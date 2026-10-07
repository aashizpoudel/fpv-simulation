import type { CameraAudioOrientation, CameraMode, DroneTelemetry, Vec3 } from "../types";
import type { DroneConfig } from "../config/drone-config";
import type { WorldConfig } from "../config/world-config";
import type { GogglesSettings } from "../xr/goggles-config";
import type { GogglesOsdState } from "../xr/goggles-osd";

export type XrControllerPose = {
  quaternion: { x: number; y: number; z: number; w: number };
  gamepad: Gamepad | null;
};

export interface IRenderer {
  init(container: HTMLElement, startPosition?: Vec3): Promise<void> | void;
  render(frame: DroneTelemetry, cameraMode: CameraMode): void;
  resize(): void;
  dispose(): void;
  setFeedCanvas?(canvasId: string | null): void;
  setFeedMode?(mode: "auto" | "fpv" | "third"): void;
  setDroneConfig?(config: DroneConfig): void;
  setWorldConfig?(config: WorldConfig): void;
  /** Camera position in simulation-local coordinates for spatial audio. */
  getCameraPosition?(): Vec3;
  getCameraAudioOrientation?(): CameraAudioOrientation;
  /** Optional callback invoked when the map mesh finishes loading. */
  onMapLoaded?: (mapObject: object) => void;
  /**
   * Optional uniform scale applied to the map GLB at load time.
   * Must be set before calling init(). Defaults to 1 (no scaling).
   */
  mapScale?: number;
  /** Drives the app frame loop; required for WebXR, where window rAF stops. */
  setFrameLoop?(callback: (() => void) | null): void;
  /** WebXR goggle mode (FPV only). Only renderers that support VR implement these. */
  enterVr?(session: XRSession, settings: GogglesSettings): Promise<void>;
  exitVr?(): void;
  isVrActive?(): boolean;
  updateVrOsd?(state: GogglesOsdState): void;
  getXrInputSources?(): Iterable<XRInputSource> | null;
  /** World-fixed controller orientation; only valid inside the XR frame loop. */
  getXrControllerPose?(hand: "left" | "right"): XrControllerPose | null;
  /** Called when a VR session ends for any reason (headset removed, user exit). */
  onVrEnd?: () => void;
}
