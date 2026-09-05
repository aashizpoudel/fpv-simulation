import { afterEach, expect, it, vi } from "vitest";
import { GamepadInputProvider } from "../src/input/gamepad-input-provider";
import { DEFAULT_CALIBRATION } from "../src/input/gamepad-calibration";

afterEach(() => vi.unstubAllGlobals());
it("maps radio throttle absolutely, blocks high-throttle arming, and disarms on disconnect", () => {
  const pad = {
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 8 }, () => ({ pressed: false, value: 0 })),
  };
  let connected = true;
  vi.stubGlobal("navigator", { getGamepads: () => connected ? [pad] : [] });
  const provider = new GamepadInputProvider({
    gamepadIndex: 0, calibration: DEFAULT_CALIBRATION,
    callbacks: { onReset: vi.fn(), onToggleCamera: vi.fn() },
  });
  provider.init();
  pad.buttons[4].pressed = true;
  expect(provider.read(1 / 60).arm).toBe(false);
  pad.buttons[4].pressed = false;
  provider.read(1 / 60);
  pad.axes[1] = 1; // Inverted throttle: fully down.
  pad.buttons[4].pressed = true;
  expect(provider.read(1 / 60).arm).toBe(true);
  pad.axes[1] = -0.48;
  expect(provider.read(1 / 60).throttle).toBe(0.74);
  expect(provider.read(1 / 30).throttle).toBe(0.74);
  connected = false;
  const result = provider.read(1 / 60);
  expect(result.arm).toBe(false);
  expect(result.throttle).toBe(0);
});
