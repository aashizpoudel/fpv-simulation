import { clamp } from "./math-utils";
import type {
  AxisRateConfig,
  BetaflightRatesConfig,
  BetaflightRatesType,
} from "../config/drone-config";

export const RATES_TYPE_IDS: Record<BetaflightRatesType, number> = {
  betaflight: 0,
  raceflight: 1,
  kiss: 2,
  actual: 3,
  quick: 4,
};

export interface RatesTypeUiMeta {
  label: string;
  rcRateLabel: string;
  superRateLabel: string;
  expoLabel: string;
  rcRate: { min: number; max: number; step: number; scale: number; defaultVal: number };
  superRate: { min: number; max: number; step: number; scale: number; defaultVal: number };
  expo: { min: number; max: number; step: number; scale: number; defaultVal: number };
}

export const RATES_TYPE_META: Record<BetaflightRatesType, RatesTypeUiMeta> = {
  betaflight: {
    label: "Betaflight",
    rcRateLabel: "RC Rate",
    superRateLabel: "Super Rate",
    expoLabel: "RC Expo",
    rcRate: { min: 0.01, max: 2.55, step: 0.01, scale: 100, defaultVal: 1.0 },
    superRate: { min: 0.0, max: 0.99, step: 0.01, scale: 100, defaultVal: 0.7 },
    expo: { min: 0.0, max: 1.0, step: 0.01, scale: 100, defaultVal: 0.0 },
  },
  raceflight: {
    label: "RaceFlight",
    rcRateLabel: "RC Rate (°/s)",
    superRateLabel: "Acro+",
    expoLabel: "Expo",
    rcRate: { min: 10, max: 2000, step: 10, scale: 0.1, defaultVal: 370 },
    superRate: { min: 0, max: 255, step: 1, scale: 1, defaultVal: 80 },
    expo: { min: 0, max: 100, step: 1, scale: 1, defaultVal: 0 },
  },
  kiss: {
    label: "KISS",
    rcRateLabel: "RC Rate",
    superRateLabel: "Rate",
    expoLabel: "RC Curve",
    rcRate: { min: 0.01, max: 2.55, step: 0.01, scale: 100, defaultVal: 1.0 },
    superRate: { min: 0.0, max: 0.99, step: 0.01, scale: 100, defaultVal: 0.7 },
    expo: { min: 0.0, max: 1.0, step: 0.01, scale: 100, defaultVal: 0.0 },
  },
  actual: {
    label: "Actual",
    rcRateLabel: "Center Sensitivity (°/s)",
    superRateLabel: "Max Rate (°/s)",
    expoLabel: "Expo",
    rcRate: { min: 10, max: 2000, step: 10, scale: 0.1, defaultVal: 200 },
    superRate: { min: 10, max: 2000, step: 10, scale: 0.1, defaultVal: 670 },
    expo: { min: 0.0, max: 1.0, step: 0.01, scale: 100, defaultVal: 0.0 },
  },
  quick: {
    label: "Quick",
    rcRateLabel: "RC Rate",
    superRateLabel: "Max Rate (°/s)",
    expoLabel: "RC Expo",
    rcRate: { min: 0.01, max: 2.55, step: 0.01, scale: 100, defaultVal: 1.0 },
    superRate: { min: 10, max: 2000, step: 10, scale: 0.1, defaultVal: 670 },
    expo: { min: 0.0, max: 1.0, step: 0.01, scale: 100, defaultVal: 0.0 },
  },
};

export function resolveAxisRates(
  rates: BetaflightRatesConfig,
  axis: "roll" | "pitch" | "yaw",
): AxisRateConfig {
  const specific = rates[axis];
  if (specific) {
    return {
      rcRate: specific.rcRate,
      superRate: specific.superRate,
      expo: specific.expo,
    };
  }
  return {
    rcRate: rates.rcRate,
    superRate: rates.superRate,
    expo: rates.expo,
  };
}

/** Convert UI/config AxisRateConfig values into Betaflight's native uint8 bytes. */
export function toNativeRateBytes(
  type: BetaflightRatesType,
  axis: AxisRateConfig,
): { rcRate: number; superRate: number; expo: number } {
  const meta = RATES_TYPE_META[type];
  return {
    rcRate: Math.round(clamp(axis.rcRate, meta.rcRate.min, meta.rcRate.max) * meta.rcRate.scale),
    superRate: Math.round(clamp(axis.superRate, meta.superRate.min, meta.superRate.max) * meta.superRate.scale),
    expo: Math.round(clamp(axis.expo, meta.expo.min, meta.expo.max) * meta.expo.scale),
  };
}

const SETPOINT_RATE_LIMIT = 1998;

