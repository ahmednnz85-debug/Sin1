/* SÎN ENGINE — fixed light budget for the palace interior ("light rig").
   ---------------------------------------------------------------------------
   Why: three.js bakes the NUMBER of lights of every type (point, spot, spot
   with shadow, directional, hemisphere, ...) into each shader program. Every
   palace room carries its own braziers / sun / local ambient, and portal
   culling hides or shows them with the room. So the moment a room became
   ready (or swung into view) the light counts changed and EVERY visible
   material — hall, corridors, hero, the room itself — needed a new program
   variant, compiled synchronously in that one frame. Measured on the iPhone
   profile: L1 reveal linked 41 programs in one frame and froze ~3 s
   (SwiftShader); on an iPhone that is the multi-second stall at every room.

   What: the rig keeps the light layout CONSTANT. For every category it holds
   a pool of silent pad lights (black, intensity 0) and, before each render of
   the palace scene, shows exactly as many pads as are needed to bring the
   visible real lights up to a fixed target. Program keys never change, so
   every material compiles once (behind the loading screen / during the
   room's off-screen preparation) and a reveal compiles nothing.

   Look: a pad adds exactly zero light (its colour uniform is 0). The fragment
   shader skips the BRDF for any light whose incoming colour is zero, so pads
   cost a uniform load and a branch per pixel, not a lighting evaluation.
   The same skip is exact for real lights beyond their range or fully in
   shadow (their contribution was colour × 0 before).

   Real lights are never moved, dimmed or reassigned. If a view ever shows
   more real lights of a category than its target, the rig shows no pads for
   that category (three.js then behaves exactly as before) and logs it once.
*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SinLightRig = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // Categories match WebGLLights.setup(): a shadow-casting light is counted
  // in its type's total AND in the shadow total, and a spot light with a
  // projected map (L1's skylight sun) also in the map totals — every
  // combination is kept apart so the program key stays exact.
  const CATEGORIES = ['point', 'pointShadow', 'spot', 'spotShadow', 'spotMap', 'spotShadowMap', 'dir', 'dirShadow', 'hemi', 'rect', 'probe'];
  // The largest set of real lights any palace view shows at once, with
  // headroom. A frame that ever shows more simply compiles once for that
  // view, as three.js did before (and the rig logs it).
  // Census (?lightrig=measure, every room): hall 8 point / 3 dir / 3 hemi;
  // L1 10 point + the skylight sun (spot, shadow, map); T1 7; T4 8; T3 4 +
  // 2 spot + 1 hemi; T5 2 + 2 spot; L2 2 + 1 spot; L3 4; K5 4. Worst view:
  // the hall looking into L1 and T1 = 25 point lights. Without the rig the
  // same tour produced 10 different light layouts, i.e. 10 full rebuilds of
  // every visible material.
  const DEFAULT_TARGETS = { point: 26, pointShadow: 0, spot: 4, spotShadow: 0, spotMap: 0, spotShadowMap: 1, dir: 3, dirShadow: 1, hemi: 4, rect: 0, probe: 0 };

  function category(l) {
    if (!l || !l.isLight || l.isAmbientLight) return null;
    if (l.isLightProbe) return 'probe';
    if (l.isRectAreaLight) return 'rect';
    if (l.isHemisphereLight) return 'hemi';
    if (l.isDirectionalLight) return l.castShadow ? 'dirShadow' : 'dir';
    if (l.isSpotLight) return l.map ? (l.castShadow ? 'spotShadowMap' : 'spotMap') : (l.castShadow ? 'spotShadow' : 'spot');
    if (l.isPointLight) return l.castShadow ? 'pointShadow' : 'point';
    return 'other';
  }
  function emptyCounts() { const c = {}; CATEGORIES.forEach(k => { c[k] = 0; }); c.other = 0; return c; }

  // Exact replica of three.js' rule: a light is collected when it and every
  // ancestor are visible, it is attached to the rendered scene, and its
  // layers pass the camera (default layers everywhere in the palace).
  function rendered(light, scene, camera) {
    let node = light;
    for (; node; node = node.parent) {
      if (node.visible === false) return false;
      if (node === scene) break;
    }
    if (node !== scene) return false;
    return !camera || !camera.layers || light.layers.test(camera.layers);
  }

  // Shader side: a light whose colour uniform is zero is skipped before any
  // per-pixel work (uniform branch: every pixel takes the same path, so a
  // pad costs a compare). Exact for real lights too: their whole
  // contribution is a multiple of that colour.
  const LOOP_HEADS = [
    ['pointLight = pointLights[ i ];', 'pointLight.color'],
    ['spotLight = spotLights[ i ];', 'spotLight.color'],
    ['directionalLight = directionalLights[ i ];', 'directionalLight.color']
  ];
  const DIRECT_CALL = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
  function patchShaderChunks(THREE) {
    const SC = THREE && THREE.ShaderChunk;
    if (!SC || !SC.lights_fragment_begin || SC.__sinLightRigPatched) return false;
    let src = SC.lights_fragment_begin;
    for (const [head, colour] of LOOP_HEADS) {
      const at = src.indexOf(head);
      if (at < 0) return false;
      const end = src.indexOf(DIRECT_CALL, at);
      if (end < 0) return false;
      const close = end + DIRECT_CALL.length;
      src = src.slice(0, at) + head + '\n\t\tif ( ' + colour + ' != vec3( 0.0 ) ) {' + src.slice(at + head.length, close) + '\n\t\t}' + src.slice(close);
    }
    SC.lights_fragment_begin = src;
    SC.__sinLightRigPatched = true;
    return true;
  }

  function create(THREE, options) {
    const o = Object.assign({ targets: DEFAULT_TARGETS, log: null }, options || {});
    const attachHook = o.attachRenderer || null;
    const targets = Object.assign(emptyCounts(), o.targets);
    const lights = new Set();
    const pads = {};
    let scene = null, padRoot = null, active = false, configScene = null, padMap = null;
    const overflowSeen = new Set();
    const stats = { applies: 0, overflows: 0, lastCounts: null, lastPads: null, max: emptyCounts() };

    function note(msg) { try { if (o.log) o.log(msg); else console.info('[light-rig] ' + msg); } catch (_) {} }

    function makePad(cat) {
      let l;
      if (cat === 'point' || cat === 'pointShadow') { l = new THREE.PointLight(0x000000, 0, 0.001, 2); }
      else if (/^spot/.test(cat)) {
        l = new THREE.SpotLight(0x000000, 0, 0.001, 0.1, 0, 2);
        if (/Map$/.test(cat)) {
          if (!padMap) { padMap = new THREE.DataTexture(new Uint8Array(4), 1, 1); padMap.needsUpdate = true; }
          l.map = padMap;
        }
      }
      else if (cat === 'dir' || cat === 'dirShadow') { l = new THREE.DirectionalLight(0x000000, 0); }
      else if (cat === 'hemi') { l = new THREE.HemisphereLight(0x000000, 0x000000, 0); }
      else if (cat === 'rect' && THREE.RectAreaLight) { l = new THREE.RectAreaLight(0x000000, 0, 0.001, 0.001); }
      else if (cat === 'probe' && THREE.LightProbe) { l = new THREE.LightProbe(); l.intensity = 0; }
      if (!l) return null;
      if (/Shadow/.test(cat)) {
        l.castShadow = true;
        // Never re-rendered: one tiny map, if shadows are ever on.
        l.shadow.mapSize.set(1, 1);
        l.shadow.autoUpdate = false;
        l.shadow.needsUpdate = true;
      }
      l.position.set(0, -10000, 0);
      if (l.target) { l.target.position.set(0, -10001, 0); padRoot.add(l.target); }
      l.name = 'sin-light-pad-' + cat;
      l.userData.sinLightPad = true;
      l.userData.sinKeepVisible = true;
      l.visible = false;
      return l;
    }
    function buildPads() {
      padRoot = new THREE.Group();
      padRoot.name = 'SinLightRigPads';
      padRoot.userData.sinKeepVisible = true;
      padRoot.userData.keepDuringPalace = true;
      CATEGORIES.forEach(cat => {
        pads[cat] = [];
        for (let i = 0; i < (targets[cat] || 0); i++) {
          const p = makePad(cat);
          if (!p) break;
          padRoot.add(p);
          pads[cat].push(p);
        }
      });
    }
    function track(obj) {
      if (!obj || !obj.traverse) return;
      obj.traverse(x => { if (x.isLight && !(x.userData && x.userData.sinLightPad)) lights.add(x); });
    }
    function count(camera) {
      const c = emptyCounts();
      if (!scene) return c;
      lights.forEach(l => {
        // One walk to the root: visibility chain + attachment.
        let shown = true, node = l;
        for (; node.parent; node = node.parent) if (node.visible === false) shown = false;
        // Not under the scene any more (evicted room, removed effect): drop
        // the reference so the disposed subtree can be collected. A later
        // add() of that subtree tracks its lights again.
        if (node !== scene) { lights.delete(l); return; }
        if (!shown || scene.visible === false) return;
        if (camera && camera.layers && !l.layers.test(camera.layers)) return;
        const k = category(l);
        if (k) c[k]++;
      });
      return c;
    }
    // Show exactly target - real pads per category.
    function apply(camera) {
      if (!active || !scene) return null;
      stats.applies++;
      const c = count(camera);
      let overflow = '';
      if (c.other) overflow += ' unsupported light type';
      CATEGORIES.forEach(cat => {
        const want = Math.max(0, (targets[cat] || 0) - c[cat]);
        if (c[cat] > (targets[cat] || 0)) overflow += ' ' + cat + ' ' + c[cat] + '>' + (targets[cat] || 0);
        const list = pads[cat] || [];
        for (let i = 0; i < list.length; i++) {
          const v = i < want;
          if (list[i].visible !== v) list[i].visible = v;
        }
      });
      stats.lastCounts = c;
      Object.keys(c).forEach(k => { if (c[k] > (stats.max[k] || 0)) stats.max[k] = c[k]; });
      if (overflow && !overflowSeen.has(overflow)) {
        overflowSeen.add(overflow);
        stats.overflows++;
        note('light budget exceeded —' + overflow + ' (programs for this view compile once)');
      }
      return c;
    }

    // ---- compile against the fixed layout ---------------------------------
    // A scene that holds exactly the target layout (clones of the pads, all
    // visible) with the real scene's fog / environment: compiling against it
    // yields the program the real frame will use.
    function compileScene(real) {
      if (!configScene) {
        configScene = new THREE.Scene();
        configScene.name = 'SinLightRigConfig';
        CATEGORIES.forEach(cat => (pads[cat] || []).forEach(p => {
          const c = p.clone();
          c.visible = true;
          configScene.add(c);
          if (c.target) configScene.add(c.target);
        }));
      }
      const s = real || scene;
      if (s) {
        configScene.fog = s.fog || null;
        configScene.environment = s.environment || null;
        if (s.environmentIntensity != null) configScene.environmentIntensity = s.environmentIntensity;
        if (s.environmentRotation && configScene.environmentRotation) configScene.environmentRotation.copy(s.environmentRotation);
        configScene.background = null;
      }
      return configScene;
    }
    // Lights INSIDE the object would be counted on top of the layout: hide
    // them only for the synchronous part of compile().
    function withoutOwnLights(object, fn) {
      const hidden = [];
      if (object && object.traverse) object.traverse(x => { if (x.isLight && x.visible && !(x.userData && x.userData.sinLightPad)) { hidden.push(x); x.visible = false; } });
      try { return fn(); } finally { hidden.forEach(x => { x.visible = true; }); }
    }
    function compile(renderer, object, camera) {
      if (!active || !renderer) return null;
      const target = compileScene(scene);
      return withoutOwnLights(object, () => renderer.compile(object, camera, target));
    }
    function compileAsync(renderer, object, camera) {
      if (!active || !renderer) return null;
      const target = compileScene(scene);
      if (typeof renderer.compileAsync !== 'function') return Promise.resolve(withoutOwnLights(object, () => renderer.compile(object, camera, target)));
      return withoutOwnLights(object, () => renderer.compileAsync(object, camera, target));
    }

    function install(s, renderer) {
      if (!s) return false;
      if (renderer && typeof attachHook === 'function') attachHook(renderer);
      if (active && scene === s) return true;
      if (active) uninstall();
      scene = s;
      if (!padRoot) buildPads();
      scene.add(padRoot);
      lights.clear();
      track(scene);
      active = true;
      apply(null);
      note('installed: targets ' + JSON.stringify(Object.fromEntries(CATEGORIES.map(k => [k, targets[k]]))));
      return true;
    }
    function uninstall() {
      if (padRoot && padRoot.parent) padRoot.parent.remove(padRoot);
      active = false; scene = null; lights.clear();
    }
    function report() {
      return { active, targets: Object.fromEntries(CATEGORIES.map(k => [k, targets[k]])), lights: lights.size,
        counts: stats.lastCounts, max: stats.max, applies: stats.applies, overflows: stats.overflows, overflowKinds: Array.from(overflowSeen) };
    }
    return { install, uninstall, apply, track, count, compile, compileAsync, compileScene, report,
      active: () => active, scene: () => scene, targets: () => Object.assign({}, targets) };
  }

  // ---- runtime wiring (browser) --------------------------------------------
  // One rig per page. Object3D.add feeds new lights to it; render() and
  // compile() of the rig's scene apply the layout first.
  let shared = null;
  function boot(THREE, options) {
    if (shared || !THREE || !THREE.WebGLRenderer) return shared;
    // ?lightrig=off: legacy behaviour (A/B). ?lightrig=measure: count the
    // real lights per view (report().max) without pads.
    let mode = '';
    try { mode = (new URLSearchParams(location.search).get('lightrig') || '').toLowerCase(); } catch (_) {}
    if (mode === 'off') return null;
    patchShaderChunks(THREE);
    const extra = mode === 'measure' ? { targets: Object.fromEntries(CATEGORIES.map(k => [k, 0])), log: () => {} } : {};
    shared = create(THREE, Object.assign({ attachRenderer: r => attachRenderer(r) }, options || {}, extra));
    const O = THREE.Object3D && THREE.Object3D.prototype;
    if (O && !O.__sinLightRigAdd) {
      const add = O.add;
      O.add = function () {
        const r = add.apply(this, arguments);
        if (shared && shared.active()) for (let i = 0; i < arguments.length; i++) shared.track(arguments[i]);
        return r;
      };
      O.__sinLightRigAdd = true;
    }
    return shared;
  }
  // three.js r187 defines render()/compile() inside the WebGLRenderer
  // constructor (instance properties), so the rig wraps the live renderer
  // instance; prototype patches would never run. compileAsync() calls
  // this.compile(), so it is covered too.
  function attachRenderer(renderer) {
    if (!renderer || renderer.__sinLightRig || typeof renderer.render !== 'function') return false;
    const render = renderer.render, compile = renderer.compile;
    renderer.render = function (scene, camera) {
      if (shared && shared.active() && scene === shared.scene()) shared.apply(camera);
      return render.apply(this, arguments);
    };
    if (typeof compile === 'function') {
      renderer.compile = function (scene, camera, targetScene) {
        if (shared && shared.active() && (targetScene || scene) === shared.scene()) shared.apply(camera);
        return compile.apply(this, arguments);
      };
    }
    renderer.__sinLightRig = true;
    return true;
  }

  const api = { create, boot, attachRenderer, category, rendered, patchShaderChunks, CATEGORIES, DEFAULT_TARGETS };
  Object.defineProperty(api, 'shared', { get: () => shared });
  ['install', 'uninstall', 'apply', 'compile', 'compileAsync', 'compileScene', 'report'].forEach(fn => {
    api[fn] = function () { return shared ? shared[fn].apply(null, arguments) : null; };
  });
  api.active = () => !!(shared && shared.active());
  return api;
});

// Legacy-script boot: THREE is on window before the game scripts run.
if (typeof window !== 'undefined' && window.THREE && window.SinLightRig) window.SinLightRig.boot(window.THREE);
