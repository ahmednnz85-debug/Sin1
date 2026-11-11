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
     when all of the above finished (or `timeoutMs` expired, so a failed
     download never hides a room forever);
   - LRU eviction with hysteresis: zones that are no longer wanted linger for
     `graceMs`, and an LRU cache keeps up to `cacheZones[memoryLevel]` extra
     zones resident; visible / adjacent / wanted zones are never evicted;
     eviction disposes GPU geometry + textures owned by the zone;
   - CPU release after upload: textures marked releasable (parsed GLBs) drop
     their decoded pixels only after the GPU copy exists.

   Spec (all functions optional except load):
     { id: 'K2',                 // region id in the wing layout / portal graph
       prefetchHops: 1,          // start loading this many hops away
       priority: 0,              // lower = uploads first among equal hops
       timeoutMs: 14000,         // reveal anyway after this long
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
      log: null                  // function(kind, msg) for the memory overlay
    }, options || {});

    const zones = new Map();               // id -> record
    const order = [];                      // registration order (stable priority)
    const releasable = new Map();          // source -> Set(textures) waiting for GPU copy
    const stats = { uploads: 0, uploadMs: 0, maxFrameUploadMs: 0, compiles: 0, reveals: 0, evictions: 0, texturesDisposed: 0, cpuReleased: 0 };
    let ctx = null;                        // { renderer, scene, camera, groupOf(id) }
    let uploadQueue = [];                  // { tex, zone, rank }

    function note(kind, msg) { try { if (o.log) o.log(kind, msg); } catch (_) {} }

    function register(spec) {
      if (!spec || !spec.id || typeof spec.load !== 'function') throw new Error('SinZoneStreamer.register: spec needs id + load()');
      const prev = zones.get(spec.id);
      const rec = prev || { id: spec.id, state: 'cold', lastWanted: 0, leftAt: 0, startedAt: 0, pending: new Set(), compilePromise: null, done: false, failed: null, waiters: [] };
      rec.spec = Object.assign({ prefetchHops: 1, priority: 0, timeoutMs: o.defaultTimeoutMs }, spec);
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
      try { t.source.data = null; if (typeof img.close === 'function') img.close(); stats.cpuReleased++; } catch (_) {}
    }
    function queueTextures(rec, obj, rank) {
      const renderer = ctx && ctx.renderer;
      texturesOf(obj).forEach(function (t) {
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
        if (complete(rec) || t - rec.startedAt > rec.spec.timeoutMs) {
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
              // Only textures that cannot be shared any more (pixels released
              // after upload, owned by this zone) are destroyed on the GPU.
              if (t && !keep.has(t) && t.userData && t.userData.sinReleaseCpu && !t.image) { t.dispose(); stats.texturesDisposed++; }
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
      return doomed.length;
    }

    // view = { current, distances: Map(id->hops), visible:Set, prepared:Set, memoryLevel }
    function update(view) {
      const t = now();
      const distances = view.distances || new Map();
      const visible = view.visible || new Set(), prepared = view.prepared || new Set();
      const level = view.memoryLevel || 'normal';
      const wanted = [];
      order.forEach(function (id) {
        const rec = zones.get(id);
        const hops = distances.has(id) ? distances.get(id) : Infinity;
        const want = visible.has(id) || prepared.has(id) || hops <= rec.spec.prefetchHops;
        const protect = want || hops <= 1 || id === view.current;
        rec.hops = hops; rec.protected = protect;
        if (want) { rec.lastWanted = t; rec.leftAt = 0; wanted.push(rec); }
        else if (rec.state !== 'cold' && !rec.leftAt) rec.leftAt = t;
      });
      // Nearest / visible first. Lower rank = more urgent.
      wanted.sort((a, b) => (a.hops - b.hops) || ((visible.has(b.id) ? 1 : 0) - (visible.has(a.id) ? 1 : 0)) || (a.spec.priority - b.spec.priority));
      let loading = 0;
      zones.forEach(r => { if (r.state === 'loading') loading++; });
      wanted.forEach(function (rec, i) {
        if (rec.state === 'cold' && (loading < o.maxConcurrentLoads || rec.id === view.current)) { start(rec, t); loading++; }
        if (rec.state !== 'cold' && rec.state !== 'ready') step(rec, t, i);
      });
      // Zones still preparing but no longer wanted keep preparing (cheap) so
      // a quick turn-back does not restart them.
      zones.forEach(function (rec) { if (!rec.lastWanted || rec.lastWanted === t) return; if (rec.state !== 'cold' && rec.state !== 'ready') step(rec, t, 99); });
      // Eviction: never protected zones; LRU beyond cache size after the grace
      // period, at once under critical memory pressure.
      const idle = [];
      zones.forEach(r => { if (r.state !== 'cold' && !r.protected && r.leftAt) idle.push(r); });
      idle.sort((a, b) => a.lastWanted - b.lastWanted); // oldest first
      const cache = o.cacheZones[level] != null ? o.cacheZones[level] : 0;
      let evicted = 0;
      idle.forEach(function (rec, i) {
        const overCache = idle.length - i > cache;
        if (level === 'critical' || (overCache && t - rec.leftAt >= o.graceMs)) { evict(rec, level === 'critical' ? 'critical memory' : 'lru'); evicted++; }
      });
      pumpUploads();
      sweepReleasable();
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
    function reset() {
      zones.forEach(r => { r.state = 'cold'; r.pending.clear(); r.leftAt = 0; r.lastWanted = 0; r.done = false; r.waiters.length = 0; });
      uploadQueue = []; releasable.clear();
    }
    function report() {
      const out = { zones: {}, uploadQueue: uploadQueue.length, releasable: releasable.size, stats: Object.assign({}, stats) };
      zones.forEach(r => { out.zones[r.id] = { state: r.state, hops: r.hops, pending: r.pending.size, protected: !!r.protected }; });
      return out;
    }
    return { register, unregister, attach, update, status, isReady, whenReady, markReleasable, queueTextures: (obj) => queueTextures(null, obj, 50), pumpUploads, forceEvict, reset, report, hide: hideObject, reveal: revealObject, zones: () => Array.from(order) };
  }
  return { create, HIDE_FLAG };
});
