import type { DroneConfig } from "../config/drone-config";
import type { DroneSimModule } from "../vendor/dronesim";
import {
  RATES_TYPE_IDS,
  resolveAxisRates,
  toNativeRateBytes,
} from "../controllers/rates";

/** Apply the active Betaflight rate profile and rate PID gains after EEPROM load. */
export function applyBetaflightTuning(wasm: DroneSimModule, handle: number, config: DroneConfig): void {
  const tuningPtr = wasm._malloc(10);
  if (!tuningPtr) throw new Error("DroneSim tuning buffer allocation failed");
  try {
    const rateType = config.rates.type ?? "betaflight";
    const typeId = RATES_TYPE_IDS[rateType];
    const rollRates = toNativeRateBytes(rateType, resolveAxisRates(config.rates, "roll"));
    const pitchRates = toNativeRateBytes(rateType, resolveAxisRates(config.rates, "pitch"));
    const yawRates = toNativeRateBytes(rateType, resolveAxisRates(config.rates, "yaw"));

    wasm.HEAPU8.set([
      typeId,
      rollRates.rcRate, pitchRates.rcRate, yawRates.rcRate,
      rollRates.expo, pitchRates.expo, yawRates.expo,
      rollRates.superRate, pitchRates.superRate, yawRates.superRate,
    ], tuningPtr);
    if (wasm._dronesim_set_rates(handle, tuningPtr, 10) !== 1) {
      throw new Error("Betaflight rejected drone rates");
    }

    const { roll, pitch, yaw } = config.betaflightPids;
    wasm.HEAPU8.set([
      roll.p, roll.i, roll.d,
      pitch.p, pitch.i, pitch.d,
      yaw.p, yaw.i, yaw.d,
    ], tuningPtr);
    if (wasm._dronesim_set_pid_rate_config(handle, tuningPtr, 9) !== 1) {
      throw new Error("Betaflight rejected drone PID gains");
    }
  } finally {
    wasm._free(tuningPtr);
  }
}
