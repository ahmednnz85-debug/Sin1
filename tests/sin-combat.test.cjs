const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RULES, createVitals, resolveDamage, sweep, clock } = require('../sin-combat.js');

const point = (x, y, z = 0) => ({ x, y, z });
const defense = (options = {}) => ({ alignment: 1, blocking: true, guardAge: .4, ...options });
const sword = { damage: 20, posture: 40 };
const contact = point(0, 1);

test('direction, guard age and invulnerability decide damage only after contact', () => {
  const target = createVitals(RULES.hero);
  assert.equal(resolveDamage(target, sword, defense(), null), null);
  assert.equal(resolveDamage(target, sword, defense({ invulnerable: true }), contact), null);
  assert.equal(resolveDamage(target, sword, defense({ guardAge: .12 }), contact).kind, 'parry');
  assert.equal(target.state.health, 100);
  const blocked = resolveDamage(target, sword, defense(), contact);
  assert.equal(blocked.kind, 'block');
  assert.ok(Math.abs(blocked.damage - 3.6) < 1e-10);
  assert.equal(target.state.posture, 40);
  assert.equal(resolveDamage(target, sword, defense({ alignment: -1, guardAge: 0 }), contact).damage, 20);
  assert.equal(resolveDamage(target, { ...sword, blockable: false }, defense({ guardAge: 0 }), contact).damage, 20);
});

test('posture breaks once, recovers independently and resets for retries', () => {
  const target = createVitals(RULES.hero);
  assert.equal(resolveDamage(target, sword, defense(), contact).broken, false);
  assert.equal(resolveDamage(target, sword, defense(), contact).broken, false);
  assert.equal(resolveDamage(target, sword, defense(), contact).kind, 'break');
  assert.equal(resolveDamage(target, sword, defense(), contact).broken, false);
  const hp = target.state.health;
  target.step(5);
  assert.equal(target.state.posture, 100);
  target.recover(.4);
  target.step(2);
  assert.equal(target.state.posture, 40);
  target.step(1);
  assert.equal(target.state.health, hp);
  assert.ok(target.state.posture < 40);
  target.reset();
  assert.equal(target.state.health, 100);
  assert.equal(target.state.posture, 0);
  assert.equal(target.state.broken, false);
});

test('swept weapon hits between frames, respects height and distinguishes other targets', () => {
  const near = { a: point(0, .45), b: point(0, 1.55), radius: .26 };
  const far = { ...near, a: point(0, .45, 3), b: point(0, 1.55, 3) };
  const overhead = { ...near, a: point(0, 2.5), b: point(0, 3.5) };
  const first = [point(-4, .9), point(-3, 1.7)];
  const second = [point(3, .9), point(4, 1.7)];
  const collision = point(9, 9);
  assert.equal(sweep(...first, ...second, .14, [far, overhead, near], collision), near);
  assert.equal(sweep(...first, ...second, .14, [far, overhead], collision), null);
  assert.ok(Math.abs(collision.x) < .2);
  assert.equal(sweep(contact, contact, contact, contact, .1, [near], collision), near);
});

test('combat clock processes 120 Hz at 30, 60 and 120 presentation frames per second', () => {
  for (const fps of [30, 60, 120]) {
    let sampleCount = 0, elapsed = 0;
    const run = clock(dt => { elapsed += dt; sampleCount++; });
    for (let n = 0; n < fps * 3; n++) run.advance(1 / fps);
    assert.equal(sampleCount, 360, fps);
    assert.ok(Math.abs(elapsed - 3) < 1e-8);
    run.advance(3);
    assert.equal(sampleCount, 360 + RULES.maxTicks, 'bound catch-up after a tab/background hitch');
    run.single();
    assert.equal(sampleCount, 361 + RULES.maxTicks);
  }
});
