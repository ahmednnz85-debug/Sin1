const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const architecture = require('../wing-architecture');
const baked = require('../data/palace-colliders.json');
const window = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'sacred-columns.js'), 'utf8'), { window });

const layout = architecture.solveLayout(baked.hall);
const room = layout.rooms.find(region => region.id === 'T3');
const { cx, cz } = room.bbox;
const channels = window.SinSacredColumns.channelLayout(room);
const tiles = channels.flatMap(channel => channel.tiles);

test('the recessed T3 channels preserve the original axis, side crossing and dry column plinths', () => {
  assert.equal(channels.length, 4);
  for (const channel of channels) {
    assert.ok(channel.r - channel.l > 17);
    assert.ok(channel.tiles.some(t => t.f - t.n > 7), 'a bay reaches between columns');
  }
  for (const { l, r, n, f } of tiles) {
    assert.ok(f - n > 4);
    assert.ok(r <= -3.2 || l >= 3.2, 'the route to T5 stays dry');
    assert.ok(f <= -2.94 || n >= 2.94, 'the T2–T4 axis stays dry');
    assert.ok(n > -10.15 && f < 10.15, 'the outer walk stays dry');
  }
  const west = layout.doors.find(door => door.id === 'TC23-T3');
  const east = layout.doors.find(door => door.id === 'T3-TC34');
  const offering = layout.doors.find(door => door.id === 'T3-TC5');
  assert.equal(west.z, cz);
  assert.equal(east.z, cz);
  assert.equal(offering.x, cx);
});

test('a Temple floor cut using the room channels removes support from the water footprints only', () => {
  let openings = [];
  for (const { l, r, n, f } of tiles) {
    const rectangle = architecture.rectRegion('channel', 'Temple', 'channel', cx + l, cz + n, r - l, f - n, 0);
    openings = architecture.union(openings, architecture.solid(rectangle.poly));
  }
  const dryFloor = architecture.difference(architecture.solid(room.poly), openings);
  for (const { l, r, n, f } of tiles) {
    assert.equal(architecture.pointInSolids(cx + (l + r) / 2, cz + (n + f) / 2, dryFloor), false);
  }
  assert.equal(architecture.pointInSolids(cx - 13.95, cz + 8.82, dryFloor), false, 'water occupies the bay');
  for (const position of [[cx - 17, cz], [cx + 17, cz], [cx, cz + 10],
    [cx - 17.15, cz + 8.82], [cx - 10.75, cz - 8.82], [cx - 13.95, cz + 11]]) {
    assert.equal(architecture.pointInSolids(...position, dryFloor), true);
  }
});
