'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Z = require('../zone-streamer.js');

// Minimal scene-graph + renderer doubles (no THREE dependency).
let nextId = 1;
function obj(name, extra) {
  const o = Object.assign({ id: nextId++, name, visible: true, userData: {}, children: [], parent: null }, extra || {});
  o.add = c => { c.parent = o; o.children.push(c); return o; };
  o.remove = c => { o.children.splice(o.children.indexOf(c), 1); c.parent = null; };
  o.traverse = fn => { fn(o); o.children.slice().forEach(c => c.traverse(fn)); };
  return o;
}
function tex() { const source = { data: { width: 4, height: 4 } }; return { isTexture: true, version: 1, source, get image() { return source.data; }, userData: {}, disposed: 0, dispose() { this.disposed++; } }; }
function mesh(name, t) { return obj(name, { isMesh: true, geometry: { dispose() { this.d = 1; } }, material: { map: t, userData: {}, dispose() {} } }); }
function renderer() {
  const props = new Map();
  return {
    uploads: 0, compiles: 0,
    properties: { get(t) { if (!props.has(t)) props.set(t, {}); return props.get(t); } },
    initTexture(t) { this.uploads++; const p = this.properties.get(t); p.__webglTexture = {}; p.__version = t.version; },
    compileAsync() { this.compiles++; return Promise.resolve(); }
  };
}
const tick = () => new Promise(r => setImmediate(r));

test('registered test zone: prefetch -> budgeted upload -> compile -> atomic reveal', async () => {
  const scene = obj('scene'); const g = obj('TEST1'); scene.add(g);
  const R = renderer();
  const s = Z.create({ uploadsPerFrame: 2, uploadMsPerFrame: 100 });
  const textures = [tex(), tex(), tex(), tex(), tex()];
  let loadedApi = null;
  s.register({ id: 'TEST1', prefetchHops: 1, load(api) { loadedApi = api; textures.forEach((t, i) => api.add(mesh('TEST1-m' + i, t))); api.done(); } });
  s.attach({ renderer: R, scene, camera: {}, groupOf: id => (id === 'TEST1' ? g : null) });
  // Two hops away: not wanted yet.
  s.update({ current: 'A', distances: new Map([['TEST1', 2]]) });
  assert.strictEqual(s.status('TEST1'), 'cold');
  // One hop away: predictive prefetch starts before the player can see it.
  s.update({ current: 'B', distances: new Map([['TEST1', 1]]) });
  assert.ok(loadedApi);
  assert.ok(g.children.every(m => m.visible === false), 'content hidden while preparing');
  let frames = 0;
  while (s.status('TEST1') !== 'ready' && frames < 20) { s.update({ current: 'B', distances: new Map([['TEST1', 1]]) }); await tick(); frames++; }
  assert.strictEqual(s.status('TEST1'), 'ready');
  assert.strictEqual(R.uploads, 5);
  assert.ok(frames >= 3, 'uploads spread over frames (budget 2/frame)');
  assert.strictEqual(R.compiles, 1);
  assert.ok(g.children.every(m => m.visible === true), 'revealed as one set');
  assert.strictEqual(g.userData.dressReady, true);
});

test('CPU pixels are released only after every texture of a source is on the GPU', () => {
  const scene = obj('scene'); const g = obj('Z'); scene.add(g);
  const R = renderer();
  const s = Z.create();
  s.attach({ renderer: R, scene, camera: {}, groupOf: () => g });
  const t = tex(); const clone = Object.assign(Object.create(Object.getPrototypeOf(t)), t); // same source
  Object.defineProperty(clone, 'image', { get() { return t.source.data; } });
  const root = obj('gltf'); root.add(mesh('a', t)); root.add(mesh('b', clone));
  s.markReleasable(root);
  R.initTexture(t); s.pumpUploads();
  assert.ok(t.source.data, 'still has pixels: clone not uploaded');
  R.initTexture(clone); s.update({ distances: new Map() });
  assert.strictEqual(t.source.data, null);
});

