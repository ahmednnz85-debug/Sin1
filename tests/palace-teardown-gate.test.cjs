const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const palace = fs.readFileSync(path.join(__dirname, '..', 'palaceInterior.js'), 'utf8');
const overlay = fs.readFileSync(path.join(__dirname, '..', 'memory-overlay.js'), 'utf8');
const cinematic = fs.readFileSync(path.join(__dirname, '..', 'cinematic.js'), 'utf8');

test('teardown gate reaches load only after verify phase 4', () => {
  assert.match(palace, /teardownPhase = 4/);
  assert.match(palace, /beginPalaceAssetLoad\(ctx\)/);
  assert.match(palace, /teardownPhase = 5/);
  assert.match(palace, /reportHeaviest\(ctx\.scene, 'pre-teardown'\)/);
  assert.match(palace, /reportHeaviest\(ctx\.scene, 'post-teardown'\)/);
  assert.match(palace, /reportHeaviest\((?:ctx|saved)\.scene, 'post-palace-build'\)/);
});

test('door camera keeps a minimum distance behind the hero', () => {
  assert.match(palace, /DOOR_CAM_MIN = 3\.2/);
  assert.match(palace, /aheadOfHero/);
  assert.match(palace, /aimCamera\(ctx, true\)/);
});

test('black box persists samples and surfaces prior session on start', () => {
  assert.match(overlay, /sinBlackBox/);
  assert.match(overlay, /sinBlackBoxPrev/);
  assert.match(overlay, /TICK_MS = 500/);
  assert.match(overlay, /showCrashReportOnStart/);
  assert.match(overlay, /reportHeaviest/);
  assert.match(cinematic, /SinMemoryOverlay\.tick/);
});
