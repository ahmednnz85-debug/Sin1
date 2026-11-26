/* Published entrance, platform traversal, perimeter and selected authored assets. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const three = process.env.THREE_DIR;

function glb(relative) {
  const file = fs.readFileSync(path.join(root, relative));
  return { size: file.length, doc: JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12))) };
}

test('the Maw GLBs carry the authored platform, only needed textures, and one lighter link', () => {
  const chosen = glb('assets/r3/maw/elevator-and-ruins.glb');
  const guardian = glb('assets/r3/maw/left-guardian.glb');
  const source = glb('assets/R3_MawOfTheAbyss_Assets.glb');
  const names = chosen.doc.scenes[0].nodes.map(i => chosen.doc.nodes[i].name);
  assert.ok(names.includes('Elevator_Platform') && names.includes('Elevator_Mechanism'));
  assert.ok(names.includes('Elevator_Anchor_Upper') && names.includes('Elevator_Anchor_Lower'));
  for (const node of ['Abyss_Mural_Fragment', 'Abyss_Overlook', 'Elevator_Chain', 'Abyss_Rock_Formation']) {
    assert.ok(!names.includes(node));
  }
  const crown = chosen.doc.nodes.find(n => n.name === 'Abyss_Cliff_Ruins_Body_Geo');
  const crownPieces = chosen.doc.meshes[crown.mesh].primitives;
  assert.equal(crownPieces.length, 1);
  assert.equal(chosen.doc.materials[crownPieces[0].material].name, 'M_Stone_Ashlar');
  const triangles = (asset, name) => {
    const node = asset.doc.nodes.find(n => n.name === name);
    return asset.doc.meshes[node.mesh].primitives.reduce((n, prim) => n + asset.doc.accessors[prim.indices].count / 3, 0);
  };
  assert.equal(triangles(chosen, 'Elevator_Platform_Body_Geo'), triangles(source, 'Elevator_Platform_Body_Geo'));
  assert.equal(triangles(chosen, 'Elevator_Chain_Link_01_Geo'), 1140);
  assert.equal(guardian.doc.scenes[0].nodes.length, 1);
  assert.ok(chosen.size + guardian.size < 22 * 1024 * 1024);
});

test('the registered Maw spawn connects to the deck and the void blocks the capsule', { skip: !three }, () => {
  const THREE = require(path.join(three, 'build/three.cjs'));
  const window = {};
  const ctx = vm.createContext({ window, globalThis: window, THREE, performance, console });
  for (const file of ['sin-areas.js', 'r3-maw-geology.js', 'r3-maw-approach.js', 'r3-maw-dressing.js', 'r3-sealed-zone.js']) {
    if (window.SinAreas) ctx.SinAreas = window.SinAreas;
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx);
  }
  const hall = JSON.parse(fs.readFileSync(path.join(root, 'data/palace-colliders.json'), 'utf8')).hall;
  const p = hall.passages.find(x => x.id === window.SinR3SealedZone.passageId);
  const stage = window.SinR3SealedZone.mount(THREE, p, hall, new THREE.Vector3());
  return window.SinAreas.get('R3-03').then(area => {
    const { u, y, v } = area.spawn;
    const xAt = d => p.position[0] - d;
    const zAt = d => p.position[2] + d;
    assert.ok(stage.nearFloor(xAt(u), zAt(v), y));
    const room = stage.maw.room.position;
    let feet = room.y;
    const traversed = new Set();
    for (let x = room.x + 0.3; x < room.x + 18.1; x += 0.11) {
      const z = zAt(room.z - 1.4);
      assert.ok(!stage.blocks(xAt(x), z, feet, xAt(x - 0.11), z, 0.32), 'centerline blocked at ' + x);
      const f = stage.nearFloor(xAt(x), z, feet);
      feet = f.y;
      traversed.add((feet - room.y).toFixed(2));
    }
    assert.deepEqual([...traversed].sort(), ['0.00', '0.19', '0.38', '0.58']);
    assert.ok(stage.blocks(xAt(room.x + 22), zAt(room.z), feet, xAt(room.x + 18.1), zAt(room.z), 0.32));
    assert.ok(!stage.nearFloor(xAt(room.x + 19), zAt(room.z - 9), feet));
    assert.equal(stage.maw.status.phase, 'idle');

    // The dressed approach (arch piers, columns, fallen masonry) keeps the
    // whole route from the First Seal hall exit to the overlook walkable.
    const route = [[-20, 20.6], [-20, 13], [-9, 13], [-9, 0], [1.2, 0]];
    let walk = stage.nearFloor(xAt(room.x - 20), zAt(room.z + 20.6), room.y + 4).y;
    let [px, pz] = route[0];
    for (let leg = 1; leg < route.length; leg++) {
      const [tx, tz] = route[leg];
      const steps = Math.ceil(Math.hypot(tx - px, tz - pz) / 0.1);
      const [sx, sz] = [px, pz];
      for (let i = 1; i <= steps; i++) {
        const x = sx + (tx - sx) * i / steps, z = sz + (tz - sz) * i / steps;
        const at = [xAt(room.x + x), zAt(room.z + z)];
        assert.ok(!stage.blocks(at[0], at[1], walk, xAt(room.x + px), zAt(room.z + pz), 0.32),
          'approach blocked at ' + x.toFixed(2) + ', ' + z.toFixed(2));
        walk = stage.nearFloor(at[0], at[1], walk).y;
        px = x; pz = z;
      }
    }
    // Every dressed arch leaves the authored 2.32 m half-opening clear.
    const piers = [[-17, 13 + 2.2], [-17, 13 - 2.2], [-9 + 2.2, 10], [-6, 2.2]];
    for (const [x, z] of piers) {
      const at = [xAt(room.x + x), zAt(room.z + z)];
      const f = stage.nearFloor(at[0], at[1], walk + 2) || stage.nearFloor(at[0], at[1], walk);
      assert.ok(f, 'floor under arch at ' + x + ',' + z);
    }
  });
});
