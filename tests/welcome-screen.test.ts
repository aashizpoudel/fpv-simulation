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
    expect(welcome.querySelectorAll("select")).toHaveLength(3);
    expect(welcome.querySelectorAll("button:not([hidden])")).toHaveLength(3);
    // VR is offered only after a headset is detected.
    expect((document.getElementById("welcomeVrBtn") as HTMLButtonElement).hidden).toBe(true);
    expect((document.getElementById("welcomeFlightModeSelect") as HTMLSelectElement).value).toBe("angle");
    expect(document.querySelector(".flight-help")?.hasAttribute("open")).toBe(false);
  });

  it("starts the selected controls and reveals the simulator on Play", async () => {
    const play = vi.fn(async () => true);
    setupWelcomeScreen("ekotori", "threejs", Promise.resolve({ play }));
    expect((document.getElementById("welcomeWorldSelect") as HTMLSelectElement).value).toBe("ekotori");
    (document.getElementById("welcomeControlSelect") as HTMLSelectElement).value = "gamepad";
    document.getElementById("welcomePlayBtn")!.click();

    await vi.waitFor(() => expect(play).toHaveBeenCalledWith("gamepad", "angle"));
    await vi.waitFor(() => expect(document.getElementById("welcomeScreen")!.hidden).toBe(true));
    expect(document.body.classList.contains("welcome-active")).toBe(false);
  });

  it("starts in the flight mode chosen on the welcome screen", async () => {
    const play = vi.fn(async () => true);
    setupWelcomeScreen("ekotori", "threejs", Promise.resolve({ play }));
    (document.getElementById("welcomeFlightModeSelect") as HTMLSelectElement).value = "acro";
    document.getElementById("welcomePlayBtn")!.click();

    await vi.waitFor(() => expect(play).toHaveBeenCalledWith("keyboard", "acro"));
  });

  it("keeps the welcome screen open when gamepad activation fails", async () => {
    const play = vi.fn(async () => false);
    setupWelcomeScreen("factory-splat", "threejs", Promise.resolve({ play }));
    (document.getElementById("welcomeControlSelect") as HTMLSelectElement).value = "gamepad";
    document.getElementById("welcomePlayBtn")!.click();

    await vi.waitFor(() => expect(play).toHaveBeenCalledWith("gamepad", "angle"));
    await vi.waitFor(() => expect(document.getElementById("welcomeStatus")?.textContent).toContain("Connect a radio"));
    expect(document.getElementById("welcomeScreen")!.hidden).toBe(false);
  });

  it("reloads with a newly chosen map right away, keeping choices but not starting play", () => {
    const navigate = vi.fn();
    const play = vi.fn(async () => true);
    setupWelcomeScreen("factory-splat", "threejs", Promise.resolve({ play }), () => {}, navigate);
    (document.getElementById("welcomeControlSelect") as HTMLSelectElement).value = "gamepad";
    (document.getElementById("welcomeFlightModeSelect") as HTMLSelectElement).value = "acro";
    const world = document.getElementById("welcomeWorldSelect") as HTMLSelectElement;
    world.value = "ekotori";
    world.dispatchEvent(new Event("change"));

    expect(navigate).toHaveBeenCalledOnce();
    expect(new URL(navigate.mock.calls[0][0]).searchParams.get("world")).toBe("ekotori");
    expect(play).not.toHaveBeenCalled();

    // After the reload the choices come back and the pilot still presses Play.
    document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
    setupWelcomeScreen("ekotori", "threejs", Promise.resolve({ play }), () => {}, navigate);
    expect((document.getElementById("welcomeControlSelect") as HTMLSelectElement).value).toBe("gamepad");
    expect((document.getElementById("welcomeFlightModeSelect") as HTMLSelectElement).value).toBe("acro");
    expect(play).not.toHaveBeenCalled();
  });

  it("resumes play after a reload that Play started", async () => {
    sessionStorage.setItem("fpv_resume_after_map_change", "keyboard");
    sessionStorage.setItem("fpv_resume_auto_play", "1");
    const play = vi.fn(async () => true);
    setupWelcomeScreen("ekotori", "threejs", Promise.resolve({ play }));
    await vi.waitFor(() => expect(play).toHaveBeenCalledWith("keyboard", "angle"));
  });

  it("keeps normal Play from starting with the VR-only motion controller", async () => {
    const play = vi.fn(async () => true);
    setupWelcomeScreen("factory-splat", "threejs", Promise.resolve({ play }));
    const control = document.getElementById("welcomeControlSelect") as HTMLSelectElement;
    const motion = control.querySelector<HTMLOptionElement>('option[value="motion"]')!;
    motion.hidden = false;
    motion.disabled = false;
    control.value = "motion";
    document.getElementById("welcomePlayBtn")!.click();
    await Promise.resolve();
    expect(play).not.toHaveBeenCalled();
    expect(document.getElementById("welcomeStatus")!.textContent).toContain("VR only");
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
