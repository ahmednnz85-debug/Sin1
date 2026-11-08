const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const wings = fs.readFileSync(path.join(root, 'wings.js'), 'utf8');
const palace = fs.readFileSync(path.join(root, 'palaceInterior.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('corridor carpet asset is placed as a clipped, centered and width-fitted runner', () => {
  assert.ok(fs.existsSync(path.join(root, 'assets', 'سجاد الممرات.JPG')));
  assert.match(wings, /corridorCarpet:\s*'assets\/سجاد الممرات\.JPG'/);
  assert.match(wings, /state\.connectors\.filter\(r => r\.kind === 'corridor' \|\| r\.kind === 'gallery'\)/);
  assert.match(wings, /const rugArea = intersection\(area, rugBand\)/);
  assert.match(wings, /const rugWidth = Math\.min\(3\.0, passageWidth \* 0\.62\)/);
  assert.match(wings, /carpetSheet\(rugArea, 0\.018/);
});

test('K1 and K5 room-door leaves are not loaded, and only the K1 entrance leaf is hidden', () => {
  assert.match(wings, /const ROOM_DOOR_ROOMS = new Set\(\['K2', 'K3', 'K4'\]\)/);
  assert.match(wings, /node\.name === 'K1_Gate_Entrance_Main'\) node\.visible = false/);
  assert.match(wings, /node\.name === 'K1_Gate_Entrance_Main'\) node\.visible = false[\s\S]{0,200}K1's already-fitted volume/);
});

test('K2 chandelier retains authored materials and uses small, subdued procedural flames', () => {
  const start = wings.indexOf('function addK2ChandelierFire');
  const end = wings.indexOf('function addK2Lights', start);
  const fire = wings.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(fire, /c \* a \* 0\.72/);
  assert.match(fire, /replace\('a \* 0\.55', 'a \* 0\.18'\)/);
  assert.match(fire, /const baseW = 0\.13, baseH = 0\.26/);
  assert.match(fire, /const PER = 2/);
  const chandelierStart = wings.indexOf('function loadK2Chandelier');
  const doorStart = wings.indexOf('function rebuildSpatial', chandelierStart);
  const chandelier = wings.slice(chandelierStart, doorStart);
  assert.doesNotMatch(chandelier, /m\.emissive = new THREE\.Color/);
});

test('palace light sources are reduced without changing renderer exposure', () => {
  assert.match(palace, /new THREE\.PointLight\(0xffb15a, 1\.25, 12 \* H, 2\)/);
  assert.match(palace, /new THREE\.HemisphereLight\(0xffe2b8, 0x5c3a28, 0\.65\)/);
  assert.match(index, /sun\.intensity=2\.4/);
  assert.match(index, /hemi\.intensity=0\.70/);
  assert.match(index, /new THREE\.DirectionalLight\(0x000000,0\.32\)/);
  assert.match(index, /renderer\.toneMappingExposure=1\.02;/);
});
