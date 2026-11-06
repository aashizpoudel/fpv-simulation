import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSelectedDrone, setupDroneSelection } from "../src/app/drone-selection";
import { loadFlightConfig } from "../src/app/flight-settings";
import { STORAGE_KEYS } from "../src/app/storage-keys";
import { DEFAULT_DRONE, DRONES } from "../src/config/drone-catalog";
import { Manta5DeadCatConfig } from "../src/config/manta5-config";
import { defaultPreset, exportPreset, parsePreset } from "../src/config/presets";

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = new DOMParser()
    .parseFromString(readFileSync("play.html", "utf8"), "text/html").body.innerHTML;
});

describe("drone selection", () => {
  it("offers the same default drone on welcome and settings", () => {
    setupDroneSelection();
    for (const page of ["index.html", "play.html"]) {
      document.body.innerHTML = new DOMParser().parseFromString(readFileSync(page, "utf8"), "text/html").body.innerHTML;
      setupDroneSelection();
      const id = page === "index.html" ? "welcomeDroneSelect" : "droneSelect";
      const select = document.getElementById(id) as HTMLSelectElement;
      expect(select.value).toBe(DEFAULT_DRONE.id);
      expect([...select.options].map((o) => [o.value, o.text])).toEqual(DRONES.map((d) => [d.id, d.name]));
      expect(select.selectedOptions[0].text).toBe("EMAX Tinyhawk III Plus");
    }
    expect(loadFlightConfig().modelUrl).toBe(DEFAULT_DRONE.config.modelUrl);
  });

  it.each(["index.html", "play.html"])("lists every catalog drone statically on %s", (page) => {
    const html = new DOMParser().parseFromString(readFileSync(page, "utf8"), "text/html");
    const id = page === "index.html" ? "welcomeDroneSelect" : "droneSelect";
    const options = [...(html.getElementById(id) as HTMLSelectElement).options];
    expect(options.map((o) => [o.value, o.text])).toEqual(DRONES.map((d) => [d.id, d.name]));
  });

  it("loads the selected drone instead of tuning saved for another drone", () => {
    localStorage.setItem(STORAGE_KEYS.physicsPreset, exportPreset(defaultPreset()));
    const onChange = vi.fn();
    setupDroneSelection(onChange);
    const settings = document.getElementById("droneSelect") as HTMLSelectElement;
    settings.value = "axisflying-manta5-dc";
    settings.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenCalledTimes(1);
    const loaded = loadFlightConfig();
    expect(loaded).toEqual(defaultPreset(Manta5DeadCatConfig));
    expect(loaded.battery.cells).toBe(6);
    settings.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("keeps saved tuning that belongs to the selected drone", () => {
    const tuned = defaultPreset(Manta5DeadCatConfig);
    tuned.rates.expo = 0.3;
    localStorage.setItem(STORAGE_KEYS.drone, "axisflying-manta5-dc");
    localStorage.setItem(STORAGE_KEYS.physicsPreset, exportPreset(tuned));
    expect(loadFlightConfig()).toEqual(tuned);
  });

  it("checks pack voltages against the cell count", () => {
    const config = defaultPreset(Manta5DeadCatConfig);
    config.battery.cells = 1;
    expect(() => exportPreset(config)).toThrow("Reference voltage");
  });

  it.each(["index.html", "play.html"])("persists selection on %s", (page) => {
    document.body.innerHTML = new DOMParser().parseFromString(readFileSync(page, "utf8"), "text/html").body.innerHTML;
    const id = page === "index.html" ? "welcomeDroneSelect" : "droneSelect";
    setupDroneSelection();
    document.getElementById(id)!.dispatchEvent(new Event("change"));
    expect(localStorage.getItem(STORAGE_KEYS.drone)).toBe(DEFAULT_DRONE.id);
    setupDroneSelection();
    expect(loadSelectedDrone().id).toBe(DEFAULT_DRONE.id);
  });

  it("falls back from an unavailable drone and synchronizes the controls", () => {
    localStorage.setItem(STORAGE_KEYS.drone, "removed-drone");
    setupDroneSelection();
    const settings = document.getElementById("droneSelect") as HTMLSelectElement;
    settings.value = "invalid";
    settings.dispatchEvent(new Event("change"));
    expect(settings.value).toBe(DEFAULT_DRONE.id);
    expect(loadSelectedDrone().id).toBe(DEFAULT_DRONE.id);
  });

  it("works when storage is unavailable", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
    expect(loadSelectedDrone().id).toBe(DEFAULT_DRONE.id);
    get.mockRestore();
  });

  it("rejects arbitrary imported model URLs", () => {
    const config = defaultPreset();
    config.modelUrl = "https://example.com/drone.glb";
    expect(() => parsePreset(JSON.stringify({ version: 1, config }))).toThrow("Unsupported drone model");
  });
});
