import type { Controls } from "../types";
import {
  createNeutralControls,
  type InputActionCallbacks,
  type InputMapping,
  type InputProvider,
  type InputSmoothing,
} from "./input-provider";
import { InputMapper, type InputMapperOptions } from "./input-mapper";

export type KeyboardInputProviderOptions = {
  callbacks: InputActionCallbacks;
  mapping?: Partial<InputMapping>;
  smoothing?: Partial<InputSmoothing>;
  mapper?: InputMapperOptions;
  speedBoostMultiplier?: number;
};

const DEFAULT_MAPPING: InputMapping = {
  thrustPositive: ["w"],
  thrustNegative: ["s"],
  pitchPositive: ["arrowup"],
  pitchNegative: ["arrowdown"],
  rollPositive: ["arrowright"],
  rollNegative: ["arrowleft"],
  yawPositive: ["a"],
  yawNegative: ["d"],
  speedBoost: " ",
};

const DEFAULT_SMOOTHING: InputSmoothing = {
  thrustRate: 8,
  stickRate: 0.5,
  yawRate: 0.5,
  deadzone: 0.02,
};

export class KeyboardInputProvider implements InputProvider {
  private callbacks: InputActionCallbacks;
  private mapping: InputMapping;
  private smoothing: InputSmoothing;
  private inputMapper: InputMapper;
  private speedBoostMultiplier: number;
  private controls: Controls = createNeutralControls();
  private keys: Record<string, boolean> = {};
  private axis = { thrust: 0, pitch: 0, roll: 0, yaw: 0 };
  private resetPending = false;
  private armed = false;
  private flightInputEnabled = true;
  private initialized = false;
  private handleKeyDown: (event: KeyboardEvent) => void;
  private handleKeyUp: (event: KeyboardEvent) => void;
  private clearInput = () => {
    this.keys = {};
    this.axis = { thrust: 0, pitch: 0, roll: 0, yaw: 0 };
    this.armed = false;
  };

