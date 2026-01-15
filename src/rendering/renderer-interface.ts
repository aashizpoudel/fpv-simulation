import type { CameraMode, Controls, DronePose, DroneTelemetry, Vec3 } from "../types";
import type { DroneConfig } from "../config/tinyhawk-config";
import { IPhysics } from "../physics/physics-interface";

export interface IRenderer {
  init(containerId: string, startPosition: Vec3): void;
  setFeedCanvas(canvasId: string | null): void;
  setFeedMode(mode: "auto" | "fpv" | "third"): void;
  setDroneConfig(config: DroneConfig): void;
  update(controls: Controls, deltaTime:number, cameraMode: CameraMode): DroneTelemetry;
  setupPhysics(physics: IPhysics): void;
}
