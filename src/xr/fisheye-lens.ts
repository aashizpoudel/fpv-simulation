/*
  Equidistant fisheye remap for the DJI O3 feed.

  The drone camera renders with a normal rectilinear camera into a source
  render target. A full-screen pass then resamples it so output image radius is
  proportional to ray angle from the optical axis (equidistant model).
*/

import * as THREE from "three";

type HalfAngles = { h: number; v: number };

export type SourceCamera = { tanHalfH: number; tanHalfV: number; fovYDeg: number; aspect: number };

/** Largest corner angle (radians) a rectilinear frustum is allowed to cover. */
const MAX_CORNER_ANGLE = (89 * Math.PI) / 180;

/**
 * Smallest rectilinear frustum covering the whole fisheye output rectangle.
 * tan(θ)/θ grows with θ, so the extent peaks at the image corner.
 */
export function sourceCameraFor(half: HalfAngles): SourceCamera {
  const thetaC = Math.hypot(half.h, half.v);
  if (!(thetaC < MAX_CORNER_ANGLE)) {
    throw new Error(
      `Fisheye corner angle ${((thetaC * 180) / Math.PI).toFixed(1)}° is too wide for a rectilinear source (limit 89°).`,
    );
  }
  const k = Math.tan(thetaC) / thetaC;
  const tanHalfH = k * half.h;
  const tanHalfV = k * half.v;
  return {
    tanHalfH,
    tanHalfV,
    fovYDeg: (2 * Math.atan(tanHalfV) * 180) / Math.PI,
    aspect: tanHalfH / tanHalfV,
  };
}

/**
 * Source render-target size whose center pixel density matches the output,
 * times `scale`, clamped so the longer side is at most `maxSide`.
 */
export function sourceResolution(
  outputWidth: number,
  half: HalfAngles,
  src: SourceCamera,
  scale = 1,
  maxSide = 4096,
): { width: number; height: number } {
  let w = ((outputWidth * src.tanHalfH) / half.h) * scale;
  let h = w / src.aspect;
  const longer = Math.max(w, h);
  if (longer > maxSide) {
    const f = maxSide / longer;
    w *= f;
    h *= f;
  }
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D source;
uniform vec2 halfAngle;
uniform vec2 tanHalf;
uniform float vignette;
varying vec2 vUv;
void main() {
  vec2 p = (vUv * 2.0 - 1.0) * halfAngle;
  float theta = length(p);
  vec2 dir = theta > 1e-6 ? p / theta : vec2(0.0);
  vec2 plane = tan(theta) * dir;
  vec2 srcUv = 0.5 + 0.5 * plane / tanHalf;
  vec4 c = texture2D(source, srcUv);
  float r = theta / length(halfAngle);
  c.rgb *= 1.0 - vignette * smoothstep(0.3, 1.0, r);
  if (srcUv.x < 0.0 || srcUv.x > 1.0 || srcUv.y < 0.0 || srcUv.y > 1.0) c = vec4(0.0, 0.0, 0.0, 1.0);
  gl_FragColor = vec4(c.rgb, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * Fisheye material for a 3D quad (PlaneGeometry) in the goggles scene; the
 * standard projection chain places the quad. The source render-target texture
 * holds LINEAR color, so the shader outputs linear color and
 * `<colorspace_fragment>` converts it to the output framebuffer's color space.
 * No tone mapping (`toneMapped: false`).
 */
export function createFisheyeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      source: { value: null },
      halfAngle: { value: new THREE.Vector2(1, 1) },
      tanHalf: { value: new THREE.Vector2(1, 1) },
      vignette: { value: 0.35 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

/** Point the material at a source texture and lens geometry. */
export function setFisheyeUniforms(
  material: THREE.ShaderMaterial,
  half: HalfAngles,
  src: SourceCamera,
  texture: THREE.Texture | null,
): void {
  material.uniforms.source.value = texture;
  material.uniforms.halfAngle.value.set(half.h, half.v);
  material.uniforms.tanHalf.value.set(src.tanHalfH, src.tanHalfV);
}

/** CPU version of the shader mapping: output uv (0..1) to source uv. */
export function fisheyeSourcePoint(
  uv: { x: number; y: number },
  half: HalfAngles,
  src: SourceCamera,
): { x: number; y: number } {
  const px = (uv.x * 2 - 1) * half.h;
  const py = (uv.y * 2 - 1) * half.v;
  const theta = Math.hypot(px, py);
  const t = theta > 1e-6 ? Math.tan(theta) / theta : 1;
  return {
    x: 0.5 + (0.5 * px * t) / src.tanHalfH,
    y: 0.5 + (0.5 * py * t) / src.tanHalfV,
  };
}
