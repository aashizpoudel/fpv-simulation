import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const state = { landed: false, lastIntent: null as unknown };

vi.mock("../src/input/motion-assist", () => ({
  MotionAssist: class {
    reset() { calls.push("reset"); }
    takeoff() { calls.push("takeoff"); }
    land() { calls.push("land"); }
    update(intent: unknown) {
      state.lastIntent = intent;
      return { roll: 0.1, pitch: 0.2, yaw: 0.3, throttle: 0.75, landed: state.landed };
    }
  },
}));

import {
  MotionControllerInputProvider,
  motionAnglesFromQuaternions,
  rollToYaw,
} from "../src/input/motion-controller-input-provider";
import { InputManager } from "../src/input/input-manager";
import type { XrControllerPose } from "../src/renderers/renderer-interface";

const deg = (d: number) => (d * Math.PI) / 180;
const quat = (pitchDeg: number, rollDeg: number, yawDeg = 0) => {
  // Aim: yaw about Y, then pitch about X (up), then twist about local Z (+ = tilt left).
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(pitchDeg), deg(yawDeg), deg(rollDeg), "YXZ"));
  return { x: q.x, y: q.y, z: q.z, w: q.w };
};
const ID = quat(0, 0);

type Btns = Record<number, number>;
function pose(q = ID, btns: Btns = {}): XrControllerPose {
  const buttons = Array.from({ length: 6 }, (_, i) => ({
    value: btns[i] ?? 0,
    pressed: (btns[i] ?? 0) > 0.5,
    touched: false,
  }));
  return { quaternion: q, gamepad: { buttons, axes: [] } as unknown as Gamepad };
}

function make(getPose: () => XrControllerPose | null) {
  return new MotionControllerInputProvider({
    callbacks: { onReset: vi.fn(), onToggleCamera: vi.fn() },
    getPose,
    getTelemetry: () => ({}) as never,
    config: {} as never,
  });
}

describe("motion math", () => {
  it("pitching up 30 deg gives ~0.52 rad positive pitch", () => {
    const { pitch } = motionAnglesFromQuaternions(ID, quat(30, 0));
    expect(pitch).toBeCloseTo(0.5236, 3);
    expect(motionAnglesFromQuaternions(ID, quat(-30, 0)).pitch).toBeCloseTo(-0.5236, 3);
  });
  it("clamps pitch to 60 deg", () => {
    expect(motionAnglesFromQuaternions(ID, quat(85, 0)).pitch).toBeCloseTo(deg(60), 5);
  });
  it("tilting left (CCW from behind) gives positive roll and yaw > 0", () => {
    const { roll } = motionAnglesFromQuaternions(ID, quat(0, 20));
    expect(roll).toBeCloseTo(deg(20), 3);
    expect(rollToYaw(roll)).toBeGreaterThan(0);
    expect(rollToYaw(motionAnglesFromQuaternions(ID, quat(0, -20)).roll)).toBeLessThan(0);
  });
  it("roll is independent of pitch", () => {
    expect(motionAnglesFromQuaternions(ID, quat(40, 20)).roll).toBeCloseTo(deg(20), 3);
  });
  it("applies deadzone and clamps at full tilt", () => {
    expect(rollToYaw(deg(4))).toBe(0);
    expect(rollToYaw(deg(35))).toBeCloseTo(1, 6);
    expect(rollToYaw(deg(80))).toBe(1);
    expect(rollToYaw(deg(-80))).toBe(-1);
    expect(rollToYaw(deg(20))).toBeCloseTo(0.5, 6);
  });
  it("is relative to the neutral orientation", () => {
    const n = quat(20, 10, 45);
    const a = motionAnglesFromQuaternions(n, n);
    expect(a.pitch).toBeCloseTo(0, 6);
    expect(a.roll).toBeCloseTo(0, 6);
    expect(motionAnglesFromQuaternions(n, quat(50, 10, 45)).pitch).toBeCloseTo(deg(30), 3);
  });
});

