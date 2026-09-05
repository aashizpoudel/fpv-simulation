import { readFile, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";

const manifestPath = resolve("public/maps/factory-splat/manifest.json");
try {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.levels) || !manifest.levels.length) throw new Error("Manifest has no levels");
  for (const level of manifest.levels) {
    const path = resolve(dirname(manifestPath), level.file);
    const info = await stat(path);
    if (info.size !== level.bytes) throw new Error(`Incomplete splat asset: ${level.file}`);
  }
  const collider = await readFile(resolve(dirname(manifestPath), "factory-collider.glb"));
  if (collider.subarray(0, 4).toString() !== "glTF") throw new Error("Invalid collision GLB");
  console.log("Factory splat assets and collision mesh verified.");
} catch (error) {
  console.error(`Missing or invalid Factory assets: ${error.message}\nRun npm run splat:repack before building.`);
  process.exitCode = 1;
}
