import { describe, expect, it } from "vitest";
import { groundEffectFactor } from "../src/physics/ground-effect";

describe("ground effect", () => {
  const radius = 0.02;

  it("stays at 1 beyond one rotor diameter", () => {
    expect(groundEffectFactor(radius * 2, radius)).toBe(1);
    expect(groundEffectFactor(1, radius)).toBe(1);
    expect(groundEffectFactor(0.03, 0)).toBe(1);
  });

  it("follows Cheeseman–Bennett inside one diameter and clamps the closest height", () => {
    const atRadius = 1 / (1 - (1 / 4) ** 2);
    expect(groundEffectFactor(radius, radius)).toBeCloseTo(atRadius, 8);
    const clamped = 1 / (1 - 0.5 ** 2);
    expect(groundEffectFactor(radius / 2, radius)).toBeCloseTo(clamped, 8);
    expect(groundEffectFactor(0, radius)).toBeCloseTo(clamped, 8);
  });
});
