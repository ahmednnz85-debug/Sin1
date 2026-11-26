#!/usr/bin/env node
/* Capture and exercise the installed R3 door through the throne hall.
   NODE_PATH=… THREE_DIR=… node tools/r3-door-tour.cjs [output] [index URL] */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const output = process.argv[2] || 'r3-door-tour';
const url = new URL(process.argv[3] || 'http://127.0.0.1:8080/index.html');
url.searchParams.set('dev', '1');
url.searchParams.set('level', 'HALL');
url.searchParams.set('r3DoorTest', '1');
const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const frequency = 8;

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ args: [
    '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'
  ] });
  const report = { url: url.href, browser: browser.version(), device: 'iPhone viewport/UA, Chromium SwiftShader',
    fps: frequency, errors: [], checks: {}, angles: {}, views: {} };
  const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  try {
    const page = await browser.newPage({
      viewport: { width: 852, height: 393 }, isMobile: true, hasTouch: true,
      deviceScaleFactor: 1, userAgent: ua
    });
    const cdp = await page.context().newCDPSession(page);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', msg => {
      if (/WebGLProgram: Shader Error|Invalid sealed door|Incompatible sealed door/.test(msg.text())) report.errors.push(msg.text().slice(0, 700));
      if (/\[palace load\] (الباب المختوم|gpu-pump-end|DONE)|\[dev-hub\] ready/.test(msg.text())) console.log(msg.text());
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
    await page.waitForFunction(() => window.__sinDev?.ready || window.__sinDev?.error, null, { timeout: 600000, polling: 500 });
    report.bootSeconds = (Date.now() - start) / 1000;
    const info = await page.evaluate(() => {
      if (!__sinDev.ready) throw new Error(__sinDev.error);
      if (!window.__r3DoorTest?.state()) throw new Error('Sealed door is missing');
      const game = SinDevHub.game(), hero = game.hero(), camera = game.camera;
      let scene = hero;
      while (scene.parent) scene = scene.parent;
      const gate = scene.getObjectByName('R3SealedDoor');
      const frame = gate.getObjectByName('world');
      const [x, , z] = gate.getWorldPosition(new THREE.Vector3()).toArray();
      const y = PalaceInterior.floorY();
      const passage = PalaceWings.state.hall.passages.find(p => p.id === SinR3SealedZone.passageId);
      const fixed = frame.children.filter(mesh => mesh.isMesh);
      const baked = [], edgeFinishes = [];
      const maps = new Set();
      gate.traverse(node => {
        if (node.isMesh) {
          const count = (node.geometry.index?.count || node.geometry.attributes.position.count) / 3;
          (node.userData.r3DoorTrim ? edgeFinishes : baked).push([node.material.name, count]);
          maps.add(node.material.map);
        }
      });
      const alcoveFaces = scene.getObjectsByProperty('material', gate.getObjectByName('world/SideStone').material)
        .filter(node => /^passage-(back|jamb|slab)$/.test(node.name));
      document.documentElement.classList.add('sin-dev-clean');
      window.__doorTour = { game, hero, camera, scene, gate, fixed, x, y, z, passage,
        render: window.__R.render.bind(window.__R), size: window.__R.getSize(new THREE.Vector2()).toArray(),
        far: camera.far };
      const closed = __r3DoorTest.state();
      gate.updateWorldMatrix(true, true);
      const face = new THREE.Box3().setFromObject(gate).max.x;
      const wallPlane = PalaceInterior.metrics().x + passage.position[0];
      return { closed, passage, baked, edgeFinishes, face, wallPlane, hallFloor: y,
        stoneCourses: alcoveFaces.map(node => node.geometry.attributes.uv.count / 6),
        recessedWall: !!scene.getObjectByName('R3-RecessedWall'), textures: [...maps].map(t => [
        t.image?.width || t.userData.sinGpuW, t.image?.height || t.userData.sinGpuH]) };
    });
    report.asset = info;
    report.checks.closedByDefault = info.closed.phase === 'closed' && info.closed.angles.every(a => a === 0);
    report.checks.flushMuralFace = info.recessedWall && Math.abs(info.face - info.wallPlane) < 0.005;
    report.checks.sharedFloorDatum = Math.abs(info.closed.columnBase - info.hallFloor) < 0.002;
    report.checks.authoredEdgeFinishes = info.edgeFinishes.length === 2 &&
      info.edgeFinishes.every(([name]) => ['SideStone', 'ArchSide'].includes(name));
    report.checks.stoneCourses = info.stoneCourses.length === 4 && info.stoneCourses.every(courses => courses > 6);
    report.checks.sourceTriangles = info.baked.reduce((sum, [, count]) => sum + count, 0) === 86206;
    report.checks.sharedPng = info.textures.length === 4 &&
      info.textures.filter(([w, h]) => w === 1122 && h === 1402).length === 2;
    console.log('Hall ready with door', JSON.stringify(info.closed));
    save();

    const raf = count => page.evaluate(n => new Promise(resolve => {
      function frame() { if (--n === 0) resolve(); else requestAnimationFrame(frame); }
      requestAnimationFrame(frame);
    }), count);
    async function camera(side) {
      await page.evaluate(side => {
        const { camera, x, y, z } = __doorTour;
        // Keep the camera inside the existing alcove for the reverse view.
        const rear = side === 'back';
        camera.position.set(x + (rear ? -3.95 : 8.1), y + (rear ? 3.8 : 3.6), z + (side === 'oblique' ? 4.4 : 0.25));
        camera.fov = rear ? 96 : 61;
        camera.lookAt(x, y + 3.95, z);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
      }, side);
    }
    async function capture(file, dt) {
      const frame = await page.evaluate(dt => {
        const { scene, camera, render } = __doorTour;
        const slices = Math.ceil(dt / 0.1);
        for (let i = 0; i < slices; i++) __r3DoorTest.step(dt / slices);
        render(scene, camera);
        return { jpg: window.__R.domElement.toDataURL('image/jpeg', 0.91).split(',')[1], state: __r3DoorTest.state() };
      }, dt);
      fs.writeFileSync(path.join(output, file), Buffer.from(frame.jpg, 'base64'));
      return frame.state;
    }

    await page.evaluate(() => {
      const { hero, game, x, y, z } = __doorTour;
      hero.position.set(x + 5.2, y, z + 2.4);
      game.setFacing(-Math.PI / 2);
    });
    await raf(2);
    await page.evaluate(() => {
      window.__holdSim = true;
      window.__R.render = () => {};
      window.__R.setSize(720, 332, false);
      __doorTour.camera.far = 26;
    });
    await camera('front');
    await capture('front-closed.jpg', 0);
    await camera('oblique');
    await capture('mural-alignment.jpg', 0);
    await page.evaluate(() => {
      const { x, y, z, hero } = __doorTour;
      hero.position.set(x + 0.8, y, z);
    });
    report.checks.closedCenterBlocks = await page.evaluate(() => {
      const { game, x, z } = __doorTour;
      return game.blocked(x, z);
    });
    report.checks.sillSupport = await page.evaluate(() => {
      const { x, y, z } = __doorTour;
      const rise = PalaceInterior.floorAt(x, z, y) - y;
      return rise > 0 && rise < 0.25;
    });
    await page.evaluate(() => {
      const { hero, x, y, z } = __doorTour;
      hero.position.set(x - 1.02, y, z + 0.87);
      __r3DoorTest.open();
      for (let i = 0; i < 100; i++) __r3DoorTest.step(1 / 30);
    });
    report.checks.stairTextures = (await page.evaluate(() => __r3DoorTest.entranceReady())).every(Boolean);
    report.checks.sweepPausesForHero = await page.evaluate(() => {
      const { game, hero, x, y, z } = __doorTour;
      const gate = __r3DoorTest.state();
      if (gate.phase !== 'opening' || !(gate.elapsed > 0 && gate.elapsed < 3) || game.blocked(hero.position.x, hero.position.z)) return false;
      hero.position.set(x + 5.2, y, z + 2.4);
      for (let i = 0; i < 150; i++) __r3DoorTest.step(1 / 30);
      return __r3DoorTest.state().phase === 'open' && __r3DoorTest.reset();
    });
    console.log('Closed and swept collision', JSON.stringify(report.checks));
    save();

    // Verify the production tick advances after the temporary trigger.
    await page.evaluate(() => { window.__holdSim = false; __r3DoorTest.open(); });
    await raf(12);
    report.checks.gameTickAdvances = await page.evaluate(() => __r3DoorTest.state().elapsed > 0);
    await page.evaluate(() => { window.__holdSim = true; __r3DoorTest.reset(); });

    // Each frame is drawn by the live game's renderer. Automatic redraws
    // stay suspended during export so software GL renders each pose once.
    for (const side of ['front', 'back']) {
      fs.mkdirSync(path.join(output, side), { recursive: true });
      await camera(side);
      const frameBefore = await page.evaluate(() => {
        __doorTour.fixed.forEach(part => part.updateWorldMatrix(true, false));
        return __doorTour.fixed.map(part => part.matrixWorld.toArray());
      });
      if (side === 'back') await capture('back-closed.jpg', 0);
      await page.evaluate(() => __r3DoorTest.open());
      report.angles[side] = [];
      const frames = Math.ceil(frequency * info.closed.duration) + 2;
      for (let i = 0; i < frames; i++) {
        const pose = await capture(side + '/' + String(i).padStart(3, '0') + '.jpg', i ? 1 / frequency : 0);
        report.angles[side].push([pose.elapsed, ...pose.angles]);
      }
      const after = await capture(side + '-open.jpg', 0);
      report.checks[side + 'Angle'] = after.phase === 'open' &&
        Math.abs(after.angles[0] * 180 / Math.PI - 88.5) < 0.01 && Math.abs(after.angles[0] + after.angles[1]) < 1e-8;
      report.checks[side + 'FixedFrame'] = await page.evaluate(before =>
        __doorTour.fixed.every((part, i) => part.matrixWorld.elements.every((n, j) => n === before[i][j])), frameBefore);
      if (side === 'front') await page.evaluate(() => __r3DoorTest.reset());
      console.log('Captured', side, after.angles);
      save();
    }

    report.walk = await page.evaluate(() => {
      const { game, hero, passage, scene, camera, x, y, z } = __doorTour;
      const hall = PalaceWings.state.hall;
      const plane = PalaceInterior.metrics().x + passage.position[0];
      const start = plane - hall.wallThickness - hall.alcoveDepth;
      hero.position.set(x + 0.85, y, z);
      const goal = start - 3.35;
      let blockedAt = null, steps = 0;
      while (hero.position.x > goal) {
        const nx = hero.position.x - 0.06;
        if (game.blocked(nx, z)) { blockedAt = nx; break; }
        hero.position.set(nx, PalaceInterior.floorAt(nx, z, hero.position.y), z);
        steps++;
      }
      const stair = scene.getObjectByName('R3DoorStairEntrance');
      camera.position.set(x + 1.35, y + 2.45, z + 0.15);
      camera.fov = 66;
      camera.lookAt(start - 4.8, y - 1.9, z);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      return { position: hero.position.toArray(), steps, blockedAt, start, datum: y,
        stair: stair?.visible && !!stair.getObjectByName('Treads') && !!stair.getObjectByName('Vault') };
    });
    report.checks.walksDirectlyDownStair = report.walk.stair && report.walk.blockedAt === null &&
      report.walk.position[0] < report.walk.start - 3 && report.walk.position[1] < report.walk.datum - 0.5;
    await capture('into-stair.jpg', 0);
    console.log('Direct walk', JSON.stringify(report.walk));
    save();

    await page.evaluate(() => {
      const { render, size, far, camera } = __doorTour;
      window.__R.setSize(...size, false);
      camera.far = far;
      camera.updateProjectionMatrix();
      window.__R.render = render;
    });
    for (const side of ['front', 'back']) {
      await camera(side);
      report.views[side] = await page.evaluate(async () => {
        const { scene } = __doorTour, r = window.__R;
        const durations = [];
        let calls = 0, triangles = 0, last = await new Promise(requestAnimationFrame);
        for (let i = 0; i < 12; i++) {
          const now = await new Promise(requestAnimationFrame);
          durations.push(now - last);
          calls = Math.max(calls, r.info.render.calls);
          triangles = Math.max(triangles, r.info.render.triangles);
          last = now;
        }
        const estimate = SinProcessMemory.estimate({ scene, renderer: r, phase: 'r3-door-test', room: 'HALL' });
        return { meanFrameMs: durations.reduce((a, b) => a + b, 0) / durations.length,
          p95Ms: durations.sort((a, b) => a - b).at(-1), calls, triangles,
          cpuMB: estimate.cpuMB, gpuMB: estimate.gpuMB };
      });
    }
    await cdp.send('HeapProfiler.collectGarbage');
    const heapBefore = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    await page.evaluate(start => {
      const { game, hero, scene, render, z } = __doorTour;
      const target = start - 1.66;
      hero.position.set(target, PalaceInterior.floorAt(target, z, hero.position.y), z);
      game.setFacing(-Math.PI / 2);
      window.__doorTour = { hero, scene };
      window.__R.render = (...args) => { if (PalaceInterior.inR3()) render(...args); };
      window.__holdSim = false;
      window.__qaFast = true;
    }, report.walk.start);
    await page.keyboard.down('KeyW');
    await page.waitForFunction(() => PalaceInterior.inR3(), null, { timeout: 120000, polling: 100 });
    await page.keyboard.up('KeyW');
    const arrival = await page.evaluate(() => __doorTour.hero.position.toArray());
    await page.waitForFunction(() => ['R3', 'R3_FAILED'].includes(PalaceInterior.state()), null, { timeout: 420000, polling: 500 });
    await cdp.send('HeapProfiler.collectGarbage');
    const heapAfter = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    report.retirement = await page.evaluate(async ({ arrival, entrance }) => {
      const { hero, scene } = __doorTour;
      const snapshot = PalaceInterior.r3Memory();
      const stage = scene.getObjectByName('R3Stage');
      const sectionIds = stage?.getObjectByName('R3_SealedZone')?.children.map(n => n.name.split('_')[0])
        .filter(id => /^R3-\d+$/.test(id)).sort() || [];
      const registered = (await SinAreas.list()).filter(a => a.stage === 'r3').map(a => a.id).sort();
      const reloading = await PalaceInterior.loadPalaceAssets().then(() => false, () => true);
      return { ...snapshot, arrival, actual: hero.position.toArray(), sectionIds, registered,
        walkRetained: PalaceInterior.state() === 'R3' && Math.abs(hero.position.x - arrival[0]) < 0.25,
        noReturn: reloading && PalaceInterior.blocks(entrance + 0.25, hero.position.z),
        noOldScene: scene.children.length === 2 && scene.children.includes(hero) && scene.children.includes(stage) &&
          !window.__r3DoorTest && !Object.keys(PalaceWings.state).length };
    }, { arrival, entrance: report.walk.start });
    report.retirement.heapMiB = [heapBefore, heapAfter].map(bytes => +(bytes / 1048576).toFixed(1));
    const r3 = report.retirement;
    report.checks.retainsPositionAndReleasesPalace = r3.walkRetained && r3.noReturn && r3.noOldScene &&
      r3.released?.roots.length === 1 && r3.disposed?.geometries > 0 && r3.disposed?.textures > 0 &&
      r3.released?.cpuMB < r3.before?.cpuMB && r3.released?.gpuMB < r3.before?.gpuMB;
    report.checks.onlyRegisteredR3Sections = r3.sectionIds.length === 3 &&
      JSON.stringify(r3.sectionIds) === JSON.stringify(r3.registered);
    console.log('Point of no return', JSON.stringify({ checks: report.checks, memory: report.retirement }));
    assert.deepEqual(report.errors, []);
    assert.ok(Object.values(report.checks).every(Boolean), JSON.stringify(report.checks));
  } finally {
    save();
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
