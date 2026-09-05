import type { Controls, Vec3 } from "../types";
import type { DroneConfig } from "../config/drone-config";
import { normalizePreset, PHYSICS_VERSION } from "../config/presets";
export const MAX_RECORDING_STEPS = 480 * 120;
export type RecordedStep = { controls: Controls; mode: "acro" | "angle" };
export type FlightRecording = {
  version: 1;
  physicsVersion: string;
  fixedTimeStep: number;
  config: DroneConfig;
  world: string;
  initialPosition: Vec3; // reset spawn; physics applies its normal spawn clearance
  steps: RecordedStep[];
};
export function createRecording(
  config: DroneConfig,
  world: string,
  initialPosition: Vec3,
  fixedTimeStep = 1 / 480,
): FlightRecording {
  return {
    version: 1,
    physicsVersion: PHYSICS_VERSION,
    fixedTimeStep,
    config: normalizePreset(config),
    world,
    initialPosition: { ...initialPosition },
    steps: [],
  };
}
export function parseRecording(text: string): FlightRecording {
  if (text.length > 20_000_000) throw new Error("Recording exceeds 20 MB");
  const r = JSON.parse(text) as FlightRecording;
  if (r?.version !== 1 || r.physicsVersion !== PHYSICS_VERSION)
    throw new Error("Unsupported recording or physics version");
  if (r.fixedTimeStep !== 1 / 480)
    throw new Error("Browser recordings require 480 Hz");
  r.config = normalizePreset(r.config);
  if (typeof r.world !== "string" || r.world.length > 100)
    throw new Error("Invalid recording world");
  if (
    !r.initialPosition ||
    !["x", "y", "z"].every((k) =>
      Number.isFinite(r.initialPosition[k as keyof Vec3]),
    )
  )
    throw new Error("Invalid initial position");
  if (
    !Array.isArray(r.steps) ||
    r.steps.length < 1 ||
    r.steps.length > MAX_RECORDING_STEPS
  )
    throw new Error("Recording must contain 1–57600 steps");
  for (const step of r.steps) {
    if (!step || !["acro", "angle"].includes(step.mode) || !step.controls)
      throw new Error("Invalid recorded step");
    const c = step.controls;
    for (const axis of ["thrust", "roll", "pitch", "yaw"] as const)
      if (!Number.isFinite(c[axis]) || Math.abs(c[axis]) > 1)
        throw new Error(`Invalid ${axis} command`);
    if (
      c.throttle !== undefined &&
      (!Number.isFinite(c.throttle) || c.throttle < 0 || c.throttle > 1)
    )
      throw new Error("Invalid throttle");
    if (
      typeof c.arm !== "boolean" ||
      typeof c.reset !== "boolean" ||
      !Number.isFinite(c.speedMultiplier) ||
      c.speedMultiplier < 0 ||
      c.speedMultiplier > 2
    )
      throw new Error("Invalid controls");
  }
  return r;
}
