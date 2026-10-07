import type { AppSession, FlightModeName } from "../app/app-orchestrator";
import type { RendererType } from "../renderers/renderer-factory";
import { subscribeVrSupport } from "../xr/xr-support";
import { loadGogglesSettings, saveGogglesSetting } from "../xr/goggles-preferences";
import { subscribeLoading } from "./loading-overlay";

type ControlType = "keyboard" | "gamepad" | "motion";

/**
 * Show VR buttons only when a headset is detected and the Three.js renderer is
 * active. They stay disabled until the map has loaded, because requestSession
 * must run inside the click.
 */
export function setupVrButtons(
  rendererType: RendererType,
  appReady: Promise<AppSession>,
  getChoice: () => { control: ControlType; mode: FlightModeName },
): () => void {
  setupGogglesSettings();
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-vr-button]"));
  if (rendererType !== "threejs" || buttons.length === 0) return () => {};

  let session: AppSession | undefined;
  let supported = false;
  let failed = false;
  let progress: number | undefined;
  let preparing = false;
  const loadingText = () => {
    if (failed) return "map failed to load";
    if (preparing) return "preparing…";
    return progress === undefined ? "loading…" : `loading ${Math.round(progress * 100)}%`;
  };
  const vrOnlyOptions = Array.from(document.querySelectorAll<HTMLOptionElement>("option[data-vr-only]"));
  const refresh = () => {
    for (const option of vrOnlyOptions) {
      option.hidden = !supported;
      option.disabled = !supported;
    }
    for (const button of buttons) {
      button.hidden = !supported;
      button.disabled = !session;
      button.title = session ? "Fly in VR goggles (FPV)" : `Play in VR · ${loadingText()}`;
      // Text buttons show the wait; the top-bar icon keeps its icon and uses the title.
      if (button.dataset.vrLabel !== undefined) {
        button.textContent = session ? button.dataset.vrLabel : `${button.dataset.vrLabel} · ${loadingText()}`;
      }
    }
  };
  for (const button of buttons) {
    if (!button.querySelector("svg")) button.dataset.vrLabel = button.textContent?.trim() ?? "Play in VR";
  }
  const unsubscribeLoading = subscribeLoading((_message, value) => {
    if (session) return;
    if (value !== undefined) progress = Math.min(1, Math.max(0, value));
    // After the download completes, the renderer still builds the map.
    else if (progress !== undefined && progress >= 0.999) preparing = true;
    refresh();
  });
  appReady
    .then((ready) => { session = ready; })
    .catch(() => { failed = true; })
    .finally(() => { unsubscribeLoading(); refresh(); });
  refresh();
  const unsubscribeSupport = subscribeVrSupport((value) => { supported = value; refresh(); });
  const unsubscribe = () => { unsubscribeSupport(); unsubscribeLoading(); };

  const status = document.getElementById("welcomeStatus");
  const welcome = document.getElementById("welcomeScreen");
  for (const button of buttons) {
    button.addEventListener("click", () => {
      if (!session) return;
      button.disabled = true;
      const { control, mode } = getChoice();
      session.enterVr(control, mode)
        .then(() => {
          if (welcome) welcome.hidden = true;
          document.body.classList.remove("welcome-active");
        })
        .catch((error) => {
          if (status) status.textContent = `Could not start VR: ${error instanceof Error ? error.message : String(error)}`;
        })
        .finally(() => { button.disabled = false; button.blur(); });
    });
  }
  return unsubscribe;
}

function setupGogglesSettings(): void {
  const settings = loadGogglesSettings();
  const model = document.getElementById("gogglesModelSelect") as HTMLSelectElement | null;
  const aspect = document.getElementById("gogglesAspectSelect") as HTMLSelectElement | null;
  if (model) {
    model.value = settings.model;
    model.addEventListener("change", () => saveGogglesSetting("model", model.value));
  }
  if (aspect) {
    aspect.value = settings.aspect;
    aspect.addEventListener("change", () => saveGogglesSetting("aspect", aspect.value));
  }
}
