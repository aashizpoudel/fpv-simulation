import { meshToTrimesh } from "../src/physics/map-collider";
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Box3, Mesh, BoxGeometry, MeshBasicMaterial } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { generateRaceProps, RacePropTracker, type RaceProp } from "../src/race/race-props";
import { RapierPhysics } from "../src/physics/rapier-physics";
import { IslandWorldConfig } from "../src/config/island-world-config";
import { ForestWorldConfig } from "../src/config/forest-world-config";
import { DedustWorldConfig } from "../src/config/dedust-world-config";
import { FactorySplatWorldConfig } from "../src/config/factory-splat-world-config";
import { EkotoriWorldConfig } from "../src/config/ekotori-world-config";
import { createRacePropMeshes } from "../src/renderers/three/race-prop-meshes";

function seeded(seed: number) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
const prop: RaceProp = { kind: "gate", position: { x: 0, y: 0, z: 0 }, yaw: 0, radius: 1.5 };
const p = (x: number, y = 0, z = 0) => ({ x, y, z });
describe("freestyle race props", () => {
  it("counts fast forward passes, rejects reverse passes, outside openings, and resets", () => {
    const tracker = new RacePropTracker([prop]);
    tracker.update(p(-5), 0);
    expect(tracker.update(p(5), 0.1)).toEqual([0]);
    expect(tracker.update(p(-5), 2)).toEqual([]);
    expect(tracker.update(p(5, 4), 4)).toEqual([]);
    tracker.reset();
    expect(tracker.update(p(-5), 6)).toEqual([]);
  });
  it("requires a full crossing, handles plane samples, and rejects hoop corners", () => {
    const tracker = new RacePropTracker([prop]);
    tracker.update(p(-1), 0);
    expect(tracker.update(p(0), 0.01)).toEqual([]);
    expect(tracker.update(p(0.1), 0.02)).toEqual([]);
    expect(tracker.update(p(1), 0.03)).toEqual([0]);
    const hoop = new RacePropTracker([{ ...prop, kind: "hoop", yaw: Math.PI / 2 }]);
    hoop.update(p(1.2, -3, 1.2), 0);
    expect(hoop.update(p(1.2, 3, 1.2), 1)).toEqual([]);
    hoop.reset();
    hoop.update(p(0, -3), 0);
    expect(hoop.update(p(0, 3), 1)).toEqual([0]);
  });
  for (const config of [IslandWorldConfig, DedustWorldConfig, FactorySplatWorldConfig, EkotoriWorldConfig]) {
    it(`places six gates and six hoops clear of ${config.name}'s actual collider`, async () => {
      let bytes = await readFile(`public/${config.collisionGlbPath ?? config.mapGlbPath}`);
      if (config.collisionGlbPath?.endsWith(".gz")) bytes = gunzipSync(bytes);
      const loader = new GLTFLoader().register(() => ({ name: "test_geometry_only", loadMaterial: async () => new MeshBasicMaterial() }));
      const mesh = (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "")).scene;
      mesh.rotation.x = config.collisionRotationX ?? config.visualRotationX ?? Math.PI / 2;
      if (config.collisionPosition) mesh.position.copy(config.collisionPosition);
      const bounds = new Box3().setFromObject(mesh);
      const world = { ...config, bounds: { min: { ...config.bounds.min, x: bounds.min.x, y: bounds.min.y }, max: { ...config.bounds.max, x: bounds.max.x, y: bounds.max.y } } };
      const physics = new RapierPhysics();
      try {
        physics.setRoofHeight(config.roofHeight);
        await physics.init(config.spawnPosition);
        physics.createCollider(meshToTrimesh(mesh));
        for (const seed of [1, 25, 9876]) {
          const props = generateRaceProps(world, (pos, radius) => physics.isPropSpaceClear(pos, radius), seeded(seed));
          expect(props).toHaveLength(12);
          expect(props.filter(p => p.kind === "gate")).toHaveLength(6);
          expect(props.every(p => physics.isPropSpaceClear(p.position, 2.5))).toBe(true);
        }
      } finally { physics.dispose(); }
    }, 60000);
  }
  it("scatters Forest props and keeps frame colliders separate from the map with open centers", async () => {
    const physics = new RapierPhysics();
    try {
      await physics.init(ForestWorldConfig.spawnPosition);
      const floor = new Mesh(new BoxGeometry(300, 300, 0.2));
      floor.position.z = -0.1;
      physics.createCollider(meshToTrimesh(floor));
      const props = generateRaceProps(ForestWorldConfig, (p, r) => physics.isPropSpaceClear(p, r), seeded(5));
      expect(props).toHaveLength(12);
      const meshes = createRacePropMeshes(props);
      physics.createPropCollider(meshToTrimesh(meshes));
      expect(physics.isPropSpaceClear(p(10, 10, 0), 0.2)).toBe(false);
      for (const prop of props) expect(physics.isPropSpaceClear(prop.position, 0.1)).toBe(true);
      physics.reset();
      expect(physics.isPropSpaceClear(props[0].position, 0.1)).toBe(true);
    } finally { physics.dispose(); }
  });
});
