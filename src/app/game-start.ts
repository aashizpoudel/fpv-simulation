import type { AppSession } from "./app-orchestrator";
import type { PlayChoices } from "./page-navigation";

/** Begin desktop flight; VR waits for the existing VR button's user gesture. */
export function setupGameStart(appReady: Promise<AppSession>, choices: PlayChoices): void {
  let retrying = false;
  let started = false;
  const showError = (message: string) => {
    const status = document.getElementById("lodStatus");
    if (status) {
      status.textContent = message;
      status.dataset.state = "error";
    }
  };
  const clearError = () => {
    const status = document.getElementById("lodStatus");
    if (status?.dataset.state === "error") {
      status.textContent = "";
      delete status.dataset.state;
    }
  };
  void appReady.then(async (session) => {
    if (choices.control === "motion") return;
    const retry = async () => {
      if (retrying || started) return;
      retrying = true;
      try {
        started = await session.play(choices.control === "gamepad" ? "gamepad" : "keyboard", choices.mode);
        if (started) {
          clearError();
          window.removeEventListener("gamepadconnected", onConnect);
          document.getElementById("detectGamepadBtn")?.removeEventListener("click", onDetect);
        } else {
          showError("Gamepad unavailable. Press a button on the controller, then select Detect in Settings.");
        }
      } catch (error) {
        showError(`Unable to start: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        retrying = false;
      }
    };
    const onConnect = () => { void retry(); };
    const onDetect = () => { void retry(); };
    if (choices.control === "gamepad") {
      window.addEventListener("gamepadconnected", onConnect);
      document.getElementById("detectGamepadBtn")?.addEventListener("click", onDetect);
    }
    await retry();
  }).catch((error) => {
    showError(`Unable to start: ${error instanceof Error ? error.message : String(error)}`);
  });
}
