import type { Controls } from "../types";

export function updateStickDots(
  controls: Controls,
  leftStickDot: HTMLElement,
  rightStickDot: HTMLElement,
): void {
  const thr =
    controls.throttle != null && Number.isFinite(controls.throttle)
      ? controls.throttle
      : Number.isFinite(controls.thrust)
        ? (controls.thrust + 1) / 2
        : 0;
  const yaw = Number.isFinite(controls.yaw) ? controls.yaw : 0;
  const rol = Number.isFinite(controls.roll) ? controls.roll : 0;
  const pit = Number.isFinite(controls.pitch) ? controls.pitch : 0;

  const leftX = Math.max(0, Math.min(100, ((1 - yaw) / 2) * 100));
  const leftY = Math.max(
    0,
    Math.min(100, (1 - Math.max(0, Math.min(1, thr))) * 100),
  );
  const rightX = Math.max(0, Math.min(100, ((rol + 1) / 2) * 100));
  const rightY = Math.max(0, Math.min(100, ((1 - pit) / 2) * 100));

  leftStickDot.style.left = `${leftX}%`;
  leftStickDot.style.top = `${leftY}%`;
  rightStickDot.style.left = `${rightX}%`;
    rightStickDot.style.top = `${rightY}%`;
}
