#!/usr/bin/env node
/* Developer hub checks in the real game (Chromium / SwiftShader).

   node static-server.mjs &
   THREE_DIR=/path/to/node_modules/three node tools/dev-hub-check.cjs --out hub-check \
     [--mode gate|play|disabled|direct|fly|cycle|storage|all] [--levels OUT-GATE,K3,R3-02] [--mobile 1] [--video 1] [--sampled-render 1]

   gate     entry screen before any world asset; developer list; phone + desktop shots
   play     "بدء اللعبة" → original boot reaches the original main menu
   disabled ENABLED=false (served copy) → no entry screen, original boot
   direct   ?dev=1&level=<id> for each level: ready time, hero pose, collision at
            the spawn, renderer memory; screenshot
   fly      real mouse, keyboard and phone touch controls, frozen player and camera restoration
   cycle    one palace session: every palace area in turn through the hub
            (in-place teleport), then back to the first: memory drift
   storage  real keys untouched by a dev session; dev keys carry the prefix
   Output: <out>/report.json and screenshots. */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const OUT = opt('out') || 'hub-check';
const BASE = opt('url') || 'http://127.0.0.1:8080/index.html';
const MODE = opt('mode') || 'all';
const MOBILE = opt('mobile') !== '0';
const VIDEO = opt('video') === '1';
const THREE_DIR = process.env.THREE_DIR;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const report = { base: BASE, results: {} };
const save = () => fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));

