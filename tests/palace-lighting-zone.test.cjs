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

test('authored ORM metalness is respected (clamp only without metalnessMap)', () => {
  assert.match(palace, /function softenPalaceMetal/);
  assert.match(palace, /m\.metalness >= 0\.99\) && !m\.metalnessMap/);
  assert.doesNotMatch(palace, /m\.metalness = 0\.22/);
});

test('palace keeps the original hall PMREM probe as scene.environment', () => {
  assert.match(palace, /makePalaceEnv/);
  assert.match(palace, /ctx\.scene\.environment = palaceEnv/);
  assert.match(palace, /c\.width = 128/);
});

test('zone label switches to palace indoors without re-grading fog/exposure', () => {
  assert.match(cinematic, /zoneName = 'palace'/);
  const i = cinematic.indexOf("zoneName = 'palace'");
  assert.match(cinematic.slice(i, i + 40), /^zoneName = 'palace';\s*return;/);
});

test('r147 legacy PI scale applies to point and spot lights too', () => {
  assert.doesNotMatch(compat, /legacyFalloff && intensity/);
  assert.match(compat, /!light\.isRectAreaLight && !light\.isLightProbe && intensity !== 0/);
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
  // compile + budgeted upload live in the zone streamer (single source of truth).
  const streamer = fs.readFileSync(require('path').join(__dirname, '..', 'zone-streamer.js'), 'utf8');
  assert.match(streamer, /compileAsync/);
  assert.match(streamer, /pumpUploads/);
  // the room must not stay visible while the async compile is pending
  assert.match(streamer, /\} finally \{\s*g\.visible = was;\s*\}/);
});

test('per-asset load timing is recorded', () => {
  assert.match(palace, /downloadMs/);
  assert.match(palace, /parseMs/);
  assert.match(palace, /uploadMs/);
  assert.match(palace, /sinLoadTiming/);
});
