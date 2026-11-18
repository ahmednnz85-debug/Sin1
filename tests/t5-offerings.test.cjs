const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const architect = require('../wing-architecture');
const layout = architect.solveLayout(require('../data/palace-colliders.json').hall);
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'royal-offerings.js'), 'utf8'), context);
const { altarFloor, ceilingLayout } = context.window.SinRoyalOfferings;

test('the original offering room and its single temple approach remain at the baked dimensions', () => {
  const room = layout.rooms.find(room => room.id === 'T5');
  const doors = layout.doors.filter(door => door.from === 'T5' || door.to === 'T5');
  assert.equal(room.bbox.x1 - room.bbox.x0, 18);
  assert.equal(room.bbox.z1 - room.bbox.z0, 14);
  assert.equal(room.height, 5.5);
  assert.equal(doors.length, 1);
  assert.equal(doors[0].id, 'TC5-T5');
  assert.equal(doors[0].axis, 'z');
  assert.equal(doors[0].x, room.bbox.cx);
  assert.equal(doors[0].z, room.bbox.z0 - 0.5);
  for (const [from, to] of [['T4', 'TC34'], ['TC34', 'T3'], ['T3', 'TC5'], ['TC5', 'T5']]) {
    assert.ok(layout.links.some(([a, b]) => a === from && b === to || a === to && b === from));
  }
});

test('altar treads step up along the approach and the surrounding aisles stay level', () => {
  const floorAtRun = ratio => altarFloor(0, -.44 - ratio * 3.38);
  const levels = [.54, .46, .38, .28].map(floorAtRun);
  assert.equal(levels[0], 0);
  assert.ok(levels[1] > .22 && levels[1] < .26);
  assert.ok(levels[2] > .39 && levels[2] < .43);
  assert.ok(levels[3] > .54 && levels[3] < .58);
  assert.equal(floorAtRun(-.55), 0);
  assert.ok(altarFloor(2.10, -.40) > .39);
  assert.equal(altarFloor(3, -.44 - .38 * 3.38), 0);
});

test('ceiling fields and open slots cover the original roof area exactly once', () => {
  const { slots, fields } = ceilingLayout(9, 7);
  assert.equal(slots.length, 29);
  for (const slot of slots) {
    assert.ok(fields.every(([left, right, near, far]) =>
      slot.x + slot.w * .5 <= left + 1e-7 || slot.x - slot.w * .5 >= right - 1e-7 ||
      slot.z + slot.d * .5 <= near + 1e-7 || slot.z - slot.d * .5 >= far - 1e-7));
  }
  const solidArea = fields.reduce((area, [l, r, n, f]) => area + (r - l) * (f - n), 0);
  const skylightArea = slots.reduce((area, { w, d }) => area + w * d, 0);
  assert.ok(Math.abs(solidArea + skylightArea - 18 * 14) < 1e-7);
});
