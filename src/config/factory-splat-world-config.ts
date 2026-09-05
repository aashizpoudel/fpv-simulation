import type { WorldConfig } from "./dedust-world-config";

/**
 * PlayCanvas Factory capture repacked for Three.js.
 *
 * Spark loads the finest local KSPLAT and builds a spatial LOD tree in a worker.
 * The original SOG is not requested by the default renderer.
 */
export const FactorySplatWorldConfig: WorldConfig = {
  name: "factory-splat",
  streamedSogManifestPath:
    "https://code.playcanvas.com/temp/factory/lod-meta.json",
  splatLodManifestPath: "maps/factory-splat/manifest.json",
  collisionGlbPath: "maps/factory-splat/factory-collider.glb",
  visualRotationX: 0,
  collisionRotationX: Math.PI / 2,
  // Original Factory entity is translated (-4.695, 0.438, 11.397) in Y-up.
  // The GLB alone does not include that scene placement.
  collisionPosition: { x: -4.695, y: -11.397, z: 0.438 },
  mapScale: 1,
  // Floor raycast at this X/Y is Z=-0.67765; start just above it.
  spawnPosition: { x: -26.8, y: -12.12, z: -0.65 },
  bounds: {
    min: { x: -67.06923, y: -31.69481, z: -31.75432 },
    max: { x: 56.08843, y: 51.59734, z: 29.12209 },
  },
  groundLevel: -0.67765,
  // The collider GLB contains the actual ceiling; avoid an artificial plane.
  roofHeight: Number.POSITIVE_INFINITY,
};
