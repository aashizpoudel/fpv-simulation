/*
Shared types for drone simulation state + rendering handoff.
Flow: physics emits telemetry -> main maps to pose -> renderer consumes pose.

Usage example:
import type { DronePose, Controls } from "./types";
const controls: Controls = { thrust: 0, pitch: 0, roll: 0, yaw: 0, speedMultiplier: 1 };
*/

// Shared simulation types.
export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

export type Quaternion = {
  x: number;
  y: number;
  z: number;
  w: number;
};

export type DroneTelemetry = {
  localPosition: Vec3;
  localOrientation: Quaternion;
  localVelocity: Vec3;
  gforce: number;
  throttle: number;
  rotorThrusts: number[];
  crashed: boolean;
};

export type DronePose = {
  localPosition: Vec3;
  localOrientation: Quaternion;
  worldPosition: Vec3;
  worldOrientation: Quaternion;
  worldVelocity: Vec3;
  gforce: number;
  throttle: number;
  rotorThrusts: number[];
  crashed: boolean;
};

export type Controls = {
  thrust: number;
  pitch: number;
  roll: number;
  yaw: number;
  speedMultiplier: number;
};

export type CameraMode = "fpv" | "third" | "orbit";
