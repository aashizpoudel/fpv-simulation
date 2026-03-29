/*
  Acro (rate) flight mode — PID rate controller on roll/pitch/yaw.
  Extracted from acroController.ts.
*/

import { PIDController } from "../pid";
import type { IFlightMode, ModeInput, ModeOutput } from "./flight-mode-interface";

export type PidRateConfig = {
  roll: { kP: number; kI: number; kD: number };
  pitch: { kP: number; kI: number; kD: number };
  yaw: { kP: number; kI: number; kD: number };
  iLimit: number;
  dFilterHz: number;
  maxRate: { roll: number; pitch: number; yaw: number }; // deg/s
};

const DEG2RAD = Math.PI / 180;

export class AcroMode implements IFlightMode {
  readonly name = "acro";

  private readonly pidRoll: PIDController;
  private readonly pidPitch: PIDController;
  private readonly pidYaw: PIDController;
  private readonly maxRateRoll: number; // rad/s
  private readonly maxRatePitch: number; // rad/s
  private readonly maxRateYaw: number; // rad/s

  constructor(config: PidRateConfig) {
    this.pidRoll = new PIDController(config.roll.kP, config.roll.kI, config.roll.kD, config.iLimit, config.dFilterHz);
    this.pidPitch = new PIDController(config.pitch.kP, config.pitch.kI, config.pitch.kD, config.iLimit, config.dFilterHz);
    this.pidYaw = new PIDController(config.yaw.kP, config.yaw.kI, config.yaw.kD, config.iLimit, config.dFilterHz);
    this.maxRateRoll = config.maxRate.roll * DEG2RAD;
    this.maxRatePitch = config.maxRate.pitch * DEG2RAD;
    this.maxRateYaw = config.maxRate.yaw * DEG2RAD;
  }

  compute(input: ModeInput): ModeOutput {
    const { controls, bodyAngularVelocity, throttle, dt } = input;

    // Target rates from stick inputs (rad/s)
    const targetRoll = controls.roll * this.maxRateRoll;
    const targetPitch = controls.pitch * this.maxRatePitch;
    const targetYaw = controls.yaw * this.maxRateYaw;

    // Run PID controllers
    const roll = this.pidRoll.update(targetRoll, bodyAngularVelocity.x, dt);
    const pitch = this.pidPitch.update(targetPitch, bodyAngularVelocity.y, dt);
    const yaw = this.pidYaw.update(targetYaw, bodyAngularVelocity.z, dt);

    // Anti-windup: zero integrals at low throttle
    if (throttle < 0.05) {
      this.pidRoll.zeroIntegral();
      this.pidPitch.zeroIntegral();
      this.pidYaw.zeroIntegral();
    }

    return { roll, pitch, yaw };
  }

  reset(): void {
    this.pidRoll.reset();
    this.pidPitch.reset();
    this.pidYaw.reset();
  }
}