test('LRU eviction with grace; visible / adjacent zones are never evicted', async () => {
  const scene = obj('scene');
  const groups = new Map(['Z1', 'Z2', 'Z3'].map(id => { const g = obj(id); scene.add(g); return [id, g]; }));
  const R = renderer();
  const s = Z.create({ graceMs: 0, cacheZones: { normal: 1, watch: 0, critical: 0 }, maxConcurrentLoads: 3 });
  s.attach({ renderer: R, scene, camera: {}, groupOf: id => groups.get(id) });
  const unloaded = [];
  ['Z1', 'Z2', 'Z3'].forEach(id => s.register({ id, load(api) { const t = tex(); const m = api.add(mesh(id + '-m', t)); s.markReleasable(m); api.done(); }, unload() { unloaded.push(id); } }));
  const all = new Map([['Z1', 1], ['Z2', 1], ['Z3', 1]]);
  for (let i = 0; i < 10; i++) { s.update({ current: 'X', distances: all }); await tick(); }
  ['Z1', 'Z2', 'Z3'].forEach(id => assert.strictEqual(s.status(id), 'ready'));
  // Player moves far away, but Z3 is still visible through a portal.
  const far = new Map([['Z1', 5], ['Z2', 4], ['Z3', 6]]);
  s.update({ current: 'Y', distances: far, visible: new Set(['Z3']) });
  await tick();
  s.update({ current: 'Y', distances: far, visible: new Set(['Z3']) });
  assert.strictEqual(s.status('Z3'), 'ready', 'visible zone kept');
  // One idle zone may stay cached (LRU), the older one is evicted.
  assert.strictEqual(unloaded.length, 1);
  assert.strictEqual(groups.get(unloaded[0]).children.length, 0);
  // Critical memory: every idle zone goes, visible still protected.
  s.update({ current: 'Y', distances: far, visible: new Set(['Z3']), memoryLevel: 'critical' });
  assert.deepStrictEqual(unloaded.sort(), ['Z1', 'Z2']);
  assert.strictEqual(s.status('Z3'), 'ready');
});

test('a still-loading zone is not revealed by a short timeout (K2 table pop-in)', async () => {
  const scene = obj('scene'); const g = obj('Z'); scene.add(g);
  const s = Z.create();
  s.register({ id: 'Z', timeoutMs: 0, abandonMs: 60000, load() { /* never completes, never fails */ } });
  s.attach({ renderer: renderer(), scene, camera: {}, groupOf: () => g });
  for (let i = 0; i < 8; i++) { s.update({ distances: new Map([['Z', 0]]) }); await tick(); }
  assert.strictEqual(s.status('Z'), 'loading', 'must wait for isComplete, not a 14s-style timeout');
});

test('a zone whose load fails or hits abandonMs is revealed so it is not hidden forever', async () => {
  const scene = obj('scene'); const g = obj('Z'); scene.add(g);
  const s = Z.create();
  s.register({ id: 'Z', abandonMs: 0, load() { /* never completes */ } });
  s.attach({ renderer: renderer(), scene, camera: {}, groupOf: () => g });
  for (let i = 0; i < 5; i++) { s.update({ distances: new Map([['Z', 0]]) }); await tick(); }
  assert.strictEqual(s.status('Z'), 'ready');
});

test('fail() also lets an incomplete zone proceed to reveal', async () => {
  const scene = obj('scene'); const g = obj('Z'); scene.add(g);
  const s = Z.create();
  s.register({ id: 'Z', abandonMs: 60000, load(api) { api.fail(new Error('404')); } });
  s.attach({ renderer: renderer(), scene, camera: {}, groupOf: () => g });
  for (let i = 0; i < 5; i++) { s.update({ distances: new Map([['Z', 0]]) }); await tick(); }
  assert.strictEqual(s.status('Z'), 'ready');
});

