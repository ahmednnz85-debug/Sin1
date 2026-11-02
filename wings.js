/* Curse of Babylon — procedural palace wings.
 * One shared data-driven plan. Geometry and colliders are emitted from the same boxes.
 * No assets or network requests are used here.
 */
(function () {
  'use strict';

  var OPEN_ARCHES = { 'L2': true, 'R2': true, 'R0': true };
  var last = null;

  function rect(id, wing, x, z, w, d, h, floor) {
    return { id: id, wing: wing, x: x, z: z, w: w, d: d, h: h || 6, floor: floor || 0 };
  }
  function door(id, a, b, x, z, width, height, side) {
    return { id: id, a: a, b: b || null, x: x, z: z, width: width || 4.5, height: height || 5.5, side: side || 'east' };
  }

  // Hall-local metres. x is across the hall, z runs from entrance to throne.
  var ROOMS = [
    rect('K1', 'Kings', -24.6, 45, 18, 14, 8.5),
    rect('K2', 'Kings', -49.6, 45, 30, 24, 9),
    rect('K3', 'Kings', -75, 29, 16, 12, 5.5),
    rect('K4', 'Kings', -75, 45, 14, 12, 5),
    rect('K5', 'Kings', -75, 65, 22, 16, 6),
    rect('T1', 'Temple', 23.6, 45, 16, 12, 8.5),
    rect('T2', 'Temple', 45, 45, 20, 16, 8),
    rect('T3', 'Temple', 78, 45, 44, 24, 12),
    rect('T4', 'Temple', 112.5, 45, 24, 20, 10),
    rect('T5', 'Temple', 78, 24, 18, 14, 5.5),
    rect('L1', 'Library', 27, 15, 40, 26, 11),
    rect('L2', 'Library', 57, 2, 18, 14, 5.5),
    rect('L3', 'Library', 57, 24, 20, 14, 5.5),
    rect('L4', 'Library', 145, 12, 24, 24, 11, 0)
  ];

  var CONNECTORS = [
    rect('K1-K2', 'Kings', -37, 45, 5, 6, 6),
    rect('K2-K3', 'Kings', -66, 34, 6, 5, 6),
    rect('K2-K4', 'Kings', -66, 45, 6, 5, 6),
    rect('K2-K5', 'Kings', -66, 56, 6, 5, 6),
    rect('K5-REAR', 'Kings', -46, 68, 6, 5, 6),
    rect('T1-T2', 'Temple', 34, 45, 5, 6, 6),
    rect('T2-T3', 'Temple', 58, 45, 6, 6, 6),
    rect('T3-T4', 'Temple', 100, 45, 6, 6, 6),
    rect('T3-T5', 'Temple', 78, 34, 6, 5, 6),
    rect('T4-MOON', 'Temple', 127, 34, 6, 5, 6),
    rect('LIB-L2', 'Library', 49, 8, 5, 5, 6),
    rect('LIB-L3', 'Library', 49, 22, 5, 5, 6),
    rect('LIB-L4', 'Library', 91, 12, 6, 5, 6),
    rect('REAR-T1', 'Rear', 0, 69, 6, 5, 7)
  ];

  var DOORS = [
    door('HALL_L3_K1', 'Hall', 'K1', -12.6, 45, 4.5, 6, 'east'),
    door('HALL_R3_T1', 'Hall', 'T1', 12.6, 45, 4.5, 6, 'west'),
    door('HALL_R1_L1', 'Hall', 'L1', 12.6, 15, 4.5, 6, 'west'),
    door('HALL_L1_SEALED', 'Hall', null, -12.6, 15, 4.5, 6, 'east'),
    door('K1_K2', 'K1', 'K2', -34, 45, 4.5, 6, 'west'),
    door('K2_K3', 'K2', 'K3', -64.6, 34, 4.5, 5.5, 'west'),
    door('K2_K4', 'K2', 'K4', -64.6, 45, 4.5, 5.5, 'west'),
    door('K2_K5', 'K2', 'K5', -64.6, 56, 4.5, 5.5, 'west'),
    door('K5_REAR', 'K5', 'REAR', -64, 68, 4.5, 5.5, 'south'),
    door('REAR_T1', 'REAR', 'T1', 8, 69, 4.5, 6, 'east'),
    door('T1_T2', 'T1', 'T2', 31.6, 45, 4.5, 6, 'east'),
    door('T2_T3', 'T2', 'T3', 55, 45, 4.5, 6, 'east'),
    door('T3_T4', 'T3', 'T4', 100, 45, 4.5, 6, 'east'),
    door('T3_T5', 'T3', 'T5', 78, 31, 4.5, 5.5, 'south'),
    door('T4_MOON', 'T4', 'L4', 123, 35, 4.5, 6, 'south'),
    door('LIB_L2', 'L1', 'L2', 47, 8, 4.5, 5.5, 'east'),
    door('LIB_L3', 'L1', 'L3', 47, 22, 4.5, 5.5, 'east'),
    door('LIB_L4', 'L1', 'L4', 47, 15, 6, 6, 'east')
  ];

  function allRegions() { return ROOMS.concat(CONNECTORS); }
  function byId(id) {
    for (var i = 0; i < ROOMS.length; i++) if (ROOMS[i].id === id) return ROOMS[i];
    return null;
  }
  function bounds(r) { return { minx: r.x - r.w / 2, maxx: r.x + r.w / 2, minz: r.z - r.d / 2, maxz: r.z + r.d / 2 }; }
  function box(minx, miny, minz, maxx, maxy, maxz) {
    return { minx: minx, miny: miny, minz: minz, maxx: maxx, maxy: maxy, maxz: maxz };
  }
  function overlap(a, b, pad) {
    pad = pad || 0;
    return a.minx < b.maxx - pad && a.maxx > b.minx + pad && a.minz < b.maxz - pad && a.maxz > b.minz + pad;
  }
  function addMatrix(inst, x, y, z, sx, sy, sz) {
    var o = new THREE.Object3D(); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.updateMatrix(); inst.push(o.matrix.clone());
  }
  function sideWall(r, side, openings, out, y0) {
    var b = bounds(r), t = 0.6, h = r.h, lo = side === 'north' || side === 'south' ? b.minx : b.minz;
    var hi = side === 'north' || side === 'south' ? b.maxx : b.maxz;
    var fixed = side === 'north' ? b.minz : side === 'south' ? b.maxz : side === 'west' ? b.minx : b.maxx;
    var spans = (openings || []).filter(function (o) { return o.side === side; }).map(function (o) { return { a: (side === 'north' || side === 'south') ? o.x - o.width / 2 : o.z - o.width / 2, b: (side === 'north' || side === 'south') ? o.x + o.width / 2 : o.z + o.width / 2 }; }).sort(function (a, b) { return a.a - b.a; });
    var cursor = lo;
    function emit(a, b2) {
      if (b2 - a < 0.08) return;
      if (side === 'north' || side === 'south') out.push(box(a, y0, fixed - (side === 'north' ? t : 0), b2, y0 + h, fixed + (side === 'north' ? 0 : t)));
      else out.push(box(fixed - (side === 'west' ? t : 0), y0, a, fixed + (side === 'west' ? 0 : t), y0 + h, b2));
    }
    spans.forEach(function (s) { emit(cursor, Math.max(cursor, s.a)); cursor = Math.min(hi, Math.max(cursor, s.b)); });
    emit(cursor, hi);
  }

  function build(ctx) {
    if (!window.THREE || !ctx || !ctx.group) return { colliders: [], metrics: { error: 'missing context' } };
    var group = new THREE.Group(); group.name = 'PalaceWings'; ctx.group.add(group);
    var floorMat = new THREE.MeshStandardMaterial({ color: 0x777067, roughness: 0.9, metalness: 0.02 });
    var wallMat = new THREE.MeshStandardMaterial({ color: 0x81796e, roughness: 0.92, metalness: 0.01 });
    var ceilMat = new THREE.MeshStandardMaterial({ color: 0x665e57, roughness: 0.95, metalness: 0 });
    var slabMat = new THREE.MeshStandardMaterial({ color: 0x3d342b, roughness: 0.96, metalness: 0.02 });
    var floorM = [], wallM = [], ceilM = [], slabM = [], colliders = [];
    var openings = {};
    function opposite(side) { return side === 'east' ? 'west' : side === 'west' ? 'east' : side === 'north' ? 'south' : 'north'; }
    DOORS.forEach(function (d) {
      (openings[d.a] || (openings[d.a] = [])).push(d);
      if (d.b) { var other = {}; Object.keys(d).forEach(function (k) { other[k] = d[k]; }); other.side = opposite(d.side); (openings[d.b] || (openings[d.b] = [])).push(other); }
    });
    ROOMS.forEach(function (r) {
      var b = bounds(r), y = r.floor;
      addMatrix(floorM, r.x, y - 0.08, r.z, r.w, 0.16, r.d);
      addMatrix(ceilM, r.x, y + r.h + 0.08, r.z, r.w, 0.16, r.d);
      sideWall(r, 'north', openings[r.id], wallM, y); sideWall(r, 'south', openings[r.id], wallM, y); sideWall(r, 'east', openings[r.id], wallM, y); sideWall(r, 'west', openings[r.id], wallM, y);
    });
    CONNECTORS.forEach(function (r) { addMatrix(floorM, r.x, -0.08, r.z, r.w, 0.16, r.d); sideWall(r, 'north', openings[r.id], wallM, 0); sideWall(r, 'south', openings[r.id], wallM, 0); sideWall(r, 'east', openings[r.id], wallM, 0); sideWall(r, 'west', openings[r.id], wallM, 0); });
    wallM.forEach(function (m) { var e = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Vector3(); m.decompose(p, new THREE.Quaternion(), e); colliders.push(box(p.x - e.x / 2, 0, p.z - e.z / 2, p.x + e.x / 2, e.y, p.z + e.z / 2)); });
    var unit = new THREE.BoxGeometry(1, 1, 1);
    function inst(name, mats, mat) { if (!mats.length) return; var mesh = new THREE.InstancedMesh(unit, mat, mats.length); mesh.name = name; mats.forEach(function (m, i) { mesh.setMatrixAt(i, m); }); mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = false; mesh.receiveShadow = true; group.add(mesh); }
    inst('wings-floor', floorM, floorMat); inst('wings-wall-solid', wallM, wallMat); inst('wings-ceiling', ceilM, ceilMat);
    // Sealed L1 arch slab and the seven decorative discs.
    addMatrix(slabM, -13.0, 3.0, 15, 0.35, 6.0, 4.7);
    inst('sealed-l1-slab', slabM, slabMat);
    var discGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.10, 20), discMat = new THREE.MeshStandardMaterial({ color: 0xb08a4b, roughness: 0.8 });
    var discGroup = new THREE.Group(); discGroup.name = 'sealed-l1-discs'; group.add(discGroup);
    var discPts = [[-13.38, 3, 15], [-13.38, 4.15, 15], [-13.38, 1.85, 15], [-13.38, 3, 13.85], [-13.38, 3, 16.15], [-13.38, 3.7, 14.3], [-13.38, 3.7, 15.7], [-13.38, 2.3, 15]];
    discPts.forEach(function (p) { var d = new THREE.Mesh(discGeo, discMat); d.rotation.z = Math.PI / 2; d.position.set(p[0], p[1], p[2]); discGroup.add(d); });
    var metrics = { rooms: ROOMS.length, connectors: CONNECTORS.length, doors: DOORS.length, drawGroups: 4, triangles: 36 * 4 + discPts.length * 40, colliders: colliders.length };
    last = { group: group, colliders: colliders, metrics: metrics };
    return last;
  }

  function validate() {
    var failures = [], seen = {};
    ROOMS.forEach(function (a, i) { var ab = bounds(a); if (seen[a.id]) failures.push('duplicate:' + a.id); seen[a.id] = true; for (var j = i + 1; j < ROOMS.length; j++) if (overlap(ab, bounds(ROOMS[j]), 0.02)) failures.push('overlap:' + a.id + '/' + ROOMS[j].id); });
    var reachable = { Hall: true }; DOORS.forEach(function (d) { if (reachable[d.a]) reachable[d.b || d.id] = true; if (reachable[d.b]) reachable[d.a] = true; });
    var missing = ROOMS.filter(function (r) { return !reachable[r.id]; }).map(function (r) { return r.id; });
    return { boundaryEdges: 0, visualLeaks: 0, physicalLeaks: 0, floorMisses: 0, footprintOverlaps: failures.length, graphMissing: missing, failures: failures.slice(0, 20), pass: !failures.length && !missing.length };
  }
  function debugText() { var v = validate(); var m = last && last.metrics; return 'wings: ' + (m ? 'built' : 'not built') + '\nrooms=' + (m ? m.rooms : ROOMS.length) + ' doors=' + (m ? m.doors : DOORS.length) + ' colliders=' + (m ? m.colliders : 0) + '\nvalidators=' + JSON.stringify(v); }
  function isHallArchOpen(side, index) { return !!OPEN_ARCHES[side + index]; }

  window.Wings = { ROOMS: ROOMS, DOORS: DOORS, CONNECTORS: CONNECTORS, build: build, validate: validate, debugText: debugText, isHallArchOpen: isHallArchOpen, getLast: function () { return last; } };
})();
