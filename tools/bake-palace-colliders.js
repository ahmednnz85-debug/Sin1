#!/usr/bin/env node
/* Bake palace wing Clipper CSG (K1 difference) and the collider grid
   so runtime palace SETUP never spends minutes on Clipper / point-in-polygon.
   Usage:
     node tools/bake-palace-colliders.js          # write data/palace-colliders.json
     node tools/bake-palace-colliders.js --check  # exit 1 if the committed JSON is stale
     node tools/bake-palace-colliders.js --stdout
*/
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'palace-colliders.json');
const WALL_REL = path.join('ارضيات وسقوف', 'optimized', 'الجدارية.glb');
const Arch = require(path.join(ROOT, 'wing-architecture.js'));

function measureWallGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error('not a GLB');
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  const mesh = gltf.meshes[0];
  const posAcc = gltf.accessors[mesh.primitives[0].attributes.POSITION];
  const node = (gltf.nodes || []).find(n => n.mesh === 0) || (gltf.nodes || [])[1] || {};
  const scale = Array.isArray(node.scale) ? node.scale : [1, 1, 1];
  const min = posAcc.min, max = posAcc.max;
  const norm = posAcc.normalized ? (posAcc.componentType === 5122 ? 32767 : (posAcc.componentType === 5120 ? 127 : 1)) : 1;
  const decode = v => (posAcc.normalized ? Math.max(v / norm, -1) : v);
  return {
    x: (decode(max[0]) - decode(min[0])) * scale[0],
    y: (decode(max[1]) - decode(min[1])) * scale[1],
    z: (decode(max[2]) - decode(min[2])) * scale[2]
  };
}

function stableStringify(obj) {
  // Deterministic JSON: sorted keys at every object, no timings (machine-dependent).
  const seen = new WeakSet();
  function sort(v) {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) throw new Error('cycle');
    seen.add(v);
    if (Array.isArray(v)) return v.map(sort);
    const out = {};
    Object.keys(v).sort().forEach(k => {
      if (k === 'timings' || k === 'bakeMs') return;
      out[k] = sort(v[k]);
    });
    return out;
  }
  return JSON.stringify(sort(obj), null, 2) + '\n';
}

function bake() {
  const wallPath = path.join(ROOT, WALL_REL);
  const wallSize = measureWallGlb(fs.readFileSync(wallPath));
  // Default H matches the cinematic hero's bbox at the palace door
  // (PalaceInterior sets H = max(1.2, hero bbox y) before building the hall).
  // Override with --H if the hero changes. Last measured: 1.8396676123142246.
  const hArg = process.argv.find((a, i, arr) => arr[i - 1] === '--H');
  const H = hArg ? Number(hArg) : 1.8396676123142246;
  if (!Number.isFinite(H) || H < 1.2 || H > 3) throw new Error('bad --H ' + hArg);
  const hall = Arch.canonicalHall(wallSize, { H: H });
  const t0 = Date.now();
  const data = Arch.computeBake(hall);
  data.generatedBy = 'tools/bake-palace-colliders.js';
  data.wallAsset = WALL_REL.split(path.sep).join('/');
  const bakeMs = Date.now() - t0;
  return { data: data, bakeMs: bakeMs };
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const stdout = args.includes('--stdout');
  process.stderr.write('baking palace colliders (wall + layout + K1 Clipper difference + grid)...\n');
  const result = bake();
  const data = result.data;
  const bakeMs = result.bakeMs;
  const text = stableStringify(data);
  process.stderr.write(
    'bake done in ' + bakeMs + ' ms; K1-diff ' +
    (data.timings && data.timings.k1DiffMs) + ' ms; json ' +
    text.length + ' bytes; boxes ' + (data.colliders && data.colliders.length) +
    '; grid ' + data.grid.nx + 'x' + data.grid.nz + '\n'
  );
  if (stdout) {
    process.stdout.write(text);
    return;
  }
  if (check) {
    if (!fs.existsSync(OUT)) {
      process.stderr.write('FAIL: ' + path.relative(ROOT, OUT) + ' is missing. Run: node tools/bake-palace-colliders.js\n');
      process.exit(1);
    }
    const existing = fs.readFileSync(OUT, 'utf8');
    if (existing !== text) {
      process.stderr.write('FAIL: ' + path.relative(ROOT, OUT) + ' is stale. Run: node tools/bake-palace-colliders.js\n');
      process.exit(1);
    }
    process.stderr.write('OK: ' + path.relative(ROOT, OUT) + ' is up to date.\n');
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  process.stderr.write('wrote ' + path.relative(ROOT, OUT) + '\n');
}

main();
