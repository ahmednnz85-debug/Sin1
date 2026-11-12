'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const Z = require('../zone-streamer.js');
const D = require('../device-profile.js');

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

// Each synthetic heavy room is ~4.5× a typical 40 MB GPU room.
const HEAVY = { estGpuMB: 180, estCpuMB: 20, estProcessMB: 200 };
const BUDGET = { processBudgetMB: 500, gpuBudgetMB: 400, cpuBudgetMB: 80 };
const BASE = { processMB: 50, gpuMB: 50, cpuMB: 10 };

function makeHeavyStreamer() {
  const resident = Object.create(null);
  const estimate = () => {
    let p = BASE.processMB, g = BASE.gpuMB, c = BASE.cpuMB;
    for (const id of Object.keys(resident)) {
      p += resident[id].processMB; g += resident[id].gpuMB; c += resident[id].cpuMB;
    }
    return { processMB: p, gpuMB: g, cpuMB: c };
  };
  const scene = obj('scene');
  const groups = new Map();
  const s = Z.create(Object.assign({
    graceMs: 60_000,                       // budget must evict before grace
    cacheZones: { normal: 10, watch: 10, critical: 0 },
    maxConcurrentLoads: 1,
    estimate
  }, BUDGET));
  for (let i = 0; i < 6; i++) {
    const id = 'H' + i;
    const g = obj(id); scene.add(g); groups.set(id, g);
    s.register({
      id,
      prefetchHops: 0,
      estGpuMB: HEAVY.estGpuMB,
      estCpuMB: HEAVY.estCpuMB,
      estProcessMB: HEAVY.estProcessMB,
      load(api) {
        resident[id] = { gpuMB: HEAVY.estGpuMB, cpuMB: HEAVY.estCpuMB, processMB: HEAVY.estProcessMB };
        api.add(mesh(id + '-m', tex()));
        api.done();
      },
      isComplete() { return !!resident[id]; },
      unload() { delete resident[id]; }
    });
  }
  s.attach({ renderer: renderer(), scene, camera: {}, groupOf: id => groups.get(id) });
  return { s, resident, estimate, groups };
}

async function settle(s, view, frames = 8) {
  for (let i = 0; i < frames; i++) { s.update(view); await tick(); }
}

function underBudget(u) {
  assert.ok(u.gpuMB <= BUDGET.gpuBudgetMB, 'GPU ' + u.gpuMB + ' over ' + BUDGET.gpuBudgetMB);
  assert.ok(u.cpuMB <= BUDGET.cpuBudgetMB, 'CPU ' + u.cpuMB + ' over ' + BUDGET.cpuBudgetMB);
  assert.ok(u.processMB <= BUDGET.processBudgetMB, 'process ' + u.processMB + ' over ' + BUDGET.processBudgetMB);
}

