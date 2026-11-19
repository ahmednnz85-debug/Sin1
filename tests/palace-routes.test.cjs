const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../palace-routes');
const { throughOpenings } = require('../wing-visibility');

const area = (id, x0, x1, z0, z1, kind = 'corridor') => ({ id, bbox: { x0, x1, z0, z1 }, kind });
const door = (id, from, to, x, z) => ({ id, from, to, x, z, axis: 'x', width: 3.4 });
const hall = area('Hall', -12, 0, -4, 4);
const corridor = area('Passage', 0, 8, -2, 2);
const study = area('Study', 8, 18, -4, 4, 'room');
const side = area('Other', 0, 18, 2, 8, 'room');
const a = door('entry', 'Hall', 'Passage', 0, 0);
const b = door('study-door', 'Passage', 'Study', 8, 0);
const rooms = new Set(['Study', 'Other']);
const network = create([hall, corridor, study, side], [
  ['Hall', 'Passage', a.id], ['Passage', 'Study', b.id]
], [a, b]);

test('preparation follows a connected corridor in the direction of motion', () => {
  const motion = { x: -9, z: 0, vx: 4, vz: 0 };
  assert.equal(network.nextRoom('Hall', motion, rooms, () => 6)?.id, 'Study');
  assert.equal(network.nextRoom('Hall', { ...motion, vx: 0 }, rooms, () => 6), null);
  assert.equal(network.nextRoom('Hall', { ...motion, vx: -4 }, rooms, () => 6), null);
  assert.equal(network.nextRoom('Passage', { x: 6, z: 1.91, vx: 0, vz: 5 }, rooms, () => 6), null);
});

test('closed portals and unconnected rooms prevent visibility during a camera turn', () => {
  const view = { x: -6, z: 0, dirX: 1, dirZ: 0, halfFov: .65 };
  const closed = new Set(['study-door']);
  const visible = camera => [...network.connectedView('Hall', camera, throughOpenings, p => !closed.has(p.id))];
  assert.deepEqual(visible(view), ['Hall', 'Passage']);
  closed.clear();
  assert.deepEqual(visible(view), ['Hall', 'Passage', 'Study']);
  assert.deepEqual(visible({ ...view, dirX: 0, dirZ: 1 }), ['Hall']);
});

test('a cold room has explicit readiness demand only near its portal mouth', () => {
  assert.equal(network.nearRoom('Passage', { x: 7, z: 0 }, rooms, () => false), 'Study');
  assert.equal(network.nearRoom('Passage', { x: 7, z: 0 }, rooms, () => true), null);
  assert.equal(network.nearRoom('Passage', { x: 7, z: 2.2 }, rooms, () => false), null);
  assert.equal(network.nearRoom('Passage', { x: 2, z: 0 }, rooms, () => false), null);
});

test('a prepared room can lead to a second room before the first threshold is crossed', () => {
  const archive = area('Archive', 18, 28, -4, 4, 'room');
  const c = door('archive-door', 'Study', 'Archive', 18, 0);
  const route = create([hall, corridor, study, archive], [
    ['Hall', 'Passage', a.id], ['Passage', 'Study', b.id], ['Study', 'Archive', c.id]
  ], [a, b, c]);
  const motion = { x: -6, z: 0, vx: 5, vz: 0 };
  const zones = new Set(['Study', 'Archive']);
  assert.equal(route.nextRoom('Hall', motion, zones, () => 4).id, 'Study');
  assert.equal(route.nextRoom('Hall', motion, zones, () => 4, id => id === 'Study').id, 'Archive');
});
