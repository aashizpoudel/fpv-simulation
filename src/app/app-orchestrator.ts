import { Tinyhawk3Config } from "../config/tinyhawk-config";
import type { WorldConfig } from "../config/dedust-world-config";
import { SimulationEngine, type SimulationEngineOptions } from "../core/simulation-engine";
import { InputManager } from "../input/input-manager";
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
  const renderer: IRenderer = await createRenderer(options.rendererType);
  const simulationEngine = new SimulationEngine({
    config: Tinyhawk3Config,
    roofHeight: options.worldConfig?.roofHeight,
    ...options.simulationOptions,
  });

  let cameraMode: CameraMode = options.initialCameraMode ?? "orbit";
  const cameraSelect = document.getElementById("cameraSelect") as HTMLSelectElement | null;
  if (cameraSelect) {
    cameraSelect.value = cameraMode;
    cameraSelect.addEventListener("change", () => {
      cameraMode = cameraSelect.value as CameraMode;
      localStorage.setItem("drone_sim_camera", cameraMode);
    });
  }
  let flightMode: "acro" | "angle" = Tinyhawk3Config.controllerType === "angle" ? "angle" : "acro";
  let lastTime = performance.now();
  let frameCount = 0;
  let fpsTime = performance.now();
  let lastHudUpdate = 0;
  let resetRequested = false;

  const inputProvider = new InputManager({
    callbacks: {
      onReset: () => {
        resetRequested = true;
      },
      onToggleCamera: () => {
        cameraMode = nextCameraMode(cameraMode);
        if (cameraSelect) cameraSelect.value = cameraMode;
        localStorage.setItem("drone_sim_camera", cameraMode);
      },
      onSwitchFlightMode: () => {
        flightMode = flightMode === "acro" ? "angle" : "acro";
        simulationEngine.switchFlightMode(flightMode);
      },
      onInputSourceChanged: (source) => {
        const element = document.getElementById("inputSource");
        if (element) element.textContent = source === "gamepad" ? "RADIO / GAMEPAD" : "KEYBOARD";
      },
    },
  });

  const containerId = options.containerId ?? "renderingContainer";
  const container = requireElement(containerId);
  const simulationStart = options.simulationStart ?? { x: 10, y: 1, z: 4 };
  const rendererStart = options.rendererStart ?? simulationStart;

  renderer.setDroneConfig?.(Tinyhawk3Config);
  if (options.worldConfig) renderer.setWorldConfig?.(options.worldConfig);
  renderer.setFeedCanvas?.(options.feedCanvasId ?? null);
  renderer.setFeedMode?.("auto");
  if (options.worldConfig?.mapScale != null) {
    renderer.mapScale = options.worldConfig.mapScale;
  }

  // Asset loading and Rapier WASM initialization happen concurrently. Keep a
  // completed collision asset until the physics world is ready to avoid a race.
  let physicsReady = false;
  let pendingMapCollider: import("three").Object3D | undefined;
  renderer.onMapLoaded = (mapObject) => {
    pendingMapCollider = mapObject as import("three").Object3D;
    if (physicsReady) simulationEngine.createMapCollider(pendingMapCollider);
  };

  try {
    await Promise.resolve(renderer.init(container, rendererStart));
    await simulationEngine.init(simulationStart);
    physicsReady = true;
    if (pendingMapCollider) simulationEngine.createMapCollider(pendingMapCollider);
  } catch (error) {
    renderer.dispose();
    simulationEngine.dispose();
    throw error;
  }

  inputProvider.init();
  lastTime = performance.now();
  const loading = document.getElementById("lodStatus");
  if (loading) loading.textContent = "Ready • Shift+M to arm • W to raise throttle";
  let animationId = 0;
  let stopped = false;
  const calibrate = document.getElementById("calibrate");
  const onCalibrate = () => {
    void inputProvider.recalibrate().catch((error) => {
      if (loading) loading.textContent = `Calibration cancelled: ${error instanceof Error ? error.message : String(error)}`;
    });
    calibrate?.blur();
  };
  calibrate?.addEventListener("click", onCalibrate);

  const onVisibilityChange = () => { lastTime = performance.now(); };
  document.addEventListener("visibilitychange", onVisibilityChange);
  const animate = () => {
    if (stopped) return;
    const now = performance.now();
    const deltaTime = (now - lastTime) / 1000;
    lastTime = now;
    // A hidden tab is paused; do not turn time away into a catch-up burst.
    if (document.hidden) { animationId = requestAnimationFrame(animate); return; }

    const controls = inputProvider.read(deltaTime);
    if (controls.reset || resetRequested) {
      simulationEngine.reset();
      simulationEngine.switchFlightMode(flightMode);
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

    animationId = requestAnimationFrame(animate);
  };

  animationId = requestAnimationFrame(animate);

  window.addEventListener("beforeunload", () => {
    stopped = true;
    cancelAnimationFrame(animationId);
    calibrate?.removeEventListener("click", onCalibrate);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    inputProvider.dispose();
    renderer.dispose();
    simulationEngine.dispose();
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
