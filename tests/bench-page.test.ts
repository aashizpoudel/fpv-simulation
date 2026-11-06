import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupBenchControls, startBenchFlight } from "../src/app/bench-page";
import { parsePlayChoices } from "../src/app/page-navigation";
import { defaultPreset } from "../src/config/presets";
import type { DroneConfig } from "../src/config/drone-config";

const benchHtml = readFileSync("bench.html", "utf8");

describe("bench.html tuning lab", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    const doc = new DOMParser().parseFromString(benchHtml, "text/html");
    // Remove renderingContainer during unit tests so top-level auto-boot does not run
    doc.getElementById("renderingContainer")?.remove();
    document.body.innerHTML = doc.body.innerHTML;
  });

  it("does not include a map selection control on bench.html", () => {
    expect(document.getElementById("worldSelect")).toBeNull();
    expect(document.getElementById("welcomeWorldSelect")).toBeNull();
  });

  it("collapses and expands the configuration sidebar and triggers viewport resize", () => {
    const onResize = vi.fn();
    setupBenchControls({ initialConfig: defaultPreset(), onResize });

    const sidebar = document.getElementById("benchSidebar")!;
    const collapseBtn = document.getElementById("benchCollapseBtn")!;
    const expandBtn = document.getElementById("benchExpandBtn")!;

    expect(sidebar.hidden).toBe(false);
    expect(expandBtn.hidden).toBe(true);

    collapseBtn.click();
    expect(sidebar.hidden).toBe(true);
    expect(expandBtn.hidden).toBe(false);
    expect(onResize).toHaveBeenCalledTimes(1);

    expandBtn.click();
    expect(sidebar.hidden).toBe(false);
    expect(expandBtn.hidden).toBe(true);
    expect(onResize).toHaveBeenCalledTimes(2);
  });

  it("only applies and reloads when Apply to Drone is clicked", async () => {
    let applied: DroneConfig | undefined;
    setupBenchControls({
      initialConfig: defaultPreset(),
      onApply: (cfg) => {
        applied = cfg;
      },
    });

    const setControl = (id: string, value: string) => {
      const el = document.getElementById(id) as HTMLInputElement;
      el.value = value;
      el.dispatchEvent(new Event("input"));
      el.dispatchEvent(new Event("change"));
    };

    setControl("benchRollP", "62");
    setControl("benchPitchD", "41");
    setControl("benchYawI", "28");
    setControl("benchRollSuperRate", "0.80");
    setControl("benchMassG", "52");
    setControl("benchMaxThrust", "0.28");
    setControl("benchGyroVibration", "0.045");

    // Previews update immediately, but config is not applied until button click
    expect(document.getElementById("benchMaxVelRoll")!.textContent).toBe("1000 °/s");
    expect(applied).toBeUndefined();

    (document.getElementById("benchApplyBtn") as HTMLButtonElement).click();

    expect(applied).toBeDefined();
    expect(applied!.betaflightPids.roll.p).toBe(62);
    expect(applied!.betaflightPids.pitch.d).toBe(41);
    expect(applied!.betaflightPids.yaw.i).toBe(28);
    expect(applied!.rates.roll?.superRate).toBeCloseTo(0.8);
    expect(applied!.mass).toBeCloseTo(0.052);
    expect(applied!.rotors.every((r) => Math.abs(r.maxThrust - 0.28) < 1e-6)).toBe(true);
    expect(applied!.imu.gyroVibration).toBeCloseTo(0.045);
  });

  it("switches to keyboard automatically when gamepad is not detected", async () => {
    const play = vi.fn(async (control: "keyboard" | "gamepad") => control === "keyboard");
    startBenchFlight(
      Promise.resolve({ play, enterVr: vi.fn() }),
      parsePlayChoices("?input=gamepad&mode=acro"),
    );

    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(play).toHaveBeenNthCalledWith(1, "gamepad", "acro");
    expect(play).toHaveBeenNthCalledWith(2, "keyboard", "acro");
    expect(document.getElementById("lodStatus")?.dataset.state).toBeUndefined();
  });

  it("renders realtime PID step response and live target/gyro telemetry curves for Roll, Pitch, and Yaw", () => {
    const bench = setupBenchControls({
      initialConfig: defaultPreset(),
      onApply: () => {},
    });

    for (const axis of ["Roll", "Pitch", "Yaw"] as const) {
      expect(document.getElementById(`benchPidStep${axis}`)!.getAttribute("d")).toContain("M28.0,41.0");
      expect(document.getElementById(`benchPidLabel${axis}`)!.textContent).toContain(`${axis} Step`);
    }

    // Stream two telemetry frames to populate the live target & gyro polylines
    for (let i = 0; i < 4; i++) {
      bench.pushTelemetryFrame(
        {
          localPosition: { x: 0, y: 0, z: 1 },
          localOrientation: { x: 0, y: 0, z: 0, w: 1 },
          localVelocity: { x: 0, y: 0, z: 0 },
          localAngularVelocity: { x: 0, y: 0, z: 0 },
          imuGyro: { x: 1.5, y: -0.9, z: 0.6 },
          gforce: 1,
          throttle: 50,
          rotorThrusts: [0.1, 0.1, 0.1, 0.1],
          crashed: false,
          armed: true,
        },
        { thrust: 0, throttle: 0.5, roll: 0.4, pitch: -0.3, yaw: 0.2, arm: true, reset: false, speedMultiplier: 1 },
        "acro",
      );
    }

    for (const axis of ["Roll", "Pitch", "Yaw"] as const) {
      expect(document.getElementById(`benchPidLiveTarget${axis}`)!.getAttribute("d")).toContain("M28.0,");
      expect(document.getElementById(`benchPidLiveGyro${axis}`)!.getAttribute("d")).toContain("M28.0,");
      expect(document.getElementById(`benchPidLabel${axis}`)!.textContent).toContain("Target");
    }
  });

  it("collapses setting groups by default and restores opened groups and scroll position on reload", () => {
    setupBenchControls({ initialConfig: defaultPreset() });

    const pidSection = document.getElementById("benchSectionPids") as HTMLDetailsElement;
    const ratesSection = document.getElementById("benchSectionRates") as HTMLDetailsElement;
    const airframeSection = document.getElementById("benchSectionAirframe") as HTMLDetailsElement;
    const imuSection = document.getElementById("benchSectionImu") as HTMLDetailsElement;
    const scrollEl = document.querySelector<HTMLElement>(".bench-sidebar-scroll")!;

    expect(pidSection.open).toBe(false);
    expect(ratesSection.open).toBe(false);
    expect(airframeSection.open).toBe(false);
    expect(imuSection.open).toBe(false);

    // Open Rates and IMU, and scroll down
    ratesSection.open = true;
    ratesSection.dispatchEvent(new Event("toggle"));
    imuSection.open = true;
    imuSection.dispatchEvent(new Event("toggle"));
    scrollEl.scrollTop = 185;
    scrollEl.dispatchEvent(new Event("scroll"));

    // Simulate reload with fresh DOM
    const doc = new DOMParser().parseFromString(benchHtml, "text/html");
    doc.getElementById("renderingContainer")?.remove();
    document.body.innerHTML = doc.body.innerHTML;

    setupBenchControls({ initialConfig: defaultPreset() });

    expect((document.getElementById("benchSectionPids") as HTMLDetailsElement).open).toBe(false);
    expect((document.getElementById("benchSectionRates") as HTMLDetailsElement).open).toBe(true);
    expect((document.getElementById("benchSectionAirframe") as HTMLDetailsElement).open).toBe(false);
    expect((document.getElementById("benchSectionImu") as HTMLDetailsElement).open).toBe(true);
    expect(document.querySelector<HTMLElement>(".bench-sidebar-scroll")!.scrollTop).toBe(185);
  });
});
