import { STORAGE_KEYS } from "./storage-keys";

export type PlayChoices = {
  control: "keyboard" | "gamepad" | "motion";
  mode: "angle" | "acro";
  vr: boolean;
};

export type SimulationBackend = "rapier" | "dronesim";

/** Welcome labels are Vanilla and Betaflight SITL. Stored values match the engine backend. */
export function parseSimulationBackend(search = ""): SimulationBackend {
  const param = new URLSearchParams(search).get("backend") || localStorage.getItem(STORAGE_KEYS.simulationBackend);
  return param === "rapier" || param === "vanilla" ? "rapier" : "dronesim";
}

export function saveSimulationBackend(backend: SimulationBackend): void {
  localStorage.setItem(STORAGE_KEYS.simulationBackend, backend);
}

export function parsePlayChoices(search: string = ""): PlayChoices {
  const params = new URLSearchParams(search);
  const vrParam = params.get("vr");
  const vr = vrParam !== null ? vrParam === "1" : localStorage.getItem(STORAGE_KEYS.vrIntent) === "1";
  const input = params.get("input") || localStorage.getItem(STORAGE_KEYS.control);
  const modeParam = params.get("mode") || localStorage.getItem(STORAGE_KEYS.flightMode);
  return {
    control: input === "gamepad" ? "gamepad" : input === "motion" && vr ? "motion" : "keyboard",
    mode: modeParam === "acro" ? "acro" : "angle",
    vr,
  };
}

export function savePlayChoices(choices: PlayChoices): void {
  localStorage.setItem(STORAGE_KEYS.control, choices.control);
  localStorage.setItem(STORAGE_KEYS.flightMode, choices.mode);
  if (choices.vr) {
    localStorage.setItem(STORAGE_KEYS.vrIntent, "1");
  } else {
    localStorage.removeItem(STORAGE_KEYS.vrIntent);
  }
}

export function landingWorld(search: string): string {
  const value = new URLSearchParams(search).get("world") || localStorage.getItem(STORAGE_KEYS.world);
  return value === "island" || value === "forest" || value === "dedust" || value === "factory-splat" || value === "ekotori" ? value : "island";
}

/** A sibling URL retains the deployment directory, including GitHub Pages bases. */
export function playUrl(current: string, world: string, choices: PlayChoices): string {
  const source = new URL(current);
  const target = new URL("play.html", source);
  target.search = "";
  if (choices.vr) {
    target.searchParams.set("renderer", "threejs");
  }
  return target.toString();
}

/** Bench keeps the deployment directory and always opens the Island tuning page. */
export function benchUrl(current: string): string {
  const source = new URL(current);
  const target = new URL("bench.html", source);
  target.search = "";
  return target.toString();
}
