import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { o3HalfAngles } from "../src/xr/goggles-config";
import {
  createFisheyeMaterial,
  fisheyeSourcePoint,
  setFisheyeUniforms,
  sourceCameraFor,
  sourceResolution,
} from "../src/xr/fisheye-lens";

const aspects = ["4:3", "16:9"] as const;

describe("fisheye lens", () => {
  it("maps center to center", () => {
    for (const a of aspects) {
      const half = o3HalfAngles(a);
      const p = fisheyeSourcePoint({ x: 0.5, y: 0.5 }, half, sourceCameraFor(half));
      expect(p.x).toBeCloseTo(0.5, 9);
      expect(p.y).toBeCloseTo(0.5, 9);
    }
  });

  it("keeps corners inside the source and touches the border", () => {
    for (const a of aspects) {
      const half = o3HalfAngles(a);
      const src = sourceCameraFor(half);
      const pts = [0, 1].flatMap((x) => [0, 1].map((y) => fisheyeSourcePoint({ x, y }, half, src)));
      for (const p of pts) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-9);
        expect(p.x).toBeLessThanOrEqual(1 + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(-1e-9);
        expect(p.y).toBeLessThanOrEqual(1 + 1e-9);
      }
      expect(Math.max(...pts.map((p) => Math.max(p.x, p.y)))).toBeCloseTo(1, 9);
      expect(Math.min(...pts.map((p) => Math.min(p.x, p.y)))).toBeCloseTo(0, 9);
      // Whole edges stay inside too.
      for (let i = 0; i <= 50; i++) {
        const t = i / 50;
        for (const e of [{ x: t, y: 0 }, { x: t, y: 1 }, { x: 0, y: t }, { x: 1, y: t }]) {
          const p = fisheyeSourcePoint(e, half, src);
          expect(p.x).toBeGreaterThanOrEqual(-1e-9);
          expect(p.x).toBeLessThanOrEqual(1 + 1e-9);
          expect(p.y).toBeGreaterThanOrEqual(-1e-9);
          expect(p.y).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    }
  });

  it("is monotonic along the horizontal axis", () => {
    const half = o3HalfAngles("4:3");
    const src = sourceCameraFor(half);
    let prev = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const x = fisheyeSourcePoint({ x: i / 100, y: 0.5 }, half, src).x;
      expect(x).toBeGreaterThan(prev);
      prev = x;
    }
  });

  it("derives fov and aspect from the tangents", () => {
    const src = sourceCameraFor(o3HalfAngles("4:3"));
    expect(src.fovYDeg).toBeCloseTo((2 * Math.atan(src.tanHalfV) * 180) / Math.PI, 9);
    expect(src.aspect).toBeCloseTo(src.tanHalfH / src.tanHalfV, 9);
  });

  it("sizes the source and clamps to maxSide keeping aspect", () => {
    const half = o3HalfAngles("4:3");
    const src = sourceCameraFor(half);
    const r = sourceResolution(800, half, src);
    expect(r.width).toBe(Math.round((800 * src.tanHalfH) / half.h));
    expect(r.width / r.height).toBeCloseTo(src.aspect, 2);
    const big = sourceResolution(1440, half, src, 10, 4096);
    expect(Math.max(big.width, big.height)).toBe(4096);
    expect(big.width / big.height).toBeCloseTo(src.aspect, 2);
    const tiny = sourceResolution(1, half, src, 0.0001);
    expect(tiny.width).toBeGreaterThanOrEqual(1);
    expect(tiny.height).toBeGreaterThanOrEqual(1);
  });

  it("throws when the corner angle is 89 degrees or more", () => {
    const t = (90 * Math.PI) / 180 / Math.SQRT2;
    expect(() => sourceCameraFor({ h: t, v: t })).toThrow(/too wide/);
  });

  it("creates a material with the expected uniforms", () => {
    const m = createFisheyeMaterial();
    expect(m).toBeInstanceOf(THREE.ShaderMaterial);
    for (const k of ["source", "halfAngle", "tanHalf", "vignette"]) expect(m.uniforms[k]).toBeDefined();
    expect(m.uniforms.vignette.value).toBeCloseTo(0.35);
    expect(m.depthTest).toBe(false);
    const half = o3HalfAngles("16:9");
    const src = sourceCameraFor(half);
    setFisheyeUniforms(m, half, src, null);
    expect(m.uniforms.halfAngle.value.x).toBeCloseTo(half.h);
    expect(m.uniforms.tanHalf.value.y).toBeCloseTo(src.tanHalfV);
  });
});
