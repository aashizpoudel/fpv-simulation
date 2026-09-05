import type { BatteryConfig } from "../config/drone-config";
import { clamp } from "../utils/math";

// Empirical electrical approximation, not an ESC/motor circuit simulation.
export class BatteryModel {
  charge = 1;
  voltage = 0;
  current = 0;
  constructor(private config: BatteryConfig) {
    this.reset();
  }
  step(motorOutputs: number[], dt: number): number {
    if (this.config.fixedVoltage !== null) {
      this.voltage = this.config.fixedVoltage;
      this.current = 0;
      return this.voltage;
    }
    if (this.charge === 0) {
      this.current = 0;
      this.voltage = 0;
      return 0;
    }
    this.current =
      this.config.idleCurrent +
      motorOutputs.reduce(
        (sum, u) => sum + this.config.maxMotorCurrent * clamp(u, 0, 1) ** 2,
        0,
      );
    this.charge = clamp(
      this.charge - (this.current * dt) / (this.config.capacityAh * 3600),
      0,
      1,
    );
    const openCircuit =
      this.config.emptyVoltage +
      (this.config.fullVoltage - this.config.emptyVoltage) * this.charge;
    this.voltage =
      this.charge === 0
        ? 0
        : Math.max(0, openCircuit - this.current * this.config.resistance);
    return this.voltage;
  }
  reset(): void {
    this.charge = this.config.initialCharge;
    this.current = 0;
    this.voltage =
      this.config.fixedVoltage ??
      (this.charge === 0
        ? 0
        : this.config.emptyVoltage +
          (this.config.fullVoltage - this.config.emptyVoltage) * this.charge);
  }
}
