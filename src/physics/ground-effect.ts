/**
 * Cheeseman–Bennett in-ground-effect thrust multiplier.
 * The factor is 1 above one rotor diameter. Height is clamped to half a
 * radius because the formula is not valid closer to the surface.
 */
export function groundEffectFactor(heightM: number, rotorRadiusM: number): number {
  if (!(rotorRadiusM > 0) || !(heightM < rotorRadiusM * 2)) return 1;
  const z = Math.max(heightM, rotorRadiusM / 2);
  const ratio = rotorRadiusM / (4 * z);
  return 1 / (1 - ratio * ratio);
}
