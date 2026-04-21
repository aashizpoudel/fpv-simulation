// tinyhawk3.config.ts

export interface RotorConfig {
  name: string;
  // Local-space position in meters, relative to body center
  position: { x: number; y: number; z: number };
  // Maximum thrust in Newtons
  maxThrust: number;
}

export type ControllerType = "acro" | "angle" | "simple";

export interface DroneConfig {
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
  hoverThrottle: number; // 0..1 fraction of max thrust per rotor
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
    thirdPersonBehind: number;   // meters behind drone
    thirdPersonHeight: number;   // meters above drone
    orbitInitialDistance: number; // initial orbit camera distance
    fpvForwardOffset: number;    // FPV camera forward offset from center
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

// EMAX Tinyhawk 3 – real specs, Z-up world
// Sources: EMAX USA product page, Oscar Liang review, motor/prop datasheets
// AUW: ~44g (32g dry + 12.5g 1S 450mAh battery)
// Motors: TH0802 II 15000KV, ~20g thrust per motor on 1S
// Props: Avan TH 40mm 4-blade
// Wheelbase: 76mm, frame: 105x105x45mm polypropylene whoop
export const Tinyhawk3Config: DroneConfig = {
  // Outer shell size (collision box)
  width: 0.105,
  length: 0.105,
  height: 0.045,
  modelUrl: `${import.meta.env.BASE_URL}drone_models/tinyhawk.gltf`,

  // Mass: 44g AUW (32g dry + 12.5g battery)
  mass: 0.044,

  // Damping — whoop ducts add significant drag
  linearDamping: 0.6,
  angularDamping: 0.8,

  // Rotors — 76mm wheelbase, X-config
  rotors: (() => {
    // arm length = wheelbase / 2 = 38mm, each arm in X-Y plane
    const d = 0.076 / 2 / Math.SQRT2; // ~0.0269m center-to-motor along each axis
    const armHeight = 0.0;
    // ~20g per motor on 1S = 0.196N
    const maxThrustPerRotor = 0.196;

    return [
      {
        name: "frontRight",
        position: { x: +d, y: -d, z: armHeight },
        maxThrust: maxThrustPerRotor,
      },
      {
        name: "frontLeft",
        position: { x: +d, y: +d, z: armHeight },
        maxThrust: maxThrustPerRotor,
      },
      {
        name: "rearLeft",
        position: { x: -d, y: +d, z: armHeight },
        maxThrust: maxThrustPerRotor,
      },
      {
        name: "rearRight",
        position: { x: -d, y: -d, z: armHeight },
        maxThrust: maxThrustPerRotor,
      },
    ];
  })(),

  // Hover throttle: sqrt(mass*g / (4 * maxThrustPerRotor)) = sqrt(0.044*9.81 / (4*0.196)) ≈ 0.742
  hoverThrottle: 0.742,
  maxTiltAngleDeg: 55,
  throttleRate: 0.3,
  stickRate: 0.12,
  controllerType: "acro",
  rotorMode: true,
  yawTorquePerNewton: 0.003,

  cameraConfig: {
    thirdPersonBehind: 0.63,   // base (0.105) * 6
    thirdPersonHeight: 0.32,   // base (0.105) * 3
    orbitInitialDistance: 0.5,
    fpvForwardOffset: 0.01,    // base (0.105) * 0.5
  },

  pidRateConfig: {
    roll: { kP: 0.45, kI: 0.35, kD: 0.003 },
    pitch: { kP: 0.45, kI: 0.35, kD: 0.003 },
    yaw: { kP: 0.35, kI: 0.25, kD: 0.0 },
    iLimit: 0.3,
    dFilterHz: 100,
    maxRate: { roll: 670, pitch: 670, yaw: 400 },
  },

  pidAngleConfig: {
    roll: { kP: 4.0, kI: 0.5, kD: 0.0 },
    pitch: { kP: 4.0, kI: 0.5, kD: 0.0 },
    maxAngle: { roll: 55, pitch: 55 },
  },
};
