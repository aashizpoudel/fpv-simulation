import "../styles.css";
import type {
  AxisRateConfig,
  BetaflightRatesType,
  DroneConfig,
} from "../config/drone-config";
import {
  defaultPreset,
  exportPreset,
  normalizePreset,
  PRESET_STORAGE_KEY,
} from "../config/presets";
import {
  evaluateBetaflightRateDps,
  RATES_TYPE_META,
  resolveAxisRates,
  shapeStick,
} from "../controllers/rates";
import { conjugateQuat, quaternionToEuler, rotateVector } from "../controllers/math-utils";
import type { Controls, DroneTelemetry } from "../types";
import { resolveWorldConfig } from "../config/world-config";
import { resolveCameraMode, resolveWorld } from "./url-options";
import { downloadJson } from "./download";
import { loadFlightConfig } from "./flight-settings";
import { parsePlayChoices, type PlayChoices } from "./page-navigation";
import { setupSettingsTabs } from "./settings-tabs";
import { setupConfigControls } from "./config-controls";
import { setupLoadingOverlay } from "../ui/loading-overlay";
import { setupVrButtons } from "../ui/vr-buttons";
import type { AppSession } from "./app-orchestrator";

export interface BenchControlsOptions {
  initialConfig?: DroneConfig;
  onApply?: (config: DroneConfig) => Promise<void> | void;
  onResize?: () => void;
}

const BENCH_UI_STATE_KEY = "fpv_bench_ui_state_v1";

interface BenchUiState {
  openSections: Record<string, boolean>;
  scrollTop: number;
}

