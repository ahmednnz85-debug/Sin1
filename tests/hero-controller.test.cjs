// Sîn hero / combat controller: asset contract, configuration and game integration.
// Visual + runtime checks run in the browser lab: tests/hero-lab.html (see tests/hero-lab-run.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const HERO = 'assets/Sin_combat_FINAL3_axe.glb';
function glbJson(file) {
  const b = fs.readFileSync(path.join(root, file));
  assert.equal(b.toString('ascii', 0, 4), 'glTF');
  return JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12)));
}
// sin-hero.js only needs THREE at create(); expose a stub so the module registers its config.
const ctx = { window: { THREE: {} }, performance: { now: () => 0 }, addEventListener() {}, console };
vm.runInNewContext(fs.readFileSync(path.join(root, 'sin-hero.js'), 'utf8'), ctx);
const { CONFIG } = ctx.window.SinHero;

test('the hero file carries every clip the controller uses, the axe and both sockets', () => {
  const j = glbJson(HERO);
  const names = new Set(j.animations.map(a => a.name));
  for (const n of Object.values(CONFIG.CLIPS)) assert.ok(names.has(n), 'missing clip ' + n);
  const nodes = new Set(j.nodes.map(n => n.name));
  for (const n of ['Axe', 'Axe_Back_Socket', 'Axe_RightHand_Socket', 'weapon_r', 'spine_03', 'thigh_l', 'calf_l', 'foot_l', 'ball_l'])
    assert.ok(nodes.has(n), 'missing node ' + n);
  assert.equal(j.skins.length, 1);
  const h = j.scenes[0].extras.axeHolster;
  assert.ok(h.attach.back && h.attach.hand);
  assert.ok(Math.abs(h.clips.Axe_Equip.switch.time - 0.0668) < 1e-3);
  assert.ok(Math.abs(h.clips.Axe_Unequip.switch.time - 0.2168) < 1e-3);
  const dur = Object.fromEntries(j.animations.map(a => [a.name, Math.max(...a.samplers.map(s => j.accessors[s.input].max[0]))]));
  assert.ok(Math.abs(dur.Axe_Equip - 0.4) < 0.01 && Math.abs(dur.Axe_Unequip - 0.367) < 0.01);
  assert.ok(dur.sprint_loop_quaternius > 0);
});

test('runtime rig mapping uses the new arm chain and door integration does not use Mixamo names', () => {
  const j = glbJson('assets/Sin_hero_runtime.glb');
  const nodes = new Set(j.nodes.map(n => n.name));
  for (const n of ['clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r', 'middle_02_l', 'middle_02_r']) {
    assert.ok(nodes.has(n), 'runtime rig missing ' + n);
  }
  const heroSource = fs.readFileSync(path.join(root, 'sin-hero.js'), 'utf8');
  const doorsSource = fs.readFileSync(path.join(root, 'temple-doors.js'), 'utf8');
  assert.match(heroSource, /function resolveRig\(model\)/);
  assert.match(heroSource, /handSocket: find\(\['Axe_RightHand_Socket'\]\)/);
  assert.match(doorsSource, /SinHero\.resolveRig/);
  assert.doesNotMatch(doorsSource, /side\+'Arm'/);
  assert.doesNotMatch(doorsSource, /HandMiddle1/);
});

test('one axe under one socket: re-seated after evaluation, never force-shown, never classed as city dressing', () => {
  const source = fs.readFileSync(path.join(root, 'sin-hero.js'), 'utf8');
  assert.match(source, /const p = weapon\.seat === 'hand' \? handSock : backSock;\s*if \(axe\.parent !== p\) seat\(weapon\.seat\)/);
  assert.match(source, /axeVisible/);
  assert.doesNotMatch(source, /axe\.visible = true/);                     // visibility is fixed at the cause, not forced
  assert.match(source, /root\.userData\.sinHeroRoot = true/);
  const perf = fs.readFileSync(path.join(root, 'outdoor-perf.js'), 'utf8');
  assert.match(perf, /function onHero\(o\)/);
  assert.match(perf, /if \(onHero\(o\)\) return;/);
});

test('attack windows lie inside their clips and chain points follow the active frames', () => {
  const j = glbJson(HERO);
  const dur = Object.fromEntries(j.animations.map(a => [a.name, Math.max(...a.samplers.map(s => j.accessors[s.input].max[0]))]));
  for (const [k, A] of Object.entries(CONFIG.ATTACKS)) {
    const d = dur[CONFIG.CLIPS[A.clip]];
    assert.ok(A.act[0] < A.act[1] && A.act[1] < d, k);
    assert.ok(A.impact >= A.act[0] && A.impact <= A.act[1], k);
    assert.ok(A.cancel > A.act[1] && A.end <= d, k);
    assert.ok(A.blendIn >= 0.05 && A.blendIn <= 0.09, k + ' blend in 50-90 ms');
    assert.equal(A.ts, 1, k + ' plays at its authored rate');
  }
  assert.ok(CONFIG.BUFFER >= 0.15 && CONFIG.BUFFER <= 0.25);
  assert.ok(CONFIG.DODGE.blendIn >= 0.04 && CONFIG.DODGE.blendIn <= 0.08);
});

