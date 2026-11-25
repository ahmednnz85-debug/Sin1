/* R3 — architectural greybox. Dimensions are in PalaceInterior metres.
   u points out of passage-L0 (-X); v follows the hall (+Z). */
(function () {
  'use strict';

  const TURN = 34, HALL_U = 59, HALL_V = 24;
  const RADIUS = 20, GALLERY = -15, BASIN = GALLERY - 1.2;
  const SPRING = BASIN + 11.5, CROWN = BASIN + 20;
  const HALF = 3, PORT = Math.asin(HALF / RADIUS);
  const CHORD = Math.sqrt(RADIUS ** 2 - HALF ** 2);
  const HALL_ENTRY = HALL_U - CHORD, SIDE_EXIT = HALL_V - CHORD;
  const TAU = Math.PI * 2, GALLERY_INNER = 16, STAIR_INNER = 12;
  const SEAL = 'passage-L0';
  const budget = Object.freeze({ geometryBytes: 2 * 1024 * 1024, textures: 0, batches: 40 });

  function mount(THREE, passage, hall, origin) {
    const root = new THREE.Group();
    root.name = 'R3_SealedZone';
    root.position.set(passage.position[0], 0, passage.position[2]);
    root.scale.x = -1;
    root.visible = false;
    const start = hall.wallThickness + hall.alcoveDepth;
    const parts = [
      section('R3-01', 'BuriedYearsStair'),
      section('R3-02', 'FirstSealHall'),
      section('R3-03', 'MouthOfTheAbyss')
    ];
    const floors = [];
    const obstacles = [];
    const cameraBoxes = [];
    const slots = {
      Treads: 0x9b9b9b, Landings: 0x969696, Walls: 0x777777,
      Vault: 0x919191, ArchRibs: 0xa9a9a9, Buttresses: 0x909090,
      Plinths: 0x9c9c9c, MuralBays: 0x676767, Gallery: 0xa1a1a1,
      Basin: 0x838383, Dais: 0xbbbbbb, Columns: 0xa3a3a3,
      Capitals: 0xb4b4b4, Guardstones: 0xa4a4a4,
      Platform: 0xababab, Shaft: 0x343434
    };
    let part = parts[0];

    function section(id, name) {
      const group = new THREE.Group();
      group.name = id + '_' + name;
      root.add(group);
      return { group, batches: new Map() };
    }

    function socket(name, position) {
      const anchor = new THREE.Object3D();
      anchor.name = name;
      anchor.position.set(...position);
      part.group.add(anchor);
    }

    function geometry(slot, geo, strength = 1) {
      const data = part.batches.get(slot) || { position: [], color: [], uv: [] };
      part.batches.set(slot, data);
      const pos = geo.attributes.position, normal = geo.attributes.normal, uv = geo.attributes.uv;
      const count = geo.index ? geo.index.count : pos.count;
      for (let i = 0; i < count; i++) {
        const j = geo.index ? geo.index.getX(i) : i;
        const x = pos.getX(j), y = pos.getY(j), z = pos.getZ(j);
        data.position.push(x, y, z);
        const directional = 0.64 + 0.26 * normal.getY(j) - 0.11 * normal.getX(j) + 0.09 * normal.getZ(j);
        const falloff = slot === 'Shaft' ? Math.max(0.12, 1 + (y + 19) / 18) :
          part === parts[1] ? 0.88 + 0.11 * Math.exp(-Math.hypot(x - HALL_U, z - HALL_V) / 9) :
          0.83 + 0.16 * Math.cos((x + z) * 0.14) ** 2;
        const light = Math.max(0.12, directional * strength * falloff);
        data.color.push(light, light, light);
        data.uv.push(uv ? uv.getX(j) : (x + 0.3 * z) / 2, uv ? uv.getY(j) : (y + 0.3 * z) / 2);
      }
      geo.dispose();
    }

    function box(slot, x0, x1, y0, y1, z0, z1, strength) {
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      geometry(slot, g, strength);
    }

    function surface(slot, points, strength) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
      g.setIndex(points.length === 3 ? [0, 1, 2] : [0, 1, 2, 0, 2, 3]);
      g.computeVertexNormals();
      geometry(slot, g, strength);
    }

    function cylinder(slot, x, z, y, height, bottom, top = bottom, sides = 20) {
      const g = new THREE.CylinderGeometry(top, bottom, height, sides);
      g.translate(x, y + height / 2, z);
      geometry(slot, g);
    }

    function collision(x0, x1, y0, y1, z0, z1, solid = false) {
      cameraBoxes.push({
        minx: origin.x + passage.position[0] - x1, maxx: origin.x + passage.position[0] - x0,
        miny: origin.y + y0, maxy: origin.y + y1,
        minz: origin.z + passage.position[2] + z0, maxz: origin.z + passage.position[2] + z1,
        _wing: true
      });
      if (solid) obstacles.push({ x0, x1, y0, y1, z0, z1 });
    }

    function solidBox(slot, x0, x1, y0, y1, z0, z1) {
      box(slot, x0, x1, y0, y1, z0, z1);
      collision(x0, x1, y0, y1, z0, z1, true);
    }

    function rectangle(x0, x1, z0, z1, height, ceiling, steps = false) {
      floors.push({ x0, x1, z0, z1, height, ceiling, steps });
    }

    // Frames describe a tunnel section in distance-along and transverse coordinates.
    const alongU = (x, y, t) => [x, y, t];
    const alongV = (z, y, t) => [t, y, z];
    function frameBox(slot, frame, a, b, y0, y1, t0, t1, solid = false) {
      const p = frame(a, y0, t0), q = frame(b, y1, t1);
      (solid ? solidBox : box)(slot, p[0], q[0], y0, y1, p[2], q[2]);
    }

    function arch(frame, a, b, base, half, top, thickness) {
      const radius = half, spring = base + top - radius, n = 16;
      for (let i = 0; i < n; i++) {
        const t0 = Math.PI * i / n, t1 = Math.PI * (i + 1) / n;
        const p = (d, t, r) => frame(d, spring + Math.sin(t) * r, Math.cos(t) * r);
        const r = radius + thickness;
        surface('ArchRibs', [p(a, t0, radius), p(a, t1, radius), p(a, t1, r), p(a, t0, r)]);
        surface('ArchRibs', [p(b, t0, r), p(b, t1, r), p(b, t1, radius), p(b, t0, radius)]);
        const inner = [p(a, t1, radius), p(a, t0, radius), p(b, t0, radius), p(b, t1, radius)];
        const outer = [p(a, t0, r), p(a, t1, r), p(b, t1, r), p(b, t0, r)];
        surface('ArchRibs', inner);
        surface('ArchRibs', outer);
      }
      for (const sign of [-1, 1]) {
        const edge = sign * (radius + thickness);
        const inner = sign * radius;
        const lo = Math.min(inner, edge), hi = Math.max(inner, edge);
        frameBox('Buttresses', frame, a - 0.16, b + 0.16, base - 0.42, spring, lo, hi, true);
        frameBox('Capitals', frame, a - 0.12, b + 0.12, spring - 0.25, spring + 0.03, lo, hi);
        frameBox('Plinths', frame, a - 0.26, b + 0.26, base - 0.64, base + 0.55, lo, hi, true);
      }
    }

    function tunnel(frame, a, b, width, y0, y1, count, height = 8.4, endWalls = [], ribs = 0) {
      const grade = d => y0 + (y1 - y0) * (d - a) / (b - a);
      const floor = d => count ? y0 + (y1 - y0) *
        Math.min(count, Math.floor((d - a) * count / (b - a) + 1e-7) + (y1 < y0 ? 1 : 0)) / count : grade(d);
      const bound = width + 0.68;
      const p = frame(a, 0, -bound), q = frame(b, 0, bound);
      const transverse = frame === alongV || frame.isTransverse;
      const along = transverse ? (x, z) => z : x => x;
      rectangle(p[0], q[0], p[2], q[2], (x, z) => floor(along(x, z)),
        (x, z) => grade(along(x, z)) + height, count !== 0 || y0 !== y1);
      function plane(slot, a0, a1, t0, t1, y, reverse, strength) {
        const corners = [frame(a0, y(a0), t0), frame(a0, y(a0), t1), frame(a1, y(a1), t1), frame(a1, y(a1), t0)];
        const oriented = reverse !== transverse;
        surface(slot, oriented ? corners.reverse() : corners, strength);
      }
      if (count) {
        for (let i = 0; i < count; i++) {
          const d = a + (b - a) * i / count, e = a + (b - a) * (i + 1) / count;
          const level = floor((d + e) / 2);
          const breakAt = y1 < y0 ? d + 0.035 : e - 0.035;
          plane('Treads', d, breakAt, -bound, bound, () => level, false, y1 < y0 ? 0.83 : 1);
          plane('Treads', breakAt, e, -bound, bound, () => level, false, y1 < y0 ? 1 : 0.83);
          const lip = y0 + (y1 - y0) * (i + (y1 < y0 ? 0 : 1)) / count;
          const at = y1 < y0 ? d : e;
          const riser = [frame(at, Math.min(level, lip), -bound), frame(at, Math.min(level, lip), bound),
            frame(at, Math.max(level, lip), bound), frame(at, Math.max(level, lip), -bound)];
          surface('Treads', (y1 < y0) !== transverse ? riser.reverse() : riser, 0.83);
          const front = frame(d, 0, -bound), back = frame(e, 0, bound);
          collision(front[0], back[0], level - 0.45, level, front[2], back[2]);
        }
      } else {
        plane('Landings', a, b, -bound, bound, grade, false);
      }
      if (ribs) {
        const vault = (d, angle) => frame(d, grade(d) + height - 2.6 * (1 - Math.sin(angle)), bound * Math.cos(angle));
        for (let i = 0; i < 16; i++) {
          const t0 = i * Math.PI / 16, t1 = (i + 1) * Math.PI / 16;
          const strip = [vault(a, t0), vault(b, t0), vault(b, t1), vault(a, t1)];
          surface('Vault', transverse ? strip.reverse() : strip);
        }
      } else {
        plane('Vault', a, b, -bound, bound, d => grade(d) + height, true);
      }
      for (const side of endWalls) {
        const t = side * bound;
        const wall = [frame(a, y0 - 0.4, t), frame(b, y1 - 0.4, t),
          frame(b, y1 + height, t), frame(a, y0 + height, t)];
        surface('Walls', (side > 0) !== transverse ? wall.reverse() : wall);
        const f = frame(a, 0, side < 0 ? t - 0.48 : t);
        const g = frame(b, 0, side < 0 ? t : t + 0.48);
        collision(f[0], g[0], Math.min(y0, y1) - 0.4, Math.max(y0, y1) + height, f[2], g[2]);
        if (!ribs) continue;
        for (let i = 0; i < ribs - 1; i++) {
          const d = a + (b - a) * (i + 0.5) / (ribs - 1);
          const lo = Math.min(t, t - side * 0.035), hi = Math.max(t, t - side * 0.035);
          frameBox('MuralBays', frame, d - 1.55, d + 1.55, grade(d) + 1.05, grade(d) + 4.6, lo, hi);
          const bay = (transverse ? 'Lower' : 'Upper') + '_' + (side < 0 ? 'A' : 'B') + (i + 1);
          socket('Mural_' + bay, frame(d, grade(d) + 2.82, t - side * 0.05));
          if (i % 2 === 0) {
            const ledge = Math.min(t, t - side * 0.58), edge = Math.max(t, t - side * 0.58);
            frameBox('Plinths', frame, d - 0.95, d + 0.95, grade(d) - 0.8, grade(d) + 0.57, ledge, edge, true);
            socket('Statue_' + bay, frame(d, grade(d) + 0.57, t - side * 0.3));
          }
        }
      }
      for (let i = 0; i < ribs; i++) {
        const d = a + (b - a) * (i + 0.22) / ribs;
        arch(frame, d - 0.3, d + 0.32, grade(d), width, height - 0.72, 0.72);
      }
    }

    function landing(x0, x1, z0, z1, y, height, walls) {
      rectangle(x0, x1, z0, z1, () => y, () => y + height);
      box('Landings', x0, x1, y - 0.45, y, z0, z1);
      box('Vault', x0, x1, y + height, y + height + 0.45, z0, z1);
      const [west, east, north, south] = walls;
      if (west) solidBox('Walls', x0 - 0.5, x0, y - 0.4, y + height, z0, z1);
      if (east) solidBox('Walls', x1, x1 + 0.5, y - 0.4, y + height, z0, z1);
      if (north) solidBox('Walls', x0, x1, y - 0.4, y + height, z0 - 0.5, z0);
      if (south) solidBox('Walls', x0, x1, y - 0.4, y + height, z1, z1 + 0.5);
    }

    // Keep the authored opening, floor and reveal. Widen only beyond the reveal.
    // The independent stage starts beyond the old palace wall.
    solidBox('Walls', start - 0.4, start, -0.45, 8.4, -3.68, 3.68);
    const flightStart = start + 0.86, flightEnd = TURN - HALF - 0.68;
    const turnEnd = HALF + 0.68, lowerTurn = HALL_V - HALF - 0.68;
    landing(start, flightStart, -3.68, 3.68, 0, 8.4, [false, false, true, true]);
    tunnel(alongU, flightStart, flightEnd, HALF, 0, -9, 54, 8.4, [-1, 1], 5);
    landing(flightEnd, TURN + 3.68, -3.68, turnEnd, -9, 8.4, [false, true, true, false]);
    const cross = (d, y, t) => alongV(d, y, t + TURN);
    // An offset transverse tunnel shares the same orientation as alongV.
    cross.isTransverse = true;
    tunnel(cross, turnEnd, lowerTurn, HALF, -9, GALLERY, 36, 8.4, [-1, 1], 4);
    landing(flightEnd, HALL_ENTRY - 1.15, lowerTurn, HALL_V + 3.68, GALLERY, 8.4, [true, false, false, true]);
    solidBox('Walls', TURN + 3.68, HALL_ENTRY - 1.15, GALLERY - 0.4, GALLERY + 8.4, lowerTurn - 0.5, lowerTurn);
    landing(HALL_ENTRY - 1.15, HALL_ENTRY, HALL_V - HALF, HALL_V + HALF, GALLERY, 8.4, [false, false, true, true]);
    for (const side of [-1, 1]) {
      const edge = HALL_V + side * HALF;
      solidBox('Buttresses', HALL_ENTRY - 1.65, HALL_ENTRY - 1.15, GALLERY - 0.4, GALLERY + 8.4,
        Math.min(edge, edge + side * 0.68), Math.max(edge, edge + side * 0.68));
    }
    arch((u, y, t) => alongU(u, y, t + HALL_V), HALL_ENTRY - 1.14, HALL_ENTRY - 0.05, GALLERY, HALF, 7.7, 0.7);

    part = parts[1];
    const headings = [Math.PI, 1.5 * Math.PI];
    const angleDistance = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    const opening = a => headings.some(h => angleDistance(a, h) < PORT - 1e-7);
    const stairAngles = [0, Math.PI];
    const STAIR_HALF = 0.115;
    const inStair = a => stairAngles.some(h => angleDistance(a, h) < STAIR_HALF + 1e-7);
    const angles = [...new Set([
      ...Array.from({ length: 80 }, (_, i) => i * TAU / 80).filter(a => !opening(a)),
      ...headings.flatMap(a => [a - PORT, a + PORT]),
      ...stairAngles.flatMap(a => [(a - STAIR_HALF + TAU) % TAU, a + STAIR_HALF]),
      TAU
    ])].sort((a, b) => a - b);
    const point = (r, a, y) => {
      const edge = r === RADIUS ? wallLimit(a) : r;
      return [HALL_U + edge * Math.cos(a), y, HALL_V + edge * Math.sin(a)];
    };
    // The wall openings use six-metre chords, aligned to the approach floors.
    const wallLimit = a => {
      const h = headings.find(d => angleDistance(a, d) <= PORT);
      return h == null ? RADIUS : CHORD / Math.cos(a - h);
    };
    const annulus = (slot, r0, r1, a, b, y) => {
      surface(slot, [point(r0, a, y), point(r0, b, y), point(r1, b, y), point(r1, a, y)]);
    };
    const face = (slot, r, a, b, y0, y1, strength) =>
      surface(slot, [point(r, a, y0), point(r, b, y0), point(r, b, y1), point(r, a, y1)], strength);
    const radialStep = (r, a) => {
      if (r >= GALLERY_INNER) return GALLERY;
      if (!inStair(a) || r <= STAIR_INNER) return BASIN;
      return BASIN + Math.floor((r - STAIR_INNER) * 2) * 0.15;
    };
    const domeY = r => CROWN - (CROWN - SPRING) * (r / RADIUS) ** 1.35;
    for (let i = 0; i < angles.length - 1; i++) {
      const a = angles[i], b = angles[i + 1], mid = (a + b) / 2;
      const port = opening(mid);
      if (!inStair(mid)) {
        annulus('Gallery', GALLERY_INNER, RADIUS, a, b, GALLERY);
        face('Gallery', GALLERY_INNER, a, b, BASIN, GALLERY);
        annulus('Guardstones', 15.8, 16.16, a, b, GALLERY + 0.95);
        face('Guardstones', 15.8, a, b, GALLERY, GALLERY + 0.95);
        face('Guardstones', 16.16, a, b, GALLERY, GALLERY + 0.95);
        const guard = [point(15.8, a, 0), point(15.8, b, 0), point(16.16, a, 0), point(16.16, b, 0)];
        const gx = guard.map(p => p[0]), gz = guard.map(p => p[2]);
        collision(Math.min(...gx), Math.max(...gx), BASIN, GALLERY + 0.95, Math.min(...gz), Math.max(...gz));
        annulus('Basin', 0, GALLERY_INNER, a, b, BASIN);
      } else {
        annulus('Gallery', GALLERY_INNER, RADIUS, a, b, GALLERY);
        annulus('Basin', 0, STAIR_INNER, a, b, BASIN);
        for (let j = 0; j < 8; j++) {
          const r = STAIR_INNER + j * 0.5, y = BASIN + j * 0.15;
          annulus('Treads', r, r + 0.5, a, b, y);
          face('Treads', r + 0.5, a, b, y, y + 0.15);
        }
      }
      face('Walls', RADIUS, a, b, port ? GALLERY + 8.4 : GALLERY, SPRING + 0.08);
      if (!port) {
        face('MuralBays', RADIUS - 0.06, a, b, GALLERY + 2.15, GALLERY + 6.15, 0.81);
        face('Capitals', RADIUS - 0.23, a, b, GALLERY + 6.25, GALLERY + 6.67);
        face('Capitals', RADIUS - 0.42, a, b, SPRING - 0.27, SPRING + 0.02);
        const p0 = point(RADIUS, a, 0), p1 = point(RADIUS, b, 0), q = point(RADIUS + 0.5, mid, 0);
        collision(Math.min(p0[0], p1[0], q[0]), Math.max(p0[0], p1[0], q[0]), GALLERY - 0.35, SPRING,
          Math.min(p0[2], p1[2], q[2]), Math.max(p0[2], p1[2], q[2]));
      }
      for (let j = 0; j < 8; j++) {
        const inner = j * RADIUS / 8, outer = (j + 1) * RADIUS / 8;
        surface(j === 7 ? 'ArchRibs' : 'Vault', [point(inner, a, domeY(inner)), point(outer, a, domeY(outer)),
          point(outer, b, domeY(outer)), point(inner, b, domeY(inner))], j % 2 === 0 ? 1 : 0.95);
      }
    }
    for (const a of stairAngles.flatMap(a => [a - STAIR_HALF, a + STAIR_HALF])) {
      for (let j = 0; j < 8; j++) {
        const r = STAIR_INNER + j * 0.5, y = BASIN + j * 0.15;
        if (j) surface('Gallery', [point(r, a, BASIN), point(r + 0.5, a, BASIN), point(r + 0.5, a, y), point(r, a, y)]);
      }
    }
    const columns = [17, 51, 90, 129, 157, 206, 236, 303, 334];
    for (const degrees of columns) {
      const a = degrees * Math.PI / 180;
      const [x, , z] = point(19.25, a, 0);
      cylinder('Plinths', x, z, GALLERY, 0.42, 1.2, 1.2, 12);
      cylinder('Columns', x, z, GALLERY + 0.42, 7.58, 0.98, 0.8, 16);
      cylinder('Capitals', x, z, GALLERY + 8, 0.53, 0.82, 1.22, 12);
      cylinder('Capitals', x, z, GALLERY + 8.53, 0.53, 1.22, 1.05, 12);
      collision(x - 0.92, x + 0.92, GALLERY, GALLERY + 9.06, z - 0.92, z + 0.92, true);
      // Recesses in the upper arcade, backed by the cylindrical shell.
      if (!headings.some(h => angleDistance(a + 0.22, h) < PORT + 0.11)) {
        const tangent = a + 0.22;
        const frame = (depth, y, t) => [
          HALL_U + depth * Math.cos(tangent) - t * Math.sin(tangent), y,
          HALL_V + depth * Math.sin(tangent) + t * Math.cos(tangent)
        ];
        const panel = (slot, depth, low, high, half, strength) => surface(slot, [
          frame(depth, low, -half), frame(depth, low, half),
          frame(depth, high, half), frame(depth, high, -half)
        ], strength);
        const low = GALLERY + 2.18, high = GALLERY + 6.14;
        panel('Buttresses', 19.56, low - 0.19, high + 0.19, 2.2);
        panel('MuralBays', 19.52, low, high, 2.0, 0.83);
        socket('HallMural_' + degrees, frame(19.49, (low + high) / 2, 0));

        const arcadeBase = GALLERY + 6.72, arcadeSpring = GALLERY + 8.24;
        const reveal = 19.37, backing = 19.9, inside = 1.67, outside = 2.08;
        for (const side of [-1, 1]) {
          const t = side * inside, edge = side * outside;
          surface('ArchRibs', [frame(reveal, arcadeBase, t), frame(reveal, arcadeBase, edge),
            frame(reveal, arcadeSpring, edge), frame(reveal, arcadeSpring, t)]);
          surface('Buttresses', [frame(reveal, arcadeBase, t), frame(reveal, arcadeSpring, t),
            frame(backing, arcadeSpring, t), frame(backing, arcadeBase, t)]);
        }
        panel('MuralBays', backing, arcadeBase, arcadeSpring, inside, 0.65);
        for (let j = 0; j < 12; j++) {
          const a0 = j * Math.PI / 12, a1 = (j + 1) * Math.PI / 12;
          const end = (d, angle, r) => frame(d, arcadeSpring + Math.sin(angle) * r, r * Math.cos(angle));
          surface('ArchRibs', [end(reveal, a0, inside), end(reveal, a1, inside),
            end(reveal, a1, outside), end(reveal, a0, outside)]);
          surface('Buttresses', [end(reveal, a0, inside), end(reveal, a1, inside),
            end(backing, a1, inside), end(backing, a0, inside)]);
          surface('MuralBays', [frame(backing, arcadeSpring, 0), end(backing, a0, inside), end(backing, a1, inside)], 0.65);
        }
      }
    }
    const daisRadii = [4, 3.45, 2.88];
    daisRadii.forEach((r, i) => cylinder('Dais', HALL_U, HALL_V, BASIN + 0.15 * i, 0.15, r, r, 48));
    socket('FirstSealCore', [HALL_U, BASIN + 0.45, HALL_V]);
    const hallFloor = (x, z) => {
      const u = x - HALL_U, v = z - HALL_V, r = Math.hypot(u, v), a = Math.atan2(v, u);
      if (r > wallLimit(a)) return null;
      for (let i = daisRadii.length - 1; i >= 0; i--) {
        if (r <= daisRadii[i]) return BASIN + (i + 1) * 0.15;
      }
      return radialStep(r, a);
    };

    part = parts[2];
    const crossAbyss = (d, y, t) => alongV(d, y, t + HALL_U);
    crossAbyss.isTransverse = true;
    tunnel(crossAbyss, -1, SIDE_EXIT, 2.32, -15.8, GALLERY, 0, 8.4, [-1, 1]);
    landing(HALL_U - 3, HALL_U + 3, -7, -1, -15.8, 8.4, [true, false, true, false]);
    const jog = (d, y, t) => alongU(d, y, t - 4);
    tunnel(jog, HALL_U + 3, HALL_U + 8, 2.32, -15.8, -16.7, 0, 8.4, [-1, 1]);
    landing(HALL_U + 8, HALL_U + 14, -7, -1, -16.7, 8.4, [false, true, false, true]);
    const drop = (d, y, t) => alongV(d, y, t + HALL_U + 11);
    drop.isTransverse = true;
    tunnel(drop, -14, -7, 2.32, -18, -16.7, 0, 8.4, [-1, 1]);
    landing(HALL_U + 8, HALL_U + 14, -20, -14, -18, 8.4, [true, false, true, false]);
    const mouth = (d, y, t) => alongU(d, y, t - 17);
    tunnel(mouth, HALL_U + 14, HALL_U + 20, 2.32, -18, -18.9, 0, 10, [-1, 1]);
    const bridge = HALL_U + 20, rim = bridge + 8, ledge = -18.9;
    arch(mouth, bridge - 0.05, bridge + 1.2, ledge, HALF, 9, 1.1);
    box('Platform', bridge, rim, ledge - 1.45, ledge, -22, -12);
    rectangle(bridge, rim, -22, -12, () => ledge, () => Infinity);
    for (const z of [-21.8, -12.6]) {
      solidBox('Guardstones', bridge + 0.4, rim, ledge, ledge + 1.04, z, z + 0.4);
      solidBox('Buttresses', bridge, bridge + 1.5, ledge, ledge + 10.1, z - 0.25, z + 0.65);
      solidBox('Plinths', bridge + 1.5, bridge + 3.3, ledge, ledge + 0.55, z - 0.1, z + 0.52);
      socket(z < -17 ? 'OverlookStatue_A' : 'OverlookStatue_B', [bridge + 2.4, ledge + 0.55, z + 0.2]);
    }
    // Open void below the overlook; just the shaft boundary belongs to R3.
    solidBox('Guardstones', rim - 0.42, rim, ledge, ledge + 1.06, -22, -12);
    box('Shaft', rim, rim + 0.5, -49, ledge - 1.45, -22, -12);
    const far = rim + 23, bottom = -53, top = ledge + 11;
    for (const [nearZ, farZ] of [[-22, -30], [-12, -4]]) {
      const middleZ = (nearZ + farZ) / 2;
      surface('Shaft', [[bridge, ledge - 8, nearZ], [rim + 8, bottom, middleZ],
        [rim + 8, top, middleZ], [bridge, top, nearZ]], 0.75);
      surface('Shaft', [[rim + 8, bottom, middleZ], [far, bottom, farZ],
        [far, top, farZ], [rim + 8, top, middleZ]], 0.64);
    }
    box('Shaft', far, far + 1, bottom, top, -30, -4, 0.61);
    box('Shaft', rim, far, bottom - 1, bottom, -30, -4, 0.48);
    box('Shaft', bridge, far + 1, top, top + 0.5, -30, -4, 0.54);

    let geometryBytes = 0, batchCount = 0;
    for (const { group, batches } of parts) {
      for (const [slot, data] of batches) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(data.color, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
        g.computeBoundingSphere();
        geometryBytes += Object.values(g.attributes).reduce((total, attr) => total + attr.array.byteLength, 0);
        batchCount++;
        const m = new THREE.MeshBasicMaterial({ color: slots[slot], vertexColors: true, fog: false, toneMapped: false, side: THREE.DoubleSide });
        m.name = group.name + '/' + slot;
        const mesh = new THREE.Mesh(g, m);
        mesh.name = slot;
        mesh.userData.materialSlot = m.name;
        group.add(mesh);
      }
      batches.clear();
    }

    if (geometryBytes > budget.geometryBytes || batchCount > budget.batches) {
      const live = resources([root]);
      release(live, resources([]));
      throw new Error('R3 architecture exceeded its independent stage budget');
    }
    const uAt = x => passage.position[0] - x;
    const vAt = z => z - passage.position[2];
    function sample(u, v) {
      if (u < start || u > rim || v < -22 || v > HALL_V + RADIUS) return null;
      const h = hallFloor(u, v);
      if (h !== null) {
        return { y: h, ceiling: domeY(Math.hypot(u - HALL_U, v - HALL_V)), steps: true };
      }
      for (const f of floors) {
        if (u >= f.x0 && u <= f.x1 && v >= f.z0 && v <= f.z1) {
          return { y: f.height(u, v), ceiling: f.ceiling(u, v), steps: f.steps };
        }
      }
      return null;
    }

    function nearFloor(x, z, y) {
      const hit = sample(uAt(x), vAt(z));
      return hit && Math.abs(hit.y - y) < 1.8 ? hit : null;
    }

    const probes = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.707, 0.707], [0.707, -0.707], [-0.707, 0.707], [-0.707, -0.707]];
    function blocks(x, z, y, px, pz, radius) {
      const u = uAt(x), v = vAt(z);
      const previous = nearFloor(px, pz, y);
      const target = sample(u, v);
      if (!previous || !target || Math.abs(target.y - previous.y) > 0.37) return true;
      for (const [du, dv] of probes) {
        const su = u + du * radius, sv = v + dv * radius;
        const probe = sample(su, sv);
        if (!probe || Math.abs(probe.y - target.y) > 0.47) return true;
      }
      for (const b of obstacles) {
        if (b.y0 >= target.y + 1.9 || b.y1 <= target.y + 0.08) continue;
        const dx = u - Math.max(b.x0, Math.min(u, b.x1));
        const dz = v - Math.max(b.z0, Math.min(v, b.z1));
        if (dx * dx + dz * dz < radius * radius) return true;
      }
      const r = Math.hypot(u - HALL_U, v - HALL_V);
      if (r > 15.8 - radius && r < 16.16 + radius && target.y > BASIN + 0.62 &&
          !inStair(Math.atan2(v - HALL_V, u - HALL_U))) return true;
      return false;
    }

    function update(x, y, z) {
      const u = uAt(x), v = vAt(z);
      const inside = !!nearFloor(x, z, y);
      root.visible = inside;
      const inHall = inside && hallFloor(u, v) !== null;
      parts[0].group.visible = inHall || inside && u <= HALL_ENTRY;
      parts[1].group.visible = inside && u > TURN - 4 && v > -5;
      parts[2].group.visible = inHall || inside && u > HALL_U - 13;
    }

    // Index the boxes by camera-pivot cell, with enough padding for the
    // game's longest follow-camera ray. Unrelated wings get no R3 boxes.
    const cellSize = 6, rayReach = 6;
    const cameraCells = new Map();
    for (const box of cameraBoxes) {
      for (let x = Math.floor((box.minx - rayReach) / cellSize); x <= Math.floor((box.maxx + rayReach) / cellSize); x++) {
        for (let z = Math.floor((box.minz - rayReach) / cellSize); z <= Math.floor((box.maxz + rayReach) / cellSize); z++) {
          const key = x + ',' + z;
          if (!cameraCells.has(key)) cameraCells.set(key, []);
          cameraCells.get(key).push(box);
        }
      }
    }
    cameraBoxes.length = 0;
    return {
      root, nearFloor, blocks, update, budget, cost: { geometryBytes, batches: batchCount, textures: 0 },
      spawn: [passage.position[0] - start - 0.55, 0, passage.position[2]],
      cameraBoxesAt(x, z, y) {
        if (!nearFloor(x, z, y)) return null;
        return cameraCells.get(Math.floor((x + origin.x) / cellSize) + ',' + Math.floor((z + origin.z) / cellSize));
      }
    };
  }

  // Collect owned resources from live roots and detached asset caches. Use
  // identity sets because authored meshes, clones and render targets share data.
  function resources(values) {
    const seen = new Set(), geometry = new Set(), material = new Set(), textures = new Set(), targets = new Set(), instances = new Set();
    function visit(value) {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (value.isObject3D) {
        value.traverse(node => {
          if (node.isInstancedMesh) instances.add(node);
          visit(node.geometry);
          visit(node.material);
          visit(node.shadow?.map);
          visit(node.shadow?.mapPass);
          if (node.isSkinnedMesh) visit(node.skeleton?.boneTexture);
        });
      } else if (value.isTexture) textures.add(value);
      else if (value.isBufferGeometry) geometry.add(value);
      else if (value.isWebGLRenderTarget || value.isRenderTarget) {
        targets.add(value);
        visit(value.textures || value.texture);
        visit(value.depthTexture);
      } else if (value.isMaterial) {
        material.add(value);
        for (const field of Object.values(value)) if (field?.isTexture) visit(field);
        for (const uniform of Object.values(value.uniforms || {})) {
          if (uniform.value?.isTexture) visit(uniform.value);
        }
      } else if (Array.isArray(value)) value.forEach(visit);
      else if (value.constructor === Object) {
        for (const [key, field] of Object.entries(value)) if (key !== 'parser') visit(field);
      }
    }
    values.forEach(visit);
    return { geometry, material, textures, targets, instances };
  }

  function release(drop, keep) {
    const keptSources = new Set([...keep.textures].map(t => t.source));
    const counts = { geometries: 0, materials: 0, textures: 0 };
    for (const node of drop.instances) if (!keep.instances.has(node)) node.dispose();
    for (const g of drop.geometry) {
      if (keep.geometry.has(g)) continue;
      g.dispose();
      for (const name of Object.keys(g.attributes)) g.deleteAttribute(name);
      g.setIndex(null);
      g.morphAttributes = {};
      counts.geometries++;
    }
    for (const m of drop.material) if (!keep.material.has(m)) { m.dispose(); counts.materials++; }
    for (const target of drop.targets) if (!keep.targets.has(target)) target.dispose();
    for (const texture of drop.textures) {
      if (keep.textures.has(texture)) continue;
      // Keep the source identity until the renderer releases its GPU ref.
      // Prevent the memory hook from clearing pixels shared with the hero.
      const shared = keptSources.has(texture.source);
      texture.userData.sinKeepCpu = shared;
      texture.dispose();
      if (shared) texture.source = new (THREE.TextureSource || THREE.Source)(null);
      counts.textures++;
    }
    return counts;
  }

  window.SinR3SealedZone = { mount, resources, release, passageId: SEAL };
})();
