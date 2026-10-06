import type { RendererType } from "../renderers/renderer-factory";
import { STORAGE_KEYS } from "./storage-keys";

export function setupConfigControls(currentRenderer: RendererType, currentWorld: string): void {
  const worldSelect = document.getElementById("worldSelect") as HTMLSelectElement | null;
  const worldSelectLabel = document.getElementById("worldSelectLabel");
  const collisionCheckbox = document.getElementById("collisionCheckbox") as HTMLInputElement | null;
  const qualitySelect = document.getElementById("quality") as HTMLSelectElement | null;

  if (worldSelect) {
    worldSelect.value = currentWorld;
    if (currentRenderer === "cesium") {
      worldSelect.disabled = true;
      if (worldSelectLabel) worldSelectLabel.style.opacity = "0.5";
    }
    worldSelect.addEventListener("change", () => {
      const selected = worldSelect.value;
      localStorage.setItem(STORAGE_KEYS.world, selected);
      const url = new URL(window.location.href);
      url.searchParams.set("world", selected);
      window.location.href = url.toString();
    });
  }

  if (collisionCheckbox) {
    const params = new URLSearchParams(window.location.search);
    collisionCheckbox.checked =
      params.get("collision") === "1" ||
      localStorage.getItem(STORAGE_KEYS.collision) === "1";

    collisionCheckbox.addEventListener("change", () => {
      const val = collisionCheckbox.checked ? "1" : "0";
      localStorage.setItem(STORAGE_KEYS.collision, val);
      const url = new URL(window.location.href);
      if (collisionCheckbox.checked) {
        url.searchParams.set("collision", "1");
      } else {
        url.searchParams.delete("collision");
      }
      window.location.href = url.toString();
    });
  }

  if (qualitySelect) {
    const savedQuality = localStorage.getItem(STORAGE_KEYS.quality);
    if (savedQuality) qualitySelect.value = savedQuality;
    qualitySelect.addEventListener("change", () => {
      localStorage.setItem(STORAGE_KEYS.quality, qualitySelect.value);
    });
  }
}
