'use strict';
// wing-render-budget.js (triangle budget that could drop visible rooms) was
// removed. Visibility is camera+portal based with no triangle cap.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('triangle-budget module is gone and wings never drops a visible room for it', () => {
  const root = path.join(__dirname, '..');
  assert.equal(fs.existsSync(path.join(root, 'wing-render-budget.js')), false);
  const wings = fs.readFileSync(path.join(root, 'wings.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(wings, /SinWingRenderBudget|renderBudget\.choose/);
  assert.doesNotMatch(index, /wing-render-budget\.js/);
});
