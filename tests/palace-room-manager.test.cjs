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

test('the camera never starts a load: sight is reported for diagnostics only', () => {
  const m = M.create({ streamed });
  const r = m.update({ now: 0, heroRegion: 'T1', origin: 'T1', sight: new Set(['T1','TC12','T2','TC23','T3']),
    distances: new Map([['T2', 10], ['T3', 140]]), leadSec: () => 4, status: statusFrom({ T1: 'ready', T2: 'cold', T3: 'cold' }) });
  assert.ok(!r.approach.has('T3'), 'T3 is in the camera sight line but 140 m away on foot');
  assert.ok(r.approach.has('T2'), 'T2 is requested because it is 10 m away, not because it is seen');
  assert.equal(r.retained.size, 0);
  assert.deepEqual(m.report().sight.sort(), ['T1', 'T2', 'T3']);
});

test('load radius = run speed x (preparation + pad) + doorway slack, clamped; release adds hysteresis', () => {
  const m = M.create({ streamed, runSpeed: 9.5, leadPadSec: 1, doorMarginM: 4, minLoadM: 22, maxLoadM: 75, hysteresisM: 18 });
  const r = m.update({ now: 0, heroRegion: 'Palace', origin: 'Palace', leadSec: id => ({ L1: 3, T1: 1, K2: 20 })[id] || 3,
    distances: new Map([['L1', 13], ['T1', 40], ['K2', 92]]), status: statusFrom({}) });
  assert.equal(Math.round(r.radius.get('L1')), Math.round(9.5 * 4 + 4));   // 42 m
  assert.equal(Math.round(r.radius.get('T1')), 23);                         // 9.5 x 2 + 4
  assert.equal(r.radius.get('K2'), 75, 'clamped to the device maximum');
  assert.ok(r.approach.has('L1') && !r.approach.has('T1') && !r.approach.has('K2'));
  assert.ok(r.keep.has('T1'), 'inside load + hysteresis: kept if resident, not started');
  assert.equal(r.rank.get('L1'), 13);
});

test('distance prefetch prepares connected rooms before the player reaches the door', () => {
  const m = M.create({ streamed });
  const r = m.update({ now: 0, heroRegion: 'K1', origin: 'K1', motion: { vx: 0, vz: 0 }, leadSec: () => 3,
    distances: new Map([['K2', 25], ['K5', 60], ['K3', 70]]), status: statusFrom({}) });
  assert.ok(r.approach.has('K2'));
  assert.ok(!r.approach.has('K5'));
  // A room that measured a slower preparation is requested from farther away.
  const slow = m.update({ now: 16, heroRegion: 'K1', origin: 'K1', motion: { vx: 0, vz: 0 }, leadSec: () => 6,
    distances: new Map([['K2', 25], ['K5', 55], ['K3', 70]]), status: statusFrom({}) });
  assert.ok(slow.approach.has('K5'));
});