/**
 * Evaluate any of Betaflight's 5 rate curves in degrees per second, matching
 * `src/main/fc/rc.c` (`applyBetaflightRates`, `applyRaceFlightRates`,
 * `applyKissRates`, `applyActualRates`, `applyQuickRates`).
 */
export function evaluateBetaflightRateDps(
  stick: number,
  axis: AxisRateConfig,
  type: BetaflightRatesType = "betaflight",
  maxDegreesPerSecond = SETPOINT_RATE_LIMIT,
): number {
  const rcCommandf = clamp(stick, -1, 1);
  const rcCommandfAbs = Math.abs(rcCommandf);
  const native = toNativeRateBytes(type, axis);
  let angleRate = 0;

  switch (type) {
    case "betaflight": {
      let cmd = rcCommandf;
      if (native.expo) {
        const expof = native.expo / 100;
        cmd = cmd * rcCommandfAbs ** 3 * expof + cmd * (1 - expof);
      }
      let rcRate = native.rcRate / 100;
      if (rcRate > 2) {
        rcRate += 14.54 * (rcRate - 2);
      }
      angleRate = 200 * rcRate * cmd;
      if (native.superRate) {
        const rcSuperfactor = 1 / clamp(1 - rcCommandfAbs * (native.superRate / 100), 0.01, 1);
        angleRate *= rcSuperfactor;
      }
      break;
    }
    case "raceflight": {
      const cmd = (1 + 0.01 * native.expo * (rcCommandf * rcCommandf - 1)) * rcCommandf;
      angleRate = 10 * native.rcRate * cmd;
      angleRate *= 1 + rcCommandfAbs * native.superRate * 0.01;
      break;
    }
    case "kiss": {
      const rcCurvef = native.expo / 100;
      const kissRpyUseRates = 1 / clamp(1 - rcCommandfAbs * (native.superRate / 100), 0.01, 1);
      const kissRcCommandf = (rcCommandf ** 3 * rcCurvef + rcCommandf * (1 - rcCurvef)) * (native.rcRate / 1000);
      angleRate = clamp(2000 * kissRpyUseRates * kissRcCommandf, -SETPOINT_RATE_LIMIT, SETPOINT_RATE_LIMIT);
      break;
    }
    case "actual": {
      let expof = native.expo / 100;
      expof = rcCommandfAbs * (rcCommandf ** 5 * expof + rcCommandf * (1 - expof));
      const centerSensitivity = native.rcRate * 10;
      const stickMovement = Math.max(0, native.superRate * 10 - centerSensitivity);
      angleRate = rcCommandf * centerSensitivity + stickMovement * expof;
      break;
    }
    case "quick": {
      const rcRate = native.rcRate * 2;
      const maxDPS = Math.max(native.superRate * 10, rcRate);
      const expof = native.expo / 100;
      const superFactorConfig = maxDPS > 0 ? (maxDPS / rcRate - 1) / (maxDPS / rcRate) : 0;
      const curve = rcCommandfAbs ** 3 * expof + rcCommandfAbs * (1 - expof);
      const superFactor = 1 / clamp(1 - curve * superFactorConfig, 0.01, 1);
      angleRate = clamp(rcCommandf * rcRate * superFactor, -SETPOINT_RATE_LIMIT, SETPOINT_RATE_LIMIT);
      break;
    }
  }

  const limit = Math.min(SETPOINT_RATE_LIMIT, maxDegreesPerSecond);
  return clamp(angleRate, -limit, limit);
}

/** Betaflight's BETAFLIGHT (legacy) rate curve, in radians per second. */
export function rateTarget(
  stick: number,
  rcRate: number,
  superRate: number,
  expo: number,
  maxDegreesPerSecond = Infinity,
  type: BetaflightRatesType = "betaflight",
): number {
  if (type !== "betaflight") {
    return (
      (evaluateBetaflightRateDps(stick, { rcRate, superRate, expo }, type, maxDegreesPerSecond) *
        Math.PI) /
      180
    );
  }
  const x = clamp(stick, -1, 1);
  const shaped = shapeStick(x, expo);
  const effectiveRcRate = rcRate > 2 ? rcRate + 14.54 * (rcRate - 2) : rcRate;
  const superFactor = 1 / Math.max(0.01, 1 - Math.abs(x) * superRate);
  const degreesPerSecond = 200 * effectiveRcRate * shaped * superFactor;
  return (clamp(degreesPerSecond, -maxDegreesPerSecond, maxDegreesPerSecond) * Math.PI) / 180;
}

export function shapeStick(stick: number, expo: number): number {
  const x = clamp(stick, -1, 1);
  return (1 - expo) * x + expo * x ** 3;
}
