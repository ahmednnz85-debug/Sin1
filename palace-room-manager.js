/* SÎN — PalaceRoomManager: one coordinator for the 14 palace rooms.
   ---------------------------------------------------------------------------
   It does NOT own memory or GPU uploads (zone-streamer.js stays the single
   owner of load / upload / compile / reveal / eviction). It owns the
   *decisions* that used to be scattered across wings.js:

     - which streamed rooms are needed NOW because the camera can already
       look at them through physically open arches (sight demand),
     - which rooms must be prepared next from the room connectivity graph,
       the player's walking distance, speed and heading (prefetch),
     - which rooms recently left stay resident for a while (cooldown) so a
       turn-back never reloads them,
     - visibility hysteresis: a room the camera just stopped seeing keeps
       drawing for a short linger window, and the room the hero or the
       camera stands in is always drawn (no wall / floor dropping out while
       the camera swings around a doorway),
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
      cooldownMs: 30000,       // keep a left room resident this long (desktop)
      prefetchMetres: 42,      // walking distance inside which rooms are prepared (desktop)
      leadPadSec: 1.6,         // extra time on top of a room's measured preparation time
      sightHoldMs: 4000,       // a room seen through an arch stays urgent this long (camera swings)
      maxPrefetch: 4           // most rooms requested ahead at once (desktop)
    }, options || {});
    if (o.constrained) {
      // A 650 MB phone cannot stack rooms: the streamer swaps instead. Ask
      // for one predicted room at a time and keep no cooldown residency.
      o.cooldownMs = Math.min(o.cooldownMs, options && options.cooldownMs != null ? options.cooldownMs : 0);
      // Distance prefetch is off: every speculative start swaps the other
      // rooms out under the no-stack rule (measured: more reloads, longer
      // door waits). Heading prediction + sight demand only.
      o.maxPrefetch = 0;
      o.prefetchMetres = 0;
    }
    const lastShown = new Map();     // id -> ms last drawn
    const lastSight = new Map();     // id -> ms last geometrically visible
    const lastActive = new Map();    // id -> ms last current/visible (for cooldown)
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

    /* input = {
         now, heroRegion, camRegion, origin,
         motion: {vx, vz},
         drawn: Set   — rooms the portal culling decided to draw this frame,
         sight: Set   — regions geometrically visible through physically open
                        portals, ignoring readiness (what the player WOULD see),
         predicted: Iterable — heading-based next rooms from palace-routes,
         distances: Map id->metres walking distance from the hero,
         status(id) -> zone-streamer state, leadSec(id) -> seconds to prepare,
         memoryLevel: 'normal' | 'watch' | 'critical'
       } */
    function update(input) {
      const t = Number.isFinite(input.now) ? input.now : 0;
      const status = input.status || (() => 'unregistered');
      const ready = id => { const s = status(id); return s === 'ready' || s === 'unregistered'; };
      const distances = input.distances || new Map();
      const level = input.memoryLevel || 'normal';
      const motion = input.motion || { vx: 0, vz: 0 };
      const speed = Math.hypot(motion.vx || 0, motion.vz || 0);
      lastSpeed = speed;

      // ---- visibility with hysteresis -------------------------------------
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

      // ---- sight demand: rooms the camera can look into right now ---------
      // Sticky: a quick camera swing away from an arch must not demote a
      // room that is mid-preparation (it would be evicted and restarted).
      (input.sight || []).forEach(id => { if (o.streamed.has(id)) lastSight.set(id, t); });
      const sight = new Set();
      lastSight.forEach((at, id) => {
        if (t - at > o.sightHoldMs) { lastSight.delete(id); return; }
        if (!ready(id)) sight.add(id);
      });
      let sightList = Array.from(sight).sort((a, b) => (distances.get(a) ?? 999) - (distances.get(b) ?? 999));
      // A 650 MB phone holds one dressed room at a time: sight-driven loads
      // only swap rooms back and forth there (measured: +18% reloads, longer
      // door waits). Its sealed portals keep the placeholder until the
      // heading prediction brings the room in.
      const observed = sightList;
      if (o.constrained) sightList = [];

      // ---- prefetch: graph distance + speed + heading ---------------------
      const approach = new Set();
      for (const id of input.predicted || []) if (id && o.streamed.has(id)) approach.add(id);
      const leadSec = input.leadSec || (() => 5);
      const candidates = [];
      o.streamed.forEach(id => {
        if (id === input.origin || approach.has(id) || sight.has(id)) return;
        const d = distances.get(id);
        if (d == null) return;
        // Reachable before preparation could finish at the current pace?
        const reach = speed * (leadSec(id) + o.leadPadSec) + 6;
        if (o.maxPrefetch > 0 && d <= Math.max(o.prefetchMetres, reach)) candidates.push({ id, d });
      });
      candidates.sort((a, b) => a.d - b.d);
      const room = Math.max(0, o.maxPrefetch - approach.size);
      // Speculative (distance) prefetch never competes with a room the
      // camera already sees or the player is predicted to enter next.
      const urgentPending = sightList.length > 0 || Array.from(approach).some(id => !ready(id)) ||
        (!!input.origin && o.streamed.has(input.origin) && !ready(input.origin));
      // On a constrained device only start a distance prefetch while no
      // predicted room is already asked for (no-stack swap rule).
      if (!(o.constrained && approach.size)) {
        candidates.slice(0, room).forEach(c => { if (!urgentPending || ready(c.id)) approach.add(c.id); });
      }
      // Under critical memory pressure keep only the heading prediction;
      // the streamer's budget still has the final word on every start.
      if (level === 'critical') {
        approach.clear();
        for (const id of input.predicted || []) if (id && o.streamed.has(id)) approach.add(id);
      }

      // ---- cooldown residency ---------------------------------------------
      const active = new Set([input.origin, input.heroRegion].filter(Boolean));
      shown.forEach(id => active.add(id));
      active.forEach(id => { if (o.streamed.has(id) && ready(id)) lastActive.set(id, t); });
      // Sight rooms are protected (the camera is about to show them).
      // Cooldown rooms are only *kept*: they stay resident while memory
      // allows but yield to any more important room under the budget.
      const retained = new Set(sightList);
      const keep = new Set();
      if (level === 'normal' && o.cooldownMs > 0) {
        lastActive.forEach((at, id) => {
          if (active.has(id)) return;
          if (t - at <= o.cooldownMs && status(id) !== 'cold') keep.add(id);
        });
      }
      // Budget rank for the streamer: sight 1, predicted 2, prefetch 3, cooldown 4.
      const rank = new Map();
      keep.forEach(id => rank.set(id, 4));
      approach.forEach(id => rank.set(id, 3));
      for (const id of input.predicted || []) if (approach.has(id)) rank.set(id, 2);
      sightList.forEach(id => rank.set(id, 1));
      lastActive.forEach((at, id) => { if (t - at > Math.max(o.cooldownMs, 1) * 2) lastActive.delete(id); });

      // ---- lifecycle states ------------------------------------------------
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

      last = { shown, lingering, sight: new Set(sightList), observed, approach, retained, keep, rank, t };
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
        cooldown: last ? Array.from(last.keep) : [],
        speed: +lastSpeed.toFixed(2),
        transitions: transitions.slice(-16)
      };
    }
    function reset() { lastShown.clear(); lastActive.clear(); states.clear(); transitions.length = 0; last = null; }
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
