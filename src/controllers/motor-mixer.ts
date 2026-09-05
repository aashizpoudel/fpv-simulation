import type { Vec3, Quaternion } from "../types";
import type { RotorConfig, PropulsionConfig } from "../config/drone-config";
import { clamp } from "../utils/math";
import { rotateVector, cross, add, scale } from "./math-utils";
import type { ModeOutput } from "./modes/flight-mode-interface";

export type MixerRotor = { position: Vec3; yawSign: number };
export function assignYawSigns(positions: Vec3[]): MixerRotor[] {
  // Preserve configured motor order for telemetry and per-motor parameters.
  const ordered = positions
    .map((p, i) => ({ p, i }))
    .sort((a, b) => Math.atan2(a.p.y, a.p.x) - Math.atan2(b.p.y, b.p.x));
  return positions.map((position, i) => ({
    position,
    yawSign: ordered.findIndex((r) => r.i === i) % 2 === 0 ? 1 : -1,
  }));
}

export class MotorMixer {
  private rotors: MixerRotor[];
  saturation: ModeOutput = { roll: 0, pitch: 0, yaw: 0 };
  constructor(
    rotors: RotorConfig[],
    private config: PropulsionConfig,
    private yawTorquePerNewton: number,
    private centerOfMass: Vec3,
  ) {
    this.rotors = assignYawSigns(rotors.map((r) => r.position));
  }
  /** Preserve differential commands by shifting collective; scale only if the
   * differential span cannot fit. With Airmode off, clip at requested collective.
   * This is a documented simplified policy, not firmware emulation. */
  mix(throttle: number, roll: number, pitch: number, yaw: number): number[] {
    const signs = this.rotors.map((r) => ({
      roll: Math.sign(r.position.y),
      pitch: -Math.sign(r.position.x),
      yaw: r.yawSign,
    }));
    let correction = signs.map(
      (s) => s.roll * roll + s.pitch * pitch + s.yaw * yaw,
    );
    const idle = this.config.idle;
    const span = Math.max(...correction) - Math.min(...correction);
    if (this.config.airmode && span > 1 - idle)
      correction = correction.map((c) => (c * (1 - idle)) / span);
    const collective = this.config.airmode
      ? clamp(
          throttle,
          idle - Math.min(...correction),
          1 - Math.max(...correction),
        )
      : Math.max(idle, throttle);
    const commands = correction.map((c) => clamp(collective + c, idle, 1));
    // Requested minus achieved correction for conditional integration next step.
    for (const axis of ["roll", "pitch", "yaw"] as const) {
      const achieved =
        commands.reduce((sum, u, i) => sum + u * signs[i][axis], 0) / 4;
      const error = { roll, pitch, yaw }[axis] - achieved;
      this.saturation[axis] = Math.abs(error) < 1e-9 ? 0 : error;
    }
    return commands;
  }
  computeForces(
    thrusts: number[],
    orientation: Quaternion,
  ): { force: Vec3; torque: Vec3 } {
    const up = rotateVector(orientation, { x: 0, y: 0, z: 1 });
    let force: Vec3 = { x: 0, y: 0, z: 0 },
      torque: Vec3 = { x: 0, y: 0, z: 0 };
    this.rotors.forEach((r, i) => {
      const f = scale(up, thrusts[i]);
      const offset = rotateVector(orientation, {
        x: r.position.x - this.centerOfMass.x,
        y: r.position.y - this.centerOfMass.y,
        z: r.position.z - this.centerOfMass.z,
      });
      force = add(force, f);
      torque = add(
        torque,
        add(
          cross(offset, f),
          scale(up, r.yawSign * thrusts[i] * this.yawTorquePerNewton),
        ),
      );
    });
    return { force, torque };
  }
  reset(): void {
    this.saturation = { roll: 0, pitch: 0, yaw: 0 };
  }
}
