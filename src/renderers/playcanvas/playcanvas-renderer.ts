import {
  Application,
  Asset,
  CameraComponent,
  Color,
  ContainerResource,
  Entity,
  FILLMODE_NONE,
  GSplatComponent,
  Quat,
  RESOLUTION_AUTO,
  TONEMAP_LINEAR,
  Vec3 as PcVec3,
} from "playcanvas";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { WorldConfig } from "../../config/dedust-world-config";
import type { DroneConfig } from "../../config/tinyhawk-config";
import type { CameraMode, DroneTelemetry, Quaternion, Vec3 } from "../../types";
import type { IRenderer } from "../renderer-interface";

const Z_UP_TO_Y_UP = new Quat().setFromEulerAngles(-90, 0, 0);
const Z_UP_TO_Y_UP_INVERSE = Z_UP_TO_Y_UP.clone().invert();

/** Native PlayCanvas renderer for camera-driven Streamed SOG octree LOD. */
export class PlayCanvasRenderer implements IRenderer {
  private app?: Application;
  private canvas?: HTMLCanvasElement;
  private container?: HTMLElement;
  private cameraEntity?: Entity;
  private camera?: CameraComponent;
  private droneEntity?: Entity;
  private worldEntity?: Entity;
  private worldAsset?: Asset;
  private droneAsset?: Asset;
  private worldConfig?: WorldConfig;
  private droneConfig?: DroneConfig;
  private orbitYaw = Math.PI;
  private orbitPitch = 0.58;
  private orbitDistance = 3;
  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private resizeHandler = () => this.resize();
  private pointerDownHandler = (event: PointerEvent) => this.onPointerDown(event);
  private pointerMoveHandler = (event: PointerEvent) => this.onPointerMove(event);
  private pointerUpHandler = () => {
    this.dragging = false;
  };
  private wheelHandler = (event: WheelEvent) => this.onWheel(event);

  public onMapLoaded?: (mapObject: object) => void;
  public mapScale?: number;

  public async init(container: HTMLElement, startPosition?: Vec3): Promise<void> {
    this.container = container;
    const canvas = document.createElement("canvas");
    canvas.className = "playcanvas-canvas";
    canvas.tabIndex = 0;
    container.appendChild(canvas);
    this.canvas = canvas;

    const app = new Application(canvas, {
      graphicsDeviceOptions: {
        antialias: false,
        powerPreference: "high-performance",
      },
    });
    this.app = app;
    app.setCanvasFillMode(
      FILLMODE_NONE,
      container.clientWidth,
      container.clientHeight,
    );
    app.setCanvasResolution(RESOLUTION_AUTO);
    app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);

    // Keep the active set bounded. The native octree spends detail near the
    // camera and streams/evicts SOG chunks as the drone moves.
    app.scene.gsplat.splatBudget = this.isMobile() ? 650_000 : 1_000_000;
    app.scene.gsplat.lodUpdateDistance = 0.35;
    app.scene.gsplat.lodUpdateAngle = 35;
    app.scene.gsplat.lodBehindPenalty = 3;
    app.scene.gsplat.lodUnderfillLimit = 5;
    app.scene.gsplat.radialSorting = true;
    app.scene.ambientLight = new Color(0.45, 0.45, 0.45);

    this.createCamera();
    this.createLight();
    this.createDroneRoot(startPosition ?? { x: 0, y: 0, z: 0 });

    const config = this.worldConfig;
    if (!config) throw new Error("PlayCanvas renderer requires a world config");

    await Promise.all([
      this.loadVisualWorld(config),
      this.loadDroneModel().catch((error) => {
        console.warn("Could not load drone model; using a box", error);
        this.droneEntity?.addComponent("render", { type: "box" });
        this.droneEntity?.setLocalScale(0.12, 0.04, 0.12);
      }),
      this.loadCollisionWorld(config),
    ]);