test('device profiles publish a hard process/GPU/CPU budget', () => {
  const phone = D.detect({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', hardwareConcurrency: 6, deviceMemory: 4 });
  assert.equal(phone.processBudgetMB, 650);
  assert.equal(phone.gpuBudgetMB, 480);
  assert.equal(phone.cpuBudgetMB, 80);
  const desk = D.detect({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', hardwareConcurrency: 8, deviceMemory: 16 });
  assert.equal(desk.processBudgetMB, 1400);
  assert.ok(desk.processBudgetMB > phone.processBudgetMB);
});

test('ADDING_CONTENT.md documents the hard budget and the evict-then-defer rule', () => {
  const md = fs.readFileSync(path.join(__dirname, '../ADDING_CONTENT.md'), 'utf8');
  assert.match(md, /Hard memory budget/);
  assert.match(md, /processBudgetMB/);
  assert.match(md, /deferred/);
  assert.match(md, /qaSyntheticMem|memory-budget\.test/);
  assert.match(md, /650/);
  assert.match(md, /evict/i);
});

test('wings.js passes the device budgets into the streamer', () => {
  const src = fs.readFileSync(path.join(__dirname, '../wings.js'), 'utf8');
  assert.match(src, /processBudgetMB:\s*deviceProfile\.processBudgetMB/);
  assert.match(src, /gpuBudgetMB:\s*deviceProfile\.gpuBudgetMB/);
  assert.match(src, /cpuBudgetMB:\s*deviceProfile\.cpuBudgetMB/);
});

test('hard budget evicts then admits; a 3–5× heavy-room sprint never exceeds the cap', async () => {
  const { s, estimate } = makeHeavyStreamer();
  const peaks = { processMB: 0, gpuMB: 0, cpuMB: 0 };
  const snap = () => {
    const u = estimate();
    peaks.processMB = Math.max(peaks.processMB, u.processMB);
    peaks.gpuMB = Math.max(peaks.gpuMB, u.gpuMB);
    peaks.cpuMB = Math.max(peaks.cpuMB, u.cpuMB);
    underBudget(u);
    assert.equal(s.report().overBudget, false);
    return u;
  };

  // Two full loops through H0–H5: enter, wait until ready, leave, next.
  for (let loop = 0; loop < 2; loop++) {
    for (let i = 0; i < 6; i++) {
      const id = 'H' + i;
      const prev = 'H' + ((i + 5) % 6);
      const distances = new Map([[id, 0], [prev, 2]]);
      const view = { current: id, distances, visible: new Set([id]) };
      await settle(s, view, 10);
      snap();
      assert.equal(s.status(id), 'ready', loop + '/' + id + ' must be ready (door opens only when complete and under budget)');
      // Previous heavy room must have been evicted: 2×180 + 50 = 410 > 400.
      if (s.status(prev) !== 'cold') {
        const u = estimate();
        assert.ok(u.gpuMB <= BUDGET.gpuBudgetMB);
      }
    }
  }
  const r = s.report();
  assert.ok(r.stats.budgetEvictions >= 5, 'evicted previous heavy rooms to admit the next: ' + r.stats.budgetEvictions);
  // No growth: second loop peak equals first-loop-capable peak (one room + base).
  const expected = BASE.gpuMB + HEAVY.estGpuMB; // 230
  assert.ok(peaks.gpuMB <= expected + 1, 'peak GPU ' + peaks.gpuMB + ' grew past one-room residency');
  assert.ok(peaks.processMB <= BASE.processMB + HEAVY.estProcessMB + 1);
});

test('a room that cannot fit after every evictable neighbour is gone is deferred; the door stays closed', async () => {
  const resident = Object.create(null);
  const estimate = () => {
    let p = 200, g = 200, c = 20;
    for (const id of Object.keys(resident)) {
      p += resident[id].processMB; g += resident[id].gpuMB; c += resident[id].cpuMB;
    }
    return { processMB: p, gpuMB: g, cpuMB: c };
  };
  const scene = obj('scene');
  const g = obj('HUGE'); scene.add(g);
  const hall = obj('HALL'); scene.add(hall);
  const s = Z.create({
    processBudgetMB: 500, gpuBudgetMB: 400, cpuBudgetMB: 80,
    graceMs: 0, cacheZones: { normal: 0, watch: 0, critical: 0 },
    estimate
  });
  s.register({
    id: 'HALL', prefetchHops: 0,
    estGpuMB: 200, estCpuMB: 20, estProcessMB: 200,
    load(api) { resident.HALL = { gpuMB: 200, cpuMB: 20, processMB: 200 }; api.add(mesh('hall', tex())); api.done(); }
  });
  s.register({
    id: 'HUGE', prefetchHops: 0,
    estGpuMB: 350, estCpuMB: 40, estProcessMB: 400, // hall-visible + HUGE would be 550 GPU
    load(api) { resident.HUGE = { gpuMB: 350, cpuMB: 40, processMB: 400 }; api.add(mesh('huge', tex())); api.done(); },
    isComplete() { return !!resident.HUGE; }
  });
  s.attach({ renderer: renderer(), scene, camera: {}, groupOf: id => id === 'HUGE' ? g : hall });
  // Hall is current AND visible — must not be evicted. HUGE cannot fit.
  const view = { current: 'HALL', distances: new Map([['HALL', 0], ['HUGE', 0]]), visible: new Set(['HALL', 'HUGE']), prepared: new Set(['HUGE']) };
  await settle(s, view, 8);
  // Wait: prepared HUGE with hops 0, hall visible. If current is HALL, HUGE hops 0 from distances.
  // canStart HUGE: evictToFit cannot evict HALL (visible+current). Defer.
  assert.equal(s.status('HUGE'), 'cold', 'must refuse the load rather than exceed');
  assert.equal(s.isReady('HUGE'), false, 'door stays closed');
  assert.ok(s.report().stats.deferred >= 1);
  assert.equal(s.report().stats.lastDefer.id, 'HUGE');
  underBudget(Object.assign(BUDGET, estimate())); // reuse asserts with this estimate — wait underBudget uses BUDGET caps vs estimate()
  const u = estimate();
  assert.ok(u.gpuMB <= 400);
  assert.ok(!resident.HUGE);
});

test('adjacent non-visible rooms yield so the room in front of the player can fit', async () => {
  const { s, estimate } = makeHeavyStreamer();
  await settle(s, { current: 'H0', distances: new Map([['H0', 0], ['H1', 1]]), visible: new Set(['H0']) }, 10);
  assert.equal(s.status('H0'), 'ready');
  // Walk to H1: H0 is adjacent (1 hop) but not visible (player faces the closed door).
  await settle(s, { current: 'H1', distances: new Map([['H1', 0], ['H0', 1]]), visible: new Set(['H1']) }, 10);
  assert.equal(s.status('H1'), 'ready', 'H1 admitted after H0 yielded');
  assert.equal(s.status('H0'), 'cold', 'non-visible adjacent evicted for budget');
  underBudget(estimate());
});
