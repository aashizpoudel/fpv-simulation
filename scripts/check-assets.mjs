import { readFile, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { inspectCollisionGlb } from "./lib/collision-glb.mjs";

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
  inspectCollisionGlb(collider);
  console.log("Factory splat assets and collision mesh verified.");
} catch (error) {
  console.error(`Missing or invalid Factory assets: ${error.message}\nRun npm run splat:repack before building.`);
  process.exitCode = 1;
}

try {
  const base = resolve("public/maps/ekotori");
  const manifest = JSON.parse(await readFile(resolve(base, "manifest.json"), "utf8"));
  if (!manifest.levels?.length) throw new Error("Manifest has no levels");
  for (const level of manifest.levels) {
    const bytes = await readFile(resolve(base, level.file));
    if (bytes.length !== level.bytes || bytes.length < 1024 ||
        bytes.readUInt32LE(16) !== level.splatCount) {
      throw new Error(`Incomplete or invalid splat asset: ${level.file}`);
    }
  }
  if (!manifest.collision?.file) throw new Error("Missing collision metadata; run npm run collision:ekotori");
  const collider = await readFile(resolve(base, manifest.collision.file));
  const { triangles } = inspectCollisionGlb(collider);
  if (collider.length !== manifest.collision.bytes || triangles !== manifest.collision.triangles) {
    throw new Error("Collision mesh does not match manifest");
  }
  console.log(`Ekotori assets verified: ${triangles} collision triangles.`);
} catch (error) {
  console.error(`Missing or invalid Ekotori assets: ${error.message}\nRestore public/maps/ekotori/ekotori.ksplat and its manifest before building.`);
  process.exitCode = 1;
}
