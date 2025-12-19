/*
App entry point: wires controls, physics, rendering, and HUD updates.
Flow: init renderer + physics -> map telemetry to pose -> render + HUD
each frame; reset/toggle camera via input callbacks.
*/
import "./styles.css";
import { setupControls } from "./controls";
import { createPhysics, PhysicsType } from "./physics/physics-factory";
import { createRenderer, RendererType } from "./rendering/renderer-factory";
import type { CameraMode, DronePose, DroneTelemetry } from "./types";
import { IPhysics } from "./physics/physics-interface";
import { IRenderer } from "./rendering/renderer-interface";

// --- Configuration ---
const RENDERER_TYPE: RendererType = "threejs";
const PHYSICS_TYPE: PhysicsType = "rapier";
// ---------------------

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
  if (!element) throw new Error(`Missing required element: ${id}`);
  return element;
}

function requireSelector<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

// Core simulation objects.
const startPosition = { x: 0, y: 0, z: 1 };
let renderer: IRenderer;
let physics: IPhysics;
let cameraMode: CameraMode = "free";
let snapFreeCamera = false;

// Keyboard controls and callbacks for reset/camera toggle.
const { controls, updateControls } = setupControls({
  onReset: () => {
    if (physics) {
      physics.reset();
      ui.statusBanner.classList.remove("show");
    }
  },
  onToggleCamera: () => {
    if (cameraMode === "fpv") cameraMode = "chase";
    else if (cameraMode === "chase") {
      cameraMode = "free";
      snapFreeCamera = true;
    } else cameraMode = "fpv";
  },
  onToggleArm: () => {
    if (physics) {
      physics.setArmed(true);
    }
  },
  onPushBody: (direction) => {
    if (physics) {
      physics.togglePush(direction);
    }
  },
});

function updateHUD(pose: DronePose) {
  // This function will need to be adapted depending on the renderer
  // For now, we'll just display the raw data.
  ui.altitude.textContent = `${pose.worldPosition.z.toFixed(1)} m`;
  ui.speed.textContent = `${Math.sqrt(pose.worldVelocity.x ** 2 + pose.worldVelocity.y ** 2 + pose.worldVelocity.z ** 2).toFixed(1)} m/s`;
  ui.pitch.textContent = `${pose.localOrientation.x.toFixed(1)} deg`;
  ui.roll.textContent = `${pose.localOrientation.y.toFixed(1)} deg`;
  ui.yaw.textContent = `${pose.localOrientation.z.toFixed(1)} deg`;
  ui.position.textContent = `${pose.localPosition.x.toFixed(2)},${pose.localPosition.y.toFixed(2)},${pose.localPosition.z.toFixed(2)}`;
  ui.orientation.textContent = `${pose.localOrientation.x.toFixed(2)},${pose.localOrientation.y.toFixed(2)},${pose.localOrientation.z.toFixed(2)}`;
  ui.cameraMode.textContent = cameraMode.toUpperCase();
  ui.latitude.textContent = `N/A`;
  ui.longitude.textContent = `N/A`;
  ui.gforce.textContent = `${pose.gforce.toFixed(2)} g`;
  ui.throttle.textContent = `${pose.throttle.toFixed(0)}%`;
  ui.thrustBar.style.width = `${Math.max(0, Math.min(100, pose.throttle))}%`;
  ui.rotorThrusts.textContent = pose.rotorThrusts
    .map((t) => t.toFixed(2))
    .join(", ");

  // Attitude indicator might need renderer-specific data.
  // ui.attitudeInner.style.transform = `rotate(${rollDeg}deg)`;
  // ui.attitudeInner.style.backgroundPosition = `0 ${pitchDeg * 2}px`;
}

let lastTime = performance.now();
let frameCount = 0;
let fpsTime = performance.now();

function telemetryToPose(telemetry: DroneTelemetry): DronePose {
  // This is a simplified conversion. The actual world position/orientation
  // will be calculated inside the renderer based on its coordinate system.
  return {
    localPosition: telemetry.localPosition,
    localOrientation: telemetry.localOrientation,
    worldPosition: telemetry.localPosition, // Placeholder
    worldOrientation: telemetry.localOrientation, // Placeholder
    worldVelocity: telemetry.localVelocity,
    gforce: telemetry.gforce,
    throttle: telemetry.throttle,
    rotorThrusts: telemetry.rotorThrusts,
    crashed: telemetry.crashed,
  };
}

function animate() {
  if (!physics || !renderer) {
    requestAnimationFrame(animate);
    return;
  }

  const now = performance.now();
  const deltaTime = (now - lastTime) / 1000;
  lastTime = now;

  updateControls(deltaTime);
  const telemetry = physics.step(controls, deltaTime);

  if (telemetry.crashed) {
    ui.statusBanner.classList.add("show");
  }

  const pose = telemetryToPose(telemetry);

  renderer.update(pose, cameraMode, snapFreeCamera);
  updateHUD(pose);

  frameCount += 1;
  if (now - fpsTime >= 1000) {
    ui.fps.textContent = String(frameCount);
    frameCount = 0;
    fpsTime = now;
  }

  snapFreeCamera = false;
  requestAnimationFrame(animate);
}

async function start() {
  renderer = createRenderer(RENDERER_TYPE);
  renderer.init("cesiumContainer", startPosition);

  physics = createPhysics(PHYSICS_TYPE);
  await physics.init();

  physics.reset();

  requestAnimationFrame(animate);
}

start();
