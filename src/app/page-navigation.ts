import { STORAGE_KEYS } from "./storage-keys";

export type PlayChoices = {
  control: "keyboard" | "gamepad" | "motion";
  mode: "angle" | "acro";
  vr: boolean;
};

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
  return value === "forest" || value === "ekotori" || value === "dedust" ? value : "factory-splat";
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
