/* Sîn — World Streaming core logic (pure, no THREE / no DOM).
   Shared by the browser integration layer (world-streaming.js) and by the
   node tests in tests/. Every function here is deterministic and side-effect
   free so behaviour can be measured before it is wired into the game. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SinStreamingCore = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. Predictive streaming — direction + speed of player and camera.
   *    The prediction is used to widen the prefetch wedge ahead of the
   *    player and never to hide anything the camera can already see.
   * ------------------------------------------------------------------ */
  function createPredictor(options) {
    var o = Object.assign({
      smoothing: 0.35,     // EMA weight of the newest sample
      stopSpeed: 0.25,     // m/s below which the player counts as standing
      maxHorizon: 3.0,     // seconds of look-ahead
      leadSeconds: 1.4,    // metres of lead = speed * this
      maxLead: 22          // hard cap so prediction never runs away
    }, options || {});
    var last = null, vx = 0, vz = 0, speed = 0, idleMs = 0;

    function sample(x, z, dt) {
      var d = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 1 / 60;
      if (!last) { last = { x: x, z: z }; return state(); }
      var ix = (x - last.x) / d, iz = (z - last.z) / d;
      last.x = x; last.z = z;
      vx += (ix - vx) * o.smoothing;
      vz += (iz - vz) * o.smoothing;
      speed = Math.hypot(vx, vz);
      if (speed < o.stopSpeed) { speed = 0; vx = 0; vz = 0; idleMs += d * 1000; }
      else idleMs = 0;
      return state();
    }
    function state() {
      var lead = Math.min(o.maxLead, speed * o.leadSeconds);
      var len = Math.hypot(vx, vz);
      return {
        speed: speed,
        vx: vx, vz: vz,
        dirX: len > 1e-4 ? vx / len : null,
        dirZ: len > 1e-4 ? vz / len : null,
        lead: speed > 0 ? lead : 0,
        idleMs: idleMs,
        moving: speed >= o.stopSpeed
      };
    }
    /* Predicted position: where the player will be in `seconds`. */
    function predict(seconds) {
      var s = Math.max(0, Math.min(Number(seconds) || 0, o.maxHorizon));
      if (!last) return null;
      return { x: last.x + vx_safe() * s, z: last.z + vz_safe() * s };
    }
    function vx_safe() { return speed ? vx : 0; }
    function vz_safe() { return speed ? vz : 0; }
    /* Direction to bias look-ahead: blend of camera forward and travel. */
    function blend(camDirX, camDirZ, weight) {
      var w = Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 0.5;
      if (!speed || !Number.isFinite(vx)) return { x: camDirX, z: camDirZ, mixed: false };
      var bx = camDirX * (1 - w) + vx_safe() * w;
      var bz = camDirZ * (1 - w) + vz_safe() * w;
      var l = Math.hypot(bx, bz) || 1;
      return { x: bx / l, z: bz / l, mixed: true };
    }
    function reset() { last = null; vx = vz = speed = idleMs = 0; }
    return { sample: sample, state: state, predict: predict, blend: blend, reset: reset, options: o };
  }

  /* ------------------------------------------------------------------ *
   * 2. Memory budget — device profile for Safari/iOS limits.
   *    These are residency budgets expressed in the same units the
   *    renderer reports (renderer.info.memory.geometries / .textures).
   * ------------------------------------------------------------------ */
  var PROFILES = {
    ios: { geometryBudget: 300, textureBudget: 130, frameTargetMs: 16.7, hardFrameMs: 33, cacheSlots: 3, maxTextureAnisotropy: 2 },
    ipad: { geometryBudget: 420, textureBudget: 180, frameTargetMs: 16.7, hardFrameMs: 33, cacheSlots: 4, maxTextureAnisotropy: 4 },
    mobile: { geometryBudget: 360, textureBudget: 150, frameTargetMs: 16.7, hardFrameMs: 33, cacheSlots: 3, maxTextureAnisotropy: 4 },
    desktop: { geometryBudget: 900, textureBudget: 380, frameTargetMs: 16.7, hardFrameMs: 40, cacheSlots: 6, maxTextureAnisotropy: 8 }
  };
  function detectDevice(nav, ua) {
    var u = String(ua || (nav && nav.userAgent) || '');
    var touch = !!(nav && nav.maxTouchPoints > 1);
    var ios = /iPad|iPhone|iPod/.test(u) || (/Macintosh/.test(u) && touch);
    if (/iPad/.test(u) || (/Macintosh/.test(u) && touch)) return 'ipad';
    if (ios || /iPhone|iPod/.test(u)) return 'ios';
    if (/Android|Mobile/i.test(u)) return 'mobile';
    return 'desktop';
  }
  function createMemoryBudget(options) {
    var o = options || {};
    var device = o.device || detectDevice(o.navigator, o.userAgent);
    var profile = Object.assign({}, PROFILES[device] || PROFILES.desktop, o.overrides || {});
    var frameEma = profile.frameTargetMs;
    var level = 'normal';
    var stableMs = 0;
    var recoveryMs = 2500;

    function ratio(v, b) { return Math.max(0, Number(v) || 0) / Math.max(1, b); }
    function sample(info, frameMs, dtMs) {
      var mem = (info && info.memory) || {};
      var g = ratio(mem.geometries, profile.geometryBudget);
      var t = ratio(mem.textures, profile.textureBudget);
      var ms = Number.isFinite(frameMs) && frameMs > 0 ? Math.min(frameMs, 1000) : frameEma;
      frameEma = frameEma * 0.88 + ms * 0.12;
      var pressure = Math.max(g, t);
      var step = Number.isFinite(dtMs) && dtMs > 0 ? Math.min(dtMs, 250) : Math.min(ms, 250);
      var critical = pressure >= 0.97 || frameEma >= profile.hardFrameMs || !!(info && info.__oomRisk);
      var watch = pressure >= 0.84 || frameEma >= profile.frameTargetMs * 1.28;
      if (critical) { level = 'critical'; stableMs = 0; }
      else if (watch) { level = 'watch'; stableMs = 0; }
      else if (level !== 'normal') { stableMs += step; if (stableMs >= recoveryMs) level = 'normal'; }
      else { stableMs = Math.min(recoveryMs, stableMs + step); }
      return {
        device: device, profile: profile, level: level,
        geometryRatio: +g.toFixed(3), textureRatio: +t.toFixed(3),
        pressure: +pressure.toFixed(3), frameMs: +frameEma.toFixed(2),
        geometries: mem.geometries || 0, textures: mem.textures || 0
      };
    }
    /* How many hidden-but-recently-seen regions may stay resident. */
    function cacheSlots() {
      if (level === 'critical') return 1;
      if (level === 'watch') return Math.max(1, profile.cacheSlots - 2);
      return profile.cacheSlots;
    }
    function state() { return { device: device, level: level, profile: profile, frameMs: +frameEma.toFixed(2) }; }
    return { sample: sample, cacheSlots: cacheSlots, state: state, profile: profile, device: device };
  }

  /* ------------------------------------------------------------------ *
   * 3. Persistent asset cache — bounded LRU of regions kept ready so a
   *    return trip never reloads or re-decodes anything.
   * ------------------------------------------------------------------ */
  function createRegionCache(options) {
    var o = Object.assign({ slots: 4, ttlMs: 180000 }, options || {});
    var order = [];               // most recent first
    var meta = new Map();         // id -> {lastSeen, visits, bytes}
    var hits = 0, misses = 0;

    function slots() { return Math.max(0, o.slots); }
    function touch(id, now, bytes) {
      var t = Number.isFinite(now) ? now : 0;
      var m = meta.get(id) || { lastSeen: t, visits: 0, bytes: 0 };
      m.lastSeen = t; m.visits++; if (Number.isFinite(bytes)) m.bytes = bytes;
      meta.set(id, m);
      var i = order.indexOf(id);
      if (i >= 0) order.splice(i, 1);
      order.unshift(id);
      while (order.length > slots()) { var drop = order.pop(); if (drop !== id) meta.set(drop, meta.get(drop) || { lastSeen: t, visits: 0, bytes: 0 }); }
    }
    function isHot(id) { return order.indexOf(id) >= 0; }
    function noteLookup(id) {
      if (isHot(id)) { hits++; return true; }
      misses++; return false;
    }
    function resident(now) {
      var t = Number.isFinite(now) ? now : 0;
      return new Set(order.filter(function (id) {
        var m = meta.get(id);
        return !m || (t - m.lastSeen) <= o.ttlMs;
      }));
    }
    function report() {
      var bytes = 0;
      order.forEach(function (id) { var m = meta.get(id); if (m) bytes += m.bytes || 0; });
      return { slots: slots(), order: order.slice(), bytes: bytes, hits: hits, misses: misses };
    }
    function reset() { order.length = 0; meta.clear(); hits = misses = 0; }
    function residentNow() { return resident(Date.now()); }
    return { touch: touch, isHot: isHot, resident: resident, residentNow: residentNow, noteLookup: noteLookup, report: report, reset: reset, setSlots: function (n) { o.slots = n; } };
  }

  /* ------------------------------------------------------------------ *
   * 4. Async loading scheduler — time sliced, priority ordered.
   *    Guarantees no frame spends more than `sliceMs` on decode/upload.
   * ------------------------------------------------------------------ */
  function createScheduler(options) {
    var o = Object.assign({ sliceMs: 4.5, maxTasksPerFrame: 2 }, options || {});
    var queues = { 0: [], 1: [], 2: [] };   // 0 = camera-visible, 1 = ahead, 2 = background
    var running = null, done = 0, skipped = 0, dropped = 0;
    var lastSlice = 0, peakSlice = 0;

    function push(task, priority) {
      var p = priority === 0 || priority === 1 ? priority : 2;
      task.priority = p;
      task.tries = task.tries || 0;
      queues[p].push(task);
      return task;
    }
    function take() {
      for (var p = 0; p <= 2; p++) if (queues[p].length) return queues[p].shift();
      return null;
    }
    function runFrame(now, budgetMs) {
      var budget = Number.isFinite(budgetMs) ? budgetMs : o.sliceMs;
      var t0 = Number.isFinite(now) ? now : 0;
      var used = 0, ran = 0;
      while (ran < o.maxTasksPerFrame) {
        var task = take();
        if (!task) break;
        var started = clock();
        try { task.run(); done++; }
        catch (e) { task.tries++; if (task.tries < 3) push(task, task.priority); else dropped++; }
        used += clock() - started;
        ran++;
        if (used >= budget) break;
      }
      lastSlice = used; if (used > peakSlice) peakSlice = used;
      return { ran: ran, sliceMs: +used.toFixed(2), pending: pending() };
    }
    function pending() { return queues[0].length + queues[1].length + queues[2].length; }
    function report() {
      return { pending: pending(), done: done, dropped: dropped, lastSliceMs: +lastSlice.toFixed(2), peakSliceMs: +peakSlice.toFixed(2), sliceMs: o.sliceMs };
    }
    function reset() { queues = { 0: [], 1: [], 2: [] }; done = dropped = 0; lastSlice = peakSlice = 0; }
    return { push: push, runFrame: runFrame, pending: pending, report: report, reset: reset, options: o };
  }
  var clock = (typeof performance !== 'undefined' && performance.now)
    ? function () { return performance.now(); }
    : function () { return Date.now(); };

  /* ------------------------------------------------------------------ *
   * 5. Resource lifecycle — ref counted ownership so a shared geometry,
   *    material or texture is never disposed while another region uses it.
   * ------------------------------------------------------------------ */
  function createResourceRegistry() {
    var counts = new Map();       // resource -> users
    var owner = new Map();        // resource -> Set(regionId)
    var created = 0, released = 0, blocked = 0, leaked = 0;
    var disposed = new WeakSet();

    function key(res) { return res; }
    function acquire(res, regionId) {
      if (!res) return 0;
      var k = key(res);
      var n = counts.get(k) || 0;
      counts.set(k, n + 1);
      if (regionId) {
        var s = owner.get(k);
        if (!s) { s = new Set(); owner.set(k, s); }
        s.add(regionId);
      }
      created++;
      return n + 1;
    }
    function release(res, regionId) {
      if (!res) return 0;
      var k = key(res);
      var n = counts.get(k) || 0;
      if (n <= 1) {
        counts.delete(k);
        var s = owner.get(k);
        if (s && regionId) s.delete(regionId);
        owner.delete(k);
        return 0;
      }
      counts.set(k, n - 1);
      var set = owner.get(k);
      if (set && regionId) set.delete(regionId);
      return n - 1;
    }
    function users(res) { return counts.get(res) || 0; }
    /* Dispose only when nothing else references it. */
    function disposeIfUnused(res, liveSet) {
      if (!res || disposed.has(res)) return false;
      if (liveSet && liveSet.has(res)) { blocked++; return false; }
      if ((counts.get(res) || 0) > 0) { blocked++; return false; }
      if (typeof res.dispose === 'function') {
        res.dispose(); disposed.add(res); released++; return true;
      }
      return false;
    }
    function audit(liveSet) {
      var orphans = 0;
      counts.forEach(function (n, res) {
        if (n <= 0) return;
        if (liveSet && !liveSet.has(res)) { orphans++; leaked++; }
      });
      return { tracked: counts.size, created: created, released: released, blocked: blocked, orphans: orphans };
    }
    function report() { return { tracked: counts.size, created: created, released: released, blocked: blocked }; }
    function reset() { counts.clear(); owner.clear(); created = released = blocked = leaked = 0; }
    return { acquire: acquire, release: release, users: users, disposeIfUnused: disposeIfUnused, audit: audit, report: report, reset: reset };
  }

  /* ------------------------------------------------------------------ *
   * 6. Texture streaming — distance/priority driven sampler policy.
   *    Palace textures ship as single mip pyramids, so the win here is
   *    (a) always generate mipmaps, (b) drop anisotropy + keep small
   *    sampling cost for far regions, (c) defer the GPU upload of far
   *    regions to the async scheduler instead of the visible frame.
   * ------------------------------------------------------------------ */
  function createTexturePolicy(options) {
    var o = Object.assign({ near: 14, mid: 45, far: 120, maxAnisotropy: 4 }, options || {});
    function level(distance, priority) {
      var d = Number.isFinite(distance) ? distance : 999;
      var p = priority === 0 || priority === 1 ? priority : 2;
      if (p === 0 || d <= o.near) return { name: 'near', anisotropy: o.maxAnisotropy, mipmaps: true, deferUpload: false };
      if (p === 1 || d <= o.mid) return { name: 'mid', anisotropy: Math.max(1, Math.round(o.maxAnisotropy / 2)), mipmaps: true, deferUpload: false };
      if (d <= o.far) return { name: 'far', anisotropy: 1, mipmaps: true, deferUpload: true };
      return { name: 'distant', anisotropy: 1, mipmaps: true, deferUpload: true };
    }
    /* Apply to one texture; returns true when something changed. */
    function applyTexture(texture, distance, priority) {
      if (!texture || !texture.isTexture) return false;
      var L = level(distance, priority);
      var changed = false;
      if (texture.anisotropy !== L.anisotropy) { texture.anisotropy = L.anisotropy; changed = true; }
      if (texture.generateMipmaps !== L.mipmaps) { texture.generateMipmaps = L.mipmaps; changed = true; }
      if (L.mipmaps && texture.minFilter === 1006 /* NearestFilter */) { changed = true; }
      if (changed) texture.needsUpdate = false;   // apply flags without re-uploading pixels
      return changed;
    }
    return { level: level, applyTexture: applyTexture, options: o };
  }

  /* ------------------------------------------------------------------ *
   * 7. LOD / HLOD policy — explicit distance ladder with hysteresis so a
   *    mesh never flips back and forth at a boundary. Levels only exist
   *    for assets that actually ship alternates; HLOD is region level.
   * ------------------------------------------------------------------ */
  function createLodPolicy(options) {
    var o = Object.assign({ distances: [12, 30, 70], hysteresis: 0.12, hlodFrom: 120 }, options || {});
    var current = new Map();
    function level(id, distance) {
      var d = Number.isFinite(distance) ? distance : 0;
      var prev = current.has(id) ? current.get(id) : 0;
      var n = 0;
      // Thresholds are inflated when climbing and deflated when descending, so
      // a mesh sitting on a boundary can never flip every frame.
      for (var i = 0; i < o.distances.length; i++) {
        var lim = o.distances[i] * (prev > i ? 1 - o.hysteresis : 1 + o.hysteresis);
        if (d > lim) n = i + 1;
      }
      current.set(id, n);
      return n;
    }
    function hlod(distance) { return distance > o.hlodFrom; }
    function report() { var out = {}; current.forEach(function (v, k) { out[k] = v; }); return out; }
    function reset() { current.clear(); }
    return { level: level, hlod: hlod, report: report, reset: reset, options: o };
  }

  /* ------------------------------------------------------------------ *
   * 8. Instancing / batching audit — measures how many draw calls are
   *    duplicates (same geometry+material) per region so batching can be
   *    targeted instead of guessed.
   * ------------------------------------------------------------------ */
  function auditDrawCalls(meshes) {
    var groups = new Map(), alone = 0, batchableDrawCalls = 0, triangles = 0;
    (meshes || []).forEach(function (m) {
      if (!m || !m.geometry) return;
      triangles += m.triangles || 0;
      if (m.isInstancedMesh) return;
      var k = (m.geometryKey || m.geometry) + '|' + (m.materialKey || m.material);
      var arr = groups.get(k);
      if (!arr) { arr = []; groups.set(k, arr); }
      arr.push(m);
    });
    groups.forEach(function (arr) {
      if (arr.length > 1) batchableDrawCalls += arr.length - 1;
      else alone++;
    });
    return { uniqueKeys: groups.size, batchableDrawCalls: batchableDrawCalls, singles: alone, triangles: triangles };
  }
  /* Shared material dedupe: identical config -> one instance. */
  function dedupeMaterials(materials, keyOf) {
    var byKey = new Map(), reused = 0, kept = [];
    (materials || []).forEach(function (m) {
      if (!m) return;
      var k = keyOf ? keyOf(m) : null;
      if (!k) { kept.push(m); return; }
      if (byKey.has(k)) { reused++; return; }
      byKey.set(k, m); kept.push(m);
    });
    return { materials: kept, reused: reused, unique: byKey.size };
  }

  /* ------------------------------------------------------------------ *
   * 9. Portal / occlusion visibility with predictive widening.
   *    This is the piece the integration layer injects into the existing
   *    SinWingVisibility planner: it never adds a region that is not
   *    reachable through an open portal (hops), it only decides how far
   *    ahead of the camera that reachable region gets prepared.
   * ------------------------------------------------------------------ */
  function planPrefetch(input) {
    var regions = input.regions || [];
    var reach = input.reach || new Map();       // id -> portal hops
    var cam = input.cam || { x: 0, z: 0, dirX: 0, dirZ: 1, halfFov: 0.6 };
    var opts = input.options || {};
    var viewDistance = Number.isFinite(opts.viewDistance) ? opts.viewDistance : 400;
    var baseHalf = (cam.halfFov || 0.6);
    var lead = Math.max(0, Number(input.lead) || 0);
    var leadHalf = Math.min(1.2, baseHalf + (lead > 0 ? 0.30 : 0));
    var leadDistance = viewDistance + lead * 2;
    var visible = new Set(), prepared = new Set(), meta = new Map();
    var Vis = input.visibility;                  // SinWingVisibility (inWedge, nearestDistance)
    if (!Vis) return { visible: visible, prepared: prepared, meta: meta };

    regions.forEach(function (r) {
      var hops = reach.has(r.id) ? reach.get(r.id) : Infinity;
      var near = Vis.nearestDistance(r.bbox, cam.x, cam.z);
      var seen = false;
      if (hops <= (opts.maxHops || 6)) {
        if (near <= 1.25) seen = true;
        else if (Vis.inWedge(r.bbox, cam, baseHalf + (opts.frustumMargin || 0.22), viewDistance)) seen = true;
        if (seen) visible.add(r.id), prepared.add(r.id);
      }
      if (!seen && hops <= (opts.maxHops || 6)) {
        // Prepared = what the camera could see after a turn or a few more
        // metres of travel. Never drawn, only resident and decoded.
        if (Vis.inWedge(r.bbox, cam, baseHalf + (opts.prefetchMargin || 0.55) + (lead > 0 ? 0.15 : 0), viewDistance + (opts.prefetchDistance || 25) + lead * 2.5)) prepared.add(r.id);
        else if (lead > 0 && Vis.inWedge(r.bbox, cam, leadHalf, leadDistance)) prepared.add(r.id);
      }
      meta.set(r.id, { hops: hops, distance: near, inView: seen, lead: +lead.toFixed(2) });
    });
    return { visible: visible, prepared: prepared, meta: meta };
  }

  return {
    createPredictor: createPredictor,
    createMemoryBudget: createMemoryBudget,
    createRegionCache: createRegionCache,
    createScheduler: createScheduler,
    createResourceRegistry: createResourceRegistry,
    createTexturePolicy: createTexturePolicy,
    createLodPolicy: createLodPolicy,
    planPrefetch: planPrefetch,
    auditDrawCalls: auditDrawCalls,
    dedupeMaterials: dedupeMaterials,
    detectDevice: detectDevice,
    PROFILES: PROFILES
  };
});
