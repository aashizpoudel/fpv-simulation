import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { inspectCollisionGlb } from "./lib/collision-glb.mjs";

// Reference: https://developer.playcanvas.com/user-manual/splat-transform/collision/
// Crop distant capture floaters and keep the seed-connected indoor scan.
// Carve with a drone-sized capsule rather than the default human-sized capsule.
const root = fileURLToPath(new URL("../", import.meta.url));
const base = join(root, "public/maps/ekotori");
const temporary = await mkdtemp(join(tmpdir(), "ekotori-collision-"));
const args = [
  join(root, "node_modules/@playcanvas/splat-transform/bin/cli.mjs"),
  join(base, "ekotori.ksplat"),
  "--filter-box=-40,-2,-35,40,25,35",
  "--seed-pos", "0,1,0", "--filter-cluster",
  "--voxel-size", "0.05", "--voxel-opacity", "0.1",
  "--voxel-external-fill", "--voxel-carve", "0.12,0.06",
  "--collision-mesh", "smooth",
  join(temporary, "ekotori.voxel.json"),
];
try {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit", cwd: root });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Collision generation exited ${code}; GPU access is required.`)));
  });
  const generated = join(temporary, "ekotori.collision.glb");
  const bytes = await readFile(generated);
  const { triangles } = inspectCollisionGlb(bytes);
  const map = (await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "",
  )).scene;
  map.rotation.x = Math.PI / 2;
  map.updateMatrixWorld(true);
  // Open aisle: avoid both the original floor hole and the table at (0, 1).
  const spawnXY = { x: 1.65, y: -1 };
  const ray = new THREE.Raycaster(new THREE.Vector3(spawnXY.x, spawnXY.y, 1), new THREE.Vector3(0, 0, -1));
  const floor = ray.intersectObject(map)[0];
  if (!floor || floor.distance > 2) throw new Error("No floor below the Ekotori seed; inspect generation settings.");
  // Check the entire footprint, not just the center ray, before publishing a spawn.
  for (const dx of [-0.07, 0, 0.07]) for (const dy of [-0.07, 0, 0.07]) {
    ray.ray.origin.set(spawnXY.x + dx, spawnXY.y + dy, 1);
    const support = ray.intersectObject(map)[0];
    if (!support || Math.abs(support.point.z - floor.point.z) > 0.025) {
      throw new Error("Spawn footprint has a hole or raised edge; select a flatter patch.");
    }
  }
  // A supported floor is not enough: keep a 40 cm-wide launch column clear.
  ray.ray.direction.set(0, 0, 1);
  for (const dx of [-0.2, 0, 0.2]) for (const dy of [-0.2, 0, 0.2]) {
    ray.ray.origin.set(spawnXY.x + dx, spawnXY.y + dy, floor.point.z + 0.1);
    const overhead = ray.intersectObject(map)[0];
    if (overhead && overhead.distance < 2) {
      throw new Error("Spawn is beneath an obstacle; select an open aisle.");
    }
  }
  const bounds = new THREE.Box3().setFromObject(map);
  const manifest = JSON.parse(await readFile(join(base, "manifest.json"), "utf8"));
  manifest.collision = {
    file: "./ekotori.collision.glb", bytes: bytes.length, triangles,
    source: "./ekotori.ksplat", voxelSize: 0.05,
    groundLevel: floor.point.z,
    spawnPosition: { ...spawnXY, z: floor.point.z + 0.04 },
    bounds: { min: bounds.min, max: bounds.max },
  };
  await copyFile(generated, join(base, "ekotori.collision.glb"));
  await writeFile(join(base, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Verified ${triangles} collision triangles; floor Z=${floor.point.z}.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
