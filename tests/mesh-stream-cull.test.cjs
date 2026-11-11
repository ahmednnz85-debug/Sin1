const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const palace = fs.readFileSync(path.join(__dirname, '..', 'palaceInterior.js'), 'utf8');
const wings = fs.readFileSync(path.join(__dirname, '..', 'wings.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('palace GLBs settle strictly one at a time and free buffers', () => {
  assert.match(palace, /MAX_INFLIGHT = 1/);
  assert.match(palace, /for \(let i = 0; i < specs\.length; i\+\+\)/);
  assert.match(palace, /spec\.buf = null/);
  assert.match(palace, /releaseCpuFromResult/);
  // CPU pixels are dropped only after every texture sharing the source is on the GPU.
  assert.doesNotMatch(palace, /armTextureCpuRelease/);
  assert.match(palace, /function textureUploaded/);
  assert.match(palace, /if \(result\.isTexture\) return;/);
  const loadStart = palace.indexOf('function loadPalaceAssets');
  const loadEnd = palace.indexOf('function mat(map, opts)', loadStart);
  const loadFn = palace.slice(loadStart, loadEnd);
  assert.match(loadFn, /await settle\(s\)/);
  assert.doesNotMatch(loadFn, /Promise\.all\(jobs\)/);
  assert.match(loadFn, /One GLB\/texture at a time/);
});

test('hall uses distance cull and prop instancing', () => {
  // Hall is 30H long: the cull distance must cover the whole hall (no pop-in).
  assert.match(palace, /cullDistanceH:\s*40/);
  assert.match(palace, /dist > cull/);
  assert.match(palace, /InstancedMesh\(part\.geometry/);
  assert.match(palace, /mode: instanced \? 'instanced' : 'real'/);
});

test('wing GLBs share a serial queue; K3 table then furniture', () => {
  assert.match(wings, /function enqueueWingLoad/);
  assert.match(wings, /res\.arrayBuffer\(\)/);
  assert.match(wings, /releaseGltfCpu/);
  const rel = wings.slice(wings.indexOf('function releaseGltfCpu'), wings.indexOf('function wingGLB'));
  assert.ok(rel.indexOf('initTexture') >= 0 && rel.indexOf('initTexture') < rel.indexOf('source.data = null'));
  const dress = wings.slice(wings.indexOf('function dressK3'), wings.indexOf('window.PalaceWings'));
  const tableAt = dress.indexOf('K3_LAZY.table');
  const furnAt = dress.indexOf('K3_LAZY.furn');
  assert.ok(tableAt >= 0 && furnAt > tableAt);
  // furniture load is nested after table callback, not a sibling parallel call
  assert.match(dress, /k3LoadGLB\(K3_LAZY\.table[\s\S]*k3LoadGLB\(K3_LAZY\.furn/);
});

test('blood sky and skyline are disposed after outdoor teardown', () => {
  assert.match(index, /sky_babylon_blood/);
  assert.match(index, /__sinSkyDisposed/);
  assert.match(index, /exterior\+sky disposed \(blood\+skyline\)/);
  assert.match(index, /redSkyTex=null/);
});

test('K1 preload is lod25 hall; الاستقبال.glb is not in assetList', () => {
  assert.match(wings, /K1_RoyalReceptionHall_lod25\.glb/);
  const assetList = wings.slice(wings.indexOf('function assetList'), wings.indexOf('function provideAsset'));
  assert.doesNotMatch(assetList, /الاستقبال\.glb/);
  assert.doesNotMatch(assetList, /طاولة/);
});
