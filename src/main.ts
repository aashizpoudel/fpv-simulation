/*
App entry point: wires controls, physics, rendering, and HUD updates.
Flow: init renderer + physics -> map telemetry to Cesium pose -> render + HUD
each frame; reset/toggle camera via input callbacks.

Usage example (from index.html):
<script type="module" src="/src/main.ts"></script>
*/
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./styles.css";
import { setupControls } from "./controls";
import {
  createDronePhysicsFromConfig,
  resetDronePhysics,
  setDroneArmed,
  stepDronePhysics,
  type DronePhysics,
} from "./dronePhysics";
import {
  attachDebugHelpers,
  createRenderer,
  updateDroneRender,
} from "./renderer";
import type { CameraMode, DronePose, DroneTelemetry } from "./types";
import { Vector3 } from "@dimforge/rapier3d-compat";

// Cache required HUD elements once.
const ui = {
  altitude: requireElement("altitude"),
  speed: requireElement("speed"),
  pitch: requireElement("pitch"),
  roll: requireElement("roll"),
  yaw: requireElement("yaw"),
  position: requireElement("position"),
  orientation: requireElement("orientation"),
  cameraMode: requireElement("cameraMode"),
  latitude: requireElement("latitude"),
  longitude: requireElement("longitude"),
  gforce: requireElement("gforce"),
  throttle: requireElement("throttle"),
  thrustBar: requireElement("thrustBar"),
  rotorThrusts: requireElement("rotorThrusts"),
  fps: requireElement("fps"),
  statusBanner: requireElement("statusBanner"),
  attitudeInner: requireSelector<HTMLElement>(".attitude-inner"),
};

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }
  return element;
}

function requireSelector<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

// Core simulation objects.
const startPosition = Cesium.Cartesian3.fromDegrees(-96.67049, 40.832242, 1000);
const renderer = createRenderer("cesiumContainer", startPosition);
let physics: DronePhysics | null = null;
let cameraMode: CameraMode = "free";
let armed = false;
let snapFreeCamera = false;
const enuTransform = Cesium.Transforms.eastNorthUpToFixedFrame(startPosition);
const enuRotation = Cesium.Matrix4.getMatrix3(
  enuTransform,
  new Cesium.Matrix3(),
);
const enuQuaternion = Cesium.Quaternion.fromRotationMatrix(
  enuRotation,
  new Cesium.Quaternion(),
);

// Keyboard controls and callbacks for reset/camera toggle.
const { controls, updateControls } = setupControls({
  onReset: () => {
    if (physics) {
      resetDronePhysics(physics);
      ui.statusBanner.classList.remove("show");
      armed = false;
    }
  },
  onToggleCamera: () => {
    if (cameraMode === "fpv") {
      cameraMode = "chase";
    } else if (cameraMode === "chase") {
      cameraMode = "free";
      snapFreeCamera = true;
    } else {
      cameraMode = "fpv";
    }
  },
  onToggleArm: () => {
    if (physics) {
      armed = !armed;
      setDroneArmed(physics, armed);
    }
  },
  onPushBody: (direction) => {
    if (physics) {
      physics.body.applyImpulse(
        {
          x: direction == 1 ? 0.01 : 0,
          y: direction == 2 ? 0.01 : 0,
          z: direction == 3 ? 0.05 : 0,
        },
        true,
      );
    }
  },
});

