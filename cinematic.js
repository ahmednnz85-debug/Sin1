/* Sîn — cinematic lighting / camera / quality layer (three r187, classic script).
 *
 * Performance-first design:
 *  - Height fog + sun in-scattering are done INSIDE the existing fog shader chunk
 *    (no extra pass, no extra uniform, ~10 ALU per pixel).
 *  - No post-processing render targets: ACES tone mapping stays in-shader,
 *    vignette/grade stay the existing CSS overlays.
 *  - Only the sun casts a dynamic shadow; its frustum is snapped to shadow texels
 *    (stable shadows, no shimmering) and sized per quality tier.
 *  - Quality tiers (low / medium / high) + an adaptive governor that lowers
 *    render resolution, then shadow resolution, then shadows, when frame time
 *    rises, and restores them slowly (hysteresis) when it recovers.
 *  - Optional perf HUD (?perf or Settings): FPS, frame time, draw calls,
 *    triangles, GPU ms (only where EXT_disjoint_timer_query_webgl2 exists).
 */
(function () {
  'use strict';
  if (!window.THREE) return;
  const store = {
    get(k) { try { return localStorage.getItem('sin.gfx.' + k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem('sin.gfx.' + k, String(v)); } catch (_) {} }
  };

  // ---------- quality tiers ----------
  const TIERS = {
    //        render scale | shadows | map | half-extent(m) | soft | veg dist | pot cull(m) | pot shadow r(m) | dust
    // Start near native resolution; the previous 0.88/0.92 scales made the
    // whole game visibly soft. The governor still lowers scale only after a
    // sustained FPS drop, avoiding a permanent blurry image.
    // iPhone: never allocate a 2048 shadow map — that alone can tip Safari into
    // a memory kill after palace entry (confirmed crash with Tier HIGH / 2048).
    low:    { scale: 0.94, shadow: true,  res: 1024, extent: 88, soft: false, veg: 0.70, pots: 58,  potShadow: 18, dust: 220 },
    medium: { scale: 0.98, shadow: true,  res: 1024, extent: 88, soft: false, veg: 0.78, pots: 70,  potShadow: 22, dust: 320 },
    high:   { scale: 1.00, shadow: true,  res: 2048, extent: 88, soft: false, veg: 1.00, pots: 110, potShadow: 46, dust: 500 }
  };
  const ORDER = ['low', 'medium', 'high'];
  function isMobileUA() {
    if (window.SinDevice) return SinDevice.isMobile(navigator);
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod|Android/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  }
  function detectTier() {
    // Starting AUTO tier only. The governor below scales render resolution
    // up and down with hysteresis; we never lock a device onto a lower look.
    if (window.SinDevice) return SinDevice.detect().gfxTier;
    const mobile = isMobileUA();
    const mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 4;
    if (mobile) return (mem <= 3 || cores <= 4) ? 'low' : 'medium';
    return (cores <= 4) ? 'medium' : 'high';
  }

  let R = null, scene = null, camera = null, sun = null, hemi = null, fill = null, SUNV = null;
  let ctx = { interior: () => false, onTier: null, resize: null, interiorFov: 42 };
  let mode = store.get('tier') || 'auto';           // auto | low | medium | high
  if (!TIERS[mode] && mode !== 'auto') mode = 'auto';
  // migrate the old two-state preference written by index.html
  try { if (!store.get('tier') && localStorage.getItem('sin.quality') === 'low') mode = 'low'; } catch (_) {}
  let base = mode === 'auto' ? detectTier() : mode;
  let pressure = 0;                                  // 0..3 adaptive (resolution) degradation, not a locked tier
  // Target 60 fps (16.7 ms). Drop scale below 55, recover above 59.
  const dynamicResolution = window.SinDynamicResolution ? window.SinDynamicResolution.create({ min: 0.58, max: 1.00, initial: 1.00, downStep: 0.08, upStep: 0.01, lowerFps: 55, upperFps: 59, recoveryMs: 2500 }) : null;
  // After a memory-kill, start a little under native and ramp back up if
  // the frame time allows — temporary, not a permanent look change.
  try {
    if (dynamicResolution && window.SinDevice && SinDevice.pendingCrashDowngrade && SinDevice.pendingCrashDowngrade()) {
      dynamicResolution.reset(0.88);
    }
  } catch (_) {}
  let fovH = Number(store.get('fov')) || 73;         // horizontal FOV (degrees), 73 = test starting point

  function eff() {                                   // effective settings = tier ∘ pressure
    const t = Object.assign({}, TIERS[base]);
    // Keep the chosen visual tier stable. Only render resolution adapts; never
    // drop shadows, change shadow filtering, or cull scene detail as a reaction
    // to a short frame-time spike.
    t.shadow = true;
    // Cap shadow map size on phones even if the user picks HIGH — 2048² shadow
    // RT is a confirmed Safari memory killer once the palace is loaded.
    if (isMobileUA() && t.res > 1024) t.res = 1024;
    t.scale = dynamicResolution ? Math.min(t.scale, dynamicResolution.value()) : t.scale;
    return t;
  }
  let E = eff();

  // ---------- height fog + sun in-scatter (shader chunk patch) ----------
  function f(x) { return (Math.round(x * 1e5) / 1e5).toFixed(5); }
  function installFog(sunDir) {
    const C = THREE.ShaderChunk;
    C.fog_pars_vertex = '#ifdef USE_FOG\nvarying float vFogDepth;\nvarying vec3 vFogWorld;\n#endif\n';
    // world position rebuilt from mvPosition (works for every built-in material, instanced or not)
    C.fog_vertex = '#ifdef USE_FOG\nvFogDepth = - mvPosition.z;\n{ vec3 fd_ = mvPosition.xyz - viewMatrix[3].xyz;\n  vFogWorld = vec3( dot( viewMatrix[0].xyz, fd_ ), dot( viewMatrix[1].xyz, fd_ ), dot( viewMatrix[2].xyz, fd_ ) ); }\n#endif\n';
    C.fog_pars_fragment = '#ifdef USE_FOG\nuniform vec3 fogColor;\nvarying float vFogDepth;\nvarying vec3 vFogWorld;\n#ifdef FOG_EXP2\nuniform float fogDensity;\n#else\nuniform float fogNear;\nuniform float fogFar;\n#endif\n#endif\n';
    C.fog_fragment = [
      '#ifdef USE_FOG',
      '#ifdef FOG_EXP2',
      '  vec3 fr_ = vFogWorld - cameraPosition; float fl_ = max( length( fr_ ), 1e-3 );',
      '  float hy_ = 0.5 * ( vFogWorld.y + cameraPosition.y );',
      // height fog: full density near the ground, thins out above ~4 m (keeps the gate/palace silhouettes)
      '  float hf_ = 0.38 + 0.62 * exp( - max( hy_ - 4.0, 0.0 ) * 0.055 );',
      '  float fd_ = fogDensity * hf_;',
      '  float fogFactor = 1.0 - exp( - fd_ * fd_ * vFogDepth * vFogDepth );',
      // analytic sun in-scattering: haze looking toward the sun is warmer/brighter (approximation, not ray-marched)
      '  float sc_ = pow( max( dot( fr_ / fl_, vec3(' + f(sunDir.x) + ',' + f(sunDir.y) + ',' + f(sunDir.z) + ') ), 0.0 ), 6.0 );',
      '  vec3 fc_ = min( mix( fogColor, fogColor * vec3( 1.22, 1.02, 0.80 ), sc_ * 0.65 ), vec3( 1.0 ) );',
      '#else',
      '  float fogFactor = smoothstep( fogNear, fogFar, vFogDepth ); vec3 fc_ = fogColor;',
      '#endif',
      '  gl_FragColor.rgb = mix( gl_FragColor.rgb, fc_, fogFactor );',
      '#endif', ''
    ].join('\n');
  }

  // ---------- shadows ----------
  const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _d = new THREE.Vector3();
  function lightBasis() {
    _d.copy(SUNV).negate().normalize();
    _r.set(0, 1, 0).cross(_d); if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0); _r.normalize();
    _u.copy(_d).cross(_r).normalize();
  }
  function applyShadowSettings(force) {
    if (!sun) return;
    const c = sun.shadow.camera, ex = E.extent;
    if (force || c.right !== ex) { c.left = -ex; c.right = ex; c.top = ex; c.bottom = -ex; c.updateProjectionMatrix(); }
    if (sun.shadow.mapSize.x !== E.res) {
      sun.shadow.mapSize.set(E.res, E.res);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    if (!ctx.interior() && force) {
      // r181+: PCFSoftShadowMap is removed/deprecated; PCFShadowMap is soft.
      const wantType = THREE.PCFShadowMap;
      let recompile = false;
      if (R.shadowMap.enabled !== E.shadow) { R.shadowMap.enabled = E.shadow; recompile = true; }
      if (R.shadowMap.type !== wantType) { R.shadowMap.type = wantType; recompile = true; }
      if (recompile) scene.traverse(o => { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); } });
    }
  }
  // Snap the shadow frustum to whole shadow-map texels: removes edge shimmering while the hero walks.
  function snapShadow(center) {
    if (!sun || !SUNV) return;
    const texel = (2 * E.extent) / E.res;
    const u = center.dot(_r), v = center.dot(_u);
    const du = Math.round(u / texel) * texel - u, dv = Math.round(v / texel) * texel - v;
    sun.position.addScaledVector(_r, du).addScaledVector(_u, dv);
    sun.target.position.addScaledVector(_r, du).addScaledVector(_u, dv);
    sun.target.updateMatrixWorld();
  }

  // ---------- atmosphere zones with smooth transitions ----------
  let baseAtmo = null;
  const cur = {}, tgt = {};
  const ZONES = {
    approach:  { exp: 1.00, fog: 1.00, fogTint: [1, 1, 1],          hemi: 1.00, sun: 1.00 },
    babylon:   { exp: 0.97, fog: 1.10, fogTint: [1.04, 0.86, 0.78], hemi: 0.94, sun: 1.00 },
    courtyard: { exp: 0.96, fog: 0.78, fogTint: [1.02, 0.90, 0.82], hemi: 0.96, sun: 1.00 },
    // Interior: cut outdoor fog so ceilings/far walls are not crushed; hall lights own fill.
    palace:    { exp: 1.06, fog: 0.18, fogTint: [1.05, 0.92, 0.78], hemi: 0.00, sun: 0.00 }
  };
  let zoneName = 'approach';
  function captureBase() {
    baseAtmo = {
      exp: R.toneMappingExposure, fogD: scene.fog ? scene.fog.density : 0,
      fogC: scene.fog ? scene.fog.color.clone() : new THREE.Color(),
      hemi: hemi ? hemi.intensity : 0, sun: sun ? sun.intensity : 0
    };
    Object.assign(cur, ZONES.approach); cur.fogTint = ZONES.approach.fogTint.slice();
  }
  // ---------- cinematic interior look (God-of-War style, zero extra passes) ----------
  // Warm practicals (braziers) against a cool, low ambient; filmic ACES with a
  // tuned exposure; an HDR environment (warm fire hot-spots over a dark cool
  // room) for PBR reflections so metals read as metal instead of black; a warm
  // depth haze in the existing fog chunk. NO new lights, NO post passes, NO
  // new shadow casters: the look costs nothing per frame. It is applied by
  // light NAME/TYPE, so new rooms and assets pick it up automatically.
  const LOOK = {
    enabled: true,
    interior: {
      // Tuned so midtones stay near the pre-upgrade luminance (K3 ~57)
      // and materials (blue tiles, books, painted maps) stay clearly readable.
      // Warm practicals vs a cooler, brighter fill — not a dark orange wash.
      exposure: 1.16,
      envIntensity: 0.70,             // scene.environmentIntensity (r163+); keep IBL from washing albedo
      fogColor: [0.12, 0.10, 0.09], fogDensity: 0.0040,  // subtle depth haze, almost-neutral
      hemiSky: [0.52, 0.60, 0.76], hemiGround: [0.42, 0.32, 0.22], hemiGain: 1.05,  // cooler, lifted fill
      ambientGain: 1.15,
      fireColor: [1.0, 0.64, 0.36], fireGain: 1.28,  // warm key, not overpowering
      wingAmbientGain: 1.05             // K3/wings are lit mainly by this hemi; 0.6 crushed them
    },
    tier: { low: { envIntensity: 0.9 }, medium: {}, high: {} }
  };
  let interiorEnv = null, wasInterior = false, lookScanAt = 0;
  const lookLights = [];
  function interiorEnvironment(renderer) {
    if (interiorEnv) return interiorEnv;
    const r = renderer || R; if (!r || !THREE.PMREMGenerator || !THREE.DataTexture) return null;
    // 128x64 float equirect: dark cool upper room, warm floor bounce, a ring of
    // HDR fire hot-spots near the horizon (strong but small -> controlled
    // highlights on metal/gold, readable stone/wood).
    const W = 128, Hh = 64, data = new Float32Array(W * Hh * 4);
    for (let y = 0; y < Hh; y++) {
      const v = y / (Hh - 1);                  // 0 top .. 1 bottom
      const up = Math.max(0, 0.5 - v) * 2, down = Math.max(0, v - 0.5) * 2;
      for (let x = 0; x < W; x++) {
        const u = x / W, i = (y * W + x) * 4;
        let rr = 0.045 + 0.045 * up, gg = 0.050 + 0.060 * up, bb = 0.065 + 0.090 * up;   // cooler, brighter ceiling
        rr += 0.055 * down; gg += 0.042 * down; bb += 0.032 * down;                          // mild warm floor bounce
        const band = Math.exp(-Math.pow((v - 0.47) / 0.07, 2));                               // warm wall band
        rr += 0.045 * band; gg += 0.032 * band; bb += 0.018 * band;
        for (let k = 0; k < 6; k++) {                                                        // fire hot-spots
          const du = Math.min(Math.abs(u - (k + 0.5) / 6), 1 - Math.abs(u - (k + 0.5) / 6));
          const d2 = (du * 6.5) * (du * 6.5) + Math.pow((v - 0.44) / 0.05, 2);
          const f = 14.0 * Math.exp(-d2 * 24.0);   // small + hot: crisp highlights, little diffuse
          rr += f; gg += f * 0.52; bb += f * 0.20;
        }
        data[i] = rr; data[i + 1] = gg; data[i + 2] = bb; data[i + 3] = 1;
      }
    }
    const tex = new THREE.DataTexture(data, W, Hh, THREE.RGBAFormat, THREE.FloatType);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    const pm = new THREE.PMREMGenerator(r);
    interiorEnv = pm.fromEquirectangular(tex).texture;
    pm.dispose(); tex.dispose();
    interiorEnv.name = 'SinInteriorHDR';
    interiorEnv.userData.palaceShared = true;
    interiorEnv.addEventListener('dispose', function () { interiorEnv = null; });
    return interiorEnv;
  }
  function setRGB(c, a) { if (c && a) c.setRGB(a[0], a[1], a[2]); }
  function scanLookLights() {
    lookLights.length = 0;
    scene.traverse(function (o) {
      if (!o.isLight) return;
      let inside = false;
      for (let p = o.parent; p; p = p.parent) if (p.name === 'PalaceInterior' || p.name === 'PalaceWings') { inside = true; break; }
      if (inside) lookLights.push(o);
    });
  }
  function applyInteriorLook(t) {
    const L = Object.assign({}, LOOK.interior, LOOK.tier[base] || {});
    R.toneMappingExposure = L.exposure;
    if (scene.fog) { setRGB(scene.fog.color, L.fogColor); if (scene.fog.isFogExp2) scene.fog.density = L.fogDensity; }
    const env = interiorEnvironment(R);
    if (env && scene.environment !== env) scene.environment = env;
    if ('environmentIntensity' in scene) scene.environmentIntensity = L.envIntensity;
    if (t - lookScanAt > 1000) { lookScanAt = t; scanLookLights(); }
    for (let i = 0; i < lookLights.length; i++) {
      const o = lookLights[i], u = o.userData;
      if (o.isHemisphereLight) {
        if (o.name === 'PalaceWingsUnifiedAmbient') u.lookGain = L.wingAmbientGain; else u.lookGain = L.hemiGain;
        setRGB(o.color, L.hemiSky); setRGB(o.groundColor, L.hemiGround);
      } else if (o.isAmbientLight) { u.lookGain = L.ambientGain; }
      else if (o.isPointLight || o.isSpotLight) { setRGB(o.color, L.fireColor); u.lookGain = L.fireGain; }
    }
    document.documentElement.classList.add('sin-interior');
  }
  let outdoorEnv = null;
  function leaveInteriorLook() {
    if ('environmentIntensity' in scene) scene.environmentIntensity = 1;
    if (scene.environment === interiorEnv) scene.environment = outdoorEnv;
    R.toneMappingExposure = baseAtmo ? baseAtmo.exp * (cur.exp || 1) : R.toneMappingExposure;
    for (let i = 0; i < lookLights.length; i++) delete lookLights[i].userData.lookGain;
    document.documentElement.classList.remove('sin-interior');
  }
  // Runs every rAF (also while the simulation is held), before rendering.
  function lookFrame() {
    if (!R || !scene) return;
    const inside = !!ctx.interior() && LOOK.enabled !== false;
    if (inside) {
      if (!wasInterior) { outdoorEnv = scene.environment !== interiorEnv ? scene.environment : outdoorEnv; lookScanAt = 0; }
      applyInteriorLook(performance.now()); wasInterior = true;
    } else if (wasInterior) { leaveInteriorLook(); wasInterior = false; }
  }

  function updateAtmo(dt, info) {
    if (!baseAtmo) captureBase();
    if (ctx.interior()) {
      // Keep the HUD zone truthful, but leave exposure/fog exactly as the
      // pre-upgrade game did (the palace hall owns its own lighting). Ramping
      // fog to x0.18 and exposure to x1.06 over ~1 s after entry changed the
      // whole interior look and read as surfaces slowly fading in.
      zoneName = 'palace';
      return;
    }
    zoneName = info && info.courtyard ? 'courtyard' : info && info.babylon ? 'babylon' : 'approach';
    const z = ZONES[zoneName], k = 1 - Math.exp(-dt / 1.6);   // ~1.6 s time constant: no exposure jumps
    cur.exp += (z.exp - cur.exp) * k; cur.fog += (z.fog - cur.fog) * k;
    cur.hemi += (z.hemi - cur.hemi) * k; cur.sun += (z.sun - cur.sun) * k;
    for (let i = 0; i < 3; i++) cur.fogTint[i] += (z.fogTint[i] - cur.fogTint[i]) * k;
    R.toneMappingExposure = baseAtmo.exp * cur.exp;
    if (scene.fog) {
      scene.fog.density = baseAtmo.fogD * cur.fog;
      scene.fog.color.setRGB(baseAtmo.fogC.r * cur.fogTint[0], baseAtmo.fogC.g * cur.fogTint[1], baseAtmo.fogC.b * cur.fogTint[2]);
    }
    if (hemi) hemi.intensity = baseAtmo.hemi * cur.hemi;
    if (sun) sun.intensity = baseAtmo.sun * cur.sun;
  }

  // ---------- camera ----------
  const CAM = { shoulder: 0.36, lookUp: 0.0, outRate: 2.2, runPush: 0.06 };
  let clipT = 1, runK = 0, curV = 0;
  function vfovFor(aspect) {
    const v = 2 * Math.atan(Math.tan(fovH * Math.PI / 360) / Math.max(0.5, aspect)) * 180 / Math.PI;
    return Math.max(34, Math.min(62, v));
  }
  // Collision fraction smoothing: pull in instantly (never through walls), ease back out slowly.
  function smoothClip(t, dt) {
    if (t < clipT) clipT = t; else clipT += (t - clipT) * (1 - Math.exp(-dt * CAM.outRate));
    return clipT;
  }
  function cameraFrame(dt, interior, running) {
    runK += ((running ? 1 : 0) - runK) * (1 - Math.exp(-dt * 2));
    const want = interior ? ctx.interiorFov : vfovFor(camera.aspect);   // palace hall keeps its tuned framing
    if (!curV) curV = want;
    curV += (want - curV) * (1 - Math.exp(-dt * 4));
    if (Math.abs(camera.fov - curV) > 0.01) { camera.fov = curV; camera.updateProjectionMatrix(); }
  }

  // ---------- adaptive governor ----------
  let acc = 0, n = 0, winT = 0, slowWins = 0, fastT = 0, lastChange = 0, lastTs = 0;
  function govern(ts, busy) {
    const dt = lastTs ? ts - lastTs : 16.7; lastTs = ts;
    // Do not discard 3–4 FPS frames as "stalls": that left phones permanently
    // rendering at full resolution. Only ignore genuine pauses/resume gaps.
    if (!Number.isFinite(dt) || dt > 2000 || busy || document.hidden) {
      if (dynamicResolution) dynamicResolution.sample(0, dt, true);
      acc = n = winT = 0; return;
    }   // stalls / loading / transitions are not a performance signal
    acc += dt; n++; winT += dt;
    if (winT < 1500) return;
    const avg = acc / n, sampleMs = winT; acc = n = winT = 0;
    perf.avg = avg;
    if (dynamicResolution) {
      let memoryLevel = 'normal';
      try {
        const zr = window.PalaceWings && PalaceWings.zones && PalaceWings.zones();
        memoryLevel = (zr && zr.memory && zr.memory.level) || 'normal';
      } catch (_) {}
      if (memoryLevel === 'critical') pressure = Math.min(3, pressure + 1);
      else if (memoryLevel === 'watch') pressure = Math.min(2, Math.max(pressure, 1));
      else if (pressure > 0) pressure -= 1;
      const change = dynamicResolution.sample(1000 / avg, sampleMs, false, { triangles: perf.tris || 0, memoryLevel: memoryLevel });
      if (change.changed) { E = eff(); if (ctx.resize) ctx.resize(); }
    }
    // Keep shadow policy, material layout, LOD distances and grade fixed during
    // play. Resolution-only changes use small, hysteretic steps above.
    slowWins = 0;
    fastT = 0;
  }

  // ---------- perf HUD ----------
  const perf = { on: /[?&]perf\b/.test(location.search) || store.get('perf') === '1', avg: 0, frames: [], calls: 0, tris: 0, gpu: null, el: null, t: 0 };
  let tq = null, gl = null, pendingQ = null;
  function ensureHud() {
    if (perf.el || !perf.on) return;
    const d = document.createElement('div');
    d.id = 'sin-perf';
    d.style.cssText = 'position:fixed;z-index:50;left:calc(8px + env(safe-area-inset-left,0px));top:8px;padding:6px 8px;font:11px/1.35 ui-monospace,Menlo,monospace;color:#f2e2c2;background:rgba(10,8,6,.62);border:1px solid rgba(225,183,111,.4);pointer-events:none;white-space:pre';
    document.body.appendChild(d); perf.el = d;
  }
  function wrapRender() {
    const orig = R.render.bind(R);
    try { if (typeof window !== 'undefined') window.__R = R; } catch (_) {}
    gl = R.getContext();
    if (R.capabilities.isWebGL2) tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    R.render = function (s, c) {
      try {
        if (typeof window !== 'undefined') {
          window.__R = R;
          if (c && c.isCamera) window.__C = c;
          if (s && s.isScene) window.__S = s;
        }
      } catch (_) {}
      const isMain = !R.getRenderTarget() && c && c.isPerspectiveCamera;
      // Instance-level wrap shadows prototype hooks, so outdoor-perf must
      // run here or LODs/culling never apply on a real device.
      if (isMain) {
        try {
          if (window.SinOutdoorPerf && SinOutdoorPerf.beforeRender)
            SinOutdoorPerf.beforeRender(s, c);
        } catch (_) {}
      }
      const main = perf.on && isMain;
      let q = null;
      if (main && tq && !pendingQ) { q = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, q); }
      orig(s, c);
      if (q) { gl.endQuery(tq.TIME_ELAPSED_EXT); pendingQ = q; }
      // Record tris/draws even when the on-screen HUD is off (diag / estimator).
      if (isMain) {
        perf.calls = R.info.render.calls; perf.tris = R.info.render.triangles;
        // Instance R.render shadows the process-memory prototype hook, so
        // outdoor CPU ImageBitmaps (~375 MB) never dropped and process
        // memory sat at ~994 MB (iOS jetsam range). Drain here, throttled,
        // after the GPU has the copy. Same rule as palace: shared sources
        // only after every clone is resident.
        try {
          if (window.SinProcessMemory && SinProcessMemory.releaseCpuFromObject) {
            const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
            // Every 2 s was too slow: during REVEAL and K2 dress, new
            // ImageBitmaps arrive faster than the drain, so CPU (~230 MB)
            // overlapped GPU (~690 MB) and process peaked at 1081–1137 MB
            // (iOS jetsam). Drain every frame while the palace is busy or
            // a wing is still streaming; otherwise keep the 2 s cadence.
            let busy = false;
            try {
              const ps = window.PalaceInterior && PalaceInterior.state && PalaceInterior.state();
              busy = ['LOADING','SETUP','FADING_OUT','FADING_IN','REVEAL','ENTRANCE','SETTLE'].indexOf(ps) >= 0;
              const zs = window.PalaceWings && PalaceWings.zones && PalaceWings.zones();
              if (zs && zs.zones) {
                const rows = Array.isArray(zs.zones) ? zs.zones : Object.keys(zs.zones).map(function (k) { return zs.zones[k]; });
                for (let i = 0; i < rows.length; i++) {
                  const st = rows[i] && (rows[i].state || rows[i].status);
                  if (st && st !== 'ready' && st !== 'cold' && st !== 'evicted' && st !== 'unregistered') { busy = true; break; }
                }
              }
            } catch (_) {}
            // First ~3 s of outdoor load has the same overlap (city
            // ImageBitmaps + GPU copies → peak 998 before the palace).
            if (R.__sinCpuRelFrames == null) R.__sinCpuRelFrames = 0;
            R.__sinCpuRelFrames++;
            const interval = (busy || R.__sinCpuRelFrames < 180) ? 0 : 2000;
            if (!R.__sinCpuRelAt || now - R.__sinCpuRelAt > interval) {
              R.__sinCpuRelAt = now;
              const rel = SinProcessMemory.releaseCpuFromObject(s, R, { upload: false });
              try { window.__sinCpuRelease = rel; } catch (_) {}
            }
          }
        } catch (_) {}
      }
    };
  }
  function pollGpu() {
    if (!pendingQ || !tq) return;
    if (!gl.getQueryParameter(pendingQ, gl.QUERY_RESULT_AVAILABLE)) return;
    if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) perf.gpu = gl.getQueryParameter(pendingQ, gl.QUERY_RESULT) / 1e6;
    gl.deleteQuery(pendingQ); pendingQ = null;
  }
  function hud(ts) {
    if (!perf.on) { if (perf.el) { perf.el.remove(); perf.el = null; } return; }
    ensureHud(); pollGpu();
    // Ignore harness/tab-stall gaps so a single long pause does not
    // empty the 1 s window and flash "FPS 0   - ms" (r5 lab + any
    // real >1 s hitch). Keep the last good reading.
    const hudStall = 500;
    if (perf._lastTs && ts - perf._lastTs > hudStall) perf.frames = [];
    perf._lastTs = ts;
    perf.frames.push(ts);
    while (perf.frames.length > 2 && ts - perf.frames[0] > 1000) perf.frames.shift();
    if (ts - perf.t < 400) return; perf.t = ts;
    let fr = perf._lastFr || 0;
    if (perf.frames.length > 1 && ts > perf.frames[0]) {
      const cand = (perf.frames.length - 1) * 1000 / (ts - perf.frames[0]);
      if (Number.isFinite(cand) && cand > 0) { fr = cand; perf._lastFr = cand; }
    } else if (!fr && perf.avg > 0 && perf.avg < 2000) {
      fr = 1000 / perf.avg;
    }
    const mapOn = !!(R && R.shadowMap && R.shadowMap.enabled);
    perf.el.textContent =
      'FPS ' + fr.toFixed(0) + '   ' + (fr ? (1000 / fr).toFixed(1) : '-') + ' ms\n' +
      'Draws ' + perf.calls + '   Tris ' + (perf.tris / 1000).toFixed(0) + 'k\n' +
      'GPU ' + (perf.gpu == null ? 'n/a' : perf.gpu.toFixed(1) + ' ms') + '\n' +
      'Tier ' + (mode === 'auto' ? 'AUTO:' : '') + base.toUpperCase() + '  P' + pressure + '  x' + E.scale.toFixed(2) + '\n' +
      'Renderer shadowMap ' + (mapOn ? ((sun && sun.shadow && sun.shadow.mapSize ? sun.shadow.mapSize.x : 0) + 'px') : 'OFF') + ' (policy ' + (E.shadow ? 'ON' : 'OFF') + ')  Zone ' + zoneName;
  }

  // On-demand diagnostic: distinguishes the live renderer shadow map from baked/AO light maps.
  function shadowSnapshot() {
    const camera = sun && sun.shadow ? sun.shadow.camera : null;
    const snap = { mapEnabled: !!(R && R.shadowMap && R.shadowMap.enabled), policyEnabled: !!E.shadow,
      mapSize: sun && sun.shadow && sun.shadow.mapSize ? sun.shadow.mapSize.x : 0, extent: E.extent,
      shadowFrustum: camera ? { left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom, near: camera.near, far: camera.far } : null,
      shadowLights: [], shadowCasters: 0, shadowReceivers: 0, bakedLightingMaterials: 0 };
    if (scene) scene.traverse(function (o) {
      if (o.isLight && o.castShadow) snap.shadowLights.push({ name: o.name || '(unnamed)', intensity: o.intensity });
      if (!o.isMesh) return;
      if (o.castShadow) snap.shadowCasters++;
      if (o.receiveShadow) snap.shadowReceivers++;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some(function (m) { return !!(m && (m.lightMap || m.aoMap)); })) snap.bakedLightingMaterials++;
    });
    return snap;
  }
  // ---------- public API ----------
  function refresh() {
    E = eff();
    applyShadowSettings(false);
    if (ctx.resize) ctx.resize();
    if (ctx.onTier) ctx.onTier(base !== 'low', E);
  }
  const API = {
    TIERS,
    install(o) {
      R = o.renderer; scene = o.scene; camera = o.camera; sun = o.sun; hemi = o.hemi; fill = o.fill || null;
      try { if (typeof window !== 'undefined') window.__R = R; } catch (_) {}
      SUNV = o.sunDir.clone().normalize();
      ctx.interior = o.isInterior || ctx.interior; ctx.resize = o.resize || null; ctx.onTier = o.onTier || null; if (o.interiorFov) ctx.interiorFov = o.interiorFov;
      installFog(SUNV); lightBasis(); wrapRender();
      R.shadowMap.autoUpdate = true;
      applyShadowSettings(true);
      return base !== 'low';
    },
    hq() { return base !== 'low'; },
    settings() { return E; },
    pixelRatio() {
      // Cap DPR so Retina stays sharp without uncapped 3× pixel fill on phones.
      // iPhone 16-class: allow up to 1.25×; the dynamic-resolution governor still
      // scales down under frame pressure. Desktop stays at the same 1.25× ceiling.
      const dpr = Number(window.devicePixelRatio) || 1;
      return Math.min(1.25, Math.max(1, dpr)) * E.scale;
    },
    mode() { return mode; },
    tier() { return base; },
    setMode(m) {
      mode = (m === 'auto' || TIERS[m]) ? m : 'auto';
      base = mode === 'auto' ? detectTier() : mode;
      pressure = 0; slowWins = 0; fastT = 0;
      store.set('tier', mode); refresh();
    },
    cycleMode() { const L = ['auto', 'low', 'medium', 'high']; API.setMode(L[(L.indexOf(mode) + 1) % L.length]); return mode; },
    label() { return mode === 'auto' ? 'AUTO (' + base.toUpperCase() + ')' : mode.toUpperCase(); },
    fov() { return fovH; },
    setFov(v) { fovH = Math.max(60, Math.min(90, Math.round(Number(v) || 73))); store.set('fov', fovH); },
    vfov: vfovFor,
    camera: CAM,
    smoothClip,
    setPerf(on) { perf.on = !!on; store.set('perf', on ? '1' : '0'); },
    perfOn() { return perf.on; },
    snapShadow,
    shadowSnapshot,
    vegScale() { return E.veg; },
    potRange() { return E.pots; },
    potShadowRange() { return E.potShadow; },
    dustCount() { return E.dust; },
    // called once per rAF, before simulation
    frame(ts, busy) {
      govern(ts, busy); hud(ts);
      try { lookFrame(); } catch (_) {}
      try {
        if (window.SinMemoryOverlay) {
          const memCtx = {
            renderer: R,
            scene: scene,
            phase: window.PalaceInterior && PalaceInterior.status && PalaceInterior.status().phase
          };
          // Black box always ticks (sessionStorage); HUD only when overlay is on.
          if (SinMemoryOverlay.tick) SinMemoryOverlay.tick(memCtx);
          else if (SinMemoryOverlay.on()) SinMemoryOverlay.render(memCtx);
        }
      } catch (_) {}
    },
    // called once per simulation step, after the camera has been placed
    look: LOOK,
    interiorEnvironment: interiorEnvironment,
    update(dt, info) { updateAtmo(dt, info); cameraFrame(dt, ctx.interior(), info && info.running); },
    renderer() { return R; },
    scene() { return scene; },
    // MUST NOT be named camera(): that overwrote camera: CAM, so
    // SinGfx.camera.shoulder was undefined, follow-cam want became NaN,
    // and the 3D view went fully black after NEW GAME (r5 / PR #45).
    getCamera() { return camera; },
    status() { return { mode, tier: base, pressure, scale: E.scale, targetScale: dynamicResolution ? dynamicResolution.value() : E.scale, shadow: E.shadow ? E.res : 0, shadowPolicy: !!E.shadow, shadowMapEnabled: !!(R && R.shadowMap && R.shadowMap.enabled), zone: zoneName, fovH, vfov: camera && camera.fov, avgMs: perf.avg, calls: perf.calls, tris: perf.tris }; }
  };
  window.SinGfx = API;
})();
