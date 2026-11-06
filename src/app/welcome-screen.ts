import { benchUrl, landingWorld, parsePlayChoices, parseSimulationBackend, playUrl, savePlayChoices, saveSimulationBackend, type PlayChoices } from "./page-navigation";
import { STORAGE_KEYS } from "./storage-keys";
import "../styles.css";
import { setupChoiceCarousel } from "../ui/choice-carousel";
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
  const drone = document.getElementById("welcomeDroneSelect") as HTMLSelectElement | null;
  const backend = document.getElementById("welcomeBackendSelect") as HTMLSelectElement;
  const status = document.getElementById("welcomeStatus")!;
  const initial = parsePlayChoices(window.location.search);
  // The landing page lists drones statically so that it need not load the drone catalog.
  const savedDrone = localStorage.getItem(STORAGE_KEYS.drone);
  if (drone && [...drone.options].some((option) => option.value === savedDrone)) drone.value = savedDrone!;
  world.value = landingWorld(window.location.search);
  control.value = initial.control;
  mode.value = initial.mode;
  backend.value = parseSimulationBackend(window.location.search);
  setupChoiceCarousel(world, "Map");
  if (drone) setupChoiceCarousel(drone, "Drone");
  const remember = () => {
    localStorage.setItem(STORAGE_KEYS.world, world.value);
    if (drone) localStorage.setItem(STORAGE_KEYS.drone, drone.value);
    saveSimulationBackend(backend.value === "rapier" ? "rapier" : "dronesim");
  };
  const choicesFromForm = (vr: boolean): PlayChoices => ({
    control: control.value === "gamepad" || control.value === "motion" ? control.value : "keyboard",
    mode: mode.value === "acro" ? "acro" : "angle",
    vr,
  });
  const go = (vr: boolean) => {
    if (control.value === "motion" && !vr) {
      status.textContent = "The motion controller works in VR only. Select Play in VR.";
      return;
    }
    remember();
    const choices = choicesFromForm(vr);
    savePlayChoices(choices);
    navigate(playUrl(window.location.href, world.value, choices));
  };
  document.getElementById("welcomePlayBtn")!.addEventListener("click", () => go(false));
  document.getElementById("welcomeVrBtn")!.addEventListener("click", () => go(true));
  document.getElementById("welcomeBenchBtn")!.addEventListener("click", () => {
    remember();
    savePlayChoices(choicesFromForm(false));
    navigate(benchUrl(window.location.href));
  });
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
