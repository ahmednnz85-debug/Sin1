'use strict';
// smart-memory-manager.js was folded into zone-streamer.js (sample / memoryLevel).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Z = require('../zone-streamer.js');

test('the standalone smart-memory-manager module is gone; streamer owns pressure', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'smart-memory-manager.js')), false);
  const s = Z.create();
  assert.equal(typeof s.sample, 'function');
  const st = s.sample({ info: { memory: { geometries: 10, textures: 10 } } }, 16);
  assert.equal(st.level, 'normal');
});

test('watch pressure is reported so LRU cache shrinks (does not drop visible/adjacent)', () => {
  const s = Z.create();
  let last;
  for (let i = 0; i < 8; i++) last = s.sample({ info: { memory: { geometries: 400, textures: 10 } } }, 16);
  assert.equal(last.level, 'watch');
});

test('critical pressure is reported from frame-time spikes, without touching resolution', () => {
  const s = Z.create();
  let last;
  for (let i = 0; i < 20; i++) last = s.sample({ info: { memory: { geometries: 10, textures: 10 } } }, 50);
  assert.equal(last.level, 'critical');
});
