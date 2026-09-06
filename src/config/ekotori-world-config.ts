import type { WorldConfig } from "./dedust-world-config";
import manifest from "../../public/maps/ekotori/manifest.json";

/** PlayCanvas bakes KSPLAT’s 180° Z conversion into its generated collider.
 * Spark reads raw KSPLAT coordinates, so apply that conversion to visuals only. */
export const EkotoriWorldConfig: WorldConfig = {
  name: "ekotori",
  splatLodManifestPath: "maps/ekotori/manifest.json",
  collisionGlbPath: `maps/ekotori/${manifest.collision.file.replace("./", "")}`,
  visualRotationX: Math.PI / 2,
  visualRotationZ: Math.PI,
  collisionRotationX: Math.PI / 2,
  mapScale: 1,
  spawnPosition: manifest.collision.spawnPosition,
  bounds: manifest.collision.bounds,
  groundLevel: manifest.collision.groundLevel,
  roofHeight: Number.POSITIVE_INFINITY,
};
