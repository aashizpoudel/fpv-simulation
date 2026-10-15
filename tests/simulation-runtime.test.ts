import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SimulationRuntime } from "../src/core/simulation-runtime";
import { meshToTrimesh } from "../src/physics/map-collider";
import { createRecording, parseRecording } from "../src/core/flight-recording";
import { defaultPreset } from "../src/config/presets";
import type { Controls } from "../src/types";
import type { FlightRecording } from "../src/core/flight-recording";
const controls: Controls = { thrust: 0, throttle: 0.6, roll: 0.1, pitch: 0, yaw: 0, arm: true, reset: false, speedMultiplier: 1 };
const position = { x: 0, y: 0, z: 2 };
async function setup() {
  const runtime = new SimulationRuntime();
  await runtime.command({ type: "init", options: { config: defaultPreset() }, position });
  return runtime;
}
describe("shared simulation runtime", () => {
  it("retains collision arrays across resets and rejects uninitialized commands", async () => {
    const runtime = new SimulationRuntime();
    await expect(runtime.command({ type: "reset" })).rejects.toThrow("not initialized");
    const r = await setup();
    try {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 0.1));
      await r.command({ type: "collision", kind: "map", data: meshToTrimesh(mesh) });
      expect(r.engine.isPropSpaceClear({ x: 0, y: 0, z: 0 }, 0.3)).toBe(false);
      await r.command({ type: "reset" });
      expect(r.engine.isPropSpaceClear({ x: 0, y: 0, z: 0 }, 0.3)).toBe(false);
      expect(r.snapshot().generation).toBe(1);
      await r.command({ type: "collision", kind: "map", data: { vertices: new Float32Array(), indices: new Uint32Array() } }).then(() => { throw Error("expected failure"); }, error => expect(String(error)).toContain("no triangles"));
    } finally { await r.command({ type: "dispose" }); }
  });
  it("records applied fixed-step controls and reproduces reset/mode timing exactly", async () => {
    const r = await setup();
    try {
      await r.command({ type: "pause", paused: false });
      await r.command({ type: "record", recording: createRecording(defaultPreset(), "empty", position) });
      await r.command({ type: "controls", controls });
      r.tick(0); r.tick(1000 / 60);
      await r.command({ type: "reset" });
      await r.command({ type: "mode", mode: "acro" });
      r.tick(20); r.tick(20 + 1000 / 60);
      const expected = r.snapshot().telemetry;
      const recording = await r.command({ type: "stop-recording" }) as FlightRecording;
      expect(recording.steps.length).toBe(16);
      expect(recording.steps[8].controls.reset).toBe(true);
      expect(recording.steps[8].mode).toBe("acro");
      const parsed = parseRecording(JSON.stringify(recording));
      await r.command({ type: "replay", recording: parsed });
      r.tick(100); r.tick(100 + 1000 / 60); r.tick(100 + 2000 / 60);
      expect(r.snapshot().telemetry).toEqual(expected);
      r.tick(150); expect(r.snapshot().step).toBe(32);
      expect(r.snapshot().replayComplete).toBe(true);
    } finally { await r.command({ type: "dispose" }); }
  });
  it("caps a long scheduling gap and excludes paused time", async () => {
    const r = await setup();
    try {
      await r.command({ type: "pause", paused: false });
      await r.command({ type: "controls", controls });
      r.tick(0); r.tick(60000);
      expect(r.snapshot().step).toBe(32);
      expect(r.snapshot().telemetry.armed).toBe(false);
      await r.command({ type: "pause", paused: true }); r.tick(120000);
      await r.command({ type: "pause", paused: false }); r.tick(180000);
      expect(r.snapshot().step).toBe(32);
    } finally { await r.command({ type: "dispose" }); }
  });
});
