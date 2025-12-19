/*
  Simple velocity-based controller for a quadrotor.
  - Directly sets linear and angular velocities
  - No forces, no PID loops
  - Immediate response to stick inputs
*/

import type { RigidBody } from "@dimforge/rapier3d-compat";
import type { Controls, Vec3, Quaternion } from "./types";

/* ---------- types ---------- */

type SimpleConfig = {
  maxLinearSpeed: number; // m/s
  maxAngularSpeed: number; // rad/s
  throttleRate: number; // 1/s (stick -> vertical speed)
  damping: number; // 0-1, how much to preserve existing velocity
};

/* ---------- controller ---------- */

export class SimpleController {
  private readonly config: SimpleConfig;
  private verticalSpeed = 0; // m/s

  constructor(config: SimpleConfig) {
    this.config = {
      maxLinearSpeed: config.maxLinearSpeed ?? 5,
      maxAngularSpeed: config.maxAngularSpeed ?? Math.PI,
      throttleRate: config.throttleRate ?? 3,
      damping: config.damping ?? 0.8,
    };
  }

  reset() {
    this.verticalSpeed = 0;
  }

  /* Update and apply velocities directly to rigid body */
  update(controls: Controls, body: RigidBody, dt: number) {
    // 1. Update vertical speed from throttle stick
    const verticalDelta =
      controls.thrust *
      this.config.throttleRate *
      dt *
      controls.speedMultiplier;
    this.verticalSpeed = clamp(
      this.verticalSpeed + verticalDelta,
      -this.config.maxLinearSpeed,
      this.config.maxLinearSpeed,
    );

    // 2. Calculate target velocities in body frame
    const targetLinVel: Vec3 = {
      x: controls.roll * this.config.maxLinearSpeed, // right
      y: controls.pitch * this.config.maxLinearSpeed, // forward
      z: this.verticalSpeed, // up
    };

    const targetAngVel: Vec3 = {
      x: controls.pitch * this.config.maxAngularSpeed, // pitch
      y: controls.roll * this.config.maxAngularSpeed, // roll
      z: controls.yaw * this.config.maxAngularSpeed, // yaw
    };

    // 3. Transform linear velocity to world space
    const rot = body.rotation();
    const worldLinVel = rotateVector(rot, targetLinVel);

    // 4. Blend with existing velocity (damping)
    const currentLinVel = body.linvel();
    const currentAngVel = body.angvel();

    const newLinVel = {
      x: lerp(currentLinVel.x, worldLinVel.x, 1 - this.config.damping),
      y: lerp(currentLinVel.y, worldLinVel.y, 1 - this.config.damping),
      z: lerp(currentLinVel.z, worldLinVel.z, 1 - this.config.damping),
    };

    const newAngVel = {
      x: lerp(currentAngVel.x, targetAngVel.x, 1 - this.config.damping),
      y: lerp(currentAngVel.y, targetAngVel.y, 1 - this.config.damping),
      z: lerp(currentAngVel.z, targetAngVel.z, 1 - this.config.damping),
    };

    // 5. Set velocities directly
    body.setLinvel(newLinVel, true);
    body.setAngvel(newAngVel, true);
  }

  getVerticalSpeed() {
    return this.verticalSpeed;
  }

  getVerticalSpeedPercent() {
    return (this.verticalSpeed / this.config.maxLinearSpeed) * 100;
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

/* linear interpolation */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* clamp */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
