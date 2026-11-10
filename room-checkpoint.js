/* Sîn — Room streaming crash recovery (Phase 5).
   Saves room + hero + open doors to localStorage on every room enter.
   Restores after Safari kills the tab or WebGL context is lost.
   Kill switch: ?checkpoint=0 */
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  if (params.get('checkpoint') === '0') { window.SinRoomCheckpoint = null; return; }

  var KEY = 'sin.roomStream.v1';
  var lastSaved = null;
  var restorePending = null;
  var contextHooked = false;

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return null;
      return data;
    } catch (_) { return null; }
  }

  function write(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      lastSaved = data;
      return true;
    } catch (_) { return false; }
  }

  function openDoorIds() {
    var wings = window.PalaceWings && window.PalaceWings.state;
    if (!wings || !wings.doors) return [];
    return wings.doors.filter(function (d) {
      return d && d.kind !== 'arch' && (d.state === 'Open' || d.state === 'Opening');
    }).map(function (d) { return d.id; });
  }

  function save(ctx) {
    if (!ctx || !ctx.hero) return null;
    var room = (window.PalaceWings && window.PalaceWings.state && window.PalaceWings.state.current) || 'Palace';
    var p = ctx.hero.position;
    var data = {
      v: 1,
      t: Date.now(),
      room: room,
      x: +p.x.toFixed(3),
      y: +p.y.toFixed(3),
      z: +p.z.toFixed(3),
      yaw: typeof ctx.getFacing === 'function' ? +Number(ctx.getFacing()).toFixed(4) : null,
      doors: openDoorIds()
    };
    write(data);
    return data;
  }

  function applyDoors(ids) {
    var wings = window.PalaceWings && window.PalaceWings.state;
    if (!wings || !wings.doors || !ids || !ids.length) return;
    var want = new Set(ids);
    wings.doors.forEach(function (d) {
      if (!d || d.kind === 'arch' || !want.has(d.id)) return;
      d.state = 'Open';
      if (typeof d.openness === 'number') d.openness = 1;
      if (d.mixer && d.clip && d.action) {
        try {
          d.action.reset();
          d.action.time = d.clip.duration || 0;
          d.action.paused = true;
          d.mixer.update(0);
        } catch (_) { /* decorative */ }
      }
    });
  }

  function restore(ctx) {
    var data = restorePending || read();
    if (!data || !ctx || !ctx.hero) return false;
    restorePending = data;
    if (!(window.PalaceWings && window.PalaceWings.state && window.PalaceWings.state.built)) return false;
    ctx.hero.position.set(data.x, data.y, data.z);
    if (data.yaw != null && typeof ctx.setFacing === 'function') ctx.setFacing(data.yaw);
    applyDoors(data.doors || []);
    if (window.SinRoomMetrics && typeof window.SinRoomMetrics.noteRoom === 'function') {
      window.SinRoomMetrics.noteRoom(data.room || 'Palace', ctx.renderer);
    }
    try { console.info('[room-checkpoint] restored', data.room, data.x, data.z); } catch (_) {}
    restorePending = null;
    return true;
  }

  function hookContext(renderer) {
    if (contextHooked || !renderer || !renderer.getContext) return;
    var gl = renderer.getContext();
    if (!gl || !gl.canvas) return;
    contextHooked = true;
    gl.canvas.addEventListener('webglcontextlost', function (e) {
      if (e && e.preventDefault) e.preventDefault();
      restorePending = read() || lastSaved;
      try { console.warn('[room-checkpoint] webglcontextlost — will restore current room only'); } catch (_) {}
    }, false);
    gl.canvas.addEventListener('webglcontextrestored', function () {
      try { console.info('[room-checkpoint] webglcontextrestored'); } catch (_) {}
      // Re-warm only the player's current room through existing wing streaming.
      if (window.PalaceWings && window.PalaceWings.state) {
        window.PalaceWings.state._preparedKey = '';
        if (window.PalaceWings.tick && lastContext) {
          // tick path will re-classify and dress the active room
        }
      }
      if (lastContext) restore(lastContext);
    }, false);
  }

  var lastContext = null;
  function noteContext(ctx) {
    lastContext = ctx || lastContext;
    if (ctx && ctx.renderer) hookContext(ctx.renderer);
  }

  // Seed restore intent from a previous session as soon as the module loads.
  restorePending = read();

  window.SinRoomCheckpoint = {
    save: save,
    restore: restore,
    read: read,
    noteContext: noteContext,
    pending: function () { return restorePending; },
    clear: function () { try { localStorage.removeItem(KEY); } catch (_) {} restorePending = null; lastSaved = null; }
  };
})();
