import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { setupGameStart } from "../src/app/game-start";
import { parsePlayChoices } from "../src/app/page-navigation";

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(readFileSync("play.html", "utf8"), "text/html").body.innerHTML;
  window.history.replaceState(null, "", "/repo/play.html");
});
it("starts direct game visits with default desktop choices", async () => {
  const play = vi.fn(async () => true);
  setupGameStart(Promise.resolve({ play, enterVr: vi.fn() }), parsePlayChoices(""));
  await vi.waitFor(() => expect(play).toHaveBeenCalledWith("keyboard", "angle"));
  expect(document.body.classList.contains("welcome-active")).toBe(false);
  expect(window.location.pathname).toBe("/repo/play.html");
});
it("reports error when gamepad is unavailable", async () => {
  const play = vi.fn(async (control: string) => control === "keyboard");
  setupGameStart(Promise.resolve({ play, enterVr: vi.fn() }), parsePlayChoices("?input=gamepad&mode=acro"));
  await vi.waitFor(() => expect(document.getElementById("lodStatus")!.textContent).toContain("Gamepad unavailable"));
  expect(document.getElementById("lodStatus")!.dataset.state).toBe("error");
});
it("does not auto-play when motion controller is selected", async () => {
  const play = vi.fn(async () => true);
  const enterVr = vi.fn();
  setupGameStart(Promise.resolve({ play, enterVr }), parsePlayChoices("?input=motion&vr=1"));
  await Promise.resolve();
  expect(enterVr).not.toHaveBeenCalled();
  expect(play).not.toHaveBeenCalled();
});
it("shows load error on lodStatus", async () => {
  setupGameStart(Promise.reject(new Error("map failed")), parsePlayChoices(""));
  await vi.waitFor(() => expect(document.getElementById("lodStatus")!.textContent).toContain("map failed"));
  expect(document.querySelector('a[aria-label="Home"]')).not.toBeNull();
});
