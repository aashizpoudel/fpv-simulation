import { describe, expect, it } from "vitest";
import { Vec3 as PcVec3 } from "playcanvas";

import {
  toPlayCanvasPosition,
  toPlayCanvasRotation,
} from "../src/renderers/playcanvas/playcanvas-renderer";

describe("PlayCanvasRenderer coordinate conversion", () => {
  it("converts simulator Z-up coordinates to PlayCanvas Y-up", () => {
    const result = toPlayCanvasPosition({ x: 1, y: 2, z: 3 });
    expect([result.x, result.y, result.z]).toEqual([1, 3, -2]);
  });

  it("preserves orientation across the coordinate-system basis change", () => {
    const halfAngle = Math.PI / 4;
    const rotation = toPlayCanvasRotation({
      x: 0,
      y: 0,
      z: Math.sin(halfAngle),
      w: Math.cos(halfAngle),
    });
    const forward = rotation.transformVector(PcVec3.RIGHT);

    expect(forward.x).toBeCloseTo(0, 5);
    expect(forward.y).toBeCloseTo(0, 5);
    expect(forward.z).toBeCloseTo(-1, 5);
  });
});