test('wings registers K2-K4 through the data manifest and exposes registerZone', () => {
  const fs = require('fs'); const path = require('path');
  const wings = fs.readFileSync(path.join(__dirname, '..', 'wings.js'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(wings, /const WING_ZONES = \[/);
  ['K2', 'K3', 'K4'].forEach(id => assert.match(wings, new RegExp("\\{ id: '" + id + "'")));
  assert.match(wings, /WING_ZONES\.forEach\(registerZone\)/);
  assert.match(wings, /registerZone: registerZone/);
  const streamer = fs.readFileSync(path.join(__dirname, '..', 'zone-streamer.js'), 'utf8');
  assert.match(streamer, /compileAsync\(g, ctx\.camera, ctx\.scene/);
  assert.ok(index.indexOf('zone-streamer.js') > 0 && index.indexOf('zone-streamer.js') < index.indexOf('wings.js?'));
});

test('camera pointing at a far zone does not start a load; player hops do', async () => {
  const scene = obj('scene'); const g = obj('FAR'); scene.add(g);
  const R = renderer();
  const s = Z.create({ graceMs: 0, maxConcurrentLoads: 1 });
  let loaded = 0;
  s.register({ id: 'FAR', prefetchHops: 2, load(api) { loaded++; api.add(mesh('FAR-m', tex())); api.done(); } });
  s.attach({ renderer: R, scene, camera: {}, groupOf: () => g });
  // Camera can see FAR, but the player is 5 hops away: must not start.
  s.update({ current: 'HERE', distances: new Map([['FAR', 5]]), visible: new Set(['FAR']), prepared: new Set() });
  assert.strictEqual(s.status('FAR'), 'cold');
  assert.strictEqual(loaded, 0);
  // Player walks to 2 hops: prefetch starts.
  s.update({ current: 'NEAR', distances: new Map([['FAR', 2]]), visible: new Set(), prepared: new Set() });
  assert.notStrictEqual(s.status('FAR'), 'cold');
  assert.strictEqual(loaded, 1);
});

test('a zone the camera can see is never evicted even if hops are large', async () => {
  const scene = obj('scene'); const g = obj('Z'); scene.add(g);
  const R = renderer();
  const s = Z.create({ graceMs: 0, cacheZones: { normal: 0, watch: 0, critical: 0 }, maxConcurrentLoads: 1 });
  let unloaded = 0;
  s.register({ id: 'Z', prefetchHops: 1, load(api) { api.add(mesh('Z-m', tex())); api.done(); }, unload() { unloaded++; } });
  s.attach({ renderer: R, scene, camera: {}, groupOf: () => g });
  for (let i = 0; i < 8; i++) { s.update({ current: 'A', distances: new Map([['Z', 1]]), prepared: new Set(['Z']) }); await tick(); }
  assert.strictEqual(s.status('Z'), 'ready');
  // Player moves far, but the camera still sees Z through a doorway.
  s.update({ current: 'FAR', distances: new Map([['Z', 6]]), visible: new Set(['Z']), prepared: new Set(), memoryLevel: 'critical' });
  assert.strictEqual(s.status('Z'), 'ready');
  assert.strictEqual(unloaded, 0);
});

test('evict disposes unshared textures even when CPU pixels remain (no accumulation)', async () => {
  const scene = obj('scene');
  const g = obj('Z'); scene.add(g);
  const R = renderer();
  const s = Z.create({ graceMs: 0, cacheZones: { normal: 0, watch: 0, critical: 0 } });
  s.attach({ renderer: R, scene, camera: {}, groupOf: () => g });
  const t = tex(); // image still present — the old evict path would skip this
  let disposed = 0;
  t.dispose = function () { disposed++; this.disposed++; };
  s.register({ id: 'Z', prefetchHops: 0, load(api) { api.add(mesh('Z-m', t)); api.done(); } });
  for (let i = 0; i < 8; i++) { s.update({ current: 'Z', distances: new Map([['Z', 0]]) }); await tick(); }
  assert.strictEqual(s.status('Z'), 'ready');
  s.update({ current: 'Y', distances: new Map([['Z', 5]]), memoryLevel: 'critical' });
  assert.strictEqual(s.status('Z'), 'cold');
  assert.ok(disposed >= 1, 'GPU texture must be disposed on evict even if image is still set');
  assert.strictEqual(g.children.length, 0);
});


test('tryReleaseCpu records sinGpuW before closing the ImageBitmap', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const assert = require('node:assert/strict');
  const src = fs.readFileSync(path.join(__dirname, '..', 'zone-streamer.js'), 'utf8');
  const fn = src.slice(src.indexOf('function tryReleaseCpu'), src.indexOf('function capOne'));
  assert.match(fn, /sinGpuW/);
  assert.ok(fn.indexOf('sinGpuW') < fn.indexOf('img.close'));
});

test('current cold zone is wanted even when hops are missing', async () => {
  const scene = obj('scene'); const g = obj('K4'); scene.add(g);
  const R = renderer();
  const s = Z.create({ uploadsPerFrame: 8, uploadMsPerFrame: 100 });
  let loads = 0;
  s.register({
    id: 'K4', prefetchHops: 1,
    load(api) { loads++; api.add(mesh('K4-treasury-floor-artwork', tex())); api.done(); },
    isComplete() { return loads > 0; }
  });
  s.attach({ renderer: R, scene, camera: {}, groupOf: id => (id === 'K4' ? g : null) });
  // Player is in K4, but the distances map has no entry (hops = Infinity).
  // Before the fix this stayed cold forever (second visit after eviction).
  s.update({ current: 'K4', distances: new Map(), prepared: new Set(), visible: new Set(['K4']) });
  assert.ok(loads >= 1, 'current room must start even with missing hops, loads=' + loads);
  let frames = 0;
  while (s.status('K4') !== 'ready' && frames < 20) {
    s.update({ current: 'K4', distances: new Map(), prepared: new Set(), visible: new Set(['K4']) });
    await tick();
    frames++;
  }
  assert.strictEqual(s.status('K4'), 'ready');
});

test('forceLoad starts a cold current zone even with no hop entry', async () => {
  const scene = obj('scene'); const g = obj('K4'); scene.add(g);
  const R = renderer();
  const s = Z.create({ uploadsPerFrame: 8, uploadMsPerFrame: 100 });
  let loads = 0;
  s.register({
    id: 'K4', prefetchHops: 1,
    load(api) { loads++; api.add(mesh('K4-treasury-floor-artwork', tex())); api.done(); },
    isComplete() { return loads > 0; }
  });
  s.attach({ renderer: R, scene, camera: {}, groupOf: id => (id === 'K4' ? g : null) });
  assert.ok(typeof s.forceLoad === 'function');
  const st = s.forceLoad('K4');
  assert.notStrictEqual(st, 'cold');
  assert.ok(loads >= 1, 'forceLoad must call load(), loads=' + loads);
  let frames = 0;
  while (s.status('K4') !== 'ready' && frames < 20) {
    s.update({ current: 'K4', distances: new Map(), prepared: new Set(['K4']), visible: new Set(['K4']) });
    await tick();
    frames++;
  }
  assert.strictEqual(s.status('K4'), 'ready');
});

test('forceLoad pumps step so a complete zone is not left unrevealed', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'zone-streamer.js'), 'utf8');
  const body = src.slice(src.indexOf('function forceLoad(id)'), src.indexOf('function reset('));
  assert.match(body, /rec\.lastWanted = now\(\)/);
  assert.match(body, /step\(rec, now\(\), 0\)/);
});

