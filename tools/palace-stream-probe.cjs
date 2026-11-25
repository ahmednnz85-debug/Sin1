#!/usr/bin/env node
/* Palace streaming probe — the real game in Chromium on the iPhone path.

   The page gets an iPhone user agent (SinDevice takes the phone profile:
   650 MB process budget, 1024 px textures, 2 uploads / frame) and the
   process estimate uses the iOS formula (performance.memory is hidden, as
   Safari has none). For every room it then measures, frame by frame:

     approach   the hero is placed in the corridor / hall next to the room
                (inside the load radius); the room must become ready there,
                before the hero walks in — distance preloading
     enter      the hero steps into the room
     leave      the hero goes to the far end of the palace; the room must be
                unloaded (beyond its release radius)
     return     approach + enter again: it must be prepared again before the
                hero arrives, with no freeze when it appears

   Per phase: seconds until ready, frames where a streamed room is in the
   camera's sight through open arches but not ready (an "empty room in
   view"), frames inside an unready room, longest frame, frames > 100 ms,
   shader programs linked (and how many in the reveal frames), texture and
   buffer uploads, and the memory estimate.

   SwiftShader (software GL) is far slower than a phone GPU: absolute frame
   times are not phone numbers; what is compared is work per frame
   (program links / uploads in a frame) and the ordering of events.

   Usage:  node static-server.mjs &   (serves the repo on :8080)
           THREE_DIR=/path/to/node_modules/three node tools/palace-stream-probe.cjs \
             [--rooms L1,T1,...] [--viewport 426x197] [--out probe.json] [--query '&lightrig=off'] */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const ROOMS = (opt('rooms') || 'L1,L2,L3,L4,T1,T2,T3,T4,T5,K2,K3,K4,K5').split(',');
const OUT = opt('out');
const [VW, VH] = (opt('viewport') || '426x197').split('x').map(Number);
const QUERY = opt('query') || '';
const BASE = process.env.SIN1_URL || 'http://127.0.0.1:8080/index.html';
const THREE_DIR = process.env.THREE_DIR;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const FAR = { L: 'K4', T: 'L3', K: 'T5' };      // a room at the other end of the palace, per wing

const INSTRUMENT = `(() => {
  try { Object.defineProperty(Performance.prototype, 'memory', { get() { return undefined; }, configurable: true }); } catch (e) {}
  const F = window.__probe = { rows: [], mark: null };
  let cur = null; const reset = () => { cur = { link: 0, q: 0, qMs: 0, buf: 0, tex: 0, texMs: 0 }; }; reset();
  const p = WebGL2RenderingContext.prototype;
  const wrap = (fn, k, km) => { const o = p[fn]; p[fn] = function () { const t = performance.now(); const r = o.apply(this, arguments); cur[k]++; if (km) cur[km] += performance.now() - t; return r; }; };
  wrap('linkProgram', 'link'); wrap('getUniformLocation', 'q', 'qMs'); wrap('getProgramParameter', 'q', 'qMs');
  wrap('bufferData', 'buf'); wrap('texImage2D', 'tex', 'texMs'); wrap('texSubImage2D', 'tex', 'texMs'); wrap('compressedTexImage2D', 'tex', 'texMs'); wrap('texStorage2D', 'tex', 'texMs');
  let last = performance.now();
  function sight() {
    const W = window.PalaceWings, S = W && W.state, cam = window.__C;
    if (!S || !S.routes || !cam || !window.SinWingVisibility) return { holes: [], inside: null };
    const root = S.root.position, d = new THREE.Vector3(); cam.getWorldDirection(d);
    const len = Math.hypot(d.x, d.z) || 1, cp = cam.parent && !cam.parent.isScene ? cam.getWorldPosition(new THREE.Vector3()) : cam.position;
    const view = { x: cp.x - root.x, z: cp.z - root.z, dirX: d.x / len, dirZ: d.z / len, halfFov: Math.atan(Math.tan((cam.fov || 60) * Math.PI / 360) * (cam.aspect || 1)) };
    const reg = W.regionAt(view.x, view.z); const viewer = reg ? (reg.kind === 'threshold' && reg.linkRoom ? reg.linkRoom : reg.id) : 'Palace';
    const open = q => !(S.templeDoors && !S.templeDoors.allows(q.id)) && !(S.libraryDoors && !S.libraryDoors.allows(q.id)) && !(q._roomDoor && (!['Open', 'Opening', 'Closing'].includes(q.state) || (q.progress || 0) < .025));
    const seen = S.routes.connectedView(viewer, view, SinWingVisibility.throughOpenings, open);
    const z = W.zones().zones; const hero = W.current && W.current();
    const holes = [...seen].filter(id => z[id] && z[id].state !== 'ready');
    const inside = [viewer, hero].find(id => z[id] && z[id].state !== 'ready') || null;
    return { holes, inside };
  }
  (function raf(t) {
    let s = { holes: [], inside: null }, zs = null;
    try { s = sight(); const z = PalaceWings.zones(); zs = Object.fromEntries(Object.entries(z.zones).map(([k, v]) => [k, v.state[0]])); } catch (e) {}
    F.rows.push({ t: Math.round(t), gap: Math.round(t - last), link: cur.link, q: cur.q, qMs: Math.round(cur.qMs), buf: cur.buf, tex: cur.tex, texMs: Math.round(cur.texMs), holes: s.holes, inside: s.inside, zs,
      programs: window.__R ? __R.info.programs.length : 0 });
    reset(); last = t; if (F.rows.length > 20000) F.rows.splice(0, 5000); requestAnimationFrame(raf);
  })(performance.now());
})();`;

