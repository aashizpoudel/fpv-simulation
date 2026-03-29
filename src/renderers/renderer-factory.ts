import { CesiumRenderer } from "./cesium/cesium-renderer";
import { ThreejsRenderer } from "./three/three-renderer";
import type { IRenderer } from "./renderer-interface";

export type RendererType = "cesium" | "threejs";

export function createRenderer(type: RendererType): IRenderer {
  switch (type) {
    case "cesium":
      return new CesiumRenderer();
    case "threejs":
      return new ThreejsRenderer();
    default:
      throw new Error(`Unknown renderer type: ${type}`);
  }
}
