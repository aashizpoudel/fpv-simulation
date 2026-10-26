import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupVrButtons } from "../src/ui/vr-buttons";
import { reportLoading } from "../src/ui/loading-overlay";

const html = readFileSync("play.html", "utf8");
const vrButton = () => document.getElementById("vrToggleBtn") as HTMLButtonElement;
const choice = () => ({ control: "keyboard" as const, mode: "angle" as const });
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function stubXr(supported: boolean) {
  vi.stubGlobal("navigator", {
    ...navigator,
    xr: {
      isSessionSupported: vi.fn(async () => supported),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
}

beforeEach(() => {
  const page = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = page.body.innerHTML;
});

afterEach(() => vi.unstubAllGlobals());

describe("VR buttons", () => {
  it("stay hidden without a VR headset", async () => {
    stubXr(false);
    setupVrButtons("threejs", Promise.resolve({} as never), choice);
    await flush();
    expect(vrButton().hidden).toBe(true);
  });

  it("show as soon as a headset is detected, disabled until the map loads", async () => {
    stubXr(true);
    let ready!: (value: never) => void;
    setupVrButtons("threejs", new Promise((r) => { ready = r; }), choice);
    await flush();
    expect(vrButton().hidden).toBe(false);
    expect(vrButton().disabled).toBe(true);

    ready({ enterVr: vi.fn() } as never);
    await flush();
    expect(vrButton().disabled).toBe(false);
  });

  it("shows map loading progress on the welcome button until it can be used", async () => {
    document.body.innerHTML += '<button id="testVrTextBtn" type="button" data-vr-button hidden>Play in VR</button>';
    const textBtn = () => document.getElementById("testVrTextBtn") as HTMLButtonElement;
    stubXr(true);
    let ready!: (value: never) => void;
    setupVrButtons("threejs", new Promise((r) => { ready = r; }), choice);
    await flush();
    expect(textBtn().textContent).toBe("Play in VR · loading…");

    reportLoading("Loading environment… 45%", 0.45);
    expect(textBtn().textContent).toBe("Play in VR · loading 45%");
    reportLoading("Loading environment… 100%", 1);
    reportLoading("Preparing environment detail…");
    expect(textBtn().textContent).toBe("Play in VR · preparing…");

    ready({ enterVr: vi.fn() } as never);
    await flush();
    expect(textBtn().textContent).toBe("Play in VR");
    expect(textBtn().disabled).toBe(false);
    expect(vrButton().querySelector("svg")).not.toBeNull();
  });

  it("says when the map failed to load", async () => {
    stubXr(true);
    setupVrButtons("threejs", Promise.reject(new Error("no map")), choice);
    await flush();
    expect(vrButton().title).toBe("Play in VR · map failed to load");
    expect(vrButton().disabled).toBe(true);
  });

  it("offers the motion controller only when a headset is detected", async () => {
    document.body.innerHTML += '<select id="welcomeControlSelect"><option value="motion" data-vr-only hidden disabled>Motion</option></select>';
    const motion = () => document.querySelector<HTMLOptionElement>('#welcomeControlSelect option[value="motion"]')!;
    expect(motion().hidden).toBe(true);
    stubXr(true);
    setupVrButtons("threejs", Promise.resolve({} as never), choice);
    await flush();
    expect(motion().hidden).toBe(false);
    expect(motion().disabled).toBe(false);
  });

  it("stay hidden for the Cesium renderer", async () => {
    stubXr(true);
    setupVrButtons("cesium", Promise.resolve({} as never), choice);
    await flush();
    expect(vrButton().hidden).toBe(true);
  });
});
