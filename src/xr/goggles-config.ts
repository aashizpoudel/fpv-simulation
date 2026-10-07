/*
  DJI O3 goggles view model for WebXR.

  Real FPV goggles are not head-tracked: they show the drone camera's 2D video
  on a fixed screen in front of the eyes. The VR view reproduces that screen.

  Sources (manufacturer specs):
  - O3 Air Unit: 1/1.7" sensor, 155° FOV in 4:3, 16:9 is a crop of 4:3;
    1080p/100 fps live view, ~30 ms latency with DJI Goggles 2.
  - DJI Goggles 2: 1920×1080 micro-OLED per eye, 51° FOV.
  - DJI Goggles Integra: 1920×1080 micro-OLED per eye, 44° FOV.

  The lens is modeled as equidistant fisheye (image radius ∝ ray angle), an
  approximation of the O3's barrel distortion.
*/

export type FeedAspect = "4:3" | "16:9";
export type GogglesModel = "goggles2" | "integra";

export type GogglesScreen = {
  label: string;
  /** Diagonal field of view of the goggle screen, degrees. */
  diagonalFovDeg: number;
  /** Screen panel resolution (per eye). */
  width: number;
  height: number;
};

export const GOGGLES_SCREENS: Record<GogglesModel, GogglesScreen> = {
  goggles2: { label: "DJI Goggles 2 (51°)", diagonalFovDeg: 51, width: 1920, height: 1080 },
  integra: { label: "DJI Goggles Integra (44°)", diagonalFovDeg: 44, width: 1920, height: 1080 },
};

export type O3Lens = {
  /** Diagonal FOV of the full 4:3 sensor image, degrees. */
  sensorDiagonalFovDeg: number;
  /** Camera uptilt is taken from DroneConfig.cameraConfig.fpvTiltDeg. */
};

export const O3_LENS: O3Lens = { sensorDiagonalFovDeg: 155 };

export type GogglesSettings = {
  model: GogglesModel;
  aspect: FeedAspect;
  /** Extra video-link delay added on top of rendering delay, ms. */
  extraLatencyMs: number;
  /** Distance from the eye to the virtual screen, meters. Any value works; it only sets parallax-free depth. */
  screenDistance: number;
};

export const DEFAULT_GOGGLES_SETTINGS: GogglesSettings = {
  model: "goggles2",
  aspect: "4:3",
  // ~30 ms O3 link latency minus ~10 ms the headset pipeline already adds.
  extraLatencyMs: 20,
  screenDistance: 2,
};

/** Half-angles (radians) of the O3 output image for the chosen aspect, equidistant model. */
export function o3HalfAngles(aspect: FeedAspect, lens: O3Lens = O3_LENS): { h: number; v: number } {
  const diagHalf = ((lens.sensorDiagonalFovDeg / 2) * Math.PI) / 180;
  // 4:3 sensor: diagonal is 5 units, width 4, height 3. Equidistant: angle ∝ radius.
  const h = (diagHalf * 4) / 5;
  const v43 = (diagHalf * 3) / 5;
  // 16:9 keeps the full sensor width and crops height.
  const v = aspect === "4:3" ? v43 : (h * 9) / 16;
  return { h, v };
}

/** Size (meters) of the head-locked goggle screen quad at `distance`, 16:9 panel. */
export function gogglesScreenSize(screen: GogglesScreen, distance: number): { width: number; height: number } {
  const diagonal = 2 * distance * Math.tan(((screen.diagonalFovDeg / 2) * Math.PI) / 180);
  const diagUnits = Math.hypot(screen.width, screen.height);
  return {
    width: (diagonal * screen.width) / diagUnits,
    height: (diagonal * screen.height) / diagUnits,
  };
}
