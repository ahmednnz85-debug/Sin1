'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function sinAssetUrl(url, build) {
  if (typeof url !== 'string' || !url) return url;
  if (/^(data:|blob:)/i.test(url)) return url;
  if (/jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|esm\.sh|googleapis\.com|gstatic\.com/i.test(url)) return url;
  if (/[?&](?:v|sin|fix)=/.test(url)) return url;
  if (!/\.(glb|gltf|json|bin|wasm)(?:$|\?)/i.test(url)) return url;
  const b = build || 'dev';
  const sep = url.indexOf('?') >= 0 ? '&' : '?';
  return url + sep + 'v=' + encodeURIComponent(b);
}

describe('sin cache-proof asset URLs', () => {
  it('appends ?v=build to bare GLB and JSON paths', () => {
    assert.equal(sinAssetUrl('assets/bab.glb', 'abc'), 'assets/bab.glb?v=abc');
    assert.equal(sinAssetUrl('assets/lod/outdoor-lod.json', 'abc'), 'assets/lod/outdoor-lod.json?v=abc');
  });
  it('leaves already-versioned, data:, blob:, and CDN URLs alone', () => {
    assert.equal(sinAssetUrl('palaceInterior.js?v=hall31', 'abc'), 'palaceInterior.js?v=hall31');
    assert.equal(sinAssetUrl('x.png?fix=1', 'abc'), 'x.png?fix=1');
    assert.equal(sinAssetUrl('data:image/jpeg;base64,xx', 'abc'), 'data:image/jpeg;base64,xx');
    assert.equal(sinAssetUrl('blob:https://example/1', 'abc'), 'blob:https://example/1');
    const cdn = 'https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js';
    assert.equal(sinAssetUrl(cdn, 'abc'), cdn);
  });
  it('appends with & when a different query already exists', () => {
    assert.equal(sinAssetUrl('a.glb?foo=1', 'abc'), 'a.glb?foo=1&v=abc');
  });
  it('does not stamp image, hdr, or other non-model URLs', () => {
    assert.equal(sinAssetUrl('assets/sky_babylon_blood.jpeg', 'abc'), 'assets/sky_babylon_blood.jpeg');
    assert.equal(sinAssetUrl('assets/skyline_ring_a.jpg', 'abc'), 'assets/skyline_ring_a.jpg');
    assert.equal(sinAssetUrl('assets/distant_city_ring.jpg', 'abc'), 'assets/distant_city_ring.jpg');
    assert.equal(sinAssetUrl('assets/foo.png', 'abc'), 'assets/foo.png');
    assert.equal(sinAssetUrl('assets/env.hdr', 'abc'), 'assets/env.hdr');
  });
});

describe('cache-proof boot is wired into the shipped files', () => {
  const root = path.join(__dirname, '..');
  it('three-compat fetches legacy scripts with cache: no-store', () => {
    const t = fs.readFileSync(path.join(root, 'three-compat.js'), 'utf8');
    assert.match(t, /fetch\(url,\s*\{\s*cache:\s*'no-store'\s*\}\)/);
    assert.match(t, /function sinAssetUrl/);
    assert.match(t, /FileLoader && ThreeModule\.FileLoader\.prototype/);
    assert.doesNotMatch(t, /wrap\(ThreeModule\.TextureLoader/);
    assert.doesNotMatch(t, /wrap\(ThreeModule\.ImageLoader/);
    assert.doesNotMatch(t, /script\.src = original\.dataset\.src/);
  });
  it('index.html keeps a golden placeholder sky and pins skyline CPU', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.match(html, /function __sinPlaceholderSky/);
    assert.match(html, /SKY_IMG failed to load/);
    assert.match(html, /distant_city_ring\.jpg/);
    assert.match(html, /sinKeepCpu=true;t\.userData\.sinSky=true/);
  });
  it('index.html boots a build stamp and ?sin= redirect, and versions leftover scripts', () => {
    const t = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.match(t, /window\.__SIN_BUILD__/);
    assert.match(t, /build\.json\?t=/);
    assert.match(t, /cache:\s*'no-store'/);
    assert.match(t, /searchParams\.set\('sin'/);
    assert.match(t, /id="sin-build"|'sin-build'/);
    assert.match(t, /clipper\.js\?v=/);
    assert.match(t, /performance-debug\.js\?v=/);
  });
  it('build.json exposes a non-empty id', () => {
    const b = JSON.parse(fs.readFileSync(path.join(root, 'build.json'), 'utf8'));
    assert.equal(typeof b.id, 'string');
    assert.ok(b.id.length >= 3);
  });
  it('tools/stamp-build.py can stamp a deploy id into build.json and index.html', () => {
    const t = fs.readFileSync(path.join(root, 'tools/stamp-build.py'), 'utf8');
    assert.match(t, /__SIN_BUILD__/);
    assert.match(t, /build\.json/);
  });
});
