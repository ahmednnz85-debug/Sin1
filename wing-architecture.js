/* Shared palace-wing architecture: Clipper CSG, room layout, and collider grid.
   Used at bake time (tools/bake-palace-colliders.js) and at runtime (wings.js)
   so the baked JSON is bit-identical to a live compute. No THREE dependency. */
(function (root) {
  'use strict';
  const C = (typeof window !== 'undefined' && window.ClipperLib)
    || (typeof require !== 'undefined' ? require(require('path').join(__dirname, 'vendor', 'clipper.js')) : null);
  if (!C) throw new Error('PalaceWingArchitecture requires ClipperLib');

  const SCALE = 1000;
  const WALL = 1.0;
  const GRID = 0.5;
  const MAX_H = 12.25;
  const BAKE_VERSION = 1;
  const ROOM_NAMES = {
    K1: 'reception hall', K2: 'council hall', K3: 'map room', K4: 'royal treasury', K5: 'king private wing',
    T1: 'sacred entrance', T2: 'purification hall', T3: 'sacred columns', T4: 'holy sanctuary', T5: 'offering room',
    L1: 'great library', L2: 'archive', L3: 'scribes room', L4: 'observatory'
  };
  const HALL_DEFAULTS = {
    hallWidthH: 14,
    hallLengthH: 30,
    hallHeightH: 8,
    archWidthRatio: 0.30,
    archHeightRatio: 0.64,
    H: 1.8,
    useWings: true
  };

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
    const KC2 = addCon(rectRegion('KC2', 'Kings', 'Kings L corridor', KC1x - 3, K5.bbox.z1 + 1, K5.bbox.cx - KC1x + 3, 6, 6, 'corridor'));
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

  function prepareArchitecture(layout, hall) {
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
    const hw = hall.width * 0.5, hl = hall.length;
    let hallObstacles = solid(polyRect(-hw - 0.2, -0.2, hw * 2 + 0.4, hl + 0.4));
    layout.doors.filter(d => d.kind === 'arch').forEach(d => {
      const inner = d.x, outer = inner < 0 ? -layout.back : layout.back;
      const x0 = Math.min(inner, outer) - 0.05, x1 = Math.max(inner, outer) + 0.05;
      hallObstacles = union(hallObstacles, solid(polyRect(x0, d.z - d.width * 0.5 - 0.05, x1 - x0, d.width + 0.1)));
    });
    wallSolid = difference(wallSolid, hallObstacles);
    wallSolid = difference(wallSolid, solid(polyRect(layout.sealed.x, layout.sealed.z, layout.sealed.w, layout.sealed.d)));
    const baseWall = openings.reduce((acc, s) => difference(acc, s), wallSolid);
    return { floors: floors, floorExtended: floorExtended, wallSolid: wallSolid, baseWall: baseWall, caps: caps };
  }


  function wingArchOpen(side, index) {
    return (side < 0 && index === 2) || (side > 0 && (index === 0 || index === 2));
  }

  function canonicalHall(wallSize, opts) {
    const CFG = Object.assign({}, HALL_DEFAULTS, opts || {});
    const H = CFG.H;
    const W = CFG.hallWidthH * H, L = CFG.hallLengthH * H;
    let n = 3;
    for (let k = 2; k <= 6; k++) {
      const hTry = wallSize.y * ((L / k) / Math.max(1e-4, wallSize.z));
      if (hTry >= 5.5 * H && hTry <= 8 * H) { n = k; break; }
    }
    const moduleLen = L / n;
    const wallScale = moduleLen / Math.max(1e-4, wallSize.z);
    let CH = wallSize.y * wallScale;
    if (CH > 8 * H) CH = 8 * H;
    const wallThick = wallSize.x * wallScale;
    const archW = CFG.archWidthRatio * moduleLen;
    const archH = CFG.archHeightRatio * CH;
    const passages = [];
    for (let i = 0; i < n; i++) {
      const zc = (i + 0.5) * moduleLen;
      [-1, 1].forEach(function (side) {
        const inner = side * (W / 2);
        passages.push({
          id: 'passage-' + (side < 0 ? 'L' : 'R') + i,
          position: [inner, 0, zc],
          rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
          width: archW,
          height: archH,
          state: wingArchOpen(side, i) ? 'open' : (CFG.useWings && side < 0 && i === 0 ? 'sealed' : 'closed')
        });
      });
    }
    return {
      width: W,
      length: L,
      wallThickness: wallThick,
      alcoveDepth: 1.15 * H,
      floorY: 0,
      passages: passages,
      H: H,
      n: n,
      CH: CH,
      wallScale: wallScale,
      wallSize: { x: wallSize.x, y: wallSize.y, z: wallSize.z }
    };
  }

  function makeCollidersSync(solids, caps) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    (solids || []).forEach(function (s) {
      const b = bbox(s.outer);
      minX = Math.min(minX, b.x0); minZ = Math.min(minZ, b.z0);
      maxX = Math.max(maxX, b.x1); maxZ = Math.max(maxZ, b.z1);
    });
    const nx = Math.ceil((maxX - minX) / GRID), nz = Math.ceil((maxZ - minZ) / GRID);
    const occupied = new Uint8Array(nx * nz);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const x = minX + (ix + 0.5) * GRID, z = minZ + (iz + 0.5) * GRID;
        if (pointInSolids(x, z, solids)) occupied[iz * nx + ix] = 1;
      }
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
          if (q.iz0 === r.iz1 + 1 && q.ix0 === r.ix0 && q.ix1 === r.ix1) {
            r.iz1 = q.iz1; rects.splice(rects.indexOf(q), 1); extended = true; break;
          }
        }
      }
      merged.push(r);
    }
    const boxes = merged.map(function (r) {
      return {
        minx: minX + r.ix0 * GRID - 0.25, maxx: minX + (r.ix1 + 1) * GRID + 0.25,
        miny: 0, maxy: MAX_H,
        minz: minZ + r.iz0 * GRID - 0.25, maxz: minZ + (r.iz1 + 1) * GRID + 0.25,
        _wing: true
      };
    });
    (caps || []).forEach(function (c) {
      const d = c.door;
      boxes.push(d.axis === 'x' ?
        { minx: d.x - 0.5, maxx: d.x + 0.5, miny: d.height, maxy: MAX_H, minz: d.z - d.width * 0.5, maxz: d.z + d.width * 0.5, _wing: true } :
        { minx: d.x - d.width * 0.5, maxx: d.x + d.width * 0.5, miny: d.height, maxy: MAX_H, minz: d.z - 0.5, maxz: d.z + 0.5, _wing: true });
    });
    return {
      boxes: boxes,
      minX: minX, minZ: minZ, maxX: maxX, maxZ: maxZ,
      nx: nx, nz: nz,
      occupied: occupied
    };
  }

  function rebuildSpatial(boxes) {
    const spatial = new Map();
    (boxes || []).forEach(function (b, i) {
      const x0 = Math.floor(b.minx), x1 = Math.floor(b.maxx), z0 = Math.floor(b.minz), z1 = Math.floor(b.maxz);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = x + ',' + z;
        let a = spatial.get(k);
        if (!a) spatial.set(k, a = []);
        a.push(i);
      }
    });
    return spatial;
  }

  function stripSolid(s) {
    return { outer: s.outer, holes: s.holes || [] };
  }
  function serializeCaps(caps) {
    return (caps || []).map(function (c) {
      const d = c.door;
      return {
        door: {
          id: d.id, from: d.from, to: d.to, x: d.x, z: d.z,
          axis: d.axis, width: d.width, height: d.height,
          thickness: d.thickness, kind: d.kind
        },
        solids: (c.solids || []).map(stripSolid)
      };
    });
  }

  function computeBake(hall) {
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const layout = solveLayout(hall);
    const arch = prepareArchitecture(layout, hall);
    const k1 = layout.rooms.find(function (r) { return r.id === 'K1'; });
    let baseWall = arch.baseWall, wallSolid = arch.wallSolid;
    let tDiff = 0;
    if (k1) {
      const td = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      baseWall = difference(baseWall, solid(k1.poly));
      wallSolid = difference(wallSolid, solid(k1.poly));
      tDiff = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - td;
    }
    const col = makeCollidersSync(baseWall, arch.caps);
    function occupiedToB64(u8) {
      if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
      let s = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < u8.length; i += CHUNK) {
        s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
      }
      return btoa(s);
    }
    const occupiedB64 = occupiedToB64(col.occupied);
    const timings = {
      totalMs: ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0,
      k1DiffMs: tDiff
    };
    return {
      version: BAKE_VERSION,
      hall: {
        width: hall.width,
        length: hall.length,
        wallThickness: hall.wallThickness,
        alcoveDepth: hall.alcoveDepth,
        H: hall.H,
        n: hall.n,
        CH: hall.CH,
        wallSize: hall.wallSize || null,
        passages: (hall.passages || []).map(function (p) {
          return {
            id: p.id,
            position: p.position.slice(),
            rotY: p.rotY,
            width: p.width,
            height: p.height,
            state: p.state
          };
        })
      },
      baseWall: (baseWall || []).map(stripSolid),
      wallSolid: (wallSolid || []).map(stripSolid),
      floors: (arch.floors || []).map(stripSolid),
      floorExtended: (arch.floorExtended || []).map(stripSolid),
      caps: serializeCaps(arch.caps),
      colliders: col.boxes,
      grid: {
        minX: col.minX, minZ: col.minZ, maxX: col.maxX, maxZ: col.maxZ,
        nx: col.nx, nz: col.nz,
        occupied: occupiedB64
      },
      timings: timings
    };
  }

  function hallMatches(bakedHall, hall, eps) {
    eps = eps != null ? eps : 1e-3;
    if (!bakedHall || !hall) return false;
    function close(a, b) { return Math.abs((a || 0) - (b || 0)) <= eps; }
    if (!close(bakedHall.width, hall.width) || !close(bakedHall.length, hall.length)) return false;
    if (!close(bakedHall.wallThickness, hall.wallThickness)) return false;
    if (!close(bakedHall.alcoveDepth, hall.alcoveDepth)) return false;
    const a = bakedHall.passages || [], b = hall.passages || [];
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].id !== b[i].id) return false;
      if (!close(a[i].position[0], b[i].position[0]) || !close(a[i].position[2], b[i].position[2])) return false;
      if (!close(a[i].width, b[i].width) || !close(a[i].height, b[i].height)) return false;
    }
    return true;
  }

  function hallMismatchReason(bakedHall, hall, eps) {
    eps = eps != null ? eps : 1e-3;
    if (!bakedHall) return 'no-baked-hall';
    if (!hall) return 'no-live-hall';
    function close(a, b) { return Math.abs((a || 0) - (b || 0)) <= eps; }
    const diffs = [];
    function cmp(name, a, b) { if (!close(a, b)) diffs.push(name + '=' + a + '!=' + b); }
    cmp('width', bakedHall.width, hall.width);
    cmp('length', bakedHall.length, hall.length);
    cmp('wallThickness', bakedHall.wallThickness, hall.wallThickness);
    cmp('alcoveDepth', bakedHall.alcoveDepth, hall.alcoveDepth);
    const a = bakedHall.passages || [], b = hall.passages || [];
    if (a.length !== b.length) diffs.push('passages=' + a.length + '!=' + b.length);
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i].id !== b[i].id) diffs.push('passage[' + i + '].id=' + a[i].id + '!=' + b[i].id);
      cmp('passage[' + i + '].x', a[i].position[0], b[i].position[0]);
      cmp('passage[' + i + '].z', a[i].position[2], b[i].position[2]);
      cmp('passage[' + i + '].width', a[i].width, b[i].width);
      cmp('passage[' + i + '].height', a[i].height, b[i].height);
    }
    return diffs.length ? diffs.join(', ') : 'match';
  }

  function applyColliderBake(state, baked) {
    if (!state || !baked) return false;
    state.floors = baked.floors;
    state.floorExtended = baked.floorExtended;
    state.wallSolid = baked.wallSolid;
    state.baseWall = baked.baseWall;
    state.caps = baked.caps || [];
    state.colliders = (baked.colliders || []).map(function (b) {
      return Object.assign({}, b, { _wing: true });
    });
    state.spatial = rebuildSpatial(state.colliders);
    return true;
  }

  const api = {
    SCALE: SCALE, WALL: WALL, GRID: GRID, MAX_H: MAX_H, BAKE_VERSION: BAKE_VERSION,
    ROOM_NAMES: ROOM_NAMES, HALL_DEFAULTS: HALL_DEFAULTS,
    pt: pt, polyRect: polyRect, polyCircle: polyCircle,
    union: union, difference: difference, intersection: intersection,
    solid: solid, offset: offset, clip: clip,
    signedArea: signedArea, pointInPoly: pointInPoly, pointInSolids: pointInSolids,
    solidsArea: solidsArea, bbox: bbox, region: region, rectRegion: rectRegion,
    solveLayout: solveLayout, prepareArchitecture: prepareArchitecture,
    makeCollidersSync: makeCollidersSync, rebuildSpatial: rebuildSpatial,
    canonicalHall: canonicalHall, wingArchOpen: wingArchOpen,
    computeBake: computeBake, hallMatches: hallMatches, hallMismatchReason: hallMismatchReason, applyColliderBake: applyColliderBake
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PalaceWingArchitecture = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
