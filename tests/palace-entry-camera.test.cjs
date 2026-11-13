const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const palace = fs.readFileSync(path.join(__dirname, '..', 'palaceInterior.js'), 'utf8');

test('blocked palace follow camera smoothly selects a collision-checked alternate direction without per-frame candidate scans', () => {
  const start = palace.indexOf('function followCamera(cam, hero, yaw, pitch, dist, dt, snap, cinematic)');
  const end = palace.indexOf('function constrainCamera(cam, hero)', start);
  const follow = palace.slice(start, end);
  assert.ok(start >= 0 && end > start, 'followCamera must be present');
  assert.match(palace, /escapeYaw: 0, escapePitch: 0, escapeTargetYaw: 0, escapeTargetPitch: 0, escapeCheckAt: 0/);
  assert.match(follow, /if \(now >= rig\.escapeCheckAt\)/);
  assert.match(follow, /baseSafe < 1\.35/);
  assert.match(follow, /\[\[-1\.1, 0\.55\], \[1\.1, 0\.55\]\]/);
  assert.match(follow, /rig\.escapeCheckAt = now \+ 500/);
  assert.match(follow, /rig\.escapeYaw \+= wrapAngle\(rig\.escapeTargetYaw - rig\.escapeYaw\) \* turn/);
  assert.match(follow, /const safe = castCamera\(px, py, pz, ux, uy, uz, rig\.ds, p\.y, false\)/);
  assert.match(follow, /cam\.position\.set\(px \+ ux \* rig\.d, py \+ uy \* rig\.d, pz \+ uz \* rig\.d\)/);
});
