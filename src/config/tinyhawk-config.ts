// tinyhawk3.config.ts

export interface RotorConfig {
  name: string;
  // Local-space position in meters, relative to body center
  position: { x: number; y: number; z: number };
  // Maximum thrust in Newtons
  maxThrust: number;
}

export interface DroneConfig {
  // Physical dimensions (full extents)
  width: number; // meters
  depth: number; // meters
  height: number; // meters

  mass: number; // kg

  // Physics / collider parameters
  density: number;
  linearDamping: number;
  angularDamping: number;

  // Rotor layout
  rotors: RotorConfig[];

  // Control tuning
  hoverThrottle: number; // 0..1 fraction of max thrust per rotor
  maxTiltAngleDeg: number;
  throttleRate: number;
  stickRate: number;

  // Force application mode
  rotorMode: boolean; // true = per-rotor at offsets, false = aggregate at body center
}

// Tinyhawk 3–style configuration
export const Tinyhawk3Config: DroneConfig = {
  // Approx Tinyhawk 3 dimensions
  width: 0.105, // 10.5 cm
  depth: 0.105, // 10.5 cm
  height: 0.045, // 4.5 cm

  // Approx mass ~30 g
  mass: 0.03,

  // Physics tuning (adjust as needed)
  density: 0.5,
  linearDamping: 0.5,
  angularDamping: 0.5,

  // 4 rotors at corners in local space
  rotors: (() => {
    const halfW = 0.105 / 2;
    const halfD = 0.105 / 2;
    const armHeight = 0.0; // rotors in body plane
    const maxThrustPerRotor = 0.3;

    return [
      {
        name: "frontRight",
        position: { x: +halfW, y: armHeight, z: +halfD },
        maxThrust: maxThrustPerRotor,
      },
      {
        name: "frontLeft",
        position: { x: -halfW, y: armHeight, z: +halfD },
        maxThrust: maxThrustPerRotor,
      },
      {
        name: "rearLeft",
        position: { x: -halfW, y: armHeight, z: -halfD },
        maxThrust: maxThrustPerRotor,
      },
      {
        name: "rearRight",
        position: { x: +halfW, y: armHeight, z: -halfD },
        maxThrust: maxThrustPerRotor,
      },
    ];
  })(),

  // Control tuning
  hoverThrottle: 0.4,
  maxTiltAngleDeg: 45,
  throttleRate: 0.2,
  stickRate: 0.4,
  rotorMode: false,
};
