import * as THREE from "three";
import type { DroneConfig } from "../config/drone-config";
import type { XrControllerPose } from "../renderers/renderer-interface";
import type { Controls, DroneTelemetry } from "../types";
import {
  createNeutralControls,
  type InputActionCallbacks,
  type InputProvider,
} from "./input-provider";
import { MotionAssist, type MotionAssistOptions, type MotionIntent } from "./motion-assist";

export type QuatLike = { x: number; y: number; z: number; w: number };

export type MotionControllerInputProviderOptions = {
  callbacks: InputActionCallbacks;
  getPose: () => XrControllerPose | null;
  getTelemetry: () => DroneTelemetry;
  config: DroneConfig;
  assist?: MotionAssistOptions;
  /** Roll deadzone in degrees (default 5). */
  deadzoneDeg?: number;
  /** Roll for full yaw command in degrees (default 35). */
  fullTiltDeg?: number;
};

// "xr-standard" mapping.
const BTN_TRIGGER = 0;
const BTN_GRIP = 1;
const BTN_STICK = 3;
const BTN_A = 4;
const BTN_B = 5;

const MAX_PITCH = (60 * Math.PI) / 180;
/** Seconds without a pose before an armed drone is told to land. */
const NO_POSE_LAND_S = 1;

const FORWARD = new THREE.Vector3(0, 0, -1);
const RIGHT = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

function pointing(q: THREE.Quaternion): THREE.Vector3 {
  return FORWARD.clone().applyQuaternion(q);
}

function elevation(q: THREE.Quaternion): number {
  return Math.asin(Math.max(-1, Math.min(1, pointing(q).y)));
}

/** Twist about the pointing axis (rad). Positive = right side raised = tilted left (CCW from behind). */
function twist(q: THREE.Quaternion): number {
  const d = pointing(q);
  const levelRight = new THREE.Vector3().crossVectors(d, UP);
  if (levelRight.lengthSq() < 1e-6) return 0; // pointing straight up/down: roll undefined
  levelRight.normalize();
  const levelUp = new THREE.Vector3().crossVectors(levelRight, d);
  const right = RIGHT.clone().applyQuaternion(q);
  return Math.atan2(right.dot(levelUp), right.dot(levelRight));
}

/**
 * Angles of `current` relative to `neutral` (WebXR convention: Y up, pointing along local -Z).
 * pitch: change in elevation of the pointing direction, + up, clamped to +-60 deg.
 * roll: change in twist about the pointing axis, + = tilted left (counter-clockwise seen from behind).
 */
export function motionAnglesFromQuaternions(
  neutral: QuatLike,
  current: QuatLike,
): { pitch: number; roll: number } {
  const n = new THREE.Quaternion(neutral.x, neutral.y, neutral.z, neutral.w).normalize();
  const c = new THREE.Quaternion(current.x, current.y, current.z, current.w).normalize();
  const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, elevation(c) - elevation(n)));
  let roll = twist(c) - twist(n);
  while (roll > Math.PI) roll -= 2 * Math.PI;
  while (roll < -Math.PI) roll += 2 * Math.PI;
  return { pitch, roll };
}

/** Map roll (rad, + left) to yaw -1..1 (+ = turn left) with deadzone and saturation. */
export function rollToYaw(rollRad: number, deadzoneDeg = 5, fullTiltDeg = 35): number {
  const deg = (rollRad * 180) / Math.PI;
  const a = Math.abs(deg);
  if (a <= deadzoneDeg) return 0;
  const span = Math.max(1e-6, fullTiltDeg - deadzoneDeg);
  return Math.sign(deg) * Math.min(1, (a - deadzoneDeg) / span);
}

/**
 * DJI Avata motion-controller style: point to climb/dive, tilt left/right to turn,
 * trigger = forward, grip = reverse, A = brake, B = takeoff/land, stick press = recenter.
 */
