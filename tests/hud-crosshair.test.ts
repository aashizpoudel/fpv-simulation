import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  isCrosshairEnabled,
  setCrosshairEnabled,
  subscribeCrosshair,
  isHorizonLineEnabled,
  setHorizonLineEnabled,
  subscribeHorizonLine,
} from "../src/app/crosshair-preferences";

const html = readFileSync("index.html", "utf8");

describe("HUD crosshair and horizon line visibility", () => {
  let crosshairEl: HTMLElement;
  let horizonEl: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
    localStorage.clear();
    crosshairEl = document.querySelector<HTMLElement>(".osd-crosshair")!;
    horizonEl = document.querySelector<HTMLElement>(".osd-horizon-line")!;
  });

  it("is present in the DOM and starts without the show class", () => {
    expect(crosshairEl).not.toBeNull();
    expect(crosshairEl.classList.contains("show")).toBe(false);
    expect(isCrosshairEnabled()).toBe(false);

    expect(horizonEl).not.toBeNull();
    expect(horizonEl.classList.contains("show")).toBe(false);
    expect(isHorizonLineEnabled()).toBe(false);
  });

  it("updates visibility based on crosshair setting and camera mode", () => {
    let crosshairEnabled = isCrosshairEnabled();
    let cameraMode = "fpv";

    const updateCrosshair = () => {
      crosshairEl.classList.toggle("show", crosshairEnabled && cameraMode === "fpv");
    };

    const unsubscribe = subscribeCrosshair((enabled) => {
      crosshairEnabled = enabled;
      updateCrosshair();
    });

    try {
      // Default: disabled, in FPV -> not shown
      expect(crosshairEl.classList.contains("show")).toBe(false);

      // Enable crosshair in FPV -> shown
      setCrosshairEnabled(true);
      expect(crosshairEl.classList.contains("show")).toBe(true);

      // Switch to third person -> hidden
      cameraMode = "third";
      updateCrosshair();
      expect(crosshairEl.classList.contains("show")).toBe(false);

      // Switch to orbit -> hidden
      cameraMode = "orbit";
      updateCrosshair();
      expect(crosshairEl.classList.contains("show")).toBe(false);

      // Switch back to FPV -> shown
      cameraMode = "fpv";
      updateCrosshair();
      expect(crosshairEl.classList.contains("show")).toBe(true);

      // Disable crosshair while in FPV -> hidden
      setCrosshairEnabled(false);
      expect(crosshairEl.classList.contains("show")).toBe(false);
    } finally {
      unsubscribe();
    }
  });

  it("updates horizon line visibility based on setting and camera mode", () => {
    let horizonEnabled = isHorizonLineEnabled();
    let cameraMode = "fpv";

    const updateHorizon = () => {
      horizonEl.classList.toggle("show", horizonEnabled && cameraMode === "fpv");
    };

    const unsubscribe = subscribeHorizonLine((enabled) => {
      horizonEnabled = enabled;
      updateHorizon();
    });

    try {
      // Default: disabled, in FPV -> not shown
      expect(horizonEl.classList.contains("show")).toBe(false);

      // Enable horizon in FPV -> shown
      setHorizonLineEnabled(true);
      expect(horizonEl.classList.contains("show")).toBe(true);

      // Switch to third person -> hidden
      cameraMode = "third";
      updateHorizon();
      expect(horizonEl.classList.contains("show")).toBe(false);

      // Switch to orbit -> hidden
      cameraMode = "orbit";
      updateHorizon();
      expect(horizonEl.classList.contains("show")).toBe(false);

      // Switch back to FPV -> shown
      cameraMode = "fpv";
      updateHorizon();
      expect(horizonEl.classList.contains("show")).toBe(true);

      // Disable horizon while in FPV -> hidden
      setHorizonLineEnabled(false);
      expect(horizonEl.classList.contains("show")).toBe(false);
    } finally {
      unsubscribe();
    }
  });
});
