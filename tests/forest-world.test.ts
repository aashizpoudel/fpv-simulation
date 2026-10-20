import { generateRaceProps } from "../src/race/race-props";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { createForest, groundH, type ForestEnvironment } from "../src/renderers/three/forest/forest";
import { ForestWorldConfig } from "../src/config/forest-world-config";
import { meshToTrimesh } from "../src/physics/map-collider";
import { partitionCollision } from "../src/physics/partition-collision";
import { resolveWorld, resolveWorldName } from "../src/app/url-options";
import { RapierPhysics } from "../src/physics/rapier-physics";
import { Tinyhawk3Config } from "../src/config/tinyhawk-config";
import type { Controls } from "../src/types";

describe("procedural forest", () => {
  let forest: ForestEnvironment;
  beforeAll(() => {
    // Test real geometry independently of canvas rasterization and WebGL.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      const canvas = this;
      return new Proxy({}, {
        get: (_target, key) => {
          if (key === "getImageData") return () => ({ data: new Uint8ClampedArray(canvas.width * canvas.height * 4) });
          if (key === "createRadialGradient") return () => ({ addColorStop() {} });
          return () => {};
        },
      }) as CanvasRenderingContext2D;
    } as any);
    forest = createForest({ capabilities: { getMaxAnisotropy: () => 1 }, shadowMap: {} } as THREE.WebGLRenderer);
  });
  afterAll(() => { forest?.dispose(); vi.restoreAllMocks(); });

  it("places 12 freestyle props clear of real terrain and trees", async () => {
    const physics = new RapierPhysics();
    try {
      await physics.init(ForestWorldConfig.spawnPosition);
      physics.createCollider(meshToTrimesh(forest.collision));
      let seed = 42;
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      const props = generateRaceProps(ForestWorldConfig, (p, r) => physics.isPropSpaceClear(p, r), random);
      expect(props).toHaveLength(12);
      expect(props.every(p => physics.isPropSpaceClear(p.position, 2.5))).toBe(true);
    } finally { physics.dispose(); }
  });

  it("selects Forest via URL and resolves its configuration", () => {
    window.history.replaceState({}, "", "?world=forest");
    expect(resolveWorldName()).toBe("forest");
    expect(resolveWorld("forest")).toBe(ForestWorldConfig);
    window.history.replaceState({}, "", "/");
    expect(ForestWorldConfig.roofHeight).toBe(Infinity);
  });

  it("caches sun shadows and refreshes them after quality changes", () => {
    const sun = forest.root.children.find((o) => o instanceof THREE.DirectionalLight) as THREE.DirectionalLight;
    const camera = new THREE.PerspectiveCamera();
    forest.setQuality("detail");
    forest.update(camera);
    expect(sun.shadow.autoUpdate).toBe(false);
    expect(sun.shadow.needsUpdate).toBe(true);
    // Simulate the renderer consuming the pending shadow update.
    sun.shadow.needsUpdate = false;
    forest.update(camera);
    expect(sun.shadow.needsUpdate).toBe(false);
    forest.setQuality("performance");
    expect(sun.castShadow).toBe(false);
    forest.setQuality("detail");
    expect(sun.castShadow).toBe(true);
    expect(sun.shadow.needsUpdate).toBe(true);
    expect(forest.root.matrixAutoUpdate).toBe(true);
    expect(forest.collision.children.every((o) => !o.matrixAutoUpdate)).toBe(true);
  });

  it("aligns collision terrain with visible terrain and leaves clearance at spawn", () => {
    forest.root.updateMatrixWorld(true);
    forest.collision.updateMatrixWorld(true);
    const spawn = ForestWorldConfig.spawnPosition;
    const ray = new THREE.Raycaster(new THREE.Vector3(spawn.x, spawn.y, 30), new THREE.Vector3(0, 0, -1));
    const ground = forest.root.children.find((o) => o instanceof THREE.Mesh && o.geometry instanceof THREE.PlaneGeometry)!;
    const visibleHit = ray.intersectObject(ground)[0];
    const solidHit = ray.intersectObject(forest.collision, true)[0];
    expect(visibleHit).toBeDefined();
    expect(solidHit.point.distanceTo(visibleHit.point)).toBeLessThan(1e-6);
    expect(solidHit.point.z).toBeCloseTo(groundH(spawn.x, -spawn.y), 5);
    expect(spawn.z - solidHit.point.z).toBeCloseTo(0.15, 5);
  });

  it("registers placed obstacles as ordinary meshes usable by Rapier", async () => {
    expect(forest.collision.children.length).toBeGreaterThan(300);
    expect(forest.collision.children.every((o) => o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh))).toBe(true);
    const tree = forest.collision.children[1] as THREE.Mesh;
    const box = new THREE.Box3().setFromObject(tree);
    const center = box.getCenter(new THREE.Vector3());
    const { vertices, indices } = meshToTrimesh(forest.collision);
    expect(vertices.every(Number.isFinite)).toBe(true);
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: 0, z: -9.81 });
    try {
      world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(vertices), new Uint32Array(indices)));
      world.step();
      // The first tree is in the nearby grove, away from the origin.
      const hit = world.castRay(new RAPIER.Ray({ x: box.min.x - 2, y: center.y, z: center.z }, { x: 1, y: 0, z: 0 }), box.max.x - box.min.x + 4, true);
      expect(hit).not.toBeNull();
    } finally { world.free(); }
  });

  it("blocks canopy impacts on placed conifer and deciduous branches", async () => {
    await RAPIER.init();
    forest.collision.updateMatrixWorld(true);
    for (const name of ["Conifer branches", "Deciduous branches"]) {
      const branches = forest.collision.children.find((o) => o.name === name) as THREE.Mesh;
      expect(branches).toBeDefined();
      // Test a branch well away from the trunk, in simulation coordinates.
      const probes = branches.geometry.userData.branchProbes as { center: number[]; normal: number[]; radius: number }[];
      const probe = [...probes].sort((a, b) => Math.hypot(b.center[0], b.center[2]) - Math.hypot(a.center[0], a.center[2]))[0];
      const center = new THREE.Vector3().fromArray(probe.center).applyMatrix4(branches.matrixWorld);
      const direction = new THREE.Vector3().fromArray(probe.normal).transformDirection(branches.matrixWorld);
      const origin = center.clone().addScaledVector(direction, 0.6);
      const { vertices, indices } = meshToTrimesh(branches);
      const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
      try {
        for (const part of partitionCollision({ vertices, indices, cellSize: forest.collision.userData.collisionCellSize })) {
          const p = part.origin!;
          world.createCollider(RAPIER.ColliderDesc.trimesh(part.vertices, part.indices).setTranslation(p.x, p.y, p.z));
        }
        world.step();
        const ray = world.castRay(new RAPIER.Ray(origin, direction.clone().negate()), 1.2, true);
        expect(ray).not.toBeNull();
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(origin.x, origin.y, origin.z).setCcdEnabled(true));
        world.createCollider(RAPIER.ColliderDesc.ball(0.03), body);
        body.setLinvel(direction.clone().multiplyScalar(-80), true);
        world.timestep = 1 / 120;
        for (let i = 0; i < 24; i++) world.step();
        const offset = new THREE.Vector3().copy(body.translation()).sub(center).dot(direction);
        expect(offset).toBeGreaterThan(0);
      } finally { world.free(); }
    }
    // Quality changes only affect visuals; woody canopy collisions remain active.
    const before = meshToTrimesh(forest.collision).indices.length;
    forest.setQuality("performance"); forest.update(new THREE.PerspectiveCamera());
    expect(meshToTrimesh(forest.collision).indices.length).toBe(before);
    expect(before / 3).toBeLessThan(600_000);
  });

  it("settles on the forest floor, takes off, and resets to the clearing", async () => {
    const physics = new RapierPhysics(Tinyhawk3Config);
    const spawn = ForestWorldConfig.spawnPosition;
    const neutral: Controls = { thrust: 0, pitch: 0, roll: 0, yaw: 0, speedMultiplier: 1, arm: false, reset: false };
    try {
      await physics.init(spawn);
      physics.createCollider(meshToTrimesh(forest.collision));
      for (let i = 0; i < 240; i++) physics.step(neutral, 1 / 480, -Infinity);
      const settled = physics.getTelemetry();
      expect(settled.localPosition.z).toBeGreaterThan(groundH(spawn.x, -spawn.y));
      expect(settled.crashed).toBe(false);
      physics.setArmed(true);
      for (let i = 0; i < 240; i++) physics.step({ ...neutral, arm: true, throttle: 1 }, 1 / 480, -Infinity);
      const flying = physics.getTelemetry();
      expect(flying.localPosition.z).toBeGreaterThan(settled.localPosition.z + 0.5);
      expect(flying.crashed).toBe(false);
      physics.reset();
      const reset = physics.getTelemetry();
      expect(reset.localPosition.x).toBeCloseTo(spawn.x);
      expect(reset.localPosition.y).toBeCloseTo(spawn.y);
      expect(reset.localPosition.z).toBeGreaterThan(spawn.z);
      expect(reset.armed).toBe(false);
    } finally { physics.dispose(); }
  });
});
