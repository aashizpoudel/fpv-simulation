# FPV Drone Simulator

A browser-based FPV drone simulator built with Three.js, Spark, and Rapier. Fly with a keyboard, USB radio, or gamepad.

## Run locally

Requires Node.js 22 or later.

```sh
npm install
npm run dev
```

Open http://localhost:5173/fpv-simulation/.

## Controls

| Input | Action |
| --- | --- |
| Shift+M | Arm or disarm |
| W / S | Throttle |
| A / D | Yaw |
| Arrow keys | Pitch and roll |
| F | Flight mode |
| C | Camera view |
| R | Reset |
| G | Record |
| H | Help |

Configure a USB radio or gamepad under **Settings > Flight Controls**.

## Environments

Choose Factory, DeDust, or Ekotori in Settings, or use `?world=factory-splat`, `?world=dedust`, or `?world=ekotori`.

## Build

```sh
npm test
npm run build
```

Deploy the `build/` directory. The base path defaults to `/fpv-simulation/`; set `VITE_BASE_PATH=/` to serve from the root.
