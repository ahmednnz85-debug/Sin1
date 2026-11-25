#!/usr/bin/env node
/* In-game R3-02 tour through Developer Hub. Captures frames for ffmpeg.
   NODE_PATH=… THREE_DIR=… node tools/r3-hall-tour.cjs [output] [index URL]
   ffmpeg -framerate 9 -i output/frames/%04d.jpg -vf "scale=852:392,fps=24" -c:v libx264 -pix_fmt yuv420p tour.mp4 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const out = process.argv[2] || 'r3-hall-tour';
const url = new URL(process.argv[3] || 'http://127.0.0.1:8080/index.html');
url.search = '';
url.searchParams.set('dev', '1');
url.searchParams.set('level', 'R3-02');
const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const mobile = process.env.HALL_DESKTOP !== '1';


async function main() {
  fs.mkdirSync(path.join(out, 'frames'), { recursive: true });
  const browser = await chromium.launch({ args: [
    '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'
  ] });
  let index = 0;
  const report = { entry: url.href, browser: browser.version(), profile: mobile ? 'iPhone landscape UA, Chromium SwiftShader' : 'Desktop Chromium SwiftShader', errors: [], movement: [], views: {} };
  try {
    const page = await browser.newPage({
      viewport: mobile ? { width: 852, height: 393 } : { width: 960, height: 540 },
      deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, userAgent: mobile ? ua : undefined
    });
    page.on('pageerror', e => report.errors.push(String(e)));
    page.on('console', msg => {
      if (/\[R3-02\]|WebGLProgram: Shader Error/.test(msg.text())) report.errors.push(msg.text().slice(0, 1000));
    });
    if (mobile) await page.addInitScript(() => {
      Object.defineProperty(Performance.prototype, 'memory', { get: () => undefined, configurable: true });
      Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'iPhone', configurable: true });
    });
    if (process.env.THREE_DIR) await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.187\.0\/(.*)$/, route => {
      const file = route.request().url().split('three@0.187.0/')[1].split('?')[0];
      return route.fulfill({ path: path.join(process.env.THREE_DIR, file), contentType: 'text/javascript' });
    });
    const started = Date.now();
    await page.goto(url.href);
    await page.waitForFunction(() => window.__sinDev?.ready || window.__sinDev?.error, null, { timeout: 420000, polling: 750 });
    await page.evaluate(() => {
      if (!__sinDev.ready) throw new Error(__sinDev.error);
      document.documentElement.classList.add('sin-dev-clean');
      const game = SinDevHub.game(), frame = __sinDev.r3;
      const hero = game.hero(), camera = game.camera;
      const origin = new THREE.Vector3(frame.portalX + frame.px, frame.floorY, frame.front + frame.pz);
      const world = (u, y, v) => new THREE.Vector3(origin.x - u, origin.y + y, origin.z + v);
      const stage = () => [origin.x - hero.position.x, hero.position.y - origin.y, hero.position.z - origin.z];
      let scene = hero;
      while (scene.parent) scene = scene.parent;
      window.__hallTour = { game, hero, camera, origin, world, stage, scene };
    });
    report.bootSeconds = (Date.now() - started) / 1000;
    report.transition = await page.evaluate(() => PalaceInterior.r3Memory());
    assert.ok(report.transition.loaded.cost.hall?.props, 'All hall props loaded');
    assert.ok(!report.transition.released.roots.some(name => /palace/i.test(name)), 'Palace retired');
    console.log('R3-02 ready', report.bootSeconds.toFixed(1) + ' s');

    const raf = n => page.evaluate(count => new Promise(resolve => {
      function frame() { if (--count < 1) resolve(); else requestAnimationFrame(frame); }
      requestAnimationFrame(frame);
    }), n);
    const pose = () => page.evaluate(() => __hallTour.stage());
    async function capture(file) {
      const jpg = await page.evaluate(() => {
        const render = __hallTour.render || window.__R.render.bind(window.__R);
        render(__hallTour.scene, __hallTour.camera);
        return window.__R.domElement.toDataURL('image/jpeg', 0.93).split(',')[1];
      });
      fs.writeFileSync(path.join(out, file), Buffer.from(jpg, 'base64'));
    }
    const shot = name => capture(name + '.jpg');
    const record = () => capture('frames/' + String(index++).padStart(4, '0') + '.jpg');
    const save = () => fs.writeFileSync(path.join(out, 'tour.json'), JSON.stringify(report, null, 2) + '\n');
    async function measure() {
      return page.evaluate(async () => {
        const { scene } = __hallTour, r = window.__R;
        const ticks = [], frames = [];
        let last = performance.now();
        for (let i = 0; i < 10; i++) {
          const now = await new Promise(resolve => requestAnimationFrame(resolve));
          if (i > 1) {
            ticks.push(now - last);
            frames.push([r.info.render.calls, r.info.render.triangles]);
          }
          last = now;
        }
        const mean = ticks.reduce((a, b) => a + b, 0) / ticks.length;
        ticks.sort((a, b) => a - b);
        const est = SinProcessMemory.estimate({ scene, renderer: r, phase: 'tour', room: 'R3-02' });
        return {
          samples: ticks.length, meanFrameMs: +mean.toFixed(1), fps: +(1000 / mean).toFixed(1),
          p95Ms: +ticks[Math.floor(ticks.length * 0.95)].toFixed(1),
          drawCalls: Math.max(...frames.map(x => x[0])), triangles: Math.max(...frames.map(x => x[1])),
          residentGeometry: r.info.memory.geometries, residentTextures: r.info.memory.textures,
          cpuMB: est.cpuMB, gpuMB: est.gpuMB, heapMB: performance.memory?.usedJSHeapSize / 1048576 || null
        };
      });
    }

    // Exercise the real controller briefly, then probe the full route at
    // native capsule radius using the same collision and support APIs.
    const spawn = await pose();
    const atSpawn = await page.evaluate(() => {
      const { hero, game } = __hallTour;
      return game.blocked(hero.position.x, hero.position.z);
    });
    assert.equal(atSpawn, false);
    report.views.arrival = await measure();
    await shot('01-sin-arrival');
    save();
    await page.keyboard.down('KeyW');
    await raf(18);
    await page.keyboard.up('KeyW');
    const moved = await pose();
    report.movement.push({ name: 'Developer spawn walk', start: spawn, end: moved });
    assert.ok(moved[0] - spawn[0] > 0.4, 'Controller moves Sin forward');
    report.route = await page.evaluate(() => {
      const { game, hero, world, stage, origin } = __hallTour;
      const saved = hero.position.clone(), [u, , v] = stage();
      const path = [];
      for (let x = u + 0.10; x < 76.5; x += 0.10) path.push([x, v]);
      const supports = [];
      const blocked = [];
      try {
        for (const [x, z] of path) {
          const destination = world(x, 0, z);
          const y = PalaceInterior.floorAt(destination.x, destination.z, hero.position.y);
          if (game.blocked(destination.x, destination.z)) blocked.push([x, z]);
          hero.position.copy(destination);
          hero.position.y = y;
          if (supports.length === 0 || Math.abs(supports.at(-1)[1] - (y - origin.y)) > 0.08) {
            supports.push([+x.toFixed(2), +(y - origin.y).toFixed(2), +z.toFixed(2)]);
          }
        }
      } finally {
        hero.position.copy(saved);
      }
      return { probes: path.length, blocked, supports };
    });
    assert.deepEqual(report.route.blocked, [], 'Gallery steps and authored platform remain traversable');
    assert.ok(report.route.supports.some(([u, y]) => u > 57 && u < 61 && y > -15), 'Platform provides raised support');
    console.log('Walked', (moved[0] - spawn[0]).toFixed(2), 'm, cleared', report.route.probes, 'route probes');
    save();

    async function placeHero(u, v) {
      await page.evaluate(([u, v]) => {
        const { world, hero, game } = __hallTour;
        const p = world(u, -15, v);
        p.y = PalaceInterior.floorAt(p.x, p.z, p.y);
        hero.position.copy(p);
        game.setFacing(-Math.PI / 2);
      }, [u, v]);
      await raf(3);
    }
    await placeHero(49.5, 24);
    report.views.basin = await measure();
    await shot('02-sin-basin');
    save();
    await placeHero(59, 24);
    report.views.platform = await measure();
    await shot('03-sin-platform');
    save();

    const camera = async (position, target) => page.evaluate(({ position, target }) => {
      const { camera, world } = __hallTour;
      camera.position.copy(world(...position));
      camera.lookAt(world(...target));
      camera.updateMatrixWorld();
    }, { position, target });
    await page.evaluate(() => { window.__holdSim = true; });
    await camera([40.2, -8.8, 24.5], [68, -10.2, 24.5]);
    await shot('04-hall-reference-angle');
    report.views.wide = await measure();
    save();
    await camera([65.9, -10.8, 9.8], [70.7, -10.8, 20.7]);
    await shot('05-guardian-and-seal');
    report.views.side = await measure();
    save();

    // Freeze gameplay only for the camera move. Explicit renders keep
    // every encoded frame from the game renderer regardless of host FPS.
    await page.evaluate(() => {
      const renderer = window.__R;
      window.__hallTour.render = renderer.render.bind(renderer);
      renderer.render = () => {};
    });
    for (let i = 0; i < 37; i++) {
      const t = i / 36, blend = t * t * (3 - 2 * t);
      await camera([40.2 + 6.1 * blend, -8.8 - 1.7 * blend, 24.5 + 8.7 * blend],
        [68 - 2.9 * blend, -10.2 - 2.2 * blend, 24.5 - 2.4 * blend]);
      await record();
    }
    for (let i = 0; i < 20; i++) {
      const t = i / 19;
      await camera([65.9 + 1.2 * t, -10.8 - 0.9 * t, 9.8 + 2.8 * t], [70.7, -10.8, 20.7]);
      await record();
    }
    report.frames = index;
    assert.deepEqual(report.errors, []);
  } finally {
    fs.writeFileSync(path.join(out, 'tour.json'), JSON.stringify(report, null, 2) + '\n');
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
