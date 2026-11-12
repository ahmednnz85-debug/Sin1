/* SIN ENGINE — outdoor triangle / draw-call reduction for phones.
 *
 * A real iPhone (Safari) measured 11.7 MILLION triangles and 620 draws at
 * 11 fps near the city walls (Zone approach, Tier HIGH, dynamic res already
 * at 0.58). Dynamic resolution cannot fix that load.
 *
 * Cause (lab inventory, originals untouched):
 *   - ~11,150 grass tufts. LOD2 is 1,514 tris; if the 4,776 LOD2 instances
 *     all draw (sightRange is ~520 m at fog 0.0038, and maxHQ is unused)
 *     that alone is 7.2 M tris. LOD1 (4,023) on a handful of near chunks
 *     adds millions more. 2 InstancedMeshes per chunk → hundreds of draws.
 *   - The processional-way walls (x = ±10.4) occlude the forest, but there
 *     is no occlusion culling, so grass and palms behind the walls are
 *     drawn the whole walk.
 *   - Each wall section is a 50,680-tri photogrammetry mesh; both walls
 *     stay in the frustum down the 80 m corridor.
 *
 * This module, loaded after the scene is built, without editing the
 * original GLBs or changing lighting/style:
 *   1. Swaps grass / wall / palm-leaf geometries for meshopt LODs baked
 *      with a tight error (assets/lod/outdoor-lod.json). Original files
 *      stay in assets/.
 *   2. Occludes vegetation behind the city walls when the camera is on
 *      the inner side of a wall plane (no visible change on the path).
 *   3. Stronger distance LOD (mid 12 m, far 24 m) on grass, palms and
 *      walls, validated per-view by SSIM >= 0.99. Palms now have baked
 *      mid/far ladders (clustered offline; original GLBs untouched).
 *   4. Far-field HLOD: vegetation past 36 m is merged into a handful of
 *      InstancedMeshes using the baked far geos. Distant city geometry
 *      is replaced by a baked impostor (assets/lod/outdoor-hlod.json)
 *      built offline from the originals, which stay untouched.
 *   5. Tighter wall occlusion (8 m end slack) and a 90 m far-hide cap
 *      (20 % fog transmittance). Shadow casters past 16 m are culled.
 *   6. Records a before/after inventory on window.__sinOutdoorPerf.
 *
 * Visuals are verified with SSIM at the same camera stations.
 */
