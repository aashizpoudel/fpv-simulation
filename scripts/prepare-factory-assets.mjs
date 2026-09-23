import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const manifestPath = resolve("public/maps/factory-splat/manifest.json");

try {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.levels) || manifest.levels.length === 0) {
    throw new Error("Factory manifest has no levels");
  }
  for (const level of manifest.levels) {
    const asset = await stat(resolve(dirname(manifestPath), level.file));
    if (asset.size !== level.bytes) {
      throw new Error(`Factory asset is incomplete: ${level.file}`);
    }
  }
  await stat(resolve(dirname(manifestPath), "factory-collider.glb"));
  console.log("Factory assets already present.");
} catch (error) {
  console.log(`Preparing Factory assets (${error.message}).`);
  execFileSync(process.execPath, [resolve("scripts/repack-splat-lod.mjs")], {
    stdio: "inherit",
  });
}
