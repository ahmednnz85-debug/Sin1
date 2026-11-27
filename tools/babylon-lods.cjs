#!/usr/bin/env node
// Run after babylon-assets.py with meshoptimizer available in NODE_PATH.
const fs = require('node:fs');
const path = require('node:path');
const { MeshoptSimplifier } = require('meshoptimizer');

(async () => {
  await MeshoptSimplifier.ready;
  for (const pack of ['market', 'city']) prepare(pack);
})().catch(error => { console.error(error); process.exitCode = 1; });

function prepare(pack) {
  const file = path.join(__dirname, '../assets/babylon/', pack+'.glb');
  const glb = fs.readFileSync(file);
  const size = glb.readUInt32LE(12);
  const doc = JSON.parse(glb.subarray(20, 20 + size));
  if (doc.nodes.some(node => node.name.endsWith('_LOD1'))) return;
  const binary = glb.subarray(28 + size);
  const buffers = [binary];
  let offset = binary.length;
  function read(index, type) {
    const a = doc.accessors[index], view = doc.bufferViews[a.bufferView];
    const copy = binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
    return new type(copy.buffer, copy.byteOffset, copy.length / type.BYTES_PER_ELEMENT);
  }
  for (const source of [...doc.nodes]) {
    const original = doc.meshes[source.mesh].primitives[0];
    const Type = doc.accessors[original.indices].componentType === 5123 ? Uint16Array : Uint32Array;
    const indices = new Uint32Array(read(original.indices, Type));
    const position = read(original.attributes.POSITION, Float32Array);
    const uv = read(original.attributes.TEXCOORD_0, Float32Array);
    const presets = pack === 'city' ? [[.32,.007]] : [[.25,.009],[.11,.034]];
    for (const [level,[ratio,error]] of presets.entries()) {
      const [low] = MeshoptSimplifier.simplifyWithAttributes(indices, position, 3, uv, 2, [0.11, 0.11], null,
        Math.floor(indices.length * ratio / 3) * 3, error, []);
      const result = new Type(low);
      const data = Buffer.from(result.buffer);
      const view = doc.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length, target: 34963 }) - 1;
      const pad = Buffer.alloc(-data.length & 3);
      buffers.push(data, pad);
      offset += data.length + pad.length;
      const index = doc.accessors.push({ ...doc.accessors[original.indices], bufferView: view, count: result.length }) - 1;
      const name = source.name + '_LOD' + (level + 1);
      const mesh = doc.meshes.push({ name, primitives: [{ ...original, indices: index }] }) - 1;
      doc.scenes[0].nodes.push(doc.nodes.push({ name, mesh }) - 1);
      console.log(name, indices.length / 3, '→', low.length / 3);
    }
  }
  doc.buffers[0].byteLength = offset;
  let json = JSON.stringify(doc);
  json += ' '.repeat(-Buffer.byteLength(json) & 3);
  const j = Buffer.from(json), head = Buffer.alloc(20), bin = Buffer.alloc(8);
  head.write('glTF'); head.writeUInt32LE(2, 4); head.writeUInt32LE(28 + j.length + offset, 8);
  head.writeUInt32LE(j.length, 12); head.write('JSON', 16);
  bin.writeUInt32LE(offset); bin.write('BIN\0', 4);
  fs.writeFileSync(file, Buffer.concat([head, j, bin, ...buffers]));
}
