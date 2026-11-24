/* SÎN — PalaceRoomManager: one coordinator for the 14 palace rooms.
   ---------------------------------------------------------------------------
   It does NOT own memory or GPU uploads (zone-streamer.js stays the single
   owner of load / upload / compile / reveal / eviction). It owns the
   *decisions*, and they are made from WALKING DISTANCE only:

     - every streamed room gets a load radius from the hero's running speed
       and the room's measured preparation time (it is ready before the hero
       can reach its doorway) and a larger release radius (hysteresis);
     - rooms inside the load radius are requested nearest first, rooms
       between the two radii stay resident, rooms beyond the release radius
       are unloaded — and come back the same way before the hero returns;
     - the camera never starts or stops a load (what it can see is only
       reported for diagnostics; drawn rooms are protected by the streamer);
     - visibility hysteresis: a room the camera just stopped seeing keeps
       drawing for a short linger window, and the room the hero or the
       camera stands in is always drawn;
     - a per-room lifecycle state for diagnostics:
         UNLOADED -> PREPARING -> READY -> ACTIVE / VISIBLE -> COOLDOWN.

   Pure logic (no THREE) apart from the optional debug overlay, so it is
   unit-tested in Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SinPalaceRoomManager = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const STATES = ['UNLOADED', 'PREPARING', 'READY', 'ACTIVE', 'VISIBLE', 'COOLDOWN'];
  const PREPARING = new Set(['loading', 'uploading', 'compiling']);

  function create(options) {
    const o = Object.assign({
      streamed: new Set(),
      constrained: false,
      lingerMs: 450,           // keep drawing a room this long after the camera left it
      // ---- distance planning (metres along the walkable route) ----------
      // A room starts preparing when the hero could reach its doorway in
      // less time than the room needs to prepare, at full running speed:
      //   load radius = runSpeed x (preparation s + leadPadSec) + doorMarginM
      // and is unloaded once the hero is farther than the load radius plus
      // hysteresisM (no load/unload flapping on a radius line).
      runSpeed: 9.5,           // m/s: the hero's run clip (fastest approach on foot)
      leadPadSec: 1.0,
      doorMarginM: 4,
      minLoadM: 22,
      maxLoadM: 75,
      hysteresisM: 18
    }, options || {});
    const lastShown = new Map();     // id -> ms last drawn
    const lastSight = new Map();     // id -> ms last geometrically visible (diagnostics only)
    const states = new Map();
    const transitions = [];
    let last = null, lastSpeed = 0;

    function setState(id, next, t) {
      const prev = states.get(id);
      if (prev === next) return;
      states.set(id, next);
      transitions.push({ id, from: prev || null, to: next, t: Math.round(t) });
      if (transitions.length > 64) transitions.shift();
    }
    let pvsCache = null, seenCache = null;
    function seenFromOf(pvs) {
      if (!pvs) return null;
      if (pvs === pvsCache) return seenCache;
      const inv = new Map();
      pvs.forEach((set, region) => set.forEach(id => {
        if (id === region || !o.streamed.has(id)) return;
        if (!inv.has(id)) inv.set(id, []);
        inv.get(id).push(region);
      }));
      pvsCache = pvs; seenCache = inv;
      return inv;
    }
    function loadRadius(id, leadSec) {
      const lead = Math.max(0, Number(leadSec(id)) || 0);
      return Math.max(o.minLoadM, Math.min(o.maxLoadM, o.runSpeed * (lead + o.leadPadSec) + o.doorMarginM));
    }

    /* input = {
         now, heroRegion, camRegion, origin,
         motion: {vx, vz},
         drawn: Set   — rooms the portal culling decided to draw this frame,
         sight: Set   — regions geometrically visible through open portals
                        (reported for diagnostics; it never starts a load),
         distances: Map id->metres walking distance from the hero to every
                    region's doorway (0 inside it),
         pvs: Map region -> Set of regions visible from it (static, optional),
         status(id) -> zone-streamer state, leadSec(id) -> seconds to prepare,
         memoryLevel
       } */
    function update(input) {
      const t = Number.isFinite(input.now) ? input.now : 0;
      const status = input.status || (() => 'unregistered');
      const ready = id => { const s = status(id); return s === 'ready' || s === 'unregistered'; };
      const distances = input.distances || new Map();
      const motion = input.motion || { vx: 0, vz: 0 };
      lastSpeed = Math.hypot(motion.vx || 0, motion.vz || 0);
      const leadSec = input.leadSec || (() => 5);

      // ---- visibility with hysteresis (rendering only) --------------------
      const shown = new Set(input.drawn || []);
      // Whatever the hero or the camera stands in is always drawn.
      for (const id of [input.heroRegion, input.camRegion, input.origin]) if (id) shown.add(id);
      shown.forEach(id => lastShown.set(id, t));
      const lingering = new Set();
      lastShown.forEach((at, id) => {
        if (shown.has(id)) return;
        if (t - at <= o.lingerMs && ready(id)) { shown.add(id); lingering.add(id); }
        else if (t - at > o.lingerMs * 4) lastShown.delete(id);
      });
      (input.sight || []).forEach(id => { if (o.streamed.has(id)) lastSight.set(id, t); });
      const observed = [];
      lastSight.forEach((at, id) => { if (t - at > 4000) lastSight.delete(id); else observed.push(id); });

      // ---- distance planning: the camera never decides what loads ---------
      const approach = new Set(), keep = new Set(), rank = new Map(), radius = new Map();
      const metres = id => id === input.origin ? 0 : (distances.has(id) ? distances.get(id) : Infinity);
      // A room counts as near as the nearest spot it can be SEEN from: with
      // the potentially visible set (static, per region), a room seen down
      // an open passage is prepared before the hero reaches that passage.
      const seenFrom = seenFromOf(input.pvs);
      const sightMetres = id => {
        let d = metres(id);
        const from = seenFrom && seenFrom.get(id);
        if (from) from.forEach(r => { const m = metres(r); if (m < d) d = m; });
        return d;
      };
      o.streamed.forEach(id => {
        const d = sightMetres(id);
        if (!Number.isFinite(d)) return;
        const r = loadRadius(id, leadSec);
        radius.set(id, r);
        if (d <= r + o.hysteresisM) { keep.add(id); rank.set(id, d); }
        if (d <= r) approach.add(id);
      });

      // ---- lifecycle states ------------------------------------------------
      const active = new Set([input.origin, input.heroRegion].filter(Boolean));
      shown.forEach(id => active.add(id));
      o.streamed.forEach(id => {
        const s = status(id);
        let next;
        if (s === 'cold' || s === 'failed' || s === 'unregistered') next = 'UNLOADED';
        else if (PREPARING.has(s)) next = 'PREPARING';
        else if (shown.has(id)) next = 'VISIBLE';
        else if (active.has(id) || approach.has(id)) next = 'ACTIVE';
        else if (keep.has(id)) next = 'COOLDOWN';
        else next = 'READY';
        setState(id, next, t);
      });

      // retained: hard eviction protection is the streamer's job (drawn,
      // current, moving doors); the planner only orders and bounds.
      last = { shown, lingering, sight: new Set(), observed, approach, retained: new Set(), keep, rank, radius, t };
      return last;
    }

    function report() {
      const out = {};
      states.forEach((s, id) => { out[id] = s; });
      return {
        states: out,
        shown: last ? Array.from(last.shown) : [],
        lingering: last ? Array.from(last.lingering) : [],
        sight: last ? Array.from(last.observed) : [],
        approach: last ? Array.from(last.approach) : [],
        retained: last ? Array.from(last.retained) : [],
        cooldown: last ? Array.from(last.keep).filter(id => !last.approach.has(id)) : [],
        radius: last ? Object.fromEntries(Array.from(last.radius, ([k, v]) => [k, Math.round(v)])) : {},
        metres: last ? Object.fromEntries(Array.from(last.rank, ([k, v]) => [k, Math.round(v)])) : {},
        speed: +lastSpeed.toFixed(2),
        transitions: transitions.slice(-16)
      };
    }
    function reset() { lastShown.clear(); lastSight.clear(); states.clear(); transitions.length = 0; last = null; }
    return { update, report, reset, options: o, state: id => states.get(id) || 'UNLOADED' };
  }

  // ---- frame statistics (P50 / P95 / P99) ---------------------------------
  function frameStats(size) {
    const buf = new Float32Array(size || 600);
    let n = 0, i = 0;
    return {
      push(ms) { if (!(ms > 0) || ms > 2000) return; buf[i] = ms; i = (i + 1) % buf.length; if (n < buf.length) n++; },
      summary() {
        if (!n) return { p50: 0, p95: 0, p99: 0, fps: 0, n: 0 };
        const a = Array.from(buf.subarray(0, n)).sort((x, y) => x - y);
        const q = p => a[Math.min(n - 1, Math.floor(p * n))];
        const mean = a.reduce((s, v) => s + v, 0) / n;
        return { p50: q(.5), p95: q(.95), p99: q(.99), fps: 1000 / mean, n };
      },
      reset() { n = 0; i = 0; }
    };
  }

  // ---- optional debug overlay (?roomdebug=1) -------------------------------
  function overlay(doc) {
    if (!doc || !doc.createElement) return null;
    const el = doc.createElement('pre');
    el.id = 'palace-room-debug';
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:60;margin:0;padding:6px 8px;' +
      'font:11px/1.35 ui-monospace,Menlo,monospace;color:#f3e3c3;background:rgba(10,8,6,.78);' +
      'border:1px solid rgba(225,183,111,.4);pointer-events:none;white-space:pre;max-width:46vw;direction:ltr';
    doc.body.appendChild(el);
    let at = 0;
    return {
      draw(now, data) {
        if (now - at < 400) return;
        at = now;
        const f = data.frame || {}, r = data.rooms || {}, z = data.zones || {};
        const queue = Object.entries(z.zones || {}).filter(([, v]) => PREPARING.has(v.state)).map(([k, v]) => k + ':' + v.state[0]);
        const ready = Object.entries(z.zones || {}).filter(([, v]) => v.state === 'ready').map(([k]) => k);
        const timings = Object.entries(z.zones || {}).filter(([, v]) => v.timing && v.timing.totalMs)
          .map(([k, v]) => k + ' ' + v.timing.assetsMs + '/' + v.timing.uploadMs + '/' + v.timing.compileMs);
        el.textContent = [
          'Room ' + (data.current || '-') + '  speed ' + (r.speed || 0) + ' m/s',
          'Visible  ' + (r.shown || []).join(' '),
          'Ready    ' + ready.join(' '),
          'Loading  ' + (queue.join(' ') || '-') + '   sight ' + ((r.sight || []).join(' ') || '-'),
          'Prefetch ' + ((r.approach || []).join(' ') || '-') + '   cool ' + ((r.cooldown || []).join(' ') || '-'),
          'FPS ' + (f.fps || 0).toFixed(1) + '  P50 ' + (f.p50 || 0).toFixed(1) + '  P95 ' + (f.p95 || 0).toFixed(1) + '  P99 ' + (f.p99 || 0).toFixed(1) + ' ms',
          'CPU(js) ' + (data.cpuMs || 0).toFixed(2) + ' ms  GPU ' + (data.gpuMs != null ? data.gpuMs.toFixed(2) + ' ms' : 'n/a'),
          'Calls ' + (data.calls || 0) + '  Tris ' + (data.tris || 0) + '  Heap ' + (data.heapMB || 'n/a') + ' MB',
          'Textures ' + (data.textures || 0) + '  Geometries ' + (data.geometries || 0),
          'Prep ms (assets/upload/compile): ' + (timings.join('  ') || '-')
        ].join('\n');
      },
      dispose() { el.remove(); }
    };
  }

  return { create, frameStats, overlay, STATES };
});
