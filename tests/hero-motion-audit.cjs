// Quantitative motion audit of the hero in the isolated lab (fixed camera, deterministic steps).
// Measures what the eye calls "sliding": planted-foot drift in world space, travel after the stick is
// released, time to rest, root speed vs clip playback rate, turn arcs, combat displacement, FPS dependence.
//
//   node static-server.mjs &   THREE_DIR=/path/to/node_modules/three node tests/hero-motion-audit.cjs [--json out.json] [--strict]
//
// --strict turns the acceptance limits below into a failing exit code (regression gate).
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const URL = process.env.SIN1_LAB || 'http://127.0.0.1:8080/tests/hero-lab.html?manual=1&nodummy=1';
const THREE_DIR = process.env.THREE_DIR;
const args = process.argv.slice(2);
const outJson = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const strict = args.includes('--strict');

const LIMITS = {
  plantedSlideWalk: 0.20,   // m/s of the weight-bearing point while walking (raw walk_casual itself: ~0.15)
  plantedSlideRun: 1.50,    // m/s while running: the sprint clip played at its own rate grazes the floor with the swing
                            // heel one frame per stride (~1.4 at 60 Hz); the stance itself holds within 0.2 m/s
  stopTravelWalk: 0.30,     // metres the root travels after releasing the stick from a walk
  stopTravelRun: 1.40,      // ... from a run (9.4 m/s run -> walk -> stand, feet locked)
  stopTime: 0.45,           // seconds until the root is fully at rest (walk)
  stopTimeRun: 0.55,        // ... from a run
  stopSlide: 0.40,          // m/s mean drift of the weight-bearing point while stopping
  restDrift: 0.0005,        // metres the root moves once at rest (must be ~0)
  rateWalk: [0.98, 1.02],   // clip playback rate (natural = 1)
  rateRun: [0.98, 1.02],
  fpsSpread: 0.03,          // relative spread of distance travelled at 30/60/120 FPS
  attackDrift: 0.05,        // metres the root moves during an attack started from a run (in-place clips)
  turnSlideWalk: 0.30,      // m/s contact slide during 45/90/180 deg turns while walking
  turnSlideRun: 1.60,       // ... while running (same floor as straight running)
  footSpike: 6.0            // m/s: no contact point may jump (pin re-entry, teleport) during the dodge
};

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if (THREE_DIR) await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.187\.0\/(.*)$/, r => r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace(/^.*three@0\.187\.0\//, '').split('?')[0]), contentType: 'text/javascript' }));
  await page.goto(URL);
  await page.waitForFunction('window.__lab && window.__lab.ready', null, { timeout: 180000 });
  const R = await page.evaluate(() => {
    const L = __lab, H = L.hero, V = new THREE.Vector3();
    const bones = ['ball_l', 'ball_r', 'foot_l', 'foot_r'].map(n => H.model.getObjectByName(n));
    const clipTime = () => { const d = H.debug(); return d.clipTimes || null; };
    // per-frame sample: root, both balls / ankles (world), heights above the floor
    function sample() {
      const r = H.root.position, o = { x: r.x, z: r.z, f: [] };
      for (const b of bones) { b.getWorldPosition(V); o.f.push([V.x, V.y - r.y, V.z]); }
      return o;
    }
    // Slide of the contact point: each frame the lowest of the four sole points (both heels, both balls),
    // measured against its height when standing flat (idle pose), is the point carrying the weight; if it is within 1.5 cm of the
    // floor its horizontal world speed is slide. Heel-to-toe roll hands the weight from heel to ball instead
    // of counting as slide. rows may contain null separators (treadmill wraps).
    function plantedDrift(rows, dt) {
      const real = rows.filter(Boolean); if (!real.length) return { mean: 0, max: 0, n: 0 };
      const mins = FLAT;   // heights of balls / ankles when standing flat on the floor (idle pose)
      let sum = 0, n = 0, max = 0, worst = null;
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1], b = rows[i]; if (!a || !b) continue;
        // heel (ankle) counts as the contact only while that foot is near flat: a pitched swing foot can carry its
        // ankle at standing height while the sole is still in the air
        let k = 0, best = 1e9;
        for (let j = 0; j < 4; j++) {
          const h = b.f[j][1] - mins[j];
          if (j >= 2 && b.f[j - 2][1] - mins[j - 2] > 0.06) continue;
          if (h < best) { best = h; k = j; }
        }
        if (best > 0.015 || a.f[k][1] - mins[k] > 0.015) continue;
        const v = Math.hypot(b.f[k][0] - a.f[k][0], b.f[k][2] - a.f[k][2]) / dt; sum += v; n++; if (v > max) { max = v; worst = [i, k, +best.toFixed(3), +(a.f[k][1] - mins[k]).toFixed(3)]; }
      }
      if (worst && globalThis.__dumpWorst) worst.push(rows.slice(Math.max(0, worst[0] - 3), worst[0] + 2).map(r => r && [+r.z.toFixed(2)].concat(r.f.map(p => [+p[1].toFixed(3), +p[2].toFixed(3)]))));
      return { mean: n ? sum / n : 0, max, n, worst };
    }
    // treadmill: the lab is 26 m deep; long runs are wrapped back without touching the animation state
    let travelled = 0;
    function adv(n, h, rows) {
      for (let i = 0; i < n; i++) {
        const z0 = H.root.position.z; L.step(1, h); travelled += H.root.position.z - z0;
        if (rows) rows.push(sample());
        if (H.root.position.z > 8) { H.root.position.z -= 16; if (rows) rows.push(null); }
      }
    }
    const out = {};
    // floor reference: ball / ankle heights in the idle stance
    L.place(0, 0, 0); L.set(0, 0, 0, true); L.step(60);
    const FLAT = (() => { const s = sample(); return s.f.map(p => p[1]); })();
    out.flat = FLAT.map(v => +v.toFixed(3));
    const dt = 1 / 60;
    L.setYaw(0);
    // ---- steady locomotion: root speed, clip rate, planted foot drift
    function steady(mag, label) {
      L.place(0, -6, 0); L.setYaw(0); L.set(1, 0, mag, true); adv(90, dt);
      const rows = [], d0 = H.debug(); travelled = 0;
      adv(150, dt, rows);
      const d1 = H.debug();
      const speed = travelled / (150 * dt);
      let key = d1.locoClip, rate = null;
      if (d1.clipTimes) {                       // controller reports raw clip clocks
        const t0 = d0.clipTimes[key], t1 = d1.clipTimes[key], D = d1.clipDur[key];
        let adv = t1 - t0; while (adv < 0) adv += D; rate = adv / (150 * dt);
        // a whole number of loops can hide in 150 frames: unwrap using the expected advance
        const k = Math.round((150 * dt - adv) / D); rate = (adv + k * D) / (150 * dt);
      } else if (d1.stride && d1.nat) {         // older controller: shared phase -> clip seconds
        key = d1.gait === 2 ? 'run' : (d1.gait >= 3 ? 'sprint' : 'walk');
        const cyc = d1.stride[key] / d1.nat[key];
        rate = speed / d1.stride[key] * cyc;     // cycles per second * cycle duration
      }
      return { label, mag, speed: +speed.toFixed(3), clip: key || null, rate: rate == null ? null : +rate.toFixed(3), drift: plantedDrift(rows, dt) };
    }
    out.walk = steady(0.40, 'walk'); out.run = steady(1.0, 'run');
    // ---- release: travel after stick release, time to rest, drift during the stop, drift once at rest
    function stop(mag, label) {
      L.place(0, -6, 0); L.setYaw(0); L.set(1, 0, mag, true); adv(100, dt);
      L.set(0, 0, 0, true);
      const rows = []; let tRest = null; travelled = 0;
      for (let i = 0; i < 90; i++) {
        const before = travelled; adv(1, dt, rows);
        if (tRest == null && Math.abs(travelled - before) < 1e-5) tRest = i * dt;
      }
      const zr = H.root.position.z; L.step(60); const rest = Math.abs(H.root.position.z - zr);
      return { label, travel: +travelled.toFixed(3), tRest: tRest == null ? null : +tRest.toFixed(3), drift: plantedDrift(rows.slice(0, 30), dt), restDrift: +rest.toFixed(5) };
    }
    out.stopWalk = stop(0.40, 'walk'); out.stopRun = stop(1.0, 'run');
    // ---- turns while moving: lateral offset of the path (arc) and drift during the turn
    function turn(mag, deg) {
      L.place(0, -6, 0); L.setYaw(0); L.set(1, 0, mag, true); L.step(90);
      const a = deg * Math.PI / 180, p0 = H.root.position.clone(), rows = [];
      L.set(Math.cos(a), -Math.sin(a), mag, true);      // stick to the new direction (camera fixed at yaw 0)
      let t90 = null;
      for (let i = 0; i < 120; i++) { L.step(1); rows.push(sample()); const f = Math.abs(Math.atan2(Math.sin(L.facing() - a), Math.cos(L.facing() - a))); if (t90 == null && f < 0.05) t90 = i * dt; }
      const p1 = H.root.position;
      return { mag, deg, tFace: t90 == null ? null : +t90.toFixed(3), drift: plantedDrift(rows.slice(0, 40), dt), moved: +p0.distanceTo(p1).toFixed(2) };
    }
    out.turns = [];
    for (const m of [0.4, 1.0]) for (const d of [45, 90, 180]) out.turns.push(turn(m, d));
    // ---- turn in place from idle (stick tap to the side)
    L.place(0, 0, 0); L.set(0, 0, 0, true); L.step(30);
    { const rows = []; const p0 = H.root.position.clone(); L.set(0, 1, 0.2, true); for (let i = 0; i < 20; i++) { L.step(1); rows.push(sample()); } L.set(0, 0, 0, true); L.step(40); out.turnInPlace = { moved: +p0.distanceTo(H.root.position).toFixed(3), drift: plantedDrift(rows, dt) }; }
    // ---- attack started from a run: root displacement while the clip plays (clips are in-place)
    L.place(0, -12, 0); L.setYaw(0); L.set(1, 0, 1, true); L.step(90); H.weapon.equip(); L.step(40);
    L.set(0, 0, 0, true); L.press('light'); L.step(2);
    { const z0 = H.root.position.z, rows = []; for (let i = 0; i < 8; i++) { L.step(1); rows.push(sample()); }
      const z1 = H.root.position.z; for (let i = 0; i < 52; i++) { L.step(1); rows.push(sample()); }
      out.attackFromRun = { fade: +(z1 - z0).toFixed(3), drift: +(H.root.position.z - z1).toFixed(3), feet: plantedDrift(rows.slice(8), dt) }; }
    L.step(90);
    // ---- dodge: root travel vs planted feet
    L.place(0, 0, 0); L.set(0, 0, 0, true); L.step(30); L.press('dodge');
    { const p0 = H.root.position.clone(), rows = []; for (let i = 0; i < 100; i++) { L.step(1); rows.push(sample()); } out.dodge = { travel: +p0.distanceTo(H.root.position).toFixed(3), feet: plantedDrift(rows, dt) }; }
    // ---- frame-rate independence: distance in 2.0 s of running and stop travel at 30/60/120 FPS
    out.fps = [30, 60, 120].map(fps => {
      const h = 1 / fps; L.place(0, -6, 0); L.setYaw(0); L.set(1, 0, 1, true); adv(Math.round(1.5 * fps), h);
      travelled = 0; adv(Math.round(2 * fps), h); const run = travelled;
      L.set(0, 0, 0, true); travelled = 0; adv(Math.round(1 * fps), h); const st = travelled;
      travelled = 0; L.set(1, 0, 0.4, true); adv(Math.round(2 * fps), h); const walk = travelled; L.set(0, 0, 0, true); adv(fps, h);
      return { fps, run2s: +run.toFixed(3), stop: +st.toFixed(3), walk2s: +walk.toFixed(3) };
    });
    L.set(0, 0, 0, true);
    out.debug = H.debug();
    return out;
  });
  const fails = [];
  const chk = (ok, msg) => { if (!ok) fails.push(msg); };
  chk(R.walk.drift.mean <= LIMITS.plantedSlideWalk, `walk planted drift ${R.walk.drift.mean.toFixed(3)} m/s`);
  chk(R.run.drift.mean <= LIMITS.plantedSlideRun, `run planted drift ${R.run.drift.mean.toFixed(3)} m/s`);
  chk(R.stopWalk.travel <= LIMITS.stopTravelWalk, `walk stop travel ${R.stopWalk.travel} m`);
  chk(R.stopRun.travel <= LIMITS.stopTravelRun, `run stop travel ${R.stopRun.travel} m`);
  chk(R.stopWalk.tRest != null && R.stopWalk.tRest <= LIMITS.stopTime, `walk time to rest ${R.stopWalk.tRest}`);
  chk(R.stopRun.tRest != null && R.stopRun.tRest <= LIMITS.stopTimeRun, `run time to rest ${R.stopRun.tRest}`);
  chk(R.stopRun.drift.mean <= LIMITS.stopSlide, `run stop planted drift ${R.stopRun.drift.mean.toFixed(3)} m/s`);
  chk(R.stopWalk.restDrift <= LIMITS.restDrift && R.stopRun.restDrift <= LIMITS.restDrift, 'root moves after coming to rest');
  chk(R.walk.rate != null && R.walk.rate >= LIMITS.rateWalk[0] && R.walk.rate <= LIMITS.rateWalk[1], `walk clip rate ${R.walk.rate}`);
  chk(R.run.rate != null && R.run.rate >= LIMITS.rateRun[0] && R.run.rate <= LIMITS.rateRun[1], `run clip rate ${R.run.rate}`);
    { const r = R.fps.map(f => f.run2s), w = R.fps.map(f => f.walk2s), sp = a => (Math.max(...a) - Math.min(...a)) / Math.max(1e-6, Math.max(...a));
    chk(sp(r) <= LIMITS.fpsSpread && sp(w) <= LIMITS.fpsSpread, `FPS-dependent distance spread run ${(sp(r) * 100).toFixed(1)}% walk ${(sp(w) * 100).toFixed(1)}%`); }
  chk(Math.abs(R.attackFromRun.drift) <= LIMITS.attackDrift, `root drifts ${R.attackFromRun.drift} m during an in-place attack`);
  for (const t of R.turns) chk(t.drift.mean <= (t.mag < 0.5 ? LIMITS.turnSlideWalk : LIMITS.turnSlideRun), `turn ${t.deg} deg at ${t.mag} slide ${t.drift.mean.toFixed(3)} m/s`);
  chk(R.dodge.feet.max <= LIMITS.footSpike, `dodge contact spike ${R.dodge.feet.max.toFixed(2)} m/s`);
  if (R.debug.speeds) chk(Math.abs(R.run.speed - R.debug.speeds.run) < 0.02 * R.debug.speeds.run && Math.abs(R.walk.speed - R.debug.speeds.walk) < 0.02 * R.debug.speeds.walk, 'root speed differs from the measured stance speed of the clip');
  else chk(false, 'controller does not report clip-measured speeds');
  chk(errors.length === 0, 'page errors: ' + errors.join(' | '));
  R.fails = fails;
  console.log(JSON.stringify(R, (k, v) => typeof v === 'number' ? +v.toFixed(4) : v, 1));
  if (outJson) fs.writeFileSync(outJson, JSON.stringify(R, null, 1));
  console.log(fails.length ? 'AUDIT FAILURES:\n  ' + fails.join('\n  ') : 'motion audit: all limits met');
  await browser.close();
  if (strict && fails.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
