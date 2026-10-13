import type * as THREE from "three";

export interface ForestEnvironment {
  root: THREE.Group;
  collision: THREE.Group;
  fog: THREE.FogExp2;
  background: THREE.Color;
  update(camera: THREE.Camera): void;
  setQuality(name: string): void;
  dispose(): void;
}
export function groundH(x: number, z: number): number;
export function createForest(renderer: THREE.WebGLRenderer): ForestEnvironment;
