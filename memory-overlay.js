/* Toggleable memory / residency diagnostic overlay (?mem=1 or Settings).
   Persistent black box: writes phase/room/renderer.info/texMB/FPS/last events
   to sessionStorage every 500 ms so a crash/reload can show the prior session. */
(function (root) {
  'use strict';
  const MAX_LOG = 40;
  const MAX_EVENTS_STORE = 30;
  const STORE_KEY = 'sinBlackBox';
  const PREV_KEY = 'sinBlackBoxPrev';
  const TICK_MS = 500;
  const log = [];
  let el = null;
  const params = (typeof location !== 'undefined' && location.search) ? location.search : '';
  let on = /(?:[?&](?:mem|perf)\b)/.test(params) || false;
  const diagOn = /(?:[?&]diag=1\b)/.test(params) || /(?:[?&]diag\b)/.test(params);
  if (diagOn) on = true;
  const DIAG_KEY = 'sinDiagTimeline';
  const DIAG_PREV = 'sinDiagPrev';
  const DIAG_MAX = 30;
  let diagEl = null;
  let lastDiagWrite = 0;

  let lastSample = null;
  let lastWriteAt = 0;
  let lastEstimateAt = 0;
  let fpsEma = 0;
  const fpsRing = [];
  let fpsLow1 = null;
  let lastFrameTs = 0;
  let heaviestByPhase = {};
  let crashBannerShown = false;

  function push(kind, msg) {
    const line = {
      t: performance.now(),
      kind: kind || 'info',
      msg: String(msg || '')
    };
    log.unshift(line);
    if (log.length > MAX_LOG) log.length = MAX_LOG;
    try { console.log('[mem]', kind, msg); } catch (_) {}
  }

  function estimateTextureBytes(renderer) {
    // Prefer the real process-memory estimator. The historical
    // `textures * 2.5` (71 × 2.5 = 177.5) is kept only as a last-ditch
    // fallback when the estimator has not booted.
    try {
      if (root.SinProcessMemory && SinProcessMemory.last && SinProcessMemory.last()) {
        const s = SinProcessMemory.last();
        if (s && s.gpuTexMB != null) return s.gpuTexMB;
      }
    } catch (_) {}
    const n = renderer && renderer.info && renderer.info.memory ? renderer.info.memory.textures : 0;
    return n * 2.5;
  }

  function estimateGeometryBytes(renderer) {
    try {
      if (root.SinProcessMemory && SinProcessMemory.last && SinProcessMemory.last()) {
        const s = SinProcessMemory.last();
        if (s && s.gpuGeoMB != null) return s.gpuGeoMB;
      }
    } catch (_) {}
    const n = renderer && renderer.info && renderer.info.memory ? renderer.info.memory.geometries : 0;
    return n * 0.15;
  }

  function texDecodedMB(tex) {
    if (!tex) return 0;
    const img = tex.image || tex.source && tex.source.data;
    let w = 0, h = 0;
    if (img) {
      w = img.width || img.videoWidth || (img.image && img.image.width) || 0;
      h = img.height || img.videoHeight || (img.image && img.image.height) || 0;
      if ((!w || !h) && img.data && img.data.width) { w = img.data.width; h = img.data.height; }
    }
    if (!w || !h) {
      if (tex.isCompressedTexture && tex.mipmaps && tex.mipmaps[0]) {
        w = tex.mipmaps[0].width || 0;
        h = tex.mipmaps[0].height || 0;
      }
    }
    if (!w || !h) return 0;
    // RGBA8 + mipmaps (~33% overhead)
    return (w * h * 4 * 1.333) / 1048576;
  }

  function meshTris(obj) {
    const g = obj.geometry;
    if (!g) return 0;
    const idx = g.index;
    if (idx) return Math.floor(idx.count / 3);
    const pos = g.attributes && g.attributes.position;
    return pos ? Math.floor(pos.count / 3) : 0;
  }

  function reportHeaviest(scene, phase) {
    phase = phase || 'unknown';
    const texMap = new Map();
    const meshes = [];
    if (!scene || !scene.traverse) {
      return { phase: phase, textures: [], meshes: [] };
    }
    scene.traverse(function (o) {
      if (o.isMesh || o.isSkinnedMesh || o.isInstancedMesh) {
        const tris = meshTris(o);
        if (tris > 0) {
          const count = o.isInstancedMesh ? (o.count || 1) : 1;
          meshes.push({
            name: o.name || o.type || 'mesh',
            tris: tris * count,
            inst: count,
            res: (o.geometry && (o.geometry.uuid || '').slice(0, 8)) || ''
          });
        }
      }
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      mats.forEach(function (m) {
        if (!m) return;
        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'envMap', 'lightMap', 'alphaMap', 'bumpMap', 'displacementMap'].forEach(function (k) {
          const t = m[k];
          if (!t || !t.isTexture) return;
          const mb = texDecodedMB(t);
          const img = t.image || t.source && t.source.data;
          const w = img && (img.width || img.videoWidth) || 0;
          const h = img && (img.height || img.videoHeight) || 0;
          const key = t.uuid || (k + ':' + w + 'x' + h);
          const prev = texMap.get(key);
          if (!prev || mb > prev.mb) {
            texMap.set(key, {
              name: (t.name || m.name || o.name || k),
              slot: k,
              mb: +mb.toFixed(2),
              w: w,
              h: h
            });
          }
        });
      });
    });
    const textures = Array.from(texMap.values()).sort(function (a, b) { return b.mb - a.mb; }).slice(0, 10);
    const heavyMeshes = meshes.sort(function (a, b) { return b.tris - a.tris; }).slice(0, 10);
    const report = { phase: phase, at: Date.now(), textures: textures, meshes: heavyMeshes };
    heaviestByPhase[phase] = report;
    try {
      console.groupCollapsed('[mem] heaviest @ ' + phase);
      console.table(textures.map(function (t) {
        return { name: t.name, slot: t.slot, MB: t.mb, res: t.w + 'x' + hStr(t) };
      }));
      console.table(heavyMeshes.map(function (m) {
        return { name: m.name, tris: m.tris, inst: m.inst };
      }));
      console.groupEnd();
    } catch (_) {}
    push('heaviest', phase + ' tex0=' + (textures[0] ? textures[0].name + ' ' + textures[0].mb + 'MB' : '—') +
      ' mesh0=' + (heavyMeshes[0] ? heavyMeshes[0].name + ' ' + heavyMeshes[0].tris : '—'));
    try {
      sessionStorage.setItem('sinHeaviest', JSON.stringify(heaviestByPhase));
    } catch (_) {}
    return report;
  }

  function hStr(t) { return (t.w || '?') + 'x' + (t.h || '?'); }

  function ensure() {
    if (el || !on) return;
    el = document.createElement('div');
    el.id = 'sin-mem';
    el.style.cssText = 'position:fixed;z-index:60;right:calc(8px + env(safe-area-inset-right,0px));top:8px;max-width:min(360px,92vw);max-height:70vh;overflow:auto;padding:8px 10px;font:11px/1.35 ui-monospace,Menlo,monospace;color:#e8f5e0;background:rgba(6,12,8,.72);border:1px solid rgba(120,200,140,.45);white-space:pre-wrap;pointer-events:none';
    document.body.appendChild(el);
  }

  function sample(ctx) {
    ctx = ctx || {};
    const renderer = ctx.renderer;
    const info = renderer && renderer.info ? renderer.info : null;
    const mem = info && info.memory ? info.memory : {};
    const render = info && info.render ? info.render : {};
    const heap = performance.memory ? {
      usedMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
      totalMB: +(performance.memory.totalJSHeapSize / 1048576).toFixed(1)
    } : null;
    const wings = window.PalaceWings && PalaceWings.metrics ? PalaceWings.metrics() : null;
    const palace = window.PalaceInterior && PalaceInterior.status ? PalaceInterior.status() : null;
    const gfx = window.SinGfx && SinGfx.status ? SinGfx.status() : null;
    const now = performance.now();
    if (lastFrameTs) {
      const instDt = Math.max(1, now - lastFrameTs);
      const instFps = 1000 / instDt;
      fpsEma = fpsEma ? (fpsEma * 0.85 + instFps * 0.15) : instFps;
      // Real on-device 1% low over the last ~2 s (120 frames at 60).
      if (instDt < 2000) {
        fpsRing.push(instDt);
        if (fpsRing.length > 120) fpsRing.shift();
        if (fpsRing.length >= 20) {
          const sorted = fpsRing.slice().sort(function (a, b) { return b - a; });
          const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * 0.01)));
          fpsLow1 = +(1000 / sorted[idx]).toFixed(0);
        }
      }
    }
    lastFrameTs = now;
    // Prefer the rAF EMA (real device fps) so the user can confirm 55–60.
    const fps = fpsEma ? +fpsEma.toFixed(0) : (gfx && gfx.avgMs ? +(1000 / Math.max(1, gfx.avgMs)).toFixed(0) : null);
    lastSample = {
      t: Date.now(),
      phase: (palace && palace.phase) || (ctx.phase) || ((document.body && document.body.dataset && document.body.dataset.sinPhase)) || '—',
      room: (wings && wings.current) || (palace && palace.room) || '—',
      cityReleased: !!(ctx.scene && ctx.scene.userData && ctx.scene.userData.cityReleased) || !!(palace && palace.cityReleased),
      teardown: palace && palace.teardownPhase != null ? palace.teardownPhase : null,
      geometries: mem.geometries || 0,
      textures: mem.textures || 0,
      programs: Array.isArray(info && info.programs) ? info.programs.length : (mem.programs || 0),
      calls: render.calls || 0,
      triangles: render.triangles || 0,
      texMB: +estimateTextureBytes(renderer).toFixed(1),
      geoMB: +estimateGeometryBytes(renderer).toFixed(1),
      heap,
      fps: fps,
      fpsLow1: fpsLow1,
      frameMs: fpsEma ? +(1000 / fpsEma).toFixed(1) : (gfx ? gfx.avgMs : null),
      visible: wings && wings.visibility ? wings.visibility.visible : null,
      prepared: wings && wings.visibility ? wings.visibility.prepared : null,
      gpu: wings && wings.gpuResidency ? wings.gpuResidency : null,
      memoryPolicy: wings && wings.visibility && wings.visibility.memory ? wings.visibility.memory : null,
      events: log.slice(0, MAX_EVENTS_STORE).map(function (e) {
        return { kind: e.kind, msg: e.msg.slice(0, 120), t: Math.round(e.t) };
      })
    };
    // programs live on renderer.info.programs (an array) in three r187, not on info.memory.
    if (Array.isArray(info && info.programs)) lastSample.programs = info.programs.length;
    else if (Array.isArray(mem.programs)) lastSample.programs = mem.programs.length;
    try {
      // estimate() traverses the scene. Doing that on the first DONE frame
      // (and every rAF after) raced the first hall present and burned tens
      // of seconds in WebKit software GL. Wait until the first present has
      // returned, then sample at the same 500 ms cadence as the black box.
      const firstPresent = (typeof window !== 'undefined' && window.__sinFirstPresentLogged);
      const estNow = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      if (firstPresent && root.SinProcessMemory && typeof SinProcessMemory.estimate === 'function' && (estNow - lastEstimateAt >= TICK_MS)) {
        lastEstimateAt = estNow;
        const pe = SinProcessMemory.estimate({ renderer: renderer, scene: ctx.scene, phase: lastSample.phase, room: lastSample.room });
        if (pe) {
          lastSample.texMB = pe.gpuTexMB;
          lastSample.geoMB = pe.gpuGeoMB;
          lastSample.cpuMB = pe.cpuMB;
          lastSample.cpuImgMB = pe.cpuImgMB;
          lastSample.cpuGeoMB = pe.cpuGeoMB;
          lastSample.gpuMB = pe.gpuMB;
          lastSample.gpuRTMB = pe.gpuRTMB;
          lastSample.processMB = pe.processMB;
          lastSample.peakMB = (SinProcessMemory.peak() && SinProcessMemory.peak().processMB) || pe.processMB;
        }
      }
    } catch (_) {}
    return lastSample;
  }

  function persist(sampleObj) {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(sampleObj));
    } catch (_) {}
    // Compact on-device timeline: last ~30 one-second samples, so a tab
    // kill can show the 10 frames before death. localStorage survives
    // iOS Safari WebContent jetsam in the same way sessionStorage did
    // for the single-sample black box (confirmed on the user's phone).
    try {
      const now = Date.now();
      if (now - lastDiagWrite < 1000) return;
      lastDiagWrite = now;
      const snap = {
        t: now,
        phase: sampleObj.phase,
        room: sampleObj.room,
        fps: sampleObj.fps,
        tris: sampleObj.triangles,
        draws: sampleObj.calls,
        cpuMB: sampleObj.cpuMB,
        gpuMB: sampleObj.gpuMB,
        processMB: sampleObj.processMB,
        programs: sampleObj.programs,
        cityReleased: sampleObj.cityReleased,
        texMB: sampleObj.texMB,
        geo: sampleObj.geometries,
        tex: sampleObj.textures
      };
      let arr = [];
      try { arr = JSON.parse(localStorage.getItem(DIAG_KEY) || '[]'); } catch (_) { arr = []; }
      if (!Array.isArray(arr)) arr = [];
      arr.push(snap);
      if (arr.length > DIAG_MAX) arr = arr.slice(arr.length - DIAG_MAX);
      localStorage.setItem(DIAG_KEY, JSON.stringify(arr));
    } catch (_) {}
  }

  function promotePrevOnBoot() {
    try {
      const cur = sessionStorage.getItem(STORE_KEY);
      if (cur) {
        sessionStorage.setItem(PREV_KEY, cur);
        // Keep STORE_KEY until a fresh write replaces it; PREV holds the crash snapshot.
      }
    } catch (_) {}
    try {
      const tl = localStorage.getItem(DIAG_KEY);
      if (tl) {
        localStorage.setItem(DIAG_PREV, tl);
        // Fresh session starts a new timeline; PREV keeps the crash window.
        localStorage.removeItem(DIAG_KEY);
      }
    } catch (_) {}
  }

  function readDiagPrev() {
    try {
      const raw = localStorage.getItem(DIAG_PREV) || localStorage.getItem(DIAG_KEY);
      const arr = raw ? JSON.parse(raw) : null;
      return Array.isArray(arr) ? arr : null;
    } catch (_) { return null; }
  }

  function readPrev() {
    try {
      const raw = sessionStorage.getItem(PREV_KEY) || sessionStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function render(ctx) {
    if (!on) { if (el) { el.remove(); el = null; } return; }
    ensure();
    if (diagOn && el) {
      el.style.maxWidth = 'min(280px,86vw)';
      el.style.maxHeight = '40vh';
      el.style.font = '10px/1.3 ui-monospace,Menlo,monospace';
      el.style.padding = '5px 7px';
      el.style.background = 'rgba(6,10,8,.58)';
    }
    const s = sample(ctx);
    const proc = (s.processMB != null) ? (s.processMB + 'MB' + (s.peakMB != null ? (' peak ' + s.peakMB) : '')) : '';
    const cpu = (s.cpuMB != null) ? ('cpu ' + s.cpuMB + ' gpu ' + (s.gpuMB != null ? s.gpuMB : '—')) : null;
    const lines = diagOn ? [
      'DIAG ' + (s.phase || '—') + '  ' + (s.room || '—'),
      'fps ' + (s.fps != null ? s.fps : '—') + (s.fpsLow1 != null ? ('  1% ' + s.fpsLow1) : '') + '  ' + (s.frameMs != null ? (s.frameMs + 'ms') : '') + '  tris ' + ((s.triangles || 0) / 1000).toFixed(0) + 'k  draw ' + s.calls,
      'proc ' + (proc || '—') + (cpu ? ('  ' + cpu) : ''),
      'geo ' + s.geometries + '  tex ' + s.textures + '  prog ' + s.programs,
      'city ' + (s.cityReleased ? 'released' : 'out')
    ] : [
      'MEM ' + (s.phase || '—') + '  room ' + (s.room || '—'),
      'cityReleased ' + (s.cityReleased ? 'YES' : 'no') + (s.teardown != null ? '  tear ' + s.teardown : ''),
      'geo ' + s.geometries + '  tex ' + s.textures + '  prog ' + s.programs,
      'draw ' + s.calls + '  tris ' + (s.triangles / 1000).toFixed(0) + 'k',
      '~tex ' + s.texMB + 'MB  ~geo ' + s.geoMB + 'MB  ~proc ' + (s.processMB != null ? s.processMB + 'MB' : '—') + '  fps ' + (s.fps != null ? s.fps : '—'),
      heapLine(s.heap),
      'vis ' + fmtList(s.visible),
      'prep ' + fmtList(s.prepared),
      gpuLine(s.gpu),
      '— log —'
    ].concat(log.slice(0, 12).map(function (e) {
      return e.kind[0].toUpperCase() + ' ' + e.msg.slice(0, 72);
    }));
    el.textContent = lines.filter(Boolean).join('\n');
  }

  function tick(ctx) {
    const s = sample(ctx || {});
    const now = performance.now();
    if (now - lastWriteAt >= TICK_MS) {
      lastWriteAt = now;
      persist(s);
    }
    if (on) render(ctx);
    return s;
  }

  function heapLine(h) {
    if (!h) return 'heap n/a';
    return 'heap ' + h.usedMB + '/' + h.totalMB + ' MB';
  }
  function fmtList(arr) {
    if (!arr || !arr.length) return '—';
    return arr.slice(0, 10).join(',') + (arr.length > 10 ? '…' : '');
  }
  function gpuLine(g) {
    if (!g || !g.resident) return 'gpu —';
    return 'gpu g' + g.resident.geometries + ' t' + g.resident.textures + ' rel+' + (g.releasedThisSync || 0);
  }

  function showCrashReportOnStart() {
    if (crashBannerShown) return;
    const prev = readPrev();
    if (!prev || !prev.phase) return;
    // Only surface if prior session died mid-palace or with heavy load.
    const interesting = prev.phase === 'LOADING' || prev.phase === 'FADING_OUT' || prev.phase === 'SETUP' ||
      prev.phase === 'REVEAL' || prev.phase === 'FAILED' || (prev.triangles && prev.triangles > 500000) ||
      prev.cityReleased === false && (prev.phase && prev.phase !== 'IDLE' && prev.phase !== '—');
    // Always show a compact last-record strip when we have a previous snapshot.
    crashBannerShown = true;
    const host = document.getElementById('main-menu') || document.getElementById('menu-grid') || document.body;
    if (!host) return;
    let box = document.getElementById('sin-blackbox-prev');
    if (!box) {
      box = document.createElement('div');
      box.id = 'sin-blackbox-prev';
      box.style.cssText = 'margin-top:14px;padding:10px 12px;font:11px/1.4 ui-monospace,Menlo,monospace;color:#f0e2c8;background:rgba(40,12,10,.72);border:1px solid rgba(220,120,80,.55);white-space:pre-wrap;max-width:min(440px,92vw);text-align:left;direction:ltr';
      const col = host.querySelector && host.querySelector('.menu-column');
      (col || host).appendChild(box);
    }
    const ev = (prev.events || []).slice(0, 8).map(function (e) {
      return '  ' + (e.kind || '?') + ': ' + (e.msg || '');
    }).join('\n');
    const diag = readDiagPrev();
    const lastN = (diag && diag.length) ? diag.slice(-10) : [];
    const diagLines = lastN.map(function (s, i) {
      const mb = (s.processMB != null) ? (s.processMB + 'MB') : ((s.cpuMB != null || s.gpuMB != null) ? (('c' + (s.cpuMB || 0) + '+g' + (s.gpuMB || 0)) + 'MB') : '');
      return '  ' + (i + 1) + ' ' + (s.phase || '—') + ' ' + (s.room || '') +
        ' fps ' + (s.fps != null ? s.fps : '—') +
        ' tris ' + ((s.tris || 0) / 1000).toFixed(0) + 'k' +
        ' draw ' + (s.draws != null ? s.draws : '—') +
        ' ' + mb +
        ' p' + (s.programs != null ? s.programs : '—');
    });
    box.textContent = [
      'LAST SESSION (black box)',
      'phase ' + prev.phase + '  room ' + (prev.room || '—') + '  cityReleased ' + (prev.cityReleased ? 'YES' : 'no'),
      'geo ' + prev.geometries + '  tex ' + prev.textures + '  prog ' + prev.programs,
      'draw ' + prev.calls + '  tris ' + ((prev.triangles || 0) / 1000).toFixed(0) + 'k  ~tex ' + prev.texMB + 'MB' +
        (prev.processMB != null ? ('  ~proc ' + prev.processMB + 'MB') : '') +
        (prev.cpuMB != null ? ('  cpu ' + prev.cpuMB + 'MB') : ''),
      'fps ' + (prev.fps != null ? prev.fps : '—') + (prev.teardown != null ? '  teardownPhase ' + prev.teardown : ''),
      interesting ? '⚠ prior session looked like a crash mid-entry' : 'prior session snapshot',
      ev ? ('events:\n' + ev) : '',
      lastN.length ? ('last ' + lastN.length + ' samples before death:\n' + diagLines.join('\n')) : ''
    ].filter(Boolean).join('\n');
  }

  // On boot: promote last live record to "previous" so a reload shows the crash frame.
  promotePrevOnBoot();

  const api = {
    set(v) { on = !!v; if (!on && el) { el.remove(); el = null; } },
    toggle() { api.set(!on); return on; },
    on() { return on; },
    note: push,
    sample,
    render,
    tick,
    reportHeaviest,
    heaviest() { return heaviestByPhase; },
    showCrashReportOnStart,
    readPrev,
    readDiagPrev,
    log() { return log.slice(); },
    last() { return lastSample; },
    diagOn() { return diagOn; }
  };
  root.SinMemoryOverlay = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        setTimeout(function () { try { api.showCrashReportOnStart(); } catch (_) {} }, 50);
      });
    } else {
      setTimeout(function () { try { api.showCrashReportOnStart(); } catch (_) {} }, 50);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
