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
import { createNeutralControls } from "./input-provider";

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
  private gamepadIndex: number;
  private readonly mapperOptions?: InputMapperOptions;
  private calibrating = false;
  private userPrefersKeyboard = false;

  private readonly handleConnect = (event: GamepadEvent) => {
    this.callbacks.onGamepadAvailabilityChanged?.(true);
    if (this.userPrefersKeyboard) return;
    this.activateGamepad(event.gamepad.index, event.gamepad).catch(() => {
      this.switchToKeyboard();
    });
  };

  private readonly handleDisconnect = (event: GamepadEvent) => {
    const wasActive =
      this.activeProvider === this.gamepadProvider &&
      event.gamepad.index === this.gamepadIndex;
    if (event.gamepad.index !== this.gamepadIndex) {
      this.notifyGamepadAvailability();
      return;
    }
    this.gamepadProvider?.dispose();
    this.gamepadProvider = undefined;
    if (wasActive) this.switchToKeyboard();
    this.notifyGamepadAvailability();
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
    this.keyboardProvider.setFlightInputEnabled(
      this.activeProvider === this.keyboardProvider,
    );
    this.keyboardProvider.init();
    if (this.activeProvider !== this.keyboardProvider) {
      this.activeProvider.init();
    }
    window.addEventListener("gamepadconnected", this.handleConnect);
    window.addEventListener("gamepaddisconnected", this.handleDisconnect);

    this.notifyGamepadAvailability();
    this.tryAdoptExistingGamepad();
  }

  read(dt: number) {
    if (this.calibrating) return createNeutralControls();
    return this.activeProvider.read(dt);
  }

  dispose(): void {
    window.removeEventListener("gamepadconnected", this.handleConnect);
    window.removeEventListener("gamepaddisconnected", this.handleDisconnect);
    if (this.activeProvider !== this.keyboardProvider) {
      this.activeProvider.dispose();
    }
    this.keyboardProvider.dispose();
    if (
      this.gamepadProvider &&
      this.gamepadProvider !== this.activeProvider
    ) {
      this.gamepadProvider.dispose();
    }
  }

  async recalibrate(): Promise<void> {
    if (this.calibrating) return;

    // Scan for any connected gamepad across all indices
    const pads = navigator.getGamepads?.();
    let targetIndex = this.gamepadIndex;
    let pad: Gamepad | null = pads?.[targetIndex] ?? null;

    if (!pad && pads) {
      for (let i = 0; i < pads.length; i++) {
        if (pads[i]) {
          pad = pads[i];
          targetIndex = i;
          break;
        }
      }
    }

    try {
      const calibration = await this.calibrate(targetIndex);
      const activePads = navigator.getGamepads?.();
      const detectedPad =
        (activePads &&
          (activePads[targetIndex] ||
            Array.from(activePads).find((p) => p != null))) ??
        pad;

      const withId: GamepadCalibration = {
        ...calibration,
        gamepadId:
          calibration.gamepadId || detectedPad?.id || `gamepad-${targetIndex}`,
      };
      saveCalibration(withId);

      if (detectedPad) {
        this.callbacks.onGamepadAvailabilityChanged?.(true);
        await this.useCalibration(detectedPad, withId);
      } else {
        this.callbacks.onGamepadAvailabilityChanged?.(false);
        this.switchToKeyboard();
      }
    } catch (error) {
      if ((error as Error)?.message === "SWITCH_TO_KEYBOARD") {
        this.switchToKeyboard();
        return;
      }
      if (!this.gamepadProvider) {
        this.switchToKeyboard();
      }
      throw error;
    }
  }

  public useKeyboard(): void {
    this.userPrefersKeyboard = true;
    this.switchToKeyboard();
  }

  public async useGamepad(): Promise<boolean> {
    const detected = this.findConnectedGamepad();
    if (!detected) {
      this.callbacks.onGamepadAvailabilityChanged?.(false);
      return false;
    }

    this.userPrefersKeyboard = false;
    this.gamepadIndex = detected.index;
    this.callbacks.onGamepadAvailabilityChanged?.(true);
    await this.activateGamepad(detected.index, detected.pad);
    return this.activeProvider === this.gamepadProvider;
  }

  public detectGamepad(): boolean {
    const available = this.findConnectedGamepad() !== null;
    this.callbacks.onGamepadAvailabilityChanged?.(available);
    return available;
  }

  private switchProvider(newProvider: InputProvider): void {
    if (this.activeProvider === newProvider) return;

    if (this.activeProvider !== this.keyboardProvider) {
      this.activeProvider.dispose();
    }

    const keyboardActive = newProvider === this.keyboardProvider;
    this.keyboardProvider.setFlightInputEnabled(keyboardActive);
    this.activeProvider = newProvider;
    if (!keyboardActive) this.activeProvider.init();
  }

  private switchToKeyboard() {
    this.switchProvider(this.keyboardProvider);
    this.callbacks.onInputSourceChanged?.("keyboard");
  }

  private tryAdoptExistingGamepad() {
    if (this.userPrefersKeyboard) return;
    const detected = this.findConnectedGamepad();
    if (detected) {
      this.activateGamepad(detected.index, detected.pad).catch(() => {
        this.switchToKeyboard();
      });
    }
  }

  private async activateGamepad(index: number, pad?: Gamepad) {
    if (this.calibrating) return;
    const gamepad = pad ?? navigator.getGamepads?.()[index];
    if (!gamepad) return;
    this.gamepadIndex = index;

    let calibration = loadCalibration(gamepad.id);
    if (!calibration) {
      try {
        calibration = await this.calibrate(index);
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

  private async calibrate(index: number): Promise<GamepadCalibration> {
    this.calibrating = true;
    try { return await runCalibrationWizard(index); }
    finally { this.calibrating = false; }
  }

  private findConnectedGamepad(): { index: number; pad: Gamepad } | null {
    const pads = navigator.getGamepads?.();
    if (!pads) return null;

    for (let index = 0; index < pads.length; index++) {
      const pad = pads[index];
      if (pad) return { index, pad };
    }
    return null;
  }

  private notifyGamepadAvailability(): void {
    this.callbacks.onGamepadAvailabilityChanged?.(
      this.findConnectedGamepad() !== null,
    );
  }
}
