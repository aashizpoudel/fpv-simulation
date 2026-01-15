import RAPIER, { ColliderDesc } from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import type { Controls, DroneTelemetry, Vec3 } from "../types";
import { AcroController } from "../controllers/acroController";
import { SimpleController } from "../controllers/simpleController";
import { DroneConfig, Tinyhawk3Config } from "../config/tinyhawk-config";
import type { IController } from "../controllers/controller-interface";

const GRAVITY = 9.81;

export class RapierPhysics {
  private world?: RAPIER.World;
  private body?: RAPIER.RigidBody;
  private controller?: IController;
  private crashed: boolean;
  private lastVelocity: Vec3;
  private spawnHeight: number;
  private armed: boolean;
  private rotorOffsets?: Vec3[];
  private droneTelemetry: DroneTelemetry;
  private startPosition: Vec3;

  constructor(private config: DroneConfig = Tinyhawk3Config) {
    this.crashed = false;
    this.armed = false;
    this.spawnHeight = 0.5
    this.lastVelocity = { x: 0, y: 0, z: 0 }
    this.droneTelemetry = this.emptyTelemetry()
    this.startPosition = {x:0,y:config.height+ this.spawnHeight, z:0}
  }

  private emptyTelemetry(): DroneTelemetry {
    return {
      localPosition: { x: 0, y: 0, z: 0 },
      localOrientation: { x: 0, y: 0, z: 0, w: 1 },
      localVelocity: { x: 0, y: 0, z: 0 },
      gforce: 0,
      throttle: 0,
      rotorThrusts: [0, 0, 0, 0],
      crashed: false,
      armed: false,
    }
  }

  public createCollider(mesh: THREE.Object3D): void {
    if (!this.world) {
      console.log("No world defined yet");
      return;
    }

    // Collect vertices and indices from all child meshes
    const vertices: number[] = [];
    const indices: number[] = [];
    let vertexOffset = 0;

    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        const geometry = child.geometry;
        const positionAttr = geometry.attributes.position;

        if (positionAttr) {
          // Add vertices
          vertices.push(...Array.from(positionAttr.array));

          // Add indices with offset
          if (geometry.index) {
            const indexArray = Array.from(geometry.index.array);
            indices.push(...indexArray.map(i => i + vertexOffset));
            vertexOffset += positionAttr.count;
          } else {
            // Generate indices if geometry doesn't have them
            for (let i = 0; i < positionAttr.count; i++) {
              indices.push(vertexOffset + i);
            }
            vertexOffset += positionAttr.count;
          }
        }
      }
    });

    if (vertices.length === 0 || indices.length === 0) {
      console.warn("No valid geometry found for collider creation");
      return;
    }

    // CREATE A STATIC RIGID BODY FIRST
    const rigidBodyDesc = RAPIER.RigidBodyDesc.fixed();
    const rigidBody = this.world.createRigidBody(rigidBodyDesc);
  

    const colliderDesc = RAPIER.ColliderDesc.trimesh(
      new Float32Array(vertices),
      new Uint32Array(indices)
    );

    this.world.createCollider(colliderDesc, rigidBody);
  }

  public setupDrone(startPosition: Vec3, config?: DroneConfig|undefined) {
    this.spawnHeight = this.config.height + 0.01;
    this.startPosition = startPosition;
    if(config){
      this.config = config
    }
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(startPosition.x, startPosition.y, this.spawnHeight)
      .setLinearDamping(this.config.linearDamping)
      .setAngularDamping(this.config.angularDamping)
      .setCcdEnabled(true);

    if (!this.world) {
      throw "World not initialized"
    }
    this.body = this.world.createRigidBody(bodyDesc);

    const halfExtents = {
      x: this.config.length / 2,
      y: this.config.width / 2,
      z: this.config.height / 2,
    };

    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      halfExtents.x,
      halfExtents.y,
      halfExtents.z,
    )
      .setTranslation(0, 0, -halfExtents.z)
      .setMass(this.config.mass)
      .setFriction(0.8)
      .setRestitution(0.1);

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
        yawTorquePerNewton: this.config.yawTorquePerNewton
      });
    }

    this.droneTelemetry.localPosition.z = this.spawnHeight
    this.world.createCollider(colliderDesc, this.body);
  }

  private resetWorld() {
    if (this.world) {
      this.world.free()
    }
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    // Ground physics (Rapier)
    // const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, -10);
    // const groundBody = this.world.createRigidBody(groundBodyDesc);

    // const groundColliderDesc = RAPIER.ColliderDesc.cuboid(50, 50, 0.5);
    // this.world.createCollider(groundColliderDesc, groundBody);
    this.setupDrone(this.startPosition, this.config)
  }
  public async init(startPosition: Vec3): Promise<void> {
    await RAPIER.init();
    this.startPosition = startPosition;
    this.reset();
  }

  public reset(): void {
    this.resetWorld()
  }

  public setArmed(armed: boolean): void {
    this.armed = armed;
    if (!armed && this.controller) {
      this.controller.reset();
    }
  }

  public getTelemetry(): DroneTelemetry {
    return this.droneTelemetry;
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

  public step(controls: Controls, deltaTime: number, clampZ: number) {
    if (!this.world || !this.body || !this.controller) {
      throw "Body is not setup!! Call init first."
    }

    if (!this.armed) {
      const controllerTelemetry = this.controller.getTelemetry();
      const translation = this.body.translation();
      const rotation = this.body.rotation();
      const velocity = this.body.linvel();
      const clampedTranslation =
        translation.z <= clampZ
          ? { x: translation.x, y: translation.y, z: 0 }
          : translation;

      this.droneTelemetry = {
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
        armed: this.armed,
      };
      return
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
    this.droneTelemetry = {
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
      armed: this.armed
    };
  }
}
