import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { IRenderer } from "./renderer-interface";
import type { CameraMode, DronePose, Vec3 } from "../types";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export class ThreejsRenderer implements IRenderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private fpvCamera?: THREE.PerspectiveCamera;
  private activeCamera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private feedRenderer?: THREE.WebGLRenderer;
  private feedCanvas?: HTMLCanvasElement;
  private drone: THREE.Object3D;
  private container: HTMLElement;
  private orbitControls: OrbitControls;
  private skyDome?: THREE.Mesh;
  private orbitOffset = new THREE.Vector3();
  private hasOrbitOffset = false;
  private noseMarker?: THREE.Mesh;
  private feedMode: "auto" | "fpv" | "third" = "auto";

  public init(containerId: string, startPosition: Vec3): void {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Container with id ${containerId} not found`);
    }

    // Set up
    THREE.Object3D.DEFAULT_UP = new THREE.Vector3(0, 0, 1);
    THREE.Scene.DEFAULT_UP = new THREE.Vector3(0, 0, 1);
    THREE.Camera.DEFAULT_UP = new THREE.Vector3(0, 0, 1);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);

    // Background (sky dome with mountains + horizon)
    this.skyDome = this.createSkyDome();
    this.scene.add(this.skyDome);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(
      this.container.clientWidth,
      this.container.clientHeight,
    );
    this.container.appendChild(this.renderer.domElement);

    this.setFeedCanvas("cameraFeed");

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(100, 100, 100);
    this.scene.add(directionalLight);

    // Ground
    const groundGeometry = new THREE.PlaneGeometry(1000, 1000);
    const groundMaterial = this.createGroundMaterial();
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    // ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    // Drone
    const loader = new GLTFLoader();
    loader.load(
      "/drone_models/tinyhawk.gltf",
      (gltf) => {
        this.drone = gltf.scene;
        const mesh = gltf.scene.children[0]; // or scene.getObjectByName("xxx")
        if (!mesh) return;

        // 2. rotate ONLY the mesh (pure visual)
        mesh.rotateX(Math.PI / 2);
        mesh.rotateY(Math.PI / 2);

        // 1. make a camera
        const fpvCam = new THREE.PerspectiveCamera(
          75,
          this.container.clientWidth / this.container.clientHeight,
          0.01,
          1000,
        );

        // 2. place it where the real cam sits on the frame
        fpvCam.position.set(0.1, 0, 0); // 10 cm in front of body origin
        fpvCam.rotation.set(0, -Math.PI / 2, -Math.PI / 2); // look along +X in X-forward space
        // 3. glue it to the drone so it moves/rotates with it
        this.drone.add(fpvCam);
        this.fpvCamera = fpvCam;

        this.noseMarker = this.createNoseMarker();
        this.drone.add(this.noseMarker);

        this.scene.add(this.drone);
      },
      undefined,
      (error) => {
        console.error(error);
        // Fallback to a cube if model loading fails
        const droneGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.05);
        const droneMaterial = new THREE.MeshStandardMaterial({
          color: 0xff0000,
        });
        this.drone = new THREE.Mesh(droneGeometry, droneMaterial);
        this.noseMarker = this.createNoseMarker();
        this.drone.add(this.noseMarker);
        this.scene.add(this.drone);
      },
    );

    this.camera = new THREE.PerspectiveCamera(
      60,
      this.container.clientWidth / this.container.clientHeight,
      0.1,
      2000,
    );
    this.camera.position.set(1, 1, 1);
    this.camera.lookAt(0, 0, 0);
    this.activeCamera = this.camera;

    // after this.camera exists
    this.orbitControls = new OrbitControls(
      this.camera,
      this.renderer.domElement,
    );
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.05;
    this.orbitControls.target.set(0, 0, 0); // look slightly above ground

    window.addEventListener("resize", this.onWindowResize.bind(this));
  }

  private onWindowResize(): void {
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

  public update(pose: DronePose, cameraMode: CameraMode): void {
    if (!this.drone) {
      return;
    }

    this.drone.position.set(
      pose.localPosition.x,
      pose.localPosition.y,
      pose.localPosition.z,
    );

    this.drone.quaternion.set(
      pose.localOrientation.x,
      pose.localOrientation.y,
      pose.localOrientation.z,
      pose.localOrientation.w,
    );

    // Update camera
    this.updateCamera(pose, cameraMode);

    this.renderer.render(this.scene, this.activeCamera);
    this.renderFeed(cameraMode);
  }

  public setFeedCanvas(canvasId: string | null): void {
    if (!canvasId) {
      this.feedRenderer?.dispose();
      this.feedRenderer = undefined;
      this.feedCanvas = undefined;
      return;
    }

    const canvas = document.getElementById(
      canvasId,
    ) as HTMLCanvasElement | null;
    if (!canvas) {
      this.feedRenderer?.dispose();
      this.feedRenderer = undefined;
      this.feedCanvas = undefined;
      return;
    }

    this.feedCanvas = canvas;
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

  private updateCamera(pose: DronePose, cameraMode: CameraMode): void {
    const dronePosition = new THREE.Vector3(
      pose.localPosition.x,
      pose.localPosition.y,
      pose.localPosition.z,
    );

    if (cameraMode === "orbit") {
      this.activeCamera = this.camera;
      this.orbitControls.enabled = true;
      if (!this.hasOrbitOffset) {
        const orbitOffset = new THREE.Vector3(-2.5, 0, 1.2)
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
    const chaseOffset = new THREE.Vector3(-2, 0, 1.2).applyQuaternion(
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
    const rect = this.feedCanvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.feedRenderer.setSize(rect.width, rect.height, false);
  }

  private renderFeed(cameraMode: CameraMode): void {
    if (!this.feedRenderer || !this.feedCanvas) return;
    const rect = this.feedCanvas.getBoundingClientRect();
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
    return new THREE.Mesh(geometry, material);
  }

  private createGroundMaterial(): THREE.MeshStandardMaterial {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return new THREE.MeshStandardMaterial({
        color: 0x3a7d3a,
        side: THREE.DoubleSide,
      });
    }

    // Base grass color
    ctx.fillStyle = "#3f8a3a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Speckle noise for grass texture
    for (let i = 0; i < 20000; i += 1) {
      const x = Math.floor(Math.random() * canvas.width);
      const y = Math.floor(Math.random() * canvas.height);
      const shade = 120 + Math.floor(Math.random() * 60);
      ctx.fillStyle = `rgb(40, ${shade}, 40)`;
      ctx.fillRect(x, y, 1, 1);
    }

    // Subtle ground grid for depth cues
    ctx.strokeStyle = "rgba(20, 60, 20, 0.25)";
    ctx.lineWidth = 1;
    const grid = 32;
    for (let i = 0; i <= canvas.width; i += grid) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, canvas.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(canvas.width, i);
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(20, 20);

    return new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
    });
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
