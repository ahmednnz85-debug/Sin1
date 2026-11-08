const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const wings = fs.readFileSync(path.join(root, 'wings.js'), 'utf8');
const palace = fs.readFileSync(path.join(root, 'palaceInterior.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

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

test('K2 chandelier keeps authored materials and subtle procedural flames', () => {
  const start = wings.indexOf('function addK2ChandelierFire');
  const end = wings.indexOf('function addK2Lights', start);
  const fire = wings.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(fire, /c \* a \* 0\.72/);
  assert.match(fire, /replace\('a \* 0\.55', 'a \* 0\.18'\)/);
  assert.match(fire, /const baseW = 0\.13, baseH = 0\.26/);
  assert.match(fire, /const PER = 2/);
  const chandelierStart = wings.indexOf('function loadK2Chandelier');
  const chandelierEnd = wings.indexOf('function rebuildSpatial', chandelierStart);
  assert.doesNotMatch(wings.slice(chandelierStart, chandelierEnd), /m\.emissive = new THREE\.Color/);
});

test('palace braziers animate and drive warm, localized flickering lights instead of a sun wash', () => {
  assert.match(palace, /fireList\.push\(\{ x: x, y: y \+ targetMeters \* 0\.66, z: z, intensity: intensity/);
  assert.match(palace, /fireMats\.forEach\(function \(m\)[\s\S]{0,150}m\.uniforms\.uTime\.value = clock/);
  assert.doesNotMatch(palace, /m\.uniforms\.uTime\.value = 1\.15/);
  assert.match(palace, /new THREE\.HemisphereLight\(0xffe2b8, 0x5c3a28, 0\.18\)/);
  assert.match(palace, /new THREE\.AmbientLight\(0xffd0a4, 0\.035\)/);
  assert.doesNotMatch(palace, /const wash = new THREE\.DirectionalLight/);
  assert.match(palace, /new THREE\.PointLight\(0xffb15a, 0, 9 \* H, 2\)/);
  assert.match(palace, /target\.baseIntensity = 0\.82[\s\S]{0,150}Number\(f\.intensity\)/);
  assert.match(palace, /const flicker = 0\.92 \+ 0\.05 \* Math\.sin/);
  assert.match(palace, /l\.distance = 9 \* H/);
  assert.match(index, /sun\.intensity=3\.6/);
  assert.match(index, /hemi\.intensity=0\.9/);
  assert.match(index, /new THREE\.DirectionalLight\(0x000000,0\.55\)/);
  assert.match(index, /renderer\.toneMappingExposure=1\.02;/);
});
