const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const wings = fs.readFileSync(path.join(root, 'wings.js'), 'utf8');
const palace = fs.readFileSync(path.join(root, 'palaceInterior.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cinematic = fs.readFileSync(path.join(root, 'cinematic.js'), 'utf8');

test('corridor carpet asset remains centered, clipped and fitted to corridor width', () => {
  assert.ok(fs.existsSync(path.join(root, 'assets', 'سجاد الممرات.JPG')));
  assert.match(wings, /corridorCarpet:\s*'assets\/سجاد الممرات\.JPG'/);
  assert.match(wings, /state\.connectors\.filter\(r => r\.kind === 'corridor' \|\| r\.kind === 'gallery'\)/);
  assert.match(wings, /const rugArea = intersection\(area, rugBand\)/);
  assert.match(wings, /const rugWidth = Math\.min\(3\.0, passageWidth \* 0\.62\)/);
  assert.match(wings, /carpetSheet\(rugArea, 0\.018/);
});

test('K1 door is restored and only the entrance leaf into K2 is excluded', () => {
  assert.match(wings, /const ROOM_DOOR_ROOMS = new Set\(\['K1', 'K2', 'K3', 'K4'\]\)/);
  assert.match(wings, /d\.id !== 'KC12-K2'/);
  assert.doesNotMatch(wings, /node\.name === 'K1_Gate_Entrance_Main'\) node\.visible = false/);
  assert.doesNotMatch(wings, /ROOM_DOOR_ROOMS = new Set\([^\n]*'K5'/);
});

test('K2 has six evenly spaced columns with entry and rear sightlines offset', () => {
  assert.match(wings, /columnPairs\(r, 3, 4\.2, 5\.2\)/);
  assert.match(wings, /Three evenly spaced pairs leave the south-east entry and north exit sightlines clear/);
});

test('K3 map room keeps the central table and far map while arranging props around clear sides', () => {
  assert.match(wings, /holder\.name = 'K3-map-table'/);
  assert.match(wings, /K3-map-wall-far/);
  assert.match(wings, /b\.z1 - shelf\.size\.x \* 0\.5 - 0\.05, -Math\.PI \/ 2, 'K3-shelf-b'/);
  assert.match(wings, /b\.x0 \+ 7\.0, b\.z1 - 2\.2, 0\.4, 'K3-scrolls'/);
  assert.match(wings, /b\.x0 \+ 13\.0, b\.z0 \+ 9\.0, 2\.4, 'K3-easel'/);
});

test('K2 chandelier keeps subtle fire but does not add a camera-facing glow halo', () => {
  const start = wings.indexOf('function addK2ChandelierFire');
  const end = wings.indexOf('function addK2Lights', start);
  const fire = wings.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(fire, /c \* a \* 0\.72/);
  assert.doesNotMatch(fire, /K2-chandelier-glow/);
  assert.match(fire, /const baseW = 0\.13, baseH = 0\.26/);
  assert.match(fire, /const PER = 2/);
  const chandelierStart = wings.indexOf('function loadK2Chandelier');
  const chandelierEnd = wings.indexOf('function rebuildSpatial', chandelierStart);
  assert.doesNotMatch(wings.slice(chandelierStart, chandelierEnd), /m\.emissive = new THREE\.Color/);
});

test('palace braziers retain fixed warm lighting without traveling glow, and outdoor shadows stay anchored', () => {
  assert.match(palace, /fireList\.push\(\{ x: x, y: y \+ targetMeters \* 0\.66, z: z, intensity: intensity/);
  assert.match(palace, /fireMats\.forEach\(function \(m\)[\s\S]{0,150}m\.uniforms\.uTime\.value = clock/);
  assert.doesNotMatch(palace, /m\.uniforms\.uTime\.value = 1\.15/);
  // Throne-hall gold look (user-requested). Rooms/corridors are unchanged:
  // only PalaceHall* lights and the hall floor/shafts are retuned.
  assert.match(palace, /new THREE\.HemisphereLight\(0xffe8c0, 0x6a3e1c, 0\.52\)/);
  assert.match(palace, /new THREE\.AmbientLight\(0xffd0a4, 0\.14\)/);
  assert.match(palace, /PalaceHallWindowSun/);
  assert.match(palace, /new THREE\.PointLight\(0xffb15a, 0, 12 \* H, 2\)/);
  assert.doesNotMatch(palace, /const flicker = 0\.92 \+ 0\.05 \* Math\.sin/);
  assert.match(palace, /lights\[i\]\.distance = 12 \* H/);
  assert.match(palace, /function buildHallLightShafts/);
  assert.match(palace, /hall-light-shafts/);
  // Fixed braziers: no 4-nearest switching, no fake glow sprites.
  assert.doesNotMatch(palace, /const ACTIVE = 4/);
  assert.doesNotMatch(palace, /spr\.name = 'torch-glow'/);
  assert.doesNotMatch(palace, /const wash = new THREE\.DirectionalLight/);
  assert.match(index, /sun\.intensity=2\.6/);
  assert.match(index, /sun\.target\.position\.set\(0,0,93\)/);
  assert.match(index, /hemi\.intensity=0\.9/);
  assert.match(index, /new THREE\.DirectionalLight\(0x000000,0\.55\)/);
  assert.match(index, /renderer\.toneMappingExposure=1\.02;/);
});

test('outdoor sun position and intensity do not follow the hero or region transitions', () => {
  assert.match(index, /sun\.target\.position\.set\(0,0,93\);sun\.position\.set\(0,0,93\)\.addScaledVector\(SUN,80\)/);
  assert.doesNotMatch(index, /sun\.position\.copy\(hp\)/);
  assert.match(cinematic, /babylon:\s*\{[^\n]*sun: 1\.00/);
  assert.match(cinematic, /courtyard:\s*\{[^\n]*sun: 1\.00/);
});

test('opening intro and interior-entry cinematics are bypassed while the palace-door scene remains', () => {
  assert.match(index, /\$\('go'\)\.addEventListener\(\s*'click',[^\n]*introT=INTRO/);
  assert.match(index, /function begin\(\)\{\s*if\(phase!=='idle'\)return;phase='approach';elapsed=0;startAudio\(\)/);
  assert.match(index, /phase='push'/);
  assert.match(palace, /state = 'DONE';\s*fadeT = 0;\s*entranceLeft = 0;/);
});

test('K4 legacy assets are removed unless shared by K5; K4 is rebuilt from split compressed kits', () => {
  ['اثاث الخزانة.glb', 'اثاث الخزانة 3.glb', 'جدارية الخزانة.glb',
    'ارضية الخزانة.JPG', 'سقف الخزانة .JPG', 'جدارية ايمن الخزانة.JPG'].forEach(f => {
    assert.equal(fs.existsSync(path.join(root, 'assets', f)), false, f + ' must be deleted');
  });
  assert.ok(fs.existsSync(path.join(root, 'assets', 'اثاث الخزانة 2.glb')), 'K5 still uses this shared furniture source');
  ['k4_kit_a.glb', 'k4_kit_b.glb', 'k4_kit_c.glb', 'k4_front_mural.glb',
    'ارضية-الخزانة.jpg', 'سقف-الخزانة.jpg', 'جدارية-ايمن-الخزانة.jpg'].forEach(f => {
    assert.ok(fs.existsSync(path.join(root, 'ارضيات وسقوف', 'optimized', 'k4', f)), f + ' must exist');
  });
  assert.match(wings, /ROOM_NAMES\.K4, KC1x \+ 17, KC2\.bbox\.z1 \+ 3, 21\.322, 12, 8\.5\)/);
  assert.match(wings, /K4\.ceiling = false/);
  const start = wings.indexOf('function dressK4()');
  const end = wings.indexOf('// اثاث الخرائط is one fused mesh', start);
  const dress = wings.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(dress, /futureZone|addTorches|addColumns|boxAt/);
  assert.doesNotMatch(dress, /اثاث الخزانة 2\.glb/);
});

test('K4 layout follows the reference picture: mural at the back, altar centre, shelves on the right, king statue on the left', () => {
  const start = wings.indexOf('function dressK4()');
  const dress = wings.slice(start, wings.indexOf('// اثاث الخرائط is one fused mesh', start));
  const spec = item => dress.match(new RegExp("at\\([^,]+, '" + item + "', ([-\\w.+ /]+), ([\\d.]+),", 'g')) || [];
  assert.equal(spec('k4_frontMural').length, 1);
  assert.equal(spec('k4_column').length, 2);
  assert.equal(spec('k4_shelfCabinet').length, 2);
  assert.match(dress, /'k4_altarTable', 0, /);
  assert.match(dress, /'k4_chandelier', 0, /);
  assert.match(dress, /'k4_kingStatue', L \+/);
  assert.match(dress, /'k4_shelfCabinet', R - /);
  assert.match(dress, /'k4_lionSphinx', R - /);
});

test('K4 kits are camera-prefetched and each kit is downloaded once', () => {
  assert.match(wings, /const K4_DEFERRED_MODELS = new Set\([\s\S]{0,180}WING_FILES\.k4FrontWall/);
  const cullStart = wings.indexOf('function updateCulling(force)');
  const cullEnd = wings.indexOf('function tick(dt)', cullStart);
  // K4 kits now start from the K4 zone manifest entry (streamer prefetch).
  assert.match(wings.slice(cullStart, cullEnd), /streamZones\(origin, visibleIds, preparedIds\)/);
  assert.match(wings, /id: 'K4'[\s\S]{0,120}load: function \(\) \{ dressK4\(\); loadK4Assets\(\); \}/);
  assert.match(wings, /if \(kits\.indexOf\(spec\.url\) < 0\) kits\.push\(spec\.url\)/);
  assert.match(wings, /gltf\.scene\.getObjectByName\(spec\.item\)/);
  assert.match(wings, /loaded\.forEach\(function \(entry\)/);
  assert.doesNotMatch(wings, /setTimeout\(placeNext, 90\)/);
});
