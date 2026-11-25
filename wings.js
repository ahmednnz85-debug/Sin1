/* Curse of Babylon — procedural palace wings.
   One shared architectural plan; all dimensions are metres in PalaceInterior local X/Z.
   Requires THREE r147 and the locally bundled ClipperLib 6.4.2 (Boost license). */
(function () {
  'use strict';
  const C = window.ClipperLib;
  const SCALE = 1000;
  const WALL = 1.0;
  const GRID = 0.5;
  const MAX_H = 12.25;
  const ROOM_NAMES = {
    K1: 'reception hall', K2: 'council hall', K3: 'map room', K4: 'royal treasury', K5: 'king private wing',
    T1: 'sacred entrance', T2: 'purification hall', T3: 'sacred columns', T4: 'holy sanctuary', T5: 'offering room',
    L1: 'great library', L2: 'archive', L3: 'scribes room', L4: 'observatory'
  };
  const WING_NAMES = { Kings: 'Kings', Temple: 'Temple', Library: 'Library', Shared: 'Corridor' };
  const state = {
    built: false, root: null, ctx: null, hall: null, rooms: [], connectors: [], doors: [], regions: [],
    floors: null, floorExtended: null, wallSolid: null, baseWall: null, wallGeometry: null,
    colliders: [], spatial: new Map(), regionGroups: new Map(), ceilings: [], materials: [],
    k1FloorY: 0, k1ModelMetrics: null, k1ModelColliderCount: 0,
    current: null, cutaway: false, fullbright: false, debug: false, report: null,
    deferredDress: new Set(),
    ui: null, label: null, minimap: null, minimapAt: 0, fires: [], seals: [], ambient: null, dynamicDoorBoxes: [], activeDoor: null, interactDoor: null
  };
  // Palace streaming / residency / shader warm / memory pressure are all owned
  // by zone-streamer.js (single source of truth). wing-gpu-residency.js is
  // still used by the outdoor city in index.html, not by the palace wings.
  // Data-driven zone streaming (prefetch -> budgeted upload -> shader
  // precompile -> atomic reveal -> LRU eviction). See zone-streamer.js and
  // ADDING_CONTENT.md. Streamed rooms are registered in WING_ZONES below.
  const deviceProfile = (window.SinDevice && SinDevice.detect()) || {
    prefetchHops: 7, cacheZones: { normal: 3, watch: 2, critical: 0 },
    uploadsPerFrame: 3, uploadMsPerFrame: 4, graceMs: 20000,
    maxTextureSize: 0, geometryBudget: 420, textureBudget: 180, constrained: false
  };
  const zoneStreamer = window.SinZoneStreamer ? window.SinZoneStreamer.create({
    // Device-aware: on iOS / mobile, keep only one extra idle zone and a
    // tighter texture budget. Keeping K2+K3+K4 all resident (cache 3,
    // prefetch 8) reached ~295 MB / 118 textures and Safari killed the tab.
    // Prefetch hops still start K2 from the palace hall (K2 is 3 hops).
    cacheZones: deviceProfile.cacheZones,
    uploadsPerFrame: deviceProfile.uploadsPerFrame,
    uploadMsPerFrame: deviceProfile.uploadMsPerFrame,
    graceMs: deviceProfile.graceMs,
    maxTextureSize: deviceProfile.maxTextureSize || 0,
    geometryBudget: deviceProfile.geometryBudget,
    textureBudget: deviceProfile.textureBudget,
    processBudgetMB: deviceProfile.processBudgetMB,
    gpuBudgetMB: deviceProfile.gpuBudgetMB,
    cpuBudgetMB: deviceProfile.cpuBudgetMB,
    deferStallMs: 3000,
    onBudgetStall: function (rec) {
      try {
        const st = window.PalaceInterior && PalaceInterior.state && PalaceInterior.state();
        // During palace LOADING/SETUP the city is already gone. A purge of
        // the loader cache on the same tick as a GLB parse would block the
        // main thread and was a suspected stall -> evict -> re-admit loop.
        if (st === 'LOADING' || st === 'FADING_OUT' || st === 'SETUP') return;
        // Do not tear down the outdoor sky or city while the player is still
        // outside. A budget stall after the Ishtar gate (zone babylon) used
        // to call __releaseExteriorStage and leave a clear-color black sky.
        const occ = window.PalaceInterior && PalaceInterior.metrics && PalaceInterior.metrics().occupant;
        if (st !== 'DONE' && !occ) return;
        if (window.PalaceInterior && typeof PalaceInterior.releaseCity === 'function') PalaceInterior.releaseCity();
        if (window.__releaseExteriorStage) window.__releaseExteriorStage();
        const PM = window.SinProcessMemory;
        const R = window.__R, S = window.__S;
        if (PM && PM.purgeOrphanTextures && R) PM.purgeOrphanTextures(R, S);
        if (PM && PM.releaseCpuFromObject && S) PM.releaseCpuFromObject(S, R, { upload: false });
      } catch (e) { try { console.warn('onBudgetStall', rec && rec.id, e); } catch (_) {} }
    },
    log: function (kind, msg) { try { if (window.SinMemoryOverlay) SinMemoryOverlay.note(kind, msg); } catch (_) {} }
  }) : null;

  /* ---------------------------------------------------------------------------
     Wing asset files. Heavy models and pictures use the compressed copies in
     "ارضيات وسقوف/optimized/" (same geometry, WebP textures, meshopt where the
     game already decodes it). Only the K1 model is needed for the first palace
     frame; all other rooms use the on-demand loader after the player approaches.
  --------------------------------------------------------------------------- */
  const OPT_DIR = 'ارضيات وسقوف/optimized/';
  const WING_FILES = {
    // LOD25 keeps the original model's nodes/materials/UVs with 75% fewer triangles.
    k1: OPT_DIR + 'K1_RoyalReceptionHall_lod25.glb',
    corridorFloor: 'assets/ارضية الممرات.JPG',
    corridorCarpet: 'assets/سجاد الممرات.JPG',
    corridorCeiling: OPT_DIR + 'سقف-الممرات.webp',
    corridorWall: 'assets/جدار الممرات.jpg',
    plant: OPT_DIR + 'شتله.glb',
    torchBlack: OPT_DIR + 'مشعل اسود.glb',
    torchWood: OPT_DIR + 'مشعل خشب.glb',
    k2Wall: OPT_DIR + 'جدار-المجلس.webp',
    k2Ceiling: OPT_DIR + 'سقف-المجلس.glb',
    k2Chandelier: OPT_DIR + 'ثريا-المجلس.glb',
    k2Lion: OPT_DIR + 'lion_winged.glb',
    k2Floor: 'assets/ارضية المجلس.PNG',
    // Map-room pictures only. The two Draco models stay off this list so they
    // are not decoded while the city is still in memory (same rule as K2).
    k3Floor: 'assets/\u0627\u0631\u0636\u064A\u0629 \u0627\u0644\u062E\u0631\u0627\u064A\u0654\u0637.JPG',
    k3Wall: 'assets/\u062C\u062F\u0627\u0631 \u0627\u0644\u062E\u0631\u0627\u064A\u0654\u0637.JPG',
    k3WallFar: 'assets/جدار الخرائط 2.JPG',
    k3Ceiling: 'assets/سقف الخرائط .JPG',
    // K4 royal treasury (rebuilt): the original treasury GLBs were split into
    // one named node per object (origin = base centre, front = +Z), simplified
    // with a tight geometric error bound (shape kept) and stored as meshopt +
    // WebP. Surfaces are the same pictures (already smaller as JPEG than as WebP).
    k4Floor: OPT_DIR + 'k4/ارضية-الخزانة.jpg',
    k4Ceiling: OPT_DIR + 'k4/سقف-الخزانة.jpg',
    k4SideWall: OPT_DIR + 'k4/جدارية-ايمن-الخزانة.jpg',
    k4KitA: OPT_DIR + 'k4/k4_kit_a.glb',
    k4KitB: OPT_DIR + 'k4/k4_kit_b.glb',
    k4KitC: OPT_DIR + 'k4/k4_kit_c.glb',
    k4FrontWall: OPT_DIR + 'k4/k4_front_mural.glb',
    // Formerly lazy assets are now part of the palace manifest.
    k2Reception: OPT_DIR + 'عمود-المجلس.glb',
    k2Meetings: 'assets/اجتماعات .glb',
    k3Table: 'assets/طاولة الخرائط.glb',
    k3Furniture: 'assets/اثاث_الخرائط.glb',
    // K5 king private wing: only the supplied repository artwork and models.
    k5Bed: 'assets/\u0633\u0631\u064A\u0631 \u0627\u0644\u0645\u0644\u0643.glb',
    k5Steps: 'assets/\u062F\u0631\u062C \u0627\u0644\u0633\u0631\u064A\u0631.glb',
    k5Furniture: 'assets/\u0627\u062B\u0627\u062B \u0627\u0644\u062E\u0632\u0627\u0646\u0629 2.glb',
    k5Chandelier: 'assets/\u062B\u0631\u064A\u0627 \u0627\u0644\u0645\u062C\u0644\u0633 .glb'
  };
  // K4's authored GLBs have large embedded textures. Keep them out of the
  // palace-entry preload so the first WebGL warm-up fits mobile GPU budgets.
  const K4_DEFERRED_MODELS = new Set([
    WING_FILES.k4KitA, WING_FILES.k4KitB,
    WING_FILES.k4KitC, WING_FILES.k4FrontWall
  ]);
  const WING_DOOR_FILE = 'assets/باب الاجنحة.glb';
  let wingDoorLoadStarted = false;
  const K2_LAZY = { reception: WING_FILES.k2Reception, meetings: WING_FILES.k2Meetings };
  const preloaded = new Map();   // path -> THREE.Texture | parsed gltf
  let retired = false;
  const stageAbort = typeof AbortController === 'function' ? new AbortController() : null;
  const deferredLoads = [];      // cached-model callbacks queued while build() runs
  function assetList() {
    // Entry-visible corridor models must parse during LOADING (already
    // yielded and logged between files). If they stay off this list,
    // dressCorridors starts a fetch+GLTFLoader.parse mid-SETUP; at high
    // WebKit RSS that parse raced the post-corridors yield and blocked
    // the main thread for minutes.
    const entryAssets = new Set([
      WING_FILES.k1,
      WING_FILES.plant,
      WING_FILES.torchBlack,
      WING_FILES.torchWood,
      WING_DOOR_FILE
    ]);
    const list = Object.keys(WING_FILES).filter(k => entryAssets.has(WING_FILES[k]))
      .map(k => ({ url: WING_FILES[k], kind: /\.glb$/i.test(WING_FILES[k]) ? 'glb' : 'tex' }));
    if (entryAssets.has(WING_DOOR_FILE) && !list.some(function (a) { return a.url === WING_DOOR_FILE; })) {
      list.push({ url: WING_DOOR_FILE, kind: 'glb' });
    }
    if (window.SinTempleDoors) for(const url of [SinTempleDoors.asset,SinTempleDoors.libraryAsset])list.push({url,kind:'draco',required:true});
    return list.filter((a, i, all) => all.findIndex(b => b.url === a.url) === i);
  }
  function provideAsset(url, value) { if (!retired && url && value) preloaded.set(url, value); }
  function preloadReport() {
    return assetList().map(a => ({ url: a.url, kind: a.kind, ready: preloaded.has(a.url) }));
  }
  function preloadedTexture(url) {
    const t = preloaded.get(url);
    return t && t.isTexture ? t : null;
  }
  async function flushDeferredLoads() {
    // building must be false before any queued wingGLB runs, otherwise
    // the uncached path would re-queue itself forever.
    state.building = false;
    let i = 0;
    const n = deferredLoads.length;
    try { console.info('[palace load] deferred-start', n); } catch (_) {}
    while (deferredLoads.length) {
      const run = deferredLoads.shift();
      const t0 = performance.now();
      try { await Promise.resolve(run()); } catch (e) { console.error('Wing model setup failed', e); }
      try { console.info('[palace load] deferred', i, Math.round(performance.now() - t0) + 'ms', 'left', deferredLoads.length); } catch (_) {}
      i++;
      await yieldWing();
    }
    const tChain = performance.now();
    try {
      await Promise.race([
        wingLoadChain,
        new Promise(function (_, rej) { setTimeout(function () { rej(new Error('wingLoadChain timeout')); }, 8000); })
      ]);
    } catch (e) {
      try { console.warn('[palace load] deferred-chain', e && e.message, Math.round(performance.now() - tChain) + 'ms'); } catch (_) {}
    }
    try { console.info('[palace load] deferred-end', n, 'chain', Math.round(performance.now() - tChain) + 'ms'); } catch (_) {}
  }
  function withMeshopt(go0) {
    // Decode in background workers when palaceInterior enabled them.
    const go = d => go0(d && window.__sinMeshoptWorkers ? window.__sinMeshoptWorkers(d) : d);
    const D = window.MeshoptDecoder;
    if (D && D.ready) { D.ready.then(() => go(D), () => go(null)); return; }
    setTimeout(() => {
      if (window.MeshoptDecoder || document.querySelector('script[data-corridor-meshopt]')) return;
      const sc = document.createElement('script'); sc.src = 'vendor/meshopt_decoder.js'; sc.dataset.corridorMeshopt = '1';
      document.head.appendChild(sc);
    }, 3000);
    let tries = 0; const t = setInterval(() => {
      const d = window.MeshoptDecoder;
      if (d && d.ready) { clearInterval(t); d.ready.then(() => go(d), () => go(null)); }
      else if (++tries > 300) { clearInterval(t); go(null); }
    }, 100);
  }
  // Strict one-at-a-time wing GLB fetch/parse. Parallel parses were a peak-RAM
  // spike on iPhone when K2/K3 dressed several models together.
  let wingLoadChain = Promise.resolve();
  function enqueueWingLoad(task) {
    const runTask = () => {
      stageAbort?.signal.throwIfAborted();
      return task();
    };
    const run = wingLoadChain.then(runTask, runTask);
    wingLoadChain = run.catch(function () {});
    return run;
  }
  // Visual-regression fix: this used to null every texture.image right after
  // parse, BEFORE the texture had ever been uploaded. Every streamed wing
  // model (room doors, K2-K4 dress) then sampled the empty 1x1 texture
  // (black albedo, zero roughness/metalness, broken normals) and only the
  // gold environment reflection remained. Upload first, then drop CPU pixels
  // only for image sources whose textures all have a live GPU copy.
  function releaseGltfCpu(gltf) {
    // Phase 2: no synchronous upload of a whole GLB on the parse frame (that
    // was a frame-time spike). The streamer uploads the textures under its
    // per-frame budget and drops CPU pixels once every texture sharing an
    // image source has a GPU copy.
    if (zoneStreamer && gltf && gltf.scene) { zoneStreamer.markReleasable(gltf.scene); return; }
    const renderer = state.ctx && state.ctx.renderer;
    if (!gltf || !gltf.scene || !renderer || typeof renderer.initTexture !== 'function') return;
    const bySource = new Map();
    gltf.scene.traverse(function (o) {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      mats.forEach(function (m) {
        if (!m) return;
        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'].forEach(function (k) {
          const t = m[k];
          if (!t || !t.isTexture || t.isCompressedTexture || !t.source) return;
          const list = bySource.get(t.source) || [];
          if (list.indexOf(t) < 0) list.push(t);
          bySource.set(t.source, list);
        });
      });
    });
    bySource.forEach(function (list) {
      list.forEach(function (t) { try { if (t.image) renderer.initTexture(t); } catch (_) {} });
    });
    bySource.forEach(function (list, source) {
      if (!source.data) return;
      const resident = list.every(function (t) {
        try { const p = renderer.properties.get(t); return !!(p && p.__webglTexture && p.__version === t.version); } catch (_) { return false; }
      });
      if (!resident) return;
      try {
        const img = source.data;
        source.data = null;
        if (img && typeof img.close === 'function') img.close();
      } catch (_) {}
    });
  }
  // Every wing model goes through here: a preloaded model is handed out as a
  // fresh clone (geometry, materials and textures shared, nothing downloaded);
  // otherwise it is fetched exactly as before — but never in parallel.
  function wingGLB(url, onLoad, onError) {
    if (retired) return;
    const fail = onError || (e => console.warn('Wing model failed', url, e));
    if (!THREE.GLTFLoader) { fail(new Error('GLTFLoader not available')); return; }
    const deliver = gltf => {
      if (retired) { discardStageAsset(gltf); return; }
      const t0 = performance.now();
      let p;
      try { p = Promise.resolve(onLoad(gltf)); } catch (e) { p = Promise.reject(e); }
      return p.then(function () {
        try { console.info('[palace load] wing-deliver', (url || '').split('/').pop(), Math.round(performance.now() - t0) + 'ms'); } catch (_) {}
        if (state.built && !state.building) updateCulling(true);
      }, fail);
    };
    const cached = preloaded.get(url);
    if (cached && cached.scene) {
      const run = () => deliver({ scene: cached.scene.clone(true), animations: cached.animations || [] });
      if (state.building) deferredLoads.push(run); else run();
      return;
    }
    // Uncached fetch+parse used to start here even during SETUP. The parse
    // callback then raced the post-corridors yield and ran GLTFLoader.parse
    // of the plant and both torch GLBs on the main thread — the multi-minute
    // WebKit block after visuals-corridors. Queue the whole load until
    // flushDeferredLoads (building is false then).
    if (state.building) {
      deferredLoads.push(function () { wingGLB(url, onLoad, onError); });
      return;
    }
    enqueueWingLoad(function () {
      return new Promise(function (resolve) {
        withMeshopt(function (dec) {
          fetch(encodeURI(url), { signal: stageAbort?.signal }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
            return res.arrayBuffer();
          }).then(function (buf) {
            const file = (url || '').split('/').pop();
            const big = !!(buf && buf.byteLength >= 1500000);
            // After the first hall present, a 2–4 s GLTFLoader.parse
            // (عمود-المجلس, سقف-المجلس) must not run on the same turn as
            // standing frames. Wait out the stream hold, then yield a
            // few rAFs (more for large files) so the hall can paint.
            const waitToParse = function () {
              return new Promise(function (ready) {
                const step = function () {
                  try {
                    if (typeof window !== 'undefined' && window.__sinStreamHold) {
                      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(step);
                      else setTimeout(step, 16);
                      return;
                    }
                    const presented = typeof window !== 'undefined' && window.__sinFirstPresentLogged;
                    if (presented) {
                      const need = big ? 12 : 2;
                      const held = window.__sinWingParseYields || 0;
                      if (held < need) {
                        window.__sinWingParseYields = held + 1;
                        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(step);
                        else setTimeout(step, 16);
                        return;
                      }
                    }
                  } catch (_) {}
                  ready();
                };
                step();
              });
            };
            return waitToParse().then(function () {
              stageAbort?.signal.throwIfAborted();
              return new Promise(function (resOk, resFail) {
                const loader = new THREE.GLTFLoader();
                if (dec) loader.setMeshoptDecoder(dec);
                const tParse = performance.now();
                try { console.info('[palace load] wing-parse-start', file, buf && buf.byteLength); } catch (_) {}
                loader.parse(buf, '', function (gltf) {
                  const dt = Math.round(performance.now() - tParse);
                  try { console.info('[palace load] wing-parse', file, dt + 'ms'); } catch (_) {}
                  try {
                    if (typeof window !== 'undefined' && dt > (window.__palaceMaxSliceMs || 0)) {
                      window.__palaceMaxSliceMs = dt;
                      window.__palaceMaxSliceName = 'wing:' + file;
                    }
                  } catch (_) {}
                  if (!retired) try { releaseGltfCpu(gltf); } catch (_) {}
                  Promise.resolve(deliver(gltf)).then(resOk, resFail);
                }, resFail);
              });
            });
          }).catch(function (e) {
            fail(e);
          }).then(resolve, resolve);
        });
      });
    });
  }

  function assertDeps() {
    if (!window.THREE || !C) throw new Error('PalaceWings requires THREE and local ClipperLib');
  }
  function pt(x, z) { return { X: Math.round(x * SCALE), Y: Math.round(z * SCALE) }; }
  function pathRect(x0, z0, x1, z1) {
    return [pt(x0, z0), pt(x1, z0), pt(x1, z1), pt(x0, z1)];
  }
  function polyRect(x, z, w, d) { return [[x, z], [x + w, z], [x + w, z + d], [x, z + d]]; }
  function polyCircle(cx, cz, r, n) {
    const p = [];
    for (let i = 0; i < n; i++) {
      const a = i * Math.PI * 2 / n;
      p.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    return p;
  }
  function toPath(poly) { return poly.map(p => pt(p[0], p[1])); }
  function fromPath(path) { return path.map(p => [p.X / SCALE, p.Y / SCALE]); }
  function solidsToPaths(solids) {
    const paths = [];
    (solids || []).forEach(s => {
      if (!s || !s.outer) { console.error('Clipper invalid solid', JSON.stringify(s), JSON.stringify(solids).slice(0, 2000)); return; }
      paths.push(toPath(s.outer));
      (s.holes || []).forEach(h => { if (h) paths.push(toPath(h)); });
    });
    return paths;
  }
  function treeToSolids(tree) {
    const ex = C.JS.PolyTreeToExPolygons(tree);
    return ex.map(e => ({ outer: fromPath(e.outer), holes: (e.holes || []).map(fromPath) }));
  }
  function clip(op, a, b) {
    const c = new C.Clipper();
    c.AddPaths(solidsToPaths(a || []), C.PolyType.ptSubject, true);
    if (b) c.AddPaths(solidsToPaths(b), C.PolyType.ptClip, true);
    const tree = new C.PolyTree();
    c.Execute(op, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
    return treeToSolids(tree);
  }
  function union(a, b) { return clip(C.ClipType.ctUnion, a, b); }
  function difference(a, b) { return clip(C.ClipType.ctDifference, a, b); }
  function intersection(a, b) { return clip(C.ClipType.ctIntersection, a, b); }
  function solid(poly) { return [{ outer: poly, holes: [] }]; }
  function offset(solids, amount) {
    const co = new C.ClipperOffset(1, 0.08 * SCALE);
    co.AddPaths(solidsToPaths(solids), C.JoinType.jtMiter, C.EndType.etClosedPolygon);
    const tree = new C.PolyTree();
    co.Execute(tree, amount * SCALE);
    return treeToSolids(tree);
  }
  function signedArea(poly) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
    return a * 0.5;
  }
  function pointInPoly(x, z, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (((a[1] > z) !== (b[1] > z)) && x < (b[0] - a[0]) * (z - a[1]) / ((b[1] - a[1]) || 1e-12) + a[0]) inside = !inside;
    }
    return inside;
  }
  function pointInSolids(x, z, solids) {
    for (const s of solids || []) {
      if (!s._bb && s.outer) s._bb = bbox(s.outer);
      if (s._bb && (x < s._bb.x0 || x > s._bb.x1 || z < s._bb.z0 || z > s._bb.z1)) continue;
      if (!pointInPoly(x, z, s.outer)) continue;
      let hole = false;
      for (const h of s.holes || []) if (pointInPoly(x, z, h)) { hole = true; break; }
      if (!hole) return true;
    }
    return false;
  }
  function solidsArea(solids) {
    let a = 0;
    (solids || []).forEach(s => { a += Math.abs(signedArea(s.outer)); (s.holes || []).forEach(h => a -= Math.abs(signedArea(h))); });
    return a;
  }
  function bbox(poly) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    poly.forEach(p => { x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]); x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]); });
    return { x0, z0, x1, z1, cx: (x0 + x1) * 0.5, cz: (z0 + z1) * 0.5 };
  }
  function region(id, wing, name, poly, height, kind) {
    return { id, wing, name: name || id, poly, height, floorY: 0, kind: kind || 'room', bbox: bbox(poly) };
  }
  function rectRegion(id, wing, name, x, z, w, d, h, kind) { return region(id, wing, name, polyRect(x, z, w, d), h, kind); }

  function solveLayout(hall) {
    const passages = {};
    hall.passages.forEach(p => { passages[p.id.replace('passage-', '')] = p; });
    const zK = passages.L2.position[2];
    const zT = passages.R2.position[2];
    const zL = passages.R0.position[2];
    const back = hall.width * 0.5 + hall.wallThickness + hall.alcoveDepth;
    const rooms = [], connectors = [], doors = [], links = [];
    const addRoom = r => { rooms.push(r); return r; };
    const addCon = r => { connectors.push(r); return r; };
    function door(id, a, b, x, z, axis, width, kind) {
      const ra = rooms.concat(connectors).find(r => r.id === a);
      const rb = rooms.concat(connectors).find(r => r.id === b);
      const h = kind === 'arch' ? (passages[a] ? passages[a].height : 7.8) : Math.min(6, (ra ? ra.height : 6) - 0.5, (rb ? rb.height : 6) - 0.5);
      const d = { id, from: a, to: b, x, z, axis, width: width || 4.5, height: Math.max(3.8, h), thickness: 1, kind: kind || 'door' };
      doors.push(d); links.push([a, b, id]); return d;
    }

    // K1_RoyalReceptionHall.glb is authored as a 39m-long by 28m-wide hall,
    // with its two gates on the local Z ends.  K1 is entered/exited from the
    // west/east sides of the wing layout, so the room follows that footprint
    // and the loader rotates the asset once to put both gates on those sides.
    const K1 = addRoom(rectRegion('K1', 'Kings', ROOM_NAMES.K1, -back - 39, zK - 14, 39, 28, 8.5)); K1.ceiling = false;
    const KC12 = addCon(rectRegion('KC12', 'Kings', 'Kings corridor', K1.bbox.x0 - 8, zK - 3, 8, 6, 6, 'corridor'));
    const K2 = addRoom(rectRegion('K2', 'Kings', ROOM_NAMES.K2, KC12.bbox.x0 - 31, zK, 30, 24, 9));
    door('K1-KC12', 'K1', 'KC12', K1.bbox.x0 - 0.5, zK, 'x');
    door('KC12-K2', 'KC12', 'K2', K2.bbox.x1 + 0.5, zK, 'x');

    const KC1x = K2.bbox.cx;
    const rearZ = hall.length + 5;
    const REAR = addCon(rectRegion('REAR', 'Shared', 'Rear Gallery', -28, rearZ, back + 44, 6, 7, 'gallery'));
    const K5 = addRoom(rectRegion('K5', 'Kings', ROOM_NAMES.K5, -28, rearZ + 12, 22, 16, 6));
    const KC2 = addCon(rectRegion('KC2', 'Kings', 'Kings L corridor', KC1x - 3, K5.bbox.z1 + 1, K5.bbox.cx - KC1x + 6, 6, 6, 'corridor'));
    const KC1 = addCon(rectRegion('KC1', 'Kings', 'Kings L corridor', KC1x - 3, K2.bbox.z1 + 1, 6, KC2.bbox.z1 - K2.bbox.z1 - 1, 6, 'corridor'));
    door('K2-KC1', 'K2', 'KC1', KC1x, K2.bbox.z1 + 0.5, 'z');
    links.push(['KC1', 'KC2', 'KC1-KC2']);
    door('KC2-K5', 'KC2', 'K5', K5.bbox.cx, K5.bbox.z1 + 0.5, 'z');

    const K3 = addRoom(rectRegion('K3', 'Kings', ROOM_NAMES.K3, KC1.bbox.x0 - 17, KC1.bbox.z0 + 5, 16, 12, 5.5));
    const KC3 = addCon(rectRegion('KC3', 'Kings', 'Map corridor', K3.bbox.x1, K3.bbox.cz - 3, KC1.bbox.x0 - K3.bbox.x1, 6, 6, 'corridor'));
    door('K3-KC3', 'K3', 'KC3', K3.bbox.x1 + 0.5, K3.bbox.cz, 'x'); links.push(['KC3', 'KC1', 'KC3-KC1']);
    // Match the supplied 16:9 floor/ceiling artwork while keeping K4's entrance and corridor centered.
    const K4 = addRoom(rectRegion('K4', 'Kings', ROOM_NAMES.K4, KC1x + 17, KC2.bbox.z1 + 3, 21.322, 12, 8.5));
    K4.ceiling = false; // The authored treasury ceiling texture replaces the generic slab.
    const KC4 = addCon(rectRegion('KC4', 'Kings', 'Treasury corridor', K4.bbox.cx - 3, KC2.bbox.z1, 6, K4.bbox.z0 - KC2.bbox.z1, 6, 'corridor'));
    door('KC4-K4', 'KC4', 'K4', K4.bbox.cx, K4.bbox.z0 - 0.5, 'z'); links.push(['KC4', 'KC2', 'KC4-KC2']);
    const KC5R = addCon(rectRegion('KC5R', 'Kings', 'Rear approach', K5.bbox.cx - 3, REAR.bbox.z1, 6, K5.bbox.z0 - REAR.bbox.z1, 6, 'corridor'));
    door('K5-KC5R', 'K5', 'KC5R', K5.bbox.cx, K5.bbox.z0 - 0.5, 'z'); links.push(['KC5R', 'REAR', 'KC5R-REAR']);

    const T1 = addRoom(rectRegion('T1', 'Temple', ROOM_NAMES.T1, back, zT - 6, 16, 12, 8.5));
    const TR1 = addCon(rectRegion('TR1', 'Temple', 'Rear temple approach', T1.bbox.cx - 3, T1.bbox.z1, 6, REAR.bbox.z0 - T1.bbox.z1, 6, 'corridor'));
    door('T1-TR1', 'T1', 'TR1', T1.bbox.cx, T1.bbox.z1 + 0.5, 'z'); links.push(['TR1', 'REAR', 'TR1-REAR']);
    const T2 = addRoom(rectRegion('T2', 'Temple', ROOM_NAMES.T2, T1.bbox.x1 + 7, zT - 8, 20, 16, 8));
    const TC12 = addCon(rectRegion('TC12', 'Temple', 'Temple corridor', T1.bbox.x1, zT - 3, T2.bbox.x0 - T1.bbox.x1, 6, 6, 'corridor'));
    door('T1-TC12', 'T1', 'TC12', T1.bbox.x1 + 0.5, zT, 'x'); door('TC12-T2', 'TC12', 'T2', T2.bbox.x0 - 0.5, zT, 'x');
    const T3 = addRoom(rectRegion('T3', 'Temple', ROOM_NAMES.T3, T2.bbox.x1 + 6, zT - 12, 44, 24, 12));
    const TC23 = addCon(rectRegion('TC23', 'Temple', 'Temple corridor', T2.bbox.x1, zT - 3, T3.bbox.x0 - T2.bbox.x1, 6, 6, 'corridor'));
    door('T2-TC23', 'T2', 'TC23', T2.bbox.x1 + 0.5, zT, 'x'); door('TC23-T3', 'TC23', 'T3', T3.bbox.x0 - 0.5, zT, 'x');
    const T4 = addRoom(rectRegion('T4', 'Temple', ROOM_NAMES.T4, T3.bbox.x1 + 6, zT - 10, 24, 20, 10));
    const TC34 = addCon(rectRegion('TC34', 'Temple', 'Sanctuary corridor', T3.bbox.x1, zT - 3, T4.bbox.x0 - T3.bbox.x1, 6, 6, 'corridor'));
    door('T3-TC34', 'T3', 'TC34', T3.bbox.x1 + 0.5, zT, 'x'); door('TC34-T4', 'TC34', 'T4', T4.bbox.x0 - 0.5, zT, 'x');
    const T5 = addRoom(rectRegion('T5', 'Temple', ROOM_NAMES.T5, T3.bbox.cx - 9, T3.bbox.z1 + 7, 18, 14, 5.5));
    const TC5 = addCon(rectRegion('TC5', 'Temple', 'Offering side passage', T3.bbox.cx - 3, T3.bbox.z1, 6, T5.bbox.z0 - T3.bbox.z1, 6, 'corridor'));
    door('T3-TC5', 'T3', 'TC5', T3.bbox.cx, T3.bbox.z1 + 0.5, 'z'); door('TC5-T5', 'TC5', 'T5', T3.bbox.cx, T5.bbox.z0 - 0.5, 'z');

    const L1 = addRoom(rectRegion('L1', 'Library', ROOM_NAMES.L1, back, zL - 13, 40, 26, 11));
    const L2 = addRoom(rectRegion('L2', 'Library', ROOM_NAMES.L2, back + 5, L1.bbox.z0 - 21, 18, 14, 5.5));
    const LC2 = addCon(rectRegion('LC2', 'Library', 'Archive corridor', L2.bbox.cx + 1, L2.bbox.z1, 6, L1.bbox.z0 - L2.bbox.z1, 6, 'corridor'));
    door('L1-LC2', 'L1', 'LC2', LC2.bbox.cx, L1.bbox.z0 - 0.5, 'z'); door('LC2-L2', 'LC2', 'L2', LC2.bbox.cx, L2.bbox.z1 + 0.5, 'z');
    const L3 = addRoom(rectRegion('L3', 'Library', ROOM_NAMES.L3, back + 30, L1.bbox.z0 - 21, 20, 14, 5.5));
    const LC3 = addCon(rectRegion('LC3', 'Library', 'Scribes corridor', L3.bbox.cx - 9, L3.bbox.z1, 6, L1.bbox.z0 - L3.bbox.z1, 6, 'corridor'));
    door('L1-LC3', 'L1', 'LC3', LC3.bbox.cx, L1.bbox.z0 - 0.5, 'z'); door('LC3-L3', 'LC3', 'L3', LC3.bbox.cx, L3.bbox.z1 + 0.5, 'z');
    const L4 = addRoom(region('L4', 'Library', ROOM_NAMES.L4, polyCircle(L1.bbox.x1 + 18, zL, 12, 32), 11));
    const LC4 = addCon(rectRegion('LC4', 'Library', 'Observatory opening', L1.bbox.x1, zL - 3, L4.bbox.x0 - L1.bbox.x1 + 1, 6, 6, 'corridor'));
    door('L1-LC4', 'L1', 'LC4', L1.bbox.x1 + 0.5, zL, 'x'); door('LC4-L4', 'LC4', 'L4', L4.bbox.x0 + 0.5, zL, 'x', 6, 'opening');

    const MP1 = addCon(rectRegion('MP1', 'Shared', 'Moon Passage', T4.bbox.cx - 3, zL - 3, 6, T4.bbox.z0 - zL + 3, 6, 'corridor'));
    const MP2 = addCon(rectRegion('MP2', 'Shared', 'Moon Passage', L4.bbox.x1 - 1, zL - 3, T4.bbox.cx - L4.bbox.x1 + 4, 6, 6, 'corridor'));
    links.push(['MP1', 'MP2', 'MP1-MP2']);
    door('T4-MP1', 'T4', 'MP1', T4.bbox.cx, T4.bbox.z0 - 0.5, 'z'); door('MP2-L4', 'MP2', 'L4', L4.bbox.x1 - 0.5, zL, 'x', 6, 'opening');

    const thresholds = [];
    function threshold(id, wing, passage, room) {
      const inner = passage.position[0];
      const x0 = Math.min(inner, room.bbox.x0, room.bbox.x1) - 0.05;
      const x1 = Math.max(inner, room.bbox.x0, room.bbox.x1) + 0.05;
      const r = rectRegion(id, wing, 'Arch threshold', x0, passage.position[2] - passage.width * 0.5 - 0.05, x1 - x0, passage.width + 0.1, room.height, 'threshold');
      r.ceiling = false; r.linkRoom = room.id; thresholds.push(r);
    }
    threshold('ARCH_L3', 'Kings', passages.L2, K1);
    threshold('ARCH_R3', 'Temple', passages.R2, T1);
    threshold('ARCH_R1', 'Library', passages.R0, L1);
    doors.unshift(
      { id: 'PalaceL3', from: 'Palace', to: 'K1', x: passages.L2.position[0], z: zK, axis: 'x', width: passages.L2.width, height: passages.L2.height, kind: 'arch' },
      { id: 'PalaceR3', from: 'Palace', to: 'T1', x: passages.R2.position[0], z: zT, axis: 'x', width: passages.R2.width, height: passages.R2.height, kind: 'arch' },
      { id: 'PalaceR1', from: 'Palace', to: 'L1', x: passages.R0.position[0], z: zL, axis: 'x', width: passages.R0.width, height: passages.R0.height, kind: 'arch' }
    );
    links.push(['Palace', 'K1', 'PalaceL3'], ['Palace', 'T1', 'PalaceR3'], ['Palace', 'L1', 'PalaceR1']);
    const sealed = { x: -back - 68, z: zL - 20, w: 50, d: 40 };
    return { rooms, connectors: connectors.concat(thresholds), doors, links, sealed, passages, back };
  }

  function prepareArchitecture(layout) {
    const regions = layout.rooms.concat(layout.connectors);
    const allFloor = regions.reduce((acc, r) => union(acc, solid(r.poly)), []);
    const doorFloors = [];
    layout.doors.forEach(d => {
      if (d.kind === 'arch') return;
      const w = d.width, t = d.thickness + 0.1;
      const poly = d.axis === 'x' ? polyRect(d.x - t * 0.5, d.z - w * 0.5, t, w) : polyRect(d.x - w * 0.5, d.z - t * 0.5, w, t);
      d.floorPoly = poly;
      doorFloors.push(solid(poly));
    });
    const floors = doorFloors.reduce((acc, s) => union(acc, s), allFloor);
    const floorExtended = offset(floors, 0.3);
    const doorWalls = [], openings = [], caps = [];
    layout.doors.forEach(d => {
      if (d.kind === 'arch') return;
      const span = d.width + 2;
      const wallPoly = d.axis === 'x' ? polyRect(d.x - 0.5, d.z - span * 0.5, 1, span) : polyRect(d.x - span * 0.5, d.z - 0.5, span, 1);
      const openPoly = d.axis === 'x' ? polyRect(d.x - 0.6, d.z - d.width * 0.5, 1.2, d.width) : polyRect(d.x - d.width * 0.5, d.z - 0.6, d.width, 1.2);
      d.wallPoly = wallPoly; d.openPoly = openPoly;
      doorWalls.push(solid(wallPoly)); openings.push(solid(openPoly));
      caps.push({ door: d, solids: solid(openPoly) });
    });
    let wallSolid = union(difference(offset(floors, WALL), floors), doorWalls.reduce((a, s) => union(a, s), []));
    const hw = state.hall.width * 0.5, hl = state.hall.length;
    let hallObstacles = solid(polyRect(-hw - 0.2, -0.2, hw * 2 + 0.4, hl + 0.4));
    layout.doors.filter(d => d.kind === 'arch').forEach(d => {
      const inner = d.x, outer = inner < 0 ? -state.back : state.back;
      const x0 = Math.min(inner, outer) - 0.05, x1 = Math.max(inner, outer) + 0.05;
      hallObstacles = union(hallObstacles, solid(polyRect(x0, d.z - d.width * 0.5 - 0.05, x1 - x0, d.width + 0.1)));
    });
    wallSolid = difference(wallSolid, hallObstacles);
    wallSolid = difference(wallSolid, solid(polyRect(layout.sealed.x, layout.sealed.z, layout.sealed.w, layout.sealed.d)));
    const baseWall = openings.reduce((acc, s) => difference(acc, s), wallSolid);
    state.floors = floors;
    state.floorExtended = floorExtended;
    state.wallSolid = wallSolid;
    state.baseWall = baseWall;
    state.caps = caps;
    return { floors, floorExtended, wallSolid, baseWall, caps };
  }

  function cleanPoly(poly, ccw) {
    const out = poly.filter((p, i) => i === 0 || Math.hypot(p[0] - poly[i - 1][0], p[1] - poly[i - 1][1]) > 1e-6);
    if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-6) out.pop();
    if ((signedArea(out) > 0) !== ccw) out.reverse();
    return out;
  }
  function extrudeSolids(solids, y0, y1) {
    const positions = [];
    function tri(a, b, c) { positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
    function quad(a, b, c, d) { tri(a, b, c); tri(a, c, d); }
    (solids || []).forEach(s => {
      const outer = cleanPoly(s.outer, true);
      const holes = (s.holes || []).map(h => cleanPoly(h, false));
      if (outer.length < 3) return;
      const contour = outer.map(p => new THREE.Vector2(p[0], p[1]));
      const holeV = holes.map(h => h.map(p => new THREE.Vector2(p[0], p[1])));
      let faces = [];
      try { faces = THREE.ShapeUtils.triangulateShape(contour, holeV); } catch (e) { console.error('Wing triangulation', e); }
      const verts = outer.concat.apply(outer, holes);
      faces.forEach(f => {
        const a = verts[f[0]], b = verts[f[1]], c = verts[f[2]];
        const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        const A = [a[0], y0, a[1]], B = [b[0], y0, b[1]], Cc = [c[0], y0, c[1]];
        const At = [a[0], y1, a[1]], Bt = [b[0], y1, b[1]], Ct = [c[0], y1, c[1]];
        if (cross > 0) { tri(A, B, Cc); tri(At, Ct, Bt); }
        else { tri(A, Cc, B); tri(At, Bt, Ct); }
      });
      function sides(poly) {
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          quad([a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]], [b[0], y0, b[1]]);
        }
      }
      sides(outer); holes.forEach(sides);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
  function mergeGeometries(geometries) {
    const pos = [], nor = [];
    geometries.forEach(src => {
      if (!src) return;
      const g = src.index ? src.toNonIndexed() : src;
      const p = g.attributes.position, n = g.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        if (n) nor.push(n.getX(i), n.getY(i), n.getZ(i));
        else nor.push(0, 1, 0);
      }
      if (g !== src) g.dispose();
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.computeBoundingBox(); out.computeBoundingSphere();
    return out;
  }
  function boxAt(w, h, d, x, y, z) {
    const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g;
  }
  function gridMaterial(color, roughness, emissive) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: roughness == null ? 0.9 : roughness, metalness: 0.03, emissive: emissive || 0x17120e, emissiveIntensity: 0.16 });
    m.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWingWorld;')
        .replace('#include <project_vertex>', 'vWingWorld=(modelMatrix*vec4(transformed,1.0)).xyz;\n#include <project_vertex>');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWingWorld;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec2 wp=vWingWorld.xz;
          vec2 a=abs(fract(wp)-0.5);
          float thin=1.0-smoothstep(0.475,0.495,max(a.x,a.y));
          vec2 b=abs(fract(wp/5.0)-0.5);
          float strong=1.0-smoothstep(0.488,0.498,max(b.x,b.y));
          diffuseColor.rgb*=1.0-thin*0.055-strong*0.10;`);
    };
    m.customProgramCacheKey = () => 'wing-world-grid-v2';
    state.materials.push(m); return m;
  }
  function mesh(geometry, material, name, parent) {
    const m = new THREE.Mesh(geometry, material); m.name = name; m.castShadow = false; m.receiveShadow = true;
    if (name && /^K[234]-/.test(name)) m.userData.streamDress = true;
    (parent || state.root).add(m); return m;
  }
  async function makeColliders(solids, caps) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    solids.forEach(s => { const b = bbox(s.outer); minX = Math.min(minX, b.x0); minZ = Math.min(minZ, b.z0); maxX = Math.max(maxX, b.x1); maxZ = Math.max(maxZ, b.z1); });
    const nx = Math.ceil((maxX - minX) / GRID), nz = Math.ceil((maxZ - minZ) / GRID);
    try { console.info('[palace load] colliders-grid', nx, 'x', nz, 'solids', (solids||[]).length); } catch (_) {}
    const occupied = new Uint8Array(nx * nz);
    const tGrid = performance.now();
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const x = minX + (ix + 0.5) * GRID, z = minZ + (iz + 0.5) * GRID;
        if (pointInSolids(x, z, solids)) occupied[iz * nx + ix] = 1;
      }
      if ((iz & 7) === 7) {
        try { console.info('[palace load] colliders-row', iz, '/', nz, Math.round(performance.now()-tGrid)+'ms'); } catch (_) {}
        await yieldWing();
      }
    }
    try { console.info('[palace load] colliders-grid-done', Math.round(performance.now()-tGrid)+'ms'); } catch (_) {}
    const rects = [];
    for (let iz = 0; iz < nz; iz++) {
      let ix = 0;
      while (ix < nx) {
        if (!occupied[iz * nx + ix]) { ix++; continue; }
        const start = ix; while (ix < nx && occupied[iz * nx + ix]) ix++;
        rects.push({ ix0: start, ix1: ix - 1, iz0: iz, iz1: iz });
      }
    }
    const merged = [];
    while (rects.length) {
      const r = rects.shift();
      let extended = true;
      while (extended) {
        extended = false;
        for (const q of rects) {
          if (q.iz0 === r.iz1 + 1 && q.ix0 === r.ix0 && q.ix1 === r.ix1) { r.iz1 = q.iz1; rects.splice(rects.indexOf(q), 1); extended = true; break; }
        }
      }
      merged.push(r);
    }
    const boxes = merged.map(r => ({
      minx: minX + r.ix0 * GRID - 0.25, maxx: minX + (r.ix1 + 1) * GRID + 0.25,
      miny: 0, maxy: MAX_H,
      minz: minZ + r.iz0 * GRID - 0.25, maxz: minZ + (r.iz1 + 1) * GRID + 0.25,
      _wing: true
    }));
    caps.forEach(c => {
      const d = c.door;
      boxes.push(d.axis === 'x' ?
        { minx: d.x - 0.5, maxx: d.x + 0.5, miny: d.height, maxy: MAX_H, minz: d.z - d.width * 0.5, maxz: d.z + d.width * 0.5, _wing: true } :
        { minx: d.x - d.width * 0.5, maxx: d.x + d.width * 0.5, miny: d.height, maxy: MAX_H, minz: d.z - 0.5, maxz: d.z + 0.5, _wing: true });
    });
    state.colliders = boxes;
    state.spatial.clear();
    boxes.forEach((b, i) => {
      const x0 = Math.floor(b.minx), x1 = Math.floor(b.maxx), z0 = Math.floor(b.minz), z1 = Math.floor(b.maxz);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = x + ',' + z; let a = state.spatial.get(k); if (!a) state.spatial.set(k, a = []); a.push(i);
      }
    });
    return boxes;
  }
  function nearbyBoxes(x, z) {
    const out = [], seen = new Set(), ix = Math.floor(x), iz = Math.floor(z);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const a = state.spatial.get((ix + dx) + ',' + (iz + dz)) || [];
      for (const i of a) if (!seen.has(i)) { seen.add(i); out.push(state.colliders[i]); }
    }
    return out;
  }
  function cutCollider(box, cut) {
    const middle={...box}, pieces=[];
    for(const axis of ['x','y','z'])if(box['min'+axis]>=cut['max'+axis]||box['max'+axis]<=cut['min'+axis])return [box];
    for(const axis of ['x','y','z']){
      const lo='min'+axis,hi='max'+axis;
      if(middle[lo]<cut[lo]){
        pieces.push({...middle,[hi]:cut[lo]});middle[lo]=cut[lo];
      }
      if(middle[hi]>cut[hi]){
        pieces.push({...middle,[lo]:cut[hi]});middle[hi]=cut[hi];
      }
    }
    return pieces;
  }
  function capsuleBlocked(x, z, radius, fromY) {
    const r = radius == null ? 0.32 : radius;
    if (state.sacredHall && zoneIsReady('T3') && state.sacredHall.blocksDrop(x, z, r, fromY)) return true;
    const library = state.library && state.library.ready ? state.library : null;
    const libraryFeet = library && fromY != null ? library.floor(x, z, fromY) : 0;
    const observatory = state.observatory && zoneIsReady('L4') && state.observatory;
    const entrance = state.sacredEntrance && zoneIsReady('T1') ? state.sacredEntrance.floorAt(x,z) : 0;
    if (entrance > 0 && fromY != null && entrance > fromY + SinT1Entrance.maxStep) return true;
    const purification = state.purificationHall && zoneIsReady('T2') ? state.purificationHall.floorAt(x, z) : 0;
    if (purification > 0 && fromY != null && purification > fromY + .25) return true;
    const sanctuary = state.lunarSanctuary && zoneIsReady('T4') ? state.lunarSanctuary.floorAt(x, z) : 0;
    if (sanctuary > 0 && fromY != null && sanctuary > fromY + .33) return true;
    const offerings = state.royalOfferings && zoneIsReady('T5') ? state.royalOfferings.floorAt(x, z) : 0;
    const feet = (observatory && observatory.floorAt(x, z)) || offerings || sanctuary || purification || entrance || libraryFeet;
    if (offerings > 0 && fromY != null && offerings > fromY + .28) return true;
    if (observatory && observatory.blocks(x, z, r, feet)) return true;
    const hero = state.ctx && state.ctx.hero;
    if (library && fromY != null && hero) {
      const position = hero.position;
      const px = position.x - state.root.position.x, pz = position.z - state.root.position.z;
      const previous = library.floor(px, pz, fromY);
      const maxStep = library.crossesStairSide(px, pz, x, z) ? 0.23 : 0.95;
      if (Math.abs(libraryFeet - previous) > maxStep) return true;
    }
    for (const b of state.dynamicDoorBoxes) {
      if (b._templeDoor && (b.miny > feet+1.65 || b.maxy < feet+.08)) continue;
      const qx = Math.max(b.minx, Math.min(x, b.maxx)), qz = Math.max(b.minz, Math.min(z, b.maxz));
      if ((x - qx) * (x - qx) + (z - qz) * (z - qz) < r * r) return true;
    }
    for (const b of nearbyBoxes(x, z)) {
      if (b.miny > feet + 1.65 || b.maxy < feet + 0.08) continue;
      const qx = Math.max(b.minx, Math.min(x, b.maxx)), qz = Math.max(b.minz, Math.min(z, b.maxz));
      if ((x - qx) * (x - qx) + (z - qz) * (z - qz) < r * r) return true;
    }
    return false;
  }

  function columnGeometry() {
    const parts = [];
    parts.push(boxAt(1.25, 0.12, 1.25, 0, 0.06, 0));
    const shaft = new THREE.CylinderGeometry(0.39, 0.46, 0.76, 12, 1, false); shaft.translate(0, 0.5, 0); parts.push(shaft);
    parts.push(boxAt(1.12, 0.12, 1.12, 0, 0.94, 0));
    return mergeGeometries(parts);
  }
  function addColumns(r, parent, pairs, radius) {
    if (!pairs.length) return;
    const geo = state.columnGeo || (state.columnGeo = columnGeometry());
    const mat = state.columnMat || (state.columnMat = gridMaterial(0xa18b6d, 0.9, 0x21170f));
    const inst = new THREE.InstancedMesh(geo, mat, pairs.length);
    inst.name = r.id + '-columns'; inst.castShadow = false; inst.receiveShadow = true;
    const dummy = new THREE.Object3D();
    pairs.forEach((p, i) => {
      dummy.position.set(p[0], 0, p[1]); dummy.scale.set(radius * 2, r.height - 0.15, radius * 2); dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix);
      state.colliders.push({ minx: p[0] - radius * 0.75, maxx: p[0] + radius * 0.75, miny: 0, maxy: r.height, minz: p[1] - radius * 0.75, maxz: p[1] + radius * 0.75, _wing: true });
    });
    inst.instanceMatrix.needsUpdate = true; parent.add(inst);
  }
  function columnPairs(r, count, inset, zInset) {
    const out = [], b = r.bbox;
    for (let i = 0; i < count; i++) {
      const z = b.z0 + zInset + (b.z1 - b.z0 - 2 * zInset) * (count === 1 ? 0.5 : i / (count - 1));
      out.push([b.x0 + inset, z], [b.x1 - inset, z]);
    }
    return out;
  }
  function labelSprite(text) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 80;
    const g = c.getContext('2d'); g.fillStyle = 'rgba(5,4,3,.78)'; g.fillRect(0, 4, 512, 72);
    g.fillStyle = '#f4d89c'; g.font = '600 28px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 40);
    const t = new THREE.CanvasTexture(c); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
    s.scale.set(5.2, 0.82, 1); return s;
  }
  function futureZone(r, parent, label, x, z, w, d) {
    if (!state.debug) return;
    const y = 0.08, points = [
      new THREE.Vector3(x - w / 2, y, z - d / 2), new THREE.Vector3(x + w / 2, y, z - d / 2),
      new THREE.Vector3(x + w / 2, y, z - d / 2), new THREE.Vector3(x + w / 2, y, z + d / 2),
      new THREE.Vector3(x + w / 2, y, z + d / 2), new THREE.Vector3(x - w / 2, y, z + d / 2),
      new THREE.Vector3(x - w / 2, y, z + d / 2), new THREE.Vector3(x - w / 2, y, z - d / 2)
    ];
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xe7bd65, transparent: true, opacity: 0.9 }));
    lines.name = 'future-' + label; parent.add(lines);
    const s = labelSprite(label); s.position.set(x, 1.15, z); parent.add(s);
  }
  function addSpecials() {
    const stone = state.wallMat, dark = state.darkMat;
    const T4 = state.rooms.find(r => r.id === 'T4'), tg = state.regionGroups.get('T4');
    if (T4 && tg && !window.SinLunarSanctuary) {
      const geos = [];
      for (let i = 0; i < 5; i++) geos.push(boxAt(1.24, (i + 1) * 0.3, 10, T4.bbox.x1 - 13.8 + i * 1.2, (i + 1) * 0.15, T4.bbox.cz));
      geos.push(boxAt(8, 1.5, 12, T4.bbox.x1 - 4, 0.75, T4.bbox.cz));
      const support = mesh(mergeGeometries(geos), stone, 'T4-five-steps-platform', tg);
      state.floorSupport.push(support);
      futureZone(T4, tg, 'ALTAR', T4.bbox.x1 - 4, T4.bbox.cz, 4, 3);
    }
    // K5 has no procedural props: dressK5 uses only the supplied assets.
  }
  function addFutureZones(r, parent) {
    const b = r.bbox;
    if (r.id === 'K2') futureZone(r, parent, 'COUNCIL TABLE', b.cx, b.cz, 12, 4);
    if (r.id === 'K3') futureZone(r, parent, 'MAP TABLE', b.cx, b.cz, 7, 4);
    if (r.id === 'K4') { futureZone(r, parent, 'ROYAL CHESTS', b.cx - 3, b.cz, 3, 7); futureZone(r, parent, 'TOOLS', b.cx + 4, b.cz, 2, 6); }
    if (r.id === 'T2') futureZone(r, parent, 'PURIFICATION BASIN', b.cx, b.cz, 8, 6);
    if (r.id === 'L3') { futureZone(r, parent, 'WRITING TABLES', b.cx - 4, b.cz, 4, 8); futureZone(r, parent, 'WRITING TABLES', b.cx + 4, b.cz, 4, 8); }
  }
  function addTorches(r) {
    if (r.kind === 'threshold') return;
    // corridors and galleries use the repository torch models (dressCorridors)
    if (r.kind === 'corridor' || r.kind === 'gallery') return;
    const b = r.bbox, spacing = 10;
    function wall(a, b0, fixed, alongX) {
      const len = b0 - a, n = Math.max(1, Math.round(len / spacing));
      for (let i = 0; i < n; i++) {
        const v = a + len * (i + 0.5) / n;
        state.fires.push({ x: alongX ? v : fixed, y: 2.35, z: alongX ? fixed : v, intensity: 0.75, seed: state.fires.length * 0.731 + 0.4 });
      }
    }
    wall(b.x0 + 1, b.x1 - 1, b.z0 + 0.45, true); wall(b.x0 + 1, b.x1 - 1, b.z1 - 0.45, true);
    if (b.z1 - b.z0 > 8) { wall(b.z0 + 1, b.z1 - 1, b.x0 + 0.45, false); wall(b.z0 + 1, b.z1 - 1, b.x1 - 0.45, false); }
  }
  function loadK1Model(r, parent) {
    if (!window.THREE || !window.THREE.GLTFLoader) {
      console.warn('GLTFLoader not available for K1 model');
      return;
    }
    const url = WING_FILES.k1;
    wingGLB(url, function (gltf) {
      const model = gltf.scene;
      model.name = 'K1-RoyalReceptionHall';
      // K1 is non-uniformly fitted after rotation. Disable per-mesh frustum
      // culling so stale GLTF bounds cannot make the hall disappear when the
      // player enters from the palace alcove.
      model.traverse(function (node) {
        if (node.isMesh) { node.frustumCulled = false; node.visible = true; }
      });
      // The source GLB contains KHR_lights_punctual nodes at intensity 90-120.
      // Three.js instantiates them during parsing; keeping them causes the
      // white exposure spike when the player enters K1.  The game owns its
      // lighting, so keep the visible fixtures but remove only embedded lights.
      const embeddedLightNodes = [];
      model.traverse(function (node) {
        if (!node.isLight) return;
        embeddedLightNodes.push(node);
      });
      embeddedLightNodes.forEach(function (node) { if (node.parent) node.parent.remove(node); });
      const embeddedLights = embeddedLightNodes.length;
      model.updateMatrixWorld(true);
      // Gates are authored on Z; rotate them onto the room's west/east arches.
      model.rotation.y = Math.PI * 0.5;
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const gateCenters = {};
      model.traverse(function (node) {
        if (!node.isMesh || !/^K1_Gate_(Entrance_Main|Exit_ToK2)$/.test(node.name)) return;
        const gateBox = new THREE.Box3().setFromObject(node);
        gateCenters[node.name] = gateBox.getCenter(new THREE.Vector3()).x;
      });
      // Room size from region
      const roomD = r.bbox.z1 - r.bbox.z0;
      const roomH = r.height;
      // The model is rotated around Y, so the post-rotation X axis is the
      // west/east axis. Fit that full outer axis to the real interfaces. The
      // previous version fitted gate-center-to-gate-center, leaving the
      // decorative wall ends protruding through both adjoining walls.
      const westBoundary = r.bbox.x0;
      const palaceDoor = state.doors.find(d => d.id === 'PalaceL3');
      const eastBoundary = palaceDoor ? palaceDoor.x : r.bbox.x1;
      const sourceGateSpan = Math.abs((gateCenters.K1_Gate_Exit_ToK2 == null ? size.z * 0.5 : gateCenters.K1_Gate_Exit_ToK2) -
        (gateCenters.K1_Gate_Entrance_Main == null ? -size.z * 0.5 : gateCenters.K1_Gate_Entrance_Main));
      const targetOuterSpan = Math.max(0.001, eastBoundary - westBoundary);
      const scaleLocalX = roomD / Math.max(size.z, 0.001);
      const scaleLocalZ = targetOuterSpan / Math.max(size.x, 0.001);
      const scaleY = roomH / Math.max(size.y, 0.001);
      model.scale.set(scaleLocalX, scaleY, scaleLocalZ);
      const targetGateCenter = (westBoundary + eastBoundary) * 0.5;
      const targetZ = r.bbox.cz;
      model.position.set(0, -box.min.y * scaleY, 0);
      parent.add(model);
      state.root.updateMatrixWorld(true);
      const fitted0 = new THREE.Box3().setFromObject(model);
      const fittedCenter0 = fitted0.getCenter(new THREE.Vector3());
      const fittedCenterLocalX = fittedCenter0.x - state.root.position.x;
      model.position.x += targetGateCenter - fittedCenterLocalX;
      model.position.z += targetZ + state.root.position.z - fittedCenter0.z;
      model.updateMatrixWorld(true);
      model.visible = true;
      let floorTop = 0;
      model.traverse(function (node) {
        if (!node.isMesh || !/^K1_(Floor|Carpet)/.test(node.name)) return;
        const fb = new THREE.Box3().setFromObject(node);
        floorTop = Math.max(floorTop, fb.max.y - state.root.position.y);
        if (state.floorMeshes && state.floorMeshes.indexOf(node) < 0) state.floorMeshes.push(node);
      });
      state.k1FloorY = Math.max(0, floorTop);
      addK1ModelColliders(model);
      const fittedBox = new THREE.Box3().setFromObject(model);
      // Hide only palace geometry that occupies K1's already-fitted volume.
      // This is a palace-material mask, not a transform or collider change.
      // No other wing is inside these bounds.
      if (window.__K1PalaceHole) {
        window.__K1PalaceHole.min.value.copy(fittedBox.min).subScalar(0.05);
        window.__K1PalaceHole.max.value.copy(fittedBox.max).addScalar(0.05);
        window.__K1PalaceHole.enabled.value = 1;
      }
      const fitted = fittedBox.getSize(new THREE.Vector3());
      state.k1ModelMetrics = { size: fitted.toArray(), scale: [scaleLocalX, scaleY, scaleLocalZ], outerSpan: targetOuterSpan, sourceGateSpan: sourceGateSpan, floorY: state.k1FloorY, embeddedLightsRemoved: embeddedLights };
      console.info('K1 model loaded and fitted to both gates', state.k1ModelMetrics);
      // Add approximate wall colliders for the room (perimeter, inset for doors)
      addK1Colliders(r);
    }, function (err) {
      console.error('Failed to load K1 model', err);
    });
  }
  function addK1Colliders(r) {
    // Simple perimeter colliders so player doesn't fall through or walk through walls
    // Doors are on the sides; leave openings roughly matching door positions
    const wallT = 0.8;
    const h = r.height;
    // Keep procedural wing structure on its authored K1 room footprint. The
    // GLB alone is stretched to the palace facade; extending these walls into
    // the alcove corrupts the neighbouring wing/corridor structure.
    const x0 = r.bbox.x0, x1 = r.bbox.x1, z0 = r.bbox.z0, z1 = r.bbox.z1;
    const cx = r.bbox.cx, cz = r.bbox.cz;
    // Four walls, with matched west/east gaps for the two arch openings.
    // K1's GLB gates are on the west/east sides after the loader rotation.
    state.colliders.push({ minx: x0, miny: 0, minz: z0 - wallT, maxx: x1, maxy: h, maxz: z0 });
    // North wall
    state.colliders.push({ minx: x0, miny: 0, minz: z1, maxx: x1, maxy: h, maxz: z1 + wallT });
    const westDoor = state.doors.find(d => d.id === 'K1-KC12');
    const eastDoor = state.doors.find(d => d.id === 'PalaceL3');
    const westGap = Math.max(3, westDoor ? westDoor.width * 0.5 : 3);
    const eastGap = Math.max(3, eastDoor ? eastDoor.width * 0.5 : 3);
    // West wall: corridor opening.
    state.colliders.push({ minx: x0 - wallT, miny: 0, minz: z0, maxx: x0, maxy: h, maxz: cz - westGap });
    state.colliders.push({ minx: x0 - wallT, miny: 0, minz: cz + westGap, maxx: x0, maxy: h, maxz: z1 });
    // East wall: palace arch opening.
    state.colliders.push({ minx: x1, miny: 0, minz: z0, maxx: x1 + wallT, maxy: h, maxz: cz - eastGap });
    state.colliders.push({ minx: x1, miny: 0, minz: cz + eastGap, maxx: x1 + wallT, maxy: h, maxz: z1 });
    // Rebuild spatial after adding
    if (typeof rebuildSpatial === 'function') rebuildSpatial();
  }
  function addK1ModelColliders(model) {
    const rootX = state.root.position.x, rootZ = state.root.position.z;
    const selected = /K1_(Column|VaseLarge|VaseSmall)_/;
    let added = 0;
    model.traverse(function (node) {
      if (!node.isMesh || !selected.test(node.name)) return;
      const b = new THREE.Box3().setFromObject(node);
      const minx = b.min.x - rootX, maxx = b.max.x - rootX;
      const minz = b.min.z - rootZ, maxz = b.max.z - rootZ;
      if (![minx, maxx, minz, maxz, b.min.y, b.max.y].every(Number.isFinite)) return;
      const pad = node.name.indexOf('Column') >= 0 ? 0.10 : 0.08;
      state.colliders.push({
        minx: minx - pad, maxx: maxx + pad,
        miny: Math.max(0, b.min.y - state.root.position.y),
        maxy: b.max.y - state.root.position.y,
        minz: minz - pad, maxz: maxz + pad, _wing: true, _k1Model: true
      });
      added++;
    });
    state.k1ModelColliderCount = added;
    rebuildSpatial();
  }
  async function buildVisuals(layout) {
    const tV = performance.now();
    function vis(name) {
      try { console.info('[palace load] visuals-' + name, Math.round(performance.now() - tV) + 'ms'); } catch (_) {}
    }
    vis('start');
    await yieldWing();
    vis('after-first-yield');
    state.floorSupport = [];
    state.wallMat = gridMaterial(0x8d7a63, 0.9, 0x1c1510);
    state.darkMat = new THREE.MeshStandardMaterial({ color: 0x070706, roughness: 1, emissive: 0x010101, emissiveIntensity: 0.1 });
    state.sealMat = new THREE.MeshStandardMaterial({ color: 0xa58a61, roughness: 0.72, metalness: 0.18 });
    state.materials.push(state.darkMat, state.sealMat);
    vis('materials');
    const tCaps = performance.now();
    const capGeos=[], templeLintels=[], libraryLintels=[];
    (state.caps || []).forEach(function (c, i) {
      const t1 = performance.now();
      // L1's large arch rises past the corridor's flat ceiling. Set the
      // visible lintel back from its crown while keeping the baked collider.
      const bottom = c.door.id === 'L1-LC4' ? 7.78 : c.door.height;
      const g = extrudeSolids(c.solids, bottom, MAX_H);
      const dt = performance.now() - t1;
      if (dt > 16) {
        try { console.info('[palace load] visuals-slow-cap', i, c.door && c.door.id, Math.round(dt) + 'ms'); } catch (_) {}
      }
      const target=state.templeDoorIds.has(c.door.id)?templeLintels:state.libraryDoorIds?.has(c.door.id)?libraryLintels:capGeos;
      target.push(g);
    });
    vis('caps ' + Math.round(performance.now() - tCaps) + 'ms n=' + capGeos.length);
    await yieldWing();
    // The palace's own decorated wall modules already fill the band |x| <= hall half-width + wall thickness.
    // Drawing the wing threshold walls inside that band makes their flat plaster faces poke through the
    // relief around the open arches. Colliders still use the full baseWall, so walking limits are unchanged.
    const hwv = state.hall.width * 0.5, wtv = state.hall.wallThickness || 0;
    const palaceBand = solid(polyRect(-hwv - wtv - 0.02, -0.5, (hwv + wtv + 0.02) * 2, state.hall.length + 1));
    let visualWall = difference(state.baseWall, palaceBand);
    // K1's GLB is stretched east to the palace arch (PalaceL3). The 1 m wing
    // wall ring between K1's region edge and that arch stood inside the model
    // and showed as a flat white slab over the decorated K1 wall. Visual only:
    // colliders still use baseWall + addK1Colliders.
    const k1v = state.rooms.find(r => r.id === 'K1'), pl3v = state.doors.find(d => d.id === 'PalaceL3');
    if (k1v && pl3v) visualWall = difference(visualWall, solid(polyRect(k1v.bbox.x0, k1v.bbox.z0, pl3v.x - k1v.bbox.x0 + 0.05, k1v.bbox.z1 - k1v.bbox.z0)));
    for (const opening of state.privateApertures || []) {
      visualWall = difference(visualWall, solid(polyRect(opening.x-.15,opening.z-opening.half,1.55,opening.half*2)));
    }
    state.visualWallSolid = visualWall;
    vis('wall-diff');
    await yieldWing();
    state.wallGeometry = mergeGeometries([extrudeSolids(visualWall, 0, MAX_H)].concat(capGeos));
    wingMark('wings wall mesh');
    state.wallMesh = mesh(state.wallGeometry, state.wallMat, 'wings-unified-watertight-walls');
    vis('wall-mesh');
    await yieldWing();
    const floorMats = {
      Kings: gridMaterial(0x80705a, 0.94, 0x1d1710), Temple: gridMaterial(0x65756e, 0.94, 0x121c18),
      Library: gridMaterial(0x756b7e, 0.94, 0x19151d), Shared: gridMaterial(0x746653, 0.94, 0x19150f)
    };
    state.floorMeshes = []; state.floorWingSolids = [];
    const sacredRoom = window.SinSacredColumns && state.rooms.find(r => r.id === 'T3');
    let templeWaterCuts = [];
    if (sacredRoom) {
      const { cx, cz } = sacredRoom.bbox;
      for (const { l, r, n, f } of SinSacredColumns.channelLayout(sacredRoom).flatMap(channel => channel.tiles)) {
        templeWaterCuts = union(templeWaterCuts, solid(polyRect(cx + l, cz + n, r - l, f - n)));
      }
    }
    const purification = window.SinPurificationHall && state.rooms.find(r => r.id === 'T2');
    if (purification) {
      const { cx, cz } = purification.bbox;
      for (const { l, r, n, f } of SinPurificationHall.pools(purification)) {
        templeWaterCuts = union(templeWaterCuts, solid(polyRect(cx + l, cz + n, r - l, f - n)));
      }
    }
    let claimedFloor = [];
    ['Kings', 'Temple', 'Library', 'Shared'].forEach((wing, wi) => {
      let wingFloor = [];
      state.regions.filter(r => r.wing === wing && r.id !== 'K1' && r.id !== 'K2' && r.id !== 'K3').forEach(r => { wingFloor = union(wingFloor, solid(r.poly)); });
      layout.doors.filter(d => d.kind !== 'arch').forEach(d => {
        const target = state.regions.find(r => r.id === d.to), source = state.regions.find(r => r.id === d.from);
        if ((target && target.wing === wing) || (source && source.wing === wing)) wingFloor = union(wingFloor, solid(d.floorPoly));
      });
      wingFloor = difference(wingFloor, claimedFloor);
      claimedFloor = union(claimedFloor, wingFloor);
      state.floorWingSolids.push({ wing,
        solids: wing === 'Temple' && templeWaterCuts.length ? difference(wingFloor, templeWaterCuts) : wingFloor });
      let skirt = offset(wingFloor, 0.3);
      if (wing === 'Temple' && templeWaterCuts.length) skirt = difference(skirt, templeWaterCuts);
      if (wing === 'Kings') {
        const k2 = state.regions.find(r => r.id === 'K2');
        if (k2) {
          state.k2FloorSolids = solid(k2.poly);
          skirt = difference(skirt, state.k2FloorSolids);
        }
        const k3 = state.regions.find(r => r.id === 'K3');
        if (k3) {
          state.k3FloorSolids = solid(k3.poly);
          skirt = difference(skirt, state.k3FloorSolids);
        }
      }
      const g = extrudeSolids(skirt, -0.25, wi * 0.002);
      state.floorMeshes.push(mesh(g, floorMats[wing], 'wings-floor-' + wing));
    });
    vis('floors');
    await yieldWing();
    state.ceilings = [];
    for (const r of state.regions) {
      const g = new THREE.Group(); g.name = 'wing-region-' + r.id; state.root.add(g); state.regionGroups.set(r.id, g);
      if (r.ceiling !== false) {
        let poly = solid(r.poly);
        if (r.id === 'L4') poly = difference(poly, solid(polyCircle(r.bbox.cx, r.bbox.cz, 2.5, 32)));
        const ceiling = mesh(extrudeSolids(poly, r.height, r.height + 0.25), state.wallMat, r.id + '-ceiling', g);
        if (r.id === 'L1') ceiling.userData.hallShell = true;
        ceiling.userData.ceiling = true; state.ceilings.push(ceiling);
        if (r.id === 'L4') {
          const ring = difference(solid(polyCircle(r.bbox.cx, r.bbox.cz, 3.0, 32)), solid(polyCircle(r.bbox.cx, r.bbox.cz, 2.5, 32)));
          mesh(extrudeSolids(ring, r.height, r.height + 3), state.wallMat, 'L4-oculus-shaft', g);
          mesh(extrudeSolids(solid(polyCircle(r.bbox.cx, r.bbox.cz, 3.0, 32)), r.height + 3, r.height + 3.25), state.darkMat, 'L4-oculus-dark-cap', g);
        }
      }
      if (r.id === 'K1') { /* procedural geometry removed for GLB model */ loadK1Model(r, g); }
      // K2 columns are the real asset extracted from الاستقبال.glb (dressK2).
      // K2 and K3 keep their own dressings, so the procedural torch brackets stay out.
      if (r.id !== 'K1') {
        if (r.id !== 'K4' && r.id !== 'K5' && !(r.id==='L3' && window.SinPrivateRooms)) addFutureZones(r, g);
        if (!['K2', 'K3', 'K4', 'K5', 'T1', 'T3', 'L1', 'L2', 'L4', 'L3', 'K5'].includes(r.id) &&
            !(r.id === 'T5' && window.SinRoyalOfferings) && !(r.id === 'T4' && window.SinLunarSanctuary) && !(r.id === 'T2' && window.SinPurificationHall)) addTorches(r);
      }
    }
    vis('regions');
    await yieldWing();
    addSpecials();
    vis('specials');
    await yieldWing();
    await dressCorridors();
    const archiveOpening = state.archivePortals[2];
    const archiveCorridor = state.regionGroups.get('LC2');
    if (archiveOpening && archiveCorridor && !state.libraryDoorIds?.has(archiveOpening.id)) {
      const { x, z, width, height } = archiveOpening;
      // The far archive portal remains occluded until all of L2 can be
      // drawn. This is inside LC2, beyond the permanently open L1 arch.
      const panel = boxAt(width + .08, height + .04, .12, x, height / 2, z);
      state.archiveScreen = mesh(panel, state.darkMat, 'LC2-archive-portal-occluder', archiveCorridor);
      state.archiveScreen.castShadow = false;
    }
    if (state.studyDoor && !state.libraryDoorIds?.has(state.studyDoor.id)) {
      const d=state.studyDoor;
      state.studyScreen=mesh(boxAt(d.width+.03,d.height,.09,d.x,d.height/2,d.z),
        state.darkMat,'L3-pending-study',state.regionGroups.get('LC3'));
      state.studyScreen.castShadow=false;
    }
    state.kingScreens=[];
    if(window.SinPrivateRooms)for(const d of state.doors.filter(d=>d.from==='K5'||d.to==='K5')){
      const corridor=state.regionGroups.get(d.from==='K5'?d.to:d.from);
      const screen=mesh(boxAt(d.width+.04,d.height,.09,d.x,d.height/2,d.z),state.darkMat,d.id+'-pending-apartments',corridor);
      state.kingScreens.push(screen);
    }
    const offeringCorridor = state.regionGroups.get('TC5');
    if (state.offeringPortal && !state.templeDoorIds?.has(state.offeringPortal.id) && offeringCorridor && window.SinRoyalOfferings) {
      const { x, z, width, height } = state.offeringPortal;
      state.offeringScreen = mesh(boxAt(width + .08, height + .04, .16, x, height / 2, z),
        state.darkMat, 'TC5-offerings-portal-occluder', offeringCorridor);
      state.offeringScreen.castShadow = false;
    }
    if (window.SinT1Entrance) {
      state.entranceScreens = state.entranceDoors.filter(d=>!state.templeDoorIds?.has(d.id)).map(d => {
        const outside = d.kind === 'arch' ? 'ARCH_R3' : (d.from === 'T1' ? d.to : d.from);
        const corridor = state.regionGroups.get(outside);
        const width = d.width + .07, h = d.height + .05;
        const [w, depth] = d.axis==='x' ? [.17,width] : [width,.17];
        return mesh(boxAt(w,h,depth,d.x,h*.5,d.z),state.darkMat,
          d.id+'-entrance-portal-occluder',corridor);
      });
    }
    if (window.SinPurificationHall) {
      state.purificationScreens = state.purificationDoors.filter(d=>!state.templeDoorIds?.has(d.id)).map(d => {
        const corridor = state.regionGroups.get(d.from === 'T2' ? d.to : d.from);
        return mesh(boxAt(.17, d.height + .05, d.width + .06, d.x, d.height / 2, d.z),
          state.darkMat, d.id + '-purification-portal-occluder', corridor);
      });
    }
    if (window.SinLunarSanctuary) {
      state.sanctuaryScreens = state.sanctuaryDoors.filter(d=>!state.templeDoorIds?.has(d.id)).map(d => {
        const outside = state.regionGroups.get(d.from === 'T4' ? d.to : d.from);
        const width = d.width + .08;
        const [w, depth] = d.axis === 'x' ? [.16, width] : [width, .16];
        return mesh(boxAt(w, d.height + .04, depth, d.x, d.height / 2, d.z),
          state.darkMat, d.id + '-sanctuary-portal-occluder', outside);
      });
    }
    vis('corridors');
    wingMark('wings corridors');
    try { console.info('[palace load] visuals-post-corridors fires', state.fires.length); } catch (_) {}
    await yieldWing();
    try { console.info('[palace load] visuals-post-corridors-yield'); } catch (_) {}
    wingMark('wings k2');
    wingMark('wings k3');
    wingMark('wings k4');
    const tTorch = performance.now();
    if (state.fires.length) {
      const bracket = new THREE.CylinderGeometry(0.09, 0.13, 0.8, 8); bracket.translate(0, -0.35, 0);
      const torches = new THREE.InstancedMesh(bracket, state.sealMat, state.fires.length); torches.name = 'wings-wall-torches';
      const dummy = new THREE.Object3D();
      state.fires.forEach((f, i) => { dummy.position.set(f.x, f.y, f.z); dummy.updateMatrix(); torches.setMatrixAt(i, dummy.matrix); });
      torches.instanceMatrix.needsUpdate = true; state.root.add(torches);
    }
    try { console.info('[palace load] visuals-torches', Math.round(performance.now() - tTorch) + 'ms'); } catch (_) {}
    const tMx = performance.now();
    state.root.updateMatrixWorld(true);
    try { console.info('[palace load] visuals-matrix', Math.round(performance.now() - tMx) + 'ms'); } catch (_) {}
    return {Temple:templeLintels.length?mergeGeometries(templeLintels):null,Library:libraryLintels.length?mergeGeometries(libraryLintels):null};
  }
  /* ---------------------------------------------------------------------------
     Corridor dressing: every corridor/gallery region of the Kings, Library and
     Temple wings (plus the shared passages that link them) is re-skinned with
     the repository corridor assets only:
       assets/ارضية الممرات.JPG  -> corridor floors (incl. the door strips)
       assets/سجاد الممرات.JPG   -> centered, width-fitted corridor runners
       assets/سقف الممرات.PNG    -> corridor ceilings
       assets/جدار الممرات.jpg   -> corridor wall faces + door lintels
       assets/شتله.glb           -> potted plants, repeated on both sides
     Rooms are never touched: corridor pieces are clipped against every room
     polygon and against each other, so no surface is drawn twice. */
  const CORRIDOR_TILE = { floor: 2.0, ceiling: 3.0, wall: 3.0 };
  const CORRIDOR_ASSETS = {
    floor: WING_FILES.corridorFloor, carpet: WING_FILES.corridorCarpet, ceiling: WING_FILES.corridorCeiling,
    wall: WING_FILES.corridorWall, plant: WING_FILES.plant
  };
  function textureDisposed(t) {
    // Evict calls dispose() and may null the CPU pixels (source.data / image).
    // A preloaded map in that state must not be reused for a second dress.
    if (!t) return true;
    const img = t.image || (t.source && t.source.data);
    if (t.source && t.source.data === null && !t.image) return true;
    if (img === null) return true;
    return false;
  }
  function corridorTexture(url) {
    let cached = preloadedTexture(url);
    if (cached && textureDisposed(cached)) { preloaded.delete(url); cached = null; }
    const tex = cached || new THREE.TextureLoader().load(encodeURI(url), t => { t.needsUpdate = true; });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 8; if (cached) tex.needsUpdate = true; return tex;
  }
  function corridorMaterial(url, rough) {
    const m = new THREE.MeshStandardMaterial({ map: corridorTexture(url), roughness: rough, metalness: 0.02, emissive: 0x17120e, emissiveIntensity: 0.16 });
    state.materials.push(m); return m;
  }
  // Flat triangulated sheet over clipper solids, world-anchored UVs so adjacent
  // corridor pieces continue the pattern without seams.
  function flatSheet(solids, y, faceUp, tile) {
    const pos = [], uv = [], nor = [];
    (solids || []).forEach(s => {
      const outer = cleanPoly(s.outer, true), holes = (s.holes || []).map(h => cleanPoly(h, false));
      if (outer.length < 3) return;
      let faces = [];
      try { faces = THREE.ShapeUtils.triangulateShape(outer.map(p => new THREE.Vector2(p[0], p[1])), holes.map(h => h.map(p => new THREE.Vector2(p[0], p[1])))); } catch (e) { console.error('Corridor triangulation', e); }
      const verts = outer.concat.apply(outer, holes);
      faces.forEach(f => {
        let a = verts[f[0]], b = verts[f[1]], c = verts[f[2]];
        const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        // In X/Z, a negative cross gives an upward (+Y) facing triangle.
        if ((cross < 0) !== faceUp) { const t = b; b = c; c = t; }
        [a, b, c].forEach(p => { pos.push(p[0], y, p[1]); uv.push(p[0] / tile, p[1] / tile); nor.push(0, faceUp ? 1 : -1, 0); });
      });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  }
  // A clipped, narrow carpet strip follows the corridor axis. UVs are measured
  // in metres so the supplied portrait rug repeats at its natural proportions.
  function carpetSheet(solids, y, alongX, center, width, tileLength, alongOrigin) {
    const pos = [], uv = [], nor = [];
    (solids || []).forEach(s => {
      const outer = cleanPoly(s.outer, true), holes = (s.holes || []).map(h => cleanPoly(h, false));
      if (outer.length < 3) return;
      let faces = [];
      try { faces = THREE.ShapeUtils.triangulateShape(outer.map(p => new THREE.Vector2(p[0], p[1])), holes.map(h => h.map(p => new THREE.Vector2(p[0], p[1])))); }
      catch (e) { console.error('Corridor carpet triangulation', e); return; }
      const verts = outer.concat.apply(outer, holes);
      faces.forEach(f => {
        let a = verts[f[0]], b = verts[f[1]], c = verts[f[2]];
        const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (cross >= 0) { const t = b; b = c; c = t; }
        [a, b, c].forEach(p => {
          const across = alongX ? p[1] - center : p[0] - center;
          const along = alongX ? p[0] : p[1];
          pos.push(p[0], y, p[1]);
          uv.push((across + width * 0.5) / width, (along - alongOrigin) / tileLength);
          nor.push(0, 1, 0);
        });
      });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  }
  // Every face of the real wall solid that looks into this corridor (side
  // walls, end walls, door jambs, door walls standing inside the corridor) is
  // collected in 0.25 m steps and merged into straight runs.
  function corridorWallRuns(wallSolids, area) {
    const runs = [], STEP = 0.25, INSET = 0.012;
    (wallSolids || []).forEach(s => {
      [cleanPoly(s.outer, true)].concat((s.holes || []).map(h => cleanPoly(h, false))).forEach(poly => {
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) continue;
          const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L;
          let wx = tz, wz = -tx;
          const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
          if (pointInSolids(mx + wx * 0.05, mz + wz * 0.05, wallSolids)) { wx = -wx; wz = -wz; }
          const n = Math.max(1, Math.round(L / STEP)), st = L / n;
          let cur = null;
          for (let k = 0; k < n; k++) {
            const cx = a[0] + tx * st * (k + 0.5), cz = a[1] + tz * st * (k + 0.5);
            const inside = pointInSolids(cx + wx * 0.2, cz + wz * 0.2, area);
            if (inside) { if (cur) cur.s1 = st * (k + 1); else cur = { a, tx, tz, nx: -wx, nz: -wz, s0: st * k, s1: st * (k + 1), inset: INSET }; }
            else if (cur) { runs.push(cur); cur = null; }
          }
          if (cur) runs.push(cur);
        }
      });
    });
    return runs;
  }
  function wallQuads(segs, yOf, tile) {
    const pos = [], uv = [], nor = [];
    segs.forEach(r => {
      const [y0, y1] = yOf(r);
      if (y1 - y0 < 0.02 || r.s1 - r.s0 < 0.02) return;
      const ix = -r.nx * r.inset, iz = -r.nz * r.inset;
      const P = s => [r.a[0] + r.tx * s + ix, r.a[1] + r.tz * s + iz];
      const p0 = P(r.s0), p1 = P(r.s1);
      // world-anchored U so walls continue across corners and pieces
      const u0 = (p0[0] * Math.abs(r.tx) + p0[1] * Math.abs(r.tz)) / tile;
      const u1 = u0 + (r.s1 - r.s0) * (r.tx + r.tz >= 0 ? 1 : -1) / tile;
      const A = [p0[0], y0, p0[1]], B = [p1[0], y0, p1[1]], Cq = [p1[0], y1, p1[1]], D = [p0[0], y1, p0[1]];
      const uA = [u0, y0 / tile], uB = [u1, y0 / tile], uC = [u1, y1 / tile], uD = [u0, y1 / tile];
      // face inward (-outward normal)
      const fx = -r.nx, fz = -r.nz;
      const e1 = [B[0] - A[0], 0, B[2] - A[2]];
      const cr = e1[2] * 1 - 0; // (e1 x up).x sign helper
      const flip = (e1[0] * 0 - 0) + 0; void cr; void flip;
      // normal of (A,B,C) = (B-A)x(C-A) = (e1x,0,e1z)x(…,h,…) -> (-e1z*h, 0, e1x*h)
      const want = (-e1[2]) * fx + e1[0] * fz > 0;
      const tri = want ? [A, B, Cq, A, Cq, D] : [A, Cq, B, A, D, Cq];
      const tuv = want ? [uA, uB, uC, uA, uC, uD] : [uA, uC, uB, uA, uD, uC];
      tri.forEach((p, i) => { pos.push(p[0], p[1], p[2]); uv.push(tuv[i][0], tuv[i][1]); nor.push(fx, 0, fz); });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  }
  async function dressCorridors() {
    const tDress = performance.now();
    function dressLog(name) {
      try { console.info('[palace load] dress-' + name, Math.round(performance.now() - tDress) + 'ms'); } catch (_) {}
    }
    dressLog('start');
    const corridors = state.connectors.filter(r => r.kind === 'corridor' || r.kind === 'gallery');
    const mats = {
      floor: corridorMaterial(CORRIDOR_ASSETS.floor, 0.86),
      ceiling: corridorMaterial(CORRIDOR_ASSETS.ceiling, 0.92),
      wall: corridorMaterial(CORRIDOR_ASSETS.wall, 0.9)
    };
    const carpetTex = corridorTexture(CORRIDOR_ASSETS.carpet);
    const carpetMat = new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 0.96, metalness: 0, side: THREE.DoubleSide });
    state.materials.push(carpetMat);
    mats.ceiling.side = THREE.FrontSide;
    let roomsSolid = []; state.rooms.forEach(r => { roomsSolid = union(roomsSolid, solid(r.poly)); });
    state.corridorCeilings = [];
    let claimed = [], claimedDoors = [];
    const plantSlots = [], report = [], torchSlots = [], dressedRuns = [];
    for (const r of corridors) {
      const g = state.regionGroups.get(r.id); if (!g) continue;
      const tC = performance.now();
      const piece = difference(difference(solid(r.poly), roomsSolid), claimed);
      claimed = union(claimed, piece);
      if (!piece.length) continue;
      // door strips through the 1 m walls that open from this corridor
      let doorStrip = [];
      state.doors.filter(d => d.kind !== 'arch' && d.floorPoly && (d.from === r.id || d.to === r.id)).forEach(d => { doorStrip = union(doorStrip, solid(d.floorPoly)); });
      doorStrip = difference(difference(doorStrip, claimedDoors), claimed);
      claimedDoors = union(claimedDoors, doorStrip);
      const floorG = flatSheet(union(piece, doorStrip), 0.012, true, CORRIDOR_TILE.floor);
      const fm = mesh(floorG, mats.floor, r.id + '-corridor-floor', g); fm.renderOrder = 1;
      const h = r.height;
      const cm = mesh(flatSheet(piece, h - 0.012, false, CORRIDOR_TILE.ceiling), mats.ceiling, r.id + '-corridor-ceiling', g);
      cm.userData.ceiling = true; state.corridorCeilings.push(cm);
      const area = union(piece, doorStrip);
      // door walls may stand inside the corridor footprint, so keep every wall
      // solid touching the corridor and sample only its free (walkable) side
      const wallsHere = intersection(state.baseWall, offset(area, 1.6));
      const wallsPad = offset(wallsHere, 0.4);
      const freeArea = difference(area, state.baseWall);
      const runs = corridorWallRuns(wallsHere, freeArea);
      const lintelRuns = [], soffits = [];
      state.doors.filter(d => d.kind !== 'arch' && d.openPoly && (d.from === r.id || d.to === r.id)).forEach(d => {
        const op = solid(d.openPoly);
        corridorWallRuns(op, difference(freeArea, op)).forEach(l => { l.door = d; lintelRuns.push(l); });
        const under = intersection(op, area);
        if (under.length) soffits.push({ d, under });
      });
      const parts = [
        wallQuads(runs, () => [0, h - 0.012], CORRIDOR_TILE.wall),
        wallQuads(lintelRuns, l => [Math.min(l.door.height, h), h - 0.012], CORRIDOR_TILE.wall)
      ];
      soffits.forEach(sf => {
        // L1 supplies a recessed stone soffit at the observatory arch.
        if (sf.d.id !== 'L1-LC4') parts.push(flatSheet(sf.under, Math.min(sf.d.height, h) - 0.012, false, CORRIDOR_TILE.wall));
      });
      mesh(mergeGeometriesUV(parts), mats.wall, r.id + '-corridor-walls', g);
      runs.forEach(x => dressedRuns.push(x)); lintelRuns.forEach(x => dressedRuns.push(x));
      const lintels = lintelRuns;
      placeCorridorTorches(r, runs, freeArea, torchSlots);
      const rugB = r.bbox, rugDx = rugB.x1 - rugB.x0, rugDz = rugB.z1 - rugB.z0;
      const alongX = rugDx >= rugDz;
      const passageWidth = alongX ? rugDz : rugDx;
      const rugWidth = Math.min(3.0, passageWidth * 0.62);
      const rugBand = alongX
        ? solid(polyRect(rugB.x0 - 0.05, rugB.cz - rugWidth * 0.5, rugDx + 0.1, rugWidth))
        : solid(polyRect(rugB.cx - rugWidth * 0.5, rugB.z0 - 0.05, rugWidth, rugDz + 0.1));
      const rugArea = intersection(area, rugBand);
      if (rugArea.length && rugWidth > 0.1) {
        const rugTileLength = rugWidth * 1774 / 585;
        const rugGeo = carpetSheet(rugArea, 0.018, alongX, alongX ? rugB.cz : rugB.cx, rugWidth,
          rugTileLength, alongX ? rugB.x0 : rugB.z0);
        const rugMesh = mesh(rugGeo, carpetMat, r.id + '-corridor-carpet', g);
        rugMesh.renderOrder = 3; rugMesh.castShadow = false; rugMesh.receiveShadow = true;
      }
      // plant slots along every solid wall run, both sides
      const b = r.bbox, dx = b.x1 - b.x0, dz = b.z1 - b.z0;
      // transverse width; short wall stubs (KC3/KC4) report their long side
      const width = Math.min(dx, dz) >= 2.5 ? Math.min(dx, dz) : Math.max(dx, dz);
      const spacing = Math.min(6.0, Math.max(3.5, width * 0.85));
      const off = Math.min(0.7, Math.max(0.45, width * 0.09));
      const margin = Math.max(1.0, off + 0.6);
      let count = 0;
      runs.forEach(run => {
        const len = run.s1 - run.s0 - margin * 2; if (len < -1.0) return;
        const n = Math.floor(len / spacing) + 1, used = (n - 1) * spacing;
        for (let i = 0; i < n; i++) {
          const s = run.s0 + margin + (len - used) / 2 + i * spacing;
          let x = 0, z = 0, ok = false;
          for (const shift of [0, 1.0, -1.0]) {
            const ss = s + shift; if (ss < run.s0 + 0.6 || ss > run.s1 - 0.6) continue;
            x = run.a[0] + run.tx * ss - run.nx * off; z = run.a[1] + run.tz * ss - run.nz * off;
            if (!pointInSolids(x, z, freeArea) || pointInSolids(x, z, wallsPad)) continue;
            if (state.fires.some(f => Math.hypot(f.x - x, f.z - z) < 0.7)) continue;
            if (torchSlots.some(t => Math.hypot(t.x - x, t.z - z) < 1.1)) continue;
            if (plantSlots.some(p => Math.hypot(p.x - x, p.z - z) < spacing * 0.6)) continue;
            if (state.doors.some(d => d.kind !== 'arch' && Math.hypot(d.x - x, d.z - z) < d.width * 0.5 + 0.4)) continue;
            ok = true; break;
          }
          if (!ok) continue;
          plantSlots.push({ x, z, region: r.id, width, rot: (plantSlots.length * 2.399) % (Math.PI * 2) }); count++;
        }
      });
      report.push({ id: r.id, wing: r.wing, bbox: r.bbox, width, plants: count, wallRuns: runs.length, lintels: lintels.length });
      try { console.info('[palace load] dress-corridor', r.id, Math.round(performance.now() - tC) + 'ms', 'plants', count); } catch (_) {}
      if (performance.now() - tDress > 45) await yieldWing();
    }
    try { fillUndressedCorridorWalls(dressedRuns, roomsSolid, mats.wall); } catch (e) { try { console.warn('[palace load] corridor wall fill', e && (e.message || e)); } catch (_) {} }
    dressLog('corridors-done n=' + corridors.length);
    state.corridorReport = report;
    state.corridorPlants = plantSlots;
    // footprint colliders so the hero walks around the pots
    plantSlots.forEach(p => {
      const rr = 0.32;
      state.colliders.push({ minx: p.x - rr, maxx: p.x + rr, miny: 0, maxy: 1.2, minz: p.z - rr, maxz: p.z + rr, _wing: true, _plant: true });
    });
    loadCorridorPlants(plantSlots);
    state.corridorTorches = torchSlots;
    loadCorridorTorches(torchSlots);
  }
  // Some wall faces bordering corridor/passage floor were never covered by a
  // corridor dress (corner pieces claimed by a neighbouring corridor, short
  // arch passages) and showed the bare light plaster. Cover exactly those
  // faces with the same corridor wall texture, full corridor height.
  function fillUndressedCorridorWalls(dressedRuns, roomsSolid, wallMat) {
    const CELL = 0.25, cov = new Set();
    const ck = (x, z, nx, nz) => Math.round(x / CELL) + ',' + Math.round(z / CELL) + ',' + Math.round(nx) + ',' + Math.round(nz);
    dressedRuns.forEach(r => {
      for (let s = r.s0; s <= r.s1 + 1e-6; s += 0.1) {
        const x = r.a[0] + r.tx * s, z = r.a[1] + r.tz * s;
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) cov.add(ck(x + dx * CELL, z + dz * CELL, r.nx, r.nz));
      }
    });
    const wall = state.visualWallSolid || state.baseWall;
    let floor = [];
    state.connectors.forEach(c => { floor = union(floor, solid(c.poly)); });
    state.doors.forEach(d => { if (d.floorPoly) floor = union(floor, solid(d.floorPoly)); });
    const walk = difference(difference(floor, roomsSolid), state.baseWall);
    const all = corridorWallRuns(wall, walk);
    const fill = [];
    all.forEach(r => {
      const n = Math.max(1, Math.round((r.s1 - r.s0) / 0.25)), st = (r.s1 - r.s0) / n;
      let cur = null;
      for (let k = 0; k < n; k++) {
        const s = r.s0 + st * (k + 0.5), x = r.a[0] + r.tx * s, z = r.a[1] + r.tz * s;
        const miss = !cov.has(ck(x, z, r.nx, r.nz));
        if (miss) { if (cur) cur.s1 = r.s0 + st * (k + 1); else cur = Object.assign({}, r, { s0: r.s0 + st * k, s1: r.s0 + st * (k + 1) }); }
        else if (cur) { fill.push(cur); cur = null; }
      }
      if (cur) fill.push(cur);
    });
    if (!fill.length) return;
    const byRegion = new Map();
    fill.forEach(r => {
      const m = (r.s0 + r.s1) * 0.5, x = r.a[0] + r.tx * m - r.nx * 0.3, z = r.a[1] + r.tz * m - r.nz * 0.3;
      const reg = state.connectors.find(c => pointInSolids(x, z, solid(c.poly))) || state.connectors.find(c => pointInSolids(x - r.nx * 0.6, z - r.nz * 0.6, solid(c.poly)));
      const id = reg ? reg.id : '__fill';
      if (!byRegion.has(id)) byRegion.set(id, { reg, runs: [] });
      byRegion.get(id).runs.push(r);
    });
    byRegion.forEach((v, id) => {
      const h = v.reg ? v.reg.height : 6;
      const g = (v.reg && state.regionGroups.get(v.reg.id)) || state.root;
      mesh(wallQuads(v.runs, () => [0, h - 0.012], CORRIDOR_TILE.wall), wallMat, id + '-corridor-walls-fill', g);
    });
    state.corridorWallFill = fill.length;
  }
  function mergeGeometriesUV(list) {
    const pos = [], nor = [], uv = [];
    list.forEach(g => { const p = g.attributes.position.array, n = g.attributes.normal.array, u = g.attributes.uv.array; for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); } for (let i = 0; i < u.length; i++) uv.push(u[i]); g.dispose(); });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    out.computeBoundingBox(); out.computeBoundingSphere(); return out;
  }
  function loadCorridorPlants(slots) {
    if (!slots.length || !THREE.GLTFLoader) return;
    const root = state.root;
    wingGLB(CORRIDOR_ASSETS.plant, gltf => {
      if (state.root !== root) return; // rebuilt meanwhile
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene), size = box.getSize(new THREE.Vector3());
      const parts = [];
      gltf.scene.traverse(o => { if (o.isMesh) parts.push(o); });
      const byRegion = new Map();
      slots.forEach(s => { if (!byRegion.has(s.region)) byRegion.set(s.region, []); byRegion.get(s.region).push(s); });
      const dummy = new THREE.Object3D(), rel = new THREE.Matrix4();
      byRegion.forEach((list, id) => {
        const g = state.regionGroups.get(id); if (!g) return;
        parts.forEach(part => {
          const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
          im.name = id + '-corridor-plants'; im.castShadow = false; im.receiveShadow = true;
          list.forEach((s, i) => {
            const target = Math.min(1.15, Math.max(0.75, s.width * 0.18));
            const k = target / Math.max(1e-3, size.y);
            dummy.position.set(s.x, -box.min.y * k, s.z); dummy.rotation.set(0, s.rot, 0); dummy.scale.setScalar(k);
            dummy.updateMatrix();
            rel.copy(dummy.matrix).multiply(part.matrixWorld);
            im.setMatrixAt(i, rel);
          });
          im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere && im.computeBoundingSphere();
          g.add(im);
        });
      });
      state.root.updateMatrixWorld(true);
      state.corridorPlantsReady = true;
    }, e => console.warn('Corridor plant model failed', e));
  }
  /* ---------------------------------------------------------------------------
     Corridor torches: the repository models "مشعل اسود" and "مشعل خشب" replace
     the procedural brackets in corridor/gallery regions only. They alternate at a
     fixed spacing along every solid corridor wall run, keep one standard size, and
     their back plate is seated flush on the wall surface (no gap). Each torch
     carries a fully procedural fire: domain-warped flame layers, a flickering
     halo, warm light spill on the wall behind it and rising embers.
  --------------------------------------------------------------------------- */
  const TORCH_ASSETS = [WING_FILES.torchBlack, WING_FILES.torchWood];
  const TORCH = {
    spacing: 7.0,      // metres between torches along a wall run
    margin: 1.3,       // keep clear of run ends / corners
    height: 1.05,      // standard model height (metres)
    mountY: 1.75,      // bottom of the model above the floor
    sink: 0.01,        // seat the plate into the wall so no seam can show
    flameY: 0.70,      // flame base, fraction of model height (inside the cage)
    flameZ: 0.25      // flame base, fraction of model height out from the plate
  };
  function placeCorridorTorches(r, runs, freeArea, out) {
    runs.forEach(run => {
      const len = run.s1 - run.s0, usable = len - TORCH.margin * 2;
      if (usable < 0) return;
      const n = Math.floor(usable / TORCH.spacing) + 1, used = (n - 1) * TORCH.spacing;
      for (let i = 0; i < n; i++) {
        const s = run.s0 + TORCH.margin + (usable - used) / 2 + i * TORCH.spacing;
        const dx = -run.nx, dz = -run.nz; // into the corridor
        const wx = run.a[0] + run.tx * s + dx * run.inset, wz = run.a[1] + run.tz * s + dz * run.inset;
        // the plate and the flame must face free corridor floor
        if (!pointInSolids(wx + dx * 0.35, wz + dz * 0.35, freeArea)) continue;
        if (!pointInSolids(wx + dx * 0.35 + run.tx * 0.3, wz + dz * 0.35 + run.tz * 0.3, freeArea)) continue;
        if (!pointInSolids(wx + dx * 0.35 - run.tx * 0.3, wz + dz * 0.35 - run.tz * 0.3, freeArea)) continue;
        if (state.doors.some(d => d.kind !== 'arch' && Math.hypot(d.x - wx, d.z - wz) < d.width * 0.5 + 0.9)) continue;
        if (out.some(t => Math.hypot(t.x - wx, t.z - wz) < TORCH.spacing * 0.55)) continue;
        out.push({ x: wx, z: wz, dx, dz, region: r.id, type: out.length % 2, seed: out.length * 0.618 + 0.37 });
      }
    });
  }
  const TORCH_FIRE_VS = [
    'attribute float aSeed;', 'attribute float aLayer;',
    'varying vec2 vUv;', 'varying float vSeed;', 'varying float vLayer;',
    'void main() {',
    '  vUv = uv; vSeed = aSeed; vLayer = aLayer;',
    '  vec3 base = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;',
    '  float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz);',
    '  vec3 toCam = cameraPosition - base; toCam.y = 0.0;',
    '  float dl = length(toCam);',
    '  vec3 side = dl > 1e-4 ? vec3(toCam.z, 0.0, -toCam.x) / dl : vec3(1.0, 0.0, 0.0);',
    '  vec3 p = base + side * position.x * sx + vec3(0.0, position.y * sy, 0.0);',
    '  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);',
    '}'
  ].join('\n');
  const TORCH_NOISE = [
    'float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y); }',
    'float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * vnoise(p); p = p * 2.07 + vec2(1.7, 9.2); a *= 0.5; } return v; }'
  ].join('\n');
  const TORCH_FIRE_FS = [
    'precision highp float;',
    'uniform float uTime;', 'varying vec2 vUv;', 'varying float vSeed;', 'varying float vLayer;',
    TORCH_NOISE,
    'void main() {',
    '  vec2 uv = vUv;',
    '  float t = uTime * (1.0 + fract(vSeed * 7.13) * 0.25) + vSeed * 13.0;',
    '  vec2 q = vec2(fbm(uv * vec2(2.6, 1.8) + vec2(vSeed, -t * 1.5)), fbm(uv * vec2(2.6, 1.8) + vec2(vSeed + 5.2, -t * 1.8)));',
    '  float n = fbm(vec2(uv.x * 3.4, uv.y * 2.4 - t * 2.7) + q * 1.6);',
    '  float sway = ((q.x - 0.5) * 0.55 + sin(t * 1.9) * 0.08 + sin(t * 4.3 + vSeed) * 0.04) * uv.y * uv.y;',
    '  float x = (uv.x - 0.5) * 2.0 - sway;',
    '  float w = mix(1.0, 0.10, pow(uv.y, 0.9)) * mix(0.85, 1.2, n);',
    '  float body = 1.0 - smoothstep(0.0, 1.0, abs(x) / max(w, 1e-3));',
    '  body *= smoothstep(0.0, 0.10, uv.y);',
    '  float v = body * 1.5 - uv.y * 0.45 - (1.0 - n) * 0.6 * uv.y;',
    '  v += (n - 0.5) * 0.35;',
    '  v = clamp(v, 0.0, 1.0);',
    '  float core = vLayer < 0.5 ? 1.0 : (vLayer < 1.5 ? 0.6 : 0.25);',
    '  float T = clamp(v * (0.7 + core * 0.6) * (1.0 - uv.y * 0.35), 0.0, 1.0);',
    '  vec3 c = vec3(0.45, 0.04, 0.0);',
    '  c = mix(c, vec3(0.95, 0.30, 0.03), smoothstep(0.08, 0.38, T));',
    '  c = mix(c, vec3(1.0, 0.62, 0.16), smoothstep(0.32, 0.62, T));',
    '  c = mix(c, vec3(1.0, 0.88, 0.55), smoothstep(0.58, 0.85, T));',
    '  c = mix(c, vec3(1.0, 0.97, 0.88), smoothstep(0.82, 1.0, T));',
    '  float base = smoothstep(0.22, 0.0, uv.y) * body;',
    '  c = mix(c, vec3(0.35, 0.55, 1.0), base * 0.35 * core);',
    '  float a = smoothstep(0.03, 0.4, v) * (vLayer > 1.5 ? 0.55 : 0.9);',
    '  if (a < 0.01) discard;',
    '  gl_FragColor = vec4(c * a * 1.25, a);',
    '}'
  ].join('\n');
  const TORCH_GLOW_VS = [
    'attribute float aSeed;', 'varying vec2 vUv;', 'varying float vSeed;',
    'void main() {',
    '  vUv = uv; vSeed = aSeed;',
    '  vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;',
    '  vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);',
    '  vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);',
    '  float s = length(instanceMatrix[0].xyz);',
    '  gl_Position = projectionMatrix * viewMatrix * vec4(c + (r * position.x + u * position.y) * s, 1.0);',
    '}'
  ].join('\n');
  const TORCH_FLICKER = 'float flick(float t, float s){ return 0.78 + 0.12 * sin(t * 7.1 + s * 11.0) + 0.07 * sin(t * 13.7 + s * 3.0) + 0.05 * sin(t * 23.3 + s * 5.0); }';
  const TORCH_GLOW_FS = [
    'precision mediump float;', 'uniform float uTime;', 'varying vec2 vUv;', 'varying float vSeed;', TORCH_FLICKER,
    'void main() {',
    '  float d = length(vUv - 0.5) * 2.0;',
    '  float a = pow(max(0.0, 1.0 - d), 2.4) * flick(uTime, vSeed);',
    '  if (a < 0.004) discard;',
    '  gl_FragColor = vec4(vec3(1.0, 0.52, 0.16) * a * 0.55, a);',
    '}'
  ].join('\n');
  const TORCH_WALL_VS = [
    'attribute float aSeed;', 'varying vec2 vUv;', 'varying float vSeed;',
    'void main() { vUv = uv; vSeed = aSeed; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }'
  ].join('\n');
  const TORCH_WALL_FS = [
    'precision mediump float;', 'uniform float uTime;', 'varying vec2 vUv;', 'varying float vSeed;', TORCH_FLICKER,
    'void main() {',
    '  vec2 p = (vUv - vec2(0.5, 0.42)) * vec2(2.0, 1.6);',
    '  float a = pow(max(0.0, 1.0 - length(p)), 2.0) * flick(uTime * 0.9, vSeed + 1.3);',
    '  if (a < 0.004) discard;',
    '  gl_FragColor = vec4(vec3(1.0, 0.45, 0.12) * a * 0.42, a);',
    '}'
  ].join('\n');
  const TORCH_EMBER_VS = [
    'uniform float uTime;', 'attribute float aSeed;', 'varying float vLife;',
    'void main() {',
    '  float life = fract(uTime * (0.35 + fract(aSeed * 3.7) * 0.3) + aSeed);',
    '  vLife = life;',
    '  vec3 p = position;',
    '  p.x += sin(aSeed * 31.0 + uTime * 1.7) * 0.09 * life;',
    '  p.z += cos(aSeed * 17.0 + uTime * 1.3) * 0.09 * life;',
    '  p.y += life * (0.75 + fract(aSeed * 5.3) * 0.5);',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  gl_PointSize = (1.0 - life) * 34.0 / max(0.5, -mv.z);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');
  const TORCH_EMBER_FS = [
    'precision mediump float;', 'varying float vLife;',
    'void main() {',
    '  float d = length(gl_PointCoord - 0.5);',
    '  float a = smoothstep(0.5, 0.0, d) * (1.0 - vLife) * smoothstep(0.0, 0.08, vLife);',
    '  if (a < 0.01) discard;',
    '  gl_FragColor = vec4(mix(vec3(1.0, 0.8, 0.4), vec3(1.0, 0.25, 0.03), vLife) * a, a);',
    '}'
  ].join('\n');
  function torchFireMaterials() {
    const add = (vs, fs, extra) => new THREE.ShaderMaterial(Object.assign({
      uniforms: { uTime: { value: 0 } }, vertexShader: vs, fragmentShader: fs,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
    }, extra || {}));
    const m = {
      fire: add(TORCH_FIRE_VS, TORCH_FIRE_FS, { side: THREE.DoubleSide }),
      ember: add(TORCH_EMBER_VS, TORCH_EMBER_FS)
    };
    state.torchFireMats = (state.torchFireMats || []).concat([m.fire, m.ember]);
    return m;
  }
  function torchFit(scene) {
    scene.updateMatrixWorld(true);
    const parts = [], drop = [];
    scene.traverse(o => { if (o.isMesh) (/flame/i.test(o.name) ? drop : parts).push(o); });
    const box = new THREE.Box3(), plate = new THREE.Box3();
    parts.forEach(o => { const b = new THREE.Box3().setFromObject(o); box.union(b); if (/holder/i.test(o.name)) plate.union(b); });
    const contactZ = plate.isEmpty() ? box.min.z : plate.min.z;
    const h = Math.max(1e-4, box.max.y - box.min.y), cx = (box.min.x + box.max.x) / 2;
    return { parts, k: TORCH.height / h, minY: box.min.y, h, cx, contactZ };
  }
  function loadCorridorTorches(slots) {
    if (!slots.length || !THREE.GLTFLoader) return;
    const root = state.root, fits = [], dummy = new THREE.Object3D();
    const byRegion = new Map();
    slots.forEach(s => { if (!byRegion.has(s.region)) byRegion.set(s.region, []); byRegion.get(s.region).push(s); });
    function slotMatrix(s, fit) {
      // model +Z (away from its plate) -> into the corridor; plate seated on the wall
      const out = fit.contactZ * fit.k;
      dummy.rotation.set(0, Math.atan2(s.dx, s.dz), 0);
      dummy.scale.setScalar(fit.k);
      const off = new THREE.Vector3(-fit.cx * fit.k, 0, -out).applyEuler(dummy.rotation);
      dummy.position.set(s.x + off.x - s.dx * TORCH.sink, TORCH.mountY - fit.minY * fit.k, s.z + off.z - s.dz * TORCH.sink);
      dummy.updateMatrix();
      return dummy.matrix.clone();
    }
    function buildFire() {
      const mats = torchFireMaterials();
      const layers = [{ w: 0.20, h: 0.34 }, { w: 0.30, h: 0.48 }, { w: 0.40, h: 0.60 }];
      byRegion.forEach((list, id) => {
        const g = state.regionGroups.get(id); if (!g) return;
        const fpos = list.map(s => {
          const fit = fits[s.type], m = slotMatrix(s, fit);
          return new THREE.Vector3(fit.cx, fit.minY + fit.h * TORCH.flameY, fit.contactZ + fit.h * TORCH.flameZ).applyMatrix4(m);
        });
        // flame layers
        const fg = new THREE.PlaneGeometry(1, 1); fg.translate(0, 0.5, 0);
        const cnt = list.length * layers.length, seeds = new Float32Array(cnt), lay = new Float32Array(cnt);
        const fire = new THREE.InstancedMesh(fg, mats.fire, cnt); fire.name = id + '-torch-fire'; fire.frustumCulled = false; fire.renderOrder = 3;
        let k = 0;
        layers.forEach((L, li) => list.forEach((s, i) => {
          seeds[k] = s.seed + li * 2.31; lay[k] = li;
          dummy.position.copy(fpos[i]); dummy.position.y -= 0.03; dummy.rotation.set(0, 0, 0); dummy.scale.set(L.w, L.h, 1); dummy.updateMatrix();
          fire.setMatrixAt(k++, dummy.matrix);
        }));
        fg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
        fg.setAttribute('aLayer', new THREE.InstancedBufferAttribute(lay, 1));
        fire.instanceMatrix.needsUpdate = true; g.add(fire);
        // rising embers
        const PER = 10, ep = new Float32Array(list.length * PER * 3), es = new Float32Array(list.length * PER);
        list.forEach((s, i) => { for (let j = 0; j < PER; j++) { const e = i * PER + j; ep[e * 3] = fpos[i].x; ep[e * 3 + 1] = fpos[i].y + 0.12; ep[e * 3 + 2] = fpos[i].z; es[e] = (s.seed * 0.37 + j * 0.1037) % 1; } });
        const eg = new THREE.BufferGeometry();
        eg.setAttribute('position', new THREE.BufferAttribute(ep, 3)); eg.setAttribute('aSeed', new THREE.BufferAttribute(es, 1));
        const embers = new THREE.Points(eg, mats.ember); embers.name = id + '-torch-embers'; embers.frustumCulled = false; embers.renderOrder = 4; g.add(embers);
      });
    }
    let pending = TORCH_ASSETS.length;
    TORCH_ASSETS.forEach((url, type) => {
      wingGLB(url, gltf => {
        if (state.root !== root) return; // rebuilt meanwhile
        const fit = torchFit(gltf.scene); fits[type] = fit;
        byRegion.forEach((list, id) => {
          const g = state.regionGroups.get(id); if (!g) return;
          const mine = list.filter(s => s.type === type); if (!mine.length) return;
          fit.parts.forEach(part => {
            const im = new THREE.InstancedMesh(part.geometry, part.material, mine.length);
            im.name = id + '-corridor-torch-' + type; im.castShadow = false; im.receiveShadow = true;
            mine.forEach((s, i) => im.setMatrixAt(i, slotMatrix(s, fit).multiply(part.matrixWorld)));
            im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere && im.computeBoundingSphere();
            g.add(im);
          });
        });
        if (--pending === 0) { buildFire(); state.corridorTorchesReady = true; }
        state.root.updateMatrixWorld(true);
      }, e => { console.warn('Corridor torch model failed', url, e); });
    });
  }
  /* ---------------------------------------------------------------------------
     K2 council hall (Kings wing) dressing — visuals only:
       (files: WING_FILES, compressed copies of the assets/ originals)
       جدار المجلس               -> mural on every wall face of the hall, repeated
                                    in whole panels (2 rows) fitted to each wall
       سقف المجلس                -> coffered ceiling panel tiled edge-to-edge over
                                    the whole hall (6 m squares, no gaps)
       ثريا المجلس               -> enlarged chandelier, top seated on the
                                    ceiling (no gap) and the body hung lower
       ارضية المجلس             -> one marble floor framed to the hall
       الاستقبال (column only)  -> the upright column, instanced in place of
                                    the procedural shafts
       اجتماعات                  -> council table under the chandelier
       procedural fire           -> flames in the chandelier cups
       lion_winged               -> two winged lions facing each other, flanking
                                    the north doorway
       شتله                      -> six large potted plants, three per side wall
     The procedural wall torches of K2 are no longer generated (see buildVisuals).
  --------------------------------------------------------------------------- */
  const K2_ASSETS = {
    wall: WING_FILES.k2Wall, ceiling: WING_FILES.k2Ceiling,
    chandelier: WING_FILES.k2Chandelier, lion: WING_FILES.k2Lion, plant: WING_FILES.plant,
    floor: WING_FILES.k2Floor, reception: K2_LAZY.reception, meetings: K2_LAZY.meetings
  };
  const K2_DRESS = {
    wallPanelW: 6.75,   // mural panel width (image is 3:2), fitted to whole panels per wall
    wallRows: 2,        // mural rows from floor to ceiling
    ceilingTile: 6.0,   // ceiling panel size (30 x 24 m hall -> 5 x 4 squares)
    ceilingDepth: 0.30, // relief depth of the ceiling panels
    chandelierH: 5.75,  // enlarged so the body hangs lower; the top still seats on the ceiling
    tableSpan: 9.2,     // meeting-table long side, metres (sits under the chandelier)
    tableHeightRatio: 0.2872, // model height / long side, measured from اجتماعات.glb
    lionH: 3.2,         // winged lion height incl. its pedestal
    lionFoot: { len: 0.824, wid: 0.386 }, // lion footprint / height (measured from the GLB)
    lionX: 4.6,         // lion centres, either side of the north door axis
    lionInsetZ: 2.6,    // distance of the lions from the north wall
    plantH: 2.2,        // potted plant height (large)
    plantInset: 1.15,   // plant distance from its wall
    plantSpacing: 6.0,  // plants per side: centre and +/- this distance
    plantRadius: 0.6,
    // Lamp cups inside ثريا المجلس, in the model's own space (Y up, centre origin).
    // Four large cups on the cross, eight smaller cups on the lower ring.
    cups: [
      { x: 0.179, y: -0.100, z: 0.000, s: 1 },
      { x: -0.178, y: -0.100, z: 0.000, s: 1 },
      { x: 0.000, y: -0.100, z: 0.177, s: 1 },
      { x: 0.000, y: -0.100, z: -0.180, s: 1 },
      { x: 0.094, y: -0.146, z: -0.214, s: 0.62 },
      { x: -0.091, y: -0.145, z: 0.209, s: 0.62 },
      { x: 0.211, y: -0.145, z: -0.099, s: 0.62 },
      { x: -0.093, y: -0.146, z: -0.214, s: 0.62 },
      { x: -0.210, y: -0.145, z: 0.094, s: 0.62 },
      { x: -0.210, y: -0.146, z: -0.096, s: 0.62 },
      { x: 0.212, y: -0.146, z: 0.091, s: 0.62 },
      { x: 0.095, y: -0.145, z: 0.208, s: 0.62 }
    ]
  };
  function k2LoadGLB(url, needsMeshopt, onLoad) {
    const root = state.root;
    wingGLB(url, gltf => { if (state.root === root) onLoad(gltf); },
      e => {
        const msg = (e && (e.message || e)) + '';
        console.warn('K2 council hall model failed', url, e);
        dressFailures.push({ room: 'K2', url: url, error: msg, at: performance.now() });
        try { if (window.SinMemoryOverlay) SinMemoryOverlay.note('error', 'K2 fail ' + url); } catch (_) {}
        if (state.root === root) onLoad(null);
      });
  }
  // Wall faces with world-anchored UVs: U runs to the viewer's right and is
  // fitted so every wall holds whole mural panels from corner to corner.
  function k2WallQuads(segs, yOf, b, fitU, tileV) {
    const pos = [], uv = [], nor = [];
    segs.forEach(r => {
      const [y0, y1] = yOf(r);
      if (y1 - y0 < 0.02 || r.s1 - r.s0 < 0.02) return;
      const ix = -r.nx * r.inset, iz = -r.nz * r.inset;
      const P = s => [r.a[0] + r.tx * s + ix, r.a[1] + r.tz * s + iz];
      const p0 = P(r.s0), p1 = P(r.s1);
      const rx = -r.nz, rz = r.nx; // viewer's right when facing this wall
      const tileU = Math.abs(r.tx) >= Math.abs(r.tz) ? fitU.x : fitU.z;
      const U = p => ((p[0] - b.x0) * rx + (p[1] - b.z0) * rz) / tileU;
      const u0 = U(p0), u1 = U(p1);
      const A = [p0[0], y0, p0[1]], B = [p1[0], y0, p1[1]], Cq = [p1[0], y1, p1[1]], D = [p0[0], y1, p0[1]];
      const uA = [u0, y0 / tileV], uB = [u1, y0 / tileV], uC = [u1, y1 / tileV], uD = [u0, y1 / tileV];
      const fx = -r.nx, fz = -r.nz;
      const e1 = [B[0] - A[0], 0, B[2] - A[2]];
      const want = (-e1[2]) * fx + e1[0] * fz > 0;
      const tri = want ? [A, B, Cq, A, Cq, D] : [A, Cq, B, A, D, Cq];
      const tuv = want ? [uA, uB, uC, uA, uC, uD] : [uA, uC, uB, uA, uD, uC];
      tri.forEach((p, i) => { pos.push(p[0], p[1], p[2]); uv.push(tuv[i][0], tuv[i][1]); nor.push(fx, 0, fz); });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  }
  // One fitted copy of ارضية المجلس across the hall, gold border along the walls.
  function k2FloorSheet(solids, y, b) {
    const W = Math.max(1e-4, b.x1 - b.x0), D = Math.max(1e-4, b.z1 - b.z0);
    const pos = [], uv = [], nor = [];
    (solids || []).forEach(sol => {
      const outer = cleanPoly(sol.outer, true), holes = (sol.holes || []).map(h => cleanPoly(h, false));
      if (outer.length < 3) return;
      let faces = [];
      try { faces = THREE.ShapeUtils.triangulateShape(outer.map(pt2 => new THREE.Vector2(pt2[0], pt2[1])), holes.map(h => h.map(pt2 => new THREE.Vector2(pt2[0], pt2[1])))); }
      catch (e) { console.error('K2 floor triangulation', e); return; }
      const verts = outer.concat.apply(outer, holes);
      faces.forEach(f => {
        let a = verts[f[0]], b2 = verts[f[1]], c = verts[f[2]];
        const cross = (b2[0] - a[0]) * (c[1] - a[1]) - (b2[1] - a[1]) * (c[0] - a[0]);
        if (cross >= 0) { const t = b2; b2 = c; c = t; }
        [a, b2, c].forEach(pt2 => {
          pos.push(pt2[0], y, pt2[1]);
          uv.push((pt2[0] - b.x0) / W, (pt2[1] - b.z0) / D);
          nor.push(0, 1, 0);
        });
      });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
  function k2FloorMaterial(url) {
    const tex = corridorTexture(url);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(1, 1);
    const m = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.55, metalness: 0.04,
      emissive: new THREE.Color(0x120e0a), emissiveIntensity: 0.07
    });
    m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
    state.materials.push(m);
    return m;
  }
  // الاستقبال.glb is one fused mesh of several props. Keep only the upright
  // square column (tall, nearly square footprint) and drop the rest.
  function extractUprightColumn(root) {
    let src = null;
    root.updateMatrixWorld(true);
    root.traverse(o => { if (!src && o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) src = o; });
    if (!src) return null;
    const geo = src.geometry, attr = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
    const vcount = attr.count, index = geo.index;
    const triCount = index ? index.count / 3 : Math.floor(vcount / 3);
    const wp = new Float32Array(vcount * 3);
    const v = new THREE.Vector3();
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vcount; i++) {
      v.fromBufferAttribute(attr, i).applyMatrix4(src.matrixWorld);
      wp[i * 3] = v.x; wp[i * 3 + 1] = v.y; wp[i * 3 + 2] = v.z;
      if (v.x < min[0]) min[0] = v.x; if (v.y < min[1]) min[1] = v.y; if (v.z < min[2]) min[2] = v.z;
      if (v.x > max[0]) max[0] = v.x; if (v.y > max[1]) max[1] = v.y; if (v.z > max[2]) max[2] = v.z;
    }
    const voxel = 0.015;
    const dims = [0, 1, 2].map(a => Math.ceil((max[a] - min[a]) / voxel) + 3);
    const sx = dims[0], sy = dims[1];
    const keyOf = (x, y, z) => (x + 1) + (y + 1) * sx + (z + 1) * sx * sy;
    const vertKey = new Int32Array(vcount);
    const occ = new Set();
    for (let i = 0; i < vcount; i++) {
      const x = Math.floor((wp[i * 3] - min[0]) / voxel);
      const y = Math.floor((wp[i * 3 + 1] - min[1]) / voxel);
      const z = Math.floor((wp[i * 3 + 2] - min[2]) / voxel);
      const k = keyOf(x, y, z);
      vertKey[i] = k; occ.add(k);
    }
    const parent = new Map();
    function find(x) {
      let p = parent.get(x);
      if (p === undefined) { parent.set(x, x); return x; }
      while (p !== parent.get(p)) { parent.set(p, parent.get(parent.get(p))); p = parent.get(p); }
      parent.set(x, p); return p;
    }
    function uni(a, b) { a = find(a); b = find(b); if (a !== b) parent.set(b, a); }
    occ.forEach(k => {
      const z = Math.floor(k / (sx * sy)), rem = k % (sx * sy), y = Math.floor(rem / sx), x = rem % sx;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nk = keyOf(x - 1 + dx, y - 1 + dy, z - 1 + dz);
        if (occ.has(nk)) uni(k, nk);
      }
    });
    const clusters = new Map();
    for (let i = 0; i < vcount; i++) {
      const r = find(vertKey[i]);
      let c = clusters.get(r);
      if (!c) { c = { n: 0, min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }; clusters.set(r, c); }
      c.n++;
      for (let a = 0; a < 3; a++) {
        const val = wp[i * 3 + a];
        if (val < c.min[a]) c.min[a] = val;
        if (val > c.max[a]) c.max[a] = val;
      }
    }
    let best = null, bestScore = -1, bestRoot = 0;
    clusters.forEach((c, r) => {
      const size = [c.max[0] - c.min[0], c.max[1] - c.min[1], c.max[2] - c.min[2]];
      const tall = size[1], foot = Math.max(size[0], size[2]), thin = Math.min(size[0], size[2]);
      if (tall < size[0] || tall < size[2]) return;
      const aspect = tall / Math.max(1e-4, foot);
      const square = thin / Math.max(1e-4, foot);
      if (aspect < 2.2 || aspect > 6 || square < 0.72 || c.n < 800) return;
      const score = square * 3 + Math.min(aspect, 4) + Math.log(c.n);
      if (score > bestScore) { bestScore = score; best = c; bestRoot = r; }
    });
    if (!best) { console.warn('K2: no column found inside الاستقبال.glb'); return null; }
    const keep = new Uint8Array(vcount);
    for (let i = 0; i < vcount; i++) if (find(vertKey[i]) === bestRoot) keep[i] = 1;
    const triAt = (t, k) => index ? index.getX(t * 3 + k) : t * 3 + k;
    const srcIndex = [];
    for (let t = 0; t < triCount; t++) {
      const a = triAt(t, 0), b = triAt(t, 1), c = triAt(t, 2);
      if (keep[a] && keep[b] && keep[c]) srcIndex.push(a, b, c);
    }
    if (srcIndex.length < 30) return null;
    const mapV = new Map();
    const positions = [], normals = [], uvs = [], indices = [];
    const tmpN = new THREE.Vector3();
    function pushV(i) {
      const hit = mapV.get(i);
      if (hit !== undefined) return hit;
      const m = positions.length / 3;
      mapV.set(i, m);
      positions.push(wp[i * 3], wp[i * 3 + 1], wp[i * 3 + 2]);
      if (nrm) { tmpN.fromBufferAttribute(nrm, i).transformDirection(src.matrixWorld); normals.push(tmpN.x, tmpN.y, tmpN.z); }
      if (uv) uvs.push(uv.getX(i), uv.getY(i));
      return m;
    }
    for (let i = 0; i < srcIndex.length; i++) indices.push(pushV(srcIndex[i]));
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (normals.length) out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    else out.computeVertexNormals();
    if (uvs.length) out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    out.setIndex(indices);
    out.computeBoundingBox();
    const bb = out.boundingBox;
    const cx = (bb.min.x + bb.max.x) * 0.5, cz = (bb.min.z + bb.max.z) * 0.5;
    out.translate(-cx, -bb.min.y, -cz);
    out.computeBoundingBox(); out.computeBoundingSphere();
    const srcMat = Array.isArray(src.material) ? src.material[0] : src.material;
    const material = srcMat ? srcMat.clone() : new THREE.MeshStandardMaterial({ color: 0xc6ae86, roughness: 0.6, metalness: 0.12 });
    state.materials.push(material);
    const sz = out.boundingBox.getSize(new THREE.Vector3());
    console.info('K2 column extracted', { tris: indices.length / 3, size: sz.toArray().map(n => +n.toFixed(3)) });
    return { geometry: out, material: material, size: sz };
  }
  function placeK2Columns(r, g) {
    // Three evenly spaced pairs leave the south-east entry and north exit sightlines clear.
    const pairs = columnPairs(r, 3, 4.2, 5.2);
    const targetH = Math.max(4, r.height - K2_DRESS.ceilingDepth + 0.04);
    const rad = 0.78;
    pairs.forEach(p => {
      state.colliders.push({ minx: p[0] - rad, maxx: p[0] + rad, miny: 0, maxy: targetH, minz: p[1] - rad, maxz: p[1] + rad, _wing: true, _k2Prop: true });
    });
    k2LoadGLB(K2_ASSETS.reception, false, gltf => {
      try {
        if (!gltf) return;
        let src = null;
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse(o => { if (o.isMesh && !src) src = o; });
        if (!src || !src.geometry) return;
        const triN = src.geometry.index ? src.geometry.index.count / 3 : src.geometry.attributes.position.count / 3;
        // The shipped file is only the column. The fused prop mesh is the fallback.
        const extracted = triN > 40000 ? extractUprightColumn(gltf.scene) : (function () {
          const geo = src.geometry.clone();
          geo.applyMatrix4(src.matrixWorld);
          geo.computeBoundingBox();
          const bb = geo.boundingBox;
          const cx = (bb.min.x + bb.max.x) * 0.5, cz = (bb.min.z + bb.max.z) * 0.5;
          if (Math.abs(bb.min.y) > 1e-3 || Math.abs(cx) > 1e-3 || Math.abs(cz) > 1e-3) geo.translate(-cx, -bb.min.y, -cz);
          geo.computeBoundingBox(); geo.computeBoundingSphere();
          const srcMat = Array.isArray(src.material) ? src.material[0] : src.material;
          const material = srcMat ? srcMat.clone() : new THREE.MeshStandardMaterial({ color: 0xc6ae86, roughness: 0.6, metalness: 0.12 });
          state.materials.push(material);
          return { geometry: geo, material: material, size: geo.boundingBox.getSize(new THREE.Vector3()) };
        })();
        if (!extracted) return;
        softenWingMetal(extracted.material);
        const k = targetH / Math.max(1e-4, extracted.size.y);
        const im = new THREE.InstancedMesh(extracted.geometry, extracted.material, pairs.length);
        im.name = 'K2-majlis-columns'; im.castShadow = false; im.receiveShadow = true; im.frustumCulled = false;
        const dummy = new THREE.Object3D();
        pairs.forEach((p, i) => {
          dummy.position.set(p[0], 0, p[1]);
          dummy.rotation.set(0, Math.atan2(r.bbox.cx - p[0], r.bbox.cz - p[1]), 0);
          dummy.scale.setScalar(k);
          dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix);
        });
        im.instanceMatrix.needsUpdate = true;
        hideUntilReady(im);
        g.add(im);
        // Eviction can null k2Dress between request and this callback
        // (seen as "null is not an object (evaluating 'state.k2Dress.columns = …')",
        // which aborted the council-hall dress and left K2 empty).
        if (state.k2Dress) {
          state.k2Dress.columns = pairs.length;
          state.k2Dress.columnH = targetH;
        }
        if (state.root) state.root.updateMatrixWorld(true);
        rebuildSpatial();
      } finally {
        placeK2TableModel();
      }
    });
  }
  function placeK2Table(r, g) {
    const b = r.bbox;
    const k = K2_DRESS.tableSpan;
    const tableH = k * K2_DRESS.tableHeightRatio;
    state.k2Dress.tableH = tableH;
    state.k2Dress._tableRoom = r;
    state.k2Dress._tableHost = g;
    state.colliders.push({
      minx: b.cx - k * 0.50, maxx: b.cx + k * 0.50,
      miny: 0, maxy: tableH,
      minz: b.cz - k * 0.47, maxz: b.cz + k * 0.47,
      _wing: true, _k2Prop: true
    });
  }
  function placeK2TableModel() {
    const dress = state.k2Dress;
    if (!dress || dress._tableLoading || !dress._tableRoom) return;
    dress._tableLoading = true;
    const r = dress._tableRoom, g = dress._tableHost, b = r.bbox;
    k2LoadGLB(K2_ASSETS.meetings, false, gltf => {
      if (!gltf) {
        // Failed download: mark complete so the zone can reveal the rest of
        // the room instead of waiting forever. The door gate still waits for
        // isComplete / ready, and there is no late pop-in of a missing table.
        if (state.k2Dress) { state.k2Dress.table = true; state.k2Dress.tableFailed = true; }
        return;
      }
      const model = gltf.scene;
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const long = Math.max(size.x, size.z);
      const s = K2_DRESS.tableSpan / Math.max(1e-4, long);
      const rot = size.z >= size.x ? Math.PI / 2 : 0;
      model.scale.setScalar(s);
      model.position.set(-c.x * s, -box.min.y * s, -c.z * s);
      const holder = new THREE.Group();
      holder.name = 'K2-council-table';
      holder.position.set(b.cx, 0, b.cz);
      holder.rotation.y = rot;
      holder.add(model);
      model.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false;
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        mats.forEach(softenWingMetal);
      });
      hideUntilReady(holder);
      g.add(holder);
      if (state.k2Dress) {
        state.k2Dress.table = true;
        state.k2Dress.tableH = (box.max.y - box.min.y) * s;
      }
      if (state.root) state.root.updateMatrixWorld(true);
    });
  }
  // Small, warm flame tongues seated in each chandelier cup; no PointLights are attached.
  function addK2ChandelierFire(g, cups) {
    if (!cups.length) return;
    const mats = torchFireMaterials();
    mats.fire.fragmentShader = mats.fire.fragmentShader
      .replace('vec3(1.0, 0.97, 0.88)', 'vec3(1.0, 0.76, 0.38)')
      .replace('c * a * 1.25', 'c * a * 0.72');
    mats.ember.fragmentShader = mats.ember.fragmentShader.replace('vec3(1.0, 0.8, 0.4)', 'vec3(1.0, 0.62, 0.24)');
    mats.fire.needsUpdate = mats.ember.needsUpdate = true;
    const layers = [0.72, 1.0];
    const baseW = 0.13, baseH = 0.26;
    const fg = new THREE.PlaneGeometry(1, 1); fg.translate(0, 0.5, 0);
    const cnt = cups.length * layers.length;
    const seeds = new Float32Array(cnt), lay = new Float32Array(cnt);
    const fire = new THREE.InstancedMesh(fg, mats.fire, cnt);
    fire.name = 'K2-chandelier-fire'; fire.frustumCulled = false; fire.renderOrder = 4;
    const dummy = new THREE.Object3D();
    let k = 0;
    layers.forEach((sc, li) => cups.forEach((c, i) => {
      seeds[k] = c.seed + li * 2.17; lay[k] = li;
      dummy.position.set(c.x, c.y, c.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(baseW * c.s * sc, baseH * c.s * (0.85 + li * 0.12), 1);
      dummy.updateMatrix();
      fire.setMatrixAt(k++, dummy.matrix);
    }));
    fg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    fg.setAttribute('aLayer', new THREE.InstancedBufferAttribute(lay, 1));
    fire.instanceMatrix.needsUpdate = true; g.add(fire);
    const PER = 2, ep = new Float32Array(cups.length * PER * 3), es = new Float32Array(cups.length * PER);
    cups.forEach((c, i) => {
      for (let j = 0; j < PER; j++) {
        const e = i * PER + j;
        ep[e * 3] = c.x; ep[e * 3 + 1] = c.y + 0.05; ep[e * 3 + 2] = c.z;
        es[e] = (c.seed * 0.41 + j * 0.097) % 1;
      }
    });
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
    eg.setAttribute('aSeed', new THREE.BufferAttribute(es, 1));
    const embers = new THREE.Points(eg, mats.ember);
    embers.name = 'K2-chandelier-embers'; embers.frustumCulled = false; embers.renderOrder = 5;
    g.add(embers);
    if (state.k2Dress) state.k2Dress.fires = cups.length;
  }
  // PalaceInterior owns a fixed light budget. Keeping room-specific PointLights
  // out of the scene prevents the renderer's lighting program layout changing
  // when K2 is culled or revealed.
  function addK2Lights() {
    state.k2Lights = [];
    state.k2LightBase = [];
  }

  function dressK2() {
    const r = state.rooms.find(q => q.id === 'K2'), g = state.regionGroups.get('K2');
    if (!r || !g) return;
    // Idempotent after unload/re-dress: never stack a second set of K2 props.
    if (g.userData.k2Dressed && g.children.some(function (c) { return c.name && c.name.indexOf('K2-') === 0; })) return;
    g.userData.k2Dressed = true;
    const b = r.bbox, W = b.x1 - b.x0, D = b.z1 - b.z0, h = r.height;
    state.k2Dress = { walls: false, ceiling: 0, chandelier: false, lions: 0, plants: 0, columns: 0, fires: 0, table: false, tableH: K2_DRESS.tableSpan * K2_DRESS.tableHeightRatio };

    // 0) Marble floor — one copy of ارضية المجلس framed to the hall
    const floorMat = k2FloorMaterial(K2_ASSETS.floor);
    const floorGeo = k2FloorSheet(state.k2FloorSolids || solid(r.poly), 0.014, b);
    const floorMesh = mesh(floorGeo, floorMat, 'K2-majlis-floor', g);
    floorMesh.renderOrder = 2;
    hideUntilReady(floorMesh);
    state.k2Dress.floor = true;
    if (state.floorMeshes) state.floorMeshes.push(floorMesh);
    placeK2Columns(r, g);
    placeK2Table(r, g);

    // 1) Mural walls
    const area = solid(r.poly);
    const freeArea = difference(area, state.baseWall);
    const wallsHere = intersection(state.baseWall, offset(area, 1.6));
    const runs = corridorWallRuns(wallsHere, freeArea);
    const lintelRuns = [];
    state.doors.filter(d => d.kind !== 'arch' && d.openPoly && (d.from === 'K2' || d.to === 'K2')).forEach(d => {
      const op = solid(d.openPoly);
      corridorWallRuns(op, difference(freeArea, op)).forEach(l => { l.door = d; lintelRuns.push(l); });
    });
    const fitU = {
      x: W / Math.max(1, Math.round(W / K2_DRESS.wallPanelW)),
      z: D / Math.max(1, Math.round(D / K2_DRESS.wallPanelW))
    };
    const tileV = h / K2_DRESS.wallRows;
    const wallMat = corridorMaterial(K2_ASSETS.wall, 0.82);
    const wallGeo = mergeGeometriesUV([
      k2WallQuads(runs, () => [0, h], b, fitU, tileV),
      k2WallQuads(lintelRuns, l => [Math.min(l.door.height, h), h], b, fitU, tileV)
    ]);
    const k2WallMesh = mesh(wallGeo, wallMat, 'K2-majlis-walls', g);
    hideUntilReady(k2WallMesh);
    state.k2Dress.walls = true;

    // 2) Ceiling panels, then the chandelier seated on them
    const nx = Math.max(1, Math.round(W / K2_DRESS.ceilingTile)), nz = Math.max(1, Math.round(D / K2_DRESS.ceilingTile));
    const tw = W / nx, td = D / nz;
    let ceilingMeshes = [];
    k2LoadGLB(K2_ASSETS.ceiling, false, gltf => {
      if (gltf) {
        const parts = []; gltf.scene.traverse(o => { if (o.isMesh) parts.push(o); });
        const bb = new THREE.Box3();
        parts.forEach(p => { p.geometry.computeBoundingBox(); bb.union(p.geometry.boundingBox); });
        if (parts.length && !bb.isEmpty()) {
          // The panel is authored standing up: thin axis = local X, decorated face = +X.
          // Rotate -90 deg about Z so the decorated face looks down; local Y -> world X.
          // The node's tiny authored tilt is ignored so the squares butt edge to edge.
          const size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
          const sX = K2_DRESS.ceilingDepth / Math.max(1e-4, size.x), sY = tw / Math.max(1e-4, size.y), sZ = td / Math.max(1e-4, size.z);
          const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
          const scl = new THREE.Vector3(sX, sY, sZ);
          const offX = c.y * sY, offZ = c.z * sZ, top = -bb.min.x * sX;
          const m = new THREE.Matrix4(), p = new THREE.Vector3();
          parts.forEach(part => {
            const im = new THREE.InstancedMesh(part.geometry, part.material, nx * nz);
            im.name = 'K2-majlis-ceiling'; im.castShadow = false; im.receiveShadow = true; im.frustumCulled = false;
            let i = 0;
            for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
              p.set(b.x0 + tw * (ix + 0.5) - offX, h - top, b.z0 + td * (iz + 0.5) - offZ);
              m.compose(p, q, scl); im.setMatrixAt(i++, m);
            }
            im.instanceMatrix.needsUpdate = true;
            im.userData.ceiling = true;
            const mats = im.material ? (Array.isArray(im.material) ? im.material : [im.material]) : [];
            mats.forEach(softenWingMetal);
            hideUntilReady(im);
            if (!state.cutaway) { /* revealed in markDressReady */ }
            g.add(im); ceilingMeshes.push(im);
            (state.corridorCeilings || (state.corridorCeilings = [])).push(im);
          });
          if (state.k2Dress) state.k2Dress.ceiling = nx * nz;
        }
      }
      state.root.updateMatrixWorld(true);
      loadK2Chandelier(r, g, ceilingMeshes);
    });

    // 3) Winged lions facing each other across the north doorway
    const lionSlots = [
      { x: b.cx - K2_DRESS.lionX, z: b.z1 - K2_DRESS.lionInsetZ, rot: Math.PI / 2 },   // looks +X
      { x: b.cx + K2_DRESS.lionX, z: b.z1 - K2_DRESS.lionInsetZ, rot: -Math.PI / 2 }   // looks -X
    ];
    lionSlots.forEach(s => {
      const hl = K2_DRESS.lionH * K2_DRESS.lionFoot.len * 0.5, hw = K2_DRESS.lionH * K2_DRESS.lionFoot.wid * 0.5;
      state.colliders.push({ minx: s.x - hl, maxx: s.x + hl, miny: 0, maxy: K2_DRESS.lionH, minz: s.z - hw, maxz: s.z + hw, _wing: true, _k2Prop: true });
    });
    k2LoadGLB(K2_ASSETS.lion, false, gltf => {
      if (!gltf) return;
      const src = gltf.scene; src.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(src), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const k = K2_DRESS.lionH / Math.max(1e-4, size.y);
      lionSlots.forEach((s, i) => {
        const model = i ? src.clone(true) : src;
        model.scale.setScalar(k);
        model.position.set(-c.x * k, -box.min.y * k, -c.z * k);
        const holder = new THREE.Group(); holder.name = 'K2-winged-lion-' + (i + 1);
        holder.position.set(s.x, 0, s.z); holder.rotation.y = s.rot; holder.add(model);
        model.traverse(o => {
          if (!o.isMesh) return;
          o.castShadow = false; o.receiveShadow = true;
          const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
          mats.forEach(softenWingMetal);
        });
        hideUntilReady(holder);
        g.add(holder);
      });
      if (state.k2Dress) state.k2Dress.lions = lionSlots.length;
      if (state.root) state.root.updateMatrixWorld(true);
    });

    // 4) Six large potted plants, three on each side wall, evenly spaced
    const plantSlots = [];
    for (let i = -1; i <= 1; i++) {
      const z = b.cz + i * K2_DRESS.plantSpacing;
      plantSlots.push({ x: b.x0 + K2_DRESS.plantInset, z, rot: 0 });
      plantSlots.push({ x: b.x1 - K2_DRESS.plantInset, z, rot: Math.PI });
    }
    plantSlots.forEach(p => {
      const rr = K2_DRESS.plantRadius;
      state.colliders.push({ minx: p.x - rr, maxx: p.x + rr, miny: 0, maxy: K2_DRESS.plantH, minz: p.z - rr, maxz: p.z + rr, _wing: true, _plant: true, _k2Prop: true });
    });
    k2LoadGLB(K2_ASSETS.plant, true, gltf => {
      if (!gltf) return;
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const k = K2_DRESS.plantH / Math.max(1e-3, size.y);
      const parts = []; gltf.scene.traverse(o => { if (o.isMesh) parts.push(o); });
      const dummy = new THREE.Object3D(), rel = new THREE.Matrix4(), centre = new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z);
      parts.forEach(part => {
        const im = new THREE.InstancedMesh(part.geometry, part.material, plantSlots.length);
        im.name = 'K2-majlis-plants'; im.castShadow = false; im.receiveShadow = true; im.frustumCulled = false;
        plantSlots.forEach((s, i) => {
          dummy.position.set(s.x, 0, s.z); dummy.rotation.set(0, s.rot, 0); dummy.scale.setScalar(k); dummy.updateMatrix();
          rel.copy(dummy.matrix).multiply(centre).multiply(part.matrixWorld);
          im.setMatrixAt(i, rel);
        });
        im.instanceMatrix.needsUpdate = true;
        hideUntilReady(im);
        g.add(im);
      });
      if (state.k2Dress) state.k2Dress.plants = plantSlots.length;
      state.root.updateMatrixWorld(true);
    });
  }
  function loadK2Chandelier(r, g, ceilingMeshes) {
    const b = r.bbox, h = r.height;
    k2LoadGLB(K2_ASSETS.chandelier, false, gltf => {
      if (!gltf) return;
      const model = gltf.scene; model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const tableH = (state.k2Dress && state.k2Dress.tableH) || (K2_DRESS.tableSpan * K2_DRESS.tableHeightRatio);
      // Highest ceiling surface over the canopy footprint, so the top touches the
      // relief everywhere (pushes into the frames rather than leaving a gap).
      let seat = ceilingMeshes.length ? h - K2_DRESS.ceilingDepth : h;
      if (ceilingMeshes.length) {
        state.root.updateMatrixWorld(true);
        const ray = new THREE.Raycaster(), up = new THREE.Vector3(0, 1, 0), o = new THREE.Vector3();
        const probeK = K2_DRESS.chandelierH / Math.max(1e-4, size.y);
        const canopyR = Math.max(0.05, Math.min(size.x, size.z) * probeK * 0.28);
        const probes = [[0, 0]];
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; probes.push([Math.cos(a) * canopyR, Math.sin(a) * canopyR]); }
        let best = -Infinity;
        probes.forEach(([dx, dz]) => {
          o.set(b.cx + dx, h - 2, b.cz + dz); g.localToWorld(o);
          ray.set(o, up); ray.far = 4;
          const hit = ray.intersectObjects(ceilingMeshes, false)[0];
          if (hit) { const lp = g.worldToLocal(hit.point.clone()); best = Math.max(best, lp.y); }
        });
        if (Number.isFinite(best)) seat = Math.min(h, best);
      }
      // Bigger than before, and hung as low as the council table allows, while
      // the canopy stays seated in the ceiling (no gap above it).
      let chH = Math.min(h * 0.74, Math.max(K2_DRESS.chandelierH, seat - (tableH + 0.48)));
      chH = Math.min(chH, Math.max(3.2, seat - tableH - 0.42));
      const k = chH / Math.max(1e-4, size.y);
      model.scale.setScalar(k);
      model.position.set(b.cx - c.x * k, seat - box.max.y * k, b.cz - c.z * k);
      model.name = 'K2-majlis-chandelier';
      model.traverse(o => {
        if (!o.isMesh) return;
        // Keep the asset's authored materials and appearance; only set render flags.
        o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false;
      });
      hideUntilReady(model);
      g.add(model);
      const cups = K2_DRESS.cups.map((cup, i) => ({
        x: b.cx + (cup.x - c.x) * k,
        y: seat + (cup.y - box.max.y) * k + 0.02,
        z: b.cz + (cup.z - c.z) * k,
        s: cup.s,
        seed: 0.37 + i * 0.618
      }));
      addK2ChandelierFire(g, cups);
      const fireY = cups.reduce((s0, cup) => s0 + cup.y, 0) / cups.length;
      addK2Lights(r, g, fireY);
      if (state.k2Dress) {
        state.k2Dress.chandelier = true;
        state.k2Dress.chandelierTop = seat;
        state.k2Dress.chandelierH = chH;
        state.k2Dress.fireY = fireY;
      }
      if (state.root) state.root.updateMatrixWorld(true);
      // Table may still be loading; the zone streamer reveals once columns+table+chandelier are set.
    });
  }
  function indexSpatialFrom(start) {
    for (let i = start; i < state.colliders.length; i++) {
      const b = state.colliders[i];
      for (let x = Math.floor(b.minx); x <= Math.floor(b.maxx); x++) for (let z = Math.floor(b.minz); z <= Math.floor(b.maxz); z++) {
        const k = x + ',' + z; let a = state.spatial.get(k); if (!a) state.spatial.set(k, a = []); a.push(i);
      }
    }
  }
  function rebuildSpatial() {
    state.spatial.clear();
    indexSpatialFrom(0);
  }

  // Room-only Babylonian doors. Uses the supplied باب الاجنحة.glb unchanged.
  const ROOM_DOOR_ROOMS = new Set(['K1', 'K2', 'K3', 'K4']);
  function isRoomDoor(d) { return d && d.id !== 'KC12-K2' && d.kind !== 'arch' && (ROOM_DOOR_ROOMS.has(d.from) || ROOM_DOOR_ROOMS.has(d.to)); }
  function doorBox(d, out) {
    // The leaves swing out of the passage while opening. Keep only a very thin
    // safety band during the animation; a full-width slab makes the hero appear
    // to walk in the air. Once open, there is deliberately no door collider.
    const half = d.width * 0.5;
    // Closed: block the whole opening (the old 18% band let the hero walk
    // straight through the sides of a shut K3/K4 door).
    const span = d.state === 'Open' ? 0 : (d.state === 'Closed' ? half + 0.05 : Math.max(0.08, half * (1 - d.progress) * 0.18));
    const b = out || { _door: true, _doorRef: d };
    const thickness = d.state === 'Open' ? 0 : 0.14;
    b.minx = d.axis === 'x' ? d.x - thickness : d.x - span;
    b.maxx = d.axis === 'x' ? d.x + thickness : d.x + span;
    b.miny = 0; b.maxy = d.height * .94;
    b.minz = d.axis === 'x' ? d.z - span : d.z - thickness;
    b.maxz = d.axis === 'x' ? d.z + span : d.z + thickness;
    return b;
  }
  function rebuildDoorColliders() {
    const boxes = state.dynamicDoorBoxes || (state.dynamicDoorBoxes = []);
    let w = 0;
    state.doors.forEach(d => {
      if (!d._roomDoor || d.state === 'Open') return;
      const box = doorBox(d, d._colliderBox || (d._colliderBox = { _door: true, _doorRef: d }));
      boxes[w++] = box;
    });
    for(const runtime of [state.templeDoors,state.libraryDoors])if(runtime)for(const b of runtime.localBoxes)boxes[w++]=b;
    boxes.length = w;
  }
  function fitWingDoor(gltf, d, host) {
    const model = gltf.scene; model.name = 'BabylonianWingDoor-' + d.id;
    const collisionProxies=[];
    model.traverse(o => {
      if(!o.isMesh)return;
      if(o.userData.collision===true)collisionProxies.push(o);
      else { o.castShadow=true; o.receiveShadow=true; o.frustumCulled=true; }
    });
    model.rotation.y = d.axis === 'x' ? Math.PI * .5 : 0; model.updateMatrixWorld(true);
    const raw = new THREE.Box3().setFromObject(model), rs = raw.getSize(new THREE.Vector3());
    const span = d.axis === 'x' ? rs.z : rs.x;
    // Fill each room opening exactly (width x height of its wall cut) so no
    // gap shows around the leaves. Local X is the door's span axis both for
    // 'x' and 'z' doors (the rotation maps it onto the wall).
    const sSpan = d.width / Math.max(.001, span), sUp = d.height / Math.max(.001, rs.y);
    model.scale.set(sSpan, sUp, Math.min(sSpan, sUp));
    model.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(model), c = box.getCenter(new THREE.Vector3());
    model.position.x += -c.x; model.position.z += -c.z; model.position.y += -box.min.y;
    // Pivot on the door plane: mirroring it across the plane flips the swing so the leaves always open away from the hero.
    const pivot = new THREE.Group(); pivot.name = 'WingDoorPivot-' + d.id; pivot.position.set(d.x, 0, d.z); pivot.add(model);
    // Doors are hall/corridor architecture: always visible, never parented
    // to a room zone that hideObject / g.visible can take down.
    pivot.userData.isDoor = true; pivot.userData.sinKeepVisible = true;
    model.userData.isDoor = true; model.userData.sinKeepVisible = true;
    model.traverse(function (o) { if (!o.userData) o.userData = {}; o.userData.isDoor = true; o.userData.sinKeepVisible = true; });
    host.add(pivot); d.pivot = pivot;
    d.leafHalf = Math.max(.04, (d.axis === 'x' ? box.max.x - box.min.x : box.max.z - box.min.z) * .5);
    const clips = gltf.animations || [], openClip = clips.find(c => /opendoors/i.test(c.name || '')) || clips[0], closeClip = clips.find(c => /closedoors/i.test(c.name || '')) || openClip;
    if (!openClip) return;
    const om = new THREE.AnimationMixer(model), oa = om.clipAction(openClip); oa.setLoop(THREE.LoopOnce, 1); oa.clampWhenFinished = true; oa.play(); oa.paused = true; oa.time = 0; om.update(0);
    const cm = closeClip === openClip ? om : new THREE.AnimationMixer(model), ca = cm.clipAction(closeClip); ca.setLoop(THREE.LoopOnce, 1); ca.clampWhenFinished = true; ca.play(); ca.paused = true; ca.enabled = false; ca.time = closeClip === openClip ? closeClip.duration : 0; cm.update(0);
    // Which side of the door plane the original open clip swings the leaves to (+1 / -1 along the door normal).
    { const b0 = new THREE.Box3().setFromObject(model), c0 = b0.getCenter(new THREE.Vector3());
      oa.time = openClip.duration; om.update(0); model.updateMatrixWorld(true);
      const c1 = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
      oa.time = 0; om.update(0); model.updateMatrixWorld(true);
      const n = d.axis === 'x' ? c1.x - c0.x : c1.z - c0.z; d.swingSign = n < 0 ? -1 : 1; }
    // Keep the authored fitting and swing measurements. The game uses its
    // own doorBox for collision, so these fully transparent boxes need no GL
    // programs or draw calls when they enter the camera frustum.
    for(const proxy of collisionProxies)proxy.removeFromParent();
    d.model = model; d.openMixer = om; d.openAction = oa; d.openClip = openClip; d.closeMixer = cm; d.closeAction = ca; d.closeClip = closeClip; d.progress = 0; d.target = 0; d.state = 'Closed'; d.autoCloseTimer = 0; d.crossed = false; d.approachSide = 0; d.autoRearm = true; model.userData.roomDoor = d.id;
    rebuildDoorColliders();
  }
  function loadRoomDoors() {
    if (!THREE.GLTFLoader || !state.root || wingDoorLoadStarted) return;
    wingDoorLoadStarted = true;
    const roomDoors = state.doors.filter(isRoomDoor);
    roomDoors.forEach(d => { d._roomDoor = true; d.state = 'Closed'; d.progress = 0; d.target = 0; });
    wingGLB(WING_DOOR_FILE, function (template) {
      if (!state.root) return;
      try { console.info('[palace load] doors-fit-start', roomDoors.length, roomDoors.map(function (d) { return d.id; }).join(',')); } catch (_) {}
      for (let i = 0; i < roomDoors.length; i++) {
        const d = roomDoors[i];
        const room = ROOM_DOOR_ROOMS.has(d.to) ? d.to : d.from;
        try { console.info('[palace load] doors-fit-begin', i, d.id); } catch (_) {}
        const t0 = performance.now();
        try {
          fitWingDoor({ scene: template.scene.clone(true), animations: template.animations || [] }, d, state.root);
        } catch (e) {
          try { console.error('[palace load] doors-fit-err', d.id, e && (e.stack || e.message) || e); } catch (_) {}
        }
        try { console.info('[palace load] doors-fit', d.id, Math.round(performance.now() - t0) + 'ms'); } catch (_) {}
      }
      try { console.info('[palace load] doors-fit-done', roomDoors.length); } catch (_) {}
    }, err => { console.warn('تعذّر تحميل باب الأجنحة', err); wingDoorLoadStarted = false; });
  }
  function doorCoordinates(d, p) {
    const x = p.x - state.root.position.x, z = p.z - state.root.position.z;
    return { x, z, signed: d.axis === 'x' ? x - d.x : z - d.z,
      lateral: d.axis === 'x' ? z - d.z : x - d.x,
      distance: Math.hypot(x - d.x, z - d.z) };
  }
  function nearDoor(d, c) { return c.distance <= 1.15 && Math.abs(c.signed) <= 1.05 && Math.abs(c.lateral) <= d.width * 0.5 - 0.35; }
  function doorOccupied(d) {
    if (!state.ctx || !state.ctx.hero) return false;
    const c = doorCoordinates(d, state.ctx.hero.position);
    return Math.abs(c.signed) < 0.9 && Math.abs(c.lateral) < d.width * 0.5 + 0.45;
  }
  function beginDoorMotion(d, opening, c) {
    if (opening) {
      const anim = state.ctx && state.ctx.combat;
      if (!anim || !anim.startPush || !anim.startPush({ skipEnter: true, timeScale: DOOR_PUSH_SPEED, startFrac: DOOR_PUSH_START })) return false;
      d.heroPushActive = true;
      const side = Math.sign(c.signed) || 1;
      // Swing away from the hero: leaves travel to -side. Mirror the pivot across the door plane if the clip goes the other way.
      if (d.pivot && d.state === 'Closed') { const flip = d.swingSign === -side ? 1 : -1; if (d.axis === 'x') d.pivot.scale.x = flip; else d.pivot.scale.z = flip; }
      // Stand point: palms on the leaf surface.
      const reach = (anim.handReach || .48), off = side * ((d.leafHalf || .1) + reach - .03);
      d.standLocal = d.axis === 'x' ? { x: d.x + off, z: d.z + Math.max(-.6, Math.min(.6, c.lateral)) * .3 } : { x: d.x + Math.max(-.6, Math.min(.6, c.lateral)) * .3, z: d.z + off };
      d.faceYaw = d.axis === 'x' ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : (side > 0 ? Math.PI : 0);
    } else d.heroPushActive = false;
    d.target = opening ? 1 : 0; d.state = opening ? 'Opening' : 'Closing';
    if (opening) { d.approachSide = Math.sign(c.signed) || d.approachSide || 1; d.crossed = false; d.autoCloseTimer = 0; d.autoRearm = false; }
    state.activeDoor = d;
    return true;
  }
  function heroDoorOpenProgress(d) {
    const anim = state.ctx && state.ctx.combat, st = anim && anim.pushState && anim.pushState();
    if (!st || st.name !== 'push_object' || st.mode === 'enter' || st.mode === 'blend' || !(st.duration > 0)) return 0;
    const u = Math.max(0, Math.min(1, st.time / st.duration));
    const keys = [[0,0],[.64,0],[.708,.036],[.751,.107],[.792,.202],[.832,.274],[.876,.429],[.917,.631],[.957,.821],[1,1]];
    let hand = 1;
    for (let i = 1; i < keys.length; i++) {
      if (u <= keys[i][0]) { const a = keys[i-1], b = keys[i], k = (u-a[0]) / ((b[0]-a[0]) || 1); hand = a[1] + (b[1]-a[1])*k; break; }
    }
    return Math.pow(Math.max(0, Math.min(1, hand)), 1.2);
  }
  const DOOR_PUSH_SPEED = 1.15, DOOR_PUSH_START = .5, DOOR_CLOSE_SPEED = 1.1;
  function alignHeroToDoor(d, dt) {
    if (!d.standLocal || !state.ctx || !state.ctx.hero) return;
    const p = state.ctx.hero.position, k = 1 - Math.exp(-dt * 14);
    const tx = d.standLocal.x + state.root.position.x, tz = d.standLocal.z + state.root.position.z;
    p.x += (tx - p.x) * k; p.z += (tz - p.z) * k;
    if (state.ctx.setFacing) { const r = state.ctx.hero.rotation.y; let dy = d.faceYaw - r; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); state.ctx.setFacing(r + dy * k); }
  }
  // Kept as no-op compatibility methods: wing doors are intentionally not manually interactable.
  function interact() { return false; }
  // Readiness gate: a door (or open passage) into a streamed zone stays
  // closed until that zone is fully ready (upload + compile + isComplete).
  // There is no 2.5 s give-up: opening early was the K2 table pop-in on a
  // real phone. The door never opens on a timeout: only when ready (or the
  // zone failed and was revealed). A 60 s abandon would be pop-in.
  // For a door whose other side is a short corridor (K1-KC12 → KC12 → K2),
  // we wait for the first streamed room one hop past the corridor.
  const ZONE_DOOR_ABANDON_MS = 60000;
  const streamedTargetCache = new WeakMap();
  function streamedTargets(d, fromId) {
    const cur = fromId || state.current;
    if (!d) return [];
    const other = d.to === cur ? d.from : (d.from === cur ? d.to : d.to);
    let choices = streamedTargetCache.get(d);
    if (!choices) { choices = new Map(); streamedTargetCache.set(d, choices); }
    if (choices.has(other)) return choices.get(other);
    const set = new Set(WING_ZONES.map(z => z.id));
    if (set.has(other)) {
      const direct = [other];
      choices.set(other, direct);
      return direct;
    }
    const dist = distancesFrom(other);
    const found = [];
    dist.forEach(function (h, id) { if (set.has(id) && h <= 1) found.push(id); });
    found.sort(function (a, b) { return dist.get(a) - dist.get(b); });
    choices.set(other, found);
    return found;
  }
  function zoneIsReady(id) {
    if (!zoneStreamer) return true;
    const st = zoneStreamer.status(id);
    return st === 'unregistered' || st === 'ready';
  }
  function zoneGateOpen(d) {
    if (!zoneStreamer) return true;
    const targets = streamedTargets(d);
    const waiting = targets.filter(function (id) { return !zoneIsReady(id); });
    if (!waiting.length) { d._gateSince = 0; return true; }
    // Never open into a still-loading room. fail() reveals the zone (it
    // becomes ready) so a truly failed load is not stuck behind the door.
    // The 60 s abandon used to open into a half-built room — that is pop-in.
    return false;
  }
  // Open passages into a streamed room (KC12-K2 is excluded from isRoomDoor)
  // still get a temporary collider so the player cannot walk into a
  // half-built room even if they reached the passage another way.
  function updatePassageGates() {
    const boxes = state.dynamicDoorBoxes || (state.dynamicDoorBoxes = []);
    // Drop previous gate-only boxes, keep real door colliders.
    let w = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i] && boxes[i]._streamGate) continue;
      boxes[w++] = boxes[i];
    }
    boxes.length = w;
    if (!zoneStreamer || !state.doors || !state.current) return;
    const cur = state.current;
    state.doors.forEach(function (d) {
      if (!d || d._roomDoor || state.templeDoorIds?.has(d.id) || state.libraryDoorIds?.has(d.id)) return;
      const entranceDoor = window.SinT1Entrance && state.entranceDoors.includes(d);
      if (d.kind === 'arch' && d.id !== 'PalaceR1' && !entranceDoor) return;
      const targets = entranceDoor ? ['T1'] : d.id === 'PalaceR1' ? ['L1'] : d.id === 'LC2-L2' ? ['L2'] : d===state.studyDoor ? ['L3'] : d === state.offeringPortal ? ['T5'] :
        window.SinPurificationHall && state.purificationDoors.includes(d) ? ['T2'] :
        window.SinLunarSanctuary && state.sanctuaryDoors.includes(d) ? ['T4'] :
        state.observatoryDoors.includes(d) ? ['L4'] : state.sacredHallDoors.includes(d) ? ['T3'] :
          streamedTargets(d, cur).filter(id => !libraryZones.has(id) && id !== 'T1' && id !== 'T2' && id !== 'T3' && id !== 'T5' && id !== 'T4');
      // Only block when approaching from outside a not-ready streamed room.
      const waiting = targets.filter(function (id) { return id !== cur && !zoneIsReady(id); });
      if (!waiting.length) return;
      const half = (d.width || 4.5) * 0.5;
      const thick = 0.22;
      const box = d.axis === 'x'
        ? { minx: d.x - thick, maxx: d.x + thick, miny: 0, maxy: (d.height || 4) * 0.94, minz: d.z - half, maxz: d.z + half, _streamGate: true, _door: true, _doorRef: d }
        : { minx: d.x - half, maxx: d.x + half, miny: 0, maxy: (d.height || 4) * 0.94, minz: d.z - thick, maxz: d.z + thick, _streamGate: true, _door: true, _doorRef: d };
      boxes.push(box);
    });
  }
  function updateRoomDoors(dt) {
    if (!state.built || !state.ctx || !state.ctx.hero || !state.root) return;
    const hero = state.ctx.hero.position;
    let busyDoor = state.doors.find(d => d._roomDoor && (d.state === 'Opening' || d.state === 'Closing')) || null;
    state.doors.forEach(d => {
      if (!d._roomDoor || !d.model) return;
      const c = doorCoordinates(d, hero), near = nearDoor(d, c);
      if (c.distance > 4.0) { d.autoRearm = true; d._gateSince = 0; }
      if (d.state === 'Closed' && near && d.autoRearm && !busyDoor) {
        const gate = zoneGateOpen(d);
        if (!gate) {
          // Standing at a closed door: ask the streamer to finish the room.
          // Never force-open on a timer — that opened into a half-built room
          // and the gate slammed the door shut in the hero's face.
          const now = performance.now();
          if (!d._forceLoadAt || now - d._forceLoadAt > 400) {
            d._forceLoadAt = now;
            if (zoneStreamer && typeof zoneStreamer.forceLoad === 'function') {
              streamedTargets(d).forEach(function (id) { if (!zoneIsReady(id)) { try { zoneStreamer.forceLoad(id); } catch (_) {} } });
            }
          }
        } else if (beginDoorMotion(d, true, c)) {
          busyDoor = d;
          d._forceLoadAt = 0;
        }
      }
      if (d.state === 'Open') {
        // Stay open while the hero is near or passing. Only close after
        // the streamed room is evicted AND the hero has walked away, so
        // a return visit cannot walk into a half-built room.
        d.crossed = true;
        d.autoCloseTimer = 0;
        const targets = streamedTargets(d);
        const cur = state.current;
        const waiting = targets.filter(function (id) { return id !== cur && !zoneIsReady(id); });
        const passing = near || doorOccupied(d) || c.distance <= 4.0;
        if (waiting.length && !busyDoor && !passing) {
          if (beginDoorMotion(d, false, c)) busyDoor = d;
        }
      }
      if (d.progress === d.target) return;
      const opening = d.target > d.progress;
      if (opening && d.heroPushActive) {
        alignHeroToDoor(d, dt);
        d.progress = Math.max(d.progress, heroDoorOpenProgress(d));
      } else d.progress = Math.max(0, Math.min(1, d.progress + (opening ? 1 : -1) * dt * (opening ? 1.3 : DOOR_CLOSE_SPEED)));
      const a = opening ? d.openAction : d.closeAction, other = opening ? d.closeAction : d.openAction;
      const m = opening ? d.openMixer : d.closeMixer, cclip = opening ? d.openClip : d.closeClip;
      other.enabled = false; a.enabled = true; a.paused = false;
      a.time = opening ? cclip.duration * d.progress : cclip.duration * (1 - d.progress);
      m.update(0); a.paused = true;
      if (!opening && d.progress <= .001) { d.progress = 0; d.state = 'Closed'; d.crossed = false; d.autoCloseTimer = 0; d.heroPushActive = false; if (state.activeDoor === d) state.activeDoor = null; }
      else if (opening && d.progress >= .999) {
        d.progress = 1; d.state = 'Open';
        if (d.heroPushActive) { const anim = state.ctx && state.ctx.combat; if (anim && anim.releasePush) anim.releasePush(); d.heroPushActive = false; }
        if (state.activeDoor === d) state.activeDoor = null;
      }
    });
    state.templeDoors?.tick(dt,state.archiveMotion);
    state.libraryDoors?.tick(dt,state.archiveMotion);
    rebuildDoorColliders();
    updatePassageGates();
  }
  function canInteract() { return false; }
  function doorLocked() {
    if(state.templeDoors?.locked()||state.libraryDoors?.locked())return true;
    // Freeze the hero only for the door they are actually opening or standing in.
    // A far door auto-closing after eviction (zone no longer ready) must not pin
    // the player in another room — that looked like a hang while standing or walking
    // the hall. Opening with heroPushActive is always a local lock.
    const d = state.activeDoor;
    if (!d || (d.state !== 'Opening' && d.state !== 'Closing')) return false;
    if (d.heroPushActive) return true;
    if (!state.ctx || !state.ctx.hero) return false;
    try {
      const c = doorCoordinates(d, state.ctx.hero.position);
      return !!(nearDoor(d, c) || doorOccupied(d));
    } catch (_) { return false; }
  }
  function doorReport() {
    const royal=state.doors.filter(d=>d._roomDoor).map(d=>({id:d.id,room:ROOM_DOOR_ROOMS.has(d.to)?d.to:d.from,
      state:d.state||'pending',progress:+(d.progress||0).toFixed(3),loaded:!!d.model,collision:d.state!=='Open'}));
    return royal.concat(state.templeDoors?.report()||[],state.libraryDoors?.report()||[]);
  }

  function dispose() {
    state.k3Dress?.lunarLoad?.abort();
    state.studyLoad?.abort();state.study?.warmup.dispose();state.studyLoad=state.study=null;
    state.k5Dress?.controller?.abort();state.k5Dress?.warmup?.dispose();
    state.studyDoor=state.studyScreen=null;state.privateApertures=[];
    state.templeDoors?.dispose();state.libraryDoors?.dispose();
    state.libraryDoors=state.libraryDoorIds=null;
    state.templeDoors=state.templeDoorIds=null;
    if (state.entranceLoad) state.entranceLoad.abort();
    if (state.sacredEntrance) {
      state.sacredEntrance.root.removeFromParent();
      state.sacredEntrance.dispose();
    }
    state.sacredEntrance = state.entranceLoad = state.entranceScreens = null;
    if (state.purificationLoad) state.purificationLoad.abort();
    if (state.purificationHall) {
      state.purificationHall.root.removeFromParent();
      state.purificationHall.dispose();
    }
    state.purificationHall = state.purificationLoad = state.purificationScreens = null;
    if (state.lunarSanctuaryLoad) state.lunarSanctuaryLoad.abort();
    if (state.lunarSanctuary) {
      state.lunarSanctuary.root.removeFromParent();
      state.lunarSanctuary.dispose();
    }
    state.lunarSanctuary = state.lunarSanctuaryLoad = state.sanctuaryScreens = null;
    if (state.royalOfferingsLoad) state.royalOfferingsLoad.abort();
    if (state.royalOfferings) {
      state.royalOfferings.root.removeFromParent();
      state.royalOfferings.dispose();
    }
    state.royalOfferings = state.royalOfferingsLoad = state.offeringScreen = null;
    if (state.sacredHallLoad) state.sacredHallLoad.abort();
    if (state.sacredHall) {
      state.sacredHall.root.removeFromParent();
      state.sacredHall.dispose();
    }
    state.sacredHall = state.sacredHallLoad = null;
    if (state.observatoryLoad) state.observatoryLoad.abort();
    if (state.observatory) {
      state.observatory.root.removeFromParent();
      state.observatory.dispose(state.observatory.sharedStone === getLibraryFloorTexture());
    }
    state.observatory = state.observatoryLoad = null;
    if (state.archiveLoad) state.archiveLoad.abort();
    if (state.archive) {
      state.archive.root.removeFromParent();
      state.archive.dispose();
    }
    state.archive = state.archiveLoad = state.archiveMotion = null;
    state.routes=state.nextStreamRoom=state.recentStreamRoom=state.lastStreamOrigin=null;
    state.approachedStreamRoom=null;
    state.archiveDemand = false;
    state.archiveBudgetSampleAt = 0;
    state.archiveScreen = state.librarySightRoutes = null;
    state.entryLibrary = null;
    state.libraryFailures = null;
    if (state.libraryWarmup) state.libraryWarmup.dispose();
    state.libraryWarmup = null;
    if (state.library) {
      state.library.root.removeFromParent();
      state.library.dispose();
    }
    state.library = null;
    state.libraryLoad = null;
    if (state.root && state.root.parent) state.root.parent.remove(state.root);
    if (state.root) state.root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); }
    });
    if (state.ui) { state.ui.remove(); state.ui = null; }
    if (state.label) { state.label.remove(); state.label = null; }
    wingDoorLoadStarted = false;
    state.built = false; state.root = null; state.regionGroups.clear(); state.colliders = []; state.dynamicDoorBoxes = []; state.activeDoor = null; state.interactDoor = null; state.fires = []; state.torchFireMats = null; state.corridorTorches = [];
    state.k2Lights = null; state.k2LightBase = null; state.k2FloorSolids = null;
    state.k3Lights = null; state.k3LightBase = null; state.k3FloorSolids = null; state.k4Dress = null; state.k5Dress = null;
    state.k1FloorY = 0; state.k1ModelMetrics = null; state.k1ModelColliderCount = 0; state.gpuResidency = null; state.renderBudget = null;
    dressedRooms.clear(); zoneDone.clear(); dressFailures.length = 0; state.deferredDress.clear(); state._streamSets = null; zoneDistKey = ''; zoneDist = null;
    regionDistances.clear();
    if (zoneStreamer) zoneStreamer.reset();
  }
  function discardStageAsset(asset) {
    const r3 = window.SinR3SealedZone;
    if (r3) r3.release(r3.resources([asset]), r3.resources([]));
  }
  async function retire() {
    if (retired) return;
    retired = true;
    stageAbort?.abort();
    const pending = wingLoadChain;
    deferredLoads.length = 0;
    for (const id of zoneStreamer?.zones() || []) zoneStreamer.unregister(id);
    dispose();
    zoneStreamer?.attach(null);
    preloaded.clear();
    triCache.clear();
    roomManager = roomManaged = roomSight = null;
    regionAtHit = regionAtRooms = null;
    state.spatial.clear();
    for (const key of Object.keys(state)) delete state[key];
    await pending;
    k3Draco?.dispose();
    k3Draco = null;
  }
  function wingMark(msg) {
    try { if (window.PalaceInterior && PalaceInterior.mark) PalaceInterior.mark(msg); } catch (e) { /* marks are diagnostic only */ }
  }
  function yieldWing() {
    // setTimeout only. Sharing requestAnimationFrame with the game loop
    // let a single expensive frame (software GL, scene walk) delay SETUP
    // for minutes and freeze the tab.
    return new Promise(function (r) {
      const t0 = performance.now();
      setTimeout(function () {
        const dt = performance.now() - t0;
        if (dt > 50) {
          try { console.info('[palace load] yield-slow', Math.round(dt) + 'ms'); } catch (_) {}
        }
        r();
      }, 0);
    });
  }
  async function build(ctx, hall) {
    stageAbort?.signal.throwIfAborted();
    assertDeps(); dispose();
    state.building = true; deferredLoads.length = 0;
    try { return await buildNow(ctx, hall); }
    finally { state.building = false; deferredLoads.length = 0; }
  }
  async function buildNow(ctx, hall) {
    const t0 = performance.now();
    function phase(name) {
      try { console.info('[palace load] wings-' + name, Math.round(performance.now() - t0) + 'ms'); } catch (_) {}
    }
    state.ctx = ctx; state.hall = hall; state.debug = /(?:[?&#])debug=1(?:&|#|$)/.test(location.href);
    state.root = new THREE.Group(); state.root.name = 'PalaceWings';
    state.root.position.set(ctx.portal.x, hall.floorY || 0, ctx.portal.frontZ); ctx.scene.add(state.root);
    // One fixed ambient source serves every wing and corridor, so brightness
    // does not jump when regional geometry is culled or the hero changes rooms.
    state.unifiedAmbient = new THREE.HemisphereLight(0xffe2b8, 0x5c3a28, 0.78);
    state.unifiedAmbient.name = 'PalaceWingsUnifiedAmbient';
    state.root.add(state.unifiedAmbient);
    const Arch = window.PalaceWingArchitecture;
    const layout = (Arch && Arch.solveLayout) ? Arch.solveLayout(hall) : solveLayout(hall);
    wingMark('wings layout'); phase('layout');
    try { console.info('[palace load] wings-layout-to-bake'); } catch (_) {}
    state.rooms = layout.rooms; state.connectors = layout.connectors; state.doors = layout.doors;
    state.regions = state.rooms.concat(state.connectors); state.links = layout.links; state.sealed = layout.sealed; state.back = layout.back;
    const templePlan = window.SinTempleDoors?.plan(state.doors,state.regions);
    const templeOpenings = templePlan?.openings || [];
    state.templeDoorIds = new Set(templeOpenings.map(row=>row.portal.id));
    const libraryPlan=window.SinTempleDoors?.plan(state.doors,state.regions,'Library');
    state.libraryDoorIds=new Set(libraryPlan?.openings.map(row=>row.portal.id)||[]);
    state.archivePortals = ['PalaceR1', 'L1-LC2', 'LC2-L2'].map(id => state.doors.find(door => door.id === id));
    state.observatoryDoors = state.doors.filter(door => door.from === 'L4' || door.to === 'L4');
    state.observatoryApproach = state.doors.find(door => door.id === 'L1-LC4');
    state.sacredHallDoors = state.doors.filter(d => d.from === 'T3' || d.to === 'T3');
    const doorFor = id => state.doors.find(d => d.id === id);
    state.sacredHallEntry = doorFor('PalaceR3');
    const eastEntrance = doorFor('T1-TC12'), southEntrance = doorFor('T1-TR1');
    state.entranceDoors = [state.sacredHallEntry, eastEntrance, southEntrance];
    state.studyDoor = window.SinPrivateRooms ? doorFor('LC3-L3') : null;
    state.privateApertures = window.SinPrivateRooms ? state.rooms.filter(r=>r.id==='L3'||r.id==='K5').map(r=>SinPrivateRooms.aperture(r)) : [];
    state.entranceRoutes = new Map([
      ['ARCH_R3',[state.sacredHallEntry]],
      ['TC12',[eastEntrance]],['T2',[doorFor('TC12-T2'),eastEntrance]],['TR1',[southEntrance]]
    ]);
    const t3ViaWest = [doorFor('T2-TC23'), doorFor('TC23-T3')];
    const purgeWest = [doorFor('TC12-T2'), doorFor('T1-TC12')];
    state.purificationDoors = [purgeWest[0], t3ViaWest[0]];
    state.purificationRoutes = new Map([
      ['ARCH_R3', [purgeWest[1], purgeWest[0]]], ['T1', [purgeWest[1], purgeWest[0]]], ['TC12', [purgeWest[0]]],
      ['T3', [...t3ViaWest].reverse()], ['TC23', [t3ViaWest[0]]]
    ]);
    const t3ViaEast = [doorFor('TC34-T4'), doorFor('T3-TC34')];
    const t3ViaNorth = [doorFor('TC5-T5'), doorFor('T3-TC5')];
    const lunarExit = doorFor('T4-MP1');
    state.sanctuaryDoors = [t3ViaEast[0], lunarExit];
    state.sanctuaryFrameSet = new Set();
    state.sanctuarySightLines = [
      [['TC34', t3ViaEast[0]], ['T3', t3ViaEast[1]], ['TC23', t3ViaWest[1]], ['T2', t3ViaWest[0]]],
      [['MP1', lunarExit]]
    ];
    state.sanctuaryRoutes = new Map([
      ['T2', [...t3ViaWest, t3ViaEast[1], t3ViaEast[0]]],
      ['TC23', [t3ViaWest[1], t3ViaEast[1], t3ViaEast[0]]],
      ['T3', [t3ViaEast[1], t3ViaEast[0]]],
      ['TC34', [t3ViaEast[0]]], ['MP1', [lunarExit]]
    ]);
    state.offeringPortal = t3ViaNorth[0];
    state.offeringPassage = t3ViaNorth[1];
    state.sacredHallRoutes = new Map([
      ['T1', [doorFor('T1-TC12'), doorFor('TC12-T2'), ...t3ViaWest]],
      ['TC12', [doorFor('TC12-T2'), ...t3ViaWest]], ['T2', t3ViaWest], ['TC23', t3ViaWest.slice(1)],
      ['T4', t3ViaEast], ['TC34', t3ViaEast.slice(1)], ['T5', t3ViaNorth], ['TC5', t3ViaNorth.slice(1)]
    ]);
    state.sacredHallSightLines = [
      [['TC23', t3ViaWest[1]], ['T2', t3ViaWest[0]], ['TC12', doorFor('TC12-T2')], ['T1', doorFor('T1-TC12')]],
      [['TC34', t3ViaEast[1]], ['T4', t3ViaEast[0]]],
      [['TC5', t3ViaNorth[1]], ['T5', t3ViaNorth[0]]]
    ];
    const library = state.rooms.find(room => room.id === 'L1');
    state.archiveHallExit = Object.assign({}, state.archivePortals[0], { x: library.bbox.x0 });
    state.librarySightRoutes = makeLibrarySightRoutes();
    const hallBounds = { x0: -hall.width / 2, x1: hall.width / 2, z0: 0, z1: hall.length };
    state.planRegions = state.regions.concat({ id: 'Palace', bbox: hallBounds });
    state.routes = SinPalaceRoutes.create(state.planRegions,state.links,state.doors);
    state.hallPortalsByRoom=new Map(state.doors.filter(d=>d.from==='Palace').map(d=>[d.to,d]));
    // Prefer the build-time bake (data/palace-colliders.json): Clipper K1-diff and
    // the 0.5 m collider grid are identical to a live compute (see palace-collider-bake test)
    // and cost a JSON parse instead of minutes on the main thread.
    const baked = state.bake || window.__palaceColliderBake;
    const useBake = !!(Arch && baked && Arch.hallMatches(baked.hall, hall));
    if (useBake) {
      Arch.applyColliderBake(state, baked);
      try { console.info('[palace load] wings-baked-colliders', (baked.colliders || []).length, 'boxes'); } catch (_) {}
      wingMark('wings baked-colliders'); phase('baked-colliders'); await yieldWing();
    } else if (Arch && Arch.computeBake) {
      try {
        const why = (!baked) ? 'no-json' : (window.PalaceWingArchitecture && PalaceWingArchitecture.hallMismatchReason
          ? PalaceWingArchitecture.hallMismatchReason(baked.hall, hall)
          : 'hall-mismatch');
        console.info('[palace load] wings-bake-miss', why, JSON.stringify({
          live: { w: hall.width, l: hall.length, wt: hall.wallThickness, ad: hall.alcoveDepth, H: hall.H, nPass: (hall.passages || []).length },
          baked: baked && baked.hall && { w: baked.hall.width, l: baked.hall.length, wt: baked.hall.wallThickness, ad: baked.hall.alcoveDepth, H: baked.hall.H, nPass: (baked.hall.passages || []).length }
        }));
      } catch (_) {}
      const tC = performance.now();
      const live = Arch.computeBake(hall);
      Arch.applyColliderBake(state, live);
      try { console.info('[palace load] wings-computed-colliders', Math.round(performance.now() - tC) + 'ms', (live.colliders || []).length); } catch (_) {}
      wingMark('wings computed-colliders'); phase('computed-colliders'); await yieldWing();
    } else {
      prepareArchitecture(layout);
      wingMark('wings architecture'); phase('architecture'); await yieldWing();
      const k1 = state.rooms.find(r => r.id === 'K1');
      if (k1) {
        try { console.info('[palace load] k1-diff-start'); } catch (_) {}
        const tDiff = performance.now();
        state.baseWall = difference(state.baseWall, solid(k1.poly));
        state.wallSolid = difference(state.wallSolid, solid(k1.poly));
        try { console.info('[palace load] k1-diff-end', Math.round(performance.now() - tDiff) + 'ms'); } catch (_) {}
      }
      await yieldWing();
      await makeColliders(state.baseWall, state.caps);
      wingMark('wings colliders'); phase('colliders'); await yieldWing();
    }
    for(const opening of state.privateApertures){
      const cut={minx:opening.x-.36,maxx:opening.x+1.50,miny:opening.bottom,maxy:opening.top,
        minz:opening.z-opening.half,maxz:opening.z+opening.half};
      state.colliders=state.colliders.flatMap(box=>cutCollider(box,cut));
    }
    if(window.SinPrivateRooms)for(const d of state.doors.filter(d=>d.from==='K5'||d.to==='K5')){
      // Grid padding can intrude into the rebuilt corridor mouth. Keep the
      // whole original doorway clear using the actual jamb coordinates.
      const cut={minx:d.x-d.width/2,maxx:d.x+d.width/2,miny:0,maxy:d.height,minz:d.z-.96,maxz:d.z+.96};
      state.colliders=state.colliders.flatMap(box=>cutCollider(box,cut));
    }
    const doorLintels=await buildVisuals(layout);
    wingMark('wings visuals'); phase('visuals'); await yieldWing();
    if(window.SinTempleDoors){
      for(const [wing,plan,asset,key] of [
        ['Temple',templePlan,SinTempleDoors.asset,'templeDoors'],
        ['Library',libraryPlan,SinTempleDoors.libraryAsset,'libraryDoors']
      ]){
        if(!plan?.openings.length)continue;
        const template=preloaded.get(asset);
        if(!template?.scene)throw Error(wing+' door asset not prepared during palace loading');
        state[key]=SinTempleDoors.mount(template,plan.openings,{
          root:state.root,hero:ctx.hero,combat:ctx.combat,setFacing:yaw=>state.ctx.setFacing(yaw),
          dark:state.darkMat,ready:zoneIsReady,floor:floorAt,passages:plan.passages,lintels:doorLintels[wing],wing
        });
      }
      rebuildDoorColliders();
    }
    rebuildSpatial(); loadRoomDoors(); phase('doors'); await yieldWing();
    try { console.info('[palace load] wings-after-doors'); } catch (_) {}
    state.built = true;
    if (state.debug) createDebugUI();
    const tCull = performance.now();
    updateCulling(true);
    try { console.info('[palace load] wings-cull-1', Math.round(performance.now() - tCull) + 'ms'); } catch (_) {}
    await yieldWing();
    // Models already downloaded behind the palace loading screen are attached
    // now, in the same order the network callbacks used to run after build.
    await flushDeferredLoads(); phase('deferred');
    await yieldWing();
    const tCull2 = performance.now();
    updateCulling(true); phase('cull-2');
    try { console.info('[palace load] wings-cull-2', Math.round(performance.now() - tCull2) + 'ms'); } catch (_) {}
    return {
      root: state.root,
      fires: state.fires,
      colliders: state.colliders,
      rooms: state.rooms.length,
      drawBudget: 40,
      triangleBudget: 750000
    };
  }
  function contains(x, z) { return state.built && pointInSolids(x, z, state.floorExtended); }
  // The culling / sight tests ask for the camera's region ~20 times per
  // frame with the same coordinates. Room polygons never change after
  // build, so the last answer is reused (cleared by build / dispose).
  let regionAtKeyX = NaN, regionAtKeyZ = NaN, regionAtHit = null, regionAtRooms = null;
  function regionAt(x, z) {
    if (x === regionAtKeyX && z === regionAtKeyZ && regionAtRooms === state.rooms) return regionAtHit;
    let hit = null;
    for (const r of state.rooms) if (pointInPoly(x, z, r.poly)) { hit = r; break; }
    if (!hit) for (const r of state.connectors) if (r.kind !== 'threshold' && pointInPoly(x, z, r.poly)) { hit = r; break; }
    if (!hit) for (const r of state.connectors) if (pointInPoly(x, z, r.poly)) { hit = r; break; }
    regionAtKeyX = x; regionAtKeyZ = z; regionAtHit = hit; regionAtRooms = state.rooms;
    return hit;
  }
  function adjacency() {
    const map = new Map();
    state.regions.forEach(r => map.set(r.id, [])); map.set('Palace', []);
    state.links.forEach(([a, b]) => { if (!map.has(a)) map.set(a, []); if (!map.has(b)) map.set(b, []); map.get(a).push(b); map.get(b).push(a); });
    return map;
  }
  const regionDistances = new Map();
  function distancesFrom(id) {
    if (regionDistances.has(id)) return regionDistances.get(id);
    const adj = adjacency(), dist = new Map([[id, 0]]), q = [id];
    while (q.length) { const a = q.shift(); for (const b of adj.get(a) || []) if (!dist.has(b)) { dist.set(b, dist.get(a) + 1); q.push(b); } }
    regionDistances.set(id, dist);
    return dist;
  }
  function groupTriangleCount(g) {
    let triangles = 0;
    g.traverse(o => {
      if (!o.isMesh || !o.geometry || !o.visible) return;
      let visible = true, parent = o.parent;
      while (visible && parent && parent !== g) { visible = parent.visible; parent = parent.parent; }
      if (!visible) return;
      const count = o.geometry.index ? o.geometry.index.count / 3 : (o.geometry.attributes.position ? o.geometry.attributes.position.count / 3 : 0);
      triangles += count * (o.isInstancedMesh ? o.count : 1);
    });
    return triangles;
  }
  const visibilityPlanner = window.SinWingVisibility ? window.SinWingVisibility.createPlanner() : null;
  const triCache = new Map();
  function cachedTriangles(id, g, force) {
    if (force || !triCache.has(id)) {
      // Count all meshes regardless of current visibility so a diagnostics
      // total does not change just because a room was hidden last frame.
      const was = g.visible; g.visible = true;
      triCache.set(id, groupTriangleCount(g));
      g.visible = was;
    }
    return triCache.get(id);
  }
  // Visual-regression fix: wing GLB materials are used as authored again.
  // Forcing metalness / envMapIntensity on streamed materials was a
  // compensation for textures that were never uploaded. No-op retained
  // because dress / door / prop paths still call it.
  function softenWingMetal(m) { void m; }
  function prepareRoomMaterials(g) {
    if (!g) return;
    g.traverse(o => {
      if (!o.isMesh) return;
      const list = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      list.forEach(m => { if (m && m.side !== THREE.DoubleSide && /ceil|floor|سقف|أرض/i.test(String(o.name || ''))) m.side = THREE.DoubleSide; });
      if (o.geometry && o.frustumCulled !== false && /ceil|floor/i.test(String(o.name || ''))) {
        o.frustumCulled = false;
        try { o.geometry.computeBoundingSphere(); } catch (_) {}
      }
    });
  }
  let camDir = null, camPosition = null;
  function cameraView(rootX, rootZ, cam = state.ctx && state.ctx.camera) {
    if (!cam || !cam.getWorldDirection) return null;
    if (!camDir) camDir = new THREE.Vector3();
    if (!camPosition) camPosition = new THREE.Vector3();
    cam.getWorldDirection(camDir);
    let dx = camDir.x, dz = camDir.z; const len = Math.hypot(dx, dz);
    if (len < 1e-4) { dx = 0; dz = 1; } else { dx /= len; dz /= len; }
    const vfov = (cam.fov || 60) * Math.PI / 180, aspect = cam.aspect || 1;
    const halfFov = Math.atan(Math.tan(vfov / 2) * aspect);
    const p = cam.parent && !cam.parent.isScene ? cam.getWorldPosition(camPosition) : cam.position;
    return { x: p.x - rootX, z: p.z - rootZ, dirX: dx, dirZ: dz, halfFov };
  }
  // Streamed dress content (K2–K4 props) is owned by the zone streamer:
  // prepared before the player arrives, revealed atomically, evicted LRU with
  // a grace period. Architecture shells built at palace entry stay.
  const dressedRooms = new Set();
  const dressFailures = [];
  // ---------------------------------------------------------------------------
  // Streamed zones. Each entry is pure data + hooks; the streamer owns the
  // lifecycle (prefetch, budgeted upload, compile against the real scene,
  // atomic reveal, LRU eviction). To add a room: add one entry (see
  // ADDING_CONTENT.md) or call PalaceWings.registerZone(spec) at runtime.
  const zoneDone = new Set();
  function streamedName(id) { const re = new RegExp('^' + id + '-'); return function (ch) { return !!(ch.userData && ch.userData.streamDress) || !!(ch.name && re.test(ch.name)); }; }
  function loadLibrary(api) {
    const room = state.rooms.find(r => r.id === 'L1');
    const host = state.regionGroups.get('L1');
    if (!room || !host) { api.fail(new Error('Great Library room unavailable')); return; }
    const loadModel = url => loadRoomModel(url, stageAbort.signal);
    const doors = state.doors.filter(d => d.from === 'L1' || d.to === 'L1');
    const pending = window.SinGreatLibrary.build(room, doors, loadModel, deviceProfile.constrained);
    state.libraryLoad = pending;
    pending.then(library => {
      if (state.libraryLoad !== pending) { library.dispose(); return; }
      state.library = library;
      state.libraryWarmup = SinGreatLibrary.geometryWarmup(library.root);
      zoneStreamer.markReleasable(library.root);
      api.add(library.root);
      api.done();
    }, error => {
      if (state.libraryLoad !== pending) return;
      console.error('[L1] Great Library asset load failed', error);
      api.fail(error);
    });
  }
  function setLibraryCeiling(group) {
    const fallback = group && group.getObjectByName('L1-ceiling');
    if (fallback) fallback.visible = !(state.library && state.library.ready) && !state.cutaway;
    if (state.library && state.library.ready) {
      state.library.root.traverse(node => {
        if (/^L1-(?:ceiling|skylight)/.test(node.name) && !node.isLight) node.visible = !state.cutaway;
      });
    }
  }
  function loadArchive(api) {
    const room = state.rooms.find(r => r.id === 'L2');
    const entrance = state.archivePortals[2];
    const controller = new AbortController();
    state.archiveLoad = controller;
    const usage = window.SinProcessMemory && SinProcessMemory.last();
    const profile = archiveProfile(usage || {});
    SinRoyalArchive.build(room, entrance, timedRoomModels(api), controller.signal, profile.textureSize).then(async archive => {
      if (state.archiveLoad !== controller || controller.signal.aborted) { archive.dispose(); return; }
      try {
        const table=archive.root.getObjectByName('L2-tableLeft');
        archive.lunar=await loadLunarTablet('L2',archive.root,table,controller.signal,api,archive.lunarStand);
        controller.signal.throwIfAborted();
        archive.warmup.dispose();
        archive.warmup=SinGreatLibrary.geometryWarmup(archive.root);
        state.archive = archive;
        zoneStreamer.markReleasable(archive.root);
        api.add(archive.root);
        api.done();
      } catch(error) {
        archive.dispose();
        throw error;
      }
    }).catch(error => {
      if (state.archiveLoad !== controller || controller.signal.aborted) return;
      api.fail(error);
    });
  }

  function archiveProfile(usage) {
    if (!deviceProfile.constrained) return { processMB: 225, gpuMB: 145, cpuMB: 80, textureSize: 0 };
    const tight = usage.processMB > deviceProfile.processBudgetMB - 40 ||
      usage.gpuMB > deviceProfile.gpuBudgetMB - 35;
    return tight ? { processMB: 19, gpuMB: 14, cpuMB: 15, textureSize: 512 } :
      { processMB: 37, gpuMB: 30, cpuMB: 22, textureSize: 1024 };
  }

  const timedRoomModels = api => (url,signal,meshopt) => loadRoomModel(url,signal,meshopt,api.recordAssetTime);
  function loadRoomModel(url, signal, meshopt = false, record, draco) {
    return enqueueWingLoad(async () => {
      signal.throwIfAborted();
      const fetchAt = performance.now();
      const requestSignal = stageAbort && AbortSignal.any ? AbortSignal.any([signal, stageAbort.signal]) : signal;
      const response = await fetch(encodeURI(url), { signal: requestSignal });
      if (!response.ok) throw new Error(response.status + ' ' + url);
      const buffer = await response.arrayBuffer();
      record?.('modelFetchMs',performance.now()-fetchAt);
      signal.throwIfAborted();
      await yieldWing();
      signal.throwIfAborted();
      const decodeAt = performance.now();
      const loader = new THREE.GLTFLoader();
      if (draco) loader.setDRACOLoader(draco);
      if (meshopt) {
        const decoder = await new Promise(resolve => withMeshopt(resolve));
        signal.throwIfAborted();
        if (!decoder) throw new Error('Meshopt decoder unavailable');
        loader.setMeshoptDecoder(decoder);
      }
      const model=await loader.parseAsync(buffer, '');
      if (retired || signal.aborted) { discardStageAsset(model); signal.throwIfAborted(); stageAbort?.signal.throwIfAborted(); }
      record?.('modelDecodeMs',performance.now()-decodeAt);
      return model;
    });
  }

  async function loadLunarTablet(id,parent,table,signal,api,fallback) {
    if(!table)throw Error('Lunar discovery needs its original '+id+' table');
    const draco=await new Promise(resolve=>k3EnsureDraco(resolve));
    if(!draco)throw Error('Lunar discovery Draco decoder unavailable');
    const model=await loadRoomModel(SinLunarDiscoveries.files[id],signal,false,api.recordAssetTime,draco);
    try {
      signal.throwIfAborted();
      return SinLunarDiscoveries.monument(id,model.scene,parent,table,fallback);
    } catch(error) {
      SinGreatLibrary.disposeResources(model.scene);
      throw error;
    }
  }

  function privateCameraColliders(boxes) {
    const o=state.root.position;
    return boxes.map(b=>({minx:b.minx+o.x,maxx:b.maxx+o.x,miny:b.miny+o.y,maxy:b.maxy+o.y,
      minz:b.minz+o.z,maxz:b.maxz+o.z,_wing:true}));
  }
  function syncPrivateCeiling(group,id,ready) {
    const fallback=group?.getObjectByName(id+'-ceiling');
    if(fallback)fallback.visible=!ready&&!state.cutaway;
    const room=id==='L3'?state.study:state.k5Dress?.architecture;
    room?.root.traverse(node=>{if(node.userData.ceiling)node.visible=ready&&!state.cutaway;});
  }
  function loadStudy(api) {
    const room=state.rooms.find(r=>r.id==='L3'), controller=new AbortController();
    state.studyLoad=controller;
    SinPrivateRooms.study(room,[state.studyDoor],timedRoomModels(api),controller.signal,deviceProfile.constrained).then(study=>{
      if(controller.signal.aborted||state.studyLoad!==controller){study.dispose();return;}
      state.study=study;
      const o=state.root.position;
      study.lightOrigin.set(o.x+room.bbox.cx,o.y,o.z+room.bbox.cz);
      zoneStreamer.markReleasable(study.root);
      api.add(study.root);
      api.done();
    },error=>{if(state.studyLoad===controller&&!controller.signal.aborted)api.fail(error);});
  }

  function loadSacredEntrance(api) {
    const room = state.rooms.find(r => r.id === 'T1');
    const controller = new AbortController();
    state.entranceLoad = controller;
    SinT1Entrance.build(room,state.entranceDoors,timedRoomModels(api),controller.signal,deviceProfile.constrained).then(entrance=>{
      if (controller.signal.aborted || state.entranceLoad !== controller) { entrance.dispose(); return; }
      state.sacredEntrance=entrance;
      zoneStreamer.markReleasable(entrance.root);
      api.add(entrance.root);
      api.done();
    },error=>{
      if (!controller.signal.aborted && state.entranceLoad===controller) api.fail(error);
    });
  }

  function loadPurification(api) {
    const room = state.rooms.find(r => r.id === 'T2');
    const controller = new AbortController();
    state.purificationLoad = controller;
    SinPurificationHall.build(room, state.purificationDoors, timedRoomModels(api), controller.signal, deviceProfile.constrained).then(hall => {
      if (controller.signal.aborted || state.purificationLoad !== controller) { hall.dispose(); return; }
      state.purificationHall = hall;
      zoneStreamer.markReleasable(hall.root);
      api.add(hall.root);
      api.done();
    }, error => {
      if (!controller.signal.aborted && state.purificationLoad === controller) api.fail(error);
    });
  }

  function loadLunarSanctuary(api) {
    const room = state.rooms.find(r => r.id === 'T4');
    const controller = new AbortController();
    state.lunarSanctuaryLoad = controller;
    SinLunarSanctuary.build(room, state.sanctuaryDoors, timedRoomModels(api), controller.signal, deviceProfile.constrained).then(sanctuary => {
      if (state.lunarSanctuaryLoad !== controller || controller.signal.aborted) { sanctuary.dispose(); return; }
      try {
        sanctuary.lunar=SinLunarDiscoveries.sanctuary(sanctuary.root,sanctuary.root.getObjectByName('T4-shrine'),
          room,sanctuary.front);
        sanctuary.warmup.dispose();
        sanctuary.warmup=SinGreatLibrary.geometryWarmup(sanctuary.root);
      } catch(error) {
        sanctuary.dispose();
        api.fail(error);
        return;
      }
      state.lunarSanctuary = sanctuary;
      zoneStreamer.markReleasable(sanctuary.root);
      api.add(sanctuary.root);
      api.done();
    }, error => {
      if (state.lunarSanctuaryLoad === controller && !controller.signal.aborted) api.fail(error);
    });
  }

  function loadRoyalOfferings(api) {
    const room = state.rooms.find(r => r.id === 'T5');
    const controller = new AbortController();
    state.royalOfferingsLoad = controller;
    SinRoyalOfferings.build(room, state.offeringPortal, timedRoomModels(api), controller.signal, deviceProfile.constrained).then(offerings => {
      if (state.royalOfferingsLoad !== controller || controller.signal.aborted) { offerings.dispose(); return; }
      state.royalOfferings = offerings;
      zoneStreamer.markReleasable(offerings.root);
      api.add(offerings.root);
      api.done();
    }, error => {
      if (state.royalOfferingsLoad === controller && !controller.signal.aborted) api.fail(error);
    });
  }

  function loadObservatory(api) {
    const controller = new AbortController();
    state.observatoryLoad = controller;
    const room = state.rooms.find(r => r.id === 'L4');
    SinObservatory.build(room, state.observatoryDoors, timedRoomModels(api), controller.signal, getLibraryFloorTexture).then(observatory => {
      if (state.observatoryLoad !== controller || controller.signal.aborted) {
        observatory.dispose(observatory.sharedStone === getLibraryFloorTexture());
        return;
      }
      state.observatory = observatory;
      zoneStreamer.markReleasable(observatory.root);
      api.add(observatory.root);
      api.done();
    }, error => {
      if (state.observatoryLoad === controller && !controller.signal.aborted) api.fail(error);
    });
  }

  function getLibraryFloorTexture() {
    const library = state.library;
    const floor = library && library.ready && library.root.getObjectByName('L1-floor');
    return floor && floor.material.map;
  }

  function loadSacredHall(api) {
    const controller = new AbortController();
    state.sacredHallLoad = controller;
    const room = state.rooms.find(r => r.id === 'T3');
    SinSacredColumns.build(room, state.sacredHallDoors, timedRoomModels(api), controller.signal).then(hall => {
      if (state.sacredHallLoad !== controller || controller.signal.aborted) { hall.dispose(); return; }
      state.sacredHall = hall;
      zoneStreamer.markReleasable(hall.root);
      api.add(hall.root);
      api.done();
    }, error => {
      if (state.sacredHallLoad === controller && !controller.signal.aborted) api.fail(error);
    });
  }

  function setSacredHallCeiling(host, ready) {
    if (!host) return;
    const shell = host.getObjectByName('T3-ceiling');
    if (shell) shell.visible = !ready && !state.cutaway;
    if (state.sacredHall && ready) state.sacredHall.root.children.forEach(n => {
      if (/^T3-(?:roof-|carved-roof|sunbeams)/.test(n.name) && !n.isLight) n.visible = !state.cutaway;
    });
  }

  function templeSight(view, route, pad) {
    return route.every(d=>(state.templeDoors?.allows(d?.id)??true)&&(state.libraryDoors?.allows(d?.id)??true)) &&
      SinWingVisibility.throughOpenings(view,route,pad);
  }
  function sacredHallSight(view) {
    if (!view || !state.sacredHallRoutes || !window.SinWingVisibility) return false;
    const region = regionAt(view.x, view.z);
    if (state.current === 'T3' || (region && region.id === 'T3')) return true;
    const route = region && state.sacredHallRoutes.get(region.id);
    return !!(route && templeSight(view, route, .05));
  }

  function cullFromSacredHall(view, visible) {
    const region = regionAt(view.x, view.z);
    if (!region || region.id !== 'T3') return;
    visible.clear();
    visible.add('T3');
    for (const line of state.sacredHallSightLines) {
      const openings = [];
      for (const [id, door] of line) {
        openings.push(door);
        if (!templeSight(view, openings, .06)) break;
        visible.add(id);
      }
    }
  }

  function entranceSight(view) {
    if (!view || !window.SinWingVisibility) return false;
    const id=regionAt(view.x,view.z)?.id;
    if (id==='T1' || state.current==='T1') return true;
    if (id==='ARCH_R3' && view.x>=state.sacredHallEntry.x) {
      const gate=state.sacredHallEntry;
      return view.dirX>-.15 && Math.abs(view.z-gate.z)<gate.width*.5+.74;
    }
    const route=id ? state.entranceRoutes.get(id) :
      view.x<state.sacredHallEntry.x && view.x>0 ? [state.sacredHallEntry] : null;
    return !!(route && templeSight(view,route,.07));
  }

  function syncEntranceShell(group,ready) {
    for (const screen of state.entranceScreens || []) screen.visible=!ready;
    const ceiling=group && group.getObjectByName('T1-ceiling');
    if (ceiling) ceiling.visible=!ready && !state.cutaway;
    if (state.sacredEntrance) for (const node of state.sacredEntrance.root.children) {
      if (node.userData.ceiling) node.visible=ready && !state.cutaway;
    }
  }

  function purificationSight(view) {
    if (!view || !window.SinWingVisibility) return false;
    const id = regionAt(view.x, view.z)?.id;
    if (id === 'T2' || state.current === 'T2') return true;
    const route = state.purificationRoutes.get(id);
    return !!(route && templeSight(view, route, .07));
  }

  function syncPurificationShell(group, ready) {
    for (const screen of state.purificationScreens || []) screen.visible = !ready;
    const ceiling = group && group.getObjectByName('T2-ceiling');
    if (ceiling) ceiling.visible = !ready && !state.cutaway;
    if (state.purificationHall) {
      for (const node of state.purificationHall.root.children) {
        if (node.userData.ceiling) node.visible = ready && !state.cutaway;
      }
    }
  }

  function sanctuarySight(view) {
    if (!view || !window.SinWingVisibility) return false;
    const id = regionAt(view.x, view.z)?.id;
    if (id === 'T4' || state.current === 'T4') return true;
    const openings = state.sanctuaryRoutes.get(id);
    return !!(openings && templeSight(view, openings, .07));
  }

  function sanctuaryExits(view, visible) {
    visible.clear();
    visible.add('T4');
    for (const line of state.sanctuarySightLines) {
      const openings = [];
      for (const [id, door] of line) {
        openings.push(door);
        if (!templeSight(view, openings, .07)) break;
        visible.add(id);
      }
    }
  }

  function syncSanctuaryShell(group, ready) {
    for (const screen of state.sanctuaryScreens || []) screen.visible = !ready;
    const shell = group && group.getObjectByName('T4-ceiling');
    if (shell) shell.visible = !ready && !state.cutaway;
    if (state.lunarSanctuary) {
      for (const node of state.lunarSanctuary.root.children) {
        if (node.userData.ceiling) node.visible = ready && !state.cutaway;
      }
    }
  }

  function offeringSight(view) {
    if (!view || !state.offeringPortal || !window.SinWingVisibility) return false;
    const region = regionAt(view.x, view.z);
    const id = region && region.id;
    if (id === 'T5') return true;
    const openings = id === 'TC5' ? [state.offeringPortal] :
      id === 'T3' ? [state.offeringPassage, state.offeringPortal] : null;
    return !!(openings && templeSight(view, openings, .07));
  }

  function cullFromOfferings(view, visible) {
    const region = regionAt(view.x, view.z);
    if (!region || region.id !== 'T5') return;
    visible.clear();
    visible.add('T5');
    if (templeSight(view, [state.offeringPortal], .07)) visible.add('TC5');
    if (templeSight(view, [state.offeringPortal, state.offeringPassage], .07)) visible.add('T3');
  }

  function syncOfferingShell(group) {
    const ready = zoneIsReady('T5');
    if (state.offeringScreen) state.offeringScreen.visible = !ready;
    const shell = group && group.getObjectByName('T5-ceiling');
    if (shell) shell.visible = !ready && !state.cutaway;
    if (state.royalOfferings) {
      for (const node of state.royalOfferings.root.children) {
        if (/^T5-(ceiling-|light-well-|warm-light-rays)/.test(node.name)) node.visible = !state.cutaway && ready;
      }
    }
  }

  function setObservatoryShell(host) {
    if (!host) return;
    const ready = zoneIsReady('L4');
    for (const name of ['L4-ceiling', 'L4-oculus-shaft', 'L4-oculus-dark-cap']) {
      const part = host.getObjectByName(name);
      if (part) part.visible = !ready && !state.cutaway;
    }
    if (state.observatory) {
      for (const node of state.observatory.root.children) {
        if (/^L4-(?:dome-|oculus-)/.test(node.name) && !node.isLight) node.visible = !state.cutaway;
      }
    }
  }

  function observatorySight(view) {
    if (!view || !state.observatoryDoors || !window.SinWingVisibility) return false;
    const region = regionAt(view.x, view.z);
    const id = region && region.id;
    if (state.current === 'L4' || id === 'L4') return true;
    const [west, east] = state.observatoryDoors;
    const line = [state.observatoryApproach, west];
    const openings = id === 'L1' ? line : id === 'LC4' ? [west] : id === 'MP2' ? [east] :
      id === 'ARCH_R1' ? [state.archiveHallExit, ...line] :
        !id ? [state.archivePortals[0], state.archiveHallExit, ...line] : null;
    return !!(openings && templeSight(view, openings, .05));
  }

  function cullFromObservatory(view, visible) {
    const region = regionAt(view.x, view.z);
    if (!region || region.id !== 'L4') return;
    const [west, east] = state.observatoryDoors;
    const seeWest = templeSight(view, [west], .08);
    const seeEast = templeSight(view, [east], .08);
    const seeLibrary = seeWest && templeSight(view, [west, state.observatoryApproach], .08);
    if (!seeLibrary && !seeEast) visible.clear();
    else {
      if (!seeLibrary) state.regions.forEach(r => { if (r.wing === 'Library') visible.delete(r.id); });
      if (!seeEast) { visible.delete('MP1'); visible.delete('MP2'); }
    }
    visible.add('L4');
    if (seeWest) visible.add('LC4');
    if (seeEast) visible.add('MP2');
    if (seeLibrary) visible.add('L1');
  }

  function archiveSight(view) {
    if (!view || !state.archivePortals || !window.SinWingVisibility) return false;
    const [hall, first, last] = state.archivePortals;
    const inside = regionAt(view.x, view.z);
    const id = inside && inside.id;
    if (id === 'L2') return true;
    const heroInside = state.current === 'L2';
    const openings = id === 'L1' ? [first, last] :
      (id === 'LC2' ? [last] : id === 'ARCH_R1' ? [state.archiveHallExit, first, last] :
        !id ? [hall, state.archiveHallExit, first, last] : null);
    return heroInside || !!(openings && templeSight(view, openings, 0.035));
  }

  function archiveExitReach(view) {
    if (!state.archivePortals || !view || !window.SinWingVisibility) return null;
    const room = regionAt(view.x, view.z);
    if (!room || room.id !== 'L2') return null;
    const [, first, last] = state.archivePortals;
    if (!templeSight(view, [last], 0.08)) return 0;
    return templeSight(view, [last, first], 0.08) ? 2 : 1;
  }

  function makeLibrarySightRoutes() {
    const [, archiveEntry, archiveExit] = state.archivePortals;
    const scribeEntry = state.doors.find(d => d.id === 'L1-LC3');
    const scribeExit = state.doors.find(d => d.id === 'LC3-L3');
    const links = [
      ['L1', 'ARCH_R1', state.archiveHallExit],
      ['L1', 'LC2', archiveEntry], ['LC2', 'L2', archiveExit],
      ['L1', 'LC3', scribeEntry], ['LC3', 'L3', scribeExit],
      ['L1', 'LC4', state.observatoryApproach], ['LC4', 'L4', state.observatoryDoors[0]]
    ];
    const routes = new Map();
    for (const origin of ['L1', 'LC2', 'L2', 'LC3', 'L3']) {
      const paths = new Map([[origin, []]]);
      const queue = [origin];
      for (const from of queue) {
        for (const [a, b, opening] of links) {
          const to = a === from ? b : b === from ? a : null;
          if (!to || !opening || paths.has(to)) continue;
          paths.set(to, [...paths.get(from), opening]);
          queue.push(to);
        }
      }
      routes.set(origin, paths);
    }
    return routes;
  }

  function libraryPortalView(view) {
    if (!view || !state.librarySightRoutes || !window.SinWingVisibility) return null;
    const region = regionAt(view.x, view.z);
    const paths = region && state.librarySightRoutes.get(region.id);
    if (!paths) return null;
    const visible = new Set();
    for (const [id, openings] of paths) {
      if (!openings.length || templeSight(view, openings, .06)) visible.add(id);
    }
    return visible;
  }

  function syncArchiveScreen() {
    const ready = zoneIsReady('L2');
    if (state.archiveScreen) state.archiveScreen.visible = !ready;
    return ready;
  }

  function beforePresent(scene, camera) {
    if (!state.root || !state.built || !state.ctx || scene !== state.ctx.scene || !zoneStreamer) return;
    const view = cameraView(state.root.position.x, state.root.position.z, camera);
    const libraryView = libraryPortalView(view);
    const archiveReady = syncArchiveScreen();
    const sight = libraryView ? libraryView.has('L2') : archiveSight(view);
    const reach = archiveExitReach(view);
    const group = state.regionGroups.get('L2');
    if (libraryView) {
      state.regionGroups.forEach((node, id) => {
        node.visible = libraryView.has(id) && zoneIsReady(id);
      });
    }
    if (group) group.visible = sight && archiveReady;
    if(state.studyScreen)state.studyScreen.visible=!zoneIsReady('L3');
    const royal=state.regionGroups.get('K5');
    if(royal && !zoneIsReady('K5'))royal.visible=false;
    for(const screen of state.kingScreens||[])screen.visible=!zoneIsReady('K5');

    const corridor = state.regionGroups.get('LC2');
    if (corridor && sight && (state.current !== 'L2' || reach > 0)) corridor.visible = true;
    if (reach === 2) {
      const library = state.regionGroups.get('L1');
      if (library) library.visible = zoneIsReady('L1');
    }
    state.archiveDemand = sight && !archiveReady;
    if (window.SinT1Entrance) {
      const seeEntrance=entranceSight(view)&&zoneIsReady('T1');
      state.regionGroups.get('T1').visible=seeEntrance;
      const viewer=seeEntrance && regionAt(view.x,view.z)?.id;
      if (viewer==='T1' || viewer==='ARCH_R3') {
        for (const door of state.entranceDoors) {
          if (door.from!=='T1') continue;
          state.regionGroups.get(door.to).visible=templeSight(view,[door],.07);
        }
      }
    }
    if (window.SinPurificationHall) {
      const group = state.regionGroups.get('T2');
      group.visible = purificationSight(view) && zoneIsReady('T2');
      if (group.visible && state.purificationHall) state.purificationHall.refreshWater(state.ctx.renderer, scene, camera);
    }
    const observatory = state.regionGroups.get('L4');
    if (observatory) observatory.visible = observatorySight(view) && zoneIsReady('L4');
    const sacredHall = state.regionGroups.get('T3');
    if (sacredHall) {
      sacredHall.visible = sacredHallSight(view) && zoneIsReady('T3');
      if (sacredHall.visible && state.sacredHall && zoneIsReady('T3')) {
        state.sacredHall.refreshWater(state.ctx.renderer, scene, camera);
      }
    }
    if (window.SinLunarSanctuary) {
      const group = state.regionGroups.get('T4');
      const seeRoom = sanctuarySight(view);
      group.visible = seeRoom && zoneIsReady('T4');
      if (seeRoom && regionAt(view.x, view.z)?.id === 'T4') {
        sanctuaryExits(view, state.sanctuaryFrameSet);
        for (const id of ['TC34', 'MP1']) state.regionGroups.get(id).visible = state.sanctuaryFrameSet.has(id);
      }
    }
    const offerings = state.regionGroups.get('T5');
    if (offerings && window.SinRoyalOfferings) {
      const seeRoom = offeringSight(view);
      offerings.visible = seeRoom && zoneIsReady('T5');
      if (seeRoom && regionAt(view.x, view.z)?.id === 'T5') {
        const approach = state.regionGroups.get('TC5');
        if (approach) approach.visible = templeSight(view, [state.offeringPortal], .07);
      }
    }
    if(view){
      const viewer=regionAt(view.x,view.z)?.id||state.current||'Palace';
      state.templeDoors?.sight(viewer,view,SinWingVisibility.throughOpenings);
      state.libraryDoors?.sight(viewer,view,SinWingVisibility.throughOpenings);
    }
    // The per-room sight tests above are exact for one frame. The room the
    // hero / camera stands in, and any prepared room that was in view a
    // moment ago (hysteresis), stay drawn so a camera swing at a doorway
    // never drops a wall, floor or the room beyond and pops it back.
    if (roomManaged) {
      for (const id of roomManaged.shown) {
        const g = state.regionGroups.get(id);
        if (g && !g.visible && zoneIsReady(id)) g.visible = true;
      }
    }
  }

  const WING_ZONES = [
    ...(window.SinT1Entrance ? [{ id:'T1', prefetchHops:1, priority:-3, requireComplete:true, keepShell:true,
      serialPreparation:true, estProcessMB:deviceProfile.constrained?40:98,
      estGpuMB:deviceProfile.constrained?25:75, estCpuMB:deviceProfile.constrained?18:30,
      load:loadSacredEntrance,
      prepareGeometry: (api,renderer)=>state.sacredEntrance.warmup.step(renderer),
      onReady(api) {
        const entrance=state.sacredEntrance, o=state.root.position;
        entrance.cameraColliders=[...entrance.collision,...entrance.stairBoxes].map(b=>({
          minx:b.minx+o.x,maxx:b.maxx+o.x,miny:b.miny+o.y,maxy:b.maxy+o.y,minz:b.minz+o.z,maxz:b.maxz+o.z,_wing:true
        }));
        const first=state.colliders.length;
        state.colliders.push(...entrance.collision);
        indexSpatialFrom(first);
        syncEntranceShell(api.group,true);
        updatePassageGates();
        triCache.delete('T1');
      },
      onFailure(error) {
        registerLibraryFailure('T1');
        console.warn('[T1] Sacred Entrance preparation failed',error);
      },
      unload(api) {
        if (state.entranceLoad) state.entranceLoad.abort();
        if (state.sacredEntrance) state.sacredEntrance.warmup.dispose();
        state.entranceLoad=state.sacredEntrance=null;
        state.colliders=state.colliders.filter(b=>!b._entrance);
        rebuildSpatial();
        syncEntranceShell(api.group,false);
        triCache.delete('T1');
      },
      ownsObject:node=>node.name==='T1-Sacred-Entrance' }] : []),
    ...(window.SinPurificationHall ? [{ id: 'T2', prefetchHops: 2, priority: -2, requireComplete: true,
      keepShell: true, serialPreparation: true,
      estProcessMB: deviceProfile.constrained ? 43 : 105,
      estGpuMB: deviceProfile.constrained ? 25 : 72,
      estCpuMB: deviceProfile.constrained ? 18 : 39,
      load: loadPurification,
      prepareGeometry: (api, renderer) => state.purificationHall.warmup.step(renderer),
      onReady: function (api) {
        const hall = state.purificationHall, origin = state.root.position;
        hall.cameraColliders = [...hall.collision,...hall.stairBoxes].map(b => ({
          minx:b.minx+origin.x,maxx:b.maxx+origin.x,miny:b.miny+origin.y,maxy:b.maxy+origin.y,
          minz:b.minz+origin.z,maxz:b.maxz+origin.z,_wing:true
        }));
        const first = state.colliders.length;
        state.colliders.push(...hall.collision);
        indexSpatialFrom(first);
        syncPurificationShell(api.group, true);
        updatePassageGates();
        const visible = api.group.visible;
        try {
          api.group.visible = true;
          hall.refreshWater(state.ctx.renderer, state.ctx.scene, hall.camera, true);
        } finally {
          api.group.visible = visible;
        }
        triCache.delete('T2');
      },
      onFailure: function (error) {
        registerLibraryFailure('T2');
        console.warn('[T2] Purification Hall preparation failed', error);
      },
      unload: function (api) {
        if (state.purificationLoad) state.purificationLoad.abort();
        if (state.purificationHall) {
          state.purificationHall.disposeReflection();
          state.purificationHall.warmup.dispose();
        }
        state.purificationHall = state.purificationLoad = null;
        state.colliders = state.colliders.filter(b => !b._purification);
        rebuildSpatial();
        syncPurificationShell(api.group, false);
        triCache.delete('T2');
      },
      ownsObject: node => node.name === 'T2-Purification-Hall' }] : []),
    { id: 'T3', prefetchHops: 2, priority: -1, requireComplete: true, keepShell: true, serialPreparation: true,
      estProcessMB: deviceProfile.constrained ? 64 : 138,
      estGpuMB: deviceProfile.constrained ? 41 : 88,
      estCpuMB: deviceProfile.constrained ? 23 : 50,
      load: loadSacredHall,
      prepareGeometry: (api, renderer) => state.sacredHall.warmup.step(renderer),
      onReady: function (api) {
        const origin = state.root.position;
        state.sacredHall.cameraColliders = state.sacredHall.boxes.map(b => ({
          minx: b.minx + origin.x, maxx: b.maxx + origin.x,
          miny: b.miny + origin.y, maxy: b.maxy + origin.y,
          minz: b.minz + origin.z, maxz: b.maxz + origin.z, _wing: true
        }));
        state.colliders.push(...state.sacredHall.boxes);
        rebuildSpatial();
        setSacredHallCeiling(api.group, true);
        updatePassageGates();
        const visible = api.group.visible;
        try {
          api.group.visible = true;
          const hall = state.sacredHall;
          hall.refreshWater(state.ctx.renderer, state.ctx.scene, hall.camera, true);
        } finally {
          api.group.visible = visible;
        }
        triCache.delete('T3');
      },
      onFailure: function (error) {
        registerLibraryFailure('T3');
        console.warn('[T3] Sacred Columns Hall preparation failed', error);
      },
      unload: function (api) {
        if (state.sacredHallLoad) state.sacredHallLoad.abort();
        if (state.sacredHall) {
          state.sacredHall.disposeWater();
          state.sacredHall.warmup.dispose();
        }
        state.sacredHall = state.sacredHallLoad = null;
        state.colliders = state.colliders.filter(b => !b._sacredHall);
        setSacredHallCeiling(api.group, false);
        triCache.delete('T3');
      },
      ownsObject: node => node.name === 'T3-Sacred-Columns-Hall' },
    ...(window.SinLunarSanctuary ? [{ id: 'T4', prefetchHops: 3, priority: -1, requireComplete: true,
      keepShell: true, serialPreparation: true,
      estProcessMB: deviceProfile.constrained ? 45 : 115,
      estGpuMB: deviceProfile.constrained ? 25 : 82,
      estCpuMB: deviceProfile.constrained ? 20 : 42,
      load: loadLunarSanctuary,
      prepareGeometry: (api, renderer) => state.lunarSanctuary.warmup.step(renderer),
      onReady: function (api) {
        const sanctuary = state.lunarSanctuary, origin = state.root.position;
        sanctuary.cameraColliders = [...sanctuary.boxes, ...sanctuary.stairBoxes].map(b => ({
          minx:b.minx+origin.x, maxx:b.maxx+origin.x, miny:b.miny+origin.y,
          maxy:b.maxy+origin.y, minz:b.minz+origin.z, maxz:b.maxz+origin.z, _wing:true
        }));
        const first = state.colliders.length;
        state.colliders.push(...sanctuary.boxes);
        indexSpatialFrom(first);
        syncSanctuaryShell(api.group, true);
        updatePassageGates();
        triCache.delete('T4');
      },
      onFailure: function (error) {
        registerLibraryFailure('T4');
        console.warn('[T4] Lunar sanctuary preparation failed', error);
      },
      unload: function (api) {
        if (state.lunarSanctuaryLoad) state.lunarSanctuaryLoad.abort();
        if (state.lunarSanctuary) state.lunarSanctuary.warmup.dispose();
        state.lunarSanctuary = state.lunarSanctuaryLoad = null;
        state.colliders = state.colliders.filter(b => !b._lunarSanctuary);
        rebuildSpatial();
        syncSanctuaryShell(api.group, false);
        triCache.delete('T4');
      },
      ownsObject: node => node.name === 'T4-Lunar-Sanctuary' }] : []),
    ...(window.SinRoyalOfferings ? [{ id: 'T5', prefetchHops: 3, priority: 0, requireComplete: true,
      keepShell: true, serialPreparation: true,
      estProcessMB: deviceProfile.constrained ? 54 : 120,
      estGpuMB: deviceProfile.constrained ? 36 : 81,
      estCpuMB: deviceProfile.constrained ? 24 : 47,
      load: loadRoyalOfferings,
      prepareGeometry: (api, renderer) => state.royalOfferings.warmup.step(renderer),
      onReady: function (api) {
        const offerings = state.royalOfferings, origin = state.root.position;
        offerings.cameraColliders = [...offerings.boxes, ...offerings.stairBoxes].map(b => ({
          minx: b.minx + origin.x, maxx: b.maxx + origin.x,
          miny: b.miny + origin.y, maxy: b.maxy + origin.y,
          minz: b.minz + origin.z, maxz: b.maxz + origin.z, _wing: true
        }));
        const first = state.colliders.length;
        state.colliders.push(...offerings.boxes);
        indexSpatialFrom(first);
        syncOfferingShell(api.group);
        updatePassageGates();
        triCache.delete('T5');
      },
      onFailure: function (error) {
        registerLibraryFailure('T5');
        console.warn('[T5] Royal offerings preparation failed', error);
      },
      unload: function (api) {
        if (state.royalOfferingsLoad) state.royalOfferingsLoad.abort();
        if (state.royalOfferings) state.royalOfferings.warmup.dispose();
        state.royalOfferings = state.royalOfferingsLoad = null;
        state.colliders = state.colliders.filter(b => !b._royalOfferings);
        if (state.offeringScreen) state.offeringScreen.visible = true;
        const shell = api.group && api.group.getObjectByName('T5-ceiling');
        if (shell) shell.visible = !state.cutaway;
        triCache.delete('T5');
      },
      ownsObject: node => node.name === 'T5-Royal-Offerings' }] : []),
    { id: 'L4', prefetchHops: 1, priority: -1, requireComplete: true, keepShell: true, serialPreparation: true,
      estProcessMB: deviceProfile.constrained ? 53 : 110,
      estGpuMB: deviceProfile.constrained ? 37 : 76,
      estCpuMB: deviceProfile.constrained ? 16 : 34,
      load: loadObservatory,
      prepareGeometry: (api, renderer) => state.observatory.warmup.step(renderer),
      onReady: function (api) {
        const origin = state.root.position;
        state.observatory.cameraColliders = state.observatory.boxes.map(b => ({
          minx: b.minx + origin.x, maxx: b.maxx + origin.x,
          miny: b.miny + origin.y, maxy: b.maxy + origin.y,
          minz: b.minz + origin.z, maxz: b.maxz + origin.z, _wing: true
        }));
        setObservatoryShell(api.group);
        updatePassageGates();
        triCache.delete('L4');
      },
      onFailure: function (error) {
        registerLibraryFailure('L4');
        console.warn('[L4] Observatory preparation failed', error);
      },
      unload: function (api) {
        if (state.observatoryLoad) state.observatoryLoad.abort();
        if (state.observatory) state.observatory.warmup.dispose();
        state.observatory = state.observatoryLoad = null;
        // The streamer's state changes to cold after this hook.
        for (const name of ['L4-ceiling', 'L4-oculus-shaft', 'L4-oculus-dark-cap']) {
          const part = api.group && api.group.getObjectByName(name);
          if (part) part.visible = !state.cutaway;
        }
        triCache.delete('L4');
      },
      ownsObject: node => node.name === 'L4-Babylonian-Observatory' },
    ...(window.SinPrivateRooms?[{id:'L3',prefetchHops:2,priority:-1.4,requireComplete:true,keepShell:true,serialPreparation:true,
      estProcessMB:deviceProfile.constrained?34:65,estGpuMB:deviceProfile.constrained?24:43,estCpuMB:deviceProfile.constrained?15:26,
      load:loadStudy,prepareGeometry:(api,r)=>state.study.warmup.step(r),
      onReady(api){
        state.study.cameraColliders=privateCameraColliders(state.study.boxes);
        state.colliders.push(...state.study.boxes);rebuildSpatial();
        syncPrivateCeiling(api.group,'L3',true);updatePassageGates();triCache.delete('L3');
      },
      onFailure(error){registerLibraryFailure('L3');console.warn('[L3] Study preparation failed',error);},
      unload(api){
        state.studyLoad?.abort();state.study?.warmup.dispose();state.studyLoad=state.study=null;
        state.colliders=state.colliders.filter(b=>!b._studyProp);
        syncPrivateCeiling(api.group,'L3',false);triCache.delete('L3');
      },ownsObject:node=>node.name==='L3-Scribes-Study'}]:[]),
    { id: 'L2', prefetchHops: 2, priority: -1, requireComplete: true, keepShell: true, serialPreparation: true,
      estimateIncoming: archiveProfile,
      load: loadArchive,
      prepareGeometry: (api, renderer) => state.archive.warmup.step(renderer),
      onFailure: function (error) {
        if (state.archiveLoad) state.archiveLoad.abort();
        if (state.archive) state.archive.warmup.dispose();
        registerLibraryFailure('L2');
        console.warn('[L2] Archive preparation failed', error);
      },
      onReady: function () {
        const origin = state.root.position;
        state.archive.cameraColliders = state.archive.colliders.map(box => ({
          minx: box.minx + origin.x, maxx: box.maxx + origin.x,
          miny: box.miny + origin.y, maxy: box.maxy + origin.y,
          minz: box.minz + origin.z, maxz: box.maxz + origin.z, _wing: true
        }));
        const first = state.colliders.length;
        state.colliders.push(...state.archive.colliders);
        indexSpatialFrom(first);
        triCache.delete('L2');
        const ceiling = state.regionGroups.get('L2').getObjectByName('L2-ceiling');
        if (ceiling) ceiling.visible = false;
        syncArchiveScreen();
        updatePassageGates();
      },
      unload: function (api) {
        if (state.archiveLoad) state.archiveLoad.abort();
        if (state.archive) state.archive.warmup.dispose();
        state.archive = state.archiveLoad = null;
        state.colliders = state.colliders.filter(box => !box._archive);
        triCache.delete('L2');
        const ceiling = api.group && api.group.getObjectByName('L2-ceiling');
        if (ceiling) ceiling.visible = !state.cutaway;
      },
      ownsObject: node => node.name === 'L2-Royal-Archive' },
    { id: 'L1', prefetchHops: 3, priority: 0, requireComplete: true, keepShell: true, serialPreparation: true,
      estProcessMB: deviceProfile.constrained ? 95 : 155,
      estGpuMB: deviceProfile.constrained ? 65 : 104,
      estCpuMB: deviceProfile.constrained ? 30 : 51,
      load: loadLibrary,
      prepareGeometry: (api, renderer) => state.libraryWarmup.step(renderer),
      onFailure: function (error) {
        state.libraryLoad = null;
        if (state.libraryWarmup) state.libraryWarmup.dispose();
        registerLibraryFailure('L1');
        console.warn('[L1] Library preparation failed', error);
      },
      onReady: function (api) {
        if (!state.library) return;
        state.library.ready = true;
        state.library.sun.shadow.needsUpdate = true;
        const origin = state.root.position;
        state.library.cameraColliders = state.library.colliders.map(b => ({
          minx: b.minx + origin.x, maxx: b.maxx + origin.x,
          miny: b.miny + origin.y, maxy: b.maxy + origin.y,
          minz: b.minz + origin.z, maxz: b.maxz + origin.z, _wing: true
        }));
        state.colliders.push(...state.library.colliders);
        rebuildSpatial();
        triCache.clear();
        setLibraryCeiling(api.group);
      },
      unload: function (api) {
        if (state.libraryWarmup) state.libraryWarmup.dispose();
        state.libraryWarmup = null;
        if (state.library) {
          state.library.restoreGroundPose();
          state.library.sun.shadow.dispose();
          state.library.sun.map.dispose();
        }
        state.library = null;
        state.libraryLoad = null;
        state.colliders = state.colliders.filter(c => !c._library);
        triCache.clear();
        setLibraryCeiling(api.group);
      },
      ownsObject: function (node) { return node.name === 'L1-Grand-Library'; } },
    { id: 'K2', prefetchHops: deviceProfile.prefetchHops, priority: 0, requireComplete:true, serialPreparation:true,
      prepare:zonePrepare, onFailure:()=>registerLibraryFailure('K2'),
      load: function () { dressK2(); },
      isComplete: function () { return roomCompleteness('K2').complete; },
      unload: function (api) {
        state.colliders = state.colliders.filter(function (c) { return !c._k2Prop; });
        state.k2Lights = null; state.k2LightBase = null; state.k2Dress = null;
        if (api.group) api.group.userData.k2Dressed = false;
      },
      ownsObject: streamedName('K2') },
    { id: 'K3', prefetchHops: deviceProfile.prefetchHops, priority: 1, requireComplete:true, serialPreparation:true,
      prepare:zonePrepare, onFailure:()=>registerLibraryFailure('K3'),
      load: dressK3,
      isComplete: function () { return roomCompleteness('K3').complete; },
      unload: function (api) {
        state.k3Dress?.lunarLoad?.abort();
        state.k3Dress=null;
        state.colliders=state.colliders.filter(box=>!box._k3Prop);
        state.k3Lights=null;state.k3LightBase=null;
        if(api.group)api.group.userData.k3Dressed=false;
      },
      ownsObject: streamedName('K3') },
    { id: 'K4', prefetchHops: deviceProfile.prefetchHops, priority: 2, requireComplete:true, serialPreparation:true,
      prepare:zonePrepare, onFailure:()=>registerLibraryFailure('K4'),
      load: function () { dressK4(); loadK4Assets(); },
      isComplete: function () { return roomCompleteness('K4').complete; },
      unload: function (api) { state.k4Dress = null; state.colliders = state.colliders.filter(function (c) { return !c._k4Prop; }); if (api.group) api.group.userData.k4Dressed = false; },
      ownsObject: streamedName('K4') },
    ...(window.SinPrivateRooms?[{id:'K5',prefetchHops:deviceProfile.prefetchHops,priority:3,
      requireComplete:true,keepShell:true,serialPreparation:true,
      estProcessMB:48,estGpuMB:34,estCpuMB:24,
      load:dressK5,prepareGeometry:(api,renderer)=>state.k5Dress.warmup.step(renderer),
      onReady(api){
        state.k5Dress.cameraColliders=privateCameraColliders(state.colliders.filter(b=>b._k5Prop));
        syncPrivateCeiling(api.group,'K5',true);
        rebuildSpatial();updatePassageGates();triCache.delete('K5');
      },
      onFailure(error){registerLibraryFailure('K5');console.warn('[K5] Apartments preparation failed',error);},
      unload(api){
        state.k5Dress?.controller.abort();state.k5Dress?.warmup?.dispose();
        state.k5Dress=null;state.colliders=state.colliders.filter(b=>!b._k5Prop);
        if(api.group)api.group.userData.k5Dressed=false;
        syncPrivateCeiling(api.group,'K5',false);triCache.delete('K5');
      },ownsObject:node=>node.name==='K5-Apartment-Dress'}]:[])
  ];
  function zonePrepare(api) {
    // Material fixes that change the shader program must happen BEFORE the
    // zone is compiled, otherwise the reveal frame compiles again.
    if (api.group) prepareRoomMaterials(api.group);
  }
  function registerZone(spec) {
    if (retired) return;
    if (!zoneStreamer) return null;
    const userReady = spec.onReady, userPrepare = spec.prepare;
    return zoneStreamer.register(Object.assign({}, spec, {
      prepare: function (api) { if (!spec.requireComplete) zonePrepare(api); if (userPrepare) userPrepare(api); },
      onReady: function (api) {
        dressedRooms.add(spec.id);
        if (api.group && zoneStreamer && !spec.requireComplete) zoneStreamer.enqueueWarm(api.group);
        if (userReady) userReady(api);
      },
      unload: function (api) {
        if (spec.unload) spec.unload(api);
        dressedRooms.delete(spec.id); zoneDone.delete(spec.id);
        if (api.group) api.group.userData.dressReady = false;
        if (state.root) rebuildSpatial();
      }
    }));
  }
  WING_ZONES.forEach(registerZone);
  // Legacy entry point used by the dress builders: "everything I requested
  // has arrived". With the streamer this only marks the zone complete; the
  // reveal happens after upload + compile.
  function markDressReady(id) {
    if (zoneStreamer && zoneStreamer.status(id) !== 'unregistered') { zoneDone.add(id); return; }
    dressedRooms.add(id);
    const g = state.regionGroups.get(id);
    if (g) {
      zoneStreamer ? zoneStreamer.reveal(g) : g.traverse(function (o) { if (o.userData && o.userData.hideUntilDressReady) { o.visible = true; delete o.userData.hideUntilDressReady; } });
      g.userData.dressReady = true;
      if (zoneStreamer) zoneStreamer.enqueueWarm(g);
    }
  }
  function hideUntilReady(obj) {
    if (!obj) return;
    obj.traverse(function (o) {
      if (!o.isMesh && !o.isInstancedMesh && !o.isPoints && !o.isSprite) return;
      o.visible = false;
      o.userData.hideUntilDressReady = true;
      o.userData.streamDress = true;
    });
    obj.userData.streamDress = true;
    // Callers add the object to its room group right after this call. If that
    // room was already revealed (e.g. a slow model arriving after the
    // timeout), upload its textures and show it instead of hiding it forever.
    Promise.resolve().then(function () {
      let ready = false;
      for (let n = obj.parent; n; n = n.parent) { if (n.userData && n.userData.dressReady) { ready = true; break; } }
      if (!ready) return;
      if (zoneStreamer) zoneStreamer.queueTextures(obj);
      obj.traverse(function (o) {
        if (o.userData && o.userData.hideUntilDressReady) { o.visible = true; delete o.userData.hideUntilDressReady; }
      });
    });
  }
  let zoneDistKey = '', zoneDist = null;
  const streamedRooms = new Set(WING_ZONES.map(zone => zone.id));
  const libraryZones = new Set(['L1','L2','L4',...(window.SinPrivateRooms?['L3']:[])]);
  function portalIsOpen(portal) {
    if (state.templeDoors && !state.templeDoors.allows(portal.id)) return false;
    if (state.libraryDoors && !state.libraryDoors.allows(portal.id)) return false;
    if (portal._roomDoor && !['Open','Opening','Closing'].includes(portal.state)) return false;
    if (portal._roomDoor && (portal.progress||0)<.025) return false;
    // A real gate or an existing screen protects any unfinished destination.
    return [portal.from,portal.to].every(id=>!streamedRooms.has(id)||zoneIsReady(id));
  }
  function inHallBounds(x, z) {
    return !!state.hall && Math.abs(x) <= state.hall.width * 0.5 + 0.3 && z >= -0.3 && z <= state.hall.length + 0.4;
  }
  function visibleRoutes(view) {
    const region=regionAt(view.x,view.z);
    // A camera pushed into a wall's thickness (between two room polygons)
    // belongs to no region. Falling back to the throne hall then culled
    // the room the hero stands in for that frame; use the hero's room.
    let viewer=region?.id||(inHallBounds(view.x,view.z)||!state.current?'Palace':state.current);
    if(region?.kind==='threshold'){
      const door=state.hallPortalsByRoom.get(region.linkRoom);
      const beyond=door&&Math.sign(door.x)*(view.x-door.x)>=-.035;
      viewer=beyond?region.linkRoom:'Palace';
    }
    return state.routes.connectedView(viewer,view,SinWingVisibility.throughOpenings,portalIsOpen);
  }
  // Physical state of an opening, ignoring whether the room behind it is
  // prepared. This is what the player WOULD see; the room manager uses it
  // to prepare rooms before the camera can look into them.
  function portalPhysicallyOpen(portal) {
    if (state.templeDoors && !state.templeDoors.allows(portal.id)) return false;
    if (state.libraryDoors && !state.libraryDoors.allows(portal.id)) return false;
    if (portal._roomDoor && (!['Open','Opening','Closing'].includes(portal.state) || (portal.progress||0)<.025)) return false;
    return true;
  }
  function viewerRegion(view) {
    const region=regionAt(view.x,view.z);
    let viewer=region?.id||null;
    if(region?.kind==='threshold'){
      const door=state.hallPortalsByRoom.get(region.linkRoom);
      const beyond=door&&Math.sign(door.x)*(view.x-door.x)>=-.035;
      viewer=beyond?region.linkRoom:'Palace';
    }
    return viewer;
  }
  // ---------------------------------------------------------------------------
  // PalaceRoomManager (palace-room-manager.js): sight demand, graph/heading
  // prefetch, cooldown residency and visibility hysteresis for all 14 rooms.
  // zone-streamer.js stays the single owner of memory and GPU residency.
  let roomManager = null, roomManaged = null, roomOverlay = null, roomSightAt = 0, roomSight = null;
  const roomFrames = window.SinPalaceRoomManager ? SinPalaceRoomManager.frameStats(600) : null;
  const roomDebugWanted = (() => { try { return /[?&]roomdebug=1/.test(location.search); } catch (_) { return false; } })();
  function manageRooms(heroId, origin, view, drawn) {
    if (!window.SinPalaceRoomManager || !zoneStreamer || !state.routes) return null;
    // Load radius = run speed x (measured preparation + pad) + doorway slack,
    // capped per device; release radius = load radius + hysteresis.
    if (!roomManager) roomManager = SinPalaceRoomManager.create({ streamed: streamedRooms, constrained: !!deviceProfile.constrained,
      maxLoadM: deviceProfile.constrained ? 75 : 95 });
    const now = performance.now();
    const camId = view ? viewerRegion(view) : null;
    // Geometric sight through physically open portals (8 hops), refreshed
    // at ~15 Hz: rooms enter it long before they are reachable.
    // Diagnostics only (?roomdebug=1): what the camera could see never drives loading.
    if (roomDebugWanted && view && (!roomSight || now - roomSightAt > 66)) {
      roomSightAt = now;
      try { roomSight = state.routes.connectedView(camId || heroId, view, SinWingVisibility.throughOpenings, portalPhysicallyOpen); }
      catch (_) { roomSight = null; }
    }
    // Walking distance from the HERO (not the camera) to every room's doorway.
    const move = state.archiveMotion;
    let distances = null;
    if (move && state.routes.pathDistances) {
      const key = origin + ':' + Math.round(move.x) + ':' + Math.round(move.z);
      if (state._roomDistKey !== key) { state._roomDistKey = key; state._roomDist = state.routes.pathDistances(origin, move.x, move.z, 200); }
      distances = state._roomDist;
    }
    const level = (zoneStreamer.memoryState && zoneStreamer.memoryState().level) || 'normal';
    roomManaged = roomManager.update({
      now, heroRegion: heroId, camRegion: camId, origin, motion: move, drawn,
      sight: roomSight || [], distances, pvs: ensurePvs(),
      status: id => zoneStreamer.status(id), leadSec: id => zoneStreamer.leadTime(id), memoryLevel: level
    });
    return roomManaged;
  }
  // Architecture that the portal flood cannot reach but the camera sees:
  //  - the corridor region behind a CLOSED royal door owns the door's wall
  //    reveal; culling it left a gap around the leaf (K3/K4 audit);
  //  - a hall threshold (ARCH_*) is not a graph node, so across the throne
  //    hall the far arch was only drawn while the hero stood in it.
  // Only non-streamed shells are added here: a streamed room still appears
  // through its atomic reveal and never half-built.
  function completeArchitecture(view, visible) {
    if (!state.routes || !state.routes.closedFrames || !window.SinWingVisibility) return;
    const through = SinWingVisibility.throughOpenings;
    const viewer = viewerRegion(view) || state.current;
    for (const from of [viewer, state.current]) {
      if (!from) continue;
      state.routes.closedFrames(from, view, through, portalPhysicallyOpen).forEach(id => {
        if (!streamedRooms.has(id) && state.regionGroups.has(id)) visible.add(id);
      });
    }
    // The throne hall has no region group, so test the sight line through
    // the viewer's own hall arch directly (hall or a hall-linked room).
    const own = viewer && viewer !== 'Palace' && state.hallPortalsByRoom && state.hallPortalsByRoom.get(viewer);
    if (viewer === 'Palace' || own) {
      for (const r of state.connectors) {
        if (r.kind !== 'threshold' || visible.has(r.id)) continue;
        const arch = state.hallPortalsByRoom.get(r.linkRoom);
        if (!arch) continue;
        if (arch === own) { visible.add(r.id); continue; }
        if (through(view, viewer === 'Palace' ? [arch] : [own, arch], .055)) visible.add(r.id);
      }
    }
  }
  function drawRoomOverlay(tickMs) {
    if (!roomDebugWanted || !roomManager || typeof document === 'undefined') return;
    if (!roomOverlay) roomOverlay = SinPalaceRoomManager.overlay(document);
    if (!roomOverlay) return;
    const r = state.ctx && state.ctx.renderer, info = r && r.info;
    const mem = typeof performance !== 'undefined' && performance.memory;
    roomOverlay.draw(performance.now(), {
      current: state.current, rooms: roomManager.report(), zones: zoneStreamer.report(),
      frame: roomFrames.summary(), cpuMs: tickMs, gpuMs: window.__sinGpuMs,
      calls: info && info.render.calls, tris: info && info.render.triangles,
      textures: info && info.memory.textures, geometries: info && info.memory.geometries,
      heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null
    });
  }
  function registerLibraryFailure(id) {
    const failures = state.libraryFailures || (state.libraryFailures = new Map());
    const prior = failures.get(id);
    failures.set(id, { count: prior ? prior.count + 1 : 1, retryAt: performance.now() + 12000 });
  }
  function attachStreamer() {
    const { renderer, scene, camera } = state.ctx;
    zoneStreamer.attach({ renderer, scene, camera, groupOf: id => state.regionGroups.get(id) || null });
  }
  function sampleEntryMemory() {
    if (window.SinProcessMemory && SinProcessMemory.estimate) {
      const { renderer, scene } = state.ctx;
      SinProcessMemory.estimate({ renderer, scene });
    }
  }
  // Potentially visible set of the palace (static): computed once, behind the
  // entry blackout. Doors are gates (they open only onto a ready room), so
  // only doorless arches and passages carry sight lines.
  function ensurePvs() {
    if (state.pvs || !state.routes || !state.routes.potentiallyVisible || !window.SinWingVisibility) return state.pvs || null;
    const t0 = performance.now();
    const gated = portal => !(portal._roomDoor || state.templeDoorIds?.has(portal.id) || state.libraryDoorIds?.has(portal.id));
    state.pvs = state.routes.potentiallyVisible(SinWingVisibility.throughOpenings, gated,
      deviceProfile.constrained ? { step: 4, yaws: 12 } : { step: 3, yaws: 16 });
    try { console.info('[palace load] pvs', Math.round(performance.now() - t0) + 'ms'); } catch (_) {}
    return state.pvs;
  }
  // Palace entry (still behind the blackout): prepare every room the hero
  // could see or reach first from the spawn point — the same distance plan
  // as in play — so the first presented frame never looks into an empty
  // room. Rooms the device memory cannot hold yet do not hold the blackout.
  function prepareEntryLibrary(reclaim) {
    if (retired) return Promise.resolve();
    if (!state.built || !zoneStreamer) return 'ready';
    if (!state.entryLibrary) {
      attachStreamer();
      sampleEntryMemory();
      ensurePvs();
      state.entryLibrary = { started: performance.now() };
    }
    const entry = state.entryLibrary, now = performance.now();
    if (entry.done) return 'ready';
    const hero = state.ctx.hero.position, root = state.root.position;
    const x = hero.x - root.x, z = hero.z - root.z;
    const origin = viewerRegion({ x, z }) || 'Palace';
    const plan = window.SinPalaceRoomManager && state.routes && SinPalaceRoomManager.create({ streamed: streamedRooms,
      constrained: !!deviceProfile.constrained, maxLoadM: deviceProfile.constrained ? 75 : 95 }).update({
      now, heroRegion: origin, origin, distances: state.routes.pathDistances(origin, x, z, 200), pvs: state.pvs,
      status: id => zoneStreamer.status(id), leadSec: id => zoneStreamer.leadTime(id) });
    const plannedRooms = plan ? new Set(plan.approach) : new Set(['L1']);
    zoneStreamer.update({ metric: true, current: origin, approach: plannedRooms, keep: plan ? plan.keep : plannedRooms,
      rank: plan ? plan.rank : new Map([['L1', 0]]), visible: new Set(), retained: new Set(), allowBackgroundWarm: false });
    // The blackout waits only for what the first frames can show: rooms seen
    // from the spawn region. The rest of the plan keeps loading in play.
    const seen = state.pvs && state.pvs.get(origin);
    const wanted = new Set([...plannedRooms].filter(id => !seen || seen.has(id)));
    const states = [...wanted].map(id => zoneStreamer.status(id));
    const busy = states.some(st => st === 'loading' || st === 'uploading' || st === 'compiling');
    const r = zoneStreamer.report();
    const waitingMemory = [...wanted].filter(id => r.zones[id] && r.zones[id].state === 'cold' && r.zones[id].deferred);
    if (!busy && waitingMemory.length && !entry.reclaimed && reclaim) {
      entry.reclaimed = true;
      reclaim();
      sampleEntryMemory();
      return 'pending';
    }
    const settled = !busy && [...wanted].every(id => { const st = zoneStreamer.status(id); return st === 'ready' || st === 'failed' || waitingMemory.includes(id); });
    entry.done = settled || now - entry.started > 60000;
    if (entry.done) {
      entry.keepReadyUntil = now + 45000;
      try { console.info('[palace load] entry rooms', JSON.stringify(Object.fromEntries([...wanted].map(id => [id, zoneStreamer.status(id)])))); } catch (_) {}
    }
    return entry.done ? 'ready' : 'pending';
  }
  // Room streaming is decided by WALKING DISTANCE (palace-room-manager.js):
  // every streamed room has a load radius sized so it is ready before the
  // hero, running, can reach its doorway, and a larger release radius.
  // The camera never starts or stops a load; what it draws is only
  // protected from eviction (nothing disappears on screen). The streamer
  // prepares the nearest wanted room first and makes memory only by
  // unloading rooms FARTHER away than the one it needs.
  function streamZones(origin, visibleIds) {
    if (!zoneStreamer) return 0;
    if (zoneDistKey !== origin || !zoneDist) { zoneDistKey = origin; zoneDist = distancesFrom(origin); }
    attachStreamer();
    const level = (zoneStreamer.sample(state.ctx.renderer) || {}).level || 'normal';
    const managed = roomManaged;
    const approach = new Set(managed ? managed.approach : []);
    const keep = new Set(managed ? managed.keep : []);
    const rank = new Map(managed ? managed.rank : []);
    // A door the hero is standing at and pushing comes first.
    const demand = state.templeDoors?.waiting() || state.libraryDoors?.waiting() || null;
    if (demand) { approach.add(demand); rank.set(demand, 0); }
    // An open temple / library door holds its rooms only while the hero is
    // at it (rooms within 12 m): a door left open behind the hero no longer
    // pins a room in memory or blocks a nearer room (what is on screen
    // stays protected anyway).
    const retained = new Set([...(state.templeDoors?.retainZones()||[]),...(state.libraryDoors?.retainZones()||[])]
      .filter(id => id === demand || (rank.has(id) && rank.get(id) <= 12)));
    // A door that is moving, or that the hero stands at, keeps both of its
    // rooms resident: readiness can never drop during the swing.
    const heroAt=state.ctx&&state.ctx.hero&&state.ctx.hero.position;
    for(const d of state.doors){
      if(!d._roomDoor||d.state==='Closed')continue;
      const moving=d.state==='Opening'||d.state==='Closing';
      const near=heroAt&&doorCoordinates(d,heroAt).distance<=5;
      if(!moving&&!near)continue;
      for(const id of [d.from,d.to])if(streamedRooms.has(id))retained.add(id);
    }
    // A failed preparation is retried once the back-off passed (the room the
    // hero stands in twice).
    const now=performance.now();
    for(const id of [...approach,origin]){
      const failure=state.libraryFailures?.get(id);
      const limit=id===origin?2:1;
      if(failure && failure.count<=limit && now>=failure.retryAt && zoneStreamer.status(id)==='failed') zoneStreamer.forceEvict(id);
    }
    let next=null;
    approach.forEach(id=>{ if(!zoneIsReady(id)&&(next===null||(rank.get(id)??1e6)<(rank.get(next)??1e6)))next=id; });
    state.nextStreamRoom = demand || next;
    state._predictedRooms = next ? [next] : [];
    const pendingApproach=[...approach].some(id=>!zoneIsReady(id));
    const move=state.archiveMotion;
    const allowBackgroundWarm=level==='normal'&&!pendingApproach&&(!move||Math.hypot(move.vx,move.vz)<.3);
    const warmGroups=allowBackgroundWarm?[...visibleIds]
      .filter(id=>!streamedRooms.has(id)).map(id=>state.regionGroups.get(id)).filter(Boolean):[];
    return zoneStreamer.update({metric:true,current:origin,visible:visibleIds,memoryLevel:level,warmGroups,
      approach,keep,rank,retained,demand,allowBackgroundWarm,distances:zoneDist});
  }
  // After LRU eviction a streamed room (K4 in particular) can sit complete=false
  // with its dress refs nulled. If the player is standing in it, re-issue the
  // dress even when the streamer has not yet called load() this visit — and
  // let isComplete() then drive upload / compile / reveal.
  function ensureCurrentDress(origin) {
    // A teleport locks the dress target so a one-frame (or few-second)
    // regionAt flicker cannot start the previous room and evict the one
    // we just entered (playthrough-6: ensure-dress K2 after teleport K3).
    if (state._dressLock && state._dressLock.id && (typeof performance !== 'undefined' ? performance.now() : Date.now()) < state._dressLock.until) {
      origin = state._dressLock.id;
    }
    if (!origin || origin === 'T1' || origin === 'T2' || origin === 'T3' || origin === 'T4' || origin === 'T5' || libraryZones.has(origin)) return;
    let c = null;
    try { c = roomCompleteness(origin); } catch (_) { c = null; }
    if (c && c.complete) {
      // Assets are resident but may still be hidden if the streamer never
      // stepped to reveal. Pump forceLoad so upload/compile/reveal run.
      if (!c.revealed && zoneStreamer && typeof zoneStreamer.forceLoad === 'function') {
        try { zoneStreamer.forceLoad(origin); } catch (_) {}
      }
      return;
    }
    // Once per room per dress attempt — every-tick logs froze the WebKit console.
    if (state._ensureLog !== origin + (state.k4Dress ? ':d' : ':n')) {
      state._ensureLog = origin + (state.k4Dress ? ':d' : ':n');
      try { console.info('[palace load] ensure-dress', origin, 'complete', !!(c && c.complete), 'k4Dress', !!state.k4Dress, 'group', !!(state.regionGroups && state.regionGroups.get(origin))); } catch (_) {}
    }
    if (origin === 'K4') {
      const inflight = state.k4Dress && state.k4Dress.loadStarted && !state.k4Dress._assetsCommitted;
      if (!inflight) {
        try {
          dressK4();
          loadK4Assets();
        } catch (e) {
          try { console.warn('[palace load] K4 re-dress', e && (e.message || e)); } catch (_) {}
        }
      }
    }
    if (zoneStreamer && typeof zoneStreamer.forceLoad === 'function' && STREAM_EXPECT[origin]) {
      try { zoneStreamer.forceLoad(origin); } catch (e) { try { console.warn('[palace load] forceLoad', origin, e && (e.message || e)); } catch (_) {} }
    }
  }
  function updateCulling(force) {
    const _tr = (typeof window !== 'undefined' && window.__sinTrace) ? window.__sinTrace : null;
    if (_tr) _tr('updateCulling-enter force=' + !!force);
    if (!state.built || !state.ctx || !state.ctx.hero) return;
    const p = state.ctx.hero.position, x = p.x - state.root.position.x, z = p.z - state.root.position.z;
    const r = regionAt(x, z), id = r ? r.id : 'Palace';
    const regionChanged = !!force || state.current !== id;
    if (force) triCache.clear();
    if (regionChanged) {
      state.current = id;
      if (state.label) state.label.textContent = r ? (r.kind === 'room' ? WING_NAMES[r.wing] + ': ' + r.id + ' ' + r.name : (r.id === 'REAR' ? 'Rear Gallery' : r.id.indexOf('MP') === 0 ? 'Moon Passage' : 'Corridor')) : 'Palace Hall';
    }
    const isArch = !!(r && r.kind === 'threshold');
    const hopsToHall = (id === 'Palace' || isArch) ? 0 : (zoneDist && zoneDist.has('Palace') ? zoneDist.get('Palace') : 1);
    // Adjacent corridors (1 hop) still look back into the hall; only a
    // deeper wing may drop near-LOD packs. Default hops is 1 (safe), not 2.
    state.palaceNear = id === 'Palace' || isArch || hopsToHall <= 1;
    // Free hall near-LOD GPU packs once the player is more than one hop
    // into a wing — they cannot be seen and were part of the 700 MB peak.
    try {
      if (window.PalaceInterior && typeof PalaceInterior.setDeepWing === 'function') {
        PalaceInterior.setDeepWing(!state.palaceNear && hopsToHall > 1);
      }
    } catch (_) {}
    let origin = isArch && r.linkRoom ? r.linkRoom : id;
    // Honour a teleport dress-lock so streamZones cannot treat a regionAt
    // flicker as the new current room and evict the one just entered.
    if (state._dressLock && state._dressLock.id && (typeof performance !== 'undefined' ? performance.now() : Date.now()) < state._dressLock.until) {
      origin = state._dressLock.id;
    }
    if (force) console.info('[palace load] cull-enter');
    const view = cameraView(state.root.position.x, state.root.position.z);
    let visibleIds, preparedIds, meta = null;
    if (visibilityPlanner && view) {
      // The camera only determines visibility through real openings.
      // Preparation uses the player's route and speed in streamZones().
      const tPlan = performance.now();
      const libraryView = libraryPortalView(view);
      const planned = libraryView ? { visible: libraryView, prepared: new Set(), meta: null } :
        { visible: visibleRoutes(view), prepared: new Set(), meta: null };
      if (!libraryView) {
        const archiveReach = archiveExitReach(view);
        if (archiveReach === 0 || archiveReach === 1) {
          planned.visible.clear();
          if (archiveReach === 1) planned.visible.add('LC2');
        }
        if (archiveSight(view)) {
          planned.visible.add('L2');
          if (id !== 'L2') planned.visible.add('LC2');
          if (archiveReach === 2) {
            planned.visible.add('LC2');
            planned.visible.add('L1');
          }
        } else planned.visible.delete('L2');
        if (observatorySight(view)) planned.visible.add('L4');
        else planned.visible.delete('L4');
        cullFromObservatory(view, planned.visible);
        if (sacredHallSight(view)) planned.visible.add('T3');
        else planned.visible.delete('T3');
        cullFromSacredHall(view, planned.visible);
        if (window.SinT1Entrance) {
          if (entranceSight(view)) planned.visible.add('T1');
          else planned.visible.delete('T1');
        }
        if (window.SinPurificationHall) {
          if (purificationSight(view)) planned.visible.add('T2');
          else planned.visible.delete('T2');
        }
        if (window.SinLunarSanctuary) {
          if (sanctuarySight(view)) planned.visible.add('T4');
          else planned.visible.delete('T4');
          if (regionAt(view.x, view.z)?.id === 'T4') sanctuaryExits(view, planned.visible);
        }
        if (window.SinRoyalOfferings) {
          if (offeringSight(view)) planned.visible.add('T5');
          else planned.visible.delete('T5');
          cullFromOfferings(view, planned.visible);
        }
      }
      if (force) console.info('[palace load] cull-plan', Math.round(performance.now()-tPlan)+'ms', 'vis', planned.visible.size);
      if (isArch) planned.visible.add(id);
      meta = planned.meta;
      const candidates = [];
      planned.visible.forEach(rid => {
        const g = state.regionGroups.get(rid); if (!g) return;
        const m = meta && meta.get(rid) || { hops: 9, distance: 0 };
        const current = rid === id || rid === origin;
        candidates.push({ id: rid, current, priority: current ? 0 : m.hops <= 1 ? 1 : 2, distance: m.distance, triangles: cachedTriangles(rid, g, false) });
      });
      // Everything inside the camera's sight is drawn: no triangle budget may
      // drop a region the camera can actually see.
      const plan = { ids: candidates.map(c => c.id), triangles: candidates.reduce((n, c) => n + c.triangles, 0), budget: Infinity };
      visibleIds = new Set(plan.ids); preparedIds = planned.prepared;
      // Rooms in the camera prefetch wedge / within prefetch hops are streamed
      // by streamZones() below: assembled off-screen, revealed as one set.
      state.renderBudget = { triangles: Math.round(plan.triangles), budget: plan.budget, activeRegions: plan.ids.slice() };
      // Keep the throne hall when seen from a wing through its original arch.
      if(planned.visible.has('Palace'))state.palaceNear=true;
    } else if (regionChanged) {
      const dist = distancesFrom(origin);
      visibleIds = new Set(); preparedIds = new Set();
      state.regions.forEach(rr => { const d = dist.has(rr.id) ? dist.get(rr.id) : 99; if (d <= 2) { visibleIds.add(rr.id); preparedIds.add(rr.id); } });
    }
    if (visibleIds && view) {
      completeArchitecture(view, visibleIds);
      const managed = manageRooms(id, origin, view, visibleIds);
      if (managed) visibleIds = managed.shown;
    }
    if (visibleIds) {
      state.regions.forEach(rr => {
        const g = state.regionGroups.get(rr.id); if (!g) return;
        g.visible = visibleIds.has(rr.id) && zoneIsReady(rr.id);
      });
      // Zone streaming is the single source of truth: prefetch, budgeted
      // uploads, shader compile (shells + dress), atomic reveal, LRU eviction
      // (never visible / adjacent / in-frustum zones). Memory pressure is
      // sampled inside the streamer.
      state._streamSets = { origin, visible: visibleIds, prepared: preparedIds };
      // During SETUP the game is still behind the blackout. Starting zone
      // streams here compiles shaders and walks dress on the main thread and
      // can freeze WebKit for minutes. PalaceWings.tick runs this after REVEAL.
      const palacePhase = window.PalaceInterior && PalaceInterior.state && PalaceInterior.state();
      // SETUP, REVEAL and FADING_IN stay on the blackout. streamZones
      // compiles room shaders and starts dress loads; doing that at
      // FADING_IN froze WebKit for 90s after palace entry reached the fade.
      // Streaming begins at DONE, after the load screen is gone. Rooms
      // still use hideUntilReady, so nothing pops in front of the player.
      if (palacePhase === 'SETUP' || palacePhase === 'REVEAL' || palacePhase === 'FADING_IN' || window.__sinStreamHold) {
        if (force) console.info('[palace load] cull-stream-deferred', palacePhase || 'hold');
        return;
      }
      {
        const tS = performance.now();
        streamZones(origin, visibleIds);
        ensureCurrentDress(origin);
        if (force) console.info('[palace load] cull-stream', Math.round(performance.now()-tS)+'ms');
      }
      const zr = zoneStreamer ? zoneStreamer.report() : null;
      state.visibility = { visible: Array.from(visibleIds), prepared: Array.from(preparedIds), warmPending: zr ? zr.warmPending : 0, memory: zr ? zr.memory : null, dressFailures: dressFailures.slice(-8), zones: zr };
    } else if (state._streamSets) {
      streamZones(state._streamSets.origin, state._streamSets.visible);
      ensureCurrentDress(state._streamSets.origin);
    }
    const inHall = Math.abs(x) <= state.hall.width * 0.5 + 0.3 && z >= -0.3 && z <= state.hall.length + 0.4;
    state.root.visible = inHall || contains(x, z);
    if (_tr) _tr('updateCulling-end');
  }
  function tick(dt) {
    if (!state.built) return;
    const t0 = performance.now();
    tickInner(dt);
    if (roomFrames) {
      // Sub-stepped simulation runs several ticks inside one frame; only
      // frame-to-frame gaps count toward the percentiles.
      const gap = state._lastTickAt ? t0 - state._lastTickAt : 0;
      if (!state._lastTickAt || gap >= 2) {
        if (gap) roomFrames.push(gap);
      }
      state._lastTickAt = t0;
    }
    drawRoomOverlay(performance.now() - t0);
  }
  function tickInner(dt) {
    const _trT = (typeof window !== 'undefined' && window.__sinTrace) ? window.__sinTrace : null;
    if (!state.built) return;
    const hero = state.ctx.hero.position, root = state.root.position;
    const x = hero.x - root.x, z = hero.z - root.z;
    const motion = state.archiveMotion || (state.archiveMotion = { x, z, vx: 0, vz: 0 });
    const sec = Math.max(0.001, dt || 0.016);
    motion.vx += (Math.min(8, Math.max(-8, (x - motion.x) / sec)) - motion.vx) * 0.35;
    motion.vz += (Math.min(8, Math.max(-8, (z - motion.z) / sec)) - motion.vz) * 0.35;
    motion.x = x; motion.z = z;
    if (_trT) _trT('PalaceWings.tick-enter');
    updateRoomDoors(Math.max(.001, Math.min(.05, Number(dt) || .016)));
    if (_trT) _trT('PalaceWings.updateRoomDoors');
    updateCulling(false);
    if (state.library && state.current === 'L1') state.library.tick(performance.now() * 0.001);
    if(state.study&&zoneIsReady('L3')&&state.regionGroups.get('L3')?.visible)state.study.tick(performance.now()*.001);
    if (state.sacredHall && zoneIsReady('T3') && state.regionGroups.get('T3').visible) {
      state.sacredHall.tick(performance.now() * .001);
    }
    if (state.sacredEntrance && zoneIsReady('T1') && state.regionGroups.get('T1').visible) {
      state.sacredEntrance.update(performance.now()*.001);
    }
    if (state.purificationHall && zoneIsReady('T2') && state.regionGroups.get('T2').visible) {
      state.purificationHall.tick(performance.now() * .001);
    }
    if (state.lunarSanctuary && zoneIsReady('T4') && state.regionGroups.get('T4').visible) {
      state.lunarSanctuary.tick(performance.now() * .001);
    }
    if (state.royalOfferings && zoneIsReady('T5') && state.regionGroups.get('T5').visible) {
      state.royalOfferings.tick(performance.now() * .001);
    }
    if (_trT) _trT('PalaceWings.updateCulling');
    if (state.torchFireMats) { const t = performance.now() * 0.001; state.torchFireMats.forEach(m => { m.uniforms.uTime.value = t; }); }
    if ((state.k2Lights && state.k2Lights.length) || (state.k3Lights && state.k3Lights.length)) {
      const t = performance.now() * 0.001;
      const sharedFlicker = 0.98 + 0.02 * Math.sin(t * 2.4);
      [state.k2Lights, state.k3Lights].forEach(function (list, region) {
        const bases = region === 0 ? state.k2LightBase : state.k3LightBase;
        (list || []).forEach(function (l, i) { l.intensity = (bases[i] == null ? l.intensity : bases[i]) * sharedFlicker; });
      });
    }
    if (state.debug && state.ui && performance.now() - state.minimapAt > 120) { state.minimapAt = performance.now(); drawMinimap(); }
  }
  function floorAt(x, z, fromY) {
    if (!contains(x,z)) return null;
    if (state.sacredEntrance && zoneIsReady('T1')) {
      const y=state.sacredEntrance.floorAt(x,z);
      if (y>0) return y;
    }
    if (state.purificationHall && zoneIsReady('T2')) {
      const step = state.purificationHall.floorAt(x, z);
      if (step > 0) return step;
    }
    if (state.royalOfferings && zoneIsReady('T5')) {
      const step = state.royalOfferings.floorAt(x, z);
      if (step > 0) return step;
    }
    if (state.sacredHall && zoneIsReady('T3')) {
      const bottom = state.sacredHall.channelFloorAt(x, z);
      if (bottom !== null) return bottom;
    }
    if (state.observatory && zoneIsReady('L4')) {
      const step = state.observatory.floorAt(x, z);
      if (step > 0) return step;
    }
    if (state.library && state.library.ready && fromY != null) {
      const gallery = state.library.floor(x, z, fromY);
      if (gallery > 0) return gallery;
    }
    const K1 = state.rooms.find(r => r.id === 'K1');
    if (K1 && pointInPoly(x, z, K1.poly)) return state.k1FloorY;
    const T4 = state.rooms.find(r => r.id === 'T4');
    if (window.SinLunarSanctuary) {
      const step = state.lunarSanctuary && zoneIsReady('T4') ? state.lunarSanctuary.floorAt(x, z) : 0;
      if (step > 0) return step;
    } else if (T4 && pointInPoly(x, z, T4.poly)) {
      const start = T4.bbox.x1 - 14.4, end = T4.bbox.x1 - 8.4;
      if (x >= T4.bbox.x1 - 8.4) return 1.5;
      if (x > start) return Math.min(1.5, (x - start) / (end - start) * 1.5);
    }
    const K5 = state.rooms.find(r => r.id === 'K5');
    if (K5 && pointInPoly(x, z, K5.poly)) return k5DaisHeight(K5.bbox, x, z);
    return 0;
  }
  function onEntranceSteps(position) {
    if (!state.sacredEntrance || !zoneIsReady('T1')) return false;
    const origin = state.root.position;
    return state.sacredEntrance.floorAt(position.x - origin.x, position.z - origin.z) > 0;
  }
  function onOfferingSteps(position) {
    if (!state.royalOfferings || !zoneIsReady('T5')) return false;
    const origin = state.root.position;
    return state.royalOfferings.floorAt(position.x - origin.x, position.z - origin.z) > 0;
  }

  function onLibraryStairs(position) {
    if (!state.library || !state.library.ready) return false;
    const origin = state.root.position;
    return state.library.onStairs(position.x - origin.x, position.z - origin.z, position.y - origin.y);
  }
  function resolveCamera(cam) {
    if (!state.built || !cam) return;
    const x = cam.position.x - state.root.position.x, y = cam.position.y - state.root.position.y, z = cam.position.z - state.root.position.z;
    for (const b of nearbyBoxes(x, z)) {
      if (x <= b.minx || x >= b.maxx || z <= b.minz || z >= b.maxz || y <= b.miny || y >= b.maxy) continue;
      const moves = [
        { d: x - b.minx, x: b.minx - 0.14, z }, { d: b.maxx - x, x: b.maxx + 0.14, z },
        { d: z - b.minz, x, z: b.minz - 0.14 }, { d: b.maxz - z, x, z: b.maxz + 0.14 }
      ].sort((a, b2) => a.d - b2.d)[0];
      cam.position.x = state.root.position.x + moves.x; cam.position.z = state.root.position.z + moves.z;
      break;
    }
    cam.position.y = Math.max(state.root.position.y + 0.35, Math.min(state.root.position.y + MAX_H - 0.2, cam.position.y));
  }
  function clampFollowTarget(want) {
    if (!want) return;
    const limit = state.current === 'L1' ? 10.65 : 6.5;
    want.y = Math.max(state.root.position.y + 1.2, Math.min(state.root.position.y + limit, want.y));
  }
  function localToWorld(x, z, y) {
    return new THREE.Vector3(state.root.position.x + x, state.root.position.y + (y || 0), state.root.position.z + z);
  }
  function entranceLocal(id) {
    const r = state.regions.find(function (rr) { return rr.id === id; });
    if (!r || !r.bbox) return null;
    const doors = (state.doors || []).filter(function (dd) { return dd.from === id || dd.to === id; });
    let door = null, best = -1;
    doors.forEach(function (dd) {
      const other = dd.from === id ? dd.to : dd.from;
      const score = other && /C|REAR|MP|Palace/.test(other) ? 2 : 1;
      if (score >= best) { best = score; door = dd; }
    });
    const cx = r.bbox.cx, cz = r.bbox.cz;
    const from = door ? { x: door.x, z: door.z } : { x: cx, z: r.bbox.z0 };
    const dx = cx - from.x, dz = cz - from.z, len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    // Walk inward from the door until the capsule is clear of the door leaf,
    // columns and props. Spawning at a fixed 2.8 m put the hero inside a T2
    // column and left the 4.2 m follow-cam inside K2/K3/K4 door reliefs.
    let x = from.x + ux * 2.6, z = from.z + uz * 2.6, found = false;
    const maxD = Math.min(len * 0.55, 10);
    for (let dist = 2.6; dist <= maxD; dist += 0.4) {
      const tx = from.x + ux * dist, tz = from.z + uz * dist;
      if (!capsuleBlocked(tx, tz, 0.5)) { x = tx; z = tz; found = true; break; }
    }
    if (!found || capsuleBlocked(x, z, 0.5)) {
      const sides = [0.9, -0.9, 1.8, -1.8, 2.7, -2.7];
      for (let i = 0; i < sides.length; i++) {
        const sx = x - uz * sides[i], sz = z + ux * sides[i];
        if (!capsuleBlocked(sx, sz, 0.5)) { x = sx; z = sz; found = true; break; }
      }
    }
    return { x: x, z: z, yaw: Math.atan2(ux, uz), lookX: cx, lookZ: cz };
  }
  function teleport(id, opts) {
    if (!state.built || !state.ctx) return false;
    opts = opts || {};
    const r = state.regions.find(rr => rr.id === id);
    const d = state.doors.find(dd => dd.id === id);
    let x, z, yaw = 0, lookX = null, lookZ = null;
    // Default: stand just inside the entrance looking at the room centre, so
    // we are not on top of the K2/K3 table / K4 altar (bbox centre).
    const ent = (!opts.center && r) ? entranceLocal(id) : null;
    if (ent) { x = ent.x; z = ent.z; yaw = ent.yaw || 0; lookX = ent.lookX; lookZ = ent.lookZ; }
    else if (r) { x = r.bbox.cx; z = r.bbox.cz; }
    else if (d) { x = d.x; z = d.z; }
    else if (id === 'Palace') { x = 0; z = Math.min(8, state.hall.length * 0.2); }
    else return false;
    const y = floorAt(x, z) || 0, p = localToWorld(x, z, y);
    state.ctx.hero.position.copy(p); state.ctx.setFacing(yaw);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    // At a doorway, a 4.2 m follow pulls the lens back through the door leaf
    // (K2/K3/K4 frames were gold-stud close-ups with the room out of view).
    // Keep the original 4.2 m hall shot when we are not at an entrance.
    const back = (opts.camBack != null) ? opts.camBack : (ent ? 1.15 : 4.2);
    state.ctx.camera.position.set(p.x - fx * back, p.y + 1.7, p.z - fz * back);
    let lx = p.x + fx * 8, lz = p.z + fz * 8;
    if (lookX != null && lookZ != null) {
      const look = localToWorld(lookX, lookZ, y + 1.15);
      lx = look.x; lz = look.z;
    }
    state.ctx.camera.lookAt(lx, p.y + 1.25, lz);
    if (window.PalaceInterior) PalaceInterior.constrainCamera(state.ctx.camera, state.ctx.hero);
    resolveCamera(state.ctx.camera);
    // Lock before updateCulling so a stale regionAt cannot forceLoad the
    // room we just left and evict the target mid-load.
    state._dressLock = { id: id, until: (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 8000 };
    updateCulling(true);
    // updateCulling may return early (stream hold / non-DONE phase) before
    // streamZones. The teleport target must still be dressed — this is the
    // K4 second-visit path (playthrough-2 still timed out at 60 s).
    ensureCurrentDress(id);
    drawMinimap();
    return true;
  }

  function createDebugUI() {
    const style = document.createElement('style');
    style.textContent = `#wings-label{position:fixed;z-index:155;top:calc(8px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);padding:7px 13px;background:rgba(8,6,4,.82);border:1px solid #a7854d;color:#f4dfba;font:600 12px/1.2 system-ui;pointer-events:none;white-space:nowrap}#wings-ui{position:fixed;z-index:156;right:8px;top:52px;width:min(290px,86vw);max-height:60vh;overflow:auto;background:rgba(7,6,5,.91);border:1px solid #80683f;color:#f3e5c9;padding:8px;direction:ltr;font:11px/1.35 system-ui;touch-action:pan-y}#wings-ui h3{margin:0 0 7px;color:#eac989;font-size:13px}#wings-ui .wg{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin:5px 0 9px}#wings-ui button{border:1px solid #66563c;background:#241c13;color:#f4e3c2;padding:6px 4px;min-height:29px;font-size:10px}#wings-ui button:hover{background:#5b4226}#wings-ui .wide{width:100%;margin-top:4px}#wings-map{display:block;width:100%;height:150px;background:#0b0a08;border:1px solid #493c2a;margin-top:7px}#wings-results{white-space:pre-wrap;max-height:180px;overflow:auto;color:#cce8bd;margin-top:7px}`;
    document.head.appendChild(style);
    const label = document.createElement('div'); label.id = 'wings-label'; label.textContent = 'Palace Hall'; document.body.appendChild(label); state.label = label;
    const ui = document.createElement('div'); ui.id = 'wings-ui'; document.body.appendChild(ui); state.ui = ui;
    let html = '<h3>PALACE WINGS · DEBUG</h3><div class="wg">';
    state.rooms.forEach(r => { html += `<button data-tp="${r.id}">${r.id}</button>`; }); html += '</div><div class="wg">';
    ['Palace', 'PalaceL3', 'PalaceR3', 'PalaceR1', 'REAR', 'MP1'].forEach(id => { html += `<button data-tp="${id}">${id}</button>`; }); html += '</div>';
    html += '<button class="wide" data-act="cutaway">Cutaway / ceilings</button><button class="wide" data-act="bright">Fullbright</button><button class="wide" data-act="tests">Run geometry + graph + camera tests</button><canvas id="wings-map" width="540" height="300"></canvas><div id="wings-results">Ready. All geometry is procedural.</div>';
    ui.innerHTML = html;
    ui.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.tp) teleport(b.dataset.tp);
      if (b.dataset.act === 'cutaway') {
        state.cutaway = !state.cutaway;
        state.ceilings.concat(state.corridorCeilings || []).forEach(c => { c.visible = !state.cutaway; });
        setLibraryCeiling(state.regionGroups.get('L1'));
        setObservatoryShell(state.regionGroups.get('L4'));
        setSacredHallCeiling(state.regionGroups.get('T3'), zoneIsReady('T3'));
        if (window.SinT1Entrance) syncEntranceShell(state.regionGroups.get('T1'),zoneIsReady('T1'));
        if (window.SinPurificationHall) syncPurificationShell(state.regionGroups.get('T2'), zoneIsReady('T2'));
        if (window.SinLunarSanctuary) syncSanctuaryShell(state.regionGroups.get('T4'), zoneIsReady('T4'));
        if (window.SinRoyalOfferings) syncOfferingShell(state.regionGroups.get('T5'));
      }
      if (b.dataset.act === 'bright') {
        state.fullbright = !state.fullbright;
        state.materials.forEach(m => { if (m.emissive) { if (m.userData.oldEmissive == null) m.userData.oldEmissive = m.emissiveIntensity || 0; m.emissiveIntensity = state.fullbright ? 0.85 : m.userData.oldEmissive; } });
        state.fullbright = !!state.fullbright;
      }
      if (b.dataset.act === 'tests') {
        const out = ui.querySelector('#wings-results'); b.disabled = true; out.textContent = 'Running…';
        runTests({ camera: true }).then(report => { out.textContent = formatReport(report); }).catch(e => { out.textContent = String(e.stack || e); }).finally(() => { b.disabled = false; });
      }
    });
    drawMinimap();
  }
  function drawMinimap() {
    if (!state.ui || !state.ctx) return;
    const canvas = state.ui.querySelector('#wings-map'); if (!canvas) return;
    const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H); g.fillStyle = '#0b0a08'; g.fillRect(0, 0, W, H);
    const all = state.regions.map(r => r.bbox), minX = Math.min.apply(null, all.map(b => b.x0)), maxX = Math.max.apply(null, all.map(b => b.x1)), minZ = Math.min.apply(null, all.map(b => b.z0)), maxZ = Math.max.apply(null, all.map(b => b.z1));
    const s = Math.min((W - 24) / (maxX - minX), (H - 24) / (maxZ - minZ));
    function xy(x, z) { return [12 + (x - minX) * s, H - 12 - (z - minZ) * s]; }
    const colors = { Kings: '#9c7950', Temple: '#668b7c', Library: '#887a9b', Shared: '#80715a' };
    state.regions.forEach(r => {
      g.beginPath(); r.poly.forEach((p, i) => { const q = xy(p[0], p[1]); if (!i) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]); }); g.closePath();
      g.fillStyle = colors[r.wing] || '#777'; g.globalAlpha = r.id === state.current ? 1 : 0.55; g.fill(); g.globalAlpha = 1; g.strokeStyle = '#d8c49b'; g.lineWidth = 1; g.stroke();
      if (r.kind === 'room') { const q = xy(r.bbox.cx, r.bbox.cz); g.fillStyle = '#fff0cf'; g.font = '16px system-ui'; g.textAlign = 'center'; g.fillText(r.id, q[0], q[1] + 5); }
    });
    const p = state.ctx.hero.position, q = xy(p.x - state.root.position.x, p.z - state.root.position.z);
    g.fillStyle = '#ffdf65'; g.beginPath(); g.arc(q[0], q[1], 6, 0, Math.PI * 2); g.fill();
  }
  function overview() {
    if (!state.built) return false;
    state.cutaway = true; state.ceilings.concat(state.corridorCeilings || []).forEach(c => { c.visible = false; });
    const all = state.regions.map(r => r.bbox), cx = (Math.min(...all.map(b => b.x0)) + Math.max(...all.map(b => b.x1))) * 0.5;
    const cz = (Math.min(...all.map(b => b.z0)) + Math.max(...all.map(b => b.z1))) * 0.5;
    const span = Math.max(Math.max(...all.map(b => b.x1)) - Math.min(...all.map(b => b.x0)), Math.max(...all.map(b => b.z1)) - Math.min(...all.map(b => b.z0)));
    state.ctx.camera.position.copy(localToWorld(cx, cz, span * 0.85)); state.ctx.camera.lookAt(localToWorld(cx, cz, 0));
    state.ctx.renderer.render(state.ctx.scene, state.ctx.camera); return true;
  }


  /* Validation uses the exact rendered triangles and the exact runtime colliders. */
  function edgeAudit(geometry) {
    const p = geometry.attributes.position, index = geometry.index;
    const edges = new Map();
    function key(i) {
      return Math.round(p.getX(i) * 10000) + ',' + Math.round(p.getY(i) * 10000) + ',' + Math.round(p.getZ(i) * 10000);
    }
    function edge(a, b) {
      const ka = key(a), kb = key(b), k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
    const n = index ? index.count : p.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2;
      edge(a, b); edge(b, c); edge(c, a);
    }
    let boundary = 0, nonManifold = 0;
    edges.forEach(count => { if (count === 1) boundary++; else if (count !== 2) nonManifold++; });
    return { boundary, nonManifold, edges: edges.size };
  }
  function boundaryTest() {
    const geometries = [state.wallGeometry].concat(state.floorMeshes.map(m => m.geometry), state.ceilings.map(m => m.geometry));
    if (state.columnGeo) geometries.push(state.columnGeo);
    const bad = [], seen = new Set();
    let boundary = 0, nonManifold = 0;
    geometries.forEach((g, i) => {
      if (!g || seen.has(g.uuid)) return; seen.add(g.uuid);
      const a = edgeAudit(g); boundary += a.boundary; nonManifold += a.nonManifold;
      if (a.boundary || a.nonManifold) bad.push({ geometry: i, boundary: a.boundary, nonManifold: a.nonManifold });
    });
    return { name: 'boundary edges', failures: boundary + nonManifold, boundary, nonManifold, meshes: seen.size, bad };
  }

  function buildRayIndex(meshes) {
    state.root.updateMatrixWorld(true);
    const triangles = [];
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    meshes.forEach(m => {
      if (!m || !m.isMesh || m.isInstancedMesh || !m.geometry || !m.geometry.attributes.position) return;
      const p = m.geometry.attributes.position, idx = m.geometry.index, count = idx ? idx.count : p.count;
      const side = m.material && m.material.side != null ? m.material.side : THREE.FrontSide;
      for (let i = 0; i + 2 < count; i += 3) {
        const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
        va.fromBufferAttribute(p, ia).applyMatrix4(m.matrixWorld);
        vb.fromBufferAttribute(p, ib).applyMatrix4(m.matrixWorld);
        vc.fromBufferAttribute(p, ic).applyMatrix4(m.matrixWorld);
        const a = [va.x, va.y, va.z], b = [vb.x, vb.y, vb.z], c = [vc.x, vc.y, vc.z];
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        triangles.push({ a, b, c, nx, ny, nz, side, name: m.name,
          min: [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.min(a[2], b[2], c[2])],
          max: [Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]), Math.max(a[2], b[2], c[2])],
          center: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3] });
      }
    });
    function node(items, depth) {
      const n = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], items: null, left: null, right: null };
      items.forEach(t => { for (let k = 0; k < 3; k++) { n.min[k] = Math.min(n.min[k], t.min[k]); n.max[k] = Math.max(n.max[k], t.max[k]); } });
      if (items.length <= 16 || depth > 28) { n.items = items; return n; }
      const ext = n.max.map((v, k) => v - n.min[k]); let axis = 0; if (ext[1] > ext[axis]) axis = 1; if (ext[2] > ext[axis]) axis = 2;
      items.sort((a, b) => a.center[axis] - b.center[axis]);
      const mid = items.length >> 1;
      n.left = node(items.slice(0, mid), depth + 1); n.right = node(items.slice(mid), depth + 1); return n;
    }
    const root = triangles.length ? node(triangles, 0) : null;
    function boxHit(n, o, d, inv, far) {
      let t0 = 0.025, t1 = far;
      for (let k = 0; k < 3; k++) {
        const a = (n.min[k] - o[k]) * inv[k], b = (n.max[k] - o[k]) * inv[k];
        const lo = Math.min(a, b), hi = Math.max(a, b);
        t0 = Math.max(t0, lo); t1 = Math.min(t1, hi); if (t1 < t0) return false;
      }
      return true;
    }
    function triangleHit(t, o, d, far) {
      if (t.side === THREE.FrontSide && t.nx * d[0] + t.ny * d[1] + t.nz * d[2] >= -1e-8) return Infinity;
      const e1x = t.b[0] - t.a[0], e1y = t.b[1] - t.a[1], e1z = t.b[2] - t.a[2];
      const e2x = t.c[0] - t.a[0], e2y = t.c[1] - t.a[1], e2z = t.c[2] - t.a[2];
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-9) return Infinity;
      const invDet = 1 / det, tx = o[0] - t.a[0], ty = o[1] - t.a[1], tz = o[2] - t.a[2];
      const u = (tx * px + ty * py + tz * pz) * invDet; if (u < -1e-7 || u > 1.0000001) return Infinity;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * invDet; if (v < -1e-7 || u + v > 1.0000001) return Infinity;
      const distance = (e2x * qx + e2y * qy + e2z * qz) * invDet;
      return distance > 0.025 && distance <= far ? distance : Infinity;
    }
    function cast(o, d, far) {
      if (!root) return null;
      const inv = [1 / (d[0] || 1e-20), 1 / (d[1] || 1e-20), 1 / (d[2] || 1e-20)];
      let best = far, hit = null, stack = [root];
      while (stack.length) {
        const n = stack.pop(); if (!boxHit(n, o, d, inv, best)) continue;
        if (n.items) {
          for (const t of n.items) { const distance = triangleHit(t, o, d, best); if (distance < best) { best = distance; hit = t; } }
        } else { if (n.left) stack.push(n.left); if (n.right) stack.push(n.right); }
      }
      return hit ? { distance: best, triangle: hit } : null;
    }
    return { cast, triangles: triangles.length };
  }
  function declaredArchEscape(o, d) {
    const rp = state.root.position;
    for (const door of state.doors) {
      if (door.kind !== 'arch') continue;
      const z = rp.z + door.z, y = rp.y;
      if (Math.abs(d[0]) < 1e-8) continue;
      const planes = [rp.x + door.x, rp.x + (door.x < 0 ? -state.back : state.back)];
      for (const x of planes) {
        const t = (x - o[0]) / d[0]; if (t <= 0 || t > 300) continue;
        const hz = o[2] + d[2] * t, hy = o[1] + d[1] * t;
        if (Math.abs(hz - z) <= door.width * 0.5 + 0.05 && hy >= y - 0.05 && hy <= y + door.height + 0.05) return door.id;
      }
    }
    return null;
  }
  function roomGrid(r, spacing) {
    const points = [], b = r.bbox;
    for (let z = b.z0 + spacing * 0.5; z < b.z1; z += spacing) for (let x = b.x0 + spacing * 0.5; x < b.x1; x += spacing) {
      if (pointInPoly(x, z, r.poly)) points.push([x, z]);
    }
    return points;
  }
  async function visualLeakTest() {
    const meshes = []; state.root.traverse(o => { if (o.isMesh && !o.isInstancedMesh) meshes.push(o); });
    const index = buildRayIndex(meshes), dirs = [];
    for (let i = 0; i < 32; i++) { const a = i * Math.PI * 2 / 32; dirs.push([Math.cos(a), 0, Math.sin(a)]); }
    let failures = 0, declared = 0, points = 0, rays = 0; const bad = [];
    for (const r of state.rooms) {
      for (const p of roomGrid(r, 1)) {
        const y = (floorAt(p[0], p[1]) || 0) + 1.2, w = localToWorld(p[0], p[1], y), o = [w.x, w.y, w.z]; points++;
        for (const d of dirs) {
          rays++; const hit = index.cast(o, d, 300);
          if (!hit) { const escape = declaredArchEscape(o, d); if (escape) declared++; else { failures++; if (bad.length < 30) bad.push({ room: r.id, x: p[0], z: p[1], direction: d }); } }
        }
        rays += 2;
        if (!index.cast(o, [0, 1, 0], 300)) { failures++; if (bad.length < 30) bad.push({ room: r.id, x: p[0], z: p[1], direction: 'up' }); }
        if (!index.cast(o, [0, -1, 0], 300)) { failures++; if (bad.length < 30) bad.push({ room: r.id, x: p[0], z: p[1], direction: 'down' }); }
        if (points % 50 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    return { name: 'visual leaks · 1 m / 32+2 rays / 300 m', failures, points, rays, declaredOpenings: declared, indexedTriangles: index.triangles, bad };
  }
  async function floorRayTest() {
    const index = buildRayIndex(state.floorMeshes.concat(state.floorSupport || []));
    let failures = 0, points = 0; const bad = [];
    for (const r of state.rooms) for (const p of roomGrid(r, 0.5)) {
      const w = localToWorld(p[0], p[1], 20), hit = index.cast([w.x, w.y, w.z], [0, -1, 0], 30); points++;
      if (!hit) { failures++; if (bad.length < 30) bad.push({ room: r.id, x: p[0], z: p[1] }); }
      if (points % 500 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return { name: 'floor raycast · 0.5 m', failures, points, indexedTriangles: index.triangles, bad };
  }
  function overlapTest() {
    let failures = 0; const bad = [];
    for (let i = 0; i < state.rooms.length; i++) for (let j = i + 1; j < state.rooms.length; j++) {
      const a = state.rooms[i], b = state.rooms[j], area = solidsArea(intersection(solid(a.poly), solid(b.poly)));
      if (area > 0.0001) { failures++; bad.push({ a: a.id, b: b.id, area }); }
    }
    const wings = state.floorWingSolids || [];
    for (let i = 0; i < wings.length; i++) for (let j = i + 1; j < wings.length; j++) {
      const area = solidsArea(intersection(wings[i].solids, wings[j].solids));
      if (area > 0.0001) { failures++; bad.push({ a: wings[i].wing, b: wings[j].wing, area }); }
    }
    const sealedArea = solidsArea(intersection(state.floors, solid(polyRect(state.sealed.x, state.sealed.z, state.sealed.w, state.sealed.d))));
    if (sealedArea > 0.0001) { failures++; bad.push({ sealedZoneFloorArea: sealedArea }); }
    return { name: 'floor overlap + sealed exclusion', failures, bad };
  }

  function nearestVisited(visited, x, z, radius) {
    const ix = Math.round(x / 0.25), iz = Math.round(z / 0.25), n = Math.ceil((radius || 1) / 0.25);
    for (let r = 0; r <= n; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      if (visited.has((ix + dx) + ',' + (iz + dz))) return r * 0.25;
    }
    return null;
  }
  async function floodTest() {
    const bboxes = state.regions.map(r => r.bbox);
    const minX = Math.floor(Math.min(...bboxes.map(b => b.x0)) / 0.25) - 2, maxX = Math.ceil(Math.max(...bboxes.map(b => b.x1)) / 0.25) + 2;
    const minZ = Math.floor(Math.min(...bboxes.map(b => b.z0)) / 0.25) - 2, maxZ = Math.ceil(Math.max(...bboxes.map(b => b.z1)) / 0.25) + 2;
    const startRoom = state.rooms.find(r => r.id === 'K1');
    const sx = Math.round(startRoom.bbox.cx / 0.25), sz = Math.round(startRoom.bbox.cz / 0.25);
    const queue = [[sx, sz]], visited = new Set([sx + ',' + sz]);
    for (let head = 0; head < queue.length; head++) {
      const cell = queue[head], neighbors = [[cell[0] + 1, cell[1]], [cell[0] - 1, cell[1]], [cell[0], cell[1] + 1], [cell[0], cell[1] - 1]];
      for (const n of neighbors) {
        if (n[0] < minX || n[0] > maxX || n[1] < minZ || n[1] > maxZ) continue;
        const key = n[0] + ',' + n[1]; if (visited.has(key)) continue;
        const x = n[0] * 0.25, z = n[1] * 0.25;
        if (!pointInSolids(x, z, state.floors) || capsuleBlocked(x, z, 0.32)) continue;
        visited.add(key); queue.push(n);
      }
      if (head % 5000 === 0 && head) await new Promise(resolve => setTimeout(resolve, 0));
    }
    const bad = []; let failures = 0;
    state.rooms.forEach(r => {
      const distance = nearestVisited(visited, r.bbox.cx, r.bbox.cz, 2.5);
      if (distance == null) { failures++; bad.push({ room: r.id, unreachable: true }); }
    });
    state.doors.forEach(d => {
      const distance = nearestVisited(visited, d.x, d.z, 1.25);
      if (distance == null) { failures++; bad.push({ door: d.id, unreachable: true }); }
    });
    return { name: 'capsule flood fill · 0.25 m / real colliders', failures, visitedCells: visited.size, rooms: state.rooms.length, doors: state.doors.length, bad };
  }
  function shortestPath(start, goal) {
    const adj = adjacency(), q = [start], prev = new Map([[start, null]]);
    while (q.length) {
      const a = q.shift(); if (a === goal) break;
      for (const b of adj.get(a) || []) if (!prev.has(b)) { prev.set(b, a); q.push(b); }
    }
    if (!prev.has(goal)) return null;
    const path = []; let at = goal; while (at != null) { path.push(at); at = prev.get(at); } return path.reverse();
  }
  function graphTest() {
    const anchors = { PalaceL3: 'K1', PalaceR3: 'T1', PalaceR1: 'L1' }, paths = {}, bad = [];
    let failures = state.rooms.length === 14 ? 0 : 1;
    if (failures) bad.push({ roomCount: state.rooms.length });
    Object.keys(anchors).forEach(arch => {
      const start = anchors[arch], targets = state.rooms.map(r => r.id).concat(['Palace', 'K1', 'T1', 'L1']); paths[arch] = {};
      Array.from(new Set(targets)).forEach(target => {
        const path = shortestPath(start, target); paths[arch][target] = path;
        if (!path) { failures++; bad.push({ from: arch, to: target }); }
      });
    });
    state.doors.forEach(d => {
      if (!adjacency().has(d.from) || !adjacency().has(d.to)) { failures++; bad.push({ invalidDoor: d.id }); }
    });
    const continuous = shortestPath('K1', 'L1');
    return { name: 'graph reachability + shortest paths', failures, paths, continuousL3toR1: continuous, bad };
  }

  function cameraContact(cam) {
    const x = cam.position.x - state.root.position.x, y = cam.position.y - state.root.position.y, z = cam.position.z - state.root.position.z;
    let inside = 0, near = 0;
    for (const b of nearbyBoxes(x, z)) {
      if (y < b.miny || y > b.maxy) continue;
      if (x > b.minx && x < b.maxx && z > b.minz && z < b.maxz) { inside++; near++; continue; }
      const qx = Math.max(b.minx, Math.min(x, b.maxx)), qz = Math.max(b.minz, Math.min(z, b.maxz));
      if (Math.hypot(x - qx, z - qz) < Math.max(0.12, cam.near * 1.1)) near++;
    }
    return { inside, near };
  }
  async function cameraTour() {
    if (!state.ctx || !state.ctx.camera || !state.ctx.hero) return { name: 'real camera tour', failures: 1, bad: ['missing game context'] };
    const ctx = state.ctx, cam = ctx.camera, hero = ctx.hero;
    const oldP = hero.position.clone(), oldC = cam.position.clone(), oldQ = cam.quaternion.clone();
    let inside = 0, near = 0, frames = 0; const bad = [];
    function pose(x, z, dx, dz) {
      const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
      const fy = floorAt(x, z) || 0, p = localToWorld(x, z, fy); hero.position.copy(p);
      cam.position.set(p.x - dx * 4.2, p.y + 1.8, p.z - dz * 4.2); cam.lookAt(p.x, p.y + 1.3, p.z);
      if (window.PalaceInterior) PalaceInterior.constrainCamera(cam, hero);
      resolveCamera(cam); cam.updateMatrixWorld(true);
      const c = cameraContact(cam); inside += c.inside; near += c.near; frames++;
      if ((c.inside || c.near) && bad.length < 20) bad.push({ x, z, inside: c.inside, near: c.near });
      if (ctx.renderer) ctx.renderer.render(ctx.scene, cam);
    }
    for (const d of state.doors) {
      const a = state.regions.find(r => r.id === d.from), b = state.regions.find(r => r.id === d.to);
      const pa = a ? [a.bbox.cx, a.bbox.cz] : [0, Math.min(8, state.hall.length * 0.2)];
      const pb = b ? [b.bbox.cx, b.bbox.cz] : [0, Math.min(8, state.hall.length * 0.2)];
      const points = [pa, [d.x, d.z], pb];
      for (let s = 0; s < 2; s++) {
        const p0 = points[s], p1 = points[s + 1], dx = p1[0] - p0[0], dz = p1[1] - p0[1], distance = Math.hypot(dx, dz);
        const steps = Math.max(1, Math.ceil(distance / (8.5 / 30)));
        for (let i = 0; i <= steps; i++) { const t = i / steps; pose(p0[0] + dx * t, p0[1] + dz * t, dx, dz); }
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    for (const r of state.rooms) {
      const b = r.bbox, inset = 1.1;
      const corners = r.id === 'L4' ? [[b.cx, b.cz]] : [[b.x0 + inset, b.z0 + inset], [b.x1 - inset, b.z0 + inset], [b.x1 - inset, b.z1 - inset], [b.x0 + inset, b.z1 - inset]];
      corners.forEach((p, i) => { const a = i * Math.PI * 0.5 + Math.PI * 0.25; pose(p[0], p[1], Math.cos(a), Math.sin(a)); });
    }
    hero.position.copy(oldP); cam.position.copy(oldC); cam.quaternion.copy(oldQ); updateCulling(true);
    return { name: 'real camera tour · sprint 8.5 m/s', failures: inside + near, frames, cameraInside: inside, nearPlaneContacts: near, bad };
  }

  async function runTests(options) {
    if (!state.built) throw new Error('Build PalaceWings before running tests');
    const report = { started: new Date().toISOString(), tests: [], graph: null };
    report.tests.push(boundaryTest()); await new Promise(resolve => setTimeout(resolve, 0));
    report.tests.push(overlapTest());
    report.graph = graphTest(); report.tests.push(report.graph);
    report.tests.push(await floodTest());
    report.tests.push(await floorRayTest());
    report.tests.push(await visualLeakTest());
    if (options && options.camera) report.tests.push(await cameraTour());
    report.failures = report.tests.reduce((n, t) => n + t.failures, 0);
    report.finished = new Date().toISOString(); state.report = report;
    if (typeof window !== 'undefined') window.__wingsTestReport = report;
    return report;
  }
  function formatReport(report) {
    if (!report) return 'No report';
    const lines = report.tests.map(t => `${t.failures === 0 ? 'PASS' : 'FAIL'} · ${t.name} · failures=${t.failures}`);
    lines.push(`TOTAL FAILURES: ${report.failures}`);
    if (report.graph && report.graph.continuousL3toR1) lines.push('Continuous L3 → R1: ' + report.graph.continuousL3toR1.join(' → '));
    report.tests.forEach(t => { if (t.bad && t.bad.length) lines.push(t.name + ': ' + JSON.stringify(t.bad.slice(0, 5))); });
    return lines.join('\n');
  }
  let metricsBusy = false;
  let metricsLast = null;
  function current() { return state.current || null; }
  function metrics() {
    if (retired) return { retired: true, current: null };
    const _tr = (typeof window !== 'undefined' && window.__sinTrace) ? window.__sinTrace : null;
    const _tM = (_tr && performance.now) ? performance.now() : 0;
    if (metricsBusy) {
      if (_tr) _tr('PalaceWings.metrics-reenter');
      return metricsLast || { current: state.current || null, meshes: 0, triangles: 0, visibleMeshes: 0, visibleTriangles: 0, reentrant: true };
    }
    metricsBusy = true;
    try {
    let meshes = 0, triangles = 0, visibleMeshes = 0, visibleTriangles = 0;
    const topVisibleMeshes = [], regionByGroup = new Map();
    if (!state.root) return { meshes: 0, triangles: 0, visibleMeshes: 0, visibleTriangles: 0 };
    state.regionGroups.forEach((g, id) => regionByGroup.set(g, id));
    state.root.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      const count = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
      const instances = o.isInstancedMesh ? o.count : 1; meshes++; triangles += count * instances;
      let visible = o.visible, p = o.parent; while (visible && p) { visible = p.visible; p = p.parent; }
      if (visible) {
        const n = count * instances; visibleMeshes++; visibleTriangles += n;
        let region = o; while (region && !regionByGroup.has(region)) region = region.parent;
        topVisibleMeshes.push({ name: o.name || o.type || 'mesh', region: regionByGroup.get(region) || 'shared', triangles: Math.round(n), instances });
      }
    });
    topVisibleMeshes.sort((a, b) => b.triangles - a.triangles);
    const visibleRegionTriangles = {};
    state.regionGroups.forEach((g, id) => {
      if (!g.visible) return;
      let n = 0;
      g.traverse(o => {
        if (!o.isMesh || !o.geometry || !o.visible) return;
        let visible = true, p = o.parent;
        while (visible && p && p !== state.root) { visible = p.visible; p = p.parent; }
        if (!visible || !state.root.visible) return;
        const t = o.geometry.index ? o.geometry.index.count / 3 : (o.geometry.attributes.position ? o.geometry.attributes.position.count / 3 : 0);
        n += t * (o.isInstancedMesh ? o.count : 1);
      });
      visibleRegionTriangles[id] = Math.round(n);
    });
    // report() must stay cheap (cached memory, never a fresh estimate()) so
    // a diagnostic walk cannot re-enter this function via status().
    const zones = zoneStreamer ? zoneStreamer.report() : null;
    const out = {
      current: state.current || null,
      meshes, triangles, visibleMeshes, visibleTriangles, visibleRegionTriangles,
      topVisibleMeshes: topVisibleMeshes.slice(0, 12),
      gpuResidency: null,
      visibility: state.visibility || null,
      renderBudget: state.renderBudget || null,
      dressed: Array.from(dressedRooms),
      zones: zones,
      dressFailures: dressFailures.slice(-8),
      colliders: state.colliders.length,
      k1ModelColliders: state.k1ModelColliderCount,
      k1FloorY: state.k1FloorY,
      k1Model: state.k1ModelMetrics,
      rooms: state.rooms.length,
      regions: state.regions.length
    };
    metricsLast = out;
    if (_tr && !(typeof window !== 'undefined' && window.__sinMetricsTraced)) {
      if (typeof window !== 'undefined') window.__sinMetricsTraced = true;
      _tr('PalaceWings.metrics-end ' + Math.round((performance.now && performance.now() || 0) - _tM) + 'ms meshes=' + meshes);
    }
    return out;
    } finally { metricsBusy = false; }
  }

  /* ---------------------------------------------------------------------------
     K3 map room. Only the files named for this room:
       ارضية الخرائط     -> one square copy, centred, so the sun stays round
       جدار الخرائط 2    -> the single great map, on the far (west) wall
       جدار الخرائط      -> shelves-and-maps mural, on the other walls
       طاولة الخرائط     -> the terrain table, carved face toward the door
       اثاث الخرائط      -> chairs, arch, shelves, scrolls, easel, braziers
     Nothing else in the wing is touched.
  --------------------------------------------------------------------------- */
  const K3_LAZY = {
    table: 'assets/\u0637\u0627\u0648\u0644\u0629 \u0627\u0644\u062E\u0631\u0627\u064A\u0654\u0637.glb',
    furn: 'assets/\u0627\u062B\u0627\u062B_\u0627\u0644\u062E\u0631\u0627\u064A\u0654\u0637.glb'
  };
  let k3Draco = null;
  const k3DracoWait = [];
  function k3EnsureDraco(cb) {
    if (k3Draco) { cb(k3Draco); return; }
    k3DracoWait.push(cb);
    if (k3DracoWait.length > 1) return;
    const finish = loader => {
      if (retired) { loader?.dispose(); loader = null; }
      k3Draco = loader;
      const q = k3DracoWait.splice(0);
      q.forEach(fn => fn(loader));
    };
    const make = () => {
      if (!THREE.DRACOLoader) { finish(null); return; }
      const d = new THREE.DRACOLoader();
      d.setDecoderPath('vendor/draco/');
      d.setWorkerLimit(2);
      finish(d);
    };
    if (THREE.DRACOLoader) { make(); return; }
    const sc = document.createElement('script');
    sc.src = 'vendor/draco/DRACOLoader.js';
    sc.onload = make;
    sc.onerror = () => { console.warn('K3 DRACOLoader failed'); finish(null); };
    document.head.appendChild(sc);
  }
  function k3LoadGLB(url, onLoad) {
    const root = state.root;
    const fail = e => { console.warn('K3 map room model failed', url, e); if (state.root === root) onLoad(null); };
    const cached = preloaded.get(url);
    if (cached && cached.scene) {
      onLoad({ scene: cached.scene.clone(true), animations: cached.animations || [] });
      return;
    }
    // Queue behind other wing GLBs; never parse طاولة الخرائط alongside اثاث.
    enqueueWingLoad(function () {
      return new Promise(function (resolve) {
        k3EnsureDraco(function (draco) {
          if (!draco || !THREE.GLTFLoader) { fail(new Error('DRACOLoader unavailable')); resolve(); return; }
          withMeshopt(function (dec) {
            fetch(encodeURI(url), { signal: stageAbort?.signal }).then(function (res) {
              if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
              return res.arrayBuffer();
            }).then(function (buf) {
              return new Promise(function (resOk, resFail) {
                const loader = new THREE.GLTFLoader();
                loader.setDRACOLoader(draco);
                if (dec) loader.setMeshoptDecoder(dec);
                loader.parse(buf, '', function (gltf) {
                  if (!retired) try { releaseGltfCpu(gltf); } catch (_) {}
                  if (retired) discardStageAsset(gltf);
                  else if (state.root === root) onLoad(gltf); else onLoad(null);
                  resOk();
                }, resFail);
              });
            }).catch(function (e) {
              fail(e);
            }).then(resolve, resolve);
          });
        });
      });
    });
  }
  function k3ClampedMap(url) {
    const tex = corridorTexture(url);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(1, 1);
    return tex;
  }
  // Square sun: the texture is mapped by the short side of the room and the
  // extra length clamps to the border instead of stretching the medallion.
  function k3FloorSheet(solids, y, b) {
    const span = Math.max(1e-4, Math.min(b.x1 - b.x0, b.z1 - b.z0));
    const cx = (b.x0 + b.x1) * 0.5, cz = (b.z0 + b.z1) * 0.5;
    const pos = [], uv = [], nor = [];
    (solids || []).forEach(sol => {
      const outer = cleanPoly(sol.outer, true), holes = (sol.holes || []).map(h => cleanPoly(h, false));
      if (outer.length < 3) return;
      let faces = [];
      try { faces = THREE.ShapeUtils.triangulateShape(outer.map(pt2 => new THREE.Vector2(pt2[0], pt2[1])), holes.map(h => h.map(pt2 => new THREE.Vector2(pt2[0], pt2[1])))); }
      catch (e) { console.error('K3 floor triangulation', e); return; }
      const verts = outer.concat.apply(outer, holes);
      faces.forEach(f => {
        let a = verts[f[0]], b2 = verts[f[1]], c = verts[f[2]];
        const cross = (b2[0] - a[0]) * (c[1] - a[1]) - (b2[1] - a[1]) * (c[0] - a[0]);
        if (cross >= 0) { const t = b2; b2 = c; c = t; }
        [a, b2, c].forEach(pt2 => {
          pos.push(pt2[0], y, pt2[1]);
          uv.push((pt2[0] - cx) / span + 0.5, (pt2[1] - cz) / span + 0.5);
          nor.push(0, 1, 0);
        });
      });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
  // One copy of a mural across a whole wall. U runs to the viewer's right
  // when they face that wall, so the picture is not mirrored.
  function k3WallQuads(segs, b, h, opts) {
    const pos = [], uv = [], nor = [];
    opts = opts || {};
    const minSpan = opts.minSpan == null ? 1.2 : opts.minSpan;
    const endOverlap = opts.endOverlap || 0;
    const bottomOverlap = opts.bottomOverlap == null ? 0.045 : opts.bottomOverlap;
    const topOverlap = opts.topOverlap == null ? 0.055 : opts.topOverlap;
    segs.forEach(r => {
      if (r.s1 - r.s0 < minSpan) return;
      // Overlap adjoining runs at corners and floor/ceiling trims to hide black seams.
      const y0 = r.door ? Math.min(r.door.height, h) : -bottomOverlap, y1 = h + topOverlap;
      if (y1 - y0 < 0.02) return;
      const ix = -r.nx * r.inset, iz = -r.nz * r.inset;
      const s0 = r.s0 - endOverlap, s1 = r.s1 + endOverlap;
      const P = s => [r.a[0] + r.tx * s + ix, r.a[1] + r.tz * s + iz];
      const p0 = P(s0), p1 = P(s1);
      const along = p => {
        // corridorWallRuns stores the outward normal (away from the room).
        if (Math.abs(r.nx) >= Math.abs(r.nz)) {
          const len = Math.max(1e-4, b.z1 - b.z0);
          return r.nx > 0 ? (p[1] - b.z0) / len : (b.z1 - p[1]) / len;
        }
        const len = Math.max(1e-4, b.x1 - b.x0);
        return r.nz > 0 ? (b.x1 - p[0]) / len : (p[0] - b.x0) / len;
      };
      const u0 = along(p0), u1 = along(p1);
      const A = [p0[0], y0, p0[1]], B = [p1[0], y0, p1[1]], Cq = [p1[0], y1, p1[1]], D = [p0[0], y1, p0[1]];
      const uA = [u0, y0 / h], uB = [u1, y0 / h], uC = [u1, y1 / h], uD = [u0, y1 / h];
      const fx = -r.nx, fz = -r.nz;
      const e1 = [B[0] - A[0], 0, B[2] - A[2]];
      const want = (-e1[2]) * fx + e1[0] * fz > 0;
      const tri = want ? [A, B, Cq, A, Cq, D] : [A, Cq, B, A, D, Cq];
      const tuv = want ? [uA, uB, uC, uA, uC, uD] : [uA, uC, uB, uA, uD, uC];
      tri.forEach((p, i) => { pos.push(p[0], p[1], p[2]); uv.push(tuv[i][0], tuv[i][1]); nor.push(fx, 0, fz); });
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    return geo;
  }
  function k3WallMaterial(url) {
    const m = new THREE.MeshStandardMaterial({
      map: k3ClampedMap(url), roughness: 0.72, metalness: 0.06,
      emissive: new THREE.Color(0x1a140c), emissiveIntensity: 0.12
    });
    state.materials.push(m);
    return m;
  }
  /* ---------------------------------------------------------------------------
     K4 royal treasury. This room is dressed only with its repository artwork
     and the three authored GLB groups; debug placeholders and procedural
     dressing are intentionally excluded from K4.
  --------------------------------------------------------------------------- */
  function limitK4TextureSize(root, maxEdge) {
    const seen = new Set();
    let resized = 0;
    const keys = ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'bumpMap'];
    root.traverse(function (node) {
      if (!node.isMesh || !node.material) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach(function (material) {
        if (!material) return;
        keys.forEach(function (key) {
          const texture = material[key];
          // A compressed twin (ktx2-textures.js) is already encoded at the K4 size.
          if (!texture || seen.has(texture) || texture.isCompressedTexture) return;
          seen.add(texture);
          const image = texture.image || (texture.source && texture.source.data);
          const width = image && (image.naturalWidth || image.videoWidth || image.width || 0);
          const height = image && (image.naturalHeight || image.videoHeight || image.height || 0);
          if (!width || !height || Math.max(width, height) <= maxEdge) return;
          const scale = maxEdge / Math.max(width, height);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          const context = canvas.getContext('2d');
          if (!context) return;
          try {
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            texture.image = canvas;
            if (texture.source && texture.source.data === image) texture.source.data = canvas;
            texture.needsUpdate = true;
            resized++;
          } catch (error) {
            console.warn('تعذر تصغير خامة من أصول K4', error);
          }
        });
      });
    });
    return resized;
  }
  function k4TextureEdge() {
    if (window.SinDevice) {
      const p = SinDevice.detect();
      return p.k4TextureSize || (p.constrained ? 512 : 1024);
    }
    const nav = window.navigator || {};
    const touchDevice = (nav.maxTouchPoints || 0) > 1 && Math.min(window.innerWidth || 0, window.innerHeight || 0) <= 1024;
    const mobileDevice = /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || '') || touchDevice;
    const lowMemory = Number(nav.deviceMemory || 0) > 0 && Number(nav.deviceMemory) <= 4;
    return mobileDevice || lowMemory ? 512 : 1024;
  }
  // Places one object of a K4 kit. `source` is the named node from the kit
  // (shared geometry/material/texture; only the transform is cloned).
  function k4PlaceAsset(dress, spec, source, rootAtRequest) {
    if (!source || state.root !== rootAtRequest || state.k4Dress !== dress) return;
    const model = new THREE.Group();
    model.add(source.clone(true));
    model.updateMatrixWorld(true);
    const sourceBox = new THREE.Box3().setFromObject(model);
    const sourceSize = sourceBox.getSize(new THREE.Vector3());
    const sourceCenter = sourceBox.getCenter(new THREE.Vector3());
    if (!(sourceSize.x > 0 && sourceSize.y > 0 && sourceSize.z > 0)) {
      dress.errors.push(spec.name + ': invalid model bounds');
      return;
    }
    const scale = spec.fitWidth
      ? Math.min(spec.fitWidth / sourceSize.x, spec.fitHeight / sourceSize.y)
      : spec.fitHeight / sourceSize.y;
    model.scale.setScalar(scale);
    model.position.set(-sourceCenter.x * scale, -sourceBox.min.y * scale, -sourceCenter.z * scale);
    model.name = spec.name + '-source';
    model.traverse(function (node) {
      if (!node.isMesh) return;
      node.castShadow = spec.collider !== false;
      node.receiveShadow = true;
    });
    const holder = new THREE.Group();
    holder.name = spec.name;
    holder.position.set(spec.x, spec.y || 0, spec.z);
    holder.rotation.y = spec.rotation || 0;
    const resizedTextures = limitK4TextureSize(model, k4TextureEdge());
    holder.add(model);
    dress.host.add(holder);
    rootAtRequest.updateMatrixWorld(true);
    if (spec.collider !== false) {
      const worldBox = new THREE.Box3().setFromObject(holder);
      state.colliders.push({
        minx: worldBox.min.x - rootAtRequest.position.x,
        maxx: worldBox.max.x - rootAtRequest.position.x,
        miny: Math.max(0, worldBox.min.y - rootAtRequest.position.y),
        maxy: worldBox.max.y - rootAtRequest.position.y,
        minz: worldBox.min.z - rootAtRequest.position.z,
        maxz: worldBox.max.z - rootAtRequest.position.z,
        _wing: true, _k4Prop: true
      });
    }
    dress.loaded[spec.name] = true;
    if (spec.item === 'k4_frontMural') dress.frontWall = true;
    dress.metrics[spec.name] = {
      item: spec.item, scale: +scale.toFixed(4),
      fittedHeight: +(sourceSize.y * scale).toFixed(3), resizedTextures: resizedTextures
    };
  }
  // Each kit file is fetched once when K4 enters the camera prefetch wedge.
  // All kits are decoded first and all props are attached in one commit, so
  // the player never sees a half-dressed treasury.
  function loadK4Assets() {
    const dress = state.k4Dress;
    if (!dress || dress.loadStarted || !dress.assetSpecs || !dress.assetSpecs.length) return;
    dress.loadStarted = true;
    const rootAtRequest = state.root;
    const kits = [];
    dress.assetSpecs.forEach(function (spec) { if (kits.indexOf(spec.url) < 0) kits.push(spec.url); });
    const loaded = [];
    let pending = kits.length;
    const finish = function () {
      if (pending || state.root !== rootAtRequest) return;
      // If the dress object was replaced mid-flight, still commit onto a
      // waiting dress for the same host rather than discarding a completed parse.
      let target = dress;
      if (state.k4Dress !== dress) {
        const cur = state.k4Dress;
        if (cur && cur.host === dress.host && !cur._assetsCommitted) target = cur;
        else return;
      }
      loaded.forEach(function (entry) {
        entry.gltf.scene.updateMatrixWorld(true);
        (target.assetSpecs || dress.assetSpecs).filter(function (spec) { return spec.url === entry.url; }).forEach(function (spec) {
          const src = entry.gltf.scene.getObjectByName(spec.item);
          if (!src) target.errors.push(spec.name + ': missing node ' + spec.item);
          else k4PlaceAsset(target, spec, src, rootAtRequest);
        });
      });
      rebuildSpatial();
      rootAtRequest.updateMatrixWorld(true);
      target._assetsCommitted = true;
      if (target.host && target.host.userData) target.host.userData.k4Dressed = true;
      markDressReady('K4');
    };
    kits.forEach(function (url) {
      wingGLB(url, function (gltf) {
        if (gltf && state.root === rootAtRequest) loaded.push({ url: url, gltf: gltf });
        else if (!gltf) dress.errors.push(url + ': failed to decode');
        pending -= 1;
        finish();
      }, function (error) {
        dress.errors.push(url + ': ' + (error && error.message ? error.message : String(error || 'load failed')));
        console.error('K4 treasury asset failed', url, error);
        pending -= 1;
        finish();
      });
    });
  }
  function dressK4() {
    const r = state.rooms.find(function (room) { return room.id === 'K4'; });
    const g = state.regionGroups.get('K4');
    if (!r || !g) {
      try { console.warn('[palace load] K4 dress skipped', !r ? 'no-room' : 'no-group'); } catch (_) {}
      return;
    }
    // Second visit after eviction must re-dress, but an in-flight load must
    // never be replaced: finish() used to no-op when k4Dress changed, and
    // ensureCurrentDress then started a new 12 s parse (playthrough-4 first
    // K4: five re-parses, complete false, 60 s). Keep the in-flight dress.
    if (state.k4Dress && state.k4Dress.loadStarted && !state.k4Dress._assetsCommitted) return;
    // Two overlapping load() calls must not stack a second floor on a
    // still-resident first dress.
    if (state.k4Dress && state.k4Dress.host === g) {
      const floors = findNamed(g, 'K4-treasury-floor-artwork');
      if (floors && floors.length) return;
    }
    const b = r.bbox, h = r.height, w = b.x1 - b.x0, d = b.z1 - b.z0;
    const dress = state.k4Dress = {
      host: g, bbox: b, floor: false, walls: false, ceiling: false, frontWall: false,
      loaded: {}, metrics: {}, errors: [], loadStarted: false, assetSpecs: []
    };

    // One artwork copy spans the complete room footprint: the room aspect ratio
    // matches the supplied 1672 x 941 floor/ceiling images, leaving no bare gaps.
    const floorMat = new THREE.MeshStandardMaterial({
      map: k3ClampedMap(WING_FILES.k4Floor), roughness: 0.38, metalness: 0.025,
      emissive: new THREE.Color(0x120c07), emissiveIntensity: 0.055
    });
    state.materials.push(floorMat);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
    floor.name = 'K4-treasury-floor-artwork';
    floor.rotation.x = -Math.PI / 2;
    // Turned 180 deg so, as in the reference picture, the carpet lies under the
    // altar table at the back and the winged-lion medallion is nearest the door.
    floor.rotation.z = Math.PI;
    floor.position.set(b.cx, 0.018, b.cz);
    floor.receiveShadow = true;
    floor.renderOrder = 2;
    g.add(floor);
    hideUntilReady(floor);
    if (state.floorMeshes) state.floorMeshes.push(floor);
    dress.floor = true;

    const area = solid(r.poly);
    const freeArea = difference(area, state.baseWall);
    const wallsHere = intersection(state.baseWall, offset(area, 1.6));
    const runs = corridorWallRuns(wallsHere, freeArea);
    const lintels = [];
    state.doors.filter(function (door) {
      return door.kind !== 'arch' && door.openPoly && (door.from === 'K4' || door.to === 'K4');
    }).forEach(function (door) {
      const opening = solid(door.openPoly);
      corridorWallRuns(opening, difference(freeArea, opening)).forEach(function (segment) {
        segment.door = door;
        lintels.push(segment);
      });
    });
    const wallGeo = k3WallQuads(runs.concat(lintels), b, h);
    if (wallGeo.attributes.position.count) {
      hideUntilReady(mesh(wallGeo, k3WallMaterial(WING_FILES.k4SideWall), 'K4-treasury-decorated-walls', g));
    } else wallGeo.dispose();
    dress.walls = true;

    const ceilingMap = k3ClampedMap(WING_FILES.k4Ceiling);
    const ceilingMat = new THREE.MeshStandardMaterial({
      map: ceilingMap, color: 0xf0dfbd, roughness: 0.82, metalness: 0.01,
      side: THREE.DoubleSide, emissive: new THREE.Color(0x1a1007), emissiveIntensity: 0.09
    });
    state.materials.push(ceilingMat);
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilingMat);
    ceiling.name = 'K4-treasury-ceiling-artwork';
    ceiling.rotation.x = -Math.PI / 2;
    ceiling.position.set(b.cx, h - 0.045, b.cz);
    ceiling.receiveShadow = true;
    ceiling.userData.ceiling = true;
    ceiling.visible = !state.cutaway;
    g.add(ceiling);
    hideUntilReady(ceiling);
    state.ceilings.push(ceiling);
    dress.ceiling = true;

    // Layout copied from the treasury reference picture, seen from the K4
    // entrance (door at z0, looking +Z toward the mural on the back wall z1).
    // X = offset from the room centre (negative = left), Z = metres in front
    // of the back wall. Objects face +Z in their kit; rotation PI faces the
    // door, PI/2 faces +X (left wall), -PI/2 faces -X (right wall).
    const P = Math.PI, A = WING_FILES.k4KitA, B = WING_FILES.k4KitB, Cc = WING_FILES.k4KitC;
    const at = function (url, item, X, Z, rotation, fitHeight, extra) {
      // Looking from the door toward +Z, the viewer's left is +X, so X is mirrored
      // (and so are the yaw angles) to keep the picture's left/right exactly.
      return Object.assign({ url: url, item: item, x: b.cx - X, z: b.z1 - Z, rotation: -rotation, fitHeight: fitHeight }, extra || {});
    };
    const L = -w / 2, R = w / 2;
    dress.assetSpecs = [
      // Back wall: winged-disc mural with its arch, statues, vases and chest.
      at(WING_FILES.k4FrontWall, 'k4_frontMural', 0, 0.2, 0, Math.max(1, h - 0.4), { y: 0.05, fitWidth: 12.0, collider: false }),
      // Two tiled columns framing the mural, each carrying a hanging banner.
      at(Cc, 'k4_column', -6.9, 1.2, P, h - 0.05),
      at(Cc, 'k4_column', 6.9, 1.2, P, h - 0.05),
      at(A, 'k4_banner', -6.9, 2.75, P, 3.6, { y: 3.0, collider: false }),
      at(B, 'k4_bannerB', 6.9, 2.75, P, 3.6, { y: 3.0, collider: false }),
      // Potted palms between the columns and the mural.
      at(Cc, 'k4_palmPot', -4.4, 1.5, P, 2.5),
      at(Cc, 'k4_palmPot', 4.4, 1.5, P, 2.5),
      at(Cc, 'k4_palmPot', L + 1.0, 3.2, P / 2, 2.6),
      // Chandelier hanging over the altar table.
      at(B, 'k4_chandelier', 0, 3.8, 0, 3.0, { y: h - 3.3, collider: false }),
      // Centre: lion-legged altar table with the crown and gold vessels.
      at(A, 'k4_altarTable', 0, 3.8, P, 1.7),
      // Left side: crowned king statue on its plinth, brazier, chests and vases.
      at(B, 'k4_kingStatue', L + 2.6, 2.4, P * 0.82, 4.4),
      at(B, 'k4_brazier', -5.3, 3.2, P, 1.9),
      at(A, 'k4_goldChest', L + 1.4, 8.8, P / 2, 1.45),
      at(A, 'k4_goldChest', L + 1.3, 6.6, P / 2, 1.3),
      at(A, 'k4_vaseA', L + 0.9, 10.9, P * 0.75, 1.15),
      at(B, 'k4_vaseB', L + 0.8, 4.6, P / 2, 1.0),
      at(A, 'k4_vaseA', -3.6, 2.2, P, 1.2),
      // Right side: two arched treasure shelves on the wall, candelabrum,
      // reclining lion, brazier, chests and vases.
      at(A, 'k4_shelfCabinet', R - 0.9, 3.4, -P / 2, 3.4),
      at(A, 'k4_shelfCabinet', R - 0.9, 6.0, -P / 2, 3.4),
      at(A, 'k4_candelabra', 4.3, 4.2, P, 2.3),
      at(B, 'k4_lionSphinx', R - 2.4, 7.4, -P / 2, 1.6),
      at(B, 'k4_brazier', R - 0.9, 8.2, -P / 2, 2.1),
      at(A, 'k4_goldChest', R - 1.4, 9.4, -P / 2, 1.35),
      at(A, 'k4_goldChest', 5.4, 8.6, P * 1.1, 1.2),
      at(B, 'k4_vaseB', 5.6, 10.2, P, 0.85),
      at(A, 'k4_vaseA', 3.6, 2.2, P, 1.2)
    ].map(function (spec, i) { spec.name = 'K4-' + spec.item.replace('k4_', '') + '-' + i; return spec; });

  }
  // اثاث الخرائط is one fused mesh. The six objects sit apart, so a small
  // gap in the vertex cloud is enough to separate them.
  function k3SplitFurniture(root) {
    let src = null;
    root.updateMatrixWorld(true);
    root.traverse(o => { if (!src && o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) src = o; });
    if (!src) return [];
    const g = src.geometry.clone();
    g.applyMatrix4(src.matrixWorld);
    const pos = g.attributes.position, n = pos.count, eps = 0.008;
    let minx = 1e9, miny = 1e9, minz = 1e9;
    for (let i = 0; i < n; i++) {
      if (pos.getX(i) < minx) minx = pos.getX(i);
      if (pos.getY(i) < miny) miny = pos.getY(i);
      if (pos.getZ(i) < minz) minz = pos.getZ(i);
    }
    const cell = new Map();
    const keyOf = i => Math.floor((pos.getX(i) - minx) / eps) + ',' + Math.floor((pos.getY(i) - miny) / eps) + ',' + Math.floor((pos.getZ(i) - minz) / eps);
    for (let i = 0; i < n; i++) { const k = keyOf(i); if (!cell.has(k)) cell.set(k, i); }
    const parent = new Map();
    const find = a => {
      let p = parent.has(a) ? parent.get(a) : a;
      if (!parent.has(a)) parent.set(a, a);
      while (p !== parent.get(p)) { parent.set(p, parent.get(parent.get(p))); p = parent.get(p); }
      parent.set(a, p); return p;
    };
    const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent.set(b, a); };
    cell.forEach((vi, k) => {
      const parts = k.split(',');
      const x = +parts[0], y = +parts[1], z = +parts[2];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const nk = (x + dx) + ',' + (y + dy) + ',' + (z + dz);
        if (cell.has(nk)) uni(k, nk);
      }
    });
    const idx = g.index;
    if (!idx) return [];
    const triCount = idx.count / 3;
    const rootOf = new Map(), groups = new Map();
    for (let t = 0; t < triCount; t++) {
      const a = idx.getX(t * 3), k = keyOf(a), r = find(k);
      let id = rootOf.get(r);
      if (id == null) { id = rootOf.size; rootOf.set(r, id); }
      let bucket = groups.get(id);
      if (!bucket) groups.set(id, bucket = []);
      bucket.push(idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2));
    }
    const pieces = [];
    groups.forEach(list => {
      if (list.length < 800 * 3) return;
      const map = new Map(), arr = [], iarr = [];
      const push = vi => {
        let m = map.get(vi);
        if (m != null) return m;
        m = map.size; map.set(vi, m);
        arr.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
        return m;
      };
      for (let i = 0; i < list.length; i++) iarr.push(push(list[i]));
      const ng = new THREE.BufferGeometry();
      ng.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      ng.setIndex(iarr);
      if (g.attributes.normal) {
        const nr = g.attributes.normal, narr = new Float32Array(map.size * 3);
        map.forEach((m, vi) => { narr[m * 3] = nr.getX(vi); narr[m * 3 + 1] = nr.getY(vi); narr[m * 3 + 2] = nr.getZ(vi); });
        ng.setAttribute('normal', new THREE.BufferAttribute(narr, 3));
      } else ng.computeVertexNormals();
      if (g.attributes.uv) {
        const uv = new Float32Array(map.size * 2);
        map.forEach((m, vi) => { uv[m * 2] = g.attributes.uv.getX(vi); uv[m * 2 + 1] = g.attributes.uv.getY(vi); });
        ng.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      }
      ng.computeBoundingBox();
      const bb = ng.boundingBox, sz = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
      pieces.push({ geo: ng, mat: src.material, size: sz, center: c, min: bb.min.clone(), tris: iarr.length / 3 });
    });
    return pieces;
  }
  function k3Kind(p) {
    const sx = p.size.x, sz = p.size.z, cy = p.center.y, cz = p.center.z;
    if (Math.min(sx, sz) < 0.11 && Math.max(sx, sz) > 0.4) return cy < 0 ? 'shelf' : 'arch';
    if (sz > 0.28 && sx > 0.22) return 'easel';
    if (cz < -0.35 && cy > 0) return 'chair';
    if (cz < -0.3) return 'brazier';
    return 'scrolls';
  }
  function k3Seat(piece, targetH) {
    const s = targetH / Math.max(1e-4, piece.size.y);
    const geo = piece.geo;
    geo.translate(-piece.center.x, -piece.min.y, -piece.center.z);
    geo.computeBoundingSphere();
    return { geo, s, size: piece.size.clone().multiplyScalar(s), mat: piece.mat };
  }
  function k3Put(host, seated, x, z, rot, name) {
    const holder = new THREE.Group();
    holder.name = name;
    holder.position.set(x, 0, z);
    holder.rotation.y = rot;
    const meshObj = new THREE.Mesh(seated.geo, seated.mat);
    meshObj.name = name + '-mesh';
    meshObj.scale.setScalar(seated.s);
    meshObj.castShadow = false;
    meshObj.receiveShadow = true;
    holder.add(meshObj);
    hideUntilReady(holder);
    host.add(holder);
    const hx = seated.size.x * 0.5, hz = seated.size.z * 0.5;
    const c = Math.abs(Math.cos(rot)), sn = Math.abs(Math.sin(rot));
    const wx = hx * c + hz * sn, wz = hx * sn + hz * c;
    state.colliders.push({
      minx: x - wx, maxx: x + wx, miny: 0, maxy: seated.size.y,
      minz: z - wz, maxz: z + wz, _wing: true, _k3Prop: true
    });
  }
  function k3PlaceFurniture() {
    const dress = state.k3Dress;
    if (!dress || dress.placed || !dress.by || !dress.tableHalf || !dress.host) return;
    const g = dress.host, b = dress.bbox, by = dress.by;
    const need = ['shelf', 'arch', 'chair', 'easel', 'brazier', 'scrolls'];
    if (need.some(k => !by[k])) { console.warn('K3 furniture incomplete', need.filter(k => !by[k])); return; }
    dress.placed = true;
    const shelf = k3Seat(by.shelf, 1.5);
    const arch = k3Seat(by.arch, 3.5);
    const chair = k3Seat(by.chair, 1.28);
    const easel = k3Seat(by.easel, 1.85);
    const braz = k3Seat(by.brazier, 1.4);
    const scrolls = k3Seat(by.scrolls, 1.5);
    k3Put(g, shelf, b.x0 + 5.0, b.z0 + shelf.size.x * 0.5 + 0.05, Math.PI / 2, 'K3-shelf-a');
    k3Put(g, shelf, b.x0 + 10.6, b.z1 - shelf.size.x * 0.5 - 0.05, -Math.PI / 2, 'K3-shelf-b');
    k3Put(g, arch, b.x0 + 3.5, b.z1 - arch.size.x * 0.5 - 0.04, -Math.PI / 2, 'K3-arch');
    k3Put(g, scrolls, b.x0 + 7.0, b.z1 - 2.2, 0.4, 'K3-scrolls');
    k3Put(g, braz, b.x0 + 0.85, b.z0 + 2.5, 0, 'K3-brazier-s');
    k3Put(g, braz, b.x0 + 0.85, b.z0 + 9.5, Math.PI, 'K3-brazier-n');
    k3Put(g, easel, b.x0 + 13.0, b.z0 + 9.0, 2.4, 'K3-easel');
    const tx = dress.tableHalf.x, tz = dress.tableHalf.z;
    const cd = chair.size.x * 0.5 + 0.18;
    k3Put(g, chair, b.cx - tx - cd, b.cz, 0, 'K3-chair-head');
    k3Put(g, chair, b.cx - 1.25, b.cz + tz + cd, -Math.PI / 2, 'K3-chair-n1');
    k3Put(g, chair, b.cx + 1.25, b.cz + tz + cd, -Math.PI / 2, 'K3-chair-n2');
    k3Put(g, chair, b.cx - 1.25, b.cz - tz - cd, Math.PI / 2, 'K3-chair-s1');
    k3Put(g, chair, b.cx + 1.25, b.cz - tz - cd, Math.PI / 2, 'K3-chair-s2');
    dress.furniture = true;
    rebuildSpatial();
    if (state.root) state.root.updateMatrixWorld(true);
  }
  function dressK3(api) {
    const r = state.rooms.find(q => q.id === 'K3'), g = state.regionGroups.get('K3');
    if (!r || !g) return;
    const b = r.bbox, h = r.height;
    state.k3Dress = { floor: false, walls: false, table: false, furniture: false, placed: false, bbox: b, host: g, tableHalf: null, by: null };
    const floorMat = new THREE.MeshStandardMaterial({
      map: k3ClampedMap(WING_FILES.k3Floor), roughness: 0.45, metalness: 0.08,
      emissive: new THREE.Color(0x120e0a), emissiveIntensity: 0.07
    });
    floorMat.polygonOffset = true; floorMat.polygonOffsetFactor = -2; floorMat.polygonOffsetUnits = -2;
    state.materials.push(floorMat);
    const floorMesh = mesh(k3FloorSheet(state.k3FloorSolids || solid(r.poly), 0.014, b), floorMat, 'K3-map-floor', g);
    floorMesh.renderOrder = 2;
    hideUntilReady(floorMesh);
    state.k3Dress.floor = true;
    if (state.floorMeshes) state.floorMeshes.push(floorMesh);

    const area = solid(r.poly);
    const freeArea = difference(area, state.baseWall);
    const wallsHere = intersection(state.baseWall, offset(area, 1.6));
    const runs = corridorWallRuns(wallsHere, freeArea);
    const lintelRuns = [];
    state.doors.filter(d => d.kind !== 'arch' && d.openPoly && (d.from === 'K3' || d.to === 'K3')).forEach(d => {
      const op = solid(d.openPoly);
      corridorWallRuns(op, difference(freeArea, op)).forEach(l => { l.door = d; lintelRuns.push(l); });
    });
    const far = [], side = [];
    // Outward normal -X is the far (west) wall, opposite the door.
    runs.concat(lintelRuns).forEach(seg => { (seg.nx < -0.5 ? far : side).push(seg); });
    const farGeo = k3WallQuads(far, b, h), sideGeo = k3WallQuads(side, b, h);
    if (farGeo.attributes.position.count) hideUntilReady(mesh(farGeo, k3WallMaterial(WING_FILES.k3WallFar), 'K3-map-wall-far', g));
    else farGeo.dispose();
    if (sideGeo.attributes.position.count) hideUntilReady(mesh(sideGeo, k3WallMaterial(WING_FILES.k3Wall), 'K3-map-wall-side', g));
    else sideGeo.dispose();
    state.k3Dress.walls = true;
    // Tile the supplied Babylonian ceiling artwork across the actual room footprint.
    const ceilingMap = corridorTexture(WING_FILES.k3Ceiling);
    ceilingMap.repeat.set(Math.max(1, (b.x1 - b.x0) / 4), Math.max(1, (b.z1 - b.z0) / 4));
    const ceilingMat = new THREE.MeshStandardMaterial({ map: ceilingMap, color: 0xd8c39a, roughness: 0.88, metalness: 0.01, side: THREE.DoubleSide });
    state.materials.push(ceilingMat);
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(b.x1 - b.x0, b.z1 - b.z0), ceilingMat);
    ceiling.name = 'K3-map-ceiling';
    ceiling.rotation.x = -Math.PI / 2;
    ceiling.position.set(b.cx, h - 0.08, b.cz);
    ceiling.receiveShadow = true;
    ceiling.castShadow = false;
    ceiling.userData.ceiling = true;
    ceiling.visible = !state.cutaway;
    g.add(ceiling);
    hideUntilReady(ceiling);
    state.ceilings.push(ceiling);
    state.k3Dress.ceiling = true;

    // K3 fire positions are exported to PalaceInterior and served by its
    // fixed light budget; do not add room-local PointLights here.
    state.k3Lights = [];
    state.k3LightBase = [];

    // Sequential: table first, then furniture. طاولة الخرائط is never fetched
    // unless K3 is in the hop≤1 prepared set (dressK3 only runs then).
    k3LoadGLB(K3_LAZY.table, gltf => {
      const dress = state.k3Dress;
      if (!dress || dress.host !== g) return;
      if (!gltf) { dress.tableHalf = { x: 2.16, z: 2.20 }; }
      else {
        const model = gltf.scene;
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
        const s = 1.12 / Math.max(1e-4, size.y);
        model.scale.setScalar(s);
        model.position.set(-c.x * s, -box.min.y * s, -c.z * s);
        const holder = new THREE.Group();
        holder.name = 'K3-map-table';
        holder.position.set(b.cx, 0, b.cz);
        holder.rotation.y = -Math.PI / 2;
        holder.add(model);
        model.traverse(o => {
          if (!o.isMesh) return;
          o.castShadow = false; o.receiveShadow = true;
          const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
          mats.forEach(softenWingMetal);
        });
        hideUntilReady(holder);
        g.add(holder);
        const hx = size.z * s * 0.5, hz = size.x * s * 0.5;
        state.colliders.push({
          minx: b.cx - hx, maxx: b.cx + hx, miny: 0, maxy: size.y * s,
          minz: b.cz - hz, maxz: b.cz + hz, _wing: true, _k3Prop: true
        });
        dress.table = true;
        dress.tableHalf = { x: hx, z: hz };
        dress.tableSize = size.toArray();
        rebuildSpatial();
      }
      k3LoadGLB(K3_LAZY.furn, gltf2 => {
        const dress2 = state.k3Dress;
        if (!dress2 || dress2.host !== g) return;
        if (gltf2) {
          const pieces = k3SplitFurniture(gltf2.scene);
          const by = {};
          pieces.forEach(p => {
            const k = k3Kind(p);
            if (!by[k] || p.tris > by[k].tris) by[k] = p;
          });
          dress2.by = by;
          dress2.pieceReport = pieces.map(p => ({ kind: k3Kind(p), size: [p.size.x, p.size.y, p.size.z].map(n => +n.toFixed(3)) }));
        }
        k3PlaceFurniture();
        // Do NOT mark ready if the table or a furniture kind is missing —
        // that was revealing an empty (walls-only) K3 and opening the door
        // onto a pop-in. The door gate waits on zoneIsReady / isComplete.
        if (!dress2.furniture||!dress2.table)return;
        const controller=new AbortController();
        dress2.lunarLoad=controller;
        loadLunarTablet('K3',g,g.getObjectByName('K3-map-table'),controller.signal,api).then(clue=>{
          if(state.k3Dress!==dress2||controller.signal.aborted)return;
          dress2.lunar=clue;
          api.add(clue.frame);
          zoneStreamer.markReleasable(clue.frame);
          g.userData.k3Dressed=true;
          markDressReady('K3');
          api.done();
        },error=>{
          if(state.k3Dress===dress2&&!controller.signal.aborted)api.fail(error);
        });
      });
    });
  }


  // Named assets that MUST be resident before a streamed room is revealed or
  // its door opens. Walls-only is not complete (the K3/K4 pop-in). Visibility
  // is checked separately (`revealed`) after the atomic dress reveal.
  /* ---------------------------------------------------------------------------
     K5 king private wing. Dressed only with the repository assets, laid out
     after the king-bedroom reference picture: canopy bed on its round stepped
     dais against the west wall under the king mural, winged lions on plinths
     flanking it, the woman mural (twin arches) on the opposite east wall,
     and the pieces cut from اثاث الخزانة 2 around the room. No procedural props.
  --------------------------------------------------------------------------- */
  const K5_DAIS = { radius: 3.6, height: 0.66, wallGap: 0.3 };
  function k5Dais(b) {
    return { cx: b.x0 + K5_DAIS.wallGap + K5_DAIS.radius, cz: b.cz, r: K5_DAIS.radius, h: K5_DAIS.height };
  }
  // Walkable profile of درج السرير: three tiers (outer ring, middle ring, top).
  function k5DaisHeight(b, x, z) {
    const d = k5Dais(b), r = Math.hypot(x - d.cx, z - d.cz);
    if (r > d.r) return 0;
    if (r > d.r * 0.85) return d.h / 3;
    if (r > d.r * 0.77) return d.h * 2 / 3;
    return d.h;
  }
  // Pieces of اثاث الخزانة 2 after k3SplitFurniture, identified by their
  // centre in the source file. yaw turns the piece's own front to +Z.
  const K5_PIECES = [
    { kind: 'throne', c: [-0.157, -0.178, 0.37], yaw: 0 },
    { kind: 'chandelier', c: [0.16, -0.191, -0.34], yaw: 0 },
    { kind: 'sphinx', c: [0.033, 0.141, -0.198], yaw: 0 },
    { kind: 'statue', c: [-0.162, 0.178, 0.405], yaw: -Math.PI / 2 },
    { kind: 'brazier', c: [-0.034, -0.188, 0.102], yaw: 0 },
    { kind: 'banner', c: [0.145, 0.182, -0.422], yaw: -Math.PI / 2 },
    { kind: 'winged-disc', c: [-0.07, 0.186, 0.134], yaw: -Math.PI / 2 },
    { kind: 'vase', c: [0.016, -0.205, -0.121], yaw: 0 }
  ];
  function k5Classify(pieces) {
    const by = {};
    K5_PIECES.forEach(function (ref) {
      let best = null, bestD = 0.06;
      pieces.forEach(function (p) {
        if (p._used) return;
        const d = Math.hypot(p.center.x - ref.c[0], p.center.y - ref.c[1], p.center.z - ref.c[2]);
        if (d < bestD) { bestD = d; best = p; }
      });
      if (best) { best._used = true; by[ref.kind] = { piece: best, yaw: ref.yaw }; }
    });
    return by;
  }
  // Facing f: the object's front points to (sin f, 0, cos f).
  function k5Collider(x, z, sx, sz, rot, y0, y1) {
    const c = Math.abs(Math.cos(rot)), sn = Math.abs(Math.sin(rot));
    const wx = sx * 0.5 * c + sz * 0.5 * sn, wz = sx * 0.5 * sn + sz * 0.5 * c;
    state.colliders.push({ minx: x - wx, maxx: x + wx, miny: y0, maxy: y1, minz: z - wz, maxz: z + wz, _wing: true, _k5Prop: true });
  }
  function k5PlaceFurniture(dress, by) {
    const g = dress.host, b = dress.bbox, h = dress.height, D = k5Dais(b), P = Math.PI;
    const seated = {};
    Object.keys(by).forEach(function (k) {
      const p = by[k].piece;
      p.geo.translate(-p.center.x, -p.min.y, -p.center.z);
      p.geo.computeBoundingSphere();
      seated[k] = p;
    });
    let n = 0;
    const put = function (kind, x, z, facing, fitH, opt) {
      const p = seated[kind];
      if (!p) { dress.errors.push('missing piece ' + kind); return; }
      opt = opt || {};
      const s = fitH / Math.max(1e-4, p.size.y), rot = facing + by[kind].yaw, y = opt.y || 0;
      const holder = new THREE.Group();
      holder.name = 'K5-' + kind + '-' + (n++);
      holder.position.set(x, y, z);
      holder.rotation.y = rot;
      const m = new THREE.Mesh(p.geo, p.mat);
      m.name = holder.name + '-mesh';
      m.scale.setScalar(s);
      m.castShadow = false; m.receiveShadow = true;
      holder.add(m);
      hideUntilReady(holder);
      g.add(holder);
      if (opt.collider !== false) k5Collider(x, z, p.size.x * s, p.size.z * s, rot, y, y + p.size.y * s);
    };
    const edge = D.cx + D.r;
    // Winged lions on their plinths, flanking the bed and facing the room.
    put('sphinx', b.x0 + 1.45, b.cz - 4.7, P / 2, 1.7);
    put('sphinx', b.x0 + 1.45, b.cz + 4.7, P / 2, 1.7);
    // Winged disc above the headboard, on the king mural.
    put('winged-disc', b.x0 + 0.3, b.cz, P / 2, 1.0, { y: 4.4, collider: false });
    // Fire bowls at the foot of the dais steps.
    put('brazier', edge + 0.9, b.cz - 2.8, -P / 2, 1.5);
    put('brazier', edge + 0.9, b.cz + 2.8, -P / 2, 1.5);
    // Moon banners on the side walls beside the bed.
    put('banner', b.x0 + 7.0, b.z0 + 0.45, 0, 3.2, { y: 1.3, collider: false });
    put('banner', b.x0 + 7.0, b.z1 - 0.45, P, 3.2, { y: 1.3, collider: false });
    // Tall vases in the four corners.
    put('vase', b.x0 + 0.9, b.z0 + 0.9, P / 4, 1.3);
    put('vase', b.x0 + 0.9, b.z1 - 0.9, 3 * P / 4, 1.3);
    put('vase', b.x1 - 0.9, b.z0 + 0.9, -P / 4, 1.3);
    put('vase', b.x1 - 0.9, b.z1 - 0.9, -3 * P / 4, 1.3);
    // Crowned statues frame the balcony. Keep the lion throne in its side
    // bay, so its tall back does not mask the arches or the sitting group.
    put('statue', b.x1 - 1.0, b.cz - 5.4, -P / 2, 2.8);
    put('statue', b.x1 - 1.0, b.cz + 5.4, -P / 2, 2.8);
    put('throne', b.cx + 4.35, b.cz + 6.32, -2 * P / 3, 1.9);
    // Hanging lamp over the middle of the room.
    // The chandelier is loaded separately from the dedicated المجلس GLB.
    dress.furniture = true;
  }
  function k5PlaceModel(dress, gltf, name, x, z, y, facing, sx, sy, sz, collider) {
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const kx = sx / Math.max(1e-4, size.x), ky = sy / Math.max(1e-4, size.y), kz = sz / Math.max(1e-4, size.z);
    model.scale.set(kx, ky, kz);
    model.position.set(-c.x * kx, -box.min.y * ky, -c.z * kz);
    const holder = new THREE.Group();
    holder.name = name;
    holder.position.set(x, y, z);
    holder.rotation.y = facing;
    holder.add(model);
    model.traverse(function (o) { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    hideUntilReady(holder);
    dress.host.add(holder);
    if (collider) k5Collider(x, z, sx, sz, facing, y, y + sy);
  }
  function loadK5Chandelier(dress, onDone) {
    k3LoadGLB(WING_FILES.k5Chandelier, function (gltf) {
      if (state.k5Dress !== dress || !gltf) { if (!gltf) dress.errors.push('chandelier failed'); onDone(); return; }
      const model = gltf.scene; model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const targetH = 2.25, scale = targetH / Math.max(1e-4, size.y), seat = dress.height - 0.30;
      model.scale.setScalar(scale);
      model.position.set(dress.bbox.cx - c.x * scale, seat - box.max.y * scale, dress.bbox.cz - c.z * scale);
      model.name = 'K5-majlis-chandelier';
      model.traverse(function (o) { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; } });
      hideUntilReady(model); dress.host.add(model);
      // A handful of restrained animated flame sprites, seated just beneath the lamp cups.
      const cups = [[0.18,0,0],[ -0.18,0,0],[0,0,0.18],[0,0,-0.18],[0.10,0,-0.21],[-0.10,0,0.21],[0.21,0.0,-0.10],[-0.21,0,0.10]].map(function (q,i) {
        return { x: dress.bbox.cx + q[0]*scale, y: seat - size.y*scale*0.72, z: dress.bbox.cz + q[2]*scale, s: 0.38, seed: 0.19+i*0.37 };
      });
      addK2ChandelierFire(dress.host, cups);
      dress.chandelier = true; onDone();
    });
  }
  async function dressK5(api) {
    if(!api)return; // The zone streamer owns this room's atomic preparation.
    const room=state.rooms.find(r=>r.id==='K5'), shell=api.group;
    if(!room||!shell){api.fail(Error('K5 room shell is missing'));return;}
    const controller=new AbortController(), signal=controller.signal;
    const host=new THREE.Group();host.name='K5-Apartment-Dress';
    const dress=state.k5Dress={host,bbox:room.bbox,height:room.height,errors:[],loading:true,controller};
    const alive=()=>state.k5Dress===dress&&!signal.aborted;
    const kit=url=>new Promise((resolve,reject)=>k3LoadGLB(url,gltf=>{
      if(!alive()){
        if(gltf)SinGreatLibrary.disposeResources(gltf.scene);
        reject(Error('K5 preparation interrupted'));
      }else if(gltf)resolve(gltf);else reject(Error('K5 missing model: '+url));
    }));
    try{
      const doors=state.doors.filter(d=>d.from==='K5'||d.to==='K5');
      const architecture=await SinPrivateRooms.king(room,doors,timedRoomModels(api),signal,deviceProfile.constrained);
      if(!alive()){architecture.dispose();return;}
      dress.architecture=architecture;
      architecture.warmup.dispose();
      host.add(architecture.root);
      api.add(host);
      state.colliders.push(...architecture.boxes);
      const D=k5Dais(room.bbox);
      const steps=await kit(WING_FILES.k5Steps);
      k5PlaceModel(dress,steps,'K5-bed-steps',D.cx,D.cz,0,0,D.r*2,D.h,D.r*2,false);
      const bed=await kit(WING_FILES.k5Bed);
      k5PlaceModel(dress,bed,'K5-king-bed',D.cx,D.cz,D.h-.08,0,3.65,3.75,4.65,true);
      const props=await kit(WING_FILES.k5Furniture);
      k5PlaceFurniture(dress,k5Classify(k3SplitFurniture(props.scene)));
      await new Promise(done=>loadK5Chandelier(dress,done));
      if(!alive())return;
      if(dress.errors.length)throw Error(dress.errors.join(', '));
      SinGreatLibrary.setLibraryExposure(host,.35);
      zoneStreamer.markReleasable(host);
      dress.warmup=SinGreatLibrary.geometryWarmup(host);
      dress.loading=false;
      shell.userData.k5Dressed=true;
      api.done();
    }catch(error){if(alive())api.fail(error);}
  }
  const STREAM_EXPECT = {
    ...(window.SinT1Entrance ? { T1: SinT1Entrance.expected } : {}),
    ...(window.SinPurificationHall ? { T2: SinPurificationHall.expected } : {}),
    T3: window.SinSacredColumns ? SinSacredColumns.expected : [],
    ...(window.SinLunarSanctuary ? { T4: SinLunarSanctuary.expected } : {}),
    ...(window.SinRoyalOfferings ? { T5: SinRoyalOfferings.expected } : {}),
    L4: window.SinObservatory ? SinObservatory.expected : [],
    L2: window.SinRoyalArchive ? SinRoyalArchive.expected : [],
    L3: window.SinPrivateRooms ? SinPrivateRooms.studyExpected : [],
    L1: [
      'L1-floor-medallion', 'L1-ceiling-zodiac', 'L1-skylight',
      'L1-open-arch-L1-LC4', 'L1-open-arch-L1-LC2', 'L1-open-arch-L1-LC3',
      'L1-north-gallery-rail', 'L1-south-gallery-rail', 'L1-stairs',
      'L1-bookcases', 'L1-statue-niches', 'L1-lanterns',
      'L1-suspended-armillary', 'L1-instrument', 'L1-stele'
    ],
    K2: [
      'K2-majlis-floor', 'K2-majlis-walls', 'K2-majlis-ceiling',
      'K2-council-table', 'K2-majlis-columns',
      'K2-winged-lion-1', 'K2-winged-lion-2',
      'K2-majlis-chandelier', 'K2-majlis-plants'
    ],
    K3: [
      'K3-map-floor', 'K3-map-wall-far', 'K3-map-wall-side', 'K3-map-ceiling',
      'K3-lunar-discovery',
      'K3-map-table',
      'K3-shelf-a', 'K3-shelf-b', 'K3-arch', 'K3-scrolls',
      'K3-brazier-s', 'K3-brazier-n', 'K3-easel',
      'K3-chair-head', 'K3-chair-n1', 'K3-chair-n2', 'K3-chair-s1', 'K3-chair-s2'
    ],
    K4: [
      'K4-treasury-floor-artwork', 'K4-treasury-decorated-walls', 'K4-treasury-ceiling-artwork',
      'K4-frontMural', 'K4-altarTable', 'K4-kingStatue',
      'K4-column', 'K4-banner', 'K4-palmPot', 'K4-chandelier',
      'K4-brazier', 'K4-goldChest', 'K4-vase', 'K4-shelfCabinet',
      'K4-candelabra', 'K4-lionSphinx'
    ],
    K5: [
      'K5-king-floor', 'K5-king-mural-walls', 'K5-king-ceiling',
      'K5-bed-steps', 'K5-king-bed', 'K5-majlis-chandelier',
      'K5-sphinx', 'K5-brazier', 'K5-vase', 'K5-statue', 'K5-throne',
      'K5-banner', 'K5-winged-disc', 'K5-balcony-arches', 'K5-balcony-spandrel',
      'K5-balcony-arch-inlay', 'K5-balcony-balusters', 'K5-balcony-seats', 'K5-balcony-table',
      'K5-balcony-curtain', 'K5-blood-sky-panorama', 'K5-royal-rug'
    ]
  };
  const STREAM_EXPECT_MIN = { K5: { 'K5-sphinx': 2, 'K5-brazier': 2, 'K5-vase': 4, 'K5-statue': 2, 'K5-banner': 2 }, K4: { 'K4-column': 2, 'K4-banner': 2, 'K4-palmPot': 3, 'K4-brazier': 2, 'K4-goldChest': 4, 'K4-vase': 4, 'K4-shelfCabinet': 2 } };

  function expectedNames(id) {
    if (id === 'K4' && state.k4Dress && Array.isArray(state.k4Dress.assetSpecs) && state.k4Dress.assetSpecs.length) {
      return STREAM_EXPECT.K4.filter(function (n) { return n.indexOf('K4-treasury-') === 0; })
        .concat(state.k4Dress.assetSpecs.map(function (s) { return s.name; }));
    }
    return (STREAM_EXPECT[id] || []).slice();
  }

  function findNamed(root, name) {
    if (!root || !root.traverse) return [];
    const out = [];
    root.traverse(function (o) {
      if (!o.name) return;
      if (o.name === name || o.name.indexOf(name + '-') === 0 || o.name.indexOf(name) === 0) out.push(o);
    });
    return out;
  }
  function isWorldVisible(o) {
    let n = o, v = true;
    while (n) { if (n.visible === false) v = false; n = n.parent; }
    return v;
  }
  function groupFor(id) {
    if (id === 'Palace') {
      return (state.ctx && state.ctx.scene && (state.ctx.scene.getObjectByName('PalaceInterior') || state.ctx.scene.getObjectByName('PalaceWings'))) || state.root;
    }
    return (state.regionGroups && state.regionGroups.get(id)) || null;
  }

  function roomCompleteness(id) {
    const region = (state.regions || []).find(function (rr) { return rr.id === id; });
    // Arch thresholds are portal volumes with no independent mesh group —
    // their geometry lives on the hall / passage. Treating 0 meshes as a
    // failure was a false negative (ARCH_L3/R1/R3).
    if (region && region.kind === 'threshold') {
      return {
        id: id, expect: [], present: [], missing: [], hidden: [],
        meshes: 0, visMeshes: 0, complete: true, revealed: true,
        ready: true, streamed: false, hasGroup: false, threshold: true
      };
    }
    const g = groupFor(id);
    const expect = expectedNames(id);
    const mins = STREAM_EXPECT_MIN[id] || {};
    const present = [], missing = [], hidden = [], visNames = [];
    let meshes = 0, visMeshes = 0;
    if (g && g.traverse) {
      g.traverse(function (o) {
        if (!o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh) return;
        meshes++;
        if (isWorldVisible(o)) { visMeshes++; if (o.name) visNames.push(o.name); }
      });
    }
    function covered(name) {
      // Exact, or any node whose name starts with the expect token.
      const nodes = g ? findNamed(g, name) : [];
      if (!nodes.length) return { ok: false, vis: 0, n: 0 };
      let vis = 0;
      nodes.forEach(function (n) {
        const hasMesh = n.isMesh || n.isInstancedMesh || n.isSkinnedMesh;
        let any = hasMesh && isWorldVisible(n);
        if (!hasMesh && n.traverse) n.traverse(function (c) {
          if ((c.isMesh || c.isInstancedMesh) && isWorldVisible(c)) any = true;
        });
        if (any) vis++;
      });
      return { ok: vis > 0, vis: vis, n: nodes.length };
    }
    expect.forEach(function (name) {
      const c = covered(name);
      const need = mins[name] || 1;
      if (!c.n || c.n < need) missing.push(name);
      else {
        present.push(name);
        if (c.vis < need) hidden.push(name);
      }
    });
    // "complete" = every expected asset is RESIDENT in the graph. Visibility
    // is separate: hideUntilReady keeps props and shells hidden until the
    // streamer reveals them atomically, and isComplete() is what the streamer
    // waits on — requiring world-visible here would deadlock and never open
    // the door. After reveal, `revealed` is true when nothing is still hidden.
    const streamed = !!STREAM_EXPECT[id];
    const complete = streamed
      ? (missing.length === 0 && expect.length > 0)
      : !!(g && meshes > 0 && (id !== 'Palace' || meshes >= 20));
    const revealed = complete && hidden.length === 0 && (streamed ? visMeshes > 0 : true);
    return {
      id: id,
      expect: expect,
      present: present,
      missing: missing,
      hidden: hidden,
      meshes: meshes,
      visMeshes: visMeshes,
      complete: complete,
      revealed: revealed,
      ready: zoneIsReady(id),
      streamed: streamed,
      hasGroup: !!g
    };
  }

    window.PalaceWings = {
    // Data-driven streaming: register a new streamed zone (see ADDING_CONTENT.md).
    registerZone: registerZone,
    zones: function () { return zoneStreamer ? zoneStreamer.report() : null; },
    // Test/diagnostic hook: evict a zone now (ignores protection).
    forceEvictZone: function (id) { return zoneStreamer ? zoneStreamer.forceEvict(id) : 0; },
    streamedTargets: streamedTargets,
    zoneGateOpen: zoneGateOpen,
    zoneIsReady: zoneIsReady,
    roomCompleteness: roomCompleteness,
    expectedNames: expectedNames,
    STREAM_EXPECT: STREAM_EXPECT,
    deviceProfile: deviceProfile,
    palaceVisible: function () { return state.palaceNear !== false; },
    build, dispose, retire, stageAssets: () => [...preloaded.values(), state.materials], tick, contains, regionAt, floorAt, capsuleBlocked, resolveCamera, clampFollowTarget, interact, canInteract, locked: doorLocked, doorReport,
    teleport, overview, runTests, formatReport, cameraTour, current, metrics, corridorReport: () => state.corridorReport, corridorWallFill: () => state.corridorWallFill || 0,
    libraryCamera: () => state.library && state.library.ready ? state.library.camera : null,
    archiveCamera: () => state.archive && zoneIsReady('L2') ? state.archive.camera : null,
    observatoryCamera: () => state.observatory && zoneIsReady('L4') ? state.observatory.camera : null,
    sacredHallCamera: () => state.sacredHall && zoneIsReady('T3') ? state.sacredHall.camera : null,
    sacredEntranceCamera: () => state.sacredEntrance && zoneIsReady('T1') ? state.sacredEntrance.camera : null,
    purificationCamera: () => state.purificationHall && zoneIsReady('T2') ? state.purificationHall.camera : null,
    sanctuaryCamera: () => state.lunarSanctuary && zoneIsReady('T4') ? state.lunarSanctuary.camera : null,
    offeringsCamera: () => state.royalOfferings && zoneIsReady('T5') ? state.royalOfferings.camera : null,
    beforePresent,
    // PalaceRoomManager diagnostics: lifecycle state per room, sight demand,
    // prefetch, cooldown, and frame-time percentiles.
    rooms: function () {
      return roomManager ? Object.assign(roomManager.report(), { frame: roomFrames && roomFrames.summary() }) : null;
    },
    lunarSite() {
      const id=state.current;
      if(!zoneIsReady(id))return null;
      return (id==='K3'?state.k3Dress:id==='L2'?state.archive:id==='T4'?state.lunarSanctuary:null)?.lunar||null;
    },
    restoreTempleDoorPose:()=>{state.templeDoors?.restore();state.libraryDoors?.restore();},
    prepareEntryLibrary,
    onLibraryStairs, onOfferingSteps, onEntranceSteps,
    restoreLibraryPose: () => { if (state.library) state.library.restoreGroundPose(); },
    groundLibraryHero: hero => { if (onLibraryStairs(hero.position)) state.library.groundHero(hero); },
    shortestPath,
    assetList, provideAsset, preloadReport,
    provideBake: function (data) { if (retired) return; state.bake = data; if (typeof window !== 'undefined') window.__palaceColliderBake = data; },

    get report() { return state.report; },
    get state() { return state; }
  };
})();
