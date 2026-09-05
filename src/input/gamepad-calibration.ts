export type GamepadAxisMapping = {
  index: number;
  inverted: boolean;
};

export type GamepadButtonBinding =
  | number // digital button index e.g. 4
  | { axis: number; direction?: "positive" | "negative" }; // axis as button

export type GamepadButtonMapping = {
  arm: GamepadButtonBinding;
  reset: GamepadButtonBinding;
  camera?: GamepadButtonBinding;
  mode?: GamepadButtonBinding;
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
    throttle: { index: 0, inverted: false },
    yaw: { index: 3, inverted: true },
    pitch: { index: 2, inverted: false },
    roll: { index: 1, inverted: false },
  },
  buttons: {
    arm: { axis: 4, direction: "positive" },
    reset: { axis: 5, direction: "positive" },
    camera: 6,
    mode: 7,
  },
  gamepadId: "",
};

export function isBindingPressed(
  binding: GamepadButtonBinding | undefined,
  buttons: readonly (GamepadButton | boolean | undefined)[],
  axes: readonly number[],
): boolean {
  if (binding === undefined || binding === null) return false;
  if (typeof binding === "number") {
    if (binding < 0) return false;
    const btn = buttons[binding];
    if (typeof btn === "boolean") return btn;
    return Boolean(btn?.pressed || (btn?.value ?? 0) > 0.45);
  }
  if (typeof binding === "object" && "axis" in binding) {
    const val = axes[binding.axis] ?? 0;
    if (binding.direction === "negative") {
      return val < -0.4;
    }
    return val > 0.4;
  }
  return false;
}

export function formatButtonBinding(
  binding: GamepadButtonBinding | undefined,
): string {
  if (binding === undefined || binding === null || binding === -1)
    return "None";
  if (typeof binding === "number") return `Btn ${binding}`;
  if (typeof binding === "object" && "axis" in binding) {
    const sign = binding.direction === "negative" ? "(-)" : "(+)";
    return `Axis ${binding.axis} ${sign}`;
  }
  return String(binding);
}

export function parseButtonBinding(
  str: string,
): GamepadButtonBinding | undefined {
  if (!str || str === "none" || str === "-1") return undefined;
  if (str.startsWith("axis:")) {
    const parts = str.split(":");
    const axis = Number(parts[1]);
    const dir = parts[2] === "neg" ? "negative" : "positive";
    return { axis, direction: dir };
  }
  if (str.startsWith("btn:")) {
    return Number(str.slice(4));
  }
  const num = Number(str);
  if (!isNaN(num)) return num;
  return undefined;
}

export function serializeButtonBinding(
  binding: GamepadButtonBinding | undefined,
): string {
  if (binding === undefined || binding === null || binding === -1)
    return "none";
  if (typeof binding === "number") return `btn:${binding}`;
  if (typeof binding === "object" && "axis" in binding) {
    const dir = binding.direction === "negative" ? "neg" : "pos";
    return `axis:${binding.axis}:${dir}`;
  }
  return "none";
}

export const CALIBRATION_PRESETS: Record<
  string,
  { name: string; calibration: Omit<GamepadCalibration, "gamepadId"> }
> = {
  emaxRadio: {
    name: "EMAX Radio (A0:Thr, A3:Yaw-Inv, A1:Rol, A2:Pit, A4:Arm, A5:Reset)",
    calibration: {
      axes: {
        throttle: { index: 0, inverted: false },
        yaw: { index: 3, inverted: true },
        pitch: { index: 2, inverted: false },
        roll: { index: 1, inverted: false },
      },
      buttons: {
        arm: { axis: 4, direction: "positive" },
        reset: { axis: 5, direction: "positive" },
        camera: 6,
        mode: 7,
      },
    },
  },
  standardGamepad: {
    name: "Xbox / Standard Gamepad",
    calibration: {
      axes: {
        throttle: { index: 1, inverted: true },
        yaw: { index: 0, inverted: false },
        pitch: { index: 3, inverted: true },
        roll: { index: 2, inverted: false },
      },
      buttons: {
        arm: 4,
        reset: 5,
        camera: 2,
        mode: 0,
      },
    },
  },
  fpvRadioMode2: {
    name: "FPV Radio (Mode 2 - AETR)",
    calibration: {
      axes: {
        throttle: { index: 2, inverted: false },
        yaw: { index: 3, inverted: false },
        pitch: { index: 1, inverted: true },
        roll: { index: 0, inverted: false },
      },
      buttons: {
        arm: 4,
        reset: 5,
        camera: 6,
        mode: 7,
      },
    },
  },
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
