import type { Controls } from "../types";
import {
  createNeutralControls,
  type InputActionCallbacks,
  type InputProvider,
} from "./input-provider";
import { InputMapper, type InputMapperOptions } from "./input-mapper";
import type { GamepadAxisMapping, GamepadCalibration } from "./gamepad-calibration";

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
  private prevButtons: boolean[] = [];
  private armed = false;
  private resetPending = false;

  constructor(options: GamepadInputProviderOptions) {
    this.callbacks = options.callbacks;
    this.gamepadIndex = options.gamepadIndex;
    this.calibration = options.calibration;
    this.mapper = new InputMapper(options.mapperOptions);
  }

  init(): void {}

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

    this.handleButtons(pad.buttons);

    const mapped = this.mapper.mapAxes({
      thrust: throttle,
      yaw,
      pitch,
      roll,
    });

    this.controls.thrust = mapped.thrust;
    this.controls.pitch = mapped.pitch;
    this.controls.roll = mapped.roll;
    this.controls.yaw = mapped.yaw;
    this.controls.speedMultiplier = 1;
    this.controls.arm = this.armed;
    this.controls.reset = this.resetPending;
    this.resetPending = false;

    return this.controls;
  }

  dispose(): void {}

  private getAxisValue(axes: readonly number[], mapping: GamepadAxisMapping): number {
    const value = axes[mapping.index] ?? 0;
    return mapping.inverted ? -value : value;
  }

  private handleButtons(buttons: readonly GamepadButton[]): void {
    const current = buttons.map((button) => Boolean(button?.pressed));

    this.handleRisingEdge(current, this.calibration.buttons.arm, () => {
      this.armed = !this.armed;
      this.callbacks.onToggleArm?.();
    });

    this.handleRisingEdge(current, this.calibration.buttons.reset, () => {
      this.resetPending = true;
      this.callbacks.onReset();
    });

    if (this.calibration.buttons.camera !== undefined) {
      this.handleRisingEdge(current, this.calibration.buttons.camera, () => {
        this.callbacks.onToggleCamera();
      });
    }

    if (this.calibration.buttons.mode !== undefined) {
      this.handleRisingEdge(current, this.calibration.buttons.mode, () => {
        this.callbacks.onSwitchFlightMode?.();
      });
    }

    this.prevButtons = current;
  }

  private handleRisingEdge(current: boolean[], index: number, onRise: () => void): void {
    const pressed = current[index] ?? false;
    const wasPressed = this.prevButtons[index] ?? false;
    if (pressed && !wasPressed) {
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
    this.controls.pitch = mapped.pitch;
    this.controls.roll = mapped.roll;
    this.controls.yaw = mapped.yaw;
    this.controls.speedMultiplier = 1;
    this.controls.arm = this.armed;
    this.controls.reset = false;
    this.prevButtons = [];
    this.resetPending = false;

    return this.controls;
  }
}
