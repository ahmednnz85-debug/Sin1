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

test('adjacent corridor is drawn; room two hops away waits until hero advances', () => {
  const p = createPlanner();
  const out = p.plan(regions, links, 'A', lookNorth, 0);
  assert.ok(out.visible.has('C'));
  // Memory policy is hop≤1: R is two portals away from A.
  assert.equal(out.visible.has('R'), false);
  assert.equal(out.prepared.has('R'), false);
  assert.ok(out.prepared.has('C'));
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
  const p = createPlanner();
  p.plan(regions, links, 'A', lookNorth, 0);
  // Camera must sit inside R — otherwise nearPad would still mark A as visible.
  const camInR = { x: 0, z: 45, dirX: 0, dirZ: -1, halfFov: 0.6 };
  const later = p.plan(regions, links, 'R', camInR, 10);
  assert.equal(later.prepared.has('A'), false);
  assert.ok(later.prepared.has('C'));
  assert.ok(later.prepared.has('R'));
});
