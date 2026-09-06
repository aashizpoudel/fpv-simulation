// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { inspectCollisionGlb } from "../scripts/lib/collision-glb.mjs";

describe("collision GLB validation", () => {
  it("rejects the original misleading Gaussian point-cloud GLB", async () => {
    const bytes = await readFile("public/maps/ekotori/ekotori-collider.glb");
    expect(() => inspectCollisionGlb(bytes)).toThrow(/triangles/);
  });
  it("rejects a truncated GLB", () => {
    expect(() => inspectCollisionGlb(Buffer.from("glTF"))).toThrow(/header/);
  });
  it("validates Factory's existing triangle mesh", async () => {
    expect(inspectCollisionGlb(await readFile("public/maps/factory-splat/factory-collider.glb")).triangles)
      .toBeGreaterThan(0);
  });
});
