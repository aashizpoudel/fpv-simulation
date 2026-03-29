/*
  Generic single-axis PID controller.
  - Derivative on measurement (not error) to avoid derivative kick.
  - First-order low-pass filter on D term.
  - Integral windup clamp.
*/

export class PIDController {
  private readonly kP: number;
  private readonly kI: number;
  private readonly kD: number;
  private readonly iLimit: number;
  private readonly dFilterHz: number;

  private integral = 0;
  private prevMeasurement = 0;
  private prevDterm = 0;
  private initialized = false;

  constructor(kP: number, kI: number, kD: number, iLimit: number, dFilterHz: number) {
    this.kP = kP;
    this.kI = kI;
    this.kD = kD;
    this.iLimit = iLimit;
    this.dFilterHz = dFilterHz;
  }

  update(setpoint: number, measurement: number, dt: number): number {
    const error = setpoint - measurement;

    // P term
    const P = this.kP * error;

    // I term with windup clamp
    this.integral += error * dt;
    if (this.integral > this.iLimit) this.integral = this.iLimit;
    if (this.integral < -this.iLimit) this.integral = -this.iLimit;
    const I = this.kI * this.integral;

    // D term: derivative on measurement to avoid derivative kick
    let D = 0;
    if (!this.initialized) {
      this.initialized = true;
      // Skip D term on first call
    } else {
      const rawD = -(measurement - this.prevMeasurement) / dt;
      const alpha = dt / (dt + 1 / (2 * Math.PI * this.dFilterHz));
      const dFiltered = this.prevDterm + alpha * (rawD - this.prevDterm);
      this.prevDterm = dFiltered;
      D = this.kD * dFiltered;
    }

    this.prevMeasurement = measurement;

    return P + I + D;
  }

  reset(): void {
    this.integral = 0;
    this.prevMeasurement = 0;
    this.prevDterm = 0;
    this.initialized = false;
  }

  zeroIntegral(): void {
    this.integral = 0;
  }
}
