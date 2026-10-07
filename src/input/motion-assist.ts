/*
  Motion-controller assist (point-and-fly).
  Turns a pilot intent + drone telemetry into ordinary ANGLE-mode stick commands
  (roll/pitch/yaw in -1..1) and an absolute throttle (0..1). No new flight mode.

  Sign conventions (verified against the real simulation, see tests):
    +pitch stick -> tilts nose down, accelerates along body +X (forward)
    +roll stick  -> accelerates toward body -Y (RIGHT); left accel needs -roll
    +yaw stick   -> heading psi increases (turn LEFT, CCW from above)
*/

import type { DroneConfig } from "../config/drone-config";
import type { DroneTelemetry } from "../types";
import { clamp, quaternionToEuler } from "../controllers/math-utils";
import { shapeStick } from "../controllers/rates";

export type MotionIntent = {
  /** -1..1: trigger forward speed; negative = fly backward. */
  speed: number;
  /** Controller elevation relative to neutral, radians (+ = pointing up). The drone flies along this direction: vertical speed = speed·maxSpeed·sin(pitch), horizontal = ·cos(pitch). */
  pitch: number;
  /** -1..1 yaw rate command, + = turn LEFT (counter-clockwise seen from above, Z-up). */
  yaw: number;
  /** Hold position (brake) while true. */
  brake: boolean;
};

export type MotionAssistOptions = {
  /** m/s, default 4 */
  maxSpeed?: number;
  /** m/s cap on vertical speed, default 2 */
  maxClimb?: number;
  /** m, default 1.2 */
  takeoffHeight?: number;
};

export type MotionCommand = {
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number;
  /** true once a landing finished on the ground: caller should disarm */
  landed: boolean;
};

type Phase = "ground" | "takeoff" | "flying" | "landing";

const G = 9.81;
const KV_HORIZ = 2.5; // 1/s: velocity error -> acceleration
const KI_HORIZ = 0.6; // 1/s^2: removes drag-induced steady error
const I_HORIZ_MAX = 2; // m/s^2
const KP_ALT = 2; // 1/s: altitude error -> climb rate
const KP_VZ = 0.12; // throttle per m/s
const KI_VZ = 0.15; // throttle per m (integrated)
const I_VZ_MAX = 0.25;
const TILT_LIMIT = (35 * Math.PI) / 180; // never ask for more than this tilt
const TAKEOFF_CLIMB = 1; // m/s
const LAND_SPEED = 0.5; // m/s
const LAND_FLARE_HEIGHT = 0.25; // m above ground: slow to 0.25 m/s
const GROUND_EPS = 0.04; // m above ground counted as touchdown
const AIRBORNE_EPS = 0.3; // m above ground: idle assist considers itself flying

