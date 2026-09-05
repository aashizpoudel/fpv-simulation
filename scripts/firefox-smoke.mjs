// Node 22+; uses Firefox's built-in WebDriver BiDi, with no browser-test dependency.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ws = new WebSocket(process.env.FPV_FIREFOX_WS ?? "ws://127.0.0.1:9338/session");
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
let next = 0;
const pending = new Map();
const errors = [];
let context;
ws.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const callback = pending.get(message.id);
    pending.delete(message.id);
    message.type === "error" ? callback.reject(message) : callback.resolve(message.result);
  } else if (message.method === "log.entryAdded" && message.params.level === "error"
    && message.params.source?.context === context) errors.push(message.params.text);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++next;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + " timed out")); }, 120_000);
  pending.set(id, {
    resolve: value => { clearTimeout(timer); resolve(value); },
    reject: error => { clearTimeout(timer); reject(error); },
  });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const response = await send("script.evaluate", { expression, target: { context }, awaitPromise: true });
  if (response.type === "exception") throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hud = async () => JSON.parse(await evaluate(
  'JSON.stringify(Object.fromEntries(["lodStatus", "position", "fps", "armStatus", "throttle", "flightMode"].map(id => [id, document.getElementById(id)?.textContent])))',
));
const key = (type, value) => send("input.performActions", {
  context, actions: [{ type: "key", id: "keyboard", actions: [{ type, value }] }],
});
const press = async value => { await key("keyDown", value); await key("keyUp", value); };
const output = await mkdtemp(join(tmpdir(), "fpv-firefox-smoke-"));
const screenshot = async name => {
  const shot = await send("browsingContext.captureScreenshot", { context });
  await writeFile(join(output, name + ".png"), Buffer.from(shot.data, "base64"));
};

try {
  await send("session.new", { capabilities: {} });
  ({ context } = await send("browsingContext.create", { type: "tab" }));
  await send("session.subscribe", { events: ["log.entryAdded"] });
  await send("browsingContext.setViewport", { context, viewport: { width: 1280, height: 800 }, devicePixelRatio: 1 });
  await send("browsingContext.navigate", {
    context, url: process.env.FPV_URL ?? "http://127.0.0.1:5173/fpv-simulation/", wait: "complete",
  });
  let ready = false;
  for (let i = 0; i < 90; i++) {
    await pause(1000);
    const status = (await hud()).lodStatus;
    if (i % 10 === 0) console.log(status);
    if (status?.startsWith("Ready")) { ready = true; break; }
    if (status?.startsWith("Unable")) throw new Error(status);
  }
  assert.ok(ready, "Application did not become ready");
  await evaluate('document.querySelector(".flight-help").open = false');
  await pause(1500);
  const initial = await hud();
  console.log("Ground:", initial);
  assert.equal(initial.armStatus, "DISARMED");
  assert.ok(Math.abs(Number(initial.position.split(",")[2]) + 0.7) < 0.15, "Spawn must rest on Factory floor");
  await screenshot("ground");
  await key("keyDown", "\uE008"); await press("m"); await key("keyUp", "\uE008");
  await key("keyDown", "w"); await pause(3500); await key("keyUp", "w");
  const flight = await hud();
  console.log("Flight:", flight);
  assert.equal(flight.armStatus, "ARMED");
  assert.ok(Number(flight.position.split(",")[2]) > -0.4, "Drone must lift off");
  await screenshot("flight");
  await pause(2500);
  assert.equal((await hud()).armStatus, "CRASHED", "Real ceiling impact must cut motors");
  await press("r"); await pause(800);
  const reset = await hud();
  assert.equal(reset.armStatus, "DISARMED");
  assert.equal(reset.throttle, "0%");
  for (const mode of ["THIRD", "ORBIT", "FPV"]) {
    await press("c"); await pause(250);
    assert.ok((await hud()).flightMode.includes(mode));
  }
  await press("f"); await pause(250);
  assert.ok((await hud()).flightMode.includes("ANGLE"));
  await evaluate('const quality = document.getElementById("quality"); quality.value = "performance"; quality.dispatchEvent(new Event("change"));');
  await pause(1000);
  assert.deepEqual(errors, []);
  console.log("PASS: Firefox load, takeoff, ceiling crash, reset, cameras, mode and quality.", { screenshots: output });
} finally {
  if (context) await send("browsingContext.close", { context }).catch(() => {});
  await send("session.end").catch(() => {});
  ws.close();
}
