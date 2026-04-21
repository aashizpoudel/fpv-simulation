import * as Cesium from "cesium";
import { IRenderer } from "../renderer-interface";
import type { CameraMode, DroneTelemetry, Vec3, Quaternion } from "../../types";
import type { DroneConfig } from "../../config/tinyhawk-config";

type PoseState = {
  position: Cesium.Cartesian3;
  orientation: Cesium.Quaternion;
};

export class CesiumRenderer implements IRenderer {
  private viewer!: Cesium.Viewer;
  private droneEntity!: Cesium.Entity;
  private poseState!: PoseState;
  private enuRotation!: Cesium.Matrix3;
  private enuToEcefTransform!: Cesium.Matrix4;
  private enuQuaternion!: Cesium.Quaternion;
  private ecefToEnuTransform!: Cesium.Matrix4;
  private anchor!: Cesium.Cartesian3;
  private modelFixupQuaternion?: Cesium.Quaternion;
  private feedViewer?: Cesium.Viewer;
  private feedMode: "auto" | "fpv" | "third" = "auto";
  private droneConfig?: DroneConfig;
  private scratchCarto = new Cesium.Cartographic();
  private clampZ = 0;
  private lastClampUpdate = 0;
  private clampPending = false;
  private resizeHandler = () => this.resize();



  constructor() {
    Cesium.Ion.defaultAccessToken =
      "CESIUM_ENV";
  }

