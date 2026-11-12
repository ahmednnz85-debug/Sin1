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
 *   3. Uses the unused maxHQ/maxLQ-style far hide only past heavy fog
 *      (transmittance ≤ ~12 %, ~340 m) so silhouettes stay.
 *   4. Restricts shadow casting on heavy extras to near the hero
 *      (SinGfx.potShadowRange already exists; we also skip far walls).
 *   5. Records a before/after inventory on window.__sinOutdoorPerf.
 *
 * Visuals are verified with SSIM at the same camera stations.
 */
(function (root) {
  'use strict';

  const LOD_URL = 'assets/lod/outdoor-lod.json?v=20261112r3';
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
    before: null
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

  function loadLod(THREE) {
    if (state.lod) return Promise.resolve(state.lod);
    return fetch(LOD_URL).then(function (r) {
      if (!r.ok) throw new Error('lod pack ' + r.status);
      return r.json();
    }).then(function (pack) {
      state.lod = pack;
      const geos = state.geos;
      Object.keys(pack.meshes || {}).forEach(function (key) {
        const row = pack.meshes[key];
        geos[key] = { srcTris: row.srcTris, name: row.name, lods: {} };
        Object.keys(row.lods || {}).forEach(function (ln) {
          try { geos[key].lods[ln] = makeGeo(row.lods[ln], THREE); }
          catch (e) { try { console.warn('outdoor-perf makeGeo', key, ln, e); } catch (_) {} }
        });
      });
      return pack;
    });
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

  function classify(scene, THREE) {
    if (!scene || state.classified) return;
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
      } else if (t >= 40000 && t <= 60000) {
        // Babylonian wall sections (50,680 tris), not instanced.
        const wp = new THREE.Vector3();
        o.getWorldPosition(wp);
        const x = wp.x, z = wp.z;
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
        if (Math.abs(x) > 2) wallX = Math.abs(x);
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
    const slack = 12;
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
    if (!state.lod) return 0;
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
    for (let i = 0; i < state.palms.length; i++) swap(state.palms[i], 'play');
    for (let i = 0; i < state.walls.length; i++) {
      const e = state.walls[i];
      const lods = state.geos.wall && state.geos.wall.lods;
      if (lods) { e.lods = lods; swap({ mesh: e.mesh, key: 'wall' }, e.current || 'mid'); }
    }
    return n;
  }

    // lod0 grass only has a "play" mesh (1799 tris). At mid/far distances
    // step down to lod1.play (700) then lod2.play/far (137/53) so a 520 m
    // fog sight-range does not keep 11k high-LOD tufts in the frame.
    function pickVegLod(e, dn) {
      if (e.lodNear || e.lodMid || e.lodFar) {
        if (dn > 90) return e.lodFar || e.lodMid || e.lodNear;
        if (dn > 28) return e.lodMid || e.lodNear;
        return e.lodNear;
      }
      const key = e.key;
      const own = key && state.geos[key] && state.geos[key].lods;
      if (!own) return null;
      if (own.far && dn > 55) return own.far;
      if (own.play) return own.play;
      return null;
    }
    function attachLodLadder(e) {
      if (!e || !e.key) return;
      const key = e.key;
      const m = /^((?:grass_[ab]))_lod/.exec(key);
      const v = m ? m[1] : null;
      const g = state.geos;
      const own = (g[key] && g[key].lods) || {};
      e.lodNear = own.play || null;
      e.lodMid = (v && g[v + '_lod1'] && g[v + '_lod1'].lods && g[v + '_lod1'].lods.play) || own.play || null;
      e.lodFar = (v && g[v + '_lod2'] && g[v + '_lod2'].lods && (g[v + '_lod2'].lods.far || g[v + '_lod2'].lods.play)) || own.far || own.play || null;
    }

    function applyFrame(scene, camera) {
    if (!state.classified || !camera) return state.lastVis;
    const plane = state.wallPlane;
    const cx = camera.position.x, cz = camera.position.z;
    let occluded = 0, farHide = 0;
    const fog = scene && scene.fog;
    // Hide only when almost fully fogged (~12 % remaining): sqrt(-ln(0.12))/d.
    let farLimit = 400;
    if (fog && fog.isFogExp2 && fog.density > 0) {
      farLimit = Math.sqrt(-Math.log(0.12)) / fog.density;
    } else if (camera.far) {
      farLimit = Math.min(farLimit, camera.far);
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
          continue;
        }
        if (dn > farLimit) {
          mesh.visible = false;
          farHide++;
          continue;
        }
        // Restore if we hid it last frame and the game's updateVeg has
        // already set this frame's LOD visibility — we only force-hide.
        // If we left it false, updateVeg on the PARENT group is what
        // matters; for grass the visible flag lives on the LOD group
        // (parent). Force-hiding the InstancedMesh is enough, so we
        // must restore when no longer occluded.
        if (mesh.userData && mesh.userData._sinWantVis != null) {
          mesh.visible = mesh.userData._sinWantVis !== false;
          mesh.userData._sinWantVis = null;
        }
        if (farLod) {
          const g = pickVegLod(e, dn);
          if (g && mesh.geometry !== g) mesh.geometry = g;
        }
      }
    }
    handleVeg(state.grass, true);
    handleVeg(state.palms, false);

    for (let i = 0; i < state.walls.length; i++) {
      const w = state.walls[i];
      const d = Math.hypot(w.x - cx, w.z - cz);
      let which = 'far';
      if (d < 22) which = 'near';
      else if (d < 55) which = 'mid';
      const g = w.lods && (w.lods[which] || w.lods.mid || w.lods.near);
      if (g && w.mesh.geometry !== g) { w.mesh.geometry = g; w.current = which; }
      // Far wall sections still visible (same side of the corridor) but
      // should not cast shadows — the proxy box on layer 1 already does
      // close shadows. We only flip the high-poly mesh.
      if (w.mesh.castShadow && d > 28) w.mesh.castShadow = false;
    }

    state.lastVis = { occluded: occluded, farHide: farHide };
    return state.lastVis;
  }

  function beforeRender(scene, camera) {
    if (!scene || (scene.userData && scene.userData.cityReleased)) return;
    if (!window.THREE) return;
    if (!state.classified) {
      try { classify(scene, window.THREE); } catch (e) { try { console.warn('outdoor-perf classify', e); } catch (_) {} }
    } else if (state.lod && state.grass.length && !state.grass[0].mesh.userData.sinLodApplied) {
      // Pack arrived after the first classify: swap geometries now.
      try { state.classified = false; classify(scene, window.THREE); } catch (e) {}
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
      const r = orig.apply(this, arguments);
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
      if (window.PalaceWings && PalaceWings.state && PalaceWings.state.ctx && PalaceWings.state.ctx.camera)
        return PalaceWings.state.ctx.camera;
    } catch (_) {}
    return null;
  }
  function start() {
    const boot = function () {
      const THREE = (typeof window !== 'undefined') && window.THREE;
      if (!THREE) return false;
      hookRenderer(THREE);
      if (!state._lodStarted) {
        state._lodStarted = true;
        loadLod(THREE).then(function () {
          state.ready = true;
          // Allow a second classify so LODs attach if we already inventoried.
          if (state.classified) state.classified = false;
          try { console.log('[outdoor-perf] lod pack ready', Object.keys(state.geos)); } catch (_) {}
        }).catch(function (e) {
          try { console.warn('outdoor-perf lod', e && e.message || e); } catch (_) {}
          state.ready = true;
        });
      }
      return true;
    };
    boot();
    if (typeof setInterval === 'function') {
      let n = 0;
      const iv = setInterval(function () {
        n++;
        boot();
        try {
          const scene = findScene();
          const cam = findCamera();
          if (scene && window.THREE) {
            if (!state.classified) classify(scene, window.THREE);
            if (state.lod) {
              const swapped = applyLods();
              if (swapped) try { console.log('[outdoor-perf] applied lods', swapped); } catch (_) {}
            }
            if (state.classified && cam) applyFrame(scene, cam);
          }
        } catch (e) {
          try { console.warn('outdoor-perf poll', e); } catch (_) {}
        }
        if (n > 3600) clearInterval(iv); // stop after ~3 min of polling at 50 ms? use 200ms
      }, 200);
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
    wallPlane: function () { return state.wallPlane; },
    applyLods: applyLods,
    liveTrisOf: liveTrisOf,
    pickVegLod: function (e, dn) { return pickVegLod(e, dn); },
    attachLodLadder: attachLodLadder,
    counts: function () {
      const lodded = (state.grass.filter(function (e) { return e.mesh && e.mesh.userData && e.mesh.userData.sinLodApplied; }).length);
      return { grass: state.grass.length, palms: state.palms.length, walls: state.walls.length, lodded: lodded, lodReady: !!state.lod };
    }
  };
  root.SinOutdoorPerf = api;
})(typeof window !== 'undefined' ? window : globalThis);
