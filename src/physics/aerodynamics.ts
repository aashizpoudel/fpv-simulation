import type { AeroConfig } from "../config/drone-config";
import type { Quaternion, Vec3 } from "../types";
import { conjugateQuat, rotateVector } from "../controllers/math-utils";

export function aerodynamicForces(
  velocity: Vec3,
  angularVelocity: Vec3,
  orientation: Quaternion,
  config: AeroConfig,
) {
  const inverse = conjugateQuat(orientation);
  const v = rotateVector(inverse, velocity);
  const w = rotateVector(inverse, angularVelocity);
  const force = { x: 0, y: 0, z: 0 },
    torque = { x: 0, y: 0, z: 0 };
  for (const axis of ["x", "y", "z"] as const) {
    force[axis] =
      -config.linear[axis] * v[axis] -
      config.quadratic[axis] * Math.abs(v[axis]) * v[axis];
    torque[axis] = -config.angular[axis] * w[axis];
  }
  return {
    force: rotateVector(orientation, force),
    torque: rotateVector(orientation, torque),
  };
}
