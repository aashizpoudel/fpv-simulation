# FPV Drone Simulator

A browser-based FPV drone simulator built with Three.js, Spark, and Rapier.
It supports keyboard controls, USB radios, and gamepads.

## Run locally

Use Node.js 22 or later.

```sh
npm install
npm run dev
```

Open http://localhost:5173/fpv-simulation/.

The Factory map uses generated assets that are not stored in Git. On a fresh
checkout, create them before starting the simulator:

```sh
npm run splat:repack
```

## Controls

| Input | Action |
| --- | --- |
| Shift+M | Arm or disarm |
| W / S | Increase or decrease throttle |
| A / D | Yaw |
| Arrow keys | Pitch and roll |
| F | Switch between angle and acro modes |
| C | Switch camera view |
| R | Reset |
| G | Start or stop recording |
| H | Show or hide help |
| Mouse drag / wheel | Rotate or zoom the orbit camera |

To use a USB radio or gamepad:

1. Connect the device and press one of its buttons.
2. Open **Settings > Flight Controls**.
3. Select **Detect**, then select **Radio / Gamepad**.
4. Calibrate the device if requested.

You can return to keyboard control from the same settings section.

## Environments

Select an environment in Settings or use a URL parameter:

- `?world=factory-splat`
- `?world=dedust`
- `?world=ekotori`

To rebuild the Ekotori collision mesh:

```sh
npm run collision:ekotori
```

## Development

```sh
npm test
npm run typecheck
npm run build
npm run preview
```

The production base path is `/fpv-simulation/`. Deploy the complete `build/`
directory so that maps and runtime assets remain available.
