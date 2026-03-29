import { Tinyhawk3Config } from "../config/tinyhawk-config";
import type { WorldConfig } from "../config/dedust-world-config";
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
  worldConfig?: WorldConfig;
};

type HudElements = {
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
};

export async function startApp(options: AppOrchestratorOptions): Promise<void> {
  const ui = getHudElements();
  const renderer: IRenderer = createRenderer(options.rendererType);
  const simulationEngine = new SimulationEngine({
    config: Tinyhawk3Config,
    roofHeight: options.worldConfig?.roofHeight,
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
  if (options.worldConfig?.mapScale != null) {
    renderer.mapScale = options.worldConfig.mapScale;
  }

  // When the map mesh finishes loading, create a physics trimesh collider for it.
  renderer.onMapLoaded = (mapObject) => {
    simulationEngine.createMapCollider(mapObject as import("three").Object3D);
  };

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
      ui.fps.textContent = `${frameCount}fps`;
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

function updateHUD(ui: HudElements, telemetry: DroneTelemetry, _cameraMode: CameraMode, flightMode: "acro" | "angle" = "acro") {
  const pos = telemetry.localPosition;
  const vel = telemetry.localVelocity;
  const { rollDeg, pitchDeg } = quaternionToEulerDeg(
    telemetry.localOrientation,
  );

  const speed = Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2);
  const modeLabel = flightMode.toUpperCase();
  const throttlePct = Math.max(0, Math.min(100, telemetry.throttle));

  // Top row
  ui.flightMode.textContent = `${modeLabel} | ${_cameraMode.toUpperCase()}`;
  ui.altitude.textContent = `${pos.z.toFixed(1)}m`;

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
}
