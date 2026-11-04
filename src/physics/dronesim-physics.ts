import RAPIER from "@dimforge/rapier3d-compat";
import createDroneSim, { type DroneSimModule } from "../vendor/dronesim";
import { aerodynamicForces } from "./aerodynamics";
import { createDroneColliders } from "./drone-colliders";
import { partitionCollision, type CollisionPart } from "./partition-collision";
import type { CollisionData } from "../core/simulation-messages";
import type { Controls, DroneTelemetry, Vec3 } from "../types";
import type { DroneConfig } from "../config/drone-config";
import { Tinyhawk3Config } from "../config/tinyhawk-config";
import { normalizePreset } from "../config/presets";
import { applyBetaflightTuning } from "./betaflight-tuning";
import { ImuSensorModel } from "./imu-sensor";

const GRAVITY = 9.81;
const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));
// Betaflight Quad X: rear right, front right, rear left, front left.
// DroneConfig: front right, front left, rear left, rear right.
const CONFIG_ROTOR_FOR_BETAFLIGHT = [3, 0, 2, 1] as const;
const BETAFLIGHT_MOTOR_FOR_ROTOR = [1, 3, 2, 0] as const;
const ROTOR_SPIN = [1, -1, 1, -1] as const;

/**
 * Unified physics engine:
 * Betaflight SITL flight controller + Rust motor plant (via WebAssembly)
 * coupled with Rapier 3D 6-DOF rigid body dynamics and triangle mesh collisions.
 */
export class DroneSimPhysics {
  private wasm?: DroneSimModule;
  private handle = 0;
  private rcBuffer = 0;
  private world?: RAPIER.World;
  private body?: RAPIER.RigidBody;
  private events?: RAPIER.EventQueue;
  private droneColliders: RAPIER.Collider[] = [];

  private mapCollision?: CollisionData;
  private mapCollisionParts: CollisionPart[] = [];
  private mapColliders: RAPIER.Collider[] = [];
  private mapEnabled: boolean[] = [];

  private propCollision?: CollisionData;
  private propBody?: RAPIER.RigidBody;

  private roofHeight = Infinity;
  private startPosition: Vec3 = { x: 0, y: 0, z: 0.1 };
  private lastVelocity: Vec3 = { x: 0, y: 0, z: 0 };
  private specificForce: Vec3 = { x: 0, y: 0, z: GRAVITY };
  private throttle = 0;
  private armed = false;
  private crashed = false;
  private mode: "acro" | "angle" = "acro";
  private impact = 0;
  private gforce = 1;
  private touchingLastStep = false;
  private rotorRpms: [number, number, number, number] = [0, 0, 0, 0];
  private imu: ImuSensorModel;
  private telemetry!: DroneTelemetry;
  private readonly collisionRadius: number;

  constructor(private config: DroneConfig = Tinyhawk3Config, private floor = 0) {
    this.config = normalizePreset(config);
    const p = this.config.propulsion as { motorKv?: number; referenceVoltage?: number };
    const maxRpm = (p.motorKv ?? 15000) * (p.referenceVoltage ?? 3.8);
    this.imu = new ImuSensorModel(this.config.imu, maxRpm);
    this.collisionRadius =
      Math.max(
        Math.hypot(this.config.length, this.config.width, this.config.height),
        ...this.config.rotors.map(
          (rotor) =>
            Math.hypot(rotor.position.x, rotor.position.y, rotor.position.z) +
            Math.hypot(this.config.body.ductRadius, this.config.body.ductHeight / 2),
        ),
      ) +
      2 *
        Math.hypot(
          this.config.body.centerOfMass.x,
          this.config.body.centerOfMass.y,
          this.config.body.centerOfMass.z,
        );
    this.telemetry = this.emptyTelemetry();
  }

