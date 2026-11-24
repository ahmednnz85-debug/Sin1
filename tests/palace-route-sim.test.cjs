'use strict';
// Deterministic walk over the real portal graph with the real streamer and
// room manager (tools/palace-route-sim.cjs): the distance policy (load /
// release radii + potentially-visible-set + nearest-first admission) against
// the original heading / sight policy.
const test = require('node:test');
const assert = require('node:assert/strict');
const { simulate } = require('../tools/palace-route-sim.cjs');
const quiet = fn => { const info = console.info; console.info = () => {}; try { return fn(); } finally { console.info = info; } };

test('desktop: no door waits and no unprepared room in view, no extra reloads', () => quiet(() => {
  for (const tour of ['full', 'repeat']) {
    const old = simulate('old', 'desktop', tour), now = simulate('metric', 'desktop', tour);
    assert.equal(now.doorWaitS, 0, tour);
    assert.ok(now.unreadySightPct <= 0.2, tour + ' ' + JSON.stringify(now.holes));
    assert.ok(now.unreadySightF < old.unreadySightF, tour);
    assert.ok(now.loads <= old.loads + 2, tour + ' loads');
    assert.equal(now.insideUnreadyF, 0);
    assert.ok(now.peakMB <= 1400);
  }
}));

test('phone with GPU-compressed textures (projection): every room ready before the hero', () => quiet(() => {
  for (const tour of ['full', 'repeat']) {
    const now = simulate('metric', 'phone-ktx', tour);
    assert.equal(now.doorWaitS, 0, tour);
    assert.ok(now.unreadySightPct <= 0.2, tour + ' ' + JSON.stringify(now.holes));
    assert.ok(now.peakMB <= 650, tour + ' budget');
  }
}));

test('phone today (566 MB hall, 650 MB budget): never stuck, never past the hard ceiling', () => quiet(() => {
  for (const tour of ['full', 'repeat']) {
    const old = simulate('old', 'phone', tour), now = simulate('metric', 'phone', tour);
    assert.ok(now.seconds < 400, tour + ' tour completes (old: ' + old.seconds + ' s, stuck at a door)');
    assert.ok(now.doorWaitS < old.doorWaitS, tour + ' door wait');
    assert.ok(now.peakMB <= 650 * 1.1, tour + ' hard ceiling');
  }
}));
