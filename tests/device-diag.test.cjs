const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'memory-overlay.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function load(search) {
  const store = { session: {}, local: {} };
  const ls = {
    getItem: (k) => (k in store.local ? store.local[k] : null),
    setItem: (k, v) => { store.local[k] = String(v); },
    removeItem: (k) => { delete store.local[k]; }
  };
  const ss = {
    getItem: (k) => (k in store.session ? store.session[k] : null),
    setItem: (k, v) => { store.session[k] = String(v); },
    removeItem: (k) => { delete store.session[k]; }
  };
  const ctx = {
    window: {}, globalThis: {}, console,
    location: { search: search || '' },
    sessionStorage: ss,
    localStorage: ls,
    performance: { now: () => 2000, memory: null },
    document: {
      readyState: 'complete',
      getElementById: () => null,
      addEventListener: () => {},
      createElement: (t) => ({ style: {}, id: '', textContent: '', appendChild() {} }),
      body: { appendChild() {}, dataset: {} }
    },
    setTimeout: (fn) => { /* do not fire crash banner in this test */ },
    _store: store
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.root = ctx;
  vm.runInNewContext(src, ctx);
  return ctx;
}

test('?diag=1 is documented as an opt-in and memory-overlay is cache-busted', () => {
  assert.match(index, /memory-overlay\.js\?v=mem6-diag/);
  assert.match(src, /diag=1/);
  assert.match(src, /sinDiagTimeline/);
  assert.match(src, /last ' \+ lastN\.length \+ ' samples before death/);
});

test('diag=1 turns the compact overlay on; default players do not see it', () => {
  const off = load('');
  assert.equal(off.SinMemoryOverlay.on(), false);
  assert.equal(off.SinMemoryOverlay.diagOn(), false);
  const on = load('?diag=1');
  assert.equal(on.SinMemoryOverlay.diagOn(), true);
  assert.equal(on.SinMemoryOverlay.on(), true);
});

test('tick records a localStorage timeline that a later boot surfaces as last-N', () => {
  const a = load('?diag=1');
  a.SinMemoryOverlay.tick({ phase: 'REVEAL' });
  const raw = a._store.local.sinDiagTimeline;
  assert.ok(raw, 'timeline written, store=' + JSON.stringify(a._store));
  const arr = JSON.parse(raw);
  assert.ok(Array.isArray(arr) && arr.length >= 1);
  assert.ok('phase' in arr[0] && 'tris' in arr[0] && 'draws' in arr[0] && 'programs' in arr[0]);
  assert.equal(arr[0].phase, 'REVEAL');
});

test('black-box text includes process MB and last samples when PREV timeline exists', () => {
  // Contract in source — the banner builder reads DIAG_PREV and appends last 10.
  assert.match(src, /readDiagPrev/);
  assert.match(src, /lastN = \(diag && diag\.length\) \? diag\.slice\(-10\)/);
  assert.match(src, /processMB/);
  assert.match(src, /cpuMB/);
});
