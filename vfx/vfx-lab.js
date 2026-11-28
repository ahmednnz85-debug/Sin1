/* Sîn VFX Laboratory — independent effects test bench (developer tool).
   Loads the approved hero (assets/Sin_hero_runtime.glb, the game's runtime copy of
   Sin_combat_FINAL3_axe.glb) and the Guardian of the Covenant
   (assets/Guardian_of_the_Covenant.glb, its staff and its 59 authored clips), an
   Irkalla-like floor, and the Sîn Advanced VFX Engine (vfx/sin-vfx.js).

   Nothing here is used by the game. Models, bones, materials and clips are used as
   loaded: the lab only parents marker objects under existing sockets and animates
   runtime material emissive intensities (restored after each effect).

   URL: vfx-lab.html[?quality=high|medium|low|auto][&effect=ID][&clean=1][&auto=1]
   Automation: window.__vfxLab (ready / error, playEffect, playClip, combo, duel, advance …). */
import * as THREE_ from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const THREE = { ...THREE_ };
window.THREE = THREE;
const qs = new URLSearchParams(location.search);
const $ = s => document.querySelector(s);
const lab = window.__vfxLab = { ready: false, error: null };
const setMsg = t => { const e = $('#loadmsg'); if (e) e.textContent = t; };
window.addEventListener('error', e => { lab.error = lab.error || String(e.message || e); });

function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(s); });
}

const PRESET_KEY = 'sin-vfx-lab:presets';
const store = {
  get() { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '{}'); } catch (e) { return {}; } },
  set(v) { try { localStorage.setItem(PRESET_KEY, JSON.stringify(v)); return true; } catch (e) { return false; } }
};

try {
  await main();
} catch (e) {
  console.error(e);
  lab.error = String(e && e.stack || e);
  setMsg('خطأ: ' + (e && e.message || e));
}

