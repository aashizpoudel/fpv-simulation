# Three.js Factory splat LOD

The simulator uses a deploy-time repack instead of making browsers fetch the
original ~1.2 GB PlayCanvas SOG. The generated manifest contains only:

- LOD 6: about 12.2 MiB, loaded first.
- LOD 5: about 24.5 MiB, loaded after the first frame.
- Factory collision GLB: about 9.1 MiB unpacked.

The runtime has a 64 MiB cumulative KSPLAT download budget. Adding more entries
to the manifest does not bypass that guard.

## Generate assets

```sh
npm install
npm run splat:repack
```

Node.js 22 or newer is required by `@playcanvas/splat-transform`. Generated
files are ignored by Git because they are deployment artifacts.

## Run

```sh
npm run dev -- --open '/fpv-simulation/?world=factory-splat'
```

The default URL continues to load de_dust_2. Use `?world=factory-splat` to load
the Gaussian environment with the native PlayCanvas Streamed SOG renderer and
its invisible Rapier collision mesh. Force the repacked Three.js fallback with
`?world=factory-splat&renderer=threejs`.
