import { SimulationRuntime } from "./simulation-runtime";
import { TelemetryInterpolation } from "./telemetry-interpolation";
import type {
  CollisionData,
  Command,
  CommandResult,
  SimulationOptions,
  SimulationResponse,
  Snapshot,
} from "./simulation-messages";
import type { Controls, DroneTelemetry, Vec3 } from "../types";
import type { FlightRecording } from "./flight-recording";
import type { RaceProp } from "../race/race-props";
import type { WorldConfig } from "../config/world-config";

export type ExecutionMode = "auto" | "worker" | "main-thread";
type PendingRequest = {
  resolve: (value: CommandResult) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let nextSession = 0;

function createWorker(): Worker {
  return new Worker(new URL("./simulation.worker.ts", import.meta.url), { type: "module" });
}

/** The main thread's single entry point to either simulation execution mode. */
export class SimulationClient {
  executionMode?: Exclude<ExecutionMode, "auto">;
  ready = false;
  snapshot?: Snapshot;
  onSnapshot?: (snapshot: Snapshot) => void;
  onPropCompleted?: () => void;
  onError?: (error: Error) => void;
  readonly interpolation = new TelemetryInterpolation();

  private worker?: Worker;
  private runtime?: SimulationRuntime;
  private sessionId = ++nextSession;
  private requestId = 0;
  private disposed = false;
  private failed = false;
  private pending = new Map<number, PendingRequest>();

  constructor(
    private options: SimulationOptions = {},
    private mode: ExecutionMode = "auto",
    private workerFactory: () => Worker = createWorker,
    private requestTimeoutMs = 15000,
  ) {}

  async init(position: Vec3): Promise<void> {
    if (this.disposed || this.ready || this.worker || this.runtime) {
      throw new Error("Client cannot be initialized");
    }
    if (this.mode !== "main-thread") {
      try {
        await this.startWorker(position);
        return;
      } catch (error) {
        this.stopWorker(new Error("Worker startup failed"));
        if (this.mode === "worker" || this.disposed) throw error;
        // Invalidate delayed replies from the failed startup attempt.
        this.sessionId = ++nextSession;
        this.failed = false;
        this.snapshot = undefined;
        this.interpolation.clear();
      }
    }
    await this.startMainThread(position);
  }

  private async startWorker(position: Vec3): Promise<void> {
    const worker = this.workerFactory();
    this.worker = worker;
    worker.onmessage = event => this.receive(event.data);
    worker.onerror = event => {
      event.preventDefault();
      if (this.worker === worker) {
        this.fail(new Error(event.message || "Simulation worker failed"));
      }
    };
    worker.onmessageerror = () => {
      if (this.worker === worker) this.fail(new Error("Invalid worker response"));
    };
    await this.command({ type: "init", options: this.options, position });
    if (this.disposed) throw new Error("Client disposed");
    this.executionMode = "worker";
    this.ready = true;
  }

  private async startMainThread(position: Vec3): Promise<void> {
    const runtime = new SimulationRuntime(() => this.onPropCompleted?.());
    this.runtime = runtime;
    try {
      await runtime.command({ type: "init", options: this.options, position });
      if (this.disposed) throw new Error("Client disposed");
      this.executionMode = "main-thread";
      this.ready = true;
      this.accept(runtime.snapshot());
    } catch (error) {
      runtime.engine?.dispose();
      this.runtime = undefined;
      throw error;
    }
  }

  /** Resolves after the runtime has applied the command, at a step boundary. */
  async command(command: Command): Promise<CommandResult> {
    if (this.disposed || this.failed) throw new Error("Simulation is stopped");
    if (this.runtime) {
      try {
        const result = await this.runtime.command(command);
        if (this.disposed) throw new Error("Client disposed");
        if (command.type !== "dispose") this.accept(this.runtime.snapshot());
        return result;
      } catch (error) {
        if (this.ready) this.fail(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    }
    const worker = this.worker;
    if (!worker) throw new Error("Simulation is not initialized");
    const requestId = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Simulation ${command.type} timed out`));
        if (this.ready) {
          this.fail(new Error("Simulation stopped responding. Reload to restart."));
        }
      }, this.requestTimeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        const transfer: Transferable[] = [];
        if (command.type === "collision") {
          // Transfer copies so callers retain usable geometry if startup fails
          // or the same collision asset must be installed in another session.
          command = {
            ...command,
            data: {
              vertices: command.data.vertices.slice(),
              indices: command.data.indices.slice(),
            },
          };
          transfer.push(command.data.vertices.buffer, command.data.indices.buffer);
        }
        worker.postMessage({
          command, requestId, sessionId: this.sessionId, timestamp: performance.now(),
        }, transfer);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  /** For UI commands that do not need a result. Failures pause the session. */
  send(command: Command): void {
    void this.command(command).catch(error => {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    });
  }

  private receive(message: SimulationResponse): void {
    if (this.disposed || message.sessionId !== this.sessionId) return;
    if (message.type === "snapshot") {
      this.accept(message.snapshot);
      return;
    }
    if (message.type === "prop-completed") {
      this.onPropCompleted?.();
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(message.requestId);
      if (message.type === "error") pending.reject(new Error(message.message));
      else pending.resolve(message.result);
    }
    if (message.type === "error" && (message.fatal || this.ready)) {
      this.fail(new Error(message.message));
    }
  }

  private accept(snapshot: Snapshot): void {
    this.snapshot = snapshot;
    this.interpolation.push(snapshot);
    this.onSnapshot?.(snapshot);
  }

  private fail(error: Error): void {
    const wasReady = this.ready;
    this.failed = true;
    this.ready = false;
    this.stopWorker(error);
    // Startup can fall back. Mid-flight failure cannot: rebuilding physics
    // here would silently discard flight, battery, and recording state.
    if (wasReady) this.onError?.(error);
  }

  private stopWorker(error: Error): void {
    this.worker?.terminate();
    this.worker = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  /** Called once per render frame. Only the fallback advances physics here. */
  update(controls: Controls, now = performance.now()): void {
    if (!this.ready) return;
    if (this.runtime) {
      void this.runtime.command({ type: "controls", controls }).catch(error => this.fail(error));
      try {
        this.accept(this.runtime.tick(now));
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    } else {
      this.send({ type: "controls", controls });
    }
  }

  getTelemetry(): DroneTelemetry {
    if (!this.snapshot) throw new Error("Telemetry not ready");
    return this.snapshot.telemetry;
  }

  async installCollision(kind: "map" | "props", data: CollisionData): Promise<void> {
    await this.command({ type: "collision", kind, data });
  }

  async placeProps(world: WorldConfig): Promise<RaceProp[]> {
    const result = await this.command({ type: "place-props", world });
    if (!Array.isArray(result)) throw new Error("Invalid race-prop response");
    return result;
  }

  async startRecording(recording: FlightRecording): Promise<void> {
    await this.command({ type: "record", recording });
  }

  async stopRecording(): Promise<FlightRecording | undefined> {
    const result = await this.command({ type: "stop-recording" });
    if (Array.isArray(result)) throw new Error("Invalid recording response");
    return result;
  }

  switchFlightMode(mode: "acro" | "angle"): void {
    this.send({ type: "mode", mode });
  }

  reset(): void {
    this.interpolation.clear();
    this.send({ type: "reset" });
  }

  pause(paused: boolean): void {
    this.interpolation.clear();
    this.send({ type: "pause", paused });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    this.stopWorker(new Error("Client disposed"));
    this.runtime?.engine?.dispose();
    this.runtime = undefined;
    this.interpolation.clear();
  }
}
