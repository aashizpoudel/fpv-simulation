import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupWelcomeScreen } from "../src/app/welcome-screen";

const html = readFileSync("index.html", "utf8");
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/fpv/");
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
});
const select = (id: string, value: string) => {
  const element = document.getElementById(id) as HTMLSelectElement;
  element.value = value;
  element.dispatchEvent(new Event("change"));
};

describe("navigation-only landing", () => {
  it("keeps welcome content without simulator HUD or runtime entry", () => {
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.getElementById("welcomeScreen")!.textContent).toContain("Factory and Ekotori");
    expect(document.getElementById("renderingContainer")).toBeNull();
    expect(html).toContain('/src/app/welcome-screen.ts');
    expect(html).not.toContain('/src/main.ts');
    expect(document.getElementById("welcomeVrBtn")!.hidden).toBe(true);
  });
  it("does not navigate or load maps on selection; Play saves choices and navigates", () => {
    const navigate = vi.fn();
    setupWelcomeScreen(navigate);
    select("welcomeWorldSelect", "ekotori");
    select("welcomeControlSelect", "gamepad");
    select("welcomeFlightModeSelect", "acro");
    expect(navigate).not.toHaveBeenCalled();
    document.getElementById("welcomePlayBtn")!.click();
    const target = new URL(navigate.mock.calls[0][0]);
    expect(target.pathname).toBe("/fpv/play.html");
    expect(localStorage.getItem("drone_sim_world")).toBe("ekotori");
    expect(localStorage.getItem("drone_sim_control")).toBe("gamepad");
    expect(localStorage.getItem("drone_sim_flight_mode")).toBe("acro");
  });
  it("forwards VR intent without starting a session", () => {
    const navigate = vi.fn();
    setupWelcomeScreen(navigate);
    select("welcomeControlSelect", "motion");
    document.getElementById("welcomePlayBtn")!.click();
    expect(navigate).not.toHaveBeenCalled();
    expect(document.getElementById("welcomeStatus")!.textContent).toContain("VR only");
    document.getElementById("welcomeVrBtn")!.click();
    expect(localStorage.getItem("drone_sim_vr_intent")).toBe("1");
  });
  it("restores the saved map but never consumes old autoplay flags", () => {
    localStorage.setItem("drone_sim_world", "forest");
    sessionStorage.setItem("fpv_resume_auto_play", "1");
    const navigate = vi.fn();
    setupWelcomeScreen(navigate);
    expect(navigate).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("fpv_resume_auto_play")).toBe("1");
  });
});
