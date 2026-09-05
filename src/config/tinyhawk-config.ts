import { hoverCommand } from "../physics/motor-model";
import type { DroneConfig } from "./drone-config";
export type { DroneConfig, RotorConfig, ControllerType } from "./drone-config";

// Tinyhawk III-inspired estimated preset.
// Published size/motor class; propulsion and aerodynamic coefficients are estimates.
export const Tinyhawk3Config: DroneConfig = {
  name: "75 mm 1S — Tinyhawk III inspired (estimated)",
  body: {
    centerOfMass: { x: 0, y: 0, z: -0.004 },
    inertia: { x: 0.000022, y: 0.000022, z: 0.000038 },
    collisionShape: "ducts",
    ductRadius: 0.024,
    ductHeight: 0.022,
    friction: 0.8,
    restitution: 0.1,
    crashCutoff: true,
    crashDeltaVelocity: 3,
  },
  propulsion: {
    referenceVoltage: 3.8,
    thrustCurve: [
      [0, 0],
      [0.25, 0.0625],
      [0.5, 0.25],
      [0.75, 0.5625],
      [1, 1],
    ],
    riseTime: 0.025,
    fallTime: 0.04,
    idle: 0.05,
    airmode: true,
  },
  aerodynamics: {
    linear: { x: 0.008, y: 0.008, z: 0.012 },
    quadratic: { x: 0.001, y: 0.001, z: 0.002 },
    angular: { x: 0.000012, y: 0.000012, z: 0.00002 },
  },
  battery: {
    capacityAh: 0.45,
    initialCharge: 1,
    emptyVoltage: 3.2,
    fullVoltage: 4.35,
    resistance: 0.08,
    idleCurrent: 0.2,
    maxMotorCurrent: 2.5,
    fixedVoltage: null,
  },
  rates: { expo: 0.25 },
  // Outer shell size (collision box)
  width: 0.105,
  length: 0.105,
  height: 0.045,
  modelUrl: `${import.meta.env.BASE_URL}drone_models/tinyhawk.gltf`,

  // Mass: 44g AUW (32g dry + 12.5g battery)
  mass: 0.044,

  // Explicit aerodynamic model replaces generic damping
  linearDamping: 0,
  angularDamping: 0,

  // Rotors — 76mm wheelbase, X-config
  rotors: (() => {
    // arm length = wheelbase / 2 = 38mm, each arm in X-Y plane
    const d = 0.076 / 2 / Math.SQRT2; // ~0.0269m center-to-motor along each axis
    const armHeight = 0.0;
    // Unverified reference thrust: 20 gram-force = 0.196 N
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

  // Derived from the curve below once the preset is constructed.
  hoverThrottle: 0,
  maxTiltAngleDeg: 55,
  throttleRate: 0.3,
  stickRate: 0.12,
  controllerType: "acro",
  rotorMode: true,
  yawTorquePerNewton: 0.003,

  cameraConfig: {
    thirdPersonBehind: 0.63, // base (0.105) * 6
    thirdPersonHeight: 0.32, // base (0.105) * 3
    orbitInitialDistance: 0.5,
    fpvForwardOffset: 0.04, // front edge of whoop frame
    fpvTiltDeg: 20, // 20° standard FPV camera uptilt
  },

  pidRateConfig: {
    roll: { kP: 0.06, kI: 0.12, kD: 0.0015 },
    pitch: { kP: 0.06, kI: 0.12, kD: 0.0015 },
    yaw: { kP: 0.18, kI: 0.15, kD: 0.0 },
    iLimit: 0.3,
    dFilterHz: 40,
    maxRate: { roll: 670, pitch: 670, yaw: 400 },
  },

  pidAngleConfig: {
    roll: { kP: 4.0, kI: 0.5, kD: 0.0 },
    pitch: { kP: 4.0, kI: 0.5, kD: 0.0 },
    maxAngle: { roll: 55, pitch: 55 },
  },
};

Tinyhawk3Config.hoverThrottle = hoverCommand(
  Tinyhawk3Config.mass,
  Tinyhawk3Config.rotors.reduce((s, r) => s + r.maxThrust, 0),
  Tinyhawk3Config.propulsion,
);
