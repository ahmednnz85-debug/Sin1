#!/usr/bin/env node
/* Build index-only hall LODs and optionally extract the five original props.
   npm install meshoptimizer
   node tools/r3-hall-props.mjs [--deps /path/to/node_modules] [--extract /out] */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const option = key => args.includes(key) ? args[args.indexOf(key) + 1] : null;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const deps = option('--deps');
const req = createRequire(deps ? path.resolve(deps, '.probe.cjs') : import.meta.url);
const { MeshoptDecoder, MeshoptSimplifier } = await import(pathToFileURL(req.resolve('meshoptimizer')));
await Promise.all([MeshoptDecoder.ready, MeshoptSimplifier.ready]);

const source = fs.readFileSync(path.join(root, 'assets', 'اصول قاعة الختم.glb'));
const jsonSize = source.readUInt32LE(12);
const doc = JSON.parse(source.subarray(20, 20 + jsonSize));
const binary = source.subarray(28 + jsonSize);
const align = size => (size + 3) & ~3;

function viewOf(view, meshopt = false) {
  const v = doc.bufferViews[view];
  const { byteOffset = 0, byteLength } = meshopt ? v.extensions.EXT_meshopt_compression : v;
  return binary.subarray(byteOffset, byteOffset + byteLength);
}

function accessor(index) {
  const { count, bufferView, componentType, type, normalized, byteOffset = 0 } = doc.accessors[index];
  const view = doc.bufferViews[bufferView];
  const ext = view.extensions?.EXT_meshopt_compression;
  const parts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
  const [suffix, bytes, divisor] = {
    5120: ['Int8', 1, 127], 5121: ['Uint8', 1, 255],
    5122: ['Int16', 2, 32767], 5123: ['Uint16', 2, 65535],
    5125: ['Uint32', 4, 1], 5126: ['Float32', 4, 1]
  }[componentType];
  const stride = ext?.byteStride || view.byteStride || parts * bytes;
  const data = ext ? new Uint8Array(view.byteLength) : viewOf(bufferView);
  if (ext) MeshoptDecoder.decodeGltfBuffer(data, ext.count, stride, viewOf(bufferView, true), ext.mode, ext.filter);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const result = new (type === 'SCALAR' ? Uint32Array : Float32Array)(count * parts);
  for (let vertex = 0; vertex < count; vertex++) {
    for (let component = 0; component < parts; component++) {
      const value = dv['get' + suffix](byteOffset + vertex * stride + component * bytes, true);
      result[vertex * parts + component] = normalized ? Math.max(-1, value / divisor) : value;
    }
  }
  return result;
}

const chunks = [], manifest = [];
for (const node of doc.nodes) {
  const prop = node.name.split('_')[0];
  const ratio = { Lamassu: 0.23, Engraved: 0.19, Sun: 0.31, Collapsed: 0.16 }[prop];
  if (!ratio) continue;
  for (const p of doc.meshes[node.mesh].primitives) {
    const indices = accessor(p.indices);
    if (indices.length < 2500) continue;
    const pos = accessor(p.attributes.POSITION), normal = accessor(p.attributes.NORMAL);
    const uv = accessor(p.attributes.TEXCOORD_0);
    const attributes = new Float32Array(pos.length / 3 * 5);
    for (let i = 0; i < pos.length / 3; i++) {
      attributes.set(normal.subarray(i * 3, i * 3 + 3), i * 5);
      attributes.set(uv.subarray(i * 2, i * 2 + 2), i * 5 + 3);
    }
    const wanted = Math.floor(indices.length * ratio / 3) * 3;
    const [reduced, error] = MeshoptSimplifier.simplifyWithAttributes(
      indices, pos, 3, attributes, 5, [0.08, 0.08, 0.08, 0.22, 0.22],
      null, wanted, 0.006, ['RegularizeLight']
    );
    const key = node.name + '/' + doc.materials[p.material].name;
    console.log(key, indices.length / 3, '→', reduced.length / 3, 'error', error.toFixed(5));
    manifest.push([key, reduced.length]);
    chunks.push(Buffer.from(reduced.buffer, reduced.byteOffset, reduced.byteLength));
  }
}
const manifestBytes = Buffer.from(JSON.stringify(manifest));
const header = Buffer.alloc(4 + align(manifestBytes.length));
header.writeUInt32LE(manifestBytes.length);
manifestBytes.copy(header, 4);
fs.writeFileSync(path.join(root, 'assets', 'r3', 'hall', 'prop-lod.bin'), Buffer.concat([header, ...chunks]));

