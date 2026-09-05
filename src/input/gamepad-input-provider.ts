import type { Controls } from "../types";
import {
  createNeutralControls,
  type InputActionCallbacks,
  type InputProvider,
} from "./input-provider";
import { InputMapper, type InputMapperOptions } from "./input-mapper";
import {
  isBindingPressed,
  type GamepadAxisMapping,
  type GamepadButtonBinding,
  type GamepadCalibration,
} from "./gamepad-calibration";

type GamepadInputProviderOptions = {
  callbacks: InputActionCallbacks;
  gamepadIndex: number;
  calibration: GamepadCalibration;
  mapperOptions?: InputMapperOptions;
};

export class GamepadInputProvider implements InputProvider {
  private readonly callbacks: InputActionCallbacks;
  private readonly gamepadIndex: number;
  private readonly calibration: GamepadCalibration;
  private readonly mapper: InputMapper;
  private controls: Controls = createNeutralControls();
  private prevActionStates: Record<string, boolean> = {};
  private armed = false;
  private resetPending = false;

  constructor(options: GamepadInputProviderOptions) {
    this.callbacks = options.callbacks;
    this.gamepadIndex = options.gamepadIndex;
    this.calibration = options.calibration;
    this.mapper = new InputMapper(options.mapperOptions);
  }

  init(): void {
    this.armed = false;
    this.prevActionStates = {};
  }

  read(dt: number): Controls {
    const pads =
      typeof navigator !== "undefined" && typeof navigator.getGamepads === "function"
        ? navigator.getGamepads()
        : undefined;

    const pad = pads?.[this.gamepadIndex];
    if (!pad) {
      return this.readRest();
    }

    const throttle = this.getAxisValue(pad.axes, this.calibration.axes.throttle);
    const yaw = this.getAxisValue(pad.axes, this.calibration.axes.yaw);
    const pitch = this.getAxisValue(pad.axes, this.calibration.axes.pitch);
    const roll = this.getAxisValue(pad.axes, this.calibration.axes.roll);

    this.handleButtons(pad.buttons, pad.axes, throttle);

    const mapped = this.mapper.mapAxes({
      thrust: throttle,
      yaw,
      pitch,
      roll,
    });

    this.controls.thrust = mapped.thrust;
    this.controls.throttle = (throttle + 1) / 2;
    this.controls.pitch = mapped.pitch;
    this.controls.roll = mapped.roll;
    this.controls.yaw = mapped.yaw;
    this.controls.speedMultiplier = 1;
    this.controls.arm = this.armed;
    this.controls.reset = this.resetPending;
    this.resetPending = false;

    return this.controls;
  }

  dispose(): void { this.armed = false; }

  private getAxisValue(axes: readonly number[], mapping: GamepadAxisMapping): number {
    const value = axes[mapping.index] ?? 0;
    return mapping.inverted ? -value : value;
  }

  private handleButtons(
    buttons: readonly GamepadButton[],
    axes: readonly number[],
    throttle: number,
  ): void {
    this.handleAction("arm", this.calibration.buttons.arm, buttons, axes, () => {
      // Full-down throttle is -1 after calibration.
      if (this.armed || throttle < -0.8) this.armed = !this.armed;
      this.callbacks.onToggleArm?.();
    });

    this.handleAction("reset", this.calibration.buttons.reset, buttons, axes, () => {
      this.armed = false;
      this.resetPending = true;
      this.callbacks.onReset();
    });

    if (this.calibration.buttons.camera !== undefined) {
      this.handleAction("camera", this.calibration.buttons.camera, buttons, axes, () => {
        this.callbacks.onToggleCamera();
      });
    }

    if (this.calibration.buttons.mode !== undefined) {
      this.handleAction("mode", this.calibration.buttons.mode, buttons, axes, () => {
        this.callbacks.onSwitchFlightMode?.();
      });
    }
  }

  private handleAction(
    key: string,
    binding: GamepadButtonBinding | undefined,
    buttons: readonly GamepadButton[],
    axes: readonly number[],
    onRise: () => void,
  ): void {
    if (binding === undefined) return;
    const isPressed = isBindingPressed(binding, buttons, axes);
    const wasPressed = this.prevActionStates[key] ?? false;
    this.prevActionStates[key] = isPressed;
    if (isPressed && !wasPressed) {
      onRise();
    }
  }

  private readRest(): Controls {
    const mapped = this.mapper.mapAxes({
      thrust: 0,
      yaw: 0,
      pitch: 0,
      roll: 0,
    });

    this.controls.thrust = mapped.thrust;
    this.controls.throttle = 0;
    this.armed = false;
    this.controls.pitch = mapped.pitch;
    this.controls.roll = mapped.roll;
    this.controls.yaw = mapped.yaw;
    this.controls.speedMultiplier = 1;
    this.controls.arm = this.armed;
    this.controls.reset = false;
    this.prevActionStates = {};
    this.resetPending = false;

    return this.controls;
  }
}
