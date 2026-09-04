import type { CameraMode, DroneTelemetry, Vec3 } from "../types";
import type { DroneConfig } from "../config/tinyhawk-config";
import type { WorldConfig } from "../config/dedust-world-config";

export interface IRenderer {
  init(container: HTMLElement, startPosition?: Vec3): Promise<void> | void;
  render(frame: DroneTelemetry, cameraMode: CameraMode): void;
  resize(): void;
  dispose(): void;
  setFeedCanvas?(canvasId: string | null): void;
  setFeedMode?(mode: "auto" | "fpv" | "third"): void;
  setDroneConfig?(config: DroneConfig): void;
  setWorldConfig?(config: WorldConfig): void;
  /** Optional callback invoked when the map mesh finishes loading. */
  onMapLoaded?: (mapObject: object) => void;
  /**
   * Optional uniform scale applied to the map GLB at load time.
   * Must be set before calling init(). Defaults to 1 (no scaling).
   */
  mapScale?: number;
}
