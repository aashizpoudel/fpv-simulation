import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const defaultSource =
  "https://code.playcanvas.com/temp/factory/lod-meta.json";
const defaultOutput = "public/maps/factory-splat";
const defaultCollider =
  "https://playcanv.as/apps/b466da14/files/assets/284536691/1/Factory_collider.glb";

const sourceUrl = process.argv[2] ?? defaultSource;
const levels = (process.argv[3] ?? "6,5")
  .split(",")
  .map(Number)
  .filter(Number.isInteger);
const outputDirectory = resolve(process.argv[4] ?? defaultOutput);
const colliderUrl = process.argv[5] ?? defaultCollider;

if (levels.length === 0) {
  throw new Error("Provide at least one numeric LOD, for example: 6,5");
}

globalThis.window = globalThis;
const { KSplatLoader, PlyLoader } = await import(
  "@mkkellogg/gaussian-splats-3d"
);

const sourceManifest = await fetchJson(sourceUrl);
const temporaryDirectory = await mkdtemp(join(tmpdir(), "splat-lod-repack-"));
const splatTransformCli = fileURLToPath(
  new URL(
    "../node_modules/@playcanvas/splat-transform/bin/cli.mjs",
    import.meta.url,
  ),
);

await mkdir(outputDirectory, { recursive: true });

const outputManifest = {
  source: sourceUrl,
  generatedAt: new Date().toISOString(),
  bounds: sourceManifest.tree.bound,
  levels: [],
};

try {
  for (const lod of levels) {
    const plyPath = join(temporaryDirectory, `lod${lod}.ply`);
    const ksplatName = `factory-lod${lod}.ksplat`;
    const ksplatPath = join(outputDirectory, ksplatName);

    process.stdout.write(`Repacking LOD ${lod}: SOG -> PLY -> KSPLAT\n`);
    await execFileAsync(
      process.execPath,
      [
        splatTransformCli,
        "--quiet",
        sourceUrl,
        "--select-lod",
        String(lod),
        plyPath,
        "--filter-harmonics",
        "0",
        "--overwrite",
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    );

    const plyFile = await readFile(plyPath);
    const plyData = exactArrayBuffer(plyFile);
    const splatBuffer = await PlyLoader.loadFromFileData(
      plyData,
      1,
      2,
      true,
      0,
    );
    await writeFile(ksplatPath, new Uint8Array(splatBuffer.bufferData));

    const verified = await KSplatLoader.loadFromFileData(
      splatBuffer.bufferData,
    );
    const expectedCount = countLodSplats(sourceManifest.tree, lod);
    const actualCount = verified.getSplatCount();
    if (actualCount !== expectedCount) {
      throw new Error(
        `LOD ${lod} verification failed: expected ${expectedCount}, got ${actualCount}`,
      );
    }

    outputManifest.levels.push({
      lod,
      file: `./${basename(ksplatPath)}`,
      splatCount: actualCount,
      bytes: splatBuffer.bufferData.byteLength,
    });
    process.stdout.write(
      `Verified LOD ${lod}: ${actualCount.toLocaleString()} splats, ` +
        `${formatMiB(splatBuffer.bufferData.byteLength)} MiB\n`,
    );
  }

  process.stdout.write("Downloading Factory collision GLB\n");
  const colliderResponse = await fetch(colliderUrl);
  if (!colliderResponse.ok) {
    throw new Error(
      `Could not fetch ${colliderUrl}: ${colliderResponse.status}`,
    );
  }
  let colliderData = Buffer.from(await colliderResponse.arrayBuffer());
  // This PlayCanvas asset is served as gzip bytes without a Content-Encoding
  // header. Browsers need the unpacked GLB when it is hosted by Vite/static CDNs.
  if (colliderData[0] === 0x1f && colliderData[1] === 0x8b) {
    colliderData = gunzipSync(colliderData);
  }
  if (colliderData.subarray(0, 4).toString("ascii") !== "glTF") {
    throw new Error("Downloaded collision asset is not a GLB");
  }
  const colliderName = "factory-collider.glb";
  await writeFile(join(outputDirectory, colliderName), colliderData);
  outputManifest.collision = {
    file: `./${colliderName}`,
    bytes: colliderData.byteLength,
    source: colliderUrl,
  };

  await writeFile(
    join(outputDirectory, "manifest.json"),
    `${JSON.stringify(outputManifest, null, 2)}\n`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function countLodSplats(node, lod) {
  if (node.children) {
    return node.children.reduce(
      (total, child) => total + countLodSplats(child, lod),
      0,
    );
  }
  return node.lods?.[String(lod)]?.count ?? 0;
}

function exactArrayBuffer(buffer) {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
}

function formatMiB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch ${url}: ${response.status}`);
  }
  return response.json();
}
