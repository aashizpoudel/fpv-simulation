import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";

export interface HomeEnvironment {
  root: THREE.Group;
  /** Apply the sky and sun lighting. Call after `root` is in the scene. */
  apply(scene: THREE.Scene): void;
  /** Shift exposure between the rooms and the yard. `position` is Z-up. */
  update(position: THREE.Vector3): void;
  dispose(): void;
}

const MODELS = "maps/home/models_low";
const TEXTURES = "maps/home/textures_low";
const HDR = "maps/home/env/alps_field_2k.hdr";
const MODEL_FILES = ["house", "chair", "nightstand", "dresser", "wardrobe", "flashlight", "hanger", "door_wood", "door_metal"] as const;
/** Door leaf swing, fixed open. There is no control to close it. */
const DOOR_OPEN = Math.PI * 0.47;
/** Casement swing, fixed open. */
const WINDOW_OPEN = THREE.MathUtils.degToRad(80);
const SUN_DIR = new THREE.Vector3(0.599, 0.67, 0.438).normalize();
const ADAPT = { inside: { env: 0.3, exposure: 1.15 }, outside: { env: 1.0, exposure: 0.85 } };
const ROOMS: ReadonlyArray<readonly [string, number, number, number, number]> = [
  ["Kitchen", -6, -2, 0, 3],
  ["Bedroom", -6, -2, -6, 0],
  ["Bathroom", -6, -2, -9, -6],
  ["Living room", -2, 2, -3, 3],
  ["Balcony", -2, 2, -9, -3],
];

type Range = [number, number];
type Mat = THREE.MeshStandardMaterial;

function assetUrl(path: string): string {
  return new URL(path, new URL(import.meta.env.BASE_URL, location.origin)).href;
}

