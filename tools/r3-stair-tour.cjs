#!/usr/bin/env node
/* R3-01 Buried Years Stair — in-game tour on the iPhone profile.

   Boots the real game (?startInHall=1), walks Sîn through passage-L0 so the
   palace retires and the independent R3 stage mounts, then drives the hero
   down both flights of the stair with the game's own controller (walk, run
   and descent), recording frames, frame times and memory snapshots.

   Usage:  node static-server.mjs &
           THREE_DIR=/path/to/node_modules/three node tools/r3-stair-tour.cjs --out r3-tour \
             [--url http://127.0.0.1:8080/index.html] [--video 1] [--shots 1] [--query '&x=1']
   Output: <out>/tour.json (timings, memory, collisions), <out>/*.png and,
   with --video, <out>/frames/*.jpg for ffmpeg. */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const OUT = opt('out') || 'r3-tour';
const URL = opt('url') || 'http://127.0.0.1:8080/index.html';
const QUERY = opt('query') || '';
const VIDEO = opt('video') === '1';
const ONLY_SHOTS = opt('shots') === '1';
const W = +(opt('w') || 852), H = +(opt('h') || 393), DPR = +(opt('dpr') || 1);
const THREE_DIR = process.env.THREE_DIR;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--expose-gc'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true, userAgent: UA, ...(VIDEO ? { recordVideo: { dir: path.join(OUT, 'video'), size: { width: W, height: H } } } : {}) });
  const page = await ctx.newPage();
  const errors = [], logs = [], requests = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 400)));
  page.on('console', m => { const t = m.text(); if (/R3|r3|stair|ktx|error/i.test(t)) logs.push(m.type() + ': ' + t.slice(0, 300)); });
  page.on('request', r => requests.push({ t: Date.now(), url: decodeURIComponent(r.url()).replace(/^https?:\/\/[^/]+\//, '') }));
  await page.addInitScript(() => { try { Object.defineProperty(Performance.prototype, 'memory', { get() { return undefined; }, configurable: true }); Object.defineProperty(Navigator.prototype, 'platform', { get() { return 'iPhone'; }, configurable: true }); } catch (e) {} });
  if (THREE_DIR) await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.187\.0\/(.*)$/, r => r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace(/^.*three@0\.187\.0\//, '').split('?')[0]), contentType: 'text/javascript' }));
  const t0 = Date.now();
  await page.goto(URL + '?sin=probe&startInHall=1&royalDoorTest=1' + QUERY);
  await page.waitForFunction("window.PalaceInterior&&PalaceInterior.state&&(PalaceInterior.state()==='DONE'||PalaceInterior.state()==='FAILED')&&window.__holdSim===false", null, { timeout: 1800000, polling: 1000 });
  console.log('palace ready', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  const frames = n => page.evaluate(n => new Promise(r => { let k = 0; (function f() { if (++k >= n) r(); else requestAnimationFrame(f); })(); }), n);
  // Stand in front of passage-L0 and step through it with the controller.
  const entry = await page.evaluate(() => {
    const hall = PalaceWings.state.hall, p = hall.passages.find(d => d.id === SinR3SealedZone.passageId);
    const m = PalaceInterior.metrics(), hero = PalaceWings.state.ctx.hero;
    hero.position.set(m.x + p.position[0] + 2.2, PalaceInterior.floorY(), m.front + p.position[2]);
    PalaceWings.state.ctx.setFacing(-Math.PI / 2);
    window.__tourHero = hero; window.__tourFacing = PalaceWings.state.ctx.setFacing;
    return { passage: p.position, width: p.width, portalX: m.x, front: m.front, floorY: PalaceInterior.floorY(), wallThickness: hall.wallThickness, alcoveDepth: hall.alcoveDepth };
  });
  await frames(4);
  const key = async (code, ms) => { await page.keyboard.down(code); await page.waitForTimeout(ms); await page.keyboard.up(code); };
  await page.keyboard.down('KeyW');
  await page.waitForFunction("PalaceInterior.inR3()", null, { timeout: 120000, polling: 100 });
  await page.keyboard.up('KeyW');
  const tEnter = Date.now();
  await page.waitForFunction("PalaceInterior.state()==='R3'", null, { timeout: 600000, polling: 250 });
  console.log('R3 mounted', ((Date.now() - tEnter) / 1000).toFixed(1) + 's');
  await frames(20);
  const mem = () => page.evaluate(() => { const r = window.__R; const i = r.info; let est = null; try { const h = window.__tourHero; let sc = h; while (sc && sc.parent) sc = sc.parent; const e = window.SinProcessMemory?.estimate?.({ scene: sc, renderer: r, phase: 'tour', room: 'R3' }); if (e) est = { cpuMB: e.cpuMB, gpuMB: e.gpuMB }; } catch (_) {} return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs ? i.programs.length : null, calls: i.render.calls, triangles: i.render.triangles, est }; });
  const tour = { entry, mounted: await page.evaluate(() => PalaceInterior.r3Memory()), stage: await page.evaluate(() => window.__r3Stair?.report?.()), points: [], errors, logs };
  // ---- tour: walk, run and descend both flights with the game controller ----
  // Stage space (u out of passage-L0, v along the hall) <-> world.
  await page.evaluate(e => {
    const T = window.__r3Tour = { e, log: [], frames: [], stuck: 0 };
    T.world = (u, v) => [e.portalX + e.passage[0] - u, e.front + e.passage[2] + v];
    T.stage = p => [e.portalX + e.passage[0] - p.x, p.z - e.front - e.passage[2]];
    T.yaw = (du, dv) => Math.atan2(-du, dv); // world yaw for a stage direction
    let last = performance.now();
    (function sample() {
      const now = performance.now(), h = window.__tourHero, r = window.__R;
      if (h && r) {
        const [u, v] = T.stage(h.position), i = r.info.render;
        T.frames.push({ t: now, dt: now - last, u: +u.toFixed(3), v: +v.toFixed(3), y: +(h.position.y - e.floorY).toFixed(3), calls: i.calls, tris: i.triangles });
      }
      last = now;
      requestAnimationFrame(sample);
    })();
  }, tour.entry);
  const pose = () => page.evaluate(() => { const T = window.__r3Tour, h = window.__tourHero; const [u, v] = T.stage(h.position); return { u, v, y: h.position.y - T.e.floorY }; });
  let heading = await page.evaluate(() => -Math.PI / 2);
  async function steer(target, ms = 900) {
    // Ease the facing (and so the follow camera) toward the new heading.
    const from = heading, d = Math.atan2(Math.sin(target - from), Math.cos(target - from)), n = Math.max(1, Math.round(ms / 60));
    for (let i = 1; i <= n; i++) {
      heading = from + d * (i / n);
      await page.evaluate(y => window.__tourFacing(y), heading);
      await frames(1);
    }
  }
  const segments = [];
  async function go(name, u, v, run, opts = {}) {
    const p0 = await pose(), t0 = Date.now();
    const target = await page.evaluate(([du, dv]) => window.__r3Tour.yaw(du, dv), [u - p0.u, v - p0.v]);
    await steer(target, opts.turnMs || 700);
    if (run) await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    let p = p0, best = Infinity, still = 0, guard = 0;
    while (guard++ < 4000) {
      await frames(2);
      p = await pose();
      const dist = Math.hypot(u - p.u, v - p.v);
      if (dist < (opts.within || 0.6)) break;
      if (dist < best - 0.05) { best = dist; still = 0; } else if (++still > 40) { tour.stuck = (tour.stuck || []).concat({ name, at: p }); break; }
      // Keep the heading on the waypoint (small corrections only).
      const want = Math.atan2(-(u - p.u), (v - p.v));
      const err = Math.atan2(Math.sin(want - heading), Math.cos(want - heading));
      // Re-aim rarely and only far from the waypoint: every facing call
      // resets the stick, and near the target small offsets read as big angles.
      if (dist > 2.5 && guard % 8 === 0 && Math.abs(err) > 0.08) { heading += err * 0.5; await page.evaluate(y => window.__tourFacing(y), heading); }
    }
    await page.keyboard.up('KeyW');
    if (run) await page.keyboard.up('ShiftLeft');
    const seg = { name, run: !!run, from: [+p0.u.toFixed(2), +p0.v.toFixed(2)], to: [+p.u.toFixed(2), +p.v.toFixed(2), +p.y.toFixed(2)], wallSeconds: (Date.now() - t0) / 1000, mem: await mem() };
    segments.push(seg); console.log(JSON.stringify(seg));
    await page.screenshot({ path: path.join(OUT, String(segments.length).padStart(2, '0') + '-' + name + '.png') });
  }
  const tTour = Date.now();
  const gameT0 = await page.evaluate(() => performance.now());
  await go('walk-head', 10.5, 0.2, false);
  await go('run-flight1', 28.6, -0.3, true);
  await go('walk-turn-landing', 33.8, -0.2, false, { within: 0.5 });
  await go('walk-flight2-head', 33.9, 7.0, false, { turnMs: 1400 });
  await go('run-flight2', 33.9, 19.2, true);
  await go('walk-lower-landing', 33.9, 23.6, false);
  await go('walk-hall-arch', 37.6, 23.9, false, { turnMs: 1200 });
  tour.segments = segments;
  tour.tourWallSeconds = (Date.now() - tTour) / 1000;
  const data = await page.evaluate(() => { const f = window.__r3Tour.frames; return { frames: f.length, f }; });
  // Frame analysis: floor tracking and draw-call / triangle envelope.
  const fr = data.f.slice(5);
  tour.frames = { count: fr.length,
    callsMax: Math.max(...fr.map(f => f.calls)), callsMean: +(fr.reduce((a, f) => a + f.calls, 0) / fr.length).toFixed(1),
    trisMax: Math.max(...fr.map(f => f.tris)), trisMean: Math.round(fr.reduce((a, f) => a + f.tris, 0) / fr.length),
    wallFrameMsMean: +(fr.reduce((a, f) => a + f.dt, 0) / fr.length).toFixed(1) };
  // Game time advances min(50 ms, frame gap) per frame: the video speed-up.
  const wall = fr.reduce((a, f) => a + f.dt, 0), game = fr.reduce((a, f) => a + Math.min(50, f.dt), 0);
  tour.videoSpeedup = +(wall / game).toFixed(3);
  tour.track = fr.filter((f, i) => i % 6 === 0).map(f => [f.u, f.v, f.y, f.calls, f.tris]);
  tour.after = await mem();
  tour.requestsAfterMount = requests.filter(r => r.t > tEnter && !/^data:|jsdelivr/.test(r.url)).map(r => r.url).slice(0, 80);
  tour.r3Memory = await page.evaluate(() => PalaceInterior.r3Memory());
  tour.stageCost = await page.evaluate(() => window.__lastR3Cost || null);
  fs.writeFileSync(path.join(OUT, 'tour.json'), JSON.stringify(tour, null, 1));
  await ctx.close();
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
