/* Headless measurement of the streaming system in real Chromium (SwiftShader).
   Not an iPhone: SwiftShader FPS is CPU rasterised. It is used only to prove the
   system runs, stays memory-stable, never drops a visible region, and that the
   ?streaming=0 kill switch reproduces the pre-existing behaviour. */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8099/index.html';
const ROOMS = ['K1', 'K2', 'K3', 'K4', 'K5', 'T1', 'T2', 'T3', 'T4', 'T5', 'L1', 'L2', 'L3', 'L4'];

const infoOf = `(window.PalaceWings.state.ctx && window.PalaceWings.state.ctx.renderer) ? window.PalaceWings.state.ctx.renderer.info : null`;

async function tour(page) {
  const steps = [];
  for (const id of ROOMS) {
    steps.push(await page.evaluate(async (room) => {
      const W = window.PalaceWings;
      if (!W) return { room, error: 'no PalaceWings' };
      try { W.teleport(room); } catch (e) { return { room, error: 'teleport:' + e.message }; }
      await new Promise(r => setTimeout(r, 500));
      const m = W.metrics();
      const st = window.SinWorldStreaming ? window.SinWorldStreaming.stats() : null;
      const info = (W.state.ctx && W.state.ctx.renderer) ? W.state.ctx.renderer.info : null;
      let vis = 0; W.state.regionGroups.forEach(g => { if (g.visible) vis++; });
      return {
        room,
        visibleRegions: Object.keys(m.visibleRegionTriangles || {}).length,
        visibleTriangles: m.visibleTriangles,
        totalTriangles: m.triangles,
        groupsVisible: vis,
        prepared: st ? st.prepared : null,
        calls: info ? info.render.calls : null,
        drawnTris: info ? info.render.triangles : null,
        geometries: info ? info.memory.geometries : null,
        textures: info ? info.memory.textures : null,
        lead: st ? st.lead : null,
        cacheAdded: st ? st.addedByCache : null,
        predAdded: st ? st.addedByPrediction : null,
        trimmed: st ? st.trimmedByBudget : null,
        budget: st && st.budget ? st.budget.level : null
      };
    }, id));
  }
  return steps;
}

(async () => {
  const report = { started: new Date().toISOString(), base: BASE, runs: [] };
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--no-sandbox', '--disable-gpu-sandbox', '--ignore-gpu-blocklist']
  });
  for (const mode of ['1', '0']) {
    const page = await browser.newPage({ viewport: { width: 880, height: 480 } });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e).slice(0, 180)));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 180)); });
    const t0 = Date.now();
    await page.goto(`${BASE}?startInHall=1&streaming=${mode}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    let built = false;
    try {
      await page.waitForFunction(() => window.PalaceWings && window.PalaceWings.state && window.PalaceWings.state.built, null, { timeout: 240000 });
      built = true;
    } catch (e) { /* recorded */ }
    const run = { streaming: mode === '1', built, buildMs: Date.now() - t0, errors: errs.slice(0, 4) };
    if (built) {
      run.hasApi = await page.evaluate(() => !!window.SinWorldStreaming);
      run.device = await page.evaluate(() => window.SinWorldStreaming ? window.SinWorldStreaming.stats().device : null);
      run.profile = await page.evaluate(() => window.SinWorldStreaming ? window.SinWorldStreaming.stats().profile : null);
      run.tour = await tour(page);
      run.frames = await page.evaluate(() => new Promise(res => {
        const d = []; let last = performance.now(); const t0 = last;
        (function f(t) {
          d.push(t - last); last = t;
          if (t - t0 < 3000) requestAnimationFrame(f);
          else {
            const s = d.slice(3).sort((a, b) => a - b);
            const sum = s.reduce((a, b) => a + b, 0);
            res({ n: s.length, avgMs: +(sum / s.length).toFixed(2), p50: +s[Math.floor(s.length * .5)].toFixed(2), p95: +s[Math.floor(s.length * .95)].toFixed(2), max: +s[s.length - 1].toFixed(2) });
          }
        })(last);
      }));
      run.returnTrip = await page.evaluate(async () => {
        const W = window.PalaceWings;
        const before = window.SinWorldStreaming ? window.SinWorldStreaming.stats().cache : null;
        const geoBefore = W.state.ctx.renderer.info.memory.geometries;
        W.teleport('K1');
        await new Promise(r => setTimeout(r, 700));
        const g = W.state.regionGroups.get('K1');
        const geoAfter = W.state.ctx.renderer.info.memory.geometries;
        return { k1Visible: !!(g && g.visible), geoBefore, geoAfter, cache: window.SinWorldStreaming ? window.SinWorldStreaming.stats().cache : null, before };
      });
      run.memory = await page.evaluate(() => {
        const r = window.PalaceWings.state.ctx.renderer.info;
        return { geometries: r.memory.geometries, textures: r.memory.textures, programs: (r.programs || []).length };
      });
    }
    report.runs.push(run);
    await page.close();
  }
  await browser.close();
  report.finished = new Date().toISOString();
  console.log('###JSON###' + JSON.stringify(report));
})().catch(e => { console.log('###JSON###' + JSON.stringify({ fatal: String(e).slice(0, 600) })); process.exit(0); });
