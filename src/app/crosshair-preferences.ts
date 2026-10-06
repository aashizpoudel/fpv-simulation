import { STORAGE_KEYS } from "./storage-keys";
const CROSSHAIR_KEY = STORAGE_KEYS.crosshair;
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

const HORIZON_KEY = STORAGE_KEYS.horizonLine;
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

const STICK_OVERLAY_KEY = STORAGE_KEYS.stickOverlay;
const STICK_OVERLAY_EVENT = "drone-stick-overlay-change";

export function isStickOverlayEnabled(): boolean {
  try {
    const val = localStorage.getItem(STICK_OVERLAY_KEY);
    if (val === null) return true; // Default is ON
    return val === "1";
  } catch {
    return true;
  }
}

export function setStickOverlayEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STICK_OVERLAY_KEY, enabled ? "1" : "0");
  } catch {
    /* Live control still works. */
  }
  window.dispatchEvent(new CustomEvent(STICK_OVERLAY_EVENT, { detail: enabled }));
}

export function subscribeStickOverlay(onChange: (enabled: boolean) => void): () => void {
  onChange(isStickOverlayEnabled());
  const listener = (event: Event) => onChange((event as CustomEvent<boolean>).detail);
  window.addEventListener(STICK_OVERLAY_EVENT, listener);
  return () => window.removeEventListener(STICK_OVERLAY_EVENT, listener);
}
