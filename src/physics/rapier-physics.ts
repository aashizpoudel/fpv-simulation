import { BatteryModel } from "./battery-model";
import { aerodynamicForces } from "./aerodynamics";
import { normalizePreset } from "../config/presets";
import RAPIER from "@dimforge/rapier3d-compat";
import type { CollisionData } from "../core/simulation-messages";
import type { Controls, DroneTelemetry, Vec3 } from "../types";
import { FlightController } from "../controllers/flight-controller";
import { buildFlightMode } from "../controllers/flight-mode-factory";
import { createDroneColliders } from "./drone-colliders";
import { partitionCollision, type CollisionPart } from "./partition-collision";
import { DroneConfig, Tinyhawk3Config } from "../config/tinyhawk-config";
import type {
  IController,
  PhysicsCommand,
} from "../controllers/controller-interface";

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
  private mapCollision?: CollisionData;
  private mapCollisionParts: CollisionPart[] = [];
  private propCollision?: CollisionData;
  private propBody?: RAPIER.RigidBody;
  private roofHeight: number = Infinity;
  private droneCollider?: RAPIER.Collider;
  private mapColliders: RAPIER.Collider[] = [];
  private mapEnabled: boolean[] = [];
  private events?: RAPIER.EventQueue;
  private droneColliders: RAPIER.Collider[] = [];
  private battery: BatteryModel;
  private touchingLastStep = false;
  private readonly collisionRadius: number;

  constructor(private config: DroneConfig = Tinyhawk3Config) {
    this.config = normalizePreset(config);
    this.collisionRadius = Math.max(
      Math.hypot(this.config.length, this.config.width, this.config.height),
      ...this.config.rotors.map(rotor => Math.hypot(rotor.position.x, rotor.position.y, rotor.position.z)
        + Math.hypot(this.config.body.ductRadius, this.config.body.ductHeight / 2)),
    ) + 2 * Math.hypot(this.config.body.centerOfMass.x, this.config.body.centerOfMass.y, this.config.body.centerOfMass.z);
    this.battery = new BatteryModel(this.config.battery);
    this.crashed = false;
    this.armed = false;
    this.spawnHeight = 0.5;
    this.lastVelocity = { x: 0, y: 0, z: 0 };
    this.droneTelemetry = this.emptyTelemetry();
    this.startPosition = { x: 0, y: 0, z: config.height + this.spawnHeight };
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
    };
  }

  public createCollider(data: CollisionData): void {
    if (!this.world) {
      console.log("No world defined yet");
      return;
    }

    // Retain worker-owned arrays so a rebuilt world can restore its colliders.
    const { vertices, indices } = data;

    if (vertices.length === 0 || indices.length === 0) {
      throw new Error("The environment collision mesh contains no triangles.");
    }
    if (data !== this.mapCollision) {
      this.mapCollisionParts = partitionCollision(data);
      this.mapCollision = data;
    }

    for (const collider of this.mapColliders) this.world.removeCollider(collider, true);
    this.mapColliders = [];
    this.mapEnabled = [];
    for (const part of this.mapCollisionParts) {
      // Unparented colliders are static: no per-chunk rigid bodies to simulate.
      const origin = part.origin ?? { x: 0, y: 0, z: 0 };
      this.mapColliders.push(this.world.createCollider(RAPIER.ColliderDesc.trimesh(part.vertices, part.indices)
        .setTranslation(origin.x, origin.y, origin.z)));
      this.mapEnabled.push(true);
    }
    this.world.updateSceneQueries();
    console.log(
      `Created ${this.mapCollisionParts.length} map colliders with ${indices.length / 3} triangles`,
    );
  }

  public isPropSpaceClear(position: Vec3, radius: number): boolean {
    if (!this.world) return false;
    // Placement queries can occur anywhere, including outside the flight area.
    if (this.updateMapRegion(position, radius)) this.world.updateSceneQueries();
    let clear = true;
    this.world.intersectionsWithShape(position, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Ball(radius), () => {
      clear = false;
      return false;
    }, undefined, undefined, undefined, this.body);
    return clear;
  }

  /** Enable every chunk whose real bounds intersect the entire swept region. */
  private updateMapRegion(position: Vec3, radius: number): boolean {
    let changed = false;
    this.mapCollisionParts.forEach((part, i) => {
      if (!part.bounds) return;
      const { min, max } = part.bounds;
      const enabled = min.x <= position.x + radius && max.x >= position.x - radius
        && min.y <= position.y + radius && max.y >= position.y - radius
        && min.z <= position.z + radius && max.z >= position.z - radius;
      if (enabled !== this.mapEnabled[i]) {
        this.mapColliders[i].setEnabled(enabled);
        this.mapEnabled[i] = enabled;
        changed = true;
      }
    });
    return changed;
  }

  public createPropCollider(data: CollisionData): void {
    if (!this.world) return;
    this.propCollision = data;
    if (this.propBody) this.world.removeRigidBody(this.propBody);
    this.propBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const { vertices, indices } = data;
    const collider = RAPIER.ColliderDesc.trimesh(vertices, indices);
    this.world.createCollider(collider, this.propBody);
    this.world.updateSceneQueries();
  }

  private setupDrone(startPosition: Vec3) {
    this.spawnHeight = this.config.height + 0.01;
    this.startPosition = startPosition;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(
        startPosition.x,
        startPosition.y,
        startPosition.z + this.spawnHeight,
      )
      .setLinearDamping(this.config.linearDamping)
      .setAngularDamping(this.config.angularDamping)
      .setCcdEnabled(true);

    if (!this.world) {
      throw "World not initialized";
    }
    bodyDesc.setAdditionalMassProperties(
      this.config.mass,
      this.config.body.centerOfMass,
      this.config.body.inertia,
      { x: 0, y: 0, z: 0, w: 1 },
    );
    this.body = this.world.createRigidBody(bodyDesc);

    this.rotorOffsets = this.config.rotors.map((r) => r.position);

    // Build the appropriate flight mode
    const mode = buildFlightMode(this.config, this.config.controllerType);
    if (!mode) {
      throw new Error(
        `Unable to build flight mode "${this.config.controllerType}": missing PID config or unsupported controller type`,
      );
    }
    this.controller = new FlightController(this.config, mode);

    this.droneTelemetry.localPosition = {
      x: startPosition.x,
      y: startPosition.y,
      z: startPosition.z + this.spawnHeight,
    };
    this.droneColliders = createDroneColliders(
      this.world,
      this.body,
      this.config,
    );
    this.droneCollider = this.droneColliders[0];
    this.body.recomputeMassPropertiesFromColliders();
  }

  /** Switch the active flight mode at runtime (only works with FlightController) */
  public switchFlightMode(modeName: "acro" | "angle"): void {
    if (this.controller instanceof FlightController) {
      const mode = buildFlightMode(this.config, modeName);
      if (mode) {
        this.controller.switchMode(mode);
      }
    }
  }

  private resetWorld() {
    if (this.world) {
      this.world.free();
    }
    this.world = new RAPIER.World({ x: 0, y: 0, z: -GRAVITY });
    this.events?.free();
    this.events = new RAPIER.EventQueue(true);
    this.mapColliders = [];
    this.propBody = undefined;
    this.setupDrone(this.startPosition);
    if (this.propCollision) this.createPropCollider(this.propCollision);
    // Create ceiling collider if roofHeight is finite
    this.createCeilingCollider();
    // Re-create the map collider if one was previously registered
    if (this.mapCollision) {
      this.createCollider(this.mapCollision);
    }
  }

  private createCeilingCollider(): void {
    if (!this.world || !Number.isFinite(this.roofHeight)) return;

    const ceilingBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, this.roofHeight),
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
    this.battery.reset();
    this.touchingLastStep = false;
    this.crashed = false;
    this.armed = false;
    this.lastVelocity = { x: 0, y: 0, z: 0 };
    this.droneTelemetry = this.emptyTelemetry();
    if (!this.body || !this.world) this.resetWorld();
    else {
      // Keep the static mesh/BVH; resetting the drone must not rebuild the world.
      this.body.setTranslation(
        { ...this.startPosition, z: this.startPosition.z + this.spawnHeight },
        true,
      );
      this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.body.resetForces(true);
      this.body.resetTorques(true);
      this.controller?.reset();
      this.droneTelemetry.localPosition = {
        ...this.startPosition,
        z: this.startPosition.z + this.spawnHeight,
      };
    }
  }

  public dispose(): void {
    this.world?.free();
    this.events?.free();
    this.events = undefined;
    this.world = undefined;
    this.body = undefined;
    this.droneCollider = undefined;
    this.droneColliders = [];
    this.mapColliders = [];
  }

  public setArmed(armed: boolean): void {
    const next = armed && !this.crashed;
    if (this.armed && !next && this.controller) {
      if (this.controller instanceof FlightController) this.controller.disarm();
      else this.controller.reset();
    }
    this.armed = next;
  }

  public getTelemetry(): DroneTelemetry {
    return this.droneTelemetry;
  }

  public getSensor(): DroneTelemetry {
    return this.getTelemetryForController();
  }

  public step(
    controls: Controls,
    deltaTime: number,
    clampZ: number,
  ): DroneTelemetry {
    if (!this.world || !this.body || !this.controller) {
      throw "Body is not setup!! Call init first.";
    }

    // Get current physics state
    // Motor commands stop when disarmed; modeled spool-down, gravity and contacts continue.
    if (!Number.isFinite(deltaTime) || deltaTime <= 0)
      throw new Error("Physics timestep must be positive");
    this.battery.step(
      this.controller instanceof FlightController
        ? this.controller.getMotorOutputs()
        : [],
      deltaTime,
    );
    let forceMagnitude = 0;
    if (
      this.controller instanceof FlightController ||
      (this.armed && !this.crashed)
    ) {
      const controllerTelemetry = this.getTelemetryForController();
      const command = this.controller.computePhysicsCommand(
        controls,
        controllerTelemetry,
        deltaTime,
      );
      this.applyPhysicsCommand(command);
      forceMagnitude = Math.hypot(command.force.x, command.force.y, command.force.z);
    } else {
      this.body.resetForces(true);
      this.body.resetTorques(true);
    }
    const aero = aerodynamicForces(
      this.body.linvel(),
      this.body.angvel(),
      this.body.rotation(),
      this.config.aerodynamics,
    );
    this.body.addForce(aero.force, true);
    this.body.addTorque(aero.torque, true);
    const velocityBeforeStep = this.body.linvel();
    // A conservative sphere covers translation, acceleration, rotation and
    // rebound during this whole step. Nearby triangles remain exact and CCD
    // stays enabled; distant chunks need not participate in Rapier's pipeline.
    const sweepAcceleration = GRAVITY + (forceMagnitude + Math.hypot(aero.force.x, aero.force.y, aero.force.z)) / this.config.mass;
    const spin = this.body.angvel();
    this.updateMapRegion(this.body.translation(), 2 + this.collisionRadius
      + Math.hypot(velocityBeforeStep.x, velocityBeforeStep.y, velocityBeforeStep.z) * deltaTime
      + Math.hypot(spin.x, spin.y, spin.z) * this.collisionRadius * deltaTime
      + sweepAcceleration * deltaTime * deltaTime);
    this.world.timestep = deltaTime;
    this.world.step(this.events);
    const translation = this.body.translation();
    const rotation = this.body.rotation();
    const velocity = this.body.linvel();
    const angVel = this.body.angvel();

    // Sum normal contact impulses: gentle landings settle; hard impacts cut motors.
    let impactImpulse = 0;
    this.events?.drainContactForceEvents((event) => {
      if (
        this.droneColliders.some(
          (c) =>
            event.collider1() === c.handle || event.collider2() === c.handle,
        )
      ) {
        impactImpulse += event.totalForceMagnitude() * deltaTime;
      }
    });
    // Rapier's CCD clamping can stop motion without a matching contact-force
    // event. Include the measured velocity jump when a contact manifold exists.
    let touching = false;
    for (const collider of this.droneColliders)
      this.world.contactPairsWith(collider, (other) => {
        this.world!.contactPair(collider, other, (manifold) => {
          touching ||= manifold.numContacts() > 0;
        });
      });
    const velocityJump = Math.hypot(
      velocity.x - velocityBeforeStep.x,
      velocity.y - velocityBeforeStep.y,
      velocity.z - velocityBeforeStep.z,
    );
    const impactDeltaVelocity = Math.max(
      impactImpulse / this.config.mass,
      (touching || this.touchingLastStep) ? velocityJump : 0,
    );
    // CCD may remove the manifold in the same step that resolves its impulse.
    this.touchingLastStep = touching;
    if (
      this.config.body.crashCutoff &&
      impactDeltaVelocity > this.config.body.crashDeltaVelocity
    )
      this.crashed = true;

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
    const gforce =
      Math.sqrt(
        properAcceleration.x ** 2 +
          properAcceleration.y ** 2 +
          properAcceleration.z ** 2,
      ) / GRAVITY;

    // Handle crash condition
    if (translation.z < -200) {
      this.crashed = true;
      this.body.setTranslation(
        { x: translation.x, y: translation.y, z: 0 },
        true,
      );
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    if (this.crashed) {
      this.armed = false;
      if (this.controller instanceof FlightController) this.controller.disarm();
      else this.controller.reset();
      this.body.resetForces(true);
      this.body.resetTorques(true);
    }

    // Clamp to ground — correct the rigid body so it doesn't fall through
    if (translation.z < clampZ) {
      this.body.setTranslation(
        { x: translation.x, y: translation.y, z: clampZ },
        true,
      );
      const v = this.body.linvel();
      if (v.z < 0) {
        this.body.setLinvel({ x: v.x, y: v.y, z: 0 }, true);
      }
    }

    const clampedTranslation = this.body.translation();

    // Update telemetry
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
      localAngularVelocity: { x: angVel.x, y: angVel.y, z: angVel.z },
      gforce,
      throttle: this.armed ? controllerTelemetry.throttlePercent : 0,
      rotorThrusts: controllerTelemetry.rotorThrusts,
      motorCommands: controllerTelemetry.motorCommands,
      saturation: controllerTelemetry.saturation,
      impactDeltaVelocity,
      batteryVoltage: this.battery.voltage,
      batteryCharge: this.battery.charge,
      batteryCurrent: this.battery.current,
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
      batteryVoltage: this.battery.voltage,
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
    if (
      command.angularVelocity &&
      (command.angularVelocity.x !== 0 ||
        command.angularVelocity.y !== 0 ||
        command.angularVelocity.z !== 0)
    ) {
      this.body.setAngvel(command.angularVelocity, true);
    }

    // Handle torque (AcroController)
    if (command.torque) {
      this.body.addTorque(command.torque, true);
    }
  }
}
