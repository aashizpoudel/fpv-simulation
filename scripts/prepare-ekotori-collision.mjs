import { readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";

const source = resolve("public/maps/ekotori/ekotori.collision.glb");
const target = resolve("public/maps/ekotori/ekotori.collision.glb.gz");
const compressed = gzipSync(await readFile(source), { level: 9 });
if (compressed.length > 25 * 1024 * 1024) {
  throw new Error("Compressed Ekotori collider exceeds Cloudflare's 25 MiB asset limit");
}
await writeFile(target, compressed);
console.log(`Prepared Ekotori collision asset: ${(compressed.length / 1024 / 1024).toFixed(2)} MiB.`);
