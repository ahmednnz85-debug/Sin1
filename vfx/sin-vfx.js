/* Sîn Advanced VFX Engine — window.SinVFX
   ---------------------------------------------------------------------------
   Reusable, data-driven effects for Sîn: Curse of Babylon. Classic script that
   reads window.THREE (like every other game module). The game does not load it
   yet: it is developed and approved in the VFX Laboratory (vfx-lab.html) first.

   const vfx = await SinVFX.create({ renderer, scene, camera, base: '', quality: 'auto' });
   vfx.registerRig('guardian', { sockets, rails, bones, materials });
   const h = vfx.play('GUARDIAN_STAFF_GROUND_SLAM', {
     position, normal, direction, scale, intensity, duration, strength,
     rig: 'guardian', socket: 'staff_blade', surface: 'stone', seed });
   vfx.impact({ weapon: 'axe', surface: 'armor', position, normal, velocity, strength });
   per frame:  vfx.update(dtScaled);  vfx.render();   (render replaces renderer.render)

   Systems (all pooled and preallocated, nothing is created while playing):
     particles  GPU instanced quads, analytic drag+gravity motion, velocity stretch,
                colour/size over lifetime, dissolve, soft depth fade (3 pools:
                additive emissive, alpha dust, distortion)
     trails     ribbon meshes sampled from several tracking points of the real weapon
     shockwave  animated ground rings, rising energy walls, distortion rings
     decals     projected on the depth buffer (no change to the floor geometry)
     debris     instanced irregular stone chunks, simple physics with bounce/rest
     lights     a fixed set of point lights (constant light count: no recompiles)
     composite  scene → HDR target with depth; VFX layer; localized bloom of the
                VFX layer; heat distortion; tone mapping. Low tier: forward path.
   Definitions: vfx/effects/*.json. Shaders: vfx/shaders/*.glsl. Textures: assets/vfx. */