function loadBenchUiState(): BenchUiState | null {
  try {
    const raw = sessionStorage.getItem(BENCH_UI_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BenchUiState;
  } catch {
    return null;
  }
}

function saveBenchUiState(state: BenchUiState): void {
  try {
    sessionStorage.setItem(BENCH_UI_STATE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

export function setupBenchControls(options: BenchControlsOptions = {}) {
  let activeConfig = normalizePreset(options.initialConfig ?? loadFlightConfig());

  const layout = document.getElementById("benchLayout");
  const sidebar = document.getElementById("benchSidebar");
  const scrollContainer = sidebar?.querySelector<HTMLElement>(".bench-sidebar-scroll") ?? null;
  const sections = Array.from(sidebar?.querySelectorAll<HTMLDetailsElement>("details.bench-section") ?? []);
  const collapseBtn = document.getElementById("benchCollapseBtn") as HTMLButtonElement | null;
  const expandBtn = document.getElementById("benchExpandBtn") as HTMLButtonElement | null;
  const statusEl = document.getElementById("benchStatus");

  const persistUiState = () => {
    const openSections: Record<string, boolean> = {};
    sections.forEach((sec, idx) => {
      const key = sec.id || `section-${idx}`;
      openSections[key] = sec.open;
    });
    saveBenchUiState({
      openSections,
      scrollTop: scrollContainer?.scrollTop ?? 0,
    });
  };

  // Collapse all setting groups by default, then restore saved state if present
  const savedUiState = loadBenchUiState();
  sections.forEach((sec, idx) => {
    const key = sec.id || `section-${idx}`;
    sec.open = savedUiState?.openSections?.[key] ?? false;
    sec.addEventListener("toggle", persistUiState);
  });

  if (scrollContainer) {
    if (savedUiState && typeof savedUiState.scrollTop === "number") {
      scrollContainer.scrollTop = savedUiState.scrollTop;
    }
    scrollContainer.addEventListener("scroll", persistUiState, { passive: true });
  }

  const setStatus = (msg: string, isError = false) => {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.dataset.state = isError ? "error" : "ok";
  };

  const setSidebarCollapsed = (collapsed: boolean) => {
    layout?.classList.toggle("bench-sidebar-collapsed", collapsed);
    if (sidebar) sidebar.hidden = collapsed;
    if (collapseBtn) collapseBtn.setAttribute("aria-expanded", String(!collapsed));
    if (expandBtn) expandBtn.hidden = !collapsed;
    options.onResize?.();
  };

  collapseBtn?.addEventListener("click", () => setSidebarCollapsed(true));
  expandBtn?.addEventListener("click", () => setSidebarCollapsed(false));

  const slider = (id: string) => document.getElementById(id) as HTMLInputElement;
  const output = (id: string) => document.getElementById(id) as HTMLOutputElement | null;
  const typeSelect = document.getElementById("benchRatesType") as HTMLSelectElement | null;

  const rateIds = {
    roll: { rc: "benchRollRcRate", rcOut: "benchRollRcRateVal", super: "benchRollSuperRate", superOut: "benchRollSuperRateVal", expo: "benchRollExpo", expoOut: "benchRollExpoVal", maxVel: "benchMaxVelRoll", path: "benchCurveRoll" },
    pitch: { rc: "benchPitchRcRate", rcOut: "benchPitchRcRateVal", super: "benchPitchSuperRate", superOut: "benchPitchSuperRateVal", expo: "benchPitchExpo", expoOut: "benchPitchExpoVal", maxVel: "benchMaxVelPitch", path: "benchCurvePitch" },
    yaw: { rc: "benchYawRcRate", rcOut: "benchYawYawRcRateVal", super: "benchYawSuperRate", superOut: "benchYawSuperRateVal", expo: "benchYawExpo", expoOut: "benchYawExpoVal", maxVel: "benchMaxVelYaw", path: "benchCurveYaw" },
  } as const;

  const pidChartIds = {
    roll: { p: "benchRollP", i: "benchRollI", d: "benchRollD", stepPath: "benchPidStepRoll", targetPath: "benchPidLiveTargetRoll", gyroPath: "benchPidLiveGyroRoll", label: "benchPidLabelRoll" },
    pitch: { p: "benchPitchP", i: "benchPitchI", d: "benchPitchD", stepPath: "benchPidStepPitch", targetPath: "benchPidLiveTargetPitch", gyroPath: "benchPidLiveGyroPitch", label: "benchPidLabelPitch" },
    yaw: { p: "benchYawP", i: "benchYawI", d: "benchYawD", stepPath: "benchPidStepYaw", targetPath: "benchPidLiveTargetYaw", gyroPath: "benchPidLiveGyroYaw", label: "benchPidLabelYaw" },
  } as const;

  const LIVE_TRACE_SAMPLES = 72;
  const liveHistory: Record<"roll" | "pitch" | "yaw", { target: number[]; gyro: number[] }> = {
    roll: { target: [], gyro: [] },
    pitch: { target: [], gyro: [] },
    yaw: { target: [], gyro: [] },
  };

  /**
   * Simulate a 250 ms 1-DOF closed-loop step response (at 1 kHz) for a single axis
   * using Betaflight's PID scaling, first-order ESC/motor lag, and airframe inertia.
   */
  const simulateAxisStepResponse = (
    axis: "roll" | "pitch" | "yaw",
    P: number,
    I: number,
    D: number,
  ): { samples: number[]; overshootPct: number } => {
    const dt = 0.001;
    const totalSteps = 250;
    const inertia = activeConfig.body.inertia[axis === "roll" ? "x" : axis === "pitch" ? "y" : "z"] || 0.000022;
    const arm = Math.hypot(activeConfig.rotors[0].position.x, activeConfig.rotors[0].position.y) || 0.0269;
    const maxThrust = Number(slider("benchMaxThrust")?.value || activeConfig.rotors[0].maxThrust || 0.196);
    const maxTorque =
      axis === "yaw"
        ? 4 * maxThrust * (activeConfig.yawTorquePerNewton || 0.003)
        : 2 * arm * maxThrust;
    const maxAlpha = maxTorque / inertia;

    // Betaflight PID scaling constants (src/main/flight/pid.h)
    const kP = (P * 0.032029) / 500;
    const kI = (I * 0.244381) / 500;
    const kD = (D * 0.000529) / 500;

    let rate = 0;
    let prevRate = 0;
    let dFiltered = 0;
    let iterm = 0;
    let motorActuation = 0;
    let peak = 0;
    const samples: number[] = [];

    for (let step = 0; step <= totalSteps; step++) {
      const error = 1.0 - rate;
      iterm = Math.max(-0.5, Math.min(0.5, iterm + kI * error * dt));
      const rawD = -((rate - prevRate) / dt);
      dFiltered += 0.25 * (rawD - dFiltered);
      prevRate = rate;

      const pidSum = Math.max(-1, Math.min(1, kP * error + iterm + kD * dFiltered));
      // Motor/ESC lag (~18 ms effective time constant)
      motorActuation += (pidSum - motorActuation) * (1 - Math.exp(-dt / 0.018));
      const alpha = motorActuation * (maxAlpha / 320);
      rate += (alpha - 2.5 * rate) * dt;
      if (rate > peak) peak = rate;
      if (step % 5 === 0) samples.push(rate);
    }

    const overshootPct = Math.max(0, Math.round((peak - 1) * 100));
    return { samples, overshootPct };
  };

  const updatePidStepCurves = () => {
    const x0 = 28;
    const x1 = 252;
    const yZero = 41;
    const yStepUnit = 19; // y = 22 is +1.0 normalized step target

    for (const axis of ["roll", "pitch", "yaw"] as const) {
      const ids = pidChartIds[axis];
      const pathEl = document.getElementById(ids.stepPath);
      if (!pathEl) continue;
      const P = Number(slider(ids.p)?.value ?? 45);
      const I = Number(slider(ids.i)?.value ?? 80);
      const D = Number(slider(ids.d)?.value ?? 30);
      const { samples, overshootPct } = simulateAxisStepResponse(axis, P, I, D);
      const pts: string[] = [];
      for (let i = 0; i < samples.length; i++) {
        const px = x0 + (i / (samples.length - 1)) * (x1 - x0);
        const clamped = Math.max(-1.6, Math.min(1.6, samples[i]));
        const py = yZero - clamped * yStepUnit;
        pts.push(`${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`);
      }
      pathEl.setAttribute("d", pts.join(" "));

      // Show step metrics until live telemetry starts streaming
      if (liveHistory[axis].gyro.length === 0) {
        const labelEl = document.getElementById(ids.label);
        if (labelEl) {
          const title = axis[0].toUpperCase() + axis.slice(1);
          labelEl.textContent = `${title} Step (P:${P} I:${I} D:${D} · OS ${overshootPct}%)`;
        }
      }
    }
  };

  const pushTelemetryFrame = (
    telemetry: DroneTelemetry,
    controls: Controls,
    flightMode: "acro" | "angle",
  ) => {
    const rateType = ((typeSelect?.value as BetaflightRatesType) || activeConfig.rates.type || "betaflight");
    const sensedGyro =
      telemetry.imuGyro ??
      rotateVector(conjugateQuat(telemetry.localOrientation), telemetry.localAngularVelocity);
    const euler = quaternionToEuler(telemetry.localOrientation);
    const radToDeg = 180 / Math.PI;

    const gyroDps = {
      roll: sensedGyro.x * radToDeg,
      pitch: sensedGyro.y * radToDeg,
      yaw: sensedGyro.z * radToDeg,
    };

    const rollRates = readAxisRates("roll");
    const pitchRates = readAxisRates("pitch");
    const yawRates = readAxisRates("yaw");

    const maxTiltRoll = activeConfig.pidAngleConfig?.maxAngle.roll ?? 55;
    const maxTiltPitch = activeConfig.pidAngleConfig?.maxAngle.pitch ?? 55;
    const angleGain = activeConfig.pidAngleConfig?.roll.kP ?? 4.0;

    const targetDps = {
      roll:
        flightMode === "angle"
          ? (shapeStick(controls.roll, rollRates.expo) * maxTiltRoll - euler.roll * radToDeg) * angleGain
          : evaluateBetaflightRateDps(controls.roll, rollRates, rateType),
      pitch:
        flightMode === "angle"
          ? (shapeStick(controls.pitch, pitchRates.expo) * maxTiltPitch - euler.pitch * radToDeg) * angleGain
          : evaluateBetaflightRateDps(controls.pitch, pitchRates, rateType),
      yaw: evaluateBetaflightRateDps(controls.yaw, yawRates, rateType),
    };

    const x0 = 28;
    const x1 = 252;
    const yZero = 41;
    const halfSpan = 30;

    for (const axis of ["roll", "pitch", "yaw"] as const) {
      const hist = liveHistory[axis];
      hist.target.push(targetDps[axis]);
      hist.gyro.push(gyroDps[axis]);
      if (hist.target.length > LIVE_TRACE_SAMPLES) hist.target.shift();
      if (hist.gyro.length > LIVE_TRACE_SAMPLES) hist.gyro.shift();

      const ids = pidChartIds[axis];
      const targetEl = document.getElementById(ids.targetPath);
      const gyroEl = document.getElementById(ids.gyroPath);
      const labelEl = document.getElementById(ids.label);

      let maxScale = 200;
      for (let i = 0; i < hist.gyro.length; i++) {
        maxScale = Math.max(maxScale, Math.abs(hist.gyro[i]), Math.abs(hist.target[i]));
      }

      const buildTracePath = (arr: number[]) => {
        if (arr.length < 2) return "";
        const pts: string[] = [];
        for (let i = 0; i < arr.length; i++) {
          const px = x0 + (i / (LIVE_TRACE_SAMPLES - 1)) * (x1 - x0);
          const py = yZero - Math.max(-1, Math.min(1, arr[i] / maxScale)) * halfSpan;
          pts.push(`${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`);
        }
        return pts.join(" ");
      };

      targetEl?.setAttribute("d", buildTracePath(hist.target));
      gyroEl?.setAttribute("d", buildTracePath(hist.gyro));
      if (labelEl) {
        labelEl.textContent = `Target ${Math.round(targetDps[axis])} °/s · Gyro ${Math.round(gyroDps[axis])} °/s`;
      }
    }
  };

  const formatRateValue = (val: number, step: number) =>
    step < 1 ? val.toFixed(2) : String(Math.round(val));

  const syncRateSlidersForType = (rateType: BetaflightRatesType) => {
    const meta = RATES_TYPE_META[rateType] ?? RATES_TYPE_META.betaflight;
    document.querySelectorAll<HTMLElement>('[data-rate-label="rc"]').forEach((el) => {
      el.textContent = meta.rcRateLabel;
    });
    document.querySelectorAll<HTMLElement>('[data-rate-label="super"]').forEach((el) => {
      el.textContent = meta.superRateLabel;
    });
    document.querySelectorAll<HTMLElement>('[data-rate-label="expo"]').forEach((el) => {
      el.textContent = meta.expoLabel;
    });

    for (const axis of ["roll", "pitch", "yaw"] as const) {
      const ids = rateIds[axis];
      const rcEl = slider(ids.rc);
      const superEl = slider(ids.super);
      const expoEl = slider(ids.expo);
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

  const readAxisRates = (axis: "roll" | "pitch" | "yaw"): AxisRateConfig => {
    const ids = rateIds[axis];
    return {
      rcRate: Number(slider(ids.rc)?.value ?? 1),
      superRate: Number(slider(ids.super)?.value ?? 0.7),
      expo: Number(slider(ids.expo)?.value ?? 0),
    };
  };

  const updateOutputsAndCurve = () => {
    const rateType = ((typeSelect?.value as BetaflightRatesType) || activeConfig.rates.type || "betaflight");
    const meta = RATES_TYPE_META[rateType] ?? RATES_TYPE_META.betaflight;

    // PID outputs
    for (const [id, outId] of [
      ["benchRollP", "benchRollPVal"],
      ["benchRollI", "benchRollIVal"],
      ["benchRollD", "benchRollDVal"],
      ["benchPitchP", "benchPitchPVal"],
      ["benchPitchI", "benchPitchIVal"],
      ["benchPitchD", "benchPitchDVal"],
      ["benchYawP", "benchYawPVal"],
      ["benchYawI", "benchYawIVal"],
      ["benchYawD", "benchYawDVal"],
    ] as const) {
      const el = slider(id);
      const out = output(outId);
      if (el && out) out.textContent = el.value;
    }

    // Rate outputs & curve
    const peaks: Record<"roll" | "pitch" | "yaw", number> = { roll: 0, pitch: 0, yaw: 0 };
    const curves: Record<"roll" | "pitch" | "yaw", AxisRateConfig> = {
      roll: readAxisRates("roll"),
      pitch: readAxisRates("pitch"),
      yaw: readAxisRates("yaw"),
    };

    for (const axis of ["roll", "pitch", "yaw"] as const) {
      const ids = rateIds[axis];
      const r = curves[axis];
      const rcOut = output(ids.rcOut);
      const superOut = output(ids.superOut);
      const expoOut = output(ids.expoOut);
      if (rcOut) rcOut.textContent = formatRateValue(r.rcRate, meta.rcRate.step);
      if (superOut) superOut.textContent = formatRateValue(r.superRate, meta.superRate.step);
      if (expoOut) expoOut.textContent = formatRateValue(r.expo, meta.expo.step);

      const maxDps = Math.round(Math.abs(evaluateBetaflightRateDps(1, r, rateType)));
      peaks[axis] = maxDps;
      const maxVelOut = output(ids.maxVel);
      if (maxVelOut) maxVelOut.textContent = `${maxDps} °/s`;
    }

    const overallMax = Math.max(100, peaks.roll, peaks.pitch, peaks.yaw);
    const maxLabel = document.getElementById("benchCurveMaxLabel");
    if (maxLabel) maxLabel.textContent = `${overallMax} °/s`;

    const x0 = 28;
    const x1 = 252;
    const y0 = 96;
    const y1 = 12;
    const steps = 32;
    for (const axis of ["roll", "pitch", "yaw"] as const) {
      const pathEl = document.getElementById(rateIds[axis].path);
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

    // Physical & IMU outputs
    const massEl = slider("benchMassG");
    const thrustEl = slider("benchMaxThrust");
    const tiltEl = slider("benchCameraTilt");
    const capEl = slider("benchBatteryCapacity");
    const irEl = slider("benchBatteryResistance");
    const dragEl = slider("benchLinearDrag");
    const gNoiseEl = slider("benchGyroNoise");
    const gVibEl = slider("benchGyroVibration");
    const aNoiseEl = slider("benchAccNoise");
    const calDurEl = slider("benchCalDuration");

    if (massEl && output("benchMassGVal")) output("benchMassGVal")!.textContent = `${massEl.value} g`;
    if (thrustEl && output("benchMaxThrustVal")) output("benchMaxThrustVal")!.textContent = `${Number(thrustEl.value).toFixed(2)} N`;
    if (tiltEl && output("benchCameraTiltVal")) output("benchCameraTiltVal")!.textContent = `${tiltEl.value}°`;
    if (capEl && output("benchBatteryCapacityVal")) output("benchBatteryCapacityVal")!.textContent = `${capEl.value} mAh`;
    if (irEl && output("benchBatteryResistanceVal")) output("benchBatteryResistanceVal")!.textContent = `${Number(irEl.value).toFixed(2)} Ω`;
    if (dragEl && output("benchLinearDragVal")) output("benchLinearDragVal")!.textContent = Number(dragEl.value).toFixed(3);
    if (gNoiseEl && output("benchGyroNoiseVal")) output("benchGyroNoiseVal")!.textContent = Number(gNoiseEl.value).toFixed(5);
    if (gVibEl && output("benchGyroVibrationVal")) output("benchGyroVibrationVal")!.textContent = Number(gVibEl.value).toFixed(3);
    if (aNoiseEl && output("benchAccNoiseVal")) output("benchAccNoiseVal")!.textContent = Number(aNoiseEl.value).toFixed(3);
    if (calDurEl && output("benchCalDurationVal")) output("benchCalDurationVal")!.textContent = `${Number(calDurEl.value).toFixed(2)} s`;

    updatePidStepCurves();
  };

  const populateFromConfig = (c: DroneConfig) => {
    const rateType = c.rates.type ?? "betaflight";
    if (typeSelect) typeSelect.value = rateType;
    syncRateSlidersForType(rateType);

    slider("benchRollP").value = String(c.betaflightPids.roll.p);
    slider("benchRollI").value = String(c.betaflightPids.roll.i);
    slider("benchRollD").value = String(c.betaflightPids.roll.d);
    slider("benchPitchP").value = String(c.betaflightPids.pitch.p);
    slider("benchPitchI").value = String(c.betaflightPids.pitch.i);
    slider("benchPitchD").value = String(c.betaflightPids.pitch.d);
    slider("benchYawP").value = String(c.betaflightPids.yaw.p);
    slider("benchYawI").value = String(c.betaflightPids.yaw.i);
    slider("benchYawD").value = String(c.betaflightPids.yaw.d);

    for (const axis of ["roll", "pitch", "yaw"] as const) {
      const r = resolveAxisRates(c.rates, axis);
      const ids = rateIds[axis];
      slider(ids.rc).value = String(r.rcRate);
      slider(ids.super).value = String(r.superRate);
      slider(ids.expo).value = String(r.expo);
    }

    slider("benchMassG").value = String(Math.round(c.mass * 1000));
    slider("benchMaxThrust").value = String(c.rotors[0].maxThrust);
    slider("benchCameraTilt").value = String(c.cameraConfig?.fpvTiltDeg ?? 20);
    slider("benchBatteryCapacity").value = String(Math.round(c.battery.capacityAh * 1000));
    slider("benchBatteryResistance").value = String(c.battery.resistance);
    slider("benchLinearDrag").value = String(c.aerodynamics.linear.x);

    slider("benchGyroNoise").value = String(c.imu.gyroNoiseDensity);
    slider("benchGyroVibration").value = String(c.imu.gyroVibration);
    slider("benchAccNoise").value = String(c.imu.accNoiseDensity);
    slider("benchCalDuration").value = String(c.imu.calibrationDuration);

    updateOutputsAndCurve();
  };

  const buildConfigFromInputs = (): DroneConfig => {
    const next = structuredClone(activeConfig);

    next.betaflightPids = {
      roll: {
        p: Math.round(Number(slider("benchRollP").value)),
        i: Math.round(Number(slider("benchRollI").value)),
        d: Math.round(Number(slider("benchRollD").value)),
      },
      pitch: {
        p: Math.round(Number(slider("benchPitchP").value)),
        i: Math.round(Number(slider("benchPitchI").value)),
        d: Math.round(Number(slider("benchPitchD").value)),
      },
      yaw: {
        p: Math.round(Number(slider("benchYawP").value)),
        i: Math.round(Number(slider("benchYawI").value)),
        d: Math.round(Number(slider("benchYawD").value)),
      },
    };

    const rateType = ((typeSelect?.value as BetaflightRatesType) || "betaflight");
    const rollRates = readAxisRates("roll");
    const pitchRates = readAxisRates("pitch");
    const yawRates = readAxisRates("yaw");

    next.rates = {
      type: rateType,
      rcRate: rollRates.rcRate,
      superRate: rollRates.superRate,
      expo: rollRates.expo,
      roll: rollRates,
      pitch: pitchRates,
      yaw: yawRates,
    };

    const massKg = Number(slider("benchMassG").value) / 1000;
    const thrustPerRotor = Number(slider("benchMaxThrust").value);
    next.mass = massKg;
    for (const rotor of next.rotors) {
      rotor.maxThrust = thrustPerRotor;
    }

    if (next.cameraConfig) {
      next.cameraConfig.fpvTiltDeg = Number(slider("benchCameraTilt").value);
    }
    next.battery.capacityAh = Number(slider("benchBatteryCapacity").value) / 1000;
    next.battery.resistance = Number(slider("benchBatteryResistance").value);

    const dragXY = Number(slider("benchLinearDrag").value);
    next.aerodynamics.linear = { x: dragXY, y: dragXY, z: Math.min(0.1, dragXY * 1.5) };

    next.imu.gyroNoiseDensity = Number(slider("benchGyroNoise").value);
    next.imu.gyroVibration = Number(slider("benchGyroVibration").value);
    next.imu.accNoiseDensity = Number(slider("benchAccNoise").value);
    next.imu.calibrationDuration = Number(slider("benchCalDuration").value);

    return normalizePreset(next);
  };

  const applyBenchConfig = async () => {
    try {
      const updated = buildConfigFromInputs();
      activeConfig = updated;
      localStorage.setItem(PRESET_STORAGE_KEY, exportPreset(updated));
      persistUiState();
      setStatus(
        `Applied tuning & resetting sim • Hover ${(updated.hoverThrottle * 100).toFixed(0)}% • Mass ${Math.round(updated.mass * 1000)}g`,
      );
      if (options.onApply) {
        await options.onApply(updated);
      } else {
        location.reload();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  };

  populateFromConfig(activeConfig);

  typeSelect?.addEventListener("change", () => {
    const nextType = ((typeSelect.value as BetaflightRatesType) || "betaflight");
    const meta = RATES_TYPE_META[nextType] ?? RATES_TYPE_META.betaflight;
    syncRateSlidersForType(nextType);
    for (const axis of ["roll", "pitch", "yaw"] as const) {
      const ids = rateIds[axis];
      slider(ids.rc).value = String(meta.rcRate.defaultVal);
      slider(ids.super).value = String(meta.superRate.defaultVal);
      slider(ids.expo).value = String(meta.expo.defaultVal);
    }
    updateOutputsAndCurve();
    setStatus("Pending changes — click Apply to Drone to reload.");
  });

  sidebar?.querySelectorAll<HTMLInputElement>('input[type="range"], input[type="number"]').forEach((inputEl) => {
    inputEl.addEventListener("input", () => {
      updateOutputsAndCurve();
      setStatus("Pending changes — click Apply to Drone to reload.");
    });
    inputEl.addEventListener("change", () => {
      updateOutputsAndCurve();
    });
  });

  document.getElementById("benchApplyBtn")?.addEventListener("click", () => {
    void applyBenchConfig();
  });

  document.getElementById("benchResetDefaultsBtn")?.addEventListener("click", () => {
    const def = defaultPreset();
    activeConfig = def;
    populateFromConfig(def);
    setStatus("Defaults restored in form — click Apply to Drone to reload.");
  });

  document.getElementById("benchExportBtn")?.addEventListener("click", () => {
    try {
      const updated = buildConfigFromInputs();
      downloadJson("whoop-bench-preset.json", exportPreset(updated));
      setStatus("Exported bench preset JSON.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  return {
    getActiveConfig: () => activeConfig,
    applyBenchConfig,
    setSidebarCollapsed,
    pushTelemetryFrame,
  };
}

function setupCompactSettingsModal(): void {
  setupSettingsTabs();
  const flightHelp = document.querySelector<HTMLDetailsElement>(".flight-help");
  const settingsToggleBtn = document.getElementById("settingsToggleBtn");
  const closeSettingsBtn = document.getElementById("closeSettingsBtn");

  if (flightHelp) flightHelp.open = false;
  settingsToggleBtn?.addEventListener("click", () => {
    if (flightHelp) flightHelp.open = !flightHelp.open;
  });
  closeSettingsBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    if (flightHelp) flightHelp.open = false;
  });
}

export function startBenchFlight(appReady: Promise<AppSession>, choices: PlayChoices): void {
  void appReady
    .then(async (session) => {
      if (choices.control === "motion") return;
      if (choices.control === "gamepad") {
        const activated = await session.play("gamepad", choices.mode);
        if (activated) return;
      }
      await session.play("keyboard", choices.mode);
    })
    .catch((error) => {
      const status = document.getElementById("lodStatus");
      if (status) {
        status.textContent = `Unable to start: ${error instanceof Error ? error.message : String(error)}`;
        status.dataset.state = "error";
      }
    });
}

if (typeof window !== "undefined" && document.getElementById("benchSidebar") && document.getElementById("renderingContainer")) {
  // Auto-initialize when loaded as the entry script of bench.html
  const worldConfig = resolveWorldConfig(resolveWorld("island"));
  setupCompactSettingsModal();
  setupConfigControls("threejs", "island");

  const initialConfig = loadFlightConfig();
  let currentSession: AppSession | undefined;

  const bench = setupBenchControls({
    initialConfig,
    onResize: () => {
      currentSession?.resizeViewport?.();
    },
  });

  const choices = parsePlayChoices(window.location.search);
  const initialCameraMode = resolveCameraMode(false);
  const appReady: Promise<AppSession> = import("./app-orchestrator").then(async ({ startApp }) => {
    const session = await startApp({
      droneConfig: bench.getActiveConfig(),
      rendererType: "threejs",
      simulationStart: worldConfig.spawnPosition,
      rendererStart: worldConfig.spawnPosition,
      initialCameraMode,
      worldConfig,
      onTelemetryFrame: (telemetry, controls, flightMode) => {
        bench.pushTelemetryFrame(telemetry, controls, flightMode);
      },
    });
    currentSession = session;
    return session;
  });

  const loadingOverlay = setupLoadingOverlay(appReady);
  loadingOverlay.show();
  startBenchFlight(appReady, choices);
  setupVrButtons("threejs", appReady, () => choices);
}
