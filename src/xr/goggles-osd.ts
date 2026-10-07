/*
  Canvas-drawn OSD for the WebXR DJI O3 goggles view.
  HTML overlays are invisible in VR, so the OSD is rendered into a transparent
  canvas texture that is shown over the goggle video feed.

  Usage example:
  const osd = new GogglesOsd();
  osd.setFeedRect({ x: 240, y: 0, width: 1440, height: 1080 });
  osd.update({ telemetry, flightMode: "angle", flightTimeSec: 12, recording: false,
    crosshair: true, horizonLine: false, latencyMs: 30 });
*/

import * as THREE from "three";
import type { Controls, DroneTelemetry, Vec3 } from "../types";
import { clamp, quaternionToEulerDeg } from "../controllers/math-utils";

export type GogglesOsdRect = { x: number; y: number; width: number; height: number };

export type GogglesOsdState = {
  telemetry: DroneTelemetry;
  flightMode: "acro" | "angle";
  flightTimeSec: number;
  recording: boolean;
  recordingSec?: number;
  crosshair: boolean;
  horizonLine: boolean;
  sticks?: Controls | null;
  fps?: number;
  latencyMs: number;
};

/** Format seconds as "M:SS" (under 10 minutes) or "MM:SS". */
export function formatFlightTime(sec: number): string {
  const total = Number.isFinite(sec) ? Math.max(0, Math.floor(sec)) : 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Speed magnitude of a velocity in m/s, converted to km/h. */
export function speedKmh(vel: Vec3): number {
  return Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2) * 3.6;
}

const SAFE_MARGIN = 0.04;
const WHITE = "#ffffff";
const RED = "#ff3030";
const OUTLINE = "rgba(0,0,0,0.85)";

export class GogglesOsd {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly width: number;
  private readonly height: number;
  private feed: GogglesOsdRect;

