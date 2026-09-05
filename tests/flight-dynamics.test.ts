// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { RapierPhysics } from "../src/physics/rapier-physics";
import {
  defaultPreset,
  parsePreset,
  exportPreset,
} from "../src/config/presets";
import { conjugateQuat, rotateVector } from "../src/controllers/math-utils";
import { rateTarget } from "../src/controllers/rates";
import { MotorModel, hoverCommand } from "../src/physics/motor-model";
import { BatteryModel } from "../src/physics/battery-model";
import { aerodynamicForces } from "../src/physics/aerodynamics";
import { MotorMixer } from "../src/controllers/motor-mixer";
import { PIDController } from "../src/controllers/pid";
import { SimulationEngine } from "../src/core/simulation-engine";
import { createRecording, parseRecording } from "../src/core/flight-recording";
import type { Controls } from "../src/types";
import type { DroneConfig } from "../src/config/drone-config";
import type RAPIER from "@dimforge/rapier3d-compat";

const neutral: Controls = {
  thrust: 0,
  roll: 0,
  pitch: 0,
  yaw: 0,
  arm: true,
  reset: false,
  speedMultiplier: 1,
};
const identity = { x: 0, y: 0, z: 0, w: 1 };
const instances: RapierPhysics[] = [];
afterEach(() => {
  for (const p of instances.splice(0)) p.dispose();
});
function config(): DroneConfig {
  const c = defaultPreset();
  c.battery.fixedVoltage = c.propulsion.referenceVoltage;
  return c;
}
async function setup(c = config()) {
  const p = new RapierPhysics(c);
  instances.push(p);
  await p.init({ x: 0, y: 0, z: 100 });
  p.setArmed(true);
  return p;
}
function body(p: RapierPhysics) {
  return (p as unknown as { body: RAPIER.RigidBody }).body;
}
function run(p: RapierPhysics, controls: Controls, seconds: number, hz = 480) {
  for (let i = 0; i < Math.round(seconds * hz); i++)
    p.step(controls, 1 / hz, -Infinity);
  return p.getTelemetry();
}

describe("closed-loop flight", () => {
  for (const axis of ["roll", "pitch", "yaw"] as const)
    it(`tracks ${axis} steps and settles after release`, async () => {
      const c = config(),
        p = await setup(c),
        rates: number[] = [];
      const target =
        (rateTarget(0.1, c.pidRateConfig!.maxRate[axis], c.rates.expo) * 180) /
        Math.PI;
      for (let i = 0; i < 960; i++) {
        const t = p.step(
          { ...neutral, throttle: c.hoverThrottle, [axis]: 0.1 },
          1 / 480,
          -Infinity,
        );
        if (i >= 720)
          rates.push(
            (rotateVector(
              conjugateQuat(t.localOrientation),
              t.localAngularVelocity,
            )[{ roll: "x", pitch: "y", yaw: "z" }[axis] as "x" | "y" | "z"] *
              180) /
              Math.PI,
          );
      }
      expect(
        Math.abs(rates.reduce((a, b) => a + b, 0) / rates.length - target) /
          target,
      ).toBeLessThan(0.05);
      expect(Math.max(...rates) - Math.min(...rates)).toBeLessThan(5);
      const t = run(p, { ...neutral, throttle: c.hoverThrottle }, 2);
      expect(
        (Math.hypot(...Object.values(t.localAngularVelocity)) * 180) / Math.PI,
      ).toBeLessThan(5);
    });
  it("recovers from a tilted attitude in angle mode", async () => {
    const p = await setup();
    p.switchFlightMode("angle");
    body(p).setRotation(
      { x: Math.sin(Math.PI / 12), y: 0, z: 0, w: Math.cos(Math.PI / 12) },
      true,
    );
    const t = run(p, { ...neutral, throttle: config().hoverThrottle }, 4);
    expect(Math.abs(t.localOrientation.x)).toBeLessThan(0.025);
    expect(Math.hypot(...Object.values(t.localAngularVelocity))).toBeLessThan(
      0.05,
    );
  });
  for (const throttle of [0, 0.2, 1])
    it(`remains bounded and recovers after combined input at throttle ${throttle}`, async () => {
      const p = await setup();
      run(p, { ...neutral, throttle, roll: 1, pitch: 0.6, yaw: 0.4 }, 1);
      const t = run(p, { ...neutral, throttle: config().hoverThrottle }, 3);
      expect(t.crashed).toBe(false);
      expect(Math.hypot(...Object.values(t.localAngularVelocity))).toBeLessThan(
        0.2,
      );
      expect(t.rotorThrusts.every((v) => Number.isFinite(v) && v >= 0)).toBe(
        true,
      );
    });
  it("converges between 480 and 960 Hz", async () => {
    const a = await setup(),
      b = await setup();
    const c = {
      ...neutral,
      throttle: config().hoverThrottle,
      roll: 0.1,
      yaw: 0.1,
    };
    const x = run(a, c, 2, 480),
      y = run(b, c, 2, 960);
    expect(Math.abs(x.localPosition.z - y.localPosition.z)).toBeLessThan(0.03);
    for (const axis of ["x", "y", "z"] as const)
      expect(
        Math.abs(x.localAngularVelocity[axis] - y.localAngularVelocity[axis]),
      ).toBeLessThan(0.01);
  });
  it("preserves identical fixed-step input across 30/60/120 FPS", async () => {
    const states = [];
    for (const fps of [30, 60, 120]) {
      const c = config(),
        p = await setup(c),
        engine = new SimulationEngine({ physics: p });
      let tick = 0;
      engine.beforeFixedStep = () => ({
        ...neutral,
        throttle: c.hoverThrottle,
        roll: tick++ < 240 ? 0 : 0.1,
      });
      for (let frame = 0; frame < fps * 2; frame++)
        engine.step(neutral, 1 / fps);
      expect(engine.droppedTime).toBe(0);
      states.push(engine.getTelemetry());
    }
    expect(states[0]).toEqual(states[1]);
    expect(states[1]).toEqual(states[2]);
  });
});

