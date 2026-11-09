const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const wings = fs.readFileSync(path.join(root, 'wings.js'), 'utf8');
const palace = fs.readFileSync(path.join(root, 'palaceInterior.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('residency profiles release the requested palace and distant-wing groups', () => {
  assert.match(wings, /PALACE_NEAR:\s*new Set\(\['K1', 'KC12', 'K2', 'KC1', 'KC2', 'T1', 'L1', 'REAR'\]\)/);
  assert.match(wings, /K2:\s*new Set\(\['K1', 'KC12', 'K2', 'KC1', 'KC2', 'K5', 'REAR'\]\)/);
  assert.match(wings, /K3:\s*new Set\(\['K2', 'KC1', 'KC3', 'K3', 'KC12'\]\)/);
  assert.match(wings, /K4:\s*new Set\(\['K3', 'KC1', 'KC2', 'KC3', 'KC4', 'K4'\]\)/);
  assert.match(wings, /state\.suspendedRegions = new Set/);
  assert.match(wings, /g\.userData\.memoryResident = resident/);
  assert.match(wings, /function restoreRegionGroup\(group\)/);
  assert.match(wings, /o\.visible = o\.userData\._memoryVisible/);
});

test('KC2, KC3 and KC4 are explicit restoration checkpoints', () => {
  assert.match(wings, /if \(id === 'KC2' \|\| id === 'Palace' \|\| id === 'K1'/);
  assert.match(wings, /if \(id === 'KC3'\) return 'K3_RETURN'/);
  assert.match(wings, /if \(id === 'KC4'\) return 'K4_RETURN'/);
  assert.match(wings, /setResidency, residencyReport/);
});

test('main palace hall follows the residency profile', () => {
  assert.match(palace, /function setMemoryProfile\(mode\)/);
  assert.match(palace, /!\/\^\(K2\|K3\|K4\)\$\/.test\(memoryProfile\)/);
  assert.match(palace, /setMemoryProfile: setMemoryProfile/);
});

test('opening scene keeps its complete loading gate before the menu', () => {
  assert.match(index, /await waitForSceneTextures\(\);/);
  assert.match(index, /state='ready';\$\('st'\)\.textContent='جاهز'/);
  assert.match(index, /\$\('loading-pane'\)\.style\.display='none'/);
});
