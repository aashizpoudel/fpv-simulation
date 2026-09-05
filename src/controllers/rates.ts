import { clamp } from "../utils/math";
/** Simple cubic expo, deliberately not labeled as a Betaflight rate type. */
export function rateTarget(
  stick: number,
  maxDegreesPerSecond: number,
  expo: number,
): number {
  return (shapeStick(stick, expo) * maxDegreesPerSecond * Math.PI) / 180;
}
export function shapeStick(stick: number, expo: number): number {
  const x = clamp(stick, -1, 1);
  return (1 - expo) * x + expo * x ** 3;
}