(function (root) {
  'use strict';

  const LOD_URL = 'assets/lod/outdoor-lod.json?v=20261112r6';
  const state = {
    ready: false,
    lod: null,
    geos: {},          // key -> { play, far, near, mid } THREE.BufferGeometry
    classified: false,
    grass: [],         // { mesh, srcTris, variant, lodName, chunkX, chunkZ, r }
    palms: [],
    walls: [],         // { mesh, group, x, z, r, lods }
    wallPlane: null,   // { x, start, end, h }
    lastVis: { tris: 0, draws: 0, culled: 0, occluded: 0 },
    before: null,
    city: [],
    hlod: {},
    hlodImpostor: null
  };

  function b64ToU8(s) {
    const bin = atob(s);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function b64ToF32(s) { return new Float32Array(b64ToU8(s).buffer); }
  function b64ToU32(s) {
    const u = b64ToU8(s);
    return new Uint32Array(u.buffer, u.byteOffset, u.byteLength / 4);
  }

  function makeGeo(entry, THREE) {
    const g = new THREE.BufferGeometry();
    const attrs = entry.attrs || {};
    if (attrs.POSITION) g.setAttribute('position', new THREE.BufferAttribute(b64ToF32(attrs.POSITION.b64), attrs.POSITION.ncomp || 3));
    if (attrs.NORMAL) g.setAttribute('normal', new THREE.BufferAttribute(b64ToF32(attrs.NORMAL.b64), attrs.NORMAL.ncomp || 3));
    if (attrs.TEXCOORD_0) g.setAttribute('uv', new THREE.BufferAttribute(b64ToF32(attrs.TEXCOORD_0.b64), attrs.TEXCOORD_0.ncomp || 2));
    if (entry.indices) g.setIndex(new THREE.BufferAttribute(b64ToU32(entry.indices), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    if (!g.userData) g.userData = {};
    g.userData.sinLod = true;
    g.userData.srcTris = entry.srcTris;
    g.userData.lodTris = entry.tris;
    return g;
  }

  function srcTrisOf(mesh) {
    const g = mesh.geometry;
    if (!g) return 0;
    if (g.userData && g.userData.srcTris) return g.userData.srcTris;
    const idx = g.index;
    if (idx) return Math.floor(idx.count / 3);
    const pos = g.attributes && g.attributes.position;
    return pos ? Math.floor(pos.count / 3) : 0;
  }
  // Current drawn triangles after LOD swap. srcTris on a baked geo is the
  // ORIGINAL count and must not be used for visible-tris accounting.
  function liveTrisOf(mesh) {
    const g = mesh && mesh.geometry;
    if (!g) return 0;
    if (g.userData && g.userData.lodTris != null) return g.userData.lodTris;
    const idx = g.index;
    if (idx) return Math.floor(idx.count / 3);
    const pos = g.attributes && g.attributes.position;
    return pos ? Math.floor(pos.count / 3) : 0;
  }
  function drawnTris(mesh) {
    if (!mesh || mesh.visible === false) return 0;
    let p = mesh.parent;
    while (p) { if (p.visible === false) return 0; p = p.parent; }
    const t = liveTrisOf(mesh);
    return mesh.isInstancedMesh ? t * (mesh.count || 1) : t;
  }

  function inventory(scene) {
    const rows = [];
    let visTris = 0, visDraws = 0, allTris = 0, meshes = 0;
    if (!scene || !scene.traverse) return { rows: rows, visTris: 0, visDraws: 0, allTris: 0, meshes: 0 };
    scene.traverse(function (o) {
      if (!o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh) return;
      meshes++;
      const t = liveTrisOf(o);
      const inst = o.isInstancedMesh ? (o.count || 1) : 1;
      const tot = t * inst;
      allTris += tot;
      let vis = o.visible;
      let p = o.parent;
      while (p && vis) { if (p.visible === false) vis = false; p = p.parent; }
      if (vis) { visTris += tot; visDraws++; }
      rows.push({ name: o.name || o.type, tris: tot, unit: t, inst: inst, vis: !!vis });
    });
    rows.sort(function (a, b) { return b.tris - a.tris; });
    return { rows: rows.slice(0, 25), visTris: visTris, visDraws: visDraws, allTris: allTris, meshes: meshes };
  }

  function bboxSig(geo) {
    if (!geo) return '';
    const pos = geo.attributes && geo.attributes.position;
    if (!pos) return '';
    let minx = 1e9, miny = 1e9, minz = 1e9, maxx = -1e9, maxy = -1e9, maxz = -1e9;
    const a = pos.array;
    if (!a) {
      if (geo.boundingBox) {
        const b = geo.boundingBox;
        return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map(function (v) { return v.toFixed(3); }).join(',');
      }
      return '';
    }
    for (let i = 0; i < a.length; i += 3) {
      const x = a[i], y = a[i + 1], z = a[i + 2];
      if (x < minx) minx = x; if (y < miny) miny = y; if (z < minz) minz = z;
      if (x > maxx) maxx = x; if (y > maxy) maxy = y; if (z > maxz) maxz = z;
    }
    return [minx, miny, minz, maxx, maxy, maxz].map(function (v) { return (+v).toFixed(3); }).join(',');
  }

  // Build cheapest / most useful LODs first so they can attach before the
  // 1.8 MB pack is fully decoded (lod0 play is the largest grass mesh).
  function lodKeyOrder(keys) {
    function rank(k) {
      if (/lod2/.test(k) && /far/.test(k)) return 0;
      if (/lod2/.test(k)) return 1;
      if (/wall/.test(k)) return 2;
      if (/lod1/.test(k)) return 3;
      if (/palm/.test(k)) return 4;
      return 5;
    }
    return keys.slice().sort(function (a, b) { return rank(a) - rank(b); });
  }

  function loadLod(THREE) {
    if (state.released) return Promise.resolve(null);
    if (state.lod) return Promise.resolve(state.lod);
    if (state._lodPromise) return state._lodPromise;
    // Parse on the main thread (native r.json is much cheaper than a
    // Worker structured-clone of the 1.8 MB tree, which stalled WebKit
    // for 2.3 s). makeGeo is then budgeted across frames — never in this
    // then() — so the parse hitch is one short tick, not a freeze.
    state._lodPromise = fetch(LOD_URL).then(function (r) {
      if (!r.ok) throw new Error('lod pack ' + r.status);
      return r.json();
    }).then(function (pack) {
      if (state.released) { state._lodPromise = null; return null; }
      state._pack = pack;
      state._lodKeys = lodKeyOrder(Object.keys(pack.meshes || {}));
      state._lodBuildI = 0;
      return pack;
    }).catch(function (e) {
      try { console.warn('outdoor-perf lod', e && e.message || e); } catch (_) {}
      state.ready = true;
      throw e;
    });
    return state._lodPromise;
  }

  // Decode a few baked meshes per frame (≤ ~4 ms) and let applyLods attach
  // them immediately. Doing the whole pack in one turn is what froze Safari
  // at the approach→babylon cinematic cut.
  function pumpLodBuild(THREE, budgetMs) {
    if (state.released || !state._pack || !THREE) return 0;
    const keys = state._lodKeys || [];
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
    const budget = budgetMs || 4;
    let n = 0;
    while (state._lodBuildI < keys.length) {
      const key = keys[state._lodBuildI++];
      const row = state._pack.meshes[key];
      if (!row) continue;
      const geos = state.geos;
      geos[key] = { srcTris: row.srcTris, name: row.name, lods: {} };
      const lns = Object.keys(row.lods || {});
      for (let i = 0; i < lns.length; i++) {
        try { geos[key].lods[lns[i]] = makeGeo(row.lods[lns[i]], THREE); }
        catch (e) { try { console.warn('outdoor-perf makeGeo', key, lns[i], e); } catch (_) {} }
      }
      n++;
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : t0 + budget + 1;
      if (now - t0 >= budget) break;
    }
    if (state._lodBuildI >= keys.length && !state.lod) {
      state.lod = { version: state._pack.version, meshes: state._pack.meshes && { /* metadata only, buffers now in geos */ } };
      // Drop the raw JSON tree so the 1.8 MB parse result can be GC'd.
      state._pack = null;
      state.ready = true;
      if (state.classified) state.classified = false;
      try { console.log('[outdoor-perf] lod pack ready', Object.keys(state.geos)); } catch (_) {}
    }
    return n;
  }

  function pickGrassKey(srcTris, sig, used) {
    // Match baked pack by source triangle count and assign a/b uniquely.
    const band = srcTris > 8000 ? 'lod0' : srcTris > 2500 ? 'lod1' : 'lod2';
    const a = 'grass_a_' + band, b = 'grass_b_' + band;
    if (state.geos[a] && state.geos[a].srcTris === srcTris) {
      if (!used[a] || used[a] === sig) { used[a] = sig; return a; }
      if (!used[b] || used[b] === sig) { used[b] = sig; return b; }
    }
    return state.geos[a] ? a : (state.geos[b] ? b : null);
  }

  function outdoorCullOn() {
    try { return !(typeof window !== 'undefined' && window.__sinNoInstanceCull); } catch (_) { return true; }
  }
  function cameraFrustum(cam, THREE) {
    if (!cam || !cam.projectionMatrix || !cam.matrixWorldInverse) return null;
    try { cam.updateMatrixWorld(); } catch (_) {}
    const fr = cameraFrustum._fr || (cameraFrustum._fr = new THREE.Frustum());
    const m = cameraFrustum._m || (cameraFrustum._m = new THREE.Matrix4());
    m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    fr.setFromProjectionMatrix(m);
    return fr;
  }
  function snapshotInstances(e, THREE) {
    const mesh = e && e.mesh;
    if (!mesh || !mesh.isInstancedMesh || e.matrices) return;
    const n = mesh.count || 0;
    const mats = new Array(n);
    const tmp = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      mesh.getMatrixAt(i, tmp);
      mats[i] = tmp.clone();
    }
    e.matrices = mats;
    e.fullCount = n;
    const geo = mesh.geometry;
    try { if (geo && !geo.boundingSphere && geo.computeBoundingSphere) geo.computeBoundingSphere(); } catch (_) {}
    e.geoCenter = (geo && geo.boundingSphere && geo.boundingSphere.center.clone && geo.boundingSphere.center.clone()) || new THREE.Vector3();
    e.geoRadius = (geo && geo.boundingSphere && geo.boundingSphere.radius) || 2;
    mesh.frustumCulled = false;
  }
  function compactOutdoor(e, frustum, THREE) {
    const mesh = e && e.mesh;
    if (!mesh || !mesh.isInstancedMesh || !e.matrices) return e.fullCount || 0;
    if (!frustum || !outdoorCullOn()) {
      if (mesh.count !== e.fullCount) {
        for (let i = 0; i < e.fullCount; i++) mesh.setMatrixAt(i, e.matrices[i]);
        mesh.count = e.fullCount;
        mesh.instanceMatrix.needsUpdate = true;
      }
      return e.fullCount;
    }
    const sphere = compactOutdoor._s || (compactOutdoor._s = new THREE.Sphere());
    const c = compactOutdoor._c || (compactOutdoor._c = new THREE.Vector3());
    const tmp = compactOutdoor._t || (compactOutdoor._t = new THREE.Matrix4());
    const mw = mesh.matrixWorld;
    let n = 0;
    for (let i = 0; i < e.matrices.length; i++) {
      tmp.multiplyMatrices(mw, e.matrices[i]);
      c.copy(e.geoCenter).applyMatrix4(tmp);
      const el = tmp.elements;
      const sx = Math.sqrt(el[0] * el[0] + el[1] * el[1] + el[2] * el[2]);
      const sy = Math.sqrt(el[4] * el[4] + el[5] * el[5] + el[6] * el[6]);
      const sz = Math.sqrt(el[8] * el[8] + el[9] * el[9] + el[10] * el[10]);
      sphere.center.copy(c);
      sphere.radius = (e.geoRadius || 2) * Math.max(sx, sy, sz, 1e-6) + 0.75;
      if (frustum.intersectsSphere(sphere)) mesh.setMatrixAt(n++, e.matrices[i]);
    }
    mesh.count = n;
    if (n) mesh.instanceMatrix.needsUpdate = true;
    return n;
  }


  // Far-field city HLOD: a handful of merged, simplified meshes baked
  // offline from the original stall/house/palm field (originals untouched).
  // Loaded from assets/lod/outdoor-hlod.json and shown in place of the
  // distant originals (those originals are hidden past VEG_HLOD_D when
  // e.hlodCovered is set).
  const HLOD_URL = 'assets/lod/outdoor-hlod.json?v=20261112r1';
  function citySig(o) {
    const g = o && o.geometry;
    if (!g) return null;
    const pos = g.attributes && g.attributes.position;
    if (!pos) return null;
    const t = (g.userData && g.userData.srcTris) || (g.index ? Math.floor(g.index.count / 3) : Math.floor(pos.count / 3));
    if (!g.boundingBox) { try { g.computeBoundingBox(); } catch (_) {} }
    const b = g.boundingBox;
    const bb = b ? [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map(function (v) { return +v.toFixed(2); }).join(',') : '';
    return t + '@' + bb + 'x' + pos.count;
  }
  function attachHlodImpostor(scene, THREE) {
    if (!state._hlodPack || !THREE) return null;
    const pack = state._hlodPack;
    if (!state._hlodGeos) state._hlodGeos = {};
    const meshes = pack.meshes || {};
    for (const sig in meshes) {
      if (state._hlodGeos[sig]) continue;
      const lods = meshes[sig].lods || {};
      const built = {};
      try {
        if (lods.mid) built.mid = makeGeo(lods.mid, THREE);
        if (lods.far) built.far = makeGeo(lods.far, THREE);
      } catch (e) { try { console.warn('hlod geo', sig, e); } catch (_) {} }
      state._hlodGeos[sig] = built;
    }
    let n = 0;
    const list = state.city || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.mesh || e.lodFar) continue;
      const sig = e.sig || citySig(e.mesh);
      e.sig = sig;
      const built = sig && state._hlodGeos[sig];
      if (!built) continue;
      e.origGeo = e.origGeo || e.mesh.geometry;
      e.lodMid = built.mid || null;
      e.lodFar = built.far || null;
      e.hlodCovered = true;
      n++;
    }
    state._hlodAttached = true;
    try { console.log('[outdoor-perf] city-hlod attached', n, '/', list.length, 'sigs', Object.keys(state._hlodGeos).length); } catch (_) {}
    return n;
  }
    function loadHlod(THREE) {
    if (state.released) return Promise.resolve(null);
    if (state._hlodPromise) return state._hlodPromise;
    state._hlodPromise = fetch(HLOD_URL).then(function (r) {
      if (!r.ok) throw new Error('hlod ' + r.status);
      return r.json();
    }).then(function (pack) {
      if (state.released) { state._hlodPromise = null; return null; }
      state._hlodPack = pack;
      return pack;
    }).catch(function (e) {
      try { console.warn('outdoor-perf hlod', e && e.message || e); } catch (_) {}
      state._hlodPack = null;
    });
    return state._hlodPromise;
  }

  function classify(scene, THREE) {
    if (state.released || !scene || state.classified) return;
    state.grass = [];
    state.palms = [];
    state.walls = [];
    const usedGrass = {};
    const walls = [];
    let wallMinZ = 1e9, wallMaxZ = -1e9, wallH = 4, wallX = 10.4;
    scene.traverse(function (o) {
      if (!o.isMesh && !o.isInstancedMesh) return;
      const name = o.name || '';
      const t = srcTrisOf(o);
      if (name === 'new-grass-tufts' || (o.isInstancedMesh && t >= 1000 && t <= 12000 && /grass/i.test(name))) {
        const sig = o.geometry && o.geometry.uuid;
        const key = pickGrassKey(t, sig, usedGrass);
        const world = new THREE.Vector3();
        let cx = 0, cz = 0, r = 24;
        try {
          if (o.geometry && o.geometry.boundingSphere) {
            world.copy(o.geometry.boundingSphere.center);
            o.localToWorld(world);
            cx = world.x; cz = world.z; r = o.geometry.boundingSphere.radius || 24;
          } else if (o.parent) {
            cx = o.parent.position.x; cz = o.parent.position.z;
          }
        } catch (_) {}
        // Instance matrices are in world space (grass build uses world P),
        // so the InstancedMesh sits at the origin. Use the parent group
        // which was never given a position — vegChunks stored cx,cz on a
        // parallel structure we cannot see. Estimate from first/last
        // instance if possible.
        try {
          if (o.isInstancedMesh && o.count) {
            const m = new THREE.Matrix4();
            const p = new THREE.Vector3();
            let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
            const step = Math.max(1, Math.floor(o.count / 8));
            for (let i = 0; i < o.count; i += step) {
              o.getMatrixAt(i, m);
              p.setFromMatrixPosition(m);
              if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
              if (p.z < minz) minz = p.z; if (p.z > maxz) maxz = p.z;
            }
            cx = (minx + maxx) * 0.5;
            cz = (minz + maxz) * 0.5;
            r = Math.max(8, Math.hypot(maxx - minx, maxz - minz) * 0.5 + 4);
          }
        } catch (_) {}
        state.grass.push({ mesh: o, srcTris: t, key: key, sig: sig, x: cx, z: cz, r: r, origGeo: o.geometry });
        if (key && state.geos[key] && state.geos[key].lods.play) {
          o.geometry = state.geos[key].lods.play;
          if (!o.userData) o.userData = {};
          o.userData.sinLodApplied = key;
        }
        attachLodLadder(state.grass[state.grass.length - 1]);
        snapshotInstances(state.grass[state.grass.length - 1], THREE);
      } else if (name === 'new-palm-grove' || (o.isInstancedMesh && /palm|grove/i.test(name))) {
        const world = new THREE.Vector3();
        let cx = 0, cz = 0, r = 36;
        try {
          if (o.isInstancedMesh && o.count) {
            const m = new THREE.Matrix4(), p = new THREE.Vector3();
            let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
            const step = Math.max(1, Math.floor(o.count / 6));
            for (let i = 0; i < o.count; i += step) {
              o.getMatrixAt(i, m); p.setFromMatrixPosition(m);
              if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
              if (p.z < minz) minz = p.z; if (p.z > maxz) maxz = p.z;
            }
            cx = (minx + maxx) * 0.5; cz = (minz + maxz) * 0.5;
            r = Math.max(10, Math.hypot(maxx - minx, maxz - minz) * 0.5 + 6);
          }
        } catch (_) {}
        const palmKey = (function () {
          const keys = Object.keys(state.geos).filter(function (k) { return k.indexOf('palm_') === 0 && state.geos[k].srcTris === t; });
          return keys[0] || null;
        })();
        state.palms.push({ mesh: o, srcTris: t, key: palmKey, x: cx, z: cz, r: r, origGeo: o.geometry });
        if (palmKey && state.geos[palmKey] && state.geos[palmKey].lods.play) {
          o.geometry = state.geos[palmKey].lods.play;
          if (!o.userData) o.userData = {};
          o.userData.sinLodApplied = palmKey;
        }
        attachLodLadder(state.palms[state.palms.length - 1]);
        snapshotInstances(state.palms[state.palms.length - 1], THREE);
      } else if (t >= 40000 && t <= 60000) {
        // Babylonian wall sections (50,680 tris), not instanced.
        // The mesh is nested inside a Y-rotated group that sits at
        // x = ±10.4. Walk ancestors for that anchor — the mesh's own
        // world position is offset (~5–6 m) and is not the plane.
        let x = 0, z = 0, anchored = false;
        let node = o;
        while (node) {
          if (node.position && Math.abs(node.position.x) >= 8 && Math.abs(node.position.x) <= 14) {
            x = node.position.x; z = node.position.z; anchored = true; break;
          }
          node = node.parent;
        }
        if (!anchored) return;
        let r = 8, h = 6;
        try {
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox;
          if (bb) {
            const size = new THREE.Vector3();
            bb.getSize(size);
            o.updateWorldMatrix(true, false);
            const sx = o.getWorldScale(new THREE.Vector3());
            r = Math.max(size.x * Math.abs(sx.x), size.z * Math.abs(sx.z)) * 0.6 + 2;
            h = size.y * Math.abs(sx.y);
          }
        } catch (_) {}
        walls.push({ mesh: o, x: x, z: z, r: r, h: h, origGeo: o.geometry });
        if (z < wallMinZ) wallMinZ = z;
        if (z > wallMaxZ) wallMaxZ = z;
        if (Math.abs(x) > 8) wallX = Math.abs(x);
        if (h > wallH) wallH = h;
      }
    });
    const wallLods = state.geos.wall && state.geos.wall.lods;
    walls.forEach(function (w) {
      w.lods = wallLods || {};
      if (w.lods.near) {
        // Start at mid (walls are viewed from ≥ ~10 m on the path); near
        // is swapped in only when the camera is close.
        w.mesh.geometry = w.lods.mid || w.lods.near;
        if (!w.mesh.userData) w.mesh.userData = {};
        w.mesh.userData.sinLodApplied = 'wall';
        w.current = 'mid';
      }
      state.walls.push(w);
    });
    if (walls.length) {
      state.wallPlane = { x: wallX, start: wallMinZ - (walls[0].r || 6), end: wallMaxZ + (walls[0].r || 6), h: wallH * 1.05 };
    }
    // Stalls, houses, pots — same occlusion / far-hide / shadow cull as veg.
    // The Ishtar gate and the processional ground stay untouched (SSIM).
    state.city = [];
    const used = new Set();
    function markUsed(list) { for (let i = 0; i < list.length; i++) if (list[i].mesh) used.add(list[i].mesh); }
    markUsed(state.grass); markUsed(state.palms); markUsed(state.walls);
    scene.traverse(function (o) {
      if ((!o.isMesh && !o.isInstancedMesh) || used.has(o)) return;
      if (o.userData && (o.userData.sinHlod || o.userData.sinHlodImpostor)) return;
      const name = ((o.name || '') + ' ' + ((o.parent && o.parent.name) || '')).toLowerCase();
      if (/sky|cloud|sun|hero|player|water|canal|ground|terrain|floor|road|path|gate|ishtar|portal|door|shadow|fill|hemi/.test(name)) return;
      // Skip enormous unique meshes (ground plane, palace shell) — only
      // repeated city dressing belongs in this list.
      const t = srcTrisOf(o);
      const inst = o.isInstancedMesh;
      if (!inst && (t < 20 || t > 30000)) return;
      if (inst && t > 30000) return;
      const wp = new THREE.Vector3();
      try { o.getWorldPosition(wp); } catch (_) { return; }
      let r = 4;
      try {
        if (o.geometry) {
          if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
          if (o.geometry.boundingSphere) r = Math.max(2, o.geometry.boundingSphere.radius || 4);
        }
        if (inst && o.count) {
          const m = new THREE.Matrix4(), p = new THREE.Vector3();
          let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
          const step = Math.max(1, Math.floor(o.count / 8));
          for (let i = 0; i < o.count; i += step) {
            o.getMatrixAt(i, m); p.setFromMatrixPosition(m);
            if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
            if (p.z < minz) minz = p.z; if (p.z > maxz) maxz = p.z;
          }
          wp.x = (minx + maxx) * 0.5; wp.z = (minz + maxz) * 0.5;
          r = Math.max(r, Math.hypot(maxx - minx, maxz - minz) * 0.5 + 2);
        }
      } catch (_) {}
      const e = { mesh: o, x: wp.x, z: wp.z, r: r, srcTris: t, city: true, sig: citySig(o), origGeo: o.geometry };
      if (inst) snapshotInstances(e, THREE);
      state.city.push(e);
    });
    attachHlodImpostor(scene, THREE);
    // Only lock the inventory once the outdoor scene is actually populated.
    // A classify during the loading screen would freeze us at 0 grass forever.
    if (state.grass.length || state.walls.length || state.palms.length) {
      state.classified = true;
    }
    try { console.log('[outdoor-perf] grass', state.grass.length, 'palms', state.palms.length, 'walls', state.walls.length, 'plane', state.wallPlane, 'lods', !!state.lod); } catch (_) {}
  }

  /* Sphere behind a wall plane, camera on the inner side, crossing within
     the wall's z-span and below the wall height → occluded. Corner slack
     keeps props at the wall ends visible. */
  function occludedByWall(x, z, r, cam, plane) {
    if (!plane || !cam) return false;
    const camX = cam.position.x, camZ = cam.position.z, camY = cam.position.y;
    if (camY > plane.h - 0.3) return false;
    const slack = 8;
    for (let s = -1; s <= 1; s += 2) {
      const planeX = s * plane.x;
      const sphOuter = s > 0 ? (x - r > planeX + 0.4) : (x + r < planeX - 0.4);
      const camInner = s > 0 ? (camX <= planeX + 0.15) : (camX >= planeX - 0.15);
      if (!sphOuter || !camInner) continue;
      const dx = x - camX;
      if (Math.abs(dx) < 1e-4) continue;
      const t = (planeX - camX) / dx;
      if (t <= 0 || t >= 1) continue;
      const zCross = camZ + t * (z - camZ);
      const yCross = camY + t * (1.2 - camY);
      if (zCross >= plane.start + slack && zCross <= plane.end - slack && yCross < plane.h) return true;
    }
    return false;
  }


  function applyLods() {
    if (state.released || !state.geos || !Object.keys(state.geos).length) return 0;
    let n = 0;
    function swap(e, lodName) {
      if (!e || !e.mesh) return;
      let key = e.key;
      if (!key && e.srcTris && e.mesh.isInstancedMesh) {
        // grass keys only; palms set e.key during classify
        try { key = e.key; } catch (_) {}
      }
      const pack = key && state.geos[key];
      const lods = pack && pack.lods;
      if (!lods) return;
      const g = lods[lodName] || lods.play;
      if (!g) return;
      if (e.mesh.geometry !== g) {
        e.mesh.geometry = g;
        if (!e.mesh.userData) e.mesh.userData = {};
        e.mesh.userData.sinLodApplied = key || lodName;
        n++;
      }
    }
    for (let i = 0; i < state.grass.length; i++) {
      const e = state.grass[i];
      if (!e.key && e.srcTris) {
        e.key = (function () {
          const band = e.srcTris > 8000 ? 'lod0' : e.srcTris > 2500 ? 'lod1' : 'lod2';
          const a = 'grass_a_' + band, b = 'grass_b_' + band;
          if (state.geos[a]) return (e._ab === 1 && state.geos[b]) ? b : a;
          return state.geos[b] ? b : null;
        })();
        // Alternate a/b for same-count tufts.
        if (e.key && e.key.indexOf('grass_a_') === 0) e._ab = 0;
        else e._ab = 1;
      }
      attachLodLadder(e);
      if (!(e.mesh.userData && e.mesh.userData.sinLodApplied)) swap(e, 'play');
    }
    for (let i = 0; i < state.palms.length; i++) {
      attachLodLadder(state.palms[i]);
      if (!(state.palms[i].mesh.userData && state.palms[i].mesh.userData.sinLodApplied)) swap(state.palms[i], 'play');
    }
    for (let i = 0; i < state.walls.length; i++) {
      const e = state.walls[i];
      const lods = state.geos.wall && state.geos.wall.lods;
      if (lods) { e.lods = lods; swap({ mesh: e.mesh, key: 'wall' }, e.current || 'mid'); }
    }
    return n;
  }

    // Stronger distance LOD: mid at 12 m, far at 24 m. Palms now have
    // baked mid/far ladders (clustered offline from the play mesh;
    // original palm GLBs are untouched). Per-view SSIM >= 0.99 is the bar.
    const VEG_MID_D = 12;
    const VEG_FAR_D = 24;
    const VEG_HLOD_D = 36;
    const SHADOW_D = 16;
    function optOn() { return typeof window === 'undefined' || window.__sinOutdoorOpt !== false; }
    function vegMidD() { return optOn() ? VEG_MID_D : 28; }
    function vegFarD() { return optOn() ? VEG_FAR_D : 90; }
    function vegHlodD() { return optOn() ? VEG_HLOD_D : 1e9; }
    function shadowD() { return optOn() ? SHADOW_D : 28; }
    function farLimitCap() { return optOn() ? 80 : 400; }
    function pickVegLod(e, dn) {
      if (e.lodNear || e.lodMid || e.lodFar) {
        if (dn > vegFarD()) return e.lodFar || e.lodMid || e.lodNear;
        if (dn > vegMidD()) return e.lodMid || e.lodNear;
        return e.lodNear;
      }
      const key = e.key;
      const own = key && state.geos[key] && state.geos[key].lods;
      if (!own) return null;
      if (own.far && dn > vegFarD()) return own.far;
      if (own.mid && dn > vegMidD()) return own.mid;
      if (own.play) return own.play;
      return own.far || own.mid || null;
    }
    function attachLodLadder(e) {
      if (!e || !e.key) return;
      const key = e.key;
      const m = /^((?:grass_[ab]))_lod/.exec(key);
      const v = m ? m[1] : null;
      const g = state.geos;
      const own = (g[key] && g[key].lods) || {};
      e.lodNear = own.play || null;
      e.lodMid = (v && g[v + '_lod1'] && g[v + '_lod1'].lods && g[v + '_lod1'].lods.play) || own.mid || own.play || null;
      e.lodFar = (v && g[v + '_lod2'] && g[v + '_lod2'].lods && (g[v + '_lod2'].lods.far || g[v + '_lod2'].lods.play)) || own.far || own.mid || own.play || null;
    }

    function resetHlod() {
      const h = state.hlod;
      for (const k in h) h[k].n = 0;
    }
    function pushHlod(e, THREE, scene) {
      const mesh = e.mesh;
      if (!mesh || !mesh.isInstancedMesh) return false;
      const far = e.lodFar || mesh.geometry;
      if (!far) return false;
      const mat = mesh.material;
      const k = (e.key || 'x') + ':' + ((mat && mat.uuid) || 'm');
      let h = state.hlod[k];
      if (!h) {
        const cap = 8192;
        const im = new THREE.InstancedMesh(far, mat, cap);
        im.count = 0;
        im.castShadow = false;
        im.receiveShadow = !!mesh.receiveShadow;
        im.frustumCulled = true;
        im.name = 'sin-hlod-' + (e.key || 'veg');
        im.userData.sinHlod = true;
        im.matrixAutoUpdate = true;
        im.position.set(0, 0, 0);
        im.rotation.set(0, 0, 0);
        im.scale.set(1, 1, 1);
        // World-space instance matrices (same as the source packs).
        scene.add(im);
        h = state.hlod[k] = { mesh: im, n: 0, cap: cap };
      }
      const n = mesh.count || 0;
      if (n <= 0) return true;
      if (h.n + n > h.cap) return false;
      h.mesh.instanceMatrix.array.set(mesh.instanceMatrix.array.subarray(0, n * 16), h.n * 16);
      h.n += n;
      return true;
    }
    function flushHlod() {
      for (const k in state.hlod) {
        const h = state.hlod[k];
        h.mesh.count = h.n;
        h.mesh.instanceMatrix.needsUpdate = true;
        h.mesh.visible = h.n > 0;
        h.mesh.castShadow = false;
        try { if (h.n && h.mesh.computeBoundingSphere) h.mesh.computeBoundingSphere(); } catch (_) {}
      }
    }
    function applyShadowCull(mesh, dn) {
      if (!mesh) return;
      if (mesh.userData._sinCast == null) mesh.userData._sinCast = !!mesh.castShadow;
      if (!mesh.userData._sinCast) return;
      mesh.castShadow = dn <= shadowD();
    }

    function applyFrame(scene, camera) {
    if (state.released || !state.classified || !camera) return state.lastVis;
    const plane = state.wallPlane;
    const cx = camera.position.x, cz = camera.position.z;
    const frustum = outdoorCullOn() ? cameraFrustum(camera, window.THREE) : null;
    let occluded = 0, farHide = 0, hlodChunks = 0, shadowsOff = 0;
    let instKept = 0, instFull = 0;
    const fog = scene && scene.fog;
    // 20% fog transmittance and a hard 90 m cap: past that a baked
    // HLOD impostor carries the distant city, not the full instance field.
    const cap = farLimitCap();
    const trans = optOn() ? 0.20 : 0.12;
    let farLimit = cap;
    if (fog && fog.isFogExp2 && fog.density > 0) {
      farLimit = Math.min(cap, Math.sqrt(-Math.log(trans)) / fog.density);
    } else if (camera.far) {
      farLimit = Math.min(cap, camera.far);
    }
    resetHlod();
    if (state.hlodImpostor) {
      state.hlodImpostor.visible = false;
    }

    function handleVeg(list, farLod) {
      for (let i = 0; i < list.length; i++) {
        const e = list[i], mesh = e.mesh;
        if (!mesh) continue;
        const dx = e.x - cx, dz = e.z - cz;
        const dn = Math.max(0, Math.sqrt(dx * dx + dz * dz) - (e.r || 0));
        const occ = occludedByWall(e.x, e.z, e.r || 8, camera, plane);
        if (occ) {
          if (mesh.userData._sinWantVis == null) mesh.userData._sinWantVis = mesh.visible;
          mesh.visible = false;
          occluded++;
          applyShadowCull(mesh, 1e6);
          continue;
        }
        if (dn > farLimit) {
          mesh.visible = false;
          farHide++;
          applyShadowCull(mesh, dn);
          continue;
        }
        // Restore if we hid it last frame and the game's updateVeg has
        // already set this frame's LOD visibility — we only force-hide.
        // If we left it false, updateVeg on the PARENT group is what
        // matters; for grass the visible flag lives on the LOD group
        // (parent). Force-hiding the InstancedMesh is enough, so we
        // must restore when no longer occluded / HLOD-merged.
        if (mesh.userData && mesh.userData._sinWantVis != null) {
          mesh.visible = mesh.userData._sinWantVis !== false;
          mesh.userData._sinWantVis = null;
        }
        if (farLod) {
          const g = pickVegLod(e, dn);
          if (g && mesh.geometry !== g) mesh.geometry = g;
        } else if (e.lodNear && mesh.geometry !== e.lodNear) {
          mesh.geometry = e.lodNear;
        }
        if (mesh.isInstancedMesh) {
          instFull += e.fullCount || 0;
          instKept += compactOutdoor(e, frustum, window.THREE);
        }
        applyShadowCull(mesh, dn);
        if (!mesh.castShadow && mesh.userData._sinCast) shadowsOff++;
        // Merge far vegetation into a handful of HLOD InstancedMeshes
        // (baked far geos, originals untouched). Cuts hundreds of draws.
        // Grass only: palm HLOD drew canopy over rooftops (cluster mid/far
        // is fine at a distance, but merging a hidden grove chunk made
        // palms pop up behind the market houses). Palms still use mid/far
        // distance LOD and instance cull.
        const allowHlod = farLod && !(e.key && String(e.key).indexOf('palm_') === 0);
        if (allowHlod && dn > vegHlodD() && mesh.isInstancedMesh && mesh.count > 0) {
          let parentVis = true;
          let p = mesh.parent;
          while (p) { if (p.visible === false) { parentVis = false; break; } p = p.parent; }
          if (parentVis && mesh.visible !== false && pushHlod(e, window.THREE, scene)) {
            if (mesh.userData._sinWantVis == null) mesh.userData._sinWantVis = mesh.visible;
            mesh.visible = false;
            hlodChunks++;
          }
        }
      }
    }
    handleVeg(state.grass, true);
    handleVeg(state.palms, optOn());
    flushHlod();

    for (let i = 0; i < state.walls.length; i++) {
      const w = state.walls[i];
      const d = Math.hypot(w.x - cx, w.z - cz);
      let which = 'far';
      // Near stays out to 22 m so the relief on the opposite corridor
      // wall (≈16–20 m) does not drop to mid (SSIM 0.98 at that swap).
      if (d < (optOn() ? 22 : 22)) which = 'near';
      else if (d < (optOn() ? 45 : 55)) which = 'mid';
      const g = w.lods && (w.lods[which] || w.lods.mid || w.lods.near);
      if (g && w.mesh.geometry !== g) { w.mesh.geometry = g; w.current = which; }
      // Far wall sections still visible (same side of the corridor) but
      // should not cast shadows — the proxy box on layer 1 already does
      // close shadows. We only flip the high-poly mesh.
      applyShadowCull(w.mesh, d);
    }

    // Stalls, houses, pots: same occlusion, far-hide, and shadow cull.
    // Distant ones are covered by the baked city HLOD impostor.
    const cityList = state.city || [];
    for (let i = 0; i < cityList.length; i++) {
      const e = cityList[i], mesh = e.mesh;
      if (!mesh || (mesh.userData && mesh.userData.sinHlod)) continue;
      const dx = e.x - cx, dz = e.z - cz;
      const dn = Math.max(0, Math.sqrt(dx * dx + dz * dz) - (e.r || 0));
      const occ = occludedByWall(e.x, e.z, e.r || 4, camera, plane);
      // Only far-hide at the fog cap. Do not drop stalls at VEG_HLOD_D:
      // the clustered house impostor was visually unacceptable, so there
      // is no replacement mesh for houses. Pots swap geos, they stay visible.
      const hideFar = dn > farLimit;
      if (occ || hideFar) {
        if (mesh.userData._sinWantVis == null) mesh.userData._sinWantVis = mesh.visible;
        mesh.visible = false;
        if (occ) occluded++; else farHide++;
        applyShadowCull(mesh, 1e6);
        continue;
      }
      if (mesh.userData && mesh.userData._sinWantVis != null) {
        mesh.visible = mesh.userData._sinWantVis !== false;
        mesh.userData._sinWantVis = null;
      }
      if (frustum && outdoorCullOn() && !mesh.isInstancedMesh && window.THREE) {
        const fwd = applyFrame._fwd || (applyFrame._fwd = new window.THREE.Vector3());
        camera.getWorldDirection(fwd);
        const depth = (e.x - cx) * fwd.x + (e.z - cz) * fwd.z;
        const sph = (applyFrame._citySph || (applyFrame._citySph = new window.THREE.Sphere()));
        sph.center.set(e.x, 1.2, e.z);
        sph.radius = Math.min(e.r || 4, 14) + 1.5;
        if (depth < -10 || !frustum.intersectsSphere(sph)) {
          if (mesh.userData._sinWantVis == null) mesh.userData._sinWantVis = mesh.visible;
          mesh.visible = false;
          farHide++;
          applyShadowCull(mesh, dn);
          continue;
        }
      }
      if (mesh.isInstancedMesh && e.matrices) {
        instFull += e.fullCount || 0;
        instKept += compactOutdoor(e, frustum, window.THREE);
      }
      if (optOn() && (e.lodMid || e.lodFar)) {
        // Clustered house/stall mid-far destroyed awnings (SSIM 0.87).
        // Only pots (rounded, 3840-tri, 441 instances = 1.69 M) and
        // truly distant monuments (dn > 80) use the baked HLOD geos.
        const isPot = e.srcTris === 3840 || /pot/i.test(mesh.name || '');
        const isMonument = e.srcTris > 40000 && !e.matrices;
        if (!isPot && !isMonument) {
          // Heavy houses/stalls at > 55 m: mid HLOD (same material, ~5–15 %
          // tris). At that distance they sit in fog; closer they keep the
          // original geo (cluster at 18 m crushed the awnings).
          const isFarHouse = e.srcTris >= 8000;
          if (isFarHouse && dn > 55) {
            const next = (dn > 70 && e.lodFar) ? e.lodFar : (e.lodMid || e.lodFar);
            if (next && mesh.geometry !== next) mesh.geometry = next;
          } else if (e.origGeo && mesh.geometry !== e.origGeo) {
            mesh.geometry = e.origGeo;
          }
        } else {
        const midD = isMonument ? 80 : 16;
        const farD = isMonument ? 120 : 32;
        let next = e.origGeo || mesh.geometry;
        if (dn > farD && e.lodFar) next = e.lodFar;
        else if (dn > midD && e.lodMid) next = e.lodMid;
        if (next && mesh.geometry !== next) mesh.geometry = next;
        }
      } else if (!optOn() && e.origGeo && mesh.geometry !== e.origGeo) {
        mesh.geometry = e.origGeo;
      }
      applyShadowCull(mesh, dn);
      // Merge far instanced city (pots) into HLOD batches to cut draws.
      if (optOn() && dn > vegHlodD() && mesh.isInstancedMesh && mesh.count > 0 && e.lodFar) {
        let parentVis = true;
        let p = mesh.parent;
        while (p) { if (p.visible === false) { parentVis = false; break; } p = p.parent; }
        if (parentVis && mesh.visible !== false && pushHlod(e, window.THREE, scene)) {
          if (mesh.userData._sinWantVis == null) mesh.userData._sinWantVis = mesh.visible;
          mesh.visible = false;
          hlodChunks++;
        }
      }
    }

    let visTris = 0, visDraws = 0;
    try {
      const inv = inventory(scene);
      visTris = inv.visTris;
      visDraws = inv.visDraws;
    } catch (_) {}
    state.lastVis = {
      occluded: occluded, farHide: farHide, hlodChunks: hlodChunks,
      instKept: instKept, instFull: instFull, shadowsOff: shadowsOff,
      visTris: visTris, visDraws: visDraws, farLimit: farLimit
    };
    if (frustum && !applyFrame._loggedCull) {
      applyFrame._loggedCull = true;
      try { console.info('[outdoor-perf] instance-cull', instKept + '/' + instFull, 'occluded', occluded, 'farHide', farHide, 'hlod', hlodChunks, 'tris', visTris, 'draws', visDraws); } catch (_) {}
    }
    return state.lastVis;
  }

  function beforeRender(scene, camera) {
    if (!scene) return;
    if (scene.userData && scene.userData.cityReleased) { releaseAfterCity(); return; }
    if (!window.THREE) return;
    try { pumpLodBuild(window.THREE, 3); } catch (_) {}
    if (!state.classified) {
      try { classify(scene, window.THREE); } catch (e) { try { console.warn('outdoor-perf classify', e); } catch (_) {} }
    } else if (state.lod && state.grass.length && !state.grass[0].mesh.userData.sinLodApplied) {
      // Pack arrived after the first classify: swap geometries now.
      try { state.classified = false; classify(scene, window.THREE); } catch (e) {}
    }
    if (state.classified && state._hlodPack && !state._hlodAttached) {
      try { attachHlodImpostor(scene, window.THREE); state._hlodAttached = true; } catch (_) {}
    }
    if (state.classified) {
      try { applyFrame(scene, camera); } catch (e) { try { console.warn('outdoor-perf frame', e); } catch (_) {} }
    }
  }

  function hookRenderer(THREE) {
    if (!THREE || !THREE.WebGLRenderer || THREE.WebGLRenderer.prototype.__sinOutdoorPerf) return;
    const orig = THREE.WebGLRenderer.prototype.render;
    THREE.WebGLRenderer.prototype.render = function (scene, camera) {
      if (!this.getRenderTarget() && camera && camera.isPerspectiveCamera) {
        beforeRender(scene, camera);
      }
      // Time the first classified outdoor present (cull already applied
      // in beforeRender) so the first-hitch claim is a measured number.
      const mark = (!hookRenderer._firstOutdoor && state.classified
        && !this.getRenderTarget() && camera && camera.isPerspectiveCamera);
      const t0 = mark ? performance.now() : 0;
      const r = orig.apply(this, arguments);
      if (mark) {
        hookRenderer._firstOutdoor = true;
        const dt = Math.round(performance.now() - t0);
        state.firstPresentMs = dt;
        try {
          console.info('[outdoor-perf] first-culled-present', dt + 'ms',
            state.lastVis && (state.lastVis.instKept + '/' + state.lastVis.instFull),
            'occluded', state.lastVis && state.lastVis.occluded);
        } catch (_) {}
      }
      return r;
    };
    THREE.WebGLRenderer.prototype.__sinOutdoorPerf = true;
  }

  function findScene() {
    if (typeof window === 'undefined') return null;
    if (window.__S && window.__S.isScene) return window.__S;
    if (window.SinGfx && SinGfx.status) {
      try {
        const st = SinGfx.status();
        // no scene on status; fall through
      } catch (_) {}
    }
    try {
      if (window.PalaceWings && PalaceWings.state && PalaceWings.state.ctx && PalaceWings.state.ctx.scene)
        return PalaceWings.state.ctx.scene;
    } catch (_) {}
    return null;
  }
  function findCamera() {
    if (typeof window === 'undefined') return null;
    if (window.__C && window.__C.isCamera) return window.__C;
    try {
      if (window.SinGfx && typeof SinGfx.getCamera === 'function') {
        const c = SinGfx.getCamera();
        if (c && c.isCamera) return c;
      }
    } catch (_) {}
    try {
      if (window.PalaceWings && PalaceWings.state && PalaceWings.state.ctx && PalaceWings.state.ctx.camera)
        return PalaceWings.state.ctx.camera;
    } catch (_) {}
    return null;
  }

  function geoByteSize(g) {
    if (!g) return 0;
    let n = 0;
    const attrs = (g.attributes) || {};
    Object.keys(attrs).forEach(function (k) {
      const a = attrs[k] && attrs[k].array;
      if (a && a.byteLength) n += a.byteLength;
    });
    const idx = g.index && g.index.array;
    if (idx && idx.byteLength) n += idx.byteLength;
    return n;
  }
  function disposeGeo(g) {
    if (!g || g.__sinOutdoorReleased) return 0;
    g.__sinOutdoorReleased = true;
    const bytes = geoByteSize(g);
    try { if (g.dispose) g.dispose(); } catch (_) {}
    try {
      const attrs = g.attributes || {};
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k]) attrs[k].array = null;
      });
      if (g.index) g.index.array = null;
    } catch (_) {}
    return bytes;
  }
  function countGeos() {
    let n = 0, bytes = 0;
    function add(g) { if (g && !g.__counted) { g.__counted = true; n++; bytes += geoByteSize(g); } }
    Object.keys(state.geos || {}).forEach(function (k) {
      const lods = state.geos[k] && state.geos[k].lods;
      if (lods) Object.keys(lods).forEach(function (ln) { add(lods[ln]); });
    });
    Object.keys(state._hlodGeos || {}).forEach(function (k) {
      const row = state._hlodGeos[k];
      if (row) { add(row.mid); add(row.far); }
    });
    function walk(list) {
      (list || []).forEach(function (e) {
        add(e.origGeo); add(e.lodMid); add(e.lodFar);
        if (e.lods) Object.keys(e.lods).forEach(function (ln) { add(e.lods[ln]); });
        if (e.mesh && e.mesh.geometry) add(e.mesh.geometry);
      });
    }
    walk(state.grass); walk(state.palms); walk(state.walls); walk(state.city);
    Object.keys(state.hlod || {}).forEach(function (k) {
      const h = state.hlod[k];
      if (h && h.mesh && h.mesh.geometry) add(h.mesh.geometry);
    });
    if (state.hlodImpostor && state.hlodImpostor.geometry) add(state.hlodImpostor.geometry);
    // clear marks
    function unmark(g) { if (g) g.__counted = false; }
    Object.keys(state.geos || {}).forEach(function (k) {
      const lods = state.geos[k] && state.geos[k].lods;
      if (lods) Object.keys(lods).forEach(function (ln) { unmark(lods[ln]); });
    });
    Object.keys(state._hlodGeos || {}).forEach(function (k) {
      const row = state._hlodGeos[k];
      if (row) { unmark(row.mid); unmark(row.far); }
    });
    function unwalk(list) {
      (list || []).forEach(function (e) {
        unmark(e.origGeo); unmark(e.lodMid); unmark(e.lodFar);
        if (e.lods) Object.keys(e.lods).forEach(function (ln) { unmark(e.lods[ln]); });
        if (e.mesh && e.mesh.geometry) unmark(e.mesh.geometry);
      });
    }
    unwalk(state.grass); unwalk(state.palms); unwalk(state.walls); unwalk(state.city);
    return { count: n, bytes: bytes };
  }
  function retentionSnapshot() {
    const geos = countGeos();
    let meshRefs = 0, matrixSlots = 0;
    function walk(list) {
      (list || []).forEach(function (e) {
        if (e.mesh) meshRefs++;
        if (e.matrices) matrixSlots += e.matrices.length;
      });
    }
    walk(state.grass); walk(state.palms); walk(state.walls); walk(state.city);
    Object.keys(state.hlod || {}).forEach(function (k) { if (state.hlod[k] && state.hlod[k].mesh) meshRefs++; });
    if (state.hlodImpostor) meshRefs++;
    let packBytes = 0;
    try {
      if (state._pack) packBytes += JSON.stringify(state._pack).length;
    } catch (_) { packBytes += 1; }
    try {
      if (state._hlodPack) packBytes += JSON.stringify(state._hlodPack).length;
    } catch (_) { packBytes += 1; }
    return {
      grass: (state.grass || []).length,
      palms: (state.palms || []).length,
      walls: (state.walls || []).length,
      city: (state.city || []).length,
      hlodChunks: Object.keys(state.hlod || {}).length,
      lodGeoKeys: Object.keys(state.geos || {}).length,
      lodGeos: geos.count,
      lodGeoBytes: geos.bytes,
      hlodGeoKeys: Object.keys(state._hlodGeos || {}).length,
      pack: !!state._pack,
      hlodPack: !!state._hlodPack,
      packBytes: packBytes,
      meshRefs: meshRefs,
      matrixSlots: matrixSlots,
      pollAlive: !!state._pollIv,
      lodPromise: !!state._lodPromise,
      hlodPromise: !!state._hlodPromise,
      released: !!state.released
    };
  }
  function emptyRetention() {
    const s = retentionSnapshot();
    return s.grass === 0 && s.palms === 0 && s.walls === 0 && s.city === 0
      && s.hlodChunks === 0 && s.lodGeoKeys === 0 && s.lodGeos === 0
      && s.hlodGeoKeys === 0 && !s.pack && !s.hlodPack && s.meshRefs === 0
      && s.matrixSlots === 0 && !s.pollAlive && !s.lodPromise && !s.hlodPromise
      && s.packBytes === 0;
  }

  // After palace entry the city is one-way gone. Drop every outdoor-perf
  // cache (LOD/HLOD geos, instance matrices, mesh refs, raw packs, poll)
  // so nothing from the city stays reachable.
  function releaseAfterCity() {
    if (state.released) {
      const prev = state._releaseReport || { after: retentionSnapshot(), emptied: emptyRetention() };
      return { already: true, before: prev.before, after: prev.after, emptied: prev.emptied };
    }
    const before = retentionSnapshot();
    state.released = true;
    try { if (state._pollIv != null) clearInterval(state._pollIv); } catch (_) {}
    state._pollIv = null;
    state._lodPromise = null;
    state._hlodPromise = null;

    function dropMesh(mesh) {
      if (!mesh) return;
      try { if (mesh.parent && mesh.parent.remove) mesh.parent.remove(mesh); } catch (_) {}
      try { if (mesh.geometry) disposeGeo(mesh.geometry); } catch (_) {}
      try {
        const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
        mats.forEach(function (m) {
          if (!m) return;
          // Only dispose materials tagged as outdoor-lod/hlod, never palaceShared.
          if (m.userData && (m.userData.sinLod || m.userData.sinHlod) && m.dispose) m.dispose();
        });
      } catch (_) {}
    }
    function walkDrop(list) {
      (list || []).forEach(function (e) {
        disposeGeo(e.origGeo);
        disposeGeo(e.lodMid);
        disposeGeo(e.lodFar);
        if (e.lods) Object.keys(e.lods).forEach(function (ln) { disposeGeo(e.lods[ln]); });
        // Mesh itself was (or will be) removed by releaseCity; drop our refs
        // and any LOD geo that lived only in this cache.
        if (e.mesh && e.mesh.geometry && e.mesh.geometry.userData && e.mesh.geometry.userData.sinLod)
          disposeGeo(e.mesh.geometry);
        e.matrices = null;
        e.mesh = null;
        e.origGeo = null;
        e.lodMid = null;
        e.lodFar = null;
        e.lods = null;
        e.geoCenter = null;
      });
    }
    walkDrop(state.grass);
    walkDrop(state.palms);
    walkDrop(state.walls);
    walkDrop(state.city);
    Object.keys(state.geos || {}).forEach(function (k) {
      const lods = state.geos[k] && state.geos[k].lods;
      if (lods) Object.keys(lods).forEach(function (ln) { disposeGeo(lods[ln]); });
    });
    Object.keys(state._hlodGeos || {}).forEach(function (k) {
      const row = state._hlodGeos[k];
      if (row) { disposeGeo(row.mid); disposeGeo(row.far); }
    });
    Object.keys(state.hlod || {}).forEach(function (k) {
      const h = state.hlod[k];
      if (h) dropMesh(h.mesh);
    });
    dropMesh(state.hlodImpostor);

    state.geos = {};
    state._hlodGeos = {};
    state._hlodPack = null;
    state._pack = null;
    state._lodKeys = null;
    state.lod = null;
    state.grass = [];
    state.palms = [];
    state.walls = [];
    state.city = [];
    state.hlod = {};
    state.hlodImpostor = null;
    state.classified = false;
    state.ready = true;
    state._hlodAttached = false;
    state._lodStarted = true; // do not refetch
    state._lodBuildI = 0;
    state.wallPlane = null;
    state.before = null;
    state.lastVis = { tris: 0, draws: 0, culled: 0, occluded: 0 };
    const after = retentionSnapshot();
    const report = { before: before, after: after, emptied: emptyRetention() };
    state._releaseReport = report;
    try { console.info('[outdoor-perf] released-after-city', JSON.stringify(report)); } catch (_) {}
    return report;
  }

  var CITY_LEAK_RE = /PalaceExterior|Ishtar|new-grass-tufts|grass_tuft|babylonian_wall|skyline|sky_babylon|market-stall|processional|outdoor-hlod|sinHlod|vegChunk|palm_tree|date_palm|city-hlod|__sinOutdoor/i;
  function cityLeakScan(scene, renderer) {
    const outdoor = retentionSnapshot();
    const sceneHits = [];
    if (scene && scene.traverse) {
      scene.traverse(function (o) {
        if (o.userData && o.userData.keepDuringPalace) return;
        const n = (o.name || '') + ' ' + ((o.userData && (o.userData.kind || o.userData.src || '')) || '');
        const lod = !!(o.userData && o.userData.sinLod) || !!(o.geometry && o.geometry.userData && o.geometry.userData.sinLod);
        const hlod = !!(o.userData && o.userData.sinHlod);
        if (lod || hlod || CITY_LEAK_RE.test(n)) {
          sceneHits.push({
            name: o.name || o.type,
            type: o.type,
            sinLod: lod,
            sinHlod: hlod,
            geoBytes: geoByteSize(o.geometry)
          });
        }
      });
    }
    let cacheKeys = [];
    try {
      const THREE = (typeof window !== 'undefined' && window.THREE) || (typeof globalThis !== 'undefined' && globalThis.THREE);
      if (THREE && THREE.Cache && THREE.Cache.files) cacheKeys = Object.keys(THREE.Cache.files);
    } catch (_) {}
    const mem = renderer && renderer.info && renderer.info.memory;
    const programs = mem && mem.programs;
    const info = mem ? {
      geometries: mem.geometries || 0,
      textures: mem.textures || 0,
      programs: Array.isArray(programs) ? programs.length : (programs || 0)
    } : null;
    const report = state._releaseReport || null;
    const ok = emptyRetention() && sceneHits.length === 0 && cacheKeys.length === 0;
    return {
      ok: ok,
      outdoor: outdoor,
      release: report,
      sceneHits: sceneHits,
      cacheKeys: cacheKeys,
      rendererInfo: info,
      emptied: emptyRetention()
    };
  }

  function start() {
    const boot = function () {
      if (state.released) return false;
      const THREE = (typeof window !== 'undefined') && window.THREE;
      if (!THREE) return false;
      hookRenderer(THREE);
      if (!state._lodStarted) {
        state._lodStarted = true;
        loadLod(THREE).catch(function () { state.ready = true; });
        loadHlod(THREE);
      }
      return true;
    };
    boot();
    if (typeof setInterval === 'function') {
      let n = 0;
      const iv = setInterval(function () {
        if (state.released) { try { clearInterval(iv); } catch (_) {} return; }
        n++;
        boot();
        try {
          const scene = findScene();
          const cam = findCamera();
          if (scene && scene.userData && scene.userData.cityReleased) {
            releaseAfterCity();
            return;
          }
          if (scene && window.THREE) {
            pumpLodBuild(window.THREE, 4);
            if (!state.classified) classify(scene, window.THREE);
            const swapped = applyLods();
            if (swapped) try { console.log('[outdoor-perf] applied lods', swapped); } catch (_) {}
            if (state.classified && cam) applyFrame(scene, cam);
          }
        } catch (e) {
          try { console.warn('outdoor-perf poll', e); } catch (_) {}
        }
        if (n > 3600) { try { clearInterval(iv); } catch (_) {} state._pollIv = null; }
      }, 200);
      state._pollIv = iv;
      try { if (iv && typeof iv.unref === 'function') iv.unref(); } catch (_) {}
    }
  }
  start();

  /* Pure helper, also used by unit tests (no THREE required). */
  function occludedTest(x, z, r, camPos, plane) {
    return occludedByWall(x, z, r, { position: camPos }, plane);
  }

  const api = {
    beforeRender: beforeRender,
    inventory: inventory,
    occludedByWall: occludedTest,
    state: state,
    classify: function (scene) { return classify(scene, window.THREE); },
    applyFrame: applyFrame,
    ready: function () { return state.ready && state.classified; },
    last: function () { return state.lastVis; },
    compactOutdoor: compactOutdoor,
    snapshotInstances: snapshotInstances,
    wallPlane: function () { return state.wallPlane; },
    applyLods: applyLods,
    pumpLodBuild: pumpLodBuild,
    liveTrisOf: liveTrisOf,
    pickVegLod: function (e, dn) { return pickVegLod(e, dn); },
    attachLodLadder: attachLodLadder,
    counts: function () {
      const lodded = (state.grass.filter(function (e) { return e.mesh && e.mesh.userData && e.mesh.userData.sinLodApplied; }).length);
      return { grass: state.grass.length, palms: state.palms.length, walls: state.walls.length, lodded: lodded, lodReady: !!state.lod };
    },
    releaseAfterCity: releaseAfterCity,
    retentionSnapshot: retentionSnapshot,
    cityLeakScan: cityLeakScan,
    emptyRetention: emptyRetention
  };
  root.SinOutdoorPerf = api;
})(typeof window !== 'undefined' ? window : globalThis);
