/* Curse of Babylon — T1 "Sacred Entrance" (Temple wing).
   Fully procedural interior built from the reference image of the moon-god
   entrance hall: colonnade, upper galleries, clerestory windows, glazed
   relief walls (robed figures, vessels, crescents, rosette and cuneiform
   friezes), torch sconces, smoking braziers, crescent floor mosaic and the
   grand arched lamassu portal.
   Each family of parts has its own material, allowing the finished room to be
   painted without changing its geometry or the materials' surface properties:
     SinT1Entrance.setColor('wallTile', 0x23408f)
     SinT1Entrance.setTexture('floor', texture)
     SinT1Entrance.materials  -> { key: MeshStandardMaterial }
   Geometry stays strictly inside the existing T1 footprint and leaves every
   doorway of the room open. */
(function () {
  'use strict';
  const PALETTE = {             // fallback colors remain available beneath atlas maps
    wallStone:  0x8a8a8a, wallTile:  0x7a7a7a, frieze:  0x9a9a9a, relief:  0xb0b0b0,
    column:     0x949494, capital:   0xa4a4a4, base:    0x7e7e7e,
    floor:      0x4a4a4a, floorJoint:0x3a3a3a, mosaic:  0x6e6e6e, mosaicMoon: 0xc8c8c8, inlay: 0xa8a8a8,
    portal:     0x9c9c9c, doorFrame: 0x9c9c9c, door: 0x6a6a6a, doorRelief: 0xbababa,
    gallery:    0x888888, ceiling:   0x5e5e5e, beam:    0x707070,
    window:     0xd8dde4, metal:     0x5a5a5a, brazier: 0x8e8e8e, flame: 0xffffff
  };
  const api = { materials: {}, groups: {}, root: null, textureLoadStatus: {} };
  const textureCache = Object.create(null);
  const TEXTURE_ROOT = 'assets/textures/rooms/T1/maps/';
  const TEXTURE_DEFS = [
    { slot: 'wallTile', file: 't1_wall_tile.webp', tile: [2.2, 1.45] },
    { slot: 'relief', file: 't1_relief.webp', tile: [0.42, 0.42] },
    { slot: 'frieze', file: 't1_frieze.webp', tile: [2.8, 0.42] },
    { slot: 'column', file: 't1_column.webp', tile: [2.55, 0.9] },
    { slot: 'wallStone', file: 't1_column.webp', tile: [2.55, 0.9] },
    { slot: 'capital', file: 't1_capital.webp', tile: [1.5, 0.9] },
    { slot: 'base', file: 't1_column_base.webp', tile: [2.1, 0.58] },
    { slot: 'floor', file: 't1_floor.webp', tile: [1.5, 1.5] },
    { slot: 'mosaic', file: 't1_mosaic.webp', tile: [0.42, 0.42] },
    { slot: 'mosaicMoon', file: 't1_mosaic_moon.webp', tile: [0.3, 0.3] },
    { slot: 'inlay', file: 't1_inlay.webp', tile: [0.18, 1.6] },
    { slot: 'door', file: 't1_door.webp', tile: [0.85, 0.42] },
    { slot: 'doorRelief', file: 't1_door_relief.webp', tile: [2.0, 0.34] },
    { slot: 'doorFrame', file: 't1_door_frame.webp', tile: [0.28, 1.45] },
    { slot: 'portal', file: 't1_portal.webp', tile: [0.3, 1.4] },
    { slot: 'gallery', file: 't1_gallery.webp', tile: [2.2, 0.58] },
    { slot: 'beam', file: 't1_beam.webp', tile: [2.1, 0.52] },
    { slot: 'ceiling', file: 't1_ceiling.webp', tile: [0.9, 0.9] },
    { slot: 'window', file: 't1_window.webp', tile: [0.9, 1.25] },
    { slot: 'brazier', file: 't1_brazier.webp', tile: [1.4, 0.38] },
    { slot: 'metal', file: 't1_metal.webp', tile: [0.95, 0.65] }
  ];
  const MATERIAL_ALIAS = { columnBase: 'base' };
  function materialKey(key) { return MATERIAL_ALIAS[key] || key; }

  function mat(key) {
    if (api.materials[key]) return api.materials[key];
    const glow = key === 'window' || key === 'flame';
    const finish = {
      floor: [0.4, 0.02], wallTile: [0.78, 0.03], mosaic: [0.42, 0.05], mosaicMoon: [0.42, 0.05],
      metal: [0.38, 0.58], brazier: [0.52, 0.3], capital: [0.62, 0.16], frieze: [0.66, 0.14],
      inlay: [0.56, 0.25], door: [0.7, 0.03], doorRelief: [0.62, 0.16], doorFrame: [0.76, 0.04],
      portal: [0.78, 0.03], beam: [0.74, 0.02], window: [0.38, 0.04]
    }[key] || [0.84, 0.02];
    const m = new THREE.MeshStandardMaterial({
      color: PALETTE[key], roughness: finish[0], metalness: finish[1],
      emissive: glow ? PALETTE[key] : 0x000000, emissiveIntensity: key === 'window' ? 0.55 : (key === 'flame' ? 1.4 : 0)
    });
    m.name = 'T1-mat-' + key; api.materials[key] = m; return m;
  }
  api.setColor = function (key, hex) { const m = api.materials[materialKey(key)]; if (m) { m.color.set(hex); m.needsUpdate = true; } return !!m; };
  api.setTexture = function (key, tex) { const m = api.materials[materialKey(key)]; if (m) { m.map = tex || null; m.needsUpdate = true; } return !!m; };
  api.setEmissive = function (key, hex, k) { const m = api.materials[key]; if (m) { m.emissive.set(hex); if (k != null) m.emissiveIntensity = k; } return !!m; };
  api.keys = function () { return Object.keys(PALETTE); };
  api.textureKeys = function () { return TEXTURE_DEFS.map(x => x.slot); };
  api.getTextureLoadStatus = function () { return Object.assign({}, api.textureLoadStatus); };

  function loadAtlasTextures() {
    if (typeof THREE.TextureLoader !== 'function') return;
    TEXTURE_DEFS.forEach(function (def) {
      const material = api.materials[materialKey(def.slot)];
      if (!material) { api.textureLoadStatus[def.slot] = 'material-missing'; return; }
      const url = TEXTURE_ROOT + def.file;
      let texture = textureCache[url];
      if (!texture) {
        api.textureLoadStatus[def.slot] = 'loading';
        texture = new THREE.TextureLoader().load(encodeURI(url), function (loaded) {
          loaded.wrapS = loaded.wrapT = THREE.MirroredRepeatWrapping;
          loaded.minFilter = THREE.LinearMipmapLinearFilter;
          loaded.magFilter = THREE.LinearFilter;
          loaded.generateMipmaps = true;
          loaded.encoding = THREE.sRGBEncoding;
          loaded.anisotropy = 4;
          loaded.userData = loaded.userData || {};
          loaded.userData.palaceShared = true;
          loaded.userData.t1AtlasMap = def.file;
          loaded.needsUpdate = true;
          textureCache[url] = loaded;
          TEXTURE_DEFS.filter(peer => peer.file === def.file).forEach(function (peer) {
            api.setTexture(peer.slot, loaded);
            api.setColor(peer.slot, 0xffffff);
            api.textureLoadStatus[peer.slot] = 'loaded';
          });
        }, undefined, function (error) {
          delete textureCache[url];
          TEXTURE_DEFS.filter(peer => peer.file === def.file).forEach(peer => { api.textureLoadStatus[peer.slot] = 'error'; });
          try { console.warn('[T1] texture failed:', def.file, error); } catch (_) {}
        });
        texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.encoding = THREE.sRGBEncoding;
        texture.anisotropy = 4;
        texture.userData = texture.userData || {};
        texture.userData.palaceShared = true;
        textureCache[url] = texture;
      } else {
        api.textureLoadStatus[def.slot] = texture.image ? 'loaded-cached' : 'loading-cached';
      }
      api.setTexture(def.slot, texture);
      api.setColor(def.slot, 0xffffff);
    });
  }

  // Royal Babylonian finish: setColor changes only material color, preserving
  // the existing roughness, metalness, emissive settings, and any texture maps.
  function paintRoyalT1() {
    api.setColor('wallTile', 0x23408F);
    api.setColor('relief', 0xA88A61);
    api.setColor('frieze', 0xB58A42);
    api.setColor('column', 0x888477);
    api.setColor('capital', 0xB28A48);
    api.setColor('floor', 0x242A35);
    api.setColor('mosaic', 0x193A79);
    api.setColor('mosaicMoon', 0xD7B45C);
    api.setColor('inlay', 0xA17B39);
    api.setColor('door', 0x38291D);
    api.setColor('doorRelief', 0xC09A50);
    api.setColor('doorFrame', 0x8B7658);
    api.setColor('portal', 0x8B7658);
    api.setColor('gallery', 0x243A60);
    api.setColor('beam', 0x403020);
    api.setColor('ceiling', 0x18263D);
    api.setColor('window', 0x78B5D9);
    api.setColor('brazier', 0x87572F);
    api.setColor('metal', 0xC09A50);

    // Complementary structural slots not listed in the 18-color brief.
    api.setColor('wallStone', 0x888477);
    api.setColor('base', 0x888477);
    api.setColor('floorJoint', 0x242A35);
  }

  /* ---- geometry buckets: merged per material => few draw calls ---------- */
  function repeatUvs(g, key, type, sx, sy, sz) {
    const def = TEXTURE_DEFS.find(x => materialKey(x.slot) === key);
    if (!def || !g.attributes.position || !g.attributes.uv) return;
    const uv = g.attributes.uv, p = g.attributes.position, tileX = def.tile[0], tileY = def.tile[1];
    const scale = [Math.abs(sx || 1), Math.abs(sy || 1), Math.abs(sz || 1)];
    if (type === 'BoxGeometry' && p.count % 6 === 0) {
      for (let start = 0; start < p.count; start += 6) {
        const axisScore = function (axis, channel) {
          let mp = 0, mu = 0;
          for (let i = start; i < start + 6; i++) { mp += p.getComponent(i, axis); mu += uv.getComponent(i, channel); }
          mp /= 6; mu /= 6;
          let cov = 0, vp = 0, vu = 0, lo = Infinity, hi = -Infinity;
          for (let i = start; i < start + 6; i++) {
            const dp = p.getComponent(i, axis) - mp, du = uv.getComponent(i, channel) - mu;
            cov += dp * du; vp += dp * dp; vu += du * du;
            lo = Math.min(lo, p.getComponent(i, axis)); hi = Math.max(hi, p.getComponent(i, axis));
          }
          return { axis: axis, score: vp && vu ? Math.abs(cov) / Math.sqrt(vp * vu) : 0, extent: hi - lo };
        };
        const best = [0, 1].map(channel => [0, 1, 2].map(axis => axisScore(axis, channel)).sort((a, b) => b.score - a.score)[0]);
        if (best[0].axis === best[1].axis) {
          const alternatives = [0, 1, 2].filter(axis => axis !== best[0].axis).map(axis => axisScore(axis, 1)).sort((a, b) => b.score - a.score);
          if (alternatives.length) best[1] = alternatives[0];
        }
        const uRepeat = best[0].extent * scale[best[0].axis] / tileX;
        const vRepeat = best[1].extent * scale[best[1].axis] / tileY;
        for (let i = start; i < start + 6; i++) { uv.setX(i, uv.getX(i) * uRepeat); uv.setY(i, uv.getY(i) * vRepeat); }
      }
    } else if (type === 'CylinderGeometry' || type === 'LatheGeometry') {
      g.computeBoundingBox();
      const b = g.boundingBox, diameter = (b.max.x - b.min.x) * scale[0] + (b.max.z - b.min.z) * scale[2];
      const circumference = Math.PI * diameter / 2;
      const height = (b.max.y - b.min.y) * scale[1];
      for (let i = 0; i < uv.count; i++) { uv.setX(i, uv.getX(i) * circumference / tileX); uv.setY(i, uv.getY(i) * height / tileY); }
    } else {
      g.computeBoundingBox();
      const b = g.boundingBox;
      const width = (b.max.x - b.min.x) * scale[0], height = (b.max.y - b.min.y) * scale[1];
      for (let i = 0; i < uv.count; i++) { uv.setX(i, uv.getX(i) * width / tileX); uv.setY(i, uv.getY(i) * height / tileY); }
    }
    uv.needsUpdate = true;
  }
  function Buckets() { this.parts = {}; }
  Buckets.prototype.add = function (key, geo, x, y, z, ry, rx, rz, sx, sy, sz) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0, 'YXZ'));
    m4.compose(new THREE.Vector3(x || 0, y || 0, z || 0), q, new THREE.Vector3(sx || 1, sy || 1, sz || 1));
    const type = geo.type;
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (geo.index) geo.dispose();
    repeatUvs(g, key, type, sx, sy, sz);
    g.applyMatrix4(m4);
    (this.parts[key] || (this.parts[key] = [])).push(g);
  };
  function merge(list) {
    let n = 0; list.forEach(g => { n += g.attributes.position.count; });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let o = 0;
    list.forEach(g => {
      const c = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      o += c; g.dispose();
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.computeBoundingBox(); out.computeBoundingSphere();
    return out;
  }
  Buckets.prototype.flush = function (parent) {
    Object.keys(this.parts).forEach(key => {
      const m = new THREE.Mesh(merge(this.parts[key]), mat(key));
      m.name = 'T1-' + key; m.castShadow = false; m.receiveShadow = true;
      m.userData.t1Part = key; parent.add(m); api.groups[key] = m;
    });
    this.parts = {};
  };

  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt, rb, h, s) => new THREE.CylinderGeometry(rt, rb, h, s || 16);
  const lathe = (pts, s) => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), s || 20);
  function crescentShape(R, r, off) {
    const s = new THREE.Shape(); s.absarc(0, 0, R, 0, Math.PI * 2, false);
    const h = new THREE.Path(); h.absarc(off, off * 0.35, r, 0, Math.PI * 2, true); s.holes.push(h); return s;
  }
  const crescent = (R, r, off, depth) => new THREE.ExtrudeGeometry(crescentShape(R, r, off), { depth: depth, bevelEnabled: false, curveSegments: 24 });

  /* ---- wall frame: a wall is described in local coords (u along, v up) ---
     side: 'N' (z0, faces +z), 'S' (z1, faces -z), 'W' (x0, faces +x), 'E' (x1, faces -x) */
  function wallFrame(b, side) {
    if (side === 'N') return { len: b.x1 - b.x0, at: (u, v, d) => [b.x0 + u, v, b.z0 + d], ry: 0 };
    if (side === 'S') return { len: b.x1 - b.x0, at: (u, v, d) => [b.x1 - u, v, b.z1 - d], ry: Math.PI };
    if (side === 'W') return { len: b.z1 - b.z0, at: (u, v, d) => [b.x0 + d, v, b.z1 - u], ry: Math.PI / 2 };
    return { len: b.z1 - b.z0, at: (u, v, d) => [b.x1 - d, v, b.z0 + u], ry: -Math.PI / 2 };
  }
  function put(B, F, key, geo, u, v, d, extraRy, rx, rz, sx, sy, sz) {
    const p = F.at(u, v, d); B.add(key, geo, p[0], p[1], p[2], F.ry + (extraRy || 0), rx, rz, sx, sy, sz);
  }
  // openings (doorways) on a wall in local u
  function openingsFor(b, side, doors) {
    const out = [];
    doors.forEach(d => {
      const onX = d.axis === 'x';
      if (onX && (side === 'W' || side === 'E')) {
        const wx = side === 'W' ? b.x0 : b.x1;
        if (Math.abs(d.x - wx) > 4 || d.z < b.z0 - 0.5 || d.z > b.z1 + 0.5) return;
        const u = side === 'W' ? b.z1 - d.z : d.z - b.z0;
        out.push({ u0: u - d.width / 2 - 0.15, u1: u + d.width / 2 + 0.15, h: d.height, w: d.width, u: u, door: d });
      } else if (!onX && (side === 'N' || side === 'S')) {
        const wz = side === 'N' ? b.z0 : b.z1;
        if (Math.abs(d.z - wz) > 1.6 || d.x < b.x0 - 0.5 || d.x > b.x1 + 0.5) return;
        const u = side === 'N' ? d.x - b.x0 : b.x1 - d.x;
        out.push({ u0: u - d.width / 2 - 0.15, u1: u + d.width / 2 + 0.15, h: d.height, w: d.width, u: u, door: d });
      }
    });
    return out;
  }
  // free spans of a wall between openings (and a margin at corners)
  function spans(len, ops, margin) {
    const s = []; let a = margin;
    ops.slice().sort((p, q) => p.u0 - q.u0).forEach(o => { if (o.u0 - a > 0.3) s.push([a, o.u0]); a = Math.max(a, o.u1); });
    if (len - margin - a > 0.3) s.push([a, len - margin]);
    return s;
  }

  /* ---- relief motifs (built facing +local depth) ------------------------- */
  function robedFigure(B, F, u, y, d, scale, facing, offering) {
    const s = scale, f = facing; // f = +1 faces +u, -1 faces -u
    put(B, F, 'relief', box(0.55 * s, 1.55 * s, 0.07), u, y + 0.78 * s, d);                       // robe
    put(B, F, 'relief', box(0.7 * s, 0.12 * s, 0.075), u, y + 0.08 * s, d);                       // hem fringe
    put(B, F, 'relief', box(0.42 * s, 0.38 * s, 0.08), u, y + 1.62 * s, d);                       // shoulders
    put(B, F, 'relief', cyl(0.13 * s, 0.13 * s, 0.07, 14), u + 0.02 * f * s, y + 1.98 * s, d + 0.035, 0, Math.PI / 2); // head
    put(B, F, 'relief', box(0.2 * s, 0.28 * s, 0.075), u, y + 2.24 * s, d);                       // tall crown
    put(B, F, 'relief', box(0.16 * s, 0.22 * s, 0.072), u + 0.14 * f * s, y + 1.8 * s, d);        // beard
    put(B, F, 'relief', box(0.5 * s, 0.1 * s, 0.085), u + 0.28 * f * s, y + 1.38 * s, d, 0, 0, 0.5 * f); // raised arm
    if (offering) put(B, F, 'relief', cyl(0.14 * s, 0.07 * s, 0.14 * s, 12), u + 0.5 * f * s, y + 1.6 * s, d + 0.04, 0, Math.PI / 2); // bowl
    put(B, F, 'relief', box(0.08 * s, 0.9 * s, 0.072), u - 0.18 * f * s, y + 0.75 * s, d);        // robe fold
  }
  function vessel(B, F, u, y, d, s) {
    put(B, F, 'relief', box(0.4 * s, 0.75 * s, 0.07), u, y + 0.5 * s, d);
    put(B, F, 'relief', box(0.55 * s, 0.25 * s, 0.075), u, y + 0.55 * s, d);
    put(B, F, 'relief', box(0.22 * s, 0.25 * s, 0.07), u, y + 1.0 * s, d);
    put(B, F, 'relief', box(0.4 * s, 0.08 * s, 0.075), u, y + 1.13 * s, d);
    put(B, F, 'relief', box(0.3 * s, 0.1 * s, 0.07), u, y + 0.06 * s, d);
    for (let i = -1; i <= 1; i++) put(B, F, 'relief', cyl(0.06 * s, 0.06 * s, 0.06, 8), u + i * 0.13 * s, y + 1.24 * s, d + 0.03, 0, Math.PI / 2); // fruit
  }
  function reliefCrescent(B, F, u, y, d, R) {
    put(B, F, 'relief', crescent(R, R * 0.82, R * 0.32, 0.05), u, y, d);
  }
  function rosetteBand(B, F, u0, u1, y, d, step) {
    put(B, F, 'frieze', box(u1 - u0, 0.42, 0.1), (u0 + u1) / 2, y, d);
    put(B, F, 'relief', box(u1 - u0, 0.04, 0.13), (u0 + u1) / 2, y + 0.19, d);
    put(B, F, 'relief', box(u1 - u0, 0.04, 0.13), (u0 + u1) / 2, y - 0.19, d);
    for (let u = u0 + step / 2; u < u1 - 0.1; u += step) {
      put(B, F, 'relief', cyl(0.13, 0.13, 0.05, 12), u, y, d + 0.06, 0, Math.PI / 2);
      put(B, F, 'frieze', cyl(0.05, 0.05, 0.06, 8), u, y, d + 0.08, 0, Math.PI / 2);
    }
  }
  function cuneiformBand(B, F, u0, u1, y, d, rows) {
    put(B, F, 'frieze', box(u1 - u0, 0.16 * rows + 0.08, 0.09), (u0 + u1) / 2, y, d);
    let seed = Math.floor((u0 + y) * 97) % 233;
    for (let r = 0; r < rows; r++) for (let u = u0 + 0.1; u < u1 - 0.1; u += 0.13) {
      seed = (seed * 9301 + 49297) % 233280;
      if (seed % 5 === 0) continue;
      const tall = (seed % 3 === 0);
      put(B, F, 'relief', box(tall ? 0.03 : 0.07, tall ? 0.09 : 0.03, 0.03), u, y + (r - (rows - 1) / 2) * 0.16, d + 0.05, 0, 0, (seed % 7 === 0) ? 0.6 : 0);
    }
  }
  function tileCourse(B, F, u0, u1, y0, y1, d) {
    // glazed brick wall face: large panel + raised brick courses
    put(B, F, 'wallTile', box(u1 - u0, y1 - y0, 0.06), (u0 + u1) / 2, (y0 + y1) / 2, d);
    for (let y = y0 + 0.33; y < y1 - 0.05; y += 0.33) put(B, F, 'wallStone', box(u1 - u0, 0.02, 0.075), (u0 + u1) / 2, y, d);
  }
  function lamassu(B, key, F, u, y, d, s, facing) {
    const f = facing;
    put(B, F, key, box(0.9 * s, 0.45 * s, 0.07), u, y + 0.55 * s, d);                         // body
    for (let i = 0; i < 4; i++) put(B, F, key, box(0.09 * s, 0.4 * s, 0.07), u + (-0.35 + i * 0.23) * s, y + 0.2 * s, d); // legs
    put(B, F, key, box(0.22 * s, 0.3 * s, 0.075), u + 0.5 * f * s, y + 0.9 * s, d);            // human head
    put(B, F, key, box(0.26 * s, 0.12 * s, 0.08), u + 0.5 * f * s, y + 1.1 * s, d);            // horned crown
    for (let i = 0; i < 4; i++) put(B, F, key, box(0.75 * s, 0.07 * s, 0.08), u - 0.05 * f * s, y + (0.82 + i * 0.12) * s, d, 0, 0, (0.55 - i * 0.06) * f); // wing feathers
    put(B, F, key, box(0.08 * s, 0.25 * s, 0.07), u - 0.5 * f * s, y + 0.5 * s, d, 0, 0, -0.4 * f); // tail
  }

  /* ---- free-standing elements --------------------------------------------- */
  function column(B, x, z, h, r) {
    B.add('base', box(r * 3.0, 0.35, r * 3.0), x, 0.175, z);
    B.add('base', box(r * 2.6, 0.2, r * 2.6), x, 0.45, z);
    B.add('base', cyl(r * 1.25, r * 1.3, 0.3, 24), x, 0.7, z);
    const shaftH = h - 2.25;
    B.add('column', cyl(r * 0.94, r, shaftH, 24), x, 0.85 + shaftH / 2, z);
    // carved bands (cuneiform / guilloche rings) like the reference
    [1.2, 1.55, h * 0.48, h * 0.53].forEach(y => B.add('capital', cyl(r * 1.04, r * 1.04, 0.12, 24), x, y, z));
    for (let y = 1.75; y < 3.2; y += 0.28) B.add('relief', cyl(r * 1.02, r * 1.02, 0.08, 24), x, y, z);
    // lotus-leaf base collar
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; B.add('relief', box(0.14, 0.55, 0.06), x + Math.cos(a) * r * 1.02, 1.12, z + Math.sin(a) * r * 1.02, -a + Math.PI / 2); }
    // palm / volute capital
    const cy = 0.85 + shaftH;
    B.add('capital', lathe([[r * 0.95, 0], [r * 1.1, 0.25], [r * 1.45, 0.6], [r * 1.7, 0.95], [r * 1.75, 1.05], [0, 1.05]], 24), x, cy, z);
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; B.add('relief', box(0.12, 0.8, 0.05), x + Math.cos(a) * r * 1.4, cy + 0.6, z + Math.sin(a) * r * 1.4, -a + Math.PI / 2, 0, 0); }
    B.add('capital', box(r * 3.6, 0.25, r * 3.6), x, cy + 1.18, z);
    B.add('capital', box(r * 3.9, 0.15, r * 3.9), x, cy + 1.375, z);
  }
  function brazier(B, x, z) {
    B.add('brazier', lathe([[0.42, 0], [0.38, 0.1], [0.18, 0.2], [0.14, 0.55], [0.2, 0.62], [0.55, 0.72], [0.62, 0.9], [0.6, 0.95], [0.5, 0.92], [0.0, 0.82]], 24), x, 0, z);
    B.add('relief', cyl(0.63, 0.63, 0.06, 24), x, 0.88, z);
    B.add('metal', cyl(0.48, 0.48, 0.05, 20), x, 0.86, z); // coals bed
  }
  function sconce(B, x, y, z, ry) {
    const dx = Math.sin(ry), dz = Math.cos(ry);
    B.add('metal', box(0.12, 0.5, 0.06), x, y - 0.1, z);
    B.add('metal', cyl(0.035, 0.035, 0.45, 8), x + dx * 0.2, y + 0.05, z + dz * 0.2, ry, 0.9);
    B.add('metal', lathe([[0.06, 0], [0.16, 0.18], [0.17, 0.22], [0, 0.18]], 14), x + dx * 0.38, y + 0.2, z + dz * 0.38);
    B.add('flame', new THREE.ConeGeometry(0.09, 0.32, 8), x + dx * 0.38, y + 0.5, z + dz * 0.38);
  }

  /* ---- build --------------------------------------------------------------- */
  api.build = function (r, parent, ctx) {
    const b = r.bbox, H = r.height, doors = (ctx.doors || []).filter(d => d.from === r.id || d.to === r.id);
    const root = new THREE.Group(); root.name = 'T1-sacred-entrance'; parent.add(root); api.root = root;
    const B = new Buckets();
    const W = b.x1 - b.x0, D = b.z1 - b.z0;
    const galleryY = Math.min(5.2, H - 2.6), galleryDepth = 1.9;

    /* floor: polished dark slabs, central gold-line axis, crescent mosaic */
    B.add('floor', box(W, 0.04, D), b.cx, 0.02, b.cz);
    for (let x = b.x0 + 1.5; x < b.x1; x += 1.5) B.add('floorJoint', box(0.03, 0.045, D), x, 0.022, b.cz);
    for (let z = b.z0 + 1.5; z < b.z1; z += 1.5) B.add('floorJoint', box(W, 0.045, 0.03), b.cx, 0.022, z);
    const mR = Math.min(2.6, D * 0.22);
    B.add('inlay', box(W - 0.4, 0.05, 0.05), b.cx, 0.03, b.cz - 0.08); B.add('inlay', box(W - 0.4, 0.05, 0.05), b.cx, 0.03, b.cz + 0.08);
    B.add('mosaic', box(mR * 2.9, 0.05, mR * 2.4), b.cx, 0.03, b.cz);                                            // rug field
    B.add('inlay', box(mR * 2.9 + 0.1, 0.055, 0.06), b.cx, 0.032, b.cz - mR * 1.2); B.add('inlay', box(mR * 2.9 + 0.1, 0.055, 0.06), b.cx, 0.032, b.cz + mR * 1.2);
    B.add('inlay', box(0.06, 0.055, mR * 2.4), b.cx - mR * 1.45, 0.032, b.cz); B.add('inlay', box(0.06, 0.055, mR * 2.4), b.cx + mR * 1.45, 0.032, b.cz);
    B.add('inlay', new THREE.RingGeometry(mR * 0.98, mR * 1.06, 64), b.cx, 0.058, b.cz, 0, -Math.PI / 2);
    B.add('inlay', new THREE.RingGeometry(mR * 0.86, mR * 0.9, 64), b.cx, 0.058, b.cz, 0, -Math.PI / 2);
    B.add('mosaic', new THREE.CircleGeometry(mR * 0.86, 64), b.cx, 0.056, b.cz, 0, -Math.PI / 2);
    B.add('mosaicMoon', crescent(mR * 0.62, mR * 0.5, mR * 0.22, 0.012), b.cx, 0.06, b.cz, -Math.PI / 2, -Math.PI / 2);
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; B.add('inlay', new THREE.CircleGeometry(0.06, 5), b.cx + Math.cos(a) * mR * 0.78, 0.059, b.cz + Math.sin(a) * mR * 0.78, 0, -Math.PI / 2); }
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; B.add('inlay', box(0.5, 0.055, 0.06), b.cx + Math.cos(a) * mR * 1.35, 0.033, b.cz + Math.sin(a) * mR * 1.1, -a); }

    /* walls: tiled relief walls on every face, leaving doorways open */
    ['N', 'S', 'W', 'E'].forEach(side => {
      const F = wallFrame(b, side), ops = openingsFor(b, side, doors);
      const sp = spans(F.len, ops, 0.05);
      const longWall = side === 'N' || side === 'S';
      sp.forEach(([u0, u1]) => {
        // stone dado
        put(B, F, 'wallStone', box(u1 - u0, 0.9, 0.16), (u0 + u1) / 2, 0.45, 0.08);
        put(B, F, 'frieze', box(u1 - u0, 0.08, 0.2), (u0 + u1) / 2, 0.92, 0.1);
        rosetteBand(B, F, u0, u1, 1.25, 0.06, 0.55);
        tileCourse(B, F, u0, u1, 1.48, galleryY - 0.75, 0.03);
        cuneiformBand(B, F, u0, u1, galleryY - 0.5, 0.06, 2);
        // upper register (above gallery): tiles + frieze + crenellation
        tileCourse(B, F, u0, u1, galleryY + 0.2, H - 0.9, 0.03);
        rosetteBand(B, F, u0, u1, H - 0.65, 0.06, 0.6);
        for (let u = u0 + 0.2; u < u1 - 0.2; u += 0.5) put(B, F, 'frieze', box(0.28, 0.3, 0.1), u, H - 0.28, 0.06); // stepped merlons
        // figural scene in each span wide enough
        const w = u1 - u0;
        if (w > 2.2) {
          const n = Math.max(1, Math.floor(w / 3.4));
          for (let i = 0; i < n; i++) {
            const c = u0 + w * (i + 0.5) / n, f = i % 2 ? -1 : 1;
            robedFigure(B, F, c - 0.55 * f, 1.62, 0.09, 1.05, f, true);
            if (w / n > 2.8) robedFigure(B, F, c + 0.95 * f, 1.62, 0.09, 1.0, -f, false);
            vessel(B, F, c + 0.25 * f, 1.62, 0.09, 0.95);
            reliefCrescent(B, F, c - 0.1 * f, galleryY - 1.3, 0.09, 0.32);
          }
        }
        if (longWall) {
          // clerestory windows above the gallery (glowing, paintable)
          for (let u = u0 + 1.4; u < u1 - 1.0; u += 3.2) {
            put(B, F, 'window', box(0.7, 1.5, 0.05), u, galleryY + 1.35, 0.05);
            put(B, F, 'window', new THREE.CircleGeometry(0.35, 16, 0, Math.PI), u, galleryY + 2.1, 0.08);
            put(B, F, 'wallStone', box(0.95, 0.12, 0.18), u, galleryY + 0.55, 0.09);
            put(B, F, 'wallStone', box(0.12, 1.6, 0.16), u - 0.45, galleryY + 1.35, 0.08);
            put(B, F, 'wallStone', box(0.12, 1.6, 0.16), u + 0.45, galleryY + 1.35, 0.08);
          }
        }
        // pilasters at span ends
        [u0 + 0.25, u1 - 0.25].forEach(u => { put(B, F, 'wallStone', box(0.5, H, 0.3), u, H / 2, 0.15); for (let y = 0.7; y < H; y += 0.6) put(B, F, 'wallStone', box(0.56, 0.05, 0.34), u, y, 0.17); });
      });
      // portal framing around each doorway
      ops.forEach(o => {
        const hh = Math.min(o.h, H - 1.4), half = o.w / 2;
        const grand = side === 'E';
        const jw = grand ? 0.55 : 0.4;
        [-1, 1].forEach(s => {
          put(B, F, 'portal', box(jw, hh, 0.45), o.u + s * (half + jw / 2), hh / 2, 0.22);
          // engaged colonnettes
          put(B, F, 'column', cyl(0.14, 0.15, hh - 0.4, 14), o.u + s * (half + jw + 0.12), 0.2 + (hh - 0.4) / 2, 0.22);
          put(B, F, 'capital', box(0.4, 0.2, 0.4), o.u + s * (half + jw + 0.12), hh - 0.1, 0.22);
          put(B, F, 'base', box(0.4, 0.25, 0.4), o.u + s * (half + jw + 0.12), 0.125, 0.22);
          for (let y = 0.6; y < hh - 0.3; y += 0.45) put(B, F, 'relief', box(jw * 0.6, 0.18, 0.05), o.u + s * (half + jw / 2), y, 0.46);
        });
        put(B, F, 'portal', box(o.w + jw * 2 + 0.6, 0.35, 0.5), o.u, hh + 0.17, 0.25);
        if (grand) {
          // arched tympanum above the doorway: crescent + facing lamassu
          const top = hh + 0.35, archR = half + jw, avail = H - 1.0 - top;
          const ar = Math.min(archR, avail);
          if (ar > 0.6) {
            put(B, F, 'doorFrame', new THREE.RingGeometry(ar - 0.35, ar, 32, 1, 0, Math.PI), o.u, top, 0.47);
            put(B, F, 'relief', new THREE.RingGeometry(ar - 0.45, ar - 0.38, 32, 1, 0, Math.PI), o.u, top, 0.48);
            put(B, F, 'wallTile', new THREE.CircleGeometry(ar - 0.35, 32, 0, Math.PI), o.u, top, 0.44);
            put(B, F, 'doorRelief', crescent(ar * 0.36, ar * 0.29, ar * 0.13, 0.05), o.u, top + ar * 0.42, 0.45);
            put(B, F, 'doorRelief', cyl(0.18, 0.18, 0.06, 20), o.u, top + ar - 0.17, 0.5, 0, Math.PI / 2);
            lamassu(B, 'doorRelief', F, o.u - ar * 0.55, top + 0.05, 0.46, ar * 0.33, 1);
            lamassu(B, 'doorRelief', F, o.u + ar * 0.55, top + 0.05, 0.46, ar * 0.33, -1);
          }
          // outer rectangular frame with relief panels (griffins) to the ceiling band
          const fw = o.w + jw * 2 + 1.6;
          put(B, F, 'portal', box(0.3, H - 0.9, 0.35), o.u - fw / 2, (H - 0.9) / 2, 0.18);
          put(B, F, 'portal', box(0.3, H - 0.9, 0.35), o.u + fw / 2, (H - 0.9) / 2, 0.18);
          put(B, F, 'portal', box(fw + 0.3, 0.3, 0.35), o.u, H - 1.05, 0.18);
          cuneiformBand(B, F, o.u - fw / 2 + 0.2, o.u + fw / 2 - 0.2, H - 1.4, 0.38, 1);
          // great bronze door leaves swung open against the wall (passage stays clear)
          const leafW = half, leafH = hh - 0.1;
          [-1, 1].forEach(s => {
            const hingeU = o.u + s * half;
                        // open 90° into the room, flat against the jamb face
            const ru = F.ry + s * Math.PI / 2;
            const cu = F.at(hingeU, 0, 0.55 + leafW / 2);
            B.add('door', box(leafW, leafH, 0.12), cu[0], leafH / 2 + 0.05, cu[2], ru);
            // panels and lamassu reliefs on the leaf (both faces)
            [-1, 1].forEach(face => {
              const off = face * 0.07;
              const nx = Math.sin(ru) * off, nz = Math.cos(ru) * off;
              for (let row = 0; row < 3; row++) {
                const y = 0.9 + row * (leafH - 1.2) / 2;
                B.add('doorRelief', box(leafW * 0.8, 0.06, 0.02), cu[0] + nx, y - 0.65, cu[2] + nz, ru);
              }
              B.add('doorRelief', cyl(0.12, 0.12, 0.04, 16), cu[0] + nx * 1.3, leafH * 0.45, cu[2] + nz * 1.3, ru, Math.PI / 2);
            });
          });
        }
      });
    });

    /* colonnade along the long walls + upper gallery on top of it */
    const nCols = 3, colR = 0.42, zIn = galleryDepth + 0.1;
    const xs = []; for (let i = 0; i < nCols; i++) xs.push(b.x0 + 2.6 + (W - 5.2) * i / (nCols - 1));
    const colH = galleryY;
    [b.z0 + zIn, b.z1 - zIn].forEach((z, side) => {
      // avoid a doorway on the long wall: shift columns away from door centre
      xs.forEach(x => {
        column(B, x, z, colH, colR);
        ctx.colliders.push({ minx: x - colR * 1.1, maxx: x + colR * 1.1, miny: 0, maxy: H, minz: z - colR * 1.1, maxz: z + colR * 1.1, _wing: true });
        // torch sconce on the inner face of each column
        const dir = side === 0 ? 0 : Math.PI;
        sconce(B, x, 2.4, z + (side === 0 ? colR + 0.05 : -colR - 0.05), dir);
        ctx.fires.push({ x: x, y: 2.95, z: z + (side === 0 ? colR + 0.43 : -colR - 0.43), intensity: 0.8, seed: ctx.fires.length * 0.731 + 0.4, t1: true });
      });
      // gallery slab, beams, parapet with balusters
      const wz = side === 0 ? b.z0 : b.z1, sgn = side === 0 ? 1 : -1;
      const gz = wz + sgn * (zIn + 0.5) / 2;
      B.add('gallery', box(W - 0.1, 0.4, zIn + 0.5), b.cx, galleryY + 0.2, gz);
      B.add('beam', box(W - 0.1, 0.3, 0.6), b.cx, galleryY - 0.15, z);
      cuneiformBandWorld(B, b.x0 + 0.1, b.x1 - 0.1, galleryY + 0.2, wz + sgn * (zIn + 0.53), sgn);
      const pz = wz + sgn * (zIn + 0.45);
      B.add('gallery', box(W - 0.1, 0.12, 0.3), b.cx, galleryY + 1.05, pz);
      B.add('gallery', box(W - 0.1, 0.18, 0.28), b.cx, galleryY + 0.48, pz);
      for (let x = b.x0 + 0.4; x < b.x1 - 0.2; x += 0.45) B.add('gallery', cyl(0.06, 0.08, 0.5, 8), x, galleryY + 0.75, pz);
      for (let x = b.x0 + 0.6; x < b.x1; x += 1.6) B.add('beam', box(0.25, 0.25, zIn), x, galleryY - 0.12, wz + sgn * zIn / 2);
    });

    /* braziers with smoke-spot fires, beside the central columns */
    [[b.cx - 1.6, b.z0 + zIn + 1.4], [b.cx - 1.6, b.z1 - zIn - 1.4]].forEach(p => {
      brazier(B, p[0], p[1]);
      ctx.colliders.push({ minx: p[0] - 0.6, maxx: p[0] + 0.6, miny: 0, maxy: 1, minz: p[1] - 0.6, maxz: p[1] + 0.6, _wing: true });
      ctx.fires.push({ x: p[0], y: 1.1, z: p[1], intensity: 0.65, seed: ctx.fires.length * 0.731 + 0.4, t1: true });
    });

    /* coffered ceiling: deep beams + recessed panels with rosettes */
    for (let x = b.x0 + 2; x < b.x1 - 0.5; x += 2) B.add('beam', box(0.35, 0.45, D - 0.1), x, H - 0.225, b.cz);
    for (let z = b.z0 + 2; z < b.z1 - 0.5; z += 2) B.add('beam', box(W - 0.1, 0.4, 0.3), b.cx, H - 0.2, z);
    B.add('ceiling', box(W - 0.05, 0.05, D - 0.05), b.cx, H - 0.03, b.cz);
    for (let x = b.x0 + 1; x < b.x1; x += 2) for (let z = b.z0 + 1; z < b.z1; z += 2) B.add('relief', cyl(0.22, 0.22, 0.06, 12), x, H - 0.08, z);

    B.flush(root);
    paintRoyalT1();
    loadAtlasTextures();
    try { console.info('[T1] sacred entrance built:', root.children.length, 'material groups'); } catch (_) {}
    return root;
  };
  function cuneiformBandWorld(B, x0, x1, y, z, sgn) {
    // front fascia of the gallery slab facing the hall
    B.add('frieze', box(x1 - x0, 0.32, 0.06), (x0 + x1) / 2, y, z);
    for (let x = x0 + 0.25; x < x1 - 0.1; x += 0.5) B.add('relief', cyl(0.08, 0.08, 0.04, 10), x, y, z + sgn * 0.04, 0, Math.PI / 2);
  }

  window.SinT1Entrance = api;
})();
