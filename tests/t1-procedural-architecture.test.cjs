const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const wings = fs.readFileSync(path.join(root, 'wings.js'), 'utf8');
const arch = wings.slice(wings.indexOf('function addT1Architecture'), wings.indexOf('function addColumns', wings.indexOf('function addT1Architecture')));
const layout = wings.slice(wings.indexOf("const T1 = addRoom"), wings.indexOf("const TR1 = addCon", wings.indexOf("const T1 = addRoom")));

test('T1 uses dedicated procedural architecture instead of the former instanced placeholder columns', () => {
  assert.match(wings, /if \(r\.id === 'T1'\) addT1Architecture\(r, g\)/);
  assert.match(arch, /new THREE\.BoxGeometry/);
  assert.match(arch, /new THREE\.CylinderGeometry/);
  assert.match(arch, /new THREE\.TorusGeometry/);
  assert.match(arch, /separateMeshes:true/);
  assert.match(arch, /uvReady:true/);
  assert.match(arch, /color:0x858585/);
});

test('T1 includes symmetric colonnade, reliefs, twin basins and an open double portal', () => {
  assert.match(arch, /T1-column-/);
  assert.match(arch, /T1-relief-chevron-/);
  assert.match(arch, /T1-basin-/);
  assert.match(arch, /T1-double-door-leaf-/);
  assert.match(arch, /T1-portal-arch-layer-/);
  assert.match(arch, /T1-crescent-moon-relief/);
  assert.match(arch, /T1-guardian-lion-/);
  assert.match(arch, /T1-ceiling-coffer-crossbeam-/);
  assert.match(arch, /T1-wall-recess-frame-/);
  assert.match(arch, /existing six-metre T1→T2 link remains unobstructed/);
});

test('T1 keeps its palace footprint and existing T2/TR1 connections', () => {
  assert.match(layout, /rectRegion\('T1', 'Temple', ROOM_NAMES\.T1, back, zT - 6, 16, 12, 8\.5\)/);
  assert.match(wings, /door\('T1-TR1', 'T1', 'TR1'/);
  assert.match(wings, /door\('T1-TC12', 'T1', 'TC12'/);
});

test('HTML cache-bust points to the T1 procedural build', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(index, /wings\.js\?v=20261114t1-ref2/);
});
