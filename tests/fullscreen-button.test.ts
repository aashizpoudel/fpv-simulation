import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupFullscreenButton } from "../src/ui/fullscreen-button";

const html = readFileSync("play.html", "utf8");
let fullscreenElement: Element | null = null;
beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  fullscreenElement = null;
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
});
afterEach(() => {
  delete (document as Partial<Document>).fullscreenElement;
  delete (document as Partial<Document>).fullscreenEnabled;
  delete (document.documentElement as Partial<HTMLElement>).requestFullscreen;
  delete (document as Partial<Document>).exitFullscreen;
});
const button = () => document.getElementById("fullscreenToggleBtn") as HTMLButtonElement;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("fullscreen button", () => {
  it("sits right of the settings button", () => {
    expect(document.getElementById("settingsToggleBtn")!.nextElementSibling).toBe(button());
  });

  it("stays hidden when the Fullscreen API is unavailable", () => {
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: false });
    setupFullscreenButton();
    expect(button().style.display).toBe("none");
  });

  it("enters and exits fullscreen and updates its label and icon", async () => {
    const request = vi.fn(async () => {
      fullscreenElement = document.documentElement;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    const exit = vi.fn(async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: request });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });
    setupFullscreenButton();
    expect(button().style.display).toBe("");
    expect(button().getAttribute("aria-label")).toBe("Enter fullscreen");

    button().click();
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(button().getAttribute("aria-label")).toBe("Exit fullscreen");
    expect(button().querySelector<SVGElement>(".fullscreen-enter-icon")!.style.display).toBe("none");
    expect(button().querySelector<SVGElement>(".fullscreen-exit-icon")!.style.display).toBe("");

    button().click();
    await flush();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(button().getAttribute("aria-label")).toBe("Enter fullscreen");
  });

  it("keeps working when the browser refuses fullscreen", async () => {
    Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: vi.fn(async () => { throw new Error("Denied"); }) });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: vi.fn() });
    setupFullscreenButton();
    button().click();
    await flush();
    expect(button().getAttribute("aria-label")).toBe("Enter fullscreen");
  });
});