describe("physical invariants", () => {
  it("sets explicit mass and inertia without collider double counting", async () => {
    const c = config(),
      p = await setup(c),
      b = body(p);
    expect(b.mass()).toBeCloseTo(c.mass, 7);
    for (const axis of ["x", "y", "z"] as const)
      expect(b.principalInertia()[axis]).toBeCloseTo(c.body.inertia[axis], 9);
    expect(b.localCom().z).toBeCloseTo(c.body.centerOfMass.z, 7);
    b.addTorque({ x: 0.0001, y: 0, z: 0 }, true);
    const world = (p as unknown as { world: RAPIER.World }).world;
    world.timestep = 1 / 480;
    world.step();
    expect(b.angvel().x).toBeCloseTo(0.0001 / c.body.inertia.x / 480, 5);
  });
  it("free-falls under gravity with aerodynamic forces disabled", async () => {
    const c = config();
    c.aerodynamics.linear = { x: 0, y: 0, z: 0 };
    c.aerodynamics.quadratic = { x: 0, y: 0, z: 0 };
    const p = await setup(c);
    p.setArmed(false);
    const t = run(p, neutral, 1);
    expect(t.localVelocity.z).toBeCloseTo(-9.81, 3);
  });
  it("drag removes energy even when rotated", () => {
    const v = { x: 3, y: -2, z: 5 },
      w = { x: -1, y: 3, z: 2 };
    const f = aerodynamicForces(
      v,
      w,
      { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
      config().aerodynamics,
    );
    expect(v.x * f.force.x + v.y * f.force.y + v.z * f.force.z).toBeLessThan(0);
    expect(w.x * f.torque.x + w.y * f.torque.y + w.z * f.torque.z).toBeLessThan(
      0,
    );
  });
  it("spools down on disarm and clears residual thrust on reset", async () => {
    const p = await setup();
    run(p, { ...neutral, throttle: 0.8 }, 0.5);
    const before = p.getTelemetry().rotorThrusts[0];
    p.setArmed(false);
    const t = run(p, neutral, 1 / 480);
    expect(t.rotorThrusts[0]).toBeGreaterThan(0);
    expect(t.rotorThrusts[0]).toBeLessThan(before);
    expect(run(p, neutral, 1).rotorThrusts[0]).toBeLessThan(1e-8);
    p.reset();
    expect(p.getTelemetry().rotorThrusts).toEqual([0, 0, 0, 0]);
  });
  it("motor lag is independent of timestep for a constant command", () => {
    const c = config();
    const a = new MotorModel(c.propulsion, 0.196),
      b = new MotorModel(c.propulsion, 0.196);
    for (let i = 0; i < 48; i++) a.step(1, 3.8, 1 / 480);
    for (let i = 0; i < 96; i++) b.step(1, 3.8, 1 / 960);
    expect(a.output).toBeCloseTo(b.output, 12);
    expect(a.output).toBeLessThan(1);
    expect(a.output).toBeGreaterThan(0.9);
    expect(
      hoverCommand(
        c.mass,
        c.rotors.reduce((s, r) => s + r.maxThrust, 0),
        c.propulsion,
      ),
    ).toBeCloseTo(c.hoverThrottle, 10);
  });
});

describe("mixer and battery", () => {
  it("produces correct torque signs and bounded motor commands on each axis", () => {
    const c = config();
    const m = new MotorMixer(
      c.rotors,
      c.propulsion,
      c.yawTorquePerNewton,
      c.body.centerOfMass,
    );
    for (const [axis, xyz] of [
      ["roll", "x"],
      ["pitch", "y"],
      ["yaw", "z"],
    ] as const) {
      const command = { roll: 0, pitch: 0, yaw: 0, [axis]: 0.1 };
      const u = m.mix(0.5, command.roll, command.pitch, command.yaw);
      expect(m.computeForces(u, identity).torque[xyz]).toBeGreaterThan(0);
    }
    const u = m.mix(1, 2, 2, 2);
    expect(u.every((x) => x >= c.propulsion.idle && x <= 1)).toBe(true);
    expect(Object.values(m.saturation).some((x) => x > 0)).toBe(true);
  });
  it("Airmode preserves differential authority at zero throttle", () => {
    const c = config();
    const a = new MotorMixer(
      c.rotors,
      c.propulsion,
      c.yawTorquePerNewton,
      c.body.centerOfMass,
    );
    const b = new MotorMixer(
      c.rotors,
      { ...c.propulsion, airmode: false },
      c.yawTorquePerNewton,
      c.body.centerOfMass,
    );
    const torque = (m: MotorMixer) =>
      m.computeForces(m.mix(0, 0.1, 0, 0), identity).torque.x;
    expect(torque(a)).toBeGreaterThan(torque(b));
  });
  it("conditional integration blocks further windup but allows unwinding", () => {
    const pid = new PIDController(0, 1, 0, 1, 40);
    for (let i = 0; i < 100; i++) pid.update(1, 0, 0.01, 0.5);
    expect(pid.update(0, 0, 0.01)).toBe(0);
    pid.update(1, 0, 0.5);
    expect(pid.update(-1, 0, 0.1, 0.5)).toBeCloseTo(0.4);
  });
  it("sags under load, recovers, depletes, and resets", () => {
    const c = defaultPreset().battery,
      b = new BatteryModel(c);
    const idle = b.step([0, 0, 0, 0], 0.01),
      load = b.step([1, 1, 1, 1], 0.01);
    expect(load).toBeLessThan(idle);
    expect(b.step([0, 0, 0, 0], 0.01)).toBeGreaterThan(load);
    const initial = b.charge;
    for (let i = 0; i < 1000; i++) b.step([1, 1, 1, 1], 1);
    expect(b.charge).toBe(0);
    expect(b.voltage).toBe(0);
    expect(initial).toBeLessThan(1);
    b.reset();
    expect(b.charge).toBe(c.initialCharge);
  });
});

describe("configuration and recordings", () => {
  it("round-trips configuration and rejects invalid curves/versions/inertia", () => {
    const c = defaultPreset();
    expect(parsePreset(exportPreset(c))).toEqual(c);
    expect(() => parsePreset('{"version":2}')).toThrow(/version/);
    c.propulsion.thrustCurve[1][0] = 0;
    expect(() => exportPreset(c)).toThrow(/monotonic/);
    const bad = defaultPreset();
    bad.body.inertia.z = 0.001;
    expect(() => exportPreset(bad)).toThrow(/triangle/);
  });
  it("replays the same input, mode switches, and resets identically", async () => {
    const c = config(),
      p = await setup(c);
    p.setArmed(false);
    const r = createRecording(c, "empty", { x: 0, y: 0, z: 100 });
    for (let i = 0; i < 960; i++)
      r.steps.push({
        mode: i > 600 ? "angle" : "acro",
        controls: {
          ...neutral,
          throttle: c.hoverThrottle,
          roll: i < 240 ? 0.1 : 0,
          reset: i === 480,
        },
      });
    const parsed = parseRecording(JSON.stringify(r));
    expect(parsed).toEqual(r);
    const replay = async () => {
      const physics = await setup(parsed.config);
      let mode = "acro";
      for (const step of parsed.steps) {
        if (step.controls.reset) physics.reset();
        if (step.mode !== mode || step.controls.reset)
          physics.switchFlightMode(step.mode);
        mode = step.mode;
        physics.setArmed(step.controls.arm);
        physics.step(step.controls, parsed.fixedTimeStep, -Infinity);
      }
      return physics.getTelemetry();
    };
    expect(await replay()).toEqual(await replay());
    parsed.steps[0].controls.roll = NaN;
    expect(() => parseRecording(JSON.stringify(parsed))).toThrow(/roll/);
  });
});
