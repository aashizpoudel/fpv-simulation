import type { Controls } from "../types";
import { clamp } from "../utils/math";

export type InputAxis = "thrust" | "pitch" | "roll" | "yaw";

export type RawAxes = Pick<Controls, InputAxis>;

export type InputMapperOptions = {
  deadband?: number;
  expo?: number;
  rates?: Partial<Record<InputAxis, number>>;
  reverse?: Partial<Record<InputAxis, boolean>>;
};

const DEFAULT_OPTIONS: Required<InputMapperOptions> = {
  deadband: 0.02,
  expo: 0,
  rates: {
    thrust: 1,
    pitch: 1,
    roll: 1,
    yaw: 1,
  },
  reverse: {
    thrust: false,
    pitch: false,
    roll: false,
    yaw: false,
  },
};

export class InputMapper {
  private options: Required<InputMapperOptions>;

  constructor(options: InputMapperOptions = {}) {
    this.options = {
      deadband: options.deadband ?? DEFAULT_OPTIONS.deadband,
      expo: options.expo ?? DEFAULT_OPTIONS.expo,
      rates: {
        ...DEFAULT_OPTIONS.rates,
        ...options.rates,
      },
      reverse: {
        ...DEFAULT_OPTIONS.reverse,
        ...options.reverse,
      },
    };
  }

  mapAxes(raw: RawAxes): RawAxes {
    return {
      thrust: this.mapAxis("thrust", raw.thrust),
      pitch: this.mapAxis("pitch", raw.pitch),
      roll: this.mapAxis("roll", raw.roll),
      yaw: this.mapAxis("yaw", raw.yaw),
    };
  }

  private mapAxis(axis: InputAxis, value: number): number {
    const reversed = this.options.reverse[axis] ? -value : value;
    const withDeadband = this.applyDeadband(reversed);
    const withExpo = this.applyExpo(withDeadband);
    const rate = this.options.rates[axis] ?? 1;
    return clamp(withExpo * rate, -1, 1);
  }

  private applyDeadband(value: number): number {
    const deadband = this.options.deadband;
    if (Math.abs(value) < deadband) return 0;
    return value;
  }

  private applyExpo(value: number): number {
    const expo = this.options.expo;
    return (1 - expo) * value + expo * value * value * value;
  }
}
