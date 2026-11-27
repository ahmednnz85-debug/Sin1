#!/usr/bin/env node
/* Real-game R3-03 capture. Run with NODE_PATH=… THREE_DIR=… node tools/r3-maw-tour.cjs out [index URL]. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const out = process.argv[2] || 'r3-maw-tour';
const url = new URL(process.argv[3] || 'http://127.0.0.1:8080/index.html');
url.search = '?dev=1&level=R3-03';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const views = {
  reference: [[0.65, 2.10, 0.1], [12, 3.38, 1.55], 58],
  wide: [[1.5, 2.3, -1.0], [30, 0, -4], 70],
  down: [[20.2, 3.4, -1.2], [48, -30, -7], 72],
  left: [[4.20, 2.75, -1.6], [10.7, 2.37, 4.25], 57],
  approach: [[3.80, 1.84, 1.1], [13, 2.26, -0.6], 61],
  deck: [[8.5, 2.35, -0.75], [22.7, 3.1, -0.5], 65],
  rim: [[17.08, 2.74, -0.55], [51, -10.4, -3.55], 62]
};
const corridors = [
  ['corridor-01-from-hall.jpg', [-20.15, 5.2, 20.5], [-20, 4.2, 11], 64, [-20, 3.5, 18.5]],
  ['corridor-02-first-landing.jpg', [-21.5, 4.6, 14.5], [-9, 3.6, 13], 64, [-20, 3.1, 13]],
  ['corridor-03-second-landing.jpg', [-10.5, 4.0, 13.5], [-9, 2.6, 2], 66, [-9, 2.2, 12.5]],
  ['corridor-04-drop.jpg', [-9.0, 3.6, 7.0], [-9, 2.0, -3], 64, [-9, 1.4, 5.5]],
  ['corridor-05-abyss-reveal.jpg', [-10.5, 3.0, 1.0], [8, 2.5, -1], 62, [-8.5, 0.9, 0.5]]
];

async function main() {
  fs.mkdirSync(path.join(out, 'frames'), { recursive: true });
  const report = { url: url.href, environment: 'iPhone landscape viewport and UA, Chromium/SwiftShader on Linux',
    renderer: null, checks: {}, views: {}, errors: [] };
  const save = () => fs.writeFileSync(path.join(out, 'tour.json'), JSON.stringify(report, null, 2) + '\n');
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 852, height: 393 }, userAgent: UA,
      isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const cdp = await page.context().newCDPSession(page);
    page.on('pageerror', e => report.errors.push(String(e)));
    page.on('console', m => {
      const message = m.text();
      if (/\[R3-03\]|WebGLProgram: Shader Error/.test(message)) report.errors.push(message.slice(0, 2000));
      if (/dev-hub.*ready|\[palace load\] DONE/.test(message)) console.log(message);
    });
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'iPhone', configurable: true });
      Object.defineProperty(Performance.prototype, 'memory', { get: () => undefined, configurable: true });
    });
    if (process.env.THREE_DIR) await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.187\.0\//, route => {
      const file = route.request().url().split('three@0.187.0/')[1].split('?')[0];
      return route.fulfill({ path: path.join(process.env.THREE_DIR, file), contentType: 'text/javascript' });
    });
    const start = Date.now();
    await page.goto(url.href);
    await page.waitForFunction(() => window.__sinDev?.ready || window.__sinDev?.error, null,
      { timeout: 480000, polling: 500 });
    // The hub uncovers the area only now: the Maw must already be complete.
    const entry = await page.evaluate(() => {
      const game = SinDevHub.game(), room = game.scene.getObjectByName('MawOfTheAbyss_Dressing');
      __R.render(game.scene, game.camera);
      return { phase: room?.userData.maw.phase, visible: room?.visible,
        approach: room?.userData.maw.approach?.phase,
        frame: __R.domElement.toDataURL('image/jpeg', 0.9).split(',')[1] };
    });
    fs.writeFileSync(path.join(out, 'first-frame.jpg'), Buffer.from(entry.frame, 'base64'));
    report.firstFrame = { phase: entry.phase, roomVisible: entry.visible, approach: entry.approach };
    report.checks.completeOnEntry = entry.phase === 'ready' && entry.visible === true && entry.approach === 'ready';
    await page.evaluate(() => {
      if (!__sinDev.ready) throw new Error(__sinDev.error);
      document.documentElement.classList.add('sin-dev-clean');
      const game = SinDevHub.game(), hero = game.hero(), scene = game.scene, camera = game.camera;
      const room = scene.getObjectByName('MawOfTheAbyss_Dressing');
      if (!room) throw new Error('Maw is absent from the actual stage');
      const renderer = __R, render = renderer.render.bind(renderer);
      window.__mawTour = { game, hero, scene, camera, room, renderer, render,
        world: (x, y, z) => room.localToWorld(new THREE.Vector3(x, y, z)),
        local: () => room.worldToLocal(hero.position.clone()).toArray() };
    });
    await page.waitForFunction(() => ['ready', 'failed'].includes(__mawTour.room.userData.maw.phase), null,
      { timeout: 90000, polling: 250 });
    const info = await page.evaluate(reference => {
      const { room, renderer, hero, game, local, scene, world } = __mawTour;
      const gl = renderer.getContext(), driver = gl.getExtension('WEBGL_debug_renderer_info');
      const counts = { lamassu: 0, lift: 0, crown: 0, chainCourses: 0, arrival: 0, fire: 0 };
      scene.getObjectByName('Maw_Lift_Arrival') && counts.arrival++;
      room.traverse(o => {
        if (o.name === 'Maw_Left_Lamassu') counts.lamassu++;
        if (o.name === 'Maw_Lift') counts.lift++;
        if (o.name === 'Maw_Lift_Crown') counts.crown++;
        if (o.name === 'Maw_Lift_Chains' && o.parent?.name === 'Maw_Lift') counts.chainCourses = o.count;
        if (/fire|torch|flame/i.test(o.name)) counts.fire++;
      });
      const gorge = room.getObjectByName('Maw_Canyon_Geology');
      const bounds = gorge && new THREE.Box3().setFromObject(gorge).getSize(new THREE.Vector3()).toArray();
      const comparison = new THREE.PerspectiveCamera(reference[2], 16 / 9, 0.25, 1200);
      comparison.position.copy(world(...reference[0]));
      comparison.lookAt(world(...reference[1]));
      comparison.updateMatrixWorld();
      const screen = name => {
        const center = new THREE.Box3().setFromObject(room.getObjectByName(name)).getCenter(new THREE.Vector3());
        center.project(comparison);
        return [+(0.5 + center.x / 2).toFixed(3), +(0.5 - center.y / 2).toFixed(3)];
      };
      const composition = { guardian: screen('Maw_Left_Lamassu') };
      for (const { site } of room.userData.maw.ruins) composition[site] = screen('Maw_Ruin_' + site);
      return { renderer: driver && gl.getParameter(driver.UNMASKED_RENDERER_WEBGL), area: __sinDev.area.id,
        status: room.userData.maw, spawnClear: !game.blocked(hero.position.x, hero.position.z),
        position: local(), counts, composition, gorge: { surfaces: gorge?.children.length, dimensions: bounds },
        roots: scene.children.map(o => o.name) };
    }, views.reference);
    Object.assign(report, info, { bootSeconds: (Date.now() - start) / 1000 });
    assert.equal(info.status.phase, 'ready', info.status.error);
    report.checks.directR3 = info.area === 'R3-03' && info.roots.length === 2 && info.roots.includes('R3Stage');
    report.checks.freeSpawn = info.spawnClear;
    report.checks.composition = info.counts.lift === 1 && info.counts.crown === 1 && info.counts.lamassu === 1 &&
      info.counts.chainCourses === info.status.lift.courses && info.counts.arrival === 0 && info.counts.fire === 0;
    report.checks.solidCanyon = info.gorge.surfaces === 13 && info.gorge.dimensions[1] > 195;
    const landmarks = info.composition;
    report.checks.referenceLayout = landmarks.guardian[0] < 0.34 &&
      landmarks.Promontory[0] < landmarks.DistantSpan[0] &&
      landmarks.DistantSpan[0] < landmarks.RightLower[0] &&
      landmarks.RightLower[0] < landmarks.RightUpper[0] && landmarks.RightUpper[1] < landmarks.RightLower[1];
    console.log('Maw ready', JSON.stringify({ position: info.position, checks: report.checks, frame: report.bootSeconds }));
    save();

    const raf = n => page.evaluate(count => new Promise(resolve => {
      function frame() { if (--count < 1) resolve(); else requestAnimationFrame(frame); }
      requestAnimationFrame(frame);
    }), n);
    await page.keyboard.down('KeyW');
    await raf(22);
    await page.keyboard.up('KeyW');
    report.motion = await page.evaluate(() => __mawTour.local());
    report.checks.controller = report.motion[0] - report.position[0] > 0.22;
    await page.evaluate(() => { window.__holdSim = true; });
    report.path = await page.evaluate(() => {
      const { game, hero, world, room, local } = __mawTour;
      const previous = hero.position.clone();
      const tested = [], heights = [];
      try {
        hero.position.copy(world(0.76, 0, 1.9));
        for (let x = 0.85; x <= 18.5; x += 0.11) {
          const at = world(x, 0, 1.9);
          if (game.blocked(at.x, at.z)) { tested.push({ blockedAt: x }); break; }
          at.y = PalaceInterior.floorAt(at.x, at.z, hero.position.y);
          hero.position.copy(at);
          const y = +local()[1].toFixed(2);
          if (y !== heights.at(-1)) heights.push(y);
        }
        const edge = world(21, 0, -1.35);
        // Cabin: its side wall stops the capsule, the doorway (toward the arch) does not.
        hero.position.copy(world(12.9, 0.59, -1.4));
        const pin = world(12.9, 0.59, -1.4 + 2.0);
        const door = world(10.4, 0.59, -1.4);
        const doorOpen = !game.blocked(door.x, door.z);
        return { tested, heights, abyssBlocked: game.blocked(edge.x, edge.z),
          anchorBlocked: game.blocked(pin.x, pin.z), doorOpen };
      } finally {
        hero.position.copy(previous);
      }
    });
    report.checks.walksOntoDeck = report.path.tested.length === 0 && report.path.heights.includes(0.58);
    report.checks.edgeAndHardwareBlock = report.path.abyssBlocked && report.path.anchorBlocked && report.path.doorOpen;
    console.log('Maw collisions', JSON.stringify(report.path));
    save();

    const setCamera = view => page.evaluate(([position, target, fov]) => {
      const { camera, world } = __mawTour;
      camera.position.copy(world(...position));
      camera.fov = fov;
      camera.lookAt(world(...target));
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    }, view);
    async function capture(file) {
      const jpg = await page.evaluate(() => {
        const { scene, camera, renderer, render } = __mawTour;
        render(scene, camera);
        return renderer.domElement.toDataURL('image/jpeg', 0.92).split(',')[1];
      });
      fs.writeFileSync(path.join(out, file), Buffer.from(jpg, 'base64'));
    }
    await page.evaluate(() => { __mawTour.renderer.render = () => {}; });
    await capture('sin-perspective.jpg');
    const regionPose = await page.evaluate(() => __mawTour.hero.position.toArray());
    for (const [name, position, target, fov, heroAt] of corridors) {
      await page.evaluate(at => {
        const { hero, world } = __mawTour;
        hero.position.copy(world(...at));
      }, heroAt);
      await setCamera([position, target, fov]);
      await capture(name);
    }
    await page.evaluate(saved => __mawTour.hero.position.fromArray(saved), regionPose);
    report.corridors = corridors.map(([name]) => name);
    save();
    await cdp.send('HeapProfiler.collectGarbage');
    report.heapMiB = +((await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576).toFixed(1);
    for (const [name, view] of Object.entries(views)) {
      await setCamera(view);
      if (name === 'reference') {
        const native = await page.evaluate(() => {
          const { renderer, camera, hero, world } = __mawTour;
          const saved = [renderer.getSize(new THREE.Vector2()).toArray(), renderer.getPixelRatio(),
            camera.aspect, hero.position.toArray()];
          renderer.setPixelRatio(1);
          renderer.setSize(960, 540, false);
          camera.aspect = 16 / 9;
          camera.updateProjectionMatrix();
          hero.position.copy(world(0.1, 0, 2.4));
          return saved;
        });
        await capture('reference.jpg');
        await page.evaluate(([size, ratio, aspect, heroPosition]) => {
          const { renderer, camera, hero } = __mawTour;
          renderer.setPixelRatio(ratio);
          renderer.setSize(...size, false);
          camera.aspect = aspect;
          camera.updateProjectionMatrix();
          hero.position.fromArray(heroPosition);
        }, native);
      } else await capture(name + '.jpg');
      report.views[name] = await page.evaluate(async () => {
        const { scene, camera, renderer, render } = __mawTour;
        const durations = [];
        // Read one framebuffer pixel to include actual raster completion.
        // This is a synchronized rendering benchmark, not gameplay FPS.
        const gl = renderer.getContext();
        const pixel = new Uint8Array(4), x = gl.drawingBufferWidth >> 1, y = gl.drawingBufferHeight >> 1;
        render(scene, camera); gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        for (let i = 0; i < 3; i++) {
          const start = performance.now();
          render(scene, camera);
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          durations.push(performance.now() - start);
        }
        const estimate = SinProcessMemory.estimate({ scene, renderer, phase: 'maw-tour', room: 'R3-03' });
        const draw = renderer.info.render;
        const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
        return { synchronizedFrameMs: +mean.toFixed(2),
          worstMs: +Math.max(...durations).toFixed(2), draws: draw.calls, triangles: draw.triangles,
          geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
          resourceCpuMiB: estimate.cpuMB, resourceGpuMiB: estimate.gpuMB };
      });
    }
    report.checks.renderEnvelope = Object.values(report.views).every(v =>
      v.draws <= info.status.budget.drawCalls && v.triangles <= info.status.budget.trianglesInView);
    report.transition = await page.evaluate(() => PalaceInterior.r3Memory());
    save();

    await page.evaluate(() => {
      const { renderer, camera, hero, world } = __mawTour;
      renderer.setPixelRatio(1);
      renderer.setSize(800, 450, false);
      camera.aspect = 16 / 9;
      camera.updateProjectionMatrix();
      hero.position.copy(world(4.7, 0, 0.65));
    });
    let sequence = 0;
    for (const [a, b, samples] of [['reference', 'approach', 14], ['approach', 'deck', 15], ['deck', 'rim', 14]]) {
      const from = views[a], to = views[b];
      for (let i = 0; i < samples; i++) {
        const t = i / (samples - 1), smooth = t * t * (3 - 2 * t);
        const lerp = (x, y) => x + (y - x) * smooth;
        await setCamera([from[0].map((n, j) => lerp(n, to[0][j])),
          from[1].map((n, j) => lerp(n, to[1][j])), lerp(from[2], to[2])]);
        await capture('frames/' + String(sequence++).padStart(4, '0') + '.jpg');
      }
    }
    report.frames = sequence;
    assert.deepEqual(report.errors, []);
    assert.ok(Object.values(report.checks).every(Boolean), JSON.stringify(report.checks));
  } finally {
    save();
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
