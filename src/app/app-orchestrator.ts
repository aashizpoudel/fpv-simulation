import { Tinyhawk3Config } from "../config/tinyhawk-config";
import { SimulationEngine, type SimulationEngineOptions } from "../core/simulation-engine";
import { KeyboardInputProvider } from "../input/keyboard-input-provider";
import type { InputProvider } from "../input/input-provider";
import { createRenderer, type RendererType } from "../renderers/renderer-factory";
import type { IRenderer } from "../renderers/renderer-interface";
import type { CameraMode, DroneTelemetry, Vec3 } from "../types";
import { quaternionToEulerDeg } from "../utils/math";

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

export async function startApp(options: AppOrchestratorOptions): Promise<void> {
  const ui = getHudElements();
  const renderer: IRenderer = createRenderer(options.rendererType);
  const simulationEngine = new SimulationEngine({
    config: Tinyhawk3Config,
    ...options.simulationOptions,
  });

  let cameraMode: CameraMode = options.initialCameraMode ?? "orbit";
  let flightMode: "acro" | "angle" = Tinyhawk3Config.controllerType === "angle" ? "angle" : "acro";
  let lastTime = performance.now();
  let frameCount = 0;
  let fpsTime = performance.now();
  let lastHudUpdate = 0;
  let resetRequested = false;

  const inputProvider: InputProvider = new KeyboardInputProvider({
    callbacks: {
      onReset: () => {
        resetRequested = true;
      },
      onToggleCamera: () => {
        cameraMode = nextCameraMode(cameraMode);
      },
      onSwitchFlightMode: () => {
        flightMode = flightMode === "acro" ? "angle" : "acro";
        simulationEngine.switchFlightMode(flightMode);
      },
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
    if (now - lastHudUpdate > 100) {
      updateHUD(ui, telemetry, cameraMode, flightMode);
      lastHudUpdate = now;
    }

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

function updateHUD(ui: HudElements, telemetry: DroneTelemetry, cameraMode: CameraMode, flightMode: "acro" | "angle" = "acro") {
  const pos = telemetry.localPosition;
  const vel = telemetry.localVelocity;
  const { rollDeg, pitchDeg, yawDeg } = quaternionToEulerDeg(
    telemetry.localOrientation,
  );

  const speed = Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2);

  ui.altitude.textContent = `${pos.z.toFixed(1)} m`;
  ui.speed.textContent = `${speed.toFixed(1)} m/s`;
  ui.pitch.textContent = `${pitchDeg.toFixed(1)} deg`;
  ui.roll.textContent = `${rollDeg.toFixed(1)} deg`;
  ui.yaw.textContent = `${yawDeg.toFixed(1)} deg`;
  ui.position.innerHTML = `${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)}<br>${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)}`;
  ui.orientation.innerHTML = `${rollDeg.toFixed(1)},${pitchDeg.toFixed(1)},${yawDeg.toFixed(1)}<br>${rollDeg.toFixed(1)},${pitchDeg.toFixed(1)},${yawDeg.toFixed(1)}`;
  ui.cameraMode.textContent = cameraMode.toUpperCase();
  ui.latitude.textContent = "N/A";
  ui.longitude.textContent = "N/A";
  ui.gforce.textContent = `${telemetry.gforce.toFixed(2)} g`;
  ui.throttle.textContent = `${telemetry.throttle.toFixed(0)}%`;
  ui.thrustBar.style.width = `${Math.max(0, Math.min(100, telemetry.throttle))}%`;
  ui.rotorThrusts.textContent = telemetry.rotorThrusts
    .map((t) => t.toFixed(2))
    .join(", ");

  const modeLabel = flightMode.toUpperCase();
  ui.armStatus.textContent = telemetry.crashed
    ? "CRASHED"
    : telemetry.armed
      ? `ARMED | ${modeLabel} (F to switch)`
      : `DISARMED - Press Shift + M to arm | ${modeLabel}`;
  ui.altitude.closest(".hud")?.classList.toggle("hud--disarmed", !telemetry.armed);

  ui.attitudeInner.style.transform = `rotate(${rollDeg}deg)`;
  ui.attitudeInner.style.backgroundPosition = `0 -${pitchDeg * 2}px`;
}
