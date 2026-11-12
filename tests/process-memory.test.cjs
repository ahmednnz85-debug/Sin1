const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'process-memory.js'), 'utf8');
const memSrc = fs.readFileSync(path.join(root, 'memory-overlay.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function load() {
  const ctx = { window: {}, globalThis: {}, performance: { now: () => 0 }, console,
    setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
    atob: (s) => Buffer.from(s,'base64').toString('binary') };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInNewContext(src, ctx);
  return ctx;
}

test('process-memory is on the page ahead of the game and exports an estimator', () => {
  assert.match(index, /data-src="process-memory\.js\?v=20261112r7"/);
  // Must load after device-profile and before palace / wings so hooks wrap THREE first.
  const dp = index.indexOf('device-profile.js');
  const pm = index.indexOf('process-memory.js');
  const pi = index.indexOf('palaceInterior.js');
  assert.ok(dp >= 0 && pm > dp && pm < pi);
});

test('the 177 MB figure was textures*2.5; the new estimator does not use that formula', () => {
  assert.doesNotMatch(src, /return n \* 2\.5/);
  // The 71×2.5 story is documented in a comment; the code itself never computes it.
  assert.match(src, /cpuImgMB/);
  assert.match(src, /gpuRTMB/);
  assert.match(src, /processMB/);
  assert.match(src, /drawingBufferWidth|domElement && \(renderer\.domElement\.width/);
  assert.match(src, /ImageBitmap|closeImage/);
  // memory-overlay keeps the formula only as last-ditch fallback, after asking SinProcessMemory.
  const prefer = memSrc.indexOf('SinProcessMemory.last');
  const fallback = memSrc.indexOf('n * 2.5');
  assert.ok(prefer >= 0 && fallback > prefer, 'fallback must come after the real estimator');
});

test('estimator counts real image pixels, not a flat 2.5 MB', () => {
  const ctx = load();
  const api = ctx.SinProcessMemory;
  assert.ok(api);
  const tex = { image: { width: 1024, height: 1024 }, source: { data: { width: 1024, height: 1024 } } };
  const cpu = api._cpuImageBytes(tex);
  assert.equal(cpu, 1024 * 1024 * 4);
  const gpu = api._gpuTexBytes(tex);
  // RGBA + mip chain ≈ 1.333
  assert.ok(gpu > 1024 * 1024 * 4 && gpu < 1024 * 1024 * 4 * 1.4);
  // 71 such textures would have been reported as 177.5 MB by the old model
  // and as ~373 MB GPU + another 284 MB CPU if images were retained.
  const seventyOneGpuMB = (gpu * 71) / 1048576;
  assert.ok(seventyOneGpuMB > 300 && seventyOneGpuMB < 450);
});

test('dropTextureCpu closes ImageBitmaps and clears the shared source', () => {
  const ctx = load();
  let closed = 0;
  const img = { width: 64, height: 64, close() { closed++; } };
  const source = { data: img };
  const tex = { image: img, source: source, userData: {} };
  ctx.SinProcessMemory.dropTextureCpu(tex);
  assert.equal(source.data, null);
  assert.equal(tex.image, null);
  assert.equal(closed, 1);
  assert.equal(tex.userData.sinCpuReleased, true);
});

test('dispose hooks drop CPU copies so a released city is collectable', () => {
  const ctx = load();
  const disposed = [];
  const THREE = {
    Texture: { prototype: { dispose() { disposed.push('tex'); } } },
    BufferGeometry: { prototype: { dispose() { disposed.push('geo'); } } },
    GLTFLoader: { prototype: { parse(data, p, onLoad) { onLoad({ parser: { cache: { removeAll() { this.cleared = true; }, cleared: false }, json: { ok: 1 } } }); } } },
    WebGLRenderer: { prototype: { render() { return 'ok'; } } }
  };
  ctx.SinProcessMemory.installHooks(THREE);
  const img = { width: 8, height: 8, close() { this.closed = true; } };
  const tex = Object.create(THREE.Texture.prototype);
  tex.image = img;
  tex.source = { data: img };
  tex.userData = {};
  tex.dispose();
  assert.equal(tex.source.data, null);
  assert.equal(img.closed, true);
  assert.ok(disposed.includes('tex'));

  const geo = Object.create(THREE.BufferGeometry.prototype);
  geo.attributes = { position: { array: new Float32Array(12) } };
  geo.index = { array: new Uint16Array(6) };
  geo.userData = {};
  geo.dispose();
  assert.equal(geo.attributes.position.array, null);
  assert.equal(geo.index.array, null);
});

test('process estimate adds CPU images, GPU, RTs and a WebKit baseline', () => {
  const ctx = load();
  const scene = {
    userData: {},
    environment: null,
    background: null,
    traverse(fn) {
      const img = { width: 512, height: 512 };
      const tex = { isTexture: true, image: img, source: { data: img }, generateMipmaps: true };
      const mesh = {
        isMesh: true,
        geometry: { attributes: { position: { array: new Float32Array(30) } }, index: { array: new Uint16Array(12) } },
        material: { map: tex }
      };
      fn(mesh);
    }
  };
  const renderer = {
    info: { memory: { textures: 1, geometries: 1 }, programs: new Array(4), render: { calls: 1, triangles: 4 } },
    domElement: { width: 800, height: 400 },
    properties: { _map: new Map() }
  };
  const s = ctx.SinProcessMemory.estimate({ renderer: renderer, scene: scene, phase: 'REVEAL' });
  assert.ok(s.processMB > 64, 'includes webkit baseline + GPU RT');
  assert.ok(s.cpuImgMB > 0.9 && s.cpuImgMB < 1.2, '512² RGBA = 1 MB, got ' + s.cpuImgMB);
  assert.ok(s.gpuRTMB > 2 && s.gpuRTMB < 4, '800x400 color+depth ≈ 2.4 MB, got ' + s.gpuRTMB);
  assert.equal(s.phase, 'REVEAL');
  assert.ok(ctx.SinProcessMemory.peak().processMB >= s.processMB);
});

test('outdoor render-hook drain does not force-init every texture', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'process-memory.js'), 'utf8');
  assert.match(src, /upload: false/);
  assert.match(src, /doUpload/);
});

