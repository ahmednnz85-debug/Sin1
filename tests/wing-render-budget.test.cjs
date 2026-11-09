const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { choose } = require('../wing-render-budget.js');

test('current room is preserved and only closest fitting neighbours are admitted under mobile triangle budget', () => {
  const result = choose([
    { id: 'far-small', triangles: 100000, distance: 18, priority: 2 },
    { id: 'current', triangles: 350000, distance: 0, priority: 0, current: true },
    { id: 'near-large', triangles: 600000, distance: 4, priority: 1 },
    { id: 'near-small', triangles: 250000, distance: 8, priority: 1 }
  ], 750000);
  assert.deepEqual(result.ids, ['current', 'near-small', 'far-small']);
  assert.equal(result.triangles, 700000);
  assert.equal(result.budget, 750000);
});

test('current room remains visible if it alone exceeds budget, while every non-current room is omitted', () => {
  const result = choose([
    { id: 'neighbor', triangles: 1000, distance: 1, priority: 1 },
    { id: 'oversized-current', triangles: 900000, distance: 0, priority: 0, current: true }
  ], 750000);
  assert.deepEqual(result.ids, ['oversized-current']);
  assert.equal(result.triangles, 900000);
});

test('candidate order does not affect stable priority and distance selection', () => {
  const candidates = [
    { id: 'B', triangles: 100, distance: 10, priority: 1 },
    { id: 'A', triangles: 100, distance: 10, priority: 1 },
    { id: 'current', triangles: 100, distance: 50, priority: 0, current: true }
  ];
  assert.deepEqual(choose(candidates, 200).ids, ['current', 'A']);
  assert.deepEqual(choose(candidates.slice().reverse(), 200).ids, ['current', 'A']);
});

test('game loads the low-poly K1 asset and the browser budget module before the wing runtime', () => {
  const root = path.join(__dirname, '..');
  const wings = fs.readFileSync(path.join(root, 'wings.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(wings, /K1_RoyalReceptionHall_lod25\.glb/);
  assert.match(wings, /triangleBudget: 750000/);
  assert.match(index, /wing-render-budget\.js/);
  assert.ok(index.indexOf('wing-render-budget.js') < index.indexOf('wings.js?'));
});
