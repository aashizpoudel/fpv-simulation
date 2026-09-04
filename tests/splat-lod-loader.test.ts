import { describe, expect, it, vi } from "vitest";

import {
  SplatLodLoader,
  fetchSplatLodManifest,
  type SplatSceneViewer,
} from "../src/renderers/three/splat-lod-loader";

const levels = [
  { lod: 6, file: "./coarse.ksplat", splatCount: 10, bytes: 12 },
  { lod: 5, file: "./fine.ksplat", splatCount: 20, bytes: 25 },
];

function responseWith(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("SplatLodLoader", () => {
  it("loads coarse first, then swaps to the finer level", async () => {
    const events: string[] = [];
    const viewer: SplatSceneViewer = {
      getSceneCount: vi.fn()
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(1),
      addSplatScene: vi.fn(async (path) => {
        events.push(`add:${new URL(path).pathname.split("/").at(-1)}`);
      }),
      removeSplatScene: vi.fn(async (index) => {
        events.push(`remove:${index}`);
      }),
    };
    const fetcher = vi.fn(async () => responseWith({ levels }));
    const loader = new SplatLodLoader(
      viewer,
      new URL("https://assets.example/world/manifest.json"),
      { fetch: fetcher },
    );

    await loader.loadInitial();
    expect(events).toEqual(["add:coarse.ksplat"]);

    await loader.loadFinerLevels();
    expect(events).toEqual([
      "add:coarse.ksplat",
      "add:fine.ksplat",
      "remove:0",
    ]);
  });

  it("does not request a finer level beyond the client byte budget", async () => {
    const viewer: SplatSceneViewer = {
      getSceneCount: vi.fn().mockReturnValue(0),
      addSplatScene: vi.fn(async () => undefined),
      removeSplatScene: vi.fn(async () => undefined),
    };
    const loader = new SplatLodLoader(
      viewer,
      new URL("https://assets.example/world/manifest.json"),
      {
        fetch: async () => responseWith({ levels }),
        maxDownloadBytes: 30,
      },
    );

    await loader.loadInitial();
    await loader.loadFinerLevels();

    expect(viewer.addSplatScene).toHaveBeenCalledTimes(1);
  });
});

describe("fetchSplatLodManifest", () => {
  it("rejects an empty manifest", async () => {
    await expect(
      fetchSplatLodManifest(
        new URL("https://assets.example/manifest.json"),
        async () => responseWith({ levels: [] }),
      ),
    ).rejects.toThrow("has no levels");
  });
});
