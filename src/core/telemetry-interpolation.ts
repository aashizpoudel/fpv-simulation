import { Quaternion } from "three";
import type { DroneTelemetry } from "../types";
import type { Snapshot } from "./simulation-messages";

type TimedSnapshot = { time: number; snapshot: Snapshot };
const MAX_BUFFERED_SNAPSHOTS = 8;
const DEFAULT_RENDER_DELAY_MS = 1000 / 120;

/** Smooths the rendered pose; discrete telemetry stays authoritative. */
export class TelemetryInterpolation {
  private frames: TimedSnapshot[] = [];

  clear(): void {
    this.frames = [];
  }

  push(snapshot: Snapshot, time = performance.now()): void {
    const previous = this.frames[this.frames.length - 1];
    if (previous && (
      previous.snapshot.generation !== snapshot.generation ||
      snapshot.step < previous.snapshot.step
    )) {
      // A reset or teleport is a discontinuity: never blend across it.
      this.clear();
    }
    this.frames.push({ time, snapshot });
    if (this.frames.length > MAX_BUFFERED_SNAPSHOTS) this.frames.shift();
  }

  sample(now = performance.now(), delay = DEFAULT_RENDER_DELAY_MS): DroneTelemetry | undefined {
    const latest = this.frames[this.frames.length - 1];
    if (!latest) return;

    // Render one snapshot behind to usually have a pair bracketing the target.
    // If updates stop, hold the latest pose instead of extrapolating forever.
    const target = now - delay;
    let before = this.frames[0];
    let after = before;
    for (const frame of this.frames) {
      if (frame.time <= target) before = frame;
      after = frame;
      if (frame.time >= target) break;
    }
    const duration = after.time - before.time;
    const fraction = duration <= 0 ? 0 : Math.max(0, Math.min(1, (target - before.time) / duration));
    const start = before.snapshot.telemetry;
    const end = after.snapshot.telemetry;
    const p = start.localPosition;
    const q = end.localPosition;
    const startRotation = start.localOrientation;
    const endRotation = end.localOrientation;
    const orientation = new Quaternion(
      startRotation.x, startRotation.y, startRotation.z, startRotation.w,
    ).slerp(new Quaternion(
      endRotation.x, endRotation.y, endRotation.z, endRotation.w,
    ), fraction);

    return {
      ...latest.snapshot.telemetry,
      localPosition: {
        x: p.x + (q.x - p.x) * fraction,
        y: p.y + (q.y - p.y) * fraction,
        z: p.z + (q.z - p.z) * fraction,
      },
      localOrientation: {
        x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w,
      },
    };
  }
}
