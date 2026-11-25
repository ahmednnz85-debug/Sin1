'use strict';
// Fixed palace light budget (light-rig.js): the per-type light counts that
// three.js bakes into every shader program never change when rooms appear,
// leave the view or unload, so no program is rebuilt in front of the player.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../light-rig.js');

// Minimal scene graph with the three.js light flags the rig reads.
class Node {
  constructor(name) { this.name = name || ''; this.children = []; this.parent = null; this.visible = true; this.userData = {}; this.layers = { test: () => true }; }
  add(...objs) { objs.forEach(o => { if (o.parent) o.parent.remove(o); o.parent = this; this.children.push(o); }); return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); o.parent = null; return this; }
  traverse(fn) { fn(this); this.children.slice().forEach(c => c.traverse(fn)); }
  clone() { const c = new this.constructor(); Object.assign(c, this, { children: [], parent: null, userData: { ...this.userData } }); return c; }
}
const shadow = () => ({ mapSize: { set() {} }, autoUpdate: true, needsUpdate: false });
class Light extends Node { constructor(color, intensity) { super(); this.isLight = true; this.castShadow = false; this.intensity = intensity == null ? 1 : intensity; this.position = { set() {} }; } }
class PointLight extends Light { constructor(c, i) { super(c, i); this.isPointLight = true; this.shadow = shadow(); } }
class SpotLight extends Light { constructor(c, i) { super(c, i); this.isSpotLight = true; this.shadow = shadow(); this.map = null; this.target = new Node('target'); this.target.position = { set() {} }; } }
class DirectionalLight extends Light { constructor(c, i) { super(c, i); this.isDirectionalLight = true; this.shadow = shadow(); this.target = new Node('target'); this.target.position = { set() {} }; } }
class HemisphereLight extends Light { constructor(a, b, i) { super(a, i); this.isHemisphereLight = true; } }
class Scene extends Node { constructor() { super('scene'); this.isScene = true; this.fog = null; this.environment = null; } }
const THREE = { Group: Node, Scene, PointLight, SpotLight, DirectionalLight, HemisphereLight, DataTexture: class { constructor() { this.isTexture = true; } } };

const targets = { point: 6, pointShadow: 0, spot: 2, spotShadow: 1, spotMap: 0, spotShadowMap: 1, dir: 2, dirShadow: 1, hemi: 2, rect: 0, probe: 0 };
const KEY = ['point', 'pointShadow', 'spot', 'spotShadow', 'spotMap', 'spotShadowMap', 'dir', 'dirShadow', 'hemi'];
// What three.js puts in the program key, from the lights it would collect.
function programKey(scene) {
  const n = { point: 0, pointSh: 0, spot: 0, spotSh: 0, spotMaps: 0, spotShMaps: 0, dir: 0, dirSh: 0, hemi: 0 };
  scene.traverse(o => {
    if (!o.isLight) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    if (o.isPointLight) { n.point++; if (o.castShadow) n.pointSh++; }
    if (o.isSpotLight) { n.spot++; if (o.castShadow) n.spotSh++; if (o.map) n.spotMaps++; if (o.map && o.castShadow) n.spotShMaps++; }
    if (o.isDirectionalLight) { n.dir++; if (o.castShadow) n.dirSh++; }
    if (o.isHemisphereLight) n.hemi++;
  });
  return JSON.stringify(n);
}
function room(spec) {
  const g = new Node('room');
  for (let i = 0; i < (spec.point || 0); i++) g.add(new PointLight());
  for (let i = 0; i < (spec.spot || 0); i++) g.add(new SpotLight());
  if (spec.sun) { const s = new SpotLight(); s.castShadow = true; s.map = {}; g.add(s); }
  if (spec.hemi) g.add(new HemisphereLight());
  return g;
}

test('the program key is identical whatever rooms are drawn, loaded or unloaded', () => {
  const rig = L.create(THREE, { targets, log: () => {} });
  const scene = new Scene();
  const hall = room({ point: 2, hemi: 1 }); const sun = new DirectionalLight(); sun.castShadow = true; hall.add(sun); scene.add(hall);
  rig.install(scene);
  rig.apply(null);
  const key = programKey(scene);
  const library = room({ point: 2, sun: true, hemi: 1 });
  scene.add(library); rig.track(library); rig.apply(null);
  assert.equal(programKey(scene), key, 'room with its own braziers, skylight sun and local ambient');
  library.visible = false; rig.apply(null);
  assert.equal(programKey(scene), key, 'room culled by the portals');
  const temple = room({ point: 1, spot: 2 }); scene.add(temple); rig.track(temple); library.visible = true; rig.apply(null);
  assert.equal(programKey(scene), key, 'two rooms drawn together');
  scene.remove(library); rig.apply(null);
  assert.equal(programKey(scene), key, 'room unloaded');
  sun.castShadow = false; rig.apply(null);
  assert.equal(programKey(scene), key, 'a shadow toggled off by the quality governor');
  assert.equal(rig.report().overflows, 0);
});

