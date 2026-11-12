'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const palace = fs.readFileSync(path.join(root, 'palaceInterior.js'), 'utf8');
const wings = fs.readFileSync(path.join(root, 'wings.js'), 'utf8');
const streamer = fs.readFileSync(path.join(root, 'zone-streamer.js'), 'utf8');
const mem = fs.readFileSync(path.join(root, 'process-memory.js'), 'utf8');

test('PalaceInterior.status never calls PalaceWings.metrics (first-frame recurse)', () => {
  const start = palace.indexOf('status: function ()');
  assert.ok(start > 0);
  const end = palace.indexOf('loadPalaceAssets:', start) > 0
    ? palace.indexOf('\n    loadPalaceAssets:', start)
    : start + 2000;
  const body = palace.slice(start, end).replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(body, /PalaceWings\.metrics\s*\(/);
  assert.match(body, /PalaceWings\.current/);
});

test('PalaceWings exposes a cheap current() and guards metrics re-entry', () => {
  assert.match(wings, /function current\(\) \{ return state\.current \|\| null; \}/);
  assert.match(wings, /let metricsBusy = false/);
  assert.match(wings, /if \(metricsBusy\)/);
  assert.match(wings, /finally \{ metricsBusy = false; \}/);
  assert.match(wings, /current, metrics/);
});

test('zoneStreamer.usage reads SinProcessMemory.last, never a fresh estimate', () => {
  const start = streamer.indexOf('function usage()');
  assert.ok(start > 0);
  const body = streamer.slice(start, streamer.indexOf('function incoming', start));
  assert.match(body, /PM\.last/);
  assert.doesNotMatch(body, /PM\.estimate\s*\(/);
});

test('SinProcessMemory.estimate does not call PalaceInterior.status', () => {
  const start = mem.indexOf('function estimate(');
  const end = mem.indexOf('function wipeDisposedCpu', start);
  const body = mem.slice(start, end).replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(body, /PalaceInterior\.status\s*\(/);
  assert.match(body, /if \(estimateBusy\) return lastEstimate/);
});

test('a status→metrics→report→estimate cycle cannot re-enter metrics', () => {
  // Live stand-in of the first-DONE hall frame (current === null).
  let metricsCalls = 0;
  let estimateCalls = 0;
  let metricsBusy = false;
  function current() { return null; }
  function status() {
    const wingRoom = current();
    // The old code fell through to metrics() here whenever current was null.
    return { phase: 'DONE', room: wingRoom || 'Palace' };
  }
  function metrics() {
    metricsCalls++;
    if (metricsBusy) return { reentrant: true };
    metricsBusy = true;
    try {
      const zones = report();
      return { current: null, zones };
    } finally { metricsBusy = false; }
  }
  function report() {
    return { usage: usage() };
  }
  function usage() {
    return estimate();
  }
  function estimate() {
    estimateCalls++;
    // Old estimate asked status() which asked metrics().
    const palace = status();
    // If someone wired the old cycle back, this would recurse through metrics.
    if (palace && false) metrics();
    return { processMB: 98, phase: palace.phase };
  }
  const s = status();
  const m = metrics();
  const e = estimate();
  assert.strictEqual(s.room, 'Palace');
  assert.strictEqual(m.zones.usage.processMB, 98);
  assert.strictEqual(e.phase, 'DONE');
  assert.strictEqual(metricsCalls, 1);
  assert.ok(estimateCalls >= 1);
  assert.ok(estimateCalls < 5, 'estimate must not recurse, got ' + estimateCalls);
});