(function (root) {
  'use strict';
  const VERSION = '1.0.0';

  // ------------------------------------------------------------------ quality tiers
  const TIERS = {
    high:   { pipeline: 'composite', vfxScale: 1.0,  msaa: 4, bloom: 2, distortion: true,  density: 1.0,  debris: 1.0,  lights: 2, decals: 10, subdiv: 4, atlas: 'full', shadows: true,  capAdd: 6144, capAlpha: 1536, capDist: 384 },
    medium: { pipeline: 'composite', vfxScale: 0.75, msaa: 0, bloom: 1, distortion: true,  density: 0.65, debris: 0.6,  lights: 1, decals: 6,  subdiv: 3, atlas: 'full', shadows: false, capAdd: 4096, capAlpha: 1024, capDist: 256 },
    low:    { pipeline: 'forward',   vfxScale: 1.0,  msaa: 0, bloom: 0, distortion: false, density: 0.4,  debris: 0.35, lights: 0, decals: 4,  subdiv: 2, atlas: 'low',  shadows: false, capAdd: 2048, capAlpha: 512,  capDist: 1 }
  };
  const ORIENT = { billboard: 0, normal: 1, plane: 1, swing: 1, velocity: 2, axial: 3 };
  const RAMP_ROWS = ['spark', 'gold', 'moon', 'dust', 'ember', 'seal'];
  // ramp rows are stored top-down in vfx-ramps.png; textures upload with flipY, so row i sits at v = 1 - (i + 0.5) / 16
  const rampV = name => { const i = RAMP_ROWS.indexOf(name); return i < 0 ? -1 : 1 - (i + 0.5) / 16; };

  function detectTier(renderer) {
    const nav = root.navigator || {};
    const ua = nav.userAgent || '';
    const mobile = /iPhone|iPad|Android|Mobile/i.test(ua) || (nav.maxTouchPoints > 1 && /Mac/.test(nav.platform || ''));
    const prof = root.SinDeviceProfile && root.SinDeviceProfile.tier ? String(root.SinDeviceProfile.tier) : '';
    if (/low/i.test(prof)) return 'low';
    const gl = renderer.getContext();
    const half = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    if (!half || !(gl instanceof root.WebGL2RenderingContext)) return 'low';
    if (mobile) return (nav.hardwareConcurrency || 4) >= 6 ? 'medium' : 'low';
    return 'high';
  }

  // ------------------------------------------------------------------ utilities
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

  async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error('SinVFX: ' + url + ' ' + r.status); return r.text(); }
  async function fetchJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error('SinVFX: ' + url + ' ' + r.status); return r.json(); }

  // ================================================================== create
  async function create(cfg) {
    const T = cfg.THREE || root.THREE;
    if (!T) throw new Error('SinVFX: THREE missing');
    const renderer = cfg.renderer, scene = cfg.scene;
    let camera = cfg.camera;
    const base = cfg.base || '';
    const want = cfg.quality || 'auto';
    const detected = detectTier(renderer);
    let tierName = want === 'auto' ? detected : (TIERS[want] ? want : 'high');
    if (tierName !== 'low' && detected === 'low' && !cfg.forceTier) tierName = 'low';   // no half-float targets
    let tier = TIERS[tierName];
    const pipeline = tier.pipeline;                 // fixed for the session: materials are compiled for it once

    // ---- data
    const shaderNames = ['common', 'particle.vert', 'particle.frag', 'ribbon.vert', 'ribbon.frag', 'shockwave.vert', 'shockwave.frag', 'decal.vert', 'decal.frag', 'fullscreen.vert', 'blur.frag', 'composite.frag', 'weapon.vert', 'weapon.frag'];
    const effectFiles = cfg.effectFiles || ['sin-axe', 'guardian', 'surface-impacts'];
    const [shaderSrc, atlas, ...effectSets] = await Promise.all([
      Promise.all(shaderNames.map(n => fetchText(base + 'vfx/shaders/' + n + '.glsl'))).then(a => Object.fromEntries(shaderNames.map((n, i) => [n, a[i]]))),
      fetchJSON(base + 'assets/vfx/atlas.json'),
      ...effectFiles.map(f => fetchJSON(base + 'vfx/effects/' + f + '.json'))
    ]);
    const S = shaderSrc;
    const effects = new Map();
    let surfaces = { table: {}, materials: {} };
    for (const set of effectSets) {
      (set.effects || []).forEach(e => effects.set(e.id, e));
      if (set.surfaces) surfaces = set.surfaces;
    }
    const R = atlas.regions;
    const region = id => { const r = R[id]; if (!r) throw new Error('SinVFX: atlas region ' + id); return r; };

    // ---- textures
    const texLoader = new T.TextureLoader();
    const loadTex = (file, srgb, repeat) => new Promise((res, rej) => texLoader.load(base + 'assets/vfx/' + file, t => {
      t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
      t.generateMipmaps = true; t.minFilter = T.LinearMipmapLinearFilter; t.magFilter = T.LinearFilter;
      t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping;
      res(t);
    }, undefined, rej));
    const energyFile = tier.atlas === 'low' ? atlas.textures.energy.low : atlas.textures.energy.file;
    const [tEnergy, tShapes, tNoise, tRamp, tStone, tStoneAux] = await Promise.all([
      loadTex(energyFile, true), loadTex(atlas.textures.shapes.file, false), loadTex(atlas.textures.noise.file, false, true),
      loadTex(atlas.textures.ramps.file, true), loadTex(atlas.textures.stone.file, true), loadTex(atlas.textures.stone.aux, false)
    ]);
    tRamp.generateMipmaps = false; tRamp.minFilter = T.LinearFilter;
    tNoise.anisotropy = 1;
    const textures = { tEnergy, tShapes, tNoise, tRamp, tStone, tStoneAux };

    // ---- shared uniforms (same objects in every material: one update per frame)
    const U = {
      tDepth: { value: null }, uRes: { value: new T.Vector2(1, 1) }, uNear: { value: 0.1 }, uFar: { value: 200 },
      uOpacity: { value: 1 }, uGlow: { value: 1 }, uTime: { value: 0 }, uSizeMul: { value: 1 }, uPxScale: { value: 0.001 }, uMinPx: { value: cfg.minPixels || 1.6 },
      tEnergy: { value: tEnergy }, tShapes: { value: tShapes }, tNoise: { value: tNoise }, tRamp: { value: tRamp },
      uLightDir: { value: new T.Vector3(-0.4, 1, -0.3).normalize() }, uLightCol: { value: new T.Color(1.0, 0.86, 0.7) }, uAmbient: { value: new T.Color(0.25, 0.24, 0.3) }
    };
    const SOFT = pipeline === 'composite';
    const defs = extra => Object.assign(SOFT ? { SOFT: 1 } : {}, extra || {});
    const frag = src => S.common + '\n' + src;
    const ADD = { blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneFactor, blendSrcAlpha: T.ZeroFactor, blendDstAlpha: T.OneFactor };
    const PRE = { blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor, blendSrcAlpha: T.OneFactor, blendDstAlpha: T.OneMinusSrcAlphaFactor };
    const depthState = { depthTest: !SOFT, depthWrite: false, transparent: true };

    const vfxScene = new T.Scene(); vfxScene.name = 'SinVFX';
    const distScene = new T.Scene(); distScene.name = 'SinVFX-distortion';
    vfxScene.matrixWorldAutoUpdate = true;

    // ================================================================ particles
    function ParticlePool(name, mode, cap, parent) {
      const quad = new T.PlaneGeometry(1, 1);
      const g = new T.InstancedBufferGeometry();
      g.index = quad.index; g.setAttribute('position', quad.getAttribute('position'));
      const spec = { aP0: 4, aV0: 4, aPhys: 4, aSize: 4, aRot: 4, aUV: 4, aCol: 4, aMisc: 4, aExtra: 4, aAxX: 3, aAxY: 3 };
      const A = {};
      for (const k in spec) { const at = new T.InstancedBufferAttribute(new Float32Array(cap * spec[k]), spec[k]); at.setUsage(T.DynamicDrawUsage); g.setAttribute(k, at); A[k] = at; }
      g.instanceCount = cap;
      const death = new Float32Array(cap);
      const mat = new T.ShaderMaterial(Object.assign({
        name: 'SinVFX-particles-' + name, uniforms: U, vertexShader: S['particle.vert'], fragmentShader: frag(S['particle.frag']),
        defines: defs({ MODE: mode }), ...depthState
      }, mode === 1 ? PRE : ADD));
      const mesh = new T.Mesh(g, mat); mesh.frustumCulled = false; mesh.name = 'SinVFX-' + name;
      mesh.renderOrder = mode === 1 ? 2 : 3;
      parent.add(mesh);
      let cursor = 0, lo = Infinity, hi = -1;
      return {
        name, cap, mesh,
        emit(p) {
          const i = cursor; cursor = (cursor + 1) % cap;
          const set = (k, a, b, c, d) => { const arr = A[k].array, n = spec[k], o = i * n; arr[o] = a; arr[o + 1] = b; arr[o + 2] = c; if (n > 3) arr[o + 3] = d; };
          set('aP0', p.x, p.y, p.z, p.birth); set('aV0', p.vx, p.vy, p.vz, p.life);
          set('aPhys', p.gravity, p.drag, p.ground, p.bounce); set('aSize', p.s0, p.s1, p.stretch, p.curve);
          set('aRot', p.rot, p.spin, p.fadeIn, p.fadeOut); set('aUV', p.uv[0], p.uv[1], p.uv[2], p.uv[3]);
          set('aCol', p.r, p.g, p.b, p.intensity); set('aMisc', p.ramp, p.tex, p.dissolve, p.seed);
          set('aExtra', p.aspect, p.soft, p.recolor, p.orient);
          set('aAxX', p.ax[0], p.ax[1], p.ax[2]); set('aAxY', p.ay[0], p.ay[1], p.ay[2]);
          death[i] = p.birth + p.life;
          lo = Math.min(lo, i); hi = Math.max(hi, i);
          return i;
        },
        setPos(i, x, y, z) { const a = A.aP0.array; a[i * 4] = x; a[i * 4 + 1] = y; a[i * 4 + 2] = z; lo = Math.min(lo, i); hi = Math.max(hi, i); },
        kill(i) { A.aV0.array[i * 4 + 3] = 0; death[i] = 0; lo = Math.min(lo, i); hi = Math.max(hi, i); },
        flush() {
          if (hi < 0) return;
          for (const k in A) { const at = A[k], n = spec[k]; at.clearUpdateRanges(); at.addUpdateRange(lo * n, (hi - lo + 1) * n); at.needsUpdate = true; }
          lo = Infinity; hi = -1;
        },
        alive(now) { let c = 0; for (let i = 0; i < cap; i++) if (death[i] > now) c++; return c; },
        clear() { death.fill(0); A.aV0.array.fill(0); lo = 0; hi = cap - 1; }
      };
    }
    const pools = {
      add: ParticlePool('add', 0, tier.capAdd, vfxScene),
      alpha: ParticlePool('alpha', 1, tier.capAlpha, vfxScene),
      dist: tier.distortion ? ParticlePool('dist', 2, tier.capDist, distScene) : null
    };

    // ================================================================ trails (ribbons)
    const MAXS = 128, MAXR = 8;
    const ribbonIndex = (() => {
      const idx = [];
      for (let s = 0; s < MAXS - 1; s++) for (let r = 0; r < MAXR - 1; r++) {
        const a = s * MAXR + r, b = a + 1, c = a + MAXR, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      return idx;
    })();
    const trailPool = [];
    function makeTrail() {
      const g = new T.BufferGeometry();
      const pos = new T.BufferAttribute(new Float32Array(MAXS * MAXR * 3), 3); pos.setUsage(T.DynamicDrawUsage);
      const dat = new T.BufferAttribute(new Float32Array(MAXS * MAXR * 4), 4); dat.setUsage(T.DynamicDrawUsage);
      g.setAttribute('position', pos); g.setAttribute('aData', dat); g.setIndex(ribbonIndex);
      const uni = Object.assign({}, U, {
        uRegion: { value: new T.Vector4() }, uRegion2: { value: new T.Vector4() }, uTint: { value: new T.Color(1, 1, 1) },
        uRecolor: { value: 0 }, uIntensity: { value: 1 }, uRampRow: { value: rampV('moon') }, uFade: { value: 1 },
        uFlow: { value: 0.08 }, uDissolve: { value: 0.6 }, uEdge: { value: 1 }, uSoftness: { value: 0.12 }, uProfile: { value: 0 }
      });
      const mat = new T.ShaderMaterial(Object.assign({ name: 'SinVFX-trail', uniforms: uni, vertexShader: S['ribbon.vert'], fragmentShader: frag(S['ribbon.frag']), defines: defs(), side: T.DoubleSide, ...depthState }, ADD));
      const mesh = new T.Mesh(g, mat); mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 4; mesh.name = 'SinVFX-trail';
      vfxScene.add(mesh);
      return { mesh, pos, dat, uni, samples: [], busy: false, emitting: false, rails: 0, def: null, release: 0 };
    }
    for (let i = 0; i < 10; i++) trailPool.push(makeTrail());

    // ================================================================ shockwaves
    function annulus(seg) {
      const g = new T.BufferGeometry(), p = [], uv = [], idx = [];
      for (let i = 0; i <= seg; i++) for (let j = 0; j < 2; j++) {
        const a = i / seg * Math.PI * 2, r = j ? 1 : 0.55;
        p.push(Math.cos(a) * r, 0, Math.sin(a) * r); uv.push(i / seg, j);
      }
      for (let i = 0; i < seg; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      g.setAttribute('position', new T.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
      return g;
    }
    const ringGeo = annulus(96);
    const wallGeo = new T.CylinderGeometry(1, 1, 1, 96, 1, true); wallGeo.translate(0, 0.5, 0);
    const shockPool = [];
    function makeShock(kind) {
      const uni = Object.assign({}, U, { uRegion: { value: new T.Vector4() }, uTint: { value: new T.Color(1, 1, 1) }, uRecolor: { value: 0 }, uIntensity: { value: 1 }, uAge: { value: 0 }, uRampRow: { value: rampV('gold') }, uSeed: { value: 0 }, uRepeat: { value: 4 } });
      const mat = new T.ShaderMaterial(Object.assign({ name: 'SinVFX-shock' + kind, uniforms: uni, vertexShader: S['shockwave.vert'], fragmentShader: frag(S['shockwave.frag']), defines: defs({ KIND: kind }), side: T.DoubleSide, ...depthState }, ADD));
      const mesh = new T.Mesh(kind === 1 ? wallGeo : ringGeo, mat); mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 3;
      (kind === 2 ? distScene : vfxScene).add(mesh);
      return { mesh, uni, kind, busy: false };
    }
    for (let i = 0; i < 4; i++) shockPool.push(makeShock(0), makeShock(1));
    if (tier.distortion) for (let i = 0; i < 4; i++) shockPool.push(makeShock(2));

    // ================================================================ decals
    const decalPool = [];
    const boxGeo = new T.BoxGeometry(1, 1, 1);
    const quadGeo = new T.PlaneGeometry(1, 1); quadGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < tier.decals; i++) {
      const uni = Object.assign({}, U, {
        tStone: { value: tStone }, tStoneAux: { value: tStoneAux }, uInvProj: { value: new T.Matrix4() }, uCamWorld: { value: new T.Matrix4() },
        uInvDecal: { value: new T.Matrix4() }, uDecalBasis: { value: new T.Matrix3() }, uRegion: { value: new T.Vector4() },
        uGlowCol: { value: new T.Color(1, 0.6, 0.2) }, uGlowAmt: { value: 0 }, uAlpha: { value: 0 }, uDissolve: { value: 0 }
      });
      const mat = new T.ShaderMaterial(Object.assign({
        name: 'SinVFX-decal', uniforms: uni, vertexShader: S['decal.vert'], fragmentShader: frag(S['decal.frag']),
        defines: defs(SOFT ? { PROJECTED: 1 } : {}), side: SOFT ? T.BackSide : T.FrontSide, depthTest: !SOFT, depthWrite: false, transparent: true,
        polygonOffset: !SOFT, polygonOffsetFactor: -4, polygonOffsetUnits: -4
      }, PRE));
      const mesh = new T.Mesh(SOFT ? boxGeo : quadGeo, mat); mesh.visible = false; mesh.renderOrder = 1; mesh.frustumCulled = false;
      vfxScene.add(mesh);
      decalPool.push({ mesh, uni, busy: false, t: 0 });
    }

    // ================================================================ debris
    function rockGeometry(seed, flat) {
      const rnd = mulberry32(seed);
      const g = new T.IcosahedronGeometry(0.5, 1);
      const p = g.attributes.position, v = new T.Vector3(), key = new Map();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const k = v.x.toFixed(3) + ',' + v.y.toFixed(3) + ',' + v.z.toFixed(3);
        if (!key.has(k)) key.set(k, 0.72 + rnd() * 0.5);
        v.multiplyScalar(key.get(k)); v.y *= flat; v.x *= 1 + (seed % 3) * 0.15;
        p.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      return g;
    }
    const debrisMat = new T.MeshStandardMaterial({ color: 0x8a7f72, roughness: 0.92, metalness: 0.0, name: 'SinVFX-debris' });
    if (cfg.debrisTexture !== false) {
      texLoader.load(base + (cfg.debrisTexture || 'assets/r3/harbor/road-stone.webp'), t => { t.colorSpace = T.SRGBColorSpace; debrisMat.map = t; debrisMat.color.set(0xb9ab98); debrisMat.needsUpdate = true; }, undefined, () => {});
    }
    const DEB_CAP = 48;
    const debris = [0, 1, 2].map(k => {
      const im = new T.InstancedMesh(rockGeometry(11 + k * 7, [0.55, 0.8, 0.4][k]), debrisMat, DEB_CAP);
      im.count = 0; im.frustumCulled = false; im.castShadow = tier.shadows; im.receiveShadow = true; im.name = 'SinVFX-debris' + k;
      im.instanceMatrix.setUsage(T.DynamicDrawUsage);
      scene.add(im);
      return { im, items: [] };
    });

    // ================================================================ lights
    const lights = [];
    for (let i = 0; i < tier.lights; i++) { const l = new T.PointLight(0xffc070, 0, 8, 2); l.name = 'SinVFX-light' + i; scene.add(l); lights.push({ l, t: 0, life: 0, peak: 0, busy: false }); }

    // ================================================================ composite pipeline
    const comp = {};
    const fsGeo = new T.PlaneGeometry(2, 2);
    const fsCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    function fsPass(fragSrc, uniforms, defines) {
      const m = new T.ShaderMaterial({ uniforms, vertexShader: S['fullscreen.vert'], fragmentShader: fragSrc, defines: defines || {}, depthTest: false, depthWrite: false });
      const mesh = new T.Mesh(fsGeo, m); mesh.frustumCulled = false;
      const sc = new T.Scene(); sc.add(mesh);
      return { m, sc };
    }
    if (pipeline === 'composite') {
      const HF = T.HalfFloatType;
      const rt = (w, h, o) => new T.WebGLRenderTarget(w, h, Object.assign({ type: HF, depthBuffer: false, generateMipmaps: false, minFilter: T.LinearFilter, magFilter: T.LinearFilter }, o || {}));
      comp.scene = rt(4, 4, { depthBuffer: true, samples: tier.msaa, depthTexture: new T.DepthTexture(4, 4, T.UnsignedIntType) });
      comp.vfx = rt(4, 4);
      comp.dist = rt(4, 4);
      comp.b = [rt(4, 4), rt(4, 4), rt(4, 4), rt(4, 4)];
      comp.blur = fsPass(S['blur.frag'], { tSrc: { value: null }, uDir: { value: new T.Vector2() } });
      comp.out = fsPass(S['composite.frag'], {
        tScene: { value: comp.scene.texture }, tVfx: { value: comp.vfx.texture }, tBloomA: { value: comp.b[1].texture }, tBloomB: { value: comp.b[3].texture },
        tDistort: { value: comp.dist.texture }, uBloom: { value: 1 }, uDistort: { value: 1 }
      });
      comp.out.m.toneMapped = true;
    }
    let W = 1, H = 1;
    function setSize(w, h) {
      W = w; H = h;
      if (pipeline !== 'composite') return;
      const s = tier.vfxScale;
      comp.scene.setSize(w, h);
      comp.vfx.setSize(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
      comp.dist.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
      comp.b[0].setSize(Math.max(1, w >> 2), Math.max(1, h >> 2)); comp.b[1].setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
      comp.b[2].setSize(Math.max(1, w >> 3), Math.max(1, h >> 3)); comp.b[3].setSize(Math.max(1, w >> 3), Math.max(1, h >> 3));
    }
    {
      const v = renderer.getDrawingBufferSize(new T.Vector2());
      setSize(v.x, v.y);
    }

    // ================================================================ state + settings
    const settings = { size: 1, density: 1, glow: 1, opacity: 1, duration: 1, strength: 1, shake: 1, tint: null, tintAmount: 0, bloom: 1, distortion: 1 };
    const muted = new Set();          // 'EFFECT/layer' or 'type:<layerType>'
    const rigs = new Map();
    const weapons = new Map();
    const instances = [];
    let time = 0, uid = 1;
    const shake = { trauma: 0, freq: 22, offset: new T.Vector3(), rot: 0 };
    const stats = { spawned: 0, instances: 0 };

    const tmp = { v: new T.Vector3(), v2: new T.Vector3(), v3: new T.Vector3(), q: new T.Quaternion(), m: new T.Matrix4(), c: new T.Color() };
    const UP = new T.Vector3(0, 1, 0);

    function toVec(v, fallback) {
      if (!v) return fallback.clone();
      if (v.isVector3) return v.clone();
      return new T.Vector3(v[0], v[1], v[2]);
    }
    function basisFrom(normal, dir) {
      const N = normal.clone().normalize();
      let D = dir.clone().addScaledVector(N, -dir.dot(N));
      if (D.lengthSq() < 1e-6) { D = Math.abs(N.y) < 0.9 ? new T.Vector3(0, 1, 0).cross(N) : new T.Vector3(1, 0, 0).cross(N); }
      D.normalize();
      const B = new T.Vector3().crossVectors(N, D).normalize();
      return { N, D, B };
    }
    const rv = (v, rnd, k = 1) => Array.isArray(v) ? lerp(v[0], v[1], rnd()) * k : (v == null ? 0 : v * k);

    // ---- sockets / rails
    function socketOf(inst, name) {
      if (!name) return inst.socket || null;
      if (name && name.isObject3D) return name;
      const rig = inst.rig;
      return rig && rig.sockets && rig.sockets[name] || null;
    }
    // '@part' in a layer means the weapon part used by this attack (opts.part), e.g. crown or blade
    function resolvePart(inst, v) {
      if (typeof v !== 'string' || v.indexOf('@part') < 0) return v;
      return v.replace('@part', inst.opts.part || inst.def.part || 'blade');
    }
    function railsOf(inst, name) {
      const rig = inst.rig;
      if (Array.isArray(name)) return name;
      if (inst.opts.rails && !name) return inst.opts.rails;
      return rig && rig.rails && rig.rails[name || inst.opts.weaponRails] || null;
    }
    function railPoint(r, out) {
      if (typeof r === 'function') return r(out);
      if (r.isObject3D) return r.getWorldPosition(out);
      if (r.offset) out.copy(r.offset); else out.set(0, 0, 0);
      return r.object.localToWorld(out);
    }

    // ---- emission position / direction for a particle layer
    function emitOrigin(inst, L, out) {
      const rnd = inst.rnd;
      const at = L.at || (L.socket ? 'socket' : 'origin');
      if (at === 'socket') {
        const s = socketOf(inst, L.socket);
        if (s) s.getWorldPosition(out); else out.copy(inst.pos);
      } else if (at === 'rails') {
        const rails = railsOf(inst, L.rails);
        if (rails && rails.length > 1) {
          const t = rnd() * (rails.length - 1), i = Math.min(rails.length - 2, Math.floor(t)), f = t - i;
          railPoint(rails[i], out); railPoint(rails[i + 1], tmp.v3); out.lerp(tmp.v3, f);
        } else out.copy(inst.pos);
      } else if (at === 'weapon') {
        const w = weapons.get(L.weapon || inst.opts.weapon);
        if (w) {
          const part = resolvePart(inst, L.part || 'all');
          const S = w.samples[part] || w.samples.all, k = Math.floor(rnd() * S.count) * 6, M = w.root.matrixWorld;
          out.set(S.data[k], S.data[k + 1], S.data[k + 2]).applyMatrix4(M);
          _surfN.set(S.data[k + 3], S.data[k + 4], S.data[k + 5]).transformDirection(M);
          if (L.inheritWeapon && w.prevValid) {
            _wv.set(S.data[k], S.data[k + 1], S.data[k + 2]).applyMatrix4(w.prev);
            _wv.subVectors(out, _wv).divideScalar(Math.max(1e-4, w.dt)).multiplyScalar(L.inheritWeapon);
          } else _wv.set(0, 0, 0);
        } else out.copy(inst.pos);
      } else if (at === 'bones') {
        const bones = inst.rig && inst.rig.bones;
        if (bones && bones.length) bones[Math.floor(rnd() * bones.length)].getWorldPosition(out); else out.copy(inst.pos);
      } else out.copy(inst.pos);
      if (L.offset) { const o = L.offset; out.addScaledVector(inst.N, o[0] * inst.scale).addScaledVector(inst.D, o[1] * inst.scale).addScaledVector(inst.B, (o[2] || 0) * inst.scale); }
      return out;
    }
    function shapeOffset(inst, L, out) {
      const rnd = inst.rnd, r = rv(L.radius || 0, rnd) * inst.scale;
      out.set(0, 0, 0);
      if (!r) return out;
      const shape = L.shape || 'sphere';
      if (shape === 'disc' || shape === 'ring') {
        const a = rnd() * Math.PI * 2, rr = shape === 'ring' ? r : r * Math.sqrt(rnd());
        out.copy(inst.D).multiplyScalar(Math.cos(a) * rr).addScaledVector(inst.B, Math.sin(a) * rr);
      } else {
        out.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); if (out.lengthSq() > 1) out.normalize(); out.multiplyScalar(r);
        if (shape === 'shell') out.normalize().multiplyScalar(r);
      }
      return out;
    }
    const _t1 = new T.Vector3(), _t2 = new T.Vector3(), _ax = new T.Vector3(), _rf = new T.Vector3(), _surfN = new T.Vector3(0, 1, 0), _wv = new T.Vector3();
    function coneDir(axisIn, deg, rnd, out) {
      const axis = _ax.copy(axisIn);
      const a = deg * Math.PI / 180;
      const cosT = 1 - rnd() * (1 - Math.cos(a)), sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT)), phi = rnd() * Math.PI * 2;
      if (Math.abs(axis.y) < 0.9) _t1.set(0, 1, 0).cross(axis).normalize(); else _t1.set(1, 0, 0).cross(axis).normalize();
      _t2.crossVectors(axis, _t1);
      return out.copy(axis).multiplyScalar(cosT).addScaledVector(_t1, Math.cos(phi) * sinT).addScaledVector(_t2, Math.sin(phi) * sinT);
    }
    function emitDir(inst, L, off, out) {
      const rnd = inst.rnd, mode = L.dir || 'normal', spread = L.spread == null ? 30 : L.spread;
      if (mode === 'radial') {
        out.copy(off).addScaledVector(inst.N, -off.dot(inst.N));
        if (out.lengthSq() < 1e-6) { const a = rnd() * Math.PI * 2; out.copy(inst.D).multiplyScalar(Math.cos(a)).addScaledVector(inst.B, Math.sin(a)); }
        out.normalize().addScaledVector(inst.N, rv(L.lift || 0, rnd)).normalize();
        if (spread) coneDir(out, spread * 0.3, rnd, out);
      } else if (mode === 'outward') {
        if (off.lengthSq() < 1e-8) coneDir(inst.N, 180, rnd, out); else out.copy(off).normalize();
      } else if (mode === 'surface') {
        coneDir(_surfN, spread, rnd, out);
      } else if (mode === 'inward') {
        out.copy(off).multiplyScalar(-1).normalize();
      } else {
        let axis = inst.N;
        if (mode === 'up') axis = UP;
        else if (mode === 'direction') axis = inst.D;
        else if (mode === 'back') axis = _rf.copy(inst.D).negate();
        else if (mode === 'reflect') axis = _rf.copy(inst.D).reflect(inst.N).multiplyScalar(-1).lerp(inst.N, L.reflectBlend == null ? 0.45 : L.reflectBlend).normalize();
        coneDir(axis, spread, rnd, out);
      }
      if (L.bias) out.addScaledVector(inst.D, rv(L.bias, rnd)).normalize();
      return out;
    }

    // ---- particle emission
    const particle = { x: 0, y: 0, z: 0, birth: 0, vx: 0, vy: 0, vz: 0, life: 1, gravity: 0, drag: 0, ground: -1e3, bounce: 0, s0: 1, s1: 1, stretch: 0, curve: 1, rot: 0, spin: 0, fadeIn: 0.05, fadeOut: 0.3, uv: [0, 0, 1, 1], r: 1, g: 1, b: 1, intensity: 1, ramp: -1, tex: 0, dissolve: 0, seed: 0, aspect: 1, soft: 0.2, recolor: 0, orient: 0, ax: [0, 0, 0], ay: [0, 0, 0] };
    function tintOf(inst, L) {
      const c = tmp.c.setRGB(1, 1, 1);
      if (L.tint) c.setRGB(L.tint[0], L.tint[1], L.tint[2]);
      if (L.surfaceTint && inst.surfaceInfo && inst.surfaceInfo.dust) { const d = inst.surfaceInfo.dust; c.setRGB(d[0], d[1], d[2]); }
      let recolor = L.recolor || 0;
      const tint = inst.opts.tint || settings.tint;
      const amt = inst.opts.tint ? (inst.opts.tintAmount == null ? 1 : inst.opts.tintAmount) : settings.tintAmount;
      if (tint && amt > 0 && L.blend !== 'alpha') {
        const tc = tmp.v.set(tint[0], tint[1], tint[2]);
        if (L.sprite && R[pick0(L.sprite)] && R[pick0(L.sprite)].tex === 'energy') { c.setRGB(tc.x, tc.y, tc.z); recolor = Math.max(recolor, amt); }
        else c.setRGB(lerp(c.r, tc.x, amt), lerp(c.g, tc.y, amt), lerp(c.b, tc.z, amt));
      }
      return recolor;
    }
    const pick0 = s => Array.isArray(s) ? s[0] : s;
    const _tc = new T.Color(), _o = new T.Vector3(), _off = new T.Vector3(), _d = new T.Vector3();
    function emitParticles(inst, L, count, originOverride, velOverride) {
      const pool = L.blend === 'alpha' ? pools.alpha : L.blend === 'distort' ? pools.dist : pools.add;
      if (!pool) return;
      const rnd = inst.rnd, k = inst.scale, str = inst.strength;
      const recolor = tintOf(inst, L);
      const tc = _tc.copy(tmp.c);
      const sprites = Array.isArray(L.sprite) ? L.sprite : [L.sprite || 'soft_glow'];
      const o = _o, off = _off, d = _d;
      const lifeMul = settings.duration * (inst.opts.duration || 1);
      for (let i = 0; i < count; i++) {
        const rg = region(sprites[Math.floor(rnd() * sprites.length)]);
        if (originOverride) o.copy(originOverride); else emitOrigin(inst, L, o);
        shapeOffset(inst, L, off);
        emitDir(inst, L, off, d);
        let spd = rv(L.speed || 0, rnd) * k * Math.sqrt(str);
        const p = particle;
        p.life = rv(L.life || 1, rnd) * lifeMul;
        if (L.dir === 'inward') {                      // converge: start on the shell, reach the centre at end of life
          const dist = off.length();
          spd = dist / Math.max(p.life * 0.85, 1e-3);
        }
        p.x = o.x + off.x; p.y = o.y + off.y; p.z = o.z + off.z; p.birth = time - (L.prewarm ? rnd() * p.life : 0);
        p.vx = d.x * spd; p.vy = d.y * spd; p.vz = d.z * spd;
        if (velOverride) { p.vx += velOverride.x; p.vy += velOverride.y; p.vz += velOverride.z; }
        if (L.at === 'weapon' && L.inheritWeapon) { p.vx += _wv.x; p.vy += _wv.y; p.vz += _wv.z; }
        if (L.inherit && inst.vel) { p.vx += inst.vel.x * L.inherit; p.vy += inst.vel.y * L.inherit; p.vz += inst.vel.z * L.inherit; }
        p.gravity = rv(L.gravity || 0, rnd); p.drag = rv(L.drag || 0.0001, rnd);
        p.ground = L.ground === false ? -1e3 : (inst.groundY + 0.01); p.bounce = L.bounce == null ? 0 : L.bounce;
        const s = rv(L.size || 0.2, rnd) * k * settings.size;
        p.s0 = s; p.s1 = s * rv(L.sizeEnd == null ? 1 : L.sizeEnd, rnd); p.curve = L.sizeCurve || 1;
        p.stretch = L.stretch || 0;
        p.rot = L.rotation === 'random' || L.rotation == null && !L.orient ? rnd() * Math.PI * 2 : rv(L.rotation || 0, rnd) * Math.PI / 180;
        p.spin = rv(L.spin || 0, rnd) * Math.PI / 180;
        p.fadeIn = L.fadeIn == null ? 0.06 : L.fadeIn; p.fadeOut = L.fadeOut == null ? 0.4 : L.fadeOut;
        p.uv = rg.uv; p.tex = rg.tex === 'energy' ? 0 : 1; p.aspect = L.stretch ? 1 : (L.aspect || rg.aspect);
        if (L.orient === 'velocity' || L.stretch) p.aspect = L.aspect || 1;
        p.r = tc.r; p.g = tc.g; p.b = tc.b;
        p.intensity = rv(L.intensity == null ? 1 : L.intensity, rnd) * inst.intensity * (L.blend === 'alpha' ? Math.min(1, 0.55 + 0.45 * str) : 1);
        p.ramp = L.ramp ? rampV(L.ramp) : -1; p.dissolve = L.dissolve || 0; p.seed = rnd();
        p.soft = L.soft == null ? 0.25 : L.soft; p.recolor = recolor;
        const om = L.stretch ? 2 : (ORIENT[L.orient] || 0);
        p.orient = om;
        if (om === 1) {
          let X = inst.D, Y = inst.B;
          if (L.orient === 'swing') { X = inst.D; Y = inst.N; }
          p.ax = [X.x, X.y, X.z]; p.ay = [Y.x, Y.y, Y.z];
        } else if (om === 3) { const a = L.axis === 'normal' ? inst.N : UP; p.ax = [a.x, a.y, a.z]; p.ay = [0, 0, 0]; }
        else { p.ax = [0, 0, 0]; p.ay = [0, 0, 0]; }
        const idx = pool.emit(p);
        stats.spawned++;
        if (L.follow) inst.followers.push({ pool, idx, L, off: off.clone(), until: p.birth + p.life });
      }
    }

    // ---- trail binding
    function startTrail(inst, L) {
      const tr = trailPool.find(t => !t.busy);
      if (!tr) return null;
      let rails = railsOf(inst, resolvePart(inst, L.rails));
      const choose = rails && rails.choose ? rails : null;
      if (choose) rails = choose.choose[0];
      if (!rails || rails.length < 2) return null;
      tr.busy = true; tr.emitting = true; tr.samples.length = 0; tr.rails = Math.min(MAXR, rails.length); tr.railsSrc = rails; tr.def = L; tr.inst = inst; tr.release = 0;
      tr.choose = choose; tr.chosen = !choose; tr.chooseMem = null;
      tr.length = (L.length || 0.16) * settings.duration * (inst.opts.duration || 1);
      const u = tr.uni;
      const a = region(L.sprite || 'moon_streak'), b = region(L.sprite2 || L.sprite || 'moon_wave');
      u.uRegion.value.set(a.uv[0], a.uv[1], a.uv[2], a.uv[3]); u.uRegion2.value.set(b.uv[0], b.uv[1], b.uv[2], b.uv[3]);
      u.uRampRow.value = rampV(L.ramp || 'moon'); u.uFlow.value = L.flow == null ? 0.08 : L.flow; u.uDissolve.value = L.dissolve == null ? 0.6 : L.dissolve;
      u.uEdge.value = (L.edge == null ? 1 : L.edge); u.uFade.value = 1; u.uSoftness.value = L.soft || 0.12; u.uProfile.value = L.profile === 'along' ? 1 : 0;
      const tint = inst.opts.tint || settings.tint, amt = inst.opts.tint ? 1 : settings.tintAmount;
      if (tint && amt > 0) { u.uTint.value.setRGB(tint[0], tint[1], tint[2]); u.uRecolor.value = amt; } else u.uRecolor.value = 0;
      tr.mesh.visible = true;
      tr.lastEdge = null; tr.sparkAcc = 0;
      return tr;
    }
    const railTmp = [0, 1, 2, 3, 4, 5, 6, 7].map(() => new T.Vector3());
    // A weapon with two cutting edges (double axe): the ribbon follows the edge that leads the swing.
    function chooseEdge(tr) {
      const c = tr.choose, mids = c.choose.map(set => railPoint(set[set.length >> 1], new T.Vector3()));
      const center = railPoint(c.center, new T.Vector3());
      if (tr.chooseMem) {
        const dt = Math.max(1e-4, time - tr.chooseMem.t);
        let best = -1, score = -1e9, speed = 0;
        mids.forEach((m, i) => { const v = m.clone().sub(tr.chooseMem.mids[i]).divideScalar(dt); speed = Math.max(speed, v.length()); const sc = v.dot(m.clone().sub(center).normalize()); if (sc > score) { score = sc; best = i; } });
        if (speed > (tr.def.minSpeed || 1.5)) { tr.railsSrc = c.choose[best]; tr.rails = Math.min(MAXR, tr.railsSrc.length); tr.chosen = true; return; }
      }
      tr.chooseMem = { t: time, mids };
    }
    function sampleTrail(tr) {
      const L = tr.def, inst = tr.inst;
      if (!tr.chosen) { chooseEdge(tr); if (!tr.chosen) return; }
      const pts = railTmp.slice(0, tr.rails).map((v, i) => railPoint(tr.railsSrc[i], v).clone());
      const along = L.profile === 'along';
      const edge = along ? pts[pts.length >> 1] : pts[pts.length - 1];
      const prev = tr.samples[0];
      const dtS = prev ? Math.max(1e-4, time - prev.t) : 1 / 60;
      const pe = prev ? prev.p[along ? prev.p.length >> 1 : prev.p.length - 1] : null;
      const speed = prev ? edge.distanceTo(pe) / dtS : 0;
      const sf = clamp((speed - (L.minSpeed || 1.5)) / Math.max(0.1, (L.speedRef || 9) - (L.minSpeed || 1.5)), 0, 1);
      const width = lerp(L.widthMin == null ? 0.35 : L.widthMin, 1, sf) * (L.width == null ? 1 : L.width);
      // widen / narrow from the edge rail inwards
      if (!along) for (let i = 0; i < pts.length - 1; i++) pts[i].lerp(edge, 1 - width);
      if (prev && speed > 0.01) {
        const dist = edge.distanceTo(prev.p[along ? prev.p.length >> 1 : prev.p.length - 1]);
        const n = Math.min(tier.subdiv, Math.floor(dist / 0.05));
        const prev2 = tr.samples[1];
        for (let s = 1; s <= n; s++) {                 // Catmull-Rom sub-samples: smooth arcs at any frame rate
          const f = s / (n + 1);
          const ip = pts.map((p, r) => {
            const p1 = prev.p[r], p0 = prev2 ? prev2.p[r] : p1, p2 = p, p3 = p.clone().add(p.clone().sub(p1));
            return catmull(p0, p1, p2, p3, f);
          });
          tr.samples.unshift({ t: lerp(prev.t, time, f), p: ip, sf: lerp(prev.sf, sf, f) });
        }
      }
      tr.samples.unshift({ t: time, p: pts, sf: prev ? lerp(prev.sf, sf, 0.55) : sf });
      // velocity-based sparks shed from the edge
      if (L.sparks && prev && sf > 0.15) {
        tr.sparkAcc += edge.distanceTo(pe) * (L.sparks.perMeter || 6) * sf * settings.density * tier.density;
        const vel = edge.clone().sub(pe).divideScalar(dtS);
        while (tr.sparkAcc >= 1) {
          tr.sparkAcc -= 1;
          // a random point of the current edge curve (rails), so sparks leave the whole blade, not one point
          const f = inst.rnd() * (pts.length - 1), i0 = Math.min(pts.length - 2, Math.floor(f)), o = pts[i0].clone().lerp(pts[i0 + 1], f - i0);
          emitParticles(inst, L.sparks, 1, o, vel.clone().multiplyScalar(L.sparks.inherit || 0.25));
        }
      }
      inst.weaponSpeed = speed;
      inst.weaponVel = prev ? edge.clone().sub(pe).divideScalar(dtS) : new T.Vector3();
    }
    function catmull(p0, p1, p2, p3, t) {
      const t2 = t * t, t3 = t2 * t;
      return new T.Vector3(
        0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3));
    }
    function buildTrail(tr) {
      const len = tr.length;
      while (tr.samples.length && time - tr.samples[tr.samples.length - 1].t > len) tr.samples.pop();
      if (tr.samples.length > MAXS) tr.samples.length = MAXS;
      const n = tr.samples.length, R2 = tr.rails;
      const pa = tr.pos.array, da = tr.dat.array;
      for (let s = 0; s < n; s++) {
        const smp = tr.samples[s], u = clamp((time - smp.t) / len, 0, 1);
        for (let r = 0; r < MAXR; r++) {
          const rr = Math.min(r, R2 - 1), p = smp.p[rr], o = (s * MAXR + r);
          pa[o * 3] = p.x; pa[o * 3 + 1] = p.y; pa[o * 3 + 2] = p.z;
          da[o * 4] = u; da[o * 4 + 1] = rr / (R2 - 1); da[o * 4 + 2] = smp.sf; da[o * 4 + 3] = time - smp.t;
        }
      }
      tr.pos.clearUpdateRanges(); tr.pos.addUpdateRange(0, n * MAXR * 3); tr.pos.needsUpdate = true;
      tr.dat.clearUpdateRanges(); tr.dat.addUpdateRange(0, n * MAXR * 4); tr.dat.needsUpdate = true;
      tr.mesh.geometry.setDrawRange(0, Math.max(0, n - 1) * (MAXR - 1) * 6);
      if (!tr.emitting) {
        tr.release += 0;
        if (n === 0) { tr.busy = false; tr.mesh.visible = false; }
      }
    }

    // ---- shockwave / decal / flash / debris / light / shake
    function startShock(inst, L, kind) {
      const s = shockPool.find(x => !x.busy && x.kind === kind);
      if (!s) return;
      const rnd = inst.rnd;
      s.busy = true; s.t = 0; s.L = L; s.inst = inst;
      s.life = rv(L.life || 0.8, rnd) * settings.duration * (inst.opts.duration || 1);
      s.r0 = rv(L.radius0 || 0.2, rnd) * inst.scale; s.r1 = rv(L.radius || 4, rnd) * inst.scale * Math.pow(inst.strength, 0.35);
      s.h = rv(L.height || 0.6, rnd) * inst.scale;
      s.mesh.position.copy(inst.pos).addScaledVector(inst.N, 0.03);
      s.mesh.quaternion.setFromUnitVectors(UP, inst.N);
      s.mesh.rotateY(rnd() * Math.PI * 2);
      const u = s.uni;
      if (L.sprite) { const r = region(L.sprite); u.uRegion.value.set(r.uv[0], r.uv[1], r.uv[2], r.uv[3]); }
      u.uRampRow.value = rampV(L.ramp || 'gold'); u.uSeed.value = rnd() * 10; u.uRepeat.value = L.repeat || 4;
      u.uIntensity.value = (L.intensity == null ? 1 : L.intensity) * inst.intensity * (kind === 2 ? settings.distortion : 1);
      const tint = inst.opts.tint || settings.tint, amt = inst.opts.tint ? 1 : settings.tintAmount;
      if (tint && amt > 0) { u.uTint.value.setRGB(tint[0], tint[1], tint[2]); u.uRecolor.value = amt; } else u.uRecolor.value = 0;
      s.mesh.visible = true;
      updateShock(s, 0);
    }
    function updateShock(s, dt) {
      s.t += dt;
      const age = clamp(s.t / s.life, 0, 1);
      const r = lerp(s.r0, s.r1, easeOut(age * (s.L.speedCurve || 1)));
      if (s.kind === 1) s.mesh.scale.set(r, s.h * (1 - age * 0.6), r); else s.mesh.scale.set(r, 1, r);
      s.uni.uAge.value = age;
      if (age >= 1) { s.busy = false; s.mesh.visible = false; }
    }
    function startDecal(inst, L) {
      let d = decalPool.find(x => !x.busy);
      if (!d) { d = decalPool.reduce((a, b) => (a.t / a.life > b.t / b.life ? a : b)); }   // recycle the oldest
      const rnd = inst.rnd;
      const ids = Array.isArray(L.sprite) ? L.sprite : [L.sprite || 'crack_radial_hole'];
      const rg = region(ids[Math.floor(rnd() * ids.length)]);
      d.busy = true; d.t = 0; d.L = L; d.inst = inst;
      d.life = rv(L.life || 6, rnd) * settings.duration * (inst.opts.duration || 1);
      const size = rv(L.size || 2.5, rnd) * inst.scale * settings.size * Math.pow(inst.strength, 0.4);
      const m = d.mesh;
      emitOrigin(inst, L, m.position);
      m.quaternion.setFromUnitVectors(UP, inst.N); m.rotateY(rnd() * Math.PI * 2);
      if (SOFT) m.scale.set(size * rg.aspect, Math.max(0.6, size * 0.45), size); else { m.scale.set(size * rg.aspect, 1, size); m.position.addScaledVector(inst.N, 0.015); }
      m.updateMatrixWorld(true);
      const u = d.uni;
      u.uRegion.value.set(rg.uv[0], rg.uv[1], rg.uv[2], rg.uv[3]);
      u.uInvDecal.value.copy(m.matrixWorld).invert();
      u.uDecalBasis.value.setFromMatrix4(tmp.m.makeRotationFromQuaternion(m.quaternion));
      const gc = L.glowColor || [1, 0.62, 0.22];
      const tint = inst.opts.tint || settings.tint;
      if (tint && settings.tintAmount > 0) u.uGlowCol.value.setRGB(tint[0], tint[1], tint[2]); else u.uGlowCol.value.setRGB(gc[0], gc[1], gc[2]);
      d.glow = (L.glow == null ? 3 : L.glow) * inst.intensity;
      m.visible = true;
      updateDecal(d, 0);
    }
    function updateDecal(d, dt) {
      d.t += dt;
      const L = d.L, t = d.t, life = d.life;
      const fin = L.fadeIn || 0.06, out = Math.min(1.6, life * 0.35);
      d.uni.uAlpha.value = clamp(t / fin, 0, 1) * (L.alpha == null ? 1 : L.alpha);
      d.uni.uDissolve.value = clamp((t - (life - out)) / out, 0, 1) * 1.15;
      const gt = (L.glowTime || 1.2) * settings.duration;
      d.uni.uGlowAmt.value = d.glow * (t < 0.08 ? t / 0.08 : Math.exp(-(t - 0.08) / gt)) + (L.glowHold || 0) * (1 - clamp(t / life, 0, 1));
      if (t >= life) { d.busy = false; d.mesh.visible = false; }
    }
    function spawnDebris(inst, L) {
      const rnd = inst.rnd;
      const n = Math.round(rv(L.count || 8, rnd) * settings.density * tier.debris * clamp(inst.strength, 0.3, 1.8) * (inst.surfaceInfo ? (inst.surfaceInfo.debris == null ? 1 : inst.surfaceInfo.debris) : 1));
      const o = new T.Vector3(), off = new T.Vector3(), d = new T.Vector3();
      for (let i = 0; i < n; i++) {
        const bin = debris[Math.floor(rnd() * debris.length)];
        if (bin.items.length >= DEB_CAP) { bin.items.shift(); }
        emitOrigin(inst, L, o); shapeOffset(inst, L, off); emitDir(inst, L, off, d);
        const spd = rv(L.speed || [3, 7], rnd) * Math.sqrt(inst.strength) * inst.scale;
        const s = rv(L.size || [0.05, 0.16], rnd) * inst.scale;
        bin.items.push({
          p: o.clone().add(off), v: d.multiplyScalar(spd).clone(), q: new T.Quaternion().setFromEuler(new T.Euler(rnd() * 6, rnd() * 6, rnd() * 6)),
          w: new T.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(rv(L.spin || 14, rnd)), s, t: 0, life: rv(L.life || [2.2, 3.4], rnd) * settings.duration,
          g: L.gravity || 9.8, rest: false, ground: inst.groundY
        });
      }
    }
    const eu = new T.Quaternion(), sc3 = new T.Vector3();
    function updateDebris(dt) {
      for (const bin of debris) {
        const it = bin.items;
        for (let i = it.length - 1; i >= 0; i--) {
          const d = it[i];
          d.t += dt;
          if (d.t >= d.life) { it.splice(i, 1); continue; }
          if (!d.rest) {
            d.v.y -= d.g * dt;
            d.v.multiplyScalar(Math.exp(-0.35 * dt));
            d.p.addScaledVector(d.v, dt);
            const floor = d.ground + d.s * 0.35;
            if (d.p.y < floor) {
              d.p.y = floor;
              if (Math.abs(d.v.y) < 0.9) { d.v.set(0, 0, 0); d.rest = true; }
              else { d.v.y = -d.v.y * 0.32; d.v.x *= 0.55; d.v.z *= 0.55; d.w.multiplyScalar(0.5); }
            }
            eu.setFromAxisAngle(tmp.v.copy(d.w).normalize(), d.w.length() * dt);
            if (d.w.lengthSq() > 1e-6) d.q.premultiply(eu);
          }
          // sink and shrink at the end of life: never pops out of existence
          const endK = clamp((d.life - d.t) / 0.6, 0, 1);
          if (d.rest && endK < 1) d.p.y -= dt * d.s * 0.3;
        }
        for (let i = 0; i < it.length; i++) {
          const d = it[i], endK = clamp((d.life - d.t) / 0.6, 0, 1);
          sc3.setScalar(d.s * (0.25 + 0.75 * endK));
          tmp.m.compose(d.p, d.q, sc3);
          bin.im.setMatrixAt(i, tmp.m);
        }
        bin.im.count = it.length;
        if (it.length) bin.im.instanceMatrix.needsUpdate = true;
      }
    }
    function startLight(inst, L) {
      const s = lights.find(x => !x.busy) || lights[0];
      if (!s) return;
      const rnd = inst.rnd;
      s.busy = true; s.t = 0; s.life = rv(L.life || 0.25, rnd) * settings.duration; s.peak = rv(L.intensity || 30, rnd) * inst.intensity * Math.sqrt(inst.strength) * settings.glow;
      const c = L.color || [1, 0.75, 0.4];
      s.l.color.setRGB(c[0], c[1], c[2]); s.l.distance = (L.range || 7) * inst.scale;
      emitOrigin(inst, L, s.l.position); s.l.position.addScaledVector(inst.N, (L.lift || 0.4) * inst.scale);
      s.l.intensity = 0;
    }
    function updateLights(dt) {
      for (const s of lights) {
        if (!s.busy) continue;
        s.t += dt;
        const a = s.t / s.life;
        s.l.intensity = a < 0.08 ? s.peak * a / 0.08 : s.peak * Math.pow(1 - clamp((a - 0.08) / 0.92, 0, 1), 2);
        if (a >= 1) { s.busy = false; s.l.intensity = 0; }
      }
    }

    // ---- material glow (e.g. the Guardian's chest seal): animates the rig's own runtime materials, restores them after
    function startMatGlow(inst, L) {
      const mats = inst.rig && inst.rig.materials;
      const m = mats && mats[L.material];
      if (!m || !('emissiveIntensity' in m)) return null;
      if (m.userData.sinVfxBase == null) m.userData.sinVfxBase = m.emissiveIntensity;
      return { m, base: m.userData.sinVfxBase, L, t: 0 };
    }

    // ================================================================ weapons (geometry-driven energy)
    // registerWeapon reads the weapon's own meshes (never modifies them) and builds, in the
    // space of `root` (the object the weapon moves with):
    //   • a merged copy of its geometry with per-vertex part masks and edge closeness, drawn
    //     as an additive energy shell that follows root.matrixWorld every frame;
    //   • area-weighted surface samples per part (mesh-based emission);
    //   • rails along the real cutting-edge / rim curves (ribbon trails), registered on the rig.
    // cfg: { root, rig, parts: ['edge','head',..] (≤4), classify(p, n) → { mask:[4], edge }, curves:
    //        { name: [Vector3..] | { choose: [[..],[..]], center: Vector3 } }, sigilMaterial, energy, ramp, push, scale }
    function registerWeapon(name, wcfg) {
      const root = wcfg.root; root.updateMatrixWorld(true);
      const inv = root.matrixWorld.clone().invert();
      const pos = [], nrm = [], uvs = [], mask = [], sig = [], edge = [], idx = [];
      const v = new T.Vector3(), n = new T.Vector3(), nm = new T.Matrix3();
      let sigilMap = null;
      root.traverse(o => {
        if (!o.isMesh || o.userData.sinVfx) return;
        const g = o.geometry, P = g.attributes.position, Nn = g.attributes.normal, U2 = g.attributes.uv;
        const rel = inv.clone().multiply(o.matrixWorld); nm.getNormalMatrix(rel);
        const isSigil = !!(wcfg.sigilMaterial && o.material && o.material.name === wcfg.sigilMaterial);
        if (isSigil && o.material.emissiveMap) sigilMap = o.material.emissiveMap;
        const base = pos.length / 3;
        for (let i = 0; i < P.count; i++) {
          v.fromBufferAttribute(P, i).applyMatrix4(rel); pos.push(v.x, v.y, v.z);
          if (Nn) n.fromBufferAttribute(Nn, i).applyMatrix3(nm).normalize(); else n.set(0, 1, 0);
          nrm.push(n.x, n.y, n.z);
          if (U2) uvs.push(U2.getX(i), U2.getY(i)); else uvs.push(0, 0);
          const c = wcfg.classify(v, n);
          mask.push(c.mask[0] || 0, c.mask[1] || 0, c.mask[2] || 0, c.mask[3] || 0); edge.push(c.edge || 0); sig.push(isSigil ? 1 : 0);
        }
        if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
        else for (let i = 0; i < P.count; i++) idx.push(base + i);
      });
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new T.Float32BufferAttribute(nrm, 3));
      geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
      geo.setAttribute('aMask', new T.Float32BufferAttribute(mask, 4));
      geo.setAttribute('aEdge', new T.Float32BufferAttribute(edge, 1));
      geo.setAttribute('aSigil', new T.Float32BufferAttribute(sig, 1));
      geo.setIndex(idx);
      const parts = (wcfg.parts || []).slice(0, 4);
      // area-weighted surface samples per part, biased to the edge where asked
      const samples = {};
      const triW = (k, eb) => {
        const w = new Float32Array(idx.length / 3); let tot = 0; const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
        for (let t = 0; t < w.length; t++) {
          const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
          a.fromArray(pos, i0 * 3); b.fromArray(pos, i1 * 3); c.fromArray(pos, i2 * 3);
          const area = b.sub(a).cross(c.sub(a)).length() * 0.5;
          const m = k < 0 ? 1 : (mask[i0 * 4 + k] + mask[i1 * 4 + k] + mask[i2 * 4 + k]) / 3;
          const e = eb ? Math.pow((edge[i0] + edge[i1] + edge[i2]) / 3, eb) : 1;
          tot += area * m * e; w[t] = tot;
        }
        return { w, tot };
      };
      const rnd = mulberry32(911);
      const sampleSet = (k, eb, count) => {
        const { w, tot } = triW(k, eb); const data = new Float32Array(count * 6);
        if (tot <= 0) return null;
        for (let s2 = 0; s2 < count; s2++) {
          const r = rnd() * tot; let lo = 0, hi = w.length - 1;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (w[mid] < r) lo = mid + 1; else hi = mid; }
          let u1 = rnd(), u2 = rnd(); if (u1 + u2 > 1) { u1 = 1 - u1; u2 = 1 - u2; }
          const i0 = idx[lo * 3], i1 = idx[lo * 3 + 1], i2 = idx[lo * 3 + 2];
          for (let c = 0; c < 3; c++) {
            data[s2 * 6 + c] = pos[i0 * 3 + c] + (pos[i1 * 3 + c] - pos[i0 * 3 + c]) * u1 + (pos[i2 * 3 + c] - pos[i0 * 3 + c]) * u2;
            data[s2 * 6 + 3 + c] = nrm[i0 * 3 + c] + (nrm[i1 * 3 + c] - nrm[i0 * 3 + c]) * u1 + (nrm[i2 * 3 + c] - nrm[i0 * 3 + c]) * u2;
          }
        }
        return { data, count };
      };
      samples.all = sampleSet(-1, 0, 768);
      parts.forEach((p, k) => { samples[p] = sampleSet(k, 0, 512); const e = sampleSet(k, 3, 512); if (e) samples[p + '_edge'] = e; });
      // rails along the real curves
      const rig = wcfg.rig ? rigs.get(wcfg.rig) : null;
      const mk = (q, i, nm2) => { const o = new T.Object3D(); o.name = 'vfx-' + name + '-' + nm2 + '-' + i; o.userData.sinVfx = true; o.position.copy(q); root.add(o); return o; };
      for (const cn in (wcfg.curves || {})) {
        const c = wcfg.curves[cn];
        const val = Array.isArray(c) ? c.map((q, i) => mk(q, i, cn)) : { choose: c.choose.map((set, j) => set.map((q, i) => mk(q, i, cn + j))), center: mk(c.center, 0, cn + '-c') };
        if (rig) (rig.rails || (rig.rails = {}))[cn] = val;
      }
      // overlay
      const r = region(wcfg.energy || 'moon_wave');
      const uni = Object.assign({}, U, {
        tSigil: { value: sigilMap || tShapes }, uParts: { value: new T.Vector4(0, 0, 0, 0) }, uRegion: { value: new T.Vector4(r.uv[0], r.uv[1], r.uv[2], r.uv[3]) },
        uSigilAmt: { value: 0 }, uRampRow: { value: rampV(wcfg.ramp || 'moon') }, uFlow: { value: 0.6 }, uEdgeOnly: { value: 0.8 },
        uScale: { value: wcfg.scale || 6 }, uPush: { value: wcfg.push || 0.003 }, uTint: { value: new T.Color(1, 1, 1) }, uRecolor: { value: 0 }
      });
      const mat = new T.ShaderMaterial(Object.assign({ name: 'SinVFX-weapon-' + name, uniforms: uni, vertexShader: S['weapon.vert'], fragmentShader: frag(S['weapon.frag']),
        defines: defs(), side: T.FrontSide, depthTest: !SOFT, depthWrite: false, transparent: true, polygonOffset: !SOFT, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, ADD));
      const mesh = new T.Mesh(geo, mat); mesh.name = 'SinVFX-weapon-' + name; mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 5;
      vfxScene.add(mesh);
      const w = { name, root, parts, mesh, uni, samples, base: new T.Vector4(0, 0, 0, 0), req: new T.Vector4(0, 0, 0, 0), level: new T.Vector4(0, 0, 0, 0), sigilBase: 0, sigilReq: 0,
        prev: new T.Matrix4(), prevValid: false, dt: 1 / 60, verts: pos.length / 3, tris: idx.length / 3, enabled: true };
      weapons.set(name, w);
      return { name, verts: w.verts, tris: w.tris, parts, samples: Object.keys(samples) };
    }
    function partIndex(w, part) { return w.parts.indexOf(part); }
    function syncWeapons() {
      for (const w of weapons.values()) {
        const on = w.enabled && !muted.has('type:weaponGlow') && (Math.max(w.level.x, w.level.y, w.level.z, w.level.w) > 0.002 || w.sigilLevel > 0.002);
        w.mesh.visible = on;
        if (!on) continue;
        w.mesh.matrix.copy(w.root.matrixWorld); w.mesh.matrixWorldNeedsUpdate = true;
        w.uni.uParts.value.copy(w.level); w.uni.uSigilAmt.value = w.sigilLevel || 0;
        const tint = settings.tint;
        if (tint && settings.tintAmount > 0) { w.uni.uTint.value.setRGB(tint[0], tint[1], tint[2]); w.uni.uRecolor.value = settings.tintAmount; } else w.uni.uRecolor.value = 0;
      }
    }

    // ================================================================ instances
    function play(id, opts) {
      opts = opts || {};
      const def = typeof id === 'object' ? id : effects.get(id);
      if (!def) { console.warn('[SinVFX] unknown effect', id); return null; }
      const rig = typeof opts.rig === 'string' ? rigs.get(opts.rig) : opts.rig || null;
      const pos = toVec(opts.position, new T.Vector3());
      const nrm = toVec(opts.normal, UP);
      const dir = toVec(opts.direction, new T.Vector3(0, 0, 1));
      const b = basisFrom(nrm, dir);
      const seed = opts.seed == null ? (Math.random() * 1e9) | 0 : opts.seed;
      const surface = opts.surface || def.surface || 'stone';
      const inst = {
        uid: uid++, id: def.id, def, opts, rig, pos, N: b.N, D: b.D, B: b.B, rnd: mulberry32(seed), seed,
        scale: (opts.scale || 1) * (def.scale || 1), intensity: (opts.intensity == null ? 1 : opts.intensity),
        strength: (opts.strength == null ? 1 : opts.strength) * settings.strength,
        socket: opts.socket && opts.socket.isObject3D ? opts.socket : rig && rig.sockets && opts.socket ? rig.sockets[opts.socket] : null,
        groundY: opts.groundY == null ? (cfg.groundY || 0) : opts.groundY,
        surface, surfaceInfo: surfaces.materials[surface] || null,
        t: 0, loop: !!(opts.loop || def.loop), stopped: false, fired: new Set(), streams: new Map(), trails: new Map(), glows: [],
        followers: [], vel: opts.velocity ? toVec(opts.velocity, new T.Vector3()) : null, done: false
      };
      if (inst.socket && !opts.position) inst.socket.getWorldPosition(inst.pos);
      instances.push(inst);
      stats.instances++;
      tickInstance(inst, 0);
      return {
        uid: inst.uid, id: def.id,
        get alive() { return !inst.done; },
        get time() { return inst.t; },
        stop() { inst.stopped = true; },
        kill() { finish(inst, true); },
        setPosition(p) { inst.pos.copy(toVec(p, inst.pos)); }
      };
    }
    function layerActive(inst, L) {
      if (muted.has(inst.id + '/' + L.name) || muted.has('type:' + L.type)) return false;
      if (L.surfaces && L.surfaces.indexOf(inst.surface) < 0) return false;
      if (L.notSurfaces && L.notSurfaces.indexOf(inst.surface) >= 0) return false;
      if (L.minTier && ['low', 'medium', 'high'].indexOf(tierName) < ['low', 'medium', 'high'].indexOf(L.minTier)) return false;
      return true;
    }
    function tickInstance(inst, dt) {
      const def = inst.def, D = inst.opts.timeLocked ? 1 : settings.duration * (inst.opts.duration || 1);
      const prevT = inst.t;
      inst.t += dt / D;
      const t = inst.t;
      if (inst.socket && def.followSocket) inst.socket.getWorldPosition(inst.pos);
      let busy = false;
      def.layers.forEach((L, li) => {
        if (!layerActive(inst, L)) return;
        const st = L.start || 0;
        const cont = L.type === 'stream' || L.type === 'trail' || L.type === 'glow' || L.type === 'weaponGlow';
        const end = L.end == null ? (cont ? def.duration : st) : L.end;
        const span = inst.loop && cont && L.end == null && !inst.stopped ? Infinity : end;
        if (L.type === 'stream') {
          if (t >= st && t < span) {
            busy = true;
            const acc = (inst.streams.get(li) || 0) + rv(L.rate || 30, inst.rnd) * settings.density * tier.density * (dt / D) * (L.strengthScales ? clamp(inst.strength, 0.3, 2) : 1) * (L.ramp_up ? clamp((t - st) / L.ramp_up, 0, 1) : 1);
            const n = Math.floor(acc); inst.streams.set(li, acc - n);
            if (n > 0) emitParticles(inst, L, n);
          }
          return;
        }
        if (L.type === 'trail') {
          let tr = inst.trails.get(li);
          if (t >= st && t < span) {
            busy = true;
            if (!tr) { tr = startTrail(inst, L); inst.trails.set(li, tr || false); }
            if (tr) sampleTrail(tr);
          } else if (tr && tr.emitting && t >= span) { tr.emitting = false; }
          return;
        }
        if (L.type === 'weaponGlow') {
          const w = weapons.get(L.weapon || inst.opts.weapon);
          if (!w) return;
          const live = t >= st && t < span, k = partIndex(w, resolvePart(inst, L.part || 'edge'));
          const g = inst.glows[li] || (inst.glows[li] = { wg: true, lv: 0 });
          if (live) { busy = true; g.lv = clamp((t - st) / Math.max(0.01, L.rise || 0.15), 0, 1); }
          else if (t >= span) { g.lv = Math.max(0, 1 - (t - span) / Math.max(0.01, L.release || 0.3)); if (g.lv > 0) busy = true; }
          const pulse = L.pulse ? 1 + Math.sin(t * Math.PI * 2 * L.pulse) * 0.2 : 1;
          const lvl = g.lv * (L.intensity == null ? 1 : L.intensity) * pulse * inst.intensity;
          if (L.sigil) w.sigilReq = Math.max(w.sigilReq, g.lv * L.sigil * pulse);
          if (k >= 0) { const arr = ['x', 'y', 'z', 'w']; w.req[arr[k]] = Math.max(w.req[arr[k]], lvl); }
          else if (L.part === 'all') { w.req.set(Math.max(w.req.x, lvl), Math.max(w.req.y, lvl), Math.max(w.req.z, lvl), Math.max(w.req.w, lvl)); }
          if (L.flow != null) w.uni.uFlow.value = L.flow;
          if (L.edgeOnly != null) w.uni.uEdgeOnly.value = L.edgeOnly;
          return;
        }
        if (L.type === 'glow') {
          let g = inst.glows[li];
          if (t >= st && t < span) {
            busy = true;
            if (g === undefined) { g = startMatGlow(inst, L); inst.glows[li] = g || null; }
            if (g) {
              const a = clamp((t - st) / Math.max(0.01, L.rise || 0.5), 0, 1);
              const pulse = L.pulse ? 1 + Math.sin(t * Math.PI * 2 * L.pulse) * 0.18 : 1;
              g.m.emissiveIntensity = g.base * lerp(1, L.peak || 4, a) * pulse;
            }
          } else if (g && t >= span) {
            const k = clamp((t - span) / (L.release || 0.6), 0, 1);
            g.m.emissiveIntensity = lerp(g.base * (L.peak || 4), g.base, k);
            if (k >= 1) { g.m.emissiveIntensity = g.base; inst.glows[li] = null; } else busy = true;
          }
          return;
        }
        // one-shot layers
        if (inst.fired.has(li)) return;
        if (t < st) { busy = true; return; }
        if (prevT > st && dt > 0 && t - st > 0.5 && !L.late) { inst.fired.add(li); return; }
        inst.fired.add(li);
        if (L.type === 'burst') {
          const n = Math.max(L.min || 0, Math.round(rv(L.count || 10, inst.rnd) * settings.density * (L.noDensity ? 1 : tier.density) * (L.strengthScales === false ? 1 : clamp(inst.strength, 0.35, 1.8)) * (L.surfaceKey && inst.surfaceInfo ? (inst.surfaceInfo[L.surfaceKey] == null ? 1 : inst.surfaceInfo[L.surfaceKey]) : 1)));
          emitParticles(inst, L, n);
        } else if (L.type === 'sprite') emitParticles(inst, Object.assign({ fadeIn: 0.08, fadeOut: 0.6, speed: 0, spread: 0, drag: 0.0001 }, L), 1);
        else if (L.type === 'shockwave') startShock(inst, L, L.kind === 'wall' ? 1 : L.kind === 'distort' ? 2 : 0);
        else if (L.type === 'decal') startDecal(inst, L);
        else if (L.type === 'debris') spawnDebris(inst, L);
        else if (L.type === 'light') startLight(inst, L);
        else if (L.type === 'shake') { shake.trauma = Math.min(1.2, shake.trauma + (L.amount || 0.4) * Math.sqrt(inst.strength) * settings.shake); shake.freq = L.freq || 22; }
      });
      // attached followers (sprites pinned to a moving socket)
      for (let i = inst.followers.length - 1; i >= 0; i--) {
        const f = inst.followers[i];
        const s = socketOf(inst, f.L.socket);
        if (s) { s.getWorldPosition(tmp.v); f.pool.setPos(f.idx, tmp.v.x + f.off.x, tmp.v.y + f.off.y, tmp.v.z + f.off.z); }
        if (time > f.until) inst.followers.splice(i, 1);
      }
      const maxLife = def.duration + (def.tail || 0);
      const trailsLive = [...inst.trails.values()].some(tr => tr && tr.busy && tr.inst === inst);
      if (!busy && !trailsLive && (t >= maxLife || inst.stopped) && !inst.loop) finish(inst, false);
      else if (inst.loop && inst.stopped && !busy && !trailsLive) finish(inst, false);
    }
    function finish(inst, hard) {
      if (inst.done) return;
      inst.done = true;
      for (const g of inst.glows) if (g && g.m) g.m.emissiveIntensity = g.base;
      for (const tr of inst.trails.values()) if (tr && tr.inst === inst) { tr.emitting = false; if (hard) { tr.samples.length = 0; } }
      const i = instances.indexOf(inst); if (i >= 0) instances.splice(i, 1);
    }

    // ================================================================ per-frame
    function update(dt) {
      dt = Math.max(0, Math.min(dt, 0.1));
      time += dt;
      U.uTime.value = time;
      for (const w of weapons.values()) { w.req.set(0, 0, 0, 0); w.sigilReq = 0; }
      for (let i = instances.length - 1; i >= 0; i--) { const inst = instances[i]; if (inst) tickInstance(inst, dt); }
      for (const w of weapons.values()) {
        w.level.set(Math.max(w.req.x, w.base.x), Math.max(w.req.y, w.base.y), Math.max(w.req.z, w.base.z), Math.max(w.req.w, w.base.w));
        w.sigilLevel = Math.max(w.sigilReq, w.sigilBase || 0);
      }
      for (const tr of trailPool) if (tr.busy) {
        if (!tr.emitting) tr.uni.uFade.value = Math.max(0, tr.uni.uFade.value - dt / Math.max(0.05, tr.length));
        buildTrail(tr);
        tr.uni.uIntensity.value = (tr.def.intensity == null ? 1 : tr.def.intensity) * tr.inst.intensity;
      }
      for (const s of shockPool) if (s.busy) updateShock(s, dt);
      for (const d of decalPool) if (d.busy) updateDecal(d, dt);
      updateDebris(dt);
      updateLights(dt);
      pools.add.flush(); pools.alpha.flush(); if (pools.dist) pools.dist.flush();
      // camera shake (trauma², smooth noise)
      shake.trauma = Math.max(0, shake.trauma - dt * 1.6);
      const a = shake.trauma * shake.trauma;
      const f = time * shake.freq;
      shake.offset.set(Math.sin(f * 1.13) + Math.sin(f * 2.71) * 0.4, Math.sin(f * 1.37 + 1.7) + Math.sin(f * 3.1) * 0.35, Math.sin(f * 0.91 + 4.1)).multiplyScalar(a * 0.06);
      shake.rot = Math.sin(f * 1.7 + 2.3) * a * 0.012;
      U.uGlow.value = settings.glow; U.uOpacity.value = settings.opacity; U.uSizeMul.value = 1;
      // weapon motion of this frame (point velocities for mesh emission)
      for (const w of weapons.values()) { w.prev.copy(w.root.matrixWorld); w.prevValid = true; w.dt = dt || w.dt; }
    }

    const drawInfo = { calls: 0, triangles: 0 };
    function render(target) {
      const cam = camera;
      syncWeapons();
      U.uNear.value = cam.near; U.uFar.value = cam.far;
      U.uPxScale.value = 2 / (cam.projectionMatrix.elements[5] * Math.max(1, pipeline === 'composite' ? comp.vfx.height : H));
      const ri = renderer.info;
      const autoReset = ri.autoReset; ri.autoReset = false; ri.reset();
      for (const d of decalPool) if (d.busy) {
        d.uni.uInvProj.value.copy(cam.projectionMatrixInverse); d.uni.uCamWorld.value.copy(cam.matrixWorld);
      }
      if (pipeline === 'composite') {
        const prevTarget = renderer.getRenderTarget();
        renderer.setRenderTarget(comp.scene); renderer.clear(); renderer.render(scene, cam);
        U.tDepth.value = comp.scene.depthTexture;
        // VFX layer
        U.uRes.value.set(comp.vfx.width, comp.vfx.height);
        renderer.setRenderTarget(comp.vfx); renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false);
        renderer.render(vfxScene, cam);
        // distortion
        const distOn = tier.distortion && settings.distortion > 0;
        renderer.setRenderTarget(comp.dist); renderer.clear(true, false, false);
        if (distOn) { U.uRes.value.set(comp.dist.width, comp.dist.height); renderer.render(distScene, cam); }
        // localized bloom (VFX layer only)
        const levels = tier.bloom;
        const blur = (src, dst, dx, dy) => { comp.blur.m.uniforms.tSrc.value = src.texture; comp.blur.m.uniforms.uDir.value.set(dx / src.width, dy / src.height); renderer.setRenderTarget(dst); renderer.render(comp.blur.sc, fsCam); };
        if (levels > 0) { blur(comp.vfx, comp.b[0], 1, 0); blur(comp.b[0], comp.b[1], 0, 1); }
        else { renderer.setRenderTarget(comp.b[1]); renderer.clear(true, false, false); }
        if (levels > 1) { blur(comp.b[1], comp.b[2], 1, 0); blur(comp.b[2], comp.b[3], 0, 1); }
        else { renderer.setRenderTarget(comp.b[3]); renderer.clear(true, false, false); }
        renderer.setClearColor(0x000000, 1);
        comp.out.m.uniforms.uBloom.value = levels > 0 ? settings.bloom * settings.glow : 0;
        comp.out.m.uniforms.uDistort.value = distOn ? 1 : 0;
        renderer.setRenderTarget(target === undefined ? prevTarget : target);
        renderer.render(comp.out.sc, fsCam);
      } else {
        const ac = renderer.autoClear;
        renderer.setRenderTarget(target || null);
        renderer.render(scene, cam);
        renderer.autoClear = false;
        renderer.render(vfxScene, cam);
        renderer.autoClear = ac;
      }
      drawInfo.calls = ri.render.calls; drawInfo.triangles = ri.render.triangles;
      ri.autoReset = autoReset;
    }

    // ================================================================ prewarm: compile every program and upload every texture before the first effect
    async function prewarm() {
      const t0 = performance.now();
      Object.values(textures).forEach(t => renderer.initTexture(t));
      const hidden = [];
      const show = o => { if (!o.visible) { o.visible = true; hidden.push(o); } };
      vfxScene.traverse(show); distScene.traverse(show);
      debris.forEach(b => { b.im.count = 1; });
      const lightsOn = lights.map(s => s.l.intensity);
      const comps = [vfxScene, distScene, scene];
      if (pipeline === 'composite') comps.push(comp.blur.sc, comp.out.sc);
      for (const sc of comps) {
        const cam = sc === comp.blur?.sc || sc === comp.out?.sc ? fsCam : camera;
        if (renderer.compileAsync) await renderer.compileAsync(sc, cam); else renderer.compile(sc, cam);
      }
      // one real frame through every pass so the driver links and allocates now, not on the first hit
      render();
      hidden.forEach(o => { o.visible = false; });
      debris.forEach(b => { b.im.count = 0; });
      lights.forEach((s, i) => { s.l.intensity = lightsOn[i]; });
      return performance.now() - t0;
    }

    // ================================================================ Surface Impact System
    function impact(p) {
      const weapon = p.weapon || 'axe', surface = p.surface || 'stone';
      const row = surfaces.table[weapon] || surfaces.table.default || {};
      const id = p.effect || row[surface] || row.default;
      if (!id) { console.warn('[SinVFX] no impact effect for', weapon, surface); return null; }
      const vel = p.velocity ? toVec(p.velocity, new T.Vector3()) : null;
      const speed = vel ? vel.length() : (p.speed || 8);
      const ref = (surfaces.refSpeed && surfaces.refSpeed[weapon]) || 9;
      const strength = (p.strength == null ? 1 : p.strength) * clamp(speed / ref, 0.45, 1.6);
      const dir = vel && speed > 0.01 ? vel.clone().normalize() : toVec(p.direction, new T.Vector3(0, 0, 1));
      return play(id, Object.assign({}, p, { surface, strength, direction: dir, velocity: vel }));
    }

    function registerRig(name, rig) { rigs.set(name, rig); return rig; }
    function setCamera(c) { camera = c; }
    function setLighting(l) {
      if (l.dir) U.uLightDir.value.copy(l.dir).normalize();
      if (l.color) U.uLightCol.value.copy(l.color);
      if (l.ambient) U.uAmbient.value.copy(l.ambient);
    }
    function clearAll() {
      instances.slice().forEach(i => finish(i, true));
      pools.add.clear(); pools.alpha.clear(); if (pools.dist) pools.dist.clear();
      trailPool.forEach(t => { t.busy = false; t.mesh.visible = false; t.samples.length = 0; });
      shockPool.forEach(s => { s.busy = false; s.mesh.visible = false; });
      decalPool.forEach(d => { d.busy = false; d.mesh.visible = false; });
      debris.forEach(b => { b.items.length = 0; b.im.count = 0; });
      lights.forEach(s => { s.busy = false; s.l.intensity = 0; });
      shake.trauma = 0;
    }
    function getStats() {
      const now = time;
      const particles = pools.add.alive(now) + pools.alpha.alive(now) + (pools.dist ? pools.dist.alive(now) : 0);
      const gpuBytes = (() => {
        let b = 0;
        for (const k of ['add', 'alpha', 'dist']) if (pools[k]) b += pools[k].cap * (4 * 9 + 6) * 4;
        b += trailPool.length * MAXS * MAXR * 7 * 4;
        const tex = t => t.image ? (t.image.width * t.image.height * 4 * 1.33) : 0;
        Object.values(textures).forEach(t => { b += tex(t); });
        if (pipeline === 'composite') {
          const px = (r, bpp) => r.width * r.height * bpp;
          b += px(comp.scene, 8 * Math.max(1, tier.msaa)) + px(comp.scene, 4) + px(comp.vfx, 8) + px(comp.dist, 8) + comp.b.reduce((a, r) => a + px(r, 8), 0);
        }
        return b;
      })();
      return {
        tier: tierName, pipeline, time: now, instances: instances.length, particles,
        trails: trailPool.filter(t => t.busy).length, shockwaves: shockPool.filter(s => s.busy).length,
        decals: decalPool.filter(d => d.busy).length, debris: debris.reduce((a, b) => a + b.items.length, 0),
        lights: lights.filter(l => l.busy).length, calls: drawInfo.calls, triangles: drawInfo.triangles,
        spawnedTotal: stats.spawned, vfxGpuMB: +(gpuBytes / 1048576).toFixed(1),
        capacity: { add: pools.add.cap, alpha: pools.alpha.cap, dist: pools.dist ? pools.dist.cap : 0, trails: trailPool.length, decals: decalPool.length, debris: DEB_CAP * debris.length }
      };
    }
    // Adaptive quality inside the session's pipeline: density only (no recompiles, no change to timing or hit logic).
    const adapt = { acc: 0, n: 0, enabled: want === 'auto', floor: 0.45 };
    function frameTime(ms) {
      if (!adapt.enabled) return;
      adapt.acc += ms; adapt.n++;
      if (adapt.n < 90) return;
      const avg = adapt.acc / adapt.n; adapt.acc = 0; adapt.n = 0;
      if (avg > 19 && settings.density > adapt.floor) settings.density = Math.max(adapt.floor, settings.density - 0.15);
      else if (avg < 12 && settings.density < 1) settings.density = Math.min(1, settings.density + 0.05);
    }
    function dispose() {
      clearAll();
      [vfxScene, distScene].forEach(sc => sc.traverse(o => { if (o.isMesh) { o.material.dispose(); } }));
      Object.values(pools).forEach(p => p && p.mesh.geometry.dispose());
      trailPool.forEach(t => t.mesh.geometry.dispose());
      [ringGeo, wallGeo, boxGeo, quadGeo, fsGeo].forEach(g => g.dispose());
      debris.forEach(b => { scene.remove(b.im); b.im.geometry.dispose(); b.im.dispose(); });
      debrisMat.dispose(); if (debrisMat.map) debrisMat.map.dispose();
      lights.forEach(s => scene.remove(s.l));
      Object.values(textures).forEach(t => t.dispose());
      if (pipeline === 'composite') { comp.scene.depthTexture.dispose(); comp.scene.dispose(); comp.vfx.dispose(); comp.dist.dispose(); comp.b.forEach(r => r.dispose()); comp.blur.m.dispose(); comp.out.m.dispose(); }
    }

    return {
      VERSION, tier: tierName, pipeline, effects, surfaces, atlas, settings, muted, shake, rigs, vfxScene, distScene,
      play, impact, update, render, prewarm, registerRig, registerWeapon, weapons, setCamera, setLighting, setSize, clearAll, frameTime, dispose,
      stats: getStats, time: () => time, list: () => [...effects.values()],
      setDensityFloor(v) { adapt.floor = v; },
      debugInstances: () => instances.map(i => ({ id: i.id, t: +i.t.toFixed(3), part: i.opts.part, weapon: i.opts.weapon, glows: i.glows.map(g => g && (g.wg ? +g.lv.toFixed(2) : 'mat')) }))
    };
  }

  root.SinVFX = { create, TIERS, VERSION, detectTier };
})(typeof window !== 'undefined' ? window : globalThis);