test('pads emit no light and a view beyond the budget falls back to plain three.js once', () => {
  const logs = [];
  const rig = L.create(THREE, { targets, log: m => logs.push(m) });
  const scene = new Scene(); rig.install(scene);
  const pads = [];
  scene.traverse(o => { if (o.userData.sinLightPad) pads.push(o); });
  assert.ok(pads.length > 0);
  assert.ok(pads.every(p => p.intensity === 0), 'every pad has zero intensity (zero colour uniform)');
  const crowd = room({ point: 9 }); scene.add(crowd); rig.track(crowd);
  rig.apply(null);
  assert.ok(pads.filter(p => p.isPointLight).every(p => !p.visible), 'no point pads once the real lights exceed the budget');
  assert.equal(rig.report().overflows, 1);
  rig.apply(null);
  assert.equal(rig.report().overflows, 1, 'logged once per kind');
  assert.ok(logs.some(m => /point 9>6/.test(m)));
});

test('compile target carries exactly the fixed layout and the real fog / environment', () => {
  const rig = L.create(THREE, { targets, log: () => {} });
  const scene = new Scene(); scene.fog = { isFog: true }; scene.environment = { isTexture: true };
  rig.install(scene);
  const cfg = rig.compileScene(scene);
  assert.equal(cfg.fog, scene.fog); assert.equal(cfg.environment, scene.environment);
  const counts = {};
  cfg.traverse(o => { const k = L.category(o); if (k) counts[k] = (counts[k] || 0) + 1; });
  for (const k of KEY) assert.equal(counts[k] || 0, targets[k], k);
  // A room's own lights are hidden while it is compiled against the layout.
  const g = room({ point: 3 }); let seen = -1;
  rig.compile({ compile(obj) { seen = 0; obj.traverse(o => { if (o.isLight && o.visible) seen++; }); } }, g, {});
  assert.equal(seen, 0);
  assert.ok(g.children.every(l => l.visible), 'restored after compile');
});

test('evicted rooms are forgotten (no reference keeps a disposed room alive)', () => {
  const rig = L.create(THREE, { targets, log: () => {} });
  const scene = new Scene(); rig.install(scene);
  const r = room({ point: 3 }); scene.add(r); rig.track(r); rig.apply(null);
  assert.equal(rig.report().lights, 3);
  scene.remove(r); rig.apply(null);
  assert.equal(rig.report().lights, 0);
});

test('the shader skips a zero-colour light before any per-pixel work, for every light loop', () => {
  const chunk = { lights_fragment_begin: fs.readFileSync(path.join(__dirname, 'fixtures', 'lights_fragment_begin.r187.glsl'), 'utf8') };
  assert.equal(L.patchShaderChunks({ ShaderChunk: chunk }), true);
  const src = chunk.lights_fragment_begin;
  for (const c of ['pointLight.color', 'spotLight.color', 'directionalLight.color']) assert.match(src, new RegExp('if \\( ' + c.replace('.', '\\.') + ' != vec3\\( 0\\.0 \\) \\) \\{'));
  // three.js unrolls "for (...) { BODY }\n#pragma unroll_loop_end": the added
  // brace must close inside the body, before the loop's own brace.
  const unroll = /#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\w+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;
  let m, bodies = 0;
  while ((m = unroll.exec(src))) { bodies++; const b = m[3]; assert.equal((b.match(/{/g) || []).length, (b.match(/}/g) || []).length, 'balanced braces in an unrolled body'); }
  assert.ok(bodies >= 4);
});

test('the palace installs the rig on the live renderer before the entry shader warm-up', () => {
  const pi = fs.readFileSync(path.join(__dirname, '..', 'palaceInterior.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(pi, /SinLightRig\.install\(ctx\.scene, ctx\.renderer\)/);
  assert.ok(pi.indexOf('SinLightRig.install(') < pi.indexOf('SinLightRig.compileScene(ctx.scene)'), 'warm scene uses the fixed layout');
  assert.ok(html.indexOf('light-rig.js') > 0 && html.indexOf('light-rig.js') < html.indexOf('palaceInterior.js'));
  const zs = fs.readFileSync(path.join(__dirname, '..', 'zone-streamer.js'), 'utf8');
  assert.match(zs, /rig\.compile\(r, root, ctx\.camera\)/);
});

test('the budget fits the GPU uniform limit and grows to what this device has shown', () => {
  const full = L.fitTargets(L.DEFAULT_TARGETS, null, 1024);
  assert.ok(L.vectors(full) <= 1024 - 128);
  assert.ok(full.point >= 28 && full.spot >= 6, 'L2 / L4 views (28 point, 6 spot) fit the default budget');
  for (const v of [224, 256]) assert.ok(L.vectors(L.fitTargets(L.DEFAULT_TARGETS, null, v)) <= v - 128, 'uniform limit ' + v);
  const grown = L.fitTargets(L.DEFAULT_TARGETS, { point: 44, spot: 9 }, 1024);
  assert.equal(grown.point, 44); assert.equal(grown.spot, 9);
});
