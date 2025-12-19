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
  const updateControls = () => {
    controls.thrust = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
    controls.pitch = (keys.arrowup ? 1 : 0) - (keys.arrowdown ? 1 : 0);
    controls.roll = (keys.arrowright ? 1 : 0) - (keys.arrowleft ? 1 : 0);
    controls.yaw = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  };

  return { controls, updateControls };
}