  private emptyTelemetry(): DroneTelemetry {
    return {
      localPosition: { x: 0, y: 0, z: 0 },
      localOrientation: { x: 0, y: 0, z: 0, w: 1 },
      localVelocity: { x: 0, y: 0, z: 0 },
      localAngularVelocity: { x: 0, y: 0, z: 0 },
      gforce: 1,
      throttle: 0,
      rotorThrusts: [0, 0, 0, 0],
      rotorRpms: [0, 0, 0, 0],
      motorCommands: [0, 0, 0, 0],
      batteryVoltage: this.config.battery.fullVoltage,
      batteryCurrent: 0,
      batteryCharge: 1,
      impactDeltaVelocity: 0,
      crashed: false,
      armed: false,
    };
  }

  public setRoofHeight(height: number): void {
    this.roofHeight = height;
    if (this.world) this.buildWorld();
  }

  public async init(startPosition: Vec3): Promise<void> {
    await RAPIER.init();

    // 1. Load the unified WebAssembly module
    const asset = (name: string) => {
      if (import.meta.env.MODE === "test" || typeof window === "undefined") {
        return `${process.cwd().replace(/\\/g, "/")}/public/wasm/dronesim/${name}`;
      }
      return `${import.meta.env.BASE_URL}wasm/dronesim/${name}`;
    };

    this.wasm = await createDroneSim({
      locateFile: () => asset("dronesim_wasm.wasm"),
      print() {},
      printErr: console.warn,
    });

    // 2. Load EEPROM configuration into virtual filesystem if available
    try {
      let eeprom: Uint8Array | undefined;
      if (typeof window === "undefined" || import.meta.env.MODE === "test") {
        try {
          const fsModule = "node:fs/promises";
          const fs = await import(/* @vite-ignore */ fsModule);
          eeprom = new Uint8Array(await fs.readFile(asset("demo-eeprom.bin")));
        } catch {}
      } else {
        const response = await fetch(asset("demo-eeprom.bin"));
        if (response.ok) {
          eeprom = new Uint8Array(await response.arrayBuffer());
        }
      }
      if (eeprom) {
        this.wasm.FS.writeFile("eeprom.bin", eeprom);
      }
    } catch {
      // Continue with default configuration if EEPROM fixture not found
    }

    // 3. Configure motor plant and battery in WASM
    const cfgLen = this.wasm._dronesim_config_len();
    const cfgPtr = this.wasm._dronesim_config_alloc();
    const memF64 = new Float64Array(this.wasm.HEAPU8.buffer, cfgPtr, cfgLen);

    const p = this.config.propulsion as any;
    const b = this.config.battery;

    const motorKv = p.motorKv ?? 15000;
    const motorResistance = p.motorResistance ?? 0.38;
    const motorNoLoadCurrent = p.motorNoLoadCurrent ?? 0.0075;
    const motorPeakCurrent = p.motorPeakCurrent ?? (b.maxMotorCurrent * 4);
    const arm = Math.hypot(this.config.rotors[0].position.x, this.config.rotors[0].position.y);
    const rotorInertia = p.rotorInertia ?? Math.max(1e-8, 3.75e-8 * (arm / 0.027) ** 2);
    const escTimeConstant = p.escTimeConstant ?? 0.002;
    const yawTorque = this.config.yawTorquePerNewton ?? 0.003;
    const referenceVoltage = p.referenceVoltage ?? 3.8;
    const maxRpm = motorKv * referenceVoltage;

    for (let i = 0; i < 4; i++) {
      const o = i * 9;
      const rotorIndex = CONFIG_ROTOR_FOR_BETAFLIGHT[i];
      const rotor = this.config.rotors[rotorIndex];
      memF64[o + 0] = motorKv;
      memF64[o + 1] = motorResistance;
      memF64[o + 2] = motorNoLoadCurrent;
      memF64[o + 3] = motorPeakCurrent;
      memF64[o + 4] = rotorInertia;
      memF64[o + 5] = rotor.maxThrust / (maxRpm * maxRpm);
      memF64[o + 6] = yawTorque;
      memF64[o + 7] = escTimeConstant;
      memF64[o + 8] = ROTOR_SPIN[rotorIndex];
    }

    const bOffset = 4 * 9;
    memF64[bOffset + 0] = b.capacityAh;
    memF64[bOffset + 1] = b.initialCharge;
    memF64[bOffset + 2] = b.fullVoltage;
    memF64[bOffset + 3] = b.emptyVoltage;
    memF64[bOffset + 4] = b.resistance;
    memF64[bOffset + 5] = b.maxMotorCurrent * 4;
    memF64[bOffset + 6] = b.idleCurrent;
    memF64[bOffset + 7] = b.fixedVoltage ?? -1;

    this.handle = this.wasm._dronesim_init(cfgPtr, cfgLen);
    this.wasm._dronesim_config_free(cfgPtr);

    if (!this.handle) throw new Error("DroneSim WASM initialization rejected");
    try {
      applyBetaflightTuning(this.wasm, this.handle, this.config);
      this.rcBuffer = this.wasm._malloc(8 * Float32Array.BYTES_PER_ELEMENT);
      if (!this.rcBuffer) throw new Error("DroneSim RC buffer allocation failed");
    } catch (error) {
      this.dispose();
      throw error;
    }

    this.startPosition = { ...startPosition };
    this.buildWorld();
    this.reset();
  }

