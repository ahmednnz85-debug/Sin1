const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createResidency = require('../wing-gpu-residency.js');

function resource(extra = {}) {
  return Object.assign({ disposed: 0, dispose() { this.disposed++; } }, extra);
}
function group(children = [], visible = true) {
  return { visible, children };
}
function mesh(geometry, material, extra = {}) {
  return Object.assign({ isMesh: true, visible: true, geometry, material, children: [] }, extra);
}

test('hidden room GPU resources are disposed, shared resources are retained, and re-entry rehydrates safely', () => {
  const sharedGeometry = resource();
  const sharedTexture = resource({ isTexture: true, image: {} });
  const sharedMaterial = resource({ map: sharedTexture });
  const hiddenGeometry = resource();
  const shaderTexture = resource({ isTexture: true, image: {} });
  const hiddenMaterial = resource({ uniforms: { uMap: { value: [shaderTexture] } } });
  const instancedDispose = resource();
  const scene = group();
  const wingRoot = group();
  const commonWall = mesh(sharedGeometry, sharedMaterial);
  const roomA = group([mesh(sharedGeometry, sharedMaterial)]);
  const roomB = group([
    mesh(sharedGeometry, sharedMaterial),
    mesh(hiddenGeometry, hiddenMaterial),
    { isInstancedMesh: true, visible: true, children: [], dispose: instancedDispose.dispose.bind(instancedDispose) }
  ], false);
  const outside = group([mesh(sharedGeometry, sharedMaterial)]);
  wingRoot.children.push(commonWall, roomA, roomB);
  scene.children.push(wingRoot, outside);
  const regions = new Map([['A', roomA], ['B', roomB]]);
  const manager = createResidency();

  const first = manager.sync(scene, wingRoot, regions);
  assert.equal(hiddenGeometry.disposed, 1);
  assert.equal(hiddenMaterial.disposed, 0);
  assert.equal(shaderTexture.disposed, 1);
  assert.equal(instancedDispose.disposed, 1);
  assert.equal(sharedGeometry.disposed, 0);
  assert.equal(sharedMaterial.disposed, 0);
  assert.equal(sharedTexture.disposed, 0);
  assert.deepEqual(first.activeRegions, ['A']);
  assert.equal(first.releasedThisSync, 3);

  const repeated = manager.sync(scene, wingRoot, regions);
  assert.equal(repeated.releasedThisSync, 0);
  assert.equal(hiddenGeometry.disposed, 1);

  roomB.visible = true;
  const reentered = manager.sync(scene, wingRoot, regions);
  assert.deepEqual(reentered.activeRegions, ['A', 'B']);
  assert.equal(reentered.releasedThisSync, 0);
  assert.ok(reentered.resident.geometries >= 2);

  roomB.visible = false;
  const leftAgain = manager.sync(scene, wingRoot, regions);
  assert.equal(leftAgain.releasedThisSync, 3);
  assert.equal(hiddenGeometry.disposed, 2);
  assert.equal(hiddenMaterial.disposed, 0);
  assert.equal(shaderTexture.disposed, 2);
  assert.equal(instancedDispose.disposed, 2);
  assert.equal(sharedGeometry.disposed, 0);
  assert.equal(sharedMaterial.disposed, 0);
  assert.equal(sharedTexture.disposed, 0);
});

test('wing culling calls GPU residency synchronization and is camera-driven, draws everything in sight, and keeps prepared rooms resident', () => {
  const wings = fs.readFileSync(path.join(__dirname, '..', 'wings.js'), 'utf8');
  const cullingAt = wings.indexOf('function updateCulling(force)');
  const tickAt = wings.indexOf('function tick(dt)', cullingAt);
  assert.ok(cullingAt >= 0 && tickAt > cullingAt);
  const culling = wings.slice(cullingAt, tickAt);
  assert.match(culling, /visibilityPlanner\.plan\(state\.regions, state\.links, origin, view/);
  assert.doesNotMatch(culling, /distM < 18/);
  assert.doesNotMatch(culling, /renderBudget\.choose\(/);
  assert.match(culling, /state\.palaceNear = id === 'Palace' \|\| isArch/);
  assert.match(culling, /gpuResidency\.sync\(state\.ctx\.scene, state\.root, state\.regionGroups, preparedIds\)/);
  assert.match(wings, /visibleRegionTriangles/);
  assert.match(wings, /if \(state\.built && !state\.building\) updateCulling\(true\)/);
});

test('prepared hidden regions are not disposed', () => {
  const geo = resource();
  const room = group([mesh(geo, resource())], false);
  const wingRoot = group([room]);
  const scene = group([wingRoot]);
  const manager = createResidency();
  manager.sync(scene, wingRoot, new Map([['P', room]]), new Set(['P']));
  assert.equal(geo.disposed, 0);
  manager.sync(scene, wingRoot, new Map([['P', room]]), new Set());
  assert.equal(geo.disposed, 1);
});
