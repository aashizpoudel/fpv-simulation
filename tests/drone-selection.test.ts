import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSelectedDrone, setupDroneSelection } from "../src/app/drone-selection";
import { loadFlightConfig } from "../src/app/flight-settings";
import { STORAGE_KEYS } from "../src/app/storage-keys";
import { DEFAULT_DRONE } from "../src/config/drone-catalog";
import { defaultPreset, exportPreset, parsePreset } from "../src/config/presets";

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = new DOMParser()
    .parseFromString(readFileSync("index.html", "utf8"), "text/html").body.innerHTML;
});

describe("drone selection", () => {
  it("offers the same default drone on welcome and settings", () => {
    setupDroneSelection();
    for (const id of ["welcomeDroneSelect", "droneSelect"]) {
      const select = document.getElementById(id) as HTMLSelectElement;
      expect(select.value).toBe(DEFAULT_DRONE.id);
      expect(select.options).toHaveLength(1);
      expect(select.selectedOptions[0].text).toBe("EMAX Tinyhawk III Plus");
    }
    expect(loadFlightConfig().modelUrl).toBe(DEFAULT_DRONE.config.modelUrl);
  });

  it.each(["welcomeDroneSelect", "droneSelect"])("persists selection from %s", (id) => {
    setupDroneSelection();
    document.getElementById(id)!.dispatchEvent(new Event("change"));
    expect(localStorage.getItem(STORAGE_KEYS.drone)).toBe(DEFAULT_DRONE.id);
    setupDroneSelection();
    expect(loadSelectedDrone().id).toBe(DEFAULT_DRONE.id);
  });

  it("falls back from an unavailable drone and synchronizes the controls", () => {
    localStorage.setItem(STORAGE_KEYS.drone, "removed-drone");
    setupDroneSelection();
    const welcome = document.getElementById("welcomeDroneSelect") as HTMLSelectElement;
    const settings = document.getElementById("droneSelect") as HTMLSelectElement;
    settings.value = "invalid";
    settings.dispatchEvent(new Event("change"));
    expect(settings.value).toBe(DEFAULT_DRONE.id);
    expect(welcome.value).toBe(DEFAULT_DRONE.id);
  });

  it("works when storage is unavailable", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
    expect(loadSelectedDrone().id).toBe(DEFAULT_DRONE.id);
    get.mockRestore();
  });

  it("migrates the old model while preserving saved flight tuning", () => {
    const config = defaultPreset();
    config.modelUrl = `${import.meta.env.BASE_URL}drone_models/tinyhawk.gltf`;
    config.rates.expo = 0.6;
    config.battery.initialCharge = 0.45;
    const text = JSON.stringify({ version: 1, config });
    localStorage.setItem(STORAGE_KEYS.physicsPreset, text);
    const loaded = loadFlightConfig();
    expect(loaded.modelUrl).toBe(DEFAULT_DRONE.config.modelUrl);
    expect(loaded.rates.expo).toBe(0.6);
    expect(loaded.battery.initialCharge).toBe(0.45);
    expect(parsePreset(exportPreset(loaded))).toEqual(loaded);
    expect(config.modelUrl).toContain("tinyhawk.gltf");
  });

  it("still rejects arbitrary imported model URLs", () => {
    const config = defaultPreset();
    config.modelUrl = "https://example.com/drone.glb";
    expect(() => parsePreset(JSON.stringify({ version: 1, config }))).toThrow("Unsupported drone model");
  });
});
