import type { Controls, DroneTelemetry, Vec3 } from "../types";
import type { SimulationEngineOptions } from "./simulation-engine";
import type { FlightRecording } from "./flight-recording";
import type { RaceProp } from "../race/race-props";
import type { WorldConfig } from "../config/world-config";

/** Already transformed into simulation/world coordinates on the main thread. */
export type CollisionData = {
  vertices: Float32Array;
  indices: Uint32Array;
  /** Optional world-space cell size for static map collision broadphase. */
  cellSize?: number;
};

// A class instance cannot cross the worker boundary. Tests can still inject
// physics directly into SimulationEngine without using the client.
export type SimulationOptions = Omit<SimulationEngineOptions, "physics">;

export type Command =
  | { type: "init"; options: SimulationOptions; position: Vec3 }
  | { type: "controls"; controls: Controls }
  | { type: "armed"; armed: boolean }
  | { type: "reset" }
  | { type: "mode"; mode: "acro" | "angle" }
  | { type: "collision"; kind: "map" | "props"; data: CollisionData }
  | { type: "place-props"; world: WorldConfig }
  | { type: "props"; props: RaceProp[]; margin: number }
  | { type: "record"; recording: FlightRecording }
  | { type: "stop-recording" }
  | { type: "replay"; recording?: FlightRecording }
  | { type: "pause"; paused: boolean }
  | { type: "dispose" };

export type CommandResult = FlightRecording | RaceProp[] | undefined;

export type Envelope = {
  requestId: number;
  sessionId: number;
  timestamp: number;
};

export type SimulationRequest = Envelope & { command: Command };

export type Snapshot = {
  telemetry: DroneTelemetry;
  step: number;
  generation: number;
  simulationTime: number;
  armedFlightTime: number;
  mode: "acro" | "angle";
  recordingSteps: number;
  recordingActive: boolean;
  replayComplete: boolean;
};

export type ResponsePayload =
  | { type: "ready" | "ack"; result?: CommandResult }
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "prop-completed" }
  | { type: "error"; message: string; fatal: boolean };

export type SimulationResponse = Envelope & ResponsePayload;
