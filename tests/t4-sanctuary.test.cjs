const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const architect = require('../wing-architecture');

const layout = architect.solveLayout(require('../data/palace-colliders.json').hall);
const room = layout.rooms.find(region => region.id === 'T4');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'lunar-sanctuary.js'), 'utf8'), context);
const { stairs, treadHeight, floorProjection } = context.window.SinLunarSanctuary;

test('the original sanctuary retains the temple and Moon Passage connections', () => {
  const { x0, x1, z0, z1, cx, cz } = room.bbox;
  assert.ok(Math.abs(x1 - x0 - 24) < 1e-8);
  assert.equal(z1 - z0, 20);
  assert.equal(room.height, 10);
  const doors = layout.doors.filter(d => d.from === 'T4' || d.to === 'T4');
  assert.deepEqual(doors.map(d => d.id), ['TC34-T4', 'T4-MP1']);
  assert.equal(doors[0].z, cz);
  assert.equal(doors[0].x, x0 - .5);
  assert.equal(doors[1].x, cx);
  assert.equal(doors[1].z, z0 - .5);
  for (const [from, to] of [['T3', 'TC34'], ['MP1', 'MP2'], ['MP2', 'L4'], ['TC5', 'T5']]) {
    assert.ok(layout.links.some(([a,b]) => (a === from && b === to) || (a === to && b === from)));
  }
});

test('the shrine has four climbable steps with no invisible floor in the side aisles', () => {
  const boxes = stairs(room), { cz, cx, z0 } = room.bbox;
  let prior = 0;
  for (const step of boxes) {
    const level = treadHeight(boxes, step.minx + .023, cz);
    assert.equal(level, step.maxy);
    assert.ok(level > prior && level - prior < .33);
    assert.equal(treadHeight(boxes, step.minx + .023, cz + 5.5), 0);
    assert.equal(treadHeight(boxes, step.minx + .023, cz - 5.5), 0);
    prior = level;
  }
  assert.equal(treadHeight(boxes, boxes[0].minx - .02, cz), 0);
  assert.equal(treadHeight(boxes, cx, z0), 0);
});

test('the floor roundel projects the near and far rims onto the outer circle while keeping its star centered', () => {
  const source = (x,z) => {
    const [u,v] = floorProjection(x,z);
    return [27 + u * 279, 281 + (1 - v) * 115];
  };
  const [centerX,centerY] = source(0,0);
  assert.equal(centerX, 166.5);
  assert.equal(centerY, 315);
  assert.ok(Math.abs(source(1,0)[1] - 283) < 1);
  assert.ok(Math.abs(source(-1,0)[1] - 394) < 1);
  for (let degrees = 0; degrees < 360; degrees += 6) {
    const radians = degrees * Math.PI / 180;
    const [u,v] = floorProjection(Math.cos(radians), Math.sin(radians));
    assert.ok(u > 0 && u < 1 && v > 0 && v < 1);
  }
});
