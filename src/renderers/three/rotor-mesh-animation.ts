import * as THREE from "three";
import type { RotorAnimation } from "../rotor-animation";

export class RotorMeshAnimation {
  private readonly bindings;

  constructor(model: THREE.Object3D, animation: RotorAnimation) {
    this.bindings = animation.rotors.map((rotor) => {
      const spin = model.getObjectByName(`motor-${rotor.name}`);
      const blur = model.getObjectByName(`blur-${rotor.name}`) as THREE.Mesh | undefined;
      const blades: THREE.Mesh[] = [];
      model.getObjectByName(`blades-${rotor.name}`)?.traverse((object) => {
        if (object instanceof THREE.Mesh) blades.push(object);
      });
      return { rotor, spin, blur, blades };
    });
    this.update();
  }

  update(): void {
    for (const { rotor, spin, blur, blades } of this.bindings) {
      if (spin) spin.rotation.y = rotor.angle;
      if (blur) {
        blur.visible = rotor.blur > 0;
        const material = blur.material as THREE.MeshBasicMaterial;
        material.opacity = rotor.blur * 0.6;
        material.depthWrite = false;
        blur.renderOrder = 2;
      }
      for (const blade of blades) {
        const material = blade.material as THREE.MeshPhysicalMaterial;
        material.opacity = 0.88 * (1 - rotor.blur * 0.85);
        material.depthWrite = rotor.blur < 0.5;
        blade.castShadow = rotor.blur < 0.5;
      }
    }
  }
}
