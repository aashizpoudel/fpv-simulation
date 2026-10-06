import type { WorldConfig } from "./world-config";

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
