import type { DronePose, Vec3 } from '../types';

export interface IRenderer {
    init(containerId: string, startPosition: Vec3): void;
    update(pose: DronePose, cameraMode: string, snapFreeCamera: boolean): void;
}
