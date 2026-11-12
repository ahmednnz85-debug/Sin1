const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'outdoor-perf.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const lodPath = path.join(root, 'assets/lod/outdoor-lod.json');

function load() {
  const ctx = {
    window: {}, globalThis: {}, console,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    fetch: () => Promise.reject(new Error('no fetch in unit test')),
    performance: { now: () => 0 }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInNewContext(src, ctx);
  return ctx;
}

test('outdoor-perf is on the page and original outdoor GLBs are not replaced', () => {
  assert.match(index, /data-src="outdoor-perf\.js\?v=20261112r4"/);
  // Originals still referenced by the game (index loadX paths).
  assert.match(index, /babylonian_wall/);
  assert.match(index, /grass_tuft_a/);
  assert.match(index, /palm_new/);
  for (const f of ['assets/babylonian_wall.glb', 'assets/grass_tuft_a.glb', 'assets/grass_tuft_b.glb', 'assets/palm_new.glb']) {
    const st = fs.statSync(path.join(root, f));
    assert.ok(st.size > 10000, f + ' missing or empty');
  }
});

test('baked LOD pack exists, is smaller than the sources, and records tight errors', () => {
  assert.ok(fs.existsSync(lodPath));
  const pack = JSON.parse(fs.readFileSync(lodPath, 'utf8'));
  assert.ok(pack.meshes.wall, 'wall lod');
  assert.ok(pack.meshes.grass_a_lod2, 'grass lod2');
  const wall = pack.meshes.wall;
  assert.equal(wall.srcTris, 50680);
  assert.ok(wall.lods.mid.tris <= 1500, 'wall mid ' + wall.lods.mid.tris);
  assert.ok(wall.lods.far.tris <= 250, 'wall far ' + wall.lods.far.tris);
  assert.ok(wall.lods.mid.error < 0.03);
  const g2 = pack.meshes.grass_a_lod2;
  assert.equal(g2.srcTris, 1514);
  assert.ok(g2.lods.play.tris <= 200, 'grass lod2 play ' + g2.lods.play.tris);
  assert.ok(g2.lods.far.tris <= 80, 'grass lod2 far ' + g2.lods.far.tris);
  assert.ok(g2.lods.play.error < 0.03);
  const g0 = pack.meshes.grass_a_lod0;
  assert.ok(g0.lods.play.tris < 2500 && g0.lods.play.error < 0.02);
});

test('wall occlusion: forest outside the corridor is hidden, props at the ends stay', () => {
  const ctx = load();
  const api = ctx.SinOutdoorPerf;
  assert.ok(api && api.occludedByWall);
  const plane = { x: 10.4, start: 78, end: 160, h: 8 };
  // Camera on the processional way, looking past a wall at a grass chunk outside.
  const cam = { x: 0, y: 1.7, z: 100 };
  assert.equal(api.occludedByWall(50, 110, 16, cam, plane), true, 'forest to the right, mid-corridor');
  assert.equal(api.occludedByWall(-60, 120, 16, cam, plane), true, 'forest to the left');
  // A stall on the road is not occluded.
  assert.equal(api.occludedByWall(4, 110, 3, cam, plane), false, 'on the road');
  // Camera in the open field before the walls: trees beside the camera stay visible.
  const camOpen = { x: 0, y: 1.7, z: 40 };
  assert.equal(api.occludedByWall(50, 40, 16, camOpen, plane), false, 'beside the camera, before wall start');
  // A tree ahead and off to the side, seen from before the walls: the sight
  // line passes in front of the wall start (z=78), so it is correctly visible
  // around the corner — not a false occlusion.
  assert.equal(api.occludedByWall(50, 120, 16, camOpen, plane), false, 'around the wall entrance');
  // From just inside the corridor the same tree is hidden.
  assert.equal(api.occludedByWall(50, 120, 16, { x: 0, y: 1.7, z: 90 }, plane), true, 'inside, tree behind wall');
  // Corners: slack of 6 m keeps the wall-end pots visible.
  assert.equal(api.occludedByWall(18, 79, 3, { x: 0, y: 1.7, z: 70 }, plane), false, 'near wall entrance, slack');
});

test('sight-range comment and frustum path are not the only cull (occlusion + LOD)', () => {
  assert.match(src, /occludedByWall/);
  assert.match(src, /outdoor-lod\.json/);
  assert.match(src, /new-grass-tufts/);
  assert.match(src, /sinLodApplied/);
  // Must not permanently lower the visual tier.
  assert.doesNotMatch(src, /setMode\(['"]low['"]\)/);
  assert.doesNotMatch(src, /gfxTier\s*=\s*['"]low['"]/);
});

test('liveTrisOf prefers lodTris over the original srcTris', () => {
  const ctx = load();
  const api = ctx.SinOutdoorPerf;
  assert.ok(api.liveTrisOf);
  assert.equal(api.liveTrisOf({ geometry: { userData: { srcTris: 10268, lodTris: 1799 } } }), 1799);
  assert.equal(api.liveTrisOf({ geometry: { userData: { srcTris: 10268 }, index: { count: 411 } } }), 137);
  assert.equal(api.liveTrisOf({ geometry: { attributes: { position: { count: 300 } } } }), 100);
});

test('cross-band grass ladder steps down at mid and far distances', () => {
  assert.match(src, /function pickVegLod/);
  assert.match(src, /function attachLodLadder/);
  assert.match(src, /_lod2/);
  assert.match(src, /dn > 90/);
  assert.match(src, /dn > 28/);
});

test('palaceInterior drains CPU during REVEAL warm, not only at the end', () => {
  const pal = fs.readFileSync(path.join(root, 'palaceInterior.js'), 'utf8');
  assert.match(pal, /drainCpuNow\(ctx, 'warm-start'\)/);
  assert.match(pal, /drainCpuNow\(ctx, \(warmIndex % 16 === 0\)/);
  assert.match(pal, /__webglTexture \|\| p\.__webglInit/);
  assert.doesNotMatch(pal, /__version === t\.version/);
});