// Render telemetry and attitude to the HUD.
function updateHUD(pose: DronePose, hpr: Cesium.HeadingPitchRoll) {
  const cartographic = Cesium.Cartographic.fromCartesian(pose.position);
  const altitude = cartographic.height;
  const speed = Cesium.Cartesian3.magnitude(pose.velocity);
  const pitchDeg = Cesium.Math.toDegrees(hpr.pitch);
  const rollDeg = Cesium.Math.toDegrees(hpr.roll);
  const yawDeg = Cesium.Math.toDegrees(hpr.heading);
  const localOrientation = Cesium.HeadingPitchRoll.fromQuaternion(
    pose.phy_orientation,
  );

  ui.altitude.textContent = `${altitude.toFixed(1)} m`;
  ui.speed.textContent = `${speed.toFixed(1)} m/s`;
  ui.pitch.textContent = `${pitchDeg.toFixed(1)} deg`;
  ui.roll.textContent = `${rollDeg.toFixed(1)} deg`;
  ui.yaw.textContent = `${yawDeg.toFixed(1)} deg`;
  ui.position.textContent = `${pose.phy_position.x.toFixed(2)},${pose.phy_position.y.toFixed(2)},${pose.phy_position.z.toFixed(2)}`;
  ui.orientation.textContent = `${localOrientation.roll.toFixed(2)},${localOrientation.pitch.toFixed(2)},${localOrientation.heading.toFixed(2)}`;
  ui.cameraMode.textContent = cameraMode.toUpperCase();
  ui.latitude.textContent = `${Cesium.Math.toDegrees(cartographic.latitude).toFixed(4)} deg`;
  ui.longitude.textContent = `${Cesium.Math.toDegrees(cartographic.longitude).toFixed(4)} deg`;
  ui.gforce.textContent = `${pose.gforce.toFixed(2)} g`;
  ui.throttle.textContent = `${pose.throttle.toFixed(0)}%`;
  ui.thrustBar.style.width = `${Math.max(0, Math.min(100, pose.throttle))}%`;
  ui.rotorThrusts.textContent = pose.rotorThrusts
    .map((t) => t.toFixed(2))
    .join(", ");

  ui.attitudeInner.style.transform = `rotate(${rollDeg}deg)`;
  ui.attitudeInner.style.backgroundPosition = `0 ${pitchDeg * 2}px`;
}

let lastTime = performance.now();
let frameCount = 0;
let fpsTime = performance.now();

// Convert local Rapier telemetry into Cesium world-space pose data.
function telemetryToPose(telemetry: DroneTelemetry): DronePose {
  const localPosition = new Cesium.Cartesian3(
    telemetry.localPosition.x,
    telemetry.localPosition.y,
    telemetry.localPosition.z,
  );
  const position = Cesium.Matrix4.multiplyByPoint(
    enuTransform,
    localPosition,
    new Cesium.Cartesian3(),
  );
  const localVelocity = new Cesium.Cartesian3(
    telemetry.localVelocity.x,
    telemetry.localVelocity.y,
    telemetry.localVelocity.z,
  );
  const velocity = Cesium.Matrix3.multiplyByVector(
    enuRotation,
    localVelocity,
    new Cesium.Cartesian3(),
  );
  const localOrientation = new Cesium.Quaternion(
    telemetry.localOrientation.x,
    telemetry.localOrientation.y,
    telemetry.localOrientation.z,
    telemetry.localOrientation.w,
  );
  const orientation = Cesium.Quaternion.multiply(
    enuQuaternion,
    localOrientation,
    new Cesium.Quaternion(),
  );

  const phy_position = telemetry.localPosition;
  const phy_orientation = telemetry.localOrientation;

  return {
    phy_position,
    phy_orientation,
    position,
    orientation,
    velocity,
    gforce: telemetry.gforce,
    throttle: telemetry.throttle,
    rotorThrusts: telemetry.rotorThrusts,
    crashed: telemetry.crashed,
  };
}

// Main animation loop: input -> physics -> render -> HUD.
function animate() {
  if (!physics) {
    return;
  }
  const now = performance.now();
  const deltaTime = (now - lastTime) / 1000;
  // console.log(deltaTime)
  lastTime = now;

  updateControls();
  const telemetry = stepDronePhysics(physics, controls, deltaTime);
  // console.log(telemetry);
  // if (telemetry.crashed) {
  //   ui.statusBanner.classList.add("show");
  // }

  const pose = telemetryToPose(telemetry);
  const hpr = Cesium.HeadingPitchRoll.fromQuaternion(pose.orientation);
  updateDroneRender(renderer, pose, cameraMode, hpr, snapFreeCamera);

  updateHUD(pose, hpr);
  renderer.viewer.render();

  frameCount += 1;
  if (now - fpsTime >= 1000) {
    ui.fps.textContent = String(frameCount);
    frameCount = 0;
    fpsTime = now;
  }

  requestAnimationFrame(animate);
}

async function start() {
  physics = await createDronePhysicsFromConfig();
  resetDronePhysics(physics);
  requestAnimationFrame(animate);
}

start();
