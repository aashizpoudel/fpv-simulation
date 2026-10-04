import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { setupSettingsTabs } from "../src/app/settings-tabs";
import { getAudioVolume, subscribeAudioVolume } from "../src/audio/audio-preferences";
import {
  isCrosshairEnabled,
  subscribeCrosshair,
  isHorizonLineEnabled,
  subscribeHorizonLine,
} from "../src/app/crosshair-preferences";

const html = readFileSync("index.html", "utf8");
beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  localStorage.clear();
});

describe("settings tabs and audio", () => {
  it("switches one visible panel at a time without losing edits", () => {
    setupSettingsTabs();
    const controls = document.getElementById("settings-tab-controls")!;
    controls.click();
    const input = document.getElementById("rateRoll") as HTMLInputElement;
    input.value = "500";
    document.getElementById("settings-tab-audio")!.click();
    expect(document.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
    expect(document.getElementById("settings-panel-audio")!.hidden).toBe(false);
    expect(controls.getAttribute("aria-selected")).toBe("false");
    controls.click();
    expect(input.value).toBe("500");
  });

  it("supports arrow, Home and End navigation with a single tab stop", () => {
    setupSettingsTabs();
    const first = document.getElementById("settings-tab-display")!;
    first.focus();
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(document.activeElement?.id).toBe("settings-tab-credits");
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement).toBe(first);
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement?.id).toBe("settings-tab-credits");
    expect(document.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1);
  });

  it("updates audio immediately and restores saved mute on reopening", () => {
    setupSettingsTabs();
    const onVolume = vi.fn();
    const unsubscribe = subscribeAudioVolume(onVolume);
    try {
      const slider = document.getElementById("audioVolume") as HTMLInputElement;
      slider.value = "35";
      slider.dispatchEvent(new Event("input"));
      expect(onVolume).toHaveBeenLastCalledWith(0.35);
      expect(getAudioVolume()).toBe(0.35);
      slider.value = "0";
      slider.dispatchEvent(new Event("input"));
      expect(onVolume).toHaveBeenLastCalledWith(0);
      document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
      setupSettingsTabs();
      expect((document.getElementById("audioVolume") as HTMLInputElement).value).toBe("0");
      expect(document.getElementById("audioVolumeValue")!.textContent).toBe("Muted");
    } finally { unsubscribe(); }
  });

  it("falls back safely for invalid saved volume", () => {
    localStorage.setItem("drone_sim_audio_volume", "broken");
    expect(getAudioVolume()).toBe(1);
    setupSettingsTabs();
    expect((document.getElementById("audioVolume") as HTMLInputElement).value).toBe("100");
  });

  it("keeps crosshair disabled by default and toggles on user interaction", () => {
    expect(isCrosshairEnabled()).toBe(false);
    setupSettingsTabs();
    const checkbox = document.getElementById("crosshairCheckbox") as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);

    const onCrosshair = vi.fn();
    const unsubscribe = subscribeCrosshair(onCrosshair);
    try {
      expect(onCrosshair).toHaveBeenLastCalledWith(false);

      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change"));
      expect(isCrosshairEnabled()).toBe(true);
      expect(onCrosshair).toHaveBeenLastCalledWith(true);
      expect(localStorage.getItem("drone_sim_crosshair")).toBe("1");

      checkbox.checked = false;
      checkbox.dispatchEvent(new Event("change"));
      expect(isCrosshairEnabled()).toBe(false);
      expect(onCrosshair).toHaveBeenLastCalledWith(false);
      expect(localStorage.getItem("drone_sim_crosshair")).toBe("0");
    } finally {
      unsubscribe();
    }
  });

  it("restores crosshair enabled state from localStorage", () => {
    localStorage.setItem("drone_sim_crosshair", "1");
    expect(isCrosshairEnabled()).toBe(true);
    setupSettingsTabs();
    const checkbox = document.getElementById("crosshairCheckbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("keeps horizon line disabled by default and toggles on user interaction", () => {
    expect(isHorizonLineEnabled()).toBe(false);
    setupSettingsTabs();
    const checkbox = document.getElementById("horizonLineCheckbox") as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);

    const onHorizon = vi.fn();
    const unsubscribe = subscribeHorizonLine(onHorizon);
    try {
      expect(onHorizon).toHaveBeenLastCalledWith(false);

      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change"));
      expect(isHorizonLineEnabled()).toBe(true);
      expect(onHorizon).toHaveBeenLastCalledWith(true);
      expect(localStorage.getItem("drone_sim_horizon_line")).toBe("1");

      checkbox.checked = false;
      checkbox.dispatchEvent(new Event("change"));
      expect(isHorizonLineEnabled()).toBe(false);
      expect(onHorizon).toHaveBeenLastCalledWith(false);
      expect(localStorage.getItem("drone_sim_horizon_line")).toBe("0");
    } finally {
      unsubscribe();
    }
  });

  it("restores horizon line enabled state from localStorage", () => {
    localStorage.setItem("drone_sim_horizon_line", "1");
    expect(isHorizonLineEnabled()).toBe(true);
    setupSettingsTabs();
    const checkbox = document.getElementById("horizonLineCheckbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });
});
