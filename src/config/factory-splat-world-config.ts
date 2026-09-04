import type { WorldConfig } from "./dedust-world-config";

/**
 * PlayCanvas Factory capture repacked for Three.js.
 *
 * The browser only receives LOD 6 first, then LOD 5. The original ~1.2 GB SOG
 * remains a build-time source and is never requested by the simulator.
 */
export const FactorySplatWorldConfig: WorldConfig = {
  name: "factory-splat",
  splatLodManifestPath: "maps/factory-splat/manifest.json",
  collisionGlbPath: "maps/factory-splat/factory-collider.glb",
  visualRotationX: 0,
  collisionRotationX: Math.PI / 2,
  mapScale: 1,
  spawnPosition: { x: -26.8, y: -12.12, z: 1.19 },
  bounds: {
    min: { x: -67.06923, y: -31.69481, z: -31.75432 },
    max: { x: 56.08843, y: 51.59734, z: 29.12209 },
  },
  groundLevel: 0,
  // The collider GLB contains the actual ceiling; avoid an artificial plane.
  roofHeight: Number.POSITIVE_INFINITY,
};
