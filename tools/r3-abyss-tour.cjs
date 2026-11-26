#!/usr/bin/env node
/* In-game R3-03 check through Developer Hub (?dev=1&level=R3-03).
   1. Boots the real game straight into R3-03 and reads the stage cost.
   2. Probes the walkable route from the spawn landing to the rim with the
      game's own collision (no point on the route may be blocked or unsupported).
   3. Poses Sîn at the key views (corridors, overlook hall, rim) with the
      follow camera behind him, renders and measures draw calls / triangles /
      memory estimate.
   NODE_PATH=… THREE_DIR=… node tools/r3-abyss-tour.cjs [output] [index URL] */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const out = process.argv[2] || 'r3-abyss-tour';
const url = new URL(process.argv[3] || 'http://127.0.0.1:8080/index.html');
url.search = '';
url.searchParams.set('dev', '1');
url.searchParams.set('level', 'R3-03');
const mobile = process.env.ABYSS_DESKTOP !== '1';
const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

// Route (stage u, v): spawn landing -> jog -> drop -> mouth -> overlook hall -> rim.
const ROUTE = [[59, -4.2], [61, -4], [64, -4], [67, -4], [70, -4], [70, -7], [70, -10.5], [70, -14], [70, -17],
  [73, -17], [76, -17], [79, -17], [81, -17], [84, -21], [88, -23.6], [93, -23.9], [97, -24], [100.5, -23.4],
  [103.6, -20.2], [104.4, -17], [103.6, -13.8], [100.5, -10.6], [97, -10], [93, -10.2], [86, -10.8], [82, -13]];
