import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GogglesOsd, formatFlightTime, speedKmh, type GogglesOsdState } from "../src/xr/goggles-osd";

function makeState(over: Partial<GogglesOsdState> = {}): GogglesOsdState {
  return {
    telemetry: {
      batteryVoltage: 3.92,
      batteryCharge: 0.86,
      localPosition: { x: 0, y: 0, z: 12.3 },
      localOrientation: { x: 0, y: 0, z: 0, w: 1 },
      localVelocity: { x: 10, y: 0, z: 0 },
      localAngularVelocity: { x: 0, y: 0, z: 0 },
      gforce: 1,
      throttle: 45,
      rotorThrusts: [],
      crashed: false,
      armed: true,
    },
    flightMode: "angle",
    flightTimeSec: 12,
    recording: false,
    crosshair: false,
    horizonLine: false,
    latencyMs: 30,
    ...over,
  };
}

describe("goggles-osd helpers", () => {
  it("formats flight time", () => {
    expect(formatFlightTime(0)).toBe("0:00");
    expect(formatFlightTime(72)).toBe("1:12");
    expect(formatFlightTime(754)).toBe("12:34");
    expect(formatFlightTime(-5)).toBe("0:00");
  });

  it("converts speed to km/h", () => {
    expect(speedKmh({ x: 10, y: 0, z: 0 })).toBeCloseTo(36);
    expect(speedKmh({ x: 3, y: 4, z: 0 })).toBeCloseTo(18);
  });
});

describe("GogglesOsd", () => {
  const original = HTMLCanvasElement.prototype.getContext;
  let ctx: Record<string, any>;

  beforeEach(() => {
    ctx = {
      fillText: vi.fn(),
      strokeText: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      measureText: vi.fn(() => ({ width: 10 })),
      font: "",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      textAlign: "left",
      textBaseline: "alphabetic",
    };
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as any;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = original;
  });

  const texts = () => ctx.fillText.mock.calls.map((c: unknown[]) => String(c[0]));

  it("draws voltage, mode, and marks texture dirty", () => {
    const osd = new GogglesOsd();
    osd.update(makeState());
    expect(texts()).toContain("3.92V");
    expect(texts()).toContain("86%");
    expect(texts()).toContain("ANGLE");
    expect(texts()).toContain("ARMED");
    expect(texts()).toContain("THR 45%");
    expect(texts()).toContain("36");
    expect(ctx.strokeText).toHaveBeenCalled();
    expect(osd.texture.version).toBeGreaterThan(0);
  });

  it("draws CRASHED when crashed", () => {
    const osd = new GogglesOsd();
    osd.update(makeState({ telemetry: { ...makeState().telemetry, crashed: true } }));
    expect(texts()).toContain("CRASHED");
  });

  it("draws REC only when recording", () => {
    const osd = new GogglesOsd();
    osd.update(makeState());
    expect(texts().some((t: string) => t.includes("REC"))).toBe(false);
    ctx.fillText.mockClear();
    osd.update(makeState({ recording: true, recordingSec: 12 }));
    expect(texts()).toContain("● REC 0:12");
  });

  it("draws crosshair only when enabled", () => {
    const osd = new GogglesOsd();
    osd.setFeedRect({ x: 240, y: 0, width: 1440, height: 1080 });
    osd.update(makeState());
    expect(ctx.stroke).not.toHaveBeenCalled();
    osd.update(makeState({ crosshair: true }));
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect(ctx.moveTo).toHaveBeenCalledWith(expect.any(Number), 540);
  });

  it("draws horizon and sticks when requested", () => {
    const osd = new GogglesOsd();
    osd.update(
      makeState({
        horizonLine: true,
        sticks: { thrust: 0, pitch: 0, roll: 0, yaw: 0, speedMultiplier: 1, arm: true, reset: false },
      }),
    );
    expect(ctx.rotate).toHaveBeenCalled();
    expect(ctx.strokeRect).toHaveBeenCalledTimes(2);
    expect(ctx.arc).toHaveBeenCalledTimes(2);
  });

  it("does not crash with a null context", () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as any;
    const osd = new GogglesOsd();
    expect(() => osd.update(makeState({ recording: true, crosshair: true }))).not.toThrow();
    expect(osd.texture.version).toBeGreaterThan(0);
    expect(() => osd.dispose()).not.toThrow();
  });
});
