import { IRenderer } from './renderer-interface';
import { CesiumRenderer } from './cesium-renderer';
import { ThreejsRenderer } from './three-renderer';

export type RendererType = 'cesium' | 'threejs';

export function createRenderer(type: RendererType): IRenderer {
    switch (type) {
        case 'cesium':
            return new CesiumRenderer();
        case 'threejs':
            return new ThreejsRenderer();
        default:
            throw new Error(`Unknown renderer type: ${type}`);
    }
}
