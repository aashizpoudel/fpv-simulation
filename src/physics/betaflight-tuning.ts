import type { DroneConfig } from "../config/drone-config";
import type { DroneSimModule } from "../vendor/dronesim";

/** Apply the active Betaflight rate profile and rate PID gains after EEPROM load. */
export function applyBetaflightTuning(wasm: DroneSimModule, handle: number, config: DroneConfig): void {
  const tuningPtr = wasm._malloc(10);
  if (!tuningPtr) throw new Error("DroneSim tuning buffer allocation failed");
  try {
    const { rcRate, expo, superRate } = config.rates;
    const nativeRcRate = Math.round(rcRate * 100);
    const nativeExpo = Math.round(expo * 100);
    const nativeSuperRate = Math.round(superRate * 100);
    wasm.HEAPU8.set([
      0, // Betaflight rate type
      nativeRcRate, nativeRcRate, nativeRcRate,
      nativeExpo, nativeExpo, nativeExpo,
      nativeSuperRate, nativeSuperRate, nativeSuperRate,
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
