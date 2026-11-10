const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const store = new Map();
  const canvasListeners = {};
  const canvas = {
    addEventListener(type, fn) { canvasListeners[type] = fn; }
  };
  const renderer = { getContext() { return { canvas }; } };
  const hero = { position: { x: 1, y: 0, z: 2, set(x, y, z) { this.x = x; this.y = y; this.z = z; } } };
  const doors = [{ id: 'K1-KC12', kind: 'door', state: 'Closed', openness: 0 }];
  const windowObj = {
    PalaceWings: { state: { built: true, current: 'K2', doors } },
    SinRoomMetrics: { noteRoom() {} },
    console
  };
  const context = {
    window: windowObj,
    location: { search: '' },
    URLSearchParams,
    localStorage: {
      getItem(k) { return store.has(k) ? store.get(k) : null; },
      setItem(k, v) { store.set(k, String(v)); },
      removeItem(k) { store.delete(k); }
    },
    console, Date, JSON, Math, Number, String, Set, Map, Array, Object
  };
  windowObj.document = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'room-checkpoint.js'), 'utf8'), context);
  return { api: windowObj.SinRoomCheckpoint, hero, renderer, doors, store, canvasListeners };
}

test('saves room hero and open doors; restores after reload', () => {
  const first = load();
  first.doors[0].state = 'Open';
  first.hero.position.x = 12.5; first.hero.position.z = -4.25;
  const saved = first.api.save({ hero: first.hero, renderer: first.renderer, setFacing() {}, getFacing() { return 1.2; } });
  assert.equal(saved.room, 'K2');
  assert.equal(saved.doors[0], 'K1-KC12');

  const second = load();
  // Simulate persisted localStorage by copying
  for (const [k, v] of first.store) second.store.set(k, v);
  // Re-read pending from storage
  second.api.clear();
  // Manually seed by rewriting module pending via save/read path:
  second.store.set('sin.roomStream.v1', first.store.get('sin.roomStream.v1'));
  // Force pending by reading through restore after reconstructing API pending
  const data = JSON.parse(second.store.get('sin.roomStream.v1'));
  second.hero.position.set(0, 0, 0);
  second.doors[0].state = 'Closed';
  // Inject pending
  second.api.save({ hero: { position: { x: data.x, y: data.y, z: data.z } }, setFacing() {}, getFacing() { return data.yaw; } });
  // Overwrite with original doors list
  second.store.set('sin.roomStream.v1', JSON.stringify(data));
  const ok = second.api.restore({ hero: second.hero, setFacing(v) { second.yaw = v; }, renderer: second.renderer });
  // restore reads restorePending || read(); pending was null after clear+save; read() works
  assert.equal(ok, true);
  assert.equal(second.hero.position.x, 12.5);
  assert.equal(second.doors[0].state, 'Open');
});

test('index.html loads checkpoint module', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.indexOf('room-checkpoint.js') > 0);
  assert.ok(html.indexOf('room-texture-budget.js') > 0);
});
