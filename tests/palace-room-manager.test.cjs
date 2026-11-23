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

test('constrained devices only follow the heading prediction (no speculative swaps)', () => {
  const m = M.create({ streamed, constrained: true });
  const r = m.update({ now: 0, heroRegion: 'T1', origin: 'T1', sight: new Set(['T2','T3']), predicted: ['T2'],
    distances: new Map([['T2', 10], ['T3', 28], ['L1', 12]]), status: statusFrom({ T1: 'ready' }) });
  assert.deepEqual(Array.from(r.sight), []);
  assert.deepEqual(Array.from(r.approach), ['T2'], 'no speculative distance prefetch (L1 at 12 m) on a phone');
  assert.equal(r.retained.size, 0);
  assert.equal(r.keep.size, 0);
  assert.deepEqual(m.report().sight, ['T2', 'T3'], 'sight is still reported for diagnostics');
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
  assert.ok(!r.keep.has('K2'));
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