test('non-adjacent zones evict immediately under a 650 MB budget', async () => {
  const scene = obj('scene');
  const gA = obj('A'); const gB = obj('B'); const gC = obj('C');
  scene.add(gA); scene.add(gB); scene.add(gC);
  const R = renderer();
  const s = Z.create({
    graceMs: 8000, cacheZones: { normal: 2, watch: 0, critical: 0 },
    processBudgetMB: 650, gpuBudgetMB: 0, cpuBudgetMB: 0,
    uploadsPerFrame: 8, uploadMsPerFrame: 100, maxConcurrentLoads: 3
  });
  let unloaded = [];
  function reg(id) {
    s.register({
      id, prefetchHops: 1,
      load(api) { api.add(mesh(id + '-m', tex())); api.done(); },
      isComplete() { return true; },
      unload() { unloaded.push(id); }
    });
  }
  reg('A'); reg('B'); reg('C');
  s.attach({ renderer: R, scene, camera: {}, groupOf: id => ({ A: gA, B: gB, C: gC }[id]) });
  // Load A then B (adjacent).
  async function pump(cur, dist, vis) {
    for (let i = 0; i < 12; i++) {
      s.update({ current: cur, distances: dist, visible: vis || new Set(), prepared: new Set() });
      await tick();
    }
  }
  await pump('A', new Map([['A', 0], ['B', 1], ['C', 3]]), new Set(['A']));
  await pump('B', new Map([['A', 1], ['B', 0], ['C', 2]]), new Set(['B']));
  assert.strictEqual(s.status('A'), 'ready', 'adjacent A stays');
  assert.strictEqual(s.status('B'), 'ready');
  // Walk to C: C is 2 hops from B, A is 3 hops. Both A and B must drop
  // immediately (grace 8 s is ignored under the 650 bar) so C does not stack.
  await pump('C', new Map([['A', 3], ['B', 2], ['C', 0]]), new Set(['C']));
  assert.strictEqual(s.status('A'), 'cold', 'non-adjacent A evicted, got ' + s.status('A'));
  assert.strictEqual(s.status('B'), 'cold', 'non-adjacent B evicted, got ' + s.status('B'));
  assert.ok(unloaded.indexOf('A') >= 0 && unloaded.indexOf('B') >= 0);
  assert.ok(s.status('C') === 'ready' || s.status('C') === 'loading' || s.status('C') === 'uploading' || s.status('C') === 'compiling');
});

