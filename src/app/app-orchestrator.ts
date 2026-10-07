import type { DroneConfig } from "../config/drone-config";
import { defaultPreset, normalizePreset } from "../config/presets";
import { takePendingReplay } from "./flight-settings";
import { downloadJson } from "./download";
import {
  createRecording,
  MAX_RECORDING_STEPS,
  type FlightRecording,
} from "../core/flight-recording";
import type { WorldConfig } from "../config/world-config";
import {
  SimulationEngine,
  type SimulationEngineOptions,
} from "../core/simulation-engine";
import { InputManager } from "../input/input-manager";
import { createNeutralControls, type InputSourceKind } from "../input/input-provider";
import { requestVrSession } from "../xr/xr-support";
import { loadGogglesSettings } from "../xr/goggles-preferences";
import {
  createRenderer,
  type RendererType,
} from "../renderers/renderer-factory";
import type { IRenderer } from "../renderers/renderer-interface";
import type { CameraMode, Vec3 } from "../types";
import {
  getHudElements,
  nextCameraMode,
  requireElement,
  updateHUD,
} from "../ui/hud";
import { setupHelpModal } from "../ui/help-modal";
import { updateStickDots } from "../ui/stick-overlay";
import { DroneAudioEngine } from "../audio/drone-audio-engine";
import { subscribeAudioVolume } from "../audio/audio-preferences";
import {
  isCrosshairEnabled,
  subscribeCrosshair,
  isHorizonLineEnabled,
  subscribeHorizonLine,
  isStickOverlayEnabled,
  subscribeStickOverlay,
} from "./crosshair-preferences";
import { STORAGE_KEYS } from "./storage-keys";

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

export type FlightModeName = "acro" | "angle";

export type AppSession = {
  play(control: "keyboard" | "gamepad", mode?: FlightModeName): Promise<boolean>;
  /** Start flying in WebXR goggle mode. Call directly from a click handler. */
  /** "motion" flies DJI Avata-style by pointing the right Touch controller. */
  enterVr(control: "keyboard" | "gamepad" | "motion", mode?: FlightModeName): Promise<void>;
};

