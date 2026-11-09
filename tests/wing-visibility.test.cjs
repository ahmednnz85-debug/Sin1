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

test('room 42m away at the end of a corridor is drawn when the camera looks down it', () => {
  const p = createPlanner();
  const out = p.plan(regions, links, 'A', lookNorth, 0);
  assert.ok(out.visible.has('C'));
  assert.ok(out.visible.has('R'));
});

test('room behind a wall with no doorway is never drawn even if in front of the camera', () => {
  const p = createPlanner();
  const out = p.plan(regions, links, 'A', lookNorth, 0);
  assert.equal(out.visible.has('S'), false);
});

test('room behind the camera is not drawn but stays prepared, and is drawn on turning around', () => {
  const p = createPlanner();
  const ahead = p.plan(regions, links, 'A', lookNorth, 0);
  assert.equal(ahead.visible.has('B'), false);
  assert.ok(ahead.prepared.has('B'));
  const back = p.plan(regions, links, 'A', lookSouth, 0.1);
  assert.ok(back.visible.has('B'));
});

test('a room seen earlier stays prepared after the camera turns away', () => {
  const p = createPlanner();
  p.plan(regions, links, 'A', lookNorth, 0);
  const later = p.plan(regions, links, 'A', lookSouth, 10);
  assert.equal(later.visible.has('R'), false);
  assert.ok(later.prepared.has('R'));
});