test('a room just left stays resident until the hero passes its release radius, then is released', () => {
  const m = M.create({ streamed, hysteresisM: 18 });
  const st = statusFrom({ K2: 'ready', K3: 'ready' });
  let r = m.update({ now: 0, heroRegion: 'K3', origin: 'K3', leadSec: () => 3, distances: new Map([['K2', 30]]), status: st });
  assert.ok(r.keep.has('K2') && r.approach.has('K2'));
  r = m.update({ now: 100, heroRegion: 'KC1', origin: 'KC1', leadSec: () => 3, distances: new Map([['K2', 50]]), status: st });
  assert.ok(r.keep.has('K2') && !r.approach.has('K2'), 'between the radii: kept, not re-requested');
  assert.equal(m.state('K2'), 'COOLDOWN');
  r = m.update({ now: 200, heroRegion: 'KC2', origin: 'KC2', leadSec: () => 3, distances: new Map([['K2', 70]]), status: st });
  assert.ok(!r.keep.has('K2'), 'beyond the release radius: unloaded');
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

test('streamer (metric): nearest room first; memory is made only from farther rooms', () => {
  const Z = require('../zone-streamer.js');
  let mb = 540;
  const sizes = { A: 60, B: 60, C: 60 };
  const s = Z.create({ processBudgetMB: 650, gpuBudgetMB: 0, cpuBudgetMB: 0, estimate: () => ({ processMB: mb, gpuMB: 0, cpuMB: 0 }) });
  const started = [];
  for (const id of ['A', 'B', 'C']) s.register({ id, requireComplete: true, serialPreparation: true, estProcessMB: sizes[id], estGpuMB: 0, estCpuMB: 0,
    load(api) { started.push(id); mb += sizes[id]; api.done(); }, unload() { mb -= sizes[id]; } });
  const view = (rank, current) => ({ metric: true, current: current || 'X', approach: new Set(rank.keys()), keep: new Set(rank.keys()), rank, visible: new Set() });
  const run = v => { for (let i = 0; i < 6; i++) s.update(v); };
  run(view(new Map([['A', 10], ['B', 30]])));
  assert.deepEqual(started, ['A'], 'A (10 m) first; B (30 m) does not fit next to it and never displaces it');
  assert.equal(s.status('B'), 'cold');
  // The hero walks on: B is now nearer than A, so A (farther) yields to B.
  run(view(new Map([['A', 35], ['B', 8]])));
  assert.equal(s.status('B'), 'ready');
  assert.equal(s.status('A'), 'cold');
  // Never a farther room for a nearer one: C at 40 m waits.
  run(view(new Map([['A', 35], ['B', 8], ['C', 40]])));
  assert.equal(s.status('C'), 'cold');
  assert.ok(mb <= 650);
});

test('streamer (metric): a much nearer room takes over from a farther preparation still in its load step', () => {
  // Tour on the phone profile: the hero reached the L2 corridor while L4
  // (30 m away) was still loading its GLB; L2 (5 m) waited behind the
  // one-load gate until L4 had finished loading.
  const Z = require('../zone-streamer.js');
  const s = Z.create({ processBudgetMB: 650, gpuBudgetMB: 0, cpuBudgetMB: 0, estimate: () => ({ processMB: 300, gpuMB: 0, cpuMB: 0 }) });
  const started = [];
  for (const id of ['L2', 'L4']) s.register({ id, requireComplete: true, serialPreparation: true, estProcessMB: 90, estGpuMB: 0, estCpuMB: 0, load() { started.push(id); } });
  const view = rank => ({ metric: true, current: 'X', approach: new Set(rank.keys()), keep: new Set(rank.keys()), rank, visible: new Set() });
  s.update(view(new Map([['L4', 20], ['L2', 30]])));
  assert.equal(s.status('L4'), 'loading');
  s.update(view(new Map([['L4', 30], ['L2', 5]])));
  assert.equal(s.status('L4'), 'cold', 'the farther preparation is abandoned');
  assert.equal(s.status('L2'), 'loading', 'the nearer room starts in the same frame');
  // Only a much nearer room: 12 m vs 20 m is not worth restarting L4.
  const t = Z.create({ processBudgetMB: 0 });
  for (const id of ['A', 'B']) t.register({ id, requireComplete: true, serialPreparation: true, load() {} });
  t.update(view(new Map([['A', 20], ['B', 30]])));
  t.update(view(new Map([['A', 20], ['B', 12]])));
  assert.equal(t.status('A'), 'loading');
  assert.equal(t.status('B'), 'cold');
  // A nearer room that could not fit anyway does not churn the farther one.
  const u = Z.create({ processBudgetMB: 650, gpuBudgetMB: 0, cpuBudgetMB: 0, estimate: () => ({ processMB: 400, gpuMB: 0, cpuMB: 0 }) });
  u.register({ id: 'A', requireComplete: true, serialPreparation: true, estProcessMB: 60, estGpuMB: 0, estCpuMB: 0, load() {} });
  u.register({ id: 'B', requireComplete: true, serialPreparation: true, estProcessMB: 400, estGpuMB: 0, estCpuMB: 0, load() {} });
  u.update(view(new Map([['A', 30], ['B', 40]])));
  assert.equal(u.status('A'), 'loading');
  u.update(view(new Map([['A', 30], ['B', 5]])));
  assert.equal(u.status('A'), 'loading', 'B (400 MB) cannot fit even without A: A keeps going');
});

test('streamer (metric): a room beyond its release radius is unloaded after a short linger, never while drawn', () => {
  const Z = require('../zone-streamer.js');
  let t = 0; const real = performance.now.bind(performance); performance.now = () => t;
  try {
    const s = Z.create({ processBudgetMB: 0, releaseMs: 2500, cacheZones: { normal: 0, watch: 0, critical: 0 } });
    s.register({ id: 'A', load(api) { api.done(); } });
    const v = (keep, visible) => ({ metric: true, current: 'X', approach: new Set(keep ? ['A'] : []), keep: new Set(keep ? ['A'] : []), rank: new Map([['A', 20]]), visible: new Set(visible ? ['A'] : []) });
    for (let i = 0; i < 4; i++) { t += 16; s.update(v(true)); }
    assert.equal(s.status('A'), 'ready');
    t += 16; s.update(v(false, true)); t += 5000; s.update(v(false, true));
    assert.equal(s.status('A'), 'ready', 'on screen: protected');
    t += 16; s.update(v(false)); t += 1000; s.update(v(false));
    assert.equal(s.status('A'), 'ready', 'linger');
    t += 2000; s.update(v(false));
    assert.equal(s.status('A'), 'cold');
  } finally { performance.now = real; }
});