  constructor(options: KeyboardInputProviderOptions) {
    this.callbacks = options.callbacks;
    this.mapping = {
      thrustPositive: this.normalizeKeys(
        options.mapping?.thrustPositive ?? DEFAULT_MAPPING.thrustPositive,
      ),
      thrustNegative: this.normalizeKeys(
        options.mapping?.thrustNegative ?? DEFAULT_MAPPING.thrustNegative,
      ),
      pitchPositive: this.normalizeKeys(
        options.mapping?.pitchPositive ?? DEFAULT_MAPPING.pitchPositive,
      ),
      pitchNegative: this.normalizeKeys(
        options.mapping?.pitchNegative ?? DEFAULT_MAPPING.pitchNegative,
      ),
      rollPositive: this.normalizeKeys(
        options.mapping?.rollPositive ?? DEFAULT_MAPPING.rollPositive,
      ),
      rollNegative: this.normalizeKeys(
        options.mapping?.rollNegative ?? DEFAULT_MAPPING.rollNegative,
      ),
      yawPositive: this.normalizeKeys(
        options.mapping?.yawPositive ?? DEFAULT_MAPPING.yawPositive,
      ),
      yawNegative: this.normalizeKeys(
        options.mapping?.yawNegative ?? DEFAULT_MAPPING.yawNegative,
      ),
      speedBoost: this.normalizeKey(
        options.mapping?.speedBoost ?? DEFAULT_MAPPING.speedBoost,
      ),
    };
    this.smoothing = {
      thrustRate: options.smoothing?.thrustRate ?? DEFAULT_SMOOTHING.thrustRate,
      stickRate: options.smoothing?.stickRate ?? DEFAULT_SMOOTHING.stickRate,
      yawRate: options.smoothing?.yawRate ?? DEFAULT_SMOOTHING.yawRate,
      deadzone: options.smoothing?.deadzone ?? DEFAULT_SMOOTHING.deadzone,
    };
    const mapperOptions: InputMapperOptions = {
      ...options.mapper,
      deadband: options.mapper?.deadband ?? this.smoothing.deadzone,
    };
    this.inputMapper = new InputMapper(mapperOptions);
    this.speedBoostMultiplier = options.speedBoostMultiplier ?? 2;

    this.handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && /INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName)) return;
      const key = event.key.toLowerCase();
      if (this.flightInputEnabled) {
        if (key.startsWith("arrow") || key === " ") event.preventDefault();
        this.keys[key] = true;
      }

      if (!event.repeat && key === "r") {
        this.clearInput();
        if (this.flightInputEnabled) this.resetPending = true;
        this.callbacks.onReset();
      }
      if (!event.repeat && key === "c") {
        this.callbacks.onToggleCamera();
      }
      if (this.flightInputEnabled && !event.repeat && key === "m" && event.shiftKey) {
        this.armed = !this.armed;
        this.callbacks.onToggleArm?.();
      }
      if (key === "l") {
        this.callbacks.onPushBody?.(1);
      }
      if (key === "o") {
        this.callbacks.onPushBody?.(3);
      }
      if (key === "k") {
        this.callbacks.onPushBody?.(2);
      }
      if (!event.repeat && key === "f") {
        this.callbacks.onSwitchFlightMode?.();
      }
      if (!event.repeat && key === "g") {
        this.callbacks.onToggleRecording?.();
      }
      if (!event.repeat && key === "h") {
        this.callbacks.onToggleHelp?.();
      }
    };

    this.handleKeyUp = (event: KeyboardEvent) => {
      if (!this.flightInputEnabled) return;
      const key = event.key.toLowerCase();
      this.keys[key] = false;
    };
  }

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.clearInput();
    document.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.clearInput);
  }

  setFlightInputEnabled(enabled: boolean): void {
    if (this.flightInputEnabled === enabled) return;
    this.clearInput();
    this.flightInputEnabled = enabled;
  }

  read(dt: number): Controls {
    const targetThrust = this.getAxisTarget(
      this.mapping.thrustPositive,
      this.mapping.thrustNegative,
    );
    const targetPitch = this.getAxisTarget(
      this.mapping.pitchPositive,
      this.mapping.pitchNegative,
    );
    const targetRoll = this.getAxisTarget(
      this.mapping.rollPositive,
      this.mapping.rollNegative,
    );
    const targetYaw = this.getAxisTarget(
      this.mapping.yawPositive,
      this.mapping.yawNegative,
    );

    this.axis.thrust = this.approach(
      this.axis.thrust,
      targetThrust,
      this.smoothing.thrustRate,
      dt,
    );
    this.axis.pitch = this.approach(
      this.axis.pitch,
      targetPitch,
      this.smoothing.stickRate,
      dt,
    );
    this.axis.roll = this.approach(
      this.axis.roll,
      targetRoll,
      this.smoothing.stickRate,
      dt,
    );
    this.axis.yaw = this.approach(
      this.axis.yaw,
      targetYaw,
      this.smoothing.yawRate,
      dt,
    );

    const mapped = this.inputMapper.mapAxes({
      thrust: this.axis.thrust,
      pitch: this.axis.pitch,
      roll: this.axis.roll,
      yaw: this.axis.yaw,
    });

    this.controls.thrust = mapped.thrust;
    this.controls.pitch = mapped.pitch;
    this.controls.roll = mapped.roll;
    this.controls.yaw = mapped.yaw;
    this.controls.speedMultiplier = this.keys[this.mapping.speedBoost]
      ? this.speedBoostMultiplier
      : 1;
    this.controls.arm = this.armed;
    this.controls.reset = this.resetPending;
    this.resetPending = false;

    return this.controls;
  }

  dispose(): void {
    if (!this.initialized) return;
    this.initialized = false;
    this.clearInput();
    document.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.clearInput);
  }

  private approach(current: number, target: number, rate: number, dt: number) {
    const delta = target - current;
    const maxStep = rate * dt;
    if (Math.abs(delta) <= maxStep) return target;
    return current + Math.sign(delta) * maxStep;
  }

  private getAxisTarget(positiveKeys: string[], negativeKeys: string[]) {
    const hasPositive = positiveKeys.some((key) => this.keys[key]);
    const hasNegative = negativeKeys.some((key) => this.keys[key]);
    return (hasPositive ? 1 : 0) - (hasNegative ? 1 : 0);
  }

  private normalizeKey(key: string) {
    return key.toLowerCase();
  }

  private normalizeKeys(keys: string[]) {
    return keys.map((key) => this.normalizeKey(key));
  }
}
