/*
  Motor mixer — converts throttle + PID corrections into per-rotor thrusts,
  then computes world-space forces and torques from rotor geometry.
  Extracted from acroController.ts.
*/

import type { Vec3, Quaternion } from "../types";
import { clamp } from "../utils/math";
import { rotateVector, cross, add, scale } from "./math-utils";

export type MixerRotor = {
  position: Vec3;
  yawSign: number; // +1 CCW, -1 CW
};

/** Assign alternating CCW/CW yaw signs sorted by angle around +Z */
export function assignYawSigns(positions: Vec3[]): MixerRotor[] {
  return [...positions]
    .sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x))
    .map((p, i) => ({ position: p, yawSign: i % 2 === 0 ? 1 : -1 }));
}

export class MotorMixer {
  private readonly rotors: MixerRotor[];
  private readonly maxThrustPerRotor: number;
  private readonly yawTorquePerNewton: number;
  private readonly rotorMode: boolean;
  private _rotorThrusts: number[];

  constructor(
    rotorPositions: Vec3[],
    maxThrustPerRotor: number,
    yawTorquePerNewton: number,
    rotorMode: boolean,
  ) {
    this.rotors = assignYawSigns(rotorPositions);
    this.maxThrustPerRotor = maxThrustPerRotor;
    this.yawTorquePerNewton = yawTorquePerNewton;
    this.rotorMode = rotorMode;
    this._rotorThrusts = new Array(this.rotors.length).fill(0);
  }

  /** Convert throttle (0-1) to thrust (N) via squared curve */
  throttleToThrust(t: number): number {
    return t * t * this.maxThrustPerRotor;
  }

  /**
   * Mix throttle + PID corrections into per-rotor thrust values.
   * roll/pitch/yaw are normalized corrections (-1..1 range from PID output).
   */
  mix(throttle: number, roll: number, pitch: number, yaw: number): number[] {
    const base = this.throttleToThrust(throttle);

    this.rotors.forEach((r, i) => {
      const pitchCorr =
        (r.position.x >= 0 ? -pitch : pitch) * this.maxThrustPerRotor;
      const rollCorr =
        (r.position.y >= 0 ? roll : -roll) * this.maxThrustPerRotor;
      const yawCorr = r.yawSign * yaw * this.maxThrustPerRotor;

      this._rotorThrusts[i] = clamp(
        base + pitchCorr + rollCorr + yawCorr,
        0,
        this.maxThrustPerRotor,
      );
    });

    return this._rotorThrusts;
  }

  /** Compute world-space force and torque from per-rotor thrusts + orientation */
  computeForces(
    rotorThrusts: number[],
    orientation: Quaternion,
  ): { force: Vec3; torque: Vec3 } {
    const up = rotateVector(orientation, { x: 0, y: 0, z: 1 });

    let totalForce: Vec3 = { x: 0, y: 0, z: 0 };
    let totalTorque: Vec3 = { x: 0, y: 0, z: 0 };

    this.rotors.forEach((r, i) => {
      const thrust = rotorThrusts[i];
      if (thrust <= 0) return;

      const worldOffset = rotateVector(orientation, r.position);
      const force = scale(up, thrust);

      // Torque from rotor offset
      const torqueFromOffset = cross(worldOffset, force);

      // Yaw reaction torque
      const tz = r.yawSign * thrust * this.yawTorquePerNewton;
      const yawTorqueWorld = tz === 0 ? { x: 0, y: 0, z: 0 } : scale(up, tz);

      totalForce = add(totalForce, force);
      totalTorque = add(totalTorque, add(torqueFromOffset, yawTorqueWorld));
    });

    return { force: totalForce, torque: totalTorque };
  }

  getRotorThrusts(): number[] {
    return [...this._rotorThrusts];
  }

  reset(): void {
    this._rotorThrusts.fill(0);
  }
}
