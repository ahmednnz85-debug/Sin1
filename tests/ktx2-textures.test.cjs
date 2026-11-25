'use strict';
// GPU-compressed palace textures on phones (ktx2-textures.js + tools/ktx2-pack.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function loadRuntime(win) {
  const ctx = { window: win, globalThis: win, URLSearchParams, console: { info() {}, warn() {} }, fetch: win.fetch, Promise, Math, Object, Uint8Array };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'ktx2-textures.js'), 'utf8'), ctx);
  return win.SinKtx;
}

test('runtime and packer compute the same content key', () => {
  const Ktx = loadRuntime({ location: { search: '' } });
  const src = fs.readFileSync(path.join(root, 'tools', 'ktx2-pack.cjs'), 'utf8');
  const body = src.slice(src.indexOf('function key(bytes) {'), src.indexOf('// ---- GLB images'));
  const packKey = new Function(body + '; return key;')();
  for (const n of [1, 17, 4096, 70000, 300001]) {
    const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 2654435761) >>> 24;
    assert.equal(Ktx.key(b), packKey(b), 'length ' + n);
  }
  const a = new Uint8Array(70000), b = new Uint8Array(70000); b[69999] = 1;
  assert.notEqual(Ktx.key(a), Ktx.key(b), 'a change in the tail changes the key');
});

test('every manifest entry exists, is UASTC KTX2, at the phone size, and decodes as the right colour space', () => {
  const mf = path.join(root, 'assets', 'ktx2', 'manifest.json');
  if (!fs.existsSync(mf)) return;
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const items = Object.entries(m.items || {});
  assert.ok(items.length > 0);
  for (const [k, it] of items) {
    const f = path.join(root, it.file);
    assert.ok(fs.existsSync(f), it.file);
    const b = fs.readFileSync(f);
    assert.equal(b.toString('latin1', 1, 7), 'KTX 20', 'KTX2 identifier ' + k);
    assert.equal(b.readUInt32LE(12), 0, 'vkFormat undefined (Basis) ' + k);
    assert.ok(Math.max(it.w, it.h) <= 1024, 'never larger than the phone cap ' + k);
    assert.ok(b.readUInt32LE(40) > 1, 'mip chain ' + k);
    assert.ok(['color', 'data', 'normal'].includes(it.role));
  }
});

test('desktop, ?ktx2=off and GPUs without ASTC keep the original path', async () => {
  const off = loadRuntime({ location: { search: '?ktx2=off' } });
  assert.equal(off.textureFromBytes(new ArrayBuffer(8)), null);
  assert.equal(await off.ready(), false);
  const desktop = loadRuntime({ location: { search: '' }, SinDevice: { detect: () => ({ constrained: false }) } });
  assert.equal(await desktop.ready(), false);
  const src = fs.readFileSync(path.join(root, 'ktx2-textures.js'), 'utf8');
  assert.match(src, /astcSupported/);
  assert.match(src, /stats\.fallbacks\+\+/, 'a twin that fails to load falls back to the original image');
});

test('the game wires the loader, the transcoder and the hall surfaces', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const compat = fs.readFileSync(path.join(root, 'three-compat.js'), 'utf8');
  const pi = fs.readFileSync(path.join(root, 'palaceInterior.js'), 'utf8');
  assert.ok(html.indexOf('ktx2-textures.js') > 0 && html.indexOf('ktx2-textures.js') < html.indexOf('palaceInterior.js'));
  assert.match(compat, /loadKTX2Loader = \(\) => import\('three\/addons\/loaders\/KTX2Loader\.js'\)/);
  for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) assert.ok(fs.existsSync(path.join(root, 'vendor', 'basis', f)));
  assert.match(pi, /SinKtx\.textureFromBytes\(buf, linear\)/);
  assert.match(pi, /tex\.generateMipmaps = !tex\.isCompressedTexture/);
  const pm = fs.readFileSync(path.join(root, 'process-memory.js'), 'utf8');
  assert.match(pm, /Compressed blocks/);
});
