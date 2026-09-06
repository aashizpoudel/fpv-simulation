import { describe, expect, it } from "vitest";
import { renderQuality } from "../src/renderers/three/render-quality";

describe("render quality", () => {
  it("renders source splats and supersamples Detail on a 1x monitor", () => {
    expect(renderQuality("detail", 1)).toMatchObject({
      enableLod: false, pixelRatio: 1.5, minSortIntervalMs: 0, sortRadial: false,
    });
  });
  it("preserves Retina detail with a bounded pixel cost", () => {
    expect(renderQuality("detail", 2).pixelRatio).toBe(2);
    expect(renderQuality("detail", 3).pixelRatio).toBe(2);
  });
  it("restores the lower-cost LOD settings when leaving Detail", () => {
    expect(renderQuality("performance", 2)).toMatchObject({
      enableLod: true, pixelRatio: 0.75, splats: 300_000, minSortIntervalMs: 40,
    });
    expect(renderQuality("balanced", 2)).toMatchObject({
      enableLod: true, pixelRatio: 1, splats: 650_000,
    });
    expect(renderQuality("unknown", 1)).toEqual(renderQuality("balanced", 1));
  });
});
