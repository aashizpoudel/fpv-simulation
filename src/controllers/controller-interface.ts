import type { Controls, DroneTelemetry, Vec3 } from "../types";

export type ControllerTelemetry = {
  throttlePercent: number;
  rotorThrusts: number[];
  motorCommands?: number[];
  saturation?: { roll: number; pitch: number; yaw: number };
};

export interface IController {
  reset(): void;
  computePhysicsCommand(
    controls: Controls, 
    telemetry: DroneTelemetry, 
    dt: number
  ): PhysicsCommand;
  getTelemetry(): ControllerTelemetry;
}

export interface PhysicsCommand {
  force: Vec3;           // Force to apply in world space
  angularVelocity: Vec3; // Angular velocity in world space (for SimpleController)
  torque?: Vec3;         // Torque to apply in world space (for AcroController)
  resetForces: boolean;  // Whether to reset forces before applying
}