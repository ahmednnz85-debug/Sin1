const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = { window: {}, Number, Math };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'dynamic-resolution.js'), 'utf8'), context);
const create = context.window.SinDynamicResolution.create;

test('scale is bounded and reduces gradually after each 1.5 s low-FPS window', () => {
  const g = create({ initial: 0.8 });
  assert.equal(g.value(), 0.8);
  assert.equal(g.sample(51, 1500, false).value, 0.76);
  assert.equal(g.sample(48, 1500, false).value, 0.72);
  for (let i = 0; i < 20; i++) g.sample(30, 1500, false);
  assert.equal(g.value(), 0.55);
});

test('recovery requires 3 seconds continuously above 58 FPS and uses small steps', () => {
  const g = create({ initial: 0.7 });
  assert.equal(g.sample(59, 1500, false).value, 0.7);
  assert.equal(g.sample(59, 1499, false).value, 0.7);
  assert.equal(g.sample(59, 1, false).value, 0.72);
  assert.equal(g.sample(57, 1500, false).value, 0.72);
  assert.equal(g.sample(59, 3000, false).value, 0.74);
  for (let i = 0; i < 20; i++) g.sample(60, 3000, false);
  assert.equal(g.value(), 0.8);
});

test('transition/loading samples do not alter scale and reset recovery hysteresis', () => {
  const g = create({ initial: 0.6 });
  g.sample(59, 1500, false);
  assert.equal(g.sample(20, 1500, true).value, 0.6);
  assert.equal(g.sample(59, 1500, false).value, 0.6);
  assert.equal(g.sample(59, 1500, false).value, 0.62);
});
