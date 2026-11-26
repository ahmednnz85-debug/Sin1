/* U1 — Irkalla, first stage of the underworld (architectural greybox).
   The Maw lift lands here: U1-01 Anchorage of Souls -> U1-02 Road of the
   Dead -> U1-03 Gate of Irkalla (closed). Primitive masses only; every
   statue, relief, brazier and banner is a marked placeholder for the final
   assets. Layout follows the stage plan: a round anchorage, a road that
   breaks twice (stair, long arched bridge) with two side lookouts for the
   future branch paths, and a walled gate plaza.
   Coordinates: Maw-local (x along the approach, y above the Maw ledge),
   expressed relative to the docked arrival cabin (SinR3Maw.lift). */
(function (root) {
  'use strict';
  const tau = Math.PI * 2;
  // Walkable plan, relative to the arrival cabin centre (y = 0 platform level).
  const DISCS = [
    ['U1-01', 0, 0, 16.0, 0], ['lookout-a', -42, 13, 3.1, 0], ['junction', -42, 0, 6.1, 0],
    ['landing', -42, -26, 4.9, -6], ['lookout-b', -98, -38.5, 3.1, -6], ['midway', -98, -26, 5.8, -6],
    ['U1-03', -139, -26, 18.2, -9]
  ];
  const PATHS = [
    ['causeway', -16.0, 0, -36.2, 0, 5.0, 0, 0],
    ['branch-a', -42, 5.8, -42, 10.3, 2.6, 0, 0],
    ['stair', -42, -5.8, -42, -21.4, 4.8, 0, -6],
    ['bridge', -46.2, -26, -92.3, -26, 5.2, -6, -6],
    ['branch-b', -98, -31.9, -98, -35.4, 2.6, -6, -6],
    ['descent', -103.9, -26, -121.4, -26, 5.2, -6, -9]
  ];
  const DAIS = [[4.86, 0.58], [5.12, 0.38], [5.46, 0.19]];
  // Registered spawns (relative): inside the arrival cabin, the bridge head,
  // the plaza facing the gate. yaw: toward -x.
  const SPAWNS = { 'U1-01': [0, 0.59, 0], 'U1-02': [-49, -6, -26], 'U1-03': [-124, -9, -26] };
  // Braziers (warm) and cold cavern light, [x, y, z, radius, r, g, b].
  const BRAZIERS = [
    ...[30, 90, 150, 210, 270, 330].map(d => [Math.cos(d * Math.PI / 180) * 10.5, 0, Math.sin(d * Math.PI / 180) * 10.5]),
    [-38.5, 0, 4.6], [-38.5, 0, -4.6], [-45.5, -6, -22.6], [-55, -6, -28.9], [-73, -6, -23.1], [-91, -6, -28.9],
    [-101.5, -6, -22.6], [-101.5, -6, -29.4], [-125, -9, -15.5], [-125, -9, -36.5], [-142, -9, -12.5], [-142, -9, -39.5]
  ];
  const COLD = [[0, 9, 0, 13, 0.46, 0.41, 0.34], [0, 20, 0, 34, 0.11, 0.16, 0.24], [-70, 22, -26, 46, 0.07, 0.11, 0.17], [-139, 24, -26, 40, 0.10, 0.14, 0.21]];
  const PALETTE = {
    floor: 0x6a655f, masonry: 0x58534e, trim: 0x7d776f, rock: 0x3f434b,
    placeholder: 0xa08a68, door: 0x5a4532
  };

  function create({ T, group, lift, hit }) {
    const A = { x: lift.center[0], y: lift.drop, z: lift.center[1] };
    const L = (x, y, z) => [A.x + x, A.y + y, A.z + z];
    const world = new T.Group();
    world.name = 'U1_Irkalla_Greybox';
    group.add(world);
    const status = { phase: 'building', placeholders: {}, lights: 0 };
    const mark = kind => { status.placeholders[kind] = (status.placeholders[kind] || 0) + 1; };

    // ---- shading: local braziers, cold cavern light, graded blue fog ------
    const transform = { value: new T.Matrix4() };
    const lights = [];
    for (const [x, y, z] of BRAZIERS) lights.push([x, y + 1.9, z, 10.5, 0.95, 0.52, 0.22]);
    lights.push(...COLD);
    status.lights = lights.length;
    const spots = { value: lights.map(l => new T.Vector4(...L(l[0], l[1], l[2]), l[3])) };
    const tints = { value: lights.map(l => new T.Vector3(l[4], l[5], l[6])) };
    const n = lights.length;
    function finish(material, kind = 'stone') {
      material.fog = false;
      material.customProgramCacheKey = () => 'u1-' + kind + '-' + n;
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, { uW2L: transform, uSpots: spots, uTints: tints });
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform mat4 uW2L; varying vec3 vU;')
          .replace('#include <project_vertex>', `#include <project_vertex>
            vec4 uP = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
            uP = instanceMatrix * uP;
            #endif
            vU = (uW2L * modelMatrix * uP).xyz;`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
            uniform mat4 uW2L; uniform vec4 uSpots[${n}]; uniform vec3 uTints[${n}]; varying vec3 vU;`)
          .replace('#include <opaque_fragment>', `
            vec3 uN = normalize(mat3(uW2L) * inverseTransformDirection(normal, viewMatrix));
            vec3 uLit = vec3(0.0);
            for (int i = 0; i < ${n}; i++) {
              vec3 d = uSpots[i].xyz - vU;
              float dist = length(d);
              if (dist > uSpots[i].w) continue;
              float fall = 1.0 - smoothstep(0.0, uSpots[i].w, dist);
              uLit += uTints[i] * (max(dot(uN, d / max(dist, 0.001)), 0.0) * 0.8 + 0.2) * fall * fall;
            }
            float uH = vU.y - (${A.y.toFixed(2)});
            vec3 uSky = vec3(0.045, 0.062, 0.088) * (0.55 + 0.45 * uN.y);
            vec3 uMist = vec3(0.03, 0.085, 0.12) * (1.0 - smoothstep(-40.0, -2.0, uH)) * (0.6 + 0.4 * max(-uN.y, 0.0));
            outgoingLight = outgoingLight * 0.24 + diffuseColor.rgb * (uLit + uSky + uMist);
            vec3 uEye = (uW2L * vec4(cameraPosition, 1.0)).xyz;
            float uFog = 1.0 - exp(-length(vU - uEye) * 0.0105);
            vec3 uFogColor = mix(vec3(0.022, 0.036, 0.058), vec3(0.075, 0.16, 0.215), smoothstep(-2.0, -48.0, uH));
            outgoingLight = mix(outgoingLight, uFogColor, uFog * 0.88);
            #include <opaque_fragment>`);
      };
      return material;
    }

    // ---- geometry batches (one draw per material) --------------------------
    const batches = new Map();
    function add(kind, geometry) {
      const g = geometry.index ? geometry.toNonIndexed() : geometry;
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!batches.has(kind)) batches.set(kind, { position: [], normal: [] });
      const b = batches.get(kind);
      b.position.push(...g.attributes.position.array);
      b.normal.push(...g.attributes.normal.array);
      geometry.dispose();
      if (g !== geometry) g.dispose();
    }
    const at = (geometry, x, y, z, rx = 0, ry = 0, rz = 0) => {
      geometry.rotateX(rx).rotateZ(rz).rotateY(ry);
      return geometry.translate(...L(x, y, z));
    };
    function box(kind, x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0) {
      add(kind, at(new T.BoxGeometry(sx, sy, sz), x, y, z, rx, ry, rz));
    }
    function cyl(kind, x, y, z, top, bottom, h, seg = 32, open = false) {
      add(kind, at(new T.CylinderGeometry(top, bottom, h, seg, 1, open), x, y, z));
    }
    function ringTop(kind, x, y, z, r0, r1, seg = 64) {
      add(kind, at(new T.RingGeometry(r0, r1, seg, 1), x, y, z, -Math.PI / 2));
    }
    const solid = (x0, x1, y0, y1, z0, z1) => {
      const [a, b, c] = L(x0, y0, z0), [d, e, f] = L(x1, y1, z1);
      hit(Math.min(a, d), Math.max(a, d), Math.min(b, e), Math.max(b, e), Math.min(c, f), Math.max(c, f));
    };
    // Low parapet around a round platform, open toward the given headings.
    function parapet(x, y, z, r, gaps, height = 1.0) {
      const segments = Math.max(12, Math.round(r * 2.2));
      for (let i = 0; i < segments; i++) {
        const a = (i + 0.5) * tau / segments;
        if (gaps.some(([h, w]) => Math.abs(Math.atan2(Math.sin(a - h), Math.cos(a - h))) < w)) continue;
        const len = 2 * r * Math.sin(Math.PI / segments) + 0.05;
        box('trim', x + Math.cos(a) * r, y + height / 2, z + Math.sin(a) * r, 0.55, height, len, -a);
        if (i % 2 === 0) box('masonry', x + Math.cos(a) * r, y + height + 0.12, z + Math.sin(a) * r, 0.75, 0.24, 0.75, -a);
      }
    }
    // Straight deck with side parapets (x- or z-aligned).
    function deck(x0, z0, x1, z1, y0, y1, width, thick, rails = true) {
      const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      const len = Math.hypot(x1 - x0, z1 - z0), pitch = Math.atan2(y1 - y0, alongX ? x1 - x0 : z1 - z0);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, cy = (y0 + y1) / 2;
      const tilt = alongX ? [0, 0, pitch] : [-pitch, 0, 0];
      const sx = alongX ? len / Math.cos(pitch) : width, sz = alongX ? width : len / Math.cos(pitch);
      box('floor', cx, cy - thick / 2, cz, sx, thick, sz, 0, tilt[0], tilt[2]);
      if (!rails) return;
      for (const side of [-1, 1]) {
        const ox = alongX ? 0 : side * (width / 2 - 0.27), oz = alongX ? side * (width / 2 - 0.27) : 0;
        box('trim', cx + ox, cy + 0.5, cz + oz, alongX ? sx : 0.55, 1.0, alongX ? 0.55 : sz, 0, tilt[0], tilt[2]);
      }
    }
    // Flight of steps over a straight ramp (visual treads; the walk is the ramp).
    function steps(x0, z0, x1, z1, y0, y1, width, count) {
      const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count, y = y0 + (y1 - y0) * t;
        const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
        const run = Math.hypot(x1 - x0, z1 - z0) / count + 0.02;
        box('floor', x, y - 0.55, z, alongX ? run : width - 1.1, 1.1, alongX ? width - 1.1 : run);
      }
      const len = Math.hypot(x1 - x0, z1 - z0), pitch = Math.atan2(y1 - y0, alongX ? x1 - x0 : z1 - z0);
      for (const side of [-1, 1]) {
        const ox = alongX ? 0 : side * (width / 2 - 0.27), oz = alongX ? side * (width / 2 - 0.27) : 0;
        box('trim', (x0 + x1) / 2 + ox, (y0 + y1) / 2 + 0.35, (z0 + z1) / 2 + oz, alongX ? len / Math.cos(pitch) : 0.55, 1.5,
          alongX ? 0.55 : len / Math.cos(pitch), 0, alongX ? 0 : -pitch, alongX ? pitch : 0);
      }
    }
    // Arched spandrel panel (opening below), extruded across the run.
    // x-aligned by default; alongZ turns it to face +x with its back at c-depth.
    function arcade(kind, x0, x1, top, height, z, depth, alongZ = false) {
      const w = x1 - x0, r = Math.min(w * 0.36, height * 0.7);
      const shape = new T.Shape();
      shape.moveTo(0, 0); shape.lineTo(w, 0); shape.lineTo(w, height); shape.lineTo(0, height); shape.lineTo(0, 0);
      const hole = new T.Path();
      const spring = height - r - 0.9;
      hole.moveTo(w / 2 - r, 0); hole.lineTo(w / 2 + r, 0); hole.lineTo(w / 2 + r, spring);
      hole.absarc(w / 2, spring, r, 0, Math.PI, false); hole.lineTo(w / 2 - r, 0);
      shape.holes.push(hole);
      const g = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });
      if (alongZ) g.rotateY(-Math.PI / 2).translate(z, top - height, x0);
      else g.translate(x0, top - height, z - depth / 2);
      add(kind, g.translate(A.x, A.y, A.z));
    }
    function brazier(x, y, z) {
      cyl('trim', x, y + 0.45, z, 0.32, 0.42, 0.9, 10);
      cyl('masonry', x, y + 1.05, z, 0.62, 0.3, 0.32, 12);
      add('flame', at(new T.ConeGeometry(0.34, 0.75, 8), x, y + 1.55, z));
      solid(x - 0.5, x + 0.5, y, y + 1.4, z - 0.5, z + 0.5);
      mark('brazier');
    }
    // Statue / guardian placeholder: plinth plus a tall marked block.
    function statue(x, y, z, yaw, w = 1.3, h = 3.4, d = 1.0, plinth = 1.1) {
      box('masonry', x, y + plinth / 2, z, w + 0.8, plinth, d + 1.0, yaw);
      box('placeholder', x, y + plinth + h / 2, z, w, h, d, yaw);
      const e = Math.max(w + 0.8, d + 1.0) / 2;
      solid(x - e, x + e, y, y + plinth + h, z - e, z + e);
      mark('statue');
    }

    // ---- U1-01 Anchorage of Souls -----------------------------------------
    cyl('floor', 0, -1.5, 0, 17, 17, 3, 72);
    cyl('rock', 0, -16, 0, 15.5, 5, 26, 18);
    // Dais around the docked cabin (same steps as the Maw deck) with its well.
    for (const [r, y] of DAIS) {
      ringTop('trim', 0, y, 0, r === 4.86 ? 2.42 : r - 0.27, r, 64);
      cyl('trim', 0, y / 2, 0, r, r, y, 64, true);
    }
    cyl('masonry', 0, 0.13, 0, 2.42, 2.42, 0.9, 40, true);
    ringTop('trim', 0, 0.012, 0, 8.6, 9.0, 72);
    ringTop('trim', 0, 0.012, 0, 12.2, 12.5, 72);
    // Colonnade: ten piers on the ring, the western bay left open for the road.
    for (let i = 0; i < 10; i++) {
      const a = i * tau / 10;
      if (Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))) < 0.1) continue;
      const x = Math.cos(a) * 14.2, z = Math.sin(a) * 14.2;
      box('masonry', x, 0.5, z, 2.4, 1.0, 2.4, -a);
      cyl('masonry', x, 6.4, z, 0.8, 0.92, 10.8, 16);
      box('masonry', x, 12.2, z, 2.4, 0.8, 2.4, -a);
      solid(x - 1.25, x + 1.25, 0, 12.6, z - 1.25, z + 1.25);
      mark('column');
    }
    for (let i = 0; i < 30; i++) {
      const a = (i + 0.5) * tau / 30;
      box('masonry', Math.cos(a) * 14.2, 13.2, Math.sin(a) * 14.2, 1.8, 1.2, 2 * 14.2 * Math.sin(Math.PI / 30) + 0.06, -a);
    }
    // Vault: a coffered ring under the shaft the chains rise into.
    const ceiling = lift.arrivalVault;
    add('masonry', (() => {
      const shape = new T.Shape().absarc(0, 0, 18.5, 0, tau, false);
      shape.holes.push(new T.Path().absarc(0, 0, 3.7, 0, tau, true));
      const g = new T.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: false, curveSegments: 48 });
      g.rotateX(-Math.PI / 2);
      return g.translate(...L(0, ceiling + 0.05, 0));
    })());
    cyl('masonry', 0, ceiling + 6, 0, 3.7, 3.7, 12, 40, true);
    for (let i = 0; i < 12; i++) {
      const a = i * tau / 12;
      box('trim', Math.cos(a) * 9, ceiling - 0.25, Math.sin(a) * 9, 11, 0.5, 0.7, -a);
    }
    parapet(0, 0, 0, 16.6, [[Math.PI, 0.2]]);
    // Guardians flanking the exit and the cabin's back; relief bays between piers.
    statue(-11.8, 0, 5.6, 0); statue(-11.8, 0, -5.6, 0);
    statue(11.2, 0, 7.2, 0.5); statue(11.2, 0, -7.2, -0.5);
    for (const d of [60, 120, 240, 300]) {
      const a = d * Math.PI / 180;
      box('placeholder', Math.cos(a) * 17.6, 6.5, Math.sin(a) * 17.6, 0.3, 6, 5.5, -a);
      box('masonry', Math.cos(a) * 18.0, 6.5, Math.sin(a) * 18.0, 0.6, 13, 7.5, -a);
      mark('relief');
    }

    // ---- U1-02 Road of the Dead ---------------------------------------------
    deck(-16.0, 0, -36.2, 0, 0, 0, 6.2, 1.6);
    cyl('rock', -26, -14, 0, 3.2, 1.6, 26, 10);
    cyl('floor', -42, -1, 0, 7, 7, 2, 40);
    cyl('rock', -42, -26, 0, 6.2, 2.4, 48, 14);
    parapet(-42, 0, 0, 6.65, [[0, 0.5], [Math.PI / 2, 0.3], [-Math.PI / 2, 0.45]]);
    statue(-46.6, 0, 0, Math.PI / 2, 1.6, 4.2, 1.2);
    // Branch A lookout (future side path).
    deck(-42, 5.8, -42, 10.3, 0, 0, 3.4, 1.2);
    cyl('floor', -42, -0.6, 13, 3.7, 3.7, 1.2, 24);
    parapet(-42, 0, 13, 3.6, [[-Math.PI / 2, 0.5]]);
    box('placeholder', -42, 1.5, 15.6, 1.2, 3.0, 0.6); mark('marker');
    // The descending stair, then the landing that turns onto the bridge.
    steps(-42, -5.8, -42, -21.4, 0, -6, 5.6, 30);
    cyl('rock', -42, -16, -13.5, 3.6, 2.0, 22, 10);
    cyl('floor', -42, -7, -26, 5.6, 5.6, 2, 32);
    cyl('rock', -42, -32, -26, 5.0, 2.2, 50, 12);
    parapet(-42, -6, -26, 5.35, [[Math.PI / 2, 0.6], [Math.PI, 0.65]]);
    // Long arched bridge over the void.
    deck(-46.2, -26, -92.3, -26, -6, -6, 6.4, 1.4);
    for (let x = -48.5; x > -92; x -= 9) {
      box('masonry', x, -32, -26, 2.6, 50, 6.6);
      if (x - 9 > -93) arcade('masonry', x - 9 + 1.3, x - 1.3, -7.4, 7.5, -26, 6.4);
    }
    for (const x of [-64, -82]) {
      for (const side of [-1, 1]) {
        box('placeholder', x, -3.4, -26 + side * 3.45, 1.6, 4.4, 0.15); mark('banner');
      }
    }
    // Midway lookout with branch B.
    cyl('floor', -98, -7, -26, 6.5, 6.5, 2, 40);
    cyl('rock', -98, -34, -26, 6, 2.2, 54, 14);
    parapet(-98, -6, -26, 6.25, [[0, 0.5], [Math.PI, 0.5], [-Math.PI / 2, 0.3]]);
    deck(-98, -31.9, -98, -35.4, -6, -6, 3.4, 1.2);
    cyl('floor', -98, -6.6, -38.5, 3.7, 3.7, 1.2, 24);
    parapet(-98, -6, -38.5, 3.6, [[Math.PI / 2, 0.5]]);
    box('placeholder', -98, -4.5, -41.1, 1.2, 3.0, 0.6); mark('marker');
    // Final descent to the gate plaza.
    steps(-103.9, -26, -121.4, -26, -6, -9, 6.2, 14);
    box('rock', -112, -20, -26, 16, 24, 5);

    // ---- U1-03 Gate of Irkalla (closed) -------------------------------------
    cyl('floor', -139, -10.5, -26, 19, 19, 3, 72);
    cyl('rock', -139, -38, -26, 17, 6, 52, 18);
    parapet(-139, -9, -26, 18.7, [[0, 0.18], [Math.PI, 0.62]]);
    ringTop('trim', -139, -8.988, -26, 7.6, 8.0, 64);
    const gx = -155;
    // Gate wall, doorway frame, closed leaves, flanking towers and crown.
    box('masonry', gx - 3, 2, -26 - 9.25, 6, 22, 9.5);
    box('masonry', gx - 3, 2, -26 + 9.25, 6, 22, 9.5);
    box('masonry', gx - 3, 8.75, -26, 6, 8.5, 9.0);
    box('door', gx - 0.9, -1.7, -26, 0.8, 14.6, 9.0); mark('door');
    box('trim', gx - 0.4, -2.2, -26, 0.12, 13.4, 0.22);
    arcade('trim', -26 - 6.2, -26 + 6.2, 6.5, 16, gx + 1.2, 1.2, true);
    for (const side of [-1, 1]) {
      box('masonry', gx - 4.5, 6, -26 + side * 18.5, 11, 30, 9);
      for (let k = -1; k <= 1; k++) box('masonry', gx - 4.5 + k * 3.6, 22.4, -26 + side * 18.5, 1.6, 2.8, 9);
      statue(gx + 7.5, -9, -26 + side * 8.2, Math.PI / 2, 2.4, 5.5, 4.6, 1.6);
    }
    for (let k = -3; k <= 3; k++) box('masonry', gx - 3, 13.9, -26 + k * 2.7, 6, 1.8, 1.5);
    solid(gx - 16, gx + 1.3, -9, 40, -26 - 24, -26 + 24);
    // Canyon walls closing the plaza and the gate.
    box('rock', -186, 0, -26, 50, 130, 120);
    box('rock', -138, 0, -72, 120, 120, 34, 0.18);
    box('rock', -128, 0, 26, 110, 120, 30, -0.22);

    for (const [x, y, z] of BRAZIERS) brazier(x, y, z);

    // ---- cavern: mist sea, far shell, falls ---------------------------------
    const shell = new T.SphereGeometry(330, 32, 16);
    shell.scale(1, 0.55, 1);
    add('cavern', at(shell, -70, 20, -26));
    const mist = new T.PlaneGeometry(900, 900, 1, 1);
    add('mist', at(mist, -70, -46, -26, -Math.PI / 2));
    for (const [x, z, w] of [[-64, 58, 4], [-150, -96, 6], [-20, -70, 3]]) {
      box('falls', x, -10, z, w, 110, 0.6, 0.3); mark('waterfall');
    }

    const colours = { ...PALETTE, flame: 0xffa24a, cavern: 0x2c323c, mist: 0x5f7f92, falls: 0x93acbc };
    for (const [kind, data] of batches) {
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(data.position, 3));
      geometry.setAttribute('normal', new T.Float32BufferAttribute(data.normal, 3));
      geometry.computeBoundingSphere();
      const material = kind === 'flame'
        ? new T.MeshBasicMaterial({ color: colours.flame, fog: false })
        : finish(new T.MeshStandardMaterial({ color: colours[kind], roughness: 0.94, metalness: 0,
          side: kind === 'cavern' ? T.BackSide : T.FrontSide }), kind === 'cavern' ? 'shell' : 'stone');
      const mesh = new T.Mesh(geometry, material);
      mesh.name = 'U1_' + kind;
      world.add(mesh);
    }
    status.phase = 'ready';
    status.batches = batches.size;
    batches.clear();

    function floor(x, z) {
      const rx = x - A.x, rz = z - A.z;
      const r = Math.hypot(rx, rz);
      for (const [radius, y] of DAIS) if (r <= radius) return A.y + y;
      for (const [, cx, cz, radius, y] of DISCS) if (Math.hypot(rx - cx, rz - cz) <= radius) return A.y + y;
      for (const [, ax, az, bx, bz, w, ya, yb] of PATHS) {
        const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
        // Ends overlap their platforms slightly (no seam at the joint).
        const t = Math.min(1, Math.max(0, ((rx - ax) * dx + (rz - az) * dz) / len2));
        if (((rx - ax) * dx + (rz - az) * dz) / len2 < -0.03 || ((rx - ax) * dx + (rz - az) * dz) / len2 > 1.03) continue;
        if (Math.hypot(rx - ax - dx * t, rz - az - dz * t) <= w / 2) return A.y + ya + (yb - ya) * t;
      }
      return null;
    }

    return {
      group: world, status, floor, finish,
      spawns: Object.fromEntries(Object.entries(SPAWNS).map(([id, [x, y, z]]) => [id, L(x, y, z)])),
      update(visible) {
        world.visible = visible;
        if (!visible) return;
        world.updateWorldMatrix(true, false);
        transform.value.copy(world.matrixWorld).invert();
      }
    };
  }

  root.SinR3Underworld = { create, plan: { discs: DISCS, paths: PATHS, spawns: SPAWNS } };
})(window);
