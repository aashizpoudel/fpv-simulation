import { DedustWorldConfig } from "../config/dedust-world-config";
import { FactorySplatWorldConfig } from "../config/factory-splat-world-config";
import { EkotoriWorldConfig } from "../config/ekotori-world-config";
import type { RendererType } from "../renderers/renderer-factory";
import type { CameraMode } from "../types";
import { STORAGE_KEYS } from "./storage-keys";

export function resolveRendererType(): RendererType {
  const params = new URLSearchParams(window.location.search);
  const param = params.get("renderer") || localStorage.getItem(STORAGE_KEYS.renderer);
  if (param === "cesium" || param === "threejs") {
    return param;
  }
  return "threejs";
}

export function resolveWorldName(): string {
  const params = new URLSearchParams(window.location.search);
  const param = params.get("world") || localStorage.getItem(STORAGE_KEYS.world);
  return param === "ekotori" || param === "dedust" ? param : "factory-splat";
}

export function resolveWorld(name: string) {
  if (name === "ekotori") return EkotoriWorldConfig;
  return name === "dedust" ? DedustWorldConfig : FactorySplatWorldConfig;
}

export function resolveCameraMode(cesium: boolean): CameraMode {
  const params = new URLSearchParams(window.location.search);
  const param = params.get("camera") || localStorage.getItem(STORAGE_KEYS.camera);
  if (param === "fpv" || param === "third" || param === "orbit") {
    return param;
  }
  return cesium ? "third" : "fpv";
}
