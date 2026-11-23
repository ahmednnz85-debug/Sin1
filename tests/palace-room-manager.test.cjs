'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../palace-room-manager.js');
const Routes = require('../palace-routes.js');

const ROOMS = ['K1','K2','K3','K4','K5','T1','T2','T3','T4','T5','L1','L2','L3','L4'];
const streamed = new Set(ROOMS.filter(id => id !== 'K1'));

function statusFrom(map) { return id => map[id] || 'cold'; }

test('the hero and camera region are always drawn, even if culling dropped them', () => {
  const m = M.create({ streamed });
  const r = m.update({ now: 0, heroRegion: 'T2', camRegion: 'TC12', origin: 'T2', drawn: new Set(['T3']),
    status: statusFrom({ T2: 'ready', T3: 'ready' }) });
  assert.ok(r.shown.has('T2'));
  assert.ok(r.shown.has('TC12'));
  assert.ok(r.shown.has('T3'));
});

test('visibility hysteresis: a ready room lingers briefly, then hides; never for unready rooms', () => {
  const m = M.create({ streamed, lingerMs: 400 });
  const status = statusFrom({ T2: 'ready', T3: 'ready', T4: 'loading' });
  m.update({ now: 0, heroRegion: 'T2', origin: 'T2', drawn: new Set(['T3', 'T4']), status });
  let r = m.update({ now: 200, heroRegion: 'T2', origin: 'T2', drawn: new Set(), status });
  assert.ok(r.shown.has('T3'), 'camera swing must not drop T3 at once');
  assert.ok(r.lingering.has('T3'));
  assert.ok(!r.shown.has('T4'), 'an unready room is never forced visible');
  r = m.update({ now: 700, heroRegion: 'T2', origin: 'T2', drawn: new Set(), status });
  assert.ok(!r.shown.has('T3'));
});

test('sight demand: a room visible through an open arch but not ready is requested and retained', () => {
  const m = M.create({ streamed });
  const r = m.update({ now: 0, heroRegion: 'T1', origin: 'T1', sight: new Set(['T1','TC12','T2','TC23','T3']),
    distances: new Map([['T2', 10], ['T3', 28]]), status: statusFrom({ T1: 'ready', T2: 'cold', T3: 'cold' }) });
  assert.deepEqual(Array.from(r.sight), ['T2', 'T3']);
  assert.ok(r.retained.has('T2') && r.retained.has('T3'));
  assert.equal(r.rank.get('T2'), 1);
});

test('phone: nearest seen room ranked first but not hard-protected; one prefetch only; evictable cooldown', () => {
  const m = M.create({ streamed, constrained: true });
  const r = m.update({ now: 0, heroRegion: 'T1', origin: 'T1', sight: new Set(['T2','T3']), predicted: ['T2'],
    distances: new Map([['T2', 10], ['T3', 28], ['L1', 12]]), status: statusFrom({ T1: 'ready' }) });
  assert.deepEqual(Array.from(r.sight), ['T2'], 'nearest seen room only');
  assert.equal(r.retained.size, 0, 'the current room can always reclaim memory on a phone');
  assert.equal(r.rank.get('T2'), 1);
  assert.ok(!r.approach.has('L1'), 'no distance prefetch while a seen/predicted room is still preparing');
  assert.deepEqual(m.report().sight, ['T2', 'T3'], 'all seen rooms are reported for diagnostics');
  assert.equal(m.options.cooldownMs, 15000);
});

test('heading prediction stays sticky for a few seconds (no L3/L4 flip-flop)', () => {
  const m = M.create({ streamed });
  m.update({ now: 0, heroRegion: 'L1', origin: 'L1', predicted: ['L3'], status: statusFrom({ L1: 'ready' }) });
  let r = m.update({ now: 1500, heroRegion: 'L1', origin: 'L1', predicted: ['L4'], status: statusFrom({ L1: 'ready' }) });
  assert.ok(r.approach.has('L3') && r.approach.has('L4'));
  assert.equal(r.rank.get('L3'), 2);
  r = m.update({ now: 4000, heroRegion: 'L1', origin: 'L1', predicted: ['L4'], status: statusFrom({ L1: 'ready' }) });
  assert.ok(!r.approach.has('L3') || r.rank.get('L3') !== 2);
});