// Views: name, hero (u, v), floor y (stage), facing yaw (stage: 0 = toward +u / the abyss), camera distance, height.
const VIEWS = [
  ['01-spawn-landing', 59, -3.2, -15.8, -Math.PI / 2, 4.2, 2.1],
  ['02-corridor-arch', 61.5, -4, -15.8, 0, 4.2, 2.0],
  ['03-landing-relief', 70, -12.5, -17.7, -Math.PI / 2, 4.2, 2.0],
  ['04-mouth', 75.5, -17, -18.4, 0, 4.2, 2.0],
  ['05-overlook-hall', 84.5, -16, -18.9, 0, 4.0, 2.0],
  ['06-hall-lamassu', 86, -12.3, -18.9, -0.35, 4.6, 2.2],
  ['07-rim-abyss', 104.2, -17, -18.9, 0, 3.8, 2.3],
  ['08-hall-return', 101, -11.5, -18.9, Math.PI + 0.3, 4.6, 2.2]
];

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const report = { entry: url.pathname + url.search, profile: mobile ? 'iPhone landscape UA, Chromium SwiftShader' : 'Desktop Chromium SwiftShader', errors: [], route: [], views: {} };
  try {
    const page = await browser.newPage({ viewport: mobile ? { width: 852, height: 393 } : { width: 960, height: 540 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, userAgent: mobile ? ua : undefined });
    page.on('pageerror', e => report.errors.push(String(e).slice(0, 400)));
    page.on('console', m => { if (/\[R3-0\d\]|Shader Error/.test(m.text())) report.errors.push(m.text().slice(0, 600)); });
    if (mobile) await page.addInitScript(() => {
      Object.defineProperty(Performance.prototype, 'memory', { get: () => undefined, configurable: true });
      Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'iPhone', configurable: true });
    });
    if (process.env.THREE_DIR) await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.187\.0\/(.*)$/, route => {
      const file = route.request().url().split('three@0.187.0/')[1].split('?')[0];
      return route.fulfill({ path: path.join(process.env.THREE_DIR, file), contentType: 'text/javascript' });
    });
    const t0 = Date.now();
    await page.goto(url.href);
    await page.waitForFunction(() => window.__sinDev?.ready || window.__sinDev?.error, null, { timeout: 600000, polling: 750 });
    report.bootSeconds = (Date.now() - t0) / 1000;
    report.cost = await page.evaluate(() => {
      if (!__sinDev.ready) throw new Error(__sinDev.error);
      document.documentElement.classList.add('sin-dev-clean');
      const game = SinDevHub.game(), f = __sinDev.r3, hero = game.hero();
      const origin = new THREE.Vector3(f.portalX + f.px, f.floorY, f.front + f.pz);
      let scene = hero; while (scene.parent) scene = scene.parent;
      window.__abyssTour = { game, hero, camera: game.camera, origin, scene };
      return PalaceInterior.r3Memory?.()?.loaded?.cost?.abyss || null;
    });
    console.log('R3-03 ready', report.bootSeconds.toFixed(1), 's', JSON.stringify(report.cost && { ...report.cost, byNode: undefined }));

    // Route probe with the game's collision and floor support.
    report.route = await page.evaluate(async route => {
      const { game, origin, hero } = __abyssTour;
      const res = [];
      for (let i = 0; i < route.length - 1; i++) {
        const [u0, v0] = route[i], [u1, v1] = route[i + 1];
        const n = Math.max(2, Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 0.4));
        for (let k = 0; k <= n; k++) {
          const u = u0 + (u1 - u0) * k / n, v = v0 + (v1 - v0) * k / n;
          const x = origin.x - u, z = origin.z + v;
          const blocked = game.blocked(x, z);
          if (blocked) res.push({ u: +u.toFixed(2), v: +v.toFixed(2), blocked });
          else {
            // Step onto the point and let the game settle Sîn on the floor (ramps).
            hero.position.x = x; hero.position.z = z;
            await new Promise(r => requestAnimationFrame(r));
          }
        }
      }
      return res;
    }, ROUTE);
    console.log('route blocked points:', report.route.length);

    for (const [name, u, v, floorY, yaw, dist, height] of VIEWS) {
      const result = await page.evaluate(async ([u, v, floorY, yaw, dist, height]) => {
        const { game, origin, hero, camera, scene } = __abyssTour;
        const stage = window.PalaceInterior && PalaceInterior.r3Stage ? PalaceInterior.r3Stage() : null;
        const x = origin.x - u, z = origin.z + v;
        // Stage yaw 0 looks toward +u, which is world -x.
        const wy = Math.atan2(-Math.cos(yaw), Math.sin(yaw));
        hero.position.set(x, origin.y + floorY, z);
        for (let i = 0; i < 40; i++) await new Promise(r => requestAnimationFrame(r));   // floor snap + stage update
        hero.rotation.y = wy;
        const fx = Math.sin(wy), fz = Math.cos(wy);
        const r = window.__R, ticks = [], frames = [];
        let last = performance.now();
        for (let i = 0; i < 14; i++) {
          camera.position.set(hero.position.x - fx * dist, hero.position.y + height, hero.position.z - fz * dist);
          camera.lookAt(hero.position.x + fx * 6, hero.position.y + 1.6, hero.position.z + fz * 6);
          const now = await new Promise(res => requestAnimationFrame(res));
          if (i > 3) { ticks.push(now - last); frames.push([r.info.render.calls, r.info.render.triangles]); }
          last = now;
        }
        r.render(scene, camera);
        const jpg = r.domElement.toDataURL('image/jpeg', 0.92).split(',')[1];
        const est = window.SinProcessMemory ? SinProcessMemory.estimate({ scene, renderer: r, phase: 'tour', room: 'R3-03' }) : {};
        const mean = ticks.reduce((a, b) => a + b, 0) / ticks.length;
        return { jpg, heroY: +(hero.position.y - origin.y).toFixed(2), blocked: game.blocked(hero.position.x, hero.position.z),
          meanFrameMs: +mean.toFixed(1), drawCalls: Math.max(...frames.map(f => f[0])), triangles: Math.max(...frames.map(f => f[1])),
          cpuMB: est.cpuMB, gpuMB: est.gpuMB, textures: r.info.memory.textures, geometries: r.info.memory.geometries };
      }, [u, v, floorY, yaw, dist, height]);
      fs.writeFileSync(path.join(out, name + '.jpg'), Buffer.from(result.jpg, 'base64'));
      delete result.jpg;
      report.views[name] = result;
      console.log(name, JSON.stringify(result));
    }
  } catch (error) {
    report.errors.push(String(error && error.stack || error).slice(0, 800));
    console.error(error);
  } finally {
    fs.writeFileSync(path.join(out, 'tour.json'), JSON.stringify(report, null, 2) + '\n');
    await browser.close();
  }
  if (report.errors.length) { console.error('errors:', report.errors); process.exitCode = 1; }
}
main();