  /**
   * Run the initial 1.25s (`config.imu.calibrationDuration`) gyroscope
   * calibration in TypeScript while settling Betaflight's RC and filter state.
   */
  private calibrateImuOnBoot(): void {
    if (!this.wasm || !this.handle || !this.rcBuffer) return;
    const dt = 0.001;
    this.imu.reset(dt);

    const neutralChannels = [0, 0, 0, -1, -1, -1, -1, -1];
    const rawRc = new Float32Array(this.wasm.HEAPU8.buffer, this.rcBuffer, 8);
    for (let i = 0; i < 8; i++) {
      rawRc[this.config.rcChannelOrder[i] - 1] = neutralChannels[i];
    }

    const totalTicks = Math.max(1, Math.round(this.config.imu.calibrationDuration / dt));
    const restGyro: Vec3 = { x: 0, y: 0, z: 0 };
    const restAcc: Vec3 = { x: 0, y: 0, z: GRAVITY };
    const restRpms: [number, number, number, number] = [0, 0, 0, 0];

    for (let i = 0; i < totalTicks; i++) {
      const sensed = this.imu.sample(restGyro, restAcc, restRpms, dt);
      this.wasm._dronesim_flight_step_raw(
        this.handle,
        this.rcBuffer,
        8,
        sensed.gyro.x,
        sensed.gyro.y,
        sensed.gyro.z,
        sensed.acc.x,
        sensed.acc.y,
        sensed.acc.z,
        1,
        0,
        0,
        0,
        0,
        dt,
      );
    }
  }

  private buildWorld(): void {
    this.world?.free();
    this.events?.free();

    this.events = new RAPIER.EventQueue(true);
    this.world = new RAPIER.World({ x: 0, y: 0, z: -GRAVITY });

    // Drone 6-DOF dynamic rigid body
    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(this.startPosition.x, this.startPosition.y, this.startPosition.z)
        .setCcdEnabled(true)
        .setAdditionalMassProperties(
          this.config.mass,
          this.config.body.centerOfMass,
          this.config.body.inertia,
          { x: 0, y: 0, z: 0, w: 1 },
        ),
    );

    this.droneColliders = createDroneColliders(this.world, this.body, this.config);

    if (Number.isFinite(this.roofHeight)) {
      const ceilingBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      const ceilingCollider = RAPIER.ColliderDesc.cuboid(1000, 1000, 0.1)
        .setTranslation(0, 0, this.roofHeight + 0.1)
        .setRestitution(0);
      this.world.createCollider(ceilingCollider, ceilingBody);
    }

