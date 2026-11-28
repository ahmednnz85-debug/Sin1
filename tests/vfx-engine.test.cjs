// Sîn Advanced VFX Engine — static checks of the data the engine and the lab load.
//   node --test tests/vfx-engine.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const J = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const atlas = J('assets/vfx/atlas.json');
const sets = ['sin-axe', 'guardian', 'surface-impacts'].map(n => J('vfx/effects/' + n + '.json'));
const effects = sets.flatMap(s => s.effects);
const byId = new Map(effects.map(e => [e.id, e]));
const surfaces = sets.find(s => s.surfaces).surfaces;
const bindings = J('vfx/data/combat-bindings.json');
const TYPES = ['trail', 'stream', 'burst', 'sprite', 'shockwave', 'decal', 'debris', 'light', 'shake', 'glow'];
const RAMPS = atlas.textures.ramps.rows;
const RAILS = ['axe', 'staff_crown', 'staff_blade', 'staff_shaft', 'claw_index', 'claw_middle', 'claw_ring'];
const SOCKETS = ['chest_seal', 'claw_r', 'claw_l', 'staff_mid', 'root', 'axe_edge', 'staff_crown', 'staff_blade', 'staff_tip'];

test('every effect requested for Sîn and the Guardian exists', () => {
  const want = ['SIN_AXE_LIGHT_TRAIL', 'SIN_AXE_HEAVY_TRAIL', 'SIN_AXE_COMBO_TRAIL', 'SIN_AXE_FINISHER', 'SIN_AXE_METAL_IMPACT', 'SIN_AXE_GROUND_IMPACT', 'SIN_AXE_LUNAR_BURST', 'SIN_AXE_PARRY', 'SIN_AXE_CHARGE',
    'GUARDIAN_STAFF_LIGHT_TRAIL', 'GUARDIAN_STAFF_HEAVY_TRAIL', 'GUARDIAN_STAFF_BLADE_IMPACT', 'GUARDIAN_STAFF_CROWN_IMPACT', 'GUARDIAN_STAFF_GROUND_SLAM', 'GUARDIAN_STAFF_LEAP_SLAM',
    'GUARDIAN_GOLDEN_SHOCKWAVE', 'GUARDIAN_SPIRITUAL_BURST', 'GUARDIAN_CHEST_SEAL_CHARGE', 'GUARDIAN_ENRAGED_AURA', 'GUARDIAN_CLAW_SLASH'];
  for (const id of want) assert.ok(byId.has(id), id);
});

test('effect ids are unique and layers are well formed', () => {
  assert.equal(byId.size, effects.length, 'duplicate effect id');
  for (const e of effects) {
    assert.ok(e.ar && e.en && e.group && e.duration > 0, e.id + ' header');
    const names = new Set();
    for (const L of e.layers) {
      assert.ok(TYPES.includes(L.type), `${e.id}/${L.name}: type ${L.type}`);
      assert.ok(L.name && !names.has(L.name), `${e.id}: layer name ${L.name}`); names.add(L.name);
      const sprites = [].concat(L.sprite || [], L.sprite2 || [], (L.sparks && L.sparks.sprite) || []);
      for (const s of sprites) assert.ok(atlas.regions[s], `${e.id}/${L.name}: atlas region ${s}`);
      for (const r of [L.ramp, L.sparks && L.sparks.ramp].filter(Boolean)) assert.ok(RAMPS.includes(r), `${e.id}/${L.name}: ramp ${r}`);
      if (L.rails) assert.ok(RAILS.includes(L.rails), `${e.id}/${L.name}: rails ${L.rails}`);
      if (L.socket) assert.ok(SOCKETS.includes(L.socket), `${e.id}/${L.name}: socket ${L.socket}`);
      if (L.type === 'trail') assert.ok(L.rails, `${e.id}/${L.name}: a trail follows weapon rails`);
      if (L.start != null) assert.ok(L.start >= 0 && L.start <= e.duration + 0.001, `${e.id}/${L.name}: start inside the effect`);
    }
    if (e.impactAt != null) assert.ok(e.layers.some(L => Math.abs((L.start || 0) - e.impactAt) < 0.06), e.id + ': a layer fires at impactAt');
  }
});

