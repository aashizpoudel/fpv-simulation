import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Parse collision geometry without decoding visual textures in Node. */
export async function loadCollider(path, world) {
  const bytes = await readFile(path);
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) throw new Error('Expected GLB 2 collider');
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  delete json.images; delete json.textures; delete json.materials; delete json.samplers;
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) delete primitive.material;
  const encoded = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20); encoded.copy(padded);
  const remainder = bytes.subarray(20 + jsonLength);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length + remainder.length, 8);
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const clean = Buffer.concat([header, padded, remainder]);
  const map = (await new GLTFLoader().parseAsync(clean.buffer.slice(clean.byteOffset, clean.byteOffset + clean.byteLength), '')).scene;
  map.rotation.x = world.collisionRotationX ?? world.visualRotationX ?? Math.PI / 2;
  map.scale.setScalar(world.mapScale ?? 1);
  if (world.collisionPosition) map.position.set(world.collisionPosition.x, world.collisionPosition.y, world.collisionPosition.z).multiplyScalar(world.mapScale ?? 1);
  map.updateMatrixWorld(true);
  return map;
}
