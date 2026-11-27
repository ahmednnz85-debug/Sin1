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

test('the Maw packs carry the approved elevator, the ruins and no retired elevator parts', () => {
  const lift = glb('assets/r3/maw/elevator.glb');
  const source = glb('assets/مصعد فم الهاوية.glb');
  const ruins = glb('assets/r3/maw/abyss-ruins.glb');
  const guardian = glb('assets/r3/maw/left-guardian.glb');
  // Same authored mesh and accessors; only the maps are resized for phones.
  assert.deepEqual(lift.doc.meshes, source.doc.meshes);
  assert.deepEqual(lift.doc.accessors, source.doc.accessors);
  assert.equal(lift.doc.images.length, 3);
  const names = ruins.doc.scenes[0].nodes.map(i => ruins.doc.nodes[i].name);
  assert.deepEqual(names.sort(), ['Abyss_Bridge_Ruined', 'Abyss_Cliff_Ruins', 'Abyss_Rock_Spire']);
  assert.ok(!ruins.doc.nodes.some(n => /^Elevator_/.test(n.name || '')));
  assert.ok(!fs.existsSync(path.join(root, 'assets/r3/maw/elevator-and-ruins.glb')));
  assert.equal(guardian.doc.scenes[0].nodes.length, 1);
  assert.ok(lift.size + ruins.size + guardian.size < 16 * 1024 * 1024);
});

test('the registered Maw spawn connects to the deck and the void blocks the capsule', { skip: !three }, () => {
  const THREE = require(path.join(three, 'build/three.cjs'));
  const window = {};
  const ctx = vm.createContext({ window, globalThis: window, THREE, performance, console });
  for (const file of ['sin-areas.js', 'r3-maw-geology.js', 'r3-maw-approach.js', 'r3-maw-dressing.js', 'r3-underworld.js', 'r3-sealed-zone.js']) {
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
      const z = zAt(room.z + 1.9); // beside the docked cabin (its walls stop the capsule)
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

test('the lift docks in the Maw and at the Anchorage; the U1 route walks to the closed gate', { skip: !three }, () => {
  const THREE = require(path.join(three, 'build/three.cjs'));
  const window = {};
  const ctx = vm.createContext({ window, globalThis: window, THREE, performance, console });
  for (const file of ['sin-areas.js', 'r3-maw-geology.js', 'r3-maw-approach.js', 'r3-maw-dressing.js', 'r3-underworld.js', 'r3-sealed-zone.js']) {
    if (window.SinAreas) ctx.SinAreas = window.SinAreas;
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx);
  }
  const hall = JSON.parse(fs.readFileSync(path.join(root, 'data/palace-colliders.json'), 'utf8')).hall;
  const p = hall.passages.find(x => x.id === window.SinR3SealedZone.passageId);
  const stage = window.SinR3SealedZone.mount(THREE, p, hall, new THREE.Vector3());
  const underworld = window.SinR3SealedZone.mount(THREE, p, hall, new THREE.Vector3(), { chapter: 'u1' });
  assert.equal(stage.root.getObjectByName('U1_Underworld'), undefined);
  assert.ok(underworld.root.getObjectByName('U1_Underworld'));
  assert.equal(underworld.root.getObjectByName('MawOfTheAbyss_Dressing'), undefined);
  assert.equal(underworld.lift, undefined);
  const lift = window.SinR3Maw.lift;
  // The crown hangs from a ceiling at the arch crown, well clear of the cabin
  // roof on long chains; the arrival chains rise into the Anchorage vault.
  assert.ok(lift.ceiling > 12.8 && lift.chainTop - (lift.deck + 3.6) > 6.5, JSON.stringify(lift));
  assert.ok(lift.arrivalChainTop > lift.arrivalVault, 'arrival chains reach the vault');
  const xAt = u => p.position[0] - u, zAt = v => p.position[2] + v;
  const room = stage.maw.room.position;
  const cabin = [room.x + lift.center[0], room.z + lift.center[1]];
  const top = room.y + lift.deck, bottom = top + lift.drop;
  // Both docks: floor inside the cabin, a wall beside it, the doorway open toward the arch (-u).
  for (const [dock, y] of [[stage, top], [underworld, bottom]]) {
    assert.ok(dock.nearFloor(xAt(cabin[0]), zAt(cabin[1]), y), 'cabin floor at ' + y);
    assert.ok(dock.blocks(xAt(cabin[0]), zAt(cabin[1] + 2.0), y, xAt(cabin[0]), zAt(cabin[1]), 0.32), 'cabin wall');
    let feet = y;
    for (let du = 0; du >= -3.2; du -= 0.1) {
      const at = [xAt(cabin[0] + du), zAt(cabin[1])];
      assert.ok(!dock.blocks(at[0], at[1], feet, xAt(cabin[0] + du + 0.1), zAt(cabin[1]), 0.32), 'doorway at ' + du);
      feet = dock.nearFloor(at[0], at[1], feet).y;
    }
  }
  // The ride: wait in the cabin, the view closes, the hero is carried down.
  const at = [xAt(cabin[0]), top, zAt(cabin[1])];
  stage.maw.status.phase = 'ready';
  stage.maw.status.liftReady = true;
  assert.equal(stage.lift(xAt(cabin[0] - 4), room.y, zAt(cabin[1]), 0.1).state, 'idle');
  let shift = null;
  for (let i = 0; i < 40 && !shift; i++) shift = stage.lift(...at, 0.1).shift;
  assert.equal(JSON.stringify(shift), JSON.stringify([0, lift.drop, 0]));
  assert.equal(stage.lift(...at, 0.1).shift, null);
  assert.equal(stage.nearFloor(at[0], at[2], bottom), null);
  assert.equal(underworld.nearFloor(at[0], at[2], top), null);
  // Registered U1 spawns stand on the underworld layer.
  return Promise.all(['U1-01', 'U1-02', 'U1-03'].map(id => window.SinAreas.get(id))).then(areas => {
    for (const a of areas) assert.ok(underworld.nearFloor(xAt(a.spawn.u), zAt(a.spawn.v), a.spawn.y), a.id + ' spawn on floor');
    // Anchorage -> causeway -> junction -> stair -> landing -> bridge -> midway -> descent -> plaza.
    const rel = [[-3.5, 0], [-42, 0], [-42, 13], [-42, 0], [-42, -26],
      [-98, -26], [-98, -38.5], [-98, -26], [-139, -26], [-149, -26]];
    let [px, pz] = [-3.5, 0], feet = bottom - 0.58;
    const base = (x, z) => [xAt(cabin[0] + x), zAt(cabin[1] + z)];
    feet = underworld.nearFloor(...base(px, pz), bottom).y;
    for (const [tx, tz] of rel.slice(1)) {
      const steps = Math.ceil(Math.hypot(tx - px, tz - pz) / 0.1);
      const [sx, sz] = [px, pz];
      for (let i = 1; i <= steps; i++) {
        const x = sx + (tx - sx) * i / steps, z = sz + (tz - sz) * i / steps;
        assert.ok(!underworld.blocks(...base(x, z), feet, ...base(px, pz), 0.32), 'U1 route blocked at ' + x.toFixed(1) + ',' + z.toFixed(1));
        feet = underworld.nearFloor(...base(x, z), feet).y;
        px = x; pz = z;
      }
    }
    // The gate is closed and the void is not walkable.
    assert.ok(underworld.blocks(...base(-154, -26), feet, ...base(-149, -26), 0.32), 'closed gate');
    assert.ok(underworld.blocks(...base(-70, -14), bottom - 6, ...base(-70, -26), 0.32), 'bridge edge');
  });
});
