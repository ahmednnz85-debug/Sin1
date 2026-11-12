const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = { window: {}, Number, Math };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'dynamic-resolution.js'), 'utf8'), context);
const create = context.window.SinDynamicResolution.create;

test('scale is bounded and reduces gradually after each 1.5 s low-FPS window', () => {
  const g = create({ min: 0.82, max: 0.92, initial: 0.92, downStep: 0.02, upStep: 0.01 });
  assert.equal(g.value(), 0.92);
  assert.equal(g.sample(51, 1500, false).value, 0.9);
  assert.equal(g.sample(48, 1500, false).value, 0.88);
  for (let i = 0; i < 20; i++) g.sample(30, 1500, false);
  assert.equal(g.value(), 0.82);
});

test('recovery requires 3 seconds continuously above 58 FPS and uses small steps', () => {
  const g = create({ min: 0.82, max: 0.92, initial: 0.9, downStep: 0.02, upStep: 0.01 });
  assert.equal(g.sample(59, 1500, false).value, 0.9);
  assert.equal(g.sample(59, 1499, false).value, 0.9);
  assert.equal(g.sample(59, 1, false).value, 0.91);
  assert.equal(g.sample(57, 1500, false).value, 0.91);
  assert.equal(g.sample(59, 3000, false).value, 0.92);
  for (let i = 0; i < 20; i++) g.sample(60, 3000, false);
  assert.equal(g.value(), 0.92);
});

test('transition/loading samples do not alter scale and reset recovery hysteresis', () => {
  const g = create({ min: 0.82, max: 0.92, initial: 0.86, downStep: 0.02, upStep: 0.01 });
  g.sample(59, 1500, false);
  assert.equal(g.sample(20, 1500, true).value, 0.86);
  assert.equal(g.sample(59, 1500, false).value, 0.86);
  assert.equal(g.sample(59, 1500, false).value, 0.87);
});

test('severe 3 FPS frames drive the default render scale to its safe floor within six sample windows', () => {
  const g = create();
  for (let i = 0; i < 6; i++) g.sample(3, 1500, false);
  assert.equal(g.value(), 0.58);
  assert.equal(g.sample(59, 3000, false).value, 0.59);
});

test('triangle budgets under 600k raise the dynamic resolution floor to at least 0.85', () => {
  const g = create();
  for (let i = 0; i < 6; i++) g.sample(3, 1500, false);
  assert.equal(g.value(), 0.58);
  assert.equal(g.sample(55, 1500, false, { triangles: 450000 }).value, 0.85);
  assert.ok(g.sample(55, 1500, false, { triangles: 900000 }).value <= 0.85);
});

test('critical memory pressure drops scale; recovery still needs 3 s of headroom (hysteresis)', () => {
  const g = create({ min: 0.70, max: 1.00, initial: 1.00, downStep: 0.08, upStep: 0.01, lowerFps: 52, upperFps: 58, recoveryMs: 3000 });
  assert.equal(g.sample(60, 1500, false, { memoryLevel: 'critical' }).value, 0.92);
  assert.equal(g.sample(60, 1500, false, { memoryLevel: 'critical' }).value, 0.84);
  // High FPS but still 'watch' must not climb (hysteresis).
  assert.equal(g.sample(60, 3000, false, { memoryLevel: 'watch' }).value, 0.84);
  // After memory returns to normal, 3 s above 58 FPS climbs one step.
  assert.equal(g.sample(60, 3000, false, { memoryLevel: 'normal' }).value, 0.85);
});
