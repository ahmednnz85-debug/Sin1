const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Loader = require('../room-loader.js');

test('single-file queue runs one task per frame within slice', () => {
  const loader = Loader.createLoader({ sliceMs: 3.5, maxTasksPerFrame: 1 });
  let ran = 0;
  loader.push({ id: 'a', run() { ran++; } }, 0);
  loader.push({ id: 'b', run() { ran++; } }, 1);
  const r1 = loader.runFrame(1000, {});
  assert.equal(r1.ran, 1);
  assert.equal(ran, 1);
  assert.equal(loader.pending(), 1);
  const r2 = loader.runFrame(1010, {});
  assert.equal(r2.ran, 1);
  assert.equal(ran, 2);
});

test('pauses while door is opening or camera snaps', () => {
  const loader = Loader.createLoader({ cameraPauseRadPerSec: 1.0 });
  let ran = 0;
  loader.push({ id: 'x', run() { ran++; } }, 0);
  const paused = loader.runFrame(1, { doorBusy: true });
  assert.equal(paused.ran, 0);
  assert.equal(paused.reason, 'door');
  assert.equal(ran, 0);
  loader.noteCamera(1, 0, 1 / 60);
  loader.noteCamera(0, 1, 1 / 60); // ~90° turn in one frame
  loader.runFrame(2, {});
  assert.equal(ran, 0);
  loader.noteCamera(0, 1, 1); // settle
  loader.runFrame(20, {});
  assert.equal(ran, 1);
});

test('hysteresis keeps rooms for 10s after 2-hop departure', () => {
  const loader = Loader.createLoader({ hysteresisHops: 2, hysteresisMs: 10000 });
  const hops = new Map([['K1', 0], ['K2', 1], ['K3', 2], ['T1', 5]]);
  const live = new Set(['K1', 'K2']);
  const t0 = 1000;
  const r1 = loader.applyHysteresis(live, hops, t0);
  assert.equal(r1.has('K1'), true);
  assert.equal(r1.has('K2'), true);
  assert.equal(r1.has('K3'), true); // hop==2 still within hysteresis hops policy (< 2 keeps; ==2 starts timer but kept until timeout)
  // Immediately after leaving prepared, hop>=2 rooms linger.
  assert.equal(r1.has('T1'), true);
  const r2 = loader.applyHysteresis(live, hops, t0 + 9999);
  assert.equal(r2.has('T1'), true);
  const r3 = loader.applyHysteresis(live, hops, t0 + 10001);
  assert.equal(r3.has('T1'), false);
  assert.equal(r3.has('K1'), true);
});

test('index.html loads room-loader before wings', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const loader = html.indexOf('data-src="room-loader.js');
  const wings = html.indexOf('data-src="wings.js');
  assert.ok(loader > 0 && loader < wings);
});