export async function startApp(options: AppOrchestratorOptions): Promise<AppSession> {
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
  const audioEngine = new DroneAudioEngine(config);
  const unsubscribeAudioVolume = subscribeAudioVolume(volume => audioEngine.setVolume(volume));
  audioEngine.preload();

  let cameraMode: CameraMode = options.initialCameraMode ?? "orbit";
  let crosshairEnabled = isCrosshairEnabled();
  let horizonLineEnabled = isHorizonLineEnabled();
  const updateHudOverlay = () => {
    const isFpv = cameraMode === "fpv";
    ui.crosshair.classList.toggle("show", crosshairEnabled && isFpv);
    ui.horizonLine.classList.toggle("show", horizonLineEnabled && isFpv);
  };
  updateHudOverlay();
  const unsubscribeCrosshair = subscribeCrosshair((enabled) => {
    crosshairEnabled = enabled;
    updateHudOverlay();
  });
  const unsubscribeHorizonLine = subscribeHorizonLine((enabled) => {
    horizonLineEnabled = enabled;
    updateHudOverlay();
  });

  const cameraSelect = document.getElementById(
    "cameraSelect",
  ) as HTMLSelectElement | null;
  if (cameraSelect) {
    cameraSelect.value = cameraMode;
    cameraSelect.addEventListener("change", () => {
      cameraMode = cameraSelect.value as CameraMode;
      localStorage.setItem(STORAGE_KEYS.camera, cameraMode);
      updateHudOverlay();
    });
  }
  let flightMode: FlightModeName = "angle";
  // The pilot picks the starting mode on the welcome screen; replays keep their own.
  const setStartingFlightMode = (mode: FlightModeName | undefined) => {
    if (!mode || replay || flightStarted) return;
    flightMode = mode;
    simulationEngine.switchFlightMode(flightMode);
  };
  let flightStarted = false;
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
  const calibrateActions = document.getElementById("calibrateActions");

  let activeInputSource: InputSourceKind = "keyboard";
  // WebXR goggle mode: FPV only; the previous camera returns when VR ends.
  let vrActive = false;
  let cameraModeBeforeVr: CameraMode = cameraMode;
  let armedFlightTime = 0;
  let lastFps = 0;
  let stickOverlayEnabled = isStickOverlayEnabled();
  const stickOverlay = document.getElementById("osdStickOverlay");
  const leftStickDot = document.getElementById("osdLeftStickDot");
  const rightStickDot = document.getElementById("osdRightStickDot");

  const updateStickOverlayVisibility = () => {
    const shouldShow =
      flightStarted && activeInputSource !== "keyboard" && stickOverlayEnabled;
    stickOverlay?.classList.toggle("show", shouldShow);
  };
  updateStickOverlayVisibility();

  const unsubscribeStickOverlay = subscribeStickOverlay((enabled) => {
    stickOverlayEnabled = enabled;
    updateStickOverlayVisibility();
  });

  const updateInputSourceUI = (source: InputSourceKind) => {
    activeInputSource = source;
    updateStickOverlayVisibility();
    if (inputSourceBadge) {
      inputSourceBadge.textContent =
        source === "gamepad" ? "RADIO / GAMEPAD"
          : source === "xr" ? "QUEST CONTROLLERS"
            : source === "motion" ? "MOTION CONTROLLER"
              : "KEYBOARD";
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
    if (calibrateActions) calibrateActions.hidden = !available;
    if (gamepadDetectionStatus) {
      gamepadDetectionStatus.textContent = available
        ? "Gamepad detected."
        : "No gamepad detected. Connect one, press a button, then select Detect.";
    }
  };

  const inputProvider = new InputManager({
    callbacks: {
      onReset: () => {
        if (flightStarted && !replay) resetRequested = true;
      },
      onToggleCamera: () => {
        if (!flightStarted || vrActive) return;
        cameraMode = nextCameraMode(cameraMode);
        if (cameraSelect) cameraSelect.value = cameraMode;
        localStorage.setItem(STORAGE_KEYS.camera, cameraMode);
        updateHudOverlay();
      },
      onSwitchFlightMode: () => {
        // The motion controller steers through angle mode only.
        if (!flightStarted || replay || activeInputSource === "motion") return;
        flightMode = flightMode === "acro" ? "angle" : "acro";
        simulationEngine.switchFlightMode(flightMode);
      },
      onToggleRecording: () => {
        if (!flightStarted || replay) return;
        handleToggleRecording();
      },
      onToggleHelp: () => {
        if (!flightStarted) return;
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
    unsubscribeAudioVolume();
    audioEngine.dispose();
    renderer.dispose();
    simulationEngine.dispose();
    throw error;
  }

  simulationEngine.switchFlightMode(flightMode);
  inputProvider.setFlightInputEnabled(false);
  inputProvider.useKeyboard();
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
  const { toggleHelp, closeHelp, dispose: disposeHelpModal } = setupHelpModal();
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
    hoverHint.textContent = `Estimated hover: ${(config.hoverThrottle * 100).toFixed(0)}% at ${config.propulsion.referenceVoltage} V; varies with battery. Angle mode self-levels; press F for acro mode.`;
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
        loading.textContent = `Calibration failed: ${error instanceof Error ? error.message : String(error)}`;
    });
    calibrate?.blur();
  };
  calibrate?.addEventListener("click", onCalibrate);

  const onSwitchToKeyboard = () => {
    inputProvider.useKeyboard();
    activeInputSource = "keyboard";
    updateStickOverlayVisibility();
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

  const onVisibilityChange = () => {
    lastTime = performance.now();
    void audioEngine.setSuspended(document.hidden && !vrActive).catch(() => undefined);
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  const animate = () => {
    if (stopped) return;
    const now = performance.now();
    const deltaTime = (now - lastTime) / 1000;
    lastTime = now;
    // A hidden tab is paused; do not turn time away into a catch-up burst.
    // Some headsets report the page hidden while immersive; keep simulating.
    if (document.hidden && !vrActive) {
      scheduleFrame();
      return;
    }

    const controls = flightStarted
      ? inputProvider.read(deltaTime)
      : createNeutralControls();
    if (!replay && (controls.reset || resetRequested)) {
      pendingRecordedReset = true;
      simulationEngine.reset();
      simulationEngine.switchFlightMode(flightMode);
      ui.statusBanner.classList.remove("show");
      resetRequested = false;
      armedFlightTime = 0;
    }

    if (!replay) simulationEngine.setArmed(controls.arm);
    const telemetry = simulationEngine.step(controls, deltaTime);
    if (telemetry.armed && Number.isFinite(deltaTime)) armedFlightTime += deltaTime;

    if (
      flightStarted &&
      activeInputSource !== "keyboard" &&
      stickOverlayEnabled &&
      leftStickDot &&
      rightStickDot
    ) {
      updateStickDots(controls, leftStickDot, rightStickDot);
    }

    ui.statusBanner.classList.toggle("show", telemetry.crashed);

    renderer.render(telemetry, cameraMode);
    audioEngine.update(telemetry, cameraMode, renderer.getCameraPosition?.(), renderer.getCameraAudioOrientation?.());
    if (now - lastHudUpdate > 100) {
      updateHUD(ui, telemetry, cameraMode, flightMode, crosshairEnabled, horizonLineEnabled);
      if (vrActive) {
        renderer.updateVrOsd?.({
          telemetry,
          flightMode,
          flightTimeSec: armedFlightTime,
          recording: recordingActive,
          recordingSec: recording ? recording.steps.length * recording.fixedTimeStep : 0,
          crosshair: crosshairEnabled,
          horizonLine: horizonLineEnabled,
          sticks: stickOverlayEnabled && activeInputSource !== "keyboard" ? controls : null,
          fps: lastFps,
          latencyMs: 30,
        });
      }
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
      lastFps = frameCount;
      frameCount = 0;
      fpsTime = now;
    }

    scheduleFrame();
  };
  // Renderers that own the frame loop (three.js) keep it running inside WebXR,
  // where window.requestAnimationFrame stops.
  const scheduleFrame = renderer.setFrameLoop
    ? () => {}
    : () => { animationId = requestAnimationFrame(animate); };
  if (renderer.setFrameLoop) renderer.setFrameLoop(animate);
  else scheduleFrame();

  renderer.onVrEnd = () => {
    vrActive = false;
    cameraMode = cameraModeBeforeVr;
    if (cameraSelect) {
      cameraSelect.disabled = false;
      cameraSelect.value = cameraMode;
    }
    inputProvider.leaveXrControllers();
    updateHudOverlay();
    lastTime = performance.now();
    if (loading) loading.textContent = "Left VR goggles.";
  };

  window.addEventListener("beforeunload", () => {
    stopped = true;
    cancelAnimationFrame(animationId);
    renderer.setFrameLoop?.(null);
    calibrate?.removeEventListener("click", onCalibrate);
    recordButton.removeEventListener("click", toggleRecording);
    exportButton.removeEventListener("click", exportRecording);
    stopReplayButton.removeEventListener("click", stopReplay);
    disposeHelpModal();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    inputProvider.dispose();
    unsubscribeAudioVolume();
    unsubscribeCrosshair();
    unsubscribeHorizonLine();
    unsubscribeStickOverlay();
    audioEngine.dispose();
    // Navigation releases the document's WebGL context and workers. Calling
    // Spark.dispose here races its pending GPU readbacks/worker replies.
    // Explicit renderer disposal remains in the initialization failure path.
    simulationEngine.dispose();
  });

  return {
    async play(control, mode) {
      // Create/resume Web Audio while this call still has the user's activation.
      void audioEngine.start();
      setStartingFlightMode(mode);
      if (control === "gamepad") {
        if (!(await inputProvider.useGamepad())) return false;
      } else {
        inputProvider.useKeyboard();
      }
      inputProvider.setFlightInputEnabled(true);
      flightStarted = true;
      updateStickOverlayVisibility();
      lastTime = performance.now();
      return true;
    },
    async enterVr(control, mode) {
      if (!renderer.enterVr) throw new Error("VR goggles need the Three.js renderer.");
      if (vrActive) return;
      // Both calls need the click's user activation, so make them before any await.
      const sessionRequest = requestVrSession();
      void audioEngine.start();
      const session = await sessionRequest;
      await renderer.enterVr(session, loadGogglesSettings());
      setStartingFlightMode(control === "motion" ? "angle" : mode);
      vrActive = true;
      cameraModeBeforeVr = cameraMode;
      cameraMode = "fpv";
      if (cameraSelect) {
        cameraSelect.value = "fpv";
        cameraSelect.disabled = true;
      }
      updateHudOverlay();
      if (control === "motion") {
        inputProvider.useMotionController({
          getPose: () => renderer.getXrControllerPose?.("right") ?? null,
          getTelemetry: () => simulationEngine.getTelemetry(),
          config,
        });
      } else {
        // A radio stays in charge if chosen; otherwise fly with Quest Touch controllers.
        const useRadio = control === "gamepad" || inputProvider.isUsingGamepad();
        if (!(useRadio && (await inputProvider.useGamepad()))) {
          inputProvider.useXrControllers(() => renderer.getXrInputSources?.() ?? null);
        }
      }
      inputProvider.setFlightInputEnabled(true);
      flightStarted = true;
      updateStickOverlayVisibility();
      lastTime = performance.now();
    },
  };
}
