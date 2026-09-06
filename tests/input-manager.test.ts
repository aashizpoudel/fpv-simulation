import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CALIBRATION, saveCalibration } from "../src/input/gamepad-calibration";
import { InputManager } from "../src/input/input-manager";

function createGamepad(): Gamepad {
  return {
    axes: [0, 0, 0, 0, 0, 0],
    buttons: Array.from({ length: 8 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    })),
    connected: true,
    hapticActuators: [],
    id: "test-gamepad",
    index: 0,
    mapping: "standard",
    timestamp: 0,
    vibrationActuator: null,
  } as unknown as Gamepad;
}

describe("InputManager", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps keyboard shortcuts active while the gamepad controls flight", async () => {
    const gamepad = createGamepad();
    let pads: (Gamepad | null)[] = [];
    vi.stubGlobal("navigator", { getGamepads: () => pads });
    saveCalibration({ ...DEFAULT_CALIBRATION, gamepadId: gamepad.id });

    const onToggleCamera = vi.fn();
    const onSwitchFlightMode = vi.fn();
    const onInputSourceChanged = vi.fn();
    const manager = new InputManager({
      callbacks: {
        onReset: vi.fn(),
        onToggleCamera,
        onSwitchFlightMode,
        onInputSourceChanged,
      },
    });

    manager.init();
    pads = [gamepad];
    expect(manager.detectGamepad()).toBe(true);
    await expect(manager.useGamepad()).resolves.toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));

    expect(onToggleCamera).toHaveBeenCalledTimes(1);
    expect(onSwitchFlightMode).toHaveBeenCalledTimes(1);
    expect(onInputSourceChanged).toHaveBeenLastCalledWith("gamepad");

    manager.useKeyboard();
    expect(onInputSourceChanged).toHaveBeenLastCalledWith("keyboard");
    manager.dispose();
  });

  it("reports gamepad availability when detection is retried", () => {
    let pads: (Gamepad | null)[] = [];
    vi.stubGlobal("navigator", { getGamepads: () => pads });
    const onGamepadAvailabilityChanged = vi.fn();
    const manager = new InputManager({
      callbacks: {
        onReset: vi.fn(),
        onToggleCamera: vi.fn(),
        onGamepadAvailabilityChanged,
      },
    });

    manager.init();
    expect(manager.detectGamepad()).toBe(false);
    expect(onGamepadAvailabilityChanged).toHaveBeenLastCalledWith(false);

    pads = [createGamepad()];
    expect(manager.detectGamepad()).toBe(true);
    expect(onGamepadAvailabilityChanged).toHaveBeenLastCalledWith(true);
    manager.dispose();
  });
});
