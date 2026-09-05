import type { DroneConfig } from "../config/drone-config";
import type { Controls, DroneTelemetry, Vec3 } from "../types";
import { RapierPhysics } from "../physics/rapier-physics";
import type * as THREE from "three";

const DEFAULT_FIXED_TIME_STEP = 1 / 480;
// Keep real-time physics through ordinary rendering dips down to 15 FPS.
const DEFAULT_MAX_CATCH_UP = 1 / 15;

export type SimulationEngineOptions = {
  fixedTimeStep?: number;
  maxSubSteps?: number;
  clampZ?: number;
  roofHeight?: number;
  config?: DroneConfig;
  physics?: RapierPhysics;
};

export class SimulationEngine {
  private physics: RapierPhysics;
  public beforeFixedStep?: (input: Controls) => Controls | null;
  public afterFixedStep?: (input: Controls, telemetry: DroneTelemetry) => void;
  public get timestep(): number {
    return this.fixedTimeStep;
  }
  public resetBody(): void {
    this.physics.reset();
    this.lastTelemetry = this.physics.getTelemetry();
  }
  private accumulator = 0;
  public droppedTime = 0;
  public simulationTime = 0;
  private fixedTimeStep: number;
  private maxSubSteps: number;
  private clampZ: number;
  private roofHeight: number;
  private lastTelemetry: DroneTelemetry;

  constructor(options: SimulationEngineOptions = {}) {
    this.fixedTimeStep = options.fixedTimeStep ?? DEFAULT_FIXED_TIME_STEP;
    this.maxSubSteps =
      options.maxSubSteps ??
      Math.ceil(DEFAULT_MAX_CATCH_UP / this.fixedTimeStep);
    if (
      !Number.isFinite(this.fixedTimeStep) ||
      this.fixedTimeStep <= 0 ||
      !Number.isInteger(this.maxSubSteps) ||
      this.maxSubSteps < 1
    )
      throw new Error("Invalid simulation cadence");
    this.clampZ = options.clampZ ?? -Infinity;
    this.roofHeight = options.roofHeight ?? Infinity;
    this.physics = options.physics ?? new RapierPhysics(options.config);
    this.lastTelemetry = this.physics.getTelemetry();
  }

  async init(startPosition: Vec3): Promise<void> {
    if (Number.isFinite(this.roofHeight)) {
      this.physics.setRoofHeight(this.roofHeight);
    }
    await this.physics.init(startPosition);
    this.lastTelemetry = this.physics.getTelemetry();
  }

  step(input: Controls, dt: number): DroneTelemetry {
    if (!Number.isFinite(dt) || dt <= 0) {
      return this.lastTelemetry;
    }

    const maxAccumulator = this.fixedTimeStep * this.maxSubSteps;
    this.droppedTime += Math.max(0, this.accumulator + dt - maxAccumulator);
    this.accumulator = Math.min(this.accumulator + dt, maxAccumulator);

    while (this.accumulator + 1e-12 >= this.fixedTimeStep) {
      const command = this.beforeFixedStep
        ? this.beforeFixedStep(input)
        : input;
      if (command === null) {
        this.accumulator = 0;
        break;
      }
      this.lastTelemetry = this.physics.step(
        command,
        this.fixedTimeStep,
        this.clampZ,
      );
      this.afterFixedStep?.(command, this.lastTelemetry);
      this.accumulator = Math.max(0, this.accumulator - this.fixedTimeStep);
      this.simulationTime += this.fixedTimeStep;
    }

    return this.lastTelemetry;
  }

  setArmed(armed: boolean): void {
    this.physics.setArmed(armed);
  }

  reset(): void {
    this.accumulator = 0;
    this.simulationTime = 0;
    this.droppedTime = 0;
    this.physics.reset();
    this.lastTelemetry = this.physics.getTelemetry();
  }

  switchFlightMode(mode: "acro" | "angle"): void {
    this.physics.switchFlightMode(mode);
  }

  getTelemetry(): DroneTelemetry {
    return this.lastTelemetry;
  }

  dispose(): void {
    this.physics.dispose();
  }

  createMapCollider(mapObject: THREE.Object3D): void {
    this.physics.createCollider(mapObject);
  }
}
