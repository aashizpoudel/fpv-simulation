import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const buildDirectory = resolve("build");
const ekotoriDirectory = join(buildDirectory, "maps/ekotori");
const compressedPath = join(ekotoriDirectory, "ekotori.collision.glb.gz");
const manifestPath = join(ekotoriDirectory, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.collision.file = "./ekotori.collision.glb.gz";
manifest.collision.bytes = (await stat(compressedPath)).size;
manifest.collision.compression = "gzip";
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

for (const name of ["ekotori.collision.glb", "ekotori-collider.glb"]) {
  await rm(join(ekotoriDirectory, name), { force: true });
}

async function checkAssetSizes(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await checkAssetSizes(path);
    else if (entry.isFile() && (await stat(path)).size > 25 * 1024 * 1024) {
      throw new Error(`Cloudflare asset exceeds 25 MiB: ${path}`);
    }
  }
}

await checkAssetSizes(buildDirectory);
console.log("Build assets fit Cloudflare's 25 MiB per-file limit.");
