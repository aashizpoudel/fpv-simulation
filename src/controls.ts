/*
Keyboard input handling for thrust/attitude controls.
Flow: track key state -> map to controls each frame -> callbacks for reset/
camera toggle.

Usage example:
const { controls, updateControls } = setupControls({
  onReset: () => resetDronePhysics(physics),
  onToggleCamera: () => setCameraMode(),
});
updateControls();
*/
import type { Controls } from "./types";

type ControlCallbacks = {
  onReset: () => void;
  onToggleCamera: () => void;
  onToggleArm?: () => void;
  onPushBody?: (direction: number) => void;
};

export function setupControls(callbacks: ControlCallbacks) {
  const controls: Controls = {
    thrust: 0,
    pitch: 0,
    roll: 0,
    yaw: 0,
    speedMultiplier: 1,
  };

  const keys: Record<string, boolean> = {};

  // "Analog" axis state (smoothed)
  const axis = { thrust: 0, pitch: 0, roll: 0, yaw: 0 };

  // Move current value toward target at `rate` units per second
  function approach(current: number, target: number, rate: number, dt: number) {
    const delta = target - current;
    const maxStep = rate * dt;
    if (Math.abs(delta) <= maxStep) return target;
    return current + Math.sign(delta) * maxStep;
  }

  // Track key state and trigger one-off actions.
  const handleKeyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    keys[key] = true;
    if (!event.repeat && key === "r") {
      callbacks.onReset();
    }
    if (!event.repeat && key === "c") {
      callbacks.onToggleCamera();
    }
    if (!event.repeat && key === "m" && event.shiftKey) {
      callbacks.onToggleArm?.();
    }
    if (event.key === " ") {
      controls.speedMultiplier = 2;
    }
    if (event.key == "l") {
      callbacks.onPushBody?.(1);
    }
    if (event.key == "o") {
      callbacks.onPushBody?.(3);
    }
    if (event.key == "k") {
      callbacks.onPushBody?.(2);
    }
  };

  // Clear key state and reset speed modifier.
  const handleKeyUp = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    keys[key] = false;
    if (event.key === " ") {
      controls.speedMultiplier = 1;
    }
  };

  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", handleKeyUp);

  // Map current key state to control inputs.
  const updateControls = (dt: number) => {
    // Targets from your existing keys (digital -> -1/0/+1)
    const targetThrust = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
    const targetPitch = (keys.arrowup ? 1 : 0) - (keys.arrowdown ? 1 : 0);
    const targetRoll = (keys.arrowright ? 1 : 0) - (keys.arrowleft ? 1 : 0);
    const targetYaw = (keys.a ? 1 : 0) - (keys.d ? 1 : 0);

    // Tuning: units per second to reach the target
    // Higher = snappier, lower = smoother.
    const THRUST_AXIS_RATE = 8;
    const STICK_AXIS_RATE = 0.5;
    const YAW_AXIS_RATE = 0.5;

    axis.thrust = approach(axis.thrust, targetThrust, THRUST_AXIS_RATE, dt);
    axis.pitch = approach(axis.pitch, targetPitch, STICK_AXIS_RATE, dt);
    axis.roll = approach(axis.roll, targetRoll, STICK_AXIS_RATE, dt);
    axis.yaw = approach(axis.yaw, targetYaw, YAW_AXIS_RATE, dt);

    // Optional: tiny deadzone to remove drift near 0
    const deadzone = 0.02;
    const dz = (v: number) => (Math.abs(v) < deadzone ? 0 : v);

    controls.thrust = dz(axis.thrust);
    controls.pitch = dz(axis.pitch);
    controls.roll = dz(axis.roll);
    controls.yaw = dz(axis.yaw);
  };

  return { controls, updateControls };
}