test('forceLoad and current-room update pump step so a complete zone reveals quickly', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'zone-streamer.js'), 'utf8');
  assert.match(src, /function evictNonAdjacent/);
  assert.match(src, /rec\.isCurrent[\s\S]*step\(rec, t, 0\)/);
  assert.match(src, /function markCurrent/);
  assert.match(src, /tight \? \(far \? 'non-adjacent'/);
});


// Playthrough order on a cold first visit: K1 (always-resident hall neighbour)
// → K2 → K3 → K4. Prepared includes 2-hop rooms (the planner's prepareHops).
// Each room's real cost stacks over 650, but the incoming estimate is low
// (the evictToFit "it fits" path that left K2 resident in playthrough-4).
// Fails if any door takes more than 10 s or the residency peak exceeds 650,
// or if K2 is still resident at K3, or if K4 is evicted mid-load and retried.
test('K1 to K2 to K3 to K4 cold first visit: reveal under 10s and peak under 650', async () => {
  const BASE = 500;
  const COST = { K2: 110, K3: 110, K4: 120 };
  const resident = new Set();
  let peak = BASE;
  function usage() {
    let p = BASE;
    resident.forEach(function (id) { p += COST[id] || 0; });
    if (p > peak) peak = p;
    return { processMB: p, gpuMB: 0, cpuMB: 0 };
  }
  const scene = obj('scene');
  const groups = {};
  ['K2', 'K3', 'K4'].forEach(function (id) { groups[id] = obj(id); scene.add(groups[id]); });
  const R = renderer();
  const s = Z.create({
    graceMs: 0, cacheZones: { normal: 0, watch: 0, critical: 0 },
    processBudgetMB: 650, gpuBudgetMB: 0, cpuBudgetMB: 0,
    defaultZoneProcessMB: 20, // underestimate: evictToFit would skip
    uploadsPerFrame: 8, uploadMsPerFrame: 100, maxConcurrentLoads: 3,
    estimate: usage
  });
  const loads = { K2: 0, K3: 0, K4: 0 };
  const complete = { K2: false, K3: false, K4: false };
  const DELAY = { K2: 60, K3: 60, K4: 90 };
  function reg(id) {
    s.register({
      id, prefetchHops: 1, estProcessMB: 20, abandonMs: 60000,
      load(api) {
        loads[id]++;
        complete[id] = false;
        resident.add(id);
        api.add(mesh(id + '-m', tex()));
        setTimeout(function () { complete[id] = true; api.done(); }, DELAY[id]);
      },
      isComplete() { return complete[id]; },
      unload() { resident.delete(id); complete[id] = false; }
    });
  }
  reg('K2'); reg('K3'); reg('K4');
  s.attach({ renderer: R, scene, camera: {}, groupOf: id => groups[id] });

  // Hop distances matching the King's-wing streamer graph.
  const hops = {
    Palace: { K2: 3, K3: 6, K4: 6 },
    K1:     { K2: 2, K3: 5, K4: 6 },
    K2:     { K2: 0, K3: 3, K4: 4 },
    K3:     { K2: 3, K3: 0, K4: 5 },
    K4:     { K2: 4, K3: 5, K4: 0 }
  };
  function preparedOf(cur) {
    const set = new Set();
    Object.keys(hops[cur]).forEach(function (id) { if (hops[cur][id] <= 2) set.add(id); });
    // Force-include the previous room in prepared (prepareHops-style) to
    // prove prepared.has no longer protects or restarts it.
    if (cur === 'K3') set.add('K2');
    if (cur === 'K4') { set.add('K2'); set.add('K3'); }
    return set;
  }
  async function visit(cur, timeout) {
    timeout = timeout || 10000;
    const t0 = Date.now();
    const dist = new Map(Object.entries(hops[cur] || {}));
    const prep = preparedOf(cur);
    while (Date.now() - t0 < timeout) {
      s.update({ current: cur, distances: dist, visible: new Set([cur]), prepared: prep });
      await tick();
      if (s.isReady(cur)) return Date.now() - t0;
    }
    assert.fail(cur + ' not ready in ' + timeout + ' ms, status=' + s.status(cur) + ' peak=' + peak);
  }

  // K1 is always-resident (not a streamed zone). Standing there may
  // prefetch K2 (2 hops, prepared) — that must still fit under 650.
  for (let i = 0; i < 8; i++) {
    s.update({
      current: 'K1',
      distances: new Map(Object.entries(hops.K1)),
      visible: new Set(['K1']),
      prepared: preparedOf('K1')
    });
    await tick();
  }
  assert.ok(peak <= 650, 'peak while standing in K1 is ' + peak);

  const t2 = await visit('K2');
  assert.ok(t2 <= 10000, 'K2 first visit ' + t2 + ' ms');
  assert.strictEqual(s.status('K2'), 'ready');
  assert.ok(peak <= 650, 'peak at K2 is ' + peak);

  // Playthrough teleport calls forceLoad(K3) BEFORE update() runs, so K2
  // is still flagged isCurrent. That must not keep K2 resident (PT5 peak 693).
  s.forceLoad('K3');
  assert.strictEqual(s.status('K2'), 'cold', 'forceLoad K3 must evict K2 even while K2 isCurrent is stale, got ' + s.status('K2'));
  assert.ok(peak <= 650, 'peak after forceLoad K3 is ' + peak + ' (K2 still stacked)');

  const t3 = await visit('K3');
  assert.ok(t3 <= 10000, 'K3 first visit ' + t3 + ' ms');
  assert.strictEqual(s.status('K3'), 'ready', 'K3 status ' + s.status('K3'));
  assert.strictEqual(s.status('K2'), 'cold', 'K2 must be evicted at K3, got ' + s.status('K2'));
  assert.ok(peak <= 650, 'peak at K3 is ' + peak + ' (K2+K3 stacked)');

  s.forceLoad('K4');
  assert.strictEqual(s.status('K3'), 'cold', 'forceLoad K4 must evict K3 even while K3 isCurrent is stale, got ' + s.status('K3'));
  assert.strictEqual(s.status('K2'), 'cold', 'K2 must stay evicted at forceLoad K4');
  assert.ok(peak <= 650, 'peak after forceLoad K4 is ' + peak);

  // Mid-load flicker: one update with current=Palace, then back to K4.
  // Must not evict K4 and restart the  parse (the 60 s non-reveal).
  const t4p = visit('K4');
  // After a couple of ticks K4 is loading; flicker away and back.
  await tick(); await tick();
  s.update({
    current: 'Palace',
    distances: new Map(Object.entries(hops.Palace)),
    visible: new Set(),
    prepared: preparedOf('Palace')
  });
  await tick();
  const t4 = await t4p;
  assert.ok(t4 <= 10000, 'K4 first visit ' + t4 + ' ms');
  assert.strictEqual(s.status('K4'), 'ready', 'K4 status ' + s.status('K4'));
  assert.strictEqual(s.status('K3'), 'cold', 'K3 must be evicted at K4, got ' + s.status('K3'));
  assert.strictEqual(s.status('K2'), 'cold', 'K2 must stay evicted at K4, got ' + s.status('K2'));
  assert.strictEqual(loads.K4, 1, 'K4 must load once, not evict-and-retry (loads=' + loads.K4 + ')');
  assert.ok(peak <= 650, 'peak at K4 is ' + peak);
});