async function open(browser, { mobile = MOBILE, video = false, disable = false, init } = {}) {
  const ctx = await browser.newContext(mobile
    ? { viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: UA, ...(video ? { recordVideo: { dir: path.join(OUT, 'video'), size: { width: 852, height: 393 } } } : {}) }
    : { viewport: { width: 1280, height: 720 }, ...(video ? { recordVideo: { dir: path.join(OUT, 'video'), size: { width: 1280, height: 720 } } } : {}) });
  const page = await ctx.newPage();
  const log = { errors: [], requests: [], console: [], bytes: {} };
  page.on('pageerror', e => log.errors.push(String(e).slice(0, 300)));
  page.on('console', m => { const t = m.text(); if (/dev-hub|R3\]|error/i.test(t)) log.console.push(m.type() + ': ' + t.slice(0, 240)); });
  page.on('request', r => log.requests.push({ t: Date.now(), url: decodeURIComponent(r.url()).replace(/^https?:\/\/[^/]+\//, '') }));
  page.on('response', r => {
    const url = decodeURIComponent(r.url()).replace(/^https?:\/\/[^/]+\//, '').split('?')[0];
    if (/^(assets|data)\//.test(url)) log.bytes[url] = +(r.headers()['content-length'] || 0);
  });
  if (mobile) await page.addInitScript(() => { try { Object.defineProperty(Performance.prototype, 'memory', { get() { return undefined; }, configurable: true }); Object.defineProperty(Navigator.prototype, 'platform', { get() { return 'iPhone'; }, configurable: true }); } catch (e) {} });
  if (init) await page.addInitScript(init);
  if (THREE_DIR) await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.187\.0\/(.*)$/, r => r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace(/^.*three@0\.187\.0\//, '').split('?')[0]), contentType: 'text/javascript' }));
  if (disable) await page.route(/\/dev-hub\.js(\?.*)?$/, async r => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'dev-hub.js'), 'utf8').replace('const ENABLED = true;', 'const ENABLED = false;');
    r.fulfill({ body: src, contentType: 'text/javascript' });
  });
  return { ctx, page, log };
}
const glbs = log => log.requests.filter(r => /\.glb/.test(r.url)).length;
// Every asset file the page fetched, and the bytes delivered (what a stage entry costs).
const assetsOf = log => {
  const files = [...new Set(log.requests.map(r => r.url.split('?')[0]).filter(u => /^(assets|data)\//.test(u)))].sort();
  const bytes = Object.values(log.bytes).reduce((a, b) => a + b, 0);
  return { count: files.length, MiB: +(bytes / 1048576).toFixed(1), files };
};
async function snapshot(page) {
  return page.evaluate(() => {
    const g = window.SinDevHub?.game(), r = window.__R || g?.renderer, i = r && r.info, s = window.__sinDev;
    let hero = null, blocked = null, est = null;
    try {
      const h = g?.hero();
      hero = h && [+h.position.x.toFixed(2), +h.position.y.toFixed(2), +h.position.z.toFixed(2)];
      blocked = h ? g.blocked(h.position.x, h.position.z) : null;
      let sc = h; while (sc && sc.parent) sc = sc.parent;
      const e = window.SinProcessMemory && SinProcessMemory.estimate({ scene: sc, renderer: r, phase: 'dev', room: 'dev' });
      if (e) est = { cpuMB: e.cpuMB, gpuMB: e.gpuMB };
    } catch (e) { blocked = 'err ' + e.message; }
    return {
      level: s && s.area && s.area.id, ready: !!(s && s.ready), ms: s && s.ms, error: s && s.error || null,
      phase: window.PalaceInterior && PalaceInterior.state ? PalaceInterior.state() : null,
      hero, blockedAtHero: blocked, geometries: i && i.memory.geometries, textures: i && i.memory.textures,
      calls: i && i.render.calls, triangles: i && i.render.triangles, est, url: location.search
    };
  });
}

async function gate(browser) {
  const res = {};
  for (const mobile of [true, false]) {
    const { ctx, page, log } = await open(browser, { mobile });
    await page.goto(BASE);
    await page.waitForSelector('#sin-dev-gate .choice', { timeout: 120000 });
    await page.waitForTimeout(1500);
    const tag = mobile ? 'phone' : 'desktop';
    await page.screenshot({ path: path.join(OUT, `gate-${tag}.png`) });
    const before = glbs(log);
    await page.click('#sin-dev-gate [data-act="dev"]');
    await page.waitForSelector('#sin-dev-list .area');
    await page.screenshot({ path: path.join(OUT, `list-${tag}.png`) });
    const info = await page.evaluate(() => ({ areas: document.querySelectorAll('#sin-dev-list .area').length, groups: document.querySelectorAll('#sin-dev-list details').length,
      overflowX: document.documentElement.scrollWidth > innerWidth + 1 }));
    info.registry = await page.evaluate(async () => (await SinAreas.list()).length);
    await page.fill('#sin-dev-list input', 'R3');
    const filtered = await page.evaluate(() => [...document.querySelectorAll('#sin-dev-list .area')].filter(b => b.style.display !== 'none').length);
    res[tag] = { glbRequestsBeforeChoice: before, ...info, searchR3: filtered, errors: log.errors };
    await ctx.close();
  }
  return res;
}
async function play(browser, disable) {
  const { ctx, page, log } = await open(browser, { disable });
  const t0 = Date.now();
  await page.goto(BASE);
  let gateShown = false;
  if (!disable) {
    await page.waitForSelector('#sin-dev-gate .choice', { timeout: 120000 });
    gateShown = true;
    await page.click('#sin-dev-gate [data-act="play"]');
  }
  await page.waitForFunction("document.getElementById('main-menu') && getComputedStyle(document.getElementById('main-menu')).display !== 'none'", null, { timeout: 1200000, polling: 1000 });
  const menuSeconds = (Date.now() - t0) / 1000;
  const state = await page.evaluate(() => ({ gate: !!document.getElementById('sin-dev-gate'), tool: !!document.getElementById('sin-dev-tool'), devSession: window.SinDevHub ? SinDevHub.devSession : null, hub: !!window.SinDevHub, enabled: window.SinDevHub ? SinDevHub.enabled : null, storagePatched: !!Storage.prototype.__sinDevIsolated }));
  // Busy software-GL frames make Playwright's actionability wait time out.
  await page.evaluate(() => document.getElementById('go').click());
  await page.waitForTimeout(4000);
  const after = await snapshot(page);
  await page.screenshot({ path: path.join(OUT, (disable ? 'disabled' : 'play') + '-started.png') });
  await ctx.close();
  return { gateShown, menuSeconds, ...state, afterStart: after, errors: log.errors };
}
async function direct(browser, levels) {
  const out = {};
  const sampled = opt('sampled-render') === '1';
  for (const id of levels) {
    const init = sampled ? () => {
      let renderer;
      Object.defineProperty(window, '__R', { configurable: true, get: () => renderer, set(value) {
        if (renderer === value) return;
        renderer = value;
        queueMicrotask(() => {
          const render = value.render.bind(value);
          let drew = false;
          value.render = (scene, camera) => {
            if (!scene.isScene || !scene.getObjectByName('SinHeroRoot') || value.getRenderTarget()) return render(scene, camera);
            if (window.__sinCaptureSample || !drew) {
              drew = true;
              window.__sinCaptureSample = false;
              render(scene, camera);
              if (window.__sinDev?.ready) window.__sinSample = value.domElement.toDataURL('image/jpeg', .9);
            }
          };
        });
      }});
    } : undefined;
    const { ctx, page, log } = await open(browser, { init });
    const t0 = Date.now();
    await page.goto(BASE + '?dev=1&level=' + encodeURIComponent(id));
    try {
      await page.waitForFunction("window.__sinDev && (window.__sinDev.ready || window.__sinDev.error)", null, { timeout: 1500000, polling: 1000 });
      await page.waitForTimeout(3000);
      if (await page.evaluate(() => !!window.__sinDev?.sandbox)) {
        const shot = await page.screenshot({ path: path.join(OUT, `level-${id}.png`), timeout: 90000 }).then(() => true, () => false);
        out[id] = { wallSeconds: (Date.now() - t0) / 1000, ...(await snapshot(page)), sandbox: true,
          glbRequests: glbs(log), assets: assetsOf(log), errors: log.errors, screenshot: shot };
        console.log(id, JSON.stringify(out[id]).slice(0,400));
        report.results.direct = out;
        save();
        await ctx.close();
        continue;
      }
      // Walk a second forward with the controller: movement, camera, collisions.
      if(sampled){
        await page.evaluate(() => { window.__sinCaptureSample = true; });
        await page.waitForFunction(() => window.__sinSample, null, { timeout: 120000, polling: 400 });
      }
      const a = await snapshot(page);
      // Hold W for 40 rendered frames (game time is capped at 50 ms per frame,
      // so software rendering plays slower than real time).
      await page.keyboard.down('KeyW');
      await page.evaluate(() => new Promise(r => { let k = 0; (function f() { if (++k >= 40) r(); else requestAnimationFrame(f); })(); }));
      await page.keyboard.up('KeyW');
      await page.waitForTimeout(800);
      const b = await snapshot(page);
      // Software-GL frames can outlast Playwright's screenshot wait: keep the measurements.
      let shot;
      if (sampled) {
        const jpg = await page.evaluate(() => window.__sinSample.split(',')[1]);
        fs.writeFileSync(path.join(OUT, `level-${id}.jpg`), Buffer.from(jpg, 'base64'));
        shot = true;
      } else {
        shot = await page.screenshot({ path: path.join(OUT, `level-${id}.png`), timeout: 90000 }).then(() => true, () => false);
      }
      const moved = a.hero && b.hero ? +Math.hypot(b.hero[0] - a.hero[0], b.hero[2] - a.hero[2]).toFixed(2) : null;
      out[id] = { wallSeconds: (Date.now() - t0) / 1000, ...a, movedAfterWalk: moved, heroAfterWalk: b.hero, blockedAfterWalk: b.blockedAtHero, glbRequests: glbs(log), assets: assetsOf(log), screenshot: shot, errors: log.errors, console: log.console.slice(-4) };
    } catch (e) {
      out[id] = { failed: String(e).slice(0, 200), snap: await snapshot(page).catch(() => null), assets: assetsOf(log), errors: log.errors, console: log.console.slice(-6) };
    }
    console.log(id, JSON.stringify(out[id]).slice(0, 400));
    report.results.direct = out; save();
    await ctx.close();
  }
  return out;
}
async function fly(browser, id) {
  const results = {};
  for (const mobile of [false, true]) {
    const { ctx, page, log } = await open(browser, { mobile });
    const name = mobile ? 'phone-touch' : 'desktop';
    const url = BASE + '?dev=1&level=' + encodeURIComponent(id);
    await page.goto(url);
    await page.waitForFunction(() => window.__sinDev?.ready || window.__sinDev?.error, null, { timeout: 900000, polling: 500 });
    await page.evaluate(() => {
      if (!__sinDev.ready) throw new Error(__sinDev.error);
      const game = SinDevHub.game(), renderer = game.renderer, render = renderer.render;
      const pose = c => [...c.position.toArray(), ...c.quaternion.toArray(), c.fov, c.near, c.far, ...game.yaws()];
      const hero = () => [...game.hero().position.toArray(), ...game.hero().quaternion.toArray()];
      const probe = window.__flightQA = { samples: 0, saved: null, returned: null, drawNext: false, pose, hero };
      // Keep the real renderer for captured frames. Skipping redundant software
      // draws keeps input timings meaningful without skipping any game ticks.
      renderer.render = function (scene, camera) {
        if (scene === game.scene) {
          if (camera !== game.camera) {
            probe.samples++;
            probe.saved ||= { camera: pose(game.camera), hero: hero() };
            probe.camera = camera;
          } else if (probe.saved && !probe.returned) {
            probe.returned = { camera: pose(camera), hero: hero() };
          }
          if (!probe.drawNext) return;
          probe.drawNext = false;
        }
        const result = render.call(this, scene, camera);
        if (scene === game.scene && camera !== game.camera) probe.image = renderer.domElement.toDataURL('image/jpeg', 0.9).split(',')[1];
        return result;
      };
    });
    const take = () => page.evaluate(() => {
      const p = window.__flightQA, c = p.camera;
      return { pose: p.pose(c), heroStill: JSON.stringify(p.saved.hero) === JSON.stringify(p.hero()),
        gameplayStill: JSON.stringify(p.saved.camera) === JSON.stringify(p.pose(SinDevHub.game().camera)),
        blocked: SinDevHub.game().blocked(c.position.x, c.position.z) };
    });
    const frames = n => page.evaluate(n => new Promise(resolve => {
      const step = () => { if (--n > 0) requestAnimationFrame(step); else resolve(); };
      requestAnimationFrame(step);
    }), n);
    const collapse = '#sin-dev-fly [data-fly=';
    const speed = page.locator('#sin-dev-fly input');
    const button = (key) => page.locator(collapse + key + ']');
    const dev = page.locator('#sin-dev-tool > button');
    const launch = page.locator('#sin-dev-panel [data-t=fly]');
    if (mobile) { await dev.tap(); await launch.tap(); } else { await dev.click(); await launch.click(); }
    await page.waitForFunction(() => window.__flightQA.samples > 2);
    const start = await take();
    await page.evaluate(() => { window.__flightQA.drawNext = true; });
    await page.waitForFunction(() => window.__flightQA.image, null, { timeout: 120000, polling: 250 });
    const image = await page.evaluate(() => window.__flightQA.image);
    fs.writeFileSync(path.join(OUT, 'flight-' + name + '.jpg'), Buffer.from(image, 'base64'));
    await speed.fill('0');
    assert.match(await page.locator('#sin-dev-fly output').innerText(), /0\.4/);
    await speed.fill('100');
    assert.match(await page.locator('#sin-dev-fly output').innerText(), /80\.0/);
    let left, look, up, down;
    if (mobile) {
      const session = await ctx.newCDPSession(page);
      const send = (type, touchPoints) => session.send('Input.dispatchTouchEvent', { type, touchPoints });
      const center = async locator => {
        const b = await locator.boundingBox();
        return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
      };
      const stick = await center(page.locator('#sin-dev-fly .fly-stick'));
      const point = { x: stick.x, y: stick.y - 30, id: 1 };
      await send('touchStart', [{ ...stick, id: 1 }]);
      await send('touchMove', [point]);
      await frames(34);
      left = await take();
      await send('touchEnd', []);
      await frames(10);
      const vertical = async key => {
        await send('touchStart', [{ ...(await center(button(key))), id: 1 }]);
        await frames(22);
        const at = await take();
        await send('touchEnd', []);
        await frames(10);
        return at;
      };
      up = await vertical('up');
      down = await vertical('down');
      const from = { x: 220, y: 140, id: 1 };
      await send('touchStart', [from]);
      await send('touchMove', [{ x: 440, y: 240, id: 1 }]);
      await send('touchEnd', []);
      await frames(18);
      look = await take();
      await button('hide').tap();
      await button('exit').waitFor({ state: 'hidden', timeout: 2500 });
      await button('reveal').tap();
      await button('exit').waitFor({ state: 'visible', timeout: 2500 });
    } else {
      const move = async (key, count) => {
        await page.keyboard.down(key);
        await frames(count);
        const at = await take();
        await page.keyboard.up(key);
        await frames(12);
        return at;
      };
      left = await move('KeyW', 34);
      up = await move('KeyE', 22);
      down = await move('KeyQ', 22);
      await page.mouse.move(190, 360);
      await page.mouse.down();
      await page.mouse.move(1100, 520, { steps: 8 });
      await page.mouse.up();
      await frames(18);
      look = await take();
      await page.keyboard.press('KeyH');
      assert.equal(await button('exit').isVisible(), false);
      await page.keyboard.press('KeyH');
      assert.equal(await button('exit').isVisible(), true);
    }
    const travel = Math.hypot(left.pose[0] - start.pose[0], left.pose[2] - start.pose[2]);
    const angular = 2 * Math.acos(Math.min(1, Math.abs(start.pose.slice(3, 7).reduce((n, v, i) => n + v * look.pose[3 + i], 0))));
    assert.ok(travel > 15, 'fly distance ' + travel);
    assert.ok(up.pose[1] - left.pose[1] > 5 && up.pose[1] - down.pose[1] > 5, 'vertical flight');
    assert.ok(angular > 0.7, 'camera rotation ' + angular);
    assert.ok([start, left, up, down, look].every(p => p.heroStill && p.gameplayStill), 'player and camera stayed untouched');
    assert.ok(left.blocked || up.blocked || down.blocked, 'flight reached outside a walkable surface');
    if (mobile) await button('exit').tap();
    else {
      await page.keyboard.down('KeyW');
      await page.keyboard.press('Escape');
      await page.keyboard.down('KeyW');
      await page.keyboard.up('KeyW');
    }
    const restored = await page.evaluate(() => {
      const p = window.__flightQA;
      return { exact: JSON.stringify(p.saved) === JSON.stringify(p.returned),
        simulationResumed: !window.__holdSim, roots: SinDevHub.game().scene.children.map(o => o.name), frames: p.samples };
    });
    assert.ok(restored.exact && restored.simulationResumed, JSON.stringify(restored));
    assert.deepEqual(log.errors, []);
    results[name] = { url, travel: +travel.toFixed(2), rotationRadians: +angular.toFixed(2), ...restored, errors: log.errors };
    report.results.fly = results; save();
    await ctx.close();
  }
  return results;
}

async function cycle(browser, ids, rounds = 2) {
  const { ctx, page, log } = await open(browser, { video: VIDEO });
  await page.goto(BASE + '?dev=1&level=' + ids[0]);
  await page.waitForFunction("window.__sinDev && (window.__sinDev.ready || window.__sinDev.error)", null, { timeout: 1500000, polling: 1000 });
  await page.waitForTimeout(2000);
  const samples = [{ id: ids[0], ...(await snapshot(page)) }];
  for (let r = 0; r < rounds; r++) for (const id of ids.slice(1).concat(ids[0])) {
    const t0 = Date.now();
    await page.evaluate(id => SinDevHub.go(id), id);
    await page.waitForFunction(id => { const s = window.__sinDev; return s.area.id === id && window.PalaceWings && (() => { const z = PalaceWings.zones && PalaceWings.zones().zones[id]; return !z || z.state === 'ready' || z.state === 'resident'; })(); }, id, { timeout: 600000, polling: 500 }).catch(() => {});
    await page.waitForTimeout(1500);
    const s = { id, round: r, seconds: (Date.now() - t0) / 1000, ...(await snapshot(page)) };
    samples.push(s); console.log('cycle', JSON.stringify(s).slice(0, 260));
    report.results.cycle = { samples }; save();
    if (r === 0) await page.screenshot({ path: path.join(OUT, `cycle-${id}.png`) });
  }
  await ctx.close();
  return { samples, errors: log.errors };
}
async function storage(browser) {
  const { ctx, page, log } = await open(browser, { init: () => { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('sin.realProbe', 'player'); sessionStorage.setItem('__seeded', '1'); } } });
  await page.goto(BASE);
  await page.waitForSelector('#sin-dev-gate .choice', { timeout: 120000 });
  const realBefore = await page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
  await page.goto(BASE + '?dev=1&level=OUT-GATE');
  await page.waitForFunction("window.__sinDev && (window.__sinDev.ready || window.__sinDev.error)", null, { timeout: 1500000, polling: 1000 });
  const inDev = await page.evaluate(() => {
    localStorage.setItem('sin.realProbe', 'dev-write');                 // a game write in a dev session
    return { seen: localStorage.getItem('sin.realProbe'), patched: !!Storage.prototype.__sinDevIsolated };
  });
  await page.goto(BASE);
  await page.waitForSelector('#sin-dev-gate .choice', { timeout: 120000 });
  const realAfter = await page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
  await ctx.close();
  const changed = Object.keys(realBefore).filter(k => realBefore[k] !== realAfter[k]);
  const devKeys = Object.keys(realAfter).filter(k => k.startsWith('sin-dev:'));
  return { probeBefore: realBefore['sin.realProbe'], probeAfter: realAfter['sin.realProbe'], devView: inDev, realKeysChanged: changed, devKeys, errors: log.errors };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const want = m => MODE === 'all' || MODE.split(',').includes(m);
  if (want('gate')) { report.results.gate = await gate(browser); save(); console.log('gate', JSON.stringify(report.results.gate)); }
  if (want('storage')) { report.results.storage = await storage(browser); save(); console.log('storage', JSON.stringify(report.results.storage)); }
  if (want('play')) { report.results.play = await play(browser, false); save(); console.log('play', JSON.stringify(report.results.play).slice(0, 600)); }
  if (want('disabled')) { report.results.disabled = await play(browser, true); save(); console.log('disabled', JSON.stringify(report.results.disabled).slice(0, 600)); }
  if (want('direct')) await direct(browser, (opt('levels') || 'OUT-START,OUT-GATE,OUT-MARKET,OUT-PLAZA,OUT-PALACE,HALL,K3,L1,T3,R3-01,R3-02,R3-03').split(','));
  if (MODE.split(',').includes('fly')) { report.results.fly = await fly(browser, opt('levels')?.split(',')[0] || 'U1-01'); save(); console.log('fly', JSON.stringify(report.results.fly)); }
  if (want('cycle')) { report.results.cycle = await cycle(browser, (opt('cycle') || 'HALL,K1,K2,K3,K4,K5,L1,L2,L3,L4,T1,T2,T3,T4,T5').split(','), +(opt('rounds') || 2)); save(); }
  save();
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
