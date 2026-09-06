/** Detail keeps source Gaussians instead of substituting coarse LOD clusters. */
export function renderQuality(name: string, devicePixelRatio: number) {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  if (name === "detail") return {
    // Supersample even on 1x monitors; preserve up to 2x Retina resolution.
    pixelRatio: Math.max(1.5, Math.min(dpr, 2)),
    enableLod: false,
    splats: 1_500_000,
    minSortIntervalMs: 0,
    sortRadial: false,
  };
  const performance = name === "performance";
  return {
    pixelRatio: Math.min(dpr, performance ? 0.75 : 1),
    enableLod: true,
    splats: performance ? 300_000 : 650_000,
    minSortIntervalMs: 40,
    sortRadial: true,
  };
}
