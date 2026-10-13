import { beforeEach, expect, it } from "vitest";
import { setupConfigControls } from "../src/app/config-controls";
import { STORAGE_KEYS } from "../src/app/storage-keys";
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<input id="racePropsCheckbox" type="checkbox" />';
});
it("enables race props by default", () => {
  setupConfigControls("threejs", "forest");
  expect((document.getElementById("racePropsCheckbox") as HTMLInputElement).checked).toBe(true);
});
it("restores the disabled preference", () => {
  localStorage.setItem(STORAGE_KEYS.raceProps, "0");
  setupConfigControls("threejs", "forest");
  expect((document.getElementById("racePropsCheckbox") as HTMLInputElement).checked).toBe(false);
});
