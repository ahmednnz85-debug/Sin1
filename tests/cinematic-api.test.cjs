const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'cinematic.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('SinGfx.camera stays the CAM settings object (PR #45 black-screen regression)', () => {
  // Follow-cam in index.html reads SinGfx.camera.shoulder. A method named
  // camera() overwrote CAM, shoulder was undefined, want became NaN, and
  // the 3D view went fully black after NEW GAME (same 283k tris / 78 draws).
  assert.match(src, /camera:\s*CAM/);
  assert.match(src, /getCamera\s*\(\)\s*\{\s*return camera;/);
  assert.doesNotMatch(src, /(?:^|\n)\s*camera\s*\(\)\s*\{\s*return camera;/);
  assert.match(index, /SinGfx\.camera\.shoulder/);
  // The follow-cam must treat a missing shoulder as 0, but the real fix is
  // that shoulder is a number. Simulate the overwrite to lock the diagnosis.
  const CAM = { shoulder: 0.36 };
  const broken = { camera: CAM, camera() { return { isCamera: true }; } };
  assert.equal(typeof broken.camera, 'function');
  assert.equal(broken.camera.shoulder, undefined);
  const shK = broken.camera.shoulder;
  const hx = 0 - Math.cos(0) * shK;
  assert.ok(Number.isNaN(hx), 'overwriting camera: CAM produces NaN follow-cam');
  const ok = { camera: CAM, getCamera() { return { isCamera: true }; } };
  assert.equal(typeof ok.camera.shoulder, 'number');
  assert.equal(ok.camera.shoulder, 0.36);
  assert.equal(ok.getCamera().isCamera, true);
  const hxOk = 0 - Math.cos(0) * ok.camera.shoulder;
  assert.ok(Number.isFinite(hxOk));
});

test('cinematic.js is cache-busted after the getCamera fix', () => {
  assert.match(index, /cinematic\.js\?v=20261112r6/);
});

test('FPS HUD keeps last good reading across a >1 s stall (no "FPS 0")', () => {
  assert.match(src, /perf\._lastFr/);
  assert.match(src, /hudStall/);
  // Simulate the formula: after a stall the window may have 1 sample,
  // so we must reuse _lastFr instead of writing 0.
  const stallFormula = (frames, ts, lastFr, avg) => {
    let fr = lastFr || 0;
    if (frames.length > 1 && ts > frames[0]) {
      const cand = (frames.length - 1) * 1000 / (ts - frames[0]);
      if (Number.isFinite(cand) && cand > 0) fr = cand;
    } else if (!fr && avg > 0 && avg < 2000) {
      fr = 1000 / avg;
    }
    return fr;
  };
  assert.equal(stallFormula([5000], 5000, 58.2, 16.7).toFixed(1), '58.2');
  assert.ok(stallFormula([1000, 1016, 1033], 1033, 0, 0) > 50);
});

test('instance wrapRender drains CPU images (prototype hook is shadowed)', () => {
  assert.match(src, /SinProcessMemory && SinProcessMemory\.releaseCpuFromObject/);
  assert.match(src, /upload: false/);
});

test('index.html exposes window.__sinInp for QA movement and cache-busts process-memory r6', () => {
  assert.match(index, /window\.__sinInp\s*=\s*inp/);
  assert.match(index, /process-memory\.js\?v=20261112r6/);
});
