const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlanner } = require('../wing-visibility.js');

const box = (x0, z0, x1, z1) => ({ x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 });
// A long corridor C (0..40m) with a room R at its far end, room B behind the
// camera, and room S next to C but with no door (sealed by walls).
const regions = [
  { id: 'A', bbox: box(-3, -6, 3, 0) },
  { id: 'C', bbox: box(-1, 0, 1, 40) },
  { id: 'R', bbox: box(-5, 40, 5, 50) },
  { id: 'B', bbox: box(-3, -14, 3, -6) },
  { id: 'S', bbox: box(2, 10, 12, 20) }
];
const links = [['A', 'C'], ['C', 'R'], ['A', 'B']];
const lookNorth = { x: 0, z: -1, dirX: 0, dirZ: 1, halfFov: 0.6 };
const lookSouth = { x: 0, z: -1, dirX: 0, dirZ: -1, halfFov: 0.6 };

test('a room seen down the corridor (two portals away) is drawn immediately', () => {
  const p = createPlanner();
  const out = p.plan(regions, links, 'A', lookNorth, 0);
  assert.ok(out.visible.has('C'));
  // Visibility reaches through open portals; what the camera sees is drawn
  // (and therefore resident) instead of popping in as the hero advances.
  assert.ok(out.visible.has('R'));
  assert.ok(out.prepared.has('R'));
  assert.ok(out.prepared.has('C'));
});

test('a two-hop room that is NOT in view is not drawn but stays resident (hop<=2 residency)', () => {
  const p = createPlanner();
  const out = p.plan(regions, links, 'A', lookSouth, 0);
  assert.equal(out.visible.has('R'), false);
  assert.equal(out.prepared.has('R'), true);
});

test('with prepareHops 1 the two-hop room is not kept resident', () => {
  const p = createPlanner({ prepareHops: 1 });
  const out = p.plan(regions, links, 'A', lookSouth, 0);
  assert.equal(out.prepared.has('R'), false);
});

test('from the corridor, the far room becomes prepared and drawable', () => {
  const p = createPlanner();
  const out = p.plan(regions, links, 'C', lookNorth, 0);
  assert.ok(out.prepared.has('R'));
  assert.ok(out.visible.has('R'));
});

test('room behind a wall with no doorway is never drawn even if in front of the camera', () => {
  const p = createPlanner();
  const out = p.plan(regions, links, 'A', lookNorth, 0);
  assert.equal(out.visible.has('S'), false);
  assert.equal(out.prepared.has('S'), false);
});

test('a nearby side room stays prepared (hop≤1) but is not drawn when off-camera', () => {
  const p = createPlanner();
  const side = { id: 'D', bbox: box(3, -5, 8, -1) };
  const out = p.plan(regions.concat(side), links.concat([['A', 'D']]), 'A', lookNorth, 0);
  assert.equal(out.visible.has('D'), false);
  assert.ok(out.prepared.has('D'));
});

test('adjacent room behind the camera is kept in memory but not drawn until turning', () => {
  const p = createPlanner();
  const ahead = p.plan(regions, links, 'A', lookNorth, 0);
  assert.equal(ahead.visible.has('B'), false);
  assert.ok(ahead.prepared.has('B')); // hop≤1 neighbour
  const back = p.plan(regions, links, 'A', lookSouth, 0.1);
  assert.ok(back.visible.has('B'));
});

test('current room is always prepared', () => {
  const p = createPlanner();
  const out = p.plan(regions, links, 'A', lookNorth, 0);
  assert.ok(out.prepared.has('A'));
});

test('a room seen earlier is released from memory after leaving adjacency', () => {
  // Graph here is A-C-R only, so use a 1-hop residency to exercise the release.
  const p = createPlanner({ prepareHops: 1 });
  p.plan(regions, links, 'A', lookNorth, 0);
  // Camera must sit inside R — otherwise nearPad would still mark A as visible.
  // Looking away from A: A is out of view and beyond the residency hops, so it is released.
  const camInR = { x: 0, z: 45, dirX: 0, dirZ: 1, halfFov: 0.6 };
  const later = p.plan(regions, links, 'R', camInR, 10);
  assert.equal(later.prepared.has('A'), false);
  assert.ok(later.prepared.has('C'));
  assert.ok(later.prepared.has('R'));
});

test('prepared set is independent of camera direction (spin does not churn residency)', () => {
  const p = createPlanner();
  const dirs = [
    { x: 0, z: -1, dirX: 0, dirZ: 1, halfFov: 0.6 },
    { x: 0, z: -1, dirX: 1, dirZ: 0, halfFov: 0.6 },
    { x: 0, z: -1, dirX: 0, dirZ: -1, halfFov: 0.6 },
    { x: 0, z: -1, dirX: -1, dirZ: 0, halfFov: 0.6 },
    { x: 0, z: -1, dirX: 0.7, dirZ: 0.7, halfFov: 0.6 }
  ];
  const sets = dirs.map((cam, i) => {
    const out = p.plan(regions, links, 'A', cam, i * 0.05);
    return Array.from(out.prepared).sort().join(',');
  });
  assert.ok(sets.every(s => s === sets[0]), 'prepared changed with camera yaw: ' + sets.join(' | '));
  // A visible-through-doorways 2-hop room stays prepared because of hops, not the camera.
  assert.ok(sets[0].split(',').includes('R'));
});

test('a room only brought into the frustum (beyond prepareHops) is drawn but not added to prepared', () => {
  const p = createPlanner({ prepareHops: 1 });
  const out = p.plan(regions, links, 'A', lookNorth, 0);
  // R is 2 hops from A: visible down the corridor, but residency does not follow the camera.
  assert.ok(out.visible.has('R'));
  assert.equal(out.prepared.has('R'), false);
});

test('a large side-wing room is not drawn just because its AABB clips a long sight line', () => {
  // Hall H is 14 m × 80 m. A huge further room W (3 hops, around a corner)
  // has an AABB that spans the same Z as the hall and would intersect a
  // 400 m forward wedge, but its doorway is at x=-40, off-camera.
  const hall = [
    { id: 'H', bbox: box(-7, 0, 7, 80) },
    { id: 'C', bbox: box(-15, 20, -7, 26) },
    { id: 'S', bbox: box(-40, 18, -15, 28) },
    { id: 'W', bbox: box(-80, 0, -40, 80) }
  ];
  const lks = [['H', 'C'], ['C', 'S'], ['S', 'W']];
  const cam = { x: 0, z: 2, dirX: 0, dirZ: 1, halfFov: 0.6 };
  const p = createPlanner();
  const loose = p.plan(hall, lks, 'H', cam, 0);
  assert.equal(loose.visible.has('W'), false, 'visible=' + Array.from(loose.visible));
  assert.equal(loose.prepared.has('W'), false);
});
