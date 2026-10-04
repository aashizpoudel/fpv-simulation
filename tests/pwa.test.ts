import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupPwa } from "../src/pwa";

describe("PWA integration", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section class="welcome">
        <button id="welcomeInstallBtn" style="display: none;">Install App</button>
      </section>
      <div class="top-right-bar">
        <button id="pwaInstallBtn" style="display: none;">Install</button>
      </div>
    `;
  });

  it("keeps install button hidden initially until install prompt is fired", () => {
    setupPwa();
    const btn = document.getElementById("pwaInstallBtn") as HTMLButtonElement;
    expect(btn.style.display).toBe("none");
  });

  it("shows install button when beforeinstallprompt event is dispatched", () => {
    setupPwa();
    const btn = document.getElementById("pwaInstallBtn") as HTMLButtonElement;
    const welcomeBtn = document.getElementById("welcomeInstallBtn") as HTMLButtonElement;
    expect(btn.style.display).toBe("none");
    expect(welcomeBtn.style.display).toBe("none");

    const promptEvent = new Event("beforeinstallprompt") as any;
    promptEvent.prompt = vi.fn().mockResolvedValue(undefined);
    promptEvent.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });

    window.dispatchEvent(promptEvent);
    expect(btn.style.display).toBe("");
    expect(welcomeBtn.style.display).toBe("");

    btn.click();
    expect(promptEvent.prompt).toHaveBeenCalled();
  });

  it("hides install button when appinstalled event is dispatched", () => {
    setupPwa();
    const btn = document.getElementById("pwaInstallBtn") as HTMLButtonElement;
    btn.style.display = "";

    window.dispatchEvent(new Event("appinstalled"));
    expect(btn.style.display).toBe("none");
  });
});
