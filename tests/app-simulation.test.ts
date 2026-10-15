import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SimulationClient } from "../src/core/simulation-client";
import { startApp } from "../src/app/app-orchestrator";

const renderer = vi.hoisted(() => ({
  init: vi.fn(async () => {}),
  render: vi.fn(),
  dispose: vi.fn(),
  setFrameLoop: vi.fn(),
  enterVr: vi.fn(async () => {}),
  onVrEnd: undefined as (() => void) | undefined,
}));
vi.mock("../src/renderers/renderer-factory", () => ({ createRenderer: async () => renderer }));
vi.mock("../src/app/flight-settings", () => ({ takePendingReplay: async () => undefined }));
vi.mock("../src/xr/xr-support", () => ({ requestVrSession: async () => ({}) }));
vi.mock("../src/audio/drone-audio-engine", () => ({
  DroneAudioEngine: class {
    preload() {}
    setVolume() {}
    async start() {}
    async setSuspended() {}
    update() {}
    dispose() {}
  },
}));
const html = readFileSync("index.html", "utf8");
beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
});
afterEach(() => {
  window.dispatchEvent(new Event("beforeunload"));
  vi.restoreAllMocks();
});

describe("app simulation lifecycle", () => {
  it("pauses a hidden desktop tab, keeps hidden immersive VR running, and cleans up", async () => {
    const pause = vi.spyOn(SimulationClient.prototype, "pause");
    const dispose = vi.spyOn(SimulationClient.prototype, "dispose");
    const app = await startApp({ rendererType: "threejs", simulationExecution: "main-thread" });
    await app.play("keyboard");
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(pause).toHaveBeenLastCalledWith(true);
    await app.enterVr("keyboard");
    expect(pause).toHaveBeenLastCalledWith(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(pause).toHaveBeenLastCalledWith(false);
    renderer.onVrEnd?.();
    expect(pause).toHaveBeenLastCalledWith(true);
    window.dispatchEvent(new Event("beforeunload"));
    expect(dispose).toHaveBeenCalledOnce();
    expect(renderer.setFrameLoop).toHaveBeenLastCalledWith(null);
  });
});
