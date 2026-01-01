import RAPIER from "@dimforge/rapier3d-compat";
import { IPhysics } from "./physics-interface";
import type { Controls, DroneTelemetry, Vec3 } from "../types";
import { AcroController } from "../controllers/acroController";
import { SimpleController } from "../controllers/simpleController";
import { DroneConfig, Tinyhawk3Config } from "../config/tinyhawk-config";
import type { IController } from "../controllers/controller-interface";

const GRAVITY = 9.81;

export class RapierPhysics implements IPhysics {
  private world: RAPIER.World;
  private body: RAPIER.RigidBody;
  private controller: IController;
  private crashed: boolean;
  private lastVelocity: Vec3;
  private spawnHeight: number;
  private armed: boolean;
  private rotorOffsets: Vec3[];
  private colliderHalfExtents: Vec3;

  constructor(private config: DroneConfig = Tinyhawk3Config) {}

  public async init(): Promise<void> {
    await RAPIER.init();

    this.world = new RAPIER.World({ x: 0, y: 0, z: -GRAVITY });
    this.spawnHeight = this.config.height + 0.01;

    const groundBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0),
    );

    const groundCollider = RAPIER.ColliderDesc.cuboid(500, 500, 0.5)
      .setMass(10)
      .setFriction(1.0)
      .setTranslation(0, 0, -0.5);
    this.world.createCollider(groundCollider, groundBody);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 0, this.spawnHeight)
      .setLinearDamping(this.config.linearDamping)
      .setAngularDamping(this.config.angularDamping)
      .setCcdEnabled(true);

    this.body = this.world.createRigidBody(bodyDesc);

    const halfExtents = {
      x: this.config.length / 2,
      y: this.config.width / 2,
      z: this.config.height / 2,
    };
    this.colliderHalfExtents = halfExtents;

    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      halfExtents.x,
      halfExtents.y,
      halfExtents.z,
    )
      .setTranslation(0, 0, -halfExtents.z)
      .setMass(this.config.mass)
      .setFriction(0.8)
      .setRestitution(0.1);

    this.world.createCollider(colliderDesc, this.body);

    this.rotorOffsets = this.config.rotors.map((r) => r.position);

    if (this.config.controllerType === "simple") {
      const maxThrust = this.config.rotors.reduce(
        (total, rotor) => total + rotor.maxThrust,
        0,
      );
      this.controller = new SimpleController({
        maxThrust,
        throttleRate: this.config.throttleRate,
        ...this.config.simpleController,
      });
    } else {
      this.controller = new AcroController(this.rotorOffsets, {
        maxThrustPerRotor: this.config.rotors[0]?.maxThrust ?? 12,
        throttleRate: this.config.throttleRate,
        stickRate: this.config.stickRate,
        rotorMode: this.config.rotorMode,
      });
    }

    this.reset();
  }

  public reset(): void {
    this.body.setTranslation({ x: 0, y: 0, z: this.spawnHeight }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.controller.reset();
    this.crashed = false;
    this.lastVelocity = { x: 0, y: 0, z: 0 };
    this.armed = false;
  }

  public setArmed(armed: boolean): void {
    this.armed = armed;
    if (!armed) {
      this.controller.reset();
    }
  }

  public togglePush(direction: number): void {
    if (this.body) {
      this.body.applyImpulse(
        {
          x: direction == 1 ? 0.01 : 0,
          y: direction == 2 ? 0.01 : 0,
          z: direction == 3 ? 0.05 : 0,
        },
        true,
      );
    }
  }

  public step(controls: Controls, deltaTime: number, clampZ: number): DroneTelemetry {
    if (!this.armed) {
      const controllerTelemetry = this.controller.getTelemetry();
      const translation = this.body.translation();
      const rotation = this.body.rotation();
      const velocity = this.body.linvel();
      const clampedTranslation =
        translation.z <= clampZ
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
        gforce: 0,
        throttle: 0,
        rotorThrusts: controllerTelemetry.rotorThrusts,
        crashed: this.crashed,
      };
    }
    if (!this.crashed) {
      if (this.armed) {
        this.controller.update(controls, this.body, deltaTime);
      }
      // this.world.timestep = deltaTime;
      this.world.step();
    }

    const translation = this.body.translation();
    const rotation = this.body.rotation();
    const velocity = this.body.linvel();

    const acceleration = {
      x: (velocity.x - this.lastVelocity.x) / Math.max(deltaTime, 0.0001),
      y: (velocity.y - this.lastVelocity.y) / Math.max(deltaTime, 0.0001),
      z: (velocity.z - this.lastVelocity.z) / Math.max(deltaTime, 0.0001),
    };
    this.lastVelocity = { x: velocity.x, y: velocity.y, z: velocity.z };

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
      this.crashed = true;
      this.body.setTranslation(
        { x: translation.x, y: translation.y, z: 0 },
        true,
      );
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    const clampedTranslation =
      translation.z < clampZ
        ? { x: translation.x, y: translation.y, z: 0 }
        : translation;

    const controllerTelemetry = this.controller.getTelemetry();
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
      throttle: this.armed ? controllerTelemetry.throttlePercent : 0,
      rotorThrusts: controllerTelemetry.rotorThrusts,
      crashed: this.crashed,
    };
  }
}
