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
    ui: null, label: null, minimap: null, minimapAt: 0, fires: [], seals: [], ambient: null
  };

  /* ---------------------------------------------------------------------------
     Wing asset files. Heavy models and pictures use the compressed copies in
     "ارضيات وسقوف/optimized/" (same geometry, WebP textures, meshopt where the
     game already decodes it). PalaceInterior downloads every file in this list
     behind its loading screen and hands the decoded result back through
     provideAsset(), so the wings are fully dressed on the first visible frame.
     When a file was not preloaded the old on-demand network load still runs.
  --------------------------------------------------------------------------- */
  const OPT_DIR = 'ارضيات وسقوف/optimized/';
  const WING_FILES = {
    k1: OPT_DIR + 'K1_RoyalReceptionHall.glb',
    corridorFloor: 'assets/ارضية الممرات.JPG',
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
    k3WallFar: 'assets/\u062C\u062F\u0627\u0631 \u0627\u0644\u062E\u0631\u0627\u064A\u0654\u0637 2.JPG'
  };
  // These two are intentionally NOT in the palace loading-screen list.
  // الاستقبال.glb is an 11MB fused prop mesh; the hall only needs the column,
  // already extracted to a small GLB. The meeting table is fetched after the
  // column so neither file is decoded while the city is still in memory.
  const K2_LAZY = {
    reception: OPT_DIR + 'عمود-المجلس.glb',
    meetings: 'assets/اجتماعات .glb'
  };
  const preloaded = new Map();   // path -> THREE.Texture | parsed gltf
  const deferredLoads = [];      // cached-model callbacks queued while build() runs
  function assetList() {
    return Object.keys(WING_FILES).map(k => ({ url: WING_FILES[k], kind: /\.glb$/i.test(WING_FILES[k]) ? 'glb' : 'tex' }))
      .filter((a, i, all) => all.findIndex(b => b.url === a.url) === i);
  }
  function provideAsset(url, value) { if (url && value) preloaded.set(url, value); }
  function preloadReport() {
    return assetList().map(a => ({ url: a.url, kind: a.kind, ready: preloaded.has(a.url) }));
  }
  function preloadedTexture(url) {
    const t = preloaded.get(url);
    return t && t.isTexture ? t : null;
  }
  function flushDeferredLoads() {
    state.building = false;
    while (deferredLoads.length) {
      const run = deferredLoads.shift();
      try { run(); } catch (e) { console.error('Wing model setup failed', e); }
    }
  }
  function withMeshopt(go) {
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
  // Every wing model goes through here: a preloaded model is handed out as a
  // fresh clone (geometry, materials and textures shared, nothing downloaded);
  // otherwise it is fetched exactly as before.
  function wingGLB(url, onLoad, onError) {
    const fail = onError || (e => console.warn('Wing model failed', url, e));
    if (!THREE.GLTFLoader) { fail(new Error('GLTFLoader not available')); return; }
    const cached = preloaded.get(url);
    if (cached && cached.scene) {
      const run = () => onLoad({ scene: cached.scene.clone(true), animations: cached.animations || [] });
      if (state.building) deferredLoads.push(run); else run();
      return;
    }
    withMeshopt(dec => {
      const loader = new THREE.GLTFLoader();
      if (dec) loader.setMeshoptDecoder(dec);
      loader.load(encodeURI(url), onLoad, undefined, fail);
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
    wingMark('wings wall mesh');
    state.wallMesh = mesh(state.wallGeometry, state.wallMat, 'wings-unified-watertight-walls');
    const floorMats = {
      Kings: gridMaterial(0x80705a, 0.94, 0x1d1710), Temple: gridMaterial(0x65756e, 0.94, 0x121c18),
      Library: gridMaterial(0x756b7e, 0.94, 0x19151d), Shared: gridMaterial(0x746653, 0.94, 0x19150f)
    };
    state.floorMeshes = []; state.floorWingSolids = [];
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
      state.floorWingSolids.push({ wing, solids: wingFloor });
      let skirt = offset(wingFloor, 0.3);
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
      // K2 columns are the real asset extracted from الاستقبال.glb (dressK2).
      if (r.id === 'T1') addColumns(r, g, columnPairs(r, 3, 2.3, 2.2), 0.48);
      if (r.id === 'T3') addColumns(r, g, columnPairs(r, 6, 5.0, 3.0), 0.88);
      if (r.id === 'L1') addColumns(r, g, columnPairs(r, 4, 4.0, 3.4), 0.60);
      // K2 and K3 keep their own dressings, so the procedural torch brackets stay out.
      if (r.id !== 'K1') { addFutureZones(r, g); if (r.id !== 'K2' && r.id !== 'K3') addTorches(r); }
    });
    addSpecials();
    dressCorridors();
    wingMark('wings corridors');
    dressK2();
    wingMark('wings k2');
    dressK3();
    wingMark('wings k3');
    const bracket = new THREE.CylinderGeometry(0.09, 0.13, 0.8, 8); bracket.translate(0, -0.35, 0);
    const torches = new THREE.InstancedMesh(bracket, state.sealMat, state.fires.length); torches.name = 'wings-wall-torches';
    const dummy = new THREE.Object3D();
    state.fires.forEach((f, i) => { dummy.position.set(f.x, f.y, f.z); dummy.updateMatrix(); torches.setMatrixAt(i, dummy.matrix); });
    torches.instanceMatrix.needsUpdate = true; state.root.add(torches);
    state.root.updateMatrixWorld(true);
  }
  /* ---------------------------------------------------------------------------
     Corridor dressing: every corridor/gallery region of the Kings, Library and
     Temple wings (plus the shared passages that link them) is re-skinned with
     the repository corridor assets only:
       assets/ارضية الممرات.JPG  -> corridor floors (incl. the door strips)
       assets/سقف الممرات.PNG    -> corridor ceilings
       assets/جدار الممرات.jpg   -> corridor wall faces + door lintels
       assets/شتله.glb           -> potted plants, repeated on both sides
     Rooms are never touched: corridor pieces are clipped against every room
     polygon and against each other, so no surface is drawn twice. */
  const CORRIDOR_TILE = { floor: 2.0, ceiling: 3.0, wall: 3.0 };
  const CORRIDOR_ASSETS = {
    floor: WING_FILES.corridorFloor, ceiling: WING_FILES.corridorCeiling,
    wall: WING_FILES.corridorWall, plant: WING_FILES.plant
  };
  function corridorTexture(url) {
    const cached = preloadedTexture(url);
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
  function dressCorridors() {
    const corridors = state.connectors.filter(r => r.kind === 'corridor' || r.kind === 'gallery');
    const mats = {
      floor: corridorMaterial(CORRIDOR_ASSETS.floor, 0.86),
      ceiling: corridorMaterial(CORRIDOR_ASSETS.ceiling, 0.92),
      wall: corridorMaterial(CORRIDOR_ASSETS.wall, 0.9)
    };
    mats.ceiling.side = THREE.FrontSide;
    let roomsSolid = []; state.rooms.forEach(r => { roomsSolid = union(roomsSolid, solid(r.poly)); });
    state.corridorCeilings = [];
    let claimed = [], claimedDoors = [];
    const plantSlots = [], report = [], torchSlots = [];
    corridors.forEach(r => {
      const g = state.regionGroups.get(r.id); if (!g) return;
      const piece = difference(difference(solid(r.poly), roomsSolid), claimed);
      claimed = union(claimed, piece);
      if (!piece.length) return;
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
      soffits.forEach(sf => parts.push(flatSheet(sf.under, Math.min(sf.d.height, h) - 0.012, false, CORRIDOR_TILE.wall)));
      mesh(mergeGeometriesUV(parts), mats.wall, r.id + '-corridor-walls', g);
      const lintels = lintelRuns;
      placeCorridorTorches(r, runs, freeArea, torchSlots);
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
            if (!pointInSolids(x, z, freeArea) || pointInSolids(x, z, offset(wallsHere, 0.4))) continue;
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
    });
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
      glow: add(TORCH_GLOW_VS, TORCH_GLOW_FS),
      wall: add(TORCH_WALL_VS, TORCH_WALL_FS, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      ember: add(TORCH_EMBER_VS, TORCH_EMBER_FS)
    };
    state.torchFireMats = (state.torchFireMats || []).concat([m.fire, m.glow, m.wall, m.ember]);
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
        // halo around the flame
        const gg = new THREE.PlaneGeometry(1, 1), gs = new Float32Array(list.length);
        const glow = new THREE.InstancedMesh(gg, mats.glow, list.length); glow.name = id + '-torch-glow'; glow.frustumCulled = false; glow.renderOrder = 2;
        list.forEach((s, i) => { gs[i] = s.seed; dummy.position.copy(fpos[i]); dummy.position.y += 0.16; dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1.1); dummy.updateMatrix(); glow.setMatrixAt(i, dummy.matrix); });
        gg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(gs, 1)); glow.instanceMatrix.needsUpdate = true; g.add(glow);
        // warm light spill on the wall behind the torch
        const wg = new THREE.PlaneGeometry(1, 1), ws = new Float32Array(list.length);
        const wall = new THREE.InstancedMesh(wg, mats.wall, list.length); wall.name = id + '-torch-wall-light'; wall.frustumCulled = false; wall.renderOrder = 1;
        list.forEach((s, i) => {
          ws[i] = s.seed;
          dummy.position.set(s.x + s.dx * 0.006, fpos[i].y + 0.1, s.z + s.dz * 0.006);
          dummy.rotation.set(0, Math.atan2(s.dx, s.dz), 0); dummy.scale.set(2.4, 2.8, 1); dummy.updateMatrix();
          wall.setMatrixAt(i, dummy.matrix);
        });
        wg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(ws, 1)); wall.instanceMatrix.needsUpdate = true; g.add(wall);
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
      e => { console.warn('K2 council hall model failed', url, e); if (state.root === root) onLoad(null); });
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
    const pairs = columnPairs(r, 4, 4.2, 3.2);
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
        g.add(im);
        state.k2Dress.columns = pairs.length;
        state.k2Dress.columnH = targetH;
        state.root.updateMatrixWorld(true);
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
      if (!gltf) return;
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
      model.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; } });
      g.add(holder);
      state.k2Dress.table = true;
      state.k2Dress.tableH = (box.max.y - box.min.y) * s;
      state.root.updateMatrixWorld(true);
    });
  }
  // Procedural flame seated in each chandelier cup, plus a warm pool of light.
  function addK2ChandelierFire(g, cups) {
    if (!cups.length) return;
    const mats = torchFireMaterials();
    const layers = [0.72, 1.05, 1.38];
    const baseW = 0.48, baseH = 0.92;
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
    const gg = new THREE.PlaneGeometry(1, 1), gs = new Float32Array(cups.length);
    const glow = new THREE.InstancedMesh(gg, mats.glow, cups.length);
    glow.name = 'K2-chandelier-glow'; glow.frustumCulled = false; glow.renderOrder = 3;
    cups.forEach((c, i) => {
      gs[i] = c.seed;
      dummy.position.set(c.x, c.y + 0.16 * c.s, c.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0.85 * c.s);
      dummy.updateMatrix();
      glow.setMatrixAt(i, dummy.matrix);
    });
    gg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(gs, 1));
    glow.instanceMatrix.needsUpdate = true; g.add(glow);
    const PER = 8, ep = new Float32Array(cups.length * PER * 3), es = new Float32Array(cups.length * PER);
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
    state.k2Dress.fires = cups.length;
  }
  function addK2Lights(r, g, fireY) {
    const b = r.bbox;
    const lights = [];
    function add(color, intensity, dist, x, y, z) {
      const pl = new THREE.PointLight(color, intensity, dist, 2);
      pl.castShadow = false;
      pl.position.set(x, y, z);
      pl.name = 'K2-light';
      g.add(pl); lights.push(pl);
      return pl;
    }
    add(0xffb15a, 11, 24, b.cx, fireY, b.cz);
    add(0xffc48a, 4.2, 14, b.cx, Math.max(3.2, fireY - 1.35), b.cz);
    const ix = (b.x1 - b.x0) * 0.30, iz = (b.z1 - b.z0) * 0.30;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      add(0xffe2c2, 2.2, 16, b.cx + sx * ix, 4.2, b.cz + sz * iz);
    });
    state.k2Lights = lights;
    state.k2LightBase = lights.map(l => l.intensity);
  }

  function dressK2() {
    const r = state.rooms.find(q => q.id === 'K2'), g = state.regionGroups.get('K2');
    if (!r || !g) return;
    const b = r.bbox, W = b.x1 - b.x0, D = b.z1 - b.z0, h = r.height;
    state.k2Dress = { walls: false, ceiling: 0, chandelier: false, lions: 0, plants: 0, columns: 0, fires: 0, table: false, tableH: K2_DRESS.tableSpan * K2_DRESS.tableHeightRatio };

    // 0) Marble floor — one copy of ارضية المجلس framed to the hall
    const floorMat = k2FloorMaterial(K2_ASSETS.floor);
    const floorGeo = k2FloorSheet(state.k2FloorSolids || solid(r.poly), 0.014, b);
    const floorMesh = mesh(floorGeo, floorMat, 'K2-majlis-floor', g);
    floorMesh.renderOrder = 2;
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
    mesh(wallGeo, wallMat, 'K2-majlis-walls', g);
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
            im.userData.ceiling = true; im.visible = !state.cutaway;
            g.add(im); ceilingMeshes.push(im);
            (state.corridorCeilings || (state.corridorCeilings = [])).push(im);
          });
          state.k2Dress.ceiling = nx * nz;
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
        model.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
        g.add(holder);
      });
      state.k2Dress.lions = lionSlots.length;
      state.root.updateMatrixWorld(true);
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
        im.instanceMatrix.needsUpdate = true; g.add(im);
      });
      state.k2Dress.plants = plantSlots.length;
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
        o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => {
          if (!m || !m.emissive) return;
          if (!m.userData.k2Glow) {
            m.emissive = new THREE.Color(0xffb15a);
            m.emissiveIntensity = Math.max(m.emissiveIntensity || 0, 0.22);
            m.userData.k2Glow = true;
          }
        });
      });
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
      state.k2Dress.chandelier = true;
      state.k2Dress.chandelierTop = seat;
      state.k2Dress.chandelierH = chH;
      state.k2Dress.fireY = fireY;
      state.root.updateMatrixWorld(true);
    });
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
    state.built = false; state.root = null; state.regionGroups.clear(); state.colliders = []; state.fires = []; state.torchFireMats = null; state.corridorTorches = [];
    state.k2Lights = null; state.k2LightBase = null; state.k2FloorSolids = null;
    state.k3Lights = null; state.k3LightBase = null; state.k3FloorSolids = null;
    state.k1FloorY = 0; state.k1ModelMetrics = null; state.k1ModelColliderCount = 0;
  }
  function wingMark(msg) {
    try { if (window.PalaceInterior && PalaceInterior.mark) PalaceInterior.mark(msg); } catch (e) { /* marks are diagnostic only */ }
  }
  function build(ctx, hall) {
    assertDeps(); dispose();
    state.building = true; deferredLoads.length = 0;
    try { return buildNow(ctx, hall); }
    finally { state.building = false; deferredLoads.length = 0; }
  }
  function buildNow(ctx, hall) {
    state.ctx = ctx; state.hall = hall; state.debug = /(?:[?&#])debug=1(?:&|#|$)/.test(location.href);
    state.root = new THREE.Group(); state.root.name = 'PalaceWings';
    state.root.position.set(ctx.portal.x, hall.floorY || 0, ctx.portal.frontZ); ctx.scene.add(state.root);
    const layout = solveLayout(hall);
    wingMark('wings layout');
    state.rooms = layout.rooms; state.connectors = layout.connectors; state.doors = layout.doors;
    state.regions = state.rooms.concat(state.connectors); state.links = layout.links; state.sealed = layout.sealed; state.back = layout.back;
    prepareArchitecture(layout);
    wingMark('wings architecture');
    // Remove procedural walls inside K1 so the GLB model is the only interior
    const k1 = state.rooms.find(r => r.id === 'K1');
    if (k1) {
      state.baseWall = difference(state.baseWall, solid(k1.poly));
      state.wallSolid = difference(state.wallSolid, solid(k1.poly));
    }
    makeColliders(state.baseWall, state.caps);
    wingMark('wings colliders');
    buildVisuals(layout); wingMark('wings visuals'); rebuildSpatial();
    state.built = true;
    if (state.debug) createDebugUI();
    updateCulling(true);
    // Models already downloaded behind the palace loading screen are attached
    // now, in the same order the network callbacks used to run after build.
    flushDeferredLoads();
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
      // Arch thresholds are not part of the link graph: measure from the wing room
      // they open into, and always keep the palace hall drawn while standing in one
      // (the hall is right behind the player there).
      const isArch = !!(r && r.kind === 'threshold');
      const dist = distancesFrom(isArch && r.linkRoom ? r.linkRoom : id);
      if (isArch) dist.set(id, 0);
      // Palace hall stays drawn while it is within two links (seen through the arch behind the player).
      state.palaceNear = id === 'Palace' || isArch || (dist.has('Palace') && dist.get('Palace') <= 2);
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
    if (state.torchFireMats) { const t = performance.now() * 0.001; state.torchFireMats.forEach(m => { m.uniforms.uTime.value = t; }); }
    if (state.k2Lights && state.k2Lights.length) {
      const t = performance.now() * 0.001;
      const flick = 0.84 + 0.11 * Math.sin(t * 6.4) + 0.07 * Math.sin(t * 13.1) + 0.04 * Math.sin(t * 22.4);
      state.k2Lights.forEach((l, i) => {
        const base = state.k2LightBase[i] || l.intensity;
        l.intensity = base * (i < 2 ? flick : 0.94 + 0.06 * Math.sin(t * 1.7 + i));
      });
    }
    if (state.k3Lights && state.k3Lights.length) {
      const t = performance.now() * 0.001;
      state.k3Lights.forEach((l, i) => {
        const base = state.k3LightBase[i] || l.intensity;
        l.intensity = base * (0.9 + 0.1 * Math.sin(t * 6.2 + i * 1.8));
      });
    }
    if (state.debug && state.ui && performance.now() - state.minimapAt > 120) { state.minimapAt = performance.now(); drawMinimap(); }
  }
  function floorAt(x, z) {
    if (!contains(x, z)) return null;
    const K1 = state.rooms.find(r => r.id === 'K1');
    if (K1 && pointInPoly(x, z, K1.poly)) return state.k1FloorY;
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
      if (b.dataset.act === 'cutaway') { state.cutaway = !state.cutaway; state.ceilings.concat(state.corridorCeilings || []).forEach(c => { c.visible = !state.cutaway; }); }
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
    return { meshes, triangles, visibleMeshes, visibleTriangles, colliders: state.colliders.length, k1ModelColliders: state.k1ModelColliderCount, k1FloorY: state.k1FloorY, k1Model: state.k1ModelMetrics, rooms: state.rooms.length, regions: state.regions.length };
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
      k3Draco = loader;
      const q = k3DracoWait.splice(0);
      q.forEach(fn => fn(loader));
    };
    const make = () => {
      if (!THREE.DRACOLoader) { finish(null); return; }
      const d = new THREE.DRACOLoader();
      d.setDecoderPath('vendor/draco/');
      d.setDecoderConfig({ type: 'wasm' });
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
    k3EnsureDraco(draco => {
      if (!draco || !THREE.GLTFLoader) { fail(new Error('DRACOLoader unavailable')); return; }
      withMeshopt(dec => {
        const loader = new THREE.GLTFLoader();
        loader.setDRACOLoader(draco);
        if (dec) loader.setMeshoptDecoder(dec);
        loader.load(encodeURI(url), gltf => { if (state.root === root) onLoad(gltf); else onLoad(null); }, undefined, fail);
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
  function k3WallQuads(segs, b, h) {
    const pos = [], uv = [], nor = [];
    segs.forEach(r => {
      if (r.s1 - r.s0 < 1.2) return;
      const y0 = r.door ? Math.min(r.door.height, h) : 0, y1 = h;
      if (y1 - y0 < 0.02) return;
      const ix = -r.nx * r.inset, iz = -r.nz * r.inset;
      const P = s => [r.a[0] + r.tx * s + ix, r.a[1] + r.tz * s + iz];
      const p0 = P(r.s0), p1 = P(r.s1);
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
    k3Put(g, shelf, b.x0 + 10.6, b.z0 + shelf.size.x * 0.5 + 0.05, Math.PI / 2, 'K3-shelf-b');
    k3Put(g, arch, b.x0 + 3.5, b.z1 - arch.size.x * 0.5 - 0.04, -Math.PI / 2, 'K3-arch');
    k3Put(g, scrolls, b.x0 + 6.7, b.z1 - 1.35, 0.4, 'K3-scrolls');
    k3Put(g, braz, b.x0 + 0.85, b.z0 + 2.5, 0, 'K3-brazier-s');
    k3Put(g, braz, b.x0 + 0.85, b.z0 + 9.5, Math.PI, 'K3-brazier-n');
    k3Put(g, easel, b.x0 + 12.4, b.z0 + 2.3, 2.4, 'K3-easel');
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
  function dressK3() {
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
    if (farGeo.attributes.position.count) mesh(farGeo, k3WallMaterial(WING_FILES.k3WallFar), 'K3-map-wall-far', g);
    else farGeo.dispose();
    if (sideGeo.attributes.position.count) mesh(sideGeo, k3WallMaterial(WING_FILES.k3Wall), 'K3-map-wall-side', g);
    else sideGeo.dispose();
    state.k3Dress.walls = true;

    const lights = [];
    function addLight(color, intensity, dist, x, y, z) {
      const pl = new THREE.PointLight(color, intensity, dist, 2);
      pl.castShadow = false;
      pl.position.set(x, y, z);
      pl.name = 'K3-light';
      g.add(pl); lights.push(pl);
    }
    addLight(0xffb15a, 6.5, 18, b.cx, 3.2, b.cz);
    addLight(0xffc48a, 2.6, 8, b.x0 + 1.1, 1.75, b.z0 + 2.5);
    addLight(0xffc48a, 2.6, 8, b.x0 + 1.1, 1.75, b.z0 + 9.5);
    state.k3Lights = lights;
    state.k3LightBase = lights.map(l => l.intensity);

    k3LoadGLB(K3_LAZY.table, gltf => {
      const dress = state.k3Dress;
      if (!dress || dress.host !== g) return;
      if (!gltf) { dress.tableHalf = { x: 2.16, z: 2.20 }; k3PlaceFurniture(); return; }
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
      model.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
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
      k3PlaceFurniture();
    });
    k3LoadGLB(K3_LAZY.furn, gltf => {
      const dress = state.k3Dress;
      if (!dress || dress.host !== g) return;
      if (!gltf) return;
      const pieces = k3SplitFurniture(gltf.scene);
      const by = {};
      pieces.forEach(p => {
        const k = k3Kind(p);
        if (!by[k] || p.tris > by[k].tris) by[k] = p;
      });
      dress.by = by;
      dress.pieceReport = pieces.map(p => ({ kind: k3Kind(p), size: [p.size.x, p.size.y, p.size.z].map(n => +n.toFixed(3)) }));
      k3PlaceFurniture();
    });
  }

  window.PalaceWings = {
    palaceVisible: function () { return state.palaceNear !== false; },
    build, dispose, tick, contains, regionAt, floorAt, capsuleBlocked, resolveCamera, clampFollowTarget,
    teleport, overview, runTests, formatReport, cameraTour, metrics, corridorReport: () => state.corridorReport,
    shortestPath,
    assetList, provideAsset, preloadReport,
    get report() { return state.report; },
    get state() { return state; }
  };
})();
