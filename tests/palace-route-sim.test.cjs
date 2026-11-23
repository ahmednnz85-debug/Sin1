'use strict';
// Deterministic walk over the real portal graph with the real streamer:
// the room manager must not make anything worse than the previous policy,
// and must cut unprepared-in-view frames on repeated door passes (desktop).
const test = require('node:test');
const assert = require('node:assert/strict');
const { simulate } = require('../tools/palace-route-sim.cjs');

test('desktop repeated passes: fewer unprepared rooms in view, no extra reloads', () => {
  const info = console.info; console.info = () => {};
  try {
    const old = simulate('old', 'desktop', 'repeat'), now = simulate('new', 'desktop', 'repeat');
    assert.ok(now.unreadySightF < old.unreadySightF * 0.6, JSON.stringify({ old: old.unreadySightF, now: now.unreadySightF }));
    assert.ok(now.loads <= old.loads);
    assert.ok(now.doorWaitS <= old.doorWaitS);
    assert.ok(now.peakMB <= 1400);
  } finally { console.info = info; }
});

test('phone (650 MB, one room at a time): never worse than before', () => {
  const info = console.info; console.info = () => {};
  try {
    for (const tour of ['full', 'repeat']) {
      const old = simulate('old', 'phone', tour), now = simulate('new', 'phone', tour);
      assert.ok(now.loads <= old.loads, tour + ' loads');
      assert.ok(now.doorWaitS <= old.doorWaitS + 0.05, tour + ' door wait');
      assert.ok(now.unreadySightF <= old.unreadySightF, tour + ' unready frames');
      assert.ok(now.peakMB <= 650, tour + ' budget');
    }
  } finally { console.info = info; }
});
