import { loadFlightConfig, setupFlightSettings } from "./app/flight-settings";
import "./styles.css";
import { setupPwa } from "./pwa";
import { startApp } from "./app/app-orchestrator";
import { setupWelcomeScreen } from "./app/welcome-screen";
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

const appReady = startApp({
  droneConfig,
  rendererType,
  simulationStart,
  rendererStart,
  initialCameraMode,
  worldConfig: isCesium ? undefined : worldConfig,
});
setupWelcomeScreen(worldName, rendererType, appReady);
setupPwa();
void appReady.catch((error) => {
  console.error("Failed to start app", error);
  const status = document.getElementById("lodStatus");
  if (status) {
    status.textContent = `Unable to start: ${error instanceof Error ? error.message : String(error)}. Reload to retry.`;
    status.dataset.state = "error";
  }
});
