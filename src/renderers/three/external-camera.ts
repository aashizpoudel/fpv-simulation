import { Quaternion, Vector3 } from "three";

/** Frame the actual drone size; never enlarge its model to compensate for distance. */
export function externalCameraRig(span: number) {
  const size = Number.isFinite(span) && span > 0 ? span : 0.105;
  return {
    thirdFov: 60,
    orbitFov: 55,
    thirdOffset: new Vector3(-3 * size, 0, 1.4 * size),
    thirdTarget: new Vector3(0.5 * size, 0, 0.15 * size),
    orbitOffset: new Vector3(-3 * size, -3 * size, 2 * size),
    minOrbitDistance: 1.5 * size,
  };
}

/** Chase follows heading, not pitch/roll: keep the horizon level during acrobatics. */
export function headingRotation(orientation: Quaternion, result: Quaternion): Quaternion {
  const { x, y, z, w } = orientation;
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return result.set(0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2));
}
