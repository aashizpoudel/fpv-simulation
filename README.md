# FPV drone simulator

Fly a Tinyhawk-sized drone through the captured Factory environment using
**Three.js + Spark 2.1** for Gaussian splats and **Rapier** for rigid-body collision.
The default route opens in FPV mode. Firefox with WebGL2 is supported.

## Run

```sh
npm install
npm run dev
```

Open http://localhost:5173/fpv-simulation/ in Firefox.
The scene and its collision mesh must finish loading before flight controls activate.

The local Factory assets already present in this workspace are used directly:
`public/maps/factory-splat/manifest.json`, `factory-lod5.ksplat`, and
`factory-collider.glb`. These generated files are ignored by Git. On a fresh
checkout, use Node 22+ and run `npm run splat:repack` to generate them.
That command downloads and converts the remote Factory source; ordinary play
does not download the original SOG.

## Controls

| Input | Action |
| --- | --- |
| Shift+M | Arm / disarm |
| W / S | Raise / lower throttle; release to hold |
| Arrow keys | Pitch / roll |
| A / D | Yaw left / right |
| F | Switch acro rate control / angle self-leveling |
| C | Switch FPV / chase / orbit |
| Mouse drag / wheel | Orbit camera / zoom |
| R | Reset, disarmed, at the spawn |

Hover is around 74% throttle. Start with angle mode if unfamiliar with acro.
Disarming stops motors; the drone continues falling. Hard impacts cut motors and
show the reset banner. Gentle contacts are handled by the physical collision mesh.

Connect a USB radio/gamepad and press a button to expose it to the browser.
Use the calibration button to map sticks and buttons. Follow the requested stick
direction: it determines axis inversion. Radio throttle is absolute, unlike
keyboard throttle. Lower it fully before arming. Calibration is stored locally.

The rendering quality selector adjusts resolution and the spatial splat budget.
Use Performance on slower hardware. Frame rate depends on GPU, viewport, and
how close the camera is to surfaces.

## Implementation

- A single Three.js WebGL2 context renders one camera per frame.
- Spark loads the finest local KSPLAT, constructs a spatial LOD tree in its worker,
  and chooses splats for the active view. It does not swap whole-world LOD files.
- Rapier uses the Factory triangle mesh with CCD on the drone.
- The collider includes the original scene placement, converted from Y-up:
  `(-4.695, 0.438, 11.397)` becomes `(-4.695, -11.397, 0.438)`.
  The GLB by itself omits this offset.
- Physics runs at 240 Hz with up to 16 steps per frame, covering ordinary rendering
  dips down to 15 FPS. Longer stalls discard excess time; hidden tabs pause.
- Reset reuses the static collider rather than rebuilding its acceleration structure.
- Cesium and PlayCanvas are loaded only when explicitly selected.

For collision alignment inspection, open `?collision=1` to overlay the mesh.
Use `?world=dedust` for the mesh map or `?renderer=playcanvas` for the older
native SOG experiment. The latter still uses its separate renderer implementation.

The existing LOD5 asset contains about 1.07 million splats and no higher-order
spherical harmonics. This limits close-up sharpness and view-dependent appearance.
The collision mesh is an approximation of the capture, not every visible splat.
To increase scene fidelity later, repack a finer source or prebuild a Spark RAD
LOD asset; the current implementation loads its local KSPLAT fully before play.

## Verify and build

```sh
npm test
npm run build
npm run preview
```

Build validates that Factory assets exist and match their manifest sizes.
Tests cover fixed-step timing, radio throttle, disarmed gravity, gentle landings,
hard impacts, high-speed thin-wall CCD, reset, and the actual Factory spawn and
ceiling (the Factory integration test requires the generated collider).

The production base path is `/fpv-simulation/`. Deploy the entire `build/`
directory, including maps and generated assets. Spark and Rapier include sizable
runtime/WASM payloads; Vite may still report large-chunk warnings.

For the automated Firefox flight check, launch an isolated Firefox profile with
`--remote-debugging-port 9338`, start the dev server, then run
`node scripts/firefox-smoke.mjs` (Node 22+). It checks takeoff, a ceiling crash,
reset, camera and flight-mode switching, quality selection, and console errors.
Screenshots are written to a temporary directory reported on completion.
Set `FPV_URL=http://127.0.0.1:4173/fpv-simulation/` to test the preview server.
