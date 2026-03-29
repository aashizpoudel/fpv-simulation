import type { Vec3 } from "../types";

/**
 * Generic world configuration interface.
 * Each map / environment implements this to describe its physical boundaries,
 * spawn points, and asset paths so the simulation and renderer can be
 * configured without hard-coding world-specific values.
 *
 * All position/bound values are specified at scale=1 (unscaled).
 * mapScale is applied automatically to all spatial values at runtime.
 */
export interface WorldConfig {
  name: string;
  mapGlbPath: string;
  /** Spawn position at scale=1. Scaled automatically by mapScale. */
  spawnPosition: Vec3;
  bounds: { min: Vec3; max: Vec3 };
  /** Ground level (Z) at scale=1. Scaled automatically by mapScale. */
  groundLevel: number;
  /** Roof height (Z) at scale=1. Scaled automatically by mapScale. */
  roofHeight: number;
  /** Scale factor applied to map AND all spatial values. Defaults to 1. */
  mapScale?: number;
  gravity?: number;
}

/** Returns a copy of the config with all spatial values multiplied by mapScale. */
export function resolveWorldConfig(config: WorldConfig): WorldConfig {
  const s = config.mapScale ?? 1;
  if (s === 1) return config;
  return {
    ...config,
    spawnPosition: scaleVec3(config.spawnPosition, s),
    bounds: {
      min: scaleVec3(config.bounds.min, s),
      max: scaleVec3(config.bounds.max, s),
    },
    groundLevel: config.groundLevel * s,
    roofHeight: config.roofHeight * s,
  };
}

function scaleVec3(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

// ---------------------------------------------------------------------------
// de_dust_2 world
// ---------------------------------------------------------------------------
// All values at scale=1 (GLB's internal transforms already convert to metres).
// Bounding box at scale=1:
//   X: -44 .. 33   (77m wide)
//   Y: -3.3 .. 7.2 (10.5m height)
//   Z: -26.5 .. 65 (91m long)

export const DedustWorldConfig: WorldConfig = {
  name: "de_dust_2",
  mapGlbPath: "maps/de_dust_2_with_real_light.glb",

  mapScale: 1,

  // Values below are at scale=1. resolveWorldConfig() scales them.
  spawnPosition: { x: 5, y: 0, z: 0.1 },

  bounds: {
    min: { x: -44, y: -3.3, z: -26.5 },
    max: { x: 33, y: 7.2, z: 65 },
  },

  groundLevel: -3.3,
  roofHeight: 7.2,
};
