/*
  Angle (self-leveling) flight mode — cascaded PID.
  Outer loop: angle PID (roll/pitch only).
  Inner loop: rate PID (roll/pitch/yaw).
  Yaw stays rate-only (like Betaflight).
*/

import { PIDController } from "../pid";
import { quaternionToEuler } from "../math-utils";
import type { IFlightMode, ModeInput, ModeOutput } from "./flight-mode-interface";
import type { PidRateConfig } from "./acro-mode";

export type PidAngleConfig = {
  roll: { kP: number; kI: number; kD: number };
  pitch: { kP: number; kI: number; kD: number };
  maxAngle: { roll: number; pitch: number }; // degrees
};

const DEG2RAD = Math.PI / 180;

export class AngleMode implements IFlightMode {
  readonly name = "angle";

  // Outer loop (angle) — roll and pitch only
  private readonly outerPidRoll: PIDController;
  private readonly outerPidPitch: PIDController;

  // Inner loop (rate) — roll, pitch, yaw
  private readonly innerPidRoll: PIDController;
  private readonly innerPidPitch: PIDController;
  private readonly innerPidYaw: PIDController;

  private readonly maxAngleRoll: number; // rad
  private readonly maxAnglePitch: number; // rad
  private readonly maxRateYaw: number; // rad/s

  constructor(angleConfig: PidAngleConfig, rateConfig: PidRateConfig) {
    // Outer angle PIDs (no D filter needed for angle loop typically, but reuse iLimit)
    this.outerPidRoll = new PIDController(
      angleConfig.roll.kP, angleConfig.roll.kI, angleConfig.roll.kD,
      rateConfig.iLimit, rateConfig.dFilterHz,
    );
    this.outerPidPitch = new PIDController(
      angleConfig.pitch.kP, angleConfig.pitch.kI, angleConfig.pitch.kD,
      rateConfig.iLimit, rateConfig.dFilterHz,
    );

    // Inner rate PIDs
    this.innerPidRoll = new PIDController(
      rateConfig.roll.kP, rateConfig.roll.kI, rateConfig.roll.kD,
      rateConfig.iLimit, rateConfig.dFilterHz,
    );
    this.innerPidPitch = new PIDController(
      rateConfig.pitch.kP, rateConfig.pitch.kI, rateConfig.pitch.kD,
      rateConfig.iLimit, rateConfig.dFilterHz,
    );
    this.innerPidYaw = new PIDController(
      rateConfig.yaw.kP, rateConfig.yaw.kI, rateConfig.yaw.kD,
      rateConfig.iLimit, rateConfig.dFilterHz,
    );

    this.maxAngleRoll = angleConfig.maxAngle.roll * DEG2RAD;
    this.maxAnglePitch = angleConfig.maxAngle.pitch * DEG2RAD;
    this.maxRateYaw = rateConfig.maxRate.yaw * DEG2RAD;
  }

  compute(input: ModeInput): ModeOutput {
    const { controls, bodyAngularVelocity, orientation, throttle, dt } = input;

    // Extract current roll/pitch angles from orientation
    const euler = quaternionToEuler(orientation);
    const currentRollAngle = euler.roll;
    const currentPitchAngle = euler.pitch;

    // Target angles from stick inputs
    const targetRollAngle = controls.roll * this.maxAngleRoll;
    const targetPitchAngle = controls.pitch * this.maxAnglePitch;

    // Outer PID: angle -> rate target
    const rollRateTarget = this.outerPidRoll.update(targetRollAngle, currentRollAngle, dt);
    const pitchRateTarget = this.outerPidPitch.update(targetPitchAngle, currentPitchAngle, dt);

    // Yaw: direct rate control (no outer angle PID)
    const yawRateTarget = controls.yaw * this.maxRateYaw;

    // Inner PID: rate -> correction
    const roll = this.innerPidRoll.update(rollRateTarget, bodyAngularVelocity.x, dt);
    const pitch = this.innerPidPitch.update(pitchRateTarget, bodyAngularVelocity.y, dt);
    const yaw = this.innerPidYaw.update(yawRateTarget, bodyAngularVelocity.z, dt);

    // Anti-windup at low throttle
    if (throttle < 0.05) {
      this.outerPidRoll.zeroIntegral();
      this.outerPidPitch.zeroIntegral();
      this.innerPidRoll.zeroIntegral();
      this.innerPidPitch.zeroIntegral();
      this.innerPidYaw.zeroIntegral();
    }

    return { roll, pitch, yaw };
  }

  reset(): void {
    this.outerPidRoll.reset();
    this.outerPidPitch.reset();
    this.innerPidRoll.reset();
    this.innerPidPitch.reset();
    this.innerPidYaw.reset();
  }
}
