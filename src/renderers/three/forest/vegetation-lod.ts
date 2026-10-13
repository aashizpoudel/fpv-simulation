import * as THREE from "three";

interface Placement {
  x: number; y: number; z: number; s: number;
  rx?: number; ry?: number; rz?: number;
}
interface BatchOptions {
  color?: (placement: any, index: number) => THREE.Color;
  cast?: boolean;
  foliage?: boolean;
  undergrowth?: boolean;
  farGeometry?: THREE.BufferGeometry;
}
interface Batch {
  mesh: THREE.InstancedMesh;
  source: THREE.BufferGeometry;
  medium: THREE.BufferGeometry;
  far: THREE.BufferGeometry;
  options: BatchOptions;
  material: THREE.Material;
  farMaterial: THREE.Material;
  count: number;
}

/** Sample whole leaf cards, expanding retained cards to keep canopy coverage. */
export function thinLeafCards(source: THREE.BufferGeometry, stride: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertices = source.getAttribute("position").count;
  const cards = Math.floor(vertices / 4);
  const retained = Math.ceil(cards / stride);
  const spread = Math.min(1.6, Math.sqrt(stride));
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const values = new Float32Array(retained * 4 * attribute.itemSize);
    let offset = 0;
    for (let card = 0; card < cards; card += stride) {
      for (let vertex = 0; vertex < 4; vertex++) {
        for (let component = 0; component < attribute.itemSize; component++) {
          const original = attribute.array[(card * 4 + vertex) * attribute.itemSize + component];
          if (name === "position") {
            let center = 0;
            for (let i = 0; i < 4; i++) center += attribute.array[(card * 4 + i) * attribute.itemSize + component] / 4;
            values[offset++] = center + (original - center) * spread;
          } else values[offset++] = original;
        }
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
  }
  const indices: number[] = [];
  for (let i = 0; i < retained; i++) {
    const v = i * 4;
    indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Small spatial batches allow the renderer to reject vegetation behind the pilot. */
export class VegetationLod {
  private batches: Batch[] = [];
  private generated = new Map<THREE.BufferGeometry, [THREE.BufferGeometry, THREE.BufferGeometry]>();
  private cheapMaterials = new Map<THREE.Material, THREE.Material>();
  private position = new THREE.Vector3();
  private quality = "balanced";

  constructor(private root: THREE.Group) {}

  add(geometry: THREE.BufferGeometry, material: THREE.Material, placements: Placement[], options: BatchOptions = {}): void {
    let medium = geometry;
    let far = options.farGeometry ?? geometry;
    if (options.foliage) {
      let levels = this.generated.get(geometry);
      if (!levels) {
        levels = [thinLeafCards(geometry, 2), thinLeafCards(geometry, 6)];
        this.generated.set(geometry, levels);
      }
      [medium, far] = levels;
    }
    let farMaterial = material;
    if (options.foliage) {
      farMaterial = this.cheapMaterials.get(material)!;
      if (!farMaterial) {
        const source = material as THREE.MeshStandardMaterial;
        farMaterial = new THREE.MeshBasicMaterial({
          map: source.map, alphaTest: source.alphaTest, side: source.side,
          vertexColors: true, color: 0xa0a994,
        });
        this.cheapMaterials.set(material, farMaterial);
      }
    }
    const chunks = new Map<string, Placement[]>();
    for (const placement of placements) {
      const key = `${Math.floor(placement.x / 24)},${Math.floor(placement.z / 24)}`;
      const list = chunks.get(key) ?? [];
      list.push(placement);
      chunks.set(key, list);
    }
    const dummy = new THREE.Object3D();
    for (const list of chunks.values()) {
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((placement, i) => {
        dummy.position.set(placement.x, placement.y, placement.z);
        dummy.rotation.set(placement.rx ?? 0, placement.ry ?? 0, placement.rz ?? 0);
        dummy.scale.setScalar(placement.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        if (options.color) mesh.setColorAt(i, options.color(placement, i));
      });
      mesh.computeBoundingSphere();
      // Retained leaf cards expand slightly; keep culling conservative for all LODs.
      if (options.foliage) mesh.boundingSphere!.radius += 3;
      mesh.receiveShadow = !options.undergrowth;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
      this.batches.push({ mesh, source: geometry, medium, far, options, material, farMaterial, count: list.length });
    }
  }

  setQuality(quality: string): void { this.quality = quality; }

  /** Returns whether the sun shadow map needs to be redrawn. */
  update(camera: THREE.Camera): boolean {
    this.root.updateWorldMatrix(true, false);
    this.root.worldToLocal(camera.getWorldPosition(this.position));
    const performance = this.quality === "performance";
    const detail = this.quality === "detail";
    let shadowsChanged = false;
    for (const batch of this.batches) {
      const { mesh, source, medium, far, options } = batch;
      const wasCaster = mesh.visible && mesh.castShadow;
      const previousGeometry = mesh.geometry;
      const previousCount = mesh.count;
      const center = mesh.boundingSphere!.center;
      // Use horizontal distance to avoid dropping ground cover when pitching up.
      const distance = Math.hypot(center.x - this.position.x, center.z - this.position.z);
      const radius = mesh.boundingSphere!.radius;
      const nearEdge = Math.max(0, distance - radius);
      const range = options.undergrowth ? (performance ? 16 : detail ? 48 : 28)
        : (performance ? 90 : detail ? 160 : 120);
      mesh.visible = nearEdge <= range;
      mesh.count = options.undergrowth
        ? Math.max(1, Math.ceil(batch.count * (performance ? 0.3 : detail ? 1 : 0.65))) : batch.count;
      mesh.geometry = options.foliage
        ? (distance < (performance ? 20 : detail ? 60 : 35) ? (performance ? medium : source) : far)
        : (options.farGeometry && distance > (detail ? 65 : 35) ? far : source);
      mesh.material = options.foliage && (performance || mesh.geometry === far)
        ? batch.farMaterial : batch.material;
      // Thin foliage shadow cards are expensive and unstable at a distance.
      mesh.castShadow = !performance && options.cast !== false && !options.undergrowth
        && (!options.foliage || (detail && distance < 60));
      const isCaster = mesh.visible && mesh.castShadow;
      if (wasCaster !== isCaster || (isCaster &&
          (previousGeometry !== mesh.geometry || previousCount !== mesh.count))) shadowsChanged = true;
    }
    return shadowsChanged;
  }

  dispose(): void {
    for (const batch of this.batches) {
      batch.mesh.geometry = batch.source;
      batch.mesh.material = batch.material;
    }
    for (const material of this.cheapMaterials.values()) material.dispose();
    this.cheapMaterials.clear();
    for (const levels of this.generated.values()) for (const geometry of levels) geometry.dispose();
    this.generated.clear();
  }
}
