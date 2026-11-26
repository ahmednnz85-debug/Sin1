// R3-01 Buried Years Stair: dressing plan, collisions and assets.
// Uses the real three.js r187 when THREE_DIR points at node_modules/three
// (the in-browser checks are tools/r3-stair-tour.cjs); otherwise skipped.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const THREE_DIR = process.env.THREE_DIR;
const skip = !THREE_DIR || !fs.existsSync(path.join(THREE_DIR, 'build/three.module.js'));

async function mount() {
  const THREE = await import(path.join(THREE_DIR, 'build/three.module.js'));
  const window = { console, performance };
  const ctx = vm.createContext({ window, console, performance, Math, Set, Map, Promise, JSON, Object, Array, Float32Array, Uint8Array, Error });
  for (const f of ['r3-stair-dressing.js', 'r3-sealed-zone.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx);
  const hall = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/palace-colliders.json'), 'utf8')).hall;
  const passage = hall.passages.find(p => p.id === window.SinR3SealedZone.passageId);
  const origin = new THREE.Vector3(1, 3.75, 183.66);
  const stage = window.SinR3SealedZone.mount(THREE, passage, hall, origin);
  return { THREE, stage, window, passage, hall, origin };
}

test('R3-01 dressing: plan, walkable path, collisions', { skip }, async () => {
  const { stage, window, passage } = await mount();
  assert.ok(stage.stair, 'stair dressing created');
  const plan = stage.stair.report().layout;
  assert.ok(plan.items >= 30 && plan.roots >= 10, JSON.stringify(plan));
  assert.ok(stage.cost.geometryBytes <= stage.budget.geometryBytes);
  assert.ok(stage.cost.batches <= stage.budget.batches);
  assert.ok(stage.budget.stair && stage.budget.stair.textureMiB >= 40);
  // Walk the centre line of both flights and the landings in 0.25 m steps:
  // nothing may block Sîn (capsule 0.32 m) on the authored route.
  const x = u => passage.position[0] - u, z = v => passage.position[2] + v;
  const u0 = passage.position[0] - stage.spawn[0];
  const route = [[u0, 0], [29.8, 0], [33.9, 0], [33.9, 19.8], [33.9, 23.8], [38.2, 23.8]];
  let y = 0, steps = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const [u0, v0] = route[i], [u1, v1] = route[i + 1];
    const n = Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 0.25);
    for (let k = 1; k <= n; k++) {
      const pu = u0 + (u1 - u0) * (k - 1) / n, pv = v0 + (v1 - v0) * (k - 1) / n;
      const u = u0 + (u1 - u0) * k / n, v = v0 + (v1 - v0) * k / n;
      assert.equal(stage.blocks(x(u), z(v), y, x(pu), z(pv), 0.32), false, `blocked at u=${u.toFixed(2)} v=${v.toFixed(2)}`);
      y = stage.nearFloor(x(u), z(v), y).y;
      steps++;
    }
  }
  assert.ok(steps > 150);
  assert.ok(y < -14.9, 'route ends at the lower landing');
  // Lanes 1.4 m either side of each flight's axis stay open (props and
  // guardian pedestals keep to the wall feet: 2.8 m clear + capsule).
  const lane = (pts) => {
    let yy = pts[0][2];
    for (let k = 1; k < pts.length; k++) {
      const [pu, pv] = pts[k - 1], [u, v] = pts[k];
      assert.equal(stage.blocks(x(u), z(v), yy, x(pu), z(pv), 0.32), false, `lane blocked at u=${u.toFixed(2)} v=${v.toFixed(2)}`);
      yy = stage.nearFloor(x(u), z(v), yy).y;
    }
  };
  for (const t of [-1.4, 1.4]) {
    lane(Array.from({ length: 94 }, (_, i) => [u0 + 0.3 + i * 0.25, t, 0]));
    lane(Array.from({ length: 64 }, (_, i) => [33.9 + t, 4 + i * 0.25, -9]));
  }
  // Lights and shafts exist; fog/light blending is bounded.
  assert.ok(stage.stair.lights.length >= 6);
  stage.update(x(10), 0, z(0));
  for (const l of stage.stair.lights) assert.ok(Number.isFinite(l.intensity) && l.intensity >= 0);
  void window;
});

test('R3-01 assets exist and are referenced by real paths', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/r3/stair/manifest.json'), 'utf8'));
  const files = [];
  for (const t of Object.values(m.tiles)) for (const k of ['albedo', 'normal', 'orm']) files.push(t[k].file);
  for (const r of Object.values(m.reliefs)) for (const k of ['albedo', 'normal']) files.push(r[k].file);
  for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  assert.ok(fs.existsSync(path.join(ROOT, 'assets/اصول درج السنين.glb')));
  assert.ok(fs.existsSync(path.join(ROOT, 'assets/r3/stair/props_lod1.glb')));
  const src = fs.readFileSync(path.join(ROOT, 'r3-stair-dressing.js'), 'utf8');
  for (const name of ['worn_tread', 'slab_landing', 'ashlar_wall', 'eroded_vault', 'coursed_rib', 'fluted_pier', 'eroded_block', 'frieze_band', 'dust_rubble'])
    assert.ok(m.tiles[name], 'tile ' + name);
  assert.match(src, /اصول درج السنين\.glb/);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.indexOf('r3-stair-dressing.js') < html.indexOf('r3-sealed-zone.js?'), 'dressing loads before the zone');
});

test('the opened palace door joins the authored stair treads without a cap across the route', { skip }, async () => {
  const { THREE, stage, window, passage, hall, origin } = await mount();
  // Use the preview's real geometry with neutral materials in Node.
  window.SinR3Stair = null;
  const entrance = window.SinR3SealedZone.mount(THREE, passage, hall, origin, { entranceOnly: true });
  const [x, , z] = passage.position;
  assert.ok(entrance.root.getObjectByName('Treads'));
  assert.ok(entrance.cost.geometryBytes < 0.2 * 1024 * 1024);
  const samples = [];
  for (let u = entrance.start - 0.6; u < entrance.handoff + 0.1; u += 0.05) {
    assert.equal(entrance.blocks(x - u, z, x - u + 0.05, z, 0.32), false, `stair entrance blocked at ${u}`);
    const floor = entrance.floorAt(x - u, z);
    if (!floor) continue;
    assert.equal(floor.y, stage.nearFloor(x - u, z, floor.y).y);
    samples.push(floor.y);
  }
  assert.ok(Math.min(...samples) < -0.4);
  assert.ok(entrance.crossed(x - entrance.handoff - 0.05, z));
  assert.ok(entrance.blocks(x - entrance.start - 0.2, z + 3.6, x - entrance.start + 0.2, z, 0.32));
});
