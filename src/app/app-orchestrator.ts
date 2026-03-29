import { Tinyhawk3Config, type DroneConfig } from "../config/tinyhawk-config";
import { SimulationEngine, type SimulationEngineOptions } from "../core/simulation-engine";
import { KeyboardInputProvider } from "../input/keyboard-input-provider";
import type { InputProvider } from "../input/input-provider";
import { createRenderer, type RendererType } from "../renderers/renderer-factory";
import type { IRenderer } from "../renderers/renderer-interface";
import type { CameraMode, DronePose, DroneTelemetry, Vec3 } from "../types";

export type AppOrchestratorOptions = {
  rendererType: RendererType;
  containerId?: string;
  feedCanvasId?: string | null;
  simulationStart?: Vec3;
  rendererStart?: Vec3;
  initialCameraMode?: CameraMode;
  simulationOptions?: Omit<SimulationEngineOptions, "config">;
};

type HudElements = {
  altitude: HTMLElement;
  speed: HTMLElement;
  pitch: HTMLElement;
  roll: HTMLElement;
  yaw: HTMLElement;
  position: HTMLElement;
  orientation: HTMLElement;
  cameraMode: HTMLElement;
  latitude: HTMLElement;
  longitude: HTMLElement;
  gforce: HTMLElement;
  throttle: HTMLElement;
  thrustBar: HTMLElement;
  rotorThrusts: HTMLElement;
  armStatus: HTMLElement;
  fps: HTMLElement;
  statusBanner: HTMLElement;
  attitudeInner: HTMLElement;
};

type RendererExtras = IRenderer & {
  setFeedCanvas?: (canvasId: string | null) => void;
  setFeedMode?: (mode: "auto" | "fpv" | "third") => void;
  setDroneConfig?: (config: DroneConfig) => void;
};

export async function startApp(options: AppOrchestratorOptions): Promise<void> {
  const ui = getHudElements();
  const renderer = createRenderer(options.rendererType) as RendererExtras;
  const simulationEngine = new SimulationEngine({
    config: Tinyhawk3Config,
    ...options.simulationOptions,
  });

  let cameraMode: CameraMode = options.initialCameraMode ?? "orbit";
  let lastTime = performance.now();
  let frameCount = 0;
  let fpsTime = performance.now();
  let resetRequested = false;

  const inputProvider = createInputProvider({
    onReset: () => {
      resetRequested = true;
    },
    onToggleCamera: () => {
      cameraMode = nextCameraMode(cameraMode);
    },
  });

  const containerId = options.containerId ?? "renderingContainer";
  const container = requireElement(containerId);
  const simulationStart = options.simulationStart ?? { x: 10, y: 1, z: 4 };
  const rendererStart = options.rendererStart ?? simulationStart;

  renderer.setDroneConfig?.(Tinyhawk3Config);
  renderer.setFeedCanvas?.(options.feedCanvasId ?? "cameraFeed");
  renderer.setFeedMode?.("auto");

  await Promise.resolve(renderer.init(container, rendererStart));
  await simulationEngine.init(simulationStart);

  inputProvider.init();

  const animate = () => {
    const now = performance.now();
    const deltaTime = (now - lastTime) / 1000;
    lastTime = now;

    const controls = inputProvider.read(deltaTime);
    if (controls.reset || resetRequested) {
      simulationEngine.reset();
      ui.statusBanner.classList.remove("show");
      resetRequested = false;
    }

    simulationEngine.setArmed(controls.arm);
    const telemetry = simulationEngine.step(controls, deltaTime);

    if (telemetry.crashed) {
      ui.statusBanner.classList.add("show");
    }

    renderer.render(telemetry, cameraMode);
    updateHUD(ui, telemetry, cameraMode);

    frameCount += 1;
    if (now - fpsTime >= 1000) {
      ui.fps.textContent = String(frameCount);
      frameCount = 0;
      fpsTime = now;
    }

    requestAnimationFrame(animate);
  };

  requestAnimationFrame(animate);

  window.addEventListener("beforeunload", () => {
    inputProvider.dispose();
    renderer.dispose();
  });
}

function createInputProvider(callbacks: {
  onReset: () => void;
  onToggleCamera: () => void;
}): InputProvider {
  return new KeyboardInputProvider({
    callbacks: {
      onReset: callbacks.onReset,
      onToggleCamera: callbacks.onToggleCamera,
    },
  });
}

function nextCameraMode(current: CameraMode): CameraMode {
  if (current === "fpv") {
    return "third";
  }
  if (current === "third") {
    return "orbit";
  }
  return "fpv";
}