  constructor(width = 1920, height = 1080) {
    this.width = width;
    this.height = height;
    this.feed = { x: 0, y: 0, width, height };
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d");
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  /** Set the area (canvas pixels) the video occupies; OSD anchors to it. */
  setFeedRect(rect: GogglesOsdRect): void {
    this.feed = { ...rect };
  }

  /** Redraw the OSD and flag the texture for upload. */
  update(state: GogglesOsdState): void {
    const ctx = this.ctx;
    if (ctx) this.draw(ctx, state);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }

  private text(
    ctx: CanvasRenderingContext2D,
    str: string,
    x: number,
    y: number,
    align: CanvasTextAlign,
    color = WHITE,
  ): void {
    ctx.textAlign = align;
    ctx.strokeStyle = OUTLINE;
    ctx.fillStyle = color;
    ctx.strokeText(str, x, y);
    ctx.fillText(str, x, y);
  }

  private draw(ctx: CanvasRenderingContext2D, s: GogglesOsdState): void {
    const { feed } = this;
    const t = s.telemetry;
    const fontPx = Math.round(this.height / 28);
    const mx = feed.width * SAFE_MARGIN;
    const my = feed.height * SAFE_MARGIN;
    const left = feed.x + mx;
    const right = feed.x + feed.width - mx;
    const top = feed.y + my;
    const bottom = feed.y + feed.height - my;
    const cx = feed.x + feed.width / 2;
    const cy = feed.y + feed.height / 2;

    ctx.clearRect(0, 0, this.width, this.height);
    ctx.font = `bold ${fontPx}px monospace`;
    ctx.lineWidth = Math.max(2, fontPx / 6);
    ctx.textBaseline = "middle";

    // Center overlays first so text sits on top.
    if (s.horizonLine) this.drawHorizon(ctx, t, cx, cy, feed.width);
    if (s.crosshair) this.drawCrosshair(ctx, cx, cy, fontPx);

    // Top row.
    const volts = (t.batteryVoltage ?? 0).toFixed(2);
    const charge = Math.round((t.batteryCharge ?? 0) * 100);
    this.text(ctx, `${volts}V`, left, top + fontPx / 2, "left");
    this.text(ctx, `${charge}%`, left, top + fontPx * 1.7, "left");

    const status = t.crashed ? "CRASHED" : t.armed ? "ARMED" : "DISARMED";
    this.text(ctx, s.flightMode.toUpperCase(), cx, top + fontPx / 2, "center");
    this.text(ctx, status, cx, top + fontPx * 1.7, "center", t.crashed ? RED : WHITE);

    this.text(ctx, `${Math.round(s.latencyMs)}ms`, right, top + fontPx / 2, "right");
    this.drawSignalBars(ctx, right, top + fontPx * 1.1, fontPx);
    if (s.fps != null) {
      this.text(ctx, `${Math.round(s.fps)}FPS`, right, top + fontPx * 2.7, "right");
    }

    // Side readouts.
    this.text(ctx, speedKmh(t.localVelocity).toFixed(0), left, cy - fontPx / 2, "left");
    this.text(ctx, "KM/H", left, cy + fontPx / 2, "left");
    this.text(ctx, `${t.localPosition.z.toFixed(1)}M`, right, cy, "right");

    // Bottom row.
    const thr = clamp(t.throttle, 0, 100);
    this.text(ctx, formatFlightTime(s.flightTimeSec), left, bottom - fontPx / 2, "left");
    this.text(ctx, `THR ${thr.toFixed(0)}%`, right, bottom - fontPx / 2, "right");
    if (s.recording) {
      this.text(
        ctx,
        `● REC ${formatFlightTime(s.recordingSec ?? 0)}`,
        cx,
        bottom - fontPx / 2,
        "center",
        RED,
      );
    }
    if (s.sticks) {
      const box = fontPx * 3;
      const gap = fontPx * 1.5;
      const by = bottom - fontPx * 1.6 - box;
      this.drawSticks(ctx, s.sticks, cx - gap / 2 - box, by, cx + gap / 2, box);
    }
  }

  private drawCrosshair(ctx: CanvasRenderingContext2D, cx: number, cy: number, fontPx: number): void {
    const r = fontPx * 0.5;
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = Math.max(2, fontPx / 10);
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();
  }

  private drawHorizon(
    ctx: CanvasRenderingContext2D,
    t: DroneTelemetry,
    cx: number,
    cy: number,
    feedWidth: number,
  ): void {
    const { rollDeg, pitchDeg } = quaternionToEulerDeg(t.localOrientation);
    // HTML uses pitch*0.5px on a ~1080px-tall page; scale to canvas height.
    const offset = pitchDeg * 0.5 * (this.height / 1080);
    const half = feedWidth * 0.15;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((rollDeg * Math.PI) / 180);
    ctx.translate(0, offset);
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = Math.max(2, this.height / 270);
    ctx.beginPath();
    ctx.moveTo(-half, 0);
    ctx.lineTo(half, 0);
    ctx.stroke();
    ctx.restore();
  }

  private drawSignalBars(ctx: CanvasRenderingContext2D, right: number, midY: number, fontPx: number): void {
    const barW = fontPx * 0.25;
    const step = barW * 1.6;
    ctx.fillStyle = WHITE;
    for (let i = 0; i < 4; i++) {
      const h = fontPx * (0.25 + i * 0.2);
      ctx.fillRect(right - (4 - i) * step - fontPx * 3.2, midY + fontPx * 0.4 - h, barW, h);
    }
  }

  /** Stick dot math mirrors src/ui/stick-overlay.ts (0..1 per axis). */
  private drawSticks(
    ctx: CanvasRenderingContext2D,
    c: Controls,
    lx: number,
    y: number,
    rx: number,
    box: number,
  ): void {
    const thr =
      c.throttle != null && Number.isFinite(c.throttle)
        ? c.throttle
        : Number.isFinite(c.thrust)
          ? (c.thrust + 1) / 2
          : 0;
    const yaw = Number.isFinite(c.yaw) ? c.yaw : 0;
    const rol = Number.isFinite(c.roll) ? c.roll : 0;
    const pit = Number.isFinite(c.pitch) ? c.pitch : 0;
    const dots = [
      { x: lx, u: clamp((1 - yaw) / 2, 0, 1), v: 1 - clamp(thr, 0, 1) },
      { x: rx, u: clamp((rol + 1) / 2, 0, 1), v: clamp((1 - pit) / 2, 0, 1) },
    ];
    ctx.lineWidth = 2;
    for (const d of dots) {
      ctx.strokeStyle = WHITE;
      ctx.strokeRect(d.x, y, box, box);
      ctx.fillStyle = WHITE;
      ctx.beginPath();
      ctx.arc(d.x + d.u * box, y + d.v * box, box * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