test('distance prefetch prepares connected rooms before the player reaches the door', () => {
  const m = M.create({ streamed, prefetchMetres: 30 });
  const r = m.update({ now: 0, heroRegion: 'K1', origin: 'K1', motion: { vx: 0, vz: 0 },
    distances: new Map([['K2', 25], ['K5', 60], ['K3', 70]]), status: statusFrom({}) });
  assert.ok(r.approach.has('K2'));
  assert.ok(!r.approach.has('K5'));
  // Running fast widens the horizon by the room's preparation lead time.
  const fast = m.update({ now: 16, heroRegion: 'K1', origin: 'K1', motion: { vx: 7, vz: 0 }, leadSec: () => 6,
    distances: new Map([['K2', 25], ['K5', 55], ['K3', 70]]), status: statusFrom({}) });
  assert.ok(fast.approach.has('K5'));
});

test('cooldown keeps a room just left resident (no reload on turn-back), not under memory pressure', () => {
  const m = M.create({ streamed, cooldownMs: 5000 });
  const st = statusFrom({ K2: 'ready', K3: 'ready' });
  m.update({ now: 0, heroRegion: 'K2', origin: 'K2', status: st });
  let r = m.update({ now: 3000, heroRegion: 'K3', origin: 'K3', status: st });
  assert.ok(r.keep.has('K2'));
  assert.ok(!r.retained.has('K2'), 'cooldown never hard-protects a room from the memory budget');
  assert.equal(r.rank.get('K2'), 4);
  assert.equal(m.state('K2'), 'COOLDOWN');
  r = m.update({ now: 3500, heroRegion: 'K3', origin: 'K3', status: st, memoryLevel: 'watch' });
  assert.ok(r.keep.has('K2'), 'cooldown rooms stay (evictable) under watch');
  r = m.update({ now: 3600, heroRegion: 'K3', origin: 'K3', status: st, memoryLevel: 'critical' });
  assert.ok(!r.keep.has('K2'), 'dropped under critical');
  r = m.update({ now: 9000, heroRegion: 'K3', origin: 'K3', status: st });
  assert.ok(!r.keep.has('K2'));
});

test('lifecycle states cover UNLOADED / PREPARING / READY / ACTIVE / VISIBLE', () => {
  const m = M.create({ streamed, cooldownMs: 0 });
  m.update({ now: 0, heroRegion: 'K2', origin: 'K2', drawn: new Set(['K2']), predicted: ['K3'],
    status: statusFrom({ K2: 'ready', K3: 'uploading', K4: 'ready', K5: 'cold' }) });
  assert.equal(m.state('K2'), 'VISIBLE');
  assert.equal(m.state('K3'), 'PREPARING');
  assert.equal(m.state('K4'), 'READY');
  assert.equal(m.state('K5'), 'UNLOADED');
  assert.ok(m.report().transitions.length > 0);
});

test('frame statistics report P50 / P95 / P99', () => {
  const f = M.frameStats(100);
  for (let i = 1; i <= 100; i++) f.push(i);
  const s = f.summary();
  assert.equal(s.p50, 51);
  assert.equal(s.p95, 96);
  assert.equal(s.p99, 100);
});

test('palace routes give walking distances through portal centres', () => {
  const regions = [
    { id: 'A', bbox: { x0: 0, z0: 0, x1: 10, z1: 10 } },
    { id: 'B', bbox: { x0: 10, z0: 0, x1: 20, z1: 10 } },
    { id: 'C', bbox: { x0: 20, z0: 0, x1: 30, z1: 10 } }
  ];
  const r = Routes.create(regions, [['A', 'B', 'ab'], ['B', 'C', 'bc']], []);
  const d = r.pathDistances('A', 5, 5);
  assert.equal(Math.round(d.get('B')), 5);
  assert.equal(Math.round(d.get('C')), 15);
  assert.deepEqual(r.neighbours('B').sort(), ['A', 'C']);
});

