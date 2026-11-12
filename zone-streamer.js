/* SÎN ENGINE — data-driven zone streamer.
   ---------------------------------------------------------------------------
   One generic lifecycle for every streamed area (room dress, future wings,
   markets ...). A zone is *registered* once with a small spec; the streamer
   then gives it, with no per-zone code:

     cold -> loading -> uploading -> compiling -> ready (revealed) -> evicted

   - predictive prefetch: a zone starts loading as soon as it is within
     `prefetchHops` portal hops of the player's region (or the visibility
     planner puts it in the prepared/visible set), i.e. one or more rooms
     before the player can reach it;
   - off-screen preparation: every streamed mesh stays hidden while its
     textures are uploaded under a per-frame budget (count + milliseconds)
     and its shader programs are compiled against the REAL scene (lights,
     fog, environment) with renderer.compileAsync;
   - atomic reveal: the zone's content becomes visible in one frame, only
     when all of the above finished. A still-loading room is NEVER revealed
     just because a short timer expired (that was the K2 table pop-in). A
     long `abandonMs` (default 60 s) or `fail()` is the only way an incomplete
     zone is shown, so a broken download cannot hide a room forever;
   - LRU eviction with hysteresis: zones that are no longer wanted linger for
     `graceMs`, and an LRU cache keeps up to `cacheZones[memoryLevel]` extra
     zones resident; the current room and anything actually in the camera
     frustum are never evicted. Prefetch and the planner's `prepared` set
     must NEVER override the budget: prepared neighbours are the first
     things evicted when the current room needs space, and the current
     room's load always has top priority. Eviction disposes GPU geometry
     + textures owned by the zone;
   - CPU release after upload: textures marked releasable (parsed GLBs) drop
     their decoded pixels only after the GPU copy exists.

   Spec (all functions optional except load):
     { id: 'K2',                 // region id in the wing layout / portal graph
       prefetchHops: 1,          // start loading this many hops away
       priority: 0,              // lower = uploads first among equal hops
       timeoutMs: 14000,         // legacy alias; prefer abandonMs
       abandonMs: 60000,         // only THEN reveal an incomplete zone (failed/stuck load)
       load(api),                // start streaming; add content via api.add(obj)
       isComplete(),             // poll: true when everything requested arrived
       prepare(api),             // material tweaks before upload + compile
       onReady(api),             // after the atomic reveal
       unload(api),              // zone-specific cleanup (colliders, refs)
       ownsObject(obj) }         // which group children are streamed content
   api passed to load/unload: { id, group, add(obj), hide(obj), done(), fail(e) }
*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SinZoneStreamer = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
    'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'specularMap', 'clearcoatMap',
    'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenColorMap', 'sheenRoughnessMap',
    'transmissionMap', 'thicknessMap', 'iridescenceMap', 'anisotropyMap'];
  const HIDE_FLAG = 'hideUntilDressReady';
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function materialsOf(o) { return o && o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; }
  function texturesOf(rootObj, out) {
    out = out || new Set();
    if (!rootObj || !rootObj.traverse) return out;
    rootObj.traverse(function (o) {
      materialsOf(o).forEach(function (m) {
        if (!m) return;
        TEX_KEYS.forEach(function (k) { const t = m[k]; if (t && t.isTexture) out.add(t); });
      });
    });
    return out;
  }
  function uploaded(renderer, t) {
    try {
      const p = renderer.properties.get(t);
      return !!(p && p.__webglTexture && p.__version === t.version);
    } catch (_) { return false; }
  }
  function hideObject(obj) {
    if (!obj || !obj.traverse) return;
    obj.traverse(function (o) {
      if (!o.isMesh && !o.isInstancedMesh && !o.isPoints && !o.isSprite && !o.isLine) return;
      o.visible = false;
      o.userData[HIDE_FLAG] = true;
    });
  }
  function revealObject(obj) {
    if (!obj || !obj.traverse) return 0;
    let n = 0;
    obj.traverse(function (o) {
      if (o.userData && o.userData[HIDE_FLAG]) { o.visible = true; delete o.userData[HIDE_FLAG]; n++; }
    });
    return n;
  }

  function create(options) {
    const o = Object.assign({
      uploadsPerFrame: 3,        // hard cap of texture uploads per frame
      uploadMsPerFrame: 4,       // soft time budget (ms) for uploads per frame
      graceMs: 20000,            // a zone that is no longer wanted lingers this long
      cacheZones: { normal: 2, watch: 1, critical: 0 }, // extra (unwanted) zones kept resident
      maxConcurrentLoads: 1,     // zones loading at once (GLB parse is the peak-RAM step)
      defaultTimeoutMs: 14000,
      defaultAbandonMs: 60000,   // reveal incomplete only after this (not a short timeout)
      maxTextureSize: 0,         // 0 = no cap; set from SinDevice on phones
      geometryBudget: 420,
      textureBudget: 180,
      // Hard device-aware process / GPU / CPU caps. Loading DEFERRs rather
      // than exceed them; eviction of unprotected idle zones runs first.
      processBudgetMB: 1400,
      gpuBudgetMB: 1100,
      cpuBudgetMB: 250,
      defaultZoneProcessMB: 50,
      defaultZoneGpuMB: 40,
      defaultZoneCpuMB: 10,
      estimate: null,            // optional () => { processMB, gpuMB, cpuMB }
      deferStallMs: 3000,        // after this, evict harder rather than wait forever
      onBudgetStall: null,       // (rec, report) => void  — release city / purge
      log: null                  // function(kind, msg) for the memory overlay
    }, options || {});

    const zones = new Map();               // id -> record
    const order = [];                      // registration order (stable priority)
    const releasable = new Map();          // source -> Set(textures) waiting for GPU copy
    const stats = { uploads: 0, uploadMs: 0, maxFrameUploadMs: 0, compiles: 0, reveals: 0, evictions: 0, texturesDisposed: 0, cpuReleased: 0, deferred: 0, budgetEvictions: 0, deferStalls: 0, lastDefer: null, lastStall: null };
    let ctx = null;                        // { renderer, scene, camera, groupOf(id) }
    let uploadQueue = [];                  // { tex, zone, rank }

    function note(kind, msg) { try { if (o.log) o.log(kind, msg); } catch (_) {} }

    function register(spec) {
      if (!spec || !spec.id || typeof spec.load !== 'function') throw new Error('SinZoneStreamer.register: spec needs id + load()');
      const prev = zones.get(spec.id);
      const rec = prev || { id: spec.id, state: 'cold', lastWanted: 0, leftAt: 0, startedAt: 0, pending: new Set(), compilePromise: null, done: false, failed: null, waiters: [] };
      rec.spec = Object.assign({ prefetchHops: 1, priority: 0, timeoutMs: o.defaultTimeoutMs, abandonMs: o.defaultAbandonMs }, spec);
      if (!prev) { zones.set(spec.id, rec); order.push(spec.id); }
      return rec;
    }
    function unregister(id) { const r = zones.get(id); if (!r) return; if (r.state !== 'cold') evict(r, 'unregister'); zones.delete(id); const i = order.indexOf(id); if (i >= 0) order.splice(i, 1); }
    function attach(c) { ctx = c; }

    function group(rec) { return ctx && ctx.groupOf ? ctx.groupOf(rec.id) : null; }
    function apiFor(rec) {
      return {
        id: rec.id,
        group: group(rec),
        hide: hideObject,
        add: function (obj) {
          const g = group(rec); if (!obj || !g) return obj;
          obj.userData.streamDress = true;
          if (rec.state !== 'ready') hideObject(obj);
          g.add(obj);
          if (rec.state === 'ready') { queueTextures(rec, obj, 0); }
          return obj;
        },
        done: function () { rec.done = true; },
        fail: function (e) { rec.failed = e || true; rec.done = true; }
      };
    }

    // ---- textures -----------------------------------------------------------
    function markReleasable(rootObj) {
      texturesOf(rootObj).forEach(function (t) {
        if (t.isCompressedTexture || t.isRenderTargetTexture || !t.source) return;
        t.userData.sinReleaseCpu = true;
        let set = releasable.get(t.source);
        if (!set) { set = new Set(); releasable.set(t.source, set); }
        set.add(t);
      });
    }
    function tryReleaseCpu(t) {
      if (!ctx || !ctx.renderer || !t || !t.source) return;
      const set = releasable.get(t.source);
      if (!set) return;
      for (const x of set) if (!uploaded(ctx.renderer, x)) return;
      const img = t.source.data;
      releasable.delete(t.source);
      if (!img) return;
      // Record GPU dimensions BEFORE closing the bitmap, or the process
      // estimator's gpuTex collapses (490 → 44, then a "fake" drop to 390).
      const w = img.width || img.videoWidth || 0;
      const h = img.height || img.videoHeight || 0;
      try {
        set.forEach(function (x) {
          if (!x.userData) x.userData = {};
          if (w && h) { x.userData.sinGpuW = x.userData.sinGpuW || w; x.userData.sinGpuH = x.userData.sinGpuH || h; }
        });
        // Null the shared source FIRST. Clones may expose image as a getter
        // over source.data (assigning x.image throws and used to skip the
        // source.data = null, leaving CPU pixels resident).
        t.source.data = null;
        set.forEach(function (x) {
          try { if ('image' in x && x.image === img) x.image = null; } catch (_) {}
        });
        if (typeof img.close === 'function') img.close();
        stats.cpuReleased++;
      } catch (_) {}
    }
    function capOne(t) {
      const max = o.maxTextureSize || 0;
      if (!max) return;
      try {
        const D = (typeof window !== 'undefined' && window.SinDevice) || (typeof globalThis !== 'undefined' && globalThis.SinDevice);
        if (D && typeof D.capTexture === 'function') D.capTexture(t, max);
      } catch (_) {}
    }
    function queueTextures(rec, obj, rank) {
      const renderer = ctx && ctx.renderer;
      texturesOf(obj).forEach(function (t) {
        capOne(t);
        if (renderer && uploaded(renderer, t)) { tryReleaseCpu(t); return; }
        if (!t.image) return;
        if (rec) rec.pending.add(t);
        uploadQueue.push({ tex: t, zone: rec, rank: rank || 0 });
      });
    }
    function pumpUploads() {
      const renderer = ctx && ctx.renderer;
      if (!renderer || typeof renderer.initTexture !== 'function') { uploadQueue.length = 0; zones.forEach(r => r.pending.clear()); return; }
      if (!uploadQueue.length) return;
      uploadQueue.sort((a, b) => a.rank - b.rank);
      const t0 = now(); let n = 0;
      while (uploadQueue.length && n < o.uploadsPerFrame) {
        if (n > 0 && now() - t0 > o.uploadMsPerFrame) break;
        const job = uploadQueue.shift();
        const t = job.tex;
        try { capOne(t); } catch (_) {}
        try { if (t.image && !uploaded(renderer, t)) { renderer.initTexture(t); n++; stats.uploads++; } } catch (_) {}
        if (job.zone) job.zone.pending.delete(t);
        tryReleaseCpu(t);
      }
      const dt = now() - t0; stats.uploadMs += dt; if (dt > stats.maxFrameUploadMs) stats.maxFrameUploadMs = dt;
    }
    // Textures an object/render uploaded outside the queue may now be releasable.
    function sweepReleasable() {
      if (!ctx || !ctx.renderer || !releasable.size) return;
      let k = 0;
      for (const [source, set] of releasable) {
        if (++k > 16) break;
        const t = set.values().next().value;
        if (!t || !source.data) { releasable.delete(source); continue; }
        tryReleaseCpu(t);
      }
    }

    // ---- lifecycle ----------------------------------------------------------

    function usage() {
      try {
        // Cached figures only. A fresh SinProcessMemory.estimate() from
        // report()/wouldExceed() walked the whole scene and called
        // PalaceInterior.status(), which used to call PalaceWings.metrics(),
        // which called report() again — infinite recursion on the first
        // hall frame. Budget decisions use the last sample (updated on a
        // 500 ms cadence after the first present).
        if (typeof o.estimate === 'function') {
          const u = o.estimate() || {};
          return { processMB: +u.processMB || 0, gpuMB: +u.gpuMB || 0, cpuMB: +u.cpuMB || 0 };
        }
        const PM = (typeof window !== 'undefined' && window.SinProcessMemory) || (typeof globalThis !== 'undefined' && globalThis.SinProcessMemory);
        if (PM && typeof PM.last === 'function') {
          const u = PM.last() || {};
          return { processMB: +u.processMB || 0, gpuMB: +u.gpuMB || 0, cpuMB: +u.cpuMB || 0 };
        }
      } catch (_) {}
      return { processMB: 0, gpuMB: 0, cpuMB: 0 };
    }
    function incoming(rec) {
      const s = (rec && rec.spec) || {};
      return {
        processMB: s.estProcessMB != null ? +s.estProcessMB : o.defaultZoneProcessMB,
        gpuMB: s.estGpuMB != null ? +s.estGpuMB : o.defaultZoneGpuMB,
        cpuMB: s.estCpuMB != null ? +s.estCpuMB : o.defaultZoneCpuMB
      };
    }
    function wouldExceed(extra) {
      extra = extra || { processMB: 0, gpuMB: 0, cpuMB: 0 };
      const u = usage();
      return (o.processBudgetMB > 0 && u.processMB + extra.processMB > o.processBudgetMB)
        || (o.gpuBudgetMB > 0 && u.gpuMB + extra.gpuMB > o.gpuBudgetMB)
        || (o.cpuBudgetMB > 0 && u.cpuMB + extra.cpuMB > o.cpuBudgetMB);
    }
    // Evict idle zones (farthest / least-recent first) until `incoming` would
    // fit. Grace is skipped: the budget is a hard cap, and the door stays
    // closed until the new room can be fully resident.
    // Pass 1: only unprotected (not current / visible / adjacent).
    // Pass 2: adjacent rooms that are NOT visible and NOT current may yield
    // so a new current room can fit. Visible + current are never evicted
    // (nothing disappears in front of the player).
    function evictCandidates(allowAdjacent) {
      const idle = [];
      zones.forEach(function (r) {
        if (r.state === 'cold') return;
        if (r.isCurrent || r.visible) return;
        if (!allowAdjacent && r.protected) return;
        idle.push(r);
      });
      idle.sort(function (a, b) {
        const dh = (b.hops || 0) - (a.hops || 0);
        if (dh) return dh;
        return (a.lastWanted || 0) - (b.lastWanted || 0);
      });
      return idle;
    }
    function evictToFit(extra) {
      if (!wouldExceed(extra)) return true;
      for (let pass = 0; pass < 2 && wouldExceed(extra); pass++) {
        const idle = evictCandidates(pass === 1);
        for (let i = 0; i < idle.length && wouldExceed(extra); i++) {
          if (idle[i].state === 'cold') continue;
          evict(idle[i], 'budget');
          stats.budgetEvictions++;
        }
      }
      return !wouldExceed(extra);
    }
    function roomFitsAlone(rec) {
      const extra = incoming(rec);
      return (o.processBudgetMB <= 0 || extra.processMB <= o.processBudgetMB)
        && (o.gpuBudgetMB <= 0 || extra.gpuMB <= o.gpuBudgetMB)
        && (o.cpuBudgetMB <= 0 || extra.cpuMB <= o.cpuBudgetMB);
    }
    function evictPreparedFirst(why, includeAdjacent) {
      const list = [];
      zones.forEach(function (r) {
        if (r.state === 'cold' || r.isCurrent || r.visible) return;
        if (!includeAdjacent && r.hops != null && r.hops <= 1) return;
        list.push(r);
      });
      // Prepared / far rooms first; 1-hop neighbours last (only when needed).
      list.sort(function (a, b) {
        const an = (a.hops != null && a.hops <= 1) ? 1 : 0;
        const bn = (b.hops != null && b.hops <= 1) ? 1 : 0;
        if (an !== bn) return an - bn;
        return (b.hops || 0) - (a.hops || 0);
      });
      let n = 0;
      list.forEach(function (r) {
        if (r.state === 'cold' || r.isCurrent || r.visible) return;
        evict(r, why || 'prepared-before-current');
        stats.budgetEvictions++;
        n++;
      });
      return n;
    }
    // Prefetch must never override the budget. Prepared neighbours are the
    // first things evicted when the current room needs space. The current
    // room's load always has top priority.
    function evictForCurrent(extra) {
      evictNonAdjacent('non-adjacent-before-load');
      const tight = o.processBudgetMB > 0 && o.processBudgetMB <= 650;
      // Under the 650 bar, always drop prepared / far rooms before a current
      // load — even if the (possibly stale) estimate says the incoming room
      // "fits". Playthrough-4 stacked K2+K3 to 656 MB because evictToFit
      // trusted that estimate and skipped the evict.
      if (tight) evictPreparedFirst('prepared-before-current', false);
      if (!wouldExceed(extra)) return true;
      evictPreparedFirst('budget-prepared', true);
      return evictToFit(extra);
    }
    function canStart(rec) {
      const extra = incoming(rec);
      if (rec.isCurrent) {
        evictForCurrent(extra);
        if (!wouldExceed(extra) || evictToFit(extra) || roomFitsAlone(rec)) {
          rec.deferred = false; rec.deferredAt = 0; return true;
        }
      } else {
        // Prefetch: start only if it fits without evicting the current room
        // or anything visible. Never override the budget. Never compete
        // with a current-room load that is still in flight.
        evictNonAdjacent('non-adjacent-before-prefetch');
        if (wouldExceed(extra)) return false;
        if (o.processBudgetMB > 0 && o.processBudgetMB <= 650) {
          let currentBusy = false;
          zones.forEach(function (r) {
            if (r.isCurrent && r.state !== 'ready' && r.state !== 'cold') currentBusy = true;
          });
          if (currentBusy) return false;
        }
        rec.deferred = false; rec.deferredAt = 0; return true;
      }
      if (!rec.deferred) {
        rec.deferred = true;
        rec.deferredAt = now();
        rec.stallAttempts = 0;
        stats.deferred++;
        stats.lastDefer = { id: rec.id, at: rec.deferredAt, usage: usage(), incoming: extra };
        note('load', rec.id + ' deferred — over budget (' + JSON.stringify(stats.lastDefer) + ')');
      }
      return false;
    }
    // A door must never wait forever. After deferStallMs, evict every
    // non-visible, non-current zone (adjacent included) and ask the host
    // to drop the city / orphans. If the room itself fits the device
    // budget (the CI content check guarantees this for shipped rooms),
    // admit it on the second stall so leftover estimate noise cannot
    // deadlock the door.
    let stallBusy = false;
    function handleDeferStall(rec, t) {
      const wait = o.deferStallMs != null ? o.deferStallMs : 3000;
      if (!rec.deferred || rec.state !== 'cold') return false;
      if (!rec.deferredAt || t - rec.deferredAt < wait) return false;
      // Re-entrancy: onBudgetStall -> releaseCity / purge must not re-enter
      // evict/canStart on the same tick (that was a suspected infinite loop).
      if (stallBusy) return false;
      stallBusy = true;
      try {
        stats.deferStalls++;
        rec.stallAttempts = (rec.stallAttempts || 0) + 1;
        stats.lastStall = { id: rec.id, at: t, attempt: rec.stallAttempts, usage: usage() };
        zones.forEach(function (r) {
          if (r.state !== 'cold' && !r.isCurrent && !r.visible) {
            evict(r, 'defer-stall');
            stats.budgetEvictions++;
          }
        });
        try { if (typeof o.onBudgetStall === 'function') o.onBudgetStall(rec, report()); } catch (e) { console.warn('onBudgetStall', e); }
        rec.deferredAt = t;
        if (canStart(rec)) return true;
        if (roomFitsAlone(rec) && rec.stallAttempts >= 2) {
          note('load', rec.id + ' admitted after defer-stall (room fits the device budget alone)');
          rec.deferred = false;
          rec.deferredAt = 0;
          return true;
        }
        return false;
      } finally {
        stallBusy = false;
      }
    }

        function start(rec, t) {
      rec.state = 'loading'; rec.startedAt = t; rec.done = false; rec.failed = null; rec.pending.clear();
      note('load', rec.id + ' stream start');
      try { rec.spec.load(apiFor(rec)); } catch (e) { rec.failed = e; rec.done = true; console.warn('zone load failed', rec.id, e); }
    }
    function complete(rec) {
      if (rec.done) return true;
      try { if (rec.spec.isComplete && rec.spec.isComplete()) return true; } catch (_) {}
      return false;
    }
    function step(rec, t, rank) {
      const g = group(rec);
      if (rec.state === 'loading') {
        const elapsed = t - rec.startedAt;
        const done = complete(rec);
        const failed = !!rec.failed;
        const abandonAt = rec.spec.abandonMs != null ? rec.spec.abandonMs
          : (rec.spec.timeoutMs != null && rec.spec.timeoutMs > 30000 ? rec.spec.timeoutMs : (o.defaultAbandonMs || 60000));
        // A short timeoutMs (legacy 14 s) must NOT reveal a still-loading room:
        // on a phone the 6.8 MB K2 table often arrives after that, which was
        // the visible pop-in. Only complete, fail(), or a long abandon reveal.
        const abandon = elapsed > abandonAt;
        if (done || failed || abandon) {
          if (!done) note('load', rec.id + (failed ? ' failed' : ' abandoned') + ' after ' + Math.round(elapsed) + ' ms — revealing what is present');
          rec.state = 'uploading';
          // Program-affecting material tweaks run before upload/compile.
          try { if (rec.spec.prepare) rec.spec.prepare(apiFor(rec)); } catch (e) { console.warn('zone prepare', rec.id, e); }
          if (g) queueTextures(rec, g, rank);
        }
      }
      if (rec.state === 'uploading' && rec.pending.size === 0) {
        rec.state = 'compiling';
        const r = ctx && ctx.renderer;
        let p = null;
        if (g && r && ctx.camera) {
          try {
            // Compile against the real scene so the programs match what the
            // renderer will use (lights, fog, env): no compile at reveal.
            if (typeof r.compileAsync === 'function') p = r.compileAsync(g, ctx.camera, ctx.scene || null);
            else if (typeof r.compile === 'function') r.compile(g, ctx.camera);
            stats.compiles++;
          } catch (_) { p = null; }
        }
        const fin = function () { if (rec.state === 'compiling') rec.compileDone = true; };
        rec.compileDone = false;
        if (p && typeof p.then === 'function') p.then(fin, fin); else fin();
      }
      if (rec.state === 'compiling' && rec.compileDone) reveal(rec);
    }
    function reveal(rec) {
      const g = group(rec);
      rec.state = 'ready';
      const n = g ? revealObject(g) : 0;
      if (g) g.userData.dressReady = true;
      stats.reveals++;
      note('load', rec.id + ' ready (' + n + ' meshes, ' + Math.round(now() - rec.startedAt) + ' ms)');
      if (rec.spec.onReady) try { rec.spec.onReady(apiFor(rec)); } catch (_) {}
      const w = rec.waiters.splice(0); w.forEach(fn => { try { fn(rec.id); } catch (_) {} });
    }
    function evict(rec, why) {
      // The current room is never evicted to make room for prefetch, and a
      // one-frame current flicker must not abort an in-flight load (playthrough-4
      // first K4 was evicted mid-parse and re-dressed five times over 60 s).
      if (why !== 'forced') {
        if (rec.isCurrent) {
          try { console.info('[palace load] evict-skipped', rec.id, why, 'current'); } catch (_) {}
          return 0;
        }
        if (rec.state !== 'cold' && rec.state !== 'ready' && rec._currentUntil && now() < rec._currentUntil) {
          try { console.info('[palace load] evict-skipped', rec.id, why, 'current-room-load'); } catch (_) {}
          return 0;
        }
      }
      const g = group(rec);
      const own = rec.spec.ownsObject || function (ch) { return !!(ch.userData && ch.userData.streamDress); };
      const doomed = g ? g.children.filter(own) : [];
      const keep = new Set();
      // Textures still used by anything else stay (shared templates).
      if (g && ctx && ctx.scene) {
        const doomedSet = new Set(doomed);
        ctx.scene.traverse(function (x) {
          for (let n = x; n; n = n.parent) if (doomedSet.has(n)) return;
          materialsOf(x).forEach(m => TEX_KEYS.forEach(k => { if (m && m[k]) keep.add(m[k]); }));
        });
      }
      doomed.forEach(function (ch) {
        g.remove(ch);
        ch.traverse(function (x) {
          if (x.geometry && x.geometry.dispose) x.geometry.dispose();
          materialsOf(x).forEach(function (m) {
            if (!m || (m.userData && m.userData.palaceShared)) return;
            TEX_KEYS.forEach(function (k) {
              const t = m[k];
              // Every unshared texture this zone owned is released on the GPU.
              // The previous condition (sinReleaseCpu && !image) skipped maps
              // whose CPU pixels were still present (including canvas-capped
              // phone textures), so repeated leave/return accumulated GPU
              // memory until Safari killed the tab.
              if (t && !keep.has(t) && !(t.userData && t.userData.palaceShared)) {
                try { t.dispose(); stats.texturesDisposed++; } catch (_) {}
              }
            });
            if (typeof m.dispose === 'function') m.dispose();
          });
        });
      });
      uploadQueue = uploadQueue.filter(j => j.zone !== rec);
      rec.pending.clear();
      try { if (rec.spec.unload) rec.spec.unload(apiFor(rec)); } catch (e) { console.warn('zone unload', rec.id, e); }
      if (g) g.userData.dressReady = false;
      rec.state = 'cold'; rec.leftAt = 0; rec.done = false;
      stats.evictions++;
      note('unload', rec.id + ' evicted (' + why + ', ' + doomed.length + ' objects)');
      try { console.info('[palace load] evict', rec.id, why, doomed.length); } catch (_) {}
      return doomed.length;
    }

    // ---- memory pressure (migrated from smart-memory-manager.js) -----------
    // Never changes render resolution. Only informs LRU cache size.
    let memLevel = 'normal', memStableMs = 0, memFrameEma = 16.7, memLast = { level: 'normal', geometryRatio: 0, textureRatio: 0, frameMs: 16.7 };
    const memOpt = { geometryBudget: o.geometryBudget || 420, textureBudget: o.textureBudget || 180, watchRatio: 0.82, criticalRatio: 0.96, frameWatchMs: 24, frameCriticalMs: 40, recoveryMs: 2500 };
    function sample(renderer, frameMs) {
      const memory = renderer && renderer.info && renderer.info.memory || {};
      const gr = Math.max(0, Number(memory.geometries) || 0) / memOpt.geometryBudget;
      const tr = Math.max(0, Number(memory.textures) || 0) / memOpt.textureBudget;
      const ms = Number.isFinite(frameMs) && frameMs > 0 ? frameMs : memFrameEma;
      memFrameEma = memFrameEma * 0.88 + ms * 0.12;
      const pressure = Math.max(gr, tr);
      const critical = pressure >= memOpt.criticalRatio || memFrameEma >= memOpt.frameCriticalMs;
      const watch = pressure >= memOpt.watchRatio || memFrameEma >= memOpt.frameWatchMs;
      if (critical) { memLevel = 'critical'; memStableMs = 0; }
      else if (watch) { memLevel = 'watch'; memStableMs = 0; }
      else if (memLevel !== 'normal') { memStableMs += Math.max(0, ms); if (memStableMs >= memOpt.recoveryMs) memLevel = 'normal'; }
      else memStableMs = Math.min(memOpt.recoveryMs, memStableMs + Math.max(0, ms));
      memLast = { level: memLevel, geometryRatio: gr, textureRatio: tr, frameMs: memFrameEma };
      return memLast;
    }
    function memoryState() { return Object.assign({}, memLast); }

    // ---- shell warm (shader compile + budgeted upload of already-built
    // architecture). Replaces wings.js warmNext / uploadQueue. One group per
    // turn; the group is only made visible during the SYNCHRONOUS compile
    // traversal so a hidden room is never drawn for a frame.
    const warmed = typeof WeakSet === 'function' ? new WeakSet() : { has() { return false; }, add() {}, delete() {} };
    const warmQ = [];
    let warmBusy = false;
    function enqueueWarm(g) {
      if (!g || (warmed.has && warmed.has(g)) || warmQ.indexOf(g) >= 0) return;
      warmQ.push(g);
    }
    function forgetWarm(g) { if (g && warmed.delete) warmed.delete(g); }
    function pumpWarm() {
      if (warmBusy || !ctx || !ctx.renderer || !ctx.camera) return;
      if (!warmQ.length) return;
      const g = warmQ.shift();
      if (!g || (warmed.has && warmed.has(g))) return;
      if (warmed.add) warmed.add(g);
      const was = g.visible, r = ctx.renderer;
      warmBusy = true;
      let pending = null;
      try {
        g.visible = true;
        try {
          if (typeof r.compileAsync === 'function') pending = r.compileAsync(g, ctx.camera, ctx.scene || null);
          else if (typeof r.compile === 'function') r.compile(g, ctx.camera, ctx.scene || null);
          stats.compiles++;
        } finally { g.visible = was; }
      } catch (_) { g.visible = was; warmBusy = false; return; }
      const fin = function () { warmBusy = false; pumpUploads(); };
      if (pending && typeof pending.then === 'function') pending.then(fin, fin); else fin();
    }

    // view = { current, distances: Map(id->hops), visible:Set, prepared:Set, memoryLevel, warmGroups }
    function update(view) {
      const t = now();
      // A flicker of view.current must not evict or de-prioritize a mid-load
      // room the player just entered (playthrough-6 first K3).
      let midId = null;
      zones.forEach(function (r) {
        if (r.state !== 'cold' && r.state !== 'ready' && r._currentUntil && t < r._currentUntil) midId = r.id;
      });
      if (midId && view && view.current !== midId) {
        view = Object.assign({}, view, { current: midId });
      }
      const distances = view.distances || new Map();
      const visible = view.visible || new Set(), prepared = view.prepared || new Set();
      const level = view.memoryLevel || memLevel || 'normal';
      const wanted = [];
      order.forEach(function (id) {
        const rec = zones.get(id);
        const hops = distances.has(id) ? distances.get(id) : Infinity;
        // The current room is always wanted (top priority). Prefetch and
        // the visibility planner's `prepared` set (prepareHops, typically 2)
        // may START a load only when the budget has room — they must never
        // protect a neighbour from eviction when the current room needs
        // space (playthrough-4: prepared/want kept K2 resident at K3 and
        // peaked at 749 MB). Visible (actually in the camera frustum) and
        // the current room itself still never disappear in front of the player.
        const isCurrent = id === view.current;
        const tight = o.processBudgetMB > 0 && o.processBudgetMB <= 650;
        // On a 650 MB phone, only prefetchHops (1) starts a neighbour —
        // the planner's prepared set (prepareHops: 2) must NOT keep or
        // restart a farther room. prepared.has in `want` is what kept
        // K2 resident (and restarted it after evict) when the player
        // reached K3.
        const prefetch = hops <= rec.spec.prefetchHops || (!tight && prepared.has(id));
        const want = isCurrent || prefetch;
        // hops <= 1 protects on desktop; on a 650 MB phone those neighbours
        // yield once evictForCurrent decides the current room needs space.
        const protect = isCurrent || visible.has(id) || (!tight && hops <= 1);
        rec.hops = hops; rec.protected = protect; rec.visible = visible.has(id); rec.isCurrent = isCurrent;
        if (isCurrent) rec._currentUntil = t + ((rec.state !== 'cold' && rec.state !== 'ready') ? 15000 : 2000);
        if (want) { rec.lastWanted = t; rec.leftAt = 0; wanted.push(rec); }
        else if (rec.state !== 'cold' && !rec.leftAt) rec.leftAt = t;
      });
      // Nearest / visible first. Lower rank = more urgent.
      wanted.sort((a, b) => (a.hops - b.hops) || ((visible.has(b.id) ? 1 : 0) - (visible.has(a.id) ? 1 : 0)) || (a.spec.priority - b.spec.priority));
      let loading = 0;
      zones.forEach(r => { if (r.state === 'loading') loading++; });
      wanted.forEach(function (rec, i) {
        if (rec.state === 'cold' && (loading < o.maxConcurrentLoads || rec.id === view.current)) {
          // Hard cap: evict idle rooms first; if the new room still would
          // not fit, defer. The door gate waits on zoneIsReady, so nothing
          // is revealed incomplete in front of the player.
          if (canStart(rec) || handleDeferStall(rec, t)) { start(rec, t); loading++; }
        }
        if (rec.state !== 'cold' && rec.state !== 'ready') step(rec, t, i);
      });
      // Zones still preparing but no longer wanted keep preparing (cheap) so
      // a quick turn-back does not restart them.
      zones.forEach(function (rec) { if (!rec.lastWanted || rec.lastWanted === t) return; if (rec.state !== 'cold' && rec.state !== 'ready') step(rec, t, 99); });
      // Current room: if dress is complete, never sit in 'loading' — a 60 s
      // door wait is a failure. Pump step every update so reveal is a few
      // hundred ms after isComplete(), not an abandon timeout.
      zones.forEach(function (rec) {
        if (!rec.isCurrent) return;
        if (rec.state !== 'cold' && rec.state !== 'ready') step(rec, t, 0);
      });
      // Eviction: never protected zones; LRU beyond cache size after the grace
      // period, at once under critical memory pressure.
      const idle = [];
      zones.forEach(r => { if (r.state !== 'cold' && !r.protected && r.leftAt) idle.push(r); });
      idle.sort((a, b) => a.lastWanted - b.lastWanted); // oldest first
      const cache = o.cacheZones[level] != null ? o.cacheZones[level] : 0;
      // Phone (processBudgetMB <= 650): evict every unprotected zone at once
      // so a new K3/K4 load cannot stack on K2. graceMs/cache do not delay it.
      const tight = o.processBudgetMB > 0 && o.processBudgetMB <= 650;
      let evicted = 0;
      idle.forEach(function (rec, i) {
        const overCache = idle.length - i > cache;
        const far = rec.hops == null || rec.hops > 1;
        if (level === 'critical' || tight || (overCache && t - rec.leftAt >= o.graceMs)) {
          evict(rec, level === 'critical' ? 'critical memory' : (tight ? (far ? 'non-adjacent' : 'prepared-before-current') : 'lru'));
          evicted++;
        }
      });
      pumpUploads();
      sweepReleasable();
      // Compile shells of prepared / visible groups (off-screen, one at a time).
      (view.warmGroups || []).forEach(enqueueWarm);
      pumpWarm();
      return evicted;
    }

    function status(id) { const r = zones.get(id); return r ? r.state : 'unregistered'; }
    function isReady(id) { return status(id) === 'ready'; }
    function whenReady(id) {
      const r = zones.get(id);
      if (!r) return Promise.reject(new Error('unknown zone ' + id));
      if (r.state === 'ready') return Promise.resolve(id);
      return new Promise(res => r.waiters.push(res));
    }
    function forceEvict(id) { const r = zones.get(id); return r && r.state !== 'cold' ? evict(r, 'forced') : 0; }
    // Player is standing in (or was teleported into) this room. Start it
    // even if the hop map or budget defer would have left it cold.
    // The previous current room keeps isCurrent=true until update() runs.
    // forceLoad of the new room must clear that flag first, otherwise
    // evict() and evictNonAdjacent skip it (playthrough-5: K2 stayed
    // resident through K3 and K4 and peaked at 693 MB).
    function markCurrent(id) {
      const t = now();
      zones.forEach(function (r) {
        const cur = r.id === id;
        r.isCurrent = cur;
        if (cur) {
          r.lastWanted = t;
          // Mid-load current rooms stay protected well past a 2 s region
          // flicker (playthrough-6 evicted K3 at 2 s and the door waited 60 s).
          r._currentUntil = t + ((r.state !== 'cold' && r.state !== 'ready') ? 15000 : 2000);
          r.leftAt = 0;
        }
        else {
          // `visible` was last computed in the previous room. It must not
          // protect that room from eviction when the player has already
          // moved (playthrough-5: K2 stayed visible=true through K3/K4).
          // update() will re-flag anything actually in the new frustum.
          r.visible = false;
        }
      });
    }
    function evictNonAdjacent(why) {
      const tight = o.processBudgetMB > 0 && o.processBudgetMB <= 650;
      let n = 0;
      zones.forEach(function (r) {
        if (r.state === 'cold') return;
        if (r.isCurrent || r.visible) return;
        // Under the 650 bar, hop counts may be stale (still 0 from the
        // previous current room) and must not keep a neighbour resident
        // while the new current room starts. Evict every non-visible,
        // non-current zone.
        if (!tight && r.hops != null && r.hops <= 1) return;
        evict(r, why || 'non-adjacent');
        // These evicts free the budget for the incoming room, same as evictToFit.
        stats.budgetEvictions++;
        n++;
      });
      return n;
    }
    function forceLoad(id) {
      const rec = zones.get(id);
      if (!rec) return 'unregistered';
      // A region flicker (ensure-dress K2 while the harness is visiting K3)
      // must not steal a mid-load current room. Playthrough-6 evicted K3
      // 2 s into its first visit and the door waited 60 s.
      let mid = null;
      zones.forEach(function (r) {
        if (r.id === id) return;
        if (r.state !== 'cold' && r.state !== 'ready' && r._currentUntil && now() < r._currentUntil) mid = r;
      });
      if (mid) {
        try { console.info('[palace load] forceLoad-ignored', id, 'mid-load', mid.id); } catch (_) {}
        if (mid.state !== 'cold' && mid.state !== 'ready') step(mid, now(), 0);
        return mid.state;
      }
      // Mark current first — and clear isCurrent on every other zone —
      // so evictForCurrent cannot unload the room the player just entered
      // and cannot skip the room they just left (playthrough-5 peak 693).
      markCurrent(id);
      evictForCurrent(incoming(rec));
      if (rec.state === 'cold') {
        evictToFit(incoming(rec));
        rec.deferred = false;
        rec.deferredAt = 0;
        start(rec, now());
      }
      // start() alone leaves the zone in 'loading'. If update() does not
      // list it as wanted (missing hops) and lastWanted was never set,
      // step() never runs — dress can be complete while hideUntilReady
      // stays on (playthrough-3 first K4: complete true, revealed false,
      // 60 s). Mark it wanted and pump upload/compile/reveal now.
      rec.lastWanted = now();
      rec.isCurrent = true;
      if (rec.state !== 'cold' && rec.state !== 'ready') step(rec, now(), 0);
      return rec.state;
    }
    function reset() {
      zones.forEach(r => { r.state = 'cold'; r.pending.clear(); r.leftAt = 0; r.lastWanted = 0; r.done = false; r.waiters.length = 0; });
      uploadQueue = []; releasable.clear(); warmQ.length = 0; warmBusy = false; memLevel = 'normal';
    }
    function report() {
      const u = usage();
      const out = {
        zones: {},
        uploadQueue: uploadQueue.length,
        releasable: releasable.size,
        warmPending: warmQ.length,
        memory: memoryState(),
        usage: u,
        budget: { processMB: o.processBudgetMB, gpuMB: o.gpuBudgetMB, cpuMB: o.cpuBudgetMB },
        overBudget: wouldExceed({ processMB: 0, gpuMB: 0, cpuMB: 0 }),
        stats: Object.assign({}, stats)
      };
      zones.forEach(r => { out.zones[r.id] = { state: r.state, hops: r.hops, pending: r.pending.size, protected: !!r.protected, deferred: !!r.deferred }; });
      return out;
    }
    return { register, unregister, attach, update, status, isReady, whenReady, markReleasable, queueTextures: (obj) => queueTextures(null, obj, 50), pumpUploads, pumpWarm, enqueueWarm, forgetWarm, sample, memoryState, forceEvict, forceLoad, reset, report, hide: hideObject, reveal: revealObject, zones: () => Array.from(order) };
  }
  return { create, HIDE_FLAG };
});
