/*
  Head-locked DJI O3 goggle screen for WebXR.

  Each XR frame:
  1. Render the world once (mono) from the drone FPV camera into a rectilinear
     source target, using the camera pose from `extraLatencyMs` ago.
  2. Draw that target on a quad in front of the eyes through the O3 fisheye
     shader, with the OSD canvas on top. The session uses the "viewer"
     reference space, so the quad stays fixed to the head like real goggles.
*/

import * as THREE from "three";
import { SparkRenderer } from "@sparkjsdev/spark";
import {
  GOGGLES_SCREENS,
  gogglesScreenSize,
  o3HalfAngles,
  type GogglesSettings,
} from "./goggles-config";
import {
  createFisheyeMaterial,
  setFisheyeUniforms,
  sourceCameraFor,
  sourceResolution,
  type SourceCamera,
} from "./fisheye-lens";
import { GogglesOsd, type GogglesOsdState } from "./goggles-osd";

export type SparkFeedOptions = {
  lodSplatCount: number;
  minSortIntervalMs: number;
};

type PoseSample = { time: number; position: THREE.Vector3; quaternion: THREE.Quaternion };

/** Fixed-size history of camera poses, sampled with interpolation to model link latency. */
export class PoseHistory {
  private samples: PoseSample[] = [];
  constructor(private readonly maxAgeMs = 500) {}

  push(time: number, position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    this.samples.push({ time, position: position.clone(), quaternion: quaternion.clone() });
    while (this.samples.length > 2 && time - this.samples[0].time > this.maxAgeMs) this.samples.shift();
  }

  sample(time: number, position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    const samples = this.samples;
    if (samples.length === 0) return;
    if (time <= samples[0].time) {
      position.copy(samples[0].position);
      quaternion.copy(samples[0].quaternion);
      return;
    }
    for (let i = samples.length - 1; i > 0; i--) {
      const a = samples[i - 1];
      const b = samples[i];
      if (time >= a.time) {
        const t = b.time > a.time ? Math.min(1, (time - a.time) / (b.time - a.time)) : 1;
        position.lerpVectors(a.position, b.position, t);
        quaternion.slerpQuaternions(a.quaternion, b.quaternion, t);
        return;
      }
    }
  }

  clear(): void {
    this.samples = [];
  }
}

export class GogglesView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 100);
  readonly osd: GogglesOsd;
  private readonly feedCamera: THREE.PerspectiveCamera;
  private readonly source: SourceCamera;
  private readonly half: { h: number; v: number };
  private readonly material = createFisheyeMaterial();
  private readonly history = new PoseHistory();
  private readonly delayedPosition = new THREE.Vector3();
  private readonly delayedQuaternion = new THREE.Quaternion();
  private spark?: SparkRenderer;
  private target?: THREE.WebGLRenderTarget;
  private sparkUpdating = false;
  private readonly meshes: THREE.Mesh[] = [];

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly world: THREE.Scene,
    private readonly settings: GogglesSettings,
    spark: SparkFeedOptions | null,
    /** Source resolution relative to matching the feed's center detail. */
    resolutionScale = 0.5,
  ) {
    const screen = GOGGLES_SCREENS[settings.model];
    this.half = o3HalfAngles(settings.aspect);
    this.source = sourceCameraFor(this.half);
    this.feedCamera = new THREE.PerspectiveCamera(this.source.fovYDeg, this.source.aspect, 0.015, 1000);
    this.feedCamera.up.set(0, 0, 1);

    // The feed fills the panel height; 4:3 is pillarboxed in the 16:9 panel.
    const feedAspect = settings.aspect === "4:3" ? 4 / 3 : 16 / 9;
    const feedPixelWidth = Math.round(screen.height * feedAspect);
    const size = sourceResolution(feedPixelWidth, this.half, this.source, resolutionScale);

    if (spark) {
      // A second Spark renderer with an offline target: Spark otherwise sorts and
      // sizes splats for the headset camera while an XR session is presenting.
      this.spark = new SparkRenderer({
        renderer,
        autoUpdate: false,
        lodSplatCount: spark.lodSplatCount,
        minSortIntervalMs: spark.minSortIntervalMs,
        focalAdjustment: 2.0,
        blurAmount: 0.0,
        sortRadial: true,
        target: { width: size.width, height: size.height },
      });
    } else {
      this.target = new THREE.WebGLRenderTarget(size.width, size.height, {
        colorSpace: THREE.SRGBColorSpace,
        depthBuffer: true,
      });
    }

    const panel = gogglesScreenSize(screen, settings.screenDistance);
    const feedWidth = panel.height * feedAspect;
    this.scene.background = new THREE.Color(0x000000);
    this.addQuad(feedWidth, panel.height, this.material, 0);

    this.osd = new GogglesOsd(screen.width, screen.height);
    const feedPixelX = (screen.width - feedPixelWidth) / 2;
    this.osd.setFeedRect({ x: feedPixelX, y: 0, width: feedPixelWidth, height: screen.height });
    const osdMaterial = new THREE.MeshBasicMaterial({
      map: this.osd.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.addQuad(panel.width, panel.height, osdMaterial, 1);
  }

  /** Render one XR frame. `pose` is the live FPV camera pose (position + orientation). */
  render(position: THREE.Vector3, quaternion: THREE.Quaternion, now = performance.now()): void {
    this.history.push(now, position, quaternion);
    this.history.sample(now - this.settings.extraLatencyMs, this.delayedPosition, this.delayedQuaternion);
    this.feedCamera.position.copy(this.delayedPosition);
    this.feedCamera.quaternion.copy(this.delayedQuaternion);
    this.feedCamera.updateMatrixWorld();

    // three.js substitutes the headset camera whenever XR is presenting, even
    // for render targets, so render the drone camera with XR switched off.
    const xrEnabled = this.renderer.xr.enabled;
    this.renderer.xr.enabled = false;
    let texture: THREE.Texture;
    try {
      if (this.spark) {
        if (!this.sparkUpdating) {
          this.sparkUpdating = true;
          void this.spark
            .update({ scene: this.world, camera: this.feedCamera })
            .catch(() => undefined)
            .finally(() => { this.sparkUpdating = false; });
        }
        texture = this.spark.renderTarget({ scene: this.world, camera: this.feedCamera }).texture;
      } else {
        const previous = this.renderer.getRenderTarget();
        this.renderer.setRenderTarget(this.target!);
        this.renderer.render(this.world, this.feedCamera);
        this.renderer.setRenderTarget(previous);
        texture = this.target!.texture;
      }
    } finally {
      this.renderer.xr.enabled = xrEnabled;
    }

    setFisheyeUniforms(this.material, this.half, this.source, texture);
    this.renderer.render(this.scene, this.camera);
  }

  updateOsd(state: GogglesOsdState): void {
    this.osd.update(state);
  }

  /** Delayed feed pose, used to place the audio listener where the pilot "sees". */
  get feedPose(): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
    return { position: this.feedCamera.position, quaternion: this.feedCamera.quaternion };
  }

  dispose(): void {
    this.history.clear();
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.osd.dispose();
    this.target?.dispose();
    this.spark?.dispose();
  }

  private addQuad(width: number, height: number, material: THREE.Material, renderOrder: number): void {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.position.set(0, 0, -this.settings.screenDistance);
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    this.meshes.push(mesh);
    this.scene.add(mesh);
  }
}