test('one stick selects idle, walk or run; speeds come from the clips, never from typed numbers', () => {
  const src = fs.readFileSync(path.join(root, 'sin-hero.js'), 'utf8');
  assert.deepEqual({ ...CONFIG.STICK }, { dead: 0.10, runIn: 0.58, runOut: 0.52 });   // hysteresis only at the walk/run edge
  assert.ok(CONFIG.STICK.runIn - CONFIG.STICK.runOut > 0 && CONFIG.STICK.runIn - CONFIG.STICK.runOut < 0.1);
  assert.match(src, /const V = \{ walk: motion\.walk\.speed, run: motion\.run\.speed \}/);
  assert.match(src, /loco\.speed = \(loco\.w\.walk \* V\.walk \+ loco\.w\.run \* V\.run\) \* lk/);   // root speed follows the blend weights
  assert.doesNotMatch(src, /setEffectiveTimeScale|timeScale = [^0]/);                       // no playback-rate warping
  assert.doesNotMatch(src, /addState\(['"](jog|sprint)/);
  assert.doesNotMatch(src, /inertialize|ik\.lean|camera: cam|shake\(/);                       // removed layers stay removed
  // one duration per transition, all inside the ranges asked for
  const X = CONFIG.XF;
  assert.ok(X.idleWalk >= 0.12 && X.idleWalk <= 0.18 + 1e-9 && X.walkIdle >= 0.15 && X.walkIdle <= 0.22);
  assert.ok(X.walkRun >= 0.12 && X.walkRun <= 0.20 + 1e-9 && X.runIdle >= 0.18 && X.runIdle <= 0.28);
  assert.ok(X.chain >= 0.05 && X.chain <= 0.10);
  assert.ok(CONFIG.TURN_MAX[0] > CONFIG.TURN_MAX[1]);
});

test('the game loads only the new hero through SinHero and has no sprint button', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /data-src="sin-hero\.js\?v=/);
  assert.match(html, /HERO_FILE='Sin_hero_runtime'/);
  assert.match(html, /SinHero\.create\(\{gltf:hg/);
  assert.doesNotMatch(html, /id="run"/);
  assert.doesNotMatch(html, /id="fight"|id="fmenu"/);
  assert.doesNotMatch(html, /heroFSM|ANIM_CFG|sprint_loop_quaternius/);
  assert.doesNotMatch(html, /[^a-zA-Z]mixer=new THREE\.AnimationMixer/);   // the hero mixer lives in SinHero only
  assert.ok(!fs.readdirSync(path.join(root, 'assets')).some(f => f.includes('سين_وقوف')), 'old Mixamo hero removed');
  assert.ok(fs.existsSync(path.join(root, HERO)));
});

test('the runtime hero is the master file minus unplayed clips (mesh, skin, textures, sockets untouched)', () => {
  const m = glbJson(HERO), r = glbJson('assets/Sin_hero_runtime.glb');
  assert.deepEqual(r.nodes, m.nodes);
  assert.deepEqual(r.materials, m.materials);
  assert.deepEqual(r.scenes, m.scenes);
  assert.equal(r.images.length, m.images.length);
  const acc = (j, i) => { const a = j.accessors[i]; return [a.count, a.type, a.componentType]; };
  m.meshes.forEach((mesh, i) => mesh.primitives.forEach((p, k) => {
    for (const att in p.attributes) assert.deepEqual(acc(r, r.meshes[i].primitives[k].attributes[att]), acc(m, p.attributes[att]));
  }));
  assert.deepEqual(r.animations.map(a => a.name).sort(), Object.values(CONFIG.CLIPS).sort());
});

test('the weapon has an explicit persistence and frustum-culling regression guard', () => {
  const source = fs.readFileSync(path.join(root, 'sin-hero.js'), 'utf8');
  assert.match(source, /root\.userData\.keepDuringPalace = true/);
  assert.match(source, /axe\.userData\.sinPersistentWeapon = true/);
  assert.match(source, /o\.frustumCulled = false/);
  assert.match(source, /computeBoundingSphere/);
});

test('main and lab cameras retain the pre-PR63 framing and have no combat camera effects', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const lab = fs.readFileSync(path.join(root, 'tests/hero-lab.html'), 'utf8');
  assert.match(index, /CAM_VFOV=42,CAM_LOOK=1\.18,CAM_DIST=3\.45,CAM_PITCH=0\.22/);
  assert.match(index, /want\.set\(hx-Math\.sin\(yaw\)\*cp\*dist,hy\+Math\.sin\(pitch\)\*dist/);
  assert.doesNotMatch(index, /dEff=dist|camShake|hero\.camera\.shake|hero\.camera\.out|hero\.camera\.roll/);
  assert.doesNotMatch(lab, /hero\.camera\.combat|hero\.camera\.out|hero\.camera\.roll/);
  assert.match(fs.readFileSync(path.join(root, 'sin-hero.js'), 'utf8'), /innerWidth \* 0\.48/);
});
