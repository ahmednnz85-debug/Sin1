/* SÎN ENGINE — device-aware memory and quality profile.
   Detects iOS / mobile / low-memory machines and returns conservative GPU
   budgets so Safari is not killed by resident textures. Desktop is unchanged
   in spirit (several rooms may stay resident). Pure logic: works in Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SinDevice = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  function uaOf(nav) { return (nav && nav.userAgent) || ''; }

  function isIOS(nav) {
    nav = nav || (typeof navigator !== 'undefined' ? navigator : {});
    const ua = uaOf(nav);
    // iPadOS 13+ can report as Macintosh; treat multi-touch Mac UA as iPad.
    return /iPhone|iPad|iPod/i.test(ua) || ((nav.maxTouchPoints || 0) > 1 && /Macintosh/.test(ua));
  }
  function isMobile(nav) {
    nav = nav || (typeof navigator !== 'undefined' ? navigator : {});
    return isIOS(nav) || /Android|Mobile/i.test(uaOf(nav));
  }

  function detect(nav, opts) {
    nav = nav || (typeof navigator !== 'undefined' ? navigator : {});
    opts = opts || {};
    const ios = isIOS(nav);
    const mobile = isMobile(nav);
    const mem = Number(nav.deviceMemory) || 0; // 0 = unknown (Safari never reports this)
    const cores = Number(nav.hardwareConcurrency) || 0;
    // Mobile, iOS, or a device that admits to 4 GB or less. Unknown memory on
    // a phone is treated as constrained: that is the safe default for Safari.
    const constrained = !!(opts.constrained) || mobile || ios || (mem > 0 && mem <= 4);
    // Hop distances from the palace hall: K2 = 3, K3 = 6, K4 = 7.
    // On a phone, prefetch only far enough that K2 starts in the hall (4 hops)
    // and K3/K4 start when the player is a couple of rooms closer. Prefetching
    // all three from the hall (hops 8 + cache 3) kept 118 textures / ~295 MB
    // resident and iOS Safari killed the tab in K2.
    const prefetchHops = constrained ? 4 : 7;
    // Visual AUTO tier matches the pre-existing detect: it is a starting
    // point only. The frame-time governor scales resolution up and down
    // with hysteresis; we never lock a phone onto a lower look.
    const memKnown = mem > 0 ? mem : 8;
    const coresKnown = cores > 0 ? cores : 4;
    let gfxTier;
    if (mobile) gfxTier = (memKnown <= 3 || coresKnown <= 4) ? 'low' : 'medium';
    else gfxTier = (coresKnown <= 4) ? 'medium' : 'high';
    return {
      isIOS: ios,
      isMobile: mobile,
      constrained: constrained,
      deviceMemory: mem,
      cores: cores,
      prefetchHops: prefetchHops,
      cacheZones: constrained ? { normal: 1, watch: 0, critical: 0 } : { normal: 3, watch: 2, critical: 0 },
      textureBudget: constrained ? 72 : 180,
      geometryBudget: constrained ? 180 : 420,
      // Hard caps (MB). The streamer evicts, then defers, rather than exceed.
      // 650 process is the iPhone Safari jetsam-safe target (peak ≲ 600–700).
      processBudgetMB: constrained ? 650 : 1400,
      gpuBudgetMB: constrained ? 480 : 1100,
      cpuBudgetMB: constrained ? 80 : 250,
      // Cap oversized GPU copies (4K maps) on phones. 1024 is still sharp
      // on a phone screen and is a residency measure, not a visual tier.
      maxTextureSize: constrained ? 1024 : 4096,
      k4TextureSize: constrained ? 512 : 1024,
      uploadsPerFrame: constrained ? 2 : 3,
      uploadMsPerFrame: constrained ? 3 : 4,
      graceMs: constrained ? 8000 : 20000,
      maxConcurrentLoads: 1,
      gfxTier: gfxTier
    };
  }

  // Downscale a decoded texture in-place so the GPU copy stays under maxSize.
  // Skips compressed textures, render targets, and images already small enough.
  // Safe to call more than once (userData.sinCapped).
  function capTexture(tex, maxSize) {
    if (!tex || !maxSize || tex.isCompressedTexture || tex.isRenderTargetTexture) return false;
    const img = tex.image || (tex.source && tex.source.data);
    if (!img) return false;
    const w = img.width || img.videoWidth || 0;
    const h = img.height || img.videoHeight || 0;
    // Not decoded yet — do NOT set sinCapped, or a later 4K ImageBitmap
    // (K2 Color/Normal/ORM 4096², 85 MB each) would skip the cap and
    // push process peak over 1 GB.
    if (!w || !h) return false;
    if (Math.max(w, h) <= maxSize) {
      if (!tex.userData) tex.userData = {};
      tex.userData.sinCapped = true;
      return false;
    }
    // If a prior call flagged sinCapped before the image existed, still cap.
    if (typeof document === 'undefined' || !document.createElement) return false;
    const scale = maxSize / Math.max(w, h);
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    try {
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx2 = canvas.getContext('2d');
      if (!ctx2) return false;
      ctx2.drawImage(img, 0, 0, cw, ch);
      if (tex.source) tex.source.data = canvas;
      tex.image = canvas;
      tex.needsUpdate = true;
      if (typeof img.close === 'function') try { img.close(); } catch (_) {}
      if (!tex.userData) tex.userData = {};
      tex.userData.sinCapped = true;
      return true;
    } catch (_) { return false; }
  }

  // After a memory-kill, the next session should start on the conservative
  // profile even if the user had picked HIGH. sessionStorage only, one session.
  const CRASH_KEY = 'sinCrashDowngrade';
  function rememberCrash(detail) {
    try {
      const payload = Object.assign({ at: Date.now() }, detail || {});
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(CRASH_KEY, JSON.stringify(payload));
    } catch (_) {}
  }
  function consumeCrashDowngrade() {
    try {
      if (typeof sessionStorage === 'undefined') return null;
      const raw = sessionStorage.getItem(CRASH_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(CRASH_KEY);
      return JSON.parse(raw);
    } catch (_) { return null; }
  }
  function pendingCrashDowngrade() {
    try {
      if (typeof sessionStorage === 'undefined') return null;
      const raw = sessionStorage.getItem(CRASH_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  // Decode ImageBitmaps already at maxTextureSize so a 4K GLB never
  // produces a 67 MB bitmap (and a phantom 85 MB GPU estimate) that
  // spikes process peak over 650 before capTexture can run.
  function installDecodeCap(opts) {
    const root = (typeof window !== 'undefined') ? window
      : (typeof globalThis !== 'undefined' ? globalThis : null);
    if (!root || typeof root.createImageBitmap !== 'function') return false;
    if (root.createImageBitmap.__sinCapped) return true;
    const orig = root.createImageBitmap.bind(root);
    const maxFrom = function () {
      try {
        if (opts && opts.maxTextureSize) return opts.maxTextureSize;
        return detect().maxTextureSize || 0;
      } catch (_) { return 0; }
    };
    let inflight = 0;
    const waiters = [];
    function acquire() {
      if (inflight >= 1) return new Promise(function (r) { waiters.push(r); });
      inflight++;
      return Promise.resolve();
    }
    function release() {
      inflight--;
      if (waiters.length) { inflight++; waiters.shift()(); }
    }
    function knownSize(src) {
      if (!src) return null;
      if (src.naturalWidth && src.naturalHeight) return { w: src.naturalWidth, h: src.naturalHeight };
      if (src.videoWidth && src.videoHeight) return { w: src.videoWidth, h: src.videoHeight };
      if (src.width && src.height && !src.arrayBuffer) return { w: src.width, h: src.height };
      return null;
    }
    function sizeFromBytes(buf) {
      if (!buf || buf.byteLength < 16) return null;
      const u = new Uint8Array(buf);
      const dv = new DataView(buf);
      // PNG
      if (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4E && u[3] === 0x47 && buf.byteLength >= 24) {
        return { w: dv.getUint32(16), h: dv.getUint32(20) };
      }
      // GIF
      if (u[0] === 0x47 && u[1] === 0x49 && u[2] === 0x46 && buf.byteLength >= 10) {
        return { w: u[6] | (u[7] << 8), h: u[8] | (u[9] << 8) };
      }
      // WebP: RIFF....WEBP
      if (u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46 &&
          u[8] === 0x57 && u[9] === 0x45 && u[10] === 0x42 && u[11] === 0x50) {
        const tag = String.fromCharCode(u[12], u[13], u[14], u[15]);
        if (tag === 'VP8X' && buf.byteLength >= 30) {
          return {
            w: 1 + (u[24] | (u[25] << 8) | (u[26] << 16)),
            h: 1 + (u[27] | (u[28] << 8) | (u[29] << 16))
          };
        }
        if (tag === 'VP8 ' && buf.byteLength >= 30) {
          return { w: (u[26] | (u[27] << 8)) & 0x3fff, h: (u[28] | (u[29] << 8)) & 0x3fff };
        }
        if (tag === 'VP8L' && buf.byteLength >= 25) {
          const b = u[21] | (u[22] << 8) | (u[23] << 16) | (u[24] << 24);
          return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
        }
      }
      // JPEG
      if (u[0] === 0xFF && u[1] === 0xD8) {
        let i = 2;
        while (i + 8 < u.length) {
          if (u[i] !== 0xFF) { i++; continue; }
          const m = u[i + 1];
          if (m === 0xC0 || m === 0xC1 || m === 0xC2) {
            return { w: (u[i + 7] << 8) | u[i + 8], h: (u[i + 5] << 8) | u[i + 6] };
          }
          if (m === 0xD8 || m === 0xD9) { i += 2; continue; }
          const len = (u[i + 2] << 8) | u[i + 3];
          if (len < 2) break;
          i += 2 + len;
        }
      }
      return null;
    }
    function peekSize(src) {
      const k = knownSize(src);
      if (k) return Promise.resolve(k);
      const blob = src && (src.slice && (src.type !== undefined || typeof src.arrayBuffer === 'function')) ? src : null;
      if (!blob || typeof blob.slice !== 'function') return Promise.resolve(null);
      try {
        return blob.slice(0, 8192).arrayBuffer().then(sizeFromBytes, function () { return null; });
      } catch (_) { return Promise.resolve(null); }
    }
    function mergeOpts(existing, rw, rh) {
      const o = existing && typeof existing === 'object' && !existing.width ? Object.assign({}, existing) : {};
      o.resizeWidth = rw;
      o.resizeHeight = rh;
      if (!o.resizeQuality) o.resizeQuality = 'high';
      return o;
    }
    function callOrig(img, a, b, c, d, e, n) {
      if (n <= 1) return orig(img);
      if (n === 2) return orig(img, a);
      if (n === 5) return orig(img, a, b, c, d);
      return orig(img, a, b, c, d, e);
    }
    function wrapped(img, a, b, c, d, e) {
      const n = arguments.length;
      const max = maxFrom();
      const existingOpts = (n === 2 && a && typeof a === 'object' && !a.width) ? a : null;
      // Already asked to resize — just serialize and forward.
      if (existingOpts && existingOpts.resizeWidth) {
        return acquire().then(function () {
          return Promise.resolve(orig(img, a)).then(function (bmp) { release(); return bmp; }, function (err) { release(); throw err; });
        });
      }
      const run = function (sz) {
        let p;
        const needs = !!(max && sz && Math.max(sz.w, sz.h) > max);
        try {
          if (needs) {
            const scale = max / Math.max(sz.w, sz.h);
            const rw = Math.max(1, Math.round(sz.w * scale));
            const rh = Math.max(1, Math.round(sz.h * scale));
            // Decode already capped: never materialize a 4K ImageBitmap.
            if (n === 2 && existingOpts) p = orig(img, mergeOpts(a, rw, rh));
            else if (n <= 1 || n === 2) p = orig(img, { resizeWidth: rw, resizeHeight: rh, resizeQuality: 'high' });
            else p = callOrig(img, a, b, c, d, e, n);
          } else {
            p = callOrig(img, a, b, c, d, e, n);
          }
        } catch (err) { return Promise.reject(err); }
        if (!p || typeof p.then !== 'function') p = Promise.resolve(p);
        return p.then(function (bmp) {
          if (!bmp || !bmp.width || !max || Math.max(bmp.width, bmp.height) <= max) return bmp;
          // Fallback if we could not peek size (or the sx/sy crop path).
          const scale = max / Math.max(bmp.width, bmp.height);
          const rw = Math.max(1, Math.round(bmp.width * scale));
          const rh = Math.max(1, Math.round(bmp.height * scale));
          return orig(bmp, { resizeWidth: rw, resizeHeight: rh, resizeQuality: 'high' }).then(function (small) {
            try { if (typeof bmp.close === 'function') bmp.close(); } catch (_) {}
            return small;
          }, function () { return bmp; });
        });
      };
      return acquire().then(function () {
        return peekSize(img).then(run, function () { return run(null); }).then(
          function (v) { release(); return v; },
          function (err) { release(); throw err; }
        );
      });
    }
    wrapped.__sinCapped = true;
    wrapped.__sinOrig = orig;
    root.createImageBitmap = wrapped;
    return true;
  }
  try { installDecodeCap(); } catch (_) {}

  return {
    detect: detect,
    isIOS: isIOS,
    isMobile: isMobile,
    capTexture: capTexture,
    installDecodeCap: installDecodeCap,
    rememberCrash: rememberCrash,
    consumeCrashDowngrade: consumeCrashDowngrade,
    pendingCrashDowngrade: pendingCrashDowngrade,
    CRASH_KEY: CRASH_KEY
  };
});
