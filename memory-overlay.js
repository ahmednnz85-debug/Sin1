/* Toggleable memory / residency diagnostic overlay (?mem=1 or Settings).
   Screenshot-friendly: phase, room, renderer.info, estimated GPU costs, event log. */
(function (root) {
  'use strict';
  const MAX_LOG = 40;
  const log = [];
  let el = null;
  let on = /(?:[?&](?:mem|perf)\b)/.test(location.search) || false;
  let lastSample = null;

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
    // Rough: count textures × assume 1024² RGBA mipmapped ≈ 5.3 MB if unknown.
    const n = renderer && renderer.info && renderer.info.memory ? renderer.info.memory.textures : 0;
    return n * 2.5; // MB estimate (conservative average for game textures)
  }

  function estimateGeometryBytes(renderer) {
    const n = renderer && renderer.info && renderer.info.memory ? renderer.info.memory.geometries : 0;
    return n * 0.15; // MB estimate
  }

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
    lastSample = {
      phase: (palace && palace.phase) || (ctx.phase) || (document.body.dataset.sinPhase) || '—',
      room: (wings && wings.current) || (palace && palace.room) || '—',
      cityReleased: !!(ctx.scene && ctx.scene.userData && ctx.scene.userData.cityReleased),
      geometries: mem.geometries || 0,
      textures: mem.textures || 0,
      programs: mem.programs || 0,
      calls: render.calls || 0,
      triangles: render.triangles || 0,
      texMB: +estimateTextureBytes(renderer).toFixed(1),
      geoMB: +estimateGeometryBytes(renderer).toFixed(1),
      heap,
      fps: gfx && gfx.avgMs ? +(1000 / Math.max(1, gfx.avgMs)).toFixed(0) : null,
      frameMs: gfx ? gfx.avgMs : null,
      visible: wings && wings.visibility ? wings.visibility.visible : null,
      prepared: wings && wings.visibility ? wings.visibility.prepared : null,
      gpu: wings && wings.gpuResidency ? wings.gpuResidency : null,
      memoryPolicy: wings && wings.visibility && wings.visibility.memory ? wings.visibility.memory : null
    };
    return lastSample;
  }

  function render(ctx) {
    if (!on) { if (el) { el.remove(); el = null; } return; }
    ensure();
    const s = sample(ctx);
    const lines = [
      'MEM ' + (s.phase || '—') + '  room ' + (s.room || '—'),
      'cityReleased ' + (s.cityReleased ? 'YES' : 'no'),
      'geo ' + s.geometries + '  tex ' + s.textures + '  prog ' + s.programs,
      'draw ' + s.calls + '  tris ' + (s.triangles / 1000).toFixed(0) + 'k',
      '~tex ' + s.texMB + 'MB  ~geo ' + s.geoMB + 'MB',
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

  const api = {
    set(v) { on = !!v; if (!on && el) { el.remove(); el = null; } },
    toggle() { api.set(!on); return on; },
    on() { return on; },
    note: push,
    sample,
    render,
    log() { return log.slice(); },
    last() { return lastSample; }
  };
  root.SinMemoryOverlay = api;
})(typeof window !== 'undefined' ? window : globalThis);
