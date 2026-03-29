import type { Controls, Quaternion, Vec3 } from "../../types";

export type ModeInput = {
  controls: Controls;
  bodyAngularVelocity: Vec3;
  orientation: Quaternion;
  throttle: number;
  dt: number;
};

export type ModeOutput = {
  roll: number;   // -1..1
  pitch: number;  // -1..1
  yaw: number;    // -1..1
};

export interface IFlightMode {
  compute(input: ModeInput): ModeOutput;
  reset(): void;
  readonly name: string;
}
