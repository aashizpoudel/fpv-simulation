import type { Controls } from "../types";
import {
  createNeutralControls,
  type InputActionCallbacks,
  type InputProvider,
} from "./input-provider";

export type XrControllerInputProviderOptions = {
  callbacks: InputActionCallbacks;
  getInputSources: () => Iterable<XRInputSource> | null;
  deadzone?: number;
  expo?: number;
};

// "xr-standard" gamepad mapping.
const AXIS_STICK_X = 2;
const AXIS_STICK_Y = 3; // up is negative
const BTN_A_OR_X = 4;
const BTN_B_OR_Y = 5;

/** Below this absolute throttle (0..1) arming is allowed (matches gamepad: raw < -0.8). */
const ARM_THROTTLE_MAX = 0.1;

type Hand = { axisX: number; axisY: number; a: boolean; b: boolean };

const NEUTRAL_HAND: Hand = { axisX: 0, axisY: 0, a: false, b: false };

/**
 * Meta Quest Touch controllers, mode 2: left stick = throttle (Y) / yaw (X),
 * right stick = pitch (Y) / roll (X). Touch sticks spring to center, so
 * throttle is absolute: center = 50%, full up = 100%.
 * Buttons: right B arm toggle, right A reset, left Y flight mode, left X recording.
 */
export class XrControllerInputProvider implements InputProvider {
  private readonly callbacks: InputActionCallbacks;
  private readonly getInputSources: () => Iterable<XRInputSource> | null;
  private readonly deadzone: number;
  private readonly expo: number;
  private controls: Controls = createNeutralControls();
  private prev: Record<string, boolean> = {};
  private armed = false;
  private resetPending = false;

  constructor(options: XrControllerInputProviderOptions) {
    this.callbacks = options.callbacks;
    this.getInputSources = options.getInputSources;
    this.deadzone = options.deadzone ?? 0.08;
    this.expo = options.expo ?? 0;
  }

  init(): void {
    this.armed = false;
    this.prev = {};
    this.resetPending = false;
  }

  read(_dt: number): Controls {
    const hands = this.findHands();
    if (!hands.left && !hands.right) return this.readRest();

    const left = hands.left ?? NEUTRAL_HAND;
    const right = hands.right ?? NEUTRAL_HAND;

    // Stick up is negative; up = more throttle (same polarity as the radio throttle axis).
    const throttleRaw = this.applyDeadzone(-left.axisY);
    this.handleButtons(left, right, throttleRaw);

    this.controls.thrust = throttleRaw;
    this.controls.throttle = (throttleRaw + 1) / 2;
    // Matches DEFAULT_CALIBRATION: pitch = raw axis (forward/up = negative),
    // roll = raw axis, yaw inverted.
    this.controls.pitch = this.shape(right.axisY);
    this.controls.roll = this.shape(right.axisX);
    this.controls.yaw = this.shape(-left.axisX);
    this.controls.speedMultiplier = 1;
    this.controls.arm = this.armed;
    this.controls.reset = this.resetPending;
    this.resetPending = false;
    return this.controls;
  }

  dispose(): void {
    this.armed = false;
    this.prev = {};
    this.resetPending = false;
  }

  private findHands(): { left?: Hand; right?: Hand } {
    const out: { left?: Hand; right?: Hand } = {};
    const sources = this.getInputSources();
    if (!sources) return out;
    for (const source of sources) {
      const pad = source.gamepad;
      if (!pad) continue;
      if (source.handedness !== "left" && source.handedness !== "right") continue;
      out[source.handedness] = {
        axisX: pad.axes[AXIS_STICK_X] ?? 0,
        axisY: pad.axes[AXIS_STICK_Y] ?? 0,
        a: this.isPressed(pad.buttons[BTN_A_OR_X]),
        b: this.isPressed(pad.buttons[BTN_B_OR_Y]),
      };
    }
    return out;
  }

  private isPressed(button: GamepadButton | undefined): boolean {
    return Boolean(button?.pressed || (button?.value ?? 0) > 0.45);
  }

  private handleButtons(left: Hand, right: Hand, throttleRaw: number): void {
    this.onRise("arm", right.b, () => {
      // Disarm always; arm only with throttle below 10% (raw < -0.8).
      if (this.armed || (throttleRaw + 1) / 2 < ARM_THROTTLE_MAX) this.armed = !this.armed;
      this.callbacks.onToggleArm?.();
    });
    this.onRise("reset", right.a, () => {
      this.armed = false;
      this.resetPending = true;
      this.callbacks.onReset();
    });
    this.onRise("mode", left.b, () => this.callbacks.onSwitchFlightMode?.());
    this.onRise("record", left.a, () => this.callbacks.onToggleRecording?.());
  }

  private onRise(key: string, pressed: boolean, fn: () => void): void {
    const was = this.prev[key] ?? false;
    this.prev[key] = pressed;
    if (pressed && !was) fn();
  }

  private applyDeadzone(v: number): number {
    const a = Math.abs(v);
    if (a < this.deadzone) return 0;
    const scaled = (a - this.deadzone) / (1 - this.deadzone);
    return Math.sign(v) * Math.min(1, scaled);
  }

  private shape(v: number): number {
    const d = this.applyDeadzone(v);
    return (1 - this.expo) * d + this.expo * d * d * d;
  }

  private readRest(): Controls {
    this.armed = false;
    this.prev = {};
    this.resetPending = false;
    this.controls.thrust = 0;
    this.controls.throttle = 0;
    this.controls.pitch = 0;
    this.controls.roll = 0;
    this.controls.yaw = 0;
    this.controls.speedMultiplier = 1;
    this.controls.arm = false;
    this.controls.reset = false;
    return this.controls;
  }
}
