#!/usr/bin/env node
/* Original-play regression, with the Developer Hub REMOVED from the page.
   node static-server.mjs &
   NODE_PATH=… THREE_DIR=… node tools/story-regression.cjs --out dir [--url index] [--scenario normal,palace,story] [--hub keep]

   The page is served without the dev-hub.js <script> tag and dev-hub.js
   answers 404, exactly as after the hub's removal (DEVELOPER_GUIDE.md).
   normal  plain link: loading screen -> main menu -> NEW GAME (story start).
           Records every asset fetched, the boot flags, hero and stage state.
   palace  the royal boundary with all exterior assets loaded.
   story   the repository's story test path (startInHall + royalDoorTest +
           r3DoorTest, AGENTS.md rule 3): the real royal door transition into
           the palace (point of no return), the sealed R3 door, the one-way
           passage-L0 transition into R3, then the one-way Maw lift to U1,
           all through the game loop.
   Output: <out>/report.json. */
'use strict';
const fs = require('fs'), path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const OUT = opt('out') || 'story-regression';
const BASE = opt('url') || 'http://127.0.0.1:8080/index.html';
const SCEN = (opt('scenario') || 'normal,story').split(',');
const KEEP_HUB = opt('hub') === 'keep';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const report = { base: BASE, hub: KEEP_HUB ? 'present' : 'removed', results: {} };
const save = () => fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));

