/*
  Acro-mode mixer for a quadrotor.
  - Thrust ∝ throttle²  (real prop curve)
  - Forces, not impulses → frame-rate independent
  - applyForces() must be called once per physics step
*/

import type { RigidBody } from "@dimforge/rapier3d-compat";
import type { Controls, Vec3, Quaternion } from "../types";

/* ---------- types ---------- */

type RotorConfig = {
  position: Vec3;
  yawSign: number; // +1 CCW, -1 CW
};

type AcroConfig = {
  maxThrustPerRotor: number; // N
  throttleRate: number; // 1/s (stick -> throttle)
  stickRate: number; // 1/s (stick -> attitude)
  rotorMode: boolean; // true = 4 separate forces, false = 1 force + torque
  yawTorquePerNewton: number;
};

/* ---------- controller ---------- */

export class AcroController {
  private readonly rotors: RotorConfig[];
  private readonly config: AcroConfig;
  private throttle = 0; // 0-1
  private rotorThrusts: number[]; // N

  constructor(rotorPositions: Vec3[], config: AcroConfig) {
    this.rotors = assignYawSigns(rotorPositions);
    this.config = {
      ...config,
      rotorMode: config.rotorMode ?? true,
      yawTorquePerNewton: config.yawTorquePerNewton ?? 0,
    };
    this.rotorThrusts = new Array(this.rotors.length).fill(0);
  }

  reset() {
    this.throttle = 0;
    this.rotorThrusts.fill(0);
  }

  /* 1. convert sticks -> per-rotor thrust (Newtons) */
  update(controls: Controls, dt: number) {
    // smooth throttle with expo-like feel
    const throttleDelta =
      controls.thrust *
      this.config.throttleRate *
      dt *
      controls.speedMultiplier;
    this.throttle = clamp(this.throttle + throttleDelta, 0, 1);

    const pitch = controls.pitch * this.config.stickRate;
    const roll = controls.roll * this.config.stickRate;
    const yaw = controls.yaw * this.config.stickRate;

    this.rotors.forEach((r, i) => {
      const base = this.throttleToThrust(this.throttle); // squared

      // sign convention: front-right motor ↓ pitch, ↓ roll, +yaw
      const pitchMix =
        (r.position.y >= 0 ? -pitch : pitch) * this.config.maxThrustPerRotor;
      const rollMix =
        (r.position.x >= 0 ? -roll : roll) * this.config.maxThrustPerRotor;
      const yawMix = r.yawSign * yaw * this.config.maxThrustPerRotor;

      this.rotorThrusts[i] = clamp(
        base + pitchMix + rollMix + yawMix,
        0,
        this.config.maxThrustPerRotor,
      );
    });
  }

  /* 2. apply forces (Newtons) once per physics step */
  applyForces(body: RigidBody) {
    body.resetForces(true); // Reset the forces to zero.
    body.resetTorques(true); // Reset the torques to zero.
    const rot = body.rotation();
    const up = rotateVector(rot, { x: 0, y: 0, z: 1 }); // body Z -> world

    if (this.config.rotorMode) this.applyRotorForces(body, rot, up);
    else this.applyBodyForces(body, rot, up);
  }

  getThrottlePercent() {
    return this.throttle * 100;
  }
  getRotorThrusts() {
    return [...this.rotorThrusts];
  }

  /* ---------- private ---------- */

  private throttleToThrust(t: number): number {
    return t * t * this.config.maxThrustPerRotor; // thrust ∝ Ω²
  }

  private rotorYawTorque(thrustN: number, yawSign: number): number {
    // Reaction torque about body +Z (then rotated to world via `up`)
    return yawSign * thrustN * this.config.yawTorquePerNewton;
  }

  /* 4 separate forces → pure torque, no ghost momentum */
  private applyRotorForces(body: RigidBody, rot: Quaternion, up: Vec3) {
    const com = body.translation();
    this.rotors.forEach((r, i) => {
      const thrust = this.rotorThrusts[i];
      if (thrust <= 0) return;

      const worldOffset = rotateVector(rot, r.position); // body -> world
      const point = add(com, worldOffset);
      const force = scale(up, thrust); // N
      const tz = this.rotorYawTorque(thrust, r.yawSign);
      if (tz !== 0) {
        const yawTorqueWorld = scale(up, tz); // Nm about body Z -> world
        body.addTorque(yawTorqueWorld, true);
      }

      body.addForceAtPoint(force, point, true); // Rapier integrates with its own dt
    });
  }

  /* single force + torque (cheaper, less accurate) */
  private applyBodyForces(body: RigidBody, rot: Quaternion, up: Vec3) {
    let totalForce: Vec3 = { x: 0, y: 0, z: 0 };
    let totalTorque: Vec3 = { x: 0, y: 0, z: 0 };

    this.rotors.forEach((r, i) => {
      const thrust = this.rotorThrusts[i];
      if (thrust <= 0) return;

      const worldOffset = rotateVector(rot, r.position);
      const force = scale(up, thrust);
      // torque from force offset (roll/pitch mainly, plus whatever geometry yields)
      const torqueFromOffset = cross(worldOffset, force);

      // yaw reaction torque (about body Z)
      const tz = this.rotorYawTorque(thrust, r.yawSign);
      const yawTorqueWorld = tz === 0 ? { x: 0, y: 0, z: 0 } : scale(up, tz);

      totalForce = add(totalForce, force);
      totalTorque = add(totalTorque, add(torqueFromOffset, yawTorqueWorld));
    });

    body.addForce(totalForce, true);
    body.addTorque(totalTorque, true);
  }
}

/* ---------- helpers ---------- */

/* CCW-CW order by angle around +Z */
function assignYawSigns(pos: Vec3[]): RotorConfig[] {
  return [...pos]
    .sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x))
    .map((p, i) => ({ position: p, yawSign: i % 2 === 0 ? 1 : -1 }));
}

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

/* cross product */
function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/* add vectors */
function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/* scale vector */
function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

/* clamp */
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