  public init(container: HTMLElement, startPosition?: Vec3): void {
    const initialPosition = startPosition ?? { x: 0, y: 0, z: 0 };
    const cesiumStartPosition = Cesium.Cartesian3.fromDegrees(
      initialPosition.x,
      initialPosition.y,
      initialPosition.z,
    );
    this.anchor = cesiumStartPosition;

    this.enuToEcefTransform =
      Cesium.Transforms.eastNorthUpToFixedFrame(cesiumStartPosition);
    this.enuRotation = Cesium.Matrix4.getRotation(
      this.enuToEcefTransform,
      new Cesium.Matrix3(),
    );
    this.enuQuaternion = Cesium.Quaternion.fromRotationMatrix(
      this.enuRotation,
      new Cesium.Quaternion(),
    );

    this.ecefToEnuTransform = Cesium.Matrix4.inverse(
      this.enuToEcefTransform,
      new Cesium.Matrix4(),
    );

    this.viewer = new Cesium.Viewer(container, {
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
    this.viewer.scene.globe.depthTestAgainstTerrain = true;

    if (!this.viewer.scene.sampleHeightSupported) {
      console.warn("sampleHeight not supported on this device");
    }



    this.poseState = {
      position: Cesium.Cartesian3.clone(cesiumStartPosition),
      orientation: Cesium.Transforms.headingPitchRollQuaternion(
        cesiumStartPosition,
        new Cesium.HeadingPitchRoll(0, 0, 0),
      ),
    };

    const offset = new Cesium.Cartesian3(-10, 0.0, 5);

    const modelUri =
      this.droneConfig?.modelUrl ??
      `${import.meta.env.BASE_URL}drone_models/tinyhawk.gltf`;

    this.droneEntity = this.viewer.entities.add({
      position: new Cesium.CallbackPositionProperty(
        (_time, result) =>
          Cesium.Cartesian3.clone(this.poseState.position, result),
        false,
      ),
      orientation: new Cesium.CallbackProperty(
        (_time, result) =>
          Cesium.Quaternion.clone(this.poseState.orientation, result),
        false,
      ),
      // box: {
      //   dimensions: new Cesium.Cartesian3(0.1, 0.1, 0.04),
      //   material: Cesium.Color.RED
      // },
      model: {
        uri: modelUri,
        minimumPixelSize: 64,
        maximumScale: 20,
      },
      viewFrom: offset,
    });

    // Initial camera setup: position behind the drone looking at it
    this.viewer.camera.lookAt(
      cesiumStartPosition,
      new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(90), // Camera positioned West, looking East at the drone
        Cesium.Math.toRadians(-20),
        10.0,
      ),
    );

    window.addEventListener("resize", this.resizeHandler);
  }

  private updateClampZ(worldPosition: Cesium.Cartesian3, nowMs: number): void {
    const scene = this.viewer.scene;

    Cesium.Cartographic.fromCartesian(
      worldPosition,
      undefined,
      this.scratchCarto,
    );

    // ---- FAST sync sample (rendered tiles only)
    const h = scene.sampleHeight(this.scratchCarto);
    if (h !== undefined) {
      const groundEcef = Cesium.Cartesian3.fromRadians(
        this.scratchCarto.longitude,
        this.scratchCarto.latitude,
        h,
      );

      const groundEnu = Cesium.Matrix4.multiplyByPoint(
        this.ecefToEnuTransform,
        groundEcef,
        new Cesium.Cartesian3(),
      );

      this.clampZ = groundEnu.z;
    }

    // ---- ASYNC refine (higher LOD)
    if (!this.clampPending && nowMs - this.lastClampUpdate > 150) {
      this.clampPending = true;
      this.lastClampUpdate = nowMs;

      const pos = [Cesium.Cartographic.clone(this.scratchCarto)];

      scene.sampleHeightMostDetailed(pos).then((updated) => {
        this.clampPending = false;
        const sample = updated[0];
        if (!sample || sample.height === undefined) {
          return;
        }

        const groundEcef = Cesium.Cartesian3.fromRadians(
          sample.longitude,
          sample.latitude,
          sample.height,
        );

        const groundEnu = Cesium.Matrix4.multiplyByPoint(
          this.ecefToEnuTransform,
          groundEcef,
          new Cesium.Cartesian3(),
        );

        this.clampZ = groundEnu.z;
      }).catch(() => {
        this.clampPending = false;
      });
    }
  }



  public setFeedCanvas(canvasId: string | null): void {
    if (!canvasId) {
      this.feedViewer?.destroy();
      this.feedViewer = undefined;
      return;
    }

    const container = document.getElementById(canvasId);
    if (!container) {
      this.feedViewer?.destroy();
      this.feedViewer = undefined;
      return;
    }

    this.feedViewer?.destroy();
    container.innerHTML = "";
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

    this.feedViewer.resize();
  }

  public setFeedMode(mode: "auto" | "fpv" | "third"): void {
    this.feedMode = mode;
  }

  public setDroneConfig(config: DroneConfig): void {
    this.droneConfig = config;
  }

  public resize(): void {
    this.viewer?.resize();
    this.feedViewer?.resize();
  }

  public dispose(): void {
    window.removeEventListener("resize", this.resizeHandler);
    this.feedViewer?.destroy();
    this.feedViewer = undefined;
    this.viewer?.destroy();
  }

  public render(frame: DroneTelemetry, cameraMode: CameraMode): void {
    const worldPosition = this.toCesiumPosition(frame.localPosition);
    const worldOrientation = this.toCesiumOrientation(frame.localOrientation);
    Cesium.Cartesian3.clone(worldPosition, this.poseState.position);
    Cesium.Quaternion.clone(worldOrientation, this.poseState.orientation);

    // Get the drone's current heading from its orientation
    const localOrientation = new Cesium.Quaternion(
      frame.localOrientation.x,
      frame.localOrientation.y,
      frame.localOrientation.z,
      frame.localOrientation.w,
    );
    const hpr = Cesium.HeadingPitchRoll.fromQuaternion(localOrientation);

    this.updateCamera(worldPosition, localOrientation, cameraMode);
    this.viewer.render();

    if (this.feedViewer) {
      this.updateFeedCamera(worldPosition, hpr, cameraMode);
      this.feedViewer.render();
    }
  }


  private updateCamera(
    worldPosition: Cesium.Cartesian3,
    worldOrientation: Cesium.Quaternion,
    cameraMode: CameraMode,
  ): void {
    const camera = this.viewer.camera;

    // Convert orientation to HPR
    const hpr = Cesium.HeadingPitchRoll.fromQuaternion(worldOrientation);

    switch (cameraMode) {
      case "fpv": {
        // First-person view: camera at drone position, same orientation
        camera.setView({
          destination: worldPosition,
          orientation: {
            heading: Math.PI / 2 + hpr.heading,
            pitch: hpr.pitch,
            roll: hpr.roll,
          },
        });
        break;
      }

      case "third": {
        // Third-person chase camera (behind and above drone)
        const range = this.getThirdPersonRange();
        const heading = Math.PI / 2 + hpr.heading;
        const pitch = Cesium.Math.toRadians(-20);

        camera.lookAt(
          worldPosition,
          new Cesium.HeadingPitchRange(heading, pitch, range),
        );
        break;
      }

      case "orbit": {
        // Orbit camera: rotates around drone, keeps constant range
        const range = this.getThirdPersonRange();

        // Example: orbit using heading only (no roll)
        const orbitHeading = hpr.heading + Math.PI / 2;
        const orbitPitch = Cesium.Math.toRadians(-30);

        camera.lookAt(
          worldPosition,
          new Cesium.HeadingPitchRange(orbitHeading, orbitPitch, range),
        );
        break;
      }
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
      this.feedViewer.camera.setView({
        destination: position,
        orientation: {
          heading: Math.PI / 2 + hpr.heading,
          pitch: hpr.pitch,
          roll: hpr.roll,
        },
      });
      return;
    }

    const thirdRange = this.getThirdPersonRange();
    this.feedViewer.camera.lookAt(
      position,
      new Cesium.HeadingPitchRange(
        Math.PI / 2 + hpr.heading,
        Cesium.Math.toRadians(-20),
        thirdRange,
      ),
    );
  }

  private getThirdPersonRange(): number {
    const base = this.droneConfig
      ? Math.max(
        this.droneConfig.length,
        this.droneConfig.width,
        this.droneConfig.height,
      )
      : 0.12;
    return Math.max(base * 6, 0.9);
  }

  private getFpvRange(): number {
    const base = this.droneConfig
      ? Math.max(
        this.droneConfig.length,
        this.droneConfig.width,
        this.droneConfig.height,
      )
      : 0.12;
    return Math.max(base * 0.5, 0.1);
  }

  private toCesiumPosition(position: Vec3): Cesium.Cartesian3 {
    // Your local frame: X=forward, Y=left, Z=up
    // ENU frame: X=East, Y=North, Z=Up
    // Direct 1:1 mapping since they align perfectly
    const localPosition = new Cesium.Cartesian3(
      position.x, // forward → East
      position.y, // left → North
      position.z, // up → Up
    );
    return Cesium.Matrix4.multiplyByPoint(
      this.enuToEcefTransform,
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
    // return localOrientation;
    // const inv = Cesium.Quaternion.inverse(localOrientation, new Cesium.Quaternion());
    // // Transform from local ENU frame to Cesium's world frame
    return Cesium.Quaternion.multiply(
      this.enuQuaternion,
      localOrientation,
      new Cesium.Quaternion(),
    );
  }

}
