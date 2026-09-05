import type { IRenderer } from "./renderer-interface";

export type RendererType = "cesium" | "threejs";

export async function createRenderer(type: RendererType): Promise<IRenderer> {
  switch (type) {
    case "cesium":
      return new (await import("./cesium/cesium-renderer")).CesiumRenderer();
    case "threejs":
      return new (await import("./three/three-renderer")).ThreejsRenderer();
    default:
      throw new Error(`Unknown renderer type: ${type}`);
  }
}
