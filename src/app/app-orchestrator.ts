import type { DroneConfig } from "../config/drone-config";
import { defaultPreset, normalizePreset } from "../config/presets";
import { downloadJson, takePendingReplay } from "./flight-settings";
import {
  createRecording,
  MAX_RECORDING_STEPS,
  type FlightRecording,
} from "../core/flight-recording";
import type { WorldConfig } from "../config/dedust-world-config";
import {
  SimulationEngine,
  type SimulationEngineOptions,
} from "../core/simulation-engine";
import { InputManager } from "../input/input-manager";
import {
  createRenderer,
  type RendererType,
} from "../renderers/renderer-factory";
import type { IRenderer } from "../renderers/renderer-interface";
import type { CameraMode, DroneTelemetry, Vec3 } from "../types";
import { quaternionToEulerDeg } from "../utils/math";

export type AppOrchestratorOptions = {
  rendererType: RendererType;
  droneConfig?: DroneConfig;
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
  const worldName = options.worldConfig?.name ?? "cesium";
  let replay = await takePendingReplay(worldName);
  const config = normalizePreset(
    replay?.config ?? options.droneConfig ?? defaultPreset(),
  );
  let replayIndex = 0;
  let recording: FlightRecording | undefined;
  let recordingActive = false;
  let pendingRecordedReset = false;
  const renderer: IRenderer = await createRenderer(options.rendererType);
  const simulationEngine = new SimulationEngine({
    config: config,
    roofHeight: options.worldConfig?.roofHeight,
    ...options.simulationOptions,
  });

  let cameraMode: CameraMode = options.initialCameraMode ?? "orbit";
  const cameraSelect = document.getElementById(
    "cameraSelect",
  ) as HTMLSelectElement | null;
  if (cameraSelect) {
    cameraSelect.value = cameraMode;
    cameraSelect.addEventListener("change", () => {
      cameraMode = cameraSelect.value as CameraMode;
      localStorage.setItem("drone_sim_camera", cameraMode);
    });
  }
  let flightMode: "acro" | "angle" =
    config.controllerType === "angle" ? "angle" : "acro";
  let lastTime = performance.now();
  let frameCount = 0;
  let fpsTime = performance.now();
  let lastHudUpdate = 0;
  let resetRequested = false;
  let handleToggleRecording = () => {};
  let handleToggleHelp = () => {};
  const inputSourceBadge = document.getElementById("inputSource");
  const keyboardSourceButton = document.getElementById(
    "inputSourceKeyboardBtn",
  ) as HTMLButtonElement | null;
  const gamepadSourceButton = document.getElementById(
    "inputSourceGamepadBtn",
  ) as HTMLButtonElement | null;
  const gamepadDetectionStatus = document.getElementById(
    "gamepadDetectionStatus",
  );

  const updateInputSourceUI = (source: "keyboard" | "gamepad") => {
    if (inputSourceBadge) {
      inputSourceBadge.textContent =
        source === "gamepad" ? "RADIO / GAMEPAD" : "KEYBOARD";
    }
    keyboardSourceButton?.setAttribute(
      "aria-pressed",
      String(source === "keyboard"),
    );
    gamepadSourceButton?.setAttribute(
      "aria-pressed",
      String(source === "gamepad"),
    );
  };

  const updateGamepadAvailabilityUI = (available: boolean) => {
    if (gamepadSourceButton) gamepadSourceButton.disabled = !available;
    if (gamepadDetectionStatus) {
      gamepadDetectionStatus.textContent = available
        ? "Gamepad detected."
        : "No gamepad detected. Connect one, press a button, then select Detect.";
    }
  };

  const inputProvider = new InputManager({
    callbacks: {
      onReset: () => {
        if (!replay) resetRequested = true;
      },
      onToggleCamera: () => {
        cameraMode = nextCameraMode(cameraMode);
        if (cameraSelect) cameraSelect.value = cameraMode;
        localStorage.setItem("drone_sim_camera", cameraMode);
      },
      onSwitchFlightMode: () => {
        if (replay) return;
        flightMode = flightMode === "acro" ? "angle" : "acro";
        simulationEngine.switchFlightMode(flightMode);
      },
      onToggleRecording: () => {
        if (replay) return;
        handleToggleRecording();
      },
      onToggleHelp: () => {
        handleToggleHelp();
      },
      onInputSourceChanged: updateInputSourceUI,
      onGamepadAvailabilityChanged: updateGamepadAvailabilityUI,
    },
  });

  const containerId = options.containerId ?? "renderingContainer";
  const container = requireElement(containerId);
  const simulationStart = replay?.initialPosition ??
    options.simulationStart ?? { x: 10, y: 1, z: 4 };
  const rendererStart = options.rendererStart ?? simulationStart;

  renderer.setDroneConfig?.(config);
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
    if (pendingMapCollider)
      simulationEngine.createMapCollider(pendingMapCollider);
  } catch (error) {
    renderer.dispose();
    simulationEngine.dispose();
    throw error;
  }

  inputProvider.init();
  const recordingStatus = document.getElementById("recordingStatus")!;
  const recordingIndicator = document.getElementById("recordingIndicator");
  const recTime = document.getElementById("recTime");
  const recordButton = document.getElementById(
    "recordFlight",
  ) as HTMLButtonElement;
  const exportButton = document.getElementById(
    "exportFlightRecording",
  ) as HTMLButtonElement;
  const stopReplayButton = document.getElementById(
    "stopReplay",
  ) as HTMLButtonElement;

  const setRecordingIndicatorVisible = (visible: boolean) => {
    if (recordingIndicator) {
      recordingIndicator.style.display = visible ? "flex" : "none";
    }
  };

  // Recording is completely disabled by default (no auto recording)
  recordingActive = false;
  setRecordingIndicatorVisible(false);

  // Help modal setup
  const helpModal = document.getElementById("helpModal");
  const helpToggleBtn = document.getElementById("helpToggleBtn");
  const closeHelpBtn = document.getElementById("closeHelpBtn");
  const toggleHelp = () => {
    if (!helpModal) return;
    const isHidden =
      helpModal.style.display === "none" || !helpModal.style.display;
    helpModal.style.display = isHidden ? "flex" : "none";
  };
  const closeHelp = () => {
    if (helpModal) helpModal.style.display = "none";
  };
  helpToggleBtn?.addEventListener("click", toggleHelp);
  closeHelpBtn?.addEventListener("click", closeHelp);
  helpModal?.addEventListener("click", (e) => {
    if (e.target === helpModal) closeHelp();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && helpModal?.style.display === "flex") {
      closeHelp();
    }
  });
  handleToggleHelp = toggleHelp;

  const restartInput = () => {
    inputProvider.dispose();
    inputProvider.init();
  };
  const startRecording = () => {
    replay = undefined;
    replayIndex = 0;
    stopReplayButton.hidden = true;
    restartInput();
    simulationEngine.reset();
    simulationEngine.switchFlightMode(flightMode);
    recording = createRecording(
      config,
      worldName,
      simulationStart,
      simulationEngine.timestep,
    );
    pendingRecordedReset = false;
    recordingActive = true;
    setRecordingIndicatorVisible(true);
    exportButton.disabled = false;
    recordingStatus.textContent = "Recording active. Arm to fly. Press G to stop.";
    recordButton.blur();
  };
  const stopRecording = () => {
    if (!recordingActive) return;
    recordingActive = false;
    setRecordingIndicatorVisible(false);
    if (recording?.steps.length) {
      recordingStatus.textContent = `Recorded ${(recording.steps.length * recording.fixedTimeStep).toFixed(1)}s. Export to save, or press G to record.`;
      exportButton.disabled = false;
    } else {
      recordingStatus.textContent = "Recording stopped. Press G to record.";
    }
  };
  const toggleRecording = () => {
    if (recordingActive) {
      stopRecording();
    } else {
      startRecording();
    }
  };
  handleToggleRecording = toggleRecording;

  const exportRecording = () => {
    if (!recording?.steps.length) return;
    recordingActive = false;
    setRecordingIndicatorVisible(false);
    downloadJson("whoop-flight.json", JSON.stringify(recording));
    recordingStatus.textContent = `Exported ${(recording.steps.length * recording.fixedTimeStep).toFixed(1)} seconds.`;
    exportButton.blur();
  };
  const stopReplay = () => {
    replay = undefined;
    replayIndex = 0;
    stopReplayButton.hidden = true;
    restartInput();
    simulationEngine.reset();
    simulationEngine.switchFlightMode(flightMode);
    recordingStatus.textContent = "Replay stopped. Flight reset.";
    stopReplayButton.blur();
  };
  recordButton.addEventListener("click", toggleRecording);
  exportButton.addEventListener("click", exportRecording);
  stopReplayButton.addEventListener("click", stopReplay);
  if (replay) {
    stopReplayButton.hidden = false;
    recordingStatus.textContent = "Replaying recorded inputs…";
  }
  simulationEngine.beforeFixedStep = (input) => {
    if (replay) {
      const step = replay.steps[replayIndex++];
      if (!step) {
        recordingStatus.textContent =
          "Replay complete. Stop replay to return to live controls.";
        return null;
      }
      if (step.controls.reset) simulationEngine.resetBody();
      if (step.mode !== flightMode || step.controls.reset) {
        flightMode = step.mode;
        simulationEngine.switchFlightMode(flightMode);
      }
      simulationEngine.setArmed(step.controls.arm);
      return step.controls;
    }
    if (recordingActive && recording) {
      recording.steps.push({
        controls: { ...input, reset: pendingRecordedReset },
        mode: flightMode,
      });
      pendingRecordedReset = false;
      if (recording.steps.length >= MAX_RECORDING_STEPS) {
        recordingActive = false;
        setRecordingIndicatorVisible(false);
        recordingStatus.textContent =
          "Two-minute recording limit reached. Export to save.";
      }
    }
    return input;
  };
  const hoverHint = document.getElementById("hoverHint");
  if (hoverHint)
    hoverHint.textContent = `Estimated hover: ${(config.hoverThrottle * 100).toFixed(0)}% at ${config.propulsion.referenceVoltage} V; varies with battery. Try angle mode for self-leveling.`;
  lastTime = performance.now();
  const loading = document.getElementById("lodStatus");
  if (loading)
    loading.textContent = "Ready • Shift+M to arm • W throttle • Press H for controls";
  let animationId = 0;
  let stopped = false;
  const calibrate = document.getElementById("calibrate");
  const onCalibrate = () => {
    void inputProvider.recalibrate().catch((error) => {
      if (loading)
        loading.textContent = `Calibration cancelled: ${error instanceof Error ? error.message : String(error)}`;
    });
    calibrate?.blur();
  };
  calibrate?.addEventListener("click", onCalibrate);

  const onSwitchToKeyboard = () => {
    inputProvider.useKeyboard();
    if (loading) loading.textContent = "Switched to Keyboard controls";
  };
  keyboardSourceButton?.addEventListener("click", onSwitchToKeyboard);

  gamepadSourceButton?.addEventListener("click", () => {
    if (gamepadDetectionStatus) {
      gamepadDetectionStatus.textContent = "Connecting to gamepad…";
    }
    void inputProvider.useGamepad().then((activated) => {
      if (gamepadDetectionStatus) {
        gamepadDetectionStatus.textContent = activated
          ? "Using radio / gamepad controls."
          : "Could not activate the gamepad. Select Detect and try again.";
      }
    }).catch((error) => {
      if (gamepadDetectionStatus) {
        gamepadDetectionStatus.textContent =
          `Could not activate the gamepad: ${error instanceof Error ? error.message : String(error)}`;
      }
    });
  });

  const detectGamepadButton = document.getElementById("detectGamepadBtn");
  detectGamepadButton?.addEventListener("click", () => {
    const detected = inputProvider.detectGamepad();
    if (loading) {
      loading.textContent = detected
        ? "Gamepad detected. Select Radio / Gamepad to use it."
        : "No gamepad detected. Connect one, press a button, and try again.";
    }
    detectGamepadButton.blur();
  });

  const helpSwitchKeyboardBtn = document.getElementById(
    "helpSwitchKeyboardBtn",
  );
  helpSwitchKeyboardBtn?.addEventListener("click", () => {
    onSwitchToKeyboard();
    closeHelp();
  });

  const helpCalibrateBtn = document.getElementById("helpCalibrateBtn");
  helpCalibrateBtn?.addEventListener("click", () => {
    closeHelp();
    onCalibrate();
  });

  const onVisibilityChange = () => {
    lastTime = performance.now();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  const animate = () => {
    if (stopped) return;
    const now = performance.now();
    const deltaTime = (now - lastTime) / 1000;
    lastTime = now;
    // A hidden tab is paused; do not turn time away into a catch-up burst.
    if (document.hidden) {
      animationId = requestAnimationFrame(animate);
      return;
    }

    const controls = inputProvider.read(deltaTime);
    if (!replay && (controls.reset || resetRequested)) {
      pendingRecordedReset = true;
      simulationEngine.reset();
      simulationEngine.switchFlightMode(flightMode);
      ui.statusBanner.classList.remove("show");
      resetRequested = false;
    }

    if (!replay) simulationEngine.setArmed(controls.arm);
    const telemetry = simulationEngine.step(controls, deltaTime);

    ui.statusBanner.classList.toggle("show", telemetry.crashed);

    renderer.render(telemetry, cameraMode);
    if (now - lastHudUpdate > 100) {
      updateHUD(ui, telemetry, cameraMode, flightMode);
      if (recordingActive && recording && recTime) {
        const totalSec = Math.floor(
          recording.steps.length * recording.fixedTimeStep,
        );
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        recTime.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
      }
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
    recordButton.removeEventListener("click", toggleRecording);
    exportButton.removeEventListener("click", exportRecording);
    stopReplayButton.removeEventListener("click", stopReplay);
    helpToggleBtn?.removeEventListener("click", toggleHelp);
    closeHelpBtn?.removeEventListener("click", closeHelp);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    inputProvider.dispose();
    // Navigation releases the document's WebGL context and workers. Calling
    // Spark.dispose here races its pending GPU readbacks/worker replies.
    // Explicit renderer disposal remains in the initialization failure path.
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

function updateHUD(
  ui: HudElements,
  telemetry: DroneTelemetry,
  _cameraMode: CameraMode,
  flightMode: "acro" | "angle" = "acro",
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
  ui.flightMode.textContent = `${modeLabel} | ${_cameraMode.toUpperCase()}`;
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
}
