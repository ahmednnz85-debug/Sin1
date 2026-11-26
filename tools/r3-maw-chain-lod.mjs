/* Reduce the repeated chain link while keeping its normal/UV boundaries. */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const req = createRequire(import.meta.url);
const { MeshoptDecoder, MeshoptSimplifier } = await import(pathToFileURL(req.resolve('meshoptimizer')));
await Promise.all([MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const glb = fs.readFileSync(process.argv[2]);
const jsonSize = glb.readUInt32LE(12);
const doc = JSON.parse(glb.subarray(20, 20 + jsonSize));
const bin = glb.subarray(28 + jsonSize);
const node = doc.nodes.find(n => n.name === 'Elevator_Chain_Link_01_Geo');
const prim = doc.meshes[node.mesh].primitives[0];

function decode(id) {
  const accessor = doc.accessors[id];
  const buffer = doc.bufferViews[accessor.bufferView];
  const ext = buffer.extensions.EXT_meshopt_compression;
  const bytes = new Uint8Array(buffer.byteLength);
  const start = ext.byteOffset || 0;
  MeshoptDecoder.decodeGltfBuffer(bytes, ext.count, ext.byteStride,
    bin.subarray(start, start + ext.byteLength), ext.mode, ext.filter);
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[accessor.type];
  const types = {
    5120: ['Int8', 1, 127], 5121: ['Uint8', 1, 255], 5122: ['Int16', 2, 32767],
    5123: ['Uint16', 2, 65535], 5125: ['Uint32', 4, 1], 5126: ['Float32', 4, 1]
  };
  const [reader, width, max] = types[accessor.componentType];
  const view = new DataView(bytes.buffer);
  const result = new (n === 1 ? Uint32Array : Float32Array)(accessor.count * n);
  for (let i = 0; i < accessor.count; i++) {
    for (let j = 0; j < n; j++) {
      const value = view['get' + reader]((accessor.byteOffset || 0) + i * ext.byteStride + j * width, true);
      result[i * n + j] = accessor.normalized ? Math.max(-1, value / max) : value;
    }
  }
  return result;
}

const position = decode(prim.attributes.POSITION);
const normal = decode(prim.attributes.NORMAL);
const uv = decode(prim.attributes.TEXCOORD_0);
const index = decode(prim.indices);
const attributes = new Float32Array(position.length / 3 * 5);
for (let i = 0; i < position.length / 3; i++) {
  attributes.set(normal.subarray(i * 3, i * 3 + 3), i * 5);
  attributes.set(uv.subarray(i * 2, i * 2 + 2), i * 5 + 3);
}
const [result, deviation] = MeshoptSimplifier.simplifyWithAttributes(index, position, 3, attributes, 5,
  [0.04, 0.04, 0.04, 0.08, 0.08], null, 3420, 0.015, ['RegularizeLight']);
if (result.length >= index.length || Math.max(...result) > 65535) throw new Error('Unexpected chain-link indices');
const output = new Uint16Array(result);
fs.writeFileSync(process.argv[3], Buffer.from(output.buffer));
console.log('Chain link', index.length / 3, '→', result.length / 3, 'triangles; error', deviation.toFixed(5));
