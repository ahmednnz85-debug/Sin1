#!/usr/bin/env node
/* Run against the game's static server. NODE_PATH=… THREE_DIR=…
   node tools/u1-harbor-check.cjs <output> <index URL> [--checks-only|--stills-only|--camera-only] [--harbor-only] */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const out = process.argv[2] || 'harbor-check';
const base = process.argv[3] || 'http://127.0.0.1:8080/index.html';
const checksOnly = process.argv.includes('--checks-only');
const cameraOnly = process.argv.includes('--camera-only');
const harborOnly = process.argv.includes('--harbor-only');
const stillsOnly = process.argv.includes('--stills-only');
const report = { browser: '', viewport: '852×393, iPhone UA/touch, Chromium/SwiftShader', levels: {}, errors: [] };
const write = (name, jpg) => fs.writeFileSync(path.join(out, name + '.jpg'), Buffer.from(jpg, 'base64'));
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

async function open(browser, level) {
  const page = await browser.newPage({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1,
    isMobile: true, hasTouch: true, userAgent: ua });
  page.on('pageerror', error => report.errors.push([level, error.message]));
  page.on('console', msg => {
    if (/WebGLProgram: Shader Error|\[U1\].*(assets|failed)|\[R3-03\].*(error|failed)/i.test(msg.text())) {
      report.errors.push([level, msg.text().slice(0, 1600)]);
    }
  });
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'iPhone' });
    Object.defineProperty(Performance.prototype, 'memory', { get: () => undefined });
    let zone;
    Object.defineProperty(window, 'SinR3SealedZone', {
      get: () => zone, set(value) {
        zone = value;
        const mount = value.mount;
        zone.mount = function (...args) {
          const stage = mount(...args);
          if (!args[4]?.entranceOnly) window.harborTestStage = { stage, origin: args[3] };
          return stage;
        };
      }
    });
  });
  if (process.env.THREE_DIR) await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.187\.0\//, route => {
    const file = route.request().url().split('three@0.187.0/')[1].split('?')[0];
    return route.fulfill({ path: path.join(process.env.THREE_DIR, file), contentType: 'text/javascript' });
  });
  const url = new URL(base);
  url.search = '?dev=1&level=' + level;
  await page.goto(url.href);
  await page.waitForFunction(() => window.__sinDev?.ready || window.__sinDev?.error, null, { timeout: 480000, polling: 500 });
  const launched = await page.evaluate(() => {
    if (!__sinDev.ready) throw new Error(__sinDev.error);
    const game = SinDevHub.game(), hero = game.hero(), camera = game.camera, scene = game.scene;
    const { stage, origin } = harborTestStage;
    const lift = SinR3Maw.lift, deep = scene.getObjectByName('U1_Underworld');
    const room = stage.maw.room, savedRender = __R.render.bind(__R);
    const at = (x, y, z, lower) => (lower ? deep : room).localToWorld(new THREE.Vector3(
      lift.center[0] + x, (lower ? lift.drop : 0) + y, lift.center[1] + z));
    const tick = () => stage.update(hero.position.x - origin.x, hero.position.y - origin.y, hero.position.z - origin.z);
    const floor = p => stage.cameraSurfaceAt(p.x - origin.x, p.z - origin.z, p.y - origin.y);
    const render = (w, h, measure) => {
      __R.setPixelRatio(1);
      __R.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const start = performance.now();
      savedRender(scene, camera);
      const gl = __R.getContext();
      const data = new Uint8Array(4);
      if (measure) gl.readPixels(w >> 1, h >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
      const time = +(performance.now() - start).toFixed(2);
      const m = SinProcessMemory.estimate({ scene, renderer: __R, phase: 'harbor-check' });
      return { frame: __R.domElement.toDataURL('image/jpeg', .90).split(',')[1],
        display: { width: w, height: h, calls: __R.info.render.calls, triangles: __R.info.render.triangles,
          geometries: __R.info.memory.geometries, textures: __R.info.memory.textures,
          cpuMB: m.cpuMB, gpuMB: m.gpuMB, readbackMs: measure ? time : null } };
    };
    window.harborTest = { game, hero, stage, origin, camera, scene, deep, room, at, tick, floor, render, lift,
      spawn: hero.position.clone(), frames: n => new Promise(resolve => {
        function frame() { if (--n <= 0) resolve(); else requestAnimationFrame(frame); }
        requestAnimationFrame(frame);
      }) };
    __R.render = () => {};
    const scenery = stage.underworld.status.ruinLandmarks;
    const offstage = [[51, 41], [81, -40]].map(([x, z]) => at(x, 0, z, true));
    return { spawn: hero.position.toArray(), readyMs: __sinDev.ms, state: PalaceInterior.state(),
      scenery: scenery ? { landmarks: scenery, unreachable: offstage.every(p => game.blocked(p.x, p.z)) } : null,
      blocked: game.blocked(hero.position.x, hero.position.z),
      underworldAssets: stage.underworld.status.phase };
  });
  return { page, launched, url: url.href };
}