test('streamer: a sight-line room displaces a lower-priority resident room, never an equal one', () => {
  const Z = require('../zone-streamer.js');
  let mb = 0;
  const s = Z.create({ processBudgetMB: 1400, estimate: () => ({ processMB: mb, gpuMB: 0, cpuMB: 0 }),
    defaultZoneProcessMB: 100, defaultZoneGpuMB: 0, defaultZoneCpuMB: 0 });
  const loaded = new Set();
  for (const id of ['A', 'B', 'C']) s.register({ id, load(api) { loaded.add(id); mb += 100; api.done(); }, unload() { mb -= 100; loaded.delete(id); } });
  const run = view => { for (let i = 0; i < 4; i++) s.update(Object.assign({ distances: new Map(), motionPrefetch: true }, view)); };
  mb = 1250;
  run({ current: 'X', approach: new Set(['A']), rank: new Map([['A', 3]]) });
  assert.equal(s.status('A'), 'ready');
  // B has the same rank and does not fit: it must wait, A stays.
  run({ current: 'X', approach: new Set(['A', 'B']), rank: new Map([['A', 3], ['B', 3]]) });
  assert.equal(s.status('A'), 'ready');
  assert.equal(s.status('B'), 'cold');
  // C is in the camera's sight line (rank 1): A yields.
  run({ current: 'X', approach: new Set(['A', 'C']), retained: new Set(['C']), rank: new Map([['A', 3], ['C', 1]]) });
  assert.equal(s.status('C'), 'ready');
  assert.equal(s.status('A'), 'cold');
});

test('closed doors: the region holding the door reveal stays drawn when the camera faces the door', () => {
  const Vis = require('../wing-visibility.js');
  const regions = [
    { id: 'K3', bbox: { x0: 0, z0: 0, x1: 10, z1: 10 } },
    { id: 'KC3', bbox: { x0: 10, z0: 3, x1: 11, z1: 7 } }
  ];
  const door = { id: 'K3-KC3', from: 'K3', to: 'KC3', x: 10.5, z: 5, axis: 'x', width: 4.5, thickness: 1 };
  const r = Routes.create(regions, [['K3', 'KC3', 'K3-KC3']], [door]);
  const facing = { x: 4, z: 5, dirX: 1, dirZ: 0, halfFov: 0.6 };
  const away = { x: 4, z: 5, dirX: -1, dirZ: 0, halfFov: 0.6 };
  const closed = () => false;
  assert.deepEqual(Array.from(r.closedFrames('K3', facing, Vis.throughOpenings, closed)), ['KC3']);
  assert.equal(r.closedFrames('K3', away, Vis.throughOpenings, closed).size, 0);
  assert.equal(r.closedFrames('K3', facing, Vis.throughOpenings, () => true).size, 0, 'open doors are handled by the portal flood');
});

test('streamer: the current room preempts a speculative serial preparation', () => {
  const Z = require('../zone-streamer.js');
  const s = Z.create({ processBudgetMB: 0 });
  const started = [];
  for (const id of ['A', 'B']) s.register({ id, requireComplete: true, serialPreparation: true, load() { started.push(id); } });
  s.update({ current: 'X', approach: new Set(['A']), rank: new Map([['A', 3]]), distances: new Map(), motionPrefetch: true });
  assert.equal(s.status('A'), 'loading');
  s.update({ current: 'B', approach: new Set(['A']), rank: new Map([['A', 3]]), distances: new Map(), motionPrefetch: true });
  assert.equal(s.status('B'), 'loading');
  assert.equal(s.status('A'), 'cold');
});

test('no speculative prefetch while the room the hero stands in is not ready', () => {
  const m = M.create({ streamed, prefetchMetres: 40 });
  const r = m.update({ now: 0, heroRegion: 'T2', origin: 'T2', distances: new Map([['T1', 15], ['T3', 20]]),
    status: statusFrom({ T2: 'failed' }) });
  assert.equal(r.approach.size, 0);
});

// ---- zone-streamer: measured costs, byte pressure, door demand, reserve ----
function fakeStreamer(opts) {
  const Z = require('../zone-streamer.js');
  const st = { mb: opts.base, loaded: new Set() };
  const s = Z.create(Object.assign({ processBudgetMB: 650, gpuBudgetMB: 0, cpuBudgetMB: 0,
    estimate: () => ({ processMB: st.mb, gpuMB: 0, cpuMB: 0 }) }, opts.streamer || {}));
  for (const [id, real, est] of opts.rooms) {
    s.register({ id, requireComplete: true, serialPreparation: true, estProcessMB: est, estGpuMB: 0, estCpuMB: 0,
      load(api) { st.loaded.add(id); st.mb += real; api.done(); }, unload() { if (st.loaded.delete(id)) st.mb -= real; } });
  }
  return { s, st };
}
const run = (s, view, n = 4) => { for (let i = 0; i < n; i++) s.update(Object.assign({ distances: new Map(), motionPrefetch: true }, view)); };

