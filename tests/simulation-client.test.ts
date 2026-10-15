import { afterEach, describe, expect, it, vi } from "vitest";
import { SimulationClient } from "../src/core/simulation-client";
import { SimulationRuntime } from "../src/core/simulation-runtime";
import type { SimulationRequest, SimulationResponse } from "../src/core/simulation-messages";
const position = { x: 0, y: 0, z: 2 };
class FakeWorker {
  onmessage?: (event: { data: SimulationResponse }) => void;
  onerror?: (event: { message: string; preventDefault(): void }) => void;
  onmessageerror?: () => void;
  runtime = new SimulationRuntime();
  terminate = vi.fn(() => this.runtime.engine?.dispose());
  requests: SimulationRequest[] = [];
  postMessage(request: SimulationRequest, transfer: Transferable[]) {
    this.requests.push(request);
    const cloned = structuredClone(request, { transfer });
    void this.runtime.command(cloned.command).then(result => {
      if (cloned.command.type === "init") this.onmessage?.({ data: { ...cloned, type: "snapshot", snapshot: this.runtime.snapshot() } });
      this.onmessage?.({ data: { ...cloned, type: cloned.command.type === "init" ? "ready" : "ack", result } });
    }, error => this.onmessage?.({ data: { ...cloned, type: "error", message: String(error), fatal: false } }));
  }
}
const clients: SimulationClient[] = [];
function client(...args: ConstructorParameters<typeof SimulationClient>) { const c = new SimulationClient(...args); clients.push(c); return c; }
afterEach(() => { clients.splice(0).forEach(c => c.dispose()); vi.useRealTimers(); });
describe("simulation client", () => {
  it("starts in explicit main-thread mode and cleans up idempotently", async () => {
    const factory = vi.fn(); const c = client({}, "main-thread", factory);
    await c.init(position);
    expect(c.ready).toBe(true); expect(c.executionMode).toBe("main-thread"); expect(factory).not.toHaveBeenCalled();
    await c.command({ type: "pause", paused: false });
    c.update({ thrust: 0, throttle: 0.5, roll: 0, pitch: 0, yaw: 0, arm: true, reset: false, speedMultiplier: 1 }, 0);
    c.update({ thrust: 0, throttle: 0.5, roll: 0, pitch: 0, yaw: 0, arm: true, reset: false, speedMultiplier: 1 }, 1000 / 60);
    expect(c.getTelemetry().armed).toBe(true);
    await c.command({ type: "reset" }); expect(c.getTelemetry().armed).toBe(false);
    c.dispose(); c.dispose();
    await expect(c.command({ type: "reset" })).rejects.toThrow("stopped");
  });
  it("falls back when worker construction is unavailable or blocked", async () => {
    const c = client({}, "auto", () => { throw new Error("blocked"); });
    await c.init(position); expect(c.executionMode).toBe("main-thread");
    const strict = client({}, "worker", () => { throw new Error("blocked"); });
    await expect(strict.init(position)).rejects.toThrow("blocked");
  });
  it("falls back after worker timeout and terminates it", async () => {
    vi.useFakeTimers();
    const worker = { postMessage: vi.fn(), terminate: vi.fn() };
    const c = client({}, "auto", () => worker as unknown as Worker, 50);
    const ready = c.init(position);
    await vi.advanceTimersByTimeAsync(51); await ready;
    expect(c.executionMode).toBe("main-thread"); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("handles worker readiness, transfers copies, and does not switch after a flight failure", async () => {
    const worker = new FakeWorker(); const c = client({}, "worker", () => worker as unknown as Worker);
    await c.init(position); expect(c.executionMode).toBe("worker"); expect(c.snapshot).toBeDefined();
    const vertices = new Float32Array([0,0,0, 1,0,0, 0,1,0]);
    await c.command({ type: "collision", kind: "map", data: { vertices, indices: new Uint32Array([0,1,2]) } });
    expect(vertices.length).toBe(9);
    expect(worker.requests[1].command.type).toBe("collision");
    const onError = vi.fn(); c.onError = onError;
    worker.onerror?.({ message: "runtime crash", preventDefault() {} });
    expect(c.ready).toBe(false); expect(onError).toHaveBeenCalledOnce(); expect(worker.terminate).toHaveBeenCalledOnce();
    expect(c.executionMode).toBe("worker");
  });
  it("rejects pending requests on cleanup and ignores stale sessions", async () => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: undefined as FakeWorker["onmessage"] };
    const c = client({}, "worker", () => worker as unknown as Worker);
    const started = c.init(position);
    const rejection = expect(started).rejects.toThrow("disposed");
    worker.onmessage?.({ data: { type: "ready", sessionId: -1, requestId: 1, timestamp: 0 } });
    expect(c.ready).toBe(false); c.dispose(); await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("falls back on worker initialization errors", async () => {
    const worker = new FakeWorker();
    worker.postMessage = request => queueMicrotask(() => worker.onmessage?.({ data: { ...request, type: "error", fatal: false, message: "WASM initialization failed" } }));
    const c = client({}, "auto", () => worker as unknown as Worker);
    await c.init(position); expect(c.executionMode).toBe("main-thread"); expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
