import type { CameraMode, DronePose, Vec3 } from "../types";
import type { DroneConfig } from "../config/tinyhawk-config";

export interface IRenderer {
  init(containerId: string, startPosition: Vec3): void;
  setFeedCanvas(canvasId: string | null): void;
  setFeedMode(mode: "auto" | "fpv" | "third"): void;
  setDroneConfig(config: DroneConfig): void;
  update(pose: DronePose, cameraMode: CameraMode): void;
}
