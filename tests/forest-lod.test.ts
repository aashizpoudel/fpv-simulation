import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { thinLeafCards, VegetationLod } from "../src/renderers/three/forest/vegetation-lod";

function leaves(cards = 12) {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < cards; i++) {
    const v = i * 4;
    positions.push(i, 0, 0, i, 1, 0, i + 1, 1, 0, i + 1, 0, 0);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  return geometry;
}

describe("forest vegetation LOD", () => {
  it("invalidates cached shadows only when visible casters change", () => {
    const root = new THREE.Group();
    const lod = new VegetationLod(root);
    const source = new THREE.CylinderGeometry();
    const far = new THREE.BoxGeometry();
    const material = new THREE.MeshStandardMaterial();
    lod.add(source, material, [{ x: 0, y: 0, z: 0, s: 1 }], { farGeometry: far });
    const camera = new THREE.PerspectiveCamera();
    expect(lod.update(camera)).toBe(true);
    expect(lod.update(camera)).toBe(false);
    camera.position.x = 50;
    expect(lod.update(camera)).toBe(true);
    expect(lod.update(camera)).toBe(false);
    camera.position.x = 300;
    expect(lod.update(camera)).toBe(true);
    expect(lod.update(camera)).toBe(false);
    camera.position.x = 0;
    expect(lod.update(camera)).toBe(true);
    lod.setQuality("performance");
    expect(lod.update(camera)).toBe(true);
    expect(lod.update(camera)).toBe(false);
    lod.setQuality("detail");
    expect(lod.update(camera)).toBe(true);
    lod.dispose();
    (root.children[0] as THREE.InstancedMesh).dispose();
    source.dispose(); far.dispose(); material.dispose();
  });

  it("retains complete cards with valid UVs and fewer triangles", () => {
    const source = leaves(13);
    const reduced = thinLeafCards(source, 6);
    expect(reduced.index!.count).toBe(18);
    expect(reduced.getAttribute("position").count).toBe(12);
    expect(reduced.getAttribute("uv").count).toBe(12);
    expect(Math.max(...reduced.index!.array)).toBeLessThan(12);
    expect(Array.from(reduced.getAttribute("position").array).every(Number.isFinite)).toBe(true);
    source.dispose(); reduced.dispose();
  });

  it("uses Z-up camera coordinates and restores close trees when returning", () => {
    const root = new THREE.Group();
    root.rotation.x = Math.PI / 2;
    root.scale.setScalar(2);
    const source = leaves();
    const material = new THREE.MeshStandardMaterial();
    const lod = new VegetationLod(root);
    lod.add(source, material, [{ x: 0, y: 0, z: 40, s: 1 }], { foliage: true });
    const mesh = root.children[0] as THREE.InstancedMesh;
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, -80, 2);
    lod.update(camera);
    expect(mesh.geometry).toBe(source);
    expect(mesh.visible).toBe(true);
    camera.position.set(300, -80, 2);
    lod.update(camera);
    expect(mesh.visible).toBe(false);
    camera.position.set(0, -80, 2);
    lod.setQuality("performance");
    lod.update(camera);
    expect(mesh.visible).toBe(true);
    expect(mesh.geometry.index!.count).toBeLessThan(source.index!.count);
    expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(mesh.count).toBe(1);
    lod.setQuality("detail"); lod.update(camera);
    expect(mesh.geometry).toBe(source);
    expect(mesh.material).toBe(material);
    lod.dispose(); mesh.dispose(); material.dispose(); source.dispose();
  });

  it("reduces decorative cover density without removing tree instances", () => {
    const root = new THREE.Group();
    const lod = new VegetationLod(root);
    const geometry = new THREE.PlaneGeometry();
    const material = new THREE.MeshBasicMaterial();
    const list = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0, z: 0, s: 1 }));
    lod.add(geometry, material, list, { undergrowth: true });
    lod.add(geometry, material, list);
    lod.setQuality("performance"); lod.update(new THREE.PerspectiveCamera());
    const [grass, trees] = root.children as THREE.InstancedMesh[];
    expect(grass.count).toBe(3);
    expect(trees.count).toBe(10);
    lod.setQuality("detail"); lod.update(new THREE.PerspectiveCamera());
    expect(grass.count).toBe(10);
    lod.dispose(); grass.dispose(); trees.dispose(); geometry.dispose(); material.dispose();
  });
});
