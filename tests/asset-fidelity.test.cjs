const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const palace = fs.readFileSync(path.join(root, 'palaceInterior.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const wings = fs.readFileSync(path.join(root, 'wings.js'), 'utf8');

test('audit pages exist and cover every GLB', () => {
  const r = spawnSync(process.execPath, ['tools/audit-assets.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const data = JSON.parse(fs.readFileSync(path.join(root, 'assets-audit-data.json'), 'utf8'));
  assert.ok(data.glbCount >= 60);
  assert.ok(data.imageCount >= 50);
  assert.equal((data.errors || []).length, 0);
  assert.ok(fs.existsSync(path.join(root, 'assets-audit.html')));
  assert.ok(fs.existsSync(path.join(root, 'runtime-diff.html')));
  assert.ok(fs.existsSync(path.join(root, 'compare.html')));
});

test('GLB material inventiveness is removed', () => {
  assert.match(palace, /applyAuthoredTextureColorSpaces/);
  assert.doesNotMatch(palace, /m\.metalness = 0\.3/);
  assert.doesNotMatch(palace, /m\.side = THREE\.DoubleSide;\s*if \(palaceEnv\)/);
  assert.doesNotMatch(palace, /m\.envMap = palaceEnv;\s*if \(!m\.envMapIntensity\) m\.envMapIntensity = 0\.45/);
  assert.match(palace, /do NOT blanket-assign palaceEnv/);
  assert.match(index, /do not invent envMapIntensity/);
  assert.match(wings, /applyWingAuthoredColorSpaces/);
});

test('fidelity probe is wired', () => {
  assert.ok(fs.existsSync(path.join(root, 'fidelity-probe.js')));
  assert.match(index, /fidelity-probe\.js/);
  assert.match(palace, /SinFidelityProbe/);
});
