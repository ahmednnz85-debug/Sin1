const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const wings = fs.readFileSync(path.join(root, 'wings.js'), 'utf8');
const decode = s => s.replace(/\\u([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

test('K5 uses only the supplied king-wing assets and they exist', () => {
  for (const key of ['k5Floor', 'k5Ceiling', 'k5WallKing', 'k5WallWoman', 'k5Bed', 'k5Steps', 'k5Furniture']) {
    const m = wings.match(new RegExp(key + ": '([^']+)'"));
    assert.ok(m, key + ' declared');
    assert.ok(fs.existsSync(path.join(root, decode(m[1]))), key + ' file exists: ' + decode(m[1]));
  }
});

test('K5 procedural balcony, ramp, rails and torches are gone', () => {
  for (const name of ['K5-balcony', 'K5-balustrade', 'K5-closed-dark-shaft']) assert.doesNotMatch(wings, new RegExp("'" + name));
  assert.match(wings, /r\.id !== 'K4' && r\.id !== 'K5'\) addTorches/);
});

test('K5 is a streamed zone expecting bed, steps and the cut furniture', () => {
  const block = wings.slice(wings.indexOf('    K5: [\n      \'K5-king-floor\''));
  for (const n of ['K5-king-bed', 'K5-bed-steps', 'K5-woman-mural-wall', 'K5-king-ceiling', 'K5-throne', 'K5-sphinx']) assert.ok(block.includes("'" + n + "'"), n);
  assert.match(wings, /\{ id: 'K5', prefetchHops/);
});
