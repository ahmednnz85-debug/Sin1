'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const root = path.join(__dirname, '..');
const wings = fs.readFileSync(path.join(root, 'wings.js'), 'utf8');
const streamer = fs.readFileSync(path.join(root, 'zone-streamer.js'), 'utf8');
const palace = fs.readFileSync(path.join(root, 'palaceInterior.js'), 'utf8');
const cinematic = fs.readFileSync(path.join(root, 'cinematic.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('door gate waits until the streamed destination is ready (no 2.5 s give-up)', () => {
  assert.match(wings, /function streamedTargets\(/);
  assert.match(wings, /ZONE_DOOR_ABANDON_MS\s*=\s*60000/);
  assert.doesNotMatch(wings, /ZONE_DOOR_WAIT_MS\s*=\s*2500/);
  // A short corridor (K1-KC12) waits for K2 one hop past KC12.
  assert.match(wings, /set\.has\(id\) && h <= 1/);
  // Open passage KC12-K2 still gets a collider until K2 is ready.
  assert.match(wings, /function updatePassageGates\(/);
  assert.match(wings, /_streamGate/);
  assert.match(wings, /updatePassageGates\(\)/);
  // Doors close again if the streamed room behind them is evicted.
  assert.match(wings, /beginDoorMotion\(d, false/);
  assert.match(wings, /Never open into a still-loading room/);
});

test('zone streamer does not reveal a still-loading room on a short timeout', () => {
  assert.match(streamer, /defaultAbandonMs:\s*60000/);
  assert.match(streamer, /still-loading room is NEVER revealed/);
});

test('context loss offers one clean reload and does not auto-onRetry', () => {
  assert.match(palace, /sinContextReload/);
  assert.match(palace, /Do not auto-onRetry/);
  // The old auto-retry on restore must be gone (it left the palace unable to open).
  const restored = palace.slice(palace.indexOf("addEventListener('webglcontextrestored'"));
  const body = restored.slice(0, restored.indexOf('}, false)'));
  assert.doesNotMatch(body, /onRetry\(\)/);
  assert.match(body, /إعادة التحميل/);
});

test('device-profile is loaded before cinematic and the zone streamer', () => {
  const a = index.indexOf('device-profile.js');
  const b = index.indexOf('cinematic.js');
  const c = index.indexOf('zone-streamer.js');
  const d = index.indexOf('wings.js?');
  assert.ok(a > 0 && a < b && b < c && c < d);
});

test('previous visual-regression and lighting fixes are still present', () => {
  // r187 PI on point lights (palaceInterior or cinematic / three-compat)
  const compat = fs.readFileSync(path.join(root, 'three-compat.js'), 'utf8');
  assert.ok(
    /Math\.PI|PI\s*\*/.test(palace) || /intensity.*PI|PI.*intensity/.test(compat) || /PHYSICALLY_CORRECT|legacyLights|_pi/.test(compat + palace),
    'expected a PI / physically-correct light factor to remain'
  );
  // Texture CPU pixels are not nulled before upload (the gold/black regression).
  assert.match(wings, /markReleasable/);
  assert.doesNotMatch(wings.slice(wings.indexOf('function releaseGltfCpu'), wings.indexOf('function releaseGltfCpu') + 800), /texture\.image\s*=\s*null/);
  // Cinematic interior look still exists.
  assert.match(cinematic, /SinGfx/);
  assert.match(cinematic, /installFog/);
  // Zone streamer lifecycle still owns prefetch / compile / atomic reveal.
  assert.match(streamer, /compileAsync/);
  assert.match(streamer, /function reveal\(/);
  // Palace load still gated on city teardown.
  assert.match(palace, /beginPalaceAssetLoad/);
  assert.match(palace, /city not released/);
});

test('visual AUTO tier is not forced to low on iOS; only resolution scales dynamically', () => {
  assert.doesNotMatch(cinematic, /if \(ios && \(wanted === 'high'/);
  assert.doesNotMatch(cinematic, /if \(crash\) \{ base = 'low'/);
  assert.match(cinematic, /dynamicResolution\.sample/);
  assert.match(cinematic, /memoryLevel/);
});
