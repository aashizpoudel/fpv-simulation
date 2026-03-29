/*
  Acro-mode mixer for a quadrotor.
  - PID rate controller on roll/pitch/yaw
  - Thrust ∝ throttle²  (real prop curve)
  - Forces, not impulses → frame-rate independent
  - Works in Z-up coordinate space
*/

import type { Controls, Vec3, Quaternion, DroneTelemetry } from "../types";
import type { ControllerTelemetry, IController, PhysicsCommand } from "./controller-interface";
import { clamp } from "../utils/math";
import { PIDController } from "./pid";

/* ---------- types ---------- */

type RotorConfig = {
  position: Vec3;
  yawSign: number; // +1 CCW, -1 CW
};

type AcroConfig = {
  maxThrustPerRotor: number; // N
  throttleRate: number; // 1/s (stick -> throttle)
  stickRate: number; // 1/s (stick -> attitude) — kept for backward compat
  rotorMode: boolean; // true = 4 separate forces, false = 1 force + torque
  yawTorquePerNewton: number;
  pidRateConfig?: {
    roll: { kP: number; kI: number; kD: number };
    pitch: { kP: number; kI: number; kD: number };
    yaw: { kP: number; kI: number; kD: number };
    iLimit: number;
    dFilterHz: number;
    maxRate: { roll: number; pitch: number; yaw: number }; // deg/s
  };
};

/* ---------- controller ---------- */

export class AcroController implements IController {
  private readonly rotors: RotorConfig[];
  private readonly config: AcroConfig;
  private throttle = 0; // 0-1
  private rotorThrusts: number[]; // N

  // PID rate controllers
  private readonly pidRoll: PIDController | null;
  private readonly pidPitch: PIDController | null;
  private readonly pidYaw: PIDController | null;
  private readonly maxRateRoll: number; // rad/s
  private readonly maxRatePitch: number; // rad/s
  private readonly maxRateYaw: number; // rad/s
  private readonly usePID: boolean;

  constructor(rotorPositions: Vec3[], config: AcroConfig) {
    this.rotors = assignYawSigns(rotorPositions);
    this.config = {
      ...config,
      rotorMode: config.rotorMode ?? true,
      yawTorquePerNewton: config.yawTorquePerNewton ?? 0,
    };
    this.rotorThrusts = new Array(this.rotors.length).fill(0);

    // Initialize PID controllers if config is provided
    const pid = config.pidRateConfig;
    if (pid) {
      this.usePID = true;
      this.pidRoll = new PIDController(pid.roll.kP, pid.roll.kI, pid.roll.kD, pid.iLimit, pid.dFilterHz);
      this.pidPitch = new PIDController(pid.pitch.kP, pid.pitch.kI, pid.pitch.kD, pid.iLimit, pid.dFilterHz);
      this.pidYaw = new PIDController(pid.yaw.kP, pid.yaw.kI, pid.yaw.kD, pid.iLimit, pid.dFilterHz);
      const DEG2RAD = Math.PI / 180;
      this.maxRateRoll = pid.maxRate.roll * DEG2RAD;
      this.maxRatePitch = pid.maxRate.pitch * DEG2RAD;
      this.maxRateYaw = pid.maxRate.yaw * DEG2RAD;
    } else {
      this.usePID = false;
      this.pidRoll = null;
      this.pidPitch = null;
      this.pidYaw = null;
      this.maxRateRoll = 0;
      this.maxRatePitch = 0;
      this.maxRateYaw = 0;
    }
  }

  reset() {
    this.throttle = 0;
    this.rotorThrusts.fill(0);
    this.pidRoll?.reset();
    this.pidPitch?.reset();
    this.pidYaw?.reset();
  }

  /* Compute physics command based on controls and current state */
  computePhysicsCommand(
    controls: Controls,
    telemetry: DroneTelemetry,
    dt: number
  ): PhysicsCommand {
    // 1. Update throttle with expo-like feel
    const throttleDelta =
      controls.thrust *
      this.config.throttleRate *
      dt *
      controls.speedMultiplier;
    this.throttle = clamp(this.throttle + throttleDelta, 0, 1);

    let pitch: number;
    let roll: number;
    let yaw: number;

    if (this.usePID && this.pidRoll && this.pidPitch && this.pidYaw) {
      // PID rate control path
      // Compute target rates from stick inputs (rad/s)
      const targetRoll = controls.roll * this.maxRateRoll;
      const targetPitch = controls.pitch * this.maxRatePitch;
      const targetYaw = controls.yaw * this.maxRateYaw;

      // Convert angular velocity from world frame to body frame
      const conjQ = conjugateQuat(telemetry.localOrientation);
      const bodyAngVel = rotateVector(conjQ, telemetry.localAngularVelocity);

      // Run PID controllers
      roll = this.pidRoll.update(targetRoll, bodyAngVel.x, dt);
      pitch = this.pidPitch.update(targetPitch, bodyAngVel.y, dt);
      yaw = this.pidYaw.update(targetYaw, bodyAngVel.z, dt);

      // Anti-windup: zero integrals at low throttle
      if (this.throttle < 0.05) {
        this.pidRoll.zeroIntegral();
        this.pidPitch.zeroIntegral();
        this.pidYaw.zeroIntegral();
      }
    } else {
      // Legacy open-loop path
      pitch = controls.pitch * this.config.stickRate;
      roll = controls.roll * this.config.stickRate;
      yaw = controls.yaw * this.config.stickRate;
    }

    // 2. Mix into rotor thrusts
    this.rotors.forEach((r, i) => {
      const base = this.throttleToThrust(this.throttle); // squared

      // sign convention: front-right motor ↓ pitch, ↓ roll, +yaw
      const pitchMix =
        (r.position.x >= 0 ? -pitch : pitch) * this.config.maxThrustPerRotor;
      const rollMix =
        (r.position.y >= 0 ? roll : -roll) * this.config.maxThrustPerRotor;
      const yawMix = r.yawSign * yaw * this.config.maxThrustPerRotor;

      this.rotorThrusts[i] = clamp(
        base + pitchMix + rollMix + yawMix,
        0,
        this.config.maxThrustPerRotor,
      );
    });

    // 3. Compute forces and torques (in Z-up coordinate space)
    return this.computeForces(telemetry.localOrientation, telemetry.localPosition);
  }

