import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { meshToTrimesh } from "../src/physics/map-collider";
import { partitionCollision, type CollisionPart } from "../src/physics/partition-collision";
import { RapierPhysics } from "../src/physics/rapier-physics";
import { Tinyhawk3Config } from "../src/config/tinyhawk-config";
import type { Controls } from "../src/types";

const neutral: Controls = { thrust: 0, pitch: 0, roll: 0, yaw: 0, speedMultiplier: 1, arm: false, reset: false };

function faces(data: CollisionPart): string[] {
  const result = [];
  for (let i = 0; i < data.indices.length; i += 3) {
    result.push(Array.from(data.indices.slice(i, i + 3)).map(index =>
      Array.from(data.vertices.slice(index * 3, index * 3 + 3), (v, axis) =>
        (v + (data.origin ? [data.origin.x, data.origin.y, data.origin.z][axis] : 0)).toFixed(4)).join(",")).join(";"));
  }
  return result.sort();
}

describe("spatial map collision", () => {
  beforeAll(async () => { await RAPIER.init(); });

  it("preserves oriented triangles under transforms and across cell boundaries", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(30, 20, 12, 6, 4, 3));
    mesh.position.set(-8, -3, 7); mesh.rotation.set(.3, .4, .5); mesh.scale.setScalar(1.7);
    mesh.userData.collisionCellSize = 8;
    const data = meshToTrimesh(mesh), parts = partitionCollision(data);
    expect(parts.length).toBeGreaterThan(10);
    expect(parts.flatMap(faces).sort()).toEqual(faces(data));
    for (const part of parts) {
      expect(new Set(part.indices).size).toBe(part.vertices.length / 3);
      expect(Math.max(...part.indices)).toBeLessThan(part.vertices.length / 3);
    }
    expect(partitionCollision({ vertices: data.vertices, indices: data.indices })).toHaveLength(1);
  });

  it("rejects invalid partition sizes", () => {
    const data = meshToTrimesh(new THREE.Mesh(new THREE.BoxGeometry()));
    for (const cellSize of [0, -1, NaN, Infinity]) expect(() => partitionCollision({ ...data, cellSize })).toThrow();
  });

  it.each(["ground", "trunk", "branch"])("keeps CCD impacts against %s, including partition seams", kind => {
    const geometry = kind === "ground" ? new THREE.BoxGeometry(32, 32, .02, 8, 8, 1)
      : kind === "trunk" ? new THREE.CylinderGeometry(.2, .3, 20, 8)
      : new THREE.CylinderGeometry(.015, .02, 20, 4);
    const mesh = new THREE.Mesh(geometry);
    mesh.userData.collisionCellSize = 4;
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    try {
      const parts = partitionCollision(meshToTrimesh(mesh));
      expect(parts.length).toBeGreaterThan(1);
      for (const part of parts) {
        const p = part.origin!;
        world.createCollider(RAPIER.ColliderDesc.trimesh(part.vertices, part.indices).setTranslation(p.x, p.y, p.z));
      }
      // x=y=0 lies on cell boundaries. At 80 m/s a step crosses the entire
      // thin obstacle, so overlap-only collision detection cannot suffice.
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0, .5).setCcdEnabled(true));
      world.createCollider(RAPIER.ColliderDesc.ball(.03), body);
      body.setLinvel({ x: 0, y: 0, z: -80 }, true);
      world.timestep = 1 / 120;
      for (let i = 0; i < 10; i++) world.step();
      expect(body.translation().z).toBeGreaterThan(0);
    } finally { world.free(); geometry.dispose(); }
  });

  it("replaces all map partitions and restores them after a physics rebuild", async () => {
    const physics = new RapierPhysics();
    try {
      await physics.init({ x: 0, y: 0, z: 5 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(20, 20, .2, 4, 4, 1));
      mesh.userData.collisionCellSize = 4;
      physics.createCollider(meshToTrimesh(mesh));
      expect(physics.isPropSpaceClear({ x: 1, y: 1, z: 0 }, .2)).toBe(false);
      mesh.position.z = -10;
      physics.createCollider(meshToTrimesh(mesh));
      expect(physics.isPropSpaceClear({ x: 1, y: 1, z: 0 }, .2)).toBe(true);
      expect(physics.isPropSpaceClear({ x: 1, y: 1, z: -10 }, .2)).toBe(false);
      physics.dispose();
      await physics.init({ x: 0, y: 0, z: 5 });
      expect(physics.isPropSpaceClear({ x: 1, y: 1, z: -10 }, .2)).toBe(false);
    } finally { physics.dispose(); }
  });

  it("activates swept cells before fast impacts and restores remote queries and reset contacts", async () => {
    const config = structuredClone(Tinyhawk3Config);
    config.aerodynamics.linear = { x: 0, y: 0, z: 0 };
    config.aerodynamics.quadratic = { x: 0, y: 0, z: 0 };
    const physics = new RapierPhysics(config);
    const map = new THREE.Group(); map.userData.collisionCellSize = 4;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(8, 8, .2)); floor.position.z = -.1;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(.02, 4, 4)); wall.position.set(8, 0, 1);
    const distant = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)); distant.position.set(100, 0, 0);
    map.add(floor, wall, distant);
    try {
      await physics.init({ x: 0, y: 0, z: 1 });
      physics.createCollider(meshToTrimesh(map));
      physics.step(neutral, 1 / 480, -Infinity);
      const internals = physics as unknown as { body: RAPIER.RigidBody; mapColliders: RAPIER.Collider[] };
      expect(internals.mapColliders.some(c => !c.isEnabled())).toBe(true);
      // This query must enable distant geometry, even after flight deactivates it.
      expect(physics.isPropSpaceClear({ x: 100.95, y: 0, z: 0 }, .1)).toBe(false);
      expect(physics.isPropSpaceClear({ x: 100, y: 5, z: 0 }, .1)).toBe(true);
      internals.body.setLinvel({ x: 1200, y: 0, z: 0 }, true);
      // Travel covers 20 m; the wall is outside the normal nearby margin.
      const impact = physics.step(neutral, 1 / 60, -Infinity);
      expect(impact.localPosition.x).toBeGreaterThan(2);
      expect(impact.localPosition.x).toBeLessThan(8);
      for (let i = 0; i < 8; i++) physics.step(neutral, 1 / 480, -Infinity);
      expect(physics.getTelemetry().localPosition.x).toBeLessThan(8);
      internals.body.setTranslation({ x: 90, y: 0, z: 2 }, true);
      internals.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      physics.step(neutral, 1 / 480, -Infinity);
      physics.reset();
      for (let i = 0; i < 480; i++) physics.step(neutral, 1 / 480, -Infinity);
      expect(physics.getTelemetry().localPosition.z).toBeGreaterThan(0);
      expect(physics.getTelemetry().localPosition.z).toBeLessThan(.1);
    } finally {
      physics.dispose();
      for (const mesh of [floor, wall, distant]) mesh.geometry.dispose();
    }
  });
});
