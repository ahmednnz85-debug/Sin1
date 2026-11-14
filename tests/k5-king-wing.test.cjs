const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const wings = fs.readFileSync(path.join(root, 'wings.js'), 'utf8');
const decode = s => s.replace(/\\u([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

test('K5 uses the supplied king-wing assets and edited woman mural texture', () => {
  for (const key of ['k5Floor', 'k5Ceiling', 'k5WallKing', 'k5WallWoman', 'k5Bed', 'k5Steps', 'k5Furniture', 'k5Chandelier']) {
    const m = wings.match(new RegExp(key + ": '([^']+)'"));
    assert.ok(m, key + ' declared');
    assert.ok(fs.existsSync(path.join(root, decode(m[1]))), key + ' file exists: ' + decode(m[1]));
  }
});

test("K5 keeps the woman's original flat mural frame and uses its edited image texture", () => {
  assert.match(wings, /k5WallWoman: 'assets\/k5-woman-balcony-mural-red\.png'/);
  assert.match(wings, /addWall\(east, WING_FILES\.k5WallWoman, 1, 'K5-woman-mural-wall'\)/);
  assert.doesNotMatch(wings, /function addK5Balcony/);
});

test('K5 is a streamed zone expecting bed, steps and the cut furniture', () => {
  const block = wings.slice(wings.indexOf('    K5: [\n      \'K5-king-floor\''));
  for (const n of ['K5-king-bed', 'K5-bed-steps', 'K5-woman-mural-wall', 'K5-king-ceiling', 'K5-throne', 'K5-sphinx', 'K5-majlis-chandelier']) assert.ok(block.includes("'" + n + "'"), n);
  assert.match(wings, /\{ id: 'K5', prefetchHops/);
});

test('K5 bed is enlarged and uses the dedicated council chandelier with procedural fire', () => {
  assert.match(wings, /k5PlaceModel\(dress, bed, 'K5-king-bed', D\.cx, D\.cz, D\.h - 0\.08, 0, 3\.65, 3\.75, 4\.65/);
  assert.match(wings, /loadK5Chandelier\(dress/);
  assert.match(wings, /addK2ChandelierFire\(dress\.host, cups\)/);
});

test('K5 wall seams are closed at short runs, corners, ceiling and floor', () => {
  assert.match(wings, /k3WallQuads\(segs, b, h, \{ minSpan: 0\.02, endOverlap: 0\.08, bottomOverlap: 0\.18, topOverlap: 0\.18 \}\)/);
  assert.match(wings, /const minSpan = opts\.minSpan == null \? 1\.2 : opts\.minSpan/);
  assert.match(wings, /const s0 = r\.s0 - endOverlap, s1 = r\.s1 \+ endOverlap/);
  assert.match(wings, /const y0 = r\.door \? Math\.min\(r\.door\.height, h\) : -bottomOverlap, y1 = h \+ topOverlap/);
});
