import { landingWorld, parsePlayChoices, playUrl, savePlayChoices } from "./page-navigation";
import { STORAGE_KEYS } from "./storage-keys";
import "../styles.css";
import { setupWelcomeGamepadStatus } from "../ui/welcome-gamepad-status";
import { subscribeVrSupport } from "../xr/xr-support";
import { setupPwa } from "../pwa";

/** Landing only: no simulator session, map loading, or resume side effects. */
export function setupWelcomeScreen(
  navigate: (url: string) => void = (url) => window.location.assign(url),
): void {
  const world = document.getElementById("welcomeWorldSelect") as HTMLSelectElement;
  const control = document.getElementById("welcomeControlSelect") as HTMLSelectElement;
  const mode = document.getElementById("welcomeFlightModeSelect") as HTMLSelectElement;
  const status = document.getElementById("welcomeStatus")!;
  const initial = parsePlayChoices(window.location.search);
  world.value = landingWorld(window.location.search);
  control.value = initial.control;
  mode.value = initial.mode;
  const go = (vr: boolean) => {
    if (control.value === "motion" && !vr) {
      status.textContent = "The motion controller works in VR only. Select Play in VR.";
      return;
    }
    localStorage.setItem(STORAGE_KEYS.world, world.value);
    const choices = {
      control: control.value === "gamepad" || control.value === "motion" ? control.value : "keyboard",
      mode: mode.value === "acro" ? "acro" : "angle",
      vr,
    } as const;
    savePlayChoices(choices);
    navigate(playUrl(window.location.href, world.value, choices));
  };
  document.getElementById("welcomePlayBtn")!.addEventListener("click", () => go(false));
  document.getElementById("welcomeVrBtn")!.addEventListener("click", () => go(true));
}

if (document.getElementById("welcomeScreen")) {
  setupWelcomeScreen();
  setupWelcomeGamepadStatus();
  subscribeVrSupport((supported) => {
    const button = document.getElementById("welcomeVrBtn")!;
    button.hidden = !supported;
    for (const option of document.querySelectorAll<HTMLOptionElement>("option[data-vr-only]")) {
      option.hidden = !supported;
      option.disabled = !supported;
    }
  });
  setupPwa();
}
