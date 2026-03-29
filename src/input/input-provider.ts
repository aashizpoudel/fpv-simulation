import type { Controls } from "../types";

export type InputActionCallbacks = {
  onReset: () => void;
  onToggleCamera: () => void;
  onToggleArm?: () => void;
  onPushBody?: (direction: number) => void;
};

export type InputMapping = {
  thrustPositive: string[];
  thrustNegative: string[];
  pitchPositive: string[];
  pitchNegative: string[];
  rollPositive: string[];
  rollNegative: string[];
  yawPositive: string[];
  yawNegative: string[];
  speedBoost: string;
};

export type InputSmoothing = {
  thrustRate: number;
  stickRate: number;
  yawRate: number;
  deadzone: number;
};

export interface InputProvider {
  init(): void;
  read(dt: number): Controls;
  dispose(): void;
}

export function createNeutralControls(): Controls {
  return {
    thrust: 0,
    pitch: 0,
    roll: 0,
    yaw: 0,
    speedMultiplier: 1,
    arm: false,
    reset: false,
  };
}
