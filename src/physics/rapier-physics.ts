import RAPIER, { ColliderDesc } from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import type { Controls, DroneTelemetry, Vec3 } from "../types";
import { AcroController } from "../controllers/acroController";
import { SimpleController } from "../controllers/simpleController";
import { FlightController } from "../controllers/flight-controller";
import { AcroMode } from "../controllers/modes/acro-mode";
import { AngleMode } from "../controllers/modes/angle-mode";
import type { IFlightMode } from "../controllers/modes/flight-mode-interface";
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
  private mapMesh?: THREE.Object3D;
  private roofHeight: number = Infinity;
  private droneCollider?: RAPIER.Collider;
  private mapBody?: RAPIER.RigidBody;
  private events?: RAPIER.EventQueue;

  constructor(private config: DroneConfig = Tinyhawk3Config) {
    this.crashed = false;
    this.armed = false;
    this.spawnHeight = 0.5
    this.lastVelocity = { x: 0, y: 0, z: 0 }
    this.droneTelemetry = this.emptyTelemetry()
    this.startPosition = { x: 0, y: 0, z: config.height + this.spawnHeight }
  }

  public setRoofHeight(height: number): void {
    this.roofHeight = height;
  }

  private emptyTelemetry(): DroneTelemetry {
    return {
      localPosition: { x: 0, y: 0, z: 0 },
      localOrientation: { x: 0, y: 0, z: 0, w: 1 },
      localVelocity: { x: 0, y: 0, z: 0 },
      localAngularVelocity: { x: 0, y: 0, z: 0 },
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

    // Store the mesh so the collider can be re-created after world reset
    this.mapMesh = mesh;

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
            // Avoid spreading large collision meshes into push(); JavaScript's
            // argument limit is far below the Factory collider's index count.
            const indexArray = geometry.index.array as ArrayLike<number>;
            for (let i = 0; i < indexArray.length; i++) {
              indices.push(indexArray[i] + vertexOffset);
            }
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
      throw new Error("The environment collision mesh contains no triangles.");
    }

    const rigidBodyDesc = RAPIER.RigidBodyDesc.fixed();
    if (this.mapBody) this.world.removeRigidBody(this.mapBody);
    const rigidBody = this.world.createRigidBody(rigidBodyDesc);
    this.mapBody = rigidBody;

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
      .setTranslation(startPosition.x, startPosition.y, startPosition.z + this.spawnHeight)
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
      .setMass(this.config.mass)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
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
      // Build the appropriate flight mode
      const mode = this.buildFlightMode(this.config.controllerType);

      if (mode) {
        // New modular FlightController path
        this.controller = new FlightController(
          this.rotorOffsets!,
          {
            throttleRate: this.config.throttleRate,
            maxThrustPerRotor: this.config.rotors[0]?.maxThrust ?? 12,
            rotorMode: this.config.rotorMode,
            yawTorquePerNewton: this.config.yawTorquePerNewton,
          },
          mode,
        );
      } else {
        // Fallback to legacy AcroController
        this.controller = new AcroController(this.rotorOffsets!, {
          maxThrustPerRotor: this.config.rotors[0]?.maxThrust ?? 12,
          throttleRate: this.config.throttleRate,
          stickRate: this.config.stickRate,
          rotorMode: this.config.rotorMode,
          yawTorquePerNewton: this.config.yawTorquePerNewton,
          pidRateConfig: this.config.pidRateConfig,
        });
      }
    }

    this.droneTelemetry.localPosition = { x: startPosition.x, y: startPosition.y, z: startPosition.z + this.spawnHeight };
    this.droneCollider = this.world.createCollider(colliderDesc, this.body);
  }

  /** Build a flight mode from the controller type string, or null if unsupported */
  private buildFlightMode(type: string): IFlightMode | null {
    const pidRateConfig = this.config.pidRateConfig;
    if (!pidRateConfig) return null;

    if (type === "acro") {
      return new AcroMode(pidRateConfig);
    }
    if (type === "angle") {
      const pidAngleConfig = this.config.pidAngleConfig;
      if (!pidAngleConfig) return null;
      return new AngleMode(pidAngleConfig, pidRateConfig);
    }
    return null;
  }

  /** Switch the active flight mode at runtime (only works with FlightController) */
  public switchFlightMode(modeName: "acro" | "angle"): void {
    if (this.controller instanceof FlightController) {
      const mode = this.buildFlightMode(modeName);
      if (mode) {
        this.controller.switchMode(mode);
      }
    }
  }

  private resetWorld() {
    if (this.world) {
      this.world.free()
    }
    this.world = new RAPIER.World({ x: 0, y: 0, z: -GRAVITY });
    this.events?.free();
    this.events = new RAPIER.EventQueue(true);
    this.mapBody = undefined;
    this.setupDrone(this.startPosition, this.config)
    // Create ceiling collider if roofHeight is finite
    this.createCeilingCollider();
    // Re-create the map collider if one was previously registered
    if (this.mapMesh) {
      this.createCollider(this.mapMesh);
    }
  }

  private createCeilingCollider(): void {
    if (!this.world || !Number.isFinite(this.roofHeight)) return;

    const ceilingBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, this.roofHeight)
    );
    // Large thin cuboid: 500m x 500m half-extents, 0.1m half-thickness
    const ceilingCollider = RAPIER.ColliderDesc.cuboid(500, 500, 0.1)
      .setFriction(0)
      .setRestitution(0);
    this.world.createCollider(ceilingCollider, ceilingBody);
  }
  public async init(startPosition: Vec3): Promise<void> {
    await RAPIER.init();
    this.startPosition = startPosition;
    this.reset();
  }

  public reset(): void {
    this.crashed = false;
    this.armed = false;
    this.lastVelocity = { x: 0, y: 0, z: 0 };
    this.droneTelemetry = this.emptyTelemetry();
    if (!this.body || !this.world) this.resetWorld();
    else {
      // Keep the static mesh/BVH; resetting the drone must not rebuild the world.
      this.body.setTranslation({ ...this.startPosition, z: this.startPosition.z + this.spawnHeight }, true);
      this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.body.resetForces(true);
      this.body.resetTorques(true);
      this.controller?.reset();
      this.droneTelemetry.localPosition = { ...this.startPosition, z: this.startPosition.z + this.spawnHeight };
    }
  }

  public dispose(): void {
    this.world?.free();
    this.events?.free();
    this.events = undefined;
    this.world = undefined;
    this.body = undefined;
    this.droneCollider = undefined;
    this.mapBody = undefined;
  }

  public setArmed(armed: boolean): void {
    this.armed = armed && !this.crashed;
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

  public step(controls: Controls, deltaTime: number, clampZ: number): DroneTelemetry {
    if (!this.world || !this.body || !this.controller) {
      throw "Body is not setup!! Call init first."
    }

    // Get current physics state
    // Motors stop when disarmed, but gravity and contacts continue.
    if (this.armed && !this.crashed) {
      const controllerTelemetry = this.getTelemetryForController();
      const command = this.controller.computePhysicsCommand(controls, controllerTelemetry, deltaTime);
      this.applyPhysicsCommand(command);
    } else {
      this.body.resetForces(true);
      this.body.resetTorques(true);
    }
    this.world.timestep = deltaTime;
    this.world.step(this.events);
    const translation = this.body.translation();
    const rotation = this.body.rotation();
    const velocity = this.body.linvel();
    const angVel = this.body.angvel();

    // Sum normal contact impulses: gentle landings settle; hard impacts cut motors.
    let impactImpulse = 0;
    this.events?.drainContactForceEvents((event) => {
      if (event.collider1() === this.droneCollider?.handle || event.collider2() === this.droneCollider?.handle) {
        impactImpulse += event.totalForceMagnitude() * deltaTime;
      }
    });
    // Rapier's CCD clamping can stop motion without a matching contact-force
    // event. Include the measured velocity jump when a contact manifold exists.
    let touching = false;
    if (this.droneCollider) this.world.contactPairsWith(this.droneCollider, (other) => {
      this.world!.contactPair(this.droneCollider!, other, (manifold) => {
        touching ||= manifold.numContacts() > 0;
      });
    });
    const velocityJump = Math.hypot(
      velocity.x - this.lastVelocity.x, velocity.y - this.lastVelocity.y, velocity.z - this.lastVelocity.z,
    );
    if (impactImpulse / this.config.mass > 3 || (touching && velocityJump > 3)) this.crashed = true;

    // Calculate G-force
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
    const gforce = Math.sqrt(
      properAcceleration.x ** 2 + properAcceleration.y ** 2 + properAcceleration.z ** 2
    ) / GRAVITY;

    // Handle crash condition
    if (translation.z < -200) {
      this.crashed = true;
      this.body.setTranslation({ x: translation.x, y: translation.y, z: 0 }, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    if (this.crashed) {
      this.armed = false;
      this.controller.reset();
      this.body.resetForces(true);
      this.body.resetTorques(true);
    }

    // Clamp to ground — correct the rigid body so it doesn't fall through
    if (translation.z < clampZ) {
      this.body.setTranslation({ x: translation.x, y: translation.y, z: clampZ }, true);
      const v = this.body.linvel();
      if (v.z < 0) {
        this.body.setLinvel({ x: v.x, y: v.y, z: 0 }, true);
      }
    }

    const clampedTranslation = this.body.translation();

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

    return this.droneTelemetry;
  }


  /**
   * Get telemetry for controller (already in Z-up space)
   */
  private getTelemetryForController(): DroneTelemetry {
    if (!this.body) {
      return this.emptyTelemetry();
    }

    const translation = this.body.translation();
    const rotation = this.body.rotation();
    const linVel = this.body.linvel();
    const angVel = this.body.angvel();

    return {
      localPosition: { x: translation.x, y: translation.y, z: translation.z },
      localOrientation: rotation,
      localVelocity: { x: linVel.x, y: linVel.y, z: linVel.z },
      localAngularVelocity: { x: angVel.x, y: angVel.y, z: angVel.z },
      gforce: this.droneTelemetry.gforce,
      throttle: this.droneTelemetry.throttle,
      rotorThrusts: this.droneTelemetry.rotorThrusts,
      crashed: this.crashed,
      armed: this.armed,
    };
  }

  /**
   * Apply physics command directly (physics is Z-up natively)
   */
  private applyPhysicsCommand(command: PhysicsCommand): void {
    if (!this.body) return;

    if (command.resetForces) {
      this.body.resetForces(true);
      this.body.resetTorques(true);
    }

    this.body.addForce(command.force, true);

    // Handle angular velocity (SimpleController)
    if (command.angularVelocity &&
      (command.angularVelocity.x !== 0 ||
        command.angularVelocity.y !== 0 ||
        command.angularVelocity.z !== 0)) {
      this.body.setAngvel(command.angularVelocity, true);
    }

    // Handle torque (AcroController)
    if (command.torque) {
      this.body.addTorque(command.torque, true);
    }
  }

}
