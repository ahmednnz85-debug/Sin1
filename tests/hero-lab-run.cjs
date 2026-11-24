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
    // 1) planted-foot sliding across the stick range (percent of ground speed)
    out.slide = [0.4, 0.7, 0.8, 1].map(mag => {
      L.place(0, -11, 0); L.set(1, 0, mag, true); L.step(90);
      const rec = [[], []], sp = [];
      for (let i = 0; i < 180; i++) { L.step(1); sp.push(H.debug().speed); balls.forEach((b, k) => { b.getWorldPosition(V); rec[k].push([V.x, V.y - H.root.position.y, V.z]); }); if (H.root.position.z > 11) { L.place(0, -11, 0); rec[0].push(null); rec[1].push(null); } }
      let s = 0, n = 0;
      for (const r of rec) { const mn = Math.min(...r.filter(Boolean).map(a => a[1])); for (let i = 1; i < r.length; i++) { const a = r[i - 1], b = r[i]; if (a && b && a[1] < mn + .02 && b[1] < mn + .02) { s += Math.hypot(b[0] - a[0], b[2] - a[2]) * 60; n++; } } }
      const v = sp.reduce((a, b) => a + b) / sp.length; return { mag, speed: v, pct: 100 * s / Math.max(1, n) / v };
    });
    L.set(0, 0, 0);
    // 2) axe socket switch: no world-space jump on the re-parent frame
    const axe = H.model.getObjectByName('Axe'); L.place(-8, -8, 0); L.step(30); L.press('axe');
    let prev = null, par = axe.parent.name, jump = 0;
    for (let i = 0; i < 40; i++) { L.step(1); axe.getWorldPosition(V); if (axe.parent.name !== par && prev) { jump = V.distanceTo(prev); par = axe.parent.name; } prev = V.clone(); }
    out.equip = { state: H.weapon.state(), seat: H.weapon.seat(), switchStep: jump };
    // 3) combo spam: one hit per swing, no action growth
    const D = L.dummies[0]; L.place(0, 1.5, 0); L.step(40); D.hits = 0; const before = H.debug().totalActions;
    for (let i = 0; i < 48; i++) { if (i % 4 === 0) L.press('light'); L.step(1); } L.step(220);
    out.combo = { hits: D.hits, actions: H.debug().totalActions, before };
    // 4) dodge distance, block, hit reaction, push
    L.place(0, -4, 0); L.step(30); L.press('dodge'); const z0 = H.root.position.z; L.step(70); out.dodge = z0 - H.root.position.z;
    L.hold('block', true); L.set(1, 0, 1, true); L.step(60); out.block = { state: H.combat.state(), speed: H.debug().speed }; L.hold('block', false); L.set(0, 0, 0); L.step(30);
    H.combat.hit({ dir: new THREE.Vector3(0, 0, 1) }); L.step(3); out.stagger = H.combat.state(); L.step(80); out.recovered = H.combat.state();
    out.push = H.compat.startPush({ skipEnter: true, timeScale: 1.03, startFrac: .5 }); L.step(40); out.pushState = H.compat.pushState(); H.compat.releasePush(); L.step(30); out.pushEnd = H.compat.pushing();
    return out;
  });
  console.log(JSON.stringify(R, null, 1));
  for (const s of R.slide) assert.ok(s.pct < 14, 'foot slide ' + JSON.stringify(s));
  assert.equal(R.equip.state, 'Equipped'); assert.equal(R.equip.seat, 'hand'); assert.ok(R.equip.switchStep < 0.08, 'axe jump on socket switch');
  assert.equal(R.combo.hits, 3); assert.equal(R.combo.actions, R.combo.before);
  assert.ok(R.dodge > 1.0 && R.dodge < 1.5);
  assert.equal(R.block.state, 'block'); assert.ok(R.block.speed <= 1.5 + 1e-6);
  assert.equal(R.stagger, 'stagger'); assert.equal(R.recovered, 'none');
  assert.equal(R.push, true); assert.equal(R.pushState.name, 'push_object'); assert.equal(R.pushEnd, false);
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('hero lab: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
