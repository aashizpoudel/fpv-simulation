import { storeReplay, consumeReplay } from "./replay-storage";
import { setupSettingsTabs } from "./settings-tabs";
import type {
  AxisRateConfig,
  BetaflightRatesType,
  DroneConfig,
} from "../config/drone-config";
import {
  defaultPreset,
  normalizePreset,
  parsePreset,
  exportPreset,
  PRESET_STORAGE_KEY,
} from "../config/presets";
import {
  evaluateBetaflightRateDps,
  RATES_TYPE_META,
  resolveAxisRates,
} from "../controllers/rates";
import { downloadJson } from "./download";
import { parseRecording, type FlightRecording } from "../core/flight-recording";
import { STORAGE_KEYS } from "./storage-keys";
import { loadSelectedDrone } from "./drone-selection";

export function loadFlightConfig(): DroneConfig {
  const saved = localStorage.getItem(PRESET_STORAGE_KEY);
  if (!saved) return normalizePreset(loadSelectedDrone().config);
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
  setupSettingsTabs();
  const flightHelp = document.querySelector<HTMLDetailsElement>(".flight-help");
  const settingsToggleBtn = document.getElementById("settingsToggleBtn");
  const closeSettingsBtn = document.getElementById("closeSettingsBtn");

  if (flightHelp) {
    flightHelp.open = false;
    flightHelp.addEventListener("toggle", () => {
      sessionStorage.setItem(
        STORAGE_KEYS.hideSettings,
        flightHelp.open ? "false" : "true",
      );
    });
  }

  if (settingsToggleBtn) {
    settingsToggleBtn.addEventListener("click", () => {
      if (!flightHelp) return;
      flightHelp.open = !flightHelp.open;
      sessionStorage.setItem(
        STORAGE_KEYS.hideSettings,
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
      sessionStorage.setItem(STORAGE_KEYS.hideSettings, "true");
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
  const select = (id: string) => document.getElementById(id) as HTMLSelectElement | null;
  const status = document.getElementById("flightSettingsStatus")!;
  const advanced = document.getElementById(
    "advancedPreset",
  ) as HTMLTextAreaElement;

  const axisInputs = {
    roll: { rc: "rateRc", super: "rateSuper", expo: "rateExpo", limit: "rateRoll", maxVel: "maxVelRoll", path: "ratesCurveRoll" },
    pitch: { rc: "rateRcPitch", super: "rateSuperPitch", expo: "rateExpoPitch", limit: "ratePitch", maxVel: "maxVelPitch", path: "ratesCurvePitch" },
    yaw: { rc: "rateRcYaw", super: "rateSuperYaw", expo: "rateExpoYaw", limit: "rateYaw", maxVel: "maxVelYaw", path: "ratesCurveYaw" },
  } as const;

  const syncRateTypeBounds = (type: BetaflightRatesType) => {
    const meta = RATES_TYPE_META[type] ?? RATES_TYPE_META.betaflight;
    const rcHeader = document.getElementById("bfColRcRate");
    const superHeader = document.getElementById("bfColSuperRate");
    const expoHeader = document.getElementById("bfColExpo");
    if (rcHeader) rcHeader.textContent = meta.rcRateLabel;
    if (superHeader) superHeader.textContent = meta.superRateLabel;
    if (expoHeader) expoHeader.textContent = meta.expoLabel;

    for (const axis of ["roll", "pitch", "yaw"] as const) {
      const ids = axisInputs[axis];
      const rcEl = document.getElementById(ids.rc) as HTMLInputElement | null;
      const superEl = document.getElementById(ids.super) as HTMLInputElement | null;
      const expoEl = document.getElementById(ids.expo) as HTMLInputElement | null;
      if (rcEl) {
        rcEl.min = String(meta.rcRate.min);
        rcEl.max = String(meta.rcRate.max);
        rcEl.step = String(meta.rcRate.step);
      }
      if (superEl) {
        superEl.min = String(meta.superRate.min);
        superEl.max = String(meta.superRate.max);
        superEl.step = String(meta.superRate.step);
      }
      if (expoEl) {
        expoEl.min = String(meta.expo.min);
        expoEl.max = String(meta.expo.max);
        expoEl.step = String(meta.expo.step);
      }
    }
  };

  const readAxisFromDom = (axis: "roll" | "pitch" | "yaw"): AxisRateConfig => {
    const ids = axisInputs[axis];
    const rcEl = document.getElementById(ids.rc) as HTMLInputElement | null;
    const superEl = document.getElementById(ids.super) as HTMLInputElement | null;
    const expoEl = document.getElementById(ids.expo) as HTMLInputElement | null;
    return {
      rcRate: Number(rcEl?.value ?? input("rateRc").value),
      superRate: Number(superEl?.value ?? input("rateSuper").value),
      expo: Number(expoEl?.value ?? input("rateExpo").value),
    };
  };

  const updateRatesPreview = () => {
    const typeSelect = select("ratesTypeSelect");
    const rateType = ((typeSelect?.value as BetaflightRatesType) || config.rates.type || "betaflight");
    const peaks: Record<"roll" | "pitch" | "yaw", number> = { roll: 0, pitch: 0, yaw: 0 };
    const curves: Record<"roll" | "pitch" | "yaw", AxisRateConfig> = {
      roll: readAxisFromDom("roll"),
      pitch: readAxisFromDom("pitch"),
      yaw: readAxisFromDom("yaw"),
    };

    for (const axis of ["roll", "pitch", "yaw"] as const) {
      const maxDps = Math.round(
        Math.abs(evaluateBetaflightRateDps(1, curves[axis], rateType)),
      );
      peaks[axis] = maxDps;
      const out = document.getElementById(axisInputs[axis].maxVel);
      if (out) out.textContent = `${maxDps} °/s`;
    }

    const overallMax = Math.max(100, peaks.roll, peaks.pitch, peaks.yaw);
    const maxLabel = document.getElementById("ratesCurveMaxLabel");
    if (maxLabel) maxLabel.textContent = `${overallMax} °/s`;

    const x0 = 28;
    const x1 = 252;
    const y0 = 96;
    const y1 = 12;
    const steps = 32;

    for (const axis of ["roll", "pitch", "yaw"] as const) {
      const pathEl = document.getElementById(axisInputs[axis].path);
      if (!pathEl) continue;
      const pts: string[] = [];
      for (let i = 0; i <= steps; i++) {
        const s = i / steps;
        const dps = Math.abs(evaluateBetaflightRateDps(s, curves[axis], rateType));
        const px = x0 + s * (x1 - x0);
        const py = y0 - Math.min(1, dps / overallMax) * (y0 - y1);
        pts.push(`${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`);
      }
      pathEl.setAttribute("d", pts.join(" "));
    }
  };

  const fill = (c: DroneConfig) => {
    const rateType = c.rates.type ?? "betaflight";
    const typeSelect = select("ratesTypeSelect");
    if (typeSelect) typeSelect.value = rateType;
    syncRateTypeBounds(rateType);

    for (const axis of ["roll", "pitch", "yaw"] as const) {
      const r = resolveAxisRates(c.rates, axis);
      const ids = axisInputs[axis];
      const rcEl = document.getElementById(ids.rc) as HTMLInputElement | null;
      const superEl = document.getElementById(ids.super) as HTMLInputElement | null;
      const expoEl = document.getElementById(ids.expo) as HTMLInputElement | null;
      if (rcEl) rcEl.value = String(r.rcRate);
      if (superEl) superEl.value = String(r.superRate);
      if (expoEl) expoEl.value = String(r.expo);
      input(ids.limit).value = String(c.pidRateConfig!.maxRate[axis]);
    }

    input("cameraTilt").value = String(c.cameraConfig!.fpvTiltDeg);
    input("batteryCharge").value = String(c.battery.initialCharge * 100);
    input("airmode").checked = c.propulsion.airmode;
    advanced.value = exportPreset(c);
    document.getElementById("presetName")!.textContent = c.name;
    updateRatesPreview();
  };

  fill(config);

  const typeSelect = select("ratesTypeSelect");
  typeSelect?.addEventListener("change", () => {
    const nextType = (typeSelect.value as BetaflightRatesType) || "betaflight";
    const meta = RATES_TYPE_META[nextType] ?? RATES_TYPE_META.betaflight;
    syncRateTypeBounds(nextType);
    for (const axis of ["roll", "pitch", "yaw"] as const) {
      const ids = axisInputs[axis];
      const rcEl = document.getElementById(ids.rc) as HTMLInputElement | null;
      const superEl = document.getElementById(ids.super) as HTMLInputElement | null;
      const expoEl = document.getElementById(ids.expo) as HTMLInputElement | null;
      if (rcEl) rcEl.value = String(meta.rcRate.defaultVal);
      if (superEl) superEl.value = String(meta.superRate.defaultVal);
      if (expoEl) expoEl.value = String(meta.expo.defaultVal);
    }
    updateRatesPreview();
  });

  for (const axis of ["roll", "pitch", "yaw"] as const) {
    const ids = axisInputs[axis];
    for (const id of [ids.rc, ids.super, ids.expo, ids.limit]) {
      document.getElementById(id)?.addEventListener("input", updateRatesPreview);
    }
  }

  const apply = (c: DroneConfig) => {
    localStorage.setItem(PRESET_STORAGE_KEY, exportPreset(c));
    sessionStorage.setItem(STORAGE_KEYS.hideSettings, "true");
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
  const applyCurrentFlightSettings = () => {
    const c = structuredClone(config);
    for (const [axis, id] of [
      ["roll", "rateRoll"],
      ["pitch", "ratePitch"],
      ["yaw", "rateYaw"],
    ] as const)
      c.pidRateConfig!.maxRate[axis] = Number(input(id).value);

    const rateType = ((select("ratesTypeSelect")?.value as BetaflightRatesType) || c.rates.type || "betaflight");
    const rollRates = readAxisFromDom("roll");
    const pitchRates = readAxisFromDom("pitch");
    const yawRates = readAxisFromDom("yaw");

    c.rates.rcRate = rollRates.rcRate;
    c.rates.superRate = rollRates.superRate;
    c.rates.expo = rollRates.expo;

    if (rateType !== "betaflight" || c.rates.type !== undefined) {
      c.rates.type = rateType;
    }
    const axesDiffer =
      pitchRates.rcRate !== rollRates.rcRate ||
      pitchRates.superRate !== rollRates.superRate ||
      pitchRates.expo !== rollRates.expo ||
      yawRates.rcRate !== rollRates.rcRate ||
      yawRates.superRate !== rollRates.superRate ||
      yawRates.expo !== rollRates.expo;

    if (axesDiffer || c.rates.roll || c.rates.pitch || c.rates.yaw) {
      c.rates.roll = rollRates;
      c.rates.pitch = pitchRates;
      c.rates.yaw = yawRates;
    }

    c.cameraConfig!.fpvTiltDeg = Number(input("cameraTilt").value);
    c.battery.initialCharge = Number(input("batteryCharge").value) / 100;
    c.propulsion.airmode = input("airmode").checked;
    apply(c);
  };
  action("applyFlightSettings", applyCurrentFlightSettings);
  if (document.getElementById("applyRestartFooterBtn")) {
    action("applyRestartFooterBtn", () => {
      applyCurrentFlightSettings();
      closeSettings();
    });
  }
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
