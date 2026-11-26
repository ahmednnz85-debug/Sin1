/* R3-03 — Mouth of the Abyss: visual dressing (no elevator motion, no story).
   Owner of R3-03's look; the area itself is registered by r3-sealed-zone.js.
     plan()   synchronous, inside SinR3SealedZone.mount: placements and the
              collision volumes of every prop standing on a walkable floor.
     create() lights, blue fog layers, light shafts; load() the assets.
   Assets
     assets/R3_MawOfTheAbyss_Assets.glb   elevator platform, mechanism, chain,
                                          mural, cliff ruins, ruined bridge,
                                          spire, rock formation
     assets/اصول درج السنين.glb            archways, columns, reliefs, rubble,
                                          balustrade — borrowed from the loaded
                                          R3-01 dressing (shared geometry and
                                          materials: no second copy in memory)
     assets/اصول قاعة الختم.glb            lamassu on its inscribed plinth,
                                          broken-drum rubble — borrowed from R3-02
   Stage space (u, y, v); the zone root is mirrored, props live in an
   un-mirrored child so carvings read the right way round. */
(function () {
  'use strict';

  const MAW = 'assets/R3_MawOfTheAbyss_Assets.glb';
  const STAIR_NODES = ['Masonry_Archway_Large', 'Fluted_Stone_Column_Tall', 'Relief_Royal_Procession',
    'Relief_Winged_Guardian_And_Attendants', 'Relief_Moon_Phases_And_Cuneiform', 'Collapsed_Masonry_Rubble_Cluster',
    'Fractured_Inscribed_Slab_Large', 'Fractured_Inscribed_Slab_Small', 'Detached_Rough_Stone_Fragment',
    'Inscribed_Broken_Column_Drum', 'Stone_Balustrade_With_Carved_Plinth'];
  // Authored bounds (metres, base-centred) for synchronous collision planning.
  const SIZE = {
    Masonry_Archway_Large: [3.50, 3.52, 0.93], Fluted_Stone_Column_Tall: [1.30, 3.34, 1.31],
    Relief_Royal_Procession: [4.21, 1.89, 0.34], Relief_Winged_Guardian_And_Attendants: [4.21, 1.93, 0.36],
    Relief_Moon_Phases_And_Cuneiform: [4.21, 1.94, 0.34], Collapsed_Masonry_Rubble_Cluster: [2.62, 0.77, 1.37],
    Fractured_Inscribed_Slab_Large: [1.17, 0.88, 1.60], Fractured_Inscribed_Slab_Small: [0.68, 0.56, 0.91],
    Detached_Rough_Stone_Fragment: [0.86, 0.57, 0.71], Inscribed_Broken_Column_Drum: [0.93, 1.00, 0.93],
    Stone_Balustrade_With_Carved_Plinth: [3.34, 1.07, 0.55],
    guardian: [3.19, 4.72, 1.34], rubble: [5.48, 1.57, 2.42], column: [1.44, 4.70, 1.43]
  };
  // Elevator rig. Dimensions of the Maw kit parts (tools/r3-maw-assets.mjs):
  // chain link half-length to the bend centreline 0.20, wire 0.045, pitch 0.31;
  // platform shackle bow centreline 0.55 above the socket top (1.40), wire 0.042;
  // upper anchor ring bottom 1.085 below the plate top, wire 0.055; mechanism
  // drum underside 1.12 below its top. The mechanism height follows from a
  // whole number of links hanging straight and taut between bow and ring.
  const LINK = { half: 0.20, wire: 0.045, pitch: 0.31 };
  const rig = (() => {
    const R = { platformScale: 1.6, mechScale: [2.05, 1.6, 2.05], chainScale: 1.8, links: 10, anchorScale: 1.3,
      archHalf: 8, archRib: 2.2, archDepth: 3, ceiling: 16.5, terrace: 9.5, platformRing: 6.6 };
    const ps = R.platformScale, cs = R.chainScale, ka = R.anchorScale;
    R.bowTop = ps * (1.40 + 0.55);
    R.firstLink = R.bowTop + 0.042 * ps + (LINK.wire + LINK.half) * cs;
    R.lastLink = R.firstLink + (R.links - 1) * LINK.pitch * cs;
    R.anchorTop = R.lastLink + (LINK.half + LINK.wire) * cs + (0.055 + 1.085) * ka;
    R.mechTop = R.anchorTop + 1.12 * R.mechScale[1];
    return R;
  })();
  // Stage direction (du, dv) the asset's local +z must face -> yaw in the un-mirrored child.
  const yawZ = (du, dv) => Math.atan2(-du, dv);

  function plan(A) {
    const P = { A, items: [], maw: [], far: [], lights: [], shafts: [], fogs: [] };
    const { ledge, bridge, rim, VL, VR, CEIL, corridors: C, landings: L } = A;
    const midV = (VL + VR) / 2;
    if (window.SinR3Stair) {
      const keep = window.SinR3Stair.keep || (window.SinR3Stair.keep = new Set());
      STAIR_NODES.forEach(n => keep.add(n));
    }
    // A prop standing on a floor; collision is its rotated footprint (inset).
    const item = (src, node, u, y, v, face, scale, { solid = true, inset = 0.85, cast = true, tilt = 0 } = {}) => {
      const yaw = yawZ(...face);
      P.items.push({ src, node, u, y, v, yaw, scale, cast, tilt });
      if (!solid) return;
      const [w, h, d] = SIZE[node].map((x, i) => x * scale[i]);
      const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
      const hu = (c * w + s * d) / 2 * inset, hv = (s * w + c * d) / 2 * inset;
      A.collision(u - hu, u + hu, y, y + h, v - hv, v + hv, true);
    };
    const S = k => [k, k, k];

    // ---- corridors: archways at the tunnel thresholds (same fit as R3-01) ----
    const arch = (u, y, v, alongU, half, top) => {
      P.items.push({ src: 'stair', node: 'Masonry_Archway_Large', u, y: y - 0.3, v, yaw: alongU ? Math.PI / 2 : 0,
        scale: [half / 1.02, (top + 0.3) / 2.96, 0.95], cast: false });
      for (const s of [-1, 1]) {
        const t0 = s * half, t1 = s * (half + 0.72), lo = Math.min(t0, t1), hi = Math.max(t0, t1);
        if (alongU) A.collision(u - 0.5, u + 0.5, y - 0.4, y + top, v + lo, v + hi, true);
        else A.collision(u + lo, u + hi, y - 0.4, y + top, v - 0.5, v + 0.5, true);
      }
    };
    const grade = (c, t) => c.y0 + (c.y1 - c.y0) * t;
    arch(C.cross.u, grade(C.cross, 0.25), C.cross.v0 + (C.cross.v1 - C.cross.v0) * 0.25, false, C.cross.half, C.cross.height - 0.72);
    arch((C.jog.u0 + C.jog.u1) / 2, grade(C.jog, 0.5), C.jog.v, true, C.jog.half, C.jog.height - 0.72);
    arch(C.drop.u, grade(C.drop, 0.5), (C.drop.v0 + C.drop.v1) / 2, false, C.drop.half, C.drop.height - 0.72);
    arch(C.mouth.u0 + 1.6, grade(C.mouth, 1.6 / (C.mouth.u1 - C.mouth.u0)), C.mouth.v, true, C.mouth.half, C.mouth.height - 0.9);

    // ---- landings: one relief per wall that faces the walker, rubble in the corners ----
    const [L1, L2, L3] = L;
    item('stair', 'Relief_Moon_Phases_And_Cuneiform', (L1.u0 + L1.u1) / 2, L1.y + 1.05, L1.v0 + 0.2, [0, 1], S(1.25), { solid: false });
    item('stair', 'Inscribed_Broken_Column_Drum', L1.u0 + 1.0, L1.y, L1.v0 + 1.1, [1, 0], S(1.1));
    item('stair', 'Detached_Rough_Stone_Fragment', L1.u0 + 2.1, L1.y, L1.v0 + 0.95, [1, 1], S(1.0));
    item('stair', 'Relief_Winged_Guardian_And_Attendants', L2.u1 - 0.2, L2.y + 1.05, (L2.v0 + L2.v1) / 2, [-1, 0], S(1.25), { solid: false });
    item('stair', 'Collapsed_Masonry_Rubble_Cluster', L2.u1 - 1.2, L2.y, L2.v1 - 0.9, [-1, 0], S(0.95));
    item('stair', 'Relief_Royal_Procession', L3.u0 + 0.2, L3.y + 1.05, (L3.v0 + L3.v1) / 2, [1, 0], S(1.25), { solid: false });
    item('stair', 'Fractured_Inscribed_Slab_Small', L3.u0 + 1.0, L3.y, L3.v0 + 0.9, [1, 0.4], S(1.1));
    item('stair', 'Fractured_Inscribed_Slab_Large', L3.u0 + 2.4, L3.y, L3.v0 + 1.0, [0.3, 1], S(1.0), { tilt: 0.06 });

    // ---- overlook hall ----
    P.wayItems = P.items.length;
    const { PU, PV } = A;
    P.platform = { u: PU, v: PV, y: ledge, yaw: yawZ(-1, 0), scale: rig.platformScale };
    // Round platform: five boxes follow the 5.8 m disc and its corner posts
    // closely, so the 2 m passages between platform and arch piers stay open.
    for (const [hu, hv] of [[5.9, 1.8], [5.4, 3.2], [4.5, 4.5], [3.2, 5.4], [1.8, 5.9]]) A.collision(PU - hu, PU + hu, ledge, ledge + 2.6, PV - hv, PV + hv, true);
    P.mechanism = { u: PU, v: PV, y: ledge + rig.mechTop, yaw: yawZ(-1, 0) + Math.PI / 6, scale: rig.mechScale };
    // Left side (screen left looking at the abyss is +v): blind arcade, lamassu
    // on its inscribed plinth beside the great arch, inscribed column in front.
    for (const u of [bridge + 4.2, bridge + 10.4]) {
      P.items.push({ src: 'stair', node: 'Masonry_Archway_Large', u, y: ledge - 0.3, v: VR - 0.5, yaw: yawZ(0, -1), scale: [2.1, 2.3, 1.1], cast: false });
    }
    item('hall', 'guardian', PU - 6.8, ledge, PV + 9.6, [1, 0], [1.45, 1.45, 1.45], { inset: 0.8 });
    item('hall', 'column', bridge + 1.9, ledge, VR - 1.6, [1, 0], [1.25, 1.8, 1.25], { inset: 0.7 });
    item('hall', 'column', bridge + 1.9, ledge, VL + 1.6, [1, 0], [1.25, 1.8, 1.25], { inset: 0.7 });
    // Right wall: the procession mural (Maw kit) and the winged-guardian relief.
    P.maw.push({ node: 'Abyss_Mural_Fragment', u: bridge + 6.0, y: ledge, v: VL + 0.3, yaw: yawZ(0, 1), scale: 1.25 });
    A.collision(bridge + 3.3, bridge + 8.7, ledge, ledge + 4.7, VL, VL + 0.7, true);
    item('stair', 'Relief_Winged_Guardian_And_Attendants', bridge + 12.2, ledge + 2.6, VL + 0.2, [0, 1], S(1.6), { solid: false });
    // Curved balustrade around the terrace (the reference's ring beyond the platform).
    const ring = A.rim - PU - 0.35, pieces = 9;
    for (let i = 0; i < pieces; i++) {
      const t = -Math.PI / 2 + Math.PI * (i + 0.5) / pieces;
      const len = 2 * ring * Math.sin(Math.PI / pieces / 2);
      item('stair', 'Stone_Balustrade_With_Carved_Plinth', PU + ring * Math.cos(t), ledge, PV + ring * Math.sin(t),
        [-Math.cos(t), -Math.sin(t)], [len / 3.34 * 1.02, 1.05, 1.1], { inset: 0.95 });
    }
    // Rubble: left foreground (reference), a slab against the right pier.
    item('hall', 'rubble', bridge + 2.6, ledge - 0.05, VR - 4.6, [1, 0.3], S(0.6));
    item('stair', 'Collapsed_Masonry_Rubble_Cluster', bridge + 1.6, ledge, VR - 7.2, [1, 0], S(1.1));
    item('stair', 'Detached_Rough_Stone_Fragment', bridge + 3.9, ledge, VR - 6.4, [1, 0.4], S(1.1));
    item('stair', 'Fractured_Inscribed_Slab_Large', A.A0 - 2.2, ledge, VL + 2.2, [-1, 0.5], S(1.0), { tilt: 0.1 });

    // ---- the abyss beyond the great arch (no collision: out of reach) ----
    const g = (node, du, dy, dv, scale, face, extra = {}) =>
      P.far.push({ node, u: rim + du, y: ledge + dy, v: midV + dv, yaw: yawZ(...face), scale, ...extra });
    // Composition after the reference: dark cliff walls frame a deep gorge,
    // arcaded ruins high on both sides, aqueducts across the far chasm,
    // spires rising out of the mist, the end wall lost in the haze.
    // Gorge walls close enough to fill the great arch from both sides and
    // to rise above its crown (the reference's dark cliffs and cave roof).
    g('Abyss_Rock_Formation', 24, -62, -25, [3.0, 6.0, 3.0], [0, 1]);
    g('Abyss_Rock_Formation', 28, -64, 24, [3.0, 6.0, 3.0], [0, -1]);
    // Rock roof of the cavern seen through the top of the arch (inverted massif).
    g('Abyss_Rock_Formation', 70, 72, 0, [5.0, 1.25, 4.2], [1, 0], { flip: true });
    // Below the rim: the face of the cliff dropping into the mist.
    g('Abyss_Rock_Formation', -14, -74, 0, 3.3, [1, 0]);
    // Mid-distance walls, receding and narrowing the gorge.
    g('Abyss_Rock_Formation', 78, -66, -33, [3.4, 4.6, 3.4], [0.4, 1]);
    g('Abyss_Rock_Formation', 92, -64, 32, [3.5, 4.6, 3.5], [0.3, -1]);
    // Arcaded ruins on ledges of the walls: low on the left, high on the right.
    g('Abyss_Cliff_Ruins', 52, -24, -19, 1.9, [0.4, 1]);
    g('Abyss_Cliff_Ruins', 84, -10, 20, 2.1, [0.3, -1]);
    // Spires rising from the mist in the middle of the gorge.
    g('Abyss_Rock_Spire', 44, -58, -6, [3.0, 3.6, 3.0], [1, 0]);
    g('Abyss_Rock_Spire', 74, -60, 8, [3.2, 3.8, 3.2], [-1, 0.2]);
    // Aqueducts: one springing from the left wall, broken mid-gorge; one far and high.
    g('Abyss_Bridge_Ruined', 70, -18, -12, 2.3, [1, 0]);
    g('Abyss_Bridge_Ruined', 128, -6, 4, 2.6, [1, 0.1]);
    // End of the gorge, deep in the haze.
    g('Abyss_Rock_Formation', 165, -72, -2, [4.4, 5.0, 4.4], [-1, 0]);

    // ---- lights: few, local, cheap; each lit only in its zone ----
    // key: cold moonlight from above the chasm onto the platform (static shadow)
    P.lights.push({ zone: 'hall', type: 'spot', color: 0xc6dcff, intensity: 3400, distance: 80, angle: 0.4, penumbra: 0.6,
      pos: [rim + 20, ledge + 32, midV - 4], target: [A.PU, ledge + 1, A.PV], shadow: true });
    // backlight from the far end of the gorge: rims the cliffs, ruins and aqueducts
    P.lights.push({ zone: 'hall', type: 'spot', color: 0x8cbcff, intensity: 90000, distance: 300, angle: 0.62, penumbra: 0.9,
      pos: [rim + 175, ledge + 70, midV], target: [rim + 35, ledge - 22, midV] });
    // pool of light on the deck under the mechanism (the reference's bright centre)
    P.lights.push({ zone: 'hall', type: 'spot', color: 0xfff0dc, intensity: 520, distance: 16, angle: 0.62, penumbra: 0.8,
      pos: [A.PU, ledge + rig.mechTop - 2.36 * rig.mechScale[1] - 0.4, A.PV], target: [A.PU, ledge, A.PV] });
    // warm fill in the hall and on the lamassu
    P.lights.push({ zone: 'hall', type: 'point', color: 0xffeedd, intensity: 300, distance: 24, pos: [A.PU - 8, ledge + 4.2, midV] });
    P.lights.push({ zone: 'hall', type: 'point', color: 0xffe2c2, intensity: 70, distance: 12, pos: [A.PU - 10.5, ledge + 5.5, VR - 9] });
    for (const [Lx, color] of [[L1, 0xffc58d], [L2, 0xffd2a4], [L3, 0xb4c8f0]])
      P.lights.push({ zone: 'way', type: 'point', color, intensity: 120, distance: 13, pos: [(Lx.u0 + Lx.u1) / 2, Lx.y + 3.8, (Lx.v0 + Lx.v1) / 2] });
    // shafts falling into the chasm (as in the reference)
    for (const [du, dv, r0, r1, power] of [[16, -10, 1.2, 4.5, 1.0], [34, 9, 1.0, 4.0, 0.8], [55, -4, 1.6, 6.0, 0.9], [88, 6, 1.4, 6.5, 0.7]])
      P.shafts.push({ from: [rim + du, ledge + 46, midV + dv], to: [rim + du + 6, ledge - 30, midV + dv * 0.6], r0, r1, power });
    // the glowing mist of the gorge bottom seen at the horizon (reference centre)
    P.glow = { u: rim + 118, y: ledge - 14, v: midV, w: 150, h: 70 };
    // fog strata in the chasm, densest at the bottom
    for (const [dy, alpha, size] of [[-42, 0.92, 1], [-33, 0.45, 1], [-26, 0.18, 0.9]])
      P.fogs.push({ y: ledge + dy, alpha, u0: rim + 2, u1: rim + 210, v0: midV - 70 * size, v1: midV + 70 * size });
    return P;
  }

  function create(THREE, root, group, P) {
    const T = THREE, A = P.A;
    const owned = [];
    const dress = new T.Group(); dress.name = 'R3-03_Dressing'; dress.scale.x = -1; group.add(dress);
    // Corridor props and the overlook (hall, elevator, gorge) are shown by zone.
    const wayDress = new T.Group(); wayDress.name = 'R3-03_Corridors'; dress.add(wayDress);
    const hallDress = new T.Group(); hallDress.name = 'R3-03_Overlook'; dress.add(hallDress);
    const far = new T.Group(); far.name = 'R3-03_Abyss'; hallDress.add(far);
    const fx = new T.Group(); fx.name = 'R3-03_Atmosphere'; group.add(fx);
    const lightRig = new T.Group(); lightRig.name = 'R3-03_Lights'; root.add(lightRig); lightRig.visible = false;
    const D = (u, y, v) => new T.Vector3(-u, y, v);
    const time = { value: 0 };
    const report = { warnings: [], cost: {} };
    let installed = false;
    const decay = T.ShaderChunk.lights_pars_begin.includes('decayExponent < 0.0') ? -2 : 2;

    // ---- lights ----
    const lights = P.lights.map(L => {
      const light = L.type === 'spot'
        ? new T.SpotLight(L.color, L.intensity, L.distance, L.angle, L.penumbra, decay)
        : new T.PointLight(L.color, L.intensity, L.distance, decay);
      light.position.set(...L.pos);
      if (L.target) { light.target.position.set(...L.target); lightRig.add(light.target); }
      if (L.shadow) {
        light.castShadow = true;
        light.shadow.mapSize.set(1024, 1024);
        light.shadow.camera.near = 8; light.shadow.camera.far = L.distance;
        light.shadow.bias = -0.0005; light.shadow.normalBias = 0.04;
        light.shadow.autoUpdate = false;                    // static scene: rendered once
      }
      light.userData.base = L.intensity; light.userData.zone = L.zone;
      lightRig.add(light);
      return light;
    });

    // ---- blue fog strata: large soft quads, scrolling noise, depth-faded ----
    const fogMat = new T.ShaderMaterial({
      uniforms: { uTime: time, uColor: { value: new T.Color(0x2f6fa3) }, uAlpha: { value: 1 }, uFade: { value: 1 } },
      vertexShader: 'varying vec2 vUv; varying vec3 vW; varying float vDepth; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: [
        'uniform float uTime; uniform vec3 uColor; uniform float uAlpha; uniform float uFade; varying vec2 vUv; varying vec3 vW; varying float vDepth;',
        'float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }',
        'float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }',
        'void main(){',
        '  vec2 p = vW.xz * 0.035;',
        '  float m = n(p + vec2(uTime * 0.012, 0.0)) * 0.55 + n(p * 2.3 - vec2(0.0, uTime * 0.02)) * 0.3 + n(p * 5.1 + uTime * 0.03) * 0.15;',
        '  float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.85, vUv.x) * smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.8, vUv.y);',
        '  float near = smoothstep(4.0, 30.0, vDepth);',
        '  float a = clamp(uAlpha * edge * near * (0.35 + 0.9 * m), 0.0, 1.0) * uFade;',
        '  gl_FragColor = vec4(uColor * (0.75 + 0.5 * m), a);',
        '}'
      ].join('\n'),
      transparent: true, depthWrite: false, side: T.DoubleSide, fog: false
    });
    owned.push(fogMat);
    const fogs = P.fogs.map((F, i) => {
      const geo = new T.PlaneGeometry(F.u1 - F.u0, F.v1 - F.v0);
      geo.rotateX(-Math.PI / 2);
      const m = fogMat.clone(); m.uniforms.uTime = time; m.uniforms.uAlpha.value = F.alpha;
      m.uniforms.uColor.value.set([0x3e7298, 0x2f6185, 0x2a5574][i] || 0x2a5574);
      const mesh = new T.Mesh(geo, m);
      mesh.position.set((F.u0 + F.u1) / 2, F.y, (F.v0 + F.v1) / 2);
      mesh.renderOrder = 4 + i; mesh.name = 'AbyssFog'; mesh.frustumCulled = false;
      fx.add(mesh); owned.push(m, geo);
      return mesh;
    });

    // ---- horizon mist glow: one vertical gradient sheet behind the spires ----
    if (P.glow) {
      const G = P.glow;
      const geo = new T.PlaneGeometry(G.w, G.h);
      geo.rotateY(Math.PI / 2);
      const glowMat = new T.ShaderMaterial({
        uniforms: { uTime: time, uFade: { value: 1 } },
        vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }',
        fragmentShader: [
          'uniform float uTime; uniform float uFade; varying vec2 vUv; varying vec3 vW;',
          'float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }',
          'float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }',
          'void main(){',
          '  float y = vUv.y;',
          '  float band = exp(-pow((y - 0.22) * 4.2, 2.0));',
          '  float side = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);',
          '  float m = n(vec2(vW.z * 0.06 + uTime * 0.01, vW.y * 0.12)) * 0.6 + 0.4;',
          '  vec3 c = mix(vec3(0.10, 0.30, 0.50), vec3(0.45, 0.75, 0.95), band);',
          '  gl_FragColor = vec4(c * band * side * m * 0.75 * uFade, 1.0);',
          '}'
        ].join('\n'),
        transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false
      });
      const glow = new T.Mesh(geo, glowMat);
      glow.position.set(G.u, G.y, G.v); glow.name = 'AbyssHorizonGlow'; glow.renderOrder = 3;
      fx.add(glow); owned.push(glowMat, geo);
      fogs.push(glow);
    }
    // ---- light shafts (open cones, soft silhouettes) ----
    const shaftMat = new T.ShaderMaterial({
      uniforms: { uTime: time, uColor: { value: new T.Color(0x9cc4ff) }, uPower: { value: 1 }, uFade: { value: 1 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec2 vUv; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }',
      fragmentShader: [
        'uniform float uTime; uniform vec3 uColor; uniform float uPower; uniform float uFade; varying vec3 vN; varying vec3 vV; varying vec2 vUv;',
        'float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }',
        'float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }',
        'void main(){',
        '  float soft = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);',
        '  float along = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.7, vUv.y);',
        '  float streak = n(vec2(vUv.x * 16.0, vUv.y * 2.0 - uTime * 0.04)) * 0.6 + 0.4;',
        '  gl_FragColor = vec4(uColor * uPower * uFade * soft * along * streak * 0.2, 1.0);',
        '}'
      ].join('\n'),
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false
    });
    owned.push(shaftMat);
    const shafts = P.shafts.map(s => {
      const a = new T.Vector3(...s.from), b = new T.Vector3(...s.to), len = a.distanceTo(b);
      const geo = new T.CylinderGeometry(s.r0, s.r1, len, 20, 1, true);
      geo.translate(0, -len / 2, 0);
      const m = shaftMat.clone(); m.uniforms.uTime = time; m.uniforms.uPower.value = s.power;
      const mesh = new T.Mesh(geo, m);
      mesh.position.copy(a);
      mesh.quaternion.setFromUnitVectors(new T.Vector3(0, -1, 0), b.clone().sub(a).normalize());
      mesh.renderOrder = 9; mesh.name = 'AbyssShaft';
      fx.add(mesh); owned.push(m, geo);
      return mesh;
    });

    // ---- loading ----
    async function loadMaw(renderer) {
      const W = window.THREE;
      const url = p => { const f = (window.SinR3Stair?.base || '') + p; return window.__sinAsset ? window.__sinAsset(f) : f; };
      if (!window.MeshoptDecoder) await new Promise((ok, err) => { const s = document.createElement('script'); s.src = url('vendor/meshopt_decoder.js'); s.onload = ok; s.onerror = err; document.head.appendChild(s); });
      const { KTX2Loader } = await W.loadKTX2Loader();
      const ktx = new KTX2Loader().setTranscoderPath(url('vendor/basis/')).setWorkerLimit(2).detectSupport(renderer);
      try {
        const res = await fetch(url(MAW));
        if (!res.ok) throw new Error('Maw GLB HTTP ' + res.status);
        const buf = await res.arrayBuffer();
        report.cost.glbMiB = +(buf.byteLength / 1048576).toFixed(1);
        return await new W.GLTFLoader().setKTX2Loader(ktx).setMeshoptDecoder(window.MeshoptDecoder).parseAsync(buf, url('assets/'));
      } finally { ktx.dispose(); }
    }

    // A borrowed prop: [{ geometry, material, matrix }] with its base centred at 0.
    const LOD_AT = { Relief: 9, Masonry_Archway: 12, Fluted: 10, Stone_Balustrade: 9, Collapsed: 8, Inscribed_Broken: 7, Fractured: 7, Detached: 6 };
    function placeBorrowed(src, it) {
      const level = parts => {
        const g = new T.Group();
        for (const p of parts) {
          const mesh = new T.Mesh(p.geometry, p.material);
          mesh.matrixAutoUpdate = false; mesh.matrix.copy(p.matrix);
          mesh.castShadow = it.cast !== false; mesh.receiveShadow = true;
          g.add(mesh);
        }
        return g;
      };
      const key = Object.keys(LOD_AT).find(k => it.node.startsWith(k));
      let g;
      if (src.levels && src.levels.length > 1 && src.levels[1][0].matrix && key) {
        // Same switch distance as R3-01, in world units of the scaled instance.
        g = new T.LOD();
        g.addLevel(level(src.levels[0]), 0);
        g.addLevel(level(src.levels[1]), LOD_AT[key] * Math.min(2.5, Math.max(1, Math.max(...it.scale))));
      } else g = level(src.parts);
      g.name = it.node;
      g.position.copy(D(it.u, it.y, it.v));
      g.quaternion.setFromEuler(new T.Euler(it.tilt || 0, it.yaw, 0, 'YXZ'));
      g.scale.set(...it.scale);
      (it.way ? wayDress : hallDress).add(g);
      return g;
    }

    function tuneMaw(gltf, renderer) {
      const aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      gltf.scene.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = o.receiveShadow = true;
        const m = o.material;
        // No environment map in R3: metal reads through its diffuse share.
        if (m.metalness > 0.5) m.metalness = /Bronze/.test(m.name) ? 0.55 : 0.35;
        for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap']) if (m[k]) m[k].anisotropy = aniso;
      });
    }

    function placeMaw(gltf) {
      const byName = n => gltf.scene.getObjectByName(n);
      const used = new Set();
      const put = (node, it, parent = hallDress) => {
        const src = byName(node); if (!src) { report.warnings.push('missing ' + node); return null; }
        used.add(node);
        const o = src.clone(true);
        o.position.copy(D(it.u, it.y, it.v));
        o.rotation.set(it.flip ? Math.PI : 0, it.yaw, 0);
        if (Array.isArray(it.scale)) o.scale.set(...it.scale); else o.scale.setScalar(it.scale);
        parent.add(o);
        return o;
      };
      const plat = put('Elevator_Platform', P.platform);
      const mech = put('Elevator_Mechanism', P.mechanism);
      for (const it of P.maw) put(it.node, it);
      // The gorge is seen in cold light and haze: its stone takes a blue-grey
      // tint (own material copies; the platform keeps the warm originals).
      const cold = new Map(), tint = new T.Color(0x6a7d99);
      for (const it of P.far) {
        const o = put(it.node, it, far);
        if (o) o.traverse(m => {
          if (!m.isMesh) return;
          m.castShadow = false; m.receiveShadow = false;
          if (!cold.has(m.material)) { const c = m.material.clone(); c.color.multiply(tint); c.name += '/cold'; cold.set(m.material, c); }
          m.material = cold.get(m.material);
        });
      }
      // Chains, hung taut and straight: each corner shackle bow carries the
      // bottom link; links alternate 90°; the top link hooks the ring of an
      // upper anchor bolted under the mechanism drum, directly above. The
      // bottom link stands across the bow plane and the anchor ring across
      // the top link, as real interlocking hardware does.
      const chainRoot = byName('Elevator_Chain'), anchorSrc = byName('Elevator_Anchor_Upper');
      if (chainRoot && anchorSrc && plat && mech) {
        const linkPivot = byName('Elevator_Chain_Link_01');
        let linkMesh = null; linkPivot.traverse(o => { if (o.isMesh && !linkMesh) linkMesh = o; });
        gltf.scene.updateMatrixWorld(true);
        const inner = new T.Matrix4().copy(linkPivot.matrixWorld).invert().multiply(linkMesh.matrixWorld);
        const cs = rig.chainScale, pitch = LINK.pitch * cs;
        dress.updateMatrixWorld(true);
        const toDress = new T.Matrix4().copy(dress.matrixWorld).invert();
        const shackles = [];
        plat.traverse(o => { if (/^Elevator_Platform_Shackle_[A-Z]+$/.test(o.name)) shackles.push(o); });
        const iron = linkMesh.material.clone();
        iron.color.multiplyScalar(0.2); iron.roughness = Math.min(1, iron.roughness + 0.3); iron.metalness = 0.45;
        iron.name = 'R3-03/ChainIron';
        const inst = new T.InstancedMesh(linkMesh.geometry, iron, shackles.length * rig.links);
        inst.name = 'Elevator_Chain_Instanced'; inst.castShadow = true; inst.receiveShadow = true;
        const m = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3().setScalar(cs), up = new T.Vector3(0, 1, 0);
        let k = 0;
        report.chains = [];
        for (const o of shackles) {
          const M = o.matrixWorld.clone().premultiply(toDress);
          const bow = new T.Vector3(0, 0.55, 0).applyMatrix4(M);
          const ex = new T.Vector3(1, 0, 0).transformDirection(M);
          const base = bow.y - rig.bowTop;                      // platform floor level
          const theta0 = Math.atan2(ex.x, ex.z);
          for (let j = 0; j < rig.links; j++) {
            q.setFromAxisAngle(up, theta0 + j * Math.PI / 2);
            m.compose(new T.Vector3(bow.x, base + rig.firstLink + j * pitch, bow.z), q, sc).multiply(inner);
            inst.setMatrixAt(k++, m);
          }
          const anchor = anchorSrc.clone(true);
          anchor.position.set(bow.x, base + rig.anchorTop, bow.z);
          anchor.rotation.set(0, theta0 + (rig.links - 1) * Math.PI / 2 + Math.PI / 2, 0);
          anchor.scale.setScalar(rig.anchorScale);
          anchor.name = 'Elevator_Anchor_Upper_' + o.name.split('_').pop();
          hallDress.add(anchor);
          report.chains.push({ shackle: o.name, x: +bow.x.toFixed(2), z: +bow.z.toFixed(2), from: +(base + rig.firstLink).toFixed(2), to: +(base + rig.lastLink).toFixed(2), anchorTop: +(base + rig.anchorTop).toFixed(2) });
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        hallDress.add(inst);
        used.add('Elevator_Chain'); used.add('Elevator_Anchor_Upper');
      }
      // Drop everything the scene does not use (textures shared with used meshes stay).
      const keep = window.SinR3SealedZone.resources([dress]);
      const all = window.SinR3SealedZone.resources([gltf.scene]);
      window.SinR3SealedZone.release(all, keep);
    }

    let stairLights = null;
    async function load(renderer, { stair, hall }) {
      const t0 = performance.now();
      stairLights = stair?.lights || null;
      const missing = [];
      const weathered = new Map(), dim = new T.Color(0.66, 0.63, 0.6);
      for (const [index, it] of P.items.entries()) {
        it.way = index < P.wayItems;
        let src = it.src === 'stair' ? stair?.borrow?.(it.node) : hall?.borrow?.(it.node);
        if (!src) { missing.push(it.node); continue; }
        if (it.src === 'hall') {
          // The reference's lamassu and columns are darker, weathered stone:
          // material copies here, geometry and textures stay shared with R3-02.
          src = { ...src, parts: src.parts.map(p => {
            if (!weathered.has(p.material)) { const c = p.material.clone(); c.color.multiply(dim); c.name += '/R3-03'; weathered.set(p.material, c); }
            return { ...p, material: weathered.get(p.material) };
          }) };
        }
        placeBorrowed(src, it);
      }
      if (missing.length) report.warnings.push('borrow missing: ' + [...new Set(missing)].join(', '));
      const gltf = await loadMaw(renderer);
      tuneMaw(gltf, renderer);
      placeMaw(gltf);
      // R3-03 stone in the reference's cooler grey-brown (own material instances).
      const greyStone = new T.Color(0.86, 0.86, 0.9);
      for (const node of group.children) if (node.isMesh && node.material?.userData?.r3Stone) node.material.color.multiply(greyStone);
      // The generated cliff placeholders are replaced by the real abyss.
      for (const node of group.children.filter(n => n.isMesh && n.name === 'Shaft')) {
        node.removeFromParent(); node.geometry.dispose();
      }
      const res = window.SinR3SealedZone.resources([dress]);
      let tex = 0;
      for (const t of res.textures) {
        if (t.mipmaps?.length) tex += t.mipmaps.reduce((a, l) => a + (l.data?.byteLength || 0), 0);
        else tex += (t.image?.width || 0) * (t.image?.height || 0) * 16 / 3;
      }
      let tris = 0;
      const byNode = {};
      for (const top of [...wayDress.children, ...hallDress.children, ...far.children]) {
        let n = 0;
        top.traverse(o => { if (o.isMesh && (!o.parent?.isLOD || o.parent.levels[0].object === o || o.parent.levels.length === 0)) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); });
        if (top === far) continue;
        byNode[top.name] = (byNode[top.name] || 0) + Math.round(n);
        tris += n;
      }
      report.cost.byNode = byNode;
      Object.assign(report.cost, { items: P.items.length - missing.length, far: P.far.length, textureMiB: +(tex / 1048576).toFixed(1), triangles: Math.round(tris), ms: Math.round(performance.now() - t0) });
      installed = true;
      return report.cost;
    }

    // ---- per frame ----
    const sceneOf = () => { let n = root; while (n.parent) n = n.parent; return n.isScene ? n : null; };
    const fogColor = new T.Color(0x16283a), bgColor = new T.Color(0x0b1622);
    const fog = new T.FogExp2(fogColor.getHex(), 0.0);
    const hemiSky = new T.Color(0xa9b9d2), hemiGround = new T.Color(0x463d36), dirCold = new T.Color(0xb8cdf0);
    let savedBg;
    let shared = null, blend = 0, last = performance.now(), shadowDone = false;
    function update(u, y, v, visible, inside) {
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
      time.value = now / 1000 % 10000;
      const sc = sceneOf();
      if (sc && !shared) shared = (root.parent ? root.parent.children : []).filter(o => o.isLight)
        .map(l => ({ l, i: l.intensity, c: l.color.clone(), g: l.groundColor ? l.groundColor.clone() : null }));
      blend += ((inside ? 1 : 0) - blend) * Math.min(1, dt * 2.5);
      if (inside && blend < 0.02) blend = 0.02;
      const k = blend, on = k > 0.01 && installed;
      lightRig.visible = on;
      // The overlook is in sight from the last landing (down the mouth tunnel) onward.
      const overlook = u > A.bridge - 1 || (u > A.bridge - 12 && v < -12.5);
      fx.visible = on && visible && overlook;
      hallDress.visible = on && visible && overlook;
      far.visible = true;
      wayDress.visible = on && visible && u < A.bridge + 2;
      // Outside the overlook hall only the near end of the chasm can be seen.
      const view = Math.min(1, Math.max(0, (u - A.bridge + 6) / 8));
      // Corridors and the overlook hall never see each other's lights.
      const zone = u > A.bridge - 4 ? 'hall' : 'way';
      for (const l of lights) { l.visible = l.userData.zone === zone || (u > A.bridge - 8 && u < A.bridge); l.intensity = l.userData.base * k; }
      // R3-01's rig contributes nothing here (its intensities are 0): skip it in the shaders.
      if (stairLights) for (const l of stairLights) l.visible = !on;
      for (const f of fogs) f.material.uniforms.uFade.value = k * (0.3 + 0.7 * view);
      for (const s of shafts) s.material.uniforms.uFade.value = k * (0.35 + 0.65 * view);
      if (on && !shadowDone) { const key = lights.find(l => l.castShadow); if (key) key.shadow.needsUpdate = true; shadowDone = true; }
      if (shared && on) for (const s of shared) {
        if (s.l.isHemisphereLight) {
          s.l.intensity = s.i + (2.5 - s.i) * k;
          s.l.color.copy(s.c).lerp(hemiSky, k);
          s.l.groundColor.copy(s.g).lerp(hemiGround, k);
        } else {
          s.l.intensity = s.i + (0.12 - s.i) * k;
          s.l.color.copy(s.c).lerp(dirCold, k);
        }
      } else if (shared && !inside && !window.SinR3Stair) for (const s of shared) {
        s.l.intensity = s.i; s.l.color.copy(s.c); if (s.g) s.l.groundColor.copy(s.g);
      }
      if (sc) {
        // Thin in the corridors, deeper blue haze toward the chasm.
        fog.density = (0.004 + 0.0035 * view) * k;
        fog.color.copy(fogColor);
        if (on) {
          if (sc.fog !== fog) sc.fog = fog;
          if (savedBg === undefined) savedBg = sc.background;
          sc.background = bgColor;
        } else {
          if (sc.fog === fog) sc.fog = null;
          if (savedBg !== undefined && sc.background === bgColor) { sc.background = savedBg; savedBg = undefined; }
        }
      }
    }

    return { load, update, report: () => JSON.parse(JSON.stringify(report)), ready: () => installed, dress, fx, lightRig };
  }

  window.SinR3Abyss = { plan, create, rig };
})();