async function audit(page, level) {
  return page.evaluate(async level => {
    const { hero, camera, game, stage, origin, at, floor, tick, lift, spawn, frames } = harborTest;
    const lower = level === 'U1-01';
    const checkLift = lower || level === 'R3-03';
    const foot = p => { p.y = (floor(p)?.y ?? p.y - origin.y) + origin.y; return p; };
    const testPoints = [];
    const distance = (c, b) => Math.hypot(Math.max(0, b.minx - c.x, c.x - b.maxx),
      Math.max(0, b.miny - c.y, c.y - b.maxy), Math.max(0, b.minz - c.z, c.z - b.maxz));
    if (checkLift) {
      testPoints.push(['cabin center', at(0, lift.deck, 0, lower)],
        ['cabin wall', at(0.92, lift.deck, 0.36, lower)], ['sill', at(-1.83, lift.deck, 0, lower)]);
      if (lower) testPoints.push(['column', at(12.38, 0, 0.35, lower)], ['parapet', at(7.1, 0, 13.8, lower)]);
      else testPoints.push(['arch pier', at(-5.1, 0, 3.1, lower)]);
    } else {
      for (const [name, heading] of [['left corridor wall', 0], ['right corridor wall', Math.PI]]) {
        const p = spawn.clone();
        // Pick a position one step from the wall through the real capsule query.
        for (let i = 0; i < 65; i++) {
          const q = foot(p.clone().add(new THREE.Vector3(Math.sin(heading) * .04, 0, Math.cos(heading) * .04)));
          if (stage.blocks(q.x - origin.x, q.z - origin.z, p.y - origin.y, p.x - origin.x, p.z - origin.z, 0.38)) break;
          p.copy(q);
        }
        testPoints.push([name, p]);
      }
    }
    window.__holdSim = true;
    const orbits = [];
    for (const [name, position] of testPoints) {
      hero.position.copy(foot(position));
      tick();
      const staged = hero.position.clone().sub(origin);
      const boxes = stage.cameraBoxesAt(staged.x, staged.z, staged.y) || [];
      let minWall = Infinity, minBody = Infinity, maxStep = 0, belowFloor = 0, outOfBody = 0, maxMs = 0, invalid = 0;
      let lastYaw = 0, yawSum = 0, lowYaw = 0, highYaw = 0;
      const c = camera.position.clone();
      const before = performance.now();
      for (let i = -20; i <= 360; i++) {
        const { position: p } = hero;
        const t = performance.now();
        PalaceInterior.followCamera(camera, hero, i * Math.PI / 180, i <= 180 ? .22 : .70, 3.45, 1 / 60);
        maxMs = Math.max(maxMs, performance.now() - t);
        const rel = camera.position.clone().sub(p);
        if (i >= 0) {
          const h = Math.hypot(rel.x, rel.z);
          const yaw = Math.atan2(rel.x, rel.z);
          if (i && h > 0.1) yawSum += Math.atan2(Math.sin(yaw - lastYaw), Math.cos(yaw - lastYaw));
          lastYaw = yaw;
          lowYaw = Math.min(lowYaw, yawSum);
          highYaw = Math.max(highYaw, yawSum);
          minBody = Math.min(minBody, h);
          if (h < .90 && rel.y < 2.61) outOfBody++;
          if (!camera.position.toArray().every(Number.isFinite)) invalid++;
          const surface = floor(camera.position);
          if (surface && (camera.position.y < origin.y + surface.y + .295 ||
            camera.position.y > origin.y + surface.ceiling - .295)) belowFloor++;
          for (const b of boxes) minWall = Math.min(minWall, distance(camera.position, b));
          maxStep = Math.max(maxStep, camera.position.distanceTo(c));
        }
        c.copy(camera.position);
      }
      orbits.push({ name, samples: 361, wallClearance: Number(minWall.toFixed(3)),
        minHorizontal: Number(minBody.toFixed(3)), bodyIntersections: outOfBody, floorOrCeilingIntersections: belowFloor,
        invalid, sweptDegrees: Math.round((highYaw - lowYaw) * 180 / Math.PI), maxStep: Number(maxStep.toFixed(3)), meanAuditMs: Number(((performance.now() - before) / 381).toFixed(3)), maxSolverMs: maxMs });
    }
    if (!checkLift) return { orbits };
    const holder = lower ? harborTest.deep.getObjectByName('Maw_Lift_Arrival') : harborTest.room.getObjectByName('Maw_Lift');
    const cabin = holder.getObjectByName('Maw_Lift_Cabin');
    // Measured floor, opening and headroom in the installed (transformed) mesh.
    const mesh = cabin, pos = mesh.geometry.attributes.position, ids = mesh.geometry.index.array;
    const v = new THREE.Vector3(), center = at(0, lift.deck, 0, lower);
    let deckMax = -Infinity, ceilingMin = Infinity, innerJamb = Infinity;
    const seen = new Set();
    for (const i of ids) {
      if (seen.has(i)) continue;
      seen.add(i);
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).sub(center);
      if (Math.hypot(v.x, v.z) < .54 && v.y < .12) deckMax = Math.max(deckMax, v.y);
      if (Math.hypot(v.x, v.z) < .67 && v.y > 1.88) ceilingMin = Math.min(ceilingMin, v.y);
      if (v.x > 1.0 && v.y > .23 && v.y < 2.15) innerJamb = Math.min(innerJamb, Math.abs(v.z));
    }
    const rest = new THREE.Box3().setFromObject(hero, true).getSize(new THREE.Vector3());
    const poses = [];
    const yaw = -Math.PI / 2; // front along world -x, because the Maw frame is mirrored
    function place(x) {
      hero.position.copy(foot(at(x, lift.deck, 0, lower)));
      game.setFacing(yaw);
      tick();
    }
    window.__holdSim = false;
    place(-2.82);
    await frames(8);
    const waitForX = async (key, target, sign) => {
      __sinInp.keys[key] = true;
      try {
        for (let i = 0; i < 280; i++) {
          await frames(1);
          if ((hero.position.x - target) * sign >= 0) return i + 1;
        }
      } finally { delete __sinInp.keys[key]; }
      return 0;
    };
    for (const [key, target, sign] of [['KeyW', center.x + 0.39, -1], ['KeyS', center.x + 2.34, 1]]) {
      const ticks = await waitForX(key, target, sign);
      poses.push({ key, ticks, x: +(hero.position.x - center.x).toFixed(3), y: +(hero.position.y - center.y).toFixed(3),
        z: +(hero.position.z - center.z).toFixed(3), blocked: game.blocked(hero.position.x, hero.position.z) });
    }
    window.__holdSim = true;
    return { orbits, doorway: { floorToSillM: +deckMax.toFixed(3), centreHeadroomM: +ceilingMin.toFixed(3),
      clearWidthSampleM: +(innerJamb * 2).toFixed(3), sinRestHeightM: +rest.y.toFixed(3), poses } };
  }, level);
}

