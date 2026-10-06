import type { CameraMode, DroneTelemetry } from "../types";
import { quaternionToEulerDeg } from "../controllers/math-utils";

export type HudElements = {
  flightMode: HTMLElement;
  altitude: HTMLElement;
  fps: HTMLElement;
  speed: HTMLElement;
  throttle: HTMLElement;
  throttleBar: HTMLElement;
  roll: HTMLElement;
  pitch: HTMLElement;
  gforce: HTMLElement;
  armStatus: HTMLElement;
  position: HTMLElement;
  statusBanner: HTMLElement;
  osd: HTMLElement;
  horizonLine: HTMLElement;
  crosshair: HTMLElement;
};

export function nextCameraMode(current: CameraMode): CameraMode {
  if (current === "fpv") {
    return "third";
  }
  if (current === "third") {
    return "orbit";
  }
  return "fpv";
}

export function getHudElements(): HudElements {
  return {
    flightMode: requireElement("flightMode"),
    altitude: requireElement("altitude"),
    fps: requireElement("fps"),
    speed: requireElement("speed"),
    throttle: requireElement("throttle"),
    throttleBar: requireElement("throttleBar"),
    roll: requireElement("roll"),
    pitch: requireElement("pitch"),
    gforce: requireElement("gforce"),
    armStatus: requireElement("armStatus"),
    position: requireElement("position"),
    statusBanner: requireElement("statusBanner"),
    osd: requireSelector<HTMLElement>(".osd"),
    horizonLine: requireSelector<HTMLElement>(".osd-horizon-line"),
    crosshair: requireSelector<HTMLElement>(".osd-crosshair"),
  };
}

export function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: ${id}`);
  return element;
}

function requireSelector<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

export function updateHUD(
  ui: HudElements,
  telemetry: DroneTelemetry,
  cameraMode: CameraMode,
  flightMode: "acro" | "angle" = "angle",
  crosshairEnabled = false,
  horizonLineEnabled = false,
) {
  const pos = telemetry.localPosition;
  const vel = telemetry.localVelocity;
  const { rollDeg, pitchDeg } = quaternionToEulerDeg(
    telemetry.localOrientation,
  );

  const speed = Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2);
  const modeLabel = flightMode.toUpperCase();
  const throttlePct = Math.max(0, Math.min(100, telemetry.throttle));

  // Top row
  ui.flightMode.textContent = `${modeLabel} | ${cameraMode.toUpperCase()}`;
  ui.altitude.textContent = `${pos.z.toFixed(1)}m`;
  const battery = document.getElementById("battery");
  if (battery)
    battery.textContent = `${(telemetry.batteryVoltage ?? 0).toFixed(2)} V · ${((telemetry.batteryCharge ?? 0) * 100).toFixed(0)}%`;

  // Left / Right center
  ui.speed.textContent = speed.toFixed(1);
  ui.throttle.textContent = `${throttlePct.toFixed(0)}%`;
  ui.throttleBar.style.height = `${throttlePct}%`;

  // Bottom
  ui.roll.textContent = rollDeg.toFixed(1);
  ui.pitch.textContent = pitchDeg.toFixed(1);
  ui.gforce.textContent = `G:${telemetry.gforce.toFixed(1)}g`;
  ui.position.textContent = `${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`;

  // Arm status
  ui.armStatus.textContent = telemetry.crashed
    ? "CRASHED"
    : telemetry.armed
      ? "ARMED"
      : "DISARMED";
  ui.osd.classList.toggle("osd--disarmed", !telemetry.armed);

  // Attitude indicator: rotate horizon line with roll, shift with pitch
  ui.horizonLine.style.transform = `rotate(${rollDeg}deg) translateY(${pitchDeg * 0.5}px)`;
  ui.horizonLine.classList.toggle("show", horizonLineEnabled && cameraMode === "fpv");

  // Center crosshair (visible only when enabled and in FPV camera mode)
  ui.crosshair.classList.toggle("show", crosshairEnabled && cameraMode === "fpv");
}
