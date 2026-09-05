import "./styles.css";
import { startApp } from "./app/app-orchestrator";
import { DedustWorldConfig, resolveWorldConfig } from "./config/dedust-world-config";
import { FactorySplatWorldConfig } from "./config/factory-splat-world-config";
import type { RendererType } from "./renderers/renderer-factory";
import type { CameraMode, Vec3 } from "./types";

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

startApp({
  rendererType,
  simulationStart,
  rendererStart,
  initialCameraMode,
  worldConfig: isCesium ? undefined : worldConfig,
}).catch((error) => {
  console.error("Failed to start app", error);
  const status = document.getElementById("lodStatus");
  if (status) {
    status.textContent = `Unable to start: ${error instanceof Error ? error.message : String(error)}. Reload to retry.`;
    status.dataset.state = "error";
  }
});

function resolveRendererType(): RendererType {
  const params = new URLSearchParams(window.location.search);
  const param = params.get("renderer") || localStorage.getItem("drone_sim_renderer");
  if (param === "cesium" || param === "threejs") {
    return param;
  }
  return "threejs";
}

function resolveWorldName(): string {
  const params = new URLSearchParams(window.location.search);
  const param = params.get("world") || localStorage.getItem("drone_sim_world");
  return param === "dedust" ? "dedust" : "factory-splat";
}

function resolveWorld(name: string) {
  return name === "dedust" ? DedustWorldConfig : FactorySplatWorldConfig;
}

function resolveCameraMode(cesium: boolean): CameraMode {
  const params = new URLSearchParams(window.location.search);
  const param = params.get("camera") || localStorage.getItem("drone_sim_camera");
  if (param === "fpv" || param === "third" || param === "orbit") {
    return param;
  }
  return cesium ? "third" : "fpv";
}

function setupConfigControls(currentRenderer: RendererType, currentWorld: string): void {
  const rendererSelect = document.getElementById("rendererSelect") as HTMLSelectElement | null;
  const worldSelect = document.getElementById("worldSelect") as HTMLSelectElement | null;
  const worldSelectLabel = document.getElementById("worldSelectLabel");
  const collisionCheckbox = document.getElementById("collisionCheckbox") as HTMLInputElement | null;
  const qualitySelect = document.getElementById("quality") as HTMLSelectElement | null;

  if (rendererSelect) {
    rendererSelect.value = currentRenderer;
    rendererSelect.addEventListener("change", () => {
      const selected = rendererSelect.value;
      localStorage.setItem("drone_sim_renderer", selected);
      const url = new URL(window.location.href);
      url.searchParams.set("renderer", selected);
      window.location.href = url.toString();
    });
  }

  if (worldSelect) {
    worldSelect.value = currentWorld;
    if (currentRenderer === "cesium") {
      worldSelect.disabled = true;
      if (worldSelectLabel) worldSelectLabel.style.opacity = "0.5";
    }
    worldSelect.addEventListener("change", () => {
      const selected = worldSelect.value;
      localStorage.setItem("drone_sim_world", selected);
      const url = new URL(window.location.href);
      url.searchParams.set("world", selected);
      window.location.href = url.toString();
    });
  }

  if (collisionCheckbox) {
    const params = new URLSearchParams(window.location.search);
    collisionCheckbox.checked =
      params.get("collision") === "1" ||
      localStorage.getItem("drone_sim_collision") === "1";

    collisionCheckbox.addEventListener("change", () => {
      const val = collisionCheckbox.checked ? "1" : "0";
      localStorage.setItem("drone_sim_collision", val);
      const url = new URL(window.location.href);
      if (collisionCheckbox.checked) {
        url.searchParams.set("collision", "1");
      } else {
        url.searchParams.delete("collision");
      }
      window.location.href = url.toString();
    });
  }

  if (qualitySelect) {
    const savedQuality = localStorage.getItem("drone_sim_quality");
    if (savedQuality) qualitySelect.value = savedQuality;
    qualitySelect.addEventListener("change", () => {
      localStorage.setItem("drone_sim_quality", qualitySelect.value);
    });
  }
}
