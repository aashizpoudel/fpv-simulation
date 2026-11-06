import type { Vec3 } from "../types";

export interface RotorConfig {
  name: string;
  // Local-space position in meters, relative to body center
  position: { x: number; y: number; z: number };
  // Maximum thrust in Newtons
  maxThrust: number;
}

export type ControllerType = "acro" | "angle" | "simple";
export type RcChannelOrder = [number, number, number, number, number, number, number, number];
export type BetaflightRatesType = "betaflight" | "raceflight" | "kiss" | "actual" | "quick";

export interface AxisRateConfig {
  rcRate: number;
  superRate: number;
  expo: number;
}

export interface BetaflightRatesConfig {
  type?: BetaflightRatesType;
  roll?: AxisRateConfig;
  pitch?: AxisRateConfig;
  yaw?: AxisRateConfig;
  rcRate: number;
  superRate: number;
  expo: number;
}

export interface ImuConfig {
  /** Gyroscope white noise spectral density in (rad/s)/sqrt(Hz). */
  gyroNoiseDensity: number;
  /** Gyroscope bias random walk in (rad/s)/sqrt(s). */
  gyroBiasRandomWalk: number;
  /** Initial turn-on gyroscope zero-rate bias in rad/s (calibrated out during startup). */
  gyroBias: Vec3;
  /** Fractional gyroscope scale factor error per axis (e.g. 0.005 = +0.5%). */
  gyroScaleError: Vec3;
  /** Peak gyroscope rotor-harmonic vibration amplitude at max RPM in rad/s. */
  gyroVibration: number;
  /** Accelerometer white noise spectral density in (m/s^2)/sqrt(Hz). */
  accNoiseDensity: number;
  /** Accelerometer bias random walk in (m/s^2)/sqrt(s). */
  accBiasRandomWalk: number;
  /** Static accelerometer bias in m/s^2. */
  accBias: Vec3;
  /** Fractional accelerometer scale factor error per axis. */
  accScaleError: Vec3;
  /** Peak accelerometer rotor-harmonic vibration amplitude at max RPM in m/s^2. */
  accVibration: number;
  /** Startup stationary gyroscope calibration window in seconds (Betaflight default: 1.25s). */
  calibrationDuration: number;
  /** Maximum allowed gyro standard deviation (rad/s) during calibration before restarting. */
  calibrationMovementThreshold: number;
  /** Deterministic PRNG seed for reproducible sensor noise and flight replays. */
  seed: number;
}

export interface DroneConfig {
  name: string;
  /** One-based raw channel positions for Betaflight's internal AERT1234 channels. */
  rcChannelOrder: RcChannelOrder;
  body: BodyDynamics;
  propulsion: PropulsionConfig;
  aerodynamics: AeroConfig;
  battery: BatteryConfig;
  imu: ImuConfig;
  rates: BetaflightRatesConfig;
  /** Betaflight's native integer P/I/D values for the active rate PID profile. */
  betaflightPids: {
    roll: { p: number; i: number; d: number };
    pitch: { p: number; i: number; d: number };
    yaw: { p: number; i: number; d: number };
  };
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

  // Legacy JS controller gains; Betaflight uses betaflightPids above.
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
  cells: number; // series cell count; voltages below are for the full pack
  capacityAh: number;
  initialCharge: number;
  emptyVoltage: number;
  fullVoltage: number;
  resistance: number; // ohm
  idleCurrent: number; // A (electronics)
  maxMotorCurrent: number; // A per motor, empirical load approximation
  fixedVoltage: number | null; // bypass discharge/sag for reproducible benchmarks
}
