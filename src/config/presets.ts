import type { DroneConfig } from "./drone-config";
import { Tinyhawk3Config } from "./tinyhawk-config";
import { hoverCommand } from "../physics/motor-model";

export const PRESET_VERSION = 1;
export const PHYSICS_VERSION = "whoop-1";
export const PRESET_STORAGE_KEY = "fpv_physics_preset_v1";
export type PresetDocument = { version: 1; config: DroneConfig };
function check(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function range(n: number, min: number, max: number, label: string): void {
  check(
    Number.isFinite(n) && n >= min && n <= max,
    `${label} must be between ${min} and ${max}`,
  );
}
function shape(value: unknown, template: unknown, path = "config"): void {
  if (template === null) {
    check(
      value === null || (typeof value === "number" && Number.isFinite(value)),
      `${path}: expected number or null`,
    );
    return;
  }
  if (Array.isArray(template)) {
    check(
      Array.isArray(value) && value.length > 0 && value.length <= 100,
      `${path}: invalid array`,
    );
    value.forEach((v, i) => shape(v, template[0], `${path}[${i}]`));
    return;
  }
  if (typeof template === "object") {
    check(
      value !== null && typeof value === "object" && !Array.isArray(value),
      `${path}: expected object`,
    );
    const object = value as Record<string, unknown>;
    for (const [key, v] of Object.entries(template as object)) {
      check(
        Object.prototype.hasOwnProperty.call(object, key),
        `${path}.${key}: required`,
      );
      shape(object[key], v, `${path}.${key}`);
    }
    const allowed = Object.keys(template as object);
    for (const key of Object.keys(object))
      check(allowed.includes(key), `${path}.${key}: unknown field`);
    return;
  }
  check(
    typeof value === typeof template &&
      (typeof value !== "number" || Number.isFinite(value)),
    `${path}: invalid value`,
  );
}
export function validateDroneConfig(c: DroneConfig): void {
  shape(c, Tinyhawk3Config);
  check(
    c.name.length > 0 && c.name.length < 120,
    "Preset name must contain 1–119 characters",
  );
  // Assets are selected by the application, never loaded from arbitrary imported URLs.
  check(c.modelUrl === Tinyhawk3Config.modelUrl, "Unsupported drone model");
  range(c.mass, 0.01, 0.15, "Mass (kg)");
  for (const key of ["width", "length", "height"] as const)
    range(c[key], 0.01, 0.3, key);
  range(c.linearDamping, 0, 0, "Legacy linear damping");
  range(c.angularDamping, 0, 0, "Legacy angular damping");
  check(c.rotors.length === 4, "Exactly four X-layout motors required");
  const quadrants = new Set(
    c.rotors.map(
      (r) => `${Math.sign(r.position.x)},${Math.sign(r.position.y)}`,
    ),
  );
  check(
    quadrants.size === 4 &&
      c.rotors.every((r) => r.position.x !== 0 && r.position.y !== 0),
    "Motors must occupy four distinct X-layout quadrants",
  );
  for (const r of c.rotors) {
    range(r.maxThrust, 0.01, 2, "Motor thrust (N)");
    for (const axis of ["x", "y", "z"] as const)
      range(r.position[axis], -0.15, 0.15, `Motor ${axis}`);
  }
  // Mixer coefficients assume a symmetric quad X geometry.
  for (const axis of ["x", "y"] as const)
    for (const r of c.rotors)
      check(
        Math.abs(
          Math.abs(r.position[axis]) - Math.abs(c.rotors[0].position[axis]),
        ) < 1e-8,
        "Mixer requires symmetric X rotor offsets",
      );
  for (const axis of ["x", "y", "z"] as const) {
    range(c.body.inertia[axis], 1e-7, 0.002, `Inertia ${axis}`);
    range(c.body.centerOfMass[axis], -0.02, 0.02, `Center of mass ${axis}`);
    range(c.aerodynamics.linear[axis], 0, 0.1, `Linear drag ${axis}`);
    range(c.aerodynamics.quadratic[axis], 0, 0.03, `Quadratic drag ${axis}`);
    range(c.aerodynamics.angular[axis], 0, 0.001, `Angular drag ${axis}`);
  }
  const { x, y, z } = c.body.inertia;
  check(
    x + y >= z && x + z >= y && y + z >= x,
    "Inertia must satisfy triangle inequalities",
  );
  check(
    ["box", "ducts"].includes(c.body.collisionShape),
    "Unsupported collision shape",
  );
  range(c.body.ductRadius, 0.005, 0.06, "Duct radius");
  range(c.body.ductHeight, 0.005, 0.06, "Duct height");
  range(c.body.friction, 0, 2, "Friction");
  range(c.body.restitution, 0, 1, "Restitution");
  range(c.body.crashDeltaVelocity, 0.1, 50, "Crash threshold");
  const p = c.propulsion;
  range(p.referenceVoltage, 2.5, 4.5, "Reference voltage");
  range(p.riseTime, 0.001, 0.2, "Motor rise time");
  range(p.fallTime, 0.001, 0.3, "Motor fall time");
  range(p.idle, 0, 0.2, "Motor idle");
  check(p.thrustCurve.length >= 2, "Thrust curve needs at least two points");
  p.thrustCurve.forEach(([u, t], i) => {
    check(
      p.thrustCurve[i].length === 2,
      "Curve point must contain command and thrust",
    );
    range(u, 0, 1, "Curve command");
    range(t, 0, 1, "Curve thrust");
    if (i)
      check(
        u > p.thrustCurve[i - 1][0] && t >= p.thrustCurve[i - 1][1],
        "Thrust curve must be monotonic",
      );
  });
  check(
    p.thrustCurve[0][0] === 0 &&
      p.thrustCurve[0][1] === 0 &&
      p.thrustCurve[p.thrustCurve.length - 1][0] === 1 &&
      p.thrustCurve[p.thrustCurve.length - 1][1] === 1,
    "Curve endpoints must be [0,0] and [1,1]",
  );
  const b = c.battery;
  range(b.capacityAh, 0.05, 2, "Capacity (Ah)");
  range(b.initialCharge, 0, 1, "Battery charge");
  range(b.emptyVoltage, 2.5, 3.6, "Empty voltage");
  range(b.fullVoltage, 3.7, 4.5, "Full voltage");
  range(b.resistance, 0, 0.5, "Battery resistance");
  range(b.idleCurrent, 0, 1, "Electronics current");
  range(b.maxMotorCurrent, 0.1, 10, "Motor current");
  if (b.fixedVoltage !== null) range(b.fixedVoltage, 0, 4.5, "Fixed voltage");
  range(c.rates.expo, 0, 0.8, "Expo");
  range(c.yawTorquePerNewton, 0.0001, 0.02, "Yaw torque coefficient");
  check(
    c.controllerType === "acro" || c.controllerType === "angle",
    "Preset requires acro or angle controller",
  );
  check(c.rotorMode === true, "Preset requires rotor force model");
  range(c.hoverThrottle, 0, 1, "Hover throttle");
  range(c.throttleRate, 0.01, 2, "Keyboard throttle rate");
  range(c.stickRate, 0, 2, "Legacy stick rate");
  range(c.maxTiltAngleDeg, 5, 80, "Maximum tilt");
  check(
    !!c.pidRateConfig && !!c.pidAngleConfig && !!c.cameraConfig,
    "Controller and camera settings required",
  );
  for (const axis of ["roll", "pitch", "yaw"] as const) {
    const gains = c.pidRateConfig[axis];
    range(gains.kP, 0, 2, `${axis} P`);
    range(gains.kI, 0, 2, `${axis} I`);
    range(gains.kD, 0, 0.05, `${axis} D`);
    range(c.pidRateConfig.maxRate[axis], 10, 1200, `${axis} rate`);
  }
  range(c.pidRateConfig.iLimit, 0, 2, "Integral limit");
  range(c.pidRateConfig.dFilterHz, 1, 200, "D filter");
  for (const axis of ["roll", "pitch"] as const) {
    const g = c.pidAngleConfig[axis];
    range(g.kP, 0, 20, "Angle P");
    range(g.kI, 0, 5, "Angle I");
    range(g.kD, 0, 1, "Angle D");
    range(c.pidAngleConfig.maxAngle[axis], 5, 80, "Angle limit");
  }
  range(c.cameraConfig.fpvTiltDeg!, 0, 60, "Camera tilt");
  for (const key of [
    "thirdPersonBehind",
    "thirdPersonHeight",
    "orbitInitialDistance",
    "fpvForwardOffset",
  ] as const)
    range(c.cameraConfig[key], 0, 10, key);
}
export function normalizePreset(config: DroneConfig): DroneConfig {
  validateDroneConfig(config);
  const copy = structuredClone(config);
  const hover = hoverCommand(
    copy.mass,
    copy.rotors.reduce((s, r) => s + r.maxThrust, 0),
    copy.propulsion,
  );
  check(
    Number.isFinite(hover),
    "Insufficient thrust to hover at reference voltage",
  );
  copy.hoverThrottle = hover;
  return copy;
}
export function parsePreset(text: string): DroneConfig {
  check(text.length < 100_000, "Preset is too large");
  const doc = JSON.parse(text) as PresetDocument;
  check(doc?.version === PRESET_VERSION, "Unsupported preset version");
  return normalizePreset(doc.config);
}
export function exportPreset(config: DroneConfig): string {
  return JSON.stringify(
    { version: PRESET_VERSION, config: normalizePreset(config) },
    null,
    2,
  );
}
export function defaultPreset(): DroneConfig {
  return normalizePreset(Tinyhawk3Config);
}
