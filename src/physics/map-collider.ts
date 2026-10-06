import * as THREE from "three";

export function meshToTrimesh(mesh: THREE.Object3D): {
  vertices: number[];
  indices: number[];
} {
  const vertices: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  mesh.updateMatrixWorld(true);

  mesh.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const geometry = child.geometry;
      const positionAttr = geometry.attributes.position;

      if (positionAttr) {
        // Apply world transform to each vertex
        const worldMatrix = child.matrixWorld;
        const vertex = new THREE.Vector3();

        for (let i = 0; i < positionAttr.count; i++) {
          vertex.set(
            positionAttr.getX(i),
            positionAttr.getY(i),
            positionAttr.getZ(i),
          );
          vertex.applyMatrix4(worldMatrix);
          vertices.push(vertex.x, vertex.y, vertex.z);
        }

        // Add indices with offset
        if (geometry.index) {
          // Avoid spreading large collision meshes into push(); JavaScript's
          // argument limit is far below the Factory collider's index count.
          const indexArray = geometry.index.array as ArrayLike<number>;
          for (let i = 0; i < indexArray.length; i++) {
            indices.push(indexArray[i] + vertexOffset);
          }
        } else {
          for (let i = 0; i < positionAttr.count; i++) {
            indices.push(vertexOffset + i);
          }
        }
        vertexOffset += positionAttr.count;
      }
    }
  });

  return { vertices, indices };
}
