const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const palace = fs.readFileSync(path.join(root, 'palaceInterior.js'), 'utf8');
const cinematic = fs.readFileSync(path.join(root, 'cinematic.js'), 'utf8');
const wings = fs.readFileSync(path.join(root, 'wings.js'), 'utf8');
const compat = fs.readFileSync(path.join(root, 'three-compat.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('metalness clamp applies even when metalnessMap exists', () => {
  assert.match(palace, /function softenPalaceMetal/);
  assert.match(palace, /m\.metalness = 0\.22/);
  assert.match(palace, /softenPalaceMetal\(m\)/);
});

test('palace installs brighter PMREM and scene.environment', () => {
  assert.match(palace, /makePalaceEnv/);
  assert.match(palace, /ctx\.scene\.environment = palaceEnv/);
  assert.match(palace, /c\.width = 256/);
});

test('zone switches to palace indoors and cuts fog', () => {
  assert.match(cinematic, /palace:\s*\{[^}]*fog: 0\.18/);
  assert.match(cinematic, /zoneName = 'palace'/);
});

test('light cache rebuilds promptly for new palace lights', () => {
  assert.match(compat, /entry\.builtAt < 32/);
  assert.doesNotMatch(compat, /entry\.builtAt < 1000/);
});

test('fight button hides indoors so run is not duplicated', () => {
  assert.match(index, /fightB\.style\.display='none'/);
  assert.match(index, /cityReleased/);
});

test('wing dress reveals when ready and spreads GPU uploads', () => {
  assert.match(wings, /function markDressReady/);
  assert.match(wings, /function hideUntilReady/);
  assert.match(wings, /compileAsync/);
  assert.match(wings, /pumpUploads/);
});

test('per-asset load timing is recorded', () => {
  assert.match(palace, /downloadMs/);
  assert.match(palace, /parseMs/);
  assert.match(palace, /uploadMs/);
  assert.match(palace, /sinLoadTiming/);
});
