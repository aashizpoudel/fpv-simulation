import type { Vec3 } from "../types";

export interface RotorConfig {
  name: string;
  // Local-space position in meters, relative to body center
  position: { x: number; y: number; z: number };
  // Maximum thrust in Newtons
  maxThrust: number;
}

export type ControllerType = "acro" | "angle" | "simple";

export interface DroneConfig {
  name: string;
  body: BodyDynamics;
  propulsion: PropulsionConfig;
  aerodynamics: AeroConfig;
  battery: BatteryConfig;
  rates: { expo: number };
  // Physical dimensions (full extents)
  width: number; // meters
  length: number; // meters
  height: number; // meters
  modelUrl: string;

  mass: number; // kg

  // Physics / collider parameters
  linearDamping: number;
  angularDamping: number;

  // Rotor layout
  rotors: RotorConfig[];

  // Control tuning
  hoverThrottle: number; // derived command at reference voltage, not thrust fraction
  maxTiltAngleDeg: number;
  throttleRate: number;
  stickRate: number;

  // Controller selection
  controllerType: ControllerType;
  simpleController?: {
    maxThrust?: number;
    maxAngularSpeed?: number;
    throttleRate?: number;
    damping?: number;
  };

  // Force application mode
  rotorMode: boolean; // true = per-rotor at offsets, false = aggregate at body center
  yawTorquePerNewton: number;

  // Camera distance / offset overrides (optional; renderer falls back to
  // automatic size-based values when omitted)
  cameraConfig?: {
    thirdPersonBehind: number; // meters behind drone
    thirdPersonHeight: number; // meters above drone
    orbitInitialDistance: number; // initial orbit camera distance
    fpvForwardOffset: number; // FPV camera forward offset from center
    fpvTiltDeg?: number; // FPV camera uptilt angle in degrees
  };

  // PID rate controller config (acro mode)
  pidRateConfig?: {
    roll: { kP: number; kI: number; kD: number };
    pitch: { kP: number; kI: number; kD: number };
    yaw: { kP: number; kI: number; kD: number };
    iLimit: number;
    dFilterHz: number;
    maxRate: { roll: number; pitch: number; yaw: number }; // deg/s
  };

  // PID angle controller config (angle mode — outer loop)
  pidAngleConfig?: {
    roll: { kP: number; kI: number; kD: number };
    pitch: { kP: number; kI: number; kD: number };
    maxAngle: { roll: number; pitch: number }; // degrees
  };
}

export interface BodyDynamics {
  centerOfMass: Vec3;
  inertia: Vec3; // principal kg m², axes aligned with body
  collisionShape: "box" | "ducts";
  ductRadius: number; // m
  ductHeight: number; // m
  friction: number;
  restitution: number;
  crashCutoff: boolean;
  crashDeltaVelocity: number; // m/s, gameplay threshold
}
export interface PropulsionConfig {
  referenceVoltage: number;
  thrustCurve: [number, number][]; // command, fraction of maximum thrust
  riseTime: number; // seconds, first-order command response
  fallTime: number;
  idle: number; // normalized command
  airmode: boolean;
}
export interface AeroConfig {
  linear: Vec3; // N / (m/s)
  quadratic: Vec3; // N / (m/s)²
  angular: Vec3; // N m / (rad/s)
}
export interface BatteryConfig {
  capacityAh: number;
  initialCharge: number;
  emptyVoltage: number;
  fullVoltage: number;
  resistance: number; // ohm
  idleCurrent: number; // A (electronics)
  maxMotorCurrent: number; // A per motor, empirical load approximation
  fixedVoltage: number | null; // bypass discharge/sag for reproducible benchmarks
}
