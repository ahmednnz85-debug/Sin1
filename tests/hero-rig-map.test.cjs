// Regression: the temple door push looked up Mixamo bones (LeftArm/LeftHand...) that the
// new hero rig does not have, freezing the palace load at 99%.
const assert = require('assert'), fs = require('fs'), path = require('path');
const vm = require('vm');
const doorSrc = fs.readFileSync(path.join(__dirname, '../temple-doors.js'), 'utf8');
const sandbox = {}; vm.runInNewContext(doorSrc.slice(doorSrc.indexOf('/* SIN_HERO_RIG_MAP_BEGIN */'), doorSrc.indexOf('/* SIN_HERO_RIG_MAP_END */')), { globalThis: sandbox, window: sandbox });
const rig = sandbox.SinHeroRig;
const glb = fs.readFileSync(path.join(__dirname, '../assets/Sin_combat_FINAL3_axe.glb'));
const json = JSON.parse(glb.slice(20, 20 + glb.readUInt32LE(12)).toString());
const names = new Set(json.nodes.map(n => n.name));
const model = { getObjectByName: n => names.has(n) ? { name: n } : undefined };
const arms = rig.arms(model, 'Temple door push');
assert.deepStrictEqual(JSON.parse(JSON.stringify(arms.map(a => a.map(b => b.name)))), [
  ['upperarm_l','lowerarm_l','hand_l','middle_01_l'], ['upperarm_r','lowerarm_r','hand_r','middle_01_r']]);
assert.ok(rig.bone(model, 'weapon', 'r'));
const src = doorSrc;
assert.ok(!/getObjectByName\(side\+'(Arm|ForeArm|Hand)/.test(src), 'temple-doors must not use Mixamo names');
assert.ok(src.includes("SinHeroRig.arms(hero"), 'temple-doors must use the unified rig map');
assert.throws(() => rig.arms({ getObjectByName: () => undefined }), /missing: upperarm_l/);
console.log('hero-rig-map: ok');
