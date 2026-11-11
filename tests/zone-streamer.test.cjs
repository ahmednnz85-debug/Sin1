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

test('a zone whose download fails is still revealed after its timeout', async () => {
  const scene = obj('scene'); const g = obj('Z'); scene.add(g);
  const s = Z.create();
  s.register({ id: 'Z', timeoutMs: 0, load() { /* never completes */ } });
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
