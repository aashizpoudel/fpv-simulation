/*
  Throttle manager — integrates stick thrust input into a 0-1 throttle value.
  Extracted from acroController.ts.
*/

import { clamp } from "../utils/math";

export class ThrottleManager {
  private _throttle = 0;
  private readonly throttleRate: number;

  constructor(throttleRate: number) {
    this.throttleRate = throttleRate;
  }

  /** Integrate thrust input into throttle. Returns current throttle 0-1. */
  update(thrustInput: number, speedMultiplier: number, dt: number): number {
    const delta = thrustInput * this.throttleRate * dt * speedMultiplier;
    this._throttle = clamp(this._throttle + delta, 0, 1);
    return this._throttle;
  }

  reset(): void {
    this._throttle = 0;
  }

  get throttle(): number {
    return this._throttle;
  }
}
