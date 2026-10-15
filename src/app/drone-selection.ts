import { DRONES, resolveDrone } from "../config/drone-catalog";
import { STORAGE_KEYS } from "./storage-keys";

export function loadSelectedDrone() {
  try {
    return resolveDrone(localStorage.getItem(STORAGE_KEYS.drone));
  } catch {
    return resolveDrone(null);
  }
}

export function setupDroneSelection(): void {
  const selects = ["welcomeDroneSelect", "droneSelect"]
    .map((id) => document.getElementById(id) as HTMLSelectElement | null)
    .filter((select): select is HTMLSelectElement => select !== null);
  const selected = loadSelectedDrone();

  for (const select of selects) {
    select.replaceChildren(...DRONES.map((drone) => new Option(drone.name, drone.id)));
    select.value = selected.id;
    select.addEventListener("change", () => {
      const drone = resolveDrone(select.value);
      for (const other of selects) other.value = drone.id;
      try {
        localStorage.setItem(STORAGE_KEYS.drone, drone.id);
      } catch { /* Selection still works when storage is unavailable. */ }
    });
  }
}
