# Spark Factory rendering

The main application uses Spark 2.1 with Three.js. Open the default route:
`/fpv-simulation/`.

Spark reads the existing manifest and loads its finest local KSPLAT (currently
LOD5, 1,066,636 splats, 24.5 MiB). `SplatMesh({ lod: true })` builds a spatial
LOD tree in a worker. The active camera and quality setting determine the rendered
detail. This is full-file loading with spatial rendering LOD, not network paging.

The collision GLB is loaded concurrently, then passed to Rapier before the input
loop starts. Its X rotation is PI/2 and its simulation-space translation is
(-4.695, -11.397, 0.438), matching the original Factory scene entity placement.
The spawn floor is approximately Z=-0.67765. There is no artificial Z=0 floor.

Use `?collision=1` to inspect the triangle mesh over the capture.

See [the project README](../README.md) for controls, asset generation, validation,
and deployment. Regenerating assets still uses `npm run splat:repack`; Node 22+
is required. Higher-quality capture data is needed to improve fidelity beyond
the already-repacked LOD5 asset.
