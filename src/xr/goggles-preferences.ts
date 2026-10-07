import { STORAGE_KEYS } from "../app/storage-keys";
import {
  DEFAULT_GOGGLES_SETTINGS,
  GOGGLES_SCREENS,
  type FeedAspect,
  type GogglesModel,
  type GogglesSettings,
} from "./goggles-config";

export function loadGogglesSettings(): GogglesSettings {
  const settings = { ...DEFAULT_GOGGLES_SETTINGS };
  try {
    const model = localStorage.getItem(STORAGE_KEYS.gogglesModel);
    if (model && model in GOGGLES_SCREENS) settings.model = model as GogglesModel;
    const aspect = localStorage.getItem(STORAGE_KEYS.gogglesAspect);
    if (aspect === "4:3" || aspect === "16:9") settings.aspect = aspect as FeedAspect;
  } catch {
    /* Defaults still work. */
  }
  return settings;
}

export function saveGogglesSetting(key: "model" | "aspect", value: string): void {
  try {
    localStorage.setItem(key === "model" ? STORAGE_KEYS.gogglesModel : STORAGE_KEYS.gogglesAspect, value);
  } catch {
    /* Applies next session only if storage works. */
  }
}
