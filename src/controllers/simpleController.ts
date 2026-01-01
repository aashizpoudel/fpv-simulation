/*
  Simple velocity-based controller for a quadrotor.
  - Directly sets linear and angular velocities
  - No forces, no PID loops
  - Immediate response to stick inputs
*/

import type { RigidBody } from "@dimforge/rapier3d-compat";
import type { Controls, Vec3, Quaternion } from "../types";
import type { ControllerTelemetry, IController } from "./controller-interface";

/* ---------- types ---------- */

type SimpleConfig = {
  maxAngularSpeed?: number; // rad/s
  throttleRate?: number; // 1/s (stick -> throttle)
  damping?: number; // 0-1, how much to preserve existing angular velocity
  maxThrust?: number; // N (total thrust)
};

/* ---------- controller ---------- */

export class SimpleController implements IController {
  private readonly config: SimpleConfig;
  private throttle = 0; // 0-1

  constructor(config: SimpleConfig) {
    this.config = {
      maxAngularSpeed: config.maxAngularSpeed ?? Math.PI,
      throttleRate: config.throttleRate ?? 1,
      damping: config.damping ?? 0.8,
      maxThrust: config.maxThrust ?? 1,
    };
  }

  reset() {
    this.throttle = 0;
  }

  /* Update angular velocity and apply thrust force */
  update(controls: Controls, body: RigidBody, dt: number) {
    // 1. Update throttle from stick input
    const throttleDelta =
      controls.thrust *
      this.config.throttleRate *
      dt *
      controls.speedMultiplier;
    this.throttle = clamp(this.throttle + throttleDelta, 0, 1);

    // 2. Calculate target angular velocity (body frame)
    const targetAngVel: Vec3 = {
      x: controls.roll * this.config.maxAngularSpeed, // roll (X forward)
      y: controls.pitch * this.config.maxAngularSpeed, // pitch (Y right)
      z: controls.yaw * this.config.maxAngularSpeed, // yaw
    };

    // 3. Thrust force along body up (tilt -> forward/back movement)
    const rot = body.rotation();
    const up = rotateVector(rot, { x: 0, y: 0, z: 1 });
    const thrust = throttleToThrust(this.throttle, this.config.maxThrust);
    const force = scale(up, thrust);

    // 4. Blend with existing angular velocity (damping)
    const currentAngVel = body.angvel();
    const targetWorld = rotateVector(rot, targetAngVel);

    const newAngVel = {
      x: lerp(currentAngVel.x, targetWorld.x, 1 - this.config.damping),
      y: lerp(currentAngVel.y, targetWorld.y, 1 - this.config.damping),
      z: lerp(currentAngVel.z, targetWorld.z, 1 - this.config.damping),
    };

    // 5. Apply force + angular velocity directly
    body.resetForces(true);
    body.addForce(force, true);
    body.setAngvel(newAngVel, true);
  }

  getTelemetry(): ControllerTelemetry {
    return {
      throttlePercent: this.throttle * 100,
      rotorThrusts: [],
    };
  }
}

/* ---------- helpers ---------- */

/* quaternion rotation */
function rotateVector(q: Quaternion, v: Vec3): Vec3 {
  const { x: qx, y: qy, z: qz, w: qw } = q;
  const { x: vx, y: vy, z: vz } = v;

  const ix = qw * vx + qy * vz - qz * vy;
  const iy = qw * vy + qz * vx - qx * vz;
  const iz = qw * vz + qx * vy - qy * vx;
  const iw = -qx * vx - qy * vy - qz * vz;

  return {
    x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
    y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
    z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
  };
}

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function throttleToThrust(t: number, maxThrust: number): number {
  return t * t * maxThrust;
}

/* linear interpolation */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* clamp */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
