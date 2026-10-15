import { SimulationEngine } from "./simulation-engine";
import {
  appendRecordingStep,
  type FlightRecording,
  type RecordedStep,
} from "./flight-recording";
import { generateRaceProps, RacePropTracker } from "../race/race-props";
import type { Controls } from "../types";
import type { Command, CommandResult, Snapshot } from "./simulation-messages";

const INPUT_TIMEOUT_MS = 500;

function neutralControls(): Controls {
  return {
    thrust: 0, roll: 0, pitch: 0, yaw: 0,
    arm: false, reset: false, speedMultiplier: 1,
  };
}

/**
 * Owns physics and everything that must run at physics cadence.
 * The worker calls tick() on its timer; the fallback calls it from rendering.
 * Neither transport contains its own recording or flight-control logic.
 */
export class SimulationRuntime {
  engine!: SimulationEngine;
  private controls = neutralControls();
  private mode: RecordedStep["mode"] = "angle";
  private recording?: FlightRecording;
  private recordingActive = false;
  private replay?: FlightRecording;
  private replayIndex = 0;
  private pendingReset = false;
  private step = 0;
  private armedFlightTime = 0;
  private generation = 0;
  private paused = true;
  private lastTime?: number;
  private lastInput = 0;

  constructor(private completed: () => void = () => {}) {}

  async command(command: Command): Promise<CommandResult> {
    if (command.type === "init") {
      if (this.engine) throw new Error("Simulation already initialized");
      this.engine = new SimulationEngine(command.options);
      await this.engine.init(command.position);
      this.engine.switchFlightMode(this.mode);
      this.engine.beforeFixedStep = input => this.prepareStep(input);
      this.engine.afterFixedStep = (_input, telemetry) => {
        this.step++;
        if (telemetry.armed) this.armedFlightTime += this.engine.timestep;
      };
      this.engine.onPropCompleted = this.completed;
      return;
    }
    if (!this.engine) throw new Error("Simulation is not initialized");

    switch (command.type) {
      case "controls":
        // Reset is an edge-triggered command, not a held stick value.
        this.controls = { ...command.controls, reset: false };
        this.lastInput = performance.now();
        break;
      case "armed":
        this.controls.arm = command.armed;
        this.engine.setArmed(command.armed);
        break;
      case "mode":
        this.mode = command.mode;
        this.engine.switchFlightMode(this.mode);
        break;
      case "reset":
        this.engine.resetBody();
        this.armedFlightTime = 0;
        this.generation++;
        this.pendingReset = true;
        this.lastTime = undefined;
        break;
      case "collision":
        if (command.kind === "map") this.engine.createMapCollider(command.data);
        else this.engine.createPropCollider(command.data);
        break;
      case "place-props":
        // Placement needs many synchronous Rapier queries. Perform the batch
        // here and return descriptors; the main thread still builds the meshes.
        return generateRaceProps(command.world, (position, radius) =>
          this.engine.isPropSpaceClear(position, radius));
      case "props":
        this.engine.raceProps = new RacePropTracker(command.props, command.margin);
        break;
      case "record":
        this.startRecording(command.recording);
        break;
      case "stop-recording":
        this.recordingActive = false;
        return structuredClone(this.recording);
      case "replay":
        this.recordingActive = false;
        this.replay = command.recording;
        this.replayIndex = 0;
        this.restart();
        break;
      case "pause":
        this.paused = command.paused;
        this.lastTime = undefined;
        this.controls = neutralControls();
        break;
      case "dispose":
        this.engine.dispose();
        this.paused = true;
        break;
    }
  }

  private startRecording(recording: FlightRecording): void {
    this.replay = undefined;
    this.recording = structuredClone(recording);
    this.recording.steps = [];
    this.recordingActive = true;
    this.pendingReset = false;
    this.restart();
  }

  private restart(): void {
    this.engine.reset();
    this.armedFlightTime = 0;
    this.generation++;
    this.lastTime = undefined;
  }

  /** Called by SimulationEngine immediately before each 1/480-second step. */
  private prepareStep(input: Controls): Controls | null {
    let applied = input;
    if (this.replay) {
      const next = this.replay.steps[this.replayIndex];
      if (!next) return null;
      this.replayIndex++;
      if (next.controls.reset) {
        this.engine.resetBody();
        this.armedFlightTime = 0;
        this.generation++;
      }
      // Switching the mode resets its controller. Do this only at a real
      // mode transition or reset, otherwise replay changes the PID history.
      if (next.mode !== this.mode || next.controls.reset) {
        this.mode = next.mode;
        this.engine.switchFlightMode(this.mode);
      }
      applied = next.controls;
    }
    this.engine.setArmed(applied.arm);
    if (this.recordingActive && this.recording) {
      this.recordingActive = appendRecordingStep(
        this.recording, { ...applied, reset: this.pendingReset }, this.mode,
      );
      this.pendingReset = false;
    }
    return applied;
  }

  tick(now: number): Snapshot {
    const dt = this.lastTime === undefined ? 0 : Math.max(0, (now - this.lastTime) / 1000);
    this.lastTime = now;
    // A stalled input/render thread must not leave a live drone holding throttle.
    const controls = now - this.lastInput > INPUT_TIMEOUT_MS ? neutralControls() : this.controls;
    // SimulationEngine caps catch-up and discards excess elapsed time. A delayed
    // worker callback therefore cannot build an unbounded physics backlog.
    if (!this.paused) this.engine.step(controls, dt);
    return this.snapshot();
  }

  snapshot(): Snapshot {
    return {
      telemetry: structuredClone(this.engine.getTelemetry()),
      step: this.step,
      generation: this.generation,
      simulationTime: this.engine.simulationTime,
      armedFlightTime: this.armedFlightTime,
      mode: this.mode,
      recordingSteps: this.recording?.steps.length ?? 0,
      recordingActive: this.recordingActive,
      replayComplete: !!this.replay && this.replayIndex >= this.replay.steps.length,
    };
  }
}