/** Low-quality house. Doors and windows are built open and stay open. */
export async function createHome(
  renderer: THREE.WebGLRenderer,
  status: (message: string, progress?: number) => void,
): Promise<HomeEnvironment> {
  const maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const manager = new THREE.LoadingManager();
  let assetsReady = false;
  manager.onLoad = () => { assetsReady = true; };
  manager.onProgress = (_url, done, total) => {
    status(`Loading house… ${Math.round(100 * done / total)}%`, done / total);
  };

  const gltfLoader = new GLTFLoader(manager);
  const texLoader = new THREE.TextureLoader(manager);
  const texCache = new Map<string, THREE.Texture>();
  const tex = (file: string, srgb = false) => {
    let map = texCache.get(file);
    if (!map) {
      map = texLoader.load(`${assetUrl(TEXTURES)}/${file}`);
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.anisotropy = maxAniso;
      if (srgb) map.colorSpace = THREE.SRGBColorSpace;
      texCache.set(file, map);
    }
    return map;
  };
  const pbr = (set: string, options: {
    texScale?: number; color?: number; normalScale?: number; roughness?: number; metalness?: number;
    colorMap?: boolean; metalMap?: boolean;
  } = {}) => {
    const { texScale = 1, color = 0xffffff, normalScale = 1, roughness = 1, metalness = 0, colorMap = true, metalMap = false } = options;
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    if (colorMap) material.map = tex(`${set}_color.jpg`, true);
    material.normalMap = tex(`${set}_normal.jpg`);
    material.normalScale.set(normalScale, normalScale);
    material.roughnessMap = tex(`${set}_rough.jpg`);
    if (metalMap) {
      material.metalnessMap = tex(`${set}_metal.jpg`);
      material.metalness = 1;
    }
    material.userData.texScale = texScale;
    return material;
  };
  const plain = (color: number, roughness = 0.8, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

  const M = {
    woodDark: pbr("Wood063", { texScale: 1.2 }),
    woodMid: pbr("Wood059", { texScale: 1.0 }),
    woodBrown: pbr("Wood051", { texScale: 1.0 }),
    painted: pbr("PaintedWood008C", { texScale: 1.0, color: 0xf2efe8 }),
    concrete: pbr("Concrete046", { texScale: 1.0 }),
    carpet: pbr("Carpet009", { texScale: 1.0, color: 0xc9b9a4 }),
    sofa: pbr("Fabric029", { texScale: 0.6, colorMap: false, color: 0x55687c }),
    blanket: pbr("Fabric029", { texScale: 0.5, colorMap: false, color: 0x8a4b3c }),
    towelW: pbr("Fabric029", { texScale: 0.3, colorMap: false, color: 0xeeeeee }),
    towelB: pbr("Fabric029", { texScale: 0.3, colorMap: false, color: 0x4f7fa8 }),
    linen: pbr("Fabric029", { texScale: 0.5, colorMap: false, color: 0xe9e5dc, normalScale: 0.5 }),
    rust: pbr("Metal047B", { texScale: 1.0, metalMap: true }),
    ceramic: plain(0xf7f7f5, 0.12),
    chrome: plain(0xdddddd, 0.12, 1.0),
    steel: plain(0xb8bcc0, 0.35, 1.0),
    blackMetal: plain(0x222222, 0.45, 0.6),
    blackGlass: plain(0x0a0a0a, 0.08, 0.2),
    white: plain(0xf0f0ee, 0.5),
    fridge: plain(0xe9eaea, 0.3, 0.1),
    pot: plain(0xa9583a, 0.9),
    soil: plain(0x3b2a1e, 1.0),
    leaf: plain(0x3f7a35, 0.6, 0, { side: THREE.DoubleSide }),
    leaf2: plain(0x5c9a3e, 0.6, 0, { side: THREE.DoubleSide }),
    shade: plain(0xf4ead6, 0.9, 0, { side: THREE.DoubleSide, emissive: 0xffd9a0, emissiveIntensity: 0.35 }),
    bulb: plain(0xffffff, 0.3, 0, { emissive: 0xffe2b0, emissiveIntensity: 6 }),
    water: plain(0x9ec9d6, 0.05, 0.1, { transparent: true, opacity: 0.6 }),
  };

  const root = new THREE.Group();
  root.name = "home";
  const deco = new THREE.Group();
  root.add(deco);

  const boxGeo = (w: number, h: number, d: number, ts?: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ts) {
      const uv = g.attributes.uv;
      const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
      for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
        const k = f * 4 + i;
        uv.setXY(k, uv.getX(k) * dims[f][0] / ts, uv.getY(k) * dims[f][1] / ts);
      }
    }
    return g;
  };
  const shadowed = (mesh: THREE.Mesh, cast = true) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    return mesh;
  };
  const bx = (parent: THREE.Object3D, mat: Mat, [x0, x1]: Range, [y0, y1]: Range, [z0, z1]: Range) => {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    const mesh = new THREE.Mesh(boxGeo(w, h, d, mat.userData.texScale as number | undefined), mat);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    parent.add(shadowed(mesh));
    return mesh;
  };
  const cyl = (parent: THREE.Object3D, mat: Mat, rTop: number, rBot: number, h: number, x: number, y: number, z: number, seg = 24, open = false) => {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
    const ts = mat.userData.texScale as number | undefined;
    if (ts) {
      const uv = g.attributes.uv;
      const c = 2 * Math.PI * Math.max(rTop, rBot);
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * c / ts, uv.getY(i) * h / ts);
    }
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(x, y + h / 2, z);
    parent.add(shadowed(mesh));
    return mesh;
  };
  const ellipsoid = (parent: THREE.Object3D, mat: Mat, rx: number, ry: number, rz: number, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
    mesh.scale.set(rx, ry, rz);
    mesh.position.set(x, y, z);
    parent.add(shadowed(mesh));
    return mesh;
  };
  const rng = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const canvasTex = (w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available.");
    draw(ctx, w, h);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = maxAniso;
    return map;
  };
  const landscape = (ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, palette: string[]) => {
    const r = rng(seed);
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, palette[0]);
    sky.addColorStop(1, palette[1]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = palette[4];
    ctx.beginPath();
    ctx.arc(w * (0.2 + 0.6 * r()), h * 0.3, h * 0.09, 0, 7);
    ctx.fill();
    for (let layer = 0; layer < 3; layer++) {
      ctx.fillStyle = palette[2 + (layer % 2)];
      ctx.globalAlpha = 0.55 + 0.2 * layer;
      ctx.beginPath();
      ctx.moveTo(0, h);
      let y = h * (0.45 + 0.12 * layer);
      for (let x = 0; x <= w; x += w / 12) {
        y += (r() - 0.5) * h * 0.12;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  const ceilingLamp = (x: number, z: number, drop = 0.35, intensity = 14) => {
    const g = new THREE.Group();
    const yb = 3 - drop;
    cyl(g, M.white, 0.07, 0.07, 0.03, x, 2.97, z).castShadow = false;
    cyl(g, M.blackMetal, 0.006, 0.006, drop - 0.1, x, yb + 0.1, z, 8).castShadow = false;
    const shade = cyl(g, M.shade, 0.07, 0.22, 0.2, x, yb - 0.08, z, 32, true);
    shade.castShadow = false;
    ellipsoid(g, M.bulb, 0.05, 0.05, 0.05, x, yb - 0.04, z).castShadow = false;
    const light = new THREE.PointLight(0xffd8a8, intensity, 5.5, 2);
    light.position.set(x, yb - 0.1, z);
    g.add(light);
    root.add(g);
  };

  const plant = (x: number, z: number, s = 1) => {
    cyl(deco, M.pot, 0.16 * s, 0.12 * s, 0.32 * s, x, 0, z, 24);
    cyl(deco, M.soil, 0.15 * s, 0.15 * s, 0.01, x, 0.3 * s, z, 24);
    const r = rng(Math.floor(x * 100 + z * 1000) & 0xffff || 5);
    for (let i = 0; i < 11; i++) {
      const a = i / 11 * Math.PI * 2 + r();
      const tilt = 0.3 + r() * 0.6;
      const len = (0.35 + r() * 0.3) * s;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), i % 2 ? M.leaf : M.leaf2);
      leaf.scale.set(0.05 * s, len / 2, 0.012 * s);
      const g = new THREE.Group();
      g.position.set(x, 0.3 * s, z);
      g.rotation.set(0, a, tilt);
      leaf.position.y = len / 2;
      g.add(shadowed(leaf));
      deco.add(g);
    }
  };

  const buildBedroom = () => {
    const z0 = -3.85, z1 = -2.15, xh = -5.96, xf = -3.86;
    bx(deco, M.woodDark, [xh, xh + 0.08], [0, 1.15], [z0 - 0.05, z1 + 0.05]);
    for (const [lx, lz] of [[xh + 0.1, z0 + 0.05], [xh + 0.1, z1 - 0.1], [xf - 0.1, z0 + 0.05], [xf - 0.1, z1 - 0.1]] as const)
      bx(deco, M.woodDark, [lx, lx + 0.06], [0, 0.12], [lz, lz + 0.06]);
    bx(deco, M.woodDark, [xh + 0.08, xf], [0.12, 0.34], [z0, z1]);
    bx(deco, M.linen, [xh + 0.12, xf - 0.04], [0.34, 0.56], [z0 + 0.04, z1 - 0.04]);
    bx(deco, M.blanket, [xh + 0.75, xf - 0.02], [0.555, 0.6], [z0, z1]);
    bx(deco, M.blanket, [xf - 0.03, xf], [0.3, 0.6], [z0, z1]);
    ellipsoid(deco, M.linen, 0.17, 0.07, 0.3, xh + 0.35, 0.64, -3.45);
    ellipsoid(deco, M.linen, 0.17, 0.07, 0.3, xh + 0.35, 0.64, -2.55);
    const art = canvasTex(512, 300, (c, w, h) => landscape(c, w, h, 7, ["#f2b880", "#f7e3c4", "#5a6b7f", "#2f3d4f", "#fff2d0"]));
    bx(deco, M.woodDark, [-5.98, -5.95], [1.42, 2.08], [-3.53, -2.47]);
    const painting = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.6), plain(0xffffff, 0.7, 0, { map: art }));
    painting.position.set(-5.948, 1.75, -3.0);
    painting.rotation.y = Math.PI / 2;
    deco.add(painting);
    cyl(deco, M.ceramic, 0.06, 0.08, 0.2, -5.7, 0.55, -1.7);
    cyl(deco, M.shade, 0.09, 0.14, 0.18, -5.7, 0.75, -1.7, 32, true).castShadow = false;
    bx(deco, M.woodBrown, [-2.66, -2.04], [0.72, 0.76], [-5.05, -3.75]);
    for (const [lx, lz] of [[-2.63, -5.02], [-2.63, -3.81], [-2.1, -5.02], [-2.1, -3.81]] as const)
      bx(deco, M.blackMetal, [lx, lx + 0.03], [0, 0.72], [lz, lz + 0.03]);
    const scr = canvasTex(512, 300, (c, w, h) => landscape(c, w, h, 21, ["#16324f", "#3d6e94", "#1b2a3a", "#0e1824", "#cfe8ff"]));
    bx(deco, M.blackMetal, [-2.2, -2.12], [0.76, 0.77], [-4.5, -4.3]);
    bx(deco, M.blackMetal, [-2.18, -2.15], [0.77, 0.98], [-4.42, -4.38]);
    bx(deco, M.blackGlass, [-2.2, -2.17], [0.95, 1.29], [-4.7, -4.1]);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.57, 0.31), plain(0x000000, 0.3, 0, { emissive: 0xffffff, emissiveMap: scr, emissiveIntensity: 0.9 }));
    screen.position.set(-2.169, 1.12, -4.4);
    screen.rotation.y = -Math.PI / 2;
    deco.add(screen);
    bx(deco, M.blackMetal, [-2.5, -2.36], [0.76, 0.78], [-4.62, -4.18]);
    ceilingLamp(-4.0, -3.0);
  };

  const buildBathroom = () => {
    const x0 = -5.96, x1 = -4.26, z0 = -8.94, z1 = -8.19, t = 0.08, h = 0.55;
    bx(deco, M.ceramic, [x0, x1], [0, 0.08], [z0, z1]);
    bx(deco, M.ceramic, [x0, x1], [0, h], [z0, z0 + t]);
    bx(deco, M.ceramic, [x0, x1], [0, h], [z1 - t, z1]);
    bx(deco, M.ceramic, [x0, x0 + t], [0, h], [z0, z1]);
    bx(deco, M.ceramic, [x1 - t, x1], [0, h], [z0, z1]);
    const water = bx(deco, M.water, [x0 + t, x1 - t], [0.08, 0.4], [z0 + t, z1 - t]);
    water.castShadow = false;
    water.userData.noCollide = true;
    cyl(deco, M.chrome, 0.015, 0.015, 0.25, x0 + 0.04, h, -8.56, 12);
    bx(deco, M.chrome, [x0 + 0.03, x0 + 0.2], [h + 0.22, h + 0.25], [-8.58, -8.54]);
    cyl(deco, M.ceramic, 0.17, 0.13, 0.38, -2.42, 0, -8.45, 32);
    const seat = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 12, 32), M.ceramic);
    seat.rotation.x = Math.PI / 2;
    seat.position.set(-2.42, 0.4, -8.45);
    seat.scale.set(1.15, 1, 1);
    deco.add(shadowed(seat));
    bx(deco, M.ceramic, [-2.22, -2.04], [0.38, 0.8], [-8.67, -8.23]);
    bx(deco, M.chrome, [-2.16, -2.1], [0.8, 0.81], [-8.47, -8.43]);
    bx(deco, M.woodBrown, [-3.45, -2.55], [0.08, 0.8], [-6.5, -6.04]);
    bx(deco, M.ceramic, [-3.48, -2.52], [0.8, 0.84], [-6.53, -6.03]);
    ellipsoid(deco, M.ceramic, 0.22, 0.06, 0.15, -3.0, 0.87, -6.3);
    cyl(deco, M.chrome, 0.012, 0.012, 0.18, -3.0, 0.84, -6.1, 12);
    bx(deco, M.chrome, [-3.01, -2.99], [1.0, 1.02], [-6.2, -6.1]);
    bx(deco, M.chrome, [-3.43, -2.57], [1.12, 1.98], [-6.035, -6.02]);
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), plain(0xe8ecee, 0.06, 1.0));
    mirror.position.set(-3.0, 1.55, -6.017);
    mirror.userData.noCollide = true;
    deco.add(mirror);
    bx(deco, M.towelW, [-5.965, -5.93], [0.95, 1.52], [-7.12, -6.68]);
    bx(deco, M.towelB, [-5.965, -5.93], [0.95, 1.52], [-7.62, -7.18]);
    bx(deco, M.towelB, [-4.95, -4.25], [0, 0.012], [-8.12, -7.7]);
    ceilingLamp(-4.0, -7.5, 0.2, 9);
  };

  const buildKitchen = () => {
    bx(deco, M.painted, [-5.96, -5.38], [0.08, 0.86], [0.04, 2.94]);
    bx(deco, M.blackMetal, [-5.9, -5.42], [0, 0.08], [0.06, 2.92]);
    for (let i = 0; i < 5; i++) {
      const za = 0.06 + i * 0.576, zb = za + 0.566;
      bx(deco, M.painted, [-5.38, -5.36], [0.11, 0.83], [za, zb]);
      bx(deco, M.chrome, [-5.36, -5.34], [0.68, 0.7], [za + 0.2, zb - 0.2]);
    }
    bx(deco, M.concrete, [-5.97, -5.33], [0.86, 0.9], [0.03, 2.95]);
    bx(deco, M.steel, [-5.85, -5.45], [0.9, 0.902], [0.6, 1.2]);
    bx(deco, plain(0x2a2c2e, 0.4, 0.8), [-5.8, -5.5], [0.902, 0.904], [0.65, 1.15]);
    cyl(deco, M.chrome, 0.015, 0.015, 0.3, -5.9, 0.9, 0.9, 12);
    bx(deco, M.chrome, [-5.9, -5.72], [1.18, 1.21], [0.885, 0.915]);
    bx(deco, M.blackGlass, [-5.9, -5.4], [0.9, 0.91], [1.95, 2.55]);
    for (const [cx, cz] of [[-5.77, 2.1], [-5.77, 2.4], [-5.53, 2.1], [-5.53, 2.4]] as const) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.006, 6, 32), plain(0x555555, 0.5, 0.3));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(cx, 0.912, cz);
      deco.add(ring);
    }
    bx(deco, M.steel, [-5.97, -5.45], [1.6, 1.75], [1.95, 2.55]);
    bx(deco, M.steel, [-5.97, -5.75], [1.75, 2.95], [2.1, 2.4]);
    for (const [za, zb] of [[0.04, 1.9], [2.6, 2.94]] as const) {
      bx(deco, M.painted, [-5.97, -5.63], [1.5, 2.25], [za, zb]);
      const n = Math.max(1, Math.round((zb - za) / 0.6));
      for (let i = 0; i < n; i++) {
        const a = za + i * (zb - za) / n + 0.005, b = za + (i + 1) * (zb - za) / n - 0.005;
        bx(deco, M.painted, [-5.63, -5.61], [1.52, 2.23], [a, b]);
        bx(deco, M.chrome, [-5.61, -5.59], [1.55, 1.7], [b - 0.06, b - 0.04]);
      }
    }
    bx(deco, M.fridge, [-2.76, -2.06], [0, 1.85], [2.24, 2.94]);
    bx(deco, plain(0x9a9c9e, 0.3, 0.5), [-2.765, -2.755], [1.2, 1.21], [2.25, 2.93]);
    bx(deco, M.chrome, [-2.79, -2.77], [0.75, 1.15], [2.3, 2.33]);
    bx(deco, M.chrome, [-2.79, -2.77], [1.3, 1.6], [2.3, 2.33]);
    bx(deco, M.woodMid, [-4.7, -3.5], [0.72, 0.76], [1.1, 1.9]);
    for (const [lx, lz] of [[-4.65, 1.15], [-4.65, 1.8], [-3.6, 1.15], [-3.6, 1.8]] as const)
      bx(deco, M.woodMid, [lx, lx + 0.05], [0, 0.72], [lz, lz + 0.05]);
    cyl(deco, M.ceramic, 0.13, 0.07, 0.07, -4.1, 0.76, 1.5, 24);
    [0xd33a2c, 0xf2b630, 0x8bbf3a, 0xd33a2c, 0xf28a30].forEach((c, i) => {
      ellipsoid(deco, plain(c, 0.45), 0.04, 0.04, 0.04, -4.1 + 0.06 * Math.cos(i * 1.3), 0.84 + (i === 4 ? 0.04 : 0), 1.5 + 0.06 * Math.sin(i * 1.3));
    });
    ceilingLamp(-4.1, 1.5, 0.8, 12);
  };

  const buildLiving = () => {
    bx(deco, M.carpet, [-0.9, 1.0], [0, 0.012], [-1.3, 1.3]).castShadow = false;
    const sx0 = 1.06, sx1 = 1.96, sz0 = -1.1, sz1 = 1.1;
    for (const [lx, lz] of [[sx0 + 0.04, sz0 + 0.04], [sx0 + 0.04, sz1 - 0.08], [sx1 - 0.08, sz0 + 0.04], [sx1 - 0.08, sz1 - 0.08]] as const)
      bx(deco, M.woodDark, [lx, lx + 0.04], [0, 0.1], [lz, lz + 0.04]);
    bx(deco, M.sofa, [sx0, sx1], [0.1, 0.4], [sz0, sz1]);
    bx(deco, M.sofa, [sx1 - 0.22, sx1], [0.4, 0.92], [sz0, sz1]);
    bx(deco, M.sofa, [sx0, sx1], [0.4, 0.64], [sz0, sz0 + 0.18]);
    bx(deco, M.sofa, [sx0, sx1], [0.4, 0.64], [sz1 - 0.18, sz1]);
    bx(deco, M.sofa, [sx0 + 0.02, sx1 - 0.22], [0.4, 0.52], [sz0 + 0.19, -0.01]);
    bx(deco, M.sofa, [sx0 + 0.02, sx1 - 0.22], [0.4, 0.52], [0.01, sz1 - 0.19]);
    const pil = [M.blanket, M.linen];
    [-0.6, 0.6].forEach((pz, i) => {
      const pillow = bx(deco, pil[i], [sx1 - 0.34, sx1 - 0.22], [0.5, 0.86], [pz - 0.2, pz + 0.2]);
      pillow.rotation.z = 0.25;
    });
    bx(deco, M.woodMid, [-0.08, 0.5], [0.4, 0.44], [-0.5, 0.5]);
    for (const [lx, lz] of [[-0.05, -0.47], [-0.05, 0.44], [0.44, -0.47], [0.44, 0.44]] as const)
      bx(deco, M.blackMetal, [lx, lx + 0.03], [0, 0.4], [lz, lz + 0.03]);
    bx(deco, plain(0x8c2f2f, 0.7), [0.05, 0.27], [0.44, 0.47], [-0.3, 0]);
    bx(deco, plain(0x2f4f8c, 0.7), [0.07, 0.25], [0.47, 0.49], [-0.28, -0.04]);
    cyl(deco, M.ceramic, 0.04, 0.04, 0.09, 0.3, 0.44, 0.25, 20);
    bx(deco, M.woodDark, [-1.96, -1.56], [0.06, 0.5], [-0.85, 0.85]);
    bx(deco, M.blackMetal, [-1.9, -1.62], [0, 0.06], [-0.8, 0.8]);
    bx(deco, M.blackMetal, [-1.56, -1.555], [0.1, 0.46], [-0.02, 0.02]);
    const tvTex = canvasTex(1024, 576, (c, w, h) => landscape(c, w, h, 3, ["#7fb6e8", "#dff0ff", "#4c7a3a", "#2e5a2a", "#fff6c8"]));
    bx(deco, M.blackGlass, [-1.97, -1.93], [0.85, 1.57], [-0.64, 0.64]);
    const tv = new THREE.Mesh(new THREE.PlaneGeometry(1.24, 0.68), plain(0x000000, 0.2, 0, { emissive: 0xffffff, emissiveMap: tvTex, emissiveIntensity: 0.8 }));
    tv.position.set(-1.929, 1.21, 0);
    tv.rotation.y = Math.PI / 2;
    deco.add(tv);
    const bx0 = 0.3, bx1 = 1.5, bz0 = 2.6, bz1 = 2.94;
    bx(deco, M.woodBrown, [bx0, bx0 + 0.03], [0, 2.0], [bz0, bz1]);
    bx(deco, M.woodBrown, [bx1 - 0.03, bx1], [0, 2.0], [bz0, bz1]);
    bx(deco, M.woodBrown, [bx0, bx1], [0, 2.0], [bz1 - 0.01, bz1]);
    const r = rng(11);
    const colors = [0x7a2e2e, 0x2e4a7a, 0x2e7a4a, 0xc9a24a, 0x5a3e7a, 0x333333, 0xd8d0c0, 0x9a5a2a];
    for (let s = 0; s < 5; s++) {
      const y = s * 0.48;
      bx(deco, M.woodBrown, [bx0 + 0.03, bx1 - 0.03], [y, y + 0.03], [bz0, bz1 - 0.01]);
      if (s === 4) break;
      let x = bx0 + 0.05;
      while (x < bx1 - 0.12) {
        if (r() < 0.08) { x += 0.12; continue; }
        const thickness = 0.025 + r() * 0.03;
        const height = 0.2 + r() * 0.16;
        bx(deco, plain(colors[Math.floor(r() * colors.length)], 0.75), [x, x + thickness], [y + 0.03, y + 0.03 + height], [bz0 + 0.04 + r() * 0.03, bz1 - 0.03]);
        x += thickness + 0.003;
      }
    }
    bx(deco, M.woodBrown, [bx0 + 0.03, bx1 - 0.03], [1.97, 2.0], [bz0, bz1 - 0.01]);
    cyl(deco, M.blackMetal, 0.15, 0.15, 0.02, 1.62, 0, 1.5, 24);
    cyl(deco, M.blackMetal, 0.012, 0.012, 1.45, 1.62, 0.02, 1.5, 8);
    cyl(deco, M.shade, 0.14, 0.22, 0.28, 1.62, 1.42, 1.5, 32, true).castShadow = false;
    const art = canvasTex(512, 300, (c, w, h) => landscape(c, w, h, 42, ["#c9d6e3", "#f4efe6", "#7a8f6a", "#4f6a4a", "#ffffff"]));
    bx(deco, M.woodBrown, [1.95, 1.98], [1.35, 2.05], [-0.65, 0.65]);
    const painting = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.62), plain(0xffffff, 0.7, 0, { map: art }));
    painting.position.set(1.948, 1.7, 0);
    painting.rotation.y = -Math.PI / 2;
    deco.add(painting);
    plant(1.62, -2.6, 1.0);
    ceilingLamp(0, 0, 0.35, 18);
  };

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.18,
    side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.5,
  });
  const frameMat = plain(0xf1f1ee, 0.45);
  const curtainPanel = (parent: THREE.Object3D, mat: Mat, width: number, height: number, x0: number, yTop: number, z: number) => {
    const g = new THREE.PlaneGeometry(width, height, 24, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) / width + 0.5) * Math.PI * 7) * 0.025);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(x0 + width / 2, yTop - height / 2, z);
    parent.add(shadowed(mesh));
  };
  const buildWindow = (spec: { c: [number, number, number]; n: [number, number]; w: number; h: number; curtain?: number; fabric?: number }) => {
    const { c, n, w, h, curtain, fabric } = spec;
    const g = new THREE.Group();
    g.position.set(c[0], c[1], c[2]);
    g.rotation.y = Math.atan2(n[0], n[1]);
    const t = 0.05, zi = -0.06, zo = 0.07, hw = w / 2, hh = h / 2;
    bx(g, frameMat, [-hw, -hw + t], [-hh, hh], [zi, zo]);
    bx(g, frameMat, [hw - t, hw], [-hh, hh], [zi, zo]);
    bx(g, frameMat, [-hw, hw], [hh - t, hh], [zi, zo]);
    bx(g, frameMat, [-hw, hw], [-hh, -hh + t], [zi, zo]);
    bx(g, frameMat, [-hw - 0.07, hw + 0.07], [-hh - 0.03, -hh + t], [-0.2, zi]);
    bx(g, plain(0xbdbdb8, 0.7), [-hw - 0.04, hw + 0.04], [-hh - 0.04, -hh + 0.01], [zo, zo + 0.08]);
    const sw = (w - 2 * t) / 2, sh = h - 2 * t, bar = 0.04;
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * (hw - t), 0, zo - 0.01);
      pivot.rotation.y = side * WINDOW_OPEN;
      const xa = side < 0 ? 0 : -sw, xb = side < 0 ? sw : 0;
      bx(pivot, frameMat, [xa, xa + bar], [-sh / 2, sh / 2], [-0.02, 0.02]);
      bx(pivot, frameMat, [xb - bar, xb], [-sh / 2, sh / 2], [-0.02, 0.02]);
      bx(pivot, frameMat, [xa, xb], [sh / 2 - bar, sh / 2], [-0.02, 0.02]);
      bx(pivot, frameMat, [xa, xb], [-sh / 2, -sh / 2 + bar], [-0.02, 0.02]);
      bx(pivot, frameMat, [xa, xb], [-0.01, 0.01], [-0.015, 0.015]);
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(sw - 2 * bar, sh - 2 * bar), glassMat);
      pane.position.set((xa + xb) / 2, 0, 0);
      pane.castShadow = false;
      pane.userData.noCollide = true;
      pivot.add(pane);
      bx(pivot, M.chrome, side < 0 ? [xb - bar - 0.02, xb - bar] : [xa + bar, xa + bar + 0.02], [-0.06, 0.06], [-0.04, -0.02]);
      g.add(pivot);
    }
    if (curtain !== undefined && fabric !== undefined) {
      const rodY = hh + 0.22, zc = -0.14;
      const rod = cyl(g, M.blackMetal, 0.012, 0.012, w + 0.9, 0, 0, 0, 12);
      rod.rotation.z = Math.PI / 2;
      rod.position.set(0, rodY, zc);
      const mat = pbr("Fabric029", { texScale: 0.4, colorMap: false, color: fabric, normalScale: 0.6 });
      mat.side = THREE.DoubleSide;
      const top = rodY - 0.02;
      const height = top - (curtain - c[1]);
      curtainPanel(g, mat, 0.32, height, -hw - 0.36, top, zc - 0.03);
      curtainPanel(g, mat, 0.32, height, hw + 0.04, top, zc - 0.03);
    }
    deco.add(g);
  };

  const buildBalcony = () => {
    const rail = M.blackMetal;
    for (let z = -8.96; z <= -3.0; z += 0.74) bx(deco, rail, [1.93, 1.97], [0, 1.0], [z, z + 0.04]);
    for (let x = -1.96; x <= 1.97; x += 0.75) bx(deco, rail, [x, x + 0.04], [0, 1.0], [-8.97, -8.93]);
    for (const y of [0.95, 0.5, 0.1]) {
      bx(deco, rail, [1.93, 1.97], [y, y + 0.05], [-8.97, -3.04]);
      bx(deco, rail, [-1.98, 1.97], [y, y + 0.05], [-8.97, -8.93]);
    }
    cyl(deco, M.blackMetal, 0.25, 0.25, 0.02, 0.6, 0, -6.5, 24);
    cyl(deco, M.blackMetal, 0.02, 0.02, 0.7, 0.6, 0.02, -6.5, 8);
    cyl(deco, M.woodMid, 0.38, 0.38, 0.03, 0.6, 0.72, -6.5, 32);
    cyl(deco, M.ceramic, 0.04, 0.035, 0.09, 0.7, 0.75, -6.45, 20);
    plant(1.6, -8.6, 1.2);
    plant(-1.6, -8.6, 0.9);
    plant(1.6, -3.5, 0.8);
  };

  const stdCache = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  const toStandard = (m: THREE.MeshPhysicalMaterial) => {
    let s = stdCache.get(m);
    if (!s) {
      s = new THREE.MeshStandardMaterial();
      s.name = m.name;
      s.color.copy(m.color);
      s.map = m.map;
      s.normalMap = m.normalMap;
      s.normalScale.copy(m.normalScale);
      s.roughness = m.roughness;
      s.roughnessMap = m.roughnessMap;
      s.metalness = m.metalness;
      s.metalnessMap = m.metalnessMap;
      s.emissive.copy(m.emissive);
      s.emissiveMap = m.emissiveMap;
      s.emissiveIntensity = m.emissiveIntensity;
      s.aoMap = m.aoMap;
      s.alphaMap = m.alphaMap;
      s.transparent = m.transparent;
      s.opacity = m.opacity;
      s.side = m.side;
      s.alphaTest = m.alphaTest;
      stdCache.set(m, s);
    }
    return s;
  };
  const prepare = (src: THREE.Object3D, opts: { height?: number; fitX?: number; scale?: number }) => {
    const model = src.clone(true);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = opts.scale ?? (opts.height !== undefined ? opts.height / size.y : (opts.fitX ?? 1) / size.x);
    model.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
    const inner = new THREE.Group();
    inner.add(model);
    inner.scale.setScalar(s);
    const wrap = new THREE.Group();
    wrap.add(inner);
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      shadowed(o);
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      const next = materials.map((material) => material instanceof THREE.MeshPhysicalMaterial ? toStandard(material) : material);
      o.material = Array.isArray(o.material) ? next : next[0];
      for (const material of next) {
        for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap"] as const) {
          const map = material[key];
          if (map) map.anisotropy = maxAniso;
        }
      }
    });
    return wrap;
  };
  const front: Record<string, number> = { chair: Math.PI };
  const place = (models: Record<string, THREE.Object3D>, name: string, opts: { height?: number; fitX?: number; scale?: number; ry?: number }, [x, y, z]: [number, number, number], face?: [number, number]) => {
    const wrap = prepare(models[name], opts);
    wrap.position.set(x, y, z);
    if (face) wrap.rotation.y = Math.atan2(-face[1], face[0]) - (front[name] ?? 0);
    if (opts.ry !== undefined) wrap.rotation.y = opts.ry;
    root.add(wrap);
    return wrap;
  };
  const addDoor = (models: Record<string, THREE.Object3D>, name: string, pos: [number, number, number], ry: number, openSign: number) => {
    const wrap = place(models, name, { scale: 1, ry }, pos);
    const pivot = wrap.getObjectByName(name === "door_wood" ? "Sphere001" : "Empty");
    if (!pivot) throw new Error(`Open door pivot is missing on ${name}.`);
    pivot.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), openSign * DOOR_OPEN));
  };

  const hdr = await new HDRLoader(manager).loadAsync(assetUrl(HDR));
  const loaded = await Promise.all(MODEL_FILES.map((name) => gltfLoader.loadAsync(`${assetUrl(MODELS)}/${name}.glb`)));
  const models = Object.fromEntries(MODEL_FILES.map((name, i) => [name, loaded[i].scene])) as Record<string, THREE.Object3D>;

  const house = prepare(models.house, { scale: 1 });
  const authored = house.children[0]?.children[0];
  if (!authored) throw new Error("House model has no authored root.");
  authored.position.set(0, 0, 0);
  root.add(house);
  place(models, "nightstand", { height: 0.55 }, [-5.67, 0, -4.25], [1, 0]);
  place(models, "nightstand", { height: 0.55 }, [-5.67, 0, -1.75], [1, 0]);
  place(models, "flashlight", { height: 0.22 }, [-5.72, 0.55, -4.35]);
  place(models, "wardrobe", { height: 2.0 }, [-5.3, 0, -0.45], [0, -1]);
  place(models, "dresser", { height: 1.3 }, [-3.7, 0, -0.34], [0, -1]);
  place(models, "chair", { height: 0.95 }, [-3.0, 0, -4.4], [1, 0]);
  place(models, "chair", { height: 0.95 }, [-4.1, 0, 0.72], [0, 1]);
  place(models, "chair", { height: 0.95 }, [-4.1, 0, 2.28], [0, -1]);
  place(models, "chair", { height: 0.95 }, [-1.3, 0, -2.3], [1, 0.8]);
  place(models, "chair", { height: 0.95 }, [-0.6, 0, 2.3], [0.4, -1]);
  place(models, "hanger", { fitX: 0.14 }, [-5.91, 1.5, -6.9], [1, 0]);
  place(models, "hanger", { fitX: 0.14 }, [-5.91, 1.5, -7.4], [1, 0]);
  place(models, "chair", { height: 0.95 }, [0.6, 0, -7.3], [0, 1]);
  place(models, "chair", { height: 0.95 }, [0.6, 0, -5.7], [0, -1]);
  addDoor(models, "door_wood", [-2, 0, 1.5], Math.PI / 2, 1);
  addDoor(models, "door_wood", [-2, 0, -1.5], Math.PI / 2, -1);
  addDoor(models, "door_wood", [-4.5, 0, -6], 0, 1);
  addDoor(models, "door_metal", [0, 0, -3], 0, 1);
  buildBedroom();
  buildBathroom();
  buildKitchen();
  buildLiving();
  buildBalcony();
  for (const spec of [
    { c: [-4.0, 1.5, 2.98] as [number, number, number], n: [0, 1] as [number, number], w: 1.2, h: 1.2, curtain: 0.85, fabric: 0xd9cdb4 },
    { c: [-0.9, 1.5, 2.98] as [number, number, number], n: [0, 1] as [number, number], w: 1.2, h: 1.2, curtain: 0.05, fabric: 0xb7c4cf },
    { c: [2.0, 1.5, -2.0] as [number, number, number], n: [1, 0] as [number, number], w: 1.2, h: 1.2, curtain: 0.05, fabric: 0xb7c4cf },
    { c: [-6.0, 1.5, -5.1] as [number, number, number], n: [-1, 0] as [number, number], w: 1.2, h: 1.2, curtain: 0.75, fabric: 0x9a6a5a },
    { c: [-5.1, 1.7, -8.98] as [number, number, number], n: [0, -1] as [number, number], w: 1.0, h: 0.8 },
  ]) buildWindow(spec);

  const radius = 140;
  const tile = 2.5;
  const groundGeo = new THREE.CircleGeometry(radius, 96);
  groundGeo.rotateX(-Math.PI / 2);
  // Keep the 0–1 circle coordinates for the edge fade. The color map uses tiled coordinates.
  groundGeo.setAttribute("uv1", groundGeo.attributes.uv.clone());
  const uv = groundGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - 0.5) * 2 * radius / tile, (uv.getY(i) - 0.5) * 2 * radius / tile);
  const fade = document.createElement("canvas");
  fade.width = fade.height = 256;
  const fadeCtx = fade.getContext("2d");
  if (!fadeCtx) throw new Error("Canvas 2D is not available.");
  const gr = fadeCtx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, "#fff");
  gr.addColorStop(0.55, "#fff");
  gr.addColorStop(1, "#000");
  fadeCtx.fillStyle = gr;
  fadeCtx.fillRect(0, 0, 256, 256);
  const alpha = new THREE.CanvasTexture(fade);
  alpha.channel = 1;
  const grass = (file: string, srgb = false) => {
    const map = tex(file, srgb);
    return map;
  };
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({
    map: grass("Grass004_color.jpg", true),
    normalMap: grass("Grass004_normal.jpg"),
    roughnessMap: grass("Grass004_rough.jpg"),
    color: 0xc8d0b0,
    alphaMap: alpha,
    transparent: true,
  }));
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  ground.castShadow = false;
  ground.renderOrder = -1;
  root.add(ground);

  const sun = new THREE.DirectionalLight(0xfff2e0, 3.5);
  sun.target.position.set(-2, 0, -3);
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 70 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  root.add(sun, sun.target);

  if (!assetsReady) {
    await new Promise<void>((resolve, reject) => {
      manager.onLoad = () => resolve();
      manager.onError = (url) => reject(new Error(`Could not load ${url}`));
    });
  }
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  let envMap: THREE.Texture | undefined;
  let sceneRef: THREE.Scene | undefined;
  let last = 0;
  return {
    root,
    apply(scene) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      envMap = pmrem.fromEquirectangular(hdr).texture;
      pmrem.dispose();
      scene.background = hdr;
      scene.environment = envMap;
      scene.environmentIntensity = ADAPT.outside.env;
      scene.backgroundRotation.set(Math.PI / 2, 0, 0);
      scene.environmentRotation.set(Math.PI / 2, 0, 0);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = ADAPT.outside.exposure;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      sceneRef = scene;
    },
    update(position) {
      const scene = sceneRef;
      if (!scene) return;
      const now = performance.now();
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
      last = now;
      const x = position.x;
      const y = position.z;
      const z = -position.y;
      let outside = y > 3;
      if (!outside) {
        outside = true;
        for (const [, x0, x1, z0, z1] of ROOMS) {
          if (x > x0 && x < x1 && z > z0 && z < z1) { outside = false; break; }
        }
      }
      const target = outside || (x > -2 && x < 2 && z > -9 && z < -3) ? ADAPT.outside : ADAPT.inside;
      const k = 1 - Math.exp(-1.5 * dt);
      scene.environmentIntensity += (target.env - scene.environmentIntensity) * k;
      renderer.toneMappingExposure += (target.exposure - renderer.toneMappingExposure) * k;
    },
    dispose() {
      envMap?.dispose();
      hdr.dispose();
    },
  };
}
