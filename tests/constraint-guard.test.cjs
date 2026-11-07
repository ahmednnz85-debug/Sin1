const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const palace = fs.readFileSync(path.join(__dirname, '..', 'palaceInterior.js'), 'utf8');
const wings = fs.readFileSync(path.join(__dirname, '..', 'wings.js'), 'utf8');
const cinematic = fs.readFileSync(path.join(__dirname, '..', 'cinematic.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('light budget stays fixed at eight and outside culling uses intensity, not visibility', () => {
  assert.match(palace, /lightCount:\s*8\b/);
  const start = palace.indexOf('function cullOutsideLights');
  const end = palace.indexOf('function updateOutsideLightFades', start);
  const culling = palace.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(culling, /_palaceIntensityTarget\s*=\s*on\s*\?\s*0/);
  assert.doesNotMatch(culling, /\.visible\s*=\s*false/);
  assert.match(palace, /1\s*-\s*Math\.exp\(-safeDt\s*\/\s*0\.28\)/);
  assert.match(palace, /function tickInner\(dt, ctx\)\s*\{\s*lastContext = ctx;\s*lastDt = dt;\s*updateOutsideLightFades\(dt\);/);
});

test('torch InstancedMesh and K1 meshes remain explicitly uncullable', () => {
  assert.match(wings, /fire\.name\s*=\s*[^;]*torch-fire[^;]*;\s*fire\.frustumCulled\s*=\s*false/);
  assert.match(wings, /node\.frustumCulled\s*=\s*false;\s*node\.visible\s*=\s*true/);
});

test('frame loop does not run PMREM generation or asynchronous shader compilation', () => {
  const start = index.indexOf('function loop(ts)');
  const end = index.indexOf("init().catch", start);
  assert.ok(start >= 0 && end > start);
  const loop = index.slice(start, end);
  assert.doesNotMatch(loop, /PMREM|compileAsync/);
});

test('shadow HUD and diagnostics expose live renderer state, not only the tier policy', () => {
  assert.match(cinematic, /Renderer shadowMap '\s*\+ \(mapOn/);
  assert.match(cinematic, /shadowMapEnabled:\s*!!\(R && R\.shadowMap && R\.shadowMap\.enabled\)/);
  assert.match(cinematic, /function shadowSnapshot\(\)/);
  assert.match(cinematic, /shadowFrustum: camera \?/);
  assert.doesNotMatch(cinematic, /R\.shadowMap\.mapSize/);
  assert.match(cinematic, /sun && sun\.shadow && sun\.shadow\.mapSize/);
});
