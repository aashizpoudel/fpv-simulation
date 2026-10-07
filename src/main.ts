import { loadFlightConfig, setupFlightSettings } from "./app/flight-settings";
import "./styles.css";
import { setupPwa } from "./pwa";
import type { AppSession } from "./app/app-orchestrator";
import { setupWelcomeScreen } from "./app/welcome-screen";
import { setupVrButtons } from "./ui/vr-buttons";
import { setupWelcomeGamepadStatus } from "./ui/welcome-gamepad-status";
import { setupLoadingOverlay } from "./ui/loading-overlay";
import { resolveWorldConfig } from "./config/world-config";
import {
  resolveCameraMode,
  resolveRendererType,
  resolveWorld,
  resolveWorldName,
} from "./app/url-options";
import { setupConfigControls } from "./app/config-controls";
import type { Vec3 } from "./types";

const rendererType = resolveRendererType();
const isCesium = rendererType === "cesium";
const worldName = resolveWorldName();
const worldConfig = resolveWorldConfig(resolveWorld(worldName));

const simulationStart: Vec3 = isCesium
  ? { x: 0, y: 0, z: 0 }
  : worldConfig.spawnPosition;
const rendererStart: Vec3 = isCesium
  ? { x: -73.985557, y: 40.757964, z: 10 }
  : simulationStart;

const initialCameraMode = resolveCameraMode(isCesium);

setupConfigControls(rendererType, worldName);

const droneConfig = loadFlightConfig();
setupFlightSettings(droneConfig, isCesium ? "cesium" : worldConfig.name);

// Load the simulator (physics, three.js, renderer) as a separate chunk so the
// welcome screen works as soon as this small entry file runs.
const appReady: Promise<AppSession> = import("./app/app-orchestrator").then(({ startApp }) =>
  startApp({
    droneConfig,
    rendererType,
    simulationStart,
    rendererStart,
    initialCameraMode,
    worldConfig: isCesium ? undefined : worldConfig,
  }));
const loadingOverlay = setupLoadingOverlay(appReady);
setupWelcomeScreen(worldName, rendererType, appReady, loadingOverlay.show);
setupWelcomeGamepadStatus();
setupVrButtons(rendererType, appReady, () => ({
  control: welcomeControl(),
  mode: (document.getElementById("welcomeFlightModeSelect") as HTMLSelectElement | null)?.value === "acro"
    ? "acro"
    : "angle",
}));
setupPwa();
void appReady.catch((error) => {
  console.error("Failed to start app", error);
  const status = document.getElementById("lodStatus");
  if (status) {
    status.textContent = `Unable to start: ${error instanceof Error ? error.message : String(error)}. Reload to retry.`;
    status.dataset.state = "error";
  }
});

function welcomeControl(): "keyboard" | "gamepad" | "motion" {
  const value = (document.getElementById("welcomeControlSelect") as HTMLSelectElement | null)?.value;
  return value === "gamepad" || value === "motion" ? value : "keyboard";
}
