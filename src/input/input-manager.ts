import {
  DEFAULT_CALIBRATION,
  loadCalibration,
  saveCalibration,
  type GamepadCalibration,
} from "./gamepad-calibration";
import { GamepadInputProvider } from "./gamepad-input-provider";
import { runCalibrationWizard } from "./gamepad-calibration-wizard";
import { KeyboardInputProvider, type KeyboardInputProviderOptions } from "./keyboard-input-provider";
import type { InputActionCallbacks, InputProvider } from "./input-provider";
import type { InputMapperOptions } from "./input-mapper";

export type InputManagerOptions = {
  callbacks: InputActionCallbacks;
  keyboard?: Omit<KeyboardInputProviderOptions, "callbacks">;
  mapper?: InputMapperOptions;
  gamepadIndex?: number;
};

export class InputManager implements InputProvider {
  private readonly callbacks: InputActionCallbacks;
  private readonly keyboardProvider: KeyboardInputProvider;
  private gamepadProvider?: GamepadInputProvider;
  private activeProvider: InputProvider;
  private readonly gamepadIndex: number;
  private readonly mapperOptions?: InputMapperOptions;

  private readonly handleConnect = (event: GamepadEvent) => {
    if (event.gamepad.index !== this.gamepadIndex) return;
    this.activateGamepad(event.gamepad.index, event.gamepad).catch(() => {
      this.switchToKeyboard();
    });
  };

  private readonly handleDisconnect = (event: GamepadEvent) => {
    if (event.gamepad.index !== this.gamepadIndex) return;
    this.gamepadProvider?.dispose();
    this.gamepadProvider = undefined;
    this.switchToKeyboard();
  };

  constructor(options: InputManagerOptions) {
    this.callbacks = options.callbacks;
    this.gamepadIndex = options.gamepadIndex ?? 0;
    this.mapperOptions = options.mapper;

    this.keyboardProvider = new KeyboardInputProvider({
      callbacks: this.callbacks,
      ...options.keyboard,
    });

    this.activeProvider = this.keyboardProvider;
  }

  init(): void {
    this.activeProvider.init();
    window.addEventListener("gamepadconnected", this.handleConnect);
    window.addEventListener("gamepaddisconnected", this.handleDisconnect);

    this.tryAdoptExistingGamepad();
  }

  read(dt: number) {
    return this.activeProvider.read(dt);
  }

  dispose(): void {
    window.removeEventListener("gamepadconnected", this.handleConnect);
    window.removeEventListener("gamepaddisconnected", this.handleDisconnect);
    this.activeProvider.dispose();
    if (this.activeProvider !== this.keyboardProvider) {
      this.keyboardProvider.dispose();
    }
    this.gamepadProvider?.dispose();
  }

  async recalibrate(): Promise<void> {
    const pad = navigator.getGamepads?.()[this.gamepadIndex];
    if (!pad) {
      this.switchToKeyboard();
      return;
    }

    const calibration = await runCalibrationWizard(this.gamepadIndex);
    const withId: GamepadCalibration = {
      ...calibration,
      gamepadId: calibration.gamepadId || pad.id || `gamepad-${this.gamepadIndex}`,
    };
    saveCalibration(withId);
    await this.useCalibration(pad, withId);
  }

  switchProvider(newProvider: InputProvider): void {
    if (this.activeProvider === newProvider) return;
    this.activeProvider.dispose();
    this.activeProvider = newProvider;
    this.activeProvider.init();
  }

  private switchToKeyboard() {
    this.switchProvider(this.keyboardProvider);
    this.callbacks.onInputSourceChanged?.("keyboard");
  }

  private tryAdoptExistingGamepad() {
    const pad = navigator.getGamepads?.()[this.gamepadIndex];
    if (pad) {
      this.activateGamepad(this.gamepadIndex, pad).catch(() => {
        this.switchToKeyboard();
      });
    }
  }

  private async activateGamepad(index: number, pad?: Gamepad) {
    const gamepad = pad ?? navigator.getGamepads?.()[index];
    if (!gamepad) return;

    let calibration = loadCalibration(gamepad.id);
    if (!calibration) {
      try {
        calibration = await runCalibrationWizard(index);
      } catch {
        this.switchToKeyboard();
        return;
      }
    }

    const withId: GamepadCalibration = {
      ...DEFAULT_CALIBRATION,
      ...calibration,
      gamepadId: calibration.gamepadId || gamepad.id || `gamepad-${index}`,
    };
    saveCalibration(withId);
    await this.useCalibration(gamepad, withId);
  }

  private async useCalibration(gamepad: Gamepad, calibration: GamepadCalibration) {
    const provider = new GamepadInputProvider({
      callbacks: this.callbacks,
      gamepadIndex: gamepad.index,
      calibration,
      mapperOptions: this.mapperOptions,
    });

    this.gamepadProvider?.dispose();
    this.gamepadProvider = provider;
    this.switchProvider(provider);
    this.callbacks.onInputSourceChanged?.("gamepad");
  }
}
