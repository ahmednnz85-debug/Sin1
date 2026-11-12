'use strict';
// Scalability: residency and GPU memory are bounded by what's near the
// player, not by how many rooms or wings are registered. This is the
// test-only proof for future content (one more Kings room + two 5-room
// wings, and beyond). Dummy zones are not game content.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Z = require('../zone-streamer.js');

let nextId = 1;
function obj(name, extra) {
  const o = Object.assign({ id: nextId++, name, visible: true, userData: {}, children: [], parent: null }, extra || {});
  o.add = c => { c.parent = o; o.children.push(c); return o; };
  o.remove = c => { const i = o.children.indexOf(c); if (i >= 0) o.children.splice(i, 1); c.parent = null; };
  o.traverse = fn => { fn(o); o.children.slice().forEach(c => c.traverse(fn)); };
  return o;
}
function tex() {
  const source = { data: { width: 4, height: 4 } };
  return {
    isTexture: true, version: 1, source,
    get image() { return source.data; },
    userData: {}, disposed: 0,
    dispose() { this.disposed++; }
  };
}
function mesh(name, t) {
  return obj(name, { isMesh: true, geometry: { disposed: 0, dispose() { this.disposed++; } }, material: { map: t, userData: {}, dispose() {} } });
}
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

// Two future wings of 6 dress rooms each (12 extra), plus a far hub so the
// wings are not in each other's prefetch window. Linear: HUB-SX1-...-SX6
// and HUB-SY1-...-SY6. Hops between SX6 and SY6 is 12.
function buildGraph() {
  const adj = new Map();
  function link(a, b) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b); adj.get(b).push(a);
  }
  const sx = [], sy = [];
  for (let i = 1; i <= 6; i++) { sx.push('SX' + i); sy.push('SY' + i); }
  link('HUB', 'SX1'); link('HUB', 'SY1');
  for (let i = 1; i < 6; i++) { link('SX' + i, 'SX' + (i + 1)); link('SY' + i, 'SY' + (i + 1)); }
  return { adj, sx, sy, all: sx.concat(sy) };
}
function distances(adj, origin) {
  const dist = new Map([[origin, 0]]), q = [origin];
  while (q.length) {
    const a = q.shift();
    for (const b of adj.get(a) || []) if (!dist.has(b)) { dist.set(b, dist.get(a) + 1); q.push(b); }
  }
  return dist;
}

function setup(opts) {
  const g = buildGraph();
  const scene = obj('scene');
  const groups = new Map();
  g.all.forEach(id => { const gr = obj(id); scene.add(gr); groups.set(id, gr); });
  const R = renderer();
  const s = Z.create(Object.assign({
    graceMs: 0,
    cacheZones: { normal: 1, watch: 0, critical: 0 },
    maxConcurrentLoads: 12,
    uploadsPerFrame: 16,
    uploadMsPerFrame: 1000
  }, opts || {}));
  s.attach({ renderer: R, scene, camera: {}, groupOf: id => groups.get(id) });
  const liveTextures = new Map(); // id -> [tex]
  const unloaded = [];
  const revealedVisible = [];
  g.all.forEach(id => {
    s.register({
      id,
      prefetchHops: (opts && opts.prefetchHops) != null ? opts.prefetchHops : 4,
      priority: 0,
      load(api) {
        const textures = [tex(), tex(), tex(), tex()]; // 4 unique maps, like a dressed room
        liveTextures.set(id, textures);
        textures.forEach((t, i) => {
          const m = mesh(id + '-m' + i, t);
          // Capture visibility at the moment of add (must be hidden).
          api.add(m);
        });
        api.done();
      },
      unload() { unloaded.push(id); liveTextures.delete(id); },
      onReady(api) {
        const g = api.group;
        if (g) revealedVisible.push({ id, allVisible: g.children.every(c => c.visible === true), n: g.children.length });
      },
      ownsObject(ch) { return !!(ch.name && ch.name.indexOf(id + '-') === 0); }
    });
  });
  async function walkTo(current, frames) {
    const dist = distances(g.adj, current);
    for (let i = 0; i < (frames || 12); i++) {
      s.update({ current, distances: dist, visible: new Set(), prepared: new Set([current]) });
      await tick();
    }
    return s.report();
  }
  function resident() {
    const r = s.report();
    const ready = [], loading = [], cold = [];
    Object.keys(r.zones).forEach(id => {
      const st = r.zones[id].state;
      if (st === 'ready') ready.push(id);
      else if (st === 'cold') cold.push(id);
      else loading.push(id);
    });
    return { ready, loading, cold, live: ready.concat(loading), report: r };
  }
  function liveTexCount() {
    let n = 0, disposed = 0;
    liveTextures.forEach(arr => arr.forEach(t => { n++; if (t.disposed) disposed++; }));
    return { n, disposed };
  }
  return { g, scene, groups, R, s, unloaded, revealedVisible, walkTo, resident, liveTextures, liveTexCount };
}

