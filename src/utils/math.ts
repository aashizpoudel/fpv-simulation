import type { Quaternion } from "../types";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

export function quaternionToEulerDeg(q: Quaternion) {
  const sinrCosp = 2 * (q.w * q.x + q.y * q.z);
  const cosrCosp = 1 - 2 * (q.x * q.x + q.y * q.y);
  const roll = Math.atan2(sinrCosp, cosrCosp);

  const sinp = 2 * (q.w * q.y - q.z * q.x);
  const pitch = Math.asin(clamp(sinp, -1, 1));

  const sinyCosp = 2 * (q.w * q.z + q.x * q.y);
  const cosyCosp = 1 - 2 * (q.y * q.y + q.z * q.z);
  const yaw = Math.atan2(sinyCosp, cosyCosp);

  return {
    rollDeg: radiansToDegrees(roll),
    pitchDeg: radiansToDegrees(pitch),
    yawDeg: radiansToDegrees(yaw),
  };
}
