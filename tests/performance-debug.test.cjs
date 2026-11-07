const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function makeEnv(search = '?debug=1') {
  const inputs = ['fireOff', 'lightsOff', 'gradeFogOff', 'skipLightWork'].map((flag) => ({
    dataset: { flag }, checked: false, addEventListener(type, fn) { this['on' + type] = fn; }
  }));
  const elements = new Map();
  const panel = { style: {}, querySelectorAll() { return inputs; }, addEventListener() {}, appendChild() {} };
  const body = { appendChild(el) { if (el.id) elements.set(el.id, el); } };
  const grade = { style: { display: 'block' } };
  const select = (id, value = '') => ({
    id, value, disabled: false, style: {}, dataset: {},
    addEventListener(type, fn) { this['on' + type] = fn; },
    click() { if (this.onclick) this.onclick(); }
  });
  for (const id of ['perf-lab-metrics', 'perf-lab-status', 'perf-pixels', 'perf-point', 'perf-record', 'perf-clear', 'perf-csv', 'perf-aa', 'perf-p3', 'perf-colour']) {
    elements.set(id, select(id, id === 'perf-pixels' ? '1' : id === 'perf-aa' ? '1' : id === 'perf-p3' ? '0' : ''));
  }
  let clock = 100;
  const rafQueue = [];
  const intervalCallbacks = [];
  const doc = {
    body,
    createElement(tag) {
      if (tag === 'canvas') return { getContext() { return { drawingBufferColorSpace: 'srgb' }; } };
      if (tag === 'section') return panel;
      return { id: '', style: {}, dataset: {}, addEventListener() {}, appendChild() {}, click() {}, remove() {} };
    },
    getElementById(id) { return id === 'grade' ? grade : elements.get(id) || null; }
  };
  const window = {
    requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; },
    setInterval(fn) { intervalCallbacks.push(fn); return intervalCallbacks.length; },
    setTimeout(fn) { this.pendingTimeout = fn; return 1; },
    addEventListener() {},
    URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} }
  };
  class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } }
  class WebGLRenderer {
    constructor() { this.info = { render: { calls: 12, triangles: 3456 } }; this.pixelRatio = 1; }
    setPixelRatio(v) { this.pixelRatio = v; }
    getSize(v) { v.x = 320; v.y = 180; return v; }
    setSize(w, h) { this.size = [w, h]; }
    render(scene) { this.seen = { fire: fire.visible, light: light.intensity, fog: scene.fog.density, grade: grade.style.display }; }
  }
  const THREE = { WebGLRenderer, Vector2 };
  const fire = { name: 'wing-torch-fire', isMesh: true, visible: true };
  const light = { name: 'point-light', isLight: true, intensity: 2.5 };
  const scene = { fog: { density: 0.0062 }, traverse(fn) { fn(fire); fn(light); } };
  const renderer = new WebGLRenderer();
  const context = {
    window, document: doc, location: { search }, URLSearchParams, performance: { now() { clock += 0.1; return clock; } },
    THREE, console, setTimeout: window.setTimeout.bind(window), Blob: class Blob {},
    URL: window.URL, Math, Number, Array, Set, Map, JSON, String
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'performance-debug.js'), 'utf8'), context);
  return { window, document: doc, inputs, elements, renderer, scene, fire, light, grade, rafQueue, context };
}

test('diagnostic script is inert without debug=1', () => {
  const env = makeEnv('');
  assert.equal(env.window.__perfLab, undefined);
  assert.equal(env.document.body.appended, undefined);
});

test('debug controls instrument frames and restore transient render state', () => {
  const e = makeEnv();
  assert.ok(e.window.__perfLab);

  e.inputs[0].checked = true; e.inputs[0].onchange();
  e.inputs[1].checked = true; e.inputs[1].onchange();
  e.inputs[2].checked = true; e.inputs[2].onchange();
  assert.equal(e.window.__perfLab.flags.skipLightWork, false);
  e.inputs[3].checked = true; e.inputs[3].onchange();
  assert.equal(e.window.__perfLab.flags.skipLightWork, true);

  const runFrame = (ts) => {
    e.window.requestAnimationFrame(() => e.renderer.render(e.scene, {}));
    e.rafQueue.shift()(ts);
  };
  runFrame(1000);
  assert.deepEqual(e.renderer.seen, { fire: false, light: 0, fog: 0, grade: 'none' });
  assert.equal(e.fire.visible, true);
  assert.equal(e.light.intensity, 2.5);
  assert.equal(e.scene.fog.density, 0.0062);
  assert.equal(e.grade.style.display, 'block');
  runFrame(1016.7);
  assert.equal(e.window.__perfLab.samples.length, 1);
  const row = e.window.__perfLab.summary(e.window.__perfLab.samples);
  assert.ok(row.fps > 59 && row.fps < 61);
  assert.equal(row.calls, 12);
  assert.equal(row.tris, 3456);

  e.elements.get('perf-pixels').value = '0.5';
  e.elements.get('perf-pixels').onchange({ target: e.elements.get('perf-pixels') });
  assert.equal(e.renderer.pixelRatio, 0.5);
  assert.deepEqual(e.renderer.size, [320, 180]);
});
