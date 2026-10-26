import type { AppSession } from "./app-orchestrator";
import type { PlayChoices } from "./page-navigation";

/** Begin desktop flight; VR waits for the existing VR button's user gesture. */
export function setupGameStart(appReady: Promise<AppSession>, choices: PlayChoices): void {
  const showError = (message: string) => {
    const status = document.getElementById("lodStatus");
    if (status) {
      status.textContent = message;
      status.dataset.state = "error";
    }
  };
  void appReady.then(async (session) => {
    if (choices.control === "motion") return;
    if (!await session.play(choices.control, choices.mode)) {
      showError("Gamepad unavailable. Connect it or select Keyboard in settings.");
    }
  }).catch((error) => {
    showError(`Unable to start: ${error instanceof Error ? error.message : String(error)}`);
  });
}