  getTelemetry(): ControllerTelemetry {
    return {
      throttlePercent: this.throttle * 100,
      rotorThrusts: [...this.rotorThrusts],
    };
  }

  /* ---------- private ---------- */

  private throttleToThrust(t: number): number {
    return t * t * this.config.maxThrustPerRotor; // thrust ∝ Ω²
  }

  private rotorYawTorque(thrustN: number, yawSign: number): number {
    // Reaction torque about body +Z (then rotated to world via `up`)
    return yawSign * thrustN * this.config.yawTorquePerNewton;
  }

  /* Compute forces in Z-up coordinate space */
  private computeForces(rotation: Quaternion, position: Vec3): PhysicsCommand {
    const up = rotateVector(rotation, { x: 0, y: 0, z: 1 }); // body Z -> world

    if (this.config.rotorMode) {
      return this.computeRotorForces(rotation, position, up);
    } else {
      return this.computeBodyForces(rotation, up);
    }
  }

  /* 4 separate forces → pure torque, no ghost momentum */
  private computeRotorForces(
    rotation: Quaternion,
    position: Vec3,
    up: Vec3
  ): PhysicsCommand {
    let totalForce: Vec3 = { x: 0, y: 0, z: 0 };
    let totalTorque: Vec3 = { x: 0, y: 0, z: 0 };

    this.rotors.forEach((r, i) => {
      const thrust = this.rotorThrusts[i];
      if (thrust <= 0) return;

      const worldOffset = rotateVector(rotation, r.position); // body -> world
      const force = scale(up, thrust); // N

      // Torque from rotor offset
      const torqueFromOffset = cross(worldOffset, force);

      // Yaw reaction torque
      const tz = this.rotorYawTorque(thrust, r.yawSign);
      const yawTorqueWorld = tz === 0 ? { x: 0, y: 0, z: 0 } : scale(up, tz);

      totalForce = add(totalForce, force);
      totalTorque = add(totalTorque, add(torqueFromOffset, yawTorqueWorld));
    });

    return {
      force: totalForce,
      angularVelocity: { x: 0, y: 0, z: 0 }, // Not used in rotor mode
      torque: totalTorque, // ✅ Add torque to PhysicsCommand
      resetForces: true,
    };
  }

  /* single force + torque (cheaper, less accurate) */
  private computeBodyForces(rotation: Quaternion, up: Vec3): PhysicsCommand {
    let totalForce: Vec3 = { x: 0, y: 0, z: 0 };
    let totalTorque: Vec3 = { x: 0, y: 0, z: 0 };

    this.rotors.forEach((r, i) => {
      const thrust = this.rotorThrusts[i];
      if (thrust <= 0) return;

      const worldOffset = rotateVector(rotation, r.position);
      const force = scale(up, thrust);

      // torque from force offset (roll/pitch mainly, plus whatever geometry yields)
      const torqueFromOffset = cross(worldOffset, force);

      // yaw reaction torque (about body Z)
      const tz = this.rotorYawTorque(thrust, r.yawSign);
      const yawTorqueWorld = tz === 0 ? { x: 0, y: 0, z: 0 } : scale(up, tz);

      totalForce = add(totalForce, force);
      totalTorque = add(totalTorque, add(torqueFromOffset, yawTorqueWorld));
    });

    return {
      force: totalForce,
      angularVelocity: { x: 0, y: 0, z: 0 }, // Not used in body force mode
      torque: totalTorque,
      resetForces: true,
    };
  }
}

/* ---------- helpers ---------- */

/* CCW-CW order by angle around +Z */
function assignYawSigns(pos: Vec3[]): RotorConfig[] {
  return [...pos]
    .sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x))
    .map((p, i) => ({ position: p, yawSign: i % 2 === 0 ? 1 : -1 }));
}

/* quaternion conjugate (inverse for unit quaternions) */
function conjugateQuat(q: Quaternion): Quaternion {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
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
