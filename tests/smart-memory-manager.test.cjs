const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../smart-memory-manager.js');

test('normal pressure keeps the planned resident rooms', () => {
  const m = create({ geometryBudget: 100, textureBudget: 100 });
  const result = m.selectPrepared(new Set(['current']), new Set(['current', 'near', 'far']), new Map(), 'current');
  assert.deepEqual([...result], ['current', 'near', 'far']);
  assert.equal(m.state().level, 'normal');
});

test('watch pressure keeps visible rooms and only the closest hidden prefetch', () => {
  const m = create({ geometryBudget: 10, textureBudget: 10 });
  m.sample({ info: { memory: { geometries: 9, textures: 1 } } }, 16);
  const result = m.selectPrepared(new Set(['current']), new Set(['current', 'near', 'far']), new Map([
    ['near', { distance: 4 }], ['far', { distance: 20 }]
  ]), 'current');
  assert.deepEqual([...result], ['current', 'near']);
  assert.equal(m.state().level, 'watch');
});

test('critical pressure releases hidden GPU residency without reducing resolution', () => {
  const m = create({ geometryBudget: 10, textureBudget: 10 });
  m.sample({ info: { memory: { geometries: 10, textures: 10 } } }, 50);
  const result = m.selectPrepared(new Set(['visible']), new Set(['visible', 'hidden']), new Map(), 'current');
  assert.deepEqual([...result].sort(), ['current', 'visible']);
  assert.equal(m.state().level, 'critical');
});
