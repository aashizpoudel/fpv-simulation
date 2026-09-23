import type { AppSession } from "./app-orchestrator";
import type { RendererType } from "../renderers/renderer-factory";

const RESUME_KEY = "fpv_resume_after_map_change";
type ControlType = "keyboard" | "gamepad";

export function setupWelcomeScreen(
  currentWorld: string,
  currentRenderer: RendererType,
  appReady: Promise<AppSession>,
): void {
  const welcome = document.getElementById("welcomeScreen")!;
  const worldSelect = document.getElementById("welcomeWorldSelect") as HTMLSelectElement;
  const controlSelect = document.getElementById("welcomeControlSelect") as HTMLSelectElement;
  const playButton = document.getElementById("welcomePlayBtn") as HTMLButtonElement;
  const settingsButton = document.getElementById("welcomeSettingsBtn") as HTMLButtonElement;
  const status = document.getElementById("welcomeStatus")!;

  worldSelect.value = currentWorld;
  const resumeControl = sessionStorage.getItem(RESUME_KEY);
  sessionStorage.removeItem(RESUME_KEY);
  if (resumeControl === "gamepad") controlSelect.value = resumeControl;

  settingsButton.addEventListener("click", () => {
    document.getElementById("settingsToggleBtn")?.click();
  });

  const play = async () => {
    const world = worldSelect.value;
    const control = controlSelect.value as ControlType;
    if (world !== currentWorld || currentRenderer === "cesium") {
      sessionStorage.setItem(RESUME_KEY, control);
      localStorage.setItem("drone_sim_world", world);
      localStorage.setItem("drone_sim_renderer", "threejs");
      const url = new URL(window.location.href);
      url.searchParams.set("world", world);
      if (currentRenderer === "cesium") url.searchParams.set("renderer", "threejs");
      window.location.assign(url.toString());
      return;
    }

    playButton.disabled = true;
    status.textContent = "Loading simulator…";
    try {
      const session = await appReady;
      if (!(await session.play(control))) {
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
  if (resumeControl === "keyboard" || resumeControl === "gamepad") void play();
}
