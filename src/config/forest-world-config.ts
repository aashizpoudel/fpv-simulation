import type { WorldConfig } from "./world-config";

export const ForestWorldConfig: WorldConfig = {
  name: "Morning Light Forest",
  proceduralWorld: "forest",
  mapScale: 1,
  // Source clearing (0, -2) becomes (0, 2) after the Y-up to Z-up rotation.
  // Ground height there is -0.216246 m; spawn 15 cm above the terrain.
  spawnPosition: { x: 0, y: 2, z: -0.0662463577 },
  bounds: {
    min: { x: -145, y: -145, z: -5 },
    max: { x: 145, y: 145, z: 100 },
  },
  groundLevel: -5,
  roofHeight: Infinity,
};
