#!/usr/bin/env node
// NODE_PATH=…/node_modules node tools/u1-harbor-mesh.cjs  (meshoptimizer)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } = require('meshoptimizer');

async function main() {
  const assets = path.join(__dirname, '../assets');
  const source = fs.readFileSync(path.join(assets, 'اصول المرسى.glb'));
  const jsonSize = source.readUInt32LE(12);
  const original = JSON.parse(source.subarray(20, 20 + jsonSize));
  const bin = source.subarray(28 + jsonSize);
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);

  const read = i => {
    const a = original.accessors[i], view = original.bufferViews[a.bufferView];
    const { byteStride, byteLength, count, mode, filter, byteOffset = 0 } = view.extensions.EXT_meshopt_compression;
    const bytes = Buffer.alloc(view.byteLength);
    MeshoptDecoder.decodeGltfBuffer(bytes, count, byteStride, bin.subarray(byteOffset, byteOffset + byteLength), mode, filter);
    return [bytes, a, byteStride];
  };
  const primitive = original.meshes[0].primitives[0];
  const [positions, pos, stride] = read(primitive.attributes.POSITION);
  const [normals, , normalStride] = read(primitive.attributes.NORMAL);
  const [uvs, , uvStride] = read(primitive.attributes.TEXCOORD_0);
  const [indices, index] = read(primitive.indices);
  const points = new Float32Array(pos.count * 3), attributes = new Float32Array(pos.count * 5);
  const authored = original.nodes[0];
  for (let i = 0; i < pos.count; i++) {
    for (let k = 0; k < 3; k++) {
      points[3 * i + k] = positions.readInt16LE(i * stride + k * 2) / 32767 * authored.scale[k] + authored.translation[k];
      attributes[5 * i + k] = Math.max(-1, normals.readInt8(i * normalStride + k) / 127);
    }
    const length = Math.hypot(...attributes.subarray(i * 5, i * 5 + 3)) || 1;
    for (let k = 0; k < 3; k++) attributes[i * 5 + k] /= length;
    for (let k = 0; k < 2; k++) attributes[5 * i + 3 + k] = uvs.readUInt16LE(i * uvStride + k * 2) / 65535;
  }
  const column = [], lamp = [];
  for (let i = 0; i < index.count; i += 3) {
    const ids = [indices.readUInt16LE(i * 2), indices.readUInt16LE(i * 2 + 2), indices.readUInt16LE(i * 2 + 4)];
    // A 12 cm empty band between the two authored objects makes this exact.
    const group = ids.every(id => points[3 * id + 2] < -0.05) ? lamp : column;
    group.push(...ids);
  }
  const doc = {
    asset: { version: '2.0', generator: 'Sin1 U1 asset preparation' }, scene: 0, scenes: [{ nodes: [0, 1] }],
    nodes: [], meshes: [], bufferViews: [], accessors: [], buffers: [],
    images: original.images, textures: original.textures, samplers: original.samplers, materials: original.materials,
    extensionsUsed: ['EXT_meshopt_compression', 'EXT_texture_webp'],
    extensionsRequired: ['EXT_meshopt_compression', 'EXT_texture_webp']
  };
  const chunks = [];
  let bytes = 0, fallback = 0;
  function append(data) {
    const offset = bytes;
    const pad = (4 - data.length % 4) % 4;
    chunks.push(Buffer.from(data), Buffer.alloc(pad));
    bytes += data.length + pad;
    return offset;
  }
  for (const image of doc.images) {
    const v = original.bufferViews[image.bufferView];
    const offset = v.byteOffset || 0;
    const data = bin.subarray(offset, offset + v.byteLength);
    image.bufferView = doc.bufferViews.length;
    doc.bufferViews.push({ buffer: 0, byteOffset: append(data), byteLength: data.length });
  }
  function compress(data, count, byteStride, mode) {
    const encoded = MeshoptEncoder.encodeGltfBuffer(data, count, byteStride, mode);
    const view = { buffer: 1, byteOffset: fallback, byteLength: data.length,
      target: mode === 'ATTRIBUTES' ? 34962 : 34963,
      extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: append(encoded), byteLength: encoded.length, byteStride, count, mode } } };
    fallback += data.length + (4 - data.length % 4) % 4;
    if (mode === 'ATTRIBUTES') view.byteStride = byteStride;
    return doc.bufferViews.push(view) - 1;
  }
  function add(name, ids, triangles) {
    const [lod, error] = MeshoptSimplifier.simplifyWithAttributes(Uint32Array.from(ids), points, 3, attributes, 5,
      [0.16, 0.16, 0.16, 0.85, 0.85], null, triangles * 3, 0.012, ['Regularize']);
    const [remap, count] = MeshoptSimplifier.compactMesh(lod);
    const data = Buffer.alloc(count * 32);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < remap.length; i++) {
      if (remap[i] === 0xffffffff) continue;
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], points[i * 3 + k]);
        max[k] = Math.max(max[k], points[i * 3 + k]);
      }
    }
    const pivot = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
    for (let i = 0; i < remap.length; i++) {
      if (remap[i] === 0xffffffff) continue;
      const offset = 32 * remap[i];
      for (let k = 0; k < 3; k++) data.writeFloatLE(points[i * 3 + k] - pivot[k], offset + k * 4);
      for (let k = 0; k < 5; k++) data.writeFloatLE(attributes[i * 5 + k], offset + 12 + k * 4);
    }
    const view = compress(data, count, 32, 'ATTRIBUTES');
    const faces = Uint16Array.from(lod);
    const access = (bufferView, type, count, byteOffset, componentType) =>
      doc.accessors.push({ bufferView, type, count, byteOffset, componentType }) - 1;
    const p = access(view, 'VEC3', count, 0, 5126);
    doc.accessors[p].min = min.map((v, i) => Math.fround(v - pivot[i]));
    doc.accessors[p].max = max.map((v, i) => Math.fround(v - pivot[i]));
    const n = access(view, 'VEC3', count, 12, 5126);
    const uv = access(view, 'VEC2', count, 24, 5126);
    const ix = access(compress(new Uint8Array(faces.buffer), faces.length, 2, 'TRIANGLES'), 'SCALAR', faces.length, 0, 5123);
    const mesh = doc.meshes.push({ primitives: [{ attributes: { POSITION: p, NORMAL: n, TEXCOORD_0: uv }, indices: ix, material: 0 }] }) - 1;
    doc.nodes.push({ name, mesh });
    console.log(name, ids.length / 3, '→', lod.length / 3, 'triangles, error', error.toFixed(4));
  }
  add('Harbor_Column', column, 14300);
  add('Harbor_Turquoise_Lamp', lamp, 3600);
  doc.buffers = [{ byteLength: bytes }, { byteLength: fallback, extensions: { EXT_meshopt_compression: { fallback: true } } }];
  let json = Buffer.from(JSON.stringify(doc), 'utf8');
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + bytes, 8);
  header.writeUInt32LE(json.length, 12); header.write('JSON', 16);
  binHeader.writeUInt32LE(bytes); binHeader.write('BIN\0', 4);
  fs.writeFileSync(path.join(assets, 'r3/harbor/architecture.glb'), Buffer.concat([header, json, binHeader, ...chunks]));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