function getHudElements(): HudElements {
  return {
    altitude: requireElement("altitude"),
    speed: requireElement("speed"),
    pitch: requireElement("pitch"),
    roll: requireElement("roll"),
    yaw: requireElement("yaw"),
    position: requireElement("position"),
    orientation: requireElement("orientation"),
    cameraMode: requireElement("cameraMode"),
    latitude: requireElement("latitude"),
    longitude: requireElement("longitude"),
    gforce: requireElement("gforce"),
    throttle: requireElement("throttle"),
    thrustBar: requireElement("thrustBar"),
    rotorThrusts: requireElement("rotorThrusts"),
    armStatus: requireElement("armStatus"),
    fps: requireElement("fps"),
    statusBanner: requireElement("statusBanner"),
    attitudeInner: requireSelector<HTMLElement>(".attitude-inner"),
  };
}

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: ${id}`);
  return element;
}

function requireSelector<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function updateHUD(ui: HudElements, telemetry: DroneTelemetry, cameraMode: CameraMode) {
  const pose = telemetryToPose(telemetry);
  const { rollDeg, pitchDeg, yawDeg } = quaternionToEulerDeg(
    pose.localOrientation,
  );
  const worldDeg = quaternionToEulerDeg(pose.worldOrientation);

  ui.altitude.textContent = `${pose.worldPosition.z.toFixed(1)} m`;
  ui.speed.textContent = `${Math.sqrt(
    pose.worldVelocity.x ** 2 +
      pose.worldVelocity.y ** 2 +
      pose.worldVelocity.z ** 2,
  ).toFixed(1)} m/s`;
  ui.pitch.textContent = `${pitchDeg.toFixed(1)} deg`;
  ui.roll.textContent = `${rollDeg.toFixed(1)} deg`;
  ui.yaw.textContent = `${yawDeg.toFixed(1)} deg`;
  ui.position.innerHTML = `${pose.localPosition.x.toFixed(2)},${pose.localPosition.y.toFixed(2)},${pose.localPosition.z.toFixed(2)}`;
  ui.position.innerHTML += `<br>${pose.worldPosition.x.toFixed(2)},${pose.worldPosition.y.toFixed(2)},${pose.worldPosition.z.toFixed(2)} `;
  ui.orientation.innerHTML = `${rollDeg.toFixed(1)},${pitchDeg.toFixed(1)},${yawDeg.toFixed(1)}`;
  ui.orientation.innerHTML += `<br>${worldDeg.rollDeg.toFixed(1)},${worldDeg.pitchDeg.toFixed(1)},${worldDeg.yawDeg.toFixed(1)}`;
  ui.cameraMode.textContent = cameraMode.toUpperCase();
  ui.latitude.textContent = "N/A";
  ui.longitude.textContent = "N/A";
  ui.gforce.textContent = `${pose.gforce.toFixed(2)} g`;
  ui.throttle.textContent = `${pose.throttle.toFixed(0)}%`;
  ui.thrustBar.style.width = `${Math.max(0, Math.min(100, pose.throttle))}%`;
  ui.rotorThrusts.textContent = pose.rotorThrusts
    .map((t) => t.toFixed(2))
    .join(", ");

  ui.armStatus.textContent = pose.crashed
    ? "CRASHED"
    : telemetry.armed
      ? "ARMED"
      : "DISARMED - Press Shift + M to arm";
  ui.altitude.closest(".hud")?.classList.toggle("hud--disarmed", !telemetry.armed);

  ui.attitudeInner.style.transform = `rotate(${rollDeg}deg)`;
  ui.attitudeInner.style.backgroundPosition = `0 -${pitchDeg * 2}px`;
}

function telemetryToPose(telemetry: DroneTelemetry): DronePose {
  return {
    localPosition: telemetry.localPosition,
    localOrientation: telemetry.localOrientation,
    worldPosition: telemetry.localPosition,
    worldOrientation: telemetry.localOrientation,
    worldVelocity: telemetry.localVelocity,
    gforce: telemetry.gforce,
    throttle: telemetry.throttle,
    rotorThrusts: telemetry.rotorThrusts,
    crashed: telemetry.crashed,
  };
}

function quaternionToEulerDeg(q: {
  x: number;
  y: number;
  z: number;
  w: number;
}) {
  const sinrCosp = 2 * (q.w * q.x + q.y * q.z);
  const cosrCosp = 1 - 2 * (q.x * q.x + q.y * q.y);
  const roll = Math.atan2(sinrCosp, cosrCosp);

  const sinp = 2 * (q.w * q.y - q.z * q.x);
  const pitch = Math.asin(clamp(sinp, -1, 1));

  const sinyCosp = 2 * (q.w * q.z + q.x * q.y);
  const cosyCosp = 1 - 2 * (q.y * q.y + q.z * q.z);
  const yaw = Math.atan2(sinyCosp, cosyCosp);

  return {
    rollDeg: radiansToDegrees(roll),
    pitchDeg: radiansToDegrees(pitch),
    yawDeg: radiansToDegrees(yaw),
  };
}

function radiansToDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
