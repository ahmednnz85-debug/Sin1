const test = require('node:test');
const assert = require('node:assert/strict');
const Vis = require('../wing-visibility.js');
const { createPlanner } = Vis;

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

test('closed room doors block visibility links while opening/open doors and arches remain prefetchable', () => {
  const links = [['A', 'B', 'door-closed'], ['A', 'C', 'door-opening'], ['A', 'D', 'door-open'], ['A', 'E', 'arch']];
  const doors = [
    { id: 'door-closed', state: 'Closed' },
    { id: 'door-opening', state: 'Opening' },
    { id: 'door-open', state: 'Open' },
    { id: 'arch', state: 'Closed', kind: 'arch' }
  ];
  assert.deepEqual(Vis.openLinks(links, doors), [links[1], links[2], links[3]]);
});

test('room behind a wall with no doorway is never drawn even if in front of the camera', () => {
  const p = createPlanner();
  const out = p.plan(regions, links, 'A', lookNorth, 0);
  assert.equal(out.visible.has('S'), false);
});

test('a nearby side room is not visible just because the hero is standing near it', () => {
  const p = createPlanner();
  const side = { id: 'D', bbox: box(3, -5, 8, -1) };
  const out = p.plan(regions.concat(side), links.concat([['A', 'D']]), 'A', lookNorth, 0);
  assert.equal(out.visible.has('D'), false);
  assert.equal(out.prepared.has('D'), false);
});

test('room behind the camera is neither drawn nor kept in memory, and is drawn on turning around', () => {
  const p = createPlanner();
  const ahead = p.plan(regions, links, 'A', lookNorth, 0);
  assert.equal(ahead.visible.has('B'), false);
  assert.equal(ahead.prepared.has('B'), false);
  const back = p.plan(regions, links, 'A', lookSouth, 0.1);
  assert.ok(back.visible.has('B'));
});

test('a room just outside the drawn view is prepared before it enters the view', () => {
  const p = createPlanner();
  // Looking east: room R (north-east, ~45 deg off axis at 40m) is outside the
  // drawn wedge but inside the wider prefetch wedge.
  const cam = { x: 0, z: 0, dirX: Math.cos(0.15), dirZ: Math.sin(0.15) * -1, halfFov: 0.1 };
  const out = p.plan([{ id: 'A', bbox: box(-3, -6, 3, 0) }, { id: 'Q', bbox: box(20, 18, 24, 22) }], [['A', 'Q']], 'A', cam, 0);
  assert.equal(out.visible.has('Q'), false);
  assert.ok(out.prepared.has('Q'));
});

test('a room seen earlier is released from memory after the camera turns away', () => {
  const p = createPlanner();
  p.plan(regions, links, 'A', lookNorth, 0);
  const later = p.plan(regions, links, 'A', lookSouth, 10);
  assert.equal(later.visible.has('R'), false);
  assert.equal(later.prepared.has('R'), false);
});
