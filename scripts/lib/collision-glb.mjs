/** Reject point-cloud GLBs: Rapier needs nonempty triangle primitives. */
export function inspectCollisionGlb(bytes) {
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "glTF" ||
      bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length ||
      bytes.readUInt32LE(16) !== 0x4e4f534a) {
    throw new Error("Invalid collision GLB header");
  }
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
  let triangles = 0;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const position = json.accessors?.[primitive.attributes?.POSITION];
      const count = primitive.indices === undefined
        ? position?.count : json.accessors?.[primitive.indices]?.count;
      if ((primitive.mode ?? 4) !== 4 || position?.type !== "VEC3" ||
          !Number.isInteger(count) || count <= 0 || count % 3 !== 0) {
        throw new Error("Collision GLB must contain triangles, not Gaussian points");
      }
      triangles += count / 3;
    }
  }
  if (!triangles) throw new Error("Collision GLB contains no triangles");
  return { triangles };
}
