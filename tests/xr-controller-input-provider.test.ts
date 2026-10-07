import { describe, expect, it, vi } from "vitest";

import { XrControllerInputProvider } from "../src/input/xr-controller-input-provider";

type Pad = { x?: number; y?: number; pressed?: number[] };

function source(hand: "left" | "right", pad: Pad = {}): XRInputSource {
  const buttons = Array.from({ length: 6 }, (_, i) => ({
    pressed: pad.pressed?.includes(i) ?? false,
    touched: false,
    value: pad.pressed?.includes(i) ? 1 : 0,
  }));
  return {
    handedness: hand,
    gamepad: { axes: [0, 0, pad.x ?? 0, pad.y ?? 0], buttons },
  } as unknown as XRInputSource;
}

function setup(opts: { deadzone?: number; expo?: number } = {}) {
  let sources: XRInputSource[] | null = [];
  const callbacks = {
    onReset: vi.fn(),
    onToggleCamera: vi.fn(),
    onToggleArm: vi.fn(),
    onSwitchFlightMode: vi.fn(),
    onToggleRecording: vi.fn(),
  };
  const provider = new XrControllerInputProvider({
    callbacks,
    getInputSources: () => sources,
    ...opts,
  });
  provider.init();
  return { provider, callbacks, set: (s: XRInputSource[] | null) => (sources = s) };
}

describe("XrControllerInputProvider", () => {
  it("maps sticks with gamepad sign conventions", () => {
    const t = setup();
    t.set([source("left", { x: 0.5, y: -1 }), source("right", { x: 0.5, y: -1 })]);
    const c = t.provider.read(0.016);
    expect(c.throttle).toBeCloseTo(1);
    expect(c.thrust).toBeCloseTo(1);
    expect(c.yaw).toBeLessThan(0);
    expect(c.roll).toBeGreaterThan(0);
    expect(c.pitch).toBeLessThan(0);
  });

  it("centered throttle is 0.5 and full down is 0", () => {
    const t = setup();
    t.set([source("left"), source("right")]);
    const c = t.provider.read(0.016);
    expect(c.throttle).toBeCloseTo(0.5);
    expect(c.thrust).toBe(0);
    t.set([source("left", { y: 1 }), source("right")]);
    expect(t.provider.read(0.016).throttle).toBeCloseTo(0);
  });

  it("applies deadzone with rescale and expo", () => {
    const t = setup({ deadzone: 0.2, expo: 1 });
    t.set([source("left"), source("right", { x: 0.1, y: 0.6 })]);
    let c = t.provider.read(0.016);
    expect(c.roll).toBe(0);
    expect(c.pitch).toBeCloseTo(0.5 ** 3);
    const t2 = setup({ deadzone: 0.2 });
    t2.set([source("left"), source("right", { x: 0.6 })]);
    c = t2.provider.read(0.016);
    expect(c.roll).toBeCloseTo(0.5);
  });

  it("arms only at low throttle, disarms always", () => {
    const t = setup();
    t.set([source("left"), source("right", { pressed: [5] })]);
    expect(t.provider.read(0.016).arm).toBe(false);
    t.set([source("left", { y: 1 }), source("right")]);
    t.provider.read(0.016);
    t.set([source("left", { y: 1 }), source("right", { pressed: [5] })]);
    expect(t.provider.read(0.016).arm).toBe(true);
    t.set([source("left"), source("right")]);
    t.provider.read(0.016);
    t.set([source("left"), source("right", { pressed: [5] })]);
    expect(t.provider.read(0.016).arm).toBe(false);
  });

  it("reset pulses for one read and disarms", () => {
    const t = setup();
    t.set([source("left", { y: 1 }), source("right", { pressed: [5] })]);
    expect(t.provider.read(0.016).arm).toBe(true);
    t.set([source("left", { y: 1 }), source("right", { pressed: [4] })]);
    const c = t.provider.read(0.016);
    expect(c.reset).toBe(true);
    expect(c.arm).toBe(false);
    expect(t.callbacks.onReset).toHaveBeenCalledTimes(1);
    expect(t.provider.read(0.016).reset).toBe(false);
    expect(t.callbacks.onReset).toHaveBeenCalledTimes(1);
  });

  it("mode and record fire once per press", () => {
    const t = setup();
    t.set([source("left", { pressed: [5, 4] }), source("right")]);
    t.provider.read(0.016);
    t.provider.read(0.016);
    expect(t.callbacks.onSwitchFlightMode).toHaveBeenCalledTimes(1);
    expect(t.callbacks.onToggleRecording).toHaveBeenCalledTimes(1);
    t.set([source("left"), source("right")]);
    t.provider.read(0.016);
    t.set([source("left", { pressed: [5] }), source("right")]);
    t.provider.read(0.016);
    expect(t.callbacks.onSwitchFlightMode).toHaveBeenCalledTimes(2);
    expect(t.callbacks.onToggleCamera).not.toHaveBeenCalled();
  });

  it("returns neutral and disarms when controllers disappear", () => {
    const t = setup();
    t.set([source("left", { y: 1 }), source("right", { pressed: [5] })]);
    expect(t.provider.read(0.016).arm).toBe(true);
    t.set(null);
    const c = t.provider.read(0.016);
    expect(c).toMatchObject({ arm: false, thrust: 0, pitch: 0, roll: 0, yaw: 0, throttle: 0 });
    t.set([source("left", { y: 1 })]);
    expect(t.provider.read(0.016).arm).toBe(false);
  });
});
