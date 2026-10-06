import { STORAGE_KEYS } from "../app/storage-keys";
const VOLUME_KEY = STORAGE_KEYS.audioVolume;
const VOLUME_EVENT = "drone-audio-volume";

export function getAudioVolume(): number {
  try {
    const saved = localStorage.getItem(VOLUME_KEY);
    const value = saved === null || saved.trim() === "" ? 1 : Number(saved);
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
  } catch {
    return 1;
  }
}

export function setAudioVolume(value: number): void {
  const volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
  try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch { /* Live control still works. */ }
  window.dispatchEvent(new CustomEvent(VOLUME_EVENT, { detail: volume }));
}

export function subscribeAudioVolume(onChange: (volume: number) => void): () => void {
  onChange(getAudioVolume());
  const listener = (event: Event) => onChange((event as CustomEvent<number>).detail);
  window.addEventListener(VOLUME_EVENT, listener);
  return () => window.removeEventListener(VOLUME_EVENT, listener);
}
