import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupWelcomeGamepadStatus } from "../src/ui/welcome-gamepad-status";

const html = readFileSync("index.html", "utf8");
let pads: (Gamepad | null)[] = [];
let dispose: () => void = () => {};

const status = () => document.getElementById("welcomeGamepadStatus")!.textContent;
const button = () => document.getElementById("welcomeGamepadBtn") as HTMLButtonElement;
const pad = (index: number) => ({ index, id: `pad-${index}` }) as Gamepad;
const gamepadEvent = (type: string, gamepad: Gamepad) =>
  Object.assign(new Event(type), { gamepad }) as GamepadEvent;

beforeEach(() => {
  const page = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = page.body.innerHTML;
  pads = [];
  vi.stubGlobal("navigator", { ...navigator, getGamepads: () => pads });
});

afterEach(() => {
  dispose();
  vi.unstubAllGlobals();
});

describe("welcome gamepad status", () => {
  it("shows not detected with a detect button when no gamepad is present", () => {
    dispose = setupWelcomeGamepadStatus();
    expect(status()).toBe("Gamepad not detected");
    expect(button().textContent).toBe("Detect gamepad");
  });

  it("shows detected with a reset button when a gamepad is already present", () => {
    pads = [null, pad(1)];
    dispose = setupWelcomeGamepadStatus();
    expect(status()).toBe("Gamepad detected");
    expect(button().textContent).toBe("Reset gamepad detection");
  });

  it("detects on click, resets on the next click, and explains when none is found", () => {
    dispose = setupWelcomeGamepadStatus();
    button().click();
    expect(status()).toContain("press any button");

    pads = [pad(0)];
    button().click();
    expect(status()).toBe("Gamepad detected");
    expect(button().textContent).toBe("Reset gamepad detection");

    button().click();
    expect(status()).toBe("Gamepad not detected");
    expect(button().textContent).toBe("Detect gamepad");
  });

  it("follows connect and disconnect events", () => {
    dispose = setupWelcomeGamepadStatus();
    pads = [pad(0)];
    window.dispatchEvent(gamepadEvent("gamepadconnected", pad(0)));
    expect(status()).toBe("Gamepad detected");

    pads = [];
    window.dispatchEvent(gamepadEvent("gamepaddisconnected", pad(0)));
    expect(status()).toBe("Gamepad not detected");
  });
});
