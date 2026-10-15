import { SimulationRuntime } from "./simulation-runtime";
import type {
  ResponsePayload,
  SimulationRequest,
  SimulationResponse,
} from "./simulation-messages";

// The project uses DOM typings. Describe only the worker APIs used here rather
// than adding conflicting Window and Worker global definitions to tsconfig.
const workerScope = self as unknown as {
  postMessage(message: SimulationResponse): void;
  onmessage: ((event: MessageEvent<SimulationRequest>) => void) | null;
};

const SNAPSHOT_INTERVAL_MS = 1000 / 60;
let sessionId = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function send(payload: ResponsePayload, requestId = 0): void {
  workerScope.postMessage({
    ...payload,
    requestId,
    sessionId,
    timestamp: performance.now(),
  });
}

const runtime = new SimulationRuntime(() => send({ type: "prop-completed" }));

function publishSnapshot(): void {
  send({ type: "snapshot", snapshot: runtime.snapshot() });
}

function startClock(): void {
  timer = setInterval(() => {
    try {
      send({ type: "snapshot", snapshot: runtime.tick(performance.now()) });
    } catch (error) {
      clearInterval(timer);
      send({ type: "error", fatal: true, message: String(error) });
    }
  }, SNAPSHOT_INTERVAL_MS);
}

async function handleRequest(request: SimulationRequest): Promise<void> {
  sessionId = request.sessionId;
  const command = request.command;
  try {
    const result = await runtime.command(command);
    // State-changing acknowledgments follow their snapshot, so the client sees
    // the resulting state as soon as its awaited command resolves.
    if (command.type !== "dispose" && command.type !== "controls") {
      publishSnapshot();
    }
    send({ type: command.type === "init" ? "ready" : "ack", result }, request.requestId);

    if (command.type === "init") startClock();
    if (command.type === "dispose") clearInterval(timer);
  } catch (error) {
    send({ type: "error", message: String(error), fatal: false }, request.requestId);
  }
}

// Initialization awaits WASM. Queue later commands until it finishes so they
// cannot reach an uninitialized physics world.
let pendingCommands = Promise.resolve();
workerScope.onmessage = event => {
  pendingCommands = pendingCommands.then(() => handleRequest(event.data));
};
