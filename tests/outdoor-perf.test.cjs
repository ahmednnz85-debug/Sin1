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
  // Token is bumped when outdoor-perf.js changes (r9 added releaseAfterCity).
  assert.match(index, /data-src="outdoor-perf\.js\?v=[0-9]+r[0-9]+"/);
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
  const palms = Object.keys(pack.meshes).filter((k) => k.startsWith('palm_'));
  assert.ok(palms.length >= 3, 'palm meshes ' + palms.length);
  for (const k of palms) {
    const lods = pack.meshes[k].lods;
    assert.ok(lods.play && lods.mid && lods.far, k + ' mid/far');
    assert.ok(lods.mid.tris < lods.play.tris, k + ' mid ' + lods.mid.tris);
    assert.ok(lods.far.tris < lods.mid.tris, k + ' far ' + lods.far.tris);
    assert.ok(lods.far.tris <= 400, k + ' far ' + lods.far.tris);
  }
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
  assert.match(src, /VEG_MID_D = 12/);
  assert.match(src, /VEG_FAR_D = 24/);
  assert.match(src, /VEG_HLOD_D = 36/);
  assert.match(src, /SHADOW_D = 16/);
  assert.match(src, /handleVeg\(state\.palms, optOn\(\)\)/);
  assert.match(src, /function pushHlod/);
  assert.match(src, /function applyShadowCull/);
});

