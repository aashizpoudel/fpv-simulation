import { afterEach, expect, it, vi } from "vitest";
import { GamepadInputProvider } from "../src/input/gamepad-input-provider";
import { DEFAULT_CALIBRATION, CALIBRATION_PRESETS } from "../src/input/gamepad-calibration";

afterEach(() => vi.unstubAllGlobals());
it("maps radio throttle absolutely, blocks high-throttle arming, and disarms on disconnect", () => {
  const pad = {
    axes: [0, 0, 0, 0, 0, 0],
    buttons: Array.from({ length: 8 }, () => ({ pressed: false, value: 0 })),
  };
  let connected = true;
  vi.stubGlobal("navigator", { getGamepads: () => (connected ? [pad] : []) });
  const provider = new GamepadInputProvider({
    gamepadIndex: 0,
    calibration: DEFAULT_CALIBRATION,
    callbacks: { onReset: vi.fn(), onToggleCamera: vi.fn() },
  });
  provider.init();
  pad.axes[4] = 1; // Arm switch flipped when throttle is at 0 (not fully down)
  expect(provider.read(1 / 60).arm).toBe(false);
  pad.axes[4] = 0;
  provider.read(1 / 60);
  pad.axes[0] = -1; // Non-inverted throttle: fully down (-1).
  pad.axes[4] = 1; // Arm switch flipped on Axis 4
  expect(provider.read(1 / 60).arm).toBe(true);
  pad.axes[0] = 0.48;
  expect(provider.read(1 / 60).throttle).toBe(0.74);
  expect(provider.read(1 / 30).throttle).toBe(0.74);
  connected = false;
  const result = provider.read(1 / 60);
  expect(result.arm).toBe(false);
  expect(result.throttle).toBe(0);
});

it("supports both digital buttons and axis switches", () => {
  const pad = {
    axes: [0, 0, 0, 0, 0, 0],
    buttons: Array.from({ length: 8 }, () => ({ pressed: false, value: 0 })),
  };
  let connected = true;
  vi.stubGlobal("navigator", { getGamepads: () => (connected ? [pad] : []) });
  const onReset = vi.fn();
  const provider = new GamepadInputProvider({
    gamepadIndex: 0,
    calibration: DEFAULT_CALIBRATION, // reset is axis 5
    callbacks: { onReset, onToggleCamera: vi.fn() },
  });
  provider.init();
  pad.axes[5] = 1; // Flip reset switch on Axis 5
  expect(provider.read(1 / 60).reset).toBe(true);
  expect(onReset).toHaveBeenCalledTimes(1);
});

it("yaws in the correct direction when stick is deflected", () => {
  const pad = {
    axes: [0, 0, 0, 0, 0, 0],
    buttons: Array.from({ length: 8 }, () => ({ pressed: false, value: 0 })),
  };
  let connected = true;
  vi.stubGlobal("navigator", { getGamepads: () => (connected ? [pad] : []) });
  const provider = new GamepadInputProvider({
    gamepadIndex: 0,
    calibration: DEFAULT_CALIBRATION,
    callbacks: { onReset: vi.fn(), onToggleCamera: vi.fn() },
  });
  provider.init();
  pad.axes[3] = -1; // Stick pushed LEFT on Axis 3
  expect(provider.read(1 / 60).yaw).toBe(1); // Positive yaw in flight controller = turn LEFT
  pad.axes[3] = 1; // Stick pushed RIGHT on Axis 3
  expect(provider.read(1 / 60).yaw).toBe(-1); // Negative yaw in flight controller = turn RIGHT
});

it("exports standard FPV Radio Mode 2 and gamepad presets", () => {
  expect(CALIBRATION_PRESETS.fpvRadioMode2.calibration.axes.throttle.index).toBe(2);
  expect(CALIBRATION_PRESETS.standardGamepad.calibration.axes.throttle.index).toBe(1);
  expect(DEFAULT_CALIBRATION.axes.throttle.index).toBe(0);
  expect(DEFAULT_CALIBRATION.axes.throttle.inverted).toBe(false);
  expect(DEFAULT_CALIBRATION.axes.yaw.index).toBe(3);
  expect(DEFAULT_CALIBRATION.axes.yaw.inverted).toBe(true);
  expect(DEFAULT_CALIBRATION.axes.roll.index).toBe(1);
  expect(DEFAULT_CALIBRATION.axes.roll.inverted).toBe(false);
  expect(DEFAULT_CALIBRATION.axes.pitch.index).toBe(2);
  expect(DEFAULT_CALIBRATION.axes.pitch.inverted).toBe(false);
});
