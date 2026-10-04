import { getAudioVolume, setAudioVolume } from "../audio/audio-preferences";
import {
  isCrosshairEnabled,
  setCrosshairEnabled,
  isHorizonLineEnabled,
  setHorizonLineEnabled,
  isStickOverlayEnabled,
  setStickOverlayEnabled,
} from "./crosshair-preferences";

export function setupSettingsTabs(): void {
  const root = document.querySelector<HTMLElement>(".flight-help");
  if (!root) return;
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const select = (selected: HTMLButtonElement) => {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      const panel = document.getElementById(tab.getAttribute("aria-controls")!);
      if (panel) panel.hidden = !active;
    }
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", event => {
      let next: number;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      event.stopPropagation();
      select(tabs[next]);
      tabs[next].focus();
    });
  });

  const crosshairCheckbox = root.querySelector<HTMLInputElement>("#crosshairCheckbox");
  if (crosshairCheckbox) {
    crosshairCheckbox.checked = isCrosshairEnabled();
    crosshairCheckbox.addEventListener("change", () => {
      setCrosshairEnabled(crosshairCheckbox.checked);
    });
  }

  const horizonCheckbox = root.querySelector<HTMLInputElement>("#horizonLineCheckbox");
  if (horizonCheckbox) {
    horizonCheckbox.checked = isHorizonLineEnabled();
    horizonCheckbox.addEventListener("change", () => {
      setHorizonLineEnabled(horizonCheckbox.checked);
    });
  }

  const stickOverlayCheckbox = root.querySelector<HTMLInputElement>("#stickOverlayCheckbox");
  if (stickOverlayCheckbox) {
    stickOverlayCheckbox.checked = isStickOverlayEnabled();
    stickOverlayCheckbox.addEventListener("change", () => {
      setStickOverlayEnabled(stickOverlayCheckbox.checked);
    });
  }

  const slider = root.querySelector<HTMLInputElement>("#audioVolume");
  const output = root.querySelector<HTMLOutputElement>("#audioVolumeValue");
  if (!slider || !output) return;
  const displayVolume = () => {
    const percent = Number(slider.value);
    output.value = percent === 0 ? "Muted" : `${percent}%`;
    slider.setAttribute("aria-valuetext", percent === 0 ? "Muted" : `${percent}%`);
  };
  slider.value = String(Math.round(getAudioVolume() * 100));
  displayVolume();
  slider.addEventListener("input", () => {
    displayVolume();
    setAudioVolume(Number(slider.value) / 100);
  });
}
