/*
Cesium renderer for the drone entity and camera modes.
Flow: build viewer + entity -> update pose each frame -> update camera based
on FPV or chase view.

Usage example:
const renderer = createRenderer("cesiumContainer", initialPosition);
updateDroneRender(renderer, pose, cameraMode, hpr, snapFree);
renderer.viewer.render();
*/
import * as Cesium from "cesium";
import type { CameraMode, DronePose, Vec3 } from "./types";

type AxisHelper = {
  entity: Cesium.Entity;
  localDir: Cesium.Cartesian3;
};

type DebugHelpers = {
  rotorOffsets: Cesium.Cartesian3[];
  colliderHalfExtents: Vec3;
  colliderEntity: Cesium.Entity;
  rotorAxisEntities: Cesium.Entity[];
  bodyAxes: AxisHelper[];
};

export type DebugConfig = {
  rotorOffsets: Vec3[];
  colliderHalfExtents: Vec3;
};

type PoseState = {
  position: Cesium.Cartesian3;
  orientation: Cesium.Quaternion;
};

export type Renderer = {
  viewer: Cesium.Viewer;
  droneEntity: Cesium.Entity;
  poseState: PoseState;
  debug?: DebugHelpers;
};

Cesium.Ion.defaultAccessToken =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJiODBlMzBjMy0yNmU1LTQ0ZWItOWIxMi0wZjJmY2E5NjU2OTUiLCJpZCI6MzcwNjIzLCJpYXQiOjE3NjU5ODg1NjF9.wu4MuQiQJKiAtI8XXdZ4-k01V-nqCjwlEcU5abDkoeE";

export function createRenderer(
  containerId: string,
  initialPosition: Cesium.Cartesian3,
): Renderer {
  // Create the Cesium viewer with OSM imagery and minimal UI.
  const viewer = new Cesium.Viewer(containerId, {
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

  // Disable free camera controls by default; modes toggle these on demand.
  const cameraController = viewer.scene.screenSpaceCameraController;
  cameraController.enableRotate = true;
  cameraController.enableZoom = true;
  cameraController.enableTilt = true;
  cameraController.enableTranslate = true;
  cameraController.enableLook = true;

  const poseState: PoseState = {
    position: Cesium.Cartesian3.clone(initialPosition),
    orientation: Cesium.Transforms.headingPitchRollQuaternion(
      initialPosition,
      new Cesium.HeadingPitchRoll(0, 0, 0),
    ),
  };

  let distance = 10;
  let height = 5;
  const offset = new Cesium.Cartesian3(
    0.0, // no east/west offset
    -distance, // behind the entity (negative north)
    height, // above the entity
  );

  // Simple visible proxy for the drone body.
  const droneEntity = viewer.entities.add({
    position: new Cesium.CallbackProperty(
      (_time, result) => Cesium.Cartesian3.clone(poseState.position, result),
      false,
    ),
    orientation: new Cesium.CallbackProperty(
      (_time, result) => Cesium.Quaternion.clone(poseState.orientation, result),
      false,
    ),
    // model: {
    //     uri: "/drone_models/tinyhawk.gltf",
    //     // minimumPixelSize: 60,
    //     // maximumScale: 10000,
    // },
    box: {
      dimensions: new Cesium.Cartesian3(0.105, 0.105, 0.045),
      // dimensions: new Cesium.Cartesian3(10, 10, 4),
      material: Cesium.Color.RED,
    },
    viewFrom: offset,
  });

  viewer.camera.lookAt(
    initialPosition,
    new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(0.0), // Heading: Angle from East
      Cesium.Math.toRadians(-10.0), // Pitch: Angle below the horizon
      5.0, // Range: Distance from the drone
    ),
  );

  return { viewer, droneEntity, poseState };
}

export function updateDroneRender(
  renderer: Renderer,
  drone: DronePose,
  cameraMode: CameraMode,
  hpr: Cesium.HeadingPitchRoll,
  snapFree = false,
) {
  // Sync entity pose to the simulated state; Cesium callbacks read this state.
  Cesium.Cartesian3.clone(drone.position, renderer.poseState.position);
  Cesium.Quaternion.clone(drone.orientation, renderer.poseState.orientation);

  // Keep camera locked onto the drone each frame.
  renderer.viewer.camera.lookAt(
    drone.position,
    new Cesium.HeadingPitchRange(hpr.heading, Cesium.Math.toRadians(-20), 5),
  );
  // const cameraController = renderer.viewer.scene.screenSpaceCameraController;
  // const isFree = true; // = cameraMode === "free";
  // cameraController.enableRotate = isFree;
  // cameraController.enableZoom = isFree;
  // cameraController.enableTilt = isFree;
  // cameraController.enableTranslate = isFree;
  // cameraController.enableLook = isFree;
  // if (isFree) {
  //   if (snapFree) {
  //     const yawRad = hpr.heading;
  //     const chaseOffset = Cesium.Cartesian3.multiplyByScalar(
  //       Cesium.Cartesian3.normalize(
  //         new Cesium.Cartesian3(-Math.sin(yawRad), -Math.cos(yawRad), 0.4),
  //         new Cesium.Cartesian3(),
  //       ),
  //       25,
  //       new Cesium.Cartesian3(),
  //     );
  //     const chasePosition = Cesium.Cartesian3.add(
  //       drone.position,
  //       chaseOffset,
  //       new Cesium.Cartesian3(),
  //     );
  //     renderer.viewer.camera.setView({
  //       destination: chasePosition,
  //       orientation: {
  //         heading: hpr.heading,
  //         pitch: Cesium.Math.toRadians(-15),
  //         roll: 0,
  //       },
  //     });
  //   }
  //   return;
  // }
  // // Update camera based on the selected mode.
  // const isChase = cameraMode === "chase";
  // try {
  //   const yawRad = hpr.heading;
  //   const chaseOffset = Cesium.Cartesian3.multiplyByScalar(
  //     Cesium.Cartesian3.normalize(
  //       new Cesium.Cartesian3(-Math.sin(yawRad), -Math.cos(yawRad), 0.4),
  //       new Cesium.Cartesian3(),
  //     ),
  //     25,
  //     new Cesium.Cartesian3(),
  //   );
  //   const chasePosition = Cesium.Cartesian3.add(
  //     drone.position,
  //     chaseOffset,
  //     new Cesium.Cart.esian3(),
  //   );
  //   renderer.viewer.camera.setView({
  //     destination: isChase ? chasePosition : drone.position,
  //     orientation: {
  //       heading: hpr.heading,
  //       pitch: isChase ? Cesium.Math.toRadians(-15) : hpr.pitch,
  //       roll: isChase ? 0 : hpr.roll,
  //     },
  //   });
  // } catch {
  //   // Ignore camera errors
  //   console.log("LOL")
  // }
}
