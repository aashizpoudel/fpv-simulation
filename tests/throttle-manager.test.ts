import { expect, it } from "vitest";
import { ThrottleManager } from "../src/controllers/throttle-manager";

it("holds an absolute radio throttle independently of frame duration", () => {
  const manager = new ThrottleManager(0.3);
  for (let i = 0; i < 100; i++) expect(manager.update(1, 1, 1 / 240, 0.74)).toBe(0.74);
  expect(manager.update(1, 1, 1, 0)).toBe(0);
});

it("retains incremental keyboard throttle and resets it", () => {
  const manager = new ThrottleManager(0.3);
  expect(manager.update(1, 1, 1)).toBe(0.3);
  expect(manager.update(0, 1, 1)).toBe(0.3);
  manager.reset();
  expect(manager.throttle).toBe(0);
});