    this.mapColliders = [];
    this.mapEnabled = [];
    if (this.mapCollision) this.installMap();
    if (this.propCollision) this.installProps();
  }

  public reset(): void {
    this.crashed = false;
    this.armed = false;
    this.throttle = 0;
    this.lastVelocity = { x: 0, y: 0, z: 0 };
    this.specificForce = { x: 0, y: 0, z: GRAVITY };
    this.impact = 0;
    this.gforce = 1;
    this.touchingLastStep = false;
    this.rotorRpms = [0, 0, 0, 0];

    if (this.wasm && this.handle) {
      this.wasm._dronesim_reset(this.handle);
      this.calibrateImuOnBoot();
    }

    if (this.body) {
      this.body.setTranslation(this.startPosition, true);
      this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.body.resetForces(true);
      this.body.resetTorques(true);
    }
    this.telemetry = this.emptyTelemetry();
    this.telemetry.localPosition = { ...this.startPosition };
  }

  public setArmed(armed: boolean): void {
    this.armed = armed && !this.crashed;
    if (!this.armed) this.throttle = 0;
  }

  public switchFlightMode(mode: "acro" | "angle"): void {
    this.mode = mode;
  }

  public getTelemetry(): DroneTelemetry {
    return this.telemetry;
  }

  public step(controls: Controls, dt: number, clampZ: number): DroneTelemetry {
    if (!this.world || !this.body || !this.wasm || !this.handle) {
      throw new Error("DroneSimPhysics is not initialized");
    }

    const pos = this.body.translation();
    const q = this.body.rotation();
    const vel = this.body.linvel();
    const angvel = this.body.angvel();

    // Rotate angular velocity and specific force into local drone coordinates
    // Inverse quaternion: q* = (-x, -y, -z, w)
    const qInv = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
    const rotateVec = (v: Vec3, rot: { x: number; y: number; z: number; w: number }): Vec3 => {
      const u = { x: rot.x, y: rot.y, z: rot.z };
      const s = rot.w;
      const uDotV = u.x * v.x + u.y * v.y + u.z * v.z;
      const uCrossV = {
        x: u.y * v.z - u.z * v.y,
        y: u.z * v.x - u.x * v.z,
        z: u.x * v.y - u.y * v.x,
      };
      return {
        x: 2 * uDotV * u.x + (s * s - (u.x * u.x + u.y * u.y + u.z * u.z)) * v.x + 2 * s * uCrossV.x,
        y: 2 * uDotV * u.y + (s * s - (u.x * u.x + u.y * u.y + u.z * u.z)) * v.y + 2 * s * uCrossV.y,
        z: 2 * uDotV * u.z + (s * s - (u.x * u.x + u.y * u.y + u.z * u.z)) * v.z + 2 * s * uCrossV.z,
      };
    };

    const localGyro = rotateVec(angvel, qInv);
    const localAcc = rotateVec(this.specificForce, qInv);
    const axialAirspeed = Math.max(0, -rotateVec(vel, qInv).z);
    const sensedImu = this.imu.sample(localGyro, localAcc, this.rotorRpms, dt);

    // Throttle integration
    if (this.armed && !this.crashed) {
      if (controls.throttle !== undefined) {
        this.throttle = clamp(controls.throttle, 0, 1);
      } else if (controls.thrust) {
        this.throttle = clamp(this.throttle + controls.thrust * dt * this.config.throttleRate, 0, 1);
      }
    } else {
      this.throttle = 0;
    }

    // Step Betaflight + Rust motor plant inside WebAssembly
    const rcRoll = clamp(controls.roll, -1, 1);
    const rcPitch = clamp(controls.pitch, -1, 1);
    const rcThrottle = clamp(this.throttle * 2 - 1, -1, 1);
    const rcYaw = clamp(controls.yaw, -1, 1);
    const rcArm = this.armed ? 1.0 : -1.0;
    const rcMode = this.mode === "angle" ? 1.0 : -1.0;

    // The config gives each AERT1234 channel's one-based raw receiver position.
    const channels = [rcRoll, rcPitch, rcYaw, rcThrottle, rcArm, rcMode, -1, -1];
    const rawRc = new Float32Array(this.wasm.HEAPU8.buffer, this.rcBuffer, 8);
    for (let i = 0; i < 8; i++) rawRc[this.config.rcChannelOrder[i] - 1] = channels[i];

    const ok = this.wasm._dronesim_flight_step_raw(
      this.handle,
      this.rcBuffer,
      8,
      sensedImu.gyro.x,
      sensedImu.gyro.y,
      sensedImu.gyro.z,
      sensedImu.acc.x,
      sensedImu.acc.y,
      sensedImu.acc.z,
      q.w,
      q.x,
      q.y,
      q.z,
      axialAirspeed,
      dt,
    );

    if (ok !== 1) throw new Error("DroneSim flight step failed");
    const flightControllerArmed = this.wasm._dronesim_is_armed(this.handle) !== 0;

    // Sample rotor forces and RPMs
    const rotorThrusts: [number, number, number, number] = [
      this.wasm._dronesim_thrust(this.handle, BETAFLIGHT_MOTOR_FOR_ROTOR[0]),
      this.wasm._dronesim_thrust(this.handle, BETAFLIGHT_MOTOR_FOR_ROTOR[1]),
      this.wasm._dronesim_thrust(this.handle, BETAFLIGHT_MOTOR_FOR_ROTOR[2]),
      this.wasm._dronesim_thrust(this.handle, BETAFLIGHT_MOTOR_FOR_ROTOR[3]),
    ];

    this.rotorRpms = [
      this.wasm._dronesim_rpm(this.handle, BETAFLIGHT_MOTOR_FOR_ROTOR[0]),
      this.wasm._dronesim_rpm(this.handle, BETAFLIGHT_MOTOR_FOR_ROTOR[1]),
      this.wasm._dronesim_rpm(this.handle, BETAFLIGHT_MOTOR_FOR_ROTOR[2]),
      this.wasm._dronesim_rpm(this.handle, BETAFLIGHT_MOTOR_FOR_ROTOR[3]),
    ];

    const rotorTorques: [number, number, number, number] = [
      this.wasm._dronesim_torque(this.handle, BETAFLIGHT_MOTOR_FOR_ROTOR[0]),
      this.wasm._dronesim_torque(this.handle, BETAFLIGHT_MOTOR_FOR_ROTOR[1]),
      this.wasm._dronesim_torque(this.handle, BETAFLIGHT_MOTOR_FOR_ROTOR[2]),
      this.wasm._dronesim_torque(this.handle, BETAFLIGHT_MOTOR_FOR_ROTOR[3]),
    ];

    const motorCommands: [number, number, number, number] = [
      this.wasm._dronesim_motor_command(this.handle, BETAFLIGHT_MOTOR_FOR_ROTOR[0]),
      this.wasm._dronesim_motor_command(this.handle, BETAFLIGHT_MOTOR_FOR_ROTOR[1]),
      this.wasm._dronesim_motor_command(this.handle, BETAFLIGHT_MOTOR_FOR_ROTOR[2]),
      this.wasm._dronesim_motor_command(this.handle, BETAFLIGHT_MOTOR_FOR_ROTOR[3]),
    ];

    // Compute net thrust and control torques in body frame (Z-up)
    const totalThrust = rotorThrusts[0] + rotorThrusts[1] + rotorThrusts[2] + rotorThrusts[3];
    let bodyTorqueX = 0;
    let bodyTorqueY = 0;
    let bodyTorqueZ = 0;

    for (let i = 0; i < 4; i++) {
      const r = this.config.rotors[i].position;
      // r x F for a rotor force along local +Z.
      bodyTorqueX += r.y * rotorThrusts[i];
      bodyTorqueY -= r.x * rotorThrusts[i];
      bodyTorqueZ += rotorTorques[i] * ROTOR_SPIN[i];
    }

    // Transform forces and torques from body frame to world frame
    const worldThrust = rotateVec({ x: 0, y: 0, z: totalThrust }, q);
    const worldTorque = rotateVec({ x: bodyTorqueX, y: bodyTorqueY, z: bodyTorqueZ }, q);

    // Apply forces and torques to Rapier body
    this.body.resetForces(true);
    this.body.resetTorques(true);

    if (flightControllerArmed && !this.crashed) {
      this.body.addForce(worldThrust, true);
      this.body.addTorque(worldTorque, true);
    }

    // Aerodynamic drag
    const aero = aerodynamicForces(vel, angvel, q, this.config.aerodynamics);
    this.body.addForce(aero.force, true);
    this.body.addTorque(aero.torque, true);

    const prevVel = { ...vel };

    // Update map partitions in Rapier
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    this.updateMapRegion(pos, 2 + this.collisionRadius + speed * dt);

    // Step Rapier rigid body physics
    this.world.timestep = dt;
    this.world.step(this.events);

    const nextPos = this.body.translation();
    const nextRot = this.body.rotation();
    const nextVel = this.body.linvel();
    const nextAngvel = this.body.angvel();

    // Specific force for accelerometer: a_spec = (v_next - v_prev) / dt - g_world
    this.specificForce = {
      x: (nextVel.x - prevVel.x) / dt,
      y: (nextVel.y - prevVel.y) / dt,
      z: (nextVel.z - prevVel.z) / dt + GRAVITY,
    };
    this.gforce = Math.hypot(this.specificForce.x, this.specificForce.y, this.specificForce.z) / GRAVITY;

    // Contact and impact calculation
    let impactImpulse = 0;
    this.events?.drainContactForceEvents((event) => {
      if (
        this.droneColliders.some(
          (c) => event.collider1() === c.handle || event.collider2() === c.handle,
        )
      ) {
        impactImpulse += event.totalForceMagnitude() * dt;
      }
    });

    let touching = false;
    for (const collider of this.droneColliders) {
      this.world.contactPairsWith(collider, (other) => {
        this.world!.contactPair(collider, other, (manifold) => {
          touching ||= manifold.numContacts() > 0;
        });
      });
    }
    const velocityJump = Math.hypot(
      nextVel.x - prevVel.x,
      nextVel.y - prevVel.y,
      nextVel.z - prevVel.z,
    );
    this.impact = Math.max(
      impactImpulse / this.config.mass,
      touching || this.touchingLastStep ? velocityJump : 0,
    );
    this.touchingLastStep = touching;
    if (this.config.body.crashCutoff && this.impact > this.config.body.crashDeltaVelocity) {
      this.crashed = true;
      this.setArmed(false);
    }

    if (nextPos.z < clampZ) {
      this.body.setTranslation({ x: nextPos.x, y: nextPos.y, z: clampZ }, true);
      if (nextVel.z < 0) {
        this.body.setLinvel({ x: nextVel.x, y: nextVel.y, z: 0 }, true);
      }
    }
    const clampedPos = this.body.translation();
    const clampedVel = this.body.linvel();

    const voltage = this.wasm._dronesim_voltage(this.handle);
    const current = this.wasm._dronesim_current(this.handle);
    const charge = this.wasm._dronesim_charge(this.handle);

    this.telemetry = {
      localPosition: { ...clampedPos },
      localOrientation: { ...nextRot },
      localVelocity: { ...clampedVel },
      localAngularVelocity: { ...nextAngvel },
      gforce: this.gforce,
      throttle: this.throttle * 100,
      rotorThrusts: [...rotorThrusts],
      rotorRpms: [...this.rotorRpms],
      motorCommands: [...motorCommands],
      batteryVoltage: voltage,
      batteryCurrent: current,
      batteryCharge: charge,
      impactDeltaVelocity: this.impact,
      crashed: this.crashed,
      armed: flightControllerArmed,
    };

    return this.telemetry;
  }

  // ===========================================================================
  // Mesh Collider & Environment Support
  // ===========================================================================
  public createCollider(data: CollisionData): void {
    if (!data.vertices.length || !data.indices.length) {
      throw new Error("The environment collision mesh contains no triangles.");
    }
    this.mapCollision = data;
    this.mapCollisionParts = partitionCollision(data);
    if (this.world) this.installMap();
  }

  private installMap(): void {
    if (!this.world) return;
    for (const collider of this.mapColliders) this.world.removeCollider(collider, true);
    this.mapColliders = this.mapCollisionParts.map((part) => {
      const origin = part.origin ?? { x: 0, y: 0, z: 0 };
      return this.world!.createCollider(
        RAPIER.ColliderDesc.trimesh(part.vertices, part.indices).setTranslation(
          origin.x,
          origin.y,
          origin.z,
        ),
      );
    });
    this.mapEnabled = this.mapColliders.map(() => true);
    this.world.updateSceneQueries();
  }

  public createPropCollider(data: CollisionData): void {
    this.propCollision = data;
    if (this.world) this.installProps();
  }

  private installProps(): void {
    if (!this.world) return;
    if (this.propBody) this.world.removeRigidBody(this.propBody);
    if (!this.propCollision?.vertices.length || !this.propCollision.indices.length) return;
    this.propBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(this.propCollision.vertices, this.propCollision.indices),
      this.propBody,
    );
    this.world.updateSceneQueries();
  }

  private updateMapRegion(position: Vec3, radius: number): boolean {
    let changed = false;
    this.mapCollisionParts.forEach((part, i) => {
      if (!part.bounds) return;
      const { min, max } = part.bounds;
      const enabled =
        min.x <= position.x + radius &&
        max.x >= position.x - radius &&
        min.y <= position.y + radius &&
        max.y >= position.y - radius &&
        min.z <= position.z + radius &&
        max.z >= position.z - radius;
      if (enabled !== this.mapEnabled[i]) {
        this.mapColliders[i].setEnabled(enabled);
        this.mapEnabled[i] = enabled;
        changed = true;
      }
    });
    return changed;
  }

  public isPropSpaceClear(position: Vec3, radius: number): boolean {
    if (!this.world) return false;
    if (this.updateMapRegion(position, radius)) this.world.updateSceneQueries();
    let clear = true;
    this.world.intersectionsWithShape(
      position,
      { x: 0, y: 0, z: 0, w: 1 },
      new RAPIER.Ball(radius),
      () => {
        clear = false;
        return false;
      },
      undefined,
      undefined,
      undefined,
      this.body,
    );
    return clear;
  }

  // ===========================================================================
  // Betaflight MSP / CLI Serial Bridge
  // ===========================================================================
  public writeSerial(data: Uint8Array, port = 0): number {
    if (!this.wasm || !this.handle) throw new Error("DroneSim is not initialized");
    const ptr = this.wasm._malloc(data.length);
    try {
      this.wasm.HEAPU8.set(data, ptr);
      return this.wasm._dronesim_serial_push(this.handle, port, ptr, data.length);
    } finally {
      this.wasm._free(ptr);
    }
  }

  public readSerial(port = 0, capacity = 1024): Uint8Array {
    if (!this.wasm || !this.handle) throw new Error("DroneSim is not initialized");
    const ptr = this.wasm._malloc(capacity);
    try {
      const count = this.wasm._dronesim_serial_pull(this.handle, port, ptr, capacity);
      if (count <= 0) return new Uint8Array(0);
      return this.wasm.HEAPU8.slice(ptr, ptr + count);
    } finally {
      this.wasm._free(ptr);
    }
  }

  public dispose(): void {
    if (this.wasm && this.rcBuffer) {
      this.wasm._free(this.rcBuffer);
      this.rcBuffer = 0;
    }
    if (this.wasm && this.handle) {
      this.wasm._dronesim_free(this.handle);
      this.handle = 0;
    }
    this.world?.free();
    this.events?.free();
    this.events = undefined;
    this.world = undefined;
    this.body = undefined;
    this.droneColliders = [];
    this.mapColliders = [];
  }
}
