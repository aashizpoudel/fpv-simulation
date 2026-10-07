// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { RapierPhysics } from "../src/physics/rapier-physics";
import { SimulationEngine } from "../src/core/simulation-engine";
import { defaultPreset } from "../src/config/presets";
import { quaternionToEuler } from "../src/controllers/math-utils";
import { MotionAssist, type MotionIntent } from "../src/input/motion-assist";
import type { Controls, DroneTelemetry } from "../src/types";

const FRAME = 1 / 60;
const neutral: MotionIntent = { speed: 0, pitch: 0, yaw: 0, brake: false };
const instances: RapierPhysics[] = [];
afterEach(() => {
  for (const p of instances.splice(0)) p.dispose();
});

async function setup() {
  const config = defaultPreset();
  config.battery.fixedVoltage = config.propulsion.referenceVoltage;
  const physics = new RapierPhysics(config);
  instances.push(physics);
  const engine = new SimulationEngine({ physics, clampZ: 0 });
  await engine.init({ x: 0, y: 0, z: 0 });
  engine.setArmed(true);
  const assist = new MotionAssist(config);
  let tel: DroneTelemetry = engine.getTelemetry();
  let last = { landed: false };
  /** Run seconds of 60 Hz assist updates, each driving 8 fixed physics steps. */
  function fly(seconds: number, intent: MotionIntent = neutral) {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      const cmd = assist.update(intent, tel, FRAME);
      last = cmd;
      const controls: Controls = {
        throttle: cmd.throttle,
        thrust: cmd.throttle * 2 - 1,
        roll: cmd.roll,
        pitch: cmd.pitch,
        yaw: cmd.yaw,
        speedMultiplier: 1,
        arm: true,
        reset: false,
      };
      tel = engine.step(controls, FRAME);
    }
    return tel;
  }
  const psi = () => quaternionToEuler(tel.localOrientation).yaw;
  return { assist, fly, psi, tel: () => tel, last: () => last };
}

async function hovering() {
  const s = await setup();
  s.assist.takeoff();
  s.fly(4);
  return s;
}

describe("MotionAssist", () => {
  it("takes off to the takeoff height and hovers", async () => {
    const s = await setup();
    s.assist.takeoff();
    const t = s.fly(4);
    expect(Math.abs(t.localPosition.z - 1.2)).toBeLessThan(0.3);
    expect(Math.abs(t.localVelocity.z)).toBeLessThan(0.15);
  });

  it("holds altitude and position with neutral intent", async () => {
    const s = await hovering();
    const p0 = { ...s.tel().localPosition };
    const t = s.fly(3);
    expect(Math.abs(t.localPosition.z - p0.z)).toBeLessThan(0.3);
    expect(Math.hypot(t.localPosition.x - p0.x, t.localPosition.y - p0.y)).toBeLessThan(0.5);
  });

  it("flies forward along the heading at constant altitude", async () => {
    const s = await hovering();
    s.fly(1, { ...neutral, yaw: 1 }); // turn so heading is not world +X
    s.fly(1.5);
    const z0 = s.tel().localPosition.z;
    const psi = s.psi();
    expect(Math.abs(psi)).toBeGreaterThan(0.3);
    const t = s.fly(2.5, { ...neutral, speed: 1 });
    const v = t.localVelocity;
    const along = v.x * Math.cos(psi) + v.y * Math.sin(psi);
    const lateral = -v.x * Math.sin(psi) + v.y * Math.cos(psi);
    expect(along).toBeGreaterThan(2);
    expect(Math.abs(lateral)).toBeLessThan(0.5);
    expect(Math.abs(t.localPosition.z - z0)).toBeLessThan(0.5);
  });

  it("climbs when pointing up while moving forward", async () => {
    const s = await hovering();
    const z0 = s.tel().localPosition.z;
    const t = s.fly(1.5, { ...neutral, speed: 1, pitch: 0.5 });
    expect(t.localVelocity.z).toBeGreaterThan(0);
    expect(t.localPosition.z).toBeGreaterThan(z0 + 0.3);
    expect(t.localVelocity.x).toBeGreaterThan(1);
  });

  it("turns left (heading increases) with positive yaw", async () => {
    const s = await hovering();
    const p0 = s.psi();
    s.fly(0.5, { ...neutral, yaw: 1 });
    expect(s.psi()).toBeGreaterThan(p0 + 0.3);
  });

  it("brakes to a stop", async () => {
    const s = await hovering();
    s.fly(3, { ...neutral, speed: 1 });
    expect(Math.hypot(s.tel().localVelocity.x, s.tel().localVelocity.y)).toBeGreaterThan(2);
    const t = s.fly(2, { ...neutral, brake: true });
    expect(Math.hypot(t.localVelocity.x, t.localVelocity.y)).toBeLessThan(0.5);
  });

  it("lands and reports landed", async () => {
    const s = await hovering();
    s.assist.land();
    const t = s.fly(6);
    expect(s.last().landed).toBe(true);
    expect(t.localPosition.z).toBeLessThan(0.1);
  });
});
