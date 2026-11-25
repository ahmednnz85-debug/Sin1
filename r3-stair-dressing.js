/* R3-01 — Buried Years Stair: final dressing.
   Stone sets and reliefs come from assets/r3/stair (tools/r3-stair-textures.py,
   extracted from "خامات درج السنين" and "نقوش درج السنين"); props come from
   assets/اصول درج السنين.glb. Everything here lives in R3-01 only:
     plan()   synchronous, inside SinR3SealedZone.mount: placements, plinths
              and collision volumes, so the camera index includes them.
     create() lights, shafts, dust and fog driven by the hero position.
     load()   textures + GLB while the transition curtain is black.
   Stage space: (u, y, v), u out of passage-L0, v along the hall. The zone
   root is mirrored (scale.x = -1); props sit in an un-mirrored child so the
   carvings and cuneiform read the right way round. */
(function () {
  'use strict';

  const DIR = 'assets/r3/stair/';
  const GLB = 'assets/' + encodeURIComponent('اصول درج السنين.glb');
  // Architecture slots -> stone set and metres per texture repeat.
  const SLOT_SETS = {
    Treads: ['worn_tread', 1.9], Landings: ['slab_landing', 2.4], Walls: ['ashlar_wall', 2.7],
    Vault: ['eroded_vault', 3.2], ArchRibs: ['coursed_rib', 1.8], Buttresses: ['fluted_pier', 1.7],
    Plinths: ['eroded_block', 1.9], Capitals: ['eroded_block', 1.6], MuralBays: ['frieze_band', 2.6]
  };
  const SET_ROUGH = { worn_tread: 0.93, slab_landing: 0.94, ashlar_wall: 0.95, eroded_vault: 0.97, coursed_rib: 0.95, fluted_pier: 0.95, eroded_block: 0.96, frieze_band: 0.95, dust_rubble: 1 };
  // Albedo gain per set: the sheet's tread flags are darker than the dusty
  // treads of the reference picture.
  const SET_GAIN = { worn_tread: 1.85, slab_landing: 1.12, eroded_vault: 0.92 };
  const SET_NORMAL = { worn_tread: 1.15, slab_landing: 1.0, ashlar_wall: 1.25, eroded_vault: 1.1, coursed_rib: 1.2, fluted_pier: 1.2, eroded_block: 1.2, frieze_band: 1.3 };
  const MAP_RES = 0.2; // metres per stage-map texel

  let pendingMaterials = [];
  const api = window.SinR3Stair = {
    base: '',
    tileMetres: slot => (SLOT_SETS[slot] || SLOT_SETS.Walls)[1],
    material, plan, create
  };

  // ---- stone shader ------------------------------------------------------
  // Shared by the architecture, the props and the reliefs: macro variation
  // breaks visible repeats; the stage map (dust, floor height, corner
  // occlusion) adds dust drifts at wall feet, on ledges and around debris.
  function sharedUniforms(THREE) {
    return api._uniforms || (api._uniforms = {
      r3Map: { value: null }, r3Dust: { value: null },
      r3W2S: { value: new THREE.Matrix4() }, r3Bounds: { value: new THREE.Vector4(0, 0, 1, 1) }
    });
  }
  function patchStone(THREE, m, dust, macro) {
    const shared = sharedUniforms(THREE);
    m.userData.r3Stone = true;
    m.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, shared, { r3DustAmt: { value: dust }, r3Macro: { value: macro } });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 r3W2S;\nvarying vec3 vR3Pos;\nvarying float vR3Up;')
        .replace('#include <fog_vertex>', [
          '#include <fog_vertex>',
          '{ vec4 r3w = vec4( transformed, 1.0 );',
          '#ifdef USE_INSTANCING',
          '  r3w = instanceMatrix * r3w;',
          '#endif',
          '  r3w = modelMatrix * r3w;',
          '  vR3Pos = ( r3W2S * r3w ).xyz;',
          '  vR3Up = ( vec4( transformedNormal, 0.0 ) * viewMatrix ).y; }'
        ].join('\n'));
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D r3Map;\nuniform sampler2D r3Dust;\nuniform vec4 r3Bounds;\nuniform float r3DustAmt;\nuniform float r3Macro;\nvarying vec3 vR3Pos;\nvarying float vR3Up;')
        .replace('#include <color_fragment>', [
          '#include <color_fragment>',
          'float r3up = vR3Up;',
          '#ifdef DOUBLE_SIDED',
          'r3up = gl_FrontFacing ? r3up : - r3up;',
          '#endif',
          'vec4 r3s = texture2D( r3Map, ( vR3Pos.xz - r3Bounds.xy ) * r3Bounds.zw );',
          'float r3above = vR3Pos.y - ( r3s.g * 18.0 - 17.0 );',
          'float r3m = texture2D( r3Dust, vR3Pos.xz * 0.037 + vec2( vR3Pos.y * 0.029 ) ).r;',
          'float r3n = texture2D( r3Dust, vR3Pos.zx * 0.23 + vec2( vR3Pos.y * 0.17 ) ).g;',
          'diffuseColor.rgb *= mix( 1.0 - r3Macro, 1.0 + r3Macro * 0.6, r3m );',
          'float r3upF = smoothstep( 0.45, 0.85, r3up );',
          'float r3d = r3s.r * ( r3upF * ( 1.0 - smoothstep( 0.4, 1.1, r3above ) ) + ( 1.0 - r3upF ) * ( 1.0 - smoothstep( 0.0, 0.5, r3above ) ) );',
          'r3d = max( r3d, r3upF * 0.42 * smoothstep( 0.5, 1.0, r3above ) );',
          'r3d = smoothstep( 0.22, 0.7, r3d * ( 0.5 + r3n ) ) * r3DustAmt;',
          'vec3 r3dc = texture2D( r3Dust, vR3Pos.xz * 0.45 + vec2( vR3Pos.y * 0.45 ) ).rgb;',
          'diffuseColor.rgb = mix( diffuseColor.rgb, r3dc * vec3( 1.04, 0.98, 0.92 ), r3d );',
          'diffuseColor.rgb *= 1.0 - 0.55 * r3s.b * ( 1.0 - smoothstep( 0.0, 1.3, r3above ) );',
          'diffuseColor.rgb *= mix( 1.0, 0.7, smoothstep( 4.5, 8.5, r3above ) );'
        ].join('\n'))
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 1.0, r3d );');
    };
    m.customProgramCacheKey = () => 'r3stone';
    return m;
  }

  function material(THREE, slot) {
    const [set] = SLOT_SETS[slot] || SLOT_SETS.Walls;
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    m.userData.r3Set = set;
    patchStone(THREE, m, slot === 'Vault' ? 0 : 1, 0.3);
    pendingMaterials.push(m);
    return m;
  }

  // ---- helpers -----------------------------------------------------------
  const rand = (() => { let s = 0x5eed1; return () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9 | 0) >>> 0) / 4294967296; })();
  const tAxis = T => { const p = T.frame(0, 0, 0), q = T.frame(0, 0, 1); return [q[0] - p[0], q[2] - p[2]]; };
  const dAxis = T => { const p = T.frame(0, 0, 0), q = T.frame(1, 0, 0); return [q[0] - p[0], q[2] - p[2]]; };
  // Stage (u, v) direction -> yaw for an asset whose front is local +z / +x.
  const yawZ = (du, dv) => Math.atan2(-du, dv);
  const yawX = (du, dv) => Math.atan2(-dv, -du);

  // ---- plan --------------------------------------------------------------
  function plan(A) {
    const P = { items: [], bands: [], panels: [], decals: [], roots: [], shafts: [], lights: [], boxes: [], arches: [] };
    const [F1, F2] = A.tunnels;
    if (!F1 || !F2) throw new Error('stair tunnels missing');
    const block = (u0, u1, y0, y1, v0, v1, solid = true) => {
      A.collision(Math.min(u0, u1), Math.max(u0, u1), y0, y1, Math.min(v0, v1), Math.max(v0, v1), solid);
      if (solid) P.boxes.push([Math.min(u0, u1), Math.max(u0, u1), Math.min(v0, v1), Math.max(v0, v1)]);
    };
    const floor = (u, v, fallback = 0) => { const h = A.floorAt(u, v); return h == null ? fallback : h; };
    const minFloor = (pts, fb) => Math.min(...pts.map(([u, v]) => floor(u, v, fb)));

    // Arches -> archway asset, sized on the authored opening.
    for (const a of A.arches) {
      const c = a.frame((a.a + a.b) / 2, 0, 0), ax = dAxis({ frame: a.frame });
      P.arches.push({ u: c[0], v: c[2], base: a.base, half: a.half, top: a.top, depth: a.b - a.a + 0.32, axis: ax });
      // Pier footprints for the dust map.
      for (const s of [-1, 1]) {
        const p = a.frame(a.a - 0.26, 0, s * a.half), q = a.frame(a.b + 0.26, 0, s * (a.half + a.thickness));
        P.boxes.push([Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[2], q[2]), Math.max(p[2], q[2])]);
      }
    }

    // Spans between arch piers, per flight.
    function spans(T) {
      const out = [], ds = [];
      for (let i = 0; i < T.ribs; i++) ds.push(T.a + (T.b - T.a) * (i + 0.22) / T.ribs);
      out.push([T.a + 0.25, ds[0] - 0.6]);
      for (let i = 0; i < ds.length - 1; i++) out.push([ds[i] + 0.64, ds[i + 1] - 0.6]);
      out.push([ds[ds.length - 1] + 0.64, T.b - 0.1]);
      return out.filter(([x, y]) => y - x > 2.2);
    }
    const S1 = spans(F1), S2 = spans(F2);

    // A wall item: centre along d, height above the uphill grade of its span.
    function onWall(T, side, d0, d1, inset) {
      const gHigh = Math.max(T.grade(d0), T.grade(d1)), gLow = Math.min(T.grade(d0), T.grade(d1));
      const t = side * (T.bound - inset), [tu, tv] = tAxis(T);
      return { d: (d0 + d1) / 2, gHigh, gLow, at: (d, y) => T.frame(d, y, t), face: [-side * tu, -side * tv] };
    }
    // GLB reliefs / sheet friezes on the flight walls.
    const R = { moon: 'Relief_Moon_Phases_And_Cuneiform', court: 'Relief_Winged_Guardian_And_Attendants', royal: 'Relief_Royal_Procession' };
    function relief(T, side, span, kind, opts = {}) {
      const [d0, d1] = span, len = d1 - d0;
      const w = Math.min(opts.width || 4.0, len - 0.35);
      const s = w / 4.21, h = 1.94 * s, depth = 0.343 * s;
      const W = onWall(T, side, d0, d1, depth / 2 - 0.12);
      const y = (opts.y != null ? W.gHigh + opts.y : W.gHigh + 1.15);
      const p = W.at(W.d, y);
      P.items.push({ node: R[kind], u: p[0], y, v: p[2], yaw: yawZ(...W.face), scale: [s, s, s] });
      const q0 = onWall(T, side, d0, d1, 0).at(W.d - w / 2, 0), q1 = onWall(T, side, d0, d1, 0.3).at(W.d + w / 2, 0);
      block(q0[0], q1[0], y, y + h, q0[2], q1[2], false);
    }
    function frieze(T, side, span, tex, y, width) {
      const [d0, d1] = span, w = Math.min(width, d1 - d0 - 0.3);
      const W = onWall(T, side, d0, d1, 0.012);
      const p = W.at(W.d, W.gHigh + y);
      P.panels.push({ tex, u: p[0], y: W.gHigh + y, v: p[2], face: W.face, w });
    }
    // Lamassu pair on stepped plinths: guardians facing the arrival.
    function lamassu(T, span, node, len, depth, height) {
      const [d0, d1] = span, dc = (d0 + d1) / 2, s = Math.min(1, (d1 - d0 - 0.5) / len);
      const L = len * s + 0.35, D = depth * s + 0.3;
      for (const side of [-1, 1]) {
        const t0 = side * (T.bound - 0.02), t1 = side * (T.bound - D);
        const a = T.frame(dc - L / 2, 0, t0), b = T.frame(dc + L / 2, 0, t1);
        const gHigh = Math.max(T.grade(dc - L / 2), T.grade(dc + L / 2)), gLow = Math.min(T.grade(dc - L / 2), T.grade(dc + L / 2));
        const top = gHigh + 0.38;
        // Stepped pedestal: the downhill half sits one course lower, under a
        // full-length top slab, so it follows the flight instead of a cliff.
        const downhill = T.grade(dc + L / 2) < T.grade(dc - L / 2) ? 1 : -1;
        const m = T.frame(dc, 0, t1), lowTop = top - 0.55;
        const hiEnd = downhill > 0 ? a : b, loEnd = downhill > 0 ? b : a;
        A.solidBox('Plinths', Math.min(hiEnd[0], m[0]), Math.max(hiEnd[0], m[0]), gLow - 0.6, top, Math.min(a[2], b[2]), Math.max(a[2], b[2]));
        A.solidBox('Plinths', Math.min(loEnd[0], m[0]), Math.max(loEnd[0], m[0]), gLow - 0.6, lowTop, Math.min(a[2], b[2]), Math.max(a[2], b[2]));
        const s0 = T.frame(dc - 0.2 * downhill, 0, t0), s1 = T.frame(dc + (L / 2) * downhill, 0, side * (T.bound - D + 0.35));
        A.solidBox('Plinths', Math.min(s0[0], s1[0]), Math.max(s0[0], s1[0]), lowTop, top, Math.min(s0[2], s1[2]), Math.max(s0[2], s1[2]));
        P.boxes.push([Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[2], b[2]), Math.max(a[2], b[2])]);
        // Moulded cap: a slightly wider slab on the plinth.
        const c0 = T.frame(dc - L / 2 - 0.06, 0, t0), c1 = T.frame(dc + L / 2 + 0.06, 0, side * (T.bound - D - 0.06));
        A.box('Capitals', Math.min(c0[0], c1[0]), Math.max(c0[0], c1[0]), top - 0.12, top + 0.02, Math.min(c0[2], c1[2]), Math.max(c0[2], c1[2]));
        const c = T.frame(dc, 0, side * (T.bound - D / 2));
        const [du, dv] = dAxis(T);
        // Head toward the arrival (up the flight); the far-side guardian is
        // mirrored so both show their carved outer flank to the stair.
        P.items.push({ node, u: c[0], y: top + 0.02, v: c[2], yaw: yawX(-du, -dv), scale: [s, s, side > 0 ? -s : s], centre: true });
        const e0 = T.frame(dc - L / 2, 0, t0), e1 = T.frame(dc + L / 2, 0, t1);
        block(e0[0], e1[0], top, top + height * s, e0[2], e1[2], false);
      }
    }

    // Flight 1 (upper): large guardians at the head, small ones lower down.
    lamassu(F1, S1[1] ? S1[0] : S1[0], 'Lamassu_Guardian_Large', 3.84, 1.62, 3.29);
    const midSpan = S1[Math.min(2, S1.length - 1)];
    lamassu(F1, midSpan, 'Lamassu_Guardian_Small', 2.89, 1.37, 2.43);
    // Reliefs behind the guardians and on the open spans.
    const plan1 = [['moon', 'court', 2.2], ['court', 'royal', 1.15], ['royal', 'moon', 1.75], ['moon', 'royal', 1.15], ['court', 'moon', 1.15]];
    S1.forEach((span, i) => {
      const [a, b, y] = plan1[i % plan1.length];
      relief(F1, -1, span, a, { y, width: 3.7 });
      relief(F1, 1, span, b, { y, width: 3.7 });
      if (i === 1 || i === 3) {
        frieze(F1, -1, span, i === 1 ? 'frieze_offerings' : 'frieze_procession', 3.05, 3.6);
        frieze(F1, 1, span, i === 1 ? 'frieze_procession' : 'frieze_offerings', 3.05, 3.6);
      }
    });
    // Flight 2 (lower): narrower spans; GLB reliefs alternate with friezes.
    S2.forEach((span, i) => {
      if (i % 2 === 0) {
        relief(F2, -1, span, ['court', 'royal', 'moon'][i % 3], { y: 1.2, width: 3.0 });
        frieze(F2, 1, span, 'frieze_offerings', 1.35, 3.0);
        frieze(F2, 1, span, 'frieze_procession', 2.25, 3.0);
      } else {
        relief(F2, 1, span, ['moon', 'court', 'royal'][i % 3], { y: 1.2, width: 3.0 });
        frieze(F2, -1, span, 'frieze_procession', 1.35, 3.0);
        frieze(F2, -1, span, 'frieze_offerings', 2.25, 3.0);
      }
    });
    // Continuous sloped registers: cuneiform dado and rosette cornice.
    for (const T of [F1, F2]) for (const side of [-1, 1]) {
      P.bands.push({ T, side, tex: 'band_cuneiform', y: 0.62, h: 0.3 });
      P.bands.push({ T, side, tex: 'band_rosettes', y: 5.28, h: 0.48 });
    }

    // Turn landing (y = -9): the crescent shrine closes the view down flight 1,
    // as in the reference; flight 2 leaves it to the left in moonlight.
    const turnY = F1.y1, east = A.TURN + A.HALF + 0.68, lowY = F2.y1;
    P.decals.push({ piece: 0, u: east - 0.015, y: turnY + 3.15, v: -0.2, h: 2.9, face: [-1, 0], glow: 1 });
    for (const [k, v] of [[1, -2.85], [7, 2.45]]) P.decals.push({ piece: k, u: east - 0.015, y: turnY + 5.2, v, h: 0.62, face: [-1, 0], glow: 0.5 });
    for (const vv of [-2.75, 2.75]) {
      P.items.push({ node: 'Fluted_Stone_Column_Tall', u: east - 0.28, y: turnY - 0.02, v: vv, yaw: 0, scale: [1.2, 1.62, 1.2], centre: true });
      block(east - 0.95, east, turnY, turnY + 5.4, vv - 0.72, vv + 0.72);
    }
    P.items.push({ node: 'Stone_Balustrade_With_Carved_Plinth', u: east - 0.95, y: turnY - 0.02, v: -0.2, yaw: yawZ(-1, 0), scale: [1, 1, 1], centre: true });
    block(east - 1.3, east - 0.6, turnY, turnY + 1.1, -1.95, 1.55);
    P.panels.push({ tex: 'band_cuneiform', u: east - 0.012, y: turnY + 1.55, v: -0.2, face: [-1, 0], w: 3.6 });
    // North wall of the turn landing: the two processions, side by side.
    const north = -(A.HALF + 0.68);
    P.panels.push({ tex: 'frieze_offerings', u: A.flightEnd + 1.95, y: turnY + 1.75, v: north + 0.012, face: [0, 1], w: 3.3 });
    P.panels.push({ tex: 'frieze_procession', u: A.flightEnd + 5.4, y: turnY + 1.75, v: north + 0.012, face: [0, 1], w: 3.3 });
    P.panels.push({ tex: 'band_rosettes', u: A.flightEnd + 3.68, y: turnY + 4.6, v: north + 0.012, face: [0, 1], w: 7.2 });

    // Lower landing (y = -15): moon phases over a parapet, framed by columns.
    const south = A.HALL_V + A.HALF + 0.68, cu = (A.flightEnd + A.TURN + A.HALF + 0.68) / 2;
    [1, 2, 3, 4, 5, 6, 7].forEach((k, i) => P.decals.push({ piece: k, u: cu + (i - 3) * 0.86, y: lowY + 3.0, v: south - 0.015, h: 0.66, face: [0, -1], glow: 0.35 }));
    P.decals.push({ piece: 0, u: cu, y: lowY + 4.25, v: south - 0.015, h: 1.25, face: [0, -1], glow: 0.6 });
    P.panels.push({ tex: 'band_cuneiform', u: cu, y: lowY + 2.35, v: south - 0.012, face: [0, -1], w: 6.4 });
    P.panels.push({ tex: 'band_rosettes', u: cu, y: lowY + 5.0, v: south - 0.012, face: [0, -1], w: 7.0 });
    P.items.push({ node: 'Stone_Balustrade_With_Carved_Plinth', u: cu, y: lowY - 0.02, v: south - 0.85, yaw: yawZ(0, -1), scale: [1, 1, 1], centre: true });
    block(cu - 1.72, cu + 1.72, lowY, lowY + 1.1, south - 1.2, south - 0.5);
    for (const du of [-3.15, 3.15]) {
      P.items.push({ node: 'Fluted_Stone_Column_Short', u: cu + du, y: lowY - 0.02, v: south - 0.3, yaw: 0, scale: [1.25, 1.55, 1.25], centre: true });
      block(cu + du - 0.55, cu + du + 0.55, lowY, lowY + 3.3, south - 0.85, south);
    }
    // West wall of the lower landing: the winged guardian relief.
    {
      const west = A.flightEnd, s = 0.86;
      P.items.push({ node: R.court, u: west + 0.07, y: lowY + 1.3, v: (A.lowerTurn + south) / 2, yaw: yawZ(1, 0), scale: [s, s, s] });
      block(west, west + 0.32, lowY + 1.3, lowY + 3.0, A.lowerTurn + 1.8, south - 1.8, false);
    }

    // Debris: broken slabs, drums, fragments and rubble along the wall feet,
    // clear of the walking line (|t| <= 2.3 stays open on every flight).
    const debris = [
      // [node, T or null, d fraction | u, t | v, yaw, scale, tilt]
      ['Collapsed_Masonry_Rubble_Cluster', F1, 0.955, 2.65, 0.4, 1.0, true],
      ['Fractured_Inscribed_Slab_Large', F1, 0.43, -2.9, 1.2, 1.0, true],
      ['Detached_Rough_Stone_Fragment', F1, 0.46, -2.55, 2.4, 0.8, true],
      ['Fractured_Inscribed_Slab_Small', F1, 0.83, 2.95, -0.5, 1.0, true],
      ['Inscribed_Broken_Column_Drum', F1, 0.81, -2.95, 0.3, 0.95, false],
      ['Detached_Rough_Stone_Fragment', F1, 0.24, 2.95, 4.1, 0.65, true],
      ['Fractured_Inscribed_Slab_Small', F2, 0.42, 2.95, 2.1, 0.9, true],
      ['Detached_Rough_Stone_Fragment', F2, 0.7, -2.9, 0.8, 0.85, true],
      ['Collapsed_Masonry_Rubble_Cluster', F2, 0.96, -2.55, 1.6, 0.85, true],
      ['Carved_Rosette_Frieze_Block', null, A.flightEnd + 1.45, north + 0.85, 0.12, 0.95, false],
      ['Inscribed_Broken_Column_Drum', null, A.flightEnd + 0.85, south - 0.8, 0.9, 1.0, false],
      ['Fractured_Inscribed_Slab_Large', null, A.flightEnd + 0.95, A.lowerTurn + 2.4, 1.2, 0.9, false],
      ['Detached_Rough_Stone_Fragment', null, east - 2.6, north + 0.55, 0.4, 0.7, false]
    ];
    const SIZES = {
      Collapsed_Masonry_Rubble_Cluster: [2.62, 0.77, 1.37], Fractured_Inscribed_Slab_Large: [1.17, 0.88, 1.6],
      Fractured_Inscribed_Slab_Small: [0.68, 0.56, 0.91], Detached_Rough_Stone_Fragment: [0.86, 0.57, 0.71],
      Inscribed_Broken_Column_Drum: [0.93, 1.0, 0.93], Carved_Rosette_Frieze_Block: [2.74, 0.91, 0.51]
    };
    const hits = (u, v, hx, hz) => P.boxes.some(b => u + hx > b[0] && u - hx < b[1] && v + hz > b[2] && v - hz < b[3]) ||
      [[u - hx, v - hz], [u + hx, v - hz], [u - hx, v + hz], [u + hx, v + hz]].some(([x, z]) => A.floorAt(x, z) == null);
    P.skipped = [];
    for (const [node, T, d, t, yaw, s, tilt] of debris) {
      const [sx, sy, sz] = SIZES[node].map(x => x * s);
      const ex = Math.abs(Math.cos(yaw)) * sx / 2 + Math.abs(Math.sin(yaw)) * sz / 2;
      const ez = Math.abs(Math.sin(yaw)) * sx / 2 + Math.abs(Math.cos(yaw)) * sz / 2;
      let u, v, slope = 0, axis = [1, 0], ok = false;
      // Slide along the wall until the footprint clears piers, plinths and props.
      for (const step of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.0, -2.0, 2.4, -2.4]) {
        if (T) {
          const dd = T.a + (T.b - T.a) * d + step, p = T.frame(dd, 0, t);
          if (dd < T.a + 0.5 || dd > T.b - 0.5) continue;
          u = p[0]; v = p[2]; slope = Math.atan((T.y0 - T.y1) / (T.b - T.a)); axis = dAxis(T);
        } else { u = d + (Math.abs(t) > 10 ? step : 0); v = t + (Math.abs(t) > 10 ? 0 : step); }
        if (!hits(u, v, ex * 0.85, ez * 0.85)) { ok = true; break; }
      }
      if (!ok) { P.skipped.push(node); continue; }
      const r = Math.max(sx, sz) / 2;
      const y = minFloor([[u - r * 0.6, v - r * 0.6], [u + r * 0.6, v - r * 0.6], [u - r * 0.6, v + r * 0.6], [u + r * 0.6, v + r * 0.6], [u, v]], 0) - 0.04;
      P.items.push({ node, u, y, v, yaw, scale: [s, s, s], centre: true, tilt: tilt ? slope * 0.85 : 0, axis });
      const hx = Math.abs(Math.cos(yaw)) * sx / 2 + Math.abs(Math.sin(yaw)) * sz / 2;
      const hz = Math.abs(Math.sin(yaw)) * sx / 2 + Math.abs(Math.cos(yaw)) * sz / 2;
      block(u - hx * 0.8, u + hx * 0.8, y, y + sy + 0.2, v - hz * 0.8, v + hz * 0.8, true);
    }

    // Dry roots through the vault joints, never below 2.6 m over a tread.
    const rootTypes = ['Hanging_Roots_Wide_Long', 'Hanging_Roots_Central_Tapered', 'Hanging_Roots_Wide_Forked', 'Hanging_Roots_Narrow'];
    const rootSpots = [[F1, 0.06, -2.7], [F1, 0.2, 2.9], [F1, 0.34, -1.6], [F1, 0.41, 2.4], [F1, 0.55, -3.0], [F1, 0.63, 1.2], [F1, 0.74, 3.0],
      [F1, 0.9, -2.2], [F2, 0.12, 2.8], [F2, 0.38, -2.4], [F2, 0.6, 1.4], [F2, 0.86, -3.0]];
    rootSpots.forEach(([T, f, t], i) => {
      let d = T.a + (T.b - T.a) * f;
      for (let r = 0; r < T.ribs; r++) {
        const da = T.a + (T.b - T.a) * (r + 0.22) / T.ribs + 0.01;
        if (Math.abs(d - da) < 1.0) d = da + Math.sign(d - da || 1) * 1.0;
      }
      const ang = Math.acos(Math.min(1, Math.abs(t) / T.bound));
      const vy = T.grade(d) + T.height - 2.6 * (1 - Math.sin(ang));
      const p = T.frame(d, 0, t), s = 1.05 + (i % 4) * 0.22;
      P.roots.push({ node: rootTypes[i % 4], u: p[0], top: vy + 0.18, v: p[2], yaw: i * 1.7, scale: [s, s * (1.25 + (i % 3) * 0.15), s] });
    });
    P.roots.push({ node: rootTypes[1], u: east - 0.9, top: turnY + 8.45, v: -3.2, yaw: 0.6, scale: [1.3, 1.7, 1.3] });
    P.roots.push({ node: rootTypes[3], u: A.flightEnd + 1.2, top: lowY + 8.45, v: south - 0.6, yaw: 2.2, scale: [1.2, 1.9, 1.2] });

    // Light: warm spill at the head of the stair, cold shafts through the
    // vault cracks, blue moonlight from the turn down to the hall.
    const at = (T, f, y, t) => { const d = T.a + (T.b - T.a) * f; return T.frame(d, T.grade(d) + y, t); };
    P.shafts.push({ from: at(F1, 0.36, 8.35, -0.5), to: at(F1, 0.47, -0.2, 0.9), r0: 0.42, r1: 1.25, color: 0xcfd9ef, power: 0.85 });
    P.shafts.push({ from: at(F1, 0.69, 8.35, 0.8), to: at(F1, 0.77, -0.2, -0.6), r0: 0.32, r1: 1.0, color: 0xbfcff0, power: 0.7 });
    P.shafts.push({ from: [A.TURN - 0.6, turnY + 8.35, -0.8], to: [A.TURN + 0.6, turnY - 0.1, 0.4], r0: 0.55, r1: 1.5, color: 0x9fb8ff, power: 0.8 });
    P.shafts.push({ from: at(F2, 0.5, 8.35, 0.6), to: at(F2, 0.58, -0.2, -0.4), r0: 0.35, r1: 1.05, color: 0x93adff, power: 0.65 });
    P.lights = [
      { type: 'point', color: 0xffd8b0, intensity: 2.9, distance: 24, decay: 1.4, pos: at(F1, 0.04, 4.2, 0.6), warm: 1 },
      { type: 'point', color: 0xffdcbc, intensity: 2.6, distance: 18, decay: 1.4, pos: at(F1, 0.3, 3.4, -1.2), warm: 1 },
      { type: 'spot', color: 0xe6ebff, intensity: 6.5, distance: 22, decay: 1.0, angle: 0.3, penumbra: 0.65, pos: P.shafts[0].from, target: P.shafts[0].to, shadow: true },
      { type: 'spot', color: 0xd2dcff, intensity: 5.0, distance: 20, decay: 1.0, angle: 0.28, penumbra: 0.65, pos: P.shafts[1].from, target: P.shafts[1].to },
      { type: 'spot', color: 0x7f9dff, intensity: 2.6, distance: 15, decay: 1.1, angle: 0.62, penumbra: 0.6, pos: [A.TURN - 1.6, turnY + 6.2, 0.4], target: [east, turnY + 3.0, -0.2] },
      { type: 'point', color: 0x7390e8, intensity: 3.0, distance: 20, decay: 1.2, pos: at(F2, 0.62, 3.6, 0), cold: 1 },
      { type: 'spot', color: 0x88a4ff, intensity: 3.0, distance: 16, decay: 1.0, angle: 0.7, penumbra: 0.6, pos: [A.TURN, lowY + 6.8, A.HALL_V - 1.5], target: [A.TURN, lowY + 2.6, A.HALL_V + A.HALF + 0.68] }
    ];

    // Stage map: dust, floor height and corner occlusion on a 0.2 m grid.
    const u0 = A.start - 0.6, u1 = A.HALL_ENTRY + 0.4, v0 = -(A.HALF + 1.3), v1 = A.HALL_V + A.HALF + 1.3;
    const W = Math.ceil((u1 - u0) / MAP_RES), H = Math.ceil((v1 - v0) / MAP_RES);
    const heights = new Float32Array(W * H).fill(NaN), dist = new Float32Array(W * H).fill(1e9);
    const steps = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const u = u0 + (i + 0.5) * MAP_RES, v = v0 + (j + 0.5) * MAP_RES, k = j * W + i;
      const h = A.floorAt(u, v);
      const solid = h == null || P.boxes.some(b => u >= b[0] && u <= b[1] && v >= b[2] && v <= b[3]);
      if (h != null) heights[k] = h;
      if (solid) dist[k] = 0;
      if (h != null) for (const T of [F1, F2]) {
        const ax = T.transverse ? v : u, tr = T.transverse ? u - A.TURN : v;
        if (ax > T.a && ax < T.b && Math.abs(tr) < T.bound) steps[k] = 1;
      }
    }
    // Two-pass chamfer distance (metres) to walls and solid props.
    const D1 = MAP_RES, D2 = MAP_RES * Math.SQRT2;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i; let d = dist[k];
      if (i > 0) d = Math.min(d, dist[k - 1] + D1);
      if (j > 0) { d = Math.min(d, dist[k - W] + D1); if (i > 0) d = Math.min(d, dist[k - W - 1] + D2); if (i < W - 1) d = Math.min(d, dist[k - W + 1] + D2); }
      dist[k] = d;
    }
    for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
      const k = j * W + i; let d = dist[k];
      if (i < W - 1) d = Math.min(d, dist[k + 1] + D1);
      if (j < H - 1) { d = Math.min(d, dist[k + W] + D1); if (i < W - 1) d = Math.min(d, dist[k + W + 1] + D2); if (i > 0) d = Math.min(d, dist[k + W - 1] + D2); }
      dist[k] = d;
    }
    // Wall texels take the nearest floor height (wall feet get the dust).
    let frontier = []; for (let k = 0; k < W * H; k++) if (!Number.isNaN(heights[k])) frontier.push(k);
    while (frontier.length) {
      const next = [];
      for (const k of frontier) {
        const i = k % W, j = (k - i) / W;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= W || b >= H) continue;
          const n = b * W + a; if (Number.isNaN(heights[n])) { heights[n] = heights[k]; next.push(n); }
        }
      }
      frontier = next;
    }
    const noise = (x, y) => {
      const f = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
      const a = f(xi, yi), b = f(xi + 1, yi), c = f(xi, yi + 1), d = f(xi + 1, yi + 1);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
    const data = new Uint8Array(W * H * 4);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, u = u0 + (i + 0.5) * MAP_RES, v = v0 + (j + 0.5) * MAP_RES, d = dist[k];
      const patch = noise(u * 0.55, v * 0.55) * 0.65 + noise(u * 1.7 + 9, v * 1.7) * 0.35;
      let dust = 0.95 * Math.exp(-d / 0.62) + 0.42 * Math.max(0, patch - 0.42);
      if (steps[k]) dust = dust * 0.8 + 0.2 + 0.25 * patch; else dust += 0.1;
      data[k * 4] = Math.round(255 * Math.min(1, dust));
      data[k * 4 + 1] = Math.round(255 * Math.min(1, Math.max(0, (heights[k] + 17) / 18)));
      data[k * 4 + 2] = Math.round(255 * Math.exp(-d / 0.38));
      data[k * 4 + 3] = 255;
    }
    P.map = { data, W, H, u0, v0, u1: u0 + W * MAP_RES, v1: v0 + H * MAP_RES };
    P.F1 = F1; P.F2 = F2; P.A = A;
    P.layout = { spans1: S1.length, spans2: S2.length, items: P.items.length, roots: P.roots.length, boxes: P.boxes.length };
    return P;
  }

  // ---- runtime -----------------------------------------------------------
  function create(THREE, root, group, P) {
    const materials = pendingMaterials; pendingMaterials = [];
    const uniforms = sharedUniforms(THREE);
    const time = { value: 0 };
    const owned = []; // textures and materials created here (for the report)
    const dress = new THREE.Group(); dress.name = 'R3-01_Dressing'; dress.scale.x = -1; group.add(dress);
    const fx = new THREE.Group(); fx.name = 'R3-01_Atmosphere'; group.add(fx);
    const lightRig = new THREE.Group(); lightRig.name = 'R3-01_Lights'; root.add(lightRig);
    const toDress = (u, y, v) => new THREE.Vector3(-u, y, v);
    // Sectors: flight 1 and flight 2 cannot see each other except from
    // near the turn landing, so each hides while the hero is deep in the other.
    const sectors = {};
    for (const n of ['F1', 'TURN', 'F2']) { sectors[n] = new THREE.Group(); sectors[n].name = 'R3-01_' + n; dress.add(sectors[n]); }
    const sectorOf = (u, v) => (u < P.F1.b - 0.2 && Math.abs(v) < P.F1.bound + 1) ? 'F1' : v > P.F2.a + 0.4 ? 'F2' : 'TURN';
    const sector = (u, v) => sectors[sectorOf(u, v)];

    // Stage map texture.
    const map = new THREE.DataTexture(P.map.data, P.map.W, P.map.H, THREE.RGBAFormat);
    map.magFilter = map.minFilter = THREE.LinearFilter; map.generateMipmaps = false; map.needsUpdate = true;
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping; map.name = 'R3-01_StageMap';
    uniforms.r3Map.value = map;
    uniforms.r3Bounds.value.set(P.map.u0, P.map.v0, 1 / (P.map.u1 - P.map.u0), 1 / (P.map.v1 - P.map.v0));
    owned.push(map);

    // Lights (intensities are r147 units; three-compat scales them by π).
    const lights = [];
    for (const L of P.lights) {
      let light;
      if (L.type === 'spot') {
        light = new THREE.SpotLight(L.color, L.intensity, L.distance, L.angle, L.penumbra, L.decay);
        light.target.position.set(...L.target);
        lightRig.add(light.target);
        if (L.shadow) {
          light.castShadow = true;
          light.shadow.mapSize.set(1024, 1024);
          light.shadow.bias = -0.0006; light.shadow.normalBias = 0.03;
          light.shadow.camera.near = 0.5; light.shadow.camera.far = L.distance;
        }
      } else light = new THREE.PointLight(L.color, L.intensity, L.distance, L.decay);
      light.position.set(...L.pos);
      light.userData.r3Base = L.intensity;
      light.userData.r3Warm = !!L.warm; light.userData.r3Cold = !!L.cold;
      lightRig.add(light); lights.push(light);
    }

    // Procedural soft sprites (no image assets): dust mote and crack glow.
    function sprite(w, h, fn) {
      const d = new Uint8Array(w * h * 4);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const x = (i + 0.5) / w * 2 - 1, y = (j + 0.5) / h * 2 - 1, a = fn(x, y);
        d.set([255, 255, 255, Math.round(255 * Math.max(0, Math.min(1, a)))], (j * w + i) * 4);
      }
      const t = new THREE.DataTexture(d, w, h, THREE.RGBAFormat); t.needsUpdate = true;
      t.magFilter = t.minFilter = THREE.LinearFilter; owned.push(t); return t;
    }
    const mote = sprite(32, 32, (x, y) => Math.exp(-(x * x + y * y) * 4.5));
    const crack = sprite(64, 32, (x, y) => {
      const r = Math.hypot(x, y * 1.6), n = Math.sin(x * 23.0 + Math.sin(y * 7.0) * 2.0) * 0.5 + 0.5;
      return Math.pow(Math.max(0, 1 - r), 1.6) * (0.55 + 0.45 * n);
    });

    // Volumetric shafts: open cones, soft at the silhouette, fading to the floor.
    const shaftMat = new THREE.ShaderMaterial({
      uniforms: { uTime: time, uColor: { value: new THREE.Color() }, uPower: { value: 1 }, uFade: { value: 1 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec2 vUv; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }',
      fragmentShader: [
        'uniform float uTime; uniform vec3 uColor; uniform float uPower; uniform float uFade; varying vec3 vN; varying vec3 vV; varying vec2 vUv;',
        'float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }',
        'float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }',
        'void main(){',
        '  float facing = abs(dot(normalize(vN), normalize(vV)));',
        '  float soft = pow(facing, 2.2);',
        '  float along = smoothstep(0.0, 0.35, vUv.y) * (0.45 + 0.55 * vUv.y);',
        '  float streak = n(vec2(vUv.x * 18.0, vUv.y * 2.0 - uTime * 0.05)) * 0.5 + n(vec2(vUv.x * 7.0 + 3.0, vUv.y * 5.0 + uTime * 0.11)) * 0.5;',
        '  float near = smoothstep(0.6, 3.5, length(vV));',
        '  gl_FragColor = vec4(uColor * uPower * uFade * soft * along * near * (0.55 + 0.75 * streak) * 0.16, 1.0);',
        '}'
      ].join('\n'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false
    });
    owned.push(shaftMat);
    const glowMat = new THREE.MeshBasicMaterial({ map: crack, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false, side: THREE.DoubleSide });
    owned.push(glowMat);
    const shafts = [];
    for (const s of P.shafts) {
      const a = new THREE.Vector3(...s.from), b = new THREE.Vector3(...s.to), len = a.distanceTo(b);
      const g = new THREE.CylinderGeometry(s.r0, s.r1, len, 24, 1, true);
      g.translate(0, -len / 2, 0);
      const m = shaftMat.clone(); m.uniforms.uTime = time; m.uniforms.uColor.value.set(s.color); m.uniforms.uPower.value = s.power;
      const mesh = new THREE.Mesh(g, m);
      mesh.position.copy(a);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), b.clone().sub(a).normalize());
      mesh.renderOrder = 5; mesh.frustumCulled = true; mesh.name = 'Shaft';
      mesh.userData.sector = sectorOf(s.from[0], s.from[2]);
      fx.add(mesh); shafts.push(mesh); owned.push(m);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(s.r0 * 3.2, s.r0 * 1.8), glowMat);
      glow.rotation.x = Math.PI / 2; glow.position.copy(a).add(new THREE.Vector3(0, 0.02, 0));
      glow.name = 'CrackGlow'; glow.userData.sector = mesh.userData.sector; fx.add(glow);
    }

    // Dust motes: drift slowly, light up inside the shafts.
    const N = 900, pos = new Float32Array(N * 3), seed = new Float32Array(N);
    const vols = [[P.F1, 0, 1, 1], [P.F2, 0, 1, 0.55]];
    for (let i = 0; i < N; i++) {
      let p;
      if (i < N * 0.45) { // concentrated in the shafts
        const s = P.shafts[i % P.shafts.length], k = rand();
        const r = (s.r0 + (s.r1 - s.r0) * k) * Math.sqrt(rand()), a = rand() * Math.PI * 2;
        p = [s.from[0] + (s.to[0] - s.from[0]) * k + Math.cos(a) * r, s.from[1] + (s.to[1] - s.from[1]) * k, s.from[2] + (s.to[2] - s.from[2]) * k + Math.sin(a) * r];
      } else {
        const [T] = vols[rand() < 0.65 ? 0 : 1], d = T.a + (T.b - T.a) * rand();
        p = T.frame(d, T.grade(d) + 0.3 + rand() * 5.5, (rand() * 2 - 1) * (T.bound - 0.3));
      }
      pos.set(p, i * 3); seed[i] = rand();
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const shaftA = [], shaftB = [];
    for (let i = 0; i < 4; i++) { const s = P.shafts[i] || P.shafts[0]; shaftA.push(new THREE.Vector3(...s.from)); shaftB.push(new THREE.Vector3(...s.to)); }
    const dustMat = new THREE.ShaderMaterial({
      uniforms: { uTime: time, uMap: { value: mote }, uScale: { value: 300 }, uA: { value: shaftA }, uB: { value: shaftB }, uWarm: { value: new THREE.Color(0xffc48a) }, uCold: { value: new THREE.Color(0xbcd0ff) }, uFade: { value: 1 } },
      vertexShader: [
        'attribute float aSeed; uniform float uTime; uniform float uScale; uniform vec3 uA[4]; uniform vec3 uB[4]; varying float vB; varying float vC;',
        'float seg(vec3 p, vec3 a, vec3 b){ vec3 ab = b - a; float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0); return length(p - a - ab * t); }',
        'void main(){',
        '  float t = uTime * (0.6 + aSeed * 0.5) + aSeed * 40.0;',
        '  vec3 p = position + vec3(sin(t * 0.21 + aSeed * 6.3) * 0.45, sin(t * 0.13 + aSeed * 3.1) * 0.35, cos(t * 0.17 + aSeed * 5.7) * 0.45);',
        '  float lit = 0.0;',
        '  for (int i = 0; i < 4; i++) { float d = seg(p, uA[i], uB[i]); lit += exp(-d * d * 1.6); }',
        '  vB = 0.10 + min(lit, 1.4) * 0.9; vC = float(p.y < -9.5);',
        '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
        '  gl_PointSize = clamp(uScale * (0.012 + aSeed * 0.02) / -mv.z, 1.0, 9.0);',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragmentShader: 'uniform sampler2D uMap; uniform vec3 uWarm; uniform vec3 uCold; uniform float uFade; varying float vB; varying float vC; void main(){ float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(mix(uWarm, uCold, vC) * a * vB * 0.55 * uFade, 1.0); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
    });
    owned.push(dustMat);
    const dust = new THREE.Points(dustGeo, dustMat); dust.name = 'DustMotes'; dust.frustumCulled = false; dust.renderOrder = 6;
    fx.add(dust);

    // ---- load: stone sets, reliefs, GLB ----------------------------------
    const cost = { textures: 0, textureMiB: 0, glbMiB: 0, triangles: 0, meshes: 0, ms: 0 };
    const report = { cost, layout: P.layout, warnings: [] };
    async function load(renderer) {
      const t0 = performance.now();
      root.updateWorldMatrix(true, false);
      uniforms.r3W2S.value.copy(root.matrixWorld).invert();
      const base = api.base;
      const aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      const texLoader = new THREE.TextureLoader();
      const tex = (name, srgb, repeat = true) => texLoader.loadAsync(base + DIR + name).then(t => {
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = aniso; t.name = 'R3-01/' + name; owned.push(t);
        cost.textures++; cost.textureMiB += t.image.width * t.image.height * 4 * 1.33 / 1048576;
        return t;
      });
      const sets = {};
      const setNames = [...new Set(materials.map(m => m.userData.r3Set).concat('dust_rubble'))];
      await Promise.all(setNames.map(async n => {
        const [map, normal, orm] = await Promise.all([tex(n + '_albedo.jpg', true), tex(n + '_normal.jpg', false), tex(n + '_orm.jpg', false)]);
        sets[n] = { map, normal, orm };
      }));
      uniforms.r3Dust.value = sets.dust_rubble.map;
      for (const m of materials) {
        const s = sets[m.userData.r3Set];
        Object.assign(m, { map: s.map, normalMap: s.normal, roughnessMap: s.orm, aoMap: s.orm, aoMapIntensity: 0.85, roughness: SET_ROUGH[m.userData.r3Set] / 0.9 });
        m.color.setScalar(SET_GAIN[m.userData.r3Set] || 1);
        m.normalScale.set(SET_NORMAL[m.userData.r3Set], SET_NORMAL[m.userData.r3Set]);
        m.needsUpdate = true;
      }

      // Relief sheet: friezes, bands and moons.
      const reliefTex = {};
      for (const n of ['frieze_offerings', 'frieze_procession', 'band_rosettes', 'band_cuneiform']) {
        const [map, normal] = await Promise.all([tex(n + '_albedo.jpg', true), tex(n + '_normal.jpg', false)]);
        reliefTex[n] = { map, normal };
      }
      const moons = await Promise.all([tex('moons_albedo.png', true, false), tex('moons_normal.jpg', false, false)]);
      const manifest = await fetch(base + DIR + 'manifest.json').then(r => r.json());
      buildPanels(reliefTex, manifest);
      buildBands(reliefTex, manifest);
      buildMoons(moons, manifest.reliefs.moons.pieces);

      // GLB props.
      try { await loadGLB(renderer); }
      catch (error) { report.warnings.push('glb: ' + (error && error.message || error)); console.error('[R3-01] props failed to load', error); }
      group.traverse(o => { if (o.isMesh || o.isPoints) { cost.meshes++; const g = o.geometry; const n = (g.index ? g.index.count : g.attributes.position.count) / 3; if (o.isMesh) cost.triangles += n * (o.isInstancedMesh ? o.count : 1); } });
      cost.textureMiB = +cost.textureMiB.toFixed(1); cost.glbMiB = +cost.glbMiB.toFixed(1);
      cost.ms = Math.round(performance.now() - t0);
      const B = P.A.budget;
      if (B && (cost.textureMiB > B.textureMiB || cost.glbMiB > B.glbMiB)) report.warnings.push('stair dressing over budget');
      return cost;
    }

    function standard(params) { const m = new THREE.MeshStandardMaterial(params); owned.push(m); return m; }
    // Carved friezes: a relief image with its normal map, flush on the wall.
    // Merged per texture and sector: one draw call each.
    function mergeInto(groups, key, geo, matrix) {
      const g = geo.clone().applyMatrix4(matrix); geo.dispose();
      (groups[key] || (groups[key] = [])).push(g);
    }
    function flush(groups, material, name) {
      for (const [key, list] of Object.entries(groups)) {
        const [tex, where] = key.split('|');
        const pos = [], nor = [], uv = [], index = []; let base = 0;
        for (const g of list) {
          pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); uv.push(...g.attributes.uv.array);
          index.push(...Array.from(g.index.array, i => i + base)); base += g.attributes.position.count; g.dispose();
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(index); g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, material(tex)); mesh.name = name + tex; mesh.receiveShadow = true;
        sectors[where].add(mesh);
      }
    }
    const placement = (u, y, v, face) => new THREE.Matrix4().compose(toDress(u, y, v),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawZ(...face)), new THREE.Vector3(1, 1, 1));
    // Carved friezes: a relief image with its normal map, flush on the wall.
    function buildPanels(T, manifest) {
      const mats = {}, groups = {};
      for (const p of P.panels) {
        const h = p.w / manifest.reliefs[p.tex].aspect;
        mergeInto(groups, p.tex + '|' + sectorOf(p.u, p.v), new THREE.PlaneGeometry(p.w, h), placement(p.u, p.y + h / 2, p.v, p.face));
      }
      flush(groups, tex => {
        if (mats[tex]) return mats[tex];
        const m = mats[tex] = patchStone(THREE, standard({ map: T[tex].map, normalMap: T[tex].normal, roughness: 0.93, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 0.55, 0.12);
        m.normalScale.set(1.6, 1.6);
        return m;
      }, 'Frieze_');
    }
    // Sloped registers along both flights (cuneiform dado, rosette cornice).
    function buildBands(T, manifest) {
      const byTex = {}, bandMats = {};
      for (const b of P.bands) {
        const t = T[b.tex], aspect = manifest.reliefs[b.tex].aspect, tile = b.h * aspect;
        const F = b.T, tt = b.side * (F.bound - 0.012);
        // Text and figures read left-to-right for a viewer facing the wall.
        const [tu, tv] = tAxis(F), [du, dv] = dAxis(F);
        const fx = b.side * tu, fz = -b.side * tv; // face (into the corridor) in dress space
        const dir = Math.sign(fz * -du + -fx * dv) || 1;
        const pts = [], uvs = [], idx = [];
        const segs = 24;
        for (let i = 0; i <= segs; i++) {
          const d = F.a + (F.b - F.a) * i / segs, g = F.grade(d);
          const lo = F.frame(d, g + b.y, tt), hi = F.frame(d, g + b.y + b.h, tt);
          pts.push(-lo[0], lo[1], lo[2], -hi[0], hi[1], hi[2]);
          const s = (d - F.a) / tile * dir;
          uvs.push(s, 0, s, 1);
          if (i < segs) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
        }
        const key = b.tex + '|' + (F === P.F1 ? 'F1' : 'F2');
        (byTex[key] || (byTex[key] = [])).push({ pts, uvs, idx });
      }
      for (const [key, parts] of Object.entries(byTex)) {
        const [name, where] = key.split('|');
        const pos = [], uv = [], index = []; let base = 0;
        for (const p of parts) { pos.push(...p.pts); uv.push(...p.uvs); index.push(...p.idx.map(i => i + base)); base += p.pts.length / 3; }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(index); g.computeVertexNormals();
        const t = T[name];
        const mat = bandMats[name] || (bandMats[name] = patchStone(THREE, standard({ map: t.map, normalMap: t.normal, roughness: 0.94, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 0.6, 0.12));
        mat.normalScale.set(1.5, 1.5);
        const mesh = new THREE.Mesh(g, mat); mesh.name = 'Band_' + name; mesh.receiveShadow = true;
        sectors[where].add(mesh);
      }
    }
    // Crescent and moon phases: cut-outs with a cold rim of moonlight.
    function buildMoons([map, normal], pieces) {
      const mat = patchStone(THREE, standard({ map, normalMap: normal, alphaTest: 0.5, roughness: 0.82, metalness: 0, emissive: 0x18306a, emissiveIntensity: 0.0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 0.3, 0.05);
      mat.normalScale.set(1.8, 1.8);
      const strong = mat.clone(); strong.onBeforeCompile = mat.onBeforeCompile; strong.customProgramCacheKey = mat.customProgramCacheKey; strong.emissiveIntensity = 0.22; owned.push(strong);
      const groups = {};
      for (const d of P.decals) {
        const [u0, v0, u1, v1, aspect] = pieces[d.piece];
        const g = new THREE.PlaneGeometry(d.h * aspect, d.h);
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v0 + (v1 - v0) * uv.getY(i));
        mergeInto(groups, (d.glow >= 1 ? 'strong' : 'soft') + '|' + sectorOf(d.u, d.v), g, placement(d.u, d.y + d.h / 2, d.v, d.face));
      }
      flush(groups, kind => kind === 'strong' ? strong : mat, 'Moons_');
    }

    async function loadGLB(renderer) {
      const T = window.THREE, aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      if (!window.MeshoptDecoder) await new Promise((ok, err) => { const s = document.createElement('script'); s.src = api.base + 'vendor/meshopt_decoder.js'; s.onload = ok; s.onerror = err; document.head.appendChild(s); });
      const { KTX2Loader } = await T.loadKTX2Loader();
      const ktx = new KTX2Loader().setTranscoderPath(api.base + 'vendor/basis/').setWorkerLimit(2).detectSupport(renderer);
      const fetchGLB = async (url, loader) => {
        const res = await fetch(window.__sinAsset ? window.__sinAsset(url) : url);
        if (!res.ok) throw new Error(url + ' ' + res.status);
        const buf = await res.arrayBuffer();
        cost.glbMiB += buf.byteLength / 1048576;
        return loader.parseAsync(buf, api.base + 'assets/');
      };
      let gltf, lod = null;
      try {
        const loader = new T.GLTFLoader().setKTX2Loader(ktx).setMeshoptDecoder(window.MeshoptDecoder);
        [gltf, lod] = await Promise.all([
          fetchGLB(api.base + GLB, loader),
          fetchGLB(api.base + DIR + 'props_lod1.glb', new T.GLTFLoader().setMeshoptDecoder(window.MeshoptDecoder)).catch(error => { report.warnings.push('lod: ' + error.message); return null; })
        ]);
      } finally { ktx.dispose(); }
      // Assets keep their quantized geometry untouched: an inner matrix
      // carries the authored node transform and puts the base centre at 0.
      const used = new Set([...P.items.map(i => i.node), ...P.roots.map(r => r.node), 'Masonry_Archway_Large']);
      const prims = node => { const out = []; node.traverse(o => { if (o.isMesh) out.push(o); }); return out; };
      const src = {};
      gltf.scene.updateMatrixWorld(true);
      for (const node of gltf.scene.children) {
        const list = prims(node);
        if (!used.has(node.name)) { list.forEach(o => o.geometry.dispose()); continue; }
        const box = new THREE.Box3(), tmp = new THREE.Box3();
        for (const o of list) { o.geometry.computeBoundingBox(); box.union(tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)); }
        const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
        const shift = new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z);
        for (const o of list) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) if (!m.userData.r3Stone) {
            m.envMap = null; patchStone(THREE, m, /Root/.test(m.name) ? 0 : 0.85, 0.12); owned.push(m);
            for (const k of ['map', 'normalMap', 'aoMap', 'roughnessMap']) if (m[k]) m[k].anisotropy = aniso;
          }
        }
        src[node.name] = { size, levels: [list.map(o => ({ geometry: o.geometry, material: o.material, matrix: shift.clone().multiply(o.matrixWorld) }))] };
      }
      if (lod) {
        lod.scene.updateMatrixWorld(true);
        for (const node of lod.scene.children) {
          const name = node.name.replace(/_LOD1$/, ''), s = src[name];
          const list = prims(node);
          if (!s || list.length !== s.levels[0].length) { list.forEach(o => o.geometry.dispose()); continue; }
          // Primitive order can change in the LOD file: pair by material name.
          const base = s.levels[0];
          const pair = list.map(o => base.find(l => l.material.name === o.material.name));
          if (pair.some(x => !x) || new Set(pair).size !== pair.length) { list.forEach(o => o.geometry.dispose()); report.warnings.push('lod mismatch ' + name); continue; }
          s.levels.push(list.map((o, i) => ({ geometry: o.geometry, material: pair[i].material, matrix: null, world: o.matrixWorld.clone() })));
        }
        lod.scene.traverse(o => { if (o.isMesh && o.material) o.material.dispose(); });
      }
      // LOD1 matrices: the authored level's shift applied to the LOD node's own world matrix.
      for (const [name, s] of Object.entries(src)) {
        if (s.levels.length < 2) continue;
        const node = gltf.scene.children.find(n => n.name === name);
        const box = new THREE.Box3(), tmp = new THREE.Box3();
        prims(node).forEach(o => box.union(tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)));
        const c = box.getCenter(new THREE.Vector3());
        const shift = new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z);
        s.levels[1].forEach(l => { l.matrix = shift.clone().multiply(l.world); });
      }
      const LOD_AT = { Lamassu: 11, Relief: 9, Masonry_Archway: 12, Hanging_Roots: 8, Fluted: 10, Stone_Balustrade: 9, Collapsed: 8, Carved_Rosette: 8, Inscribed_Broken: 7, Fractured: 7 };
      const lodDistance = name => { for (const [k, d] of Object.entries(LOD_AT)) if (name.startsWith(k)) return d; return 0; };
      const add = (name, position, quaternion, scale, opts = {}) => {
        const s = src[name]; if (!s) { report.warnings.push('missing ' + name); return null; }
        const level = l => {
          const g = new THREE.Group();
          for (const p of l) {
            const mesh = new THREE.Mesh(p.geometry, p.material);
            mesh.matrixAutoUpdate = false; mesh.matrix.copy(p.matrix);
            mesh.castShadow = opts.cast !== false; mesh.receiveShadow = true;
            g.add(mesh);
          }
          return g;
        };
        let holder;
        const far = lodDistance(name);
        if (s.levels.length > 1 && far) {
          // Distance is measured in world units: scale by the instance size.
          holder = new THREE.LOD();
          holder.addLevel(level(s.levels[0]), 0);
          holder.addLevel(level(s.levels[1]), far * Math.min(1.5, Math.max(1, Math.abs(scale.x))));
        } else holder = level(s.levels[0]);
        holder.name = name;
        holder.position.copy(position); holder.quaternion.copy(quaternion); holder.scale.copy(scale);
        sector(-position.x, position.z).add(holder);
        return holder;
      };
      const Q = new THREE.Quaternion(), E = new THREE.Euler();
      // Archways: the authored opening (half-width, crown) sets the scale.
      for (const a of P.arches) {
        const along = Math.abs(a.axis[0]) > 0.5; // passage along u
        const sx = a.half / 1.02, sy = (a.top + 0.3) / 2.96, sz = Math.max(0.7, a.depth) / 0.93;
        E.set(0, along ? Math.PI / 2 : 0, 0); Q.setFromEuler(E);
        add('Masonry_Archway_Large', toDress(a.u, a.base - 0.3, a.v), Q, new THREE.Vector3(sx, sy, sz));
      }
      for (const it of P.items) {
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.yaw);
        if (it.tilt) {
          // Slid down the flight: tip about the transverse axis.
          const ax = new THREE.Vector3(it.axis[1], 0, it.axis[0]).normalize();
          q.premultiply(new THREE.Quaternion().setFromAxisAngle(ax, it.tilt));
        }
        add(it.node, toDress(it.u, it.y, it.v), q, new THREE.Vector3(...it.scale), { cast: !/Lamassu/.test(it.node) });
      }
      for (const r of P.roots) {
        const s = src[r.node]; if (!s) continue;
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.yaw);
        add(r.node, toDress(r.u, r.top - s.size.y * r.scale[1], r.v), q, new THREE.Vector3(...r.scale), { cast: true });
      }
    }

    // ---- per frame -------------------------------------------------------
    const scene = () => { let n = root; while (n.parent) n = n.parent; return n.isScene ? n : null; };
    let shared = null, fog = null, blend = 0, last = performance.now();
    const HEMI = 3.3;
    // Near-neutral light: the reference keeps the stone's own ochre ratio,
    // so the warmth comes from the albedo, not from orange light.
    const warmFog = new THREE.Color(0x5b4b3e), coldFog = new THREE.Color(0x2b3850);
    const hemiWarm = new THREE.Color(0xbcbcbc), hemiCold = new THREE.Color(0x8696bd), groundWarm = new THREE.Color(0x9c9082), groundCold = new THREE.Color(0x5a6079);
    function progress(u, v) {
      const F1 = P.F1, F2 = P.F2;
      if (u <= F1.b && Math.abs(v) <= F1.bound + 0.5) return Math.max(0, (u - F1.a) / (F1.b - F1.a)) * 0.55;
      if (v <= F2.a) return 0.55;
      return 0.55 + 0.45 * Math.min(1, (v - F2.a) / (F2.b - F2.a));
    }
    function update(u, y, v, visible, inStair) {
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
      time.value = now / 1000 % 10000;
      const sc = scene();
      if (sc && !shared) {
        shared = (root.parent ? root.parent.children : []).filter(o => o.isLight && !lightRig.children.includes(o))
          .map(l => ({ l, i: l.intensity, c: l.color.clone(), g: l.groundColor ? l.groundColor.clone() : null }));
        fog = new THREE.FogExp2(warmFog.getHex(), 0);
      }
      blend += ((inStair ? 1 : 0) - blend) * Math.min(1, dt * 2.2);
      const p = progress(u, v), k = blend;
      for (const l of lights) {
        let w = 1;
        if (l.userData.r3Warm) w = 1 - 0.75 * Math.min(1, p / 0.6);
        if (l.userData.r3Cold) w = 0.35 + 0.65 * Math.min(1, p / 0.55);
        l.intensity = l.userData.r3Base * w * (visible ? 0.25 + 0.75 * k : 0);
      }
      if (shared) for (const s of shared) {
        if (s.l.isHemisphereLight) {
          const cool = Math.min(1, Math.max(0, (p - 0.35) * 1.6));
          s.l.intensity = s.i + (HEMI - s.i) * k;
          s.l.color.copy(s.c).lerp(hemiWarm.clone().lerp(hemiCold, cool), k);
          s.l.groundColor.copy(s.g).lerp(groundWarm.clone().lerp(groundCold, cool), k);
        } else {
          s.l.intensity = s.i + (0.06 - s.i) * k;
          s.l.color.copy(s.c).lerp(hemiCold, k);
        }
      }
      if (sc && fog) {
        fog.color.copy(warmFog).lerp(coldFog, Math.min(1, p * 1.25));
        fog.density = 0.022 * k;
        if (k > 0.01) { if (sc.fog !== fog) sc.fog = fog; }
        else if (sc.fog === fog) sc.fog = null;
      }
      const showF2 = !(u < P.F1.b - 4.5 && Math.abs(v) < P.F1.bound + 1);
      const showF1 = !(v > P.F2.a + 5.5);
      sectors.F1.visible = showF1; sectors.F2.visible = showF2;
      for (const o of fx.children) if (o.userData.sector) o.visible = o.userData.sector === 'F1' ? showF1 : o.userData.sector === 'F2' ? showF2 : true;
      const fade = visible ? 1 : 0;
      for (const s of shafts) s.material.uniforms.uFade.value = fade * (0.35 + 0.65 * k);
      dustMat.uniforms.uFade.value = fade;
    }

    return {
      load, update, report: () => JSON.parse(JSON.stringify(report)),
      lights, dress, fx
    };
  }
})();
