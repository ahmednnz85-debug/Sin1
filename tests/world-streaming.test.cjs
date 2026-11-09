const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../world-streaming-core.js');

const box = (x0, z0, x1, z1) => ({ x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 });
const Vis = require('../wing-visibility.js');

test('predictor reports no lead while standing still', () => {
  const p = Core.createPredictor();
  for (let i = 0; i < 30; i++) p.sample(0, 0, 1 / 60);
  const s = p.state();
  assert.equal(s.moving, false);
  assert.equal(s.lead, 0);
});

test('predictor produces a bounded lead in the travel direction when sprinting', () => {
  const p = Core.createPredictor();
  let z = 0;
  for (let i = 0; i < 120; i++) { z += 8.5 / 60; p.sample(0, z, 1 / 60); }   // sprint 8.5 m/s
  const s = p.state();
  assert.ok(s.moving);
  assert.ok(s.lead > 5, 'lead must be meaningful at sprint speed: ' + s.lead);
  assert.ok(s.lead <= 22, 'lead must stay inside the cap: ' + s.lead);
  assert.ok(Math.abs(s.dirZ - 1) < 0.05, 'direction follows the movement: ' + s.dirZ);
});

test('predictor lead collapses when the player stops', () => {
  const p = Core.createPredictor();
  let z = 0;
  for (let i = 0; i < 60; i++) { z += 0.14; p.sample(0, z, 1 / 60); }
  for (let i = 0; i < 90; i++) p.sample(0, z, 1 / 60);
  assert.equal(p.state().lead, 0);
});

test('iOS profile is tighter than desktop and never assumes unlimited memory', () => {
  const ios = Core.createMemoryBudget({ device: 'ios' }).profile;
  const desk = Core.createMemoryBudget({ device: 'desktop' }).profile;
  assert.ok(ios.geometryBudget < desk.geometryBudget);
  assert.ok(ios.textureBudget < desk.textureBudget);
  assert.ok(ios.cacheSlots <= 3);
});

test('memory budget escalates to critical and recovers to normal', () => {
  const b = Core.createMemoryBudget({ device: 'ios' });
  const crit = b.sample({ memory: { geometries: 400, textures: 200 } }, 60, 16);
  assert.equal(crit.level, 'critical');
  assert.ok(crit.pressure >= 0.97);
  assert.equal(b.cacheSlots(), 1);
  for (let i = 0; i < 200; i++) b.sample({ memory: { geometries: 20, textures: 10 } }, 12, 16);
  assert.equal(b.state().level, 'normal');
  assert.equal(b.cacheSlots(), b.profile.cacheSlots);
});

test('region cache keeps recently seen rooms and evicts beyond its slots', () => {
  const c = Core.createRegionCache({ slots: 2 });
  c.touch('K2', 0); c.touch('K3', 10); c.touch('K4', 20);
  const res = c.resident(20);
  assert.ok(c.isHot('K4'));
  assert.ok(c.isHot('K3'));
  assert.equal(c.isHot('K2'), false, 'oldest region must be evicted');
  assert.equal(res.size, 2);
});

test('region cache hit means no reload on a return trip', () => {
  const c = Core.createRegionCache({ slots: 3 });
  c.touch('K2', 0);
  assert.equal(c.noteLookup('K2'), true);
  assert.equal(c.noteLookup('K5'), false);
  const r = c.report();
  assert.equal(r.hits, 1);
  assert.equal(r.misses, 1);
});

test('scheduler never exceeds its per-frame time slice', () => {
  const s = Core.createScheduler({ sliceMs: 2, maxTasksPerFrame: 8 });
  let ran = 0;
  for (let i = 0; i < 20; i++) s.push({ run: () => { const t = Date.now(); while (Date.now() - t < 1); ran++; } }, 2);
  const out = s.runFrame(0, 2);
  assert.ok(out.sliceMs <= 6, 'slice stayed bounded: ' + out.sliceMs);
  assert.ok(out.ran >= 1 && ran >= 1);
  assert.ok(out.pending > 0, 'remaining work stays queued for later frames');
});

