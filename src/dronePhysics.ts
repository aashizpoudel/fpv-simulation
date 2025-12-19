/*
Builds and steps the Rapier physics world for the drone.
Flow: init Rapier -> parse DAE -> create body/collider -> step with acro
controller -> emit telemetry each frame.

Usage example:
const physics = await createDronePhysics("/drone_models/drone.dae");
const telemetry = stepDronePhysics(physics, controls, deltaTime);
*/
import RAPIER from "@dimforge/rapier3d-compat";
import type { Controls, DroneTelemetry, Vec3 } from "./types";
import { parseDroneDae } from "./daeParser";
import { AcroController } from "./acroController";
import { DroneConfig, Tinyhawk3Config } from "./config/tinyhawk-config";

export type DronePhysics = {
  world: RAPIER.World;
  body: RAPIER.RigidBody;
  controller: AcroController;
  crashed: boolean;
  lastVelocity: Vec3;
  spawnHeight: number;
  armed: boolean;
  rotorOffsets: Vec3[];
  colliderHalfExtents: Vec3;
};

const GRAVITY = 9.81;

export async function createDronePhysicsFromConfig(
  config: DroneConfig = Tinyhawk3Config,
): Promise<DronePhysics> {
  await RAPIER.init();

  // Z-up world, gravity -Z
  const world = new RAPIER.World({ x: 0, y: 0, z: -GRAVITY });

  const spawnHeight = config.height + 0.05;

  // Ground
  const groundBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0),
  );

  const groundCollider = RAPIER.ColliderDesc.cuboid(500, 500, 0.5)
    .setMass(1)
    .setFriction(1.0);
  world.createCollider(groundCollider, groundBody);

  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, 0, spawnHeight)
    .setLinearDamping(config.linearDamping)
    .setAngularDamping(config.angularDamping)
    .setCcdEnabled(true);

  const body = world.createRigidBody(bodyDesc);

  // Collider from config dimensions
  const halfExtents = {
    x: config.width / 2,
    y: config.depth / 2,
    z: config.height / 2,
  };

  const colliderDesc = RAPIER.ColliderDesc.cuboid(
    halfExtents.x,
    halfExtents.y,
    halfExtents.z,
  )
    .setMass(config.mass)
    .setFriction(0.8) // Add friction
    .setRestitution(0.1);

  world.createCollider(colliderDesc, body);

  // Use rotor positions from config
  const rotorPositions = config.rotors.map((r) => r.position);

  const controller = new AcroController(rotorPositions, {
    maxThrustPerRotor: config.rotors[0]?.maxThrust ?? 12,
    throttleRate: config.throttleRate,
    stickRate: config.stickRate,
    rotorMode: config.rotorMode,
  });

  return {
    world,
    body,
    controller,
    crashed: false,
    lastVelocity: { x: 0, y: 0, z: 0 },
    spawnHeight,
    armed: false,
    rotorOffsets: rotorPositions,
    colliderHalfExtents: halfExtents,
  };
}

// Reset Rapier state and controller back to a safe spawn.
export function resetDronePhysics(physics: DronePhysics) {
  physics.body.setTranslation({ x: 0, y: 0, z: physics.spawnHeight }, true);
  physics.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  physics.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  physics.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  physics.controller.reset();
  physics.crashed = false;
  physics.lastVelocity = { x: 0, y: 0, z: 0 };
  physics.armed = false;
}

// Toggle arming; disarm resets throttle so the drone stays on the ground.
export function setDroneArmed(physics: DronePhysics, armed: boolean) {
  physics.armed = armed;
  if (!armed) {
    physics.controller.reset();
  }
}

// Step physics and return telemetry in the drone's local (ENU) frame.
export function stepDronePhysics(
  physics: DronePhysics,
  controls: Controls,
  deltaTime: number,
): DroneTelemetry {
  if (!physics.armed) {
    const translation = physics.body.translation();
    const rotation = physics.body.rotation();
    const velocity = physics.body.linvel();

    const clampedTranslation =
      translation.z < 0
        ? { x: translation.x, y: translation.y, z: 0 }
        : translation;

    return {
      localPosition: {
        x: clampedTranslation.x,
        y: clampedTranslation.y,
        z: clampedTranslation.z,
      },
      localOrientation: {
        x: rotation.x,
        y: rotation.y,
        z: rotation.z,
        w: rotation.w,
      },
      localVelocity: { x: velocity.x, y: velocity.y, z: velocity.z },
      gforce: 0, // or keep last known gforce if you store it
      throttle: 0,
      rotorThrusts: physics.controller.getRotorThrusts(),
      crashed: physics.crashed,
    };
  }
  if (!physics.crashed) {
    if (physics.armed) {
      physics.controller.update(controls, deltaTime);
      physics.controller.applyForces(physics.body, deltaTime);
    }
    physics.world.timestep = deltaTime;
    physics.world.step();
  }

  const translation = physics.body.translation();
  const rotation = physics.body.rotation();
  const velocity = physics.body.linvel();

  const acceleration = {
    x: (velocity.x - physics.lastVelocity.x) / Math.max(deltaTime, 0.0001),
    y: (velocity.y - physics.lastVelocity.y) / Math.max(deltaTime, 0.0001),
    z: (velocity.z - physics.lastVelocity.z) / Math.max(deltaTime, 0.0001),
  };
  physics.lastVelocity = { x: velocity.x, y: velocity.y, z: velocity.z };

  const properAcceleration = {
    x: acceleration.x,
    y: acceleration.y,
    z: acceleration.z + GRAVITY,
  };
  const gforce =
    Math.sqrt(
      properAcceleration.x ** 2 +
        properAcceleration.y ** 2 +
        properAcceleration.z ** 2,
    ) / GRAVITY;

  if (translation.z < -200) {
    physics.crashed = true;
    physics.body.setTranslation(
      { x: translation.x, y: translation.y, z: 0 },
      true,
    );
    physics.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    physics.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  const clampedTranslation =
    translation.z < 0
      ? { x: translation.x, y: translation.y, z: 0 }
      : translation;

  return {
    localPosition: {
      x: clampedTranslation.x,
      y: clampedTranslation.y,
      z: clampedTranslation.z,
    },
    localOrientation: {
      x: rotation.x,
      y: rotation.y,
      z: rotation.z,
      w: rotation.w,
    },
    localVelocity: { x: velocity.x, y: velocity.y, z: velocity.z },
    gforce,
    throttle: physics.armed ? physics.controller.getThrottlePercent() : 0,
    rotorThrusts: physics.controller.getRotorThrusts(),
    crashed: physics.crashed,
  };
}
