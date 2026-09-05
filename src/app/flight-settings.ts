import { storeReplay, consumeReplay } from "./replay-storage";
import type { DroneConfig } from "../config/drone-config";
import {
  defaultPreset,
  parsePreset,
  exportPreset,
  PRESET_STORAGE_KEY,
} from "../config/presets";
import { parseRecording, type FlightRecording } from "../core/flight-recording";

export function downloadJson(name: string, text: string): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function loadFlightConfig(): DroneConfig {
  const saved = localStorage.getItem(PRESET_STORAGE_KEY);
  if (!saved) return defaultPreset();
  try {
    return parsePreset(saved);
  } catch (error) {
    const message = document.getElementById("flightSettingsStatus");
    if (message)
      message.textContent = `Saved preset could not be loaded: ${(error as Error).message}. Using defaults.`;
    return defaultPreset();
  }
}
export function setupFlightSettings(config: DroneConfig, world: string): void {
  const flightHelp = document.querySelector<HTMLDetailsElement>(".flight-help");
  const settingsToggleBtn = document.getElementById("settingsToggleBtn");
  const closeSettingsBtn = document.getElementById("closeSettingsBtn");

  // On by default; when apply is pressed, the setting should not be displayed anymore.
  const hideSettings = sessionStorage.getItem("fpv_hide_settings") === "true";
  if (flightHelp) {
    flightHelp.open = !hideSettings;
    flightHelp.addEventListener("toggle", () => {
      sessionStorage.setItem(
        "fpv_hide_settings",
        flightHelp.open ? "false" : "true",
      );
    });
  }

  if (settingsToggleBtn) {
    settingsToggleBtn.addEventListener("click", () => {
      if (!flightHelp) return;
      flightHelp.open = !flightHelp.open;
      sessionStorage.setItem(
        "fpv_hide_settings",
        flightHelp.open ? "false" : "true",
      );
    });
  }

  const closeSettings = (e?: Event) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (flightHelp) {
      flightHelp.open = false;
      sessionStorage.setItem("fpv_hide_settings", "true");
    }
  };

  const summaryEl = flightHelp?.querySelector("summary");
  if (summaryEl) {
    summaryEl.addEventListener("click", (e) => {
      if ((e.target as HTMLElement)?.closest("#closeSettingsBtn")) {
        closeSettings(e);
      } else {
        // Prevent accidental modal toggle when clicking modal header
        e.preventDefault();
      }
    });
  }

  if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener("click", closeSettings);
  }

  const closeSettingsFooterBtn = document.getElementById(
    "closeSettingsFooterBtn",
  );
  if (closeSettingsFooterBtn) {
    closeSettingsFooterBtn.addEventListener("click", closeSettings);
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && flightHelp?.open) {
      closeSettings();
    }
  });

  const input = (id: string) => document.getElementById(id) as HTMLInputElement;
  const status = document.getElementById("flightSettingsStatus")!;
  const advanced = document.getElementById(
    "advancedPreset",
  ) as HTMLTextAreaElement;
  const fill = (c: DroneConfig) => {
    input("rateRoll").value = String(c.pidRateConfig!.maxRate.roll);
    input("ratePitch").value = String(c.pidRateConfig!.maxRate.pitch);
    input("rateYaw").value = String(c.pidRateConfig!.maxRate.yaw);
    input("rateExpo").value = String(c.rates.expo);
    input("cameraTilt").value = String(c.cameraConfig!.fpvTiltDeg);
    input("batteryCharge").value = String(c.battery.initialCharge * 100);
    input("airmode").checked = c.propulsion.airmode;
    advanced.value = exportPreset(c);
    document.getElementById("presetName")!.textContent = c.name;
  };
  fill(config);
  const apply = (c: DroneConfig) => {
    localStorage.setItem(PRESET_STORAGE_KEY, exportPreset(c));
    sessionStorage.setItem("fpv_hide_settings", "true");
    if (flightHelp) flightHelp.open = false;
    location.reload();
  };
  const action = (id: string, fn: () => void) =>
    document.getElementById(id)!.addEventListener("click", () => {
      try {
        fn();
      } catch (error) {
        status.textContent = (error as Error).message;
      }
    });
  action("applyFlightSettings", () => {
    const c = structuredClone(config);
    for (const [axis, id] of [
      ["roll", "rateRoll"],
      ["pitch", "ratePitch"],
      ["yaw", "rateYaw"],
    ] as const)
      c.pidRateConfig!.maxRate[axis] = Number(input(id).value);
    c.rates.expo = Number(input("rateExpo").value);
    c.cameraConfig!.fpvTiltDeg = Number(input("cameraTilt").value);
    c.battery.initialCharge = Number(input("batteryCharge").value) / 100;
    c.propulsion.airmode = input("airmode").checked;
    apply(c);
  });
  action("restoreFlightSettings", () => apply(defaultPreset()));
  action("exportFlightPreset", () =>
    downloadJson("whoop-preset.json", exportPreset(config)),
  );
  action("applyAdvancedPreset", () => apply(parsePreset(advanced.value)));
  input("importFlightPreset").addEventListener("change", async () => {
    try {
      const file = input("importFlightPreset").files?.[0];
      if (file) {
        if (file.size > 100_000) throw new Error("Preset is too large");
        apply(parsePreset(await file.text()));
      }
    } catch (error) {
      status.textContent = (error as Error).message;
    }
  });
  input("importFlightRecording").addEventListener("change", async () => {
    try {
      const file = input("importFlightRecording").files?.[0];
      if (!file) return;
      if (file.size > 20_000_000) throw new Error("Recording exceeds 20 MB");
      const text = await file.text();
      const recording = parseRecording(text);
      if (recording.world !== world)
        throw new Error(
          `Select the recording environment (${recording.world}) before replaying.`,
        );
      // Persist pending replay first; quota failure must not alter active settings.
      await storeReplay(text);
      apply(recording.config);
    } catch (error) {
      status.textContent = (error as Error).message;
    }
  });
}
export async function takePendingReplay(
  world: string,
): Promise<FlightRecording | undefined> {
  const text = await consumeReplay();
  if (!text) return;
  const recording = parseRecording(text);
  if (recording.world !== world)
    throw new Error("Replay environment differs from active world");
  return recording;
}
