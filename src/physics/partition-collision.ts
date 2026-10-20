import type { CollisionData } from "../core/simulation-messages";
import type { Vec3 } from "../types";

export type CollisionPart = CollisionData & { origin?: Vec3; bounds?: { min: Vec3; max: Vec3 } };

/** Keep every triangle intact, but give Rapier small spatial collider bounds. */
export function partitionCollision(data: CollisionData): CollisionPart[] {
  const { vertices, indices, cellSize } = data;
  if (cellSize === undefined) return [data];
  if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error("Invalid collision cell size");
  const cells = new Map<string, { vertices: number[]; indices: number[]; remap: Map<number, number> }>();
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const key = [0, 1, 2].map(axis => Math.floor(
      (vertices[a + axis] + vertices[b + axis] + vertices[c + axis]) / (3 * cellSize),
    )).join(",");
    let cell = cells.get(key);
    if (!cell) {
      cell = { vertices: [], indices: [], remap: new Map() };
      cells.set(key, cell);
    }
    // A crossing triangle belongs to one cell; its actual bounds extend beyond
    // the cell. No clipping, duplicate faces, or cracks at partition boundaries.
    for (let corner = 0; corner < 3; corner++) {
      const source = indices[i + corner];
      let local = cell.remap.get(source);
      if (local === undefined) {
        local = cell.vertices.length / 3;
        cell.remap.set(source, local);
        cell.vertices.push(vertices[source * 3], vertices[source * 3 + 1], vertices[source * 3 + 2]);
      }
      cell.indices.push(local);
    }
  }
  return [...cells.entries()].map(([key, cell]) => {
    // Keep local bounds small as well as world bounds for swept shape queries.
    const center = key.split(",").map(Number).map(n => (n + .5) * cellSize);
    const localVertices = Float32Array.from(cell.vertices, (value, i) => value - center[i % 3]);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    localVertices.forEach((v, i) => {
      const axis = i % 3, world = v + center[axis];
      min[axis] = Math.min(min[axis], world); max[axis] = Math.max(max[axis], world);
    });
    return {
      origin: { x: center[0], y: center[1], z: center[2] },
      bounds: { min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } },
      vertices: localVertices,
      indices: new Uint32Array(cell.indices),
    };
  });
}
