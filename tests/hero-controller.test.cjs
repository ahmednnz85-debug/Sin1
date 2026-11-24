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
  assert.ok(CONFIG.JOG_CUT[1] <= dur.kr_run_to_sprint_sword);
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
  }
  assert.ok(CONFIG.BUFFER >= 0.15 && CONFIG.BUFFER <= 0.25);
  assert.ok(CONFIG.DODGE.blendIn >= 0.04 && CONFIG.DODGE.blendIn <= 0.08);
});

test('one stick: zones, contiguous speed bands, monotonic curve, hysteresis, accel/decel ranges', () => {
  assert.deepEqual(Array.from(CONFIG.GAIT_UP), [0.10, 0.55, 0.75, 0.90]);
  const B = CONFIG.BAND;
  for (let i = 2; i < B.length; i++) assert.equal(B[i][0], B[i - 1][1]);
  assert.deepEqual(Array.from(B[1]), [0.8, 1.8]); assert.deepEqual(Array.from(B[2]), [1.8, 3.2]); assert.deepEqual(Array.from(B[3]), [3.2, 4.8]);
  const C = CONFIG.STICK_CURVE;
  for (let i = 1; i < C.length; i++) { assert.ok(C[i][0] > C[i - 1][0]); assert.ok(C[i][1] > C[i - 1][1]); }
  assert.ok(CONFIG.HYST > 0 && CONFIG.HYST < 0.06);
  assert.ok(CONFIG.ACCEL >= 8 && CONFIG.ACCEL <= 12 && CONFIG.DECEL >= 10 && CONFIG.DECEL <= 15);
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