    this.installInteractionHandlers();
    app.start();
    this.resize();
  }

  public render(frame: DroneTelemetry, cameraMode: CameraMode): void {
    if (!this.app || !this.droneEntity || !this.cameraEntity) return;
    const position = toPlayCanvasPosition(frame.localPosition);
    const rotation = toPlayCanvasRotation(frame.localOrientation);
    this.droneEntity.setPosition(position);
    this.droneEntity.setRotation(rotation);
    this.updateCamera(frame, cameraMode);
  }

  public resize(): void {
    if (!this.app || !this.container) return;
    this.app.resizeCanvas(
      this.container.clientWidth,
      this.container.clientHeight,
    );
  }

  public dispose(): void {
    window.removeEventListener("resize", this.resizeHandler);
    this.canvas?.removeEventListener("pointerdown", this.pointerDownHandler);
    window.removeEventListener("pointermove", this.pointerMoveHandler);
    window.removeEventListener("pointerup", this.pointerUpHandler);
    this.canvas?.removeEventListener("wheel", this.wheelHandler);
    this.worldEntity?.destroy();
    this.droneEntity?.destroy();
    this.worldAsset?.unload();
    this.droneAsset?.unload();
    this.app?.destroy();
    this.canvas?.remove();
    this.app = undefined;
    this.canvas = undefined;
  }

  public setDroneConfig(config: DroneConfig): void {
    this.droneConfig = config;
    this.orbitDistance = config.cameraConfig?.orbitInitialDistance ?? 3;
  }

  public setWorldConfig(config: WorldConfig): void {
    this.worldConfig = config;
    this.mapScale = config.mapScale ?? 1;
  }

  public setFeedCanvas(_canvasId: string | null): void {}
  public setFeedMode(_mode: "auto" | "fpv" | "third"): void {}

  private createCamera(): void {
    if (!this.app) return;
    const camera = new Entity("Camera");
    this.camera = camera.addComponent("camera", {
      clearColor: new Color(0.53, 0.81, 0.92),
      farClip: 2000,
      nearClip: 0.02,
      fov: 75,
      toneMapping: TONEMAP_LINEAR,
    }) as CameraComponent;
    this.cameraEntity = camera;
    this.app.root.addChild(camera);
  }

  private createDroneRoot(startPosition: Vec3): void {
    if (!this.app) return;
    const drone = new Entity("Drone");
    drone.setPosition(toPlayCanvasPosition(startPosition));
    this.droneEntity = drone;
    this.app.root.addChild(drone);
  }

  private createLight(): void {
    if (!this.app) return;
    const light = new Entity("Sun");
    light.addComponent("light", {
      type: "directional",
      color: new Color(1, 1, 1),
      intensity: 1.2,
      castShadows: false,
    });
    light.setEulerAngles(45, 30, 0);
    this.app.root.addChild(light);
  }

  private async loadVisualWorld(config: WorldConfig): Promise<void> {
    if (!this.app) return;
    if (config.streamedSogManifestPath) {
      this.setStatus("Loading native Streamed SOG metadata…", "loading");
      const asset = new Asset("Factory Streamed SOG", "gsplat", {
        url: this.assetUrl(config.streamedSogManifestPath),
      });
      await this.loadAsset(asset);
      this.worldAsset = asset;

      const entity = new Entity(config.name);
      const gsplat = entity.addComponent("gsplat", { asset }) as GSplatComponent;
      entity.setLocalEulerAngles(-90, 0, 0);
      entity.setLocalScale(config.mapScale ?? 1, config.mapScale ?? 1, config.mapScale ?? 1);
      this.app.root.addChild(entity);
      this.worldEntity = entity;

      gsplat.lodRangeMin = 0;
      gsplat.lodRangeMax = 99;
      this.trackSogStreaming();
      return;
    }

    if (!config.mapGlbPath) throw new Error(`${config.name} has no PlayCanvas visual asset`);
    const asset = new Asset(config.name, "container", {
      url: this.assetUrl(config.mapGlbPath),
    });
    await this.loadAsset(asset);
    this.worldAsset = asset;
    const entity = (asset.resource as ContainerResource).instantiateRenderEntity();
    entity.setLocalEulerAngles(-90, 0, 0);
    entity.setLocalScale(config.mapScale ?? 1, config.mapScale ?? 1, config.mapScale ?? 1);
    this.app.root.addChild(entity);
    this.worldEntity = entity;
  }

  private async loadDroneModel(): Promise<void> {
    if (!this.app || !this.droneEntity) return;
    const modelUrl =
      this.droneConfig?.modelUrl ??
      `${import.meta.env.BASE_URL}drone_models/tinyhawk.gltf`;
    const asset = new Asset("Tinyhawk", "container", {
      url: this.assetUrl(modelUrl),
    });
    await this.loadAsset(asset);
    this.droneAsset = asset;
    this.droneEntity.addChild(
      (asset.resource as ContainerResource).instantiateRenderEntity(),
    );
  }

  private async loadCollisionWorld(config: WorldConfig): Promise<void> {
    const path = config.collisionGlbPath ?? config.mapGlbPath;
    if (!path) return;
    const gltf = await new GLTFLoader().loadAsync(this.assetUrl(path));
    const collision = gltf.scene;
    collision.rotation.x = config.collisionGlbPath
      ? (config.collisionRotationX ?? Math.PI / 2)
      : (config.visualRotationX ?? Math.PI / 2);
    collision.scale.setScalar(config.mapScale ?? 1);
    this.onMapLoaded?.(collision);
  }

  private loadAsset(asset: Asset): Promise<void> {
    if (!this.app) return Promise.reject(new Error("PlayCanvas app is not initialized"));
    return new Promise((resolve, reject) => {
      asset.once("load", () => resolve());
      asset.once("error", (error: unknown) => reject(new Error(String(error))));
      this.app!.assets.add(asset);
      this.app!.assets.load(asset);
    });
  }

  private trackSogStreaming(): void {
    const app = this.app;
    if (!app) return;
    const gsplatSystem = app.systems.gsplat;
    if (!gsplatSystem) return;
    let maxLoading = 0;
    gsplatSystem.on(
      "frame:ready",
      (_camera: unknown, _layer: unknown, ready: boolean, loadingCount: number) => {
        maxLoading = Math.max(maxLoading, loadingCount);
        const splats = app.stats.frame.gsplats ?? 0;
        if (ready && loadingCount === 0) {
          this.setStatus(
            `Native SOG • ${splats.toLocaleString()} active splats`,
            "ready",
          );
        } else {
          const progress = maxLoading
            ? Math.round(((maxLoading - loadingCount) / maxLoading) * 100)
            : 0;
          this.setStatus(`Streaming spatial SOG chunks… ${progress}%`, "loading");
        }
      },
    );
  }

  private updateCamera(frame: DroneTelemetry, cameraMode: CameraMode): void {
    if (!this.cameraEntity) return;
    const position = frame.localPosition;

    if (cameraMode === "orbit") {
      const horizontal = this.orbitDistance * Math.cos(this.orbitPitch);
      const cameraPosition = {
        x: position.x + horizontal * Math.cos(this.orbitYaw),
        y: position.y + horizontal * Math.sin(this.orbitYaw),
        z: position.z + this.orbitDistance * Math.sin(this.orbitPitch),
      };
      this.cameraEntity.setPosition(toPlayCanvasPosition(cameraPosition));
      this.cameraEntity.lookAt(toPlayCanvasPosition(position), PcVec3.UP);
      return;
    }

    const cameraConfig = this.droneConfig?.cameraConfig;
    if (cameraMode === "fpv") {
      const offset = rotateVector(
        { x: cameraConfig?.fpvForwardOffset ?? 0.08, y: 0, z: 0.02 },
        frame.localOrientation,
      );
      const forward = rotateVector({ x: 1, y: 0, z: 0 }, frame.localOrientation);
      const up = rotateVector({ x: 0, y: 0, z: 1 }, frame.localOrientation);
      const cameraPosition = add(position, offset);
      this.cameraEntity.setPosition(toPlayCanvasPosition(cameraPosition));
      this.cameraEntity.lookAt(
        toPlayCanvasPosition(add(cameraPosition, forward)),
        toPlayCanvasDirection(up),
      );
      return;
    }

    const behind = cameraConfig?.thirdPersonBehind ?? 1.2;
    const height = cameraConfig?.thirdPersonHeight ?? 0.6;
    const offset = rotateVector({ x: -behind, y: 0, z: height }, frame.localOrientation);
    const forward = rotateVector({ x: 1, y: 0, z: 0 }, frame.localOrientation);
    this.cameraEntity.setPosition(toPlayCanvasPosition(add(position, offset)));
    this.cameraEntity.lookAt(toPlayCanvasPosition(add(position, forward)), PcVec3.UP);
  }

  private installInteractionHandlers(): void {
    window.addEventListener("resize", this.resizeHandler);
    this.canvas?.addEventListener("pointerdown", this.pointerDownHandler);
    window.addEventListener("pointermove", this.pointerMoveHandler);
    window.addEventListener("pointerup", this.pointerUpHandler);
    this.canvas?.addEventListener("wheel", this.wheelHandler, { passive: false });
  }

  private onPointerDown(event: PointerEvent): void {
    this.dragging = true;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.canvas?.setPointerCapture(event.pointerId);
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.dragging) return;
    const dx = event.clientX - this.lastPointerX;
    const dy = event.clientY - this.lastPointerY;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.orbitYaw -= dx * 0.005;
    this.orbitPitch = THREE.MathUtils.clamp(
      this.orbitPitch + dy * 0.005,
      0.08,
      1.45,
    );
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.orbitDistance = THREE.MathUtils.clamp(
      this.orbitDistance * Math.exp(event.deltaY * 0.001),
      0.4,
      100,
    );
  }

  private assetUrl(path: string): string {
    if (/^https?:\/\//i.test(path) || path.startsWith("data:")) return path;
    if (path.startsWith("/")) return new URL(path, window.location.origin).href;
    const base = new URL(import.meta.env.BASE_URL, window.location.origin);
    return new URL(path, base).href;
  }

  private setStatus(message: string, state: "loading" | "ready" | "error"): void {
    const element = document.getElementById("lodStatus");
    if (element) {
      element.textContent = message;
      element.dataset.state = state;
    }
  }

  private isMobile(): boolean {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }
}

export function toPlayCanvasPosition(value: Vec3): PcVec3 {
  return new PcVec3(value.x, value.z, -value.y);
}

function toPlayCanvasDirection(value: Vec3): PcVec3 {
  return new PcVec3(value.x, value.z, -value.y).normalize();
}

export function toPlayCanvasRotation(value: Quaternion): Quat {
  const source = new Quat(value.x, value.y, value.z, value.w);
  return new Quat()
    .mul2(Z_UP_TO_Y_UP, source)
    .mul(Z_UP_TO_Y_UP_INVERSE);
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function rotateVector(vector: Vec3, quaternion: Quaternion): Vec3 {
  const q = new THREE.Quaternion(
    quaternion.x,
    quaternion.y,
    quaternion.z,
    quaternion.w,
  );
  const result = new THREE.Vector3(vector.x, vector.y, vector.z).applyQuaternion(q);
  return { x: result.x, y: result.y, z: result.z };
}
