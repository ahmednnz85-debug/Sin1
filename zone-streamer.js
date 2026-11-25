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
  const DOOR_RE = /door|WingDoor|WingDoorPivot|BabylonianWingDoor/i;
  function isPersistentVisible(o) {
    if (!o) return false;
    let p = o;
    while (p) {
      if (p.userData && (p.userData.sinKeepVisible || p.userData.isDoor || p.userData._roomDoor || p.userData.hallShell)) return true;
      if (p.name && DOOR_RE.test(p.name)) return true;
      p = p.parent;
    }
    return false;
  }
  function hideObject(obj) {
    if (!obj || !obj.traverse) return;
    obj.traverse(function (o) {
      if (!o.isMesh && !o.isInstancedMesh && !o.isPoints && !o.isSprite && !o.isLine) return;
      // Doors are part of the hall/corridor and must stay visible (closed)
      // while the room behind them is still loading. The hide-until-ready
      // gate used to hide them with the incomplete room, so the doorway
      // looked empty until the player arrived and the door popped in.
      if (isPersistentVisible(o)) return;
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
      // Distance (metric) policy — used when the host passes view.metric:
      // a room no longer inside its release radius is unloaded after this
      // linger (hysteresis against a step back across the radius).
      releaseMs: 2500,
      // Off-screen shader preparation: at most this many ms of compile()
      // calls per frame, and a fresh program is let finish on the GPU
      // (fence) before the next one starts, so a reveal never links
      // programs and no frame links more than one.
      compileMsPerFrame: 4,
      log: null                  // function(kind, msg) for the memory overlay
    }, options || {});

    const zones = new Map();               // id -> record
    const order = [];                      // registration order (stable priority)
    const releasable = new Map();          // source -> Set(textures) waiting for GPU copy
    const stats = { uploads: 0, uploadMs: 0, maxFrameUploadMs: 0, compiles: 0, reveals: 0, evictions: 0, texturesDisposed: 0, cpuReleased: 0, deferred: 0, budgetEvictions: 0, deferStalls: 0, lastDefer: null, lastStall: null };
    let ctx = null;                        // { renderer, scene, camera, groupOf(id) }
    let uploadQueue = [];                  // { tex, zone, rank }
    const looseUploads = new Set();

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
    function dressOf(g) { return g && g.children.find(child => child.userData.streamDress); }
    function hideZone(rec, g) {
      if (!rec.spec.keepShell) { hideObject(g); return; }
      g.children.forEach(child => { if (child.userData.streamDress) hideObject(child); });
    }
    function apiFor(rec) {
      const attempt = rec.timing;
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
        recordAssetTime(stage, elapsed) {
          if (attempt !== rec.timing || !attempt || rec.state !== 'loading') return;
          attempt[stage] = (attempt[stage] || 0) + elapsed;
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
        if (!t.image) {
          if (rec && rec.spec.requireComplete) rec.failed = new Error('Missing pixels for ' + (t.name || 'zone texture'));
          return;
        }
        const pending = rec ? rec.pending : looseUploads;
        if (pending.has(t)) return;
        pending.add(t);
        uploadQueue.push({ tex: t, zone: rec, rank: rank || 0 });
      });
    }
    function pumpUploads() {
      const renderer = ctx && ctx.renderer;
      if (!renderer || typeof renderer.initTexture !== 'function') {
        uploadQueue.length = 0; looseUploads.clear();
        zones.forEach(r => {
          if (r.spec.requireComplete && r.pending.size) r.failed = new Error('Texture upload unavailable');
          r.pending.clear();
        });
        return;
      }
      if (!uploadQueue.length) return;
      uploadQueue.sort((a, b) => a.rank - b.rank);
      const t0 = now(); let n = 0;
      while (uploadQueue.length && n < o.uploadsPerFrame) {
        if (n > 0 && now() - t0 > o.uploadMsPerFrame) break;
        const job = uploadQueue.shift();
        const t = job.tex;
        try { capOne(t); } catch (_) {}
        try { if (t.image && !uploaded(renderer, t)) { renderer.initTexture(t); n++; stats.uploads++; } } catch (_) {}
        if (job.zone) {
          job.zone.pending.delete(t);
          if (job.zone.spec.requireComplete && !uploaded(renderer, t)) {
            job.zone.failed = new Error('GPU upload failed for ' + (t.name || 'zone texture'));
          }
        } else looseUploads.delete(t);
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
    // Cost of a room: what it measured the last time it was prepared (process
    // estimate after its reveal minus before its start, taken only when no
    // other room loaded or unloaded meanwhile), else the authored estimate.
    function incoming(rec) {
      const s = (rec && rec.spec) || {};
      if (s.estimateIncoming) return s.estimateIncoming(usage());
      const est = {
        processMB: s.estProcessMB != null ? +s.estProcessMB : o.defaultZoneProcessMB,
        gpuMB: s.estGpuMB != null ? +s.estGpuMB : o.defaultZoneGpuMB,
        cpuMB: s.estCpuMB != null ? +s.estCpuMB : o.defaultZoneCpuMB
      };
      const m = rec && rec.measured;
      if (!m) return est;
      // Never trust a measurement below a quarter of the authored figure.
      return {
        processMB: Math.max(m.processMB * 1.1, est.processMB * 0.25),
        gpuMB: Math.max(m.gpuMB * 1.1, est.gpuMB * 0.25),
        cpuMB: est.cpuMB
      };
    }
    function measureStart(rec) {
      const u = usage();
      rec._measure = { t: sampleTime(), processMB: u.processMB, gpuMB: u.gpuMB, evictions: stats.evictions, reveals: stats.reveals, starts: stats.starts || 0 };
    }
    // Called from update(): once a sample newer than the reveal exists.
    function measureFinish(rec) {
      const a = rec._measure;
      if (!a || !rec.revealedWall) return;
      const t = sampleTime();
      if (!t || t < rec.revealedWall + 400) return;
      rec._measure = null;
      if (stats.evictions !== a.evictions || stats.reveals !== a.reveals + 1 || (stats.starts || 0) !== a.starts + 1) return;
      const u = usage();
      const dp = u.processMB - a.processMB, dg = u.gpuMB - a.gpuMB;
      if (dp > 1 && dg >= 0) rec.measured = { processMB: dp, gpuMB: dg, at: Date.now() };
    }
    // Memory that is committed but not yet in the last usage sample: rooms
    // still being prepared, and rooms revealed after that sample was taken
    // (the estimate is refreshed on a ~500 ms cadence). Counting them stops
    // a second admission from stacking on a stale figure — the reason the
    // old 650 MB path needed "no-stack" / "swap" special cases.
    function sampleTime() {
      try {
        const PM = (typeof window !== 'undefined' && window.SinProcessMemory) || (typeof globalThis !== 'undefined' && globalThis.SinProcessMemory);
        const u = PM && PM.last && PM.last();
        return u && u.t ? u.t : 0;
      } catch (_) { return 0; }
    }
    function committed(except) {
      const out = { processMB: 0, gpuMB: 0, cpuMB: 0 };
      const sampledAt = sampleTime();
      zones.forEach(function (r) {
        if (r === except) return;
        const preparing = r.state === 'loading' || r.state === 'uploading' || r.state === 'compiling';
        const unsampled = r.state === 'ready' && r.revealedWall && sampledAt && sampledAt < r.revealedWall;
        if (!preparing && !unsampled) return;
        const e = incoming(r);
        out.processMB += e.processMB; out.gpuMB += e.gpuMB; out.cpuMB += preparing ? e.cpuMB : 0;
      });
      return out;
    }
    function wouldExceed(extra, transientCpu) {
      extra = extra || { processMB: 0, gpuMB: 0, cpuMB: 0 };
      const u = usage();
      return (o.processBudgetMB > 0 && u.processMB + extra.processMB > o.processBudgetMB)
        || (o.gpuBudgetMB > 0 && u.gpuMB + extra.gpuMB > o.gpuBudgetMB)
        || (o.cpuBudgetMB > 0 && (transientCpu ? 0 : u.cpuMB) + extra.cpuMB > o.cpuBudgetMB);
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
        if (r.isCurrent || r.visible || r.retained) return;
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
    function evictToFit(extra, transientCpu) {
      if (!wouldExceed(extra, transientCpu)) return true;
      for (let pass = 0; pass < 2 && wouldExceed(extra, transientCpu); pass++) {
        const idle = evictCandidates(pass === 1);
        for (let i = 0; i < idle.length && wouldExceed(extra, transientCpu); i++) {
          if (idle[i].state === 'cold') continue;
          evict(idle[i], 'budget');
          stats.budgetEvictions++;
        }
      }
      return !wouldExceed(extra, transientCpu);
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
        if (r.state === 'cold' || r.isCurrent || r.visible || r.retained) return;
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
        if (r.state === 'cold' || r.isCurrent || r.visible || r.retained) return;
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
      if (rec.spec.requireComplete) {
        const serial = rec.spec.serialPreparation;
        const busy = function (other) {
          return other !== rec && other.spec.serialPreparation &&
            (other.state === 'loading' || other.state === 'uploading' || other.state === 'compiling');
        };
        // The room the hero stands in never waits behind a speculative
        // preparation (prefetch / cooldown rank >= 2, not on screen): that
        // one is abandoned and restarts later. Seen on a failed-and-retried
        // current room that queued a full minute behind a prefetch.
        if (serial && rec.isCurrent) {
          order.forEach(function (id) {
            const other = zones.get(id);
            if (busy(other) && !other.isCurrent && !other.visible && !other.retained && (other.rank == null || other.rank >= 2)) {
              evict(other, 'yield-to-current');
              stats.budgetEvictions++;
            }
          });
        }
        if (serial && order.some(id => busy(zones.get(id)))) return false;
        // An open sight line can show two dressed rooms at once. Use the
        // device's measured memory budget instead of forcibly swapping them.
        // For a serial preparation, the CPU sub-budget is for the new decode.
        // Resident CPU bytes are already included in the hard process budget.
        if (evictToFit(incoming(rec), serial)) { rec.deferredAt = 0; rec.deferred = false; return true; }
        if (!rec.deferredAt) { rec.deferredAt = now(); stats.deferred++; }
        rec.deferred = true;
        return false;
      }
      const extra = incoming(rec);
      if (rec.isCurrent) {
        evictForCurrent(extra);
        // Admit only when the incoming room fits AFTER eviction. Do not
        // use roomFitsAlone here: that ignores leftover residency (the
        // still-resident city) and would exceed the cap on the first
        // frame. roomFitsAlone is the last-resort admit inside
        // handleDeferStall, after onBudgetStall has had two chances to
        // drop leftovers.
        if (!wouldExceed(extra) || evictToFit(extra)) {
          rec.deferred = false; rec.deferredAt = 0; return true;
        }
      } else {
        // Prefetch: start only if it fits without evicting the current room.
        // Never override the budget. Never compete with a current-room load
        // that is still in flight. On the 650 phone, SWAP leftover dress
        // (the room we just left, even if hops<=1 / still marked visible)
        // so an approach prefetch cannot stack K2+K3 to 658 MB.
        evictNonAdjacent('non-adjacent-before-prefetch');
        if (o.processBudgetMB > 0 && o.processBudgetMB <= 650) {
          evictPreparedFirst('prepared-before-prefetch', true);
          zones.forEach(function (r) {
            if (r.state === 'cold' || r.isCurrent || r.visible || r.retained || r.id === rec.id) return;
            evict(r, 'swap-before-prefetch');
            stats.budgetEvictions++;
          });
        }
        // Never stack two dress rooms on the 650 phone. usage() can be
        // stale (483 vs a real 592), so the 40 MB headroom still admitted
        // K3 on top of current K2 (lab peak 658.8 on 79aee3b). If any
        // other zone is still resident — the current room cannot be
        // evicted — defer this prefetch until that room can be swapped.
        if (o.processBudgetMB > 0 && o.processBudgetMB <= 650) {
          let stacked = false;
          zones.forEach(function (r) {
            if (r.state === 'cold' || r.id === rec.id) return;
            stacked = true;
          });
          if (stacked) {
            if (!rec.deferred) {
              rec.deferred = true;
              rec.deferredAt = now();
              rec.stallAttempts = 0;
              stats.deferred++;
              stats.lastDefer = { id: rec.id, at: rec.deferredAt, usage: usage(), incoming: extra, reason: 'no-stack' };
              note('load', rec.id + ' deferred — no-stack (another zone still resident)');
            }
            return false;
          }
        }
        // 40 MB prefetch headroom: K2 at 592 + est 50 passed the raw 650
        // check but K3's real cost (~66) stacked to 658. Defer until the
        // room just left can be evicted (swap), then admit.
        const prefetchExtra = (o.processBudgetMB > 0 && o.processBudgetMB <= 650)
          ? { processMB: extra.processMB + 40, gpuMB: extra.gpuMB, cpuMB: extra.cpuMB }
          : extra;
        // Desktop: a more important room (sight line > predicted route >
        // distance prefetch > cooldown) may displace strictly less important
        // resident rooms. Equal ranks never displace each other (no thrash),
        // and current / visible / retained rooms are never touched.
        if (!(o.processBudgetMB > 0 && o.processBudgetMB <= 650) && wouldExceed(prefetchExtra) && rec.rank != null && rec.rank < 5) {
          const lower = [];
          zones.forEach(function (r) {
            // Only finished rooms yield: aborting an in-flight preparation
            // for a speculative one throws the work away (load thrash).
            if (r === rec || r.state !== 'ready' || r.isCurrent || r.visible || r.retained) return;
            if ((r.rank == null ? 9 : r.rank) > rec.rank) lower.push(r);
          });
          lower.sort(function (a, b) { return (b.rank - a.rank) || ((b.hops || 0) - (a.hops || 0)) || ((a.lastWanted || 0) - (b.lastWanted || 0)); });
          for (let i = 0; i < lower.length && wouldExceed(prefetchExtra); i++) {
            evict(lower[i], 'lower-priority (' + lower[i].rank + ' < ' + rec.id + ':' + rec.rank + ')');
            stats.budgetEvictions++;
          }
        }
        if (!wouldExceed(prefetchExtra)) {
          if (o.processBudgetMB > 0 && o.processBudgetMB <= 650) {
            let currentBusy = false;
            zones.forEach(function (r) {
              if (r.isCurrent && r.state !== 'ready' && r.state !== 'cold') currentBusy = true;
            });
            if (currentBusy) return false;
          }
          rec.deferred = false; rec.deferredAt = 0; return true;
        }
        // Over budget: fall through and record a defer so the door stays
        // closed and stats.lastDefer is visible to tests and the overlay.
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
    // ---- distance (metric) admission ----------------------------------------
    // rank = walking distance in metres from the hero (current room 0). The
    // nearest wanted room is prepared first; to make memory for it, only
    // rooms FARTHER than it may be unloaded (farthest first). A nearer room
    // is never dropped for a farther one, so there is no swap thrash, and
    // the room the hero stands in can take memory from every other room
    // that is not on screen.
    function rankOf(r) { return r.isCurrent ? 0 : (r.rank == null ? 1e6 : r.rank); }
    function fitsWith(extra, rec) {
      const c = committed(rec);
      return !wouldExceed({ processMB: extra.processMB + c.processMB, gpuMB: extra.gpuMB + c.gpuMB, cpuMB: extra.cpuMB + c.cpuMB }, !!rec.spec.serialPreparation);
    }
    // Resident / preparing rooms that may be unloaded to make memory for rec:
    // never the current, demanded, on-screen or door-held ones, and (unless
    // rec is where the hero is) only rooms farther than rec. Farthest first.
    function victimsFor(rec, skip) {
      const victims = [];
      zones.forEach(function (r) {
        if (r === rec || r === skip || r.state === 'cold' || r.state === 'failed') return;
        if (r.isCurrent || r.isDemand || r.visible || r.retained) return;
        if (rankOf(r) <= rankOf(rec) && !(rec.isCurrent || rec.isDemand)) return;
        victims.push(r);
      });
      return victims.sort(function (a, b) { return rankOf(b) - rankOf(a); });
    }
    function freedBy(list) {
      return list.reduce(function (sum, v) { const e = incoming(v); return { processMB: sum.processMB + e.processMB, gpuMB: sum.gpuMB + e.gpuMB, cpuMB: sum.cpuMB + e.cpuMB }; }, { processMB: 0, gpuMB: 0, cpuMB: 0 });
    }
    function busySerial(rec) {
      let busy = null;
      zones.forEach(function (other) {
        if (other !== rec && other.spec.serialPreparation &&
          (other.state === 'loading' || other.state === 'uploading' || other.state === 'compiling')) busy = other;
      });
      return busy;
    }
    // True when no serial preparation stands in rec's way (any that did has
    // been abandoned for it). A speculative preparation yields when the hero
    // is in, or about to reach, a room that is much nearer (its work
    // restarts later) — at whatever step it is, including the GLB load
    // itself. A nearer room that would still be waiting for memory does not
    // abandon it (that would only churn the farther preparation every frame).
    // (A preparation is never on screen, so a door holding its room does not
    // stop it from yielding: only finished rooms are held.)
    function yieldFor(rec) {
      const busy = busySerial(rec);
      if (!busy) return true;
      if (busy.isCurrent || busy.isDemand || busy.visible) return false;
      if (!(rec.isCurrent || rec.isDemand || (rankOf(rec) < 24 && rankOf(rec) + 15 < rankOf(busy)))) return false;
      if (!rec.isCurrent && !rec.isDemand) {
        const need = incoming(rec), freed = freedBy([busy].concat(victimsFor(rec, busy)));
        if (!fitsWith({ processMB: need.processMB - freed.processMB, gpuMB: need.gpuMB - freed.gpuMB, cpuMB: need.cpuMB - freed.cpuMB }, rec)) return false;
      }
      evict(busy, rec.isCurrent ? 'yield-to-current' : 'yield-to-nearer');
      stats.budgetEvictions++;
      return true;
    }
    function canStartMetric(rec) {
      if (rec.spec.serialPreparation && !yieldFor(rec)) return false;
      const need = incoming(rec);
      if (!fitsWith(need, rec)) {
        const victims = victimsFor(rec);
        // Unload only when that actually makes room: dropping a farther room
        // that frees too little would just reload it a moment later (thrash).
        const freed = freedBy(victims);
        freed.cpuMB = 0;
        const enough = fitsWith({ processMB: need.processMB - freed.processMB, gpuMB: need.gpuMB - freed.gpuMB, cpuMB: need.cpuMB }, rec);
        for (let i = 0; enough && i < victims.length && !fitsWith(need, rec); i++) {
          evict(victims[i], 'farther (' + Math.round(rankOf(victims[i])) + ' m > ' + Math.round(rankOf(rec)) + ' m)');
          stats.budgetEvictions++;
        }
      }
      if (fitsWith(need, rec)) { rec.deferred = false; rec.deferredAt = 0; return true; }
      // The room the hero stands in (or the closed door he is pushing) must
      // never wait on leftovers the estimate still carries (city / orphans):
      // ask the host once per stall window, then admit when the room fits
      // the device alone.
      if (rec.isCurrent || rec.isDemand) {
        const t = now();
        if (!rec.deferredAt) rec.deferredAt = t;
        if (t - rec.deferredAt >= (o.deferStallMs != null ? o.deferStallMs : 3000) && !stallBusy) {
          stallBusy = true;
          try { if (typeof o.onBudgetStall === 'function') o.onBudgetStall(rec, report()); } catch (e) { console.warn('onBudgetStall', e); }
          finally { stallBusy = false; }
          rec.stallAttempts = (rec.stallAttempts || 0) + 1;
          rec.deferredAt = t;
          // A room only kept for a nearby door (not on screen) yields too.
          const held = [];
          zones.forEach(function (r) {
            if (r !== rec && r.state !== 'cold' && r.state !== 'failed' && !r.isCurrent && !r.isDemand && !r.visible) held.push(r);
          });
          held.sort(function (a, b) { return rankOf(b) - rankOf(a); });
          for (let i = 0; i < held.length && !fitsWith(need, rec); i++) {
            const v = held[i];
            v.retained = false;
            evict(v, 'yield-to-waiting-hero'); stats.budgetEvictions++;
          }
          // Last resort for the room the hero is in / at: admit slightly over
          // the soft budget (never past the hard ceiling) rather than leave
          // him at a closed door; everything else that is not on screen has
          // already been unloaded for it.
          const u = usage(), c = committed(rec);
          const ceiling = o.processBudgetMB > 0 ? o.processBudgetMB * (o.hardCeiling || 1.1) : Infinity;
          if (fitsWith(need, rec) || (rec.stallAttempts >= 2 && roomFitsAlone(rec) && u.processMB + c.processMB + need.processMB <= ceiling)) {
            if (!fitsWith(need, rec)) note('load', rec.id + ' admitted over the soft budget (hero waiting)');
            rec.deferred = false; rec.deferredAt = 0; return true;
          }
        }
      }
      if (!rec.deferred) {
        rec.deferred = true;
        if (!rec.deferredAt) rec.deferredAt = now();
        stats.deferred++;
        stats.lastDefer = { id: rec.id, at: now(), usage: usage(), incoming: need, committed: committed(rec), rank: rankOf(rec) };
        note('load', rec.id + ' waiting for memory at ' + Math.round(rankOf(rec)) + ' m (' + JSON.stringify(stats.lastDefer.usage) + ')');
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
      if (rec.spec.serialPreparation) return false;
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
        // Only the CURRENT room may be force-admitted after a stall.
        // Force-admitting a prefetch via roomFitsAlone stacked K2+K3 to 658
        // because the leftover current room was ignored.
        if (!rec.spec.requireComplete && roomFitsAlone(rec) && rec.stallAttempts >= 2 && rec.isCurrent) {
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
      const waiting = rec.firstWait ? t-rec.firstWait : 0;
      rec.timing={ waitMs:Math.max(0,waiting), assetsMs:0, uploadMs:0, compileMs:0, totalMs:0 };
      rec.firstWait=0;
      rec.state = 'loading'; rec.startedAt = t; rec.done = false; rec.failed = null; rec.pending.clear(); rec.loadTicks = 0; rec.prepFrames = 0;
      measureStart(rec); stats.starts = (stats.starts || 0) + 1;
      note('load', rec.id + ' stream start');
      try { rec.spec.load(apiFor(rec)); } catch (e) { rec.failed = e; rec.done = true; console.warn('zone load failed', rec.id, e); }
    }
    function failStrict(rec, error) {
      rec.failed = error;
      rec.state = 'failed';
      rec._currentUntil = 0;
      uploadQueue = uploadQueue.filter(job => job.zone !== rec);
      rec.pending.clear();
      if (rec.spec.onFailure) {
        try { rec.spec.onFailure(error); } catch (cause) { console.warn('zone failure cleanup', rec.id, cause); }
      }
      evict(rec, 'forced');
      rec.state = 'failed';
      rec.failed = error;
      note('load', rec.id + ' failed: ' + String(error));
    }
    function complete(rec) {
      if (rec.done) return true;
      try { if (rec.spec.isComplete && rec.spec.isComplete()) return true; } catch (_) {}
      return false;
    }
    function step(rec, t, rank) {
      if (rec.state === 'failed') return;
      rec.prepFrames = (rec.prepFrames || 0) + 1;
      const g = group(rec);
      if (rec.spec.requireComplete && rec.failed) { failStrict(rec, rec.failed); return; }
      if (rec.state === 'loading') {
        const elapsed = t - rec.startedAt;
        const done = complete(rec);
        const failed = !!rec.failed;
        const abandonAt = rec.spec.abandonMs != null ? rec.spec.abandonMs
          : (rec.spec.timeoutMs != null && rec.spec.timeoutMs > 30000 ? rec.spec.timeoutMs : (o.defaultAbandonMs || 60000));
        // A short timeoutMs (legacy 14 s) must NOT reveal a still-loading room:
        // on a phone the 6.8 MB K2 table often arrives after that, which was
        // the visible pop-in. Only complete, fail(), or a long abandon reveal.
        // ...and only after enough frames: a slow frame rate must not fail a
        // healthy room (at 30 fps the time limit is always the one that hits).
        rec.loadTicks = (rec.loadTicks || 0) + 1;
        const abandon = elapsed > abandonAt && rec.loadTicks > Math.min(600, abandonAt / 100);
        if (rec.spec.requireComplete && !done && abandon) {
          failStrict(rec, new Error('Room preparation timed out'));
          return;
        }
        if (done || failed || abandon) {
          if (!done) note('load', rec.id + (failed ? ' failed' : ' abandoned') + ' after ' + Math.round(elapsed) + ' ms — revealing what is present');
          rec.state = 'uploading'; rec.timing.assetsMs=elapsed;
          // Program-affecting material tweaks run before upload/compile.
          try { if (rec.spec.prepare) rec.spec.prepare(apiFor(rec)); } catch (e) { console.warn('zone prepare', rec.id, e); }
          const uploadRoot = rec.spec.keepShell ? dressOf(g) : g;
          if (uploadRoot) queueTextures(rec, uploadRoot, rank);
        }
      }
      if (rec.spec.requireComplete && rec.failed) { failStrict(rec, rec.failed); return; }
      if (rec.state === 'uploading' && rec.pending.size === 0) {
        if (rec.spec.prepareGeometry) {
          try {
            if (!rec.spec.prepareGeometry(apiFor(rec), ctx && ctx.renderer)) return;
          } catch (error) { failStrict(rec, error); return; }
        }
        rec.state = 'compiling'; rec.timing.uploadMs=now()-rec.startedAt-rec.timing.assetsMs;
        const r = ctx && ctx.renderer;
        rec.compileDone = false;
        rec.compileJob = null;
        if (g && r && ctx.camera && slicedCompileSupported(r)) {
          // Sliced, off-screen: one fresh program at a time, each finished on
          // the GPU before the next, uniforms fetched before the reveal.
          const content = (rec.spec.keepShell && dressOf(g)) || g;
          rec.compileJob = { list: drawables(content), i: 0, fence: null, waiting: [], uniforms: [], attempt: rec.startedAt };
          stats.compiles++;
        } else {
          let p = null;
          if (g && r && ctx.camera) {
            const was = g.visible;
            try {
              // Compile against the real scene so the programs match what the
              // renderer will use (lights, fog, env): no compile at reveal.
              const content = rec.spec.requireComplete && rec.spec.keepShell && dressOf(g);
              if (content) g.visible = false; // include content lights exactly once
              p = compileWith(r, content || g, true);
              stats.compiles++;
            } catch (error) {
              if (rec.spec.requireComplete) { failStrict(rec, error); return; }
              p = null;
            } finally {
              g.visible = was;
            }
          }
          const fin = function () { if (rec.state === 'compiling') rec.compileDone = true; };
          if (p && typeof p.then === 'function') {
            const attempt = rec.startedAt;
            p.then(() => { if (rec.startedAt === attempt) fin(); }, error => {
              if (rec.startedAt !== attempt || rec.state !== 'compiling') return;
              if (rec.spec.requireComplete) failStrict(rec, error); else fin();
            });
          } else fin();
        }
      }
      if (rec.state === 'compiling' && rec.compileJob && !rec.compileDone) {
        try { if (pumpCompile(rec)) rec.compileDone = true; }
        catch (error) { if (rec.spec.requireComplete) { failStrict(rec, error); return; } rec.compileDone = true; }
      }
      if (rec.state === 'compiling' && rec.compileDone) reveal(rec);
      // Gate: a room is never world-visible before the atomic reveal, even
      // if a mesh was added without hideUntilReady or a leftover shell
      // stayed visible after eviction. The door waits on state === 'ready'.
      if (rec.state !== 'ready' && g) hideZone(rec, g);
    }
    // ---- off-screen shader preparation ----------------------------------------
    // With the palace light rig active the layout is fixed, so compiling
    // against the rig's configuration yields exactly the programs the real
    // frame uses. Without it, the old path compiles against the live scene.
    function lightRig() {
      const L = (typeof window !== 'undefined' && window.SinLightRig) || null;
      return L && L.active && L.active() ? L : null;
    }
    function compileWith(r, root, wantAsync) {
      const rig = lightRig();
      if (rig) return wantAsync ? rig.compileAsync(r, root, ctx.camera) : rig.compile(r, root, ctx.camera);
      if (wantAsync && typeof r.compileAsync === 'function') return r.compileAsync(root, ctx.camera, ctx.scene || null);
      if (typeof r.compile === 'function') return r.compile(root, ctx.camera, ctx.scene || null);
      return null;
    }
    function slicedCompileSupported(r) {
      return typeof r.compile === 'function' && r.info && Array.isArray(r.info.programs) &&
        typeof r.getContext === 'function' && !!lightRig();
    }
    function drawables(root) {
      const list = [];
      root.traverse(function (x) { if ((x.isMesh || x.isPoints || x.isLine || x.isSprite) && x.material) list.push(x); });
      return list;
    }
    function parallelCompile(r) {
      try { return !!(r.extensions && r.extensions.has && r.extensions.has('KHR_parallel_shader_compile')); } catch (_) { return false; }
    }
    // Returns true when every program of the room is linked and its uniform
    // locations are cached (so the reveal frame issues no blocking query).
    function pumpCompile(rec) {
      const job = rec.compileJob, r = ctx.renderer, gl = r.getContext();
      if (job.fence) {
        const st = gl.clientWaitSync(job.fence, 0, 0);
        if (st === gl.TIMEOUT_EXPIRED) return false;
        gl.deleteSync(job.fence); job.fence = null;
      }
      if (job.waiting.length) {
        job.waiting = job.waiting.filter(p => { try { return !p.isReady(); } catch (_) { return false; } });
        if (job.waiting.length) return false;
      }
      // First use of a linked program queries every uniform location (a
      // blocking round trip per uniform on WebKit). Do it here, one program
      // per frame, instead of in the reveal frame.
      if (job.uniforms.length) {
        const p = job.uniforms.shift();
        try { p.getUniforms(); p.getAttributes(); } catch (_) {}
        if (job.uniforms.length) return false;
      }
      const t0 = now(), par = parallelCompile(r);
      if (job.i >= job.list.length && !job.fence && !job.waiting.length) return warmDraw(job);
      while (job.i < job.list.length && now() - t0 < o.compileMsPerFrame) {
        const obj = job.list[job.i++];
        if (!obj.parent) continue;
        const before = r.info.programs.length;
        compileWith(r, obj, false);
        const fresh = r.info.programs.slice(before);
        if (fresh.length) {
          fresh.forEach(p => job.uniforms.push(p));
          if (par) job.waiting.push.apply(job.waiting, fresh);
          else { try { job.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); } catch (_) { job.fence = null; } }
          stats.programsLinked = (stats.programsLinked || 0) + fresh.length;
          return false;
        }
      }
      return false;
    }
    // Last step before the reveal: draw every mesh of the room once, with its
    // real material and the fixed light layout, but collapsed to a point
    // (zero scale: nothing is rasterised, nothing shows). The driver uploads
    // the vertex buffers and builds the GPU pipeline state now, a few meshes
    // per frame, instead of in the reveal frame.
    let warmCam = null;
    function warmDraw(job) {
      const T = (typeof window !== 'undefined' && window.THREE) || null;
      const rig = lightRig(), r = ctx.renderer;
      if (!T || !rig || !rig.compileScene || typeof r.render !== 'function') return true;
      if (!job.warm) job.warm = job.list.filter(x => (x.isMesh && !x.isSkinnedMesh && !x.isBatchedMesh) && x.parent && x.geometry);
      if (!job.warm.length) return true;
      if (!warmCam) { warmCam = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 10); warmCam.position.set(0, -1e5, 0); warmCam.updateMatrixWorld(true); }
      const stage = rig.compileScene(ctx.scene);
      const proxies = [];
      const t0 = now();
      while (job.warm.length && proxies.length < 8 && now() - t0 < o.compileMsPerFrame) {
        const src = job.warm.shift();
        let p;
        if (src.isInstancedMesh) {
          p = new T.InstancedMesh(src.geometry, src.material, 0);
          p.instanceMatrix = src.instanceMatrix; p.instanceColor = src.instanceColor; p.count = src.count;
          if (src.morphTexture) p.morphTexture = src.morphTexture;
        } else {
          p = new T.Mesh(src.geometry, src.material);
          if (src.morphTargetInfluences) p.morphTargetInfluences = src.morphTargetInfluences;
        }
        p.matrixAutoUpdate = false; p.matrix.makeScale(0, 0, 0); p.matrixWorld.makeScale(0, 0, 0); p.matrixWorldNeedsUpdate = true;
        p.frustumCulled = false; p.renderOrder = src.renderOrder;
        stage.add(p); proxies.push(p);
      }
      const clear = r.autoClear, target = r.getRenderTarget ? r.getRenderTarget() : null;
      try {
        r.autoClear = false;
        if (target && r.setRenderTarget) r.setRenderTarget(null);
        r.render(stage, warmCam);
      } catch (_) {
      } finally {
        r.autoClear = clear;
        if (target && r.setRenderTarget) r.setRenderTarget(target);
        proxies.forEach(p => { stage.remove(p); if (p.isInstancedMesh) { p.instanceMatrix = null; p.instanceColor = null; } });
      }
      return !job.warm.length;
    }
    function reveal(rec) {
      const g = group(rec);
      rec.state = 'ready';
      const elapsed=now()-rec.startedAt;
      rec.timing.compileMs=Math.max(0,elapsed-rec.timing.assetsMs-rec.timing.uploadMs);
      rec.timing.totalMs=elapsed;
      rec.leadMs=rec.leadMs?rec.leadMs*.6+elapsed*.4:elapsed;
      rec.revealedWall = Date.now();
      const n = g ? revealObject(g) : 0;
      if (g) g.userData.dressReady = true;
      stats.reveals++;
      note('load', rec.id + ' ready (' + n + ' meshes, ' + Math.round(now() - rec.startedAt) + ' ms, ' + (rec.prepFrames || 0) + ' frames)');
      if (rec.spec.onReady) try { rec.spec.onReady(apiFor(rec)); } catch (_) {}
      const w = rec.waiters.splice(0); w.forEach(fn => { try { fn(rec.id); } catch (_) {} });
    }
    function evict(rec, why) {
      // The current room is never evicted to make room for prefetch, and a
      // one-frame current flicker must not abort an in-flight load (playthrough-4
      // first K4 was evicted mid-parse and re-dressed five times over 60 s).
      if (why !== 'forced') {
        if (rec.visible || rec.retained) return 0;
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
      const keep = new Set(), keptGeometries = new Set(), keptMaterials = new Set();
      const geometries = new Set(), materials = new Set(), textures = new Set();
      // Textures still used by anything else stay (shared templates).
      if (g && ctx && ctx.scene) {
        const doomedSet = new Set(doomed);
        ctx.scene.traverse(function (x) {
          for (let n = x; n; n = n.parent) if (doomedSet.has(n)) return;
          if (x.geometry) keptGeometries.add(x.geometry);
          materialsOf(x).forEach(m => {
            if (!m) return;
            keptMaterials.add(m);
            TEX_KEYS.forEach(k => { if (m[k]) keep.add(m[k]); });
          });
        });
      }
      doomed.forEach(function (ch) {
        g.remove(ch);
        ch.traverse(function (x) {
          if (x.isInstancedMesh && x.dispose) x.dispose();
          if (x.geometry && !keptGeometries.has(x.geometry)) geometries.add(x.geometry);
          materialsOf(x).forEach(function (m) {
            if (!m || keptMaterials.has(m) || (m.userData && m.userData.palaceShared)) return;
            TEX_KEYS.forEach(function (k) {
              const t = m[k];
              // Every unshared texture this zone owned is released on the GPU.
              // The previous condition (sinReleaseCpu && !image) skipped maps
              // whose CPU pixels were still present (including canvas-capped
              // phone textures), so repeated leave/return accumulated GPU
              // memory until Safari killed the tab.
              if (t && !keep.has(t) && !(t.userData && t.userData.palaceShared)) {
                textures.add(t);
              }
            });
            materials.add(m);
          });
        });
      });
      geometries.forEach(g => { if (g.dispose) g.dispose(); });
      materials.forEach(m => { if (m.dispose) m.dispose(); });
      const keptSources = new Set(Array.from(keep, t => t.source));
      textures.forEach(t => {
        const pending = releasable.get(t.source);
        if (pending) {
          pending.delete(t);
          if (!pending.size) {
            if (!keptSources.has(t.source) && t.image && typeof t.image.close === 'function') t.image.close();
            releasable.delete(t.source);
          }
        }
        t.dispose();
        stats.texturesDisposed++;
      });
      uploadQueue = uploadQueue.filter(j => {
        if (textures.has(j.tex)) { looseUploads.delete(j.tex); return false; }
        return j.zone !== rec;
      });
      rec.pending.clear();
      try { if (rec.spec.unload) rec.spec.unload(apiFor(rec)); } catch (e) { console.warn('zone unload', rec.id, e); }
      if (g) {
        forgetWarm(g);
        const queueIndex = warmQ.indexOf(g);
        if (queueIndex >= 0) warmQ.splice(queueIndex, 1);
        g.userData.dressReady = false;
        // Shells are not in `doomed` (ownsObject is streamDress only).
        // They were revealed on the previous visit; hide them so the
        // next load cannot show an incomplete room.
        hideZone(rec, g);
      }
      if (rec.compileJob && rec.compileJob.fence && ctx && ctx.renderer && ctx.renderer.getContext) {
        try { ctx.renderer.getContext().deleteSync(rec.compileJob.fence); } catch (_) {}
      }
      rec.compileJob = null;
      rec.state = 'cold'; rec.leftAt = 0; rec.done = false; rec.failed = null;
      stats.evictions++;
      note('unload', rec.id + ' evicted (' + why + ', ' + doomed.length + ' objects)');
      try { console.info('[palace load] evict', rec.id, why, doomed.length); } catch (_) {}
      return doomed.length;
    }

    // ---- memory pressure (migrated from smart-memory-manager.js) -----------
    // Never changes render resolution. Only informs LRU cache size.
    let memLevel = 'normal', memStableMs = 0, memFrameEma = 16.7, memLast = { level: 'normal', geometryRatio: 0, textureRatio: 0, frameMs: 16.7 };
    const memOpt = { geometryBudget: o.geometryBudget || 420, textureBudget: o.textureBudget || 180, watchRatio: 0.88, criticalRatio: 0.97, recoveryMs: 2500 };
    // Pressure is MEMORY: the process estimate against the device budget.
    // It used to be the renderer's texture COUNT against a 72-texture phone
    // budget (the throne hall alone holds ~100 textures, so a phone sat in
    // "critical" for good and evicted L1 the moment it was ready) and the
    // frame time (a busy frame unloaded rooms, causing more loading). Object
    // counts are only a fallback when no process estimate exists.
    function sample(renderer, frameMs) {
      const memory = renderer && renderer.info && renderer.info.memory || {};
      const gr = Math.max(0, Number(memory.geometries) || 0) / memOpt.geometryBudget;
      const tr = Math.max(0, Number(memory.textures) || 0) / memOpt.textureBudget;
      const ms = Number.isFinite(frameMs) && frameMs > 0 ? frameMs : memFrameEma;
      memFrameEma = memFrameEma * 0.88 + ms * 0.12;
      const u = usage();
      let pressure = 0;
      if (u.processMB > 0 && o.processBudgetMB > 0) pressure = Math.max(pressure, u.processMB / o.processBudgetMB);
      if (u.gpuMB > 0 && o.gpuBudgetMB > 0) pressure = Math.max(pressure, u.gpuMB / o.gpuBudgetMB);
      if (!(u.processMB > 0)) pressure = Math.max(gr, tr);
      const critical = pressure >= memOpt.criticalRatio;
      const watch = pressure >= memOpt.watchRatio;
      if (critical) { memLevel = 'critical'; memStableMs = 0; }
      else if (watch) { memLevel = 'watch'; memStableMs = 0; }
      else if (memLevel !== 'normal') { memStableMs += Math.max(0, ms); if (memStableMs >= memOpt.recoveryMs) memLevel = 'normal'; }
      else memStableMs = Math.min(memOpt.recoveryMs, memStableMs + Math.max(0, ms));
      memLast = { level: memLevel, pressure: +pressure.toFixed(3), geometryRatio: gr, textureRatio: tr, frameMs: memFrameEma };
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
          pending = compileWith(r, g, true);
          stats.compiles++;
        } finally { g.visible = was; }
      } catch (_) { g.visible = was; warmBusy = false; return; }
      const fin = function () { warmBusy = false; pumpUploads(); };
      if (pending && typeof pending.then === 'function') pending.then(fin, fin); else fin();
    }

    // ---- distance (metric) policy -------------------------------------------
    // view = { metric:true, current, rank: Map(id -> metres), approach: Set
    //   (inside the load radius), keep: Set (inside the release radius),
    //   visible: Set (drawn this frame), retained: Set (moving doors),
    //   demand (a door the hero waits at), memoryLevel, warmGroups }
    // Loading is decided by walking distance only. What the camera sees only
    // PROTECTS rooms from eviction (nothing disappears on screen); it never
    // starts a load.
    let lastMetric = false;
    function has(set, k) { return !!(set && (set.has ? set.has(k) : set.indexOf(k) >= 0)); }
    function updateMetric(view, t, level) {
      lastMetric = true;
      const visible = view.visible || new Set(), retained = view.retained || new Set();
      const rankMap = view.rank || new Map();
      const wanted = [];
      order.forEach(function (id) {
        const rec = zones.get(id);
        const isCurrent = id === view.current;
        const resident = rec.state !== 'cold' && rec.state !== 'failed';
        const want = (!view.only || view.only.has(id)) && (isCurrent || id === view.demand || has(view.approach, id) ||
          (resident && (has(view.keep, id) || visible.has(id) || retained.has(id))));
        rec.rank = isCurrent ? 0 : (rankMap.has(id) ? rankMap.get(id) : 1e6);
        rec.hops = rec.rank;
        rec.visible = visible.has(id); rec.retained = retained.has(id); rec.isCurrent = isCurrent;
        rec.isDemand = id === view.demand;
        rec.protected = isCurrent || rec.isDemand || rec.visible || rec.retained;
        if (isCurrent) rec._currentUntil = t + ((rec.state !== 'cold' && rec.state !== 'ready') ? 15000 : 2000);
        if (want) { rec.lastWanted = t; rec.wantedAt = t; rec.leftAt = 0; wanted.push(rec); }
        else if (rec.state === 'cold') rec.firstWait = 0;
        else if (!rec.leftAt) rec.leftAt = t;
      });
      wanted.sort((a, b) => Number(b.id === view.demand) - Number(a.id === view.demand) ||
        rankOf(a) - rankOf(b) || (a.spec.priority - b.spec.priority));
      const countLoading = () => { let n = 0; zones.forEach(r => { if (r.state === 'loading') n++; }); return n; };
      let loading = countLoading();
      wanted.forEach(function (rec, i) {
        // The nearest wanted room does not wait for a farther speculative
        // preparation to get through its load step (the one-load gate):
        // wanted is sorted nearest first, so it decides before any other.
        if (rec.state === 'cold' && loading >= o.maxConcurrentLoads && !rec.isCurrent && rec.spec.serialPreparation && busySerial(rec) && yieldFor(rec)) loading = countLoading();
        if (rec.state === 'cold' && (loading < o.maxConcurrentLoads || rec.isCurrent)) {
          if (canStartMetric(rec)) { start(rec, t); loading++; }
          else if (!rec.firstWait) rec.firstWait = t;
        }
        if (rec.state !== 'cold' && rec.state !== 'ready') step(rec, t, i);
      });
      // Unload what is no longer within its release radius, after a short
      // linger (desktop keeps a small LRU of finished rooms while memory is
      // normal). A preparation that is no longer wanted is abandoned too.
      const idle = [];
      zones.forEach(function (rec) {
        if (rec.state === 'cold' || rec.state === 'failed' || rec.protected || rec.lastWanted === t || !rec.leftAt) return;
        idle.push(rec);
      });
      idle.sort((a, b) => (b.lastWanted || 0) - (a.lastWanted || 0));
      const cache = level === 'normal' && o.cacheZones[level] != null ? o.cacheZones[level] : 0;
      const linger = level === 'critical' ? 0 : (o.releaseMs != null ? o.releaseMs : 2500);
      let kept = 0, evicted = 0;
      idle.forEach(function (rec) {
        if (rec.state === 'ready' && kept < cache && t - rec.leftAt < o.graceMs) { kept++; return; }
        if (t - rec.leftAt >= linger) { evict(rec, level === 'critical' ? 'critical memory' : 'beyond release radius'); evicted++; }
      });
      zones.forEach(function (rec) {
        if (rec.state === 'ready') { if (rec._measure) measureFinish(rec); return; }
        const gg = group(rec);
        if (gg && !gg.userData.dressReady) hideZone(rec, gg);
      });
      pumpUploads();
      sweepReleasable();
      (view.warmGroups || []).forEach(enqueueWarm);
      if (view.allowBackgroundWarm !== false) pumpWarm();
      return evicted;
    }

    // view = { current, distances: Map(id->hops), visible:Set, prepared:Set, memoryLevel, warmGroups }
    let lastUpdateAt = 0;
    function update(view) {
      const t = now();
      lastUpdateAt = t;
      // Metric policy: a room the hero just left is still a few metres away,
      // so distance alone keeps it wanted — no "current" pinning needed.
      if (view && view.metric) return updateMetric(view, t, view.memoryLevel || memLevel || 'normal');
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
      const retained = view.retained || new Set();
      const level = view.memoryLevel || memLevel || 'normal';
      const wanted = [];
      lastMetric = false;
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
        const approaching = !!(view.approach && (view.approach.has ? view.approach.has(id) : (view.approach.indexOf && view.approach.indexOf(id) >= 0)));
        // Proximity/heading prefetch (wings.js approach set): start the room
        // the player is walking toward early enough that, at run speed, the
        // door can open onto a complete room. Far rooms are evicted first
        // (canStart); over-budget approach still defers rather than exceed 650.
        const passive = !view.motionPrefetch;
        const prefetch = approaching || id===view.demand || (passive && (hops <= rec.spec.prefetchHops || (!tight && prepared.has(id))));
        // `keep` (room-manager cooldown): stay resident while not needed for
        // the budget, but never restart a room that was already evicted.
        const keep = !!(view.keep && view.keep.has(id) && rec.state !== 'cold');
        const want = (!view.only || view.only.has(id)) && (isCurrent || prefetch || keep ||
          (rec.spec.requireComplete && visible.has(id) && (passive || rec.state!=='cold')) || (retained.has(id) && rec.state !== 'cold'));
        // Budget rank (lower = more important): current 0, sight 1,
        // predicted 2, distance prefetch 3, cooldown 4, anything else 9.
        rec.rank = isCurrent ? 0 : (view.rank && view.rank.has(id) ? view.rank.get(id) : (want ? 5 : 9));
        // hops <= 1 protects on desktop; on a 650 MB phone those neighbours
        // yield once evictForCurrent decides the current room needs space.
        const protect = isCurrent || visible.has(id) || retained.has(id) || (passive && !tight && hops <= 1);
        rec.hops = hops; rec.protected = protect; rec.visible = visible.has(id); rec.isCurrent = isCurrent;
        rec.retained = retained.has(id);
        if (isCurrent) rec._currentUntil = t + ((rec.state !== 'cold' && rec.state !== 'ready') ? 15000 : 2000);
        if (want) { rec.lastWanted = t; rec.wantedAt = t; rec.leftAt = 0; wanted.push(rec); }
        else if(rec.state==='cold') rec.firstWait=0;
        else if (!rec.leftAt) rec.leftAt = t;
      });
      // Nearest / visible first. Lower rank = more urgent.
      const demand = view.demand;
      wanted.sort((a, b) => Number(b.id === demand) - Number(a.id === demand) ||
        ((a.rank == null ? 9 : a.rank) - (b.rank == null ? 9 : b.rank)) ||
        (a.hops - b.hops) || (Number(visible.has(b.id)) - Number(visible.has(a.id))) || (a.spec.priority - b.spec.priority));
      let loading = 0;
      zones.forEach(r => { if (r.state === 'loading') loading++; });
      wanted.forEach(function (rec, i) {
        if (rec.state === 'cold' && (loading < o.maxConcurrentLoads || rec.id === view.current)) {
          // Hard cap: evict idle rooms first; if the new room still would
          // not fit, defer. The door gate waits on zoneIsReady, so nothing
          // is revealed incomplete in front of the player.
          if (canStart(rec) || handleDeferStall(rec, t)) { start(rec, t); loading++; }
          else if(!rec.firstWait) rec.firstWait=t;
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
      // Cold or deferred rooms can still have leftover visible shells
      // (evicted dress, resident architecture). Keep them hidden until
      // the next atomic reveal — visBefore must stay 0 regardless of budget.
      zones.forEach(function (rec) {
        if (rec.state === 'ready') return;
        const gg = group(rec);
        if (gg && !gg.userData.dressReady) hideZone(rec, gg);
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
        const keepWarm = rec.spec.requireComplete && t - rec.leftAt < o.graceMs;
        if (level === 'critical' || (!keepWarm && (tight || (overCache && t - rec.leftAt >= o.graceMs)))) {
          evict(rec, level === 'critical' ? 'critical memory' : (tight ? (far ? 'non-adjacent' : 'prepared-before-current') : 'lru'));
          evicted++;
        }
      });
      pumpUploads();
      sweepReleasable();
      // Compile shells of prepared / visible groups (off-screen, one at a time).
      (view.warmGroups || []).forEach(enqueueWarm);
      if (view.allowBackgroundWarm !== false) pumpWarm();
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
          if (!r.spec.requireComplete) r.visible = false;
        }
      });
    }
    function evictNonAdjacent(why) {
      const tight = o.processBudgetMB > 0 && o.processBudgetMB <= 650;
      let n = 0;
      zones.forEach(function (r) {
        if (r.state === 'cold') return;
        if (r.isCurrent || r.visible || r.retained) return;
        // Desktop: a room the planner still wants (sight line, predicted
        // route, cooldown) is not "non-adjacent" just because it is two
        // portals away. Evicting it here made every new prefetch unload the
        // previous one and reload it seconds later (load thrash at doors).
        // The hard budget (evictToFit) can still take it when memory is short.
        if (!tight && r.wantedAt && r.wantedAt === lastUpdateAt) return;
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
      if (lastMetric) {
        markCurrent(id);
        rec.rank = 0;
        if (rec.state === 'cold' && canStartMetric(rec)) start(rec, now());
        rec.lastWanted = now();
        if (rec.state !== 'cold' && rec.state !== 'ready' && rec.state !== 'failed') step(rec, now(), 0);
        return rec.state;
      }
      if (rec.spec.requireComplete && rec.state === 'cold' && !canStart(rec)) return rec.state;
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
      if (!rec.spec.serialPreparation) evictForCurrent(incoming(rec));
      if (rec.state === 'cold') {
        if (!rec.spec.serialPreparation) evictToFit(incoming(rec));
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
      zones.forEach(r => {
        r.state = 'cold'; r.pending.clear(); r.leftAt = 0; r.lastWanted = 0;
        r._currentUntil = 0; r.retained = r.protected = r.visible = r.isCurrent = false;
        r.deferred = false; r.deferredAt = 0; r.done = false; r.waiters.length = 0;
      });
      uploadQueue = []; looseUploads.clear(); releasable.clear(); warmQ.length = 0; warmBusy = false; memLevel = 'normal';
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
      zones.forEach(r => { out.zones[r.id] = { state: r.state, hops: r.hops, pending: r.pending.size, protected: !!r.protected, deferred: !!r.deferred, measuredMB: r.measured ? Math.round(r.measured.processMB) : null, timing:r.timing&&Object.fromEntries(
          Object.entries(r.timing).map(([stage,ms])=>[stage,Math.round(ms)])) }; });
      return out;
    }
    const leadTime=id=>Math.max(3,Math.min(8,((zones.get(id)?.leadMs||5200)+650)/1000));
    return { register, unregister, attach, update, status, isReady, leadTime, whenReady, markReleasable, queueTextures: (obj) => queueTextures(null, obj, 50), pumpUploads, pumpWarm, enqueueWarm, forgetWarm, sample, memoryState, forceEvict, forceLoad, reset, report, hide: hideObject, reveal: revealObject, zones: () => Array.from(order) };
  }
  return { create, HIDE_FLAG };
});