test('releaseCpuFromObject records sinGpuW so gpuTex is not zeroed after CPU drop', () => {
  assert.match(src, /t\.userData\.sinGpuW = t\.userData\.sinGpuW \|\| sz\.w/);
  assert.match(src, /t\.userData\.sinGpuH = t\.userData\.sinGpuH \|\| sz\.h/);
  const api = load().SinProcessMemory;
  const img = { width: 1024, height: 512 };
  const source = { data: img };
  const tex = {
    isTexture: true, image: img, source, userData: {}, version: 1,
    generateMipmaps: true
  };
  const mat = { map: tex };
  const mesh = { material: mat, traverse(fn) { fn(this); } };
  const props = new Map();
  props.set(tex, { __webglTexture: {}, __webglInit: true });
  const renderer = {
    initTexture() {},
    properties: { get(t) { return props.get(t); } },
    info: { memory: {}, render: {}, programs: [] }
  };
  const r = api.releaseCpuFromObject(mesh, renderer, { upload: false });
  assert.equal(r.released, 1);
  assert.equal(tex.image, null);
  assert.equal(source.data, null);
  assert.equal(tex.userData.sinCpuReleased, true);
  assert.equal(tex.userData.sinGpuW, 1024);
  assert.equal(tex.userData.sinGpuH, 512);
  const gpu = api._gpuTexBytes(tex);
  assert.ok(gpu > 0, 'gpu bytes must survive CPU drop, got ' + gpu);
  // 1024*512*4*1.333 mip ≈ 2.67 MB raw calc inside gpuTexBytes
  assert.ok(gpu >= 1024 * 512 * 4, 'gpu at least uncompressed base level');
});

test('releaseCpuFromObject walks shader uniforms (sky maps)', () => {
  assert.match(src, /m\.uniforms/);
  const api = load().SinProcessMemory;
  const img = { width: 100, height: 50 };
  const source = { data: img };
  const tex = { isTexture: true, image: img, source, userData: {}, version: 1 };
  const mat = { uniforms: { map: { value: tex } } };
  const mesh = { material: mat, traverse(fn) { fn(this); } };
  const props = new Map();
  props.set(tex, { __webglTexture: {}, __webglInit: true });
  const renderer = {
    initTexture() {},
    properties: { get(t) { return props.get(t); } },
    info: { memory: {}, render: {}, programs: [] }
  };
  const r = api.releaseCpuFromObject(mesh, renderer, { upload: false });
  assert.equal(r.released, 1);
  assert.equal(tex.userData.sinCpuReleased, true);
});

test('dropGeometry is opt-in so outdoor drain cannot null live attribute arrays', () => {
  assert.match(src, /opts && opts\.dropGeometry/);
  assert.match(src, /array\.byteLength/);
});

test('purgeOrphanTextures is exported and will not dispose live or palaceShared maps', () => {
  assert.match(src, /function purgeOrphanTextures/);
  assert.match(src, /purgeOrphanTextures:\s*purgeOrphanTextures/);
  assert.match(src, /userData\.palaceShared \|\| obj\.userData\.keepDuringPalace/);
  assert.match(src, /topTextures: ctx\.detail \? texRows/);
});
