/* SIN ENGINE — process-memory estimator and CPU-side release.
 *
 * iOS Safari jetsams the WebContent process on TOTAL RSS (often ~1–1.5 GB
 * on iPhone 15/16, lower on older phones), which includes decoded image
 * bitmaps kept CPU-side, GLB ArrayBuffers, geometry attribute arrays,
 * render targets, shadow maps, shader-compile peaks, and anything the
 * outdoor city still references after "dispose".
 *
 * The previous overlay reported ~tex as `info.memory.textures * 2.5`.
 * 71 textures × 2.5 = 177.5 MB — exactly the number on the user's crash
 * card. That is not a measurement.
 *
 * This module:
 *   1. Estimates CPU + GPU + heap with real image/buffer sizes.
 *   2. Drops CPU-side copies after a successful GPU upload (shared
 *      Texture.source is only cleared once every clone is resident —
 *      the r187 "gold and black" visual regression).
 *   3. Frees GLB parser buffers after parse.
 *   4. On Texture/Geometry dispose, immediately drops CPU arrays and
 *      closes ImageBitmaps so a released city is actually collectable.
 *   5. Tracks a peak around palace REVEAL.
 */
(function (root) {
  'use strict';

  const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
    'emissiveMap', 'envMap', 'lightMap', 'alphaMap', 'bumpMap', 'displacementMap'];
  const heldGltf = new Set();
  const peak = { processMB: 0, at: 0, phase: '—', sample: null };
  let hooksInstalled = false;
  let lastEstimate = null;

  function imgSize(img) {
    if (!img) return { w: 0, h: 0 };
    const w = img.width || img.videoWidth || (img.image && img.image.width) || 0;
    const h = img.height || img.videoHeight || (img.image && img.image.height) || 0;
    return { w: w, h: h };
  }

  function cpuImageBytes(tex) {
    if (!tex) return 0;
    if (tex.userData && tex.userData.sinCpuReleased) return 0;
    const img = tex.image || (tex.source && tex.source.data);
    if (!img) return 0;
    // Cube / array
    if (Array.isArray(img)) {
      let n = 0;
      for (let i = 0; i < img.length; i++) n += cpuImageBytes({ image: img[i], source: { data: img[i] } });
      return n;
    }
    const s = imgSize(img);
    if (!s.w || !s.h) {
      if (img.data && img.data.byteLength) return img.data.byteLength;
      return 0;
    }
    // Decoded bitmap is RGBA8 (ImageBitmap / HTMLImage / Canvas). Mipmaps
    // are typically GPU-only; the CPU holds one full-res copy.
    const layers = img.depth || 1;
    return s.w * s.h * 4 * layers;
  }

  function gpuTexBytes(tex) {
    if (!tex) return 0;
    let w = tex.image && (tex.image.width || tex.image.videoWidth) || 0;
    let h = tex.image && (tex.image.height || tex.image.videoHeight) || 0;
    if ((!w || !h) && tex.source && tex.source.data) {
      const d = tex.source.data;
      w = d.width || d.videoWidth || 0;
      h = d.height || d.videoHeight || 0;
    }
    if ((!w || !h) && tex.userData && tex.userData.sinGpuW) {
      w = tex.userData.sinGpuW;
      h = tex.userData.sinGpuH;
    }
    if ((!w || !h) && tex.isCompressedTexture && tex.mipmaps && tex.mipmaps[0]) {
      w = tex.mipmaps[0].width || 0;
      h = tex.mipmaps[0].height || 0;
    }
    // RenderTarget texture
    if ((!w || !h) && tex.isFramebufferTexture) {
      w = tex.image && tex.image.width || 0;
      h = tex.image && tex.image.height || 0;
    }
    if (!w || !h) return 0;
    const bpp = 4;
    const mips = tex.generateMipmaps !== false ? 1.333 : 1;
    return Math.ceil(w * h * bpp * mips);
  }

  function attribBytes(geo) {
    if (!geo) return 0;
    let n = 0;
    const attrs = geo.attributes || {};
    for (const k in attrs) {
      const a = attrs[k];
      if (a && a.array && a.array.byteLength) n += a.array.byteLength;
    }
    if (geo.index && geo.index.array && geo.index.array.byteLength) n += geo.index.array.byteLength;
    if (geo.morphAttributes) {
      for (const k in geo.morphAttributes) {
        const list = geo.morphAttributes[k] || [];
        for (let i = 0; i < list.length; i++) {
          const a = list[i];
          if (a && a.array && a.array.byteLength) n += a.array.byteLength;
        }
      }
    }
    return n;
  }

  function textureUploaded(renderer, t) {
    try {
      const p = renderer.properties && renderer.properties.get(t);
      // Any live GL name means the GPU has a copy. Requiring __version ===
      // t.version was skipping almost every texture (version drifts after
      // needsUpdate / anisotropy), so CPU bitmaps never dropped (~400 MB).
      return !!(p && (p.__webglTexture || p.__webglInit));
    } catch (_) { return false; }
  }

  function closeImage(img) {
    if (!img) return;
    try { if (typeof img.close === 'function') img.close(); } catch (_) {}
  }

  function dropTextureCpu(t) {
    if (!t || (t.userData && t.userData.sinKeepCpu)) return;
    try {
      const img = t.image || (t.source && t.source.data);
      const s = imgSize(img);
      if (!t.userData) t.userData = {};
      if (s.w && s.h) {
        t.userData.sinGpuW = t.userData.sinGpuW || s.w;
        t.userData.sinGpuH = t.userData.sinGpuH || s.h;
      }
      if (t.source) t.source.data = null;
      if (t.image && t.image !== img) closeImage(t.image);
      t.image = null;
      closeImage(img);
      t.userData.sinCpuReleased = true;
    } catch (_) {}
  }

  function dropGeometryCpu(g) {
    if (!g || (g.userData && g.userData.keepCpu)) return;
    try {
      const attrs = g.attributes || {};
      for (const k in attrs) {
        const a = attrs[k];
        if (a) {
          a.array = null;
          if (typeof a.onUploadCallback === 'function') { /* already fired */ }
        }
      }
      if (g.index) g.index.array = null;
      if (g.morphAttributes) {
        for (const k in g.morphAttributes) {
          const list = g.morphAttributes[k] || [];
          for (let i = 0; i < list.length; i++) if (list[i]) list[i].array = null;
        }
      }
      if (!g.userData) g.userData = {};
      g.userData.sinCpuReleased = true;
    } catch (_) {}
  }

  function releaseCpuFromObject(root, renderer) {
    if (!root || !root.traverse || !renderer || typeof renderer.initTexture !== 'function') return { sources: 0, released: 0 };
    const bySource = new Map();
    const geos = new Set();
    root.traverse(function (o) {
      if (o.geometry) geos.add(o.geometry);
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      mats.forEach(function (m) {
        if (!m) return;
        TEX_KEYS.forEach(function (k) {
          const t = m[k];
          if (!t || !t.isTexture || t.isCompressedTexture || t.isRenderTargetTexture || !t.source) return;
          if (t.userData && t.userData.sinKeepCpu) return;
          const list = bySource.get(t.source) || [];
          if (list.indexOf(t) < 0) list.push(t);
          bySource.set(t.source, list);
        });
      });
    });
    bySource.forEach(function (list) {
      list.forEach(function (t) { try { if (t.image || (t.source && t.source.data)) renderer.initTexture(t); } catch (_) {} });
    });
    let released = 0;
    bySource.forEach(function (list, source) {
      if (!source.data) return;
      if (!list.every(function (t) { return textureUploaded(renderer, t); })) return;
      try {
        const img = source.data;
        source.data = null;
        list.forEach(function (t) { t.image = null; if (!t.userData) t.userData = {}; t.userData.sinCpuReleased = true; });
        closeImage(img);
        released++;
      } catch (_) {}
    });
    geos.forEach(function (g) {
      if (g.userData && (g.userData.keepCpu || g.userData.palaceShared)) return;
      if (typeof g.onUploadCallback !== 'function' || !g.userData || !g.userData.sinArmUpload) {
        const self = g;
        const prev = g.onUploadCallback;
        g.onUploadCallback = function () {
          try { if (typeof prev === 'function') prev.call(this); } catch (_) {}
          dropGeometryCpu(self);
        };
        if (!g.userData) g.userData = {};
        g.userData.sinArmUpload = true;
      }
    });
    return { sources: bySource.size, released: released };
  }

  function dropGltfParser(gltf) {
    if (!gltf) return;
    try {
      if (gltf.parser) {
        const p = gltf.parser;
        try { if (p.cache && p.cache.removeAll) p.cache.removeAll(); } catch (_) {}
        try {
          if (Array.isArray(p.extensions)) { /* noop */ }
          if (p.json) p.json = null;
        } catch (_) {}
        try {
          const buf = p.buffer || (p.associative && p.associative.buffer);
          if (p._dump && p._dump()) { /* no-op */ }
        } catch (_) {}
        // Three r187: parser.fileLoader / associations; buffers live on parser.bufferViews / .cache
        try { p.associations = null; } catch (_) {}
      }
    } catch (_) {}
  }

  function trackBuffer(buf) {
    if (buf && buf.byteLength) heldGltf.add(buf);
  }
  function forgetBuffer(buf) {
    if (buf) heldGltf.delete(buf);
  }
  function heldGltfBytes() {
    let n = 0;
    heldGltf.forEach(function (b) { n += b.byteLength || 0; });
    return n;
  }

  function collectFromScene(scene) {
    const textures = new Set();
    const geos = new Set();
    const rts = new Set();
    let calls = 0;
    if (!scene || !scene.traverse) return { textures: textures, geos: geos, rts: rts };
    scene.traverse(function (o) {
      if (o.geometry) geos.add(o.geometry);
      if (o.isLight && o.shadow && o.shadow.map) rts.add(o.shadow.map);
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      mats.forEach(function (m) {
        if (!m) return;
        TEX_KEYS.forEach(function (k) { if (m[k] && m[k].isTexture) textures.add(m[k]); });
        if (m.uniforms) {
          Object.keys(m.uniforms).forEach(function (uk) {
            const v = m.uniforms[uk] && m.uniforms[uk].value;
            if (v && v.isTexture) textures.add(v);
          });
        }
      });
    });
    if (scene.environment && scene.environment.isTexture) textures.add(scene.environment);
    if (scene.background && scene.background.isTexture) textures.add(scene.background);
    return { textures: textures, geos: geos, rts: rts, _c: calls };
  }

  function estimate(ctx) {
    ctx = ctx || {};
    const renderer = ctx.renderer || (typeof window !== 'undefined' && window.__R) || null;
    const scene = ctx.scene || (typeof window !== 'undefined' && window.__S) || null;
    const info = renderer && renderer.info ? renderer.info : null;
    const mem = info && info.memory ? info.memory : {};
    const render = info && info.render ? info.render : {};
    const collected = collectFromScene(scene);

    // Also pick up textures the renderer still has in its properties map.
    if (renderer && renderer.properties && renderer.properties._map) {
      try {
        renderer.properties._map.forEach(function (_val, obj) {
          if (obj && obj.isTexture) collected.textures.add(obj);
        });
      } catch (_) {}
    }

    let cpuImg = 0, gpuTex = 0;
    const seenSrc = new Set();
    const seenGpu = new Set();
    collected.textures.forEach(function (t) {
      const src = t.source || t;
      if (!seenSrc.has(src)) {
        seenSrc.add(src);
        cpuImg += cpuImageBytes(t);
        // One GPU copy per Source (r187 WebGLTextures keys on source.uuid).
        gpuTex += gpuTexBytes(t);
      }
    });

    let cpuGeo = 0, gpuGeo = 0;
    collected.geos.forEach(function (g) {
      const b = attribBytes(g);
      if (!(g.userData && g.userData.sinCpuReleased)) cpuGeo += b;
      gpuGeo += b || (g.userData && g.userData.sinCpuReleased ? (g.userData.sinGpuBytes || 0) : 0);
      if (b && !g.userData) g.userData = {};
      if (b && g.userData && !g.userData.sinGpuBytes) g.userData.sinGpuBytes = b;
    });

    let gpuRT = 0;
    // Default framebuffer (color + depth). pixelRatio is already baked into
    // drawingBufferWidth/Height. iPhone 15/16 is DPR 3, but SinGfx caps the
    // effective ratio at 1.25 × dynamic-resolution scale.
    if (renderer) {
      const dw = renderer.domElement && (renderer.domElement.width || 0) || 0;
      const dh = renderer.domElement && (renderer.domElement.height || 0) || 0;
      if (dw && dh) gpuRT += dw * dh * 4 * 2;
    }
    collected.rts.forEach(function (rt) {
      try {
        const tw = (rt.width || (rt.texture && rt.texture.image && rt.texture.image.width) || 0);
        const th = (rt.height || (rt.texture && rt.texture.image && rt.texture.image.height) || 0);
        if (tw && th) gpuRT += tw * th * 8; // depth + optional color
      } catch (_) {}
    });
    // Sun shadow map if not already collected (release may have dropped the light's map).
    try {
      const gfx = typeof window !== 'undefined' && window.SinGfx && SinGfx.shadowSnapshot && SinGfx.shadowSnapshot();
      if (gfx && gfx.mapEnabled && gfx.mapSize) {
        const ms = gfx.mapSize;
        // already counted if sun.shadow.map is in collected.rts; add only if empty
        if (!collected.rts.size) gpuRT += ms * ms * 8;
      }
    } catch (_) {}

    const programs = Array.isArray(info && info.programs) ? info.programs.length
      : (mem.programs || 0);
    // Compiled GLSL is modest; the spike is temporary compiler IR. Budget 0.6 MB each.
    const programsMB = programs * 0.6;
    const gltfBytes = heldGltfBytes();

    const heap = (typeof performance !== 'undefined' && performance.memory) ? {
      usedMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
      totalMB: +(performance.memory.totalJSHeapSize / 1048576).toFixed(1),
      limitMB: performance.memory.jsHeapSizeLimit ? +(performance.memory.jsHeapSizeLimit / 1048576).toFixed(0) : null
    } : null;

    const cpuImgMB = cpuImg / 1048576;
    const cpuGeoMB = cpuGeo / 1048576;
    const cpuGltfMB = gltfBytes / 1048576;
    const gpuTexMB = gpuTex / 1048576;
    const gpuGeoMB = gpuGeo / 1048576;
    const gpuRTMB = gpuRT / 1048576;
    const gpuMB = gpuTexMB + gpuGeoMB + gpuRTMB;
    const cpuMB = cpuImgMB + cpuGeoMB + cpuGltfMB;
    // ImageBitmaps / HTMLImages often sit outside the JS heap. Conservative
    // process total = heap (or CPU arrays, whichever is larger) + GPU +
    // compiled programs + a small WebKit baseline.
    const heapMB = heap ? heap.usedMB : cpuMB;
    const webkitMB = 64;
    const processMB = Math.max(heapMB, cpuMB) + gpuMB + programsMB + webkitMB;

    const palace = (typeof window !== 'undefined' && window.PalaceInterior && PalaceInterior.status)
      ? PalaceInterior.status() : null;
    const sample = {
      t: Date.now(),
      phase: (palace && palace.phase) || ctx.phase || '—',
      room: (palace && palace.room) || ctx.room || '—',
      cityReleased: !!(scene && scene.userData && scene.userData.cityReleased) || !!(palace && palace.cityReleased),
      geometries: mem.geometries || collected.geos.size || 0,
      textures: mem.textures || collected.textures.size || 0,
      programs: programs,
      calls: render.calls || 0,
      triangles: render.triangles || 0,
      cpuImgMB: +cpuImgMB.toFixed(1),
      cpuGeoMB: +cpuGeoMB.toFixed(1),
      cpuGltfMB: +cpuGltfMB.toFixed(1),
      cpuMB: +cpuMB.toFixed(1),
      gpuTexMB: +gpuTexMB.toFixed(1),
      gpuGeoMB: +gpuGeoMB.toFixed(1),
      gpuRTMB: +gpuRTMB.toFixed(1),
      gpuMB: +gpuMB.toFixed(1),
      programsMB: +programsMB.toFixed(1),
      heap: heap,
      // Back-compat names used by the overlay / black box:
      texMB: +gpuTexMB.toFixed(1),
      geoMB: +gpuGeoMB.toFixed(1),
      processMB: +processMB.toFixed(1),
      webkitMB: webkitMB
    };

    if (sample.processMB > peak.processMB) {
      peak.processMB = sample.processMB;
      peak.at = sample.t;
      peak.phase = sample.phase;
      peak.sample = sample;
    }
    lastEstimate = sample;
    try { if (typeof window !== 'undefined') window.__sinMemPeak = peak; } catch (_) {}
    return sample;
  }

  function wipeDisposedCpu() {
    // Called after city release: walk anything still reachable and drop
    // leftover images / arrays on already-disposed resources.
  }

  function wrapReleaseExterior() {
    if (typeof window === 'undefined') return;
    const prev = window.__releaseExteriorStage;
    if (prev && prev.__sinMemWrapped) return;
    window.__releaseExteriorStage = function () {
      try { if (typeof prev === 'function') prev(); } catch (e) { try { console.warn('releaseExterior', e); } catch (_) {} }
      // After the original hook cleared extras/veg, drop any leftover GLB
      // ArrayBuffers we tracked during outdoor load.
      try { heldGltf.clear(); } catch (_) {}
      try {
        if (typeof globalThis.gc === 'function') globalThis.gc();
      } catch (_) {}
    };
    window.__releaseExteriorStage.__sinMemWrapped = true;
  }

  function installHooks(THREE) {
    if (hooksInstalled || !THREE) return;
    hooksInstalled = true;

    // Dispose must drop CPU pixels immediately so a released city is not
    // held by ImageBitmaps the GC has not yet noticed.
    if (THREE.Texture && THREE.Texture.prototype && !THREE.Texture.prototype.__sinMemDispose) {
      const td = THREE.Texture.prototype.dispose;
      THREE.Texture.prototype.dispose = function () {
        dropTextureCpu(this);
        const r = td.apply(this, arguments);
        return r;
      };
      THREE.Texture.prototype.__sinMemDispose = true;
    }
    if (THREE.BufferGeometry && THREE.BufferGeometry.prototype && !THREE.BufferGeometry.prototype.__sinMemDispose) {
      const gd = THREE.BufferGeometry.prototype.dispose;
      THREE.BufferGeometry.prototype.dispose = function () {
        const bytes = attribBytes(this);
        if (!this.userData) this.userData = {};
        if (bytes) this.userData.sinGpuBytes = bytes;
        dropGeometryCpu(this);
        return gd.apply(this, arguments);
      };
      THREE.BufferGeometry.prototype.__sinMemDispose = true;
    }

    if (THREE.GLTFLoader && THREE.GLTFLoader.prototype && !THREE.GLTFLoader.prototype.__sinMemParse) {
      const pp = THREE.GLTFLoader.prototype.parse;
      THREE.GLTFLoader.prototype.parse = function (data, path, onLoad, onError) {
        if (data && data.byteLength) trackBuffer(data);
        const wrapped = function (gltf) {
          try { dropGltfParser(gltf); } catch (_) {}
          try { forgetBuffer(data); } catch (_) {}
          // The ArrayBuffer can be released once the parser is done — the
          // scene already has typed-array views. Cutting the *document*
          // cache is safe; we do not detach the views themselves here
          // (geometries still need them until GPU upload).
          if (typeof onLoad === 'function') onLoad(gltf);
        };
        return pp.call(this, data, path, wrapped, onError);
      };
      THREE.GLTFLoader.prototype.__sinMemParse = true;
    }

    wrapReleaseExterior();
    try { if (typeof setInterval === 'function') setInterval(wrapReleaseExterior, 1000); } catch (_) {}

    if (THREE.WebGLRenderer && THREE.WebGLRenderer.prototype && !THREE.WebGLRenderer.prototype.__sinMemRender) {
      const rr = THREE.WebGLRenderer.prototype.render;
      let frames = 0, lastRelease = 0;
      THREE.WebGLRenderer.prototype.render = function (scene, camera) {
        const out = rr.apply(this, arguments);
        if (!this.getRenderTarget() && scene) {
          frames++;
          const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
          // After the first real frame, textures are on the GPU. Release
          // CPU-side bitmaps a few times as new assets stream in, then
          // at most every 2 s so we do not walk the graph every frame.
          if (frames <= 8 || (now - lastRelease > 2000) || (scene.userData && scene.userData.cityReleased && frames < 200)) {
            lastRelease = now;
            try { releaseCpuFromObject(scene, this); } catch (_) {}
          }
        }
        return out;
      };
      THREE.WebGLRenderer.prototype.__sinMemRender = true;
    }
  }

  function boot() {
    if (typeof window === 'undefined') return;
    if (window.THREE) installHooks(window.THREE);
    else if (typeof setInterval === 'function') {
      let n = 0;
      const iv = setInterval(function () {
        n++;
        if (window.THREE) { installHooks(window.THREE); clearInterval(iv); }
        else if (n > 200) clearInterval(iv);
      }, 25);
    }
  }
  boot();

  const api = {
    estimate: estimate,
    releaseCpuFromObject: releaseCpuFromObject,
    dropTextureCpu: dropTextureCpu,
    dropGeometryCpu: dropGeometryCpu,
    dropGltfParser: dropGltfParser,
    installHooks: installHooks,
    peak: function () { return peak; },
    last: function () { return lastEstimate; },
    heldGltfBytes: heldGltfBytes,
    // Used by unit tests.
    _cpuImageBytes: cpuImageBytes,
    _gpuTexBytes: gpuTexBytes,
    _attribBytes: attribBytes,
    _imgSize: imgSize
  };
  root.SinProcessMemory = api;
})(typeof window !== 'undefined' ? window : globalThis);
