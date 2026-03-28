import RAPIER, { ColliderDesc } from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import type { Controls, DroneTelemetry, Vec3 } from "../types";
import { AcroController } from "../controllers/acroController";
import { SimpleController } from "../controllers/simpleController";
import { DroneConfig, Tinyhawk3Config } from "../config/tinyhawk-config";
import type { IController, PhysicsCommand } from "../controllers/controller-interface";

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
    this.startPosition = { x: 0, y: config.height + this.spawnHeight, z: 0 }
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

    const vertices: number[] = [];
    const indices: number[] = [];
    let vertexOffset = 0;

    mesh.updateMatrixWorld(true);

    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        const geometry = child.geometry;
        const positionAttr = geometry.attributes.position;

        if (positionAttr) {
          // Apply world transform to each vertex
          const worldMatrix = child.matrixWorld;
          const vertex = new THREE.Vector3();

          for (let i = 0; i < positionAttr.count; i++) {
            vertex.set(
              positionAttr.getX(i),
              positionAttr.getY(i),
              positionAttr.getZ(i)
            );
            vertex.applyMatrix4(worldMatrix);
            vertices.push(vertex.x, vertex.y, vertex.z);
          }

          // Add indices with offset
          if (geometry.index) {
            const indexArray = Array.from(geometry.index.array);
            indices.push(...indexArray.map(i => i + vertexOffset));
          } else {
            for (let i = 0; i < positionAttr.count; i++) {
              indices.push(vertexOffset + i);
            }
          }
          vertexOffset += positionAttr.count;
        }
      }
    });

    if (vertices.length === 0 || indices.length === 0) {
      console.warn("No valid geometry found for collider creation");
      return;
    }

    const rigidBodyDesc = RAPIER.RigidBodyDesc.fixed();
    const rigidBody = this.world.createRigidBody(rigidBodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.trimesh(
      new Float32Array(vertices),
      new Uint32Array(indices)
    );

    this.world.createCollider(colliderDesc, rigidBody);
    console.log(`Created trimesh collider with ${vertices.length / 3} vertices and ${indices.length / 3} triangles`);
  }

  public setupDrone(startPosition: Vec3, config?: DroneConfig | undefined) {
    this.spawnHeight = this.config.height + 0.01;
    this.startPosition = startPosition;
    if (config) {
      this.config = config
    }

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(startPosition.x, this.spawnHeight, startPosition.z)
      .setLinearDamping(this.config.linearDamping)
      .setAngularDamping(this.config.angularDamping)
      .setCcdEnabled(true);

    if (!this.world) {
      throw "World not initialized"
    }
    this.body = this.world.createRigidBody(bodyDesc);

    const halfExtents = {
      x: this.config.length / 2,
      y: this.config.height / 2,
      z: this.config.width / 2,
    };

    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      halfExtents.x,
      halfExtents.y,
      halfExtents.z,
    )
      .setTranslation(0, -halfExtents.y, 0)
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

    this.droneTelemetry.localPosition.y = startPosition.y + this.spawnHeight;
    this.world.createCollider(colliderDesc, this.body);
  }

  private resetWorld() {
    if (this.world) {
      this.world.free()
    }
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
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

  public getSensor(): DroneTelemetry {
    return this.getTelemetryForController();
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

  public step(controls: Controls, deltaTime: number, clampY: number) {
    if (!this.world || !this.body || !this.controller) {
      throw "Body is not setup!! Call init first."
    }

    // Get current physics state
    const translation = this.body.translation();
    const rotation = this.body.rotation();
    const velocity = this.body.linvel();
    const angVel = this.body.angvel();

    // Update physics if armed and not crashed
    if (this.armed && !this.crashed) {
      const controllerTelemetry = this.getTelemetryForController();
      const command = this.controller.computePhysicsCommand(controls, controllerTelemetry, deltaTime);
      this.applyPhysicsCommand(command);
      this.world.step();
    }

    // Calculate G-force
    const acceleration = {
      x: (velocity.x - this.lastVelocity.x) / Math.max(deltaTime, 0.0001),
      y: (velocity.y - this.lastVelocity.y) / Math.max(deltaTime, 0.0001),
      z: (velocity.z - this.lastVelocity.z) / Math.max(deltaTime, 0.0001),
    };
    this.lastVelocity = { x: velocity.x, y: velocity.y, z: velocity.z };

    const properAcceleration = {
      x: acceleration.x,
      y: acceleration.y + GRAVITY,
      z: acceleration.z,
    };
    const gforce = Math.sqrt(
      properAcceleration.x ** 2 + properAcceleration.y ** 2 + properAcceleration.z ** 2
    ) / GRAVITY;

    // Handle crash condition
    if (translation.y < -200) {
      this.crashed = true;
      this.body.setTranslation({ x: translation.x, y: 0, z: translation.z }, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    // Clamp to ground
    const clampedTranslation = translation.y < clampY
      ? { x: translation.x, y: 0, z: translation.z }
      : translation;

    // Update telemetry
    const controllerTelemetry = this.controller.getTelemetry();
    this.droneTelemetry = {
      localPosition: { x: clampedTranslation.x, y: clampedTranslation.y, z: clampedTranslation.z },
      localOrientation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
      localVelocity: { x: velocity.x, y: velocity.y, z: velocity.z },
      localAngularVelocity: { x: angVel.x, y: angVel.y, z: angVel.z },
      gforce,
      throttle: this.armed ? controllerTelemetry.throttlePercent : 0,
      rotorThrusts: controllerTelemetry.rotorThrusts,
      crashed: this.crashed,
      armed: this.armed,
    };
  }


  /**
     * Transform Z-up vector to Y-up vector
     */
  private zUpToYUp(v: Vec3): Vec3 {
    return { x: v.x, y: v.z, z: -v.y };
  }

  /**
   * Transform Y-up vector to Z-up vector
   */
  private yUpToZUp(v: Vec3): Vec3 {
    return { x: v.x, y: -v.z, z: v.y };
  }

  /**
   * Get telemetry in Z-up coordinate space for controller
   */
  private getTelemetryForController(): DroneTelemetry {
    if (!this.body) {
      return this.emptyTelemetry();
    }

    const translation = this.body.translation();
    const rotation = this.body.rotation();
    const linVel = this.body.linvel();
    const angVel = this.body.angvel();

    // Convert to Z-up space for controller
    return {
      localPosition: this.yUpToZUp(translation),
      localOrientation: rotation, // Quaternion is the same
      localVelocity: this.yUpToZUp(linVel),
      localAngularVelocity: this.yUpToZUp(angVel),
      gforce: this.droneTelemetry.gforce,
      throttle: this.droneTelemetry.throttle,
      rotorThrusts: this.droneTelemetry.rotorThrusts,
      crashed: this.crashed,
      armed: this.armed,
    };
  }


  /**
   * Apply physics command (converts from Z-up to Y-up)
   */
  private applyPhysicsCommand(command: PhysicsCommand): void {
    if (!this.body) return;

    if (command.resetForces) {
      this.body.resetForces(true);
      this.body.resetTorques(true);
    }

    // Convert force from Z-up to Y-up
    const forceYUp = this.zUpToYUp(command.force);
    this.body.addForce(forceYUp, true);

    // Handle angular velocity (SimpleController)
    if (command.angularVelocity &&
      (command.angularVelocity.x !== 0 ||
        command.angularVelocity.y !== 0 ||
        command.angularVelocity.z !== 0)) {
      const angVelYUp = this.zUpToYUp(command.angularVelocity);
      this.body.setAngvel(angVelYUp, true);
    }

    // Handle torque (AcroController)
    if (command.torque) {
      const torqueYUp = this.zUpToYUp(command.torque);
      this.body.addTorque(torqueYUp, true);
    }
  }

}
