import { describe, expect, it } from "vitest";
import { nextBumpOpacity } from "../src/ui/hud";

describe("bump border", () => {
  it("lights on a new impact and fades without another hit", () => {
    const lit = nextBumpOpacity(0, 1.2, 0, 0.016);
    expect(lit).toBeGreaterThan(0.9);
    const faded = nextBumpOpacity(lit, 0, 1.2, 0.45);
    expect(faded).toBe(0);
  });

  it("stays dark for resting contact and does not retrigger while the impact holds", () => {
    expect(nextBumpOpacity(0, 0.1, 0, 0.016)).toBe(0);
    const held = nextBumpOpacity(0.2, 1.2, 1.2, 0.016);
    expect(held).toBeLessThan(0.2);
  });
});