export class MotionControllerInputProvider implements InputProvider {
  private readonly callbacks: InputActionCallbacks;
  private readonly getPose: () => XrControllerPose | null;
  private readonly getTelemetry: () => DroneTelemetry;
  private readonly assist: MotionAssist;
  private readonly deadzoneDeg: number;
  private readonly fullTiltDeg: number;
  private neutral: QuatLike | null = null;
  private armed = false;
  private resetPending = false;
  private noPoseTime = 0;
  private landRequested = false;
  private prev: Record<string, boolean> = {};

  constructor(options: MotionControllerInputProviderOptions) {
    this.callbacks = options.callbacks;
    this.getPose = options.getPose;
    this.getTelemetry = options.getTelemetry;
    this.assist = new MotionAssist(options.config, options.assist);
    this.deadzoneDeg = options.deadzoneDeg ?? 5;
    this.fullTiltDeg = options.fullTiltDeg ?? 35;
  }

  init(): void {
    this.clear();
  }

  dispose(): void {
    this.clear();
  }

  read(dt: number): Controls {
    const pose = this.getPose();
    const controls = createNeutralControls();
    controls.throttle = 0;
    controls.thrust = -1;

    const telemetry = this.getTelemetry();
    // A crash cuts the motors; B then resets the drone instead of taking off.
    if (telemetry.crashed && this.armed) {
      this.armed = false;
      this.assist.reset();
    }

    let intent: MotionIntent;
    if (!pose) {
      this.noPoseTime += dt;
      this.prev = {};
      if (this.armed && this.noPoseTime > NO_POSE_LAND_S && !this.landRequested) {
        this.landRequested = true;
        this.assist.land();
      }
      intent = { speed: 0, pitch: 0, yaw: 0, brake: true };
    } else {
      this.noPoseTime = 0;
      if (!this.neutral) this.neutral = { ...pose.quaternion };
      const pad = pose.gamepad;
      const value = (i: number) => pad?.buttons[i]?.value ?? (pad?.buttons[i]?.pressed ? 1 : 0);
      const pressed = (i: number) => Boolean(pad?.buttons[i]?.pressed || value(i) > 0.45);

      this.onRise("stick", pressed(BTN_STICK), () => {
        this.neutral = { ...pose.quaternion };
      });
      this.onRise("b", pressed(BTN_B), () => {
        if (telemetry.crashed) {
          this.resetPending = true;
        } else if (!this.armed) {
          this.armed = true;
          this.landRequested = false;
          this.assist.takeoff();
        } else {
          this.landRequested = true;
          this.assist.land();
        }
      });

      const { pitch, roll } = motionAnglesFromQuaternions(this.neutral, pose.quaternion);
      intent = {
        speed: Math.max(-1, Math.min(1, value(BTN_TRIGGER) - value(BTN_GRIP))),
        pitch,
        yaw: rollToYaw(roll, this.deadzoneDeg, this.fullTiltDeg),
        brake: pressed(BTN_A),
      };
    }

    controls.reset = this.resetPending;
    this.resetPending = false;
    if (!this.armed) {
      controls.arm = false;
      return controls;
    }

    const cmd = this.assist.update(intent, telemetry, dt);
    if (cmd.landed) this.armed = false;
    controls.throttle = cmd.throttle;
    controls.thrust = cmd.throttle * 2 - 1;
    controls.roll = cmd.roll;
    controls.pitch = cmd.pitch;
    controls.yaw = cmd.yaw;
    controls.speedMultiplier = 1;
    controls.arm = this.armed;
    return controls;
  }

  private clear(): void {
    this.armed = false;
    this.neutral = null;
    this.resetPending = false;
    this.noPoseTime = 0;
    this.landRequested = false;
    this.prev = {};
    this.assist.reset();
  }

  private onRise(key: string, pressed: boolean, fn: () => void): void {
    const was = this.prev[key] ?? false;
    this.prev[key] = pressed;
    if (pressed && !was) fn();
  }
}
