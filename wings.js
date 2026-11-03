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
    current: null, cutaway: false, fullbright: false, debug: false, report: null,
    ui: null, label: null, minimap: null, minimapAt: 0, fires: [], seals: [], ambient: null
  };

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

    const K1 = addRoom(rectRegion('K1', 'Kings', ROOM_NAMES.K1, -back - 18, zK - 7, 18, 14, 8.5)); K1.ceiling = false;
    const KC12 = addCon(rectRegion('KC12', 'Kings', 'Kings corridor', K1.bbox.x0 - 8, zK - 3, 8, 6, 6, 'corridor'));
    const K2 = addRoom(rectRegion('K2', 'Kings', ROOM_NAMES.K2, KC12.bbox.x0 - 31, zK, 30, 24, 9));
    door('K1-KC12', 'K1', 'KC12', K1.bbox.x0 - 0.5, zK, 'x');
    door('KC12-K2', 'KC12', 'K2', K2.bbox.x1 + 0.5, zK, 'x');

    const KC1x = K2.bbox.cx;
    const rearZ = hall.length + 5;
    const REAR = addCon(rectRegion('REAR', 'Shared', 'Rear Gallery', -28, rearZ, back + 44, 6, 7, 'gallery'));
    const K5 = addRoom(rectRegion('K5', 'Kings', ROOM_NAMES.K5, -28, rearZ + 12, 22, 16, 6));
    const KC2 = addCon(rectRegion('KC2', 'Kings', 'Kings L corridor', KC1x - 3, K5.bbox.z1 + 1, K5.bbox.cx - KC1x + 3, 6, 6, 'corridor'));
    const KC1 = addCon(rectRegion('KC1', 'Kings', 'Kings L corridor', KC1x - 3, K2.bbox.z1 + 1, 6, KC2.bbox.z1 - K2.bbox.z1 - 1, 6, 'corridor'));
    door('K2-KC1', 'K2', 'KC1', KC1x, K2.bbox.z1 + 0.5, 'z');
    links.push(['KC1', 'KC2', 'KC1-KC2']);
    door('KC2-K5', 'KC2', 'K5', K5.bbox.cx, K5.bbox.z1 + 0.5, 'z');

    const K3 = addRoom(rectRegion('K3', 'Kings', ROOM_NAMES.K3, KC1.bbox.x0 - 17, KC1.bbox.z0 + 5, 16, 12, 5.5));
    const KC3 = addCon(rectRegion('KC3', 'Kings', 'Map corridor', K3.bbox.x1, K3.bbox.cz - 3, KC1.bbox.x0 - K3.bbox.x1, 6, 6, 'corridor'));
    door('K3-KC3', 'K3', 'KC3', K3.bbox.x1 + 0.5, K3.bbox.cz, 'x'); links.push(['KC3', 'KC1', 'KC3-KC1']);
    const K4 = addRoom(rectRegion('K4', 'Kings', ROOM_NAMES.K4, KC1x + 17, KC2.bbox.z1 + 3, 14, 12, 5));
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
    const LC2 = addCon(rectRegion('LC2', 'Library', 'Archive corridor', L2.bbox.cx - 3, L2.bbox.z1, 6, L1.bbox.z0 - L2.bbox.z1, 6, 'corridor'));
    door('L1-LC2', 'L1', 'LC2', L2.bbox.cx, L1.bbox.z0 - 0.5, 'z'); door('LC2-L2', 'LC2', 'L2', L2.bbox.cx, L2.bbox.z1 + 0.5, 'z');
    const L3 = addRoom(rectRegion('L3', 'Library', ROOM_NAMES.L3, back + 30, L1.bbox.z0 - 21, 20, 14, 5.5));
    const LC3 = addCon(rectRegion('LC3', 'Library', 'Scribes corridor', L3.bbox.cx - 3, L3.bbox.z1, 6, L1.bbox.z0 - L3.bbox.z1, 6, 'corridor'));
    door('L1-LC3', 'L1', 'LC3', L3.bbox.cx, L1.bbox.z0 - 0.5, 'z'); door('LC3-L3', 'LC3', 'L3', L3.bbox.cx, L3.bbox.z1 + 0.5, 'z');
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
      r.ceiling = false; thresholds.push(r);
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
    (parent || state.root).add(m); return m;
  }
  function makeColliders(solids, caps) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    solids.forEach(s => { const b = bbox(s.outer); minX = Math.min(minX, b.x0); minZ = Math.min(minZ, b.z0); maxX = Math.max(maxX, b.x1); maxZ = Math.max(maxZ, b.z1); });
    const nx = Math.ceil((maxX - minX) / GRID), nz = Math.ceil((maxZ - minZ) / GRID);
    const occupied = new Uint8Array(nx * nz);
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const x = minX + (ix + 0.5) * GRID, z = minZ + (iz + 0.5) * GRID;
      if (pointInSolids(x, z, solids)) occupied[iz * nx + ix] = 1;
    }
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
  function capsuleBlocked(x, z, radius) {
    const r = radius == null ? 0.32 : radius;
    for (const b of nearbyBoxes(x, z)) {
      if (b.miny > 1.65 || b.maxy < 0.08) continue;
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
    if (T4 && tg) {
      const geos = [];
      for (let i = 0; i < 5; i++) geos.push(boxAt(1.24, (i + 1) * 0.3, 10, T4.bbox.x1 - 13.8 + i * 1.2, (i + 1) * 0.15, T4.bbox.cz));
      geos.push(boxAt(8, 1.5, 12, T4.bbox.x1 - 4, 0.75, T4.bbox.cz));
      const support = mesh(mergeGeometries(geos), stone, 'T4-five-steps-platform', tg);
      state.floorSupport.push(support);
      futureZone(T4, tg, 'ALTAR', T4.bbox.x1 - 4, T4.bbox.cz, 4, 3);
    }
    const K5 = state.rooms.find(r => r.id === 'K5'), kg = state.regionGroups.get('K5');
    if (K5 && kg) {
      const bx = K5.bbox.cx, bz = K5.bbox.z1 - 1.5;
      const balcony = mesh(boxAt(14, 1.2, 3, bx - 2, 0.6, bz), stone, 'K5-balcony', kg);
      state.floorSupport.push(balcony);
      const ramp = [];
      for (let i = 0; i < 6; i++) ramp.push(boxAt(14, (i + 1) * 0.2, 0.5, bx - 2, (i + 1) * 0.1, K5.bbox.z1 - 5.75 + i * 0.5));
      const rampMesh = mesh(mergeGeometries(ramp), stone, 'K5-balcony-ramp', kg); state.floorSupport.push(rampMesh);
      const rails = [boxAt(14, 0.16, 0.18, bx - 2, 2.05, bz - 1.42)];
      for (let x = bx - 8.5; x <= bx + 4.5; x += 1.3) rails.push(boxAt(0.12, 0.9, 0.12, x, 1.65, bz - 1.42));
      mesh(mergeGeometries(rails), stone, 'K5-balustrade', kg);
      mesh(boxAt(3, 0.08, 5, K5.bbox.x1 - 2, 0.06, K5.bbox.z1 - 4), dark, 'K5-closed-dark-shaft', kg);
      state.colliders.push({ minx: bx - 9, maxx: bx + 5, miny: 1.1, maxy: 2.2, minz: bz - 1.55, maxz: bz - 1.28, _wing: true });
    }
    const sealed = state.hall.passages.find(p => p.id === 'passage-L0');
    if (sealed) {
      const sg = new THREE.Group(); sg.name = 'L1-sealed-arch'; state.root.add(sg);
      const x = sealed.position[0] - 0.16, z = sealed.position[2], w = sealed.width, h = sealed.height;
      mesh(boxAt(0.34, h, w, x, h * 0.5, z), stone, 'L1-stone-seal', sg);
      const disc = new THREE.CylinderGeometry(0.5, 0.5, 0.12, 24); disc.rotateZ(Math.PI / 2);
      const inst = new THREE.InstancedMesh(disc, state.sealMat, 8); inst.name = 'L1-eight-discs';
      const dummy = new THREE.Object3D();
      dummy.position.set(x + 0.22, h * 0.53, z); dummy.scale.set(1, Math.min(2.1, w * 0.3), Math.min(2.1, w * 0.3)); dummy.updateMatrix(); inst.setMatrixAt(0, dummy.matrix);
      for (let i = 0; i < 7; i++) {
        const a = i * Math.PI * 2 / 7, rad = Math.min(w * 0.34, h * 0.31);
        dummy.position.set(x + 0.23, h * 0.53 + Math.sin(a) * rad, z + Math.cos(a) * rad);
        dummy.scale.set(1, 0.55, 0.55); dummy.updateMatrix(); inst.setMatrixAt(i + 1, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true; sg.add(inst);
    }
  }
  function addFutureZones(r, parent) {
    const b = r.bbox;
    if (r.id === 'K2') futureZone(r, parent, 'COUNCIL TABLE', b.cx, b.cz, 12, 4);
    if (r.id === 'K3') futureZone(r, parent, 'MAP TABLE', b.cx, b.cz, 7, 4);
    if (r.id === 'K4') { futureZone(r, parent, 'ROYAL CHESTS', b.cx - 3, b.cz, 3, 7); futureZone(r, parent, 'TOOLS', b.cx + 4, b.cz, 2, 6); }
    if (r.id === 'T2') futureZone(r, parent, 'PURIFICATION BASIN', b.cx, b.cz, 8, 6);
    if (r.id === 'T5') futureZone(r, parent, 'OFFERING TOOLS', b.cx, b.cz, 6, 3);
    if (r.id === 'L1') { futureZone(r, parent, 'WALL SHELVES', b.cx, b.z0 + 1.2, 30, 1.2); futureZone(r, parent, 'WALL SHELVES', b.cx, b.z1 - 1.2, 30, 1.2); }
    if (r.id === 'L3') { futureZone(r, parent, 'WRITING TABLES', b.cx - 4, b.cz, 4, 8); futureZone(r, parent, 'WRITING TABLES', b.cx + 4, b.cz, 4, 8); }
  }
  function addTorches(r) {
    if (r.kind === 'threshold') return;
    const b = r.bbox, spacing = 10;
    function wall(a, b0, fixed, alongX) {
      const len = b0 - a, n = Math.max(1, Math.round(len / spacing));
      for (let i = 0; i < n; i++) {
        const v = a + len * (i + 0.5) / n;
        state.fires.push({ x: alongX ? v : fixed, y: 2.35, z: alongX ? fixed : v, intensity: 0.75, seed: state.fires.length * 0.731 + 0.4 });
      }
    }
    if (r.id === 'L4') {
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; state.fires.push({ x: b.cx + Math.cos(a) * 10.8, y: 2.5, z: b.cz + Math.sin(a) * 10.8, intensity: 0.8, seed: 90 + i }); }
      return;
    }
    wall(b.x0 + 1, b.x1 - 1, b.z0 + 0.45, true); wall(b.x0 + 1, b.x1 - 1, b.z1 - 0.45, true);
    if (b.z1 - b.z0 > 8) { wall(b.z0 + 1, b.z1 - 1, b.x0 + 0.45, false); wall(b.z0 + 1, b.z1 - 1, b.x1 - 0.45, false); }
  }
  function loadK1Model(r, parent) {
    if (!window.THREE || !window.THREE.GLTFLoader) {
      console.warn('GLTFLoader not available for K1 model');
      return;
    }
    const loader = new THREE.GLTFLoader();
    const url = 'assets/K1_RoyalReceptionHall.glb';
    loader.load(url, function (gltf) {
      const model = gltf.scene;
      model.name = 'K1-RoyalReceptionHall';
      // Compute bounding box
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      // Room size from region
      const roomW = r.bbox.x1 - r.bbox.x0;
      const roomD = r.bbox.z1 - r.bbox.z0;
      const roomH = r.height;
      // Uniform scale to fit the footprint without distortion (use min scale)
      const scaleX = roomW / Math.max(size.x, 0.001);
      const scaleZ = roomD / Math.max(size.z, 0.001);
      const scale = Math.min(scaleX, scaleZ); // preserve proportions
      model.scale.setScalar(scale);
      // Position: center the model in the room, y=0 (floor)
      const targetX = r.bbox.cx;
      const targetZ = r.bbox.cz;
      model.position.set(targetX - center.x * scale, -box.min.y * scale, targetZ - center.z * scale);
      parent.add(model);
      console.info('K1 model loaded and placed at scale', scale.toFixed(3), 'size after', size.multiplyScalar(scale));
      // Add approximate wall colliders for the room (perimeter, inset for doors)
      addK1Colliders(r);
    }, undefined, function (err) {
      console.error('Failed to load K1 model', err);
    });
  }
  function addK1Colliders(r) {
    // Simple perimeter colliders so player doesn't fall through or walk through walls
    // Doors are on the sides; leave openings roughly matching door positions
    const wallT = 0.8;
    const h = r.height;
    const x0 = r.bbox.x0, x1 = r.bbox.x1, z0 = r.bbox.z0, z1 = r.bbox.z1;
    const cx = r.bbox.cx, cz = r.bbox.cz;
    // Four walls, with gaps for doors (approximate)
    // South wall (lower z) - may have door to corridor
    state.colliders.push({ minx: x0, miny: 0, minz: z0 - wallT, maxx: x1, maxy: h, maxz: z0 });
    // North wall
    state.colliders.push({ minx: x0, miny: 0, minz: z1, maxx: x1, maxy: h, maxz: z1 + wallT });
    // West wall (lower x) - door to palace arch roughly centered
    state.colliders.push({ minx: x0 - wallT, miny: 0, minz: z0, maxx: x0, maxy: h, maxz: cz - 3 });
    state.colliders.push({ minx: x0 - wallT, miny: 0, minz: cz + 3, maxx: x0, maxy: h, maxz: z1 });
    // East wall
    state.colliders.push({ minx: x1, miny: 0, minz: z0, maxx: x1 + wallT, maxy: h, maxz: z1 });
    // Rebuild spatial after adding
    if (typeof rebuildSpatial === 'function') rebuildSpatial();
  }
  function buildVisuals(layout) {
    state.floorSupport = [];
    state.wallMat = gridMaterial(0x8d7a63, 0.9, 0x1c1510);
    state.darkMat = new THREE.MeshStandardMaterial({ color: 0x070706, roughness: 1, emissive: 0x010101, emissiveIntensity: 0.1 });
    state.sealMat = new THREE.MeshStandardMaterial({ color: 0xa58a61, roughness: 0.72, metalness: 0.18 });
    state.materials.push(state.darkMat, state.sealMat);
    const capGeos = state.caps.map(c => extrudeSolids(c.solids, c.door.height, MAX_H));
    // The palace's own decorated wall modules already fill the band |x| <= hall half-width + wall thickness.
    // Drawing the wing threshold walls inside that band makes their flat plaster faces poke through the
    // relief around the open arches. Colliders still use the full baseWall, so walking limits are unchanged.
    const hwv = state.hall.width * 0.5, wtv = state.hall.wallThickness || 0;
    const palaceBand = solid(polyRect(-hwv - wtv - 0.02, -0.5, (hwv + wtv + 0.02) * 2, state.hall.length + 1));
    const visualWall = difference(state.baseWall, palaceBand);
    state.wallGeometry = mergeGeometries([extrudeSolids(visualWall, 0, MAX_H)].concat(capGeos));
    state.wallMesh = mesh(state.wallGeometry, state.wallMat, 'wings-unified-watertight-walls');
    const floorMats = {
      Kings: gridMaterial(0x80705a, 0.94, 0x1d1710), Temple: gridMaterial(0x65756e, 0.94, 0x121c18),
      Library: gridMaterial(0x756b7e, 0.94, 0x19151d), Shared: gridMaterial(0x746653, 0.94, 0x19150f)
    };
    state.floorMeshes = []; state.floorWingSolids = [];
    let claimedFloor = [];
    ['Kings', 'Temple', 'Library', 'Shared'].forEach((wing, wi) => {
      let wingFloor = [];
      state.regions.filter(r => r.wing === wing && r.id !== 'K1').forEach(r => { wingFloor = union(wingFloor, solid(r.poly)); });
      layout.doors.filter(d => d.kind !== 'arch').forEach(d => {
        const target = state.regions.find(r => r.id === d.to), source = state.regions.find(r => r.id === d.from);
        if ((target && target.wing === wing) || (source && source.wing === wing)) wingFloor = union(wingFloor, solid(d.floorPoly));
      });
      wingFloor = difference(wingFloor, claimedFloor);
      claimedFloor = union(claimedFloor, wingFloor);
      state.floorWingSolids.push({ wing, solids: wingFloor });
      const g = extrudeSolids(offset(wingFloor, 0.3), -0.25, wi * 0.002);
      state.floorMeshes.push(mesh(g, floorMats[wing], 'wings-floor-' + wing));
    });
    state.ceilings = [];
    state.regions.forEach(r => {
      const g = new THREE.Group(); g.name = 'wing-region-' + r.id; state.root.add(g); state.regionGroups.set(r.id, g);
      if (r.ceiling !== false) {
        let poly = solid(r.poly);
        if (r.id === 'L4') poly = difference(poly, solid(polyCircle(r.bbox.cx, r.bbox.cz, 2.5, 32)));
        const ceiling = mesh(extrudeSolids(poly, r.height, r.height + 0.25), state.wallMat, r.id + '-ceiling', g);
        ceiling.userData.ceiling = true; state.ceilings.push(ceiling);
        if (r.id === 'L4') {
          const ring = difference(solid(polyCircle(r.bbox.cx, r.bbox.cz, 3.0, 32)), solid(polyCircle(r.bbox.cx, r.bbox.cz, 2.5, 32)));
          mesh(extrudeSolids(ring, r.height, r.height + 3), state.wallMat, 'L4-oculus-shaft', g);
          mesh(extrudeSolids(solid(polyCircle(r.bbox.cx, r.bbox.cz, 3.0, 32)), r.height + 3, r.height + 3.25), state.darkMat, 'L4-oculus-dark-cap', g);
        }
      }
      if (r.id === 'K1') { /* procedural geometry removed for GLB model */ loadK1Model(r, g); }
      if (r.id === 'K2') addColumns(r, g, columnPairs(r, 4, 4.2, 3.2), 0.68);
      if (r.id === 'T1') addColumns(r, g, columnPairs(r, 3, 2.3, 2.2), 0.48);
      if (r.id === 'T3') addColumns(r, g, columnPairs(r, 6, 5.0, 3.0), 0.88);
      if (r.id === 'L1') addColumns(r, g, columnPairs(r, 4, 4.0, 3.4), 0.60);
      if (r.id !== 'K1') { addFutureZones(r, g); addTorches(r); }
    });
    addSpecials();
    const bracket = new THREE.CylinderGeometry(0.09, 0.13, 0.8, 8); bracket.translate(0, -0.35, 0);
    const torches = new THREE.InstancedMesh(bracket, state.sealMat, state.fires.length); torches.name = 'wings-wall-torches';
    const dummy = new THREE.Object3D();
    state.fires.forEach((f, i) => { dummy.position.set(f.x, f.y, f.z); dummy.updateMatrix(); torches.setMatrixAt(i, dummy.matrix); });
    torches.instanceMatrix.needsUpdate = true; state.root.add(torches);
    state.root.updateMatrixWorld(true);
  }
  function rebuildSpatial() {
    state.spatial.clear();
    state.colliders.forEach((b, i) => {
      for (let x = Math.floor(b.minx); x <= Math.floor(b.maxx); x++) for (let z = Math.floor(b.minz); z <= Math.floor(b.maxz); z++) {
        const k = x + ',' + z; let a = state.spatial.get(k); if (!a) state.spatial.set(k, a = []); a.push(i);
      }
    });
  }

  function dispose() {
    if (state.root && state.root.parent) state.root.parent.remove(state.root);
    if (state.root) state.root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); }
    });
    if (state.ui) { state.ui.remove(); state.ui = null; }
    if (state.label) { state.label.remove(); state.label = null; }
    state.built = false; state.root = null; state.regionGroups.clear(); state.colliders = []; state.fires = [];
  }
  function build(ctx, hall) {
    assertDeps(); dispose();
    state.ctx = ctx; state.hall = hall; state.debug = /(?:[?&#])debug=1(?:&|#|$)/.test(location.href);
    state.root = new THREE.Group(); state.root.name = 'PalaceWings';
    state.root.position.set(ctx.portal.x, hall.floorY || 0, ctx.portal.frontZ); ctx.scene.add(state.root);
    const layout = solveLayout(hall);
    state.rooms = layout.rooms; state.connectors = layout.connectors; state.doors = layout.doors;
    state.regions = state.rooms.concat(state.connectors); state.links = layout.links; state.sealed = layout.sealed; state.back = layout.back;
    prepareArchitecture(layout);
    // Remove procedural walls inside K1 so the GLB model is the only interior
    const k1 = state.rooms.find(r => r.id === 'K1');
    if (k1) {
      state.baseWall = difference(state.baseWall, solid(k1.poly));
      state.wallSolid = difference(state.wallSolid, solid(k1.poly));
    }
    makeColliders(state.baseWall, state.caps);
    buildVisuals(layout); rebuildSpatial();
    state.built = true;
    if (state.debug) createDebugUI();
    updateCulling(true);
    return {
      root: state.root,
      fires: state.fires,
      colliders: state.colliders,
      rooms: state.rooms.length,
      drawBudget: 40,
      triangleBudget: 150000
    };
  }
  function contains(x, z) { return state.built && pointInSolids(x, z, state.floorExtended); }
  function regionAt(x, z) {
    for (const r of state.rooms) if (pointInPoly(x, z, r.poly)) return r;
    for (const r of state.connectors) if (r.kind !== 'threshold' && pointInPoly(x, z, r.poly)) return r;
    for (const r of state.connectors) if (pointInPoly(x, z, r.poly)) return r;
    return null;
  }
  function adjacency() {
    const map = new Map();
    state.regions.forEach(r => map.set(r.id, [])); map.set('Palace', []);
    state.links.forEach(([a, b]) => { if (!map.has(a)) map.set(a, []); if (!map.has(b)) map.set(b, []); map.get(a).push(b); map.get(b).push(a); });
    return map;
  }
  function distancesFrom(id) {
    const adj = adjacency(), dist = new Map([[id, 0]]), q = [id];
    while (q.length) { const a = q.shift(); for (const b of adj.get(a) || []) if (!dist.has(b)) { dist.set(b, dist.get(a) + 1); q.push(b); } }
    return dist;
  }
  function updateCulling(force) {
    if (!state.built || !state.ctx || !state.ctx.hero) return;
    const p = state.ctx.hero.position, x = p.x - state.root.position.x, z = p.z - state.root.position.z;
    const r = regionAt(x, z), id = r ? r.id : 'Palace';
    if (force || state.current !== id) {
      state.current = id;
      const dist = distancesFrom(id);
      state.regions.forEach(rr => {
        const g = state.regionGroups.get(rr.id); if (!g) return;
        const d = dist.has(rr.id) ? dist.get(rr.id) : 99;
        const near = Math.hypot(rr.bbox.cx - x, rr.bbox.cz - z) <= 40;
        g.visible = d <= 2 || near;
      });
      if (state.label) state.label.textContent = r ? (r.kind === 'room' ? WING_NAMES[r.wing] + ': ' + r.id + ' ' + r.name : (r.id === 'REAR' ? 'Rear Gallery' : r.id.indexOf('MP') === 0 ? 'Moon Passage' : 'Corridor')) : 'Palace Hall';
    }
    const inHall = Math.abs(x) <= state.hall.width * 0.5 + 0.3 && z >= -0.3 && z <= state.hall.length + 0.4;
    state.root.visible = inHall || contains(x, z);
  }
  function tick() {
    if (!state.built) return;
    updateCulling(false);
    if (state.debug && state.ui && performance.now() - state.minimapAt > 120) { state.minimapAt = performance.now(); drawMinimap(); }
  }
  function floorAt(x, z) {
    if (!contains(x, z)) return null;
    const T4 = state.rooms.find(r => r.id === 'T4');
    if (T4 && pointInPoly(x, z, T4.poly)) {
      const start = T4.bbox.x1 - 14.4, end = T4.bbox.x1 - 8.4;
      if (x >= T4.bbox.x1 - 8.4) return 1.5;
      if (x > start) return Math.min(1.5, (x - start) / (end - start) * 1.5);
    }
    const K5 = state.rooms.find(r => r.id === 'K5');
    if (K5 && pointInPoly(x, z, K5.poly) && x < K5.bbox.x1 - 5) {
      const rampStart = K5.bbox.z1 - 6, balcony = K5.bbox.z1 - 3;
      if (z >= balcony) return 1.2;
      if (z > rampStart) return (z - rampStart) / 3 * 1.2;
    }
    return 0;
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
    want.y = Math.max(state.root.position.y + 1.2, Math.min(state.root.position.y + 6.5, want.y));
  }
  function localToWorld(x, z, y) {
    return new THREE.Vector3(state.root.position.x + x, state.root.position.y + (y || 0), state.root.position.z + z);
  }
  function teleport(id) {
    if (!state.built || !state.ctx) return false;
    const r = state.regions.find(rr => rr.id === id);
    const d = state.doors.find(dd => dd.id === id);
    let x, z;
    if (r) { x = r.bbox.cx; z = r.bbox.cz; }
    else if (d) { x = d.x; z = d.z; }
    else if (id === 'Palace') { x = 0; z = Math.min(8, state.hall.length * 0.2); }
    else return false;
    const y = floorAt(x, z) || 0, p = localToWorld(x, z, y);
    state.ctx.hero.position.copy(p); state.ctx.setFacing(0);
    state.ctx.camera.position.set(p.x, p.y + 1.8, p.z - 4.2); state.ctx.camera.lookAt(p.x, p.y + 1.3, p.z + 4);
    if (window.PalaceInterior) PalaceInterior.constrainCamera(state.ctx.camera, state.ctx.hero);
    resolveCamera(state.ctx.camera); updateCulling(true); drawMinimap();
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
      if (b.dataset.act === 'cutaway') { state.cutaway = !state.cutaway; state.ceilings.forEach(c => { c.visible = !state.cutaway; }); }
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
    state.cutaway = true; state.ceilings.forEach(c => { c.visible = false; });
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
  function metrics() {
    let meshes = 0, triangles = 0, visibleMeshes = 0, visibleTriangles = 0;
    if (!state.root) return { meshes: 0, triangles: 0, visibleMeshes: 0, visibleTriangles: 0 };
    state.root.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      const count = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
      const instances = o.isInstancedMesh ? o.count : 1; meshes++; triangles += count * instances;
      let visible = o.visible, p = o.parent; while (visible && p) { visible = p.visible; p = p.parent; }
      if (visible) { visibleMeshes++; visibleTriangles += count * instances; }
    });
    return { meshes, triangles, visibleMeshes, visibleTriangles, colliders: state.colliders.length, rooms: state.rooms.length, regions: state.regions.length };
  }

  window.PalaceWings = {
    build, dispose, tick, contains, regionAt, floorAt, capsuleBlocked, resolveCamera, clampFollowTarget,
    teleport, overview, runTests, formatReport, cameraTour, metrics,
    shortestPath,
    get report() { return state.report; },
    get state() { return state; }
  };
})();
