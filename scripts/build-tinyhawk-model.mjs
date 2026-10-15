// Export the reference geometry with canvas textures using a headless browser.
// Run: npm run drone:build (CHROME_PATH may override the browser executable).
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";

const profile = await mkdtemp(join(tmpdir(), "tinyhawk-export-"));
const server = await createServer({ server: { port: 0 }, logLevel: "error" });
let browser;
let socket;
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  const chrome = process.env.CHROME_PATH ?? (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
  browser = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding", "--remote-debugging-port=0",
    `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let launchError;
  browser.on("error", (error) => { launchError = error; });
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (launchError) throw launchError;
    try { port = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  if (!port) throw new Error("Chrome did not start; set CHROME_PATH to its executable.");
  const page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let next = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    clearTimeout(callback.timer);
    message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 60000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  // A text asset establishes the local origin without starting the simulator.
  await send("Page.navigate", { url: base + "drone_models/README.md" });
  await send("Page.bringToFront");
  await new Promise((resolve) => setTimeout(resolve, 500));
  const result = await send("Runtime.evaluate", {
    expression: `(async () => {
      const { createTinyhawkModel } = await import(${JSON.stringify(base + "scripts/models/tinyhawk-model.mjs")});
      const { GLTFExporter } = await import(${JSON.stringify(base + "node_modules/three/examples/jsm/exporters/GLTFExporter.js")});
      const model = createTinyhawkModel();
      const exporter = new GLTFExporter();
      const buffer = await exporter.parseAsync(model, { binary: true });
      window.exportBase64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(new Blob([buffer]));
      });
      return window.exportBase64.length;
    })()`,
    awaitPromise: true, returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "Model export failed");
  // Keep CDP messages small when transferring the embedded textures and geometry.
  const chunks = [];
  for (let offset = 0; offset < result.result.value; offset += 65536) {
    const chunk = await send("Runtime.evaluate", {
      expression: `window.exportBase64.slice(${offset}, ${offset + 65536})`, returnByValue: true,
    });
    chunks.push(chunk.result.value);
  }
  const bytes = Buffer.from(chunks.join(""), "base64");
  await writeFile("public/drone_models/tinyhawk-iii-plus.glb", bytes);
  console.log(`Exported Tinyhawk III Plus: ${(bytes.length / 1024 / 1024).toFixed(2)} MB`);
} finally {
  socket?.close();
  if (browser?.pid && browser.exitCode === null) {
    const exited = new Promise((resolve) => browser.once("exit", resolve));
    browser.kill();
    await exited;
  }
  await server.close();
  await rm(profile, { recursive: true, force: true });
}
