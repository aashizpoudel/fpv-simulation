import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupWelcomeScreen } from "../src/app/welcome-screen";

const html = readFileSync("index.html", "utf8");

beforeEach(() => {
  sessionStorage.clear();
  const page = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = page.body.innerHTML;
  document.body.className = "welcome-active";
});

describe("welcome screen", () => {
  it("has visible SEO text and only the requested starting controls", () => {
    const welcome = document.getElementById("welcomeScreen")!;
    expect(welcome.hidden).toBe(false);
    expect(welcome.querySelectorAll("h1")).toHaveLength(1);
    expect(welcome.textContent).toContain("Factory and Ekotori");
    expect(welcome.querySelectorAll("select")).toHaveLength(2);
    expect(welcome.querySelectorAll("button")).toHaveLength(2);
    expect(document.querySelector(".flight-help")?.hasAttribute("open")).toBe(false);
  });

  it("starts the selected controls and reveals the simulator on Play", async () => {
    const play = vi.fn(async () => true);
    setupWelcomeScreen("ekotori", "threejs", Promise.resolve({ play }));
    expect((document.getElementById("welcomeWorldSelect") as HTMLSelectElement).value).toBe("ekotori");
    (document.getElementById("welcomeControlSelect") as HTMLSelectElement).value = "gamepad";
    document.getElementById("welcomePlayBtn")!.click();

    await vi.waitFor(() => expect(play).toHaveBeenCalledWith("gamepad"));
    await vi.waitFor(() => expect(document.getElementById("welcomeScreen")!.hidden).toBe(true));
    expect(document.body.classList.contains("welcome-active")).toBe(false);
  });

  it("keeps the welcome screen open when gamepad activation fails", async () => {
    const play = vi.fn(async () => false);
    setupWelcomeScreen("factory-splat", "threejs", Promise.resolve({ play }));
    (document.getElementById("welcomeControlSelect") as HTMLSelectElement).value = "gamepad";
    document.getElementById("welcomePlayBtn")!.click();

    await vi.waitFor(() => expect(play).toHaveBeenCalledWith("gamepad"));
    await vi.waitFor(() => expect(document.getElementById("welcomeStatus")?.textContent).toContain("Connect a radio"));
    expect(document.getElementById("welcomeScreen")!.hidden).toBe(false);
  });

  it("opens Settings from the welcome screen", () => {
    const settings = document.getElementById("settingsToggleBtn")!;
    const onSettings = vi.fn();
    settings.addEventListener("click", onSettings);
    setupWelcomeScreen("factory-splat", "threejs", Promise.resolve({ play: async () => true }));
    document.getElementById("welcomeSettingsBtn")!.click();
    expect(onSettings).toHaveBeenCalledOnce();
  });
});
