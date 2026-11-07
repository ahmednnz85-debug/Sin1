/* Sîn — cinematic lighting / camera / quality layer (three r147, classic script).
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
    low:    { scale: 0.80, shadow: false, res: 1024, extent: 24, soft: false, veg: 0.60, pots: 48,  potShadow: 0,  dust: 180 },
    medium: { scale: 0.92, shadow: true,  res: 1024, extent: 26, soft: false, veg: 0.78, pots: 70,  potShadow: 22, dust: 320 },
    high:   { scale: 1.00, shadow: true,  res: 2048, extent: 32, soft: true,  veg: 1.00, pots: 110, potShadow: 46, dust: 500 }
  };
  const ORDER = ['low', 'medium', 'high'];
  function detectTier() {
    const ua = navigator.userAgent || '';
    const mobile = /iPhone|iPad|iPod|Android/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
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
  let pressure = 0;                                  // 0..3 adaptive degradation level
  let fovH = Number(store.get('fov')) || 73;         // horizontal FOV (degrees), 73 = test starting point

  function eff() {                                   // effective settings = tier ∘ pressure
    const t = Object.assign({}, TIERS[base]);
    if (pressure >= 1) t.scale *= 0.85;
    if (pressure >= 2) { t.res = Math.min(t.res, 1024); t.soft = false; t.veg *= 0.8; t.pots *= 0.8; t.potShadow *= 0.6; }
    if (pressure >= 3) { t.scale = Math.min(t.scale, 0.7); t.shadow = false; t.veg *= 0.85; }
    t.scale = Math.max(0.6, t.scale);
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
    if (!ctx.interior()) {
      const wantType = E.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
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
    babylon:   { exp: 0.97, fog: 1.10, fogTint: [1.04, 0.86, 0.78], hemi: 0.94, sun: 0.96 },
    courtyard: { exp: 0.96, fog: 0.78, fogTint: [1.02, 0.90, 0.82], hemi: 0.96, sun: 1.00 }
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
  function updateAtmo(dt, info) {
    if (ctx.interior()) return;                       // the palace hall owns its own lighting
    if (!baseAtmo) captureBase();
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
  // Fixes vs. the original: (1) quality could only be restored when the average frame time was < 14.5 ms (> 69 fps), which a
  // 60 fps display / the 60 fps cap can never reach, so one temporary dip degraded quality until the page was reloaded;
  // (2) shader-compile / loading hitches right after a transition counted as "slow", so entering the palace could lower
  // the resolution for good. Now: grace period after loads, hitches are clamped, restore works at a steady ~60 fps, and
  // repeated degrade/restore cycles back off exponentially (no visible resolution "breathing").
  let acc = 0, n = 0, winT = 0, slowWins = 0, fastT = 0, lastChange = 0, lastTs = 0;
  let restoreNeed = 8000, lastRestore = -1e9, graceUntil = 0;
  function govern(ts, busy) {
    const raw = lastTs ? ts - lastTs : 16.7; lastTs = ts;
    if (busy) graceUntil = ts + 2500;                    // first frames after a load / transition carry one-off hitches
    if (raw > 250 || busy || ts < graceUntil || document.hidden) { acc = n = winT = 0; return; }   // stalls / loading: not a perf signal
    const dt = Math.min(raw, 50);                        // a lone hitch (GC, upload, compile) must not look like sustained load
    acc += dt; n++; winT += raw;
    if (winT < 1500) return;
    const avg = acc / n; acc = n = winT = 0;
    perf.avg = avg;
    if (ts - lastChange < 2500) return;
    if (avg > 19.5) {                                    // < ~51 fps
      fastT = 0;
      if (++slowWins >= 2 && pressure < 3) {
        pressure++; slowWins = 0; lastChange = ts;
        if (ts - lastRestore < 30000) restoreNeed = Math.min(restoreNeed * 2, 64000);   // restored too early: wait longer next time
        refresh();
      }
      else if (slowWins >= 2 && mode === 'auto' && ORDER.indexOf(base) > 0) { base = ORDER[ORDER.indexOf(base) - 1]; pressure = 1; slowWins = 0; lastChange = ts; refresh(); }
    } else {
      slowWins = 0;
      if (avg <= 17.6) {                                 // holding ~57+ fps (the 60 fps cap gives ~16.7 ms)
        fastT += 1500;
        if (fastT >= restoreNeed && pressure > 0) { pressure--; fastT = 0; lastChange = ts; lastRestore = ts; refresh(); }
      } else fastT = 0;
      if (pressure === 0) restoreNeed = 8000;
    }
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
    gl = R.getContext();
    if (R.capabilities.isWebGL2) tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    R.render = function (s, c) {
      const main = perf.on && !R.getRenderTarget() && c && c.isPerspectiveCamera;
      let q = null;
      if (main && tq && !pendingQ) { q = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, q); }
      orig(s, c);
      if (q) { gl.endQuery(tq.TIME_ELAPSED_EXT); pendingQ = q; }
      if (main) { perf.calls = R.info.render.calls; perf.tris = R.info.render.triangles; }
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
    perf.frames.push(ts);
    while (perf.frames.length && ts - perf.frames[0] > 1000) perf.frames.shift();
    if (ts - perf.t < 400) return; perf.t = ts;
    const fr = perf.frames.length > 1 ? (perf.frames.length - 1) * 1000 / (ts - perf.frames[0]) : 0;
    perf.el.textContent =
      'FPS ' + fr.toFixed(0) + '   ' + (fr ? (1000 / fr).toFixed(1) : '-') + ' ms\n' +
      'Draws ' + perf.calls + '   Tris ' + (perf.tris / 1000).toFixed(0) + 'k\n' +
      'GPU ' + (perf.gpu == null ? 'n/a' : perf.gpu.toFixed(1) + ' ms') + '\n' +
      'Tier ' + (mode === 'auto' ? 'AUTO:' : '') + base.toUpperCase() + '  P' + pressure + '  x' + E.scale.toFixed(2) + '\n' +
      'Shadow ' + (E.shadow ? E.res + (E.soft ? ' soft' : ' pcf') : 'off') + '  Zone ' + zoneName;
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
      SUNV = o.sunDir.clone().normalize();
      ctx.interior = o.isInterior || ctx.interior; ctx.resize = o.resize || null; ctx.onTier = o.onTier || null; if (o.interiorFov) ctx.interiorFov = o.interiorFov;
      installFog(SUNV); lightBasis(); wrapRender();
      R.shadowMap.autoUpdate = true;
      applyShadowSettings(true);
      return base !== 'low';
    },
    hq() { return base !== 'low'; },
    settings() { return E; },
    pixelRatio() { return E.scale; },
    mode() { return mode; },
    tier() { return base; },
    setMode(m) {
      mode = (m === 'auto' || TIERS[m]) ? m : 'auto';
      base = mode === 'auto' ? detectTier() : mode; pressure = 0; slowWins = 0; fastT = 0;
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
    vegScale() { return E.veg; },
    potRange() { return E.pots; },
    potShadowRange() { return E.potShadow; },
    dustCount() { return E.dust; },
    // called once per rAF, before simulation
    frame(ts, busy) { govern(ts, busy); hud(ts); },
    // called once per simulation step, after the camera has been placed
    update(dt, info) { updateAtmo(dt, info); cameraFrame(dt, ctx.interior(), info && info.running); },
    status() { return { mode, tier: base, pressure, scale: E.scale, shadow: E.shadow ? E.res : 0, zone: zoneName, fovH, vfov: camera && camera.fov, avgMs: perf.avg }; }
  };
  window.SinGfx = API;
})();
