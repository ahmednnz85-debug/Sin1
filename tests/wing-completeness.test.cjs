const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const wings = fs.readFileSync(path.join(root, 'wings.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const md = fs.readFileSync(path.join(root, 'ADDING_CONTENT.md'), 'utf8');

function extract(name) {
  const re = new RegExp(name + ':\\s*\\[([\\s\\S]*?)\\]');
  const m = wings.match(re);
  assert.ok(m, name + ' list missing');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

test('STREAM_EXPECT lists props, not just walls, for every streamed room', () => {
  const k2 = extract('K2');
  const k3 = extract('K3');
  const k4 = extract('K4');
  for (const n of ['K2-majlis-floor', 'K2-council-table', 'K2-majlis-columns',
    'K2-winged-lion-1', 'K2-winged-lion-2', 'K2-majlis-chandelier', 'K2-majlis-plants']) {
    assert.ok(k2.includes(n), 'K2 missing ' + n);
  }
  for (const n of ['K3-map-floor', 'K3-map-table', 'K3-shelf-a', 'K3-chair-head',
    'K3-chair-n1', 'K3-chair-n2', 'K3-chair-s1', 'K3-chair-s2', 'K3-easel', 'K3-brazier-s']) {
    assert.ok(k3.includes(n), 'K3 missing ' + n);
  }
  for (const n of ['K4-treasury-floor-artwork', 'K4-altarTable', 'K4-kingStatue',
    'K4-frontMural', 'K4-goldChest', 'K4-chandelier', 'K4-lionSphinx']) {
    assert.ok(k4.includes(n), 'K4 missing ' + n);
  }
  // Walls-only must never be treated as a complete room.
  assert.ok(k2.length >= 8 && k3.length >= 16 && k4.length >= 12);
});

test('isComplete delegates to roomCompleteness so walls-only cannot pass', () => {
  assert.match(wings, /isComplete:\s*function\s*\(\)\s*\{\s*return roomCompleteness\('K2'\)\.complete/);
  assert.match(wings, /isComplete:\s*function\s*\(\)\s*\{\s*return roomCompleteness\('K3'\)\.complete/);
  assert.match(wings, /isComplete:\s*function\s*\(\)\s*\{\s*return roomCompleteness\('K4'\)\.complete/);
  assert.match(wings, /function roomCompleteness\(id\)/);
  // Deadlock guard: complete is residency, not world-visible (shells are hidden
  // until the streamer reveals them).
  assert.match(wings, /requiring world-visible here would deadlock/);
  const fn = wings.slice(wings.indexOf('function roomCompleteness'), wings.indexOf('window.PalaceWings'));
  assert.match(fn, /missing\.length === 0 && expect\.length > 0/);
  assert.doesNotMatch(fn, /complete = streamed\s*\?\s*\(missing\.length === 0 && hidden\.length === 0/);
  assert.match(fn, /const revealed = complete && hidden\.length === 0/);
});

test('PalaceWings exports the inspector used by e2e and the door gate', () => {
  assert.match(wings, /roomCompleteness:\s*roomCompleteness/);
  assert.match(wings, /expectedNames:\s*expectedNames/);
  assert.match(wings, /STREAM_EXPECT:\s*STREAM_EXPECT/);
});

test('K2/K3/K4 shells stay hidden until the dress is fully resident', () => {
  const k2 = wings.slice(wings.indexOf("mesh(floorGeo, floorMat, 'K2-majlis-floor'"), wings.indexOf("K2-majlis-walls") + 400);
  assert.match(k2, /hideUntilReady\(floorMesh\)/);
  assert.match(k2, /hideUntilReady\(k2WallMesh\)/);
  const k2c = wings.slice(wings.indexOf("im.name = 'K2-majlis-ceiling'"), wings.indexOf("im.name = 'K2-majlis-ceiling'") + 900);
  assert.match(k2c, /hideUntilReady\(im\)/);

  const k3 = wings.slice(wings.indexOf("function dressK3"), wings.indexOf('window.PalaceWings'));
  assert.match(k3, /hideUntilReady\(floorMesh\)/);
  assert.match(k3, /hideUntilReady\(mesh\(farGeo/);
  assert.match(k3, /hideUntilReady\(mesh\(sideGeo/);
  assert.match(k3, /hideUntilReady\(ceiling\)/);
  assert.match(wings, /function k3Put[\s\S]*?hideUntilReady\(holder\)/);
  assert.match(k3, /if \(state\.k3Dress && state\.k3Dress\.furniture && state\.k3Dress\.table\)/);

  const k4 = wings.slice(wings.indexOf('function dressK4'), wings.indexOf('function dressK3'));
  assert.match(k4, /hideUntilReady\(floor\)/);
  assert.match(k4, /hideUntilReady\(mesh\(wallGeo[\s\S]*K4-treasury-decorated-walls/);
  assert.match(k4, /hideUntilReady\(ceiling\)/);
});

test('K2 dress callbacks survive eviction (k2Dress null)', () => {
  assert.match(wings, /if \(state\.k2Dress\) \{\s*state\.k2Dress\.columns = pairs\.length/);
  assert.match(wings, /if \(state\.k2Dress\) state\.k2Dress\.lions = lionSlots\.length/);
  assert.match(wings, /if \(state\.k2Dress\) \{\s*state\.k2Dress\.table = true/);
  assert.match(wings, /if \(state\.k2Dress\) \{\s*state\.k2Dress\.chandelier = true/);
  assert.match(wings, /if \(state\.k2Dress\) state\.k2Dress\.plants = plantSlots\.length/);
});

test('teleport stands at the entrance, not on the table at bbox centre', () => {
  assert.match(wings, /function entranceLocal\(id\)/);
  assert.match(wings, /function teleport\(id, opts\)/);
  assert.match(wings, /const ent = \(!opts\.center && r\) \? entranceLocal\(id\) : null/);
  // Keep an opt-in path for tests that need the centre.
  assert.match(wings, /else if \(r\) \{ x = r\.bbox\.cx; z = r\.bbox\.cz; \}/);
});

test('index.html cache-busts the completeness wings build', () => {
  // The version token is bumped whenever wings.js changes; the test
  // only requires that a cache-bust query is present (a frozen token
  // like ios35 went stale on later busts and is not a game bug).
  assert.match(index, /wings\.js\?v=[^"'>\s]+/);
});

test('entry corridor plant and torches parse during LOADING, not mid-SETUP', () => {
  const start = wings.indexOf('function assetList');
  const end = wings.indexOf('function provideAsset');
  const assetList = wings.slice(start, end);
  assert.match(assetList, /WING_FILES\.plant/);
  assert.match(assetList, /WING_FILES\.torchBlack/);
  assert.match(assetList, /WING_FILES\.torchWood/);
  assert.match(assetList, /WING_DOOR_FILE/);
  assert.match(wings, /if \(state\.building\) \{/);
  assert.match(wings, /deferredLoads\.push\(function \(\) \{ wingGLB\(url, onLoad, onError\); \}\)/);
  assert.match(md, /Entry corridor models/);
});

test('arch thresholds are complete portals, not empty-room failures', () => {
  assert.match(wings, /region\.kind === 'threshold'/);
  assert.match(wings, /threshold: true/);
});
test('entrance teleport walks until capsuleBlocked is clear and keeps a short follow cam', () => {
  assert.match(wings, /if \(!capsuleBlocked\(tx, tz, 0\.5\)\)/);
  assert.match(wings, /ent \? 1\.15 : 4\.2/);
});

test('K4 dress is re-issued after eviction', () => {
  const fs = require('fs');
  const path = require('path');
  const wings = fs.readFileSync(path.join(__dirname, '..', 'wings.js'), 'utf8');
  // Unload still nulls k4Dress (GPU eviction must drop the refs).
  assert.match(wings, /state\.k4Dress = null/);
  // A second visit re-issues dressK4 + loadK4Assets when the player is in K4
  // and the floor is no longer resident. Overlapping load() must not stack.
  assert.match(wings, /function ensureCurrentDress\(origin\)/);
  assert.match(wings, /dressK4\(\);\s*loadK4Assets\(\);/);
  assert.match(wings, /ensureCurrentDress\(origin\)/);
  assert.match(wings, /K4-treasury-floor-artwork/);
  assert.match(wings, /state\.k4Dress && state\.k4Dress\.host === g/);
  // Disposed preloaded maps are not reused for the second dress.
  assert.match(wings, /function textureDisposed/);
  assert.match(wings, /preloaded\.delete\(url\)/);
});

test('teleport force-dresses K4 and unload drops k4 colliders', () => {
  const fs = require('fs');
  const path = require('path');
  const wings = fs.readFileSync(path.join(__dirname, '..', 'wings.js'), 'utf8');
  const streamer = fs.readFileSync(path.join(__dirname, '..', 'zone-streamer.js'), 'utf8');
  const tel = wings.slice(wings.indexOf('function teleport('), wings.indexOf('function createDebugUI('));
  assert.match(tel, /ensureCurrentDress\(id\)/);
  assert.match(wings, /state\.colliders = state\.colliders\.filter\(function \(c\) \{ return !c\._k4Prop/);
  assert.match(streamer, /function forceLoad\(id\)/);
  assert.match(wings, /zoneStreamer\.forceLoad\(origin\)/);
});
