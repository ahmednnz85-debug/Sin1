const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { solveLayout } = require('../wing-architecture.js');

const root = path.resolve(__dirname, '..');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'temple-doors.js'), 'utf8'), context);
const { asset, plan, clipName } = context.window.SinTempleDoors;
const { hall } = require('../data/palace-colliders.json');

test('temple doors cover every room and connector opening in the existing layout', () => {
  const layout = solveLayout(hall);
  const before = JSON.stringify(layout.doors);
  const {openings:fitted,passages}=plan(layout.doors,layout.rooms.concat(layout.connectors));
  assert.equal(JSON.stringify(layout.doors), before);
  assert.deepEqual(Array.from(fitted, row => row.portal.id).sort(), [
    'T1-TR1', 'T1-TC12', 'TC12-T2', 'T2-TC23', 'TC23-T3', 'T3-TC34', 'TC34-T4', 'T3-TC5', 'TC5-T5'
  ].sort());
  for (const { portal } of fitted) assert.ok(portal.width > 0 && portal.height > 0);
  assert.deepEqual(Array.from(passages,d=>d.id).sort(),['PalaceR3','T4-MP1','TR1-REAR'].sort());
  assert.equal(fitted.find(row => row.portal.id === 'T1-TC12').front, -1);
});

test('each fixed face uses its specific authored open and close clips', () => {
  const glb = fs.readFileSync(path.join(root, asset));
  assert.equal(glb.toString('ascii', 0, 4), 'glTF');
  const data = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
  assert.equal(asset, 'assets/باب جناح المعبد.glb');
  assert.equal(clipName(1), 'Inward');
  assert.equal(clipName(-1), 'Outward');
  const leaves = data.nodes.map(node => node.name);
  for (const side of [-1, 1]) {
    for (const prefix of ['Open_', 'Close_']) {
      const clip = data.animations.find(animation => animation.name === prefix + clipName(side));
      assert.ok(clip);
      assert.deepEqual(clip.channels.map(channel => leaves[channel.target.node]).sort(),
        ['TempleDoor_Left', 'TempleDoor_Right']);
    }
  }
});
