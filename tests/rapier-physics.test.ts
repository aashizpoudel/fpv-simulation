// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { RapierPhysics } from "../src/physics/rapier-physics";
import { Tinyhawk3Config } from "../src/config/tinyhawk-config";
import type { Controls } from "../src/types";
import type RAPIER from "@dimforge/rapier3d-compat";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FactorySplatWorldConfig } from "../src/config/factory-splat-world-config";

const neutral: Controls = { thrust: 0, pitch: 0, roll: 0, yaw: 0, speedMultiplier: 1, arm: false, reset: false };
const instances: RapierPhysics[] = [];
async function setup(z: number) {
  const physics = new RapierPhysics(Tinyhawk3Config);
  instances.push(physics);
  await physics.init({ x: 0, y: 0, z });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 0.2));
  floor.position.z = -0.1;
  physics.createCollider(floor);
  return physics;
}
function advance(physics: RapierPhysics, seconds: number, controls = neutral) {
  for (let i = 0; i < Math.round(seconds * 480); i++) physics.step(controls, 1 / 480, -Infinity);
  return physics.getTelemetry();
}
afterEach(() => { for (const instance of instances.splice(0)) instance.dispose(); });

describe("Rapier flight and contacts", () => {
  it("reports hard impact without forced disarm when the gameplay cutoff is disabled", async () => {
    const config = structuredClone(Tinyhawk3Config);
    config.body.crashCutoff = false;
    const physics = new RapierPhysics(config); instances.push(physics);
    await physics.init({x:0,y:0,z:2});
    const floor = new THREE.Mesh(new THREE.BoxGeometry(20,20,0.2)); floor.position.z=-0.1;
    physics.createCollider(floor);
    let maximumImpact = 0;
    for(let i=0;i<480;i++) maximumImpact = Math.max(maximumImpact,physics.step(neutral,1/480,-Infinity).impactDeltaVelocity ?? 0);
    expect(maximumImpact).toBeGreaterThan(3);
    expect(physics.getTelemetry().crashed).toBe(false);
    physics.setArmed(true);
    expect(advance(physics,0.1,{...neutral,throttle:0.1}).armed).toBe(true);
  });
  it("handles a glancing duct contact without declaring a hard crash", async () => {
    const physics = await setup(1);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.02,10,10)); wall.position.set(0.3,0,1);
    physics.createCollider(wall);
    const body = (physics as unknown as {body:RAPIER.RigidBody}).body;
    body.setLinvel({x:0.8,y:2,z:0},true);
    const result=advance(physics,0.5);
    expect(result.localPosition.x).toBeLessThan(0.3);
    expect(result.localPosition.y).toBeGreaterThan(0.2);
    expect(result.crashed).toBe(false);
  });

  it("settles on mesh geometry while disarmed, without crashing on a gentle landing", async () => {
    const physics = await setup(0.05);
    const result = advance(physics, 1);
    expect(result.localPosition.z).toBeCloseTo(Tinyhawk3Config.height / 2, 2);
    expect(result.localVelocity.z).toBeCloseTo(0, 2);
    expect(result.crashed).toBe(false);
  });

  it("detects a hard floor impact, cuts motors, and resets to the actual spawn", async () => {
    const physics = await setup(2);
    expect(advance(physics, 1).crashed).toBe(true);
    physics.setArmed(true);
    expect(advance(physics, 0.1).armed).toBe(false);
    physics.reset();
    expect(physics.getTelemetry().crashed).toBe(false);
    expect(physics.getTelemetry().localPosition.z).toBeCloseTo(2.055);
    expect(advance(physics, 1).localPosition.z).toBeGreaterThan(0);
  });

  it("continues falling when disarmed and reports current velocity", async () => {
    const physics = await setup(10);
    const result = advance(physics, 0.1);
    expect(result.localPosition.z).toBeLessThan(10.055);
    expect(result.localVelocity.z).toBeLessThan(-0.8);
    expect(result.localVelocity.z).toBe(physics.getSensor().localVelocity.z);
  });

  it("takes off under absolute throttle", async () => {
    const physics = await setup(0.05);
    advance(physics, 0.3);
    physics.setArmed(true);
    const result = advance(physics, 0.5, { ...neutral, arm: true, throttle: 1 });
    expect(result.localPosition.z).toBeGreaterThan(0.5);
    expect(result.crashed).toBe(false);
  });

  it("prevents a fast drone tunnelling through a thin wall and records the crash", async () => {
    const physics = await setup(1);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.02, 10, 10));
    wall.position.set(0.3, 0, 1);
    physics.createCollider(wall);
    // Seed a high-speed impact without depending on controller tuning.
    const body = (physics as unknown as { body: RAPIER.RigidBody }).body;
    body.setLinvel({ x: 80, y: 0, z: 0 }, true);
    const result = advance(physics, 0.1);
    expect(result.localPosition.x).toBeLessThan(0.3);
    expect(result.crashed).toBe(true);
  });

  it.skipIf(!existsSync("public/maps/factory-splat/factory-collider.glb"))(
    "uses the original Factory placement and supports the spawn below Z=0",
    async () => {
      const bytes = await readFile("public/maps/factory-splat/factory-collider.glb");
      const map = (await new GLTFLoader().parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "",
      )).scene;
      const config = FactorySplatWorldConfig;
      map.rotation.x = config.collisionRotationX!;
      const offset = config.collisionPosition!;
      map.position.set(offset.x, offset.y, offset.z);
      map.updateMatrixWorld(true);
      const spawn = config.spawnPosition;
      const ray = new THREE.Raycaster(new THREE.Vector3(spawn.x, spawn.y, spawn.z + 0.1), new THREE.Vector3(0, 0, -1));
      const hit = ray.intersectObject(map)[0];
      expect(hit.point.z).toBeCloseTo(-0.67765, 3);
      const physics = new RapierPhysics(Tinyhawk3Config);
      instances.push(physics);
      await physics.init(spawn);
      physics.createCollider(map);
      const result = advance(physics, 1);
      expect(result.localPosition.z).toBeGreaterThan(-0.7);
      expect(result.localPosition.z).toBeLessThan(-0.6);
      expect(result.crashed).toBe(false);
      // Real Factory ceiling, not an artificial horizontal clamp.
      physics.setArmed(true);
      const flight = advance(physics, 3, { ...neutral, arm: true, throttle: 1 });
      expect(flight.localPosition.z).toBeLessThan(2.3);
      expect(flight.crashed).toBe(true);
    },
  );
});
