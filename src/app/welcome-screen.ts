import type { AppSession, FlightModeName } from "./app-orchestrator";
import type { RendererType } from "../renderers/renderer-factory";
import { STORAGE_KEYS } from "./storage-keys";

const RESUME_KEY = STORAGE_KEYS.resumeAfterMapChange;
const RESUME_MODE_KEY = STORAGE_KEYS.resumeFlightMode;
const RESUME_PLAY_KEY = STORAGE_KEYS.resumeAutoPlay;
type ControlType = "keyboard" | "gamepad" | "motion";

export function setupWelcomeScreen(
  currentWorld: string,
  currentRenderer: RendererType,
  appReady: Promise<AppSession>,
  /** Shows the map loading overlay while the map is still loading. */
  showLoading: () => void = () => {},
  navigate: (url: string) => void = (url) => window.location.assign(url),
): void {
  const welcome = document.getElementById("welcomeScreen")!;
  const worldSelect = document.getElementById("welcomeWorldSelect") as HTMLSelectElement;
  const controlSelect = document.getElementById("welcomeControlSelect") as HTMLSelectElement;
  const modeSelect = document.getElementById("welcomeFlightModeSelect") as HTMLSelectElement | null;
  const playButton = document.getElementById("welcomePlayBtn") as HTMLButtonElement;
  const settingsButton = document.getElementById("welcomeSettingsBtn") as HTMLButtonElement;
  const status = document.getElementById("welcomeStatus")!;

  worldSelect.value = currentWorld;
  const resumeControl = sessionStorage.getItem(RESUME_KEY);
  sessionStorage.removeItem(RESUME_KEY);
  if (resumeControl === "gamepad" || resumeControl === "motion") controlSelect.value = resumeControl;
  const resumeMode = sessionStorage.getItem(RESUME_MODE_KEY);
  sessionStorage.removeItem(RESUME_MODE_KEY);
  if (modeSelect && (resumeMode === "acro" || resumeMode === "angle")) modeSelect.value = resumeMode;
  const resumePlay = sessionStorage.getItem(RESUME_PLAY_KEY) === "1";
  sessionStorage.removeItem(RESUME_PLAY_KEY);

  settingsButton.addEventListener("click", () => {
    document.getElementById("settingsToggleBtn")?.click();
  });

  const choices = () => ({
    world: worldSelect.value,
    control: controlSelect.value as ControlType,
    mode: (modeSelect?.value === "acro" ? "acro" : "angle") as FlightModeName,
  });

  /** Reload with the chosen map so it loads now; keep the other choices. */
  const loadWorld = (autoPlay: boolean) => {
    const { world, control, mode } = choices();
    sessionStorage.setItem(RESUME_KEY, control);
    sessionStorage.setItem(RESUME_MODE_KEY, mode);
    if (autoPlay) sessionStorage.setItem(RESUME_PLAY_KEY, "1");
    localStorage.setItem(STORAGE_KEYS.world, world);
    localStorage.setItem(STORAGE_KEYS.renderer, "threejs");
    const url = new URL(window.location.href);
    url.searchParams.set("world", world);
    if (currentRenderer === "cesium") url.searchParams.set("renderer", "threejs");
    status.textContent = "Loading the selected map…";
    showLoading();
    navigate(url.toString());
  };

  // Start loading a newly chosen map right away, so Play and Play in VR use it.
  worldSelect.addEventListener("change", () => {
    if (worldSelect.value !== currentWorld) loadWorld(false);
  });

  const play = async () => {
    const { world, control, mode } = choices();
    if (control === "motion") {
      status.textContent = "The motion controller works in VR only. Select Play in VR.";
      return;
    }
    if (world !== currentWorld || currentRenderer === "cesium") {
      loadWorld(true);
      return;
    }

    playButton.disabled = true;
    status.textContent = "Loading simulator…";
    showLoading();
    try {
      const session = await appReady;
      if (!(await session.play(control, mode))) {
        status.textContent = "Connect a radio or gamepad and press a button, or choose Keyboard.";
        return;
      }
      welcome.hidden = true;
      document.body.classList.remove("welcome-active");
    } catch (error) {
      status.textContent = `Unable to start: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      playButton.disabled = false;
    }
  };

  playButton.addEventListener("click", () => { void play(); });
  if (resumePlay) void play();
}
