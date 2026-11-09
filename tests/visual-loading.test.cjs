const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const cinematic = fs.readFileSync(path.join(__dirname, '..', 'cinematic.js'), 'utf8');
const resolution = fs.readFileSync(path.join(__dirname, '..', 'dynamic-resolution.js'), 'utf8');
const palace = fs.readFileSync(path.join(__dirname, '..', 'palaceInterior.js'), 'utf8');
const wings = fs.readFileSync(path.join(__dirname, '..', 'wings.js'), 'utf8');

test('startup waits for all scene textures and decodes them before opening the menu', () => {
  const initAt = index.indexOf('async function init(){');
  const readyAt = index.indexOf("state='ready'", initAt);
  assert.ok(initAt >= 0 && readyAt > initAt);
  const init = index.slice(initAt, readyAt);
  assert.match(init, /await waitForSceneTextures\(\)/);
  assert.match(index, /img\.decode\?img\.decode\(\)\.catch\(\(\)=>\{\}\)/);
  assert.match(index, /جارٍ تجهيز جميع الخامات/);
});

test('resolution governor recovers severe mobile frame stalls and remains bounded', () => {
  assert.match(cinematic, /min:\s*0\.58,\s*max:\s*1\.00,\s*initial:\s*1\.00,\s*downStep:\s*0\.08,\s*upStep:\s*0\.01/);
  assert.match(cinematic, /t\.shadow\s*=\s*true/);
  assert.doesNotMatch(cinematic, /t\.shadow\s*=\s*false/);
  assert.match(resolution, /var min = Number\.isFinite\(options\.min\) \? options\.min : 0\.58/);
  assert.match(cinematic, /dt > 2000 \|\| busy \|\| document\.hidden/);
  assert.doesNotMatch(cinematic, /dt > 250 \|\| busy/);
  assert.match(cinematic, /Math\.min\(mobile \? 1 : 1\.25, Math\.max\(1, dpr\)\) \* E\.scale/);
});

test('cinematic grade/fog are restrained and exposure is consistent', () => {
  assert.match(index, /rgba\(46,86,132,\.15\).*rgba\(214,132,67,\.13\)/);
  assert.match(index, /new THREE\.FogExp2\(0xc6a77b,0\.0038\)/);
  assert.equal((index.match(/renderer\.toneMappingExposure=1\.02;/g) || []).length, 2);
  assert.doesNotMatch(index, /renderer\.toneMappingExposure=1\.10/);
});

test('palace loading starts only after the fade, exterior disposal and reference cleanup', () => {
  const loadStart = palace.indexOf('function startPalaceLoad(ctx)');
  const loadCall = palace.indexOf('loadPalaceAssets()', loadStart);
  const release = palace.indexOf('releaseCity(ctx && ctx.scene, ctx && ctx.hero)', loadStart);
  assert.ok(loadStart >= 0 && release > loadStart && loadCall > release);
  assert.match(palace, /if \(state === 'LOADING'\)[\s\S]{0,160}startPalaceLoad\(ctx\)/);
  const threshold = palace.slice(palace.indexOf("if (state === 'IDLE')"), palace.indexOf("if (state === 'FADING_OUT')"));
  assert.doesNotMatch(threshold, /loadPalaceAssets\(\)/);
  assert.match(palace, /keepDuringPalace/);
  assert.match(palace, /retainedResources\.has\(g\)/);
  assert.match(palace, /window\.__releaseExteriorStage/);
  assert.match(index, /extras\.length=0;colliders\.length=0;marketOpenings\.length=0;vegChunks\.length=0;palMeshes\.length=0;palBVH=null/);
});

test('all palace wings share one stable ambient source and synchronized subtle flicker', () => {
  assert.match(wings, /PalaceWingsUnifiedAmbient/);
  assert.match(wings, /new THREE\.HemisphereLight\(0xffe2b8, 0x5c3a28, 0\.78\)/);
  assert.match(wings, /const sharedFlicker = 0\.98 \+ 0\.02 \* Math\.sin/);
  assert.match(wings, /\[state\.k2Lights, state\.k3Lights\]/);
});

test('palace warm-up skips materials under hidden wing-room groups', () => {
  const start = palace.indexOf('const consider = function (root, visibleOnly)');
  const end = palace.indexOf('warmMeshes.forEach(function (e)', start);
  assert.ok(start >= 0 && end > start);
  const warmup = palace.slice(start, end);
  assert.match(warmup, /if \(visibleOnly\)[\s\S]*if \(!parent\.visible\) return/);
  assert.match(warmup, /consider\(wingRuntime\.root, true\)/);
});

test('open palace doorway preview is placed behind the aperture, not occluded on the far wall', () => {
  assert.match(index, /const imageZ\s*=\s*Math\.min\(wallZ\s*-\s*0\.06,\s*frontZ\s*\+\s*0\.62\)/);
  assert.match(index, /plane\.position\.set\(doorX,\s*doorY,\s*imageZ\)/);
});
