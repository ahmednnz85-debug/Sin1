/* U1 — Irkalla. The Anchorage is dressed over the approved walkable plan;
   the road, its lookouts and the gate retain their existing layout. Local
   coordinates are relative to the docked arrival cabin in the Maw frame. */
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
  const LAMPS = Array.from({ length: 6 }, (_, i) => {
    const angle = (i + 0.5) * tau / 6;
    return [Math.cos(angle) * 11.8, 0, Math.sin(angle) * 11.8, -angle];
  });
  const BRAZIERS = [
    [-38.5, 0, 4.6], [-38.5, 0, -4.6], [-45.5, -6, -22.6], [-55, -6, -28.9], [-73, -6, -23.1], [-91, -6, -28.9],
    [-101.5, -6, -22.6], [-101.5, -6, -29.4], [-125, -9, -15.5], [-125, -9, -36.5], [-142, -9, -12.5], [-142, -9, -39.5]
  ];
  const COLD = [[-70, 22, -26, 46, 0.07, 0.11, 0.17], [-139, 24, -26, 40, 0.10, 0.14, 0.21]];
  const PALETTE = {
    floor: 0x6a655f, masonry: 0x58534e, trim: 0x7d776f, rock: 0x3f434b,
    placeholder: 0xa08a68, door: 0x5a4532
  };

  function create({ T, group, lift, hit }) {
    const A = { x: lift.center[0], y: lift.drop, z: lift.center[1] };
    const L = (x, y, z) => [A.x + x, A.y + y, A.z + z];
    const world = new T.Group();
    world.name = 'U1_Irkalla';
    group.add(world);
    const status = { phase: 'idle', placeholders: {}, lights: 0 };
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
        if (kind === 'lamp') shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
          #include <emissivemap_fragment>
          totalEmissiveRadiance *= smoothstep(1.67, 1.96, vU.y - (${A.y.toFixed(2)}));
        `);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
            uniform mat4 uW2L; uniform vec4 uSpots[${n}]; uniform vec3 uTints[${n}]; varying vec3 vU;
            float harborHash(vec3 p) {
              p=fract(p*0.1031);
              p+=dot(p,p.zyx+31.32);
              return fract((p.x+p.y)*p.z);
            }
            float harborNoise(vec3 p) {
              vec3 i=floor(p), f=fract(p);
              f=f*f*(3.0-2.0*f);
              return mix(mix(mix(harborHash(i),harborHash(i+vec3(1,0,0)),f.x),
                             mix(harborHash(i+vec3(0,1,0)),harborHash(i+vec3(1,1,0)),f.x),f.y),
                         mix(mix(harborHash(i+vec3(0,0,1)),harborHash(i+vec3(1,0,1)),f.x),
                             mix(harborHash(i+vec3(0,1,1)),harborHash(i+vec3(1,1,1)),f.x),f.y),f.z);
            }`)
          .replace('#include <opaque_fragment>', `
            vec3 uN = normalize(mat3(uW2L) * inverseTransformDirection(normal, viewMatrix));
            vec3 uEye = (uW2L * vec4(cameraPosition, 1.0)).xyz;
            vec3 uLocal = vU - vec3(${A.x.toFixed(2)}, ${A.y.toFixed(2)}, ${A.z.toFixed(2)});
            float uH = uLocal.y;
            float uRadius = length(uLocal.xz);
            vec3 uLit = vec3(0.0);
            if (uLocal.x < -20.0) {
              for (int i = 0; i < ${n}; i++) {
                vec3 d = uSpots[i].xyz - vU;
                float dist = length(d);
                if (dist > uSpots[i].w) continue;
                float fall = 1.0 - smoothstep(0.0, uSpots[i].w, dist);
                uLit += uTints[i] * (max(dot(uN, d / max(dist, 0.001)), 0.0) * 0.8 + 0.2) * fall * fall;
              }
            }
            float lampIndex = floor(atan(uLocal.z, uLocal.x) / 1.04719755);
            float lampAngle = (lampIndex + 0.5) * 1.04719755;
            vec3 lamp = vec3(11.8 * cos(lampAngle), 1.95, 11.8 * sin(lampAngle));
            vec3 toLamp = lamp - uLocal;
            float lampDist = length(toLamp);
            float lampGlow = 1.0 - smoothstep(0.0, 6.0, lampDist);
            float facingLamp = max(dot(uN, toLamp / max(lampDist, 0.01)), 0.0);
            uLit += vec3(0.095, 0.70, 0.75) * lampGlow * lampGlow * (0.2 + 0.8 * facingLamp);
            vec2 aperture = uLocal.xz - vec2((14.6 - uH) * 0.27, (14.6 - uH) * 0.09);
            float shaft = exp(-dot(aperture, aperture) * 0.022);
            vec3 key = vec3(0.60, 0.49, 0.38) * shaft * (0.38 + 0.62 * max(uN.y, 0.0));
            float trimLight = max(0.0, dot(uN, normalize(vec3(-0.7, 0.36, 0.58))));
            vec3 uSky = vec3(0.21, 0.25, 0.28) * (0.45 + 0.43 * uN.y + 0.63 * trimLight);
            vec3 bounce = vec3(0.20, 0.12, 0.050) * (1.0 - smoothstep(0.0, 19.0, uRadius));
            outgoingLight = outgoingLight * 0.54 + diffuseColor.rgb * (uLit + uSky + key + bounce);
            ${kind === 'paving' ? `
              vec3 reflectRay = reflect(-normalize(uEye-vU), uN);
              float wash = pow(max(dot(reflectRay, normalize(vec3(-0.2, 0.9, 0.37))), 0.0), 10.0);
              outgoingLight += wash * shaft * vec3(0.16, 0.14, 0.115)
                + vec3(0.027, 0.20, 0.22) * facingLamp * lampGlow * lampGlow * (1.0 - roughnessFactor);
            ` : ''}
            ${kind === 'lamp' ? `
              float orb = smoothstep(1.67, 1.91, uH);
              float facets = dot(diffuseColor.rgb, vec3(0.30, 0.40, 0.30));
              outgoingLight = mix(outgoingLight, vec3(0.015, 0.75, 0.62) * (0.62 + facets * 0.55), orb * 0.78);
            ` : ''}
            float travel = length(vU-uEye);
            float groundMist = exp(-max(uH + 13.0, 0.0) * 0.057);
            vec3 fog = mix(vec3(0.013, 0.031, 0.046), vec3(0.034, 0.136, 0.164), groundMist);
            float fade = 1.0 - exp(-travel * mix(0.0045, 0.0105, groundMist));
            ${kind === 'distant' ? `
              float rim = 0.34 + 0.82 * smoothstep(-0.58, 0.85, uN.y + 0.30 * trimLight);
              float hollow = harborNoise(uLocal * vec3(0.11, 0.09, 0.10));
              float stratum = harborNoise(uLocal * vec3(0.44, 0.07, 0.39));
              float detail = (0.48 + 0.66 * stratum) * (0.61 + 0.55 * hollow);
              outgoingLight = diffuseColor.rgb * vec3(0.18, 0.25, 0.29) * rim * detail;
              float cloud = harborNoise(uLocal * vec3(0.048, 0.21, 0.048));
              float beneath = 1.0-smoothstep(-30.0,-6.0,uH);
              fade = clamp(fade*0.59+smoothstep(0.32,0.84,cloud)*beneath*0.42,0.0,0.96);
              fog *= (0.83 + 0.42 * cloud) * (0.44 + 0.56 * groundMist);
            ` : ''}
            ${kind === 'shell' ? `
              vec3 direction = normalize(vU-uEye);
              float cloud = harborNoise(direction * 7.0 + vec3(2.9,1.0,6.1));
              float fringe = harborNoise(direction * 19.0 + vec3(9.3,17.0,12.1));
              float horizon = exp(-max(direction.y+0.19,0.0)*3.1);
              float strata = smoothstep(0.22,0.84,cloud*0.78+fringe*0.22);
              outgoingLight = vec3(0.005,0.019,0.030) +
                vec3(0.021,0.126,0.165)*horizon*(0.13+0.96*strata);
              float shaftCap = pow(max(0.0, dot(direction, normalize(vec3(0.4,0.75,-0.28)))), 18.0);
              outgoingLight += vec3(0.040,0.19,0.24)*shaftCap;
              fade = 0.0;
            ` : ''}
            outgoingLight = mix(outgoingLight, fog, fade * 0.89);
            #include <opaque_fragment>`);
      };
      return material;
    }

    // ---- geometry batches (one draw per material) --------------------------
    const batches = new Map();
    function add(kind, geometry, unwrap = false) {
      const g = geometry.index ? geometry.toNonIndexed() : geometry;
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!batches.has(kind)) batches.set(kind, { position: [], normal: [], uv: [] });
      const b = batches.get(kind);
      b.position.push(...g.attributes.position.array);
      b.normal.push(...g.attributes.normal.array);
      const { position, normal, uv } = g.attributes;
      for (let i = 0; i < position.count; i++) {
        if (unwrap) b.uv.push(uv.getX(i), uv.getY(i));
        else {
          const x = position.getX(i) - A.x, y = position.getY(i) - A.y, z = position.getZ(i) - A.z;
          const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i)), nz = Math.abs(normal.getZ(i));
          const tileSize = kind === 'paving' ? 4.6 : 3.4;
          b.uv.push((nx > Math.max(ny, nz) ? z : x) / tileSize, (ny > Math.max(nx, nz) ? z : y) / tileSize);
        }
      }
      geometry.dispose();
      if (g !== geometry) g.dispose();
    }
    const at = (geometry, x, y, z, rx = 0, ry = 0, rz = 0) => {
      geometry.rotateX(rx).rotateZ(rz).rotateY(ry);
      return geometry.translate(...L(x, y, z));
    };
    function box(kind, x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0, unwrap = false) {
      add(kind, at(new T.BoxGeometry(sx, sy, sz), x, y, z, rx, ry, rz), unwrap);
    }
    function cyl(kind, x, y, z, top, bottom, h, seg = 32, open = false, repeat = 0) {
      const g = new T.CylinderGeometry(top, bottom, h, seg, 1, open);
      if (repeat) {
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * repeat);
      }
      add(kind, at(g, x, y, z), repeat > 0);
    }
    function ringTop(kind, x, y, z, r0, r1, seg = 64) {
      add(kind, at(new T.RingGeometry(r0, r1, seg, 1), x, y, z, -Math.PI / 2));
    }
    function inlay(kind, r0, r1, y, repeat = 1) {
      const points = [], uv = [], index = [];
      for (let i = 0; i <= 144; i++) {
        const t = i / 144, a = t * tau;
        for (const [r, v] of [[r0, 0], [r1, 1]]) {
          points.push(...L(Math.cos(a) * r, y, Math.sin(a) * r));
          uv.push(t * repeat, v);
        }
        if (i) { const k = i * 2; index.push(k - 2, k, k - 1, k - 1, k, k + 1); }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(points, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      g.setIndex(index);
      add(kind, g, true);
    }
    const solid = (x0, x1, y0, y1, z0, z1, player = true) => {
      const [a, b, c] = L(x0, y0, z0), [d, e, f] = L(x1, y1, z1);
      hit(Math.min(a, d), Math.max(a, d), Math.min(b, e), Math.max(b, e), Math.min(c, f), Math.max(c, f), player);
    };
    // Low parapet, open at the road. The Anchorage retains its radius and
    // height with open balusters between the sill and the handrail.
    function parapet(x, y, z, r, gaps, height = 1.0, harbor = false) {
      const segments = Math.max(12, Math.round(r * 2.2));
      for (let i = 0; i < segments; i++) {
        const a = (i + 0.5) * tau / segments;
        if (gaps.some(([h, w]) => Math.abs(Math.atan2(Math.sin(a - h), Math.cos(a - h))) < w)) continue;
        const len = 2 * r * Math.sin(Math.PI / segments) + 0.05;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (harbor) {
          box('paving', px, y + 0.13, pz, 0.65, 0.26, len, -a);
          box('paving', px, y + height - 0.12, pz, 0.6, 0.24, len, -a);
          for (const shift of [-0.33, 0, 0.33]) {
            const t = a + shift * tau / segments;
            cyl('paving', x + Math.cos(t) * r, y + 0.50, z + Math.sin(t) * r, 0.19, 0.23, 0.66, 7);
          }
          const dx = 0.26 + Math.abs(Math.sin(a)) * len * 0.48;
          const dz = 0.26 + Math.abs(Math.cos(a)) * len * 0.48;
          solid(px - dx, px + dx, y, y + height, pz - dz, pz + dz, false);
        } else box('trim', px, y + height / 2, pz, 0.55, height, len, -a);
        if (i % 2 === 0) box(harbor ? 'paving' : 'masonry', px, y + height + 0.12, pz, 0.75, 0.24, 0.75, -a);
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
    cyl('paving', 0, -1.5, 0, 17, 17, 3, 72);
    cyl('rock', 0, -16, 0, 15.5, 5, 26, 18);
    const plinths = [];
    // Wrap the carved friezes around the *vertical* face of each step.
    // A single motif spans 24–30 cm, in proportion to the 19–20 cm riser.
    DAIS.forEach(([r, y], i) => {
      const lower = DAIS[i + 1]?.[1] ?? 0;
      const frieze = i === 1 ? 'daisBorder' : 'daisGold';
      const repeats = Math.round(tau * r / (i === 1 ? 1.38 : 1.31));
      ringTop('paving', 0, y, 0, i === 0 ? 2.42 : r - 0.27, r, 120);
      inlay('daisBorder', r - 0.105, r - 0.036, y + 0.005, 18);
      cyl(frieze, 0, (y + lower) / 2, 0, r, r, y - lower, 120, true, repeats);
      cyl('daisLip', 0, y - 0.012, 0, r + 0.014, r + 0.014, 0.024, 120, true);
    });
    cyl('paving', 0, 0.13, 0, 2.42, 2.42, 0.9, 48, true);
    inlay('floorInlay', 11.63, 13.14, 0.009, 2);

    // Keep each stone column under its existing roof bearing.
    for (let i = 0; i < 10; i++) {
      const a = i * tau / 10;
      if (i === 5) continue;
      const x = Math.cos(a) * 14.2, z = Math.sin(a) * 14.2;
      plinths.push([x, 0, z, Math.PI - a]);
      const shaft = 0.98 * (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)));
      solid(x - shaft, x + shaft, 0, 12.59, z - shaft, z + shaft);
      solid(x - 1.22, x + 1.22, 0, 1.25, z - 1.22, z + 1.22);
    }
    for (const [x, y, z] of LAMPS) solid(x - 0.53, x + 0.53, y, y + 1.62, z - 0.53, z + 0.53);
    for (let i = 0; i < 30; i++) {
      const a = (i + 0.5) * tau / 30;
      box('roofStone', Math.cos(a) * 14.2, 13.2, Math.sin(a) * 14.2, 1.8, 1.2, 2 * 14.2 * Math.sin(Math.PI / 30) + 0.06, -a);
    }
    cyl('roofBand', 0, 13.2, 0, 13.235, 13.235, 1.20, 120, true, 6);
    // Finish the vault, original ribs and shaft without moving them.
    const ceiling = lift.arrivalVault;
    const shape = new T.Shape().absarc(0, 0, 18.5, 0, tau, false);
    shape.holes.push(new T.Path().absarc(0, 0, 3.7, 0, tau, true));
    const vault = new T.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: false, curveSegments: 48 });
    add('roofStone', vault.rotateX(-Math.PI / 2).translate(...L(0, ceiling + 0.05, 0)));
    cyl('roofStone', 0, ceiling + 6, 0, 3.7, 3.7, 12, 64, true);
    cyl('roofOculus', 0, ceiling + 0.35, 0, 3.68, 3.68, 0.56, 96, true, 3);
    const collar = new T.RingGeometry(3.66, 4.24, 96).rotateX(Math.PI / 2).translate(...L(0, ceiling + 0.03, 0));
    add('roofBand', collar);
    for (let i = 0; i < 12; i++) {
      const a = i * tau / 12;
      box('roofRib', Math.cos(a) * 9, ceiling - 0.25, Math.sin(a) * 9, 11, 0.5, 0.7, -a, 0, 0, true);
    }
    parapet(0, 0, 0, 16.6, [[Math.PI, 0.2]], 1.0, true);

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

    // ---- cavern and shared U1 materials -----------------------------------
    // Three ruined precincts rise above their retaining cliffs.
    for (const [x, z, y, width, height, a] of [
      [19, 37.5, -4.4, 11.0, 18.6, -0.22], [49, 30, -5.3, 13.0, 14.4, -0.6],
      [73, -29, -3.5, 12.5, 22.8, 0.28]
    ]) {
      box('citadel', x, y - 4.3, z, width * 1.26, 8.8, width * 1.48, a);
      for (let k = 0; k < 6; k++) {
        const w = width * (1 - k * 0.122), h = height / 6;
        const dx = x + Math.cos(a) * k * 0.53, dz = z - Math.sin(a) * k * 0.49;
        const level = y + h * k;
        box('citadel', dx, level + h * 0.41, dz, w, h * 0.84, w * 1.22, a);
        for (let p = -2; p <= 2; p++) {
          if ((k + p * 2 + 6) % 5 === 0) continue;
          const t = w * p * 0.20;
          const px = dx - Math.cos(a) * w * 0.51 + Math.sin(a) * t;
          const pz = dz + Math.sin(a) * w * 0.51 + Math.cos(a) * t;
          box('citadel', px, level + h * 0.52, pz, 0.88, h * 1.04, w * 0.09, a);
        }
      }
    }
    const shell = new T.SphereGeometry(330, 32, 16).scale(1, 0.55, 1);
    add('cavern', at(shell, -70, 20, -26));
    const materials = new Map();
    const surfaces = {
      paving: [0xd2cdc5, 0.76, 'paving'], daisGold: [0xffe2aa, 0.64, 'dais-gold'],
      daisBorder: [0xeccb9e, 0.66, 'dais-border'], floorInlay: [0xf3e2ca, 0.62, 'floor-inlay'],
      roofStone: [0xb8bec8, 0.88, 'roof-stone'], roofBand: [0xd5be9b, 0.82, 'roof-band'],
      roofRib: [0xe5c494, 0.76, 'roof-rib'], roofOculus: [0xd7c8b4, 0.78, 'roof-oculus']
    };
    const colours = { ...PALETTE, flame: 0xffa24a, cavern: 0x2c323c, citadel: 0x818886, daisLip: 0x77624a };
    for (const [kind, data] of batches) {
      const geometry = new T.BufferGeometry();
      const count = data.position.length / 3;
      const packed = new Float32Array(count * 8);
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < 3; k++) {
          packed[i * 8 + k] = data.position[i * 3 + k];
          packed[i * 8 + 3 + k] = data.normal[i * 3 + k];
        }
        packed[i * 8 + 6] = data.uv[i * 2];
        packed[i * 8 + 7] = data.uv[i * 2 + 1];
      }
      const buffer = new T.InterleavedBuffer(packed, 8);
      geometry.setAttribute('position', new T.InterleavedBufferAttribute(buffer, 3, 0));
      geometry.setAttribute('normal', new T.InterleavedBufferAttribute(buffer, 3, 3));
      geometry.setAttribute('uv', new T.InterleavedBufferAttribute(buffer, 2, 6));
      geometry.computeBoundingSphere();
      const [color, roughness] = surfaces[kind] || [colours[kind], 0.94];
      const material = kind === 'flame'
        ? new T.MeshBasicMaterial({ color, fog: false })
        : finish(new T.MeshStandardMaterial({ color, roughness, metalness: 0,
          side: kind === 'cavern' ? T.BackSide : kind.startsWith('roof') ? T.DoubleSide : T.FrontSide }),
        kind === 'cavern' ? 'shell' : kind === 'paving' ? 'paving' : kind === 'citadel' ? 'distant' : 'stone');
      const mesh = new T.Mesh(geometry, material);
      mesh.name = 'U1_' + kind;
      world.add(mesh);
      materials.set(kind, material);
    }
    const sharedLight = new T.HemisphereLight(0xb1e4ff, 0x455864, 1.40);
    sharedLight.name = 'U1_Cavern_Fill';
    world.add(sharedLight);
    status.batches = batches.size;
    batches.clear();

    let pending;
    async function loadHarbor(renderer) {
      const textureLoader = new T.TextureLoader();
      const files = 'assets/r3/harbor/';
      const loadMap = async (name, srgb) => {
        const map = await textureLoader.loadAsync(files + name + '.webp');
        if (srgb) map.colorSpace = T.SRGBColorSpace;
        map.wrapS = map.wrapT = T.RepeatWrapping;
        map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        return map;
      };
      // The Maw loader already brings the shared decoder in on normal play.
      if (!root.MeshoptDecoder) await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'vendor/meshopt_decoder.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
      const basis = new KTX2Loader().setTranscoderPath('vendor/basis/').setWorkerLimit(1).detectSupport(renderer);
      const loader = new T.GLTFLoader().setMeshoptDecoder(root.MeshoptDecoder).setKTX2Loader(basis);
      const loadingMaps = Object.entries(surfaces).map(async ([key, [, , file]]) => {
        const material = materials.get(key);
        material.map = await loadMap(file, true);
        if (key === 'paving') {
          const retainingWalls = materials.get('citadel');
          retainingWalls.map = material.map;
          retainingWalls.needsUpdate = true;
        }
        material.needsUpdate = true;
      });
      for (const [key, file] of [['daisGold', 'dais-gold'], ['daisBorder', 'dais-border']]) {
        loadingMaps.push(loadMap(file + '-normal').then(normal => {
          const frieze = materials.get(key);
          frieze.normalMap = normal;
          frieze.normalScale.setScalar(0.82);
          frieze.needsUpdate = true;
        }));
      }
      loadingMaps.push(Promise.all([loadMap('paving-normal'), loadMap('paving-rough')]).then(([normal, rough]) => {
        const paving = materials.get('paving');
        paving.normalMap = normal;
        paving.normalScale.setScalar(0.57);
        paving.roughnessMap = rough;
        paving.needsUpdate = true;
      }));
      let kit, ruins;
      try {
        [kit, ruins] = await Promise.all([loader.loadAsync(files + 'architecture.glb'), loader.loadAsync(files + 'distant-ruins.glb'),
          ...loadingMaps]);
      } finally {
        basis.dispose();
      }
      const stamp = new T.Object3D();
      function instance(name, geometry, material, positions, sourceTransform = null) {
        const mesh = new T.InstancedMesh(geometry, material, positions.length);
        mesh.name = name;
        positions.forEach(([position, scale, angle], i) => {
          stamp.position.fromArray(position);
          stamp.scale.fromArray(scale);
          stamp.rotation.y = angle;
          stamp.updateMatrix();
          if (sourceTransform) stamp.matrix.multiply(sourceTransform);
          mesh.setMatrixAt(i, stamp.matrix);
        });
        mesh.computeBoundingSphere();
        world.add(mesh);
        return mesh;
      }
      const column = kit.scene.getObjectByName('Harbor_Column');
      const lamp = kit.scene.getObjectByName('Harbor_Turquoise_Lamp');
      column.material.metalness *= 0.37;
      column.material.color.setHex(0xbcb5a6);
      const lampMaterial = lamp.material.clone();
      lampMaterial.emissive.setHex(0x15c3a9);
      lampMaterial.emissiveIntensity = 0.52;
      lampMaterial.metalness *= 0.40;
      instance('U1_Carved_Columns', column.geometry, finish(column.material), plinths.map(([x, y, z, a]) => [L(x, y, z), [8.75, 12.62, 8.75], a]));
      instance('U1_Turquoise_Lamps', lamp.geometry, finish(lampMaterial, 'lamp'), LAMPS.map(([x, y, z, a]) => [L(x, y, z), [6.7, 6.7, 6.7], a]));

      // Setbacks put terraces at different heights along the basin; open
      // arcades break the skyline and span the gaps between rock promontories.
      const sites = {
        Abyss_Cliff_Ruins: [
          [19, -19, 36, 1.68, 1.83, 1.85, -0.52], [49, -22, 30, 1.52, 1.51, 1.56, -0.48],
          [53, -25, 3, 1.4, 1.65, 1.5, -1.2], [42, -24, -41, 1.5, 1.8, 1.5, -1.4],
          [73, -23, -29, 1.86, 2.0, 1.82, -1.8], [83, -17, 36, 1.48, 1.7, 1.60, -0.38],
          [91, -26, 64, 1.75, 1.85, 1.65, -0.5], [-25, -25, 49, 1.65, 1.75, 1.70, 0.4],
          [-8, -24, -46, 1.40, 1.62, 1.45, -0.35], [-49, -27, 53, 1.37, 1.70, 1.55, 0.95]
        ],
        Abyss_Bridge_Ruined: [
          [34, -9, 40, 1.38, 1.55, 1.31, -0.12], [56, -11, 19, 1.46, 2.22, 1.24, -0.6],
          [57, -7, -39, 1.45, 1.9, 1.22, -0.76], [81, -2, -17, 1.55, 1.68, 1.33, -1.22],
          [87, 1, 53, 1.36, 1.95, 1.30, -1.82], [-19, -3, 53, 1.36, 1.74, 1.25, -0.24]
        ],
        Abyss_Rock_Spire: [
          [22, -47, 26, 1.45, 3.1, 1.42, -0.40], [28, -60, 38, 2.4, 3.5, 2.1, 0.72],
          [48, -52, 45, 2.36, 3.3, 2.25, 1.28], [53, -40, 11, 2.5, 3.8, 2.0, 0.56],
          [59, -55, -39, 2.52, 3.5, 2.52, 1.37], [45, -48, -40, 1.8, 3.0, 1.65, 0.54],
          [92, -34, -38, 4.0, 4.7, 3.4, 1.31], [108, -32, 25, 4.0, 4.8, 3.1, 0.25],
          [85, -35, 62, 3.51, 4.9, 2.88, 0.65], [-6, -52, -48, 2.0, 3.5, 1.7, 0.52]
        ]
      };
      for (const [name, nodes] of Object.entries(sites)) {
        const template = ruins.scene.getObjectByName(name);
        template.position.set(0, 0, 0);
        template.updateMatrixWorld(true);
        const groups = [];
        template.traverse(mesh => {
          if (!mesh.isMesh) return;
          groups.push([mesh.geometry, finish(mesh.material, 'distant'), mesh.matrixWorld]);
        });
        const positions = nodes.map(([x, y, z, sx, sy, sz, a]) => [L(x, y, z), [sx, sy, sz], a]);
        for (const [geometry, material, matrix] of groups) instance('U1_' + name, geometry, material, positions, matrix);
      }
      atmosphere();
      status.phase = 'ready';
      status.columns = plinths.length;
      status.lamps = LAMPS.length;
    }

    function atmosphere() {
      // Each fall has a narrow bright core and soft edges. It empties into
      // the distance fog at the base instead of ending at a hard ground line.
      const fall = new T.ShaderMaterial({
        transparent: true, depthWrite: false, side: T.DoubleSide,
        vertexShader: `varying vec2 vFall;
          void main() { vFall=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `varying vec2 vFall;
          void main() {
            float border = smoothstep(0.0,0.24,vFall.x) * (1.0-smoothstep(0.74,1.0,vFall.x));
            float stream = 0.45 + 0.50*sin(vFall.x*28.0 + vFall.y*4.0)*sin(vFall.x*49.0 - vFall.y*12.0);
            float alpha = border*stream*smoothstep(0.0,0.37,vFall.y)*(1.0-smoothstep(0.94,1.0,vFall.y));
            gl_FragColor=vec4(0.13,0.57,0.60,alpha*0.78);
          }`
      });
      for (const [x, top, z, w, h, turn] of [[15, 3.2, 28.6, 1.12, 32, 1.25], [45, 2, 18, 2.1, 41, 1.15],
        [37, 3.5, -25.5, 1.7, 41, 0.93], [65, 10, -18, 1.3, 51, 1.1], [-14, 0, 38.2, 1.25, 29, 0.45]]) {
        const veil = new T.Mesh(new T.PlaneGeometry(w, h), fall);
        veil.name = 'U1_Cavern_Fall';
        veil.rotation.y = turn;
        veil.position.fromArray(L(x, top - h * 0.5, z));
        world.add(veil);
      }
      const beam = new T.ShaderMaterial({
        transparent: true, depthWrite: false, side: T.FrontSide, blending: T.AdditiveBlending,
        vertexShader: `varying vec2 beamUV; varying vec3 beamN; varying vec3 beamV;
          void main() {
            beamUV=uv; vec4 v=modelViewMatrix*vec4(position,1.0);
            beamN=normalize(normalMatrix*normal); beamV=-v.xyz; gl_Position=projectionMatrix*v;
          }`,
        fragmentShader: `varying vec2 beamUV; varying vec3 beamN; varying vec3 beamV;
          void main() {
            float edge=pow(abs(dot(normalize(beamN),normalize(beamV))),1.6);
            float fade=smoothstep(0.0,0.46,beamUV.y);
            float striae=0.62+0.38*sin(beamUV.x*53.4+beamUV.y*3.8)*sin(beamUV.x*34.6);
            gl_FragColor=vec4(0.35,0.66,0.78,edge*fade*striae*0.115);
          }`
      });
      const shaft = new T.Mesh(new T.CylinderGeometry(2.85, 5.65, ceiling - 0.25, 32, 1, true), beam);
      shaft.name = 'U1_Oculus_Light';
      shaft.position.fromArray(L(1.75, ceiling / 2 + 0.07, 0.2));
      shaft.rotation.z = 0.24;
      world.add(shaft);
      const oculus = new T.Mesh(new T.CircleGeometry(3.68, 56), new T.ShaderMaterial({
        vertexShader: `varying vec2 vO; void main() {
          vO = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
        fragmentShader: `varying vec2 vO;
          float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
          float cloud(vec2 v) {
            vec2 p=floor(v), f=fract(v); f=f*f*(3.0-2.0*f);
            return mix(mix(hash(p),hash(p+vec2(1,0)),f.x),
              mix(hash(p+vec2(0,1)),hash(p+vec2(1,1)),f.x),f.y);
          }
          void main() {
            float a=cloud(vO*5.4+3.0), b=cloud(vO*16.0+4.0), c=cloud(vO*42.0);
            float seam=1.0-smoothstep(0.0,0.21,abs(a*0.78+b*0.16+c*0.06-0.55));
            gl_FragColor=vec4(mix(vec3(0.045,0.13,0.19),vec3(0.22,0.68,0.77),pow(seam,4.0)),1.0);
          }`
      }));
      oculus.name = 'U1_Teal_Shaft_Ceiling';
      oculus.position.fromArray(L(0, ceiling + 1.55, 0));
      oculus.rotation.x = Math.PI / 2;
      world.add(oculus);
    }

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
      ready(renderer) {
        if (!pending) pending = loadHarbor(renderer).catch(error => {
          status.phase = 'failed';
          status.error = error.message;
          console.error('[U1] Anchorage assets', error);
        });
        return pending;
      },
      ceiling(x, z) {
        const r = Math.hypot(x - A.x, z - A.z);
        return r >= 3.7 && r <= 18.5 ? A.y + ceiling : Infinity;
      },
      spawns: Object.fromEntries(Object.entries(SPAWNS).map(([id, [x, y, z]]) => [id, L(x, y, z)])),
      update(visible, x, z) {
        world.visible = visible;
        const distance = Math.hypot(x-A.x, z-A.z);
        sharedLight.intensity = 1.40 * (1 - T.MathUtils.smoothstep(distance, 17, 26));
        if (!visible) return;
        world.updateWorldMatrix(true, false);
        transform.value.copy(world.matrixWorld).invert();
      }
    };
  }

  root.SinR3Underworld = { create, plan: { discs: DISCS, paths: PATHS, spawns: SPAWNS } };
})(window);
