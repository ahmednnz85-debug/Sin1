#!/usr/bin/env node
/* In-game screenshots of the throne hall and every palace room, iPhone profile
   (iPhone user agent, 852x393 landscape, device pixel ratio 2).

   For each room the hero is placed at the room's entrance (PalaceWings.teleport,
   the same pose the debug teleport uses), the shot waits until the room is
   prepared and revealed, lets a few frames render, then captures the page.

   Usage:  node static-server.mjs &
           THREE_DIR=/path/to/node_modules/three node tools/palace-room-shots.cjs --out shots/ \
             [--url http://127.0.0.1:8080/index.html] [--rooms Palace,K1,...] [--query '&lightrig=off']
   A second run against another build (e.g. tools/serve-git-ref.cjs serving main)
   gives a before/after pair; tools/compare-shots.py reports the difference. */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const OUT = opt('out') || 'shots';
const URL = opt('url') || 'http://127.0.0.1:8080/index.html';
const ROOMS = (opt('rooms') || 'Palace,K1,K2,K3,K4,K5,T1,T2,T3,T4,T5,L1,L2,L3,L4').split(',');
const QUERY = opt('query') || '';
const THREE_DIR = process.env.THREE_DIR;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  // iPhone: Safari has no performance.memory and reports navigator.platform 'iPhone'.
  await page.addInitScript(() => { try { Object.defineProperty(Performance.prototype, 'memory', { get() { return undefined; }, configurable: true }); Object.defineProperty(Navigator.prototype, 'platform', { get() { return 'iPhone'; }, configurable: true }); } catch (e) {} });
  if (THREE_DIR) await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.187\.0\/(.*)$/, r => r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace(/^.*three@0\.187\.0\//, '').split('?')[0]), contentType: 'text/javascript' }));
  await page.goto(URL + '?sin=probe&startInHall=1&royalDoorTest=1' + QUERY);
  await page.waitForFunction("window.PalaceInterior&&PalaceInterior.state&&(PalaceInterior.state()==='DONE'||PalaceInterior.state()==='FAILED')&&window.__holdSim===false", null, { timeout: 1800000, polling: 1000 });
  const frames = n => page.evaluate(n => new Promise(r => { let k = 0; (function f() { if (++k >= n) r(); else requestAnimationFrame(f); })(); }), n);
  const report = [];
  for (const id of ROOMS) {
    const t0 = Date.now();
    await page.evaluate(id => PalaceWings.teleport(id), id);
    let state = 'n/a';
    for (let i = 0; i < 600; i++) {
      state = await page.evaluate(id => { const z = PalaceWings.zones().zones[id]; return z ? z.state : 'resident'; }, id);
      if (state === 'ready' || state === 'resident' || state === 'failed') break;
      await page.waitForTimeout(500);
    }
    await frames(4);
    await page.waitForTimeout(1500);
    await frames(2);
    const file = path.join(OUT, (id === 'Palace' ? '00-throne-hall' : id) + '.png');
    await page.screenshot({ path: file });
    const row = { id, state, seconds: +((Date.now() - t0) / 1000).toFixed(1), file };
    report.push(row);
    console.log(JSON.stringify(row));
  }
  fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify({ url: URL, query: QUERY, rooms: report, errors }, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
