
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const palace = fs.readFileSync(path.join(root, 'palaceInterior.js'), 'utf8');
const wings = fs.readFileSync(path.join(root, 'wings.js'), 'utf8');

test('parseRawGLB records the GLB filename on a new maxSlice', () => {
  assert.match(palace, /function parseRawGLB\(buf, name\)/);
  assert.match(palace, /window\.__palaceMaxSliceName = label/);
  assert.match(palace, /parseRawGLB\(own\.buf, a\.url\)/);
  assert.match(palace, /parseRawGLB\(spec\.buf, spec\.name\)/);
});

test('post-present wing parses yield standing frames and record maxSlice by file', () => {
  assert.match(wings, /__sinStreamHold/);
  assert.match(wings, /__sinFirstPresentLogged/);
  assert.match(wings, /__sinWingParseYields/);
  assert.match(wings, /big \? 12 : 2/);
  assert.match(wings, /window\.__palaceMaxSliceName = 'wing:' \+ file/);
  // Must not introduce a Worker for the result tree (2.3 s structured-clone stall).
  const start = wings.indexOf('function wingGLB');
  const end = wings.indexOf('function assertDeps', start);
  assert.doesNotMatch(wings.slice(start, end), /new Worker/);
});
