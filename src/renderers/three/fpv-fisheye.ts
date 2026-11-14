/*
  Equidistant fisheye for the desktop FPV camera.

  The world is rendered with a slightly wider rectilinear camera, then resampled
  so image radius is proportional to the ray angle. The output covers the same
  field of view as the FPV camera.
*/

import * as THREE from "three";
import {
  createFisheyeMaterial,
  setFisheyeUniforms,
  sourceCameraFor,
  sourceResolution,
} from "../../xr/fisheye-lens";

export class FpvFisheye {
  private readonly material = createFisheyeMaterial();
  private readonly scene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly drawing = new THREE.Vector2();
  private target?: THREE.WebGLRenderTarget;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  render(world: THREE.Scene, camera: THREE.PerspectiveCamera, amount: number): void {
    const strength = Math.min(1, Math.max(0, amount));
    if (strength <= 0) {
      this.renderer.render(world, camera);
      return;
    }
    this.renderer.getDrawingBufferSize(this.drawing);
    const width = this.drawing.x;
    const height = this.drawing.y;
    if (width < 1 || height < 1) {
      this.renderer.render(world, camera);
      return;
    }

    const halfV = ((camera.fov * Math.PI) / 180) / 2;
    const halfH = Math.atan(Math.tan(halfV) * (width / height));
    const half = { h: halfH, v: halfV };
    let source;
    try {
      source = sourceCameraFor(half);
    } catch {
      this.renderer.render(world, camera);
      return;
    }

    const pixels = sourceResolution(width, half, source, 1, 2048);
    if (!this.target || this.target.width !== pixels.width || this.target.height !== pixels.height) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(pixels.width, pixels.height, {
        colorSpace: THREE.SRGBColorSpace,
        depthBuffer: true,
      });
    }

    const fov = camera.fov;
    const aspect = camera.aspect;
    camera.fov = source.fovYDeg;
    camera.aspect = source.aspect;
    camera.updateProjectionMatrix();
    const previous = this.renderer.getRenderTarget();
    try {
      this.renderer.setRenderTarget(this.target);
      this.renderer.render(world, camera);
    } finally {
      camera.fov = fov;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      this.renderer.setRenderTarget(previous);
    }

    setFisheyeUniforms(this.material, half, source, this.target.texture);
    this.material.uniforms.strength.value = strength;
    this.renderer.render(this.scene, this.quadCamera);
  }

  dispose(): void {
    this.target?.dispose();
    this.target = undefined;
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
    });
    this.material.dispose();
  }
}
