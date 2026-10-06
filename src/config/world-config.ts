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
  /** Regular mesh world. Mutually exclusive with splatLodManifestPath. */
  mapGlbPath?: string;
  /** Repacked coarse-to-fine splat manifest consumed by the Three.js renderer. */
  splatLodManifestPath?: string;
  /** Native PlayCanvas Streamed SOG octree (`lod-meta.json`). */
  streamedSogManifestPath?: string;
  /** Optional invisible mesh used only to build the Rapier collider. */
  collisionGlbPath?: string;
  /** X rotation applied to the visible asset. Defaults to PI / 2 for GLBs. */
  visualRotationX?: number;
  /** Local Z rotation before X rotation, for source coordinate conversion. */
  visualRotationZ?: number;
  /** X rotation applied to collisionGlbPath. Defaults to PI / 2. */
  collisionRotationX?: number;
  /** Collision asset's placement in simulation coordinates, before mapScale. */
  collisionPosition?: Vec3;
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

export function scaleVec3(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}