async function main() {
  setMsg('engine…');
  await loadScript('vfx/sin-vfx.js?v=1');
  await loadScript('sin-hero.js?v=vfxlab');          // read-only: the game's own attack hit windows (SinHero.CONFIG)

  // ------------------------------------------------------------------ renderer / world
  const canvas = $('#c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: qs.has('auto') });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15141f);
  scene.fog = new THREE.FogExp2(0x15141f, 0.022);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 160);
  camera.position.set(7.5, 3.6, -6.5);

  const hemi = new THREE.HemisphereLight(0x7a88b0, 0x3a2a1c, 1.9); scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xc4d2ff, 2.6); moon.position.set(-7, 13, -5);
  moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048); moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.02;
  Object.assign(moon.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 }); scene.add(moon);
  const warmA = new THREE.PointLight(0xff8f45, 22, 14, 2); warmA.position.set(5.5, 1.6, 5); scene.add(warmA);
  const warmB = new THREE.PointLight(0xff8f45, 16, 14, 2); warmB.position.set(-5.5, 1.6, -1); scene.add(warmB);

  // Irkalla floor and a wall (the game's own Irkalla road textures)
  setMsg('floor…');
  const tl = new THREE.TextureLoader();
  const tex = (p, srgb, rep) => new Promise(r => tl.load(p, t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; r(t); }, undefined, () => r(null)));
  const [fMap, fNrm, fRgh] = await Promise.all([tex('assets/r3/harbor/road-stone.webp', true, 10), tex('assets/r3/harbor/road-stone-normal.webp', false, 10), tex('assets/r3/harbor/road-stone-rough.webp', false, 10)]);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: fMap, normalMap: fNrm, roughnessMap: fRgh, roughness: 1, color: 0x8d8478 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.userData.surface = 'stone'; floor.name = 'lab-floor'; scene.add(floor);
  const wallMat = new THREE.MeshStandardMaterial({ map: fMap && fMap.clone(), normalMap: fNrm, roughness: 0.95, color: 0x7d7468 });
  if (wallMat.map) { wallMat.map.repeat.set(2, 1.2); wallMat.map.needsUpdate = true; }
  const wall = new THREE.Mesh(new THREE.BoxGeometry(9, 4.2, 0.9), wallMat);
  wall.position.set(-3, 2.1, -8.5); wall.castShadow = wall.receiveShadow = true; wall.userData.surface = 'wall'; wall.name = 'lab-wall'; scene.add(wall);

  let bindings = null;
  let S = null;                                  // lab state (assigned once the engine is up)

  // ------------------------------------------------------------------ characters
  setMsg('Sîn…');
  const gl = new GLTFLoader();
  const ktx2 = new KTX2Loader().setTranscoderPath('vendor/basis/').detectSupport(renderer);
  gl.setKTX2Loader(ktx2); gl.setMeshoptDecoder(MeshoptDecoder);
  const [sinG, gdnG] = await Promise.all([
    gl.loadAsync('assets/Sin_hero_runtime.glb'),
    gl.loadAsync('assets/Guardian_of_the_Covenant.glb', ev => { if (ev.total) setMsg('Guardian… ' + Math.round(ev.loaded / ev.total * 100) + '%'); })
  ]);

  const sin = makeSin(sinG);
  const gdn = makeGuardian(gdnG);
  scene.add(sin.root, gdn.root);
  layout('solo');

  // ------------------------------------------------------------------ VFX engine
  setMsg('VFX engine…');
  const vfx = await SinVFX.create({ THREE, renderer, scene, camera, base: '', quality: qs.get('quality') || 'auto', forceTier: qs.has('quality'), groundY: 0 });
  vfx.setLighting({ dir: moon.position.clone(), color: new THREE.Color(0.75, 0.8, 1.0), ambient: new THREE.Color(0.2, 0.19, 0.22) });
  registerRigs();
  setMsg('prewarm…');
  const warmMs = await vfx.prewarm();

  // ------------------------------------------------------------------ events (hit windows)
  const ATT = SinHero.CONFIG.ATTACKS, CLIPN = SinHero.CONFIG.CLIPS;
  const sinEvents = {};
  for (const k in ATT) {
    const a = ATT[k], name = CLIPN[a.clip];
    sinEvents[name] = { source: 'sin-hero.js CONFIG.ATTACKS.' + k, duration: sin.clips[name].duration, windup: { end: a.wind }, active: { start: a.act[0], end: a.act[1] }, impact: a.impact, landing: a.landing, heavy: !!a.heavy };
  }
  sinEvents.Axe_Equip = { duration: sin.clips.Axe_Equip.duration };
  let gdnEvents = null, gdnEventsSource = '';
  try { const r = await fetch('assets/Guardian_Combat_Animations.json'); if (r.ok) { gdnEvents = normaliseAuthored(await r.json()); gdnEventsSource = 'assets/Guardian_Combat_Animations.json'; } } catch (e) { /* not in the repository */ }
  if (!gdnEvents) { try { const r = await fetch('vfx/data/guardian-combat-events.json'); if (r.ok) { const j = await r.json(); gdnEvents = j.clips; gdnEventsSource = 'vfx/data/guardian-combat-events.json'; } } catch (e) { } }
  if (!gdnEvents || qs.has('measure')) { gdnEvents = analyseGuardian(); gdnEventsSource = 'measured at load (socket motion)'; }
  bindings = await (await fetch('vfx/data/combat-bindings.json')).json();

  // ------------------------------------------------------------------ lab state
  S = {
    speed: 1, paused: false, loop: false, bind: true, surface: 'stone', sinSurface: 'armor', selected: qs.get('effect') || 'GUARDIAN_STAFF_GROUND_SLAM',
    focus: new THREE.Vector3(0, 0, 1.6), focusNormal: new THREE.Vector3(0, 1, 0), focusSurface: 'stone',
    take: null, dts: [], takeT: 0, seed: 1, enraged: null, markers: false, clean: qs.has('clean')
  };
  if (S.clean) document.body.classList.add('clean');
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.4, 1.6); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxDistance = 40; controls.update();
  const keys = new Set();
  addEventListener('keydown', e => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return; keys.add(e.code); hotkey(e); });
  addEventListener('keyup', e => keys.delete(e.code));

  // ------------------------------------------------------------------ helpers
  function makeSin(g) {
    const model = g.scene, root = new THREE.Group(); root.name = 'lab-sin';
    model.scale.setScalar(SinHeroScale()); root.add(model);
    const nodeOf = n => n.slice(0, n.lastIndexOf('.'));
    const clips = {};
    for (const c of g.animations) {
      const keep = c.name === 'Axe_Equip' || c.name === 'Axe_Unequip';
      const cc = c.clone();
      cc.tracks = cc.tracks.filter(t => { const n = nodeOf(t.name); return n !== 'Axe' && n !== 'Axe_Back_Socket' && n !== 'Axe_Back_Hook' && (keep ? true : n !== 'Axe_RightHand_Socket'); });
      clips[c.name] = cc;
    }
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.isSkinnedMesh) o.frustumCulled = false; } });
    // seat the axe in the right hand exactly like the game (sin-hero.js seat('hand'))
    const meta = (g.scenes && g.scenes[0] && g.scenes[0].userData) || {};
    const att = meta.axeHolster && meta.axeHolster.attach ? meta.axeHolster.attach.hand : { translation: [0.0159736704, 0.0025291829, 0.0006476183], rotation: [0.1958154589, 0.7226944566, -0.0331940479, 0.6620175243] };
    const axe = model.getObjectByName('Axe'), hand = model.getObjectByName('Axe_RightHand_Socket');
    hand.add(axe); axe.position.fromArray(att.translation); axe.quaternion.fromArray(att.rotation); axe.scale.set(1, 1, 1);
    axe.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
    const hook = model.getObjectByName('Axe_Back_Hook'); if (hook) hook.visible = true;
    const mixer = new THREE.AnimationMixer(model);
    const ch = character('sin', 'سين', root, model, mixer, clips, 'Axe_CombatIdle');
    // ground the idle pose (sole on the floor)
    ch.idle(0); mixer.update(0); model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true);
    model.position.y -= box.min.y;
    // axe rails: several tracking points across the blade, measured from the axe mesh itself
    ch.axe = axe; ch.rails = axeRails(axe);
    return ch;
  }
  function SinHeroScale() { return 1.85; }
  function axeRails(axe) {
    const mesh = axe.isMesh ? axe : axe.getObjectByProperty('isMesh', true);
    const pos = mesh.geometry.attributes.position, v = new THREE.Vector3();
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    // handle along local +y, head at the top; the cutting edge is the far side of the head in z
    const yHead = bb.max.y - (bb.max.y - bb.min.y) * 0.3;
    let zMax = -1e9, zMin = 1e9, yLo = 1e9, yHi = -1e9;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); if (v.y < yHead) continue; zMax = Math.max(zMax, v.z); zMin = Math.min(zMin, v.z); }
    const edgeZ = Math.abs(zMax) > Math.abs(zMin) ? zMax : zMin;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); if (v.y < yHead || Math.abs(v.z - edgeZ) > Math.abs(edgeZ) * 0.12) continue; yLo = Math.min(yLo, v.y); yHi = Math.max(yHi, v.y); }
    const yMid = (yLo + yHi) / 2;
    const pts = [new THREE.Vector3(0, yMid - (yHi - yLo) * 1.6, -edgeZ * 0.1), new THREE.Vector3(0, yMid - (yHi - yLo) * 0.4, edgeZ * 0.5), new THREE.Vector3(0, yMid, edgeZ * 1.03)];
    const objs = pts.map((p, i) => { const o = new THREE.Object3D(); o.name = 'vfx-rail-axe-' + i; o.position.copy(p); mesh.add(o); return o; });
    const edge = new THREE.Object3D(); edge.name = 'vfx-socket-axe-edge'; edge.position.set(0, yMid, edgeZ); mesh.add(edge);
    return { axe: objs, edgeSocket: edge, info: { yLo, yHi, edgeZ } };
  }
  function makeGuardian(g) {
    const model = g.scene, root = new THREE.Group(); root.name = 'lab-guardian';
    root.add(model);
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.isSkinnedMesh) o.frustumCulled = false; } });
    const clips = {}; g.animations.forEach(c => { clips[c.name] = c; });
    const mixer = new THREE.AnimationMixer(model);
    const ch = character('guardian', 'حارس العهد', root, model, mixer, clips, 'Combat_Idle');
    const sockets = {};
    ['weapon_r', 'weapon_l', 'claw_r', 'claw_l', 'chest_seal', 'head_hit', 'body_hit', 'foot_r', 'foot_l', 'ground_impact', 'staff_tip', 'staff_base', 'staff_blade', 'staff_crown'].forEach(n => { sockets[n] = model.getObjectByName(n); });
    const staff = model.getObjectByName('Guardian_Staff');
    const at = (parent, name, x, y, z) => { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); parent.add(o); return o; };
    sockets.staff_mid = at(staff, 'vfx-staff-mid', -0.01, -0.6, 0);
    sockets.root = at(model.getObjectByName('Root'), 'vfx-root', 0, 0, 0);
    const P = n => sockets[n].position;
    const rails = {
      staff_crown: [at(staff, 'vfx-rail-c0', 0.0, 0.45, 0), sockets.staff_crown, sockets.staff_tip],
      staff_blade: [at(staff, 'vfx-rail-b0', -0.03, -1.65, 0), at(staff, 'vfx-rail-b1', -0.035, -2.1, 0), sockets.staff_blade],
      staff_shaft: [sockets.staff_blade, at(staff, 'vfx-rail-s1', -0.02, -0.55, 0), sockets.staff_tip]
    };
    void P;
    const fingerTip = (b2, b3) => {
      const a = model.getObjectByName(b2), b = model.getObjectByName(b3), pa = new THREE.Vector3(), pb = new THREE.Vector3();
      return [out => a.getWorldPosition(out), out => b.getWorldPosition(out),
        out => { a.getWorldPosition(pa); b.getWorldPosition(pb); return out.copy(pb).addScaledVector(pb.clone().sub(pa), 1.1); }];
    };
    rails.claw_index = fingerTip('Index_02_R', 'Index_03_R'); rails.claw_middle = fingerTip('Middle_02_R', 'Middle_03_R'); rails.claw_ring = fingerTip('Ring_02_R', 'Ring_03_R');
    const railsL = Object.assign({}, rails, { claw_index: fingerTip('Index_02_L', 'Index_03_L'), claw_middle: fingerTip('Middle_02_L', 'Middle_03_L'), claw_ring: fingerTip('Ring_02_L', 'Ring_03_L') });
    const bones = ['Spine_02', 'Chest', 'Head', 'UpperArm_R', 'UpperArm_L', 'Forearm_R', 'Forearm_L', 'Hand_R', 'Hand_L', 'Thigh_R', 'Thigh_L', 'Shin_R', 'Shin_L', 'Pauldron_R', 'Pauldron_L', 'Coat_Back_01', 'Coat_Back_02', 'Coat_Left_02', 'Coat_Right_02', 'Tabard_02'].map(n => model.getObjectByName(n)).filter(Boolean);
    const materials = {};
    model.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m && m.name) materials[m.name] = m; }); });
    ch.sockets = sockets; ch.rails = rails; ch.railsL = railsL; ch.bones = bones; ch.materials = materials; ch.staff = staff;
    ch.idle(0); mixer.update(0);
    return ch;
  }
  function registerRigs() {
    vfx.registerRig('sin', { sockets: { axe_edge: sin.rails.edgeSocket, hand: sin.model.getObjectByName('hand_r'), root: sin.root }, rails: { axe: sin.rails.axe }, bones: [] });
    const gr = { sockets: gdn.sockets, rails: gdn.rails, bones: gdn.bones, materials: gdn.materials };
    vfx.registerRig('guardian', gr);
    vfx.registerRig('guardian_l', Object.assign({}, gr, { rails: gdn.railsL }));
  }

  // A playable character: clip playback, idle return, bound effects per clip.
  function character(id, ar, root, model, mixer, clips, idleName) {
    const ch = { id, ar, root, model, mixer, clips, idleName, action: null, clipName: null, runs: [], prevPos: new Map(), vel: new Map() };
    ch.idle = (fade = 0.25) => ch.play(ch.idleName, { loop: true, fade, bind: true });
    ch.play = (name, o = {}) => {
      const clip = clips[name]; if (!clip) { console.warn('no clip', name); return null; }
      const a = mixer.clipAction(clip);
      a.reset(); a.enabled = true; a.setEffectiveTimeScale(1); a.setEffectiveWeight(1);
      a.setLoop(o.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !o.loop;
      if (o.startAt) a.time = o.startAt;
      if (ch.action && ch.action !== a && o.fade !== 0) a.crossFadeFrom(ch.action, o.fade == null ? 0.12 : o.fade, false);
      else if (ch.action && ch.action !== a) ch.action.stop();
      a.play();
      ch.action = a; ch.clipName = name; ch.loopClip = !!o.loop; ch.onEnd = o.onEnd || null;
      // stop the bound effects of the previous clip that are still running (trails)
      ch.runs.forEach(r => r.handles.forEach(h => h && h.stop && !h.persistent && h.stop()));
      ch.runs = [];
      if (o.bind !== false && S && S.bind && bindings) ch.runs.push(bindRun(ch, name, o));
      return a;
    };
    return ch;
  }
  function layout(mode) {
    if (mode === 'duel') {
      sin.root.position.set(0, 0, -0.4); sin.root.rotation.y = 0;
      gdn.root.position.set(0, 0, 3.3); gdn.root.rotation.y = Math.PI;
    } else {
      sin.root.position.set(2.6, 0, -1.2); sin.root.rotation.y = -0.25;
      gdn.root.position.set(-1.4, 0, 3.0); gdn.root.rotation.y = Math.PI * 0.92;
    }
    lab.layout = mode;
  }

  // ------------------------------------------------------------------ Guardian event measurement (no authored timing file in the repository)
  function analyseGuardian() {
    const names = Object.keys(gdn.clips).filter(n => /^(Attack|Special|Counter|Parry|Block|Phase|Dodge|Cinematic)/.test(n));
    const out = {};
    const sockNames = ['staff_crown', 'staff_tip', 'staff_blade', 'claw_r', 'claw_l', 'foot_r', 'foot_l', 'chest_seal'];
    const mixer = gdn.mixer, model = gdn.model;
    mixer.stopAllAction();
    const v = new THREE.Vector3();
    for (const name of names) {
      const clip = gdn.clips[name], a = mixer.clipAction(clip);
      a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play();
      const dt = 1 / 60, N = Math.max(2, Math.ceil(clip.duration / dt) + 1);
      const tracks = {}; sockNames.forEach(s => { tracks[s] = []; });
      for (let i = 0; i < N; i++) {
        const t = Math.min(clip.duration, i * dt);
        a.time = t; mixer.update(0); model.updateMatrixWorld(true);
        sockNames.forEach(s => { gdn.sockets[s].getWorldPosition(v); tracks[s].push(v.toArray()); });
      }
      a.stop();
      const raw = s => tracks[s].map((p, i) => i ? Math.hypot(p[0] - tracks[s][i - 1][0], p[1] - tracks[s][i - 1][1], p[2] - tracks[s][i - 1][2]) / dt : 0);
      const smooth = arr => arr.map((x, i) => { let a = 0, n = 0; for (let k = Math.max(1, i - 3); k <= Math.min(arr.length - 1, i + 3); k++) { a += arr[k]; n++; } return n ? a / n : 0; });
      const sp = {}; sockNames.forEach(s => { sp[s] = smooth(raw(s)); });
      const peakOf = s => sp[s].reduce((b, x, i) => x > b.v ? { v: x, i } : b, { v: 0, i: 0 });
      // the weapon of the clip: claws for claw attacks, feet for kicks, the staff otherwise
      const weapons = /Claw/.test(name) ? ['claw_r', 'claw_l'] : /Kick/.test(name) ? ['foot_r', 'foot_l'] : ['staff_crown', 'staff_blade'];
      let lead = weapons[0], pk = peakOf(lead);
      for (const w of weapons) { const p = peakOf(w); if (p.v > pk.v) { lead = w; pk = p; } }
      // ground contact of a staff end: a real descent (>0.3 m within 0.45 s, >1.5 m/s) ending low and stopping
      let contact = null;
      for (const s of ['staff_blade', 'staff_crown', 'staff_tip']) {
        const Y = tracks[s].map(p => p[1]);
        for (let i = 2; i < N - 1; i++) {
          if (Y[i] > 0.32) continue;
          const vyNext = (Y[i + 1] - Y[i]) / dt;
          if (vyNext < -0.35) continue;                     // still falling: the contact is later
          const w0 = Math.max(0, i - Math.round(0.45 / dt));
          let maxY = -1e9, maxDown = 0;
          for (let k = w0; k < i; k++) { maxY = Math.max(maxY, Y[k]); maxDown = Math.max(maxDown, (Y[k] - Y[k + 1]) / dt); }
          // a strike into the floor, not the staff being planted back after the swing
          const nearStrike = /Slam|Leap/.test(name) || i <= pk.i + Math.round(0.35 / dt);
          if (maxY - Y[i] > 0.3 && maxDown > 2.2 && nearStrike) { if (!contact || i < contact.i) contact = { socket: s, i, y: Y[i] }; break; }
        }
      }
      let s0, s1;
      if (contact) {
        s1 = contact.i; s0 = s1;
        const Y = tracks[contact.socket].map(p => p[1]);
        while (s0 > 0 && Y[s0 - 1] > Y[s0] + 0.004 && s1 - s0 < Math.round(0.5 / dt)) s0--;
        if (sp[contact.socket][contact.i] < pk.v * 0.2) { /* contact is the hit even if the fastest motion was elsewhere */ }
        lead = contact.socket;
      } else {
        s0 = pk.i; s1 = pk.i; const th = pk.v * 0.6;
        while (s0 > 0 && sp[lead][s0 - 1] > th) s0--;
        while (s1 < N - 1 && sp[lead][s1 + 1] > th) s1++;
      }
      let w0 = s0; while (w0 > 0 && sp[lead][w0 - 1] > pk.v * 0.12) w0--;
      // airborne phase (both feet above the floor)
      let takeoff = null, landing = null;
      for (let i = 1; i < N; i++) {
        const fy = Math.min(tracks.foot_r[i][1], tracks.foot_l[i][1]);
        if (takeoff == null && fy > 0.45) takeoff = i;
        if (takeoff != null && landing == null && i > takeoff && fy < 0.3) landing = i;
      }
      const r3 = x => Math.round(x * 1000) / 1000;
      out[name] = {
        duration: r3(clip.duration), leading: lead, peakSpeed: r3(pk.v),
        windup: { start: r3(w0 * dt), end: r3(s0 * dt) }, active: { start: r3(s0 * dt), end: r3(s1 * dt) },
        impact: r3((contact ? contact.i : Math.round((s0 + s1) / 2)) * dt),
        contact: contact ? { socket: contact.socket, t: r3(contact.i * dt), height: r3(contact.y) } : null,
        takeoff: takeoff != null ? r3(takeoff * dt) : null, landing: landing != null ? r3(landing * dt) : null
      };
    }
    gdn.idle(0); mixer.update(0);
    return out;
  }
  function normaliseAuthored(j) {
    // Accepts { clips: { name: { hitWindow:[a,b], impact, ... } } } or { name: {...} }.
    const src = j.clips || j, out = {};
    for (const k in src) {
      const c = src[k] || {};
      const hw = c.hitWindow || c.hit_window || (c.active && [c.active.start, c.active.end]);
      out[k] = { duration: c.duration, leading: c.socket || c.leading || 'staff_crown', windup: c.windup ? { start: c.windup[0] || 0, end: c.windup[1] || c.windup } : null,
        active: hw ? { start: hw[0], end: hw[1] } : null, impact: c.impact, contact: c.contact || null, takeoff: c.takeoff, landing: c.landing, source: 'authored' };
    }
    return out;
  }

  // ------------------------------------------------------------------ bindings
  function eventsFor(ch, clipName) { return ch.id === 'sin' ? (sinEvents[clipName] || {}) : (gdnEvents[clipName] || {}); }
  function resolveTime(expr, ev, dur) {
    if (typeof expr === 'number') return expr;
    for (const part of String(expr).split('|')) {
      const m = /^([a-z.:0-9]+?)([+-][0-9.]+)?$/i.exec(part.trim()); if (!m) continue;
      let base = null; const key = m[1];
      if (key.startsWith('frac:')) base = parseFloat(key.slice(5)) * dur;
      else if (key === 'end') base = dur;
      else if (key === 'contact') base = ev.contact ? ev.contact.t : null;
      else if (key === 'impact') base = ev.impact;
      else if (key === 'takeoff') base = ev.takeoff; else if (key === 'landing') base = ev.landing;
      else { const [a, b] = key.split('.'); base = ev[a] && ev[a][b]; }
      if (base == null || isNaN(base)) continue;
      return Math.max(0, base + (m[2] ? parseFloat(m[2]) : 0));
    }
    return null;
  }
  function bindRun(ch, clipName, o) {
    const set = ch.id === 'sin' ? bindings.sin : bindings.guardian;
    const list = (o.events || set.clips[clipName] || []).slice();
    const ev = eventsFor(ch, clipName), dur = ch.clips[clipName].duration;
    const items = [];
    for (const b of list) {
      if (b.type === 'trail') {
        const from = resolveTime(b.from, ev, dur), to = resolveTime(b.to, ev, dur);
        if (from == null || to == null) continue;
        items.push({ b, t: from, kind: 'trail-start' }, { b, t: to, kind: 'trail-stop' });
      } else if (b.type === 'contact') {
        if (ev.contact) items.push({ b, t: ev.contact.t, kind: 'contact' });
      } else if (b.type === 'phased') {
        const at = resolveTime(b.at, ev, dur); if (at == null) continue;
        const def = vfx.effects.get(b.effect);
        items.push({ b, t: Math.max(0, at - (def.impactAt || 0)), kind: 'phased', impactT: at });
      } else {
        const at = resolveTime(b.at || 'impact', ev, dur); if (at == null) continue;
        items.push({ b, t: at, kind: b.type });
      }
    }
    items.sort((a, b) => a.t - b.t);
    return { ch, clipName, items, next: 0, handles: [], trails: new Map(), last: -1, opts: o, ev };
  }
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
  function socketWorld(ch, name) {
    if (ch.id === 'sin') { if (name === 'axe_edge') return ch.rails.edgeSocket.getWorldPosition(new THREE.Vector3()); return ch.root.getWorldPosition(new THREE.Vector3()); }
    const s = ch.sockets[name] || ch.sockets.root; return s.getWorldPosition(new THREE.Vector3());
  }
  function fireItem(run, it) {
    const ch = run.ch, b = it.b, rig = ch.id === 'sin' ? 'sin' : (b.side === 'l' ? 'guardian_l' : 'guardian');
    const seed = S.seed * 7919 + run.items.indexOf(it) * 131 + (ch.id === 'sin' ? 1 : 2);
    const base = { rig, seed, timeLocked: true, intensity: run.opts.intensity || 1, tint: run.opts.tint };
    if (it.kind === 'trail-start') {
      const h = vfx.play(b.effect, Object.assign({}, base, { intensity: (run.opts.trailIntensity || 1) * (b.intensity || 1) }));
      run.trails.set(b, h); run.handles.push(h);
    } else if (it.kind === 'trail-stop') {
      const h = run.trails.get(b); if (h) h.stop();
    } else if (it.kind === 'contact') {
      const c = run.ev.contact; const pos = socketWorld(ch, c.socket); pos.y = 0;
      const vel = ch.vel.get(c.socket) || new THREE.Vector3(0, -8, 0);
      const weapon = c.socket === 'staff_blade' ? 'staff_blade' : 'staff_crown';
      run.handles.push(vfx.impact(Object.assign({}, base, { weapon, surface: S.surface, position: pos, normal: [0, 1, 0], velocity: vel, strength: b.heavy ? 1.35 : 1.0, direction: horiz(vel, ch) })));
    } else if (it.kind === 'phased') {
      const ev = run.ev; let pos;
      if (ev.contact) { pos = predictSocket(ch, run.clipName, ev.contact.socket, it.impactT); }
      else pos = socketWorld(ch, 'root');
      pos.y = 0;
      run.handles.push(vfx.play(b.effect, Object.assign({}, base, { position: pos, normal: [0, 1, 0], direction: forward(ch), surface: S.surface })));
    } else if (it.kind === 'impact') {
      const pos = socketWorld(ch, b.socket || 'axe_edge');
      const vel = ch.vel.get(b.socket || 'axe_edge') || forward(ch).multiplyScalar(8);
      const surface = run.opts.surface || (ch.id === 'sin' ? S.sinSurface : S.surface);
      let normal = forward(ch).negate();                  // the struck surface faces the attacker
      if (surface === 'stone' || surface === 'sand') { pos.y = 0; normal = new THREE.Vector3(0, 1, 0); }
      if (run.opts.impactPos) pos.copy(run.opts.impactPos);
      if (run.opts.impactNormal) normal = run.opts.impactNormal.clone();
      run.handles.push(vfx.impact(Object.assign({}, base, { weapon: b.weapon || 'axe', surface, position: pos, normal, velocity: vel, strength: b.strength || 1, effect: run.opts.impactEffect })));
    } else if (it.kind === 'effect') {
      if (b.unlessContact && run.ev.contact) return;
      const pos = socketWorld(ch, b.socket || 'root'); if (b.ground) pos.y = 0;
      const def = vfx.effects.get(b.effect);
      let dur = b.duration || 1;
      if (b.fit) dur = Math.max(0.4, (run.ch.clips[run.clipName].duration - it.t) / (def.duration || 1));
      const vel = ch.vel.get(b.socket || 'axe_edge') || forward(ch);
      const air = b.surface && !b.ground;
      const h = vfx.play(b.effect, Object.assign({}, base, { position: pos, normal: air ? forward(ch).negate() : [0, 1, 0], direction: b.ground ? forward(ch) : vel, socket: ch.id === 'sin' ? null : b.socket, scale: b.scale || 1, strength: b.strength || 1, duration: dur, timeLocked: !b.fit, surface: b.surface || S.surface }));
      run.handles.push(h);
    } else if (it.kind === 'aura') {
      if (!S.enraged || !S.enraged.alive) S.enraged = vfx.play(b.effect, Object.assign({}, base, { position: socketWorld(ch, 'root'), loop: true }));
      if (S.enraged) S.enraged.persistent = true;
      gdn.idleName = 'Enraged_Idle';
    }
  }
  function predictSocket(ch, clipName, socket, t) {
    // where the socket will be at clip time t (the phased effect starts before the hit)
    const a = ch.action, cur = a.time;
    a.time = t; ch.mixer.update(0); ch.model.updateMatrixWorld(true);
    const p = socketWorld(ch, socket);
    a.time = cur; ch.mixer.update(0); ch.model.updateMatrixWorld(true);
    return p;
  }
  const forward = ch => new THREE.Vector3(0, 0, 1).applyQuaternion(ch.root.quaternion);
  function horiz(v, ch) { const h = new THREE.Vector3(v.x, 0, v.z); return h.lengthSq() > 1e-4 ? h.normalize() : forward(ch); }
  function tickRuns(ch, dt) {
    // weapon socket velocities (used for impact direction / strength)
    const names = ch.id === 'sin' ? ['axe_edge'] : ['staff_crown', 'staff_blade', 'claw_r', 'claw_l'];
    for (const n of names) {
      const p = socketWorld(ch, n), prev = ch.prevPos.get(n);
      if (prev && dt > 0) ch.vel.set(n, p.clone().sub(prev).divideScalar(dt));
      ch.prevPos.set(n, p);
    }
    for (const run of ch.runs) {
      if (!ch.action) continue;
      const t = ch.action.time;
      while (run.next < run.items.length && run.items[run.next].t <= t + 1e-6) { fireItem(run, run.items[run.next]); run.next++; }
      run.last = t;
    }
  }

  // ------------------------------------------------------------------ takes (replay / frame back-step) and the main step
  let lastNow = performance.now();
  let simTime = 0;
  function resetWorld() {
    vfx.clearAll();
    if (S.enraged) { S.enraged = null; }
    gdn.idleName = 'Combat_Idle';
    [sin, gdn].forEach(ch => { ch.runs = []; ch.mixer.stopAllAction(); ch.action = null; ch.prevPos.clear(); ch.vel.clear(); ch.idle(0); ch.mixer.update(0); ch.model.updateMatrixWorld(true); });
    seqState = null;
    // restore emissive bases
    Object.values(gdn.materials).forEach(m => { if (m.userData.sinVfxBase != null) m.emissiveIntensity = m.userData.sinVfxBase; });
  }
  function startTake(take, keepSeed) {
    resetWorld();
    if (!keepSeed) S.seed = (S.seed + 1) % 100000;
    S.take = take; S.dts = []; S.takeT = 0; S.takeDone = false; comboCut = null; simTimers.length = 0;
    take.start();
    drawTimeline();
  }
  function replay() { if (S.take) startTake(S.take, true); }
  function stepCore(dt) {
    simTime += dt;
    S.takeT += dt;
    if (S.take) S.dts.push(dt);
    if (seqState) seqTick(dt);
    for (const ch of [sin, gdn]) {
      ch.mixer.update(dt);
      ch.model.updateMatrixWorld(true);
      if (ch.action && !ch.loopClip && !ch.action.isRunning() && ch.action.time >= ch.action.getClip().duration - 1e-4) {
        const cb = ch.onEnd; ch.onEnd = null;
        if (cb) cb(); else if (!seqState) ch.idle(0.3);
      }
      tickRuns(ch, dt);
    }
    if (S.enraged && S.enraged.alive) { /* aura follows the Guardian through its bones */ }
    vfx.update(dt);
  }
  function backStep() {
    if (!S.take || S.dts.length < 2) return;
    const dts = S.dts.slice(0, -1);
    startTake(S.take, true);
    for (const d of dts) stepSim(d);
    S.paused = true; syncBar();
  }
  const FIX = 1 / 60;
  function frame() {
    const now = performance.now(); const real = Math.min((now - lastNow) / 1000, 0.1); lastNow = now;
    const t0 = performance.now();
    // free camera keys
    const mv = new THREE.Vector3(), f = new THREE.Vector3();
    camera.getWorldDirection(f); f.y = 0; f.normalize();
    const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0));
    const sp = (keys.has('ShiftLeft') ? 9 : 3.5) * real;
    if (keys.has('KeyW')) mv.addScaledVector(f, sp); if (keys.has('KeyS')) mv.addScaledVector(f, -sp);
    if (keys.has('KeyD')) mv.addScaledVector(r, sp); if (keys.has('KeyA')) mv.addScaledVector(r, -sp);
    if (keys.has('KeyE')) mv.y += sp; if (keys.has('KeyQ')) mv.y -= sp;
    if (mv.lengthSq()) { camera.position.add(mv); controls.target.add(mv); }
    controls.update();
    if (!lab.manual && !S.paused) stepSim(real * S.speed);
    renderFrame();
    const cpu = performance.now() - t0;
    perf.push(real * 1000, cpu);
    vfx.frameTime(real * 1000);
    if (S.loop && S.take && !S.paused && takeFinished()) { if ((S.loopWait = (S.loopWait || 0) + real) > 0.6) { S.loopWait = 0; startTake(S.take, false); } }
    updateTimelineCursor();
    requestAnimationFrame(frame);
  }
  function renderFrame() {
    const off = vfx.shake.offset.clone().multiplyScalar(S.shakeView === false ? 0 : 1);
    camera.position.add(off);
    camera.updateMatrixWorld();
    vfx.render(null);
    camera.position.sub(off);
  }
  function takeFinished() {
    const st = vfx.stats();
    const busy = st.instances > 0 || st.trails > 0;
    const clipsBusy = [sin, gdn].some(ch => ch.action && !ch.loopClip && ch.action.isRunning());
    return !busy && !clipsBusy && !seqState && S.takeT > 0.3;
  }
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    const v = renderer.getDrawingBufferSize(new THREE.Vector2()); vfx.setSize(v.x, v.y);
  }
  addEventListener('resize', resize); resize();

  // ------------------------------------------------------------------ actions
  function effectTake(id, at, normal, surface) {
    const def = vfx.effects.get(id);
    const pos = (at || S.focus).clone(), nrm = (normal || S.focusNormal).clone();
    return {
      label: id, kind: 'effect', id,
      start() {
        const opts = { position: pos, normal: nrm, direction: camDirOnPlane(nrm), seed: S.seed, surface: surface || S.focusSurface };
        if (def.kind === 'trail' || def.kind === 'charge' || def.kind === 'aura' || def.layers.some(l => l.type === 'glow')) {
          // effects that need a weapon / body: play them on their own character
          const demo = demoFor(id);
          if (demo) return demo.start();
        }
        if (def.kind === 'phased' && def.layers.some(l => l.type === 'trail')) { const demo = demoFor(id); if (demo) return demo.start(); }
        S.lastHandle = vfx.play(id, opts);
      }
    };
  }
  function camDirOnPlane(n) { const d = new THREE.Vector3(); camera.getWorldDirection(d); d.addScaledVector(n, -d.dot(n)); return d.lengthSq() > 1e-4 ? d.normalize() : new THREE.Vector3(0, 0, 1); }
  function demoFor(id) {
    const def = vfx.effects.get(id);
    if (def && def.demo) return clipTake(def.demo.character === 'sin' ? sin : gdn, def.demo.clip, { loop: /Idle/.test(def.demo.clip) });
    // otherwise a clip whose binding uses this effect
    for (const [chId, set] of [['sin', bindings.sin], ['guardian', bindings.guardian]]) {
      for (const clip in set.clips) if (set.clips[clip].some(b => b.effect === id)) return clipTake(chId === 'sin' ? sin : gdn, clip);
    }
    if (id === 'SIN_AXE_COMBO_TRAIL') return comboTake();
    if (id === 'SIN_AXE_CHARGE') return { label: id, kind: 'effect', id, ch: sin, start() { layout('solo'); sin.play('Axe_CombatIdle', { loop: true, bind: false }); const h = vfx.play(id, { rig: 'sin', seed: S.seed, loop: true }); setTimeoutSim(() => h.stop(), 2.4); } };
    return null;
  }
  const simTimers = [];
  function setTimeoutSim(fn, t) { simTimers.push({ fn, at: S.takeT + t }); }
  function clipTake(ch, clip, o = {}) {
    return { label: ch.ar + ' · ' + clip, kind: 'clip', ch, clip, start() { if (lab.layout !== (o.layout || 'solo')) layout(o.layout || 'solo'); ch.play(clip, Object.assign({ fade: 0.1 }, o)); } };
  }
  function comboTake() {
    const c = bindings.sin.combo;
    return {
      label: 'Sîn combo', kind: 'combo', start() {
        layout('solo');
        const chain = i => {
          if (i >= c.clips.length) return sin.idle(0.3);
          const clip = c.clips[i], ev = sinEvents[clip], cfg = Object.values(ATT).find(a => CLIPN[a.clip] === clip);
          sin.play(clip, {
            fade: i ? 0.08 : 0.1, intensity: c.intensity[i],
            events: bindings.sin.clips[clip].map(b => b.type === 'trail' ? Object.assign({}, b, { effect: c.trail[i] }) : b),
            onEnd: () => chain(i + 1)
          });
          // chain at the game's own cancel point (combo window) instead of waiting for the clip end
          comboCut = { at: cfg ? cfg.cancel : ev.duration, next: () => chain(i + 1) };
        };
        chain(0);
      }
    };
  }
  let comboCut = null;

  // ---- the duel: a scripted exchange with real clips, hits at the real contact points
  let seqState = null;
  function duelTake() {
    return {
      label: 'Duel sequence', kind: 'duel', start() {
        layout('duel');
        sin.play('Axe_CombatIdle', { loop: true, fade: 0 }); gdn.play('Combat_Idle', { loop: true, fade: 0 });
        const se = n => sinEvents[n].impact, ge = n => gdnEvents[n] || {};
        const steps = [];
        let t = 0.5;
        const sinHit = (clip, surface, gClip, gLead, extra) => {
          const tt = t;
          steps.push({ t: tt, fn: () => sin.play(clip, Object.assign({ surface, onEnd: () => sin.play('Axe_CombatIdle', { loop: true }) }, extra || {})) });
          if (gClip) steps.push({ t: tt + se(clip) - gLead, fn: () => gdn.play(gClip, { onEnd: () => gdn.play(gdn.idleName, { loop: true }) }) });
          t += sin.clips[clip].duration * 0.86;
        };
        // 1. light combo: blocked by the staff (clash), then on the armour
        sinHit('Attack_Right', 'staff', 'Block_Impact', 0.08, { impactEffect: 'IMPACT_WEAPON_CLASH' });
        sinHit('Attack_Left', 'armor', 'Hit_Light_Front', 0.02);
        sinHit('Finisher_Heavy', 'armor', 'Stagger', 0.02, { impactEffect: 'SIN_AXE_METAL_IMPACT' });
        t += 0.3;
        // 2. Guardian swing parried by Sîn's right chop (the two impacts meet)
        {
          const g = ge('Attack_Staff_Swing_Right'), tt = t;
          steps.push({ t: tt, fn: () => gdn.play('Attack_Staff_Swing_Right', { onEnd: () => gdn.play(gdn.idleName, { loop: true }) }) });
          steps.push({ t: tt + (g.impact || 0.8) - se('Attack_Right'), fn: () => sin.play('Attack_Right', { surface: 'parry', impactEffect: 'SIN_AXE_PARRY', onEnd: () => sin.play('Axe_CombatIdle', { loop: true }) }) });
          t += gdn.clips.Attack_Staff_Swing_Right.duration + 0.2;
        }
        // 3. Leap slam, Sîn dodges back
        {
          const g = ge('Special_Leap_Slam'), tt = t;
          steps.push({ t: tt, fn: () => gdn.play('Special_Leap_Slam', { onEnd: () => gdn.play(gdn.idleName, { loop: true }) }) });
          steps.push({ t: tt + Math.max(0, (g.landing || g.impact || 1.2) - 0.75), fn: () => sin.play('km_dodge_back', { bind: false, startAt: 0.5, onEnd: () => sin.play('Axe_CombatIdle', { loop: true }) }) });
          t += gdn.clips.Special_Leap_Slam.duration + 0.3;
        }
        // 4. Sîn's jumping finisher
        sinHit('Finisher_Jump', 'stone', 'Hit_Heavy', -0.02);
        t += 0.4;
        // 5. Chest seal and the enraged phase
        steps.push({ t, fn: () => gdn.play('Special_Seal_Activation', { onEnd: () => gdn.play('Phase_Transition', { onEnd: () => gdn.play('Enraged_Idle', { loop: true }) }) }) });
        t += gdn.clips.Special_Seal_Activation.duration + gdn.clips.Phase_Transition.duration + 0.8;
        // 6. Enraged ground slam
        steps.push({ t, fn: () => gdn.play('Special_Ground_Slam', { onEnd: () => gdn.play('Enraged_Idle', { loop: true }) }) });
        t += gdn.clips.Special_Ground_Slam.duration + 2.5;
        seqState = { t: 0, steps, i: 0, end: t };
      }
    };
  }
  function seqTick(dt) {
    seqState.t += dt;
    while (seqState.i < seqState.steps.length && seqState.steps[seqState.i].t <= seqState.t) { seqState.steps[seqState.i].fn(); seqState.i++; }
    if (seqState.t > seqState.end) seqState = null;
  }
  // one simulation step: sequence, characters, bound effects, engine; then combo cuts and timers
  function stepSim(dt) {
    stepCore(dt);
    if (comboCut && sin.action && sin.action.time >= comboCut.at) { const c = comboCut; comboCut = null; c.next(); }
    for (let i = simTimers.length - 1; i >= 0; i--) if (S.takeT >= simTimers[i].at) { const t = simTimers[i]; simTimers.splice(i, 1); t.fn(); }
  }

  // ------------------------------------------------------------------ perf
  const perf = {
    frames: [], cpu: [],
    push(ms, cpu) { this.frames.push(ms); this.cpu.push(cpu); if (this.frames.length > 240) { this.frames.shift(); this.cpu.shift(); } },
    summary() {
      const a = this.frames.slice().sort((x, y) => x - y), avg = a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
      const c = this.cpu.reduce((s, x) => s + x, 0) / Math.max(1, this.cpu.length);
      return { fps: avg ? 1000 / avg : 0, avgMs: avg, p95Ms: a[Math.floor(a.length * 0.95)] || 0, cpuMs: c };
    }
  };
  function memInfo() {
    const m = performance.memory;
    return { heapMB: m ? +(m.usedJSHeapSize / 1048576).toFixed(1) : null, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs ? renderer.info.programs.length : null };
  }
  setInterval(() => {
    const p = perf.summary(), st = vfx.stats(), m = memInfo();
    $('#stats').textContent =
      `FPS ${p.fps.toFixed(0)}  frame ${p.avgMs.toFixed(1)}ms  p95 ${p.p95Ms.toFixed(1)}  cpu ${p.cpuMs.toFixed(1)}ms\n` +
      `tier ${st.tier} (${st.pipeline})  draw calls ${st.calls}  tris ${(st.triangles / 1000).toFixed(0)}k\n` +
      `particles ${st.particles}  trails ${st.trails}  waves ${st.shockwaves}  decals ${st.decals}  debris ${st.debris}  lights ${st.lights}\n` +
      `fx ${st.instances}  vfxGPU≈${st.vfxGpuMB}MB  heap ${m.heapMB ?? '–'}MB  geo ${m.geometries} tex ${m.textures} prog ${m.programs}\n` +
      `t ${S.takeT.toFixed(2)}s  speed ${S.speed}×${S.paused ? '  ❚❚' : ''}`;
    if (activePane === 'perf') renderPerf();
  }, 250);

  // ------------------------------------------------------------------ UI
  let activePane = 'fx';
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
    activePane = b.dataset.tab;
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + activePane));
  });
  $('#toggle').onclick = () => $('#ui').classList.toggle('hidden');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const GROUPS = [['sin', 'فأس سين · الطاقة القمرية'], ['guardian', 'حارس العهد · الطاقة الذهبية'], ['surface', 'نظام الاصطدام حسب السطح']];
  function renderFx() {
    let h = '';
    for (const [g, ar] of GROUPS) {
      h += `<h3>${ar}</h3><div class="list">`;
      vfx.list().filter(e => e.group === g).forEach(e => { h += `<button data-fx="${e.id}" class="${e.id === S.selected ? 'sel' : ''}">${esc(e.ar)}<small>${e.id}</small></button>`; });
      h += '</div>';
    }
    const def = vfx.effects.get(S.selected);
    h += `<h3>المؤثر المحدد</h3><div class="note" style="direction:ltr;text-align:right">${S.selected}</div>
      <div class="row"><button class="btn" data-act="play">تشغيل ▶</button><button class="btn" data-act="demo">مع الحركة الفعلية</button></div>
      <div class="row"><button class="btn" data-act="stop">إيقاف</button><button class="btn" data-act="clear">مسح الكل</button></div>
      <div class="note">انقر على الأرضية أو الجدار لتحديد موضع الارتطام واتجاه السطح. المؤثرات التي تحتاج سلاحاً أو جسداً تُشغَّل على شخصيتها.</div>
      <h3>الطبقات</h3><div class="layers">`;
    (def ? def.layers : []).forEach(l => { const k = def.id + '/' + l.name; h += `<label class="chk"><input type="checkbox" data-layer="${esc(k)}" ${vfx.muted.has(k) ? '' : 'checked'}>${esc(l.name)} <small style="color:var(--dim)">${l.type}</small></label>`; });
    h += `</div><h3>أنواع الطبقات (كل المؤثرات)</h3><div class="layers">`;
    ['trail', 'stream', 'burst', 'sprite', 'shockwave', 'decal', 'debris', 'light', 'shake', 'glow'].forEach(t => { h += `<label class="chk"><input type="checkbox" data-type="${t}" ${vfx.muted.has('type:' + t) ? '' : 'checked'}>${t}</label>`; });
    h += '</div>';
    $('#pane-fx').innerHTML = h;
  }
  $('#pane-fx').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.fx) { S.selected = b.dataset.fx; applyPreset(S.selected); renderFx(); renderTune(); return; }
    if (b.dataset.act === 'play') startTake(effectTake(S.selected));
    if (b.dataset.act === 'demo') { const d = demoFor(S.selected); startTake(d || effectTake(S.selected)); }
    if (b.dataset.act === 'stop') { if (S.lastHandle) S.lastHandle.stop(); vfx.clearAll(); }
    if (b.dataset.act === 'clear') resetWorld();
  });
  $('#pane-fx').addEventListener('change', e => {
    const i = e.target;
    if (i.dataset.layer) { if (i.checked) vfx.muted.delete(i.dataset.layer); else vfx.muted.add(i.dataset.layer); }
    if (i.dataset.type) { if (i.checked) vfx.muted.delete('type:' + i.dataset.type); else vfx.muted.add('type:' + i.dataset.type); }
  });

  const SIN_COMBAT = ['Axe_CombatIdle', 'Attack_Right', 'Attack_Left', 'Finisher_Heavy', 'Finisher_Jump', 'km_dodge_back', 'km_dodge_back_mirror', 'fall', 'km_knockdown_getup_mirror', 'Axe_Equip', 'Axe_Unequip'];
  function renderChars() {
    const evTxt = (ev) => ev && ev.active ? `<small>hit ${ev.active.start.toFixed(2)}–${ev.active.end.toFixed(2)} · impact ${(ev.impact ?? 0).toFixed(2)}${ev.contact ? ' · ground ' + ev.contact.socket + ' ' + ev.contact.t.toFixed(2) : ''}</small>` : '<small>&nbsp;</small>';
    let h = `<label class="chk"><input type="checkbox" id="bind" ${S.bind ? 'checked' : ''}>ربط المؤثرات بالحركات ونوافذ الإصابة</label>
      <div class="row"><button class="btn" data-act="duel">⚔ تسلسل قتالي تجريبي</button></div>
      <div class="row"><button class="btn" data-act="combo">كومبو سين (خفيفة ← خفيفة ← ثقيلة)</button></div>
      <div class="row"><button class="btn" data-act="enrage">تفعيل / إيقاف غضب الحارس</button><button class="btn" data-act="markers">نقاط الاتصال</button></div>
      <h3>سين · ${Object.keys(sin.clips).length} حركة <small style="color:var(--dim)">Sin_hero_runtime.glb</small></h3>
      <label class="ctl">سطح إصابة سين<select id="sinsurf">${['armor', 'metal', 'stone', 'wall', 'staff', 'parry', 'spirit'].map(s => `<option ${s === S.sinSurface ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <div class="list">`;
    const sinNames = SIN_COMBAT.filter(n => sin.clips[n]).concat(Object.keys(sin.clips).filter(n => !SIN_COMBAT.includes(n)));
    sinNames.forEach(n => { h += `<button data-ch="sin" data-clip="${n}">${n}${evTxt(sinEvents[n])}</button>`; });
    h += `</div><h3>حارس العهد · ${Object.keys(gdn.clips).length} حركة <small style="color:var(--dim)">${esc(gdnEventsSource)}</small></h3><div class="list">`;
    Object.keys(gdn.clips).forEach(n => { h += `<button data-ch="guardian" data-clip="${n}">${n}${evTxt(gdnEvents[n])}</button>`; });
    h += `</div><div class="row"><button class="btn" data-act="export-events">تصدير توقيتات الحارس JSON</button></div>`;
    $('#pane-chars').innerHTML = h;
  }
  $('#pane-chars').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.clip) { const ch = b.dataset.ch === 'sin' ? sin : gdn; const loop = /Idle|Walk|Run|Strafe|Stun_Loop|Death_Idle/.test(b.dataset.clip); startTake(clipTake(ch, b.dataset.clip, { loop })); }
    if (b.dataset.act === 'duel') startTake(duelTake());
    if (b.dataset.act === 'combo') startTake(comboTake());
    if (b.dataset.act === 'enrage') {
      if (S.enraged && S.enraged.alive) { S.enraged.stop(); S.enraged = null; gdn.idleName = 'Combat_Idle'; gdn.play('Combat_Idle', { loop: true }); }
      else { S.enraged = vfx.play('GUARDIAN_ENRAGED_AURA', { rig: 'guardian', position: gdn.root.position, loop: true, seed: S.seed }); gdn.idleName = 'Enraged_Idle'; gdn.play('Enraged_Idle', { loop: true }); }
    }
    if (b.dataset.act === 'markers') toggleMarkers();
    if (b.dataset.act === 'export-events') download('guardian-combat-events.json', JSON.stringify({ note: 'Measured from Guardian_of_the_Covenant.glb socket motion by the VFX Laboratory', source: gdnEventsSource, clips: gdnEvents }, null, 1));
  });
  $('#pane-chars').addEventListener('change', e => { if (e.target.id === 'bind') S.bind = e.target.checked; if (e.target.id === 'sinsurf') S.sinSurface = e.target.value; });

  const SLIDERS = [
    ['speed', 'سرعة الحركة', 0.05, 2, 0.05], ['size', 'الحجم', 0.3, 2.5, 0.05], ['density', 'كثافة الجسيمات', 0.1, 2, 0.05], ['glow', 'قوة التوهج', 0, 3, 0.05],
    ['opacity', 'الشفافية', 0, 1.5, 0.05], ['duration', 'مدة المؤثر', 0.3, 3, 0.05], ['strength', 'قوة الارتطام', 0.3, 2, 0.05], ['shake', 'اهتزاز الكاميرا', 0, 2, 0.05],
    ['bloom', 'التوهج الموضعي (Bloom)', 0, 3, 0.05], ['distortion', 'تشوه الهواء', 0, 2, 0.05], ['tintAmount', 'قوة تغيير اللون', 0, 1, 0.05]
  ];
  function renderTune() {
    let h = `<h3>إعدادات المؤثرات</h3>`;
    for (const [k, ar, mn, mx, st] of SLIDERS) {
      const v = k === 'speed' ? S.speed : vfx.settings[k];
      h += `<label class="ctl">${ar}<output>${(+v).toFixed(2)}</output><input type="range" min="${mn}" max="${mx}" step="${st}" value="${v}" data-k="${k}"></label>`;
    }
    const tint = vfx.settings.tint ? '#' + new THREE.Color(...vfx.settings.tint).getHexString() : '#9fb8ff';
    h += `<label class="ctl">اللون<input type="color" id="tint" value="${tint}" style="grid-column:2"></label>
      <label class="ctl">نوع السطح (موضع النقر)<select id="surf">${Object.keys(vfx.surfaces.materials).map(s => `<option value="${s}" ${s === S.focusSurface ? 'selected' : ''}>${s} · ${vfx.surfaces.materials[s].ar}</option>`).join('')}</select></label>
      <label class="ctl">سطح ارتطام الحارس<select id="gsurf">${['stone', 'sand', 'wall', 'metal'].map(s => `<option ${s === S.surface ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="ctl">مستوى الجودة<select id="tier">${['auto', 'high', 'medium', 'low'].map(s => `<option ${s === (qs.get('quality') || 'auto') ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <div class="note">الجودة الحالية: ${vfx.tier} (${vfx.pipeline}). تغيير المستوى يعيد تحميل المختبر.</div>
      <h3>حفظ الإعدادات</h3>
      <div class="row"><button class="btn" data-act="save">حفظ لهذا المؤثر</button><button class="btn" data-act="reset">افتراضي</button></div>
      <div class="row"><button class="btn" data-act="export">تصدير JSON</button><button class="btn" data-act="import">استيراد JSON</button></div>
      <div class="row"><button class="btn" data-act="def">تنزيل تعريف المؤثر</button></div>
      <div class="note" id="savemsg">${Object.keys(store.get()).length} إعداد محفوظ.</div>
      <h3>الكاميرا</h3><div class="row">${['front', 'side', 'top', 'low', 'close'].map(c => `<button class="btn" data-cam="${c}">${{ front: 'أمامية', side: 'جانبية', top: 'علوية', low: 'منخفضة', close: 'قريبة' }[c]}</button>`).join('')}</div>
      <div class="note">كاميرا حرة: سحب للدوران، عجلة للتقريب، زر يمين للتحريك، WASD + Q/E للطيران، Shift للإسراع. C: إخفاء الواجهة.</div>`;
    $('#pane-tune').innerHTML = h;
  }
  $('#pane-tune').addEventListener('input', e => {
    const i = e.target, k = i.dataset.k;
    if (k) { const v = parseFloat(i.value); if (k === 'speed') setSpeed(v); else vfx.settings[k] = v; i.previousElementSibling.textContent = v.toFixed(2); }
    if (i.id === 'tint') { const c = new THREE.Color(i.value); vfx.settings.tint = [c.r, c.g, c.b]; if (!vfx.settings.tintAmount) vfx.settings.tintAmount = 0.8; }
  });
  $('#pane-tune').addEventListener('change', e => {
    if (e.target.id === 'surf') S.focusSurface = e.target.value;
    if (e.target.id === 'gsurf') S.surface = e.target.value;
    if (e.target.id === 'tier') { const u = new URL(location.href); u.searchParams.set('quality', e.target.value); location.href = u.href; }
  });
  $('#pane-tune').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.cam) camPreset(b.dataset.cam);
    if (b.dataset.act === 'save') { const all = store.get(); all[S.selected] = snapshotSettings(); const ok = store.set(all); $('#savemsg').textContent = ok ? 'حُفظت إعدادات ' + S.selected : 'تعذّر الحفظ في المتصفح'; }
    if (b.dataset.act === 'reset') { Object.assign(vfx.settings, DEFAULTS, { tint: null }); setSpeed(1); renderTune(); }
    if (b.dataset.act === 'export') download('sin-vfx-presets.json', JSON.stringify(store.get(), null, 1));
    if (b.dataset.act === 'def') download(S.selected + '.json', JSON.stringify(vfx.effects.get(S.selected), null, 1));
    if (b.dataset.act === 'import') { const f = document.createElement('input'); f.type = 'file'; f.accept = '.json'; f.onchange = async () => { try { const j = JSON.parse(await f.files[0].text()); const all = Object.assign(store.get(), j); store.set(all); applyPreset(S.selected); renderTune(); } catch (err) { alert(err.message); } }; f.click(); }
  });
  const DEFAULTS = Object.assign({}, vfx.settings);
  function snapshotSettings() { return { settings: Object.assign({}, vfx.settings), muted: [...vfx.muted].filter(k => k.startsWith(S.selected + '/')), speed: S.speed }; }
  function applyPreset(id) {
    const p = store.get()[id];
    Object.assign(vfx.settings, DEFAULTS, { tint: null });
    [...vfx.muted].filter(k => k.startsWith(id + '/')).forEach(k => vfx.muted.delete(k));
    if (!p) return;
    Object.assign(vfx.settings, p.settings || {});
    (p.muted || []).forEach(k => vfx.muted.add(k));
  }
  function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

  function renderPerf() {
    const p = perf.summary(), st = vfx.stats(), m = memInfo();
    $('#pane-perf').innerHTML = `<h3>الأداء الحي</h3><div class="kv">
      <span>FPS</span><span>${p.fps.toFixed(1)}</span><span>frame avg / p95</span><span>${p.avgMs.toFixed(2)} / ${p.p95Ms.toFixed(2)} ms</span>
      <span>CPU (update+submit)</span><span>${p.cpuMs.toFixed(2)} ms</span><span>draw calls</span><span>${st.calls}</span>
      <span>particles</span><span>${st.particles} / ${st.capacity.add + st.capacity.alpha + st.capacity.dist}</span>
      <span>trails / decals / debris</span><span>${st.trails} / ${st.decals} / ${st.debris}</span>
      <span>VFX GPU (est.)</span><span>${st.vfxGpuMB} MB</span><span>JS heap</span><span>${m.heapMB ?? 'n/a'} MB</span>
      <span>geometries / textures</span><span>${m.geometries} / ${m.textures}</span><span>programs</span><span>${m.programs}</span>
      <span>tier</span><span>${st.tier} · ${st.pipeline} · density ${vfx.settings.density.toFixed(2)}</span><span>prewarm</span><span>${warmMs.toFixed(0)} ms</span></div>
      <h3>اختبارات الضغط</h3>
      <div class="row"><button class="btn" data-act="stress">8 مؤثرات معاً</button><button class="btn" data-act="repeat">تكرار 60 مرة</button></div>
      <div class="note" id="stressmsg">${lab.lastStress ? esc(JSON.stringify(lab.lastStress)) : ''}</div>`;
  }
  $('#pane-perf').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'stress') lab.stress(8);
    if (b.dataset.act === 'repeat') lab.repeatTest(S.selected, 60).then(r => { lab.lastStress = r; });
  });

  // ---- bottom bar
  function setSpeed(v) { S.speed = v; document.querySelectorAll('#bar .spd button').forEach(b => b.classList.toggle('on', +b.dataset.s === v)); }
  document.querySelectorAll('#bar .spd button').forEach(b => b.onclick = () => setSpeed(+b.dataset.s));
  function syncBar() { $('#b-play').textContent = S.paused ? '▶' : '❚❚'; $('#b-play').classList.toggle('on', S.paused); $('#b-loop').classList.toggle('on', S.loop); }
  $('#b-play').onclick = () => { S.paused = !S.paused; syncBar(); };
  $('#b-step').onclick = () => { S.paused = true; stepSim(FIX * S.speed); syncBar(); };
  $('#b-back').onclick = () => backStep();
  $('#b-replay').onclick = () => replay();
  $('#b-loop').onclick = () => { S.loop = !S.loop; syncBar(); };
  function hotkey(e) {
    if (e.code === 'Space') { e.preventDefault(); $('#b-play').onclick(); }
    if (e.code === 'Period') $('#b-step').onclick();
    if (e.code === 'Comma') backStep();
    if (e.code === 'KeyR') replay();
    if (e.code === 'KeyL') $('#b-loop').onclick();
    if (e.code === 'KeyC') document.body.classList.toggle('clean');
    if (e.code === 'Enter') startTake(effectTake(S.selected));
  }
  function drawTimeline() {
    const tl = $('#timeline'); tl.querySelectorAll('.win,.ev,.mk').forEach(x => x.remove());
    let dur = 3, label = S.take ? S.take.label : '', marks = [];
    if (S.take && S.take.kind === 'clip') {
      const ch = S.take.ch, ev = eventsFor(ch, S.take.clip); dur = ch.clips[S.take.clip].duration;
      if (ev.active) marks.push({ c: 'win' + (ch.id === 'sin' ? '' : ' g'), a: ev.active.start, b: ev.active.end });
      if (ev.impact != null) marks.push({ c: 'ev', a: ev.impact });
      if (ev.contact) marks.push({ c: 'ev', a: ev.contact.t });
      if (ev.landing) marks.push({ c: 'ev', a: ev.landing });
      label += ev.active ? `  · hit ${ev.active.start.toFixed(2)}–${ev.active.end.toFixed(2)}s impact ${(+ev.impact).toFixed(2)}s` : '';
    } else if (S.take && S.take.kind === 'effect' && vfx.effects.get(S.take.id)) {
      const d = vfx.effects.get(S.take.id); dur = (d.duration + Math.min(2, d.tail || 0)) * vfx.settings.duration;
      d.layers.forEach(l => { if (l.start) marks.push({ c: 'ev', a: l.start * vfx.settings.duration }); });
      if (d.impactAt) marks.push({ c: 'win g', a: d.impactAt * vfx.settings.duration, b: d.impactAt * vfx.settings.duration + 0.05 });
    } else if (seqState) dur = seqState.end;
    S.tlDur = dur;
    tl.querySelector('.lbl').textContent = label;
    for (const m of marks) {
      const e = document.createElement('div'); e.className = m.c;
      e.style.left = (m.a / dur * 100) + '%'; if (m.b != null) e.style.width = Math.max(0.4, (m.b - m.a) / dur * 100) + '%';
      tl.appendChild(e);
    }
    const mk = document.createElement('div'); mk.className = 'mk'; tl.appendChild(mk);
  }
  function updateTimelineCursor() {
    const mk = $('#timeline .mk'); if (!mk) return;
    let t = S.takeT;
    if (S.take && S.take.kind === 'clip' && S.take.ch.action && S.take.ch.clipName === S.take.clip) t = S.take.ch.action.time;
    mk.style.left = Math.min(100, t / (S.tlDur || 3) * 100) + '%';
    $('#tlabel').textContent = `${t.toFixed(3)}s · f${Math.round(t * 60)}`;
  }

  // ---- click to place the focus point (raycast floor / wall: position + surface normal + material)
  const ray = new THREE.Raycaster(); let down = null;
  canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
    const hit = ray.intersectObjects([floor, wall], false)[0]; if (!hit) return;
    S.focus.copy(hit.point); S.focusNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    S.focusSurface = hit.object.userData.surface; renderTune();
    startTake(effectTake(S.selected));
  });

  // ---- camera presets
  function camPreset(n) {
    const tgt = S.take && S.take.kind === 'effect' ? S.focus.clone().add(new THREE.Vector3(0, 0.8, 0)) : new THREE.Vector3(0, 1.6, 1.4);
    const P = { front: [0, 2.4, -7.5], side: [8.5, 2.6, 1.2], top: [0.5, 13, 1.5], low: [5, 0.45, -4], close: [2.8, 1.5, -2.2] }[n];
    camera.position.copy(tgt).add(new THREE.Vector3(P[0], P[1] - 1.4, P[2])); controls.target.copy(tgt); controls.update();
  }
  lab.camPreset = camPreset;

  // ---- socket markers (contact points)
  let markerGroup = null;
  function toggleMarkers() {
    if (markerGroup) { markerGroup.forEach(m => m.parent.remove(m)); markerGroup = null; return; }
    markerGroup = [];
    const add = (obj, c) => { const a = new THREE.AxesHelper(0.18); a.material.depthTest = false; a.renderOrder = 10; obj.add(a); markerGroup.push(a); void c; };
    Object.values(gdn.sockets).forEach(o => o && add(o));
    sin.rails.axe.forEach(o => add(o)); add(sin.rails.edgeSocket);
    Object.values(gdn.rails).flat().forEach(o => o && o.isObject3D && add(o));
  }

  // ------------------------------------------------------------------ automation API
  Object.assign(lab, {
    THREE, vfx, sin, gdn, scene, camera, renderer, controls, S, sinEvents, get gdnEvents() { return gdnEvents; }, gdnEventsSource, bindings, warmMs, perf, memInfo,
    manual: qs.has('auto'),
    playEffect(id, o = {}) { if (o.at) S.focus.fromArray(o.at); if (o.normal) S.focusNormal.fromArray(o.normal); if (o.surface) S.focusSurface = o.surface; startTake(effectTake(id)); },
    demo(id) { startTake(demoFor(id) || effectTake(id)); },
    playClip(chId, clip, o) { startTake(clipTake(chId === 'sin' ? sin : gdn, clip, o || {})); },
    combo() { startTake(comboTake()); },
    duel() { startTake(duelTake()); },
    duelLength() { return seqState ? seqState.end : null; },
    advance(dt, n = 1, render = true) { for (let i = 0; i < n; i++) { stepSim(dt); } controls.update(); if (render) renderFrame(); },
    render: renderFrame,
    setSpeed, pause(v) { S.paused = v !== false; syncBar(); }, backStep, replay,
    clear: resetWorld, layout, analyseGuardian, stats: () => Object.assign(vfx.stats(), memInfo(), perf.summary()),
    async stress(n) {
      const ids = ['GUARDIAN_STAFF_GROUND_SLAM', 'SIN_AXE_FINISHER', 'GUARDIAN_SPIRITUAL_BURST', 'IMPACT_METAL_METAL', 'GUARDIAN_GOLDEN_SHOCKWAVE', 'SIN_AXE_LUNAR_BURST', 'GUARDIAN_STAFF_CROWN_IMPACT', 'SIN_AXE_PARRY'];
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; vfx.play(ids[i % ids.length], { position: [Math.cos(a) * 3, 0, Math.sin(a) * 3 + 1.5], seed: i + S.seed }); }
      return vfx.stats();
    },
    async repeatTest(id, n) {
      const before = Object.assign(vfx.stats(), memInfo());
      for (let i = 0; i < n; i++) { vfx.play(id, { position: S.focus, seed: i, surface: S.focusSurface, rig: id.startsWith('SIN') ? 'sin' : 'guardian' }); for (let k = 0; k < 6; k++) { stepSim(1 / 60); } }
      for (let k = 0; k < 60 * 12; k++) stepSim(1 / 30);
      renderFrame();
      const after = Object.assign(vfx.stats(), memInfo());
      return { id, n, before: { geometries: before.geometries, textures: before.textures, programs: before.programs, heapMB: before.heapMB }, after: { geometries: after.geometries, textures: after.textures, programs: after.programs, heapMB: after.heapMB, particles: after.particles, instances: after.instances } };
    }
  });
  window.__vfxLabStep = stepSim;

  // ------------------------------------------------------------------ go
  renderFx(); renderChars(); renderTune(); syncBar();
  $('#loading').remove();
  camPreset('side');
  lab.ready = true;
  if (qs.get('effect')) startTake(effectTake(qs.get('effect')));
  requestAnimationFrame(frame);
}
