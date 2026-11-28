#!/usr/bin/env node
/* Sîn VFX Laboratory checks in a real browser (Chromium; SwiftShader when no GPU).

   node static-server.mjs &
   THREE_DIR=/path/to/node_modules/three node tools/vfx/lab-check.cjs --out vfx-check \
     [--mode smoke|shots|video|perf|all] [--effects ID,ID] [--quality high|medium|low] [--size 960x540]

   smoke  page loads, engine ready, both characters and every effect definition load,
          every effect plays without errors, Guardian event measurement present
   shots  each effect stepped deterministically, captured from 3 angles at 3 moments
   video  deterministic frame capture → mp4 per effect group (ffmpeg), real clips + effects
   perf   repeat / concurrency / leak test: resources before and after, live counts
   Output: <out>/report.json, shots/*.jpg, video/*.mp4 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out', 'vfx-check');
const BASE = opt('url', 'http://127.0.0.1:8080/vfx-lab.html');
const MODE = opt('mode', 'smoke');
const QUALITY = opt('quality', 'high');
const [VW, VH] = opt('size', '960x540').split('x').map(Number);
const THREE_DIR = process.env.THREE_DIR;
fs.mkdirSync(OUT, { recursive: true });
const report = { base: BASE, quality: QUALITY, size: [VW, VH], started: new Date().toISOString(), results: {} };
const save = () => fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));

async function open(browser, extra = '') {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const log = { errors: [], console: [] };
  page.on('pageerror', e => log.errors.push(String(e).slice(0, 400)));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') log.console.push(m.type() + ': ' + m.text().slice(0, 300)); });
  if (THREE_DIR) await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.187\.0\/(.*)$/, r => r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace(/^.*three@0\.187\.0\//, '').split('?')[0]), contentType: 'text/javascript' }));
  const t0 = Date.now();
  await page.goto(BASE + '?auto=1&clean=1&quality=' + QUALITY + extra, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__vfxLab && (window.__vfxLab.ready || window.__vfxLab.error), null, { timeout: 240000 });
  const err = await page.evaluate(() => window.__vfxLab.error);
  if (err) throw new Error('lab error: ' + err);
  return { ctx, page, log, loadMs: Date.now() - t0 };
}
const shot = async (page, file) => {
  const data = await page.evaluate(() => window.__vfxLab.renderer.domElement.toDataURL('image/jpeg', 0.9));
  fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
};
const cam = (page, pos, tgt) => page.evaluate(([p, t]) => { const L = window.__vfxLab; L.camera.position.set(...p); L.controls.target.set(...t); L.controls.update(); }, [pos, tgt]);

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    if (MODE === 'smoke' || MODE === 'all') {
      const { ctx, page, log, loadMs } = await open(browser);
      const info = await page.evaluate(() => {
        const L = window.__vfxLab;
        return {
          tier: L.vfx.tier, pipeline: L.vfx.pipeline, effects: L.vfx.list().map(e => e.id), warmMs: Math.round(L.warmMs),
          sinClips: Object.keys(L.sin.clips), gdnClips: Object.keys(L.gdn.clips), gdnEventsSource: L.gdnEventsSource,
          guardianMeasured: Object.fromEntries(Object.entries(L.gdnEvents).filter(([k]) => /Slam|Overhead|Swing_Right|Seal/.test(k))),
          sinEvents: L.sinEvents, axeRails: L.sin.rails.info, programs: L.renderer.info.programs.length
        };
      });
      const results = {};
      for (const id of info.effects) {
        const r = await page.evaluate(id => {
          const L = window.__vfxLab; L.clear(); L.demo(id);
          let peak = { particles: 0, trails: 0, decals: 0, debris: 0, shockwaves: 0 };
          for (let i = 0; i < 240; i++) { L.advance(1 / 60, 1, i % 30 === 0); const s = L.vfx.stats(); for (const k in peak) peak[k] = Math.max(peak[k], s[k]); }
          return { peak, programs: L.renderer.info.programs.length };
        }, id);
        results[id] = r;
      }
      report.results.smoke = { loadMs, info, effects: results, errors: log.errors, console: log.console.slice(0, 40) };
      save(); await ctx.close();
      console.log('smoke', loadMs + 'ms', info.tier, info.effects.length, 'effects', log.errors.length, 'errors');
    }
    if (MODE === 'shots' || MODE === 'all') {
      const list = opt('effects', '').split(',').filter(Boolean);
      const { ctx, page, log } = await open(browser);
      const ids = list.length ? list : await page.evaluate(() => window.__vfxLab.vfx.list().map(e => e.id));
      fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
      const meta = {};
      for (const id of ids) {
        const m = await page.evaluate(id => { const L = window.__vfxLab; L.clear(); L.demo(id); const d = L.vfx.effects.get(id); return { kind: d.kind, impactAt: d.impactAt || 0, take: L.S.take && L.S.take.kind, clip: L.S.take && L.S.take.clip || null, ch: L.S.take && L.S.take.ch ? L.S.take.ch.id : null, charge: d.kind === 'charge' }; }, id);
        // moments: around the impact (effect time or clip impact)
        let times;
        if (m.take === 'clip') {
          const ev = await page.evaluate(([ch, clip]) => { const L = window.__vfxLab; const e = ch === 'sin' ? L.sinEvents[clip] : L.gdnEvents[clip]; return e; }, [m.ch, m.clip]);
          const imp = ev && (ev.contact ? ev.contact.t : ev.impact) || 0.5;
          const a0 = ev && ev.active ? ev.active.start : imp - 0.15;
          times = [Math.max(0.05, a0 + (imp - a0) * 0.6), imp + 0.05, imp + 0.45];
        } else if (m.charge) times = [0.5, 1.2, 2.0];
        else times = [Math.max(0.03, m.impactAt + 0.04), m.impactAt + 0.2, m.impactAt + 0.9];
        const angles = { side: null, front: null, low: null };
        let t = 0;
        for (let k = 0; k < times.length; k++) {
          const steps = Math.max(1, Math.round((times[k] - t) * 60));
          await page.evaluate(n => window.__vfxLab.advance(1 / 60, n, false), steps); t += steps / 60;
          for (const a of Object.keys(angles)) {
            await page.evaluate(([a, id, ch]) => {
              const L = window.__vfxLab;
              const V = L.THREE.Vector3;
              let tgt, d, fwd;
              if (ch === 'sin') { tgt = L.sin.root.position.clone(); tgt.y = 1.05; fwd = L.sin.root.getWorldDirection(new V()); d = 3.6; }
              else if (ch === 'guardian') { tgt = L.gdn.root.position.clone(); tgt.y = 2.1; fwd = L.gdn.root.getWorldDirection(new V()); d = 8.5; }
              else { tgt = L.S.focus.clone().addScaledVector(L.S.focusNormal, 0.45); fwd = new V(0, 0, -1); d = 3.4; }
              const [ang, hy] = { side: [1.3, 0.3], front: [0.35, 0.15], low: [-0.75, -0.6] }[a];
              const dir = fwd.clone().applyAxisAngle(new V(0, 1, 0), ang);
              L.camera.position.copy(tgt).addScaledVector(dir, d); L.camera.position.y = Math.max(0.3, tgt.y + hy * (ch === 'guardian' ? 2.5 : 1));
              L.controls.target.copy(tgt); L.controls.update(); L.render();
            }, [a, id, m.ch]);
            await shot(page, path.join(OUT, 'shots', `${id}__${k}_${a}.jpg`));
          }
        }
        meta[id] = Object.assign(m, { times });
        console.log('shots', id);
      }
      report.results.shots = { meta, errors: log.errors };
      save(); await ctx.close();
    }
    if (MODE === 'perf' || MODE === 'all') {
      const { ctx, page, log } = await open(browser);
      const r = await page.evaluate(async () => {
        const L = window.__vfxLab; const out = {};
        L.clear(); L.advance(1 / 60, 10);
        out.idle = L.stats();
        // concurrency: 8 effects at once + both characters fighting
        L.duel(); L.advance(1 / 60, 120, false);
        await L.stress(8);
        let peak = 0, calls = 0; const cpu = [];
        for (let i = 0; i < 180; i++) { const t0 = performance.now(); L.advance(1 / 60, 1, true); cpu.push(performance.now() - t0); const s = L.vfx.stats(); peak = Math.max(peak, s.particles); calls = Math.max(calls, s.calls); }
        cpu.sort((a, b) => a - b);
        out.concurrent = { peakParticles: peak, peakCalls: calls, frameCpuMs: { median: +cpu[90].toFixed(2), p95: +cpu[171].toFixed(2) } };
        // repeat / leak tests
        out.repeat = [];
        for (const id of ['GUARDIAN_STAFF_GROUND_SLAM', 'SIN_AXE_FINISHER', 'IMPACT_METAL_METAL', 'GUARDIAN_SPIRITUAL_BURST']) out.repeat.push(await L.repeatTest(id, 60));
        L.clear(); L.advance(1 / 60, 10);
        out.after = L.stats();
        return out;
      });
      report.results.perf = Object.assign(r, { errors: log.errors });
      save(); await ctx.close();
      console.log('perf', JSON.stringify(r.concurrent), 'idle geo/tex', r.idle.geometries, r.idle.textures, '→', r.after.geometries, r.after.textures);
    }
    if (MODE === 'eval') {
      // run an async function body from a file inside the lab: node lab-check.cjs --mode eval --script f.js
      const { ctx, page, log } = await open(browser);
      const body = fs.readFileSync(opt('script'), 'utf8');
      const r = await page.evaluate(body => (new Function('return (async () => {' + body + '})()'))(), body);
      console.log(JSON.stringify(r, null, 1));
      report.results.eval = { r, errors: log.errors };
      save(); await ctx.close();
    }
    if (MODE === 'video') {
      // groups: list of takes; each frame rendered deterministically at 30 fps simulation time
      const groups = JSON.parse(opt('groups', 'null')) || {
        'sin-axe': [['clip', 'sin', 'Attack_Right'], ['combo'], ['clip', 'sin', 'Finisher_Jump'], ['clip', 'sin', 'Finisher_Heavy', 0.35]],
        'guardian-staff': [['clip', 'guardian', 'Attack_Staff_Swing_Right'], ['clip', 'guardian', 'Attack_Staff_Overhead'], ['clip', 'guardian', 'Attack_Claw_Combo'], ['clip', 'guardian', 'Attack_Staff_Overhead', 0.3]],
        'guardian-slams': [['clip', 'guardian', 'Special_Ground_Slam'], ['clip', 'guardian', 'Special_Leap_Slam', 0.5]],
        'impacts': [['effect', 'SIN_AXE_METAL_IMPACT', 'armor'], ['effect', 'SIN_AXE_PARRY', 'staff'], ['effect', 'IMPACT_WEAPON_CLASH', 'staff'], ['effect', 'IMPACT_METAL_METAL', 'metal'], ['effect', 'GUARDIAN_STAFF_CROWN_IMPACT', 'stone'], ['effect', 'IMPACT_WEAPON_WALL', 'wall']],
        'seal-enraged': [['clip', 'guardian', 'Special_Seal_Activation'], ['clip', 'guardian', 'Phase_Transition'], ['clip', 'guardian', 'Enraged_Idle', 1, 3.0]],
        'bursts': [['effect', 'SIN_AXE_LUNAR_BURST', 'stone'], ['effect', 'GUARDIAN_SPIRITUAL_BURST', 'stone'], ['effect', 'GUARDIAN_GOLDEN_SHOCKWAVE', 'stone']],
        'weapons-motion': [['weapon', 'sin', 'Axe_CombatIdle', 1, 2.5], ['weapon', 'sin', 'walk_casual', 1, 3.0], ['weapon', 'sin', 'sprint_loop_quaternius', 1, 2.5], ['effect', 'SIN_AXE_CHARGE', 'stone'],
          ['weapon', 'guardian', 'Combat_Idle', 1, 3.0], ['weapon', 'guardian', 'Walk_Forward', 1, 3.0], ['clip', 'guardian', 'Attack_Staff_Swing_Right', 0.3], ['clip', 'sin', 'Attack_Left', 0.25]],
        'duel': [['duel']]
      };
      const only = opt('only', '');
      const { ctx, page, log } = await open(browser);
      fs.mkdirSync(path.join(OUT, 'video'), { recursive: true });
      const FPS = +opt('fps', 30);
      for (const [g, takes] of Object.entries(groups)) {
        if (only && !only.split(',').includes(g)) continue;
        const dir = path.join(OUT, 'frames-' + g); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
        let f = 0;
        for (const tk of takes) {
          const speed = (tk[0] === 'clip' || tk[0] === 'weapon') ? (tk[3] || 1) : 1;
          const len = await page.evaluate(tk => {
            const L = window.__vfxLab; L.clear();
            ['x', 'y', 'z', 'w', 'sigil'].forEach(k => { L.weaponBase('axe', k === 'sigil' ? 'x' : k, 0); L.weaponBase('staff', k, 0); });
            if (tk[0] === 'weapon') {        // the weapon energy layer on its own, standing and moving
              if (tk[1] === 'sin') L.weaponBase('axe', 'x', 0.9); else { L.weaponBase('staff', 'x', 0.8); L.weaponBase('staff', 'y', 0.8); L.weaponBase('staff', 'w', 0.7); L.weaponBase('staff', 'sigil', 1.2); }
              L.playClip(tk[1], tk[2], { loop: true }); return tk[4];
            }
            if (tk[0] === 'clip') { L.playClip(tk[1], tk[2], { loop: /Idle/.test(tk[2]) }); const c = (tk[1] === 'sin' ? L.sin : L.gdn).clips[tk[2]]; return tk[4] || c.duration + 1.6; }
            if (tk[0] === 'combo') { L.combo(); return 3.6; }
            if (tk[0] === 'duel') { L.duel(); return L.duelLength() + 0.5; }
            const pts = { armor: [[0, 1.2, 1.6], [0, 0, -1]], staff: [[0, 1.5, 1.6], [0, 0, -1]], metal: [[0, 1.0, 1.6], [0, 0, -1]], stone: [[0, 0, 1.6], [0, 1, 0]], wall: [[-3, 1.4, -8.04], [0, 0, 1]] }[tk[2]] || [[0, 0, 1.6], [0, 1, 0]];
            L.playEffect(tk[1], { at: pts[0], normal: pts[1], surface: tk[2] });
            const d = L.vfx.effects.get(tk[1]); return Math.min(4.5, d.duration + 1.4);
          }, tk);
          const n = Math.round(len * FPS / speed);
          for (let i = 0; i < n; i++) {
            await page.evaluate(([tk, i, n, dt]) => {
              const L = window.__vfxLab;
              L.advance(dt, 1, false);
              // slow orbit in front of the acting character (its own facing), framing the weapon and the floor
              const ch = (tk[0] === 'clip' || tk[0] === 'weapon') ? tk[1] : (tk[0] === 'combo' || tk[1] === 'SIN_AXE_CHARGE' ? 'sin' : null);
              const V = L.THREE.Vector3;
              let tgt, d, h, fwd, a0 = 0.75, a1 = 1.25;
              if (tk[0] === 'duel') { tgt = L.sin.root.position.clone().lerp(L.gdn.root.position, 0.45); tgt.y = 1.9; fwd = new V(1, 0, 0); d = 9.5; h = 0.9; a0 = -0.25; a1 = 0.25; }
              else if (ch === 'sin') { tgt = L.sin.root.position.clone(); tgt.y = 1.05; fwd = L.sin.root.getWorldDirection(new V()); d = 3.7; h = 0.25; }
              else if (ch === 'guardian') { tgt = L.gdn.root.position.clone(); tgt.y = 2.1; fwd = L.gdn.root.getWorldDirection(new V()); d = 9.0; h = 0.3; }
              else { tgt = L.S.focus.clone().addScaledVector(L.S.focusNormal, 0.45); fwd = L.S.focusNormal.y > 0.7 ? new V(0, 0, -1) : L.S.focusNormal.clone(); d = 3.6; h = L.S.focusNormal.y > 0.7 ? 0.9 : 0.3; }
              const ang = a0 + (a1 - a0) * (i / Math.max(1, n - 1));
              const dir = fwd.clone().applyAxisAngle(new V(0, 1, 0), ang);
              L.camera.position.copy(tgt).addScaledVector(dir, d); L.camera.position.y = tgt.y + h;
              L.controls.target.copy(tgt); L.controls.update(); L.render();
            }, [tk, i, n, 1 / FPS * speed]);
            await shot(page, path.join(dir, String(f++).padStart(5, '0') + '.jpg'));
          }
        }
        const mp4 = path.join(OUT, 'video', g + '.mp4');
        cp.execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%05d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', mp4]);
        fs.rmSync(dir, { recursive: true, force: true });
        console.log('video', g, f, 'frames →', mp4);
        (report.results.video = report.results.video || {})[g] = { frames: f, file: mp4 };
        save();
      }
      report.results.videoErrors = log.errors;
      save(); await ctx.close();
    }
  } finally {
    await browser.close();
    report.finished = new Date().toISOString(); save();
  }
})().catch(e => { console.error(e); report.fatal = String(e); save(); process.exit(1); });
