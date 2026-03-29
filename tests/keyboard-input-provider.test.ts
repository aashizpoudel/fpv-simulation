import { describe, expect, it, vi } from "vitest";

import { KeyboardInputProvider } from "../src/input/keyboard-input-provider";

const fireKeyboardEvent = (type: "keydown" | "keyup", key: string, shiftKey = false) => {
  document.dispatchEvent(new KeyboardEvent(type, { key, shiftKey }));
};

describe("KeyboardInputProvider", () => {
  it("maps keyboard input into normalized controls", () => {
    const callbacks = {
      onReset: vi.fn(),
      onToggleCamera: vi.fn(),
      onToggleArm: vi.fn(),
      onPushBody: vi.fn(),
    };
    const provider = new KeyboardInputProvider({ callbacks });

    provider.init();
    fireKeyboardEvent("keydown", "w");
    fireKeyboardEvent("keydown", " ");
    fireKeyboardEvent("keydown", "m", true);
    fireKeyboardEvent("keydown", "r");

    const controls = provider.read(1);

    expect(controls.thrust).toBe(1);
    expect(controls.speedMultiplier).toBe(2);
    expect(controls.arm).toBe(true);
    expect(controls.reset).toBe(true);
    expect(callbacks.onReset).toHaveBeenCalledTimes(1);
    expect(callbacks.onToggleArm).toHaveBeenCalledTimes(1);

    fireKeyboardEvent("keyup", "w");
    fireKeyboardEvent("keyup", " ");
    fireKeyboardEvent("keyup", "m");
    fireKeyboardEvent("keyup", "r");

    const neutral = provider.read(1);
    expect(neutral.thrust).toBe(0);
    expect(neutral.speedMultiplier).toBe(1);
    expect(neutral.reset).toBe(false);

    provider.dispose();
  });
});
