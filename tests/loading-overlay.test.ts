import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { reportLoading, setupLoadingOverlay } from "../src/ui/loading-overlay";

const html = readFileSync("index.html", "utf8");
const overlay = () => document.getElementById("loadingOverlay")!;

beforeEach(() => {
  const page = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = page.body.innerHTML;
});

describe("map loading overlay", () => {
  it("stays hidden until shown, then reports progress", () => {
    const loading = setupLoadingOverlay(new Promise(() => {}));
    expect(overlay().hidden).toBe(true);
    loading.show();
    expect(overlay().hidden).toBe(false);

    reportLoading("Loading environment… 40%", 0.4);
    expect(document.getElementById("loadingOverlayText")!.textContent).toBe("Loading environment… 40%");
    expect(document.getElementById("loadingOverlayBar")!.style.width).toBe("40%");
    expect(overlay().querySelector(".loading-bar")!.classList.contains("indeterminate")).toBe(false);
  });

  it("hides when the map is ready or fails, and is not shown afterwards", async () => {
    let resolve!: () => void;
    const loading = setupLoadingOverlay(new Promise<void>((r) => { resolve = r; }));
    loading.show();
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(overlay().hidden).toBe(true);
    loading.show();
    expect(overlay().hidden).toBe(true);

    const failing = setupLoadingOverlay(Promise.reject(new Error("no map")));
    failing.show();
    await Promise.resolve();
    await Promise.resolve();
    expect(overlay().hidden).toBe(true);
  });
});
