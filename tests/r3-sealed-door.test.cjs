'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const file = fs.readFileSync(path.join(root, 'assets', 'الباب المختوم.glb'));
const source = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)));
const script = fs.readFileSync(path.join(root, 'r3-sealed-door.js'), 'utf8');
const hall = JSON.parse(fs.readFileSync(path.join(root, 'data/palace-colliders.json'), 'utf8')).hall;
const passage = hall.passages.find(p => p.state === 'sealed');
const T = process.env.THREE_DIR && require(path.join(process.env.THREE_DIR, 'build', 'three.cjs'));
const skip = T ? false : 'Set THREE_DIR to exercise Three.js transforms with the original asset bounds';

function installed() {
  const window = {};
  vm.runInNewContext(script, { window });
  const { SinR3SealedDoor: api } = window;
  const scene = new T.Group(), parent = new T.Group();
  parent.position.set(1, 3.75, 183.66);
  const nodes = source.nodes.map(n => {
    const node = new T.Group();
    node.name = n.name;
    if (n.matrix) new T.Matrix4().fromArray(n.matrix).decompose(node.position, node.quaternion, node.scale);
    if (n.mesh != null) {
      for (const primitive of source.meshes[n.mesh].primitives) {
        const position = source.accessors[primitive.attributes.POSITION];
        const geometry = new T.BufferGeometry();
        geometry.boundingBox = new T.Box3(new T.Vector3(...position.min), new T.Vector3(...position.max));
        node.add(new T.Mesh(geometry));
      }
    }
    return node;
  });
  source.nodes.forEach((spec, i) => { for (const child of spec.children || []) nodes[i].add(nodes[child]); });
  scene.add(nodes[0]);
  scene.updateMatrixWorld(true);
  const bounds = node => new T.Box3().setFromObject(node);
  const toNode = name => nodes.find(n => n.name === name);
  const hinges = ['Door_Left_Hinge_Pivot', 'Door_Right_Hinge_Pivot'].map(toNode);
  const leafBoxes = hinges.map(node => bounds(node).translate(node.position.clone().negate()));
  const fixed = ['Left_Column_Box', 'Right_Column_Box', 'Lintel_Box', 'Threshold_Box'].map(toNode);
  const outline = [[-2.78, 0.1], [2.78, 0.1], [2.78, 5.6], [0, 7.18], [-2.78, 5.6]];
  const door = api.mount(T, { scene, hinges, size: bounds(scene), fixedBoxes: fixed.map(bounds),
    leafBoxes, outline }, parent, passage);
  const [x, , z] = door.state().origin;
  return { door, fixed, hinges, x, z, y: parent.position.y, scene, leafBoxes };
}

test('authored outward hinge coordinates move both leaves inward without moving the frame', { skip }, () => {
  const { door, fixed, hinges, x, y, z, scene, leafBoxes } = installed();
  const fixedBefore = fixed.map(part => part.getWorldPosition(new T.Vector3()).toArray());
  assert.equal(door.state().phase, 'closed');
  assert(door.open());
  const safe = { x: x + 6, y, z };
  const deltas = [];
  for (let frame = 0; frame < 42; frame++) {
    const before = door.state().angles[0];
    door.update(0.1, safe, 1.95);
    deltas.push(door.state().angles[0] - before);
    scene.updateMatrixWorld(true);
    // The leaf sweep stays within the narrowest measured masonry jamb.
    for (let i = 0; i < hinges.length; i++) {
      for (const u of [leafBoxes[i].min.x, leafBoxes[i].max.x]) {
        for (const d of [leafBoxes[i].min.z, leafBoxes[i].max.z]) {
          const point = hinges[i].localToWorld(new T.Vector3(u, 1, d));
          assert(Math.abs(point.z - (183.66 + passage.position[2])) < passage.width * 0.41);
        }
      }
    }
  }
  assert.equal(door.state().phase, 'open');
  assert(deltas[0] < deltas[20] && deltas.at(-1) < deltas[20]);
  const angles = door.state().angles;
  assert(Math.abs(angles[0] * 180 / Math.PI - 88.5) < 1e-6);
  assert.equal(angles[0], -angles[1]);
  assert.deepEqual(fixed.map(part => part.getWorldPosition(new T.Vector3()).toArray()), fixedBefore);
  const tip = hinges[0].localToWorld(new T.Vector3(1.8, 1, 0));
  assert(tip.x < x - 1.5, 'the open leaf goes behind the arch plane');
});

test('closed and moving leaves block at their actual orientation and yield to the hero', { skip }, () => {
  const { door, x, y, z } = installed();
  assert(door.blocks(x, z, y, y + 1.95));
  assert(!door.blocks(x + 0.8, z, y, y + 1.95));
  const sill = door.support(x, z);
  assert(sill > y && sill - y < 0.25);
  const hero = { x: x - 1.02, y, z: z + 0.87 };
  assert(door.open());
  for (let i = 0; i < 110; i++) door.update(1 / 30, hero, 1.95);
  const paused = door.state();
  assert.equal(paused.phase, 'opening');
  assert(paused.elapsed > 0 && paused.elapsed < 3);
  assert(!door.blocks(hero.x, hero.z, y, y + 1.95));
  assert(!door.resetForTest(hero));
  hero.x = x + 6;
  for (let i = 0; i < 155; i++) door.update(1 / 30, hero, 1.95);
  assert.equal(door.state().phase, 'open');
  assert(!door.blocks(x, z, sill, sill + 1.95));
  assert(door.resetForTest(hero));
  assert(door.blocks(x, z, y, y + 1.95));
});


test('the recessed frame shares the mural and floor datums and removes only front stone', { skip }, () => {
  const { door, scene, y } = installed();
  const face = new T.Box3().setFromObject(scene).max.x;
  assert(Math.abs(face - (1 + passage.position[0])) < 1e-8);
  assert.equal(door.state().columnBase, y);
  const geometry = new T.BufferGeometry();
  // Front stone across the frame, stone deeper in the wall, and stone
  // farther sideways on the mural. Everything is in gate source metres.
  geometry.setAttribute('position', new T.Float32BufferAttribute([
    0, 4, 0.2, 1, 4, 0.2, 0, 5, 0.2,
    0, 4, -1, 1, 4, -1, 0, 5, -1,
    3, 4, 0.2, 4, 4, 0.2, 3, 5, 0.2
  ], 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute([
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1
  ], 2));
  const recessed = door.recessWall(geometry, scene.matrix);
  assert.deepEqual([...recessed.index.array], [3, 4, 5, 6, 7, 8]);
  assert.equal(recessed.attributes.uv.getX(7), 1);
});