test('streamer learns real room costs and stops stacking on an under-declared room', () => {
  const store = { v: null, load() { return this.v; }, save(v) { this.v = v; } };
  const { s, st } = fakeStreamer({ base: 400, rooms: [['K5', 205, 48], ['K4', 60, 50]], streamer: { costStore: store } });
  run(s, { current: 'K5' });
  assert.equal(s.status('K5'), 'ready');
  st.mb += 0; s.update({ current: 'K5', distances: new Map(), motionPrefetch: true });
  // two fresh samples settle the measurement
  st.mb += 0.5; s.report(); st.mb -= 0.5; s.report();
  assert.ok(store.v && store.v.K5 && store.v.K5.processMB >= 200, JSON.stringify(store.v));
  // a predicted K4 (rank 2) would now exceed 650 with K5's real cost: deferred, nothing evicted.
  run(s, { current: 'K5', approach: new Set(['K4']), rank: new Map([['K4', 2]]) });
  assert.equal(s.status('K4'), 'cold');
  assert.equal(s.status('K5'), 'ready');
  // A new session starts with the stored measurement.
  const again = fakeStreamer({ base: 400, rooms: [['K5', 205, 48]], streamer: { costStore: store } });
  assert.ok(again.s.report().measuredCost.K5.processMB >= 200);
});

test('streamer: the current room is admitted even when it cannot fit; nothing stacks on it', () => {
  const { s } = fakeStreamer({ base: 560, rooms: [['K5', 205, 210], ['K4', 30, 30]] });
  run(s, { current: 'K5' });
  assert.equal(s.status('K5'), 'ready', 'never leave the hero in an empty room');
  assert.equal(s.report().stats.overBudgetAdmits, 1);
  run(s, { current: 'K5', approach: new Set(['K4']), rank: new Map([['K4', 2]]) });
  assert.equal(s.status('K4'), 'cold');
});

test('streamer: a door waiting for a room admits it like the current room (no deadlock)', async () => {
  const { s } = fakeStreamer({ base: 560, rooms: [['L1', 124, 124]] });
  run(s, { current: 'LC2', approach: new Set(['L1']), rank: new Map([['L1', 2]]) });
  assert.equal(s.status('L1'), 'cold', 'a plain prediction stays within the budget');
  const door = { current: 'LC2', approach: new Set(['L1']), rank: new Map([['L1', 2]]), doorDemand: 'L1' };
  run(s, door);
  assert.equal(s.status('L1'), 'cold', 'first waits briefly for a visible room to leave the view');
  await new Promise(r => setTimeout(r, 1600));
  run(s, door);
  assert.equal(s.status('L1'), 'ready');
});

test('streamer: memory pressure is measured in bytes, not texture count', () => {
  const Z = require('../zone-streamer.js');
  let mb = 500;
  const s = Z.create({ processBudgetMB: 650, estimate: () => ({ processMB: mb, gpuMB: 0, cpuMB: 0 }), textureBudget: 72 });
  // 120 textures used to mean "critical" on a phone regardless of bytes.
  assert.equal(s.sample({ info: { memory: { textures: 120, geometries: 10 } } }, 16).level, 'normal');
  mb = 600; assert.equal(s.sample({ info: { memory: { textures: 120 } } }, 16).level, 'watch');
  mb = 640; assert.equal(s.sample({ info: { memory: { textures: 120 } } }, 16).level, 'critical');
});

test('streamer.reserve frees least important finished rooms for the throne hall, never the current or visible one', () => {
  const { s } = fakeStreamer({ base: 300, rooms: [['K2', 90, 90], ['K3', 60, 60], ['K4', 30, 30]] });
  run(s, { current: 'K2', approach: new Set(['K3', 'K4']), rank: new Map([['K3', 2], ['K4', 3]]) }, 12);
  assert.equal(s.status('K3'), 'ready'); assert.equal(s.status('K4'), 'ready');
  run(s, { current: 'K2', visible: new Set(['K3']), keep: new Set(['K4']), rank: new Map([['K4', 4]]) }, 1);
  assert.equal(s.reserve(238, 'hall-restore'), false, 'cannot fit 238 MB without the current/visible rooms');
  assert.equal(s.status('K4'), 'cold', 'cooldown room yielded');
  assert.equal(s.status('K3'), 'ready', 'visible room kept');
  assert.equal(s.status('K2'), 'ready', 'current room kept');
});