/** Inverse of the angle mode's cubic expo so stick maps linearly to angle. */
function unshape(target: number, expo: number): number {
  if (expo <= 0) return target;
  let lo = -1;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (shapeStick(mid, expo) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export class MotionAssist {
  private readonly maxSpeed: number;
  private readonly maxClimb: number;
  private readonly takeoffHeight: number;
  private readonly hoverThrottle: number;
  private readonly maxAngle: number; // rad, effective tilt limit
  private readonly stickAngle: number; // rad, angle at full stick
  private readonly expo: number;

  private phase: Phase = "ground";
  private pendingTakeoff = false;
  private pendingLand = false;
  private groundZ: number | null = null;
  private altTarget = 0;
  private altInit = false;
  private ivx = 0;
  private ivy = 0;
  private ivz = 0;
  private stallTime = 0;
  private landedFlag = false;

  constructor(config: DroneConfig, options: MotionAssistOptions = {}) {
    this.maxSpeed = options.maxSpeed ?? 4;
    this.maxClimb = options.maxClimb ?? 2;
    this.takeoffHeight = options.takeoffHeight ?? 1.2;
    this.hoverThrottle = config.hoverThrottle;
    const stick = (config.pidAngleConfig?.maxAngle.roll ?? 45) * (Math.PI / 180);
    this.stickAngle = stick;
    this.maxAngle = Math.min(stick, TILT_LIMIT);
    this.expo = config.rates?.expo ?? 0;
  }

  /** Clear integrators, targets and takeoff/land state. */
  reset(): void {
    this.phase = "ground";
    this.pendingTakeoff = false;
    this.pendingLand = false;
    this.groundZ = null;
    this.altInit = false;
    this.altTarget = 0;
    this.ivx = this.ivy = this.ivz = 0;
    this.stallTime = 0;
    this.landedFlag = false;
  }

  /** Auto climb to takeoffHeight above the altitude where it was called, then hover. */
  takeoff(): void {
    this.pendingTakeoff = true;
    this.landedFlag = false;
    this.pendingLand = false;
  }

  /** Descend gently until on the ground, then report landed. */
  land(): void {
    this.pendingLand = true;
    this.pendingTakeoff = false;
  }

  update(intent: MotionIntent, telemetry: DroneTelemetry, dt: number): MotionCommand {
    const z = telemetry.localPosition.z;
    const v = telemetry.localVelocity;
    const idle: MotionCommand = {
      roll: 0,
      pitch: 0,
      yaw: 0,
      throttle: 0,
      landed: this.landedFlag,
    };
    if (!(dt > 0)) return idle;

    if (this.groundZ === null) this.groundZ = z;

    // Phase transitions requested by the caller.
    if (this.pendingTakeoff) {
      this.pendingTakeoff = false;
      this.groundZ = z;
      this.altTarget = z;
      this.altInit = true;
      this.ivz = 0;
      this.phase = "takeoff";
    }
    if (this.pendingLand) {
      this.pendingLand = false;
      if (this.phase !== "ground") {
        this.phase = "landing";
        this.altTarget = z;
        this.altInit = true;
        this.stallTime = 0;
      }
    }
    // Started mid-air without takeoff(): just fly from here.
    if (this.phase === "ground" && z > this.groundZ + AIRBORNE_EPS) {
      this.phase = "flying";
      this.altTarget = z;
      this.altInit = true;
    }
    if (this.phase === "ground") {
      this.groundZ = Math.min(this.groundZ, z);
      return idle;
    }
    if (!this.altInit) {
      this.altTarget = z;
      this.altInit = true;
    }

    const psi = quaternionToEuler(telemetry.localOrientation).yaw;
    const cosP = Math.cos(psi);
    const sinP = Math.sin(psi);

    // Desired world velocity.
    let vdx = 0;
    let vdy = 0;
    let vdz = 0;
    if (this.phase === "flying" && !intent.brake) {
      const s = clamp(intent.speed, -1, 1) * this.maxSpeed;
      const horiz = s * Math.cos(intent.pitch);
      vdx = horiz * cosP;
      vdy = horiz * sinP;
      vdz = clamp(s * Math.sin(intent.pitch), -this.maxClimb, this.maxClimb);
    }

    // Altitude target.
    const height = z - (this.groundZ ?? z);
    let vzFF = vdz;
    if (this.phase === "takeoff") {
      const goal = (this.groundZ ?? z) + this.takeoffHeight;
      this.altTarget = goal;
      vzFF = 0;
      if (Math.abs(z - goal) < 0.1 && Math.abs(v.z) < 0.4) {
        this.phase = "flying";
        this.altTarget = goal;
      }
    } else if (this.phase === "landing") {
      const speed = height < LAND_FLARE_HEIGHT ? LAND_SPEED / 2 : LAND_SPEED;
      this.altTarget -= speed * dt;
      vzFF = -speed;
    } else {
      this.altTarget += vdz * dt;
    }
    // Do not let the target run away from a lagging drone.
    if (this.phase !== "takeoff") this.altTarget = clamp(this.altTarget, z - 1, z + 1);

    // Horizontal: velocity error -> acceleration -> tilt.
    const ex = vdx - v.x;
    const ey = vdy - v.y;
    this.ivx = clamp(this.ivx + KI_HORIZ * ex * dt, -I_HORIZ_MAX, I_HORIZ_MAX);
    this.ivy = clamp(this.ivy + KI_HORIZ * ey * dt, -I_HORIZ_MAX, I_HORIZ_MAX);
    let ax = KV_HORIZ * ex + this.ivx;
    let ay = KV_HORIZ * ey + this.ivy;
    const aMax = G * Math.tan(this.maxAngle);
    const aMag = Math.hypot(ax, ay);
    if (aMag > aMax) {
      ax *= aMax / aMag;
      ay *= aMax / aMag;
    }
    // World -> heading frame (forward, left).
    const aF = cosP * ax + sinP * ay;
    const aL = -sinP * ax + cosP * ay;
    const tiltF = Math.atan2(aF, G); // + = accelerate forward
    const tiltL = Math.atan2(aL, G); // + = accelerate left
    const pitchCmd = unshape(clamp(tiltF / this.stickAngle, -1, 1), this.expo);
    const rollCmd = unshape(clamp(-tiltL / this.stickAngle, -1, 1), this.expo);

    // Vertical: altitude P -> climb-rate target, then PI on vz to throttle.
    const climbCap = this.phase === "takeoff" ? TAKEOFF_CLIMB : this.maxClimb;
    const vzTarget = clamp(KP_ALT * (this.altTarget - z) + vzFF, -climbCap, climbCap);
    const evz = vzTarget - v.z;
    const tilt = Math.hypot(tiltF, tiltL);
    const ff = clamp(this.hoverThrottle / Math.sqrt(Math.max(Math.cos(tilt), 0.5)), 0, 1);
    const unsat = ff + KP_VZ * evz + this.ivz;
    // Anti-windup: only integrate while not saturated (or when it helps).
    if ((unsat < 1 || evz < 0) && (unsat > 0 || evz > 0)) {
      this.ivz = clamp(this.ivz + KI_VZ * evz * dt, -I_VZ_MAX, I_VZ_MAX);
    }
    const throttle = clamp(ff + KP_VZ * evz + this.ivz, 0, 1);

    // Landing detection: on the ground or no longer descending near it.
    let landed = false;
    if (this.phase === "landing") {
      const nearGround = height < GROUND_EPS + 0.1;
      this.stallTime = nearGround && Math.abs(v.z) < 0.1 ? this.stallTime + dt : 0;
      if (height < GROUND_EPS || this.stallTime > 0.25) {
        landed = true;
        this.landedFlag = true;
        this.phase = "ground";
        this.ivx = this.ivy = this.ivz = 0;
        return { roll: 0, pitch: 0, yaw: 0, throttle: 0, landed };
      }
    }

    return {
      roll: rollCmd,
      pitch: pitchCmd,
      yaw: clamp(intent.yaw, -1, 1),
      throttle,
      landed,
    };
  }
}
