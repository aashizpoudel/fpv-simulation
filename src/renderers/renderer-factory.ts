import { CesiumRenderer } from "./cesium/cesium-renderer";
import { PlayCanvasRenderer } from "./playcanvas/playcanvas-renderer";
import { ThreejsRenderer } from "./three/three-renderer";
import type { IRenderer } from "./renderer-interface";

export type RendererType = "cesium" | "playcanvas" | "threejs";

export function createRenderer(type: RendererType): IRenderer {
  switch (type) {
    case "cesium":
      return new CesiumRenderer();
    case "playcanvas":
      return new PlayCanvasRenderer();
    case "threejs":
      return new ThreejsRenderer();
    default:
      throw new Error(`Unknown renderer type: ${type}`);
  }
}
