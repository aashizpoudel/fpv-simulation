import type { CameraMode, DroneTelemetry, Vec3 } from "../types";

export interface IRenderer {
  init(container: HTMLElement, startPosition?: Vec3): Promise<void> | void;
  render(frame: DroneTelemetry, cameraMode: CameraMode): void;
  resize(): void;
  dispose(): void;
}
