export type GamepadAxisMapping = {
  index: number;
  inverted: boolean;
};

export type GamepadButtonMapping = {
  arm: number;
  reset: number;
  camera?: number;
  mode?: number;
};

export type GamepadCalibration = {
  axes: {
    throttle: GamepadAxisMapping;
    yaw: GamepadAxisMapping;
    pitch: GamepadAxisMapping;
    roll: GamepadAxisMapping;
  };
  buttons: GamepadButtonMapping;
  gamepadId: string;
};

const STORAGE_PREFIX = "fpv-sim-gamepad-calibration:";

export const DEFAULT_CALIBRATION: GamepadCalibration = {
  axes: {
    throttle: { index: 1, inverted: true },
    yaw: { index: 0, inverted: false },
    pitch: { index: 3, inverted: true },
    roll: { index: 2, inverted: false },
  },
  buttons: {
    arm: 4,
    reset: 5,
    camera: 6,
    mode: 7,
  },
  gamepadId: "",
};

function getStorageKey(gamepadId: string): string {
  return `${STORAGE_PREFIX}${gamepadId}`;
}

export function saveCalibration(calibration: GamepadCalibration): void {
  if (typeof localStorage === "undefined") return;
  const payload = JSON.stringify(calibration);
  localStorage.setItem(getStorageKey(calibration.gamepadId), payload);
}

export function loadCalibration(gamepadId: string): GamepadCalibration | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  const stored = localStorage.getItem(getStorageKey(gamepadId));
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as GamepadCalibration;
    return { ...DEFAULT_CALIBRATION, ...parsed, gamepadId: parsed.gamepadId || gamepadId };
  } catch {
    return null;
  }
}
