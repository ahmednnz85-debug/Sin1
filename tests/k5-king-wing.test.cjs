const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { solveLayout } = require('../wing-architecture');
const { hall } = require('../data/palace-colliders.json');
const root = path.join(__dirname, '..');
const wings = fs.readFileSync(path.join(root, 'wings.js'), 'utf8');
const architecture = fs.readFileSync(path.join(root, 'palace-private-rooms.js'), 'utf8');
const environment = { window: {} };
vm.runInNewContext(architecture, environment);
const { aperture, studyExpected } = environment.window.SinPrivateRooms;
const decode = s => s.replace(/\\u([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const { rooms, doors, connectors } = solveLayout(hall);

test('private rooms use the uploaded atlases and original furniture files', () => {
  for (const key of ['k5Bed', 'k5Steps', 'k5Furniture', 'k5Chandelier']) {
    const m = wings.match(new RegExp(key + ": '([^']+)'"));
    assert.ok(m && fs.existsSync(path.join(root, decode(m[1]))), key);
  }
  for (const key of ['study', 'studyAtlas', 'studyRoof', 'kingAtlas', 'kingRoof', 'curtain', 'sky',
    'throneColumn', 'throneAtlas']) {
    const m = architecture.match(new RegExp(key + ":'([^']+)'"));
    assert.ok(m && fs.existsSync(path.join(root, m[1])), key);
  }
});

test('the study and balcony stay on the east wall, away from the existing routes', () => {
  for (const [id, expected] of [['L3', ['LC3-L3']], ['K5', ['KC2-K5', 'K5-KC5R']]]) {
    const room = rooms.find(r => r.id === id), opening = aperture(room);
    assert.equal(opening.x, room.bbox.x1);
    assert.ok(opening.z - opening.half > room.bbox.z0);
    assert.ok(opening.z + opening.half < room.bbox.z1);
    assert.ok(opening.bottom > 0 && opening.top < room.height);
    const attached = doors.filter(d => d.from === id || d.to === id);
    assert.deepEqual(attached.map(d => d.id), expected);
    assert.ok(attached.every(d => d.axis === 'z'));
  }
  assert.match(architecture, /spans\.map\(u=>archHole/);
  assert.match(architecture, /ExtrudeGeometry\(shape/);
  assert.match(architecture, /K5-blood-sky-panorama/);
  assert.match(architecture, /place\('lattice'/);
});

test('the treasury corridor covers the full original width of the K5 door', () => {
  const door = doors.find(d => d.id === 'KC2-K5');
  const { bbox } = connectors.find(c => c.id === 'KC2');
  assert.ok(bbox.x0 <= door.x - door.width / 2);
  assert.ok(bbox.x1 >= door.x + door.width / 2);
});

test('the streamer gates both rooms and retains K5 furniture and the balcony', () => {
  const block = wings.slice(wings.indexOf("    K5: [\n      'K5-king-floor'"));
  for (const name of ['K5-king-bed', 'K5-bed-steps', 'K5-king-ceiling', 'K5-throne', 'K5-sphinx',
    'K5-majlis-chandelier', 'K5-balcony-arches', 'K5-balcony-curtain', 'K5-blood-sky-panorama',
    'K5-balcony-spandrel', 'K5-balcony-arch-inlay', 'K5-balcony-balusters', 'K5-balcony-seats']) {
    assert.ok(block.includes("'" + name + "'"), name);
  }
  assert.ok(studyExpected.includes('L3-desk') && studyExpected.includes('L3-window-jamb'));
  assert.match(wings, /d===state\.studyDoor \? \['L3'\]/);
  assert.match(wings, /load:dressK5,prepareGeometry/);
  assert.match(wings, /addK2ChandelierFire\(dress\.host, cups\)/);
});
