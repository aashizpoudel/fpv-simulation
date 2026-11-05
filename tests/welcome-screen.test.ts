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
    select("welcomeDroneSelect", "axisflying-manta5-dc");
    expect(navigate).not.toHaveBeenCalled();
    document.getElementById("welcomePlayBtn")!.click();
    const target = new URL(navigate.mock.calls[0][0]);
    expect(target.pathname).toBe("/fpv/play.html");
    expect(localStorage.getItem("drone_sim_world")).toBe("ekotori");
    expect(localStorage.getItem("drone_sim_drone")).toBe("axisflying-manta5-dc");
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
  it("restores a saved drone and ignores an unknown one", () => {
    localStorage.setItem("drone_sim_drone", "axisflying-manta5-dc");
    setupWelcomeScreen(vi.fn());
    const drone = document.getElementById("welcomeDroneSelect") as HTMLSelectElement;
    expect(drone.value).toBe("axisflying-manta5-dc");
    document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
    localStorage.setItem("drone_sim_drone", "removed-drone");
    setupWelcomeScreen(vi.fn());
    expect((document.getElementById("welcomeDroneSelect") as HTMLSelectElement).value).toBe("tinyhawk-iii-plus");
  });
  it("shows map and drone carousels with a thumbnail for every option", () => {
    localStorage.setItem("drone_sim_world", "dedust");
    setupWelcomeScreen(vi.fn());
    for (const [id, count] of [["welcomeWorldSelect", 5], ["welcomeDroneSelect", 2]] as const) {
      const select = document.getElementById(id) as HTMLSelectElement;
      expect(select.closest("label")!.hidden).toBe(true);
      const cards = document.querySelectorAll<HTMLElement>(`#${id}Carousel [role="radio"]`);
      expect(cards).toHaveLength(count);
      for (const card of cards) {
        expect(card.querySelector("img")!.getAttribute("src")).toMatch(/thumbnails\/(maps|drones)\/[\w-]+\.jpg$/);
      }
    }
    const checked = document.querySelector('#welcomeWorldSelectCarousel [aria-checked="true"]') as HTMLElement;
    expect(checked.dataset.value).toBe("dedust");
    expect(checked.tabIndex).toBe(0);
  });
  it("selects with a card click, the arrows, and the arrow keys", () => {
    const navigate = vi.fn();
    setupWelcomeScreen(navigate);
    const world = document.getElementById("welcomeWorldSelect") as HTMLSelectElement;
    const carousel = document.getElementById("welcomeWorldSelectCarousel")!;
    const onChange = vi.fn();
    world.addEventListener("change", onChange);
    (carousel.querySelector('[data-value="factory-splat"]') as HTMLElement).click();
    expect(world.value).toBe("factory-splat");
    expect(onChange).toHaveBeenCalledTimes(1);
    (carousel.querySelector('[aria-label="Next map"]') as HTMLElement).click();
    expect(world.value).toBe("ekotori");
    (carousel.querySelector('[aria-label="Next map"]') as HTMLElement).click();
    expect(world.value).toBe("island");
    (carousel.querySelector('[aria-label="Previous map"]') as HTMLElement).click();
    expect(world.value).toBe("ekotori");
    const track = carousel.querySelector('[role="radiogroup"]')!;
    track.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(world.value).toBe("island");
    track.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(world.value).toBe("forest");
    expect(document.activeElement).toBe(carousel.querySelector('[data-value="forest"]'));
    (document.querySelector('#welcomeDroneSelectCarousel [data-value="axisflying-manta5-dc"]') as HTMLElement).click();
    document.getElementById("welcomePlayBtn")!.click();
    expect(localStorage.getItem("drone_sim_world")).toBe("forest");
    expect(localStorage.getItem("drone_sim_drone")).toBe("axisflying-manta5-dc");
  });
  it("follows select changes made by other code", () => {
    setupWelcomeScreen(vi.fn());
    select("welcomeDroneSelect", "axisflying-manta5-dc");
    const checked = document.querySelector('#welcomeDroneSelectCarousel [aria-checked="true"]') as HTMLElement;
    expect(checked.dataset.value).toBe("axisflying-manta5-dc");
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
