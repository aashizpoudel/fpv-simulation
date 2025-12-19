import * as Cesium from "cesium";
import { IRenderer } from "./renderer-interface";
import type { CameraMode, DronePose, Vec3, Quaternion } from "../types";

type PoseState = {
  position: Cesium.Cartesian3;
  orientation: Cesium.Quaternion;
};

export class CesiumRenderer implements IRenderer {
  private viewer: Cesium.Viewer;
  private droneEntity: Cesium.Entity;
  private poseState: PoseState;
  private enuTransform: Cesium.Matrix4;
  private enuRotation: Cesium.Matrix3;
  private enuQuaternion: Cesium.Quaternion;
  private feedViewer?: Cesium.Viewer;
  private feedMode: "auto" | "fpv" | "third" = "auto";

  constructor() {
    Cesium.Ion.defaultAccessToken =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJiODBlMzBjMy0yNmU1LTQ0ZWItOWIxMi0wZjJmY2E5NjU2OTUiLCJpZCI6MzcwNjIzLCJpYXQiOjE3NjU5ODg1NjF9.wu4MuQiQJKiAtI8XXdZ4-k01V-nqCjwlEcU5abDkoeE";
  }

  public init(containerId: string, startPosition: Vec3): void {
    const cesiumStartPosition = Cesium.Cartesian3.fromDegrees(
      startPosition.x,
      startPosition.y,
      startPosition.z,
    );

    this.enuTransform =
      Cesium.Transforms.eastNorthUpToFixedFrame(cesiumStartPosition);
    this.enuRotation = Cesium.Matrix4.getMatrix3(
      this.enuTransform,
      new Cesium.Matrix3(),
    );
    this.enuQuaternion = Cesium.Quaternion.fromRotationMatrix(
      this.enuRotation,
      new Cesium.Quaternion(),
    );

    this.viewer = new Cesium.Viewer(containerId, {
      terrain: Cesium.Terrain.fromWorldTerrain(),
      animation: false,
      timeline: false,
      homeButton: false,
      geocoder: false,
      sceneModePicker: false,
      baseLayerPicker: false,
      navigationHelpButton: false,
      infoBox: false,
      selectionIndicator: false,
      fullscreenButton: false,
      useBrowserRecommendedResolution: false,
      contextOptions: {
        webgl: { powerPreference: "high-performance" },
      },
      useDefaultRenderLoop: false,
    });

    const cameraController = this.viewer.scene.screenSpaceCameraController;
    cameraController.enableRotate = true;
    cameraController.enableZoom = true;
    cameraController.enableTilt = true;
    cameraController.enableTranslate = true;
    cameraController.enableLook = true;

    this.poseState = {
      position: Cesium.Cartesian3.clone(cesiumStartPosition),
      orientation: Cesium.Transforms.headingPitchRollQuaternion(
        cesiumStartPosition,
        new Cesium.HeadingPitchRoll(0, 0, 0),
      ),
    };

    const offset = new Cesium.Cartesian3(-10, 0.0, 5);

    this.droneEntity = this.viewer.entities.add({
      position: new Cesium.CallbackProperty(
        (_time, result) =>
          Cesium.Cartesian3.clone(this.poseState.position, result),
        false,
      ),
      orientation: new Cesium.CallbackProperty(
        (_time, result) =>
          Cesium.Quaternion.clone(this.poseState.orientation, result),
        false,
      ),
      box: {
        dimensions: new Cesium.Cartesian3(0.105, 0.105, 0.045),
        material: Cesium.Color.RED,
      },
      viewFrom: offset,
    });

    this.viewer.camera.lookAt(
      cesiumStartPosition,
      new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(0.0),
        Cesium.Math.toRadians(-10.0),
        5.0,
      ),
    );
  }

  public setFeedCanvas(canvasId: string | null): void {
    if (!canvasId) {
      this.feedViewer?.destroy();
      this.feedViewer = undefined;
      return;
    }

    const canvas = document.getElementById(canvasId);
    if (!canvas) {
      this.feedViewer?.destroy();
      this.feedViewer = undefined;
      return;
    }

    this.feedViewer?.destroy();
    this.feedViewer = new Cesium.Viewer(canvasId, {
      terrain: Cesium.Terrain.fromWorldTerrain(),
      animation: false,
      timeline: false,
      homeButton: false,
      geocoder: false,
      sceneModePicker: false,
      baseLayerPicker: false,
      navigationHelpButton: false,
      infoBox: false,
      selectionIndicator: false,
      fullscreenButton: false,
      useBrowserRecommendedResolution: false,
      contextOptions: {
        webgl: { powerPreference: "low-power" },
      },
      useDefaultRenderLoop: false,
    });

    const controller = this.feedViewer.scene.screenSpaceCameraController;
    controller.enableRotate = false;
    controller.enableZoom = false;
    controller.enableTilt = false;
    controller.enableTranslate = false;
    controller.enableLook = false;
  }

  public setFeedMode(mode: "auto" | "fpv" | "third"): void {
    this.feedMode = mode;
  }

  public update(pose: DronePose, cameraMode: CameraMode): void {
    const worldPosition = this.toCesiumPosition(pose.localPosition);
    const worldOrientation = this.toCesiumOrientation(pose.localOrientation);

    Cesium.Cartesian3.clone(worldPosition, this.poseState.position);
    Cesium.Quaternion.clone(worldOrientation, this.poseState.orientation);

    const hpr = Cesium.HeadingPitchRoll.fromQuaternion(worldOrientation);

    this.viewer.camera.lookAt(
      worldPosition,
      new Cesium.HeadingPitchRange(hpr.heading, Cesium.Math.toRadians(-20), 5),
    );

    this.viewer.render();

    if (this.feedViewer) {
      this.updateFeedCamera(worldPosition, hpr, cameraMode);
      this.feedViewer.render();
    }
  }

  private updateFeedCamera(
    position: Cesium.Cartesian3,
    hpr: Cesium.HeadingPitchRoll,
    cameraMode: CameraMode,
  ): void {
    if (!this.feedViewer) return;
    const mode =
      this.feedMode === "auto"
        ? cameraMode === "fpv"
          ? "third"
          : "fpv"
        : this.feedMode;

    if (mode === "fpv") {
      this.feedViewer.camera.lookAt(
        position,
        new Cesium.HeadingPitchRange(hpr.heading, hpr.pitch, 0.1),
      );
      return;
    }

    this.feedViewer.camera.lookAt(
      position,
      new Cesium.HeadingPitchRange(hpr.heading, Cesium.Math.toRadians(-20), 5),
    );
  }

  private toCesiumPosition(position: Vec3): Cesium.Cartesian3 {
    const localPosition = new Cesium.Cartesian3(
      position.x,
      position.y,
      position.z,
    );
    return Cesium.Matrix4.multiplyByPoint(
      this.enuTransform,
      localPosition,
      new Cesium.Cartesian3(),
    );
  }

  private toCesiumOrientation(orientation: Quaternion): Cesium.Quaternion {
    const localOrientation = new Cesium.Quaternion(
      orientation.x,
      orientation.y,
      orientation.z,
      orientation.w,
    );
    return Cesium.Quaternion.multiply(
      this.enuQuaternion,
      localOrientation,
      new Cesium.Quaternion(),
    );
  }
}