test('12 extra rooms across two dummy wings stay cold until the player is nearby', async () => {
  const x = setup();
  // Standing at a fictional "Palace" not in the graph: every hop is Infinity.
  for (let i = 0; i < 6; i++) {
    x.s.update({ current: 'Palace', distances: new Map(), visible: new Set(), prepared: new Set() });
    await tick();
  }
  const r = x.resident();
  assert.strictEqual(r.live.length, 0, 'no dress loads when every dummy room is far');
  assert.strictEqual(r.cold.length, 12);
  assert.strictEqual(x.R.uploads, 0);
});

test('residency is bounded by prefetch+cache, not by total room count, and the far wing stays cold', async () => {
  const PREFETCH = 4, CACHE = 1;
  const x = setup({ prefetchHops: PREFETCH });
  // Upper bound: current + PREFETCH hops either direction (linear) + LRU cache.
  // On a line that's at most (PREFETCH + 1 + PREFETCH) + CACHE = 10.
  const BOUND = PREFETCH * 2 + 1 + CACHE;
  const peaks = [];
  const path = ['HUB'].concat(x.g.sx).concat(['HUB']).concat(x.g.sy).concat(['HUB']);
  for (const id of path) {
    await x.walkTo(id, 14);
    const r = x.resident();
    peaks.push({ at: id, n: r.live.length, live: r.live.slice().sort() });
    assert.ok(r.live.length <= BOUND, 'at ' + id + ' resident ' + r.live.length + ' exceeds bound ' + BOUND + ': ' + r.live.join(','));
    // Deep in one wing, the other wing is outside the prefetch window.
    // At most cacheZones (1) idle room from the far wing may linger — never
    // the whole wing. That is the "bounded by nearby, not by total" rule.
    if (/^SX[4-6]$/.test(id)) {
      const syLive = r.live.filter(z => z.indexOf('SY') === 0);
      assert.ok(syLive.length <= CACHE, 'far wing SY too resident at ' + id + ': ' + syLive.join(',') + ' (cache allows ' + CACHE + ')');
    }
    if (/^SY[4-6]$/.test(id)) {
      const sxLive = r.live.filter(z => z.indexOf('SX') === 0);
      assert.ok(sxLive.length <= CACHE, 'far wing SX too resident at ' + id + ': ' + sxLive.join(',') + ' (cache allows ' + CACHE + ')');
    }
  }
  const maxLive = Math.max(...peaks.map(p => p.n));
  assert.ok(maxLive < 12, 'peak resident ' + maxLive + ' must be less than total rooms 12');
  assert.ok(maxLive <= BOUND, 'peak ' + maxLive + ' over bound ' + BOUND);
  // After a full tour, evictions happened; we did not keep every room.
  const end = x.resident();
  assert.ok(x.unloaded.length >= 6, 'expected many evictions after crossing both wings, got ' + x.unloaded.length);
  assert.ok(end.live.length <= BOUND);
});

