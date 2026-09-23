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
    pitch: { index: 1, inverted: false },
    roll: { index: 2, inverted: false },
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
    const axes = parsed.axes;
    // Update calibrations saved with the previous default; leave custom mappings alone.
    if (
      axes?.throttle?.index === 0 && !axes.throttle.inverted &&
      axes.yaw?.index === 3 && axes.yaw.inverted &&
      axes.pitch?.index === 2 && !axes.pitch.inverted &&
      axes.roll?.index === 1 && !axes.roll.inverted
    ) {
      parsed.axes.pitch.index = 1;
      parsed.axes.roll.index = 2;
      localStorage.setItem(getStorageKey(gamepadId), JSON.stringify(parsed));
    }
    return { ...DEFAULT_CALIBRATION, ...parsed, gamepadId: parsed.gamepadId || gamepadId };
  } catch {
    return null;
  }
}
