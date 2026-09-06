import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Euler, Vector3 } from "three";
import manifest from "../public/maps/ekotori/manifest.json";
import { EkotoriWorldConfig } from "../src/config/ekotori-world-config";
import { fetchSplatLodManifest } from "../src/renderers/three/splat-lod-loader";

describe("Ekotori world", () => {
  it("uses the existing manifest loader and matches the local splat header", async () => {
    const config = EkotoriWorldConfig;
    const json = await readFile(`public/${config.splatLodManifestPath}`, "utf8");
    const manifest = await fetchSplatLodManifest(
      new URL(`https://example.test/${config.splatLodManifestPath}`),
      async () => new Response(json),
    );
    const level = manifest.levels[0];
    const asset = await readFile(`public/maps/ekotori/${level.file}`);
    expect(asset.length).toBe(level.bytes);
    expect(asset.readUInt32LE(16)).toBe(level.splatCount);
    expect(level.bytes).toBeLessThan(64 * 1024 * 1024);
  });

  it("uses generated triangles aligned with the visual splats", () => {
    const config = EkotoriWorldConfig;
    expect(config.collisionGlbPath).toBe("maps/ekotori/ekotori.collision.glb");
    expect(config.collisionRotationX).toBe(config.visualRotationX);
    expect(config.visualRotationX).toBe(Math.PI / 2);
    expect(config.spawnPosition.z).toBeGreaterThan(config.groundLevel);
    expect(config.roofHeight).toBe(Infinity);
    expect(manifest.collision.voxelSize).toBe(0.05);
    expect(config.spawnPosition).toMatchObject({ x: 1.65, y: -1 });
  });

  it("maps raw KSPLAT points onto PlayCanvas collision coordinates", () => {
    const config = EkotoriWorldConfig;
    // PlayCanvas Transform.PLY is a 180-degree Z rotation: (x,y,z)->(-x,-y,z).
    // Spark leaves the stored centers unchanged. Include off-axis points so
    // matching only the floor height cannot hide a mirrored horizontal axis.
    for (const raw of [[2, -0.25, 3], [-4, -5, 7], [1, 2, -3]]) {
      const visual = new Vector3(...raw).applyEuler(new Euler(
        config.visualRotationX, 0, config.visualRotationZ ?? 0, "XYZ",
      ));
      const collider = new Vector3(-raw[0], -raw[1], raw[2]).applyEuler(
        new Euler(config.collisionRotationX, 0, 0),
      );
      expect(visual.distanceTo(collider)).toBeLessThan(1e-10);
    }
  });

  it("is available in the environment selector", async () => {
    expect(await readFile("index.html", "utf8")).toContain('value="ekotori"');
  });
});