// Standalone GLBs contain just the selected node and its transitive dependencies.
// Keep the exact compressed geometry, all mipmaps, and the original transforms.
function extract(directory) {
  fs.mkdirSync(directory, { recursive: true });
  for (const node of doc.nodes) {
    const result = {
      asset: doc.asset, extensionsUsed: doc.extensionsUsed, extensionsRequired: doc.extensionsRequired,
      scene: 0, scenes: [{ nodes: [0] }], nodes: [{ ...node, mesh: 0 }],
      meshes: [], materials: [], textures: [], images: [], samplers: [],
      accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }, doc.buffers[1]]
    };
    const ids = new Map(), data = [];
    let offset = 0;
    function append(bytes) {
      const start = offset;
      data.push(bytes, Buffer.alloc(align(bytes.length) - bytes.length));
      offset += align(bytes.length);
      return start;
    }
    function map(table, oldIndex, transform = value => value) {
      const key = table + oldIndex;
      if (ids.has(key)) return ids.get(key);
      const index = result[table].length;
      ids.set(key, index);
      result[table].push(null);
      result[table][index] = transform(structuredClone(doc[table][oldIndex]));
      return index;
    }
    function bufferView(index) {
      return map('bufferViews', index, view => {
        const ext = view.extensions?.EXT_meshopt_compression;
        if (ext) {
          ext.byteOffset = append(viewOf(index, true));
        } else view.byteOffset = append(viewOf(index));
        return view;
      });
    }
    const attr = index => map('accessors', index, entry => ({
      ...entry, bufferView: bufferView(entry.bufferView)
    }));
    const tex = index => map('textures', index, entry => {
      if (entry.sampler != null) entry.sampler = map('samplers', entry.sampler);
      const basis = entry.extensions.KHR_texture_basisu;
      basis.source = map('images', basis.source, image => ({
        ...image, bufferView: bufferView(image.bufferView)
      }));
      return entry;
    });
    const mat = index => map('materials', index, entry => {
      for (const channel of [entry.normalTexture, entry.occlusionTexture,
        entry.pbrMetallicRoughness.baseColorTexture, entry.pbrMetallicRoughness.metallicRoughnessTexture]) {
        channel.index = tex(channel.index);
      }
      return entry;
    });
    map('meshes', node.mesh, mesh => {
      for (const p of mesh.primitives) {
        p.material = mat(p.material);
        p.indices = attr(p.indices);
        for (const key of Object.keys(p.attributes)) p.attributes[key] = attr(p.attributes[key]);
      }
      return mesh;
    });
    result.buffers[0].byteLength = offset;
    const json = Buffer.from(JSON.stringify(result));
    const fileHeader = Buffer.alloc(20);
    fileHeader.write('glTF');
    fileHeader.writeUInt32LE(2, 4);
    fileHeader.writeUInt32LE(28 + align(json.length) + offset, 8);
    fileHeader.writeUInt32LE(align(json.length), 12);
    fileHeader.write('JSON', 16);
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(offset);
    binHeader.write('BIN\0', 4);
    fs.writeFileSync(path.join(directory, node.name + '.glb'), Buffer.concat([
      fileHeader, json, Buffer.alloc(align(json.length) - json.length, 0x20), binHeader, ...data
    ]));
  }
}

const extraction = option('--extract');
if (extraction) extract(extraction);
