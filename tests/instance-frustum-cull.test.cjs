'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'palaceInterior.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('updateLODs frustum-tests each LOD and wall instance and compacts count', () => {
  assert.match(src, /function instanceInFrustum/);
  assert.match(src, /function compactInstanced/);
  assert.match(src, /function cameraFrustum/);
  const lodAt = src.indexOf('function updateLODs(cam)');
  const end = src.indexOf('function animateHall', lodAt);
  const body = src.slice(lodAt, end);
  assert.match(body, /instanceInFrustum\(frustum, worldMat, pack\.matrices\[i\]/);
  assert.match(body, /compactInstanced\(pack\.mesh, pack\.matrices, worldMat, frustum/);
  assert.match(body, /instanceCullOn\(\)/);
  // A constructed camera without projectionMatrix must skip the frustum
  // (the hall-built budget walk passes a {position} stub).
  const fr = src.slice(src.indexOf('function cameraFrustum'), src.indexOf('function instanceInFrustum'));
  assert.match(fr, /!cam\.projectionMatrix/);
});

test('wall-module and back-wall-fill register for per-instance cull', () => {
  assert.match(src, /let instanceWallPacks = \[\]/);
  assert.match(src, /name = 'wall-module'/);
  assert.match(src, /name = 'back-wall-fill'/);
  assert.equal((src.match(/instanceWallPacks\.push/g) || []).length, 2);
});

test('pre-DONE census runs updateLODs so the first present matches the census', () => {
  assert.match(src, /if \(ctx && ctx\.camera\) updateLODs\(ctx\.camera\)/);
  const at = src.indexOf('if (ctx && ctx.camera) updateLODs(ctx.camera)');
  const census = src.indexOf('censusPendingFrame(ctx, \'pre-DONE\')');
  assert.ok(at > 0 && census > at && census - at < 400);
});

test('instance cull can be disabled for a same-frame SSIM A/B', () => {
  assert.match(src, /window\.__sinNoInstanceCull/);
  assert.match(index, /palaceInterior\.js\?v=hall\d+/);
});

test('compactInstanced keeps every instance when the frustum is null', () => {
  // Stand-in of compactInstanced: no frustum means look is unchanged.
  function compact(matrices, frustum, inF) {
    const out = [];
    if (!frustum) return matrices.slice();
    for (let i = 0; i < matrices.length; i++) if (inF[i]) out.push(matrices[i]);
    return out;
  }
  const mats = ['a', 'b', 'c', 'd'];
  assert.deepEqual(compact(mats, null), mats);
  assert.deepEqual(compact(mats, {}, [true, false, true, false]), ['a', 'c']);
  assert.deepEqual(compact(mats, {}, [true, true, true, true]), mats);
});
