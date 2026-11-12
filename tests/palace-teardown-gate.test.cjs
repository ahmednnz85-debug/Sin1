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
  assert.match(palace, /reportHeaviest\(group, 'post-palace-build'\)/);
  assert.match(palace, /state = 'DONE'/);
  // Full-scene reportHeaviest at SETUP/REVEAL froze WebKit; it now runs after DONE on palace roots only.
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

test('shader warmup uses compileAsync and has no webdriver or software-GL skip', () => {
  assert.doesNotMatch(palace, /navigator\.webdriver/);
  assert.doesNotMatch(palace, /warm-skip-software-gl/);
  assert.doesNotMatch(palace, /WARM_CAP/);
  assert.match(palace, /compileAsync/);
  assert.match(palace, /KHR_parallel_shader_compile/);
  assert.match(palace, /beginWarmSlice/);
  assert.match(palace, /WARM_BUDGET_MS/);
  assert.match(palace, /waitForGlIdle/);
  assert.match(palace, /fenceSync/);
});
