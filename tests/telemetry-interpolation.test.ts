import { describe, expect, it } from "vitest";
import { TelemetryInterpolation } from "../src/core/telemetry-interpolation";
import type { Snapshot } from "../src/core/simulation-messages";
const frame = (x: number, generation = 0): Snapshot => ({
  step: x, generation, simulationTime: x / 480, armedFlightTime: 0, mode: "angle", recordingSteps: 0, recordingActive: false, replayComplete: false,
  telemetry: { localPosition: { x, y: 0, z: 0 }, localOrientation: { x: 0, y: 0, z: 0, w: 1 }, localVelocity: { x: 0, y: 0, z: 0 }, localAngularVelocity: { x: 0, y: 0, z: 0 }, gforce: 0, throttle: 0, rotorThrusts: [], armed: x > 0, crashed: false },
});
describe("telemetry interpolation", () => {
  it("interpolates pose while retaining authoritative flags", () => {
    const buffer = new TelemetryInterpolation();
    buffer.push(frame(0), 0);
    const b = frame(10); b.telemetry.localOrientation = { x: 0, y: 0, z: 1, w: 0 };
    buffer.push(b, 100);
    const middle = buffer.sample(50, 0)!;
    expect(middle.localPosition.x).toBe(5);
    expect(middle.localOrientation.z).toBeCloseTo(Math.SQRT1_2);
    expect(middle.localOrientation.w).toBeCloseTo(Math.SQRT1_2);
    expect(middle.armed).toBe(true);
    expect(buffer.sample(1000, 0)!.localPosition.x).toBe(10);
  });
  it("clears history across reset, explicit teleport, and step rollback", () => {
    const buffer = new TelemetryInterpolation();
    expect(buffer.sample()).toBeUndefined();
    buffer.push(frame(100), 0); buffer.push(frame(1, 1), 100);
    expect(buffer.sample(50, 0)!.localPosition.x).toBe(1);
    buffer.push(frame(0, 1), 110);
    expect(buffer.sample(50, 0)!.localPosition.x).toBe(0);
    buffer.clear(); expect(buffer.sample()).toBeUndefined();
  });
});
