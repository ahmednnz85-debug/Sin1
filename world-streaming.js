/* Sîn — World Streaming integration layer.
   Additive: it never builds geometry, never moves the camera, never hides and
   never disposes a visible region. It only refines the residency plan that
   wings.js already computes, using the pure logic in world-streaming-core.js.

   ?streaming=0  -> exactly the pre-existing behaviour (kill switch)
   ?predict=0 ?cache=0 ?texture=0 ?lod=0 -> disable one subsystem  */
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  if (params.get('streaming') === '0') { window.SinWorldStreaming = null; return; }
  var Core = window.SinStreamingCore;
  if (!Core) { console.warn('[streaming] core module missing'); window.SinWorldStreaming = null; return; }
  var on = function (k) { return params.get(k) !== '0'; };

  var predictor = Core.createPredictor();
  var budget = Core.createMemoryBudget();
  var cache = Core.createRegionCache({ slots: budget.profile.cacheSlots });
  var scheduler = Core.createScheduler({ sliceMs: 4.5, maxTasksPerFrame: 2 });
  var registry = Core.createResourceRegistry();
  var texPolicy = Core.createTexturePolicy({ maxAnisotropy: budget.profile.maxTextureAnisotropy });
  var lodPolicy = Core.createLodPolicy();

  var lastFrame = 0, frameNo = 0, texTick = 0;
  var texKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];
  var appliedGroups = new WeakMap(), queuedTextures = new WeakSet();
  var tmpDir = { x: 0, y: 0, z: 0 };
  var stats = {
    frames: 0, lead: 0, visible: 0, prepared: 0,
    addedByPrediction: 0, addedByCache: 0, trimmedByBudget: 0,
    textureTouches: 0, scheduler: null, budget: null, cache: null
  };

  function viewOf(cam, root) {
    if (!cam || !cam.getWorldDirection) return null;
    var d = new THREE.Vector3(); cam.getWorldDirection(d);
    var l = Math.hypot(d.x, d.z) || 1;
    var vfov = (cam.fov || 60) * Math.PI / 180, aspect = cam.aspect || 1;
    return {
      x: cam.position.x - (root ? root.position.x : 0),
      z: cam.position.z - (root ? root.position.z : 0),
      dirX: d.x / l, dirZ: d.z / l,
      halfFov: Math.atan(Math.tan(vfov / 2) * aspect)
    };
  }

  /* One call per culling update. Returns the prepared set to use. */
  function refine(p) {
    if (!p || !p.visible || !p.prepared) return p && p.prepared;
    var now = Number.isFinite(p.now) ? p.now : performance.now();
    var dt = lastFrame ? Math.min(0.25, (now - lastFrame) / 1000) : 1 / 60;
    lastFrame = now;
    frameNo++; stats.frames = frameNo;

    var visible = p.visible;
    var prepared = new Set(p.prepared);

    /* 1. Prediction from the player's real travel. */
    var pred = { lead: 0, moving: false };
    if (on('predict') && p.hero) pred = predictor.sample(p.hero.position.x, p.hero.position.z, dt);
    stats.lead = pred.lead;

    /* 2. What the camera sees is sacred: always prepared, always cached. */
    visible.forEach(function (id) { prepared.add(id); cache.touch(id, now); });

    /* 3. Persistent cache: recently seen rooms stay resident (no reload). */
    if (on('cache')) {
      cache.setSlots(budget.cacheSlots());
      cache.resident(now).forEach(function (id) {
        if (!prepared.has(id)) { prepared.add(id); stats.addedByCache++; }
      });
    }

    /* 4. Predictive widening over the REAL portal graph.
       Rooms without a portal path can never be added here. */
    if (on('predict') && pred.moving && p.regions && window.SinWingVisibility && p.links) {
      var Vis = window.SinWingVisibility;
      var reach = Vis.hops(p.links, p.origin, 6);
      var view = viewOf(p.camera, p.root);
      if (view) {
        var plan = Core.planPrefetch({
          regions: p.regions, reach: reach, cam: view,
          lead: pred.lead, visibility: Vis,
          options: { viewDistance: 400, maxHops: 6 }
        });
        plan.prepared.forEach(function (id) {
          if (!prepared.has(id)) { prepared.add(id); stats.addedByPrediction++; }
        });
      }
    }

    /* 5. Memory budget: trim only the tail, never a visible region. */
    var b = budget.sample(p.renderer && p.renderer.info, p.frameMs, dt * 1000);
    stats.budget = b;
    if (b.level !== 'normal') {
      var keep = new Set(visible);
      var tail = [];
      prepared.forEach(function (id) { if (!keep.has(id)) tail.push(id); });
      var drop = Math.max(0, tail.length - budget.cacheSlots());
      for (var i = 0; i < drop; i++) { prepared.delete(tail[i]); stats.trimmedByBudget++; }
    }

    /* 6. Texture priority + LOD on a 2-frame cadence (off the hot path). */
    if ((on('texture') || on('lod')) && p.regionGroups) {
      texTick = (texTick + 1) % 2;
      if (texTick === 0) applyTextureLod(p, visible, prepared);
    }

    /* 7. Time-sliced async work: never a big burst inside one frame. */
    if (scheduler.pending() > 0) scheduler.runFrame(now, 4.5);

    stats.scheduler = scheduler.report();
    stats.cache = cache.report();
    stats.visible = visible.size;
    stats.prepared = prepared.size;
    return prepared;
  }

  function applyTextureLod(p, visible, prepared) {
    var meta = p.meta || new Map();
    p.regionGroups.forEach(function (g, id) {
      if (!g || !prepared.has(id)) return;
      var m = meta.get(id) || {};
      var dist = Number.isFinite(m.distance) ? m.distance : 0;
      var prio = visible.has(id) ? 0 : (m.hops <= 1 ? 1 : 2);
      var L = texPolicy.level(dist, prio);
      var lod = lodPolicy.level(id, dist);
      var signature = L.anisotropy + ':' + lod;
      var previous = appliedGroups.get(g);
      var sameContents = !!previous && previous.signature === signature && previous.children.length === g.children.length;
      if (sameContents) {
        for (var ci = 0; ci < g.children.length; ci++) {
          var child = g.children[ci];
          if (previous.children[ci] !== child || previous.childCounts[ci] !== (child.children ? child.children.length : 0)) { sameContents = false; break; }
        }
      }
      if (sameContents) return;
      appliedGroups.set(g, { signature: signature, children: g.children.slice(), childCounts: g.children.map(function (child) { return child.children ? child.children.length : 0; }) });
      g.traverse(function (o) {
        if (!o.isMesh) return;
        if (o.userData && o.userData.lods) applyLod(o, lod);
        if (!o.material) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (mat) {
          if (!mat) return;
          texKeys.forEach(function (k) {
            var t = mat[k];
            if (t && t.isTexture && t.anisotropy !== L.anisotropy) { t.anisotropy = L.anisotropy; stats.textureTouches++; }
            if (t && t.isTexture && L.deferUpload) {
              // Three.js uploads textures as part of render(); there is no portable
              // public API for uploading one texture safely outside that render pass.
              // Queue only the safe flag update, bounded by the existing frame scheduler.
              if (!queuedTextures.has(t)) {
                var texture = t;
                queuedTextures.add(texture);
                scheduler.push({ run: function () { texture.needsUpdate = true; } }, 2);
              }
            }
          });
        });
      });
    });
  }
  function applyLod(obj, level) {
    var lods = obj.userData.lods;
    if (!lods || !lods.length) return;
    var i = Math.min(level >> 1, lods.length - 1);
    if (obj.userData.__lod === i) return;
    obj.userData.__lod = i;
    lods.forEach(function (m, j) { if (m) m.visible = j === i; });
  }

  window.SinWorldStreaming = {
    refine: refine,
    stats: function () {
      return {
        device: budget.device, profile: budget.profile, frames: stats.frames,
        lead: +stats.lead.toFixed(2), visible: stats.visible, prepared: stats.prepared,
        addedByPrediction: stats.addedByPrediction, addedByCache: stats.addedByCache,
        trimmedByBudget: stats.trimmedByBudget, textureTouches: stats.textureTouches,
        scheduler: stats.scheduler, budget: stats.budget, cache: stats.cache,
        registry: registry.report()
      };
    },
    cache: cache, budget: budget, scheduler: scheduler, predictor: predictor,
    registry: registry, lod: lodPolicy, textures: texPolicy,
    schedule: function (fn, priority) { return scheduler.push({ run: fn }, priority); },
    reset: function () {
      frameNo = 0; lastFrame = 0; stats.addedByPrediction = stats.addedByCache = stats.trimmedByBudget = 0;
      predictor.reset(); cache.reset(); scheduler.reset(); registry.reset(); lodPolicy.reset();
    }
  };
  console.info('[streaming] enabled · profile:', budget.device, budget.profile);
})();