async function open(browser) {
  const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const log = { errors: [], warnings: [], assets: [] };
  page.on('pageerror', e => log.errors.push(String(e).slice(0, 300)));
  page.on('console', m => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource:')) log.errors.push('console: ' + m.text().slice(0, 300));
  });
  page.on('response', response => {
    const file = new URL(response.url()).pathname;
    if (response.status() < 400 || /\/favicon\.ico$/.test(file) || (!KEEP_HUB && /\/dev-hub\.js$/.test(file))) return;
    const message = 'HTTP ' + response.status() + ' ' + decodeURIComponent(file);
    // The original exterior already uses its base sky when this optional map is absent.
    if (response.status() === 404 && file === '/assets/sky_babylon_blood.jpeg') log.warnings.push(message);
    else log.errors.push(message);
  });
  page.on('request', r => {
    const u = decodeURIComponent(r.url()).replace(/^https?:\/\/[^/]+\//, '').split('?')[0];
    if (/^(assets|data)\//.test(u)) log.assets.push(u);
  });
  await page.addInitScript(() => {
    // The story test observes the real simulation and loader. On software GL,
    // draw only the first frame of each stage (and every release/black frame).
    let renderer;
    Object.defineProperty(window, '__R', {
      configurable: true,
      get: () => renderer,
      set(value) {
        if (!value || value === renderer) return;
        renderer = value;
        queueMicrotask(() => {
          const normalRender = value.render;
          let previousPhase;
          value.render = function (scene, camera) {
            if (!scene.isScene || !scene.getObjectByName('SinHeroRoot')) return normalRender.call(this, scene, camera);
            window.__S = scene;
            window.__C = camera;
            const phase = [window.PalaceInterior?.state(), scene.children.length].join('/');
            if (phase !== previousPhase) {
              previousPhase = phase;
              return normalRender.call(this, scene, camera);
            }
          };
        });
      }
    });
    try { Object.defineProperty(Performance.prototype, 'memory', { get() { return undefined; }, configurable: true }); } catch (e) {}
  });
  if (process.env.THREE_DIR) await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.187\.0\/(.*)$/, r => r.fulfill({
    path: path.join(process.env.THREE_DIR, r.request().url().replace(/^.*three@0\.187\.0\//, '').split('?')[0]), contentType: 'text/javascript' }));
  if (!KEEP_HUB) {
    await page.route(/\/dev-hub\.js(\?.*)?$/, r => r.fulfill({ status: 404, body: 'removed' }));
    await page.route(/\/index\.html(\?.*)?$/, async r => {
      const res = await r.fetch();
      const html = (await res.text()).replace(/<!-- Temporary developer hub[^\n]*\n<script[^\n]*dev-hub\.js[^\n]*<\/script>\n/, '');
      if (/data-src="dev-hub\.js/.test(html)) throw new Error('hub tag not removed');
      r.fulfill({ response: res, body: html });
    });
  }
  return { ctx, page, log };
}
const frames = (page, n) => page.evaluate(n => new Promise(r => { let k = 0; (function f() { if (++k > n) r(); else requestAnimationFrame(f); })(); }), n);
const grab = page => page.evaluate(() => {
  // Without the hub the page exposes no game handle: capture the scene the loop draws.
  if (window.__S) return true;
  const R = window.__R; if (!R) return false;
  const render = R.render;
  R.render = function (s, c) { window.__S = s; window.__C = c; return render.call(this, s, c); };
  return true;
});

async function normal(browser) {
  const { ctx, page, log } = await open(browser);
  const t0 = Date.now();
  await page.goto(BASE);
  await page.waitForFunction("document.getElementById('main-menu') && getComputedStyle(document.getElementById('main-menu')).display !== 'none'", null, { timeout: 1200000, polling: 1000 });
  const menuSeconds = (Date.now() - t0) / 1000;
  const atMenu = [...new Set(log.assets)];
  await page.evaluate(() => document.getElementById('go').click());
  await grab(page);
  await frames(page, 40);
  const state = await page.evaluate(() => {
    const hero = window.__S && __S.getObjectByName('SinHeroRoot');
    return { hub: !!window.SinDevHub, deferExterior: window.__sinDeferExterior === undefined ? 'unset' : window.__sinDeferExterior,
      exteriorStarted: !!window.__sinExteriorStarted, palace: PalaceInterior.state(), inR3: PalaceInterior.inR3(),
      hero: hero && hero.position.toArray().map(n => +n.toFixed(2)), playing: document.body.classList.contains('playing'),
      chapters: window.SinAreas && SinAreas.chapters ? SinAreas.chapters().map(c => c.stage) : null,
      preloads: [...document.querySelectorAll('link[rel=preload]')].map(l => l.getAttribute('href')) };
  });
  await ctx.close();
  return { menuSeconds, ...state, assetsAtMenu: atMenu.sort(), assetCount: atMenu.length, errors: log.errors, warnings: log.warnings };
}

async function story(browser, palaceOnly = false) {
  const { ctx, page, log } = await open(browser);
  const out = { steps: {} };
  report.results[palaceOnly ? 'palace' : 'story'] = out;
  const t0 = Date.now();
  const mark = (k, v) => { out.steps[k] = { t: (Date.now() - t0) / 1000, ...v }; save(); console.log('story', k, JSON.stringify(out.steps[k]).slice(0, 300)); };
  const query = palaceOnly ? '?startInHall=1' : '?startInHall=1&royalDoorTest=1&r3DoorTest=1';
  out.url = BASE + query;
  await page.goto(out.url);
  // 1. Royal door -> palace (the game's own door test path and palace loader).
  await page.waitForFunction(() => window.PalaceInterior && (PalaceInterior.state() === 'FAILED' ||
    (PalaceInterior.state() === 'DONE' && window.__holdSim === false)), null, { timeout: 1500000, polling: 1000 });
  await grab(page); await frames(page, 3);
  mark('palace', await page.evaluate(() => ({
    state: PalaceInterior.state(), cityReleased: !!window.__sinCityReleased,
    memory: { before: PalaceInterior.status().preTeardown, released: PalaceInterior.status().postTeardown },
    roots: __S.children.map(o => o.name || o.type),
    isolated: !!__S.getObjectByName('PalaceInterior') && !__S.getObjectByName('R3Stage') && !__S.getObjectByName('U1Stage'),
    backToCityBlocked: PalaceInterior.blocks(PalaceInterior.metrics().x, PalaceInterior.metrics().front + 0.05),
    floorY: PalaceInterior.floorY(), front: PalaceInterior.metrics().front, x: PalaceInterior.metrics().x
  })));
  const assetsBeforeR3 = new Set(log.assets);
  const palaceAssets = [...assetsBeforeR3].filter(file => /^assets\/r3\//.test(file));
  if (palaceOnly) {
    out.assets = { requested: [...assetsBeforeR3].sort(), palaceR3OrU1: palaceAssets };
    const palace = out.steps.palace;
    out.checks = { palaceIsolated: palace.cityReleased && palace.memory.released?.cityReleased &&
      palace.isolated && palace.backToCityBlocked && palaceAssets.length === 0 && palace.memory.before.geometries > palace.memory.released.geometries };
    out.errors = log.errors;
    out.warnings = log.warnings;
    await ctx.close();
    return out;
  }
  // 2. The sealed R3 door opens; Sîn walks through passage-L0 (one way).
  const door = await page.evaluate(async () => {
    window.__holdSim = true;
    if (!window.__r3DoorTest || !__r3DoorTest.open()) return { opened: false };
    for (let i = 0; i < 400 && __r3DoorTest.state() !== 'open'; i++) __r3DoorTest.step(0.05);
    await __r3DoorTest.entranceReady();
    return { opened: true, state: __r3DoorTest.state() };
  });
  mark('r3-door', door);
  const cross = await page.evaluate(async () => {
    const hero = __S.getObjectByName('SinHeroRoot'), m = PalaceInterior.metrics(), y = PalaceInterior.floorY();
    const p = PalaceWings.state.hall.passages.find(d => d.id === SinR3SealedZone.passageId);
    const frames = n => new Promise(r => { let k = 0; (function f() { if (++k > n) r(); else requestAnimationFrame(f); })(); });
    window.__holdSim = false;
    for (let u = 0; u <= 9 && !PalaceInterior.inR3(); u += 0.25) {
      hero.position.set(m.x + p.position[0] - u, y + (u > 2.4 ? -0.15 * (u - 2.4) : 0), m.front + p.position[2]);
      await frames(2);
    }
    return { inR3: PalaceInterior.inR3(), state: PalaceInterior.state() };
  });
  mark('passage-L0', cross);
  await page.waitForFunction(() => ['R3', 'R3_FAILED'].includes(PalaceInterior.state()), null, { timeout: 900000, polling: 1000 });
  await frames(page, 3);
  mark('r3', await page.evaluate(() => {
    const hero = __S.getObjectByName('SinHeroRoot'), memory = PalaceInterior.r3Memory();
    return { state: PalaceInterior.state(), roots: __S.children.map(o => o.name),
      stage: PalaceInterior.activeSealedChapter(), memory,
      backToPalaceBlocked: PalaceInterior.blocks(hero.position.x + 2.6, hero.position.z) };
  }));
  assert.equal(out.steps.r3.state, 'R3');
  await page.waitForFunction(() => ['ready', 'failed'].includes(__S.getObjectByName('MawOfTheAbyss_Dressing')?.userData.maw.phase), null, { timeout: 900000, polling: 500 });
  assert.equal(await page.evaluate(() => __S.getObjectByName('MawOfTheAbyss_Dressing').userData.maw.phase), 'ready');
  const assetsBeforeU1 = new Set(log.assets);
  // Put Sîn just outside the dock, then on its trigger. The game loop owns
  // the delay, blackout, resource release, loading, spawn and fade-in.
  const atTop = await page.evaluate(async () => {
    const hero = __S.getObjectByName('SinHeroRoot'), room = __S.getObjectByName('MawOfTheAbyss_Dressing');
    const L = SinR3Maw.lift;
    const put = (x, y, z) => hero.position.copy(room.localToWorld(new THREE.Vector3(L.center[0] + x, y, L.center[1] + z)));
    put(-8, 0, 2.9);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    put(0, L.deck, 0);
    window.__heroBeforeLift = hero;
    return hero.position.y;
  });
  await page.waitForFunction(() => PalaceInterior.state() === 'R3_FAILED' ||
    (PalaceInterior.state() === 'R3' && PalaceInterior.activeSealedChapter() === 'u1'), null, { timeout: 900000, polling: 300 });
  mark('lift', await page.evaluate(top => {
    const hero = __S.getObjectByName('SinHeroRoot');
    return { state: PalaceInterior.state(), stage: PalaceInterior.activeSealedChapter(),
      roots: __S.children.map(o => o.name), memory: PalaceInterior.underworldMemory(),
      sameHero: hero === window.__heroBeforeLift, moved: +(hero.position.y - top).toFixed(2),
      arrivalCabin: !!__S.getObjectByName('Maw_Lift_Arrival'),
      veilGone: !document.getElementById('r3-lift-veil'),
      onFloor: Math.abs(PalaceInterior.floorAt(hero.position.x, hero.position.z, hero.position.y) - hero.position.y) < 0.05 };
  }, atTop));
  const underworldAsset = file => /^assets\/r3\/(?:harbor|underworld)\//.test(file);
  out.assets = { palaceR3OrU1: palaceAssets,
    r3U1: [...assetsBeforeU1].filter(underworldAsset),
    u1New: [...new Set(log.assets)].filter(a => !assetsBeforeU1.has(a)) };
  const { palace, r3, lift } = out.steps;
  out.checks = {
    palaceIsolated: palace.cityReleased && palace.memory.released?.cityReleased && palace.isolated && palace.backToCityBlocked && out.assets.palaceR3OrU1.length === 0,
    r3Isolated: r3.stage === 'r3' && r3.backToPalaceBlocked &&
      r3.roots.join(',') === 'SinHeroRoot,R3Stage' && r3.memory.released?.roots.join(',') === 'SinHeroRoot' && out.assets.r3U1.length === 0,
    u1Isolated: lift.stage === 'u1' && lift.roots.join(',') === 'SinHeroRoot,U1Stage' &&
      lift.memory.released?.roots.join(',') === 'SinHeroRoot' && out.assets.u1New.some(underworldAsset),
    liftArrived: lift.sameHero && Math.abs(lift.moved + 420) < 0.1 && lift.arrivalCabin && lift.veilGone && lift.onFloor
  };
  out.errors = log.errors;
  out.warnings = log.warnings;
  await ctx.close();
  return out;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  if (SCEN.includes('normal')) { report.results.normal = await normal(browser); save(); console.log('normal', JSON.stringify(report.results.normal).slice(0, 600)); }
  if (SCEN.includes('palace')) { report.results.palace = await story(browser, true); save(); }
  if (SCEN.includes('story')) { report.results.story = await story(browser); save(); }
  save();
  await browser.close();
  for (const name of ['palace', 'story']) {
    const result = report.results[name];
    if (!result) continue;
    assert.ok(Object.values(result.checks).every(Boolean), JSON.stringify(result.checks));
    assert.deepEqual(result.errors, []);
  }
})().catch(e => { console.error(e); save(); process.exit(1); });
