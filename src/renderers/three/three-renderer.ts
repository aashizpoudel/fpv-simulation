import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CameraMode, DroneTelemetry, Vec3 } from "../../types";
import type { DroneConfig } from "../../config/tinyhawk-config";
import type { IRenderer } from "../renderer-interface";

export class ThreejsRenderer implements IRenderer {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private fpvCamera?: THREE.PerspectiveCamera;
  private activeCamera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private feedRenderer?: THREE.WebGLRenderer;
  private feedCanvas?: HTMLCanvasElement;
  private feedContainer?: HTMLElement;
  private drone?: THREE.Object3D;
  private container!: HTMLElement;
  private orbitControls!: OrbitControls;
  private skyDome!: THREE.Mesh;
  private orbitOffset = new THREE.Vector3();
  private hasOrbitOffset = false;
  private noseMarker?: THREE.Mesh;
  private feedMode: "auto" | "fpv" | "third" = "auto";
  private droneConfig?: DroneConfig;
  private map?: THREE.Object3D;
  private resizeHandler = () => this.resize();

  constructor() {}

  public async init(container: HTMLElement, startPosition?: Vec3): Promise<void> {
    this.container = container;

    // Set Z-up coordinate convention (X forward, Y sideways, Z up)
    THREE.Object3D.DEFAULT_UP = new THREE.Vector3(0, 0, 1);
    // Note: Scene and Camera inherit from Object3D, so DEFAULT_UP covers them.

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);

    // Background (sky dome with mountains + horizon)
    this.skyDome = this.createSkyDome();

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(
      this.container.clientWidth,
      this.container.clientHeight,
    );

