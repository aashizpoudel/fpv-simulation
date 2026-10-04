const CROSSHAIR_KEY = "drone_sim_crosshair";
const CROSSHAIR_EVENT = "drone-crosshair-change";

export function isCrosshairEnabled(): boolean {
  try {
    return localStorage.getItem(CROSSHAIR_KEY) === "1";
  } catch {
    return false;
  }
}

export function setCrosshairEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(CROSSHAIR_KEY, enabled ? "1" : "0");
  } catch {
    /* Live control still works. */
  }
  window.dispatchEvent(new CustomEvent(CROSSHAIR_EVENT, { detail: enabled }));
}

export function subscribeCrosshair(onChange: (enabled: boolean) => void): () => void {
  onChange(isCrosshairEnabled());
  const listener = (event: Event) => onChange((event as CustomEvent<boolean>).detail);
  window.addEventListener(CROSSHAIR_EVENT, listener);
  return () => window.removeEventListener(CROSSHAIR_EVENT, listener);
}

const HORIZON_KEY = "drone_sim_horizon_line";
const HORIZON_EVENT = "drone-horizon-line-change";

export function isHorizonLineEnabled(): boolean {
  try {
    return localStorage.getItem(HORIZON_KEY) === "1";
  } catch {
    return false;
  }
}

export function setHorizonLineEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(HORIZON_KEY, enabled ? "1" : "0");
  } catch {
    /* Live control still works. */
  }
  window.dispatchEvent(new CustomEvent(HORIZON_EVENT, { detail: enabled }));
}

export function subscribeHorizonLine(onChange: (enabled: boolean) => void): () => void {
  onChange(isHorizonLineEnabled());
  const listener = (event: Event) => onChange((event as CustomEvent<boolean>).detail);
  window.addEventListener(HORIZON_EVENT, listener);
  return () => window.removeEventListener(HORIZON_EVENT, listener);
}
