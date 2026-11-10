const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const palace = fs.readFileSync(path.join(__dirname, '..', 'palaceInterior.js'), 'utf8');
const wings = fs.readFileSync(path.join(__dirname, '..', 'wings.js'), 'utf8');
const cinematic = fs.readFileSync(path.join(__dirname, '..', 'cinematic.js'), 'utf8');

test('palace warm-up does not tick wing streaming during REVEAL', () => {
  const tickLine = palace.split('\n').find((line) => line.includes('animateHall(dt, ctx)') && line.includes('hallBuilt'));
  assert.ok(tickLine, 'animateHall tick line missing');
  assert.match(tickLine, /FADING_IN.*ENTRANCE.*SETTLE.*DONE/);
  assert.equal(tickLine.includes('REVEAL'), false);
  assert.match(palace, /Safari kills the tab and reloads the opening screen at 99%/);
});

test('entrance warm hides wing regions and does not warm wing-root materials', () => {
  assert.match(palace, /g\.userData\._entryWarmVis = g\.visible !== false/);
  assert.match(palace, /regionGroups\.forEach\(function \(g\)/);
  assert.match(palace, /Do not warm wing-room materials at entrance/);
  assert.equal(/consider\(wingRuntime\.root,\s*true\)/.test(palace), false);
});

test('wing culling refuses to stream while palace is warming', () => {
  assert.match(wings, /ps === 'SETUP' \|\| ps === 'REVEAL' \|\| ps === 'LOADING'/);
  assert.match(wings, /Never stream\/dress\/unload while the palace loading warm-up/);
});

test('mobile pixel ratio stays at 1× to avoid Safari OOM at palace entry', () => {
  assert.match(cinematic, /mobile \? 1 : 2/);
  assert.match(cinematic, /Safari to kill the tab and reload the opening/);
});

test('checkpoint restore is deferred after DONE instead of mid fade', () => {
  assert.match(palace, /holdT < 1\.25/);
  assert.match(palace, /SinRoomCheckpoint\.restore/);
  const fadeDone = palace.indexOf("note('done (entrance cinematic skipped)')");
  const immediateRestoreInFade = palace.slice(fadeDone, fadeDone + 350);
  assert.doesNotMatch(immediateRestoreInFade, /SinRoomCheckpoint\.restore\(ctx\)/);
});
