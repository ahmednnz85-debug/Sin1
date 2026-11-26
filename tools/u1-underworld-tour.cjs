#!/usr/bin/env node
/* Real-game U1 (Irkalla greybox) capture and lift check.
   node static-server.mjs &
   NODE_PATH=… THREE_DIR=… node tools/u1-underworld-tour.cjs out [index URL]
   Opens ?dev=1&level=U1-01 (Sîn inside the arrival cabin), captures the
   Anchorage, the Road of the Dead and the Gate, then rides the lift up to the
   Maw and back down through the game's own loop. Output: out/tour.json + jpgs. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const out = process.argv[2] || 'u1-tour';
const url = new URL(process.argv[3] || 'http://127.0.0.1:8080/index.html');
url.search = '?dev=1&level=U1-01';
// Camera, target and hero, relative to the arrival cabin (x toward the road).
const views = {
  'anchorage': [[-14, 2.5, 5], [6, 4, -1], 70, [-8, 0, 0]],
  'arrival-cabin': [[-9.5, 1.8, 0], [0, 3, 0], 70, [-4, 0, 0]],
  'road-of-the-dead': [[-20, 4, 6], [-60, -5, -20], 70, [-19, 0, 0]],
  'bridge': [[-47, 1.5, -24], [-95, -6, -27], 66, [-49, -6, -26]],
  'gate-of-irkalla': [[-112, 5, -26], [-158, 1, -26], 66, [-114, -7.5, -26]],
  'overview': [[60, 40, 60], [-70, -10, -30], 60, [-8, 0, 0]],
  'maw-lift': [[4.5, 422.4, 0], [0, 427.5, 0], 70, [-9.4, 420, 2.9]]
};

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const report = { url: url.href, environment: 'Chromium/SwiftShader on Linux, 960x540', checks: {}, views: {}, errors: [] };
  const save = () => fs.writeFileSync(path.join(out, 'tour.json'), JSON.stringify(report, null, 2) + '\n');
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => report.errors.push(String(e)));
    page.on('console', m => { if (/\[R3|\[U1|Shader Error/.test(m.text())) report.errors.push(m.text().slice(0, 1000)); });
    if (process.env.THREE_DIR) await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.187\.0\//, route => {
      const file = route.request().url().split('three@0.187.0/')[1].split('?')[0];
      return route.fulfill({ path: path.join(process.env.THREE_DIR, file), contentType: 'text/javascript' });
    });
    const start = Date.now();
    await page.goto(url.href);
    await page.waitForFunction(() => window.__sinDev?.ready || window.__sinDev?.error, null, { timeout: 900000, polling: 500 });
    report.bootSeconds = (Date.now() - start) / 1000;
    report.entry = await page.evaluate(() => {
      if (!__sinDev.ready) throw new Error(__sinDev.error);
      const game = SinDevHub.game(), scene = game.scene, hero = game.hero();
      const lift = SinR3Maw.lift, arrival = scene.getObjectByName('Maw_Lift_Arrival');
      const deep = scene.getObjectByName('U1_Underworld'), room = scene.getObjectByName('MawOfTheAbyss_Dressing');
      const origin = deep.localToWorld(new THREE.Vector3(lift.center[0], lift.drop, lift.center[1]));
      window.__u1 = { game, scene, hero, deep, room, renderer: __R, render: __R.render.bind(__R),
        at: (x, y, z) => deep.localToWorld(new THREE.Vector3(lift.center[0] + x, lift.drop + y, lift.center[1] + z)) };
      const local = deep.worldToLocal(hero.position.clone());
      return { area: __sinDev.area.id, underworldVisible: deep.visible, mawVisible: room.visible, arrivalCabin: !!arrival,
        heroFromCabin: +Math.hypot(local.x - lift.center[0], local.z - lift.center[1]).toFixed(2),
        heroAboveDock: +(hero.position.y - origin.y).toFixed(2), blocked: game.blocked(hero.position.x, hero.position.z),
        greybox: scene.getObjectByName('U1_Irkalla_Greybox')?.parent && deep.children.length,
        status: PalaceInterior.r3Settled ? 'hub-waited' : null };
    });
    report.checks.spawnInCabin = report.entry.area === 'U1-01' && report.entry.underworldVisible && !report.entry.mawVisible &&
      report.entry.arrivalCabin && report.entry.heroFromCabin < 0.6 && !report.entry.blocked;
    save();
    const frames = n => page.evaluate(count => new Promise(r => { let k = 0; (function f() { if (++k > count) r(); else requestAnimationFrame(f); })(); }), n);
    for (const [name, [cam, target, fov, hero]] of Object.entries(views)) {
      await page.evaluate(h => { __u1.hero.position.copy(__u1.at(...h)); window.__holdSim = false; }, hero);
      await frames(4);
      const r = await page.evaluate(([cam, target, fov, hero]) => {
        const { game, scene, renderer, render, at, hero: h } = __u1;
        window.__holdSim = true;
        h.position.copy(at(...hero));
        const camera = game.camera;
        camera.position.copy(at(...cam)); camera.fov = fov; camera.aspect = 16 / 9;
        camera.lookAt(at(...target)); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
        renderer.setSize(960, 540, false);
        render(scene, camera);
        const i = renderer.info.render, e = SinProcessMemory.estimate({ scene, renderer, phase: 'u1-tour', room: 'U1' });
        return { jpg: renderer.domElement.toDataURL('image/jpeg', 0.9).split(',')[1], draws: i.calls, triangles: i.triangles,
          cpuMiB: e.cpuMB, gpuMiB: e.gpuMB };
      }, [cam, target, fov, hero]);
      fs.writeFileSync(path.join(out, name + '.jpg'), Buffer.from(r.jpg, 'base64'));
      delete r.jpg;
      report.views[name] = r;
    }
    save();
    // The lift through the game loop (rendering suspended so SwiftShader ticks at full rate).
    report.ride = await page.evaluate(async () => {
      const { hero, at, deep, room, renderer } = __u1;
      const frames = n => new Promise(r => { let k = 0; (function f() { if (++k > n) r(); else requestAnimationFrame(f); })(); });
      const wait = ms => new Promise(r => setTimeout(r, ms));
      renderer.render = () => {};
      window.__holdSim = false;
      const legs = [];
      // Down from the Maw deck, then back up from the Anchorage.
      for (const [outside, inside] of [[[-8, 420, 2.9], [0, 420.59, 0]], [[-8, 0, 2.9], [0, 0.59, 0]]]) {
        hero.position.copy(at(...outside)); await frames(5);
        hero.position.copy(at(...inside)); await frames(2);
        const y0 = hero.position.y;
        let veilSeen = 0;
        const t0 = performance.now();
        while (performance.now() - t0 < 6000) {
          await wait(100);
          const v = document.getElementById('r3-lift-veil');
          if (v) veilSeen = Math.max(veilSeen, +v.style.opacity);
        }
        legs.push({ moved: +(hero.position.y - y0).toFixed(2), veilPeak: veilSeen, veilGone: !document.getElementById('r3-lift-veil'),
          underworldVisible: deep.visible, mawVisible: room.visible,
          onFloor: Math.abs(PalaceInterior.floorAt(hero.position.x, hero.position.z, hero.position.y) - hero.position.y) < 0.05 });
      }
      return legs;
    });
    const [down, up] = report.ride;
    report.checks.rideDown = Math.abs(down.moved + 420) < 0.1 && down.veilPeak === 1 && down.veilGone && down.underworldVisible && !down.mawVisible && down.onFloor;
    report.checks.rideUp = Math.abs(up.moved - 420) < 0.1 && up.veilPeak === 1 && up.veilGone && up.mawVisible && !up.underworldVisible && up.onFloor;
    save();
    assert.deepEqual(report.errors, []);
    assert.ok(Object.values(report.checks).every(Boolean), JSON.stringify(report.checks));
  } finally {
    save();
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
