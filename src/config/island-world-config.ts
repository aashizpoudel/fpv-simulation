import * as THREE from "three";
import type { WorldConfig } from "./world-config";

// ---------------------------------------------------------------------------
// Island world
// ---------------------------------------------------------------------------
// Exact lighting & atmosphere specifications from island-forge-export/main.js:
// - Sun: DirectionalLight #ffe1b8, intensity 3.1, shining from (-0.72, 0.42, 0.55)
//   In simulation coordinates (rotation.x = PI / 2: GLB X->X, GLB Y->Z, GLB Z->-Y):
//   direction vector (-0.72, -0.55, 0.42)
// - Ambient: HemisphereLight, sky #d2e6ff, ground #b3a07e, intensity 1.45
// - Tone mapping: THREE.NeutralToneMapping, exposure 1.0, sRGB output
// - Fog: Exponential squared, colour #d3e4e6, density 0.0006
// - Sky: #d3e4e6 matching horizon/fog

export const IslandWorldConfig: WorldConfig = {
  name: "island",
  mapGlbPath: "maps/island/island-284457.glb",
  collisionGlbPath: "maps/island/island-284457-collision.glb",
  collisionCellSize: 32,

  mapScale: 1,

  // Street/piazza in front of the pastel village houses:
  // x_sim = 120, y_sim = -269 (z_col = 269), ground elevation z = 63.78
  spawnPosition: { x: 120, y: -269, z: 64.05 },

  bounds: {
    min: { x: -2600, y: -2600, z: -60 },
    max: { x: 2600, y: 2600, z: 500 },
  },

  groundLevel: 63.78,
  roofHeight: 450,

  // Exact reproduction of island-forge-export/main.js:
  skyColor: 0xd3e4e6,
  ambientGroundColor: 0xb3a07e,
  ambientIntensity: 1.45,

  sunColor: 0xffe1b8,
  sunIntensity: 3.1,
  sunDirection: { x: -720, y: -550, z: 420 },

  fogColor: 0xd3e4e6,
  fogDensity: 0.0006,

  toneMapping: THREE.NeutralToneMapping,
  toneMappingExposure: 1.0,
};