test('palaceInterior does not walk the scene to drain CPU during REVEAL warm', () => {
  // 6b9df9b / later REVEAL work: a sync drainCpuNow(ctx) walked ctx.scene
  // (still holding leftover outdoor nodes) and froze WebKit for minutes.
  // The drain function remains, GPU-ready is detected via __webglTexture,
  // and process-memory.js drains every frame while the palace is streaming.
  // The warm path itself must not call drainCpuNow on the live context.
  const pal = fs.readFileSync(path.join(root, 'palaceInterior.js'), 'utf8');
  assert.match(pal, /function drainCpuNow\(ctx, tag\)/);
  assert.match(pal, /Sync drainCpuNow here walked the hall and wings/);
  assert.doesNotMatch(pal, /drainCpuNow\(ctx, 'warm-start'\)/);
  assert.doesNotMatch(pal, /drainCpuNow\(ctx, \(warmIndex % 16 === 0\)/);
  assert.match(pal, /__webglTexture \|\| p\.__webglInit/);
  assert.doesNotMatch(pal, /__version === t\.version/);
});

test('LOD decode is budgeted across frames, not built inside the fetch callback', () => {
  assert.match(src, /function pumpLodBuild/);
  assert.match(src, /budgetMs \|\| 4/);
  // Must not build the whole pack inside the fetch then() callback.
  assert.doesNotMatch(src, /then\(function \(pack\) \{\s*state\.lod = pack;\s*const geos/);
  // A Worker structured-clone of the 1.8 MB tree stalled WebKit for 2.3 s.
  assert.doesNotMatch(src, /new Worker/);
});

test('applyLods can attach a partial pack (geos built so far)', () => {
  // releaseAfterCity short-circuits applyLods so a freed city cannot reattach LODs.
  assert.match(src, /if \(state\.released \|\| !state\.geos \|\| !Object\.keys\(state\.geos\)\.length\) return 0;/);
});

test('findCamera uses SinGfx.getCamera so the real-device poll has a camera', () => {
  assert.match(src, /SinGfx && typeof SinGfx\.getCamera === 'function'/);
  // Must not treat SinGfx.camera as a function — that is the CAM settings object.
  assert.doesNotMatch(src, /typeof SinGfx\.camera === 'function'/);
});

test('outdoor grass and palm packs snapshot instances and compact to the frustum', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'outdoor-perf.js'), 'utf8');
  assert.match(src, /function snapshotInstances/);
  assert.match(src, /function compactOutdoor/);
  assert.match(src, /function cameraFrustum/);
  assert.match(src, /snapshotInstances\(state\.grass/);
  assert.match(src, /snapshotInstances\(state\.palms/);
  assert.match(src, /instKept \+= compactOutdoor/);
  assert.match(src, /first-culled-present/);
  assert.match(src, /beforeRender\(scene, camera\)/);
  assert.match(src, /window\.__sinNoInstanceCull/);
  assert.match(src, /mesh\.frustumCulled = false/);
});

function fakeGeo(floats) {
  const arr = new Float32Array(floats);
  return {
    d: 0,
    dispose() { this.d++; },
    attributes: { position: { array: arr, count: Math.floor(arr.length / 3) } },
    userData: { sinLod: true }
  };
}

test('index.html teardown calls SinOutdoorPerf.releaseAfterCity', () => {
  const i = index.indexOf('window.__releaseExteriorStage=function(){');
  assert.ok(i >= 0);
  const block = index.slice(i, i + 2200);
  assert.match(block, /SinOutdoorPerf\.releaseAfterCity/);
});

test('releaseAfterCity disposes LOD/HLOD caches, drops mesh refs, and stops the poll', () => {
  const timers = [];
  const ctx = {
    console,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    fetch: () => Promise.reject(new Error('no fetch in unit test')),
    performance: { now: () => 0 },
    setInterval(fn, ms) {
      const id = timers.length + 1;
      timers.push({ id, fn, ms, cleared: false });
      return id;
    },
    clearInterval(id) {
      const t = timers.find((x) => x.id === id);
      if (t) t.cleared = true;
    }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInNewContext(src, ctx);
  const api = ctx.SinOutdoorPerf;
  assert.equal(typeof api.releaseAfterCity, 'function');
  assert.ok(api.state._pollIv, 'poll interval is stored so it can be cleared');

  const gPlay = fakeGeo(300);
  const gFar = fakeGeo(90);
  const gOrig = fakeGeo(600);
  const hMid = fakeGeo(120);
  const hFar = fakeGeo(60);
  const hlodMeshGeo = fakeGeo(48);
  const hlodMesh = { geometry: hlodMeshGeo, parent: { removed: 0, remove() { this.removed++; } }, material: null };

  api.state.geos = { lod0: { srcTris: 1514, lods: { play: gPlay, far: gFar } } };
  api.state.grass = [{ mesh: { geometry: gPlay, userData: { sinLodApplied: true } }, origGeo: gOrig, matrices: new Array(696), lodMid: null, lodFar: gFar }];
  api.state.palms = [{ mesh: { geometry: gPlay }, origGeo: fakeGeo(12), matrices: new Array(548) }];
  api.state.walls = [{ mesh: { geometry: gPlay }, origGeo: fakeGeo(24) }];
  api.state.city = [{ mesh: { geometry: gPlay }, origGeo: fakeGeo(18), lodFar: hFar }];
  api.state._hlodGeos = { sig: { mid: hMid, far: hFar } };
  api.state._hlodPack = { meshes: { sig: {} } };
  api.state._pack = null; // already decoded
  api.state.hlod = { a: { mesh: hlodMesh, n: 4 } };
  api.state.classified = true;
  api.state.lod = { version: 1 };

  const before = api.retentionSnapshot();
  assert.ok(before.grass === 1 && before.palms === 1 && before.walls === 1 && before.city === 1);
  assert.ok(before.lodGeos >= 4);
  assert.ok(before.meshRefs >= 4);
  assert.equal(before.pollAlive, true);
  assert.ok(before.lodGeoBytes > 0);
  assert.equal(before.released, false);

  const report = api.releaseAfterCity();
  assert.equal(gPlay.d, 1);
  assert.equal(gFar.d, 1);
  assert.equal(gOrig.d, 1);
  assert.equal(hMid.d, 1);
  assert.equal(hFar.d, 1);
  assert.equal(hlodMeshGeo.d, 1);
  assert.equal(hlodMesh.parent.removed, 1);
  assert.equal(timers[0].cleared, true);

  const after = api.retentionSnapshot();
  assert.deepEqual({
    grass: after.grass, palms: after.palms, walls: after.walls, city: after.city,
    hlodChunks: after.hlodChunks, lodGeoKeys: after.lodGeoKeys, lodGeos: after.lodGeos,
    hlodGeoKeys: after.hlodGeoKeys, pack: after.pack, hlodPack: after.hlodPack,
    meshRefs: after.meshRefs, matrixSlots: after.matrixSlots, pollAlive: after.pollAlive,
    packBytes: after.packBytes, released: after.released
  }, {
    grass: 0, palms: 0, walls: 0, city: 0,
    hlodChunks: 0, lodGeoKeys: 0, lodGeos: 0,
    hlodGeoKeys: 0, pack: false, hlodPack: false,
    meshRefs: 0, matrixSlots: 0, pollAlive: false,
    packBytes: 0, released: true
  });
  assert.equal(api.emptyRetention(), true);
  assert.equal(report.emptied, true);
  assert.equal(report.before.grass, 1);
  assert.equal(report.before.pollAlive, true);
  // Idempotent.
  const again = api.releaseAfterCity();
  assert.equal(again.already, true);
  assert.equal(gPlay.d, 1, 'dispose once');
  // Guards: a late classify / pump must not refill.
  api.classify({ traverse() {} });
  assert.equal(api.state.grass.length, 0);
  assert.equal(api.pumpLodBuild({}, 4), 0);
  assert.equal(api.applyLods(), 0);
});

test('a LOD fetch that settles after release does not refill the cache', async () => {
  let finish;
  const ctx = {
    console,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    fetch: () => new Promise((resolve) => {
      finish = () => resolve({ ok: true, json: () => Promise.resolve({ version: 1, meshes: { lod0: { srcTris: 10, lods: {} } } }) });
    }),
    performance: { now: () => 0 },
    THREE: { WebGLRenderer: { prototype: {} } },
    setInterval() { return 1; },
    clearInterval() {}
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInNewContext(src, ctx);
  const api = ctx.SinOutdoorPerf;
  // boot() already ran with THREE present and started loadLod.
  assert.equal(typeof finish, 'function', 'loadLod started a fetch');
  const report = api.releaseAfterCity();
  assert.equal(api.state.released, true);
  finish();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const snap = api.retentionSnapshot();
  assert.equal(snap.pack, false);
  assert.equal(snap.lodGeoKeys, 0);
  assert.equal(snap.lodPromise, false);
  assert.equal(api.emptyRetention(), true);
  assert.ok(report);
});

test('cityLeakScan is clean after release and flags leftover outdoor meshes', () => {
  const ctx = {
    console,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    fetch: () => Promise.reject(new Error('no fetch')),
    performance: { now: () => 0 }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInNewContext(src, ctx);
  const api = ctx.SinOutdoorPerf;
  const leftover = {
    name: 'new-grass-tufts',
    type: 'Mesh',
    userData: { sinLod: true },
    geometry: fakeGeo(30)
  };
  const palace = {
    name: 'south-wall',
    type: 'Mesh',
    userData: {},
    geometry: { attributes: { position: { array: new Float32Array(9) } }, userData: {} }
  };
  const scene = {
    traverse(fn) { fn(leftover); fn(palace); }
  };
  const dirty = api.cityLeakScan(scene, { info: { memory: { geometries: 12, textures: 8, programs: [1, 2] } } });
  assert.equal(dirty.ok, false);
  assert.equal(dirty.sceneHits.length, 1);
  assert.equal(dirty.sceneHits[0].name, 'new-grass-tufts');
  assert.equal(dirty.rendererInfo.geometries, 12);
  assert.equal(dirty.rendererInfo.textures, 8);
  assert.equal(dirty.rendererInfo.programs, 2);

  api.releaseAfterCity();
  const cleanScene = { traverse(fn) { fn(palace); } };
  const clean = api.cityLeakScan(cleanScene, { info: { memory: { geometries: 4, textures: 3, programs: [] } } });
  assert.equal(clean.emptied, true);
  assert.equal(clean.sceneHits.length, 0);
  assert.equal(clean.ok, true);
});
