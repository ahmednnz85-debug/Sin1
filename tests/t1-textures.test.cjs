const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const textureRoot = path.join(root, 'assets', 'textures', 'rooms', 'T1');
const manifest = JSON.parse(fs.readFileSync(path.join(textureRoot, 'manifest.json'), 'utf8'));
const moduleSource = fs.readFileSync(path.join(root, 't1-entrance.js'), 'utf8');
const testPage = fs.readFileSync(path.join(__dirname, 't1-texture-test.html'), 'utf8');

test('all 20 atlas panels and surface maps are present at native resolution', () => {
  assert.equal(manifest.entries.length, 20);
  assert.equal(manifest.upscaled, false);
  const names = new Set();
  const maps = new Set();
  for (const entry of manifest.entries) {
    assert.ok(!names.has(entry.name), `duplicate texture name: ${entry.name}`);
    names.add(entry.name);
    assert.ok(!maps.has(entry.runtime_map), `duplicate map path: ${entry.runtime_map}`);
    maps.add(entry.runtime_map);
    const sourcePath = path.join(root, entry.source_file);
    const mapPath = path.join(root, entry.runtime_map);
    assert.ok(fs.statSync(sourcePath).size > 100, `missing/empty source crop: ${entry.source_file}`);
    assert.ok(fs.statSync(mapPath).size > 100, `missing/empty runtime map: ${entry.runtime_map}`);
    assert.ok(entry.panel_size_px.every(n => Number.isInteger(n) && n > 0));
    assert.ok(entry.map_size_px.every(n => Number.isInteger(n) && n > 0));
    assert.ok(entry.surface_note.length > 0);
  }
  assert.equal(maps.size, 20);
});

test('every runtime map is assigned to a material slot with shared-load caching', () => {
  const defs = [...moduleSource.matchAll(/\{ slot: '([^']+)', file: '([^']+)'/g)];
  assert.equal(defs.length, 21); // 20 images; the stone map also serves the independent wallStone slot.
  assert.equal(new Set(defs.map(x => x[2])).size, 20);
  const registeredFiles = new Set(defs.map(x => x[2]));
  for (const entry of manifest.entries) {
    assert.ok(registeredFiles.has(path.basename(entry.runtime_map)), `unassigned runtime map: ${entry.runtime_map}`);
  }
  assert.match(moduleSource, /MirroredRepeatWrapping/);
  assert.match(moduleSource, /textureCache/);
  assert.match(moduleSource, /api\.setTexture/);
  assert.match(moduleSource, /api\.setColor/);
});

test('color setters and texture setters remain independent from geometry dimensions', () => {
  assert.match(moduleSource, /api\.setColor\s*=\s*function/);
  assert.match(moduleSource, /api\.setTexture\s*=\s*function/);
  assert.match(moduleSource, /repeatUvs\(g, key, type/);
  assert.match(moduleSource, /m\.name = 'T1-' \+ key/);
  assert.match(testPage, /SinT1Entrance\.build\(room,scene,ctx\)/);
  assert.match(testPage, /loaded===keys\.length/);
});
