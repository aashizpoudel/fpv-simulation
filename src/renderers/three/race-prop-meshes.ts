import * as THREE from "three";
import type { RaceProp } from "../../race/race-props";

export function createRacePropMeshes(props: RaceProp[]): THREE.Group {
  const root = new THREE.Group();
  root.name = "Freestyle race props";
  for (const prop of props) {
    const group = new THREE.Group();
    group.position.set(prop.position.x, prop.position.y, prop.position.z);
    group.rotation.z = prop.yaw;
    const material = new THREE.MeshBasicMaterial({ color: prop.kind === "gate" ? 0xff8040 : 0x24dfff });
    const thickness = 0.12;
    if (prop.kind === "hoop") {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(prop.radius + thickness / 2, thickness / 2, 8, 48), material);
      hoop.rotation.y = Math.PI / 2;
      group.add(hoop);
    } else {
      for (const sign of [-1, 1]) {
        const vertical = new THREE.Mesh(new THREE.BoxGeometry(thickness, thickness, 2 * prop.radius + 2 * thickness), material);
        vertical.position.y = sign * (prop.radius + thickness / 2);
        const horizontal = new THREE.Mesh(new THREE.BoxGeometry(thickness, 2 * prop.radius, thickness), material);
        horizontal.position.z = sign * (prop.radius + thickness / 2);
        group.add(vertical, horizontal);
      }
    }
    root.add(group);
  }
  root.updateMatrixWorld(true);
  return root;
}
