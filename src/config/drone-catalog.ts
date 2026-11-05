import { Manta5DeadCatConfig } from "./manta5-config";
import { Tinyhawk3Config } from "./tinyhawk-config";

export const DRONES = [
  {
    id: "tinyhawk-iii-plus",
    name: "EMAX Tinyhawk III Plus",
    config: Tinyhawk3Config,
  },
  {
    id: "axisflying-manta5-dc",
    name: "Axisflying Manta5 DeadCat (O4 Lite)",
    config: Manta5DeadCatConfig,
  },
] as const;

export type DroneId = (typeof DRONES)[number]["id"];
export const DEFAULT_DRONE = DRONES[0];

export function resolveDrone(id: string | null) {
  return DRONES.find((drone) => drone.id === id) ?? DEFAULT_DRONE;
}
