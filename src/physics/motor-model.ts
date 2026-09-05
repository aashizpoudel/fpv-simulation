import type { PropulsionConfig } from "../config/drone-config";
import { clamp } from "../utils/math";

export function thrustFraction(
  command: number,
  curve: PropulsionConfig["thrustCurve"],
): number {
  const x = clamp(command, 0, 1);
  for (let i = 1; i < curve.length; i++) {
    const [x0, y0] = curve[i - 1];
    const [x1, y1] = curve[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return 1;
}
export function hoverCommand(
  mass: number,
  maxThrust: number,
  config: PropulsionConfig,
  voltage = config.referenceVoltage,
): number {
  const required =
    (mass * 9.81) / (maxThrust * (voltage / config.referenceVoltage) ** 2);
  if (required > 1) return Infinity;
  let low = 0,
    high = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (thrustFraction(mid, config.thrustCurve) < required) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}
export class MotorModel {
  private command = 0;
  constructor(
    private config: PropulsionConfig,
    private maxThrust: number,
  ) {}
  step(target: number, voltage: number, dt: number): number {
    const tau =
      target > this.command ? this.config.riseTime : this.config.fallTime;
    this.command +=
      (clamp(target, 0, 1) - this.command) * -Math.expm1(-dt / tau);
    return (
      this.maxThrust *
      thrustFraction(this.command, this.config.thrustCurve) *
      (Math.max(0, voltage) / this.config.referenceVoltage) ** 2
    );
  }
  get output(): number {
    return this.command;
  }
  reset(): void {
    this.command = 0;
  }
}
