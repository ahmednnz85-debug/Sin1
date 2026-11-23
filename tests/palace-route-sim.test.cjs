'use strict';
// Deterministic walk over the real portal graph with the real streamer:
// the room manager must not make anything worse than the previous policy,
// and must cut unprepared-in-view frames on repeated door passes (desktop).
const test = require('node:test');
const assert = require('node:assert/strict');
const { simulate } = require('../tools/palace-route-sim.cjs');

test('desktop repeated passes: fewer unprepared rooms in view, at most a few extra loads', () => {
  const info = console.info; console.info = () => {};
  try {
    const old = simulate('old', 'desktop', 'repeat'), now = simulate('new', 'desktop', 'repeat');
    assert.ok(now.unreadySightF < old.unreadySightF * 0.8, JSON.stringify({ old: old.unreadySightF, now: now.unreadySightF }));
    assert.ok(now.loads <= old.loads + 3, JSON.stringify({ old: old.loads, now: now.loads }));
    assert.ok(now.doorWaitS <= old.doorWaitS + 0.5);
    assert.ok(now.peakMB <= 1400);
  } finally { console.info = info; }
});

test('phone (650 MB, measured costs, hall residency): shorter door waits, fewer reloads, lower peak and less time over the cap', () => {
  const info = console.info; console.info = () => {};
  try {
    for (const tour of ['full', 'repeat']) {
      const old = simulate('old', 'phone', tour), now = simulate('new', 'phone', tour);
      const ctx = tour + ' ' + JSON.stringify({ old: [old.doorWaitS, old.loads, old.peakMB, old.overBudgetS], now: [now.doorWaitS, now.loads, now.peakMB, now.overBudgetS] });
      assert.ok(now.doorWaitS < old.doorWaitS * 0.9, ctx);
      assert.ok(now.loads < old.loads, ctx);
      assert.ok(now.peakMB <= old.peakMB, ctx);
      assert.ok(now.overBudgetS < old.overBudgetS, ctx);
      assert.ok(now.hallHiddenSeenF <= 15, 'the released hall is almost never in a sight line: ' + now.hallHiddenSeenF);
    }
  } finally { console.info = info; }
});
