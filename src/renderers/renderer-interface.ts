import type { CameraMode, DroneTelemetry, Vec3 } from "../types";
import type { DroneConfig } from "../config/tinyhawk-config";

export interface IRenderer {
  init(container: HTMLElement, startPosition?: Vec3): Promise<void> | void;
  render(frame: DroneTelemetry, cameraMode: CameraMode): void;
  resize(): void;
  dispose(): void;
  setFeedCanvas?(canvasId: string | null): void;
  setFeedMode?(mode: "auto" | "fpv" | "third"): void;
  setDroneConfig?(config: DroneConfig): void;
}
