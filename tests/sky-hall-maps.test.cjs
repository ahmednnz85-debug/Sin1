const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cinematic = fs.readFileSync(path.join(root, 'cinematic.js'), 'utf8');
const palace = fs.readFileSync(path.join(root, 'palaceInterior.js'), 'utf8');
const mem = fs.readFileSync(path.join(root, 'process-memory.js'), 'utf8');

test('sky dome is pinned to the far plane so camera.far=1200 cannot clip a 1500-radius sphere', () => {
  // Original game used far=3000; a later landscape/FOV change set far=1200
  // while leaving makeSkyPhoto(1500). On a 73° landscape phone the sphere's
  // centre is past the far plane (black clear-color zenith) and only the
  // wide-angle edges stay visible (the red slivers on the real iPhone).
  assert.match(html, /PerspectiveCamera\(CAM_VFOV,1,0\.25,1200\)/);
  assert.match(html, /makeSkyPhoto\(1500\)/);
  const vs = html.match(/vertexShader:'varying vec3 vD;void main\(\)\{[^']+\}'/g) || [];
  assert.ok(vs.length >= 2, 'gradient + photo sky vertex shaders');
  vs.forEach(function (s) {
    assert.match(s, /cp\.z=cp\.w\*0\.9999/, 'clip-space z is at the far plane: ' + s);
  });
});

test('on-device tex diagnostic sits under the build badge', () => {
  assert.match(html, /id = 'sin-tex-diag'/);
  assert.match(html, /window\.__sinSetTexDiag/);
  assert.match(html, /function __sinUpdateTexDiag/);
  assert.match(html, /function __sinTexSnap/);
  assert.match(html, /sky '\+__sinTexSnap\(map/);
  assert.match(html, /__sinFindMap\(scene,'floor'/);
  assert.match(html, /__sinFindMap\(scene,'ceiling'/);
  assert.match(html, /__sinFindMap\(scene,'back-relief'/);
});

test('hall floor, ceiling, carpet and back mural keep their CPU images', () => {
  assert.match(palace, /function keepHallTex/);
  assert.match(palace, /t\.userData\.sinKeepCpu = true/);
  assert.match(palace, /t\.userData\.sinHallShell = true/);
  assert.match(palace, /keepHallTex\(tex\);/); // textureFromBytes
  assert.match(palace, /return keepHallTex\(map\)/); // tiledMap
  assert.match(palace, /keepHallTex\(tex\.floor\.clone\(\)\)/);
  assert.match(palace, /keepHallTex\(tex\.ceiling\.clone\(\)\)/);
  assert.match(palace, /keepHallTex\(tex\.back\.clone\(\)\)/);
  assert.match(palace, /keepHallTex\(carpetSrc\.clone\(\)\)/);
  assert.match(palace, /keepHallTex\(tex\.floorBorder\.clone\(\)\)/);
  // palaceInterior's own drain must not drop those shared sources.
  assert.match(palace, /arr\.some\(function \(t\) \{ return t\.userData && t\.userData\.sinKeepCpu; \}\)/);
  assert.match(palace, /arr\.some\(function \(t\) \{ return !!t\.needsUpdate; \}\)/);
  // srgb must not bump version after the CPU image is gone.
  const srgbAt = palace.indexOf('function srgb(tex)');
  const srgb = palace.slice(srgbAt, srgbAt + 700);
  assert.match(srgb, /const img = tex\.image \|\| \(tex\.source && tex\.source\.data\)/);
  assert.match(srgb, /if \(img\) tex\.needsUpdate = true/);
  assert.doesNotMatch(srgb, /aniso\.v;\n    tex\.needsUpdate = true/);
});

test('cinematic wrapRender guards null uploads before draw, and forceP sets P3', () => {
  const guardAt = cinematic.indexOf('SinProcessMemory.guardNullUploads');
  const origAt = cinematic.indexOf('orig(s, c)');
  assert.ok(guardAt > 0 && origAt > guardAt && origAt - guardAt < 250, 'guard runs immediately before orig()');
  assert.match(cinematic, /qs\.has\('forceP'\)/);
  assert.match(cinematic, /window\.__sinForcePressure/);
  assert.match(cinematic, /setPressure\(p\)/);
});

test('process-memory still refuses to drop a pending needsUpdate source', () => {
  assert.match(mem, /list\.some\(function \(t\) \{ return !!t\.needsUpdate; \}\)/);
  assert.match(mem, /function guardNullUploads/);
});
