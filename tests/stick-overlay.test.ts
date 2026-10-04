import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  isStickOverlayEnabled,
  setStickOverlayEnabled,
  subscribeStickOverlay,
} from "../src/app/crosshair-preferences";

const html = readFileSync("index.html", "utf8");

describe("Gamepad stick overlay", () => {
  let overlayEl: HTMLElement;
  let leftDotEl: HTMLElement;
  let rightDotEl: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
    localStorage.clear();
    overlayEl = document.getElementById("osdStickOverlay")!;
    leftDotEl = document.getElementById("osdLeftStickDot")!;
    rightDotEl = document.getElementById("osdRightStickDot")!;
  });

  it("is present in the DOM with left and right stick dots and default enabled", () => {
    expect(overlayEl).not.toBeNull();
    expect(leftDotEl).not.toBeNull();
    expect(rightDotEl).not.toBeNull();
    expect(isStickOverlayEnabled()).toBe(true);
    expect(overlayEl.classList.contains("show")).toBe(false);
  });

  it("shows when flight is started with gamepad, and hides when toggled off or on keyboard", () => {
    let flightStarted = false;
    let activeInputSource: "keyboard" | "gamepad" = "keyboard";
    let stickOverlayEnabled = isStickOverlayEnabled();

    const updateVisibility = () => {
      overlayEl.classList.toggle("show", flightStarted && activeInputSource === "gamepad" && stickOverlayEnabled);
    };

    const unsubscribe = subscribeStickOverlay((enabled) => {
      stickOverlayEnabled = enabled;
      updateVisibility();
    });

    try {
      // 1. Initial state (before game starts): hidden
      updateVisibility();
      expect(overlayEl.classList.contains("show")).toBe(false);

      // 2. Game starts with keyboard: still hidden
      flightStarted = true;
      activeInputSource = "keyboard";
      updateVisibility();
      expect(overlayEl.classList.contains("show")).toBe(false);

      // 3. User switches to gamepad while in game: visible by default!
      activeInputSource = "gamepad";
      updateVisibility();
      expect(overlayEl.classList.contains("show")).toBe(true);

      // 4. User toggles setting off: hidden
      setStickOverlayEnabled(false);
      expect(overlayEl.classList.contains("show")).toBe(false);

      // 5. User toggles setting back on: visible again
      setStickOverlayEnabled(true);
      expect(overlayEl.classList.contains("show")).toBe(true);

      // 6. User switches back to keyboard: hidden
      activeInputSource = "keyboard";
      updateVisibility();
      expect(overlayEl.classList.contains("show")).toBe(false);
    } finally {
      unsubscribe();
    }
  });

  it("positions stick dots correctly according to controls values", () => {
    const updateDots = (controls: { throttle?: number; thrust: number; yaw: number; pitch: number; roll: number }) => {
      const thr = controls.throttle != null && Number.isFinite(controls.throttle)
        ? controls.throttle
        : Number.isFinite(controls.thrust)
          ? (controls.thrust + 1) / 2
          : 0;
      const yaw = Number.isFinite(controls.yaw) ? controls.yaw : 0;
      const rol = Number.isFinite(controls.roll) ? controls.roll : 0;
      const pit = Number.isFinite(controls.pitch) ? controls.pitch : 0;

      const leftX = Math.max(0, Math.min(100, ((1 - yaw) / 2) * 100));
      const leftY = Math.max(0, Math.min(100, (1 - Math.max(0, Math.min(1, thr))) * 100));
      const rightX = Math.max(0, Math.min(100, ((rol + 1) / 2) * 100));
      const rightY = Math.max(0, Math.min(100, ((1 - pit) / 2) * 100));

      leftDotEl.style.left = `${leftX}%`;
      leftDotEl.style.top = `${leftY}%`;
      rightDotEl.style.left = `${rightX}%`;
      rightDotEl.style.top = `${rightY}%`;
    };

    // Neutral centered sticks with zero throttle:
    // Left: yaw 0 -> 50%, throttle 0 -> 100% (bottom)
    // Right: roll 0 -> 50%, pitch 0 -> 50% (center)
    updateDots({ throttle: 0, thrust: -1, yaw: 0, pitch: 0, roll: 0 });
    expect(leftDotEl.style.left).toBe("50%");
    expect(leftDotEl.style.top).toBe("100%");
    expect(rightDotEl.style.left).toBe("50%");
    expect(rightDotEl.style.top).toBe("50%");

    // Full throttle, full yaw right:
    // Left: yaw -1 -> 100% (right), throttle 1 -> 0% (top)
    updateDots({ throttle: 1, thrust: 1, yaw: -1, pitch: 0, roll: 0 });
    expect(leftDotEl.style.left).toBe("100%");
    expect(leftDotEl.style.top).toBe("0%");

    // Full pitch forward (up) and full roll right:
    // Right: roll 1 -> 100%, pitch 1 -> 0%
    updateDots({ throttle: 0.5, thrust: 0, yaw: 0, pitch: 1, roll: 1 });
    expect(rightDotEl.style.left).toBe("100%");
    expect(rightDotEl.style.top).toBe("0%");

    // Full pitch back (down) and full roll left:
    // Right: roll -1 -> 0%, pitch -1 -> 100%
    updateDots({ throttle: 0.5, thrust: 0, yaw: 0, pitch: -1, roll: -1 });
    expect(rightDotEl.style.left).toBe("0%");
    expect(rightDotEl.style.top).toBe("100%");
  });
});
