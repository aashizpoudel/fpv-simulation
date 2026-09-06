import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import type { CameraMode, DroneTelemetry, Vec3 } from "../../types";
import type { DroneConfig } from "../../config/drone-config";
import type { WorldConfig } from "../../config/dedust-world-config";
import type { IRenderer } from "../renderer-interface";
import { fetchSplatLodManifest } from "./splat-lod-loader";
import { renderQuality } from "./render-quality";
import { externalCameraRig, headingRotation } from "./external-camera";

/** One WebGL context and one camera per frame, with camera-driven Spark LOD. */
export class ThreejsRenderer implements IRenderer {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(85, 1, 0.015, 1000);
  private drone = new THREE.Group();
  private renderer!: THREE.WebGLRenderer;
  private spark?: SparkRenderer;
  private splats?: SplatMesh;
  private controls!: OrbitControls;
  private container!: HTMLElement;
  private droneConfig?: DroneConfig;
  private worldConfig?: WorldConfig;
  private previousMode?: CameraMode;
  private cameraRig = externalCameraRig(0.105);
  private heading = new THREE.Quaternion();
  private position = new THREE.Vector3();
  private offset = new THREE.Vector3();
  private look = new THREE.Vector3();
  private fpvRotation = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)),
  );
  private disposed = false;
  private resizeHandler = () => this.resize();
  private qualityHandler = () => this.applyQuality();
  public onMapLoaded?: (map: object) => void;
  public mapScale?: number;

  setDroneConfig(config: DroneConfig): void {
    this.droneConfig = config;
    this.cameraRig = externalCameraRig(Math.max(config.length, config.width));
    const tiltDeg = config.cameraConfig?.fpvTiltDeg ?? 20;
    const tiltRad = (tiltDeg * Math.PI) / 180;
    const lookTarget = new THREE.Vector3(Math.cos(tiltRad), 0, Math.sin(tiltRad));
    const upTarget = new THREE.Vector3(-Math.sin(tiltRad), 0, Math.cos(tiltRad));
    this.fpvRotation.setFromRotationMatrix(
      new THREE.Matrix4().lookAt(new THREE.Vector3(), lookTarget, upTarget),
    );
  }
  setWorldConfig(config: WorldConfig): void { this.worldConfig = config; }

  async init(container: HTMLElement, start?: Vec3): Promise<void> {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    container.appendChild(this.renderer.domElement);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = this.cameraRig.minOrbitDistance;
    this.controls.enablePan = false;
    this.controls.maxPolarAngle = Math.PI / 2;
    this.controls.maxDistance = 100;
    this.scene.background = new THREE.Color(0x161c23);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(10, -10, 20);
    this.scene.add(light, this.drone);
    if (start) this.drone.position.set(start.x, start.y, start.z);
    this.resize();
    window.addEventListener("resize", this.resizeHandler);
    document.getElementById("quality")?.addEventListener("change", this.qualityHandler);
    this.applyQuality();
    const loader = new GLTFLoader();
    // Await all jobs even on failure so disposal cannot race another asset load.
    const jobs = await Promise.allSettled([this.loadWorld(loader), this.loadDrone(loader)]);
    const failed = jobs.find((job) => job.status === "rejected");
    if (failed?.status === "rejected") { this.dispose(); throw failed.reason; }
  }

  private async loadDrone(loader: GLTFLoader): Promise<void> {
    try {
      const model = (await loader.loadAsync(this.droneConfig!.modelUrl)).scene;
      model.rotation.x = Math.PI / 2;
      model.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      const config = this.droneConfig!;
      model.scale.multiplyScalar(Math.max(config.length, config.width) / Math.max(size.x, size.y));
      model.updateMatrixWorld(true);
      model.position.sub(new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()));
      this.drone.add(model);
    } catch {
      this.drone.add(new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.105, 0.045),
        new THREE.MeshStandardMaterial({ color: 0xffaa22 })));
    }
  }

  private async loadWorld(loader: GLTFLoader): Promise<void> {
    const config = this.worldConfig;
    if (!config) throw new Error("Select a world before starting the simulator.");
    const jobs = await Promise.allSettled([
      this.loadVisual(loader, config),
      config.collisionGlbPath ? this.loadCollision(loader, config) : Promise.resolve(),
    ]);
    const failed = jobs.find((job) => job.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }

  private async loadVisual(loader: GLTFLoader, config: WorldConfig): Promise<void> {
    if (config.splatLodManifestPath) {
      this.status("Loading environment…");
      const url = new URL(this.assetUrl(config.splatLodManifestPath));
      const manifest = await fetchSplatLodManifest(url);
      // Use the finest local source once; Spark builds a spatial tree in its worker.
      const level = [...manifest.levels].sort((a, b) => b.splatCount - a.splatCount)[0];
      if (level.bytes > 64 * 1024 * 1024) throw new Error("Environment exceeds the 64 MiB asset budget.");
      this.spark = new SparkRenderer({
        renderer: this.renderer,
        lodSplatCount: 650_000,
        minSortIntervalMs: 40,
        focalAdjustment: 2.0,
        blurAmount: 0.0,
        sortRadial: true,
      });
      this.scene.add(this.spark);
      this.applyQuality();
      this.splats = new SplatMesh({
        // Retain original splats so Detail can bypass the generated LOD tree.
        url: new URL(level.file, url).href, lod: true, nonLod: true, raycastable: false,
        onProgress: (event) => this.status(event.total
          ? "Loading environment… " + Math.round(event.loaded / event.total * 100) + "%"
          : "Preparing environment detail…"),
      });
      this.splats.rotation.set(config.visualRotationX ?? 0, 0, config.visualRotationZ ?? 0, "XYZ");
      this.splats.scale.setScalar(config.mapScale ?? 1);
      await this.splats.initialized;
      this.scene.add(this.splats);
      this.applyQuality();
    } else if (config.mapGlbPath) {
      const map = (await loader.loadAsync(this.assetUrl(config.mapGlbPath))).scene;
      map.rotation.set(config.visualRotationX ?? Math.PI / 2, 0, config.visualRotationZ ?? 0, "XYZ");
      map.scale.setScalar(config.mapScale ?? 1);
      this.scene.add(map);
      if (!config.collisionGlbPath) this.onMapLoaded?.(map);
    } else throw new Error("This world has no renderable asset.");
  }

  private async loadCollision(loader: GLTFLoader, config: WorldConfig): Promise<void> {
    const map = (await loader.loadAsync(this.assetUrl(config.collisionGlbPath!))).scene;
    map.rotation.x = config.collisionRotationX ?? Math.PI / 2;
    map.scale.setScalar(config.mapScale ?? 1);
    if (config.collisionPosition) map.position.set(
      config.collisionPosition.x, config.collisionPosition.y, config.collisionPosition.z,
    ).multiplyScalar(config.mapScale ?? 1);
    map.visible = false;
    this.scene.add(map);
    this.onMapLoaded?.(map);
    // Inspect alignment without changing physical geometry.
    if (new URLSearchParams(location.search).get("collision") === "1" || localStorage.getItem("drone_sim_collision") === "1") {
      map.visible = true;
      map.traverse((child) => {
        if (child instanceof THREE.Mesh) child.material = new THREE.MeshBasicMaterial({
          color: 0x00ffcc, wireframe: true, transparent: true, opacity: 0.25, depthWrite: false,
        });
      });
    }
  }

  render(frame: DroneTelemetry, mode: CameraMode): void {
    if (this.disposed) return;
    this.position.set(frame.localPosition.x, frame.localPosition.y, frame.localPosition.z);
    this.drone.position.copy(this.position);
    const q = frame.localOrientation;
    this.drone.quaternion.set(q.x, q.y, q.z, q.w);
    this.drone.visible = mode !== "fpv";
    this.controls.enabled = mode === "orbit";
    if (this.previousMode !== mode) {
      this.camera.fov = mode === "fpv" ? 85 : mode === "third"
        ? this.cameraRig.thirdFov : this.cameraRig.orbitFov;
      this.camera.updateProjectionMatrix();
    }
    if (mode === "fpv") {
      this.offset.set(this.droneConfig?.cameraConfig?.fpvForwardOffset ?? 0.04, 0, 0.02)
        .applyQuaternion(this.drone.quaternion);
      this.camera.position.copy(this.position).add(this.offset);
      this.camera.quaternion.copy(this.drone.quaternion).multiply(this.fpvRotation);
    } else if (mode === "third") {
      headingRotation(this.drone.quaternion, this.heading);
      this.offset.copy(this.cameraRig.thirdOffset).applyQuaternion(this.heading);
      this.camera.position.copy(this.position).add(this.offset);
      this.look.copy(this.cameraRig.thirdTarget).applyQuaternion(this.heading).add(this.position);
      this.camera.lookAt(this.look);
    } else {
      if (this.previousMode !== mode) this.camera.position.copy(this.position).add(this.cameraRig.orbitOffset);
      else this.camera.position.add(this.offset.copy(this.position).sub(this.controls.target));
      this.controls.target.copy(this.position);
      this.controls.update();
    }
    this.previousMode = mode;
    this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    if (!this.renderer) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private applyQuality(): void {
    const quality = (document.getElementById("quality") as HTMLSelectElement | null)?.value ?? "balanced";
    const settings = renderQuality(quality, window.devicePixelRatio);
    this.renderer.setPixelRatio(settings.pixelRatio);
    if (this.spark) {
      this.spark.enableLod = settings.enableLod;
      this.spark.lodSplatCount = settings.splats;
      this.spark.minSortIntervalMs = settings.minSortIntervalMs;
      this.spark.sortRadial = settings.sortRadial;
      this.spark.focalAdjustment = 2.0;
      this.spark.blurAmount = 0.0;
    }
    if (this.splats) this.splats.enableLod = settings.enableLod;
    this.resize();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("resize", this.resizeHandler);
    document.getElementById("quality")?.removeEventListener("change", this.qualityHandler);
    this.controls?.dispose();
    this.splats?.removeFromParent();
    this.splats?.dispose();
    this.spark?.removeFromParent();
    this.spark?.dispose();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
    });
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }

  private assetUrl(path: string): string {
    return new URL(path, new URL(import.meta.env.BASE_URL, location.origin)).href;
  }
  private status(message: string): void {
    const element = document.getElementById("lodStatus");
    if (element) element.textContent = message;
  }
}
