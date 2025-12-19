import type { RigidBody } from "@dimforge/rapier3d-compat";
import type { Controls } from "../types";

export type ControllerTelemetry = {
  throttlePercent: number;
  rotorThrusts: number[];
};

export interface IController {
  reset(): void;
  update(controls: Controls, body: RigidBody, dt: number): void;
  getTelemetry(): ControllerTelemetry;
}
