// Run with Vite and a dedicated Firefox BiDi session on port 9339.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ws = new WebSocket(process.env.FPV_FIREFOX_WS ?? 'ws://127.0.0.1:9339/session');
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
let next = 0;
const pending = new Map();
ws.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  const callback = pending.get(message.id);
  if (!callback) return;
  pending.delete(message.id);
  clearTimeout(callback.timer);
  message.type === 'error' ? callback.reject(message) : callback.resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++next;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 30000);
  pending.set(id, { resolve, reject, timer });
  ws.send(JSON.stringify({ id, method, params }));
});

let context;
try {
  await send('session.new', { capabilities: {} });
  ({ context } = await send('browsingContext.create', { type: 'tab' }));
  const base = process.env.FPV_URL ?? 'http://localhost:5173/fpv-simulation/';
  await send('browsingContext.navigate', { context, url: base + 'audio/drone/README.md', wait: 'complete' });
  const evaluate = async expression => {
    const result = await send('script.evaluate', { target: { context }, awaitPromise: true, expression });
    if (result.type === 'exception') throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await evaluate(`(async () => {
    const html = await (await fetch(${JSON.stringify(base)})).text();
    document.documentElement.innerHTML = new DOMParser().parseFromString(html, 'text/html').documentElement.innerHTML;
    await import(${JSON.stringify(base + 'src/styles.css')});
    const { setupFlightSettings } = await import(${JSON.stringify(base + 'src/app/flight-settings.ts')});
    const { Tinyhawk3Config } = await import(${JSON.stringify(base + 'src/config/tinyhawk-config.ts')});
    setupFlightSettings(Tinyhawk3Config, 'factory-splat');
    document.getElementById('settingsToggleBtn').click();
    document.getElementById('settings-tab-audio').click();
    const volume = document.getElementById('audioVolume');
    volume.value = '37';
    volume.dispatchEvent(new Event('input'));
  })()`);
  assert.equal(await evaluate("document.getElementById('audioVolumeValue').value"), '37%');
  assert.equal(await evaluate("localStorage.getItem('drone_sim_audio_volume')"), '0.37');
  const reviewTab = process.env.FPV_SETTINGS_TAB ?? 'audio';
  await evaluate(`document.getElementById(${JSON.stringify('settings-tab-' + reviewTab)}).click()`);
  const output = resolve('artifacts/settings-review');
  await mkdir(output, { recursive: true });
  for (const [name, width, height] of [['desktop', 1280, 800], ['mobile', 390, 844]]) {
    await send('browsingContext.setViewport', { context, viewport: { width, height }, devicePixelRatio: 1 });
    const result = JSON.parse(await evaluate(`JSON.stringify((() => {
      const panel = document.querySelector('.flight-help');
      const bounds = panel.getBoundingClientRect();
      return { visible: document.querySelectorAll('[role="tabpanel"]:not([hidden])').length,
        fits: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
        overflow: panel.scrollWidth > panel.clientWidth };
    })())`));
    assert.equal(result.visible, 1);
    assert.ok(result.fits, name + ' settings should fit viewport');
    assert.equal(result.overflow, false, name + ' must not overflow horizontally');
    const shot = await send('browsingContext.captureScreenshot', { context });
    await writeFile(resolve(output, reviewTab + '-' + name + '.png'), Buffer.from(shot.data, 'base64'));
  }
  await evaluate("document.getElementById('settings-tab-controls').click()");
  assert.equal(await evaluate("document.getElementById('settings-panel-controls').hidden"), false);
  await evaluate("document.getElementById('closeSettingsFooterBtn').click()");
  assert.equal(await evaluate("document.querySelector('.flight-help').open"), false);
  console.log('Settings browser checks passed; screenshots in ' + output);
} finally {
  if (context) await send('browsingContext.close', { context }).catch(() => {});
  await send('session.end').catch(() => {});
  ws.close();
}