test('scheduler drains camera-visible work before background work', () => {
  const s = Core.createScheduler({ sliceMs: 50 });
  const order = [];
  s.push({ run: () => order.push('bg') }, 2);
  s.push({ run: () => order.push('visible') }, 0);
  s.runFrame(0, 50);
  assert.equal(order[0], 'visible', 'visible work goes first: ' + JSON.stringify(order));
});

test('a failed task is retried then dropped, never blocking the queue', () => {
  const s = Core.createScheduler({ sliceMs: 50 });
  let tries = 0;
  s.push({ run: () => { tries++; throw new Error('boom'); } }, 0);
  for (let i = 0; i < 5; i++) s.runFrame(0, 50);
  assert.ok(tries >= 3);
  assert.equal(s.report().pending, 0);
});

test('shared resource is not disposed while another region still uses it', () => {
  const r = Core.createResourceRegistry();
  let disposed = 0;
  const geo = { dispose() { disposed++; } };
  r.acquire(geo, 'K2');
  r.acquire(geo, 'K3');
  assert.equal(r.users(geo), 2);
  r.release(geo, 'K2');
  assert.equal(r.disposeIfUnused(geo, null), false);
  assert.equal(disposed, 0, 'geometry shared with K3 must survive');
  r.release(geo, 'K3');
  assert.equal(r.disposeIfUnused(geo, null), true);
  assert.equal(disposed, 1);
});

test('registry never disposes a resource that is live in a visible region', () => {
  const r = Core.createResourceRegistry();
  let disposed = 0;
  const tex = { isTexture: true, dispose() { disposed++; } };
  r.acquire(tex, 'K4');
  r.release(tex, 'K4');
  assert.equal(r.disposeIfUnused(tex, new Set([tex])), false);
  assert.equal(disposed, 0);
});

test('texture policy lowers cost with distance but never disables mipmaps', () => {
  const t = Core.createTexturePolicy({ maxAnisotropy: 4 });
  const near = t.level(2, 0), mid = t.level(30, 2), far = t.level(200, 2);
  assert.equal(near.anisotropy, 4);
  assert.ok(mid.anisotropy <= 2);
  assert.equal(far.anisotropy, 1);
  assert.equal(far.deferUpload, true);
  [near, mid, far].forEach(l => assert.equal(l.mipmaps, true, 'mipmaps always on'));
});

test('LOD ladder is monotonic in distance and has hysteresis', () => {
  const l = Core.createLodPolicy({ distances: [12, 30, 70], hysteresis: 0.12 });
  assert.equal(l.level('a', 5), 0);
  assert.equal(l.level('a', 20), 1);
  assert.equal(l.level('a', 40), 2);
  assert.equal(l.level('a', 31), 2, 'just below the boundary must not flap back');
  assert.equal(l.level('a', 5), 0);
  assert.equal(l.hlod(200), true);
});

test('prefetch never prepares a room that has no portal path', () => {
  const regions = [
    { id: 'A', bbox: box(-3, -6, 3, 0) },
    { id: 'C', bbox: box(-1, 0, 1, 40) },
    { id: 'S', bbox: box(2, 10, 12, 20) }        // sealed, no link
  ];
  const reach = new Map([['A', 0], ['C', 1], ['S', Infinity]]);
  const plan = Core.planPrefetch({
    regions, reach,
    cam: { x: 0, z: -1, dirX: 0, dirZ: 1, halfFov: 0.6 },
    lead: 12, visibility: Vis
  });
  assert.ok(plan.prepared.has('C'));
  assert.equal(plan.prepared.has('S'), false);
});

test('prediction widens the prepared set, never the visible set', () => {
  const regions = [
    { id: 'A', bbox: box(-3, -6, 3, 0) },
    { id: 'Q', bbox: box(14, 30, 20, 36) }
  ];
  const reach = new Map([['A', 0], ['Q', 1]]);
  const cam = { x: 0, z: 0, dirX: 0, dirZ: 1, halfFov: 0.30 };
  const slow = Core.planPrefetch({ regions, reach, cam, lead: 0, visibility: Vis });
  const fast = Core.planPrefetch({ regions, reach, cam, lead: 18, visibility: Vis });
  assert.equal(slow.visible.has('Q'), fast.visible.has('Q'), 'visible set is lead-independent');
  assert.ok(fast.prepared.has('Q'), 'a sprinting player gets the next room ready');
});
