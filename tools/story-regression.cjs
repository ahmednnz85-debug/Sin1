#!/usr/bin/env node
/* Original-play regression, with the Developer Hub REMOVED from the page.
   node static-server.mjs &
   NODE_PATH=… THREE_DIR=… node tools/story-regression.cjs --out dir [--url index] [--scenario normal,story] [--hub keep]

   The page is served without the dev-hub.js <script> tag and dev-hub.js
   answers 404, exactly as after the hub's removal (DEVELOPER_GUIDE.md).
   normal  plain link: loading screen -> main menu -> NEW GAME (story start).
           Records every asset fetched, the boot flags, hero and stage state.
   story   the repository's story test path (startInHall + royalDoorTest +
           r3DoorTest, AGENTS.md rule 3): the real royal door transition into
           the palace (point of no return), the sealed R3 door, the one-way
           passage-L0 transition into R3, then the Maw lift down to U1 and
           back up — all through the game loop.
   Output: <out>/report.json. */
'use strict';
const fs = require('fs'), path = require('path');
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
  const log = { errors: [], assets: [] };
  page.on('pageerror', e => log.errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error') log.errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('request', r => {
    const u = decodeURIComponent(r.url()).replace(/^https?:\/\/[^/]+\//, '').split('?')[0];
    if (/^(assets|data)\//.test(u)) log.assets.push(u);
  });
  await page.addInitScript(() => {
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
  return { menuSeconds, ...state, assetsAtMenu: atMenu.sort(), assetCount: atMenu.length, errors: log.errors };
}

async function story(browser) {
  const { ctx, page, log } = await open(browser);
  const out = { steps: {} };
  const t0 = Date.now();
  const mark = (k, v) => { out.steps[k] = { t: (Date.now() - t0) / 1000, ...v }; console.log('story', k, JSON.stringify(out.steps[k]).slice(0, 300)); };
  await page.goto(BASE + '?startInHall=1&royalDoorTest=1&r3DoorTest=1');
  // 1. Royal door -> palace (the game's own door test path and palace loader).
  await page.waitForFunction(() => window.PalaceInterior && ['DONE', 'FAILED'].includes(PalaceInterior.state()) && window.__holdSim === false, null, { timeout: 1500000, polling: 1000 });
  await grab(page); await frames(page, 3);
  mark('palace', await page.evaluate(() => ({ state: PalaceInterior.state(), cityReleased: !!window.__sinCityReleased,
    floorY: PalaceInterior.floorY(), front: PalaceInterior.metrics().front, x: PalaceInterior.metrics().x })));
  const assetsBeforeR3 = new Set(log.assets);
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
    const hero = __S.getObjectByName('SinHeroRoot'), mem = PalaceInterior.r3Memory();
    // One way: the palace is retired and the cap stands behind Sîn.
    const back = PalaceInterior.blocks(hero.position.x + 2.6, hero.position.z);
    return { state: PalaceInterior.state(), roots: __S.children.map(o => o.name), palaceGone: !__S.getObjectByName('PalaceInterior'),
      backToPalaceBlocked: back, cityReleased: !!mem.loaded?.cityReleased, loaded: mem.loaded && { cpuMB: mem.loaded.cpuMB, gpuMB: mem.loaded.gpuMB } };
  }));
  out.assetsLoadedForR3 = [...new Set(log.assets)].filter(a => !assetsBeforeR3.has(a)).length;
  // 3. The Maw lift: down to U1 and back up, through the game loop.
  await page.waitForFunction(() => __S.getObjectByName('MawOfTheAbyss_Dressing')?.userData.maw.phase === 'ready', null, { timeout: 900000, polling: 1000 });
  const ride = await page.evaluate(async () => {
    const hero = __S.getObjectByName('SinHeroRoot'), room = __S.getObjectByName('MawOfTheAbyss_Dressing');
    const deep = __S.getObjectByName('U1_Underworld'), L = SinR3Maw.lift;
    const at = (x, y, z) => room.localToWorld(new THREE.Vector3(L.center[0] + x, y, L.center[1] + z));
    const frames = n => new Promise(r => { let k = 0; (function f() { if (++k > n) r(); else requestAnimationFrame(f); })(); });
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const R = window.__R, render = R.render; R.render = () => {};
    const legs = [];
    for (const [dy, label] of [[0, 'down'], [L.drop, 'up']]) {
      hero.position.copy(at(-8, dy, 2.9)); await frames(5);
      hero.position.copy(at(0, dy + L.deck + 0.01, 0)); await frames(2);
      const y0 = hero.position.y, t0 = performance.now();
      while (performance.now() - t0 < 8000) { await wait(100); if (Math.abs(hero.position.y - y0) > 400 && !document.getElementById('r3-lift-veil')) break; }
      legs.push({ label, moved: +(hero.position.y - y0).toFixed(2), underworld: deep.visible, maw: room.visible,
        veilGone: !document.getElementById('r3-lift-veil') });
    }
    R.render = render;
    return legs;
  });
  mark('lift', { legs: ride });
  out.errors = log.errors;
  await ctx.close();
  return out;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  if (SCEN.includes('normal')) { report.results.normal = await normal(browser); save(); console.log('normal', JSON.stringify(report.results.normal).slice(0, 600)); }
  if (SCEN.includes('story')) { report.results.story = await story(browser); save(); }
  save();
  await browser.close();
})().catch(e => { console.error(e); save(); process.exit(1); });