function summarize(rows) {
  const gaps = rows.map(r => r.gap).sort((a, b) => a - b);
  const holeIds = {}; rows.forEach(r => r.holes.forEach(h => { holeIds[h] = (holeIds[h] || 0) + 1; }));
  // reveal frames: a zone switched to ready (state letter r) between rows
  let revealLinks = 0, revealFrames = 0, maxRevealGap = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1].zs || {}, b = rows[i].zs || {};
    const revealed = Object.keys(b).filter(k => b[k] === 'r' && a[k] !== 'r');
    if (revealed.length) for (let j = i; j < Math.min(rows.length, i + 3); j++) { revealLinks += rows[j].link; revealFrames++; maxRevealGap = Math.max(maxRevealGap, rows[j].gap); }
  }
  return {
    frames: rows.length, maxGap: gaps[gaps.length - 1] || 0, p50: gaps[gaps.length >> 1] || 0, over100: gaps.filter(g => g > 100).length,
    holeFrames: rows.filter(r => r.holes.length).length, holeIds, insideUnready: rows.filter(r => r.inside).length,
    links: rows.reduce((s, r) => s + r.link, 0), maxLinksInFrame: Math.max(0, ...rows.map(r => r.link)), revealLinks, maxRevealGap,
    queries: rows.reduce((s, r) => s + r.q, 0), maxQueryMsInFrame: Math.max(0, ...rows.map(r => r.qMs)),
    texUploads: rows.reduce((s, r) => s + r.tex, 0), maxTexMsInFrame: Math.max(0, ...rows.map(r => r.texMs)), buffers: rows.reduce((s, r) => s + r.buf, 0),
    worst: rows.slice().sort((a, b) => b.gap - a.gap).slice(0, 3).map(r => ({ gap: r.gap, link: r.link, q: r.q, buf: r.buf, tex: r.tex, texMs: r.texMs,
      busy: Object.entries(r.zs || {}).filter(([k, v]) => v !== 'c' && v !== 'r').map(([k, v]) => k + ':' + v).join(' ') }))
  };
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => { const t = m.text(); if (/light-rig|entry rooms|pvs|waiting for memory|admitted|evict|stream start|ready \(|failed|timed out/i.test(t)) logs.push(Math.round(Date.now() / 1000) + ' ' + t.slice(0, 220)); });
  page.on('pageerror', e => logs.push('PAGEERROR ' + String(e).slice(0, 300)));
  if (THREE_DIR) await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.187\.0\/(.*)$/, r => r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace(/^.*three@0\.187\.0\//, '').split('?')[0]), contentType: 'text/javascript' }));
  await page.addInitScript(INSTRUMENT);
  const since = async t => page.evaluate(t0 => __probe.rows.filter(r => r.t >= t0), t);
  const nowMs = () => page.evaluate(() => performance.now());
  const zone = id => page.evaluate(id => { const z = PalaceWings.zones().zones[id]; return z ? z.state : 'none'; }, id);
  const mem = () => page.evaluate(() => { const m = SinProcessMemory.last() || {}; return { processMB: m.processMB, gpuTexMB: m.gpuTexMB, programs: m.programs }; });
  // Stops early when the room is waiting for memory (it cannot be prepared here).
  const waitReady = async (id, maxS, memoryWaitS) => { const t0 = Date.now(); for (;;) {
    const z = await page.evaluate(id => { const z = PalaceWings.zones().zones[id]; return z ? { state: z.state, deferred: !!z.deferred } : { state: 'none' }; }, id);
    const el = (Date.now() - t0) / 1000;
    if (z.state === 'ready' || z.state === 'failed' || el > maxS || (memoryWaitS && z.state === 'cold' && z.deferred && el > memoryWaitS))
      return { state: z.state, deferred: !!z.deferred, s: +el.toFixed(1) };
    await page.waitForTimeout(400); } };
  const tp = id => page.evaluate(id => PalaceWings.teleport(id), id);
  const approachOf = id => page.evaluate(id => {
    const S = PalaceWings.state, z = PalaceWings.zones().zones;
    const n = S.routes.neighbours(id).filter(r => !z[r]);
    return n.includes('Palace') ? 'Palace' : n[0] || 'Palace';
  }, id);

  const out = { started: new Date().toISOString(), viewport: [VW, VH], query: QUERY, rooms: {} };
  const T0 = Date.now();
  await page.goto(BASE + '?sin=probe&startInHall=1&royalDoorTest=1' + QUERY);
  await page.waitForFunction("window.PalaceInterior&&PalaceInterior.state&&(PalaceInterior.state()==='DONE'||PalaceInterior.state()==='FAILED')&&window.__holdSim===false", null, { timeout: 1800000, polling: 1000 });
  const tDone = await nowMs();
  await page.waitForTimeout(4000);
  out.entry = Object.assign({ seconds: (Date.now() - T0) / 1000, mem: await mem(), device: await page.evaluate(() => ({ constrained: PalaceWings.deviceProfile.constrained, budget: PalaceWings.deviceProfile.processBudgetMB })),
    zones: await page.evaluate(() => Object.fromEntries(Object.entries(PalaceWings.zones().zones).map(([k, v]) => [k, v.state]))) }, summarize(await since(tDone)));
  console.log('entry', JSON.stringify(out.entry));
  for (const id of ROOMS) {
    const R = out.rooms[id] = {};
    for (const pass of ['first', 'return']) {
      const near = await approachOf(id);
      let t = await nowMs(); await tp(near);
      const a = await waitReady(id, 150, 20);
      await page.waitForTimeout(1500);
      const approach = Object.assign({ at: near, readyBeforeEntering: a.state === 'ready', waitingForMemory: a.deferred, waitS: a.s, state: a.state }, summarize(await since(t)));
      t = await nowMs(); await tp(id);
      const e = await waitReady(id, 150);
      await page.waitForTimeout(2500);
      const enter = Object.assign({ waitS: e.s, state: e.state, mem: await mem() }, summarize(await since(t)));
      R[pass] = { approach, enter };
      if (pass === 'first') {
        const far = FAR[id[0]] || 'Palace';
        t = await nowMs(); await tp(far); await waitReady(far, 150); await page.waitForTimeout(4500);
        R.leave = Object.assign({ to: far, unloaded: (await zone(id)) === 'cold', mem: await mem() }, summarize(await since(t)));
      }
      console.log(id, pass, JSON.stringify({ approach: { at: near, ready: approach.readyBeforeEntering, memoryWait: approach.waitingForMemory, waitS: approach.waitS, holes: approach.holeFrames, maxGap: approach.maxGap, revealLinks: approach.revealLinks, maxRevealGap: approach.maxRevealGap },
        enter: { waitS: enter.waitS, inside: enter.insideUnready, holes: enter.holeFrames, maxGap: enter.maxGap, links: enter.links, revealLinks: enter.revealLinks, mem: enter.mem.processMB },
        leave: pass === 'first' ? { unloaded: R.leave.unloaded, mem: R.leave.mem.processMB } : undefined }));
      if (OUT) fs.writeFileSync(OUT, JSON.stringify(Object.assign(out, { logs: logs.slice(-300) }), null, 1));
    }
  }
  out.logs = logs.slice(-300);
  out.rig = await page.evaluate(() => window.SinLightRig && SinLightRig.report());
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('rig', JSON.stringify(out.rig));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
