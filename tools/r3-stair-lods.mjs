#!/usr/bin/env node
/* R3-01 — distance LODs for the heaviest props of "اصول درج السنين.glb".

   The source GLB is never modified: near the hero the game draws the
   authored meshes. This writes assets/r3/stair/props_lod1.glb with one
   simplified copy per heavy node (same node name + "_LOD1", same primitive
   order), geometry only: the runtime reuses the authored materials and
   KTX2 textures. Simplification is meshoptimizer's (attribute-aware, UV and
   normal seams preserved), then quantized + meshopt-compressed like the source.

   Usage (needs: npm i @gltf-transform/core @gltf-transform/extensions
                       @gltf-transform/functions meshoptimizer):
     node tools/r3-stair-lods.mjs [--deps /path/to/node_modules] */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const deps = opt('deps');
const req = createRequire(deps ? path.join(deps, 'noop.js') : import.meta.url);
const load = name => import(pathToFileURL(req.resolve(name)).href);
const { NodeIO } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS } = await load('@gltf-transform/extensions');
const { dequantize, weld, quantize, meshopt, prune, dedup } = await load('@gltf-transform/functions');
const { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } = await load('meshoptimizer');

// node -> [ratio, error]: kept detail is decided per asset by its role.
const TARGETS = {
  Lamassu_Guardian_Large: [0.2, 0.004],
  Lamassu_Guardian_Small: [0.2, 0.004],
  Relief_Moon_Phases_And_Cuneiform: [0.3, 0.003],
  Relief_Winged_Guardian_And_Attendants: [0.3, 0.003],
  Relief_Royal_Procession: [0.3, 0.003],
  Masonry_Archway_Large: [0.35, 0.004],
  Hanging_Roots_Wide_Long: [0.35, 0.01],
  Hanging_Roots_Central_Tapered: [0.35, 0.01],
  Hanging_Roots_Wide_Forked: [0.35, 0.01],
  Hanging_Roots_Narrow: [0.35, 0.01]
};

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder
});
const src = path.join(ROOT, 'assets', 'اصول درج السنين.glb');
const out = path.join(ROOT, 'assets', 'r3', 'stair', 'props_lod1.glb');
const doc = await io.read(src);
const root = doc.getRoot();
// Geometry only: textures and the texture extension go away.
for (const t of root.listTextures()) t.dispose();
for (const e of root.listExtensionsUsed()) if (e.extensionName === 'KHR_texture_basisu') e.dispose();
for (const node of root.listNodes()) {
  if (!TARGETS[node.getName()]) { node.dispose(); continue; }
  node.setName(node.getName() + '_LOD1');
}
await doc.transform(prune(), dequantize(), weld());
const report = {};
for (const node of root.listNodes()) {
  const name = node.getName().replace(/_LOD1$/, '');
  const [ratio, error] = TARGETS[name];
  let a = 0, b = 0;
  for (const prim of node.getMesh().listPrimitives()) {
    const idx = prim.getIndices(), pos = prim.getAttribute('POSITION');
    const indices = new Uint32Array(idx.getArray());
    const positions = new Float32Array(pos.getArray());
    const target = Math.max(3, Math.floor(indices.length * ratio / 3) * 3);
    const [res] = MeshoptSimplifier.simplify(indices, positions, 3, target, error, []);
    a += indices.length / 3; b += res.length / 3;
    idx.setArray(res.length > 65535 * 3 ? res : new Uint32Array(res));
  }
  report[name] = { source: a, lod1: b };
}
await doc.transform(dedup(), prune(), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(out, doc);
console.log(JSON.stringify(report, null, 1));
console.log('wrote', path.relative(ROOT, out), (fs.statSync(out).size / 1024).toFixed(0) + ' KiB');
