const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(search) {
  const calls = [];
  const bodyKids = [];
  const el = {
    style: { cssText: '' },
    textContent: '',
    setAttribute() {},
    remove() { this.removed = true; }
  };
  const doc = {
    body: {
      appendChild(node) { bodyKids.push(node); return node; }
    },
    documentElement: {},
    createElement() { return el; },
    addEventListener() {}
  };
  const raf = [];
  const windowObj = {
    requestAnimationFrame(fn) { raf.push(fn); return raf.length; },
    console: { info() { calls.push(Array.from(arguments)); } }
  };
  windowObj.THREE = {
    WebGLRenderer: function () {},
  };
  windowObj.THREE.WebGLRenderer.prototype = {
    render() { return null; }
  };
  const context = {
    window: windowObj,
    document: doc,
    location: { search },
    URLSearchParams,
    performance: { now: () => 0 },
    Date,
    console: windowObj.console,
    requestAnimationFrame: windowObj.requestAnimationFrame,
    THREE: windowObj.THREE,
    Math, Number, String, Array, Object
  };
  windowObj.document = doc;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'room-metrics.js'), 'utf8'), context);
  return { api: windowObj.SinRoomMetrics, el, bodyKids, raf, calls, windowObj };
}

test('metrics kill switch ?metrics=0 disables overlay', () => {
  const { api, bodyKids } = load('?metrics=0');
  assert.equal(api, null);
  assert.equal(bodyKids.length, 0);
});

test('panel shows FPS memory render and room; logs enter/exit', () => {
  const { api, el, bodyKids, calls } = load('?metrics=1');
  assert.ok(api);
  assert.equal(bodyKids.length >= 1, true);

  const renderer = {
    info: {
      memory: { geometries: 40, textures: 22 },
      render: { calls: 90, triangles: 120000 }
    }
  };
  api.attachRenderer(renderer);
  api.noteRoom('Palace', renderer);
  assert.match(el.textContent, /Room\s+Palace/);
  assert.match(el.textContent, /Geo\s+40/);
  assert.match(el.textContent, /Tex\s+22/);
  assert.match(el.textContent, /Draw\s+90/);

  // Memory at the transition instant is what both exit/enter rows capture.
  renderer.info.memory.geometries = 55;
  renderer.info.memory.textures = 30;
  renderer.info.render.calls = 110;
  renderer.info.render.triangles = 180000;
  api.noteRoom('K1', renderer);

  const rows = api.log();
  assert.equal(rows.length >= 2, true);
  const exit = rows.find((r) => r.kind === 'exit' && r.room === 'Palace');
  const enter = rows.find((r) => r.kind === 'enter' && r.room === 'K1');
  assert.ok(exit);
  assert.ok(enter);
  assert.equal(exit.geometries, 55);
  assert.equal(enter.geometries, 55);
  assert.equal(enter.textures, 30);
  assert.equal(api.currentRoom(), 'K1');
  assert.ok(calls.some((c) => String(c[0]).indexOf('room-metrics') >= 0));
});

test('index.html loads room-metrics after wings', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const wings = html.indexOf('data-src="wings.js');
  const metrics = html.indexOf('data-src="room-metrics.js');
  assert.ok(wings > 0);
  assert.ok(metrics > wings);
});
