const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cine = fs.readFileSync(path.join(root, 'cinematic.js'), 'utf8');

function glbTriangles(file) {
  const buf = fs.readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  let tris = 0;
  for (const mesh of gltf.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const acc = gltf.accessors;
      const count = prim.indices != null ? acc[prim.indices].count : acc[prim.attributes.POSITION].count;
      tris += Math.floor(count / 3);
    }
  }
  return tris;
}

test('grass tufts are not built or shipped', () => {
  assert.equal(html.includes('await buildNewGrass()'), false);
  assert.equal(html.includes("loadX('grass_tuft_a')") || html.includes('await buildNewGrass()'), html.includes("loadX('grass_tuft_a')"));
  assert.equal(fs.existsSync(path.join(root, 'assets/grass_tuft_a.glb')), false);
  assert.equal(fs.existsSync(path.join(root, 'assets/grass_tuft_b.glb')), false);
  assert.match(html, /grassTufts:0/);
});

test('jars are gap barriers, not a seal carpet', () => {
  assert.equal(html.includes('gap-seal-pots'), false);
  assert.equal(html.includes('function potLine'), false);
  assert.match(html, /market-pot-barriers/);
  assert.match(html, /Math\.min\(3,Math\.ceil\(span\/1\.05\)\)/);
  assert.match(html, /function rail\(/);
});

test('movement does not retarget shadow casters or evict city GPU buffers', () => {
  assert.match(html, /Shadows stay/);
  assert.doesNotMatch(html, /cityResidency\.sync\(scene/);
  assert.match(html, /function forNearColliders/);
  assert.match(html, /PCFShadowMap/);
  assert.doesNotMatch(html, /antialias:gfxParams\.get\('aa'\)!=='0'/);
});

test('shadow tier stays inside a real-time budget', () => {
  assert.doesNotMatch(cine, /res:\s*2048/);
  assert.doesNotMatch(cine, /soft:\s*true/);
  assert.match(cine, /extent:\s*52/);
  assert.doesNotMatch(cine, /R\.shadowMap\.mapSize/);
});

test('repeated city meshes stay under the triangle budget', () => {
  const budget = {
    'babylonian_wall.glb': 9000,
    'market_pot.glb': 700,
    'market_pots.glb': 2800,
    'palm_new.glb': 16000,
    'kiosk.glb': 28000,
    'stalls.glb': 42000,
    'houses.glb': 28000
  };
  for (const [name, max] of Object.entries(budget)) {
    const tris = glbTriangles(path.join(root, 'assets', name));
    assert.ok(tris > 100, name + ' lost its geometry');
    assert.ok(tris <= max, name + ' has ' + tris + ' tris, budget ' + max);
  }
});

test('collider grid only reports a real hit', () => {
  const colliders = [[0, 0, 1], [30, 0, 1], [2.2, 0.2, 0.8]];
  const COL_CELL = 8;
  const buckets = new Map();
  for (const c of colliders) {
    const r = c[2];
    const x0 = Math.floor((c[0] - r) / COL_CELL), x1 = Math.floor((c[0] + r) / COL_CELL);
    const z0 = Math.floor((c[1] - r) / COL_CELL), z1 = Math.floor((c[1] + r) / COL_CELL);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = x + ',' + z;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(c);
    }
  }
  function blocked(x, z) {
    const x0 = Math.floor(x / COL_CELL), z0 = Math.floor(z / COL_CELL);
    const a = buckets.get(x0 + ',' + z0) || [];
    return a.some(c => (x - c[0]) ** 2 + (z - c[1]) ** 2 < c[2] ** 2);
  }
  assert.equal(blocked(0.2, 0.1), true);
  assert.equal(blocked(8, 0), false);
  assert.equal(blocked(30.4, 0), true);
  assert.equal(blocked(2.5, 0.2), true);
});
