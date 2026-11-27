'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { layout, perimeter, widthAt, createCollision } = require('../babylon-exterior');

function glb(name) {
  const b = fs.readFileSync(path.join(__dirname, '../assets', name));
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)));
}
function primitives(doc) {
  return doc.meshes.map(m => m.primitives[0]);
}

test('Babylon runtime packs preserve the six authored elements and share maps at both distances', () => {
  for (const [source, runtime] of [['مباني واكشاك.glb', 'market'], ['الزقورات والمدن البعيدة.glb', 'city']]) {
    const raw = glb(source), packed = glb('babylon/' + runtime + '.glb');
    assert.equal(packed.nodes.length, runtime === 'market' ? 18 : 12);
    assert.equal(packed.images.length, 3);
    assert.equal(packed.materials.length, 1);
    const prims = primitives(packed);
    const counts = prims.map(p => packed.accessors[p.indices].count);
    assert.equal(counts.slice(0, 6).reduce((a, b) => a + b, 0), raw.accessors[primitives(raw)[0].indices].count);
    packed.nodes.slice(0, 6).forEach((node, i) => {
      const levels = packed.nodes.filter(n => n.name.startsWith(node.name + '_LOD'));
      for (const [j,lod] of levels.entries()) {
        assert.equal(lod.name,node.name+'_LOD'+(j+1));
        assert.deepEqual(prims[i].attributes,prims[lod.mesh].attributes);
        assert.equal(prims[i].material,prims[lod.mesh].material);
        assert.ok(counts[lod.mesh]<=counts[i]*.65);
      }
    });
  }
});

test('the arch is flush through its full depth, and the walls close the market', () => {
  const space = createCollision();
  for (let z = -layout.gateHalfDepth; z <= layout.gateHalfDepth; z += .05) {
    assert.equal(space.floor(0, z), 0);
    assert.equal(space.blocked(0, z), false);
    assert.equal(space.blocked(layout.pass + .1, z), true);
  }
  assert.equal(space.blocked(0, layout.south), true);
  assert.equal(space.blocked(16.01, layout.market), true);
  assert.equal(space.floor(widthAt(layout.market) + .4, layout.market), .16);
  space.obstacle(9, 14, 24, 29);
  assert.equal(space.blocked(10, 25), true);
  assert.equal(space.blocked(7.6, 25), false);
  space.clear();
  assert.equal(space.blocked(10, 25), false);
});


test('the exterior perimeter is closed through the market, both turns and the palace rear', () => {
  const { blocked } = createCollision();
  let start = layout.south;
  for (const { end, west, east } of perimeter) {
    for (let z = start; z <= end; z += .07) {
      assert.equal(blocked(-west, z), true, `west wall at ${z}`);
      assert.equal(blocked(east, z), true, `east wall at ${z}`);
    }
    start = end;
  }
  for (let x = -37; x <= 37; x += .07) {
    assert.equal(blocked(x, layout.south + 1.58), true);
    assert.equal(blocked(x, layout.north - .17), true);
    assert.equal(blocked(x, layout.north + 1), true);
  }
  assert.equal(blocked(19, perimeter[0].end + .03), true);
  assert.equal(blocked(-19, perimeter[0].end + .03), true);
  assert.equal(blocked(32, perimeter[1].end + .09), true);
  assert.equal(blocked(32, perimeter[1].end + 2), false);
  assert.equal(blocked(0, perimeter[0].end), false);
  assert.equal(blocked(0, perimeter[1].end), false);
});
