/* Sîn — Room streaming metrics (Phase 0).
   Small always-on overlay for Safari memory/FPS audits.
   Kill switch: ?metrics=0
   Force on:    ?metrics=1  (also default when ?roomstream is present) */
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var forcedOff = params.get('metrics') === '0';
  var forcedOn = params.get('metrics') === '1' || params.has('roomstream');
  if (forcedOff) { window.SinRoomMetrics = null; return; }

  var enabled = forcedOn || params.get('metrics') !== '0';
  // Default ON for the room-streaming workstream so iPhone Safari can measure
  // without digging through Settings. Use ?metrics=0 to hide.
  if (!forcedOn && !forcedOff) enabled = true;

  var el = null;
  var frames = [];
  var lastPaint = 0;
  var lastFps = 0;
  var lastSample = null;
  var currentRoom = '—';
  var log = [];
  var MAX_LOG = 80;
  var rendererRef = null;
  var rafBound = false;

  function ensurePanel() {
    if (!enabled || el) return;
    el = document.createElement('div');
    el.id = 'sin-room-metrics';
    el.setAttribute('aria-live', 'polite');
    el.style.cssText = [
      'position:fixed',
      'z-index:60',
      'left:calc(8px + env(safe-area-inset-left,0px))',
      'bottom:calc(8px + env(safe-area-inset-bottom,0px))',
      'padding:6px 8px',
      'font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace',
      'color:#f2e2c2',
      'background:rgba(10,8,6,.72)',
      'border:1px solid rgba(225,183,111,.45)',
      'border-radius:4px',
      'pointer-events:none',
      'white-space:pre',
      'max-width:min(92vw,280px)'
    ].join(';');
    (document.body || document.documentElement).appendChild(el);
  }

  function readInfo(renderer) {
    var r = renderer || rendererRef;
    var mem = (r && r.info && r.info.memory) || {};
    var ren = (r && r.info && r.info.render) || {};
    return {
      geometries: mem.geometries || 0,
      textures: mem.textures || 0,
      calls: ren.calls || 0,
      triangles: ren.triangles || 0
    };
  }

  function sample(renderer, roomId, fps) {
    var info = readInfo(renderer);
    var s = {
      t: Date.now(),
      room: roomId != null ? roomId : currentRoom,
      fps: Number.isFinite(fps) ? fps : lastFps,
      geometries: info.geometries,
      textures: info.textures,
      calls: info.calls,
      triangles: info.triangles
    };
    lastSample = s;
    return s;
  }

  function format(s) {
    if (!s) return 'Room metrics…';
    return [
      'Room  ' + s.room,
      'FPS   ' + (s.fps ? s.fps.toFixed(0) : '—'),
      'Geo   ' + s.geometries + '   Tex ' + s.textures,
      'Draw  ' + s.calls + '   Tri ' + Math.round(s.triangles / 1000) + 'k'
    ].join('\n');
  }

  function paint(ts) {
    if (!enabled) return;
    ensurePanel();
    frames.push(ts);
    while (frames.length && ts - frames[0] > 1000) frames.shift();
    if (frames.length > 1) lastFps = (frames.length - 1) * 1000 / (ts - frames[0]);
    if (ts - lastPaint < 250) return;
    lastPaint = ts;
    var s = sample(rendererRef, currentRoom, lastFps);
    if (el) el.textContent = format(s);
  }

  function bindRaf() {
    if (rafBound) return;
    rafBound = true;
    var tick = function (ts) {
      paint(ts);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function pushLog(kind, room, snap) {
    var row = {
      kind: kind,
      room: room,
      fps: +(snap.fps || 0).toFixed(1),
      geometries: snap.geometries,
      textures: snap.textures,
      calls: snap.calls,
      triangles: snap.triangles,
      t: snap.t
    };
    log.push(row);
    if (log.length > MAX_LOG) log.shift();
    try {
      console.info('[room-metrics]', kind, room, {
        fps: row.fps,
        geometries: row.geometries,
        textures: row.textures,
        calls: row.calls,
        triangles: row.triangles
      });
    } catch (_) { /* ignore */ }
    return row;
  }

  function noteRoom(roomId, renderer) {
    if (!enabled) return null;
    if (renderer) rendererRef = renderer;
    ensurePanel();
    bindRaf();
    var next = roomId == null ? '—' : String(roomId);
    if (next === currentRoom) {
      return sample(rendererRef, currentRoom, lastFps);
    }
    var before = sample(rendererRef, currentRoom, lastFps);
    if (currentRoom && currentRoom !== '—') pushLog('exit', currentRoom, before);
    currentRoom = next;
    var after = sample(rendererRef, currentRoom, lastFps);
    pushLog('enter', currentRoom, after);
    if (el) el.textContent = format(after);
    return after;
  }

  function attachRenderer(renderer) {
    if (renderer) rendererRef = renderer;
    if (enabled) { ensurePanel(); bindRaf(); }
  }

  function setEnabled(on) {
    enabled = !!on;
    if (!enabled) {
      if (el) { el.remove(); el = null; }
      return;
    }
    ensurePanel();
    bindRaf();
  }

  window.SinRoomMetrics = {
    noteRoom: noteRoom,
    attachRenderer: attachRenderer,
    sample: function () { return sample(rendererRef, currentRoom, lastFps); },
    log: function () { return log.slice(); },
    currentRoom: function () { return currentRoom; },
    enabled: function () { return enabled; },
    setEnabled: setEnabled,
    format: format
  };

  if (enabled) {
    if (document.body) { ensurePanel(); bindRaf(); }
    else document.addEventListener('DOMContentLoaded', function () { ensurePanel(); bindRaf(); });
  }
})();