describe("MotionControllerInputProvider", () => {
  beforeEach(() => {
    calls.length = 0;
    state.landed = false;
    state.lastIntent = null;
  });

  it("is idle until armed; B arms+takeoff, B again lands, landed disarms", () => {
    let p: XrControllerPose | null = pose();
    const m = make(() => p);
    m.init();
    expect(m.read(0.016)).toMatchObject({ throttle: 0, arm: false });
    p = pose(ID, { 5: 1 });
    const c = m.read(0.016);
    expect(calls).toContain("takeoff");
    expect(c).toMatchObject({ arm: true, throttle: 0.75, thrust: 0.5, roll: 0.1, pitch: 0.2, yaw: 0.3 });
    m.read(0.016); // held: no retrigger
    expect(calls.filter((x) => x === "takeoff")).toHaveLength(1);
    p = pose();
    m.read(0.016);
    p = pose(ID, { 5: 1 });
    m.read(0.016);
    expect(calls).toContain("land");
    state.landed = true;
    p = pose();
    expect(m.read(0.016).arm).toBe(false);
    expect(m.read(0.016)).toMatchObject({ throttle: 0, arm: false });
  });

  it("disarms after a crash, then B resets the drone instead of taking off", () => {
    let p: XrControllerPose | null = pose(ID, { 5: 1 });
    let crashed = false;
    const m = new MotionControllerInputProvider({
      callbacks: { onReset: vi.fn(), onToggleCamera: vi.fn() },
      getPose: () => p,
      getTelemetry: () => ({ crashed }) as never,
      config: {} as never,
    });
    expect(m.read(0.016).arm).toBe(true);
    crashed = true;
    p = pose();
    expect(m.read(0.016)).toMatchObject({ arm: false, throttle: 0 });
    expect(calls).toContain("reset");

    calls.length = 0;
    p = pose(ID, { 5: 1 });
    expect(m.read(0.016)).toMatchObject({ arm: false, reset: true });
    expect(calls).not.toContain("takeoff");
    p = pose();
    expect(m.read(0.016).reset).toBe(false);
  });

  it("passes brake and trigger-grip speed, and pitch/yaw intent", () => {
    let p = pose(ID, { 5: 1 });
    const m = make(() => p);
    m.read(0.016);
    p = pose(quat(30, 35), { 0: 1, 1: 0.25, 4: 1 });
    m.read(0.016);
    expect(state.lastIntent).toMatchObject({ speed: 0.75, brake: true });
    const i = state.lastIntent as { pitch: number; yaw: number };
    expect(i.pitch).toBeCloseTo(0.5236, 3);
    expect(i.yaw).toBeCloseTo(1, 5);
  });

  it("recenters on thumbstick press", () => {
    let p = pose(ID, { 5: 1 });
    const m = make(() => p);
    m.read(0.016);
    p = pose(quat(30, 0), { 3: 1 });
    m.read(0.016);
    expect((state.lastIntent as { pitch: number }).pitch).toBeCloseTo(0, 5);
  });

  it("hovers with no pose and lands after 1 s", () => {
    let p: XrControllerPose | null = pose(ID, { 5: 1 });
    const m = make(() => p);
    m.read(0.016);
    p = null;
    m.read(0.5);
    expect(state.lastIntent).toEqual({ speed: 0, pitch: 0, yaw: 0, brake: true });
    expect(calls).not.toContain("land");
    const c = m.read(0.6);
    expect(calls.filter((x) => x === "land")).toHaveLength(1);
    expect(c.arm).toBe(true);
  });
});

describe("InputManager motion", () => {
  it("switches to motion and falls back to keyboard on leave", () => {
    vi.stubGlobal("navigator", { getGamepads: () => [] });
    const onInputSourceChanged = vi.fn();
    const manager = new InputManager({
      callbacks: { onReset: vi.fn(), onToggleCamera: vi.fn(), onInputSourceChanged },
    });
    manager.init();
    manager.useMotionController({ getPose: () => null, getTelemetry: () => ({}) as never, config: {} as never });
    expect(onInputSourceChanged).toHaveBeenLastCalledWith("motion");
    expect(manager.read(0.016).arm).toBe(false);
    manager.leaveXrControllers();
    expect(onInputSourceChanged).toHaveBeenLastCalledWith("keyboard");
    manager.dispose();
    vi.unstubAllGlobals();
  });
});