test('multi-phase slams do not show and hide every layer at once', () => {
  for (const id of ['GUARDIAN_STAFF_GROUND_SLAM', 'GUARDIAN_STAFF_LEAP_SLAM']) {
    const e = byId.get(id);
    const starts = new Set(e.layers.map(L => (L.start || 0).toFixed(2)));
    assert.ok(starts.size >= 5, id + ' staggered starts');
    const kinds = new Set(e.layers.map(L => L.type));
    for (const k of ['glow', 'stream', 'trail', 'burst', 'debris', 'decal', 'shockwave', 'light', 'shake']) assert.ok(kinds.has(k), `${id} has ${k}`);
  }
});

test('surface impact table points at real effects; every surface is described', () => {
  for (const w in surfaces.table) for (const s in surfaces.table[w]) assert.ok(byId.has(surfaces.table[w][s]), `${w}/${s} → ${surfaces.table[w][s]}`);
  for (const s of ['stone', 'metal', 'armor', 'staff', 'wall', 'spirit']) assert.ok(surfaces.materials[s], 'material ' + s);
  const distinct = new Set(Object.values(surfaces.table.axe));
  assert.ok(distinct.size >= 5, 'the axe does not use one effect for every hit');
});

test('combat bindings reference real effects and only the lab uses them', () => {
  for (const who of ['sin', 'guardian']) for (const clip in bindings[who].clips) for (const b of bindings[who].clips[clip]) if (b.effect) assert.ok(byId.has(b.effect), `${who}/${clip} → ${b.effect}`);
  const game = ['index.html', 'sin-hero.js', 'palaceInterior.js', 'r3-sealed-zone.js', 'r3-underworld.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  assert.ok(!/SinVFX|sin-vfx\.js|vfx-lab/.test(game), 'the VFX engine is not wired into the game before approval');
});

test('atlas regions are inside their textures with padding and a half-texel inset', () => {
  for (const [id, r] of Object.entries(atlas.regions)) {
    const tex = atlas.textures[r.tex]; assert.ok(tex, id);
    const [W, H] = tex.size, [x, y, w, h] = r.px;
    assert.ok(x >= 0 && y >= 0 && x + w <= W && y + h <= H, id + ' inside');
    const [u0, v0, u1, v1] = r.uv;
    assert.ok(u0 > x / W && u1 < (x + w) / W && v0 > 1 - (y + h) / H && v1 < 1 - y / H, id + ' inset');
  }
  // no two regions of the same board atlas overlap (padding keeps mips apart); procedural shapes fade to 0 at their cell border
  const list = Object.entries(atlas.regions);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const [a, A] = list[i], [b, B] = list[j]; if (A.tex !== B.tex || A.tex === 'shapes') continue;
    const [ax, ay, aw, ah] = A.px, [bx, by, bw, bh] = B.px;
    const overlap = ax < bx + bw + 4 && bx < ax + aw + 4 && ay < by + bh + 4 && by < ay + ah + 4;
    assert.ok(!overlap, `${a} / ${b} too close`);
  }
  for (const f of ['file', 'low', 'aux']) for (const t of Object.values(atlas.textures)) if (t[f]) assert.ok(fs.existsSync(path.join(ROOT, 'assets/vfx', t[f])), t[f]);
});

test('every element of the three source boards is extracted from its own sheet', () => {
  const sheets = new Set(Object.values(atlas.regions).filter(r => r.source && r.source.sheet).map(r => r.source.sheet));
  assert.deepEqual([...sheets].sort(), ['energy-sheet', 'metal-sparks-sheet', 'stone-cracks-sheet']);
  const n = k => Object.values(atlas.regions).filter(r => r.source && r.source.sheet === k).length;
  assert.ok(n('energy-sheet') >= 38 && n('metal-sparks-sheet') >= 20 && n('stone-cracks-sheet') >= 9);
});

test('GLSL sources exist and the engine reads them by name', () => {
  const engine = fs.readFileSync(path.join(ROOT, 'vfx/sin-vfx.js'), 'utf8');
  const names = /const shaderNames = \[([^\]]+)\]/.exec(engine)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
  for (const n of names) assert.ok(fs.existsSync(path.join(ROOT, 'vfx/shaders', n + '.glsl')), n);
});

test('the lab is reachable from the Developer Hub and keeps no area list', () => {
  const hub = fs.readFileSync(path.join(ROOT, 'dev-hub.js'), 'utf8');
  assert.ok(/vfx-lab\.html/.test(hub));
  const labJs = fs.readFileSync(path.join(ROOT, 'vfx/vfx-lab.js'), 'utf8');
  assert.ok(!/SinAreas|SinDevHub/.test(labJs), 'the lab is not a game area and does not drive the hub');
});