async function ride(page) {
  return page.evaluate(async () => {
    const { at, hero, frames, game, room, deep, lift, tick } = harborTest;
    window.__holdSim = false;
    const rides = [];
    for (const fromBelow of [false, true]) {
      hero.position.copy(at(-2.7, lift.deck, 0, fromBelow));
      game.setFacing(-Math.PI / 2);
      tick();
      await frames(6);
      hero.position.copy(at(0, lift.deck, 0, fromBelow));
      const y = hero.position.y, start = performance.now();
      let veil = 0;
      while (performance.now() - start < 150000) {
        await new Promise(resolve => setTimeout(resolve, 40));
        const overlay = document.getElementById('r3-lift-veil');
        veil = Math.max(veil, +(overlay?.style.opacity ?? 0));
        if (veil === 1 && !overlay && Math.abs(hero.position.y - y) > 400) break;
      }
      rides.push({ offset: +(hero.position.y - y).toFixed(2), veil,
        veilGone: !document.getElementById('r3-lift-veil'), visible: deep.visible ? 'U1' : room.visible ? 'R3' : null });
    }
    window.__holdSim = true;
    return rides;
  });
}

async function capture(page, level, spec, sequence) {
  for (let i = 0; i < spec.frames; i++) {
    const t = spec.frames <= 1 ? 0 : i / (spec.frames - 1);
    const result = await page.evaluate(async ({ spec, t, level, measure }) => {
      const { hero, camera, at, tick, render, spawn, game, frames } = harborTest;
      const lower = level === 'U1-01';
      const lerp = ([a, b], t) => a.map((n, i) => n + (b[i] - n) * t);
      game.setFacing(-Math.PI / 2);
      if (spec.walk) {
        if (t === 0) hero.position.copy(at(...spec.walk, lower));
        window.__holdSim = false;
        __sinInp.keys.KeyW = true;
        try { await frames(4); }
        finally { delete __sinInp.keys.KeyW; window.__holdSim = true; }
      } else if (spec.hero) hero.position.copy(at(...lerp(spec.hero, t), lower));
      else hero.position.copy(spawn);
      if (level === 'U1-01' && spec.hero && spec.fov === 69) hero.rotation.y = -Math.PI / 2;
      tick();
      if (spec.camera) {
        camera.position.copy(at(...lerp(spec.camera, t), lower));
        camera.lookAt(at(...lerp(spec.target, t), lower));
      } else {
        const angle = (spec.start ?? 0) + 2 * Math.PI * t;
        for (let j = 0; j < 4; j++) PalaceInterior.followCamera(camera, hero, angle, .22, 3.45, 1 / 60);
      }
      camera.fov = spec.fov ?? 42;
      return render(measure ? 852 : 480, measure ? 478 : 270, measure);
    }, { spec, t, level, measure: sequence == null });
    if (sequence == null) {
      write(spec.name, result.frame);
      report.levels[level].frames[spec.name] = result.display;
    } else {
      write('frame-' + String(sequence + i).padStart(4, '0'), result.frame);
    }
  }
  return sequence + spec.frames;
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  report.browser = browser.version();
  let frame = 0;
  const views = {
    'U1-01': [
      { name: 'harbor', frames: 1, camera: [[-16.2, 1.77, 1.18], [-16.2, 1.77, 1.18]], target: [[0.2, 3.7, 4.2], [0.2, 3.7, 4.2]],
        hero: [[-10.4, 0, 4.92], [-10.4, 0, 4.92]], fov: 69 },
      { name: 'harbor-vista', frames: 1, camera: [[-8.5, 2.45, 2.2], [-8.5, 2.45, 2.2]], target: [[8, 3.8, 10.7], [8, 3.8, 10.7]],
        hero: [[-5.6, 0, 3.9], [-5.6, 0, 3.9]], fov: 51 },
      { name: 'harbor-right', frames: 1, camera: [[-9.5, 3.03, -4.10], [-9.5, 3.03, -4.10]],
        target: [[12, 4.1, -12], [12, 4.1, -12]], fov: 54, hero: [[-5.6, 0, -4.8], [-5.6, 0, -4.8]] },
      { name: 'dais-engravings', frames: 1, camera: [[-7.7, 1.62, 1.82], [-7.7, 1.62, 1.82]],
        target: [[-3.1, .67, .47], [-3.1, .67, .47]], fov: 53,
        hero: [[-6.3, 0, -2.7], [-6.3, 0, -2.7]] },
      { name: 'harbor-cabin', frames: 1, camera: [[-4.6, 1.94, 0], [-4.6, 1.94, 0]], target: [[0, 2.12, 0], [0, 2.12, 0]],
        hero: [[-1.37, .58, 0], [-1.37, .58, 0]], fov: 48 },
      { frames: 16, camera: [[-16.2, 1.77, 1.18], [-12.8, 2.10, 2.5]], target: [[0.2, 3.7, 4.2], [0.7, 3.5, 2.0]],
        hero: [[-10.4, 0, 4.92], [-10.4, 0, 4.92]], fov: 69 },
      { frames: 17, camera: [[-5.4, 2.27, 0], [-3.58, 2.14, .02]], target: [[0.5, 2.31, 0], [1, 2.14, 0]],
        walk: [-3, .58, 0], fov: 49 },
      { frames: 21, hero: [[.1, .58, .08], [.1, .58, .08]] }
    ],
    'R3-03': [
      { name: 'maw-lift', frames: 1, camera: [[-6.2, 2.6, 0.9], [-6.2, 2.6, 0.9]], target: [[0.7, 3.9, 0], [0.7, 3.9, 0]],
        hero: [[-3, .58, 0], [-3, .58, 0]], fov: 58 },
      { frames: 16, camera: [[-6.2, 2.6, 0.9], [-4.1, 2.32, 0.12]], target: [[0.7, 3.9, 0], [0.7, 2.4, 0]],
        walk: [-3, .58, 0], fov: 58 }
    ],
    'R3-01': [{ frames: 15 }]
  };
  try {
    for (const level of Object.keys(views)) {
      if (harborOnly && level !== 'U1-01') continue;
      const { page, launched, url } = await open(browser, level);
      try {
        const result = report.levels[level] = { ...launched, url, frames: {} };
        result.audit = await audit(page, level);
        save();
        console.log(level, JSON.stringify(result.audit));
        if (level === 'R3-03' && !cameraOnly) { result.ride = await ride(page); save(); }
        if (!checksOnly) for (const view of views[level]) {
          if (cameraOnly && view.camera) continue;
          if (view.name) await capture(page, level, view, null);
          else if (!stillsOnly) frame = await capture(page, level, view, frame);
          save();
        }
      } finally { await page.close(); }
    }
    assert.deepEqual(report.errors, []);
    for (const result of Object.values(report.levels)) {
      assert.equal(result.state, 'R3');
      assert.equal(result.blocked, false);
      for (const orbit of result.audit.orbits) {
        assert.ok(orbit.wallClearance >= .295, JSON.stringify(orbit));
        assert.equal(orbit.bodyIntersections + orbit.floorOrCeilingIntersections + orbit.invalid, 0, JSON.stringify(orbit));
        if (orbit.name === 'cabin center') assert.ok(orbit.sweptDegrees >= 315, JSON.stringify(orbit));
      }
      if (result.audit.doorway) {
        const d = result.audit.doorway;
        assert.ok(Math.abs(d.floorToSillM) <= 0.02 && d.centreHeadroomM > d.sinRestHeightM, JSON.stringify(d));
        assert.ok(d.poses.every(p => p.ticks > 0 && !p.blocked), JSON.stringify(d.poses));
      }
    }
    if (report.levels['U1-01'].scenery) {
      assert.deepEqual(report.levels['U1-01'].scenery, { landmarks: 7, unreachable: true });
    }
    if (!cameraOnly && !harborOnly) assert.deepEqual(report.levels['R3-03'].ride,
      [{ offset: -420, veil: 1, veilGone: true, visible: 'U1' }, { offset: 420, veil: 1, veilGone: true, visible: 'R3' }]);
  } finally {
    save();
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
