'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const D = require('../device-profile.js');

test('desktop profile keeps a generous residency budget and does not lower the look', () => {
  const p = D.detect({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', hardwareConcurrency: 8, deviceMemory: 16 });
  assert.equal(p.constrained, false);
  assert.equal(p.isMobile, false);
  assert.equal(p.prefetchHops, 7);
  assert.equal(p.cacheZones.normal, 3);
  assert.equal(p.gfxTier, 'high');
  assert.ok(p.maxTextureSize >= 2048);
});

test('iPhone is constrained for residency (not a locked low look): K2 prefetches from the hall, K3/K4 wait', () => {
  const p = D.detect({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', hardwareConcurrency: 6, maxTouchPoints: 5 });
  assert.equal(p.isIOS, true);
  assert.equal(p.isMobile, true);
  assert.equal(p.constrained, true);
  assert.equal(p.prefetchHops, 4); // K2 is 3 hops from Palace
  assert.equal(p.cacheZones.normal, 1);
  assert.equal(p.cacheZones.critical, 0);
  assert.equal(p.maxTextureSize, 1024);
  // Capable iPhone (6 cores, unknown memory treated as 8) starts at medium, not locked low.
  assert.equal(p.gfxTier, 'medium');
});

test('iPadOS desktop-UA with touch is still treated as iOS for residency', () => {
  const p = D.detect({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', maxTouchPoints: 5, hardwareConcurrency: 8 });
  assert.equal(p.isIOS, true);
  assert.equal(p.constrained, true);
  assert.equal(p.prefetchHops, 4);
});

test('crash downgrade is session-only and does not rewrite a quality preference', () => {
  const store = {};
  const fake = {
    getItem: k => store[k] || null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  global.sessionStorage = fake;
  D.rememberCrash({ reason: 'webglcontextlost' });
  assert.ok(D.pendingCrashDowngrade());
  const got = D.consumeCrashDowngrade();
  assert.equal(got.reason, 'webglcontextlost');
  assert.equal(D.pendingCrashDowngrade(), null);
  delete global.sessionStorage;
});

test('capTexture does not flag sinCapped before the image has dimensions', () => {
  const api = require('../device-profile.js');
  const tex = { userData: {}, source: { data: {} }, image: {} }; // no width yet
  assert.equal(api.capTexture(tex, 1024), false);
  assert.ok(!tex.userData.sinCapped, 'must not skip a later 4K bitmap');
  // Now the 4K image arrives — must cap.
  const img = { width: 4096, height: 4096 };
  tex.image = img; tex.source.data = img;
  // In node, document is undefined so canvas cap cannot run; it must still
  // return false WITHOUT setting sinCapped, so the browser path can retry.
  const r = api.capTexture(tex, 1024);
  assert.equal(r, false);
  assert.ok(!tex.userData.sinCapped || (tex.image && Math.max(tex.image.width, tex.image.height) <= 1024));
});

test('installDecodeCap resizes an oversized ImageBitmap and closes the original', async () => {
  const api = require('../device-profile.js');
  const closed = [];
  function FakeBmp(w, h) { this.width = w; this.height = h; this.close = () => closed.push(w); }
  const calls = [];
  const orig = async function (img, opts) {
    calls.push({ w: img && img.width, opts });
    if (opts && opts.resizeWidth) return new FakeBmp(opts.resizeWidth, opts.resizeHeight);
    return new FakeBmp(img.width || 4096, img.height || 4096);
  };
  global.createImageBitmap = orig;
  // detect() on this node UA is desktop (4096). Force the iPhone cap.
  api.installDecodeCap({ maxTextureSize: 1024 });
  const out = await global.createImageBitmap({ width: 4096, height: 4096 });
  assert.equal(out.width, 1024);
  assert.equal(out.height, 1024);
  assert.ok(closed.includes(4096), 'original 4K bitmap must be closed');
  delete global.createImageBitmap;
});