test('walking the two wings three times does not accumulate textures or geometries', async () => {
  const x = setup({ prefetchHops: 4 });
  const path = x.g.sx.concat(['HUB']).concat(x.g.sy);
  // Warm up once so the first measured tour is at prefetch steady-state.
  // After 6e6c83f, entering a room evicts non-adjacent prefetch and
  // restarts it; the first pass therefore peaks lower than later ones
  // (loads still in flight). The leak check is that subsequent tours
  // do not grow.
  for (const id of path) await x.walkTo(id, 12);
  const peaks = [];
  for (let tour = 0; tour < 3; tour++) {
    for (const id of path) {
      await x.walkTo(id, 12);
      const live = x.liveTexCount();
      // Each resident zone owns 4 textures that are not yet evicted.
      peaks.push({ tour, id, tex: live.n, resident: x.resident().live.length, evictions: x.s.report().stats.evictions, disposed: x.s.report().stats.texturesDisposed });
    }
  }
  const byTour = [0, 1, 2].map(t => {
    const rows = peaks.filter(p => p.tour === t);
    return { tour: t, maxTex: Math.max(...rows.map(r => r.tex)), maxRes: Math.max(...rows.map(r => r.resident)), endEvict: rows[rows.length - 1].evictions, endDisp: rows[rows.length - 1].disposed };
  });
  // Peak live textures must not grow across tours (bounded, not a leak).
  assert.ok(byTour[2].maxTex <= byTour[0].maxTex + 4, 'texture peak grew: ' + JSON.stringify(byTour));
  assert.ok(byTour[2].maxRes <= byTour[0].maxRes + 1, 'resident peak grew: ' + JSON.stringify(byTour));
  assert.ok(byTour[2].endDisp > byTour[0].endDisp, 'disposals should keep climbing as rooms are evicted');
  // A live (not-yet-evicted) texture must not have been disposed; evicted ones
  // must have been disposed (no GPU accumulation).
  const endLive = x.liveTexCount();
  assert.strictEqual(endLive.disposed, 0, 'a still-resident texture was disposed');
  assert.ok(x.s.report().stats.texturesDisposed >= 4 * 6, 'too few GPU textures freed');
});

test('dummy rooms never pop in: hidden while loading, revealed atomically', async () => {
  const x = setup({ prefetchHops: 4, maxConcurrentLoads: 1, uploadsPerFrame: 2, uploadMsPerFrame: 100 });
  // Start walking toward SX1: content must be invisible until ready.
  const dist = distances(x.g.adj, 'SX1');
  x.s.update({ current: 'SX1', distances: dist, visible: new Set(), prepared: new Set(['SX1']) });
  const g = x.groups.get('SX1');
  // Mid-prepare: if children already exist they must be hidden.
  if (g.children.length) assert.ok(g.children.every(c => c.visible === false), 'visible during prepare');
  let frames = 0;
  while (x.s.status('SX1') !== 'ready' && frames < 40) {
    if (g.children.length) assert.ok(g.children.every(c => c.visible === false) || x.s.status('SX1') === 'ready', 'mesh became visible before ready on frame ' + frames);
    x.s.update({ current: 'SX1', distances: dist, visible: new Set(), prepared: new Set(['SX1']) });
    await tick();
    frames++;
  }
  assert.strictEqual(x.s.status('SX1'), 'ready');
  assert.ok(g.children.length >= 4);
  assert.ok(g.children.every(c => c.visible === true), 'atomic reveal must show every mesh together');
  const rec = x.revealedVisible.find(r => r.id === 'SX1');
  assert.ok(rec && rec.allVisible && rec.n >= 4);
});

test('ADDING_CONTENT.md teaches add-a-room and add-a-wing as data entries, and registerZone stays public', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'ADDING_CONTENT.md'), 'utf8');
  const wings = fs.readFileSync(path.join(__dirname, '..', 'wings.js'), 'utf8');
  assert.match(doc, /## 1\. Add a room/);
  assert.match(doc, /## 2\. Add a whole wing/);
  assert.match(doc, /solveLayout/);
  assert.match(doc, /WING_ZONES/);
  assert.match(doc, /PalaceWings\.registerZone/);
  assert.match(doc, /bounded by \*\*what is near the player\*\*/);
  assert.match(doc, /Do not change `zone-streamer\.js`/);
  assert.match(wings, /registerZone: registerZone/);
  assert.match(wings, /const WING_ZONES = \[/);
});
