import * as THREE from "three";
import type { WorldConfig } from "./world-config";

// House interior authored Y-up. The renderer rotates the group +90° about X,
// so a source point (x, y, z) becomes (x, -z, y).
// Balcony start (0.2, 0.05, -7.8) becomes (0.2, 7.8, 0.05).
// z is the floor. The physics engine lifts the body by the drone height.
export const HomeWorldConfig: WorldConfig = {
  name: "home",
  proceduralWorld: "home",
  collisionCellSize: 8,
  mapScale: 1,
  // Balcony floor is y = 0 in the source. Physics lifts the body by the drone height,
  // so this z is the floor, not the camera height. A higher start falls and trips the crash cut-off.
  spawnPosition: { x: 0.2, y: 7.8, z: 0.05 },
  // Identity faces +X, along the balcony. The house is toward -Y.
  spawnYaw: -Math.PI / 2,
  bounds: {
    min: { x: -140, y: -140, z: -2 },
    max: { x: 140, y: 140, z: 30 },
  },
  groundLevel: 0,
  roofHeight: 30,
  skyColor: 0x8eabbf,
  toneMapping: THREE.ACESFilmicToneMapping,
  toneMappingExposure: 0.85,
};
