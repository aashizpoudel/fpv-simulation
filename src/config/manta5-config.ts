import { hoverCommand } from "../physics/motor-model";
import type { DroneConfig } from "./drone-config";

// Axisflying MANTA5 DeadCat (DJI O4 Lite, 6S) inspired estimated preset.
// Published: 238 mm wheelbase, ~180 g frame, 4.9–5.1" props, 4S/6S 1050–1500 mAh.
// Motor, mass, inertia, and aerodynamic values are estimates for a 2207-class 6S build.
export const Manta5DeadCatConfig: DroneConfig = {
  rcChannelOrder: [1, 2, 4, 3, 5, 6, 7, 8], // AERT1234
  name: "238 mm 6S — Axisflying Manta5 DeadCat inspired (estimated)",
  body: {
    centerOfMass: { x: 0, y: 0, z: -0.002 },
    // Motors and props dominate; the wider lateral motor spacing raises roll over pitch.
    inertia: { x: 0.0016, y: 0.0014, z: 0.0028 },
    collisionShape: "box",
    ductRadius: 0.06,
    ductHeight: 0.02,
    friction: 0.8,
    restitution: 0.1,
    crashCutoff: true,
    crashDeltaVelocity: 4,
  },
  propulsion: {
    referenceVoltage: 22.8,
    thrustCurve: [
      [0, 0],
      [0.25, 0.0625],
      [0.5, 0.25],
      [0.75, 0.5625],
      [1, 1],
    ],
    riseTime: 0.03,
    fallTime: 0.05,
    idle: 0.05,
    airmode: true,
  },
  aerodynamics: {
    linear: { x: 0.04, y: 0.04, z: 0.06 },
    quadratic: { x: 0.008, y: 0.008, z: 0.02 },
    angular: { x: 0.00012, y: 0.00012, z: 0.0002 },
  },
  battery: {
    cells: 6,
    capacityAh: 1.1,
    initialCharge: 1,
    emptyVoltage: 19.8,
    fullVoltage: 25.2,
    resistance: 0.025,
    idleCurrent: 0.4,
    maxMotorCurrent: 35,
    fixedVoltage: null,
  },
  // TDK InvenSense ICM-42688-P / BMI270 6-axis MEMS IMU parameters
  imu: {
    gyroNoiseDensity: 0.0000489, // 0.0028 deg/s/sqrt(Hz)
    gyroBiasRandomWalk: 0.000012,
    gyroBias: { x: 0.008, y: -0.006, z: 0.005 },
    gyroScaleError: { x: 0.004, y: -0.003, z: 0.003 },
    gyroVibration: 0.012,
    accNoiseDensity: 0.000686, // 70 ug/sqrt(Hz)
    accBiasRandomWalk: 0.00008,
    accBias: { x: 0.015, y: -0.01, z: 0.02 },
    accScaleError: { x: 0.004, y: -0.004, z: 0.003 },
    accVibration: 0.2,
    calibrationDuration: 1.25,
    calibrationMovementThreshold: 0.08,
    seed: 2026,
  },
  // Legacy Betaflight rates: RC Rate 1.00, Super Rate 0.70, Expo 0.
  rates: { expo: 0, rcRate: 1, superRate: 0.7 },
  betaflightPids: {
    roll: { p: 45, i: 80, d: 35 },
    pitch: { p: 48, i: 85, d: 38 },
    yaw: { p: 90, i: 30, d: 0 },
  },
  // Collision box: prop tip to prop tip, landing feet to battery top.
  width: 0.308,
  length: 0.251,
  height: 0.06,
  modelUrl: `${import.meta.env.BASE_URL}drone_models/axisflying-manta5-dc.glb`,

  // Mass: ~590 g AUW (~400 g dry + ~190 g 6S 1100 mAh)
  mass: 0.59,

  linearDamping: 0,
  angularDamping: 0,

  // Rotors — 238 mm wheelbase, motor rectangle measured on the model.
  rotors: (() => {
    const dx = 0.0747; // longitudinal half-spacing
    const dy = 0.0926; // lateral half-spacing
    const armHeight = 0.0;
    // Estimated 2207 1950 KV on 6S with 5.1" props: 1.4 kgf = 13.7 N
    const maxThrustPerRotor = 13.7;

    return [
      { name: "frontRight", position: { x: +dx, y: -dy, z: armHeight }, maxThrust: maxThrustPerRotor },
      { name: "frontLeft", position: { x: +dx, y: +dy, z: armHeight }, maxThrust: maxThrustPerRotor },
      { name: "rearLeft", position: { x: -dx, y: +dy, z: armHeight }, maxThrust: maxThrustPerRotor },
      { name: "rearRight", position: { x: -dx, y: -dy, z: armHeight }, maxThrust: maxThrustPerRotor },
    ];
  })(),

  // Derived from the curve below once the preset is constructed.
  hoverThrottle: 0,
  maxTiltAngleDeg: 55,
  throttleRate: 0.3,
  stickRate: 0.12,
  controllerType: "angle",
  rotorMode: true,
  // 5" prop torque-to-thrust ratio
  yawTorquePerNewton: 0.01,

  cameraConfig: {
    thirdPersonBehind: 1.2,
    thirdPersonHeight: 0.5,
    orbitInitialDistance: 1.2,
    fpvForwardOffset: 0.07, // camera cage at the front of the frame
    fpvTiltDeg: 30, // typical 5" freestyle uptilt
  },

  pidRateConfig: {
    roll: { kP: 0.042, kI: 0.08, kD: 0.0011 },
    pitch: { kP: 0.042, kI: 0.08, kD: 0.0011 },
    yaw: { kP: 0.13, kI: 0.1, kD: 0.0 },
    iLimit: 0.3,
    dFilterHz: 40,
    maxRate: { roll: 670, pitch: 670, yaw: 670 },
  },

  pidAngleConfig: {
    roll: { kP: 4.0, kI: 0.5, kD: 0.0 },
    pitch: { kP: 4.0, kI: 0.5, kD: 0.0 },
    maxAngle: { roll: 55, pitch: 55 },
  },
};

Manta5DeadCatConfig.hoverThrottle = hoverCommand(
  Manta5DeadCatConfig.mass,
  Manta5DeadCatConfig.rotors.reduce((s, r) => s + r.maxThrust, 0),
  Manta5DeadCatConfig.propulsion,
);
