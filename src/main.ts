import "./styles.css";
import { startApp } from "./app/app-orchestrator";
import { DedustWorldConfig, resolveWorldConfig } from "./config/dedust-world-config";
import type { RendererType } from "./renderers/renderer-factory";
import type { Vec3 } from "./types";

const rendererType = resolveRendererType();
const isCesium = rendererType === "cesium";

const worldConfig = resolveWorldConfig(DedustWorldConfig);

const simulationStart: Vec3 = isCesium
  ? { x: 0, y: 0, z: 0 }
  : worldConfig.spawnPosition;
const rendererStart: Vec3 = isCesium
  ? { x: -73.985557, y: 40.757964, z: 10 }
  : simulationStart;

startApp({
  rendererType,
  simulationStart,
  rendererStart,
  initialCameraMode: isCesium ? "third" : "orbit",
  worldConfig: isCesium ? undefined : worldConfig,
}).catch((error) => {
  console.error("Failed to start app", error);
});

function resolveRendererType(): RendererType {
  const param = new URLSearchParams(window.location.search).get("renderer");
  if (param === "cesium" || param === "threejs") {
    return param;
  }
  return "threejs";
}