    //camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      this.container.clientWidth / this.container.clientHeight,
      0.1,
      2000,
    );
    this.camera.position.set(1, 1, 1); // Z-up: (X, Y, Z=height)
    this.camera.up.set(0, 0, 1); // ensure camera up matches Z-up convention
    this.activeCamera = this.camera;

    // after this.camera exists
    this.orbitControls = new OrbitControls(
      this.camera,
      this.renderer.domElement,
    );
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.05;
    this.orbitControls.target.set(0, 0, 0);
    this.orbitControls.maxPolarAngle = Math.PI / 2 - 0.05; // Prevent going below ground
    this.orbitControls.minDistance = 0.5;
    this.orbitControls.maxDistance = 50;

    this.scene.add(this.skyDome);

    this.container.appendChild(this.renderer.domElement);

    this.setFeedCanvas("cameraFeed");

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(100, 100, 100);
    this.scene.add(directionalLight);

    // Drone
    const loader = new GLTFLoader();
    const initialPosition = startPosition ?? { x: 0, y: 0, z: 0 };
    loader.load(
      "maps/de_dust_2_with_real_light.glb",
      (gltf) => {
        this.map = gltf.scene;
        // GLB/GLTF models are authored in Y-up; rotate to Z-up convention
        this.map.rotation.x = Math.PI / 2;
        this.scene.add(this.map);
      },
      undefined,
      (error) => console.error(error),
    );

    if (this.droneConfig) {
      loader.load(
        this.droneConfig?.modelUrl ?? "drone_models/tinyhawk.gltf",
        (gltf) => {
          // Create a wrapper group for physics transforms.
          // Physics sets position/quaternion on this.drone (the wrapper).
          // The actual model is a child with the Y-up → Z-up visual correction,
          // so the physics quaternion doesn't overwrite it.
          const wrapper = new THREE.Group();
          const model = gltf.scene;
          // GLB/GLTF models are authored in Y-up; rotate to Z-up convention
          model.rotation.x = Math.PI / 2;
          wrapper.add(model);
          this.drone = wrapper;

          // 1. make a camera
          const fpvCam = new THREE.PerspectiveCamera(
            75,
            this.container.clientWidth / this.container.clientHeight,
            0.01,
            1000,
          );

          // 2. place it where the real cam sits on the frame (X-forward, Z-up)
          fpvCam.position.set(this.getFpvOffsetX(), 0, 0);
          fpvCam.up.set(0, 0, 1);
          fpvCam.lookAt(new THREE.Vector3(1, 0, 0));
          // 3. glue it to the drone so it moves/rotates with it
          this.drone.add(fpvCam);
          this.fpvCamera = fpvCam;

          this.updateDroneSizeFromConfig();

          this.scene.add(this.drone);
          this.drone.position.set(
            initialPosition.x,
            initialPosition.y,
            initialPosition.z,
          );
        },
        undefined,
        (error) => {
          console.error(error);
          // Fallback: wrap a cube in a group so physics transforms work the same way
          const wrapper = new THREE.Group();
          const droneGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.05);
          const droneMaterial = new THREE.MeshStandardMaterial({
            color: 0xff0000,
          });
          const mesh = new THREE.Mesh(droneGeometry, droneMaterial);
          wrapper.add(mesh);
          this.drone = wrapper;
          this.updateDroneSizeFromConfig();
          this.noseMarker = this.createNoseMarker();
          this.drone.add(this.noseMarker);
          this.drone.position.set(
            initialPosition.x,
            initialPosition.y,
            initialPosition.z,
          );
          this.scene.add(this.drone);
        },
      );
    }

    window.addEventListener("resize", this.resizeHandler);
  }

  public resize(): void {
    if (this.camera && this.renderer) {
      this.camera.aspect =
        this.container.clientWidth / this.container.clientHeight;
      this.camera.updateProjectionMatrix();
      if (this.fpvCamera) {
        this.fpvCamera.aspect =
          this.container.clientWidth / this.container.clientHeight;
        this.fpvCamera.updateProjectionMatrix();
      }
      this.renderer.setSize(
        this.container.clientWidth,
        this.container.clientHeight,
      );
      this.updateFeedRendererSize();
    }
  }

  public render(frame: DroneTelemetry, cameraMode: CameraMode): void {
    if (!this.drone || !this.activeCamera || !this.renderer) {
      return;
    }

    // Update drone transform
    this.drone.position.set(
      frame.localPosition.x,
      frame.localPosition.y,
      frame.localPosition.z,
    );
    this.drone.quaternion.set(
      frame.localOrientation.x,
      frame.localOrientation.y,
      frame.localOrientation.z,
      frame.localOrientation.w,
    );

    // Render
    this.updateCamera(frame, cameraMode);
    this.renderer.render(this.scene, this.activeCamera);
    this.renderFeed(cameraMode);
  }

  public dispose(): void {
    window.removeEventListener("resize", this.resizeHandler);
    this.orbitControls?.dispose();
    this.feedRenderer?.dispose();
    this.feedRenderer = undefined;
    this.feedCanvas = undefined;
    this.feedContainer = undefined;

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
  }

  public setFeedCanvas(canvasId: string | null): void {
    if (!canvasId) {
      this.feedRenderer?.dispose();
      this.feedRenderer = undefined;
      this.feedCanvas = undefined;
      this.feedContainer = undefined;
      return;
    }

    const element = document.getElementById(canvasId);
    if (!element) {
      this.feedRenderer?.dispose();
      this.feedRenderer = undefined;
      this.feedCanvas = undefined;
      this.feedContainer = undefined;
      return;
    }

    if (element instanceof HTMLCanvasElement) {
      this.feedCanvas = element;
      this.feedContainer = element.parentElement ?? undefined;
    } else {
      this.feedContainer = element;
      let canvas = element.querySelector("canvas");
      if (!canvas) {
        canvas = document.createElement("canvas");
        element.innerHTML = "";
        element.appendChild(canvas);
      }
      this.feedCanvas = canvas as HTMLCanvasElement;
    }
    this.feedRenderer?.dispose();
    this.feedRenderer = new THREE.WebGLRenderer({
      antialias: true,
      canvas: this.feedCanvas,
    });
    this.updateFeedRendererSize();
  }

  public setFeedMode(mode: "auto" | "fpv" | "third"): void {
    this.feedMode = mode;
  }

  public setDroneConfig(config: DroneConfig): void {
    this.droneConfig = config;
    if (this.fpvCamera) {
      this.fpvCamera.position.set(this.getFpvOffsetX(), 0, 0);
    }
    this.hasOrbitOffset = false;
  }

  private updateCamera(pose: DroneTelemetry, cameraMode: CameraMode): void {
    if (!this.drone || !this.camera) {
      return
    }
    const dronePosition = new THREE.Vector3(
      pose.localPosition.x,
      pose.localPosition.y,
      pose.localPosition.z,
    );

    if (cameraMode === "orbit" && this.orbitControls) {
      this.activeCamera = this.camera;
      this.orbitControls.enabled = true;
      if (!this.hasOrbitOffset) {
        const { behind, height } = this.getCameraOffsets();
        const orbitOffset = new THREE.Vector3(-behind * 1.25, 0, height * 1.1)
          .applyQuaternion(this.drone.quaternion)
          .add(dronePosition);
        this.camera.position.copy(orbitOffset);
        this.orbitOffset.copy(
          new THREE.Vector3().subVectors(this.camera.position, dronePosition),
        );
        this.hasOrbitOffset = true;
      } else {
        const currentOffset = new THREE.Vector3().subVectors(
          this.camera.position,
          this.orbitControls.target,
        );
        this.orbitOffset.copy(currentOffset);
        this.camera.position.copy(
          new THREE.Vector3().addVectors(dronePosition, this.orbitOffset),
        );
      }
      this.orbitControls.target.copy(dronePosition);
      this.orbitControls.update(); // apply damping etc.
      const minHeight = 0.15;
      if (this.camera.position.z < minHeight) {
        this.camera.position.z = minHeight;
      }

      return; // early exit
    }

    // ----- non-orbit modes -----
    this.orbitControls.enabled = false;

    if (cameraMode === "fpv") {
      this.activeCamera = this.fpvCamera ?? this.camera;
      this.updateThirdPersonCamera(dronePosition);
      return;
    }

    if (cameraMode === "third") {
      this.activeCamera = this.camera;
      this.updateThirdPersonCamera(dronePosition);
    }
  }

  private updateThirdPersonCamera(dronePosition: THREE.Vector3): void {
    if (!this.drone || !this.camera) {
      return
    }

    const { behind, height } = this.getCameraOffsets();
    const chaseOffset = new THREE.Vector3(-behind, 0, height).applyQuaternion(
      this.drone.quaternion,
    );
    const desiredPosition = new THREE.Vector3().addVectors(
      dronePosition,
      chaseOffset,
    );
    this.camera.position.lerp(desiredPosition, 0.1);
    const lookAhead = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(this.drone.quaternion)
      .add(dronePosition);
    this.camera.lookAt(lookAhead);
  }

  private updateFeedRendererSize(): void {
    if (!this.feedRenderer || !this.feedCanvas) return;
    const rect = (
      this.feedContainer ?? this.feedCanvas
    ).getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.feedRenderer.setSize(rect.width, rect.height, false);
  }

  private renderFeed(cameraMode: CameraMode): void {
    if (!this.feedRenderer || !this.feedCanvas) return;
    const rect = (
      this.feedContainer ?? this.feedCanvas
    ).getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    let feedCamera: THREE.PerspectiveCamera;
    if (this.feedMode === "fpv") {
      feedCamera = this.fpvCamera ?? this.camera;
    } else if (this.feedMode === "third") {
      feedCamera = this.camera;
    } else {
      feedCamera =
        cameraMode === "fpv" ? this.camera : (this.fpvCamera ?? this.camera);
    }

    const previousAspect = feedCamera.aspect;
    feedCamera.aspect = rect.width / rect.height;
    feedCamera.updateProjectionMatrix();
    this.feedRenderer.render(this.scene, feedCamera);
    feedCamera.aspect = previousAspect;
    feedCamera.updateProjectionMatrix();
  }

  private getCameraOffsets(): { behind: number; height: number } {
    const base = this.droneConfig
      ? Math.max(
        this.droneConfig.length,
        this.droneConfig.width,
        this.droneConfig.height,
      )
      : 0.12;
    return {
      behind: Math.max(base * 6, 0.9),
      height: Math.max(base * 3, 0.5),
    };
  }

  private getFpvOffsetX(): number {
    const base = this.droneConfig
      ? Math.max(
        this.droneConfig.length,
        this.droneConfig.width,
        this.droneConfig.height,
      )
      : 0.12;
    return base * 0.5;
  }

  private updateDroneSizeFromConfig(): void {
    if (!this.droneConfig) return;
    if (this.fpvCamera) {
      this.fpvCamera.position.set(this.getFpvOffsetX(), 0, 0);
    }
  }

  private createSkyDome(): THREE.Mesh {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return new THREE.Mesh();
    }

    // Sky gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#6fb3ff");
    gradient.addColorStop(0.55, "#9ed0ff");
    gradient.addColorStop(0.7, "#cde8ff");
    gradient.addColorStop(1, "#e8f6ff");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Horizon haze band
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.fillRect(0, canvas.height * 0.62, canvas.width, canvas.height * 0.08);

    // Layered mountain silhouettes
    const layers = [
      { color: "#4a6d5a", height: 0.62, amplitude: 0.09 },
      { color: "#3b5a4b", height: 0.68, amplitude: 0.12 },
      { color: "#2c463c", height: 0.75, amplitude: 0.16 },
    ];

    layers.forEach((layer, index) => {
      ctx.beginPath();
      ctx.moveTo(0, canvas.height);
      for (let x = 0; x <= canvas.width; x += 8) {
        const t = x / canvas.width;
        const noise =
          Math.sin((t + index) * 6.5) * 0.5 +
          Math.sin((t + index * 1.3) * 12.1) * 0.3 +
          Math.sin((t + index * 0.7) * 21.3) * 0.2;
        const y =
          canvas.height * layer.height -
          noise * canvas.height * layer.amplitude;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(canvas.width, canvas.height);
      ctx.closePath();
      ctx.fillStyle = layer.color;
      ctx.fill();
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const geometry = new THREE.SphereGeometry(500, 48, 24);
    const mesh = new THREE.Mesh(geometry, material);
    // Rotate sky dome from default Y-up orientation to Z-up
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  }

  private createNoseMarker(): THREE.Mesh {
    const radius = 0.03;
    const length = 0.08;
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 3);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffcc00,
      roughness: 0.6,
      metalness: 0.1,
    });
    const marker = new THREE.Mesh(geometry, material);
    marker.rotation.z = Math.PI / 2; // align cylinder axis with +X
    marker.position.set(0.4, 0, 0);
    return marker;
  }
}
