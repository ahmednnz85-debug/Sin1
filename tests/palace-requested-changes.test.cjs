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
  assert.match(palace, /new THREE\.HemisphereLight\(0xffe2b8, 0x5c3a28, 0\.18\)/);
  assert.match(palace, /new THREE\.AmbientLight\(0xffd0a4, 0\.035\)/);
  assert.doesNotMatch(palace, /const wash = new THREE\.DirectionalLight/);
  assert.match(palace, /new THREE\.PointLight\(0xffb15a, 0, 9 \* H, 2\)/);
  assert.doesNotMatch(palace, /lightCandidates\.sort/);
  assert.doesNotMatch(palace, /const flicker = 0\.92 \+ 0\.05 \* Math\.sin/);
  assert.match(palace, /lights\[i\]\.distance = 9 \* H/);
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

test('K4 royal treasury uses its full-room artwork, supplied GLBs and no procedural room dressing', () => {
  assert.match(wings, /k4Floor: 'assets\/ارضية الخزانة\.JPG'/);
  assert.match(wings, /k4Ceiling: 'assets\/سقف الخزانة \.JPG'/);
  assert.match(wings, /k4SideWall: 'assets\/جدارية ايمن الخزانة\.JPG'/);
  assert.match(wings, /k4FrontWall: 'assets\/جدارية الخزانة\.glb'/);
  assert.match(wings, /k4Furniture1: 'assets\/اثاث الخزانة\.glb'/);
  assert.match(wings, /k4Furniture2: 'assets\/اثاث الخزانة 2\.glb'/);
  assert.match(wings, /k4Furniture3: 'assets\/اثاث الخزانة 3\.glb'/);
  assert.match(wings, /ROOM_NAMES\.K4, KC1x \+ 17, KC2\.bbox\.z1 \+ 3, 21\.322, 12, 8\.5\)/);
  assert.match(wings, /K4\.ceiling = false/);
  assert.match(wings, /if \(r\.id !== 'K4'\) addFutureZones\(r, g\)/);
  assert.match(wings, /r\.id !== 'K2' && r\.id !== 'K3' && r\.id !== 'K4'\) addTorches\(r\)/);
  const start = wings.indexOf('function dressK4()');
  const end = wings.indexOf('// اثاث الخرائط is one fused mesh', start);
  const dress = wings.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(dress, /new THREE\.PlaneGeometry\(w, d\)/);
  assert.match(dress, /WING_FILES\.k4Floor/);
  assert.match(dress, /WING_FILES\.k4Ceiling/);
  assert.match(dress, /WING_FILES\.k4SideWall/);
  assert.match(dress, /WING_FILES\.k4FrontWall/);
  assert.match(dress, /k4Furniture1[\s\S]*k4Furniture2[\s\S]*k4Furniture3/);
  assert.doesNotMatch(dress, /futureZone|addTorches|addColumns|boxAt/);
});
