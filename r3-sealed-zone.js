/* R3 — sealed zone architecture. Dimensions are in PalaceInterior metres.
   u points out of passage-L0 (-X); v follows the hall (+Z). */
(function () {
  'use strict';

  const TURN = 34, HALL_U = 59, HALL_V = 24;
  const RADIUS = 20, GALLERY = -15, BASIN = GALLERY - 1.2;
  const SPRING = BASIN + 11.5, CROWN = BASIN + 20;
  const ABYSS_LANDING = -15.8; // floor of the landing that opens the Mouth of the Abyss
  const MAW_ENTRY = HALL_U + 20, MAW_LANE = -17, MAW_LEVEL = -18.9;
  const HALF = 3, PORT = Math.asin(HALF / RADIUS);
  const CHORD = Math.sqrt(RADIUS ** 2 - HALF ** 2);
  const HALL_ENTRY = HALL_U - CHORD, SIDE_EXIT = HALL_V - CHORD;
  const TAU = Math.PI * 2, GALLERY_INNER = 16, STAIR_INNER = 12;
  const SEAL = 'passage-L0';
  // Architecture budget (generated batches) plus the R3-01 dressing budget,
  // re-evaluated on the final assets: stone sets / reliefs as decoded RGBA,
  // the props GLB and its LOD file, and the in-view render envelope measured
  // on the tour (lamassu at full detail beside the player included).
  const budget = Object.freeze({
    geometryBytes: 3 * 1024 * 1024, textures: 0, batches: 52,
    hall: Object.freeze({ textureMiB: 42, glbMiB: 18, drawCalls: 100, trianglesInView: 850000 }),
    stair: Object.freeze({ textureMiB: 48, glbMiB: 24, drawCalls: 110, trianglesInView: 900000 })
  });

  function mount(THREE, passage, hall, origin, { entranceOnly = false } = {}) {
    const root = new THREE.Group();
    root.name = entranceOnly ? 'R3DoorStairEntrance' : 'R3_SealedZone';
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
    const Stair = window.SinR3Stair || null;
    const Hall = window.SinR3Hall || null;
    const Maw = window.SinR3Maw || null;
    const hallDressed = () => !!Hall && part === parts[1];
    const dressed = () => !entranceOnly && !!Stair && part === parts[0];
    const mawDressed = () => !!Maw && part === parts[2];
    const stairArches = [], stairTunnels = [];
    const uAt = x => passage.position[0] - x;
    const vAt = z => z - passage.position[2];
    const probes = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.707, 0.707], [0.707, -0.707], [-0.707, 0.707], [-0.707, -0.707]];

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
      const data = part.batches.get(slot) || { position: [], color: [], uv: [], normal: [] };
      part.batches.set(slot, data);
      if (dressed() || hallDressed() || mawDressed()) {
        const hall = hallDressed();
        // Lit stone: real normals and metric UVs projected on the dominant
        // axis, so blocks keep their natural size on every surface.
        const pos = geo.attributes.position, normal = geo.attributes.normal;
        const count = geo.index ? geo.index.count : pos.count;
        const scale = hall ? 0 : mawDressed() ? 1 / 2.65 : 1 / Stair.tileMetres(slot);
        for (let i = 0; i < count; i++) {
          const j = geo.index ? geo.index.getX(i) : i;
          const x = pos.getX(j), y = pos.getY(j), z = pos.getZ(j);
          const nx = normal.getX(j), ny = normal.getY(j), nz = normal.getZ(j);
          data.position.push(x, y, z);
          data.normal.push(nx, ny, nz);
          const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
          if (hall) {
            const uv = geo.attributes.uv;
            if (uv && geo.userData.hallUV) data.uv.push(uv.getX(j), uv.getY(j));
            else {
              const mapped = Hall.uv({ HALL_U, HALL_V, RADIUS }, slot, x, y, z, nx, ny, nz);
              data.uv.push(...mapped);
              if (i % 3 === 2 && ['Walls', 'MuralBays', 'Guardstones'].includes(slot) && ay < Math.max(ax, az)) {
                const end = data.uv.length - 2, start = end - 4;
                const values = [data.uv[start], data.uv[start + 2], data.uv[end]];
                if (Math.max(...values) - Math.min(...values) > 22) {
                  const period = Math.round(TAU * RADIUS / 2.6);
                  for (let k = start; k <= end; k += 2) if (data.uv[k] < 4) data.uv[k] += period;
                }
              }
            }
          } else if (ay >= ax && ay >= az) data.uv.push(x * scale, z * scale);
          else if (ax >= az) data.uv.push(z * scale * Math.sign(nx || 1), y * scale);
          else data.uv.push(-x * scale * Math.sign(nz || 1), y * scale);
        }
        geo.dispose();
        return;
      }
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
        const light = entranceOnly
          ? (0.33 + 0.52 * Math.exp(-Math.max(0, x - start) / 8)) * strength
          : Math.max(0.12, directional * strength * falloff);
        data.color.push(light, light, light);
        if (entranceOnly) {
          const scale = 1 / (Stair?.tileMetres(slot) || 2);
          const nx = normal.getX(j), ny = normal.getY(j), nz = normal.getZ(j);
          if (Math.abs(ny) > 0.6) data.uv.push(x * scale, z * scale);
          else if (Math.abs(nx) > Math.abs(nz)) data.uv.push(z * scale, y * scale);
          else data.uv.push(x * scale, y * scale);
        } else data.uv.push(uv ? uv.getX(j) : (x + 0.3 * z) / 2, uv ? uv.getY(j) : (y + 0.3 * z) / 2);
      }
      geo.dispose();
    }

    function box(slot, x0, x1, y0, y1, z0, z1, strength) {
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      geometry(slot, g, strength);
    }

    function surface(slot, points, strength, uv) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
      g.setIndex(points.length === 3 ? [0, 1, 2] : [0, 1, 2, 0, 2, 3]);
      g.computeVertexNormals();
      if (uv) {
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv.flat(), 2));
        g.userData.hallUV = true;
      }
      geometry(slot, g, strength);
    }

    function cylinder(slot, x, z, y, height, bottom, top = bottom, sides = 20) {
      const g = new THREE.CylinderGeometry(top, bottom, height, sides);
      g.translate(x, y + height / 2, z);
      geometry(slot, g);
    }

    function collision(x0, x1, y0, y1, z0, z1, solid = false, enabled = null) {
      cameraBoxes.push({
        minx: origin.x + passage.position[0] - x1, maxx: origin.x + passage.position[0] - x0,
        miny: origin.y + y0, maxy: origin.y + y1,
        minz: origin.z + passage.position[2] + z0, maxz: origin.z + passage.position[2] + z1,
        _wing: true, enabled
      });
      if (solid) obstacles.push({ x0, x1, y0, y1, z0, z1, enabled });
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
      if (dressed()) {
        // Masonry archway asset replaces rib, piers, capitals and plinths.
        // The pier and plinth collision volumes stay exactly as authored.
        stairArches.push({ frame, a, b, base, half, top, thickness });
        for (const sign of [-1, 1]) {
          const edge = sign * (radius + thickness), inner = sign * radius;
          const lo = Math.min(inner, edge), hi = Math.max(inner, edge);
          const p = frame(a - 0.16, 0, lo), q = frame(b + 0.16, 0, hi);
          collision(Math.min(p[0], q[0]), Math.max(p[0], q[0]), base - 0.42, spring, Math.min(p[2], q[2]), Math.max(p[2], q[2]), true);
          const r = frame(a - 0.26, 0, lo), w = frame(b + 0.26, 0, hi);
          collision(Math.min(r[0], w[0]), Math.max(r[0], w[0]), base - 0.64, base + 0.55, Math.min(r[2], w[2]), Math.max(r[2], w[2]), true);
        }
        return;
      }
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
      if (dressed()) stairTunnels.push({ frame, a, b, width, y0, y1, count, height, ribs, transverse, bound: width + 0.68, grade });
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
          const bay = (transverse ? 'Lower' : 'Upper') + '_' + (side < 0 ? 'A' : 'B') + (i + 1);
          socket('Mural_' + bay, frame(d, grade(d) + 2.82, t - side * 0.05));
          if (dressed()) continue;
          frameBox('MuralBays', frame, d - 1.55, d + 1.55, grade(d) + 1.05, grade(d) + 4.6, lo, hi);
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

    function sampleFloor(u, v) {
      for (const f of floors) {
        if (u >= f.x0 && u <= f.x1 && v >= f.z0 && v <= f.z1) {
          return { y: f.height(u, v), ceiling: f.ceiling(u, v), steps: f.steps };
        }
      }
      return null;
    }

    function blocksPassage(u, v, previous, target, radius, sample) {
      if (!previous || !target || Math.abs(target.y - previous.y) > 0.37) return true;
      for (const [du, dv] of probes) {
        const probe = sample(u + du * radius, v + dv * radius);
        if (!probe || Math.abs(probe.y - target.y) > 0.47) return true;
      }
      for (const b of obstacles) {
        if (b.enabled && !b.enabled()) continue;
        if (b.y0 >= target.y + 1.9 || b.y1 <= target.y + 0.08) continue;
        const dx = u - Math.max(b.x0, Math.min(u, b.x1));
        const dz = v - Math.max(b.z0, Math.min(v, b.z1));
        if (dx * dx + dz * dz < radius * radius) return true;
      }
      return false;
    }

    // Keep the one-way cap in the independent stage. At the open throne
    // hall doorway, instead close only the junction outside the path.
    if (entranceOnly) {
      const jamb = passage.width * 0.5 - 0.06;
      solidBox('Walls', start - 0.04, start, -0.45, 8.4, -3.68, -jamb);
      solidBox('Walls', start - 0.04, start, -0.45, 8.4, jamb, 3.68);
      solidBox('Vault', start - 0.04, start, passage.height, 8.4, -jamb, jamb);
    } else solidBox('Walls', start - 0.4, start, -0.45, 8.4, -3.68, 3.68);
    const flightStart = start + 0.86, flightEnd = TURN - HALF - 0.68;
    const turnEnd = HALF + 0.68, lowerTurn = HALL_V - HALF - 0.68;
    landing(start, flightStart, -3.68, 3.68, 0, 8.4, [false, false, true, true]);
    tunnel(alongU, flightStart, flightEnd, HALF, 0, -9, 54, 8.4, [-1, 1], 5);
    landing(flightEnd, TURN + 3.68, -3.68, turnEnd, -9, 8.4, [false, true, true, false]);
    if (entranceOnly) {
      const maps = new Map();
      const cost = bake(part, slot => Stair?.entranceMaterial(THREE, slot, maps) || basicStone(slot));
      const limits = (u, v) => u < start
        ? (u >= start - 2 && Math.abs(v) < passage.width * 0.41 ? { y: 0, ceiling: passage.height } : null)
        : sampleFloor(u, v);
      const handoff = flightStart + 1.45;
      return {
        root, cost, start, handoff, ready: () => Promise.all([...maps.values()].map(map => map.ready)),
        floorAt(x, z) { return sampleFloor(uAt(x), vAt(z)); },
        crossed(x, z) { return uAt(x) >= handoff && !!sampleFloor(uAt(x), vAt(z)); },
        blocks(x, z, px, pz, radius) {
          const u = uAt(x), v = vAt(z);
          return blocksPassage(u, v, limits(uAt(px), vAt(pz)), limits(u, v), radius, limits);
        },
        cameraBoxesAt() { return cameraBoxes; }
      };
    }
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
    // Dressing plan: placements, plinths and their collisions are decided
    // here, synchronously, so the camera index below includes them.
    let stairPlan = null;
    if (Stair) {
      const stairFloor = (u, v) => {
        for (const f of floors) if (u >= f.x0 && u <= f.x1 && v >= f.z0 && v <= f.z1) return f.height(u, v);
        return null;
      };
      try {
        stairPlan = Stair.plan({
          THREE, group: parts[0].group, box, solidBox, collision, socket, floorAt: stairFloor,
          tunnels: stairTunnels, arches: stairArches, alongU, alongV, budget: budget.stair,
          start, flightStart, flightEnd, TURN, HALF, turnEnd, lowerTurn, HALL_ENTRY, HALL_V, GALLERY
        });
      } catch (error) {
        console.error('[R3-01] stair dressing plan failed', error);
      }
    }

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
    const columns = [17, 51, 90, 129, 157, 206, 236, 303, 334];
    const apertures = [
      { r: 2.1, a: 0.42, radial: 1.84, chord: 1.50, glow: 920, width: 1.35 },
      { r: 11.1, a: 0.89, radial: 1.19, chord: 0.68, glow: 520, width: 0.62 },
      { r: 13.6, a: -0.65, radial: 1.14, chord: 0.72, glow: 590, width: 0.74 },
      { r: 15.7, a: -0.28, radial: 1.15, chord: 0.63, glow: 375, width: 0.60 }
    ];
    const hallLook = Hall?.create({
      THREE, root, group: parts[1].group, HALL_U, HALL_V, RADIUS, BASIN, GALLERY, SPRING,
      columns: columns.map(degrees => degrees * Math.PI / 180),
      surface, box, point, domeY, opening, inStair, apertures,
      propCollision: (...bounds) => collision(...bounds, true, () => hallLook.ready()),
      fallbackSlots: ['Columns', 'Dais', 'Plinths'],
      url: path => window.__sinAsset?.(path) || path
    });
    const domeSteps = hallLook ? 24 : 8;
    const domeAngles = hallLook ? Array.from({ length: 169 }, (_, i) => i * TAU / 168) : angles;
    function roofDamage(i, j) {
      if (!hallLook || j < 0 || j >= domeSteps) return false;
      const mid = (domeAngles[i] + domeAngles[i + 1]) / 2;
      const midRadius = (j + 0.5) * RADIUS / domeSteps;
      return apertures.some(h => {
        const dr = (midRadius - h.r) / h.radial;
        const dw = angleDistance(h.a, mid) * midRadius / h.chord;
        return dr * dr + dw * dw < 1.06 + 0.22 * Math.sin(17 * i + 19 * j);
      });
    }
    for (let i = 0; i < angles.length - 1; i++) {
      const a = angles[i], b = angles[i + 1], mid = (a + b) / 2;
      const port = opening(mid);
      if (!inStair(mid)) {
        annulus('Gallery', GALLERY_INNER, RADIUS, a, b, GALLERY);
        face('Gallery', GALLERY_INNER, a, b, BASIN, GALLERY);
        annulus('Guardstones', 15.8, 16.16, a, b, GALLERY + 0.95);
        if (hallLook) {
          for (const [bottom, top] of [[0, 0.17], [0.78, 0.95]]) {
            face('Guardstones', 15.8, a, b, GALLERY + bottom, GALLERY + top);
            face('Guardstones', 16.16, a, b, GALLERY + bottom, GALLERY + top);
          }
          annulus('Guardstones', 15.8, 16.16, a, b, GALLERY + 0.17);
          annulus('Guardstones', 15.8, 16.16, a, b, GALLERY + 0.78);
          const post = (b - a) * 0.16;
          const low = GALLERY + 0.12, high = GALLERY + 0.82;
          face('Guardstones', 15.81, mid - post, mid + post, low, high);
          face('Guardstones', 16.15, mid - post, mid + post, low, high);
          for (const angle of [mid - post, mid + post]) {
            surface('RailAshlar', [point(15.81, angle, low), point(16.15, angle, low),
              point(16.15, angle, high), point(15.81, angle, high)]);
          }
        } else {
          face('Guardstones', 15.8, a, b, GALLERY, GALLERY + 0.95);
          face('Guardstones', 16.16, a, b, GALLERY, GALLERY + 0.95);
        }
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
        if (!hallLook) {
          face('MuralBays', RADIUS - 0.06, a, b, GALLERY + 2.15, GALLERY + 6.15, 0.81);
          face('Capitals', RADIUS - 0.23, a, b, GALLERY + 6.25, GALLERY + 6.67);
        }
        face('Capitals', RADIUS - 0.42, a, b, SPRING - 0.27, SPRING + 0.02);
        const p0 = point(RADIUS, a, 0), p1 = point(RADIUS, b, 0), q = point(RADIUS + 0.5, mid, 0);
        collision(Math.min(p0[0], p1[0], q[0]), Math.max(p0[0], p1[0], q[0]), GALLERY - 0.35, SPRING,
          Math.min(p0[2], p1[2], q[2]), Math.max(p0[2], p1[2], q[2]));
      }
    }
    for (let i = 0; i < domeAngles.length - 1; i++) {
      const a = domeAngles[i], b = domeAngles[i + 1];
      for (let j = 0; j < domeSteps; j++) {
        const inner = j * RADIUS / domeSteps, outer = (j + 1) * RADIUS / domeSteps;
        if (roofDamage(i, j)) {
          // Closed recessed stone above the damaged inner shell. This
          // silhouette shows lit roof thickness from every camera angle.
          const shape = [point(inner, a, domeY(inner)), point(outer, a, domeY(outer)),
            point(outer, b, domeY(outer)), point(inner, b, domeY(inner))];
          const lid = shape.map(([x, y, z]) => [x, y + 0.75, z]);
          surface('RoofGlow', lid);
          const spans = domeAngles.length - 1;
          const neighbours = [[(i + spans - 1) % spans, j], [i, j + 1], [(i + 1) % spans, j], [i, j - 1]];
          for (let k = 0; k < 4; k++) {
            if (roofDamage(...neighbours[k]) || (k === 3 && j === 0)) continue;
            const next = (k + 1) % 4;
            surface('RoofEdge', [shape[k], shape[next], lid[next], lid[k]]);
          }
        } else {
          surface(j === domeSteps - 1 ? 'ArchRibs' : 'Vault', [point(inner, a, domeY(inner)), point(outer, a, domeY(outer)),
            point(outer, b, domeY(outer)), point(inner, b, domeY(inner))], j % 2 === 0 ? 1 : 0.95);
        }
      }
    }
    if (hallLook) {
      for (const [heading, frame] of [
        [Math.PI, (depth, y, t) => [HALL_ENTRY + depth, y, HALL_V - t]],
        [1.5 * Math.PI, (depth, y, t) => [HALL_U + t, y, SIDE_EXIT + depth]]
      ]) {
        const crown = GALLERY + 8.4, impost = crown - HALF;
        // This lintel only occupies the shoulders of the existing port
        // above head height. The full six-metre path below remains clear.
        const curve = (depth, theta, width) => frame(depth, impost + Math.sin(theta) * width, Math.cos(theta) * width);
        for (let i = 0; i < 14; i++) {
          const a = i * Math.PI / 14, b = (i + 1) * Math.PI / 14;
          surface('ArchRibs', [curve(0.18, a, HALF), curve(0.18, b, HALF),
            curve(0.18, b, HALF + 0.40), curve(0.18, a, HALF + 0.40)]);
          surface('RoofEdge', [curve(0.0, a, HALF), curve(0.18, a, HALF),
            curve(0.18, b, HALF), curve(0.0, b, HALF)]);
        }
        for (const side of [-1, 1]) {
          const a = heading + side * PORT;
          face('Buttresses', RADIUS - 0.32, a, a + side * 0.024, GALLERY, impost);
        }
      }
    }
    for (const a of stairAngles.flatMap(a => [a - STAIR_HALF, a + STAIR_HALF])) {
      for (let j = 0; j < 8; j++) {
        const r = STAIR_INNER + j * 0.5, y = BASIN + j * 0.15;
        if (j) surface('Gallery', [point(r, a, BASIN), point(r + 0.5, a, BASIN), point(r + 0.5, a, y), point(r, a, y)]);
      }
    }
    for (const degrees of columns) {
      const a = degrees * Math.PI / 180;
      const [x, , z] = point(19.25, a, 0);
      cylinder('Plinths', x, z, GALLERY, 0.42, 1.2, 1.2, 12);
      cylinder('Columns', x, z, GALLERY + 0.42, 7.58, 0.98, 0.8, 16);
      cylinder(hallLook ? 'Columns' : 'Capitals', x, z, GALLERY + 8, 0.53, 0.82, 1.22, 12);
      cylinder(hallLook ? 'Columns' : 'Capitals', x, z, GALLERY + 8.53, 0.53, 1.22, 1.05, 12);
      collision(x - 0.92, x + 0.92, GALLERY, GALLERY + 9.06, z - 0.92, z + 0.92, true, () => !hallLook?.ready());
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
        if (!hallLook) {
          panel('Buttresses', 19.56, low - 0.19, high + 0.19, 2.2);
          panel('MuralBays', 19.52, low, high, 2.0, 0.83);
        }
        socket('HallMural_' + degrees, frame(19.49, (low + high) / 2, 0));

        if (hallLook && angleDistance(tangent, 0) < 0.36) continue;
        const arcadeBase = GALLERY + (hallLook ? 7.72 : 6.72), arcadeSpring = GALLERY + (hallLook ? 8.80 : 8.24);
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
    hallLook?.shell();
    hallLook?.stairs();
    hallLook?.plan();
    const hallFloor = (x, z) => {
      const u = x - HALL_U, v = z - HALL_V, r = Math.hypot(u, v), a = Math.atan2(v, u);
      if (r > wallLimit(a)) return null;
      if (hallLook?.ready() && r < 8) return BASIN + Hall.platformFloor(r, a);
      for (let i = daisRadii.length - 1; i >= 0; i--) {
        if (r <= daisRadii[i]) return BASIN + (i + 1) * 0.15;
      }
      return radialStep(r, a);
    };

    part = parts[2];
    const crossAbyss = (d, y, t) => alongV(d, y, t + HALL_U);
    crossAbyss.isTransverse = true;
    tunnel(crossAbyss, -1, SIDE_EXIT, 2.32, ABYSS_LANDING, GALLERY, 0, 8.4, [-1, 1]);
    landing(HALL_U - 3, HALL_U + 3, -7, -1, ABYSS_LANDING, 8.4, [true, false, true, false]);
    const jog = (d, y, t) => alongU(d, y, t - 4);
    tunnel(jog, HALL_U + 3, HALL_U + 8, 2.32, ABYSS_LANDING, -16.7, 0, 8.4, [-1, 1]);
    landing(HALL_U + 8, HALL_U + 14, -7, -1, -16.7, 8.4, [false, true, false, true]);
    const drop = (d, y, t) => alongV(d, y, t + HALL_U + 11);
    drop.isTransverse = true;
    tunnel(drop, -14, -7, 2.32, -18, -16.7, 0, 8.4, [-1, 1]);
    landing(HALL_U + 8, HALL_U + 14, -20, -14, -18, 8.4, [true, false, true, false]);
    const mouth = (d, y, t) => alongU(d, y, t + MAW_LANE);
    tunnel(mouth, HALL_U + 14, MAW_ENTRY, 2.32, -18, MAW_LEVEL, 0, 10, [-1, 1]);
    const bridge = MAW_ENTRY, rim = bridge + (Maw?.limits.far ?? 8), ledge = MAW_LEVEL;
    const mawLook = Maw?.create({ THREE, group: part.group, entry: bridge, lane: MAW_LANE, level: ledge, collision });
    if (!mawLook) {
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
    }

    function basicStone(slot) {
      return new THREE.MeshBasicMaterial({ color: slots[slot], vertexColors: true, fog: false, toneMapped: false, side: THREE.DoubleSide });
    }

    function bake({ group, batches }, materialForSlot) {
      let geometryBytes = 0, batchCount = 0;
      for (const [slot, data] of batches) {
        const g = new THREE.BufferGeometry();
        const lit = data.normal.length > 0;
        g.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
        if (lit) g.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3));
        else g.setAttribute('color', new THREE.Float32BufferAttribute(data.color, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
        g.computeBoundingSphere();
        geometryBytes += Object.values(g.attributes).reduce((total, attr) => total + attr.array.byteLength, 0);
        batchCount++;
        const m = materialForSlot(slot, lit);
        m.name = group.name + '/' + slot;
        const mesh = new THREE.Mesh(g, m);
        mesh.name = slot;
        if (lit) mesh.castShadow = mesh.receiveShadow = true;
        if (group === parts[1].group) {
          mesh.castShadow = ['Plinths', 'Columns', 'Guardstones', 'ArchRibs', 'PlatformSteps'].includes(slot);
          if (slot === 'PlatformSteps') mesh.visible = false;
        }
        mesh.userData.materialSlot = m.name;
        group.add(mesh);
      }
      batches.clear();
      return { geometryBytes, batches: batchCount };
    }

    let geometryBytes = 0, batchCount = 0;
    for (const section of parts) {
      const baked = bake(section, (slot, lit) => {
        if (!lit) return basicStone(slot);
        if (section === parts[1]) return hallLook.stone(slot);
        if (section === parts[2]) return mawLook.material(slot);
        return Stair.material(THREE, slot);
      });
      geometryBytes += baked.geometryBytes;
      batchCount += baked.batches;
    }

    if (geometryBytes > budget.geometryBytes || batchCount > budget.batches) {
      const live = resources([root]);
      release(live, resources([]));
      throw new Error('R3 architecture exceeded its independent stage budget');
    }
    function sample(u, v) {
      const left = mawLook ? MAW_LANE - Maw.limits.half : -22;
      if (u < start || u > rim || v < left || v > HALL_V + RADIUS) return null;
      if (mawLook && u >= bridge - 0.04 && Math.abs(v - MAW_LANE) <= Maw.limits.half) {
        const height = Maw.floor(u - bridge, v - MAW_LANE);
        if (height != null) return { y: MAW_LEVEL + height, ceiling: Infinity, steps: true };
      }
      const h = hallFloor(u, v);
      if (h !== null) {
        return { y: h, ceiling: domeY(Math.hypot(u - HALL_U, v - HALL_V)), steps: true };
      }
      return sampleFloor(u, v);
    }

    function nearFloor(x, z, y) {
      const hit = sample(uAt(x), vAt(z));
      return hit && Math.abs(hit.y - y) < 1.8 ? hit : null;
    }

    function blocks(x, z, y, px, pz, radius) {
      const u = uAt(x), v = vAt(z);
      const previous = nearFloor(px, pz, y);
      const target = sample(u, v);
      if (blocksPassage(u, v, previous, target, radius, sample)) return true;
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
      // Stair look (lights, fog, dust) follows the hero through R3-01 and
      // hands the shared stage lights back on the way into the hall.
      stair?.update(u, y, v, parts[0].group.visible, inside && !inHall && u <= HALL_ENTRY);
      hallLook?.update(u, v, inHall, parts[1].group.visible);
      mawLook?.update(u, v, inside);
    }
    const stair = stairPlan && Stair.create(THREE, root, parts[0].group, stairPlan);

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
    const stageCost = { geometryBytes, batches: batchCount, textures: 0 };
    return {
      root, nearFloor, blocks, update, budget, cost: stageCost,
      // Prepare the independent stage while the transition curtain is black.
      async ready(renderer) {
        mawLook?.configure(renderer);
        if (stair) stageCost.stair = await stair.load(renderer).catch(error => {
          console.error('[R3-01] stair assets', error);
          return { error: error.message };
        });
        if (hallLook) stageCost.hall = await hallLook.load(renderer);
        return stageCost;
      },
      stair, maw: mawLook,
      spawn: [passage.position[0] - start - 0.55, 0, passage.position[2]],
      cameraBoxesAt(x, z, y) {
        if (!nearFloor(x, z, y)) return null;
        const boxes = cameraCells.get(Math.floor((x + origin.x) / cellSize) + ',' + Math.floor((z + origin.z) / cellSize));
        return hallLook && boxes?.some(box => box.enabled)
          ? boxes.filter(box => !box.enabled || box.enabled()) : boxes;
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

  // Area registry (sin-areas.js): the three sections, spawned in stage space
  // (u out of passage-L0, v along the hall, y below the hall floor).
  if (window.SinAreas) {
    SinAreas.group('r3', 'المنطقة المختومة R3', 'Sealed zone R3', 70);
    [['R3-01', 'درج السنين المدفونة', 'Buried Years Stair', { stageSpawn: true }],
      ['R3-02', 'قاعة الختم الأول', 'First Seal Hall', { u: HALL_ENTRY + 1.7, v: HALL_V, y: GALLERY, yaw: -Math.PI / 2 }],
      ['R3-03', 'فم الهاوية', 'Mouth of the Abyss', window.SinR3Maw
        ? { u: MAW_ENTRY + 0.8, v: MAW_LANE + 0.6, y: MAW_LEVEL, yaw: -Math.PI / 2 }
        : { u: HALL_U, v: -4.2, y: ABYSS_LANDING, yaw: -Math.PI / 2 }]]
      .forEach(([id, ar, en, spawn]) => SinAreas.register({ id, stage: 'r3', group: 'r3', ar, en, spawn }, 'r3-sealed-zone'));
  }
  window.SinR3SealedZone = { mount, resources, release, passageId: SEAL };
})();
