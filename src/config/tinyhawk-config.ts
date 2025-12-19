// tinyhawk3.config.ts

export interface RotorConfig {
  name: string;
  // Local-space position in meters, relative to body center
  position: { x: number; y: number; z: number };
  // Maximum thrust in Newtons
  maxThrust: number;
}

export type ControllerType = "acro" | "simple";

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
}
// Tinyhawk 3 – geometry-corrected, Z-up world
export const Tinyhawk3Config: DroneConfig = {
  // Outer shell size (only used for collision box)
  width: 0.105,
  length: 0.105,
  height: 0.045,
  modelUrl: "/drone_models/tinyhawk.gltf",

  // Mass
  mass: 0.03,

  // Damping – start low, tune later
  linearDamping: 0.05,
  angularDamping: 0.07,

  // Rotors – real 76 mm wheel-base, symmetrical X
  rotors: (() => {
    const d = 0.076 / Math.SQRT2; // 0.0537 m diagonal arm length
    const armHeight = 0.0; // props in body X-Y plane
    const maxThrustPerRotor = 0.15; // N (gives ~2:1 T/W)

    return [
      {
        name: "frontRight",
        position: { x: +d, y: +d, z: armHeight },
        maxThrust: maxThrustPerRotor,
      },
      {
        name: "frontLeft",
        position: { x: -d, y: +d, z: armHeight },
        maxThrust: maxThrustPerRotor,
      },
      {
        name: "rearLeft",
        position: { x: -d, y: -d, z: armHeight },
        maxThrust: maxThrustPerRotor,
      },
      {
        name: "rearRight",
        position: { x: +d, y: -d, z: armHeight },
        maxThrust: maxThrustPerRotor,
      },
    ];
  })(),

  // Control
  hoverThrottle: 0.6, // 0.03·9.81 / (4·0.12) ≈ 0.61
  maxTiltAngleDeg: 45,
  throttleRate: 0.2,
  stickRate: 0.08,
  controllerType: "simple",
  rotorMode: false,
  yawTorquePerNewton: 0.002,
};
