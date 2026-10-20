import { clamp } from "./math-utils";
/** Betaflight's BETAFLIGHT (legacy) rate curve, in radians per second. */
export function rateTarget(
  stick: number,
  rcRate: number,
  superRate: number,
  expo: number,
  maxDegreesPerSecond = Infinity,
): number {
  const x = clamp(stick, -1, 1);
  const shaped = shapeStick(x, expo);
  const effectiveRcRate = rcRate > 2 ? rcRate + 14.54 * (rcRate - 2) : rcRate;
  const superFactor = 1 / Math.max(0.01, 1 - Math.abs(x) * superRate);
  const degreesPerSecond = 200 * effectiveRcRate * shaped * superFactor;
  return clamp(degreesPerSecond, -maxDegreesPerSecond, maxDegreesPerSecond) * Math.PI / 180;
}
export function shapeStick(stick: number, expo: number): number {
  const x = clamp(stick, -1, 1);
  return (1 - expo) * x + expo * x ** 3;
}
