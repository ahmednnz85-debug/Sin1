// Browser checks for the hero controller in the isolated lab (tests/hero-lab.html).
// Run: node static-server.mjs &  then  THREE_DIR=/path/to/node_modules/three node tests/hero-lab-run.cjs
// (three@0.187.0 is served locally when the CDN is not reachable; Playwright + Chromium required.)
const { chromium } = require('playwright');
const path = require('node:path');
const assert = require('node:assert/strict');
const URL = process.env.SIN1_LAB || 'http://127.0.0.1:8080/tests/hero-lab.html?manual=1';
const THREE_DIR = process.env.THREE_DIR;

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if (THREE_DIR) await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.187\.0\/(.*)$/, r => r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace(/^.*three@0\.187\.0\//, '').split('?')[0]), contentType: 'text/javascript' }));
  await page.goto(URL);
  await page.waitForFunction('window.__lab && window.__lab.ready', null, { timeout: 180000 });
  const R = await page.evaluate(() => {
    const L = __lab, H = L.hero, V = new THREE.Vector3(), out = {};
    const balls = ['ball_l', 'ball_r'].map(n => H.model.getObjectByName(n));
    // foot sliding, stops, turns and frame-rate independence: tests/hero-motion-audit.cjs
    // 2) axe socket switch: no world-space jump on the re-parent frame
    const axe = H.model.getObjectByName('Axe'); L.place(-8, -8, 0); L.step(30); L.press('axe');
    let prev = null, par = axe.parent.name, jump = 0;
    for (let i = 0; i < 40; i++) { L.step(1); axe.getWorldPosition(V); if (axe.parent.name !== par && prev) { jump = V.distanceTo(prev); par = axe.parent.name; } prev = V.clone(); }
    out.equip = { state: H.weapon.state(), seat: H.weapon.seat(), switchStep: jump };
    // 3) combo spam: one hit per swing, no action growth
    // 1.2 m from the dummy: inside the real reach of all three swings (no motion warping)
    const D = L.dummies[0]; L.place(0, 2.0, 0); L.step(40); D.hits = 0; const before = H.debug().totalActions;
    for (let i = 0; i < 72; i++) { if (i % 4 === 0) L.press('light'); L.step(1); } L.step(240);   // 18 presses in 1.2 s: one 3-hit combo, never more
    out.combo = { hits: D.hits, actions: H.debug().totalActions, before };
    // 4) dodge distance, block, hit reaction, push
    L.place(0, -4, 0); L.step(30); L.press('dodge'); const z0 = H.root.position.z; L.step(70); out.dodge = z0 - H.root.position.z;
    L.hold('block', true); L.set(1, 0, 1, true); L.step(60); out.block = { state: H.combat.state(), speed: H.debug().speed }; L.hold('block', false); L.set(0, 0, 0); L.step(30);
    H.combat.hit({ dir: new THREE.Vector3(0, 0, 1) }); L.step(3); out.stagger = H.combat.state(); L.step(80); out.recovered = H.combat.state();
    out.push = H.compat.startPush({ skipEnter: true, timeScale: 1.03, startFrac: .5 }); L.step(40); out.pushState = H.compat.pushState(); H.compat.releasePush(); L.step(30); out.pushEnd = H.compat.pushing();
    return out;
  });
  console.log(JSON.stringify(R, null, 1));
  assert.equal(R.equip.state, 'Equipped'); assert.equal(R.equip.seat, 'hand'); assert.ok(R.equip.switchStep < 0.08, 'axe jump on socket switch');
  assert.equal(R.combo.hits, 3); assert.equal(R.combo.actions, R.combo.before);
  assert.ok(R.dodge > 0.45 && R.dodge < 0.65, 'dodge travels its authored root motion (~0.55 m)');
  assert.equal(R.block.state, 'block'); assert.ok(R.block.speed <= 1.5 + 1e-6);
  assert.equal(R.stagger, 'stagger'); assert.equal(R.recovered, 'none');
  assert.equal(R.push, true); assert.equal(R.pushState.name, 'push_object'); assert.equal(R.pushEnd, false);
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('hero lab: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
