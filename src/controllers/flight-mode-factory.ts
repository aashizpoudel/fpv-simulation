import { AcroMode } from "./modes/acro-mode";
import { AngleMode } from "./modes/angle-mode";
import type { IFlightMode } from "./modes/flight-mode-interface";
import type { DroneConfig } from "../config/tinyhawk-config";

/** Build a flight mode from the controller type string, or null if unsupported */
export function buildFlightMode(
  config: DroneConfig,
  type: string,
): IFlightMode | null {
  const pidRateConfig = config.pidRateConfig;
  if (!pidRateConfig) return null;

  if (type === "acro") {
    return new AcroMode(pidRateConfig, config.rates.expo);
  }
  if (type === "angle") {
    const pidAngleConfig = config.pidAngleConfig;
    if (!pidAngleConfig) return null;
    return new AngleMode(pidAngleConfig, pidRateConfig, config.rates.expo);
  }
  return null;
}
