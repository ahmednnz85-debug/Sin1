#!/usr/bin/env node
/* Deterministic palace walk simulation (no browser, no GPU).

   Runs the REAL palace-routes.js, wing-visibility.js, zone-streamer.js and
   palace-room-manager.js over the real portal graph (tests/fixtures/
   palace-graph.json, dumped from the running game) along a full tour of the
   14 rooms at the hero's run speed, with device-like room preparation
   times and memory budgets. Compares the streaming policy before the room
   manager ("old", reproduced from the original wings.js streamZones) with
   the current one ("new").

   Metrics:
     doorWaitS     seconds the hero stood at a closed door waiting for a room
     unreadySightF frames where a streamed room is geometrically visible through
                   physically open portals but not prepared (placeholder / void)
     insideUnreadyF frames the hero stands inside an unprepared room
     loads         room preparations started (restarts = thrash)
     peakMB        estimated process memory peak

   Usage: node tools/palace-route-sim.cjs [desktop|phone] [--json] */
'use strict';
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const Routes = require(path.join(root, 'palace-routes.js'));
const Vis = require(path.join(root, 'wing-visibility.js'));
const Z = require(path.join(root, 'zone-streamer.js'));
const M = require(path.join(root, 'palace-room-manager.js'));
// Optional: compare against the previous streamer source (e.g. a checkout of
// the commit before the room manager): SIN_OLD_STREAMER=/path/zone-streamer.js
const ZOld = process.env.SIN_OLD_STREAMER ? require(path.resolve(process.env.SIN_OLD_STREAMER)) : Z;

const DATA = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'palace-graph.json'), 'utf8'));
const STREAMED = ['T1','T2','T3','T4','T5','L4','L3','L2','L1','K2','K3','K4','K5'];
const EST = { // estProcessMB per room from wings.js (desktop, constrained)
  T1: [98, 40], T2: [105, 43], T3: [138, 64], T4: [115, 45], T5: [120, 54], L4: [110, 53], L3: [65, 34],
  L2: [100, 50], L1: [155, 95], K2: [50, 50], K3: [50, 50], K4: [50, 50], K5: [48, 48]
};
const PREFETCH_HOPS = { T1: 1, T2: 2, T3: 2, T4: 3, T5: 3, L4: 1, L3: 2, L2: 2, L1: 3 };
const TOURS = {};
const TOUR_FULL = ['Palace','K1','KC12','K2','KC1','KC3','K3','KC3','KC1','KC2','KC4','K4','KC4','KC2','K5','KC5R','REAR','TR1','T1','TC12','T2','TC23','T3','TC5','T5','TC5','T3','TC34','T4','MP1','MP2','L4','LC4','L1','LC2','L2','LC2','L1','LC3','L3','LC3','L1','Palace','K1','Palace'];
TOURS.full = TOUR_FULL;
TOURS.repeat = ['Palace','K1','KC12','K2','KC12','K1','KC12','K2','KC12','K1','KC12','K2','KC12','K1','Palace','T1','TC12','T2','TC23','T3','TC23','T2','TC12','T1','TC12','T2','TC23','T3','TC34','T4','TC34','T3','TC23','T2','TC12','T1','Palace','L1','LC2','L2','LC2','L1','LC3','L3','LC3','L1','LC2','L2','LC2','L1','Palace'];
let TOUR = TOUR_FULL;
const DEAD_ENDS = new Set(['K3','K4','T5','L2','L3']);

function profile(kind) {
  return kind === 'phone'
    ? { constrained: true, budget: 650, base: 400, cacheZones: { normal: 0, watch: 0, critical: 0 }, graceMs: 0, msPerMB: 55, fixedMs: 1400 }
    : { constrained: false, budget: 1400, base: 760, cacheZones: { normal: 3, watch: 2, critical: 0 }, graceMs: 20000, msPerMB: 24, fixedMs: 900 };
}

function simulate(policy, kind, tour) {
  TOUR = TOURS[tour || 'full'];
  const P = profile(kind);
  const regions = DATA.planRegions.filter(r => r.bbox);
  const routes = Routes.create(regions, DATA.links, DATA.doors);
  const byId = new Map(regions.map(r => [r.id, r]));
  const doorIds = new Set([...DATA.templeDoorIds, ...DATA.libraryDoorIds]);
  const doors = new Map();
  for (const d of DATA.doors) if (d.roomDoor || doorIds.has(d.id)) doors.set(d.id, { ...d, temple: doorIds.has(d.id), state: 'Closed', t: 0, progress: 0 });
  const portalOf = (a, b) => {
    const l = DATA.links.find(l => (l[0] === a && l[1] === b) || (l[0] === b && l[1] === a));
    const d = DATA.doors.find(x => x.id === l[2]);
    if (d) return d;
    const A = byId.get(a).bbox, B = byId.get(b).bbox;
    return { id: l[2], x: (Math.max(A.x0, B.x0) + Math.min(A.x1, B.x1)) / 2, z: (Math.max(A.z0, B.z0) + Math.min(A.z1, B.z1)) / 2 };
  };
  const centre = id => id === 'Palace' ? { x: 0, z: 30 } : { x: byId.get(id).bbox.cx, z: byId.get(id).bbox.cz };
  // ---- waypoints ------------------------------------------------------------
  const pts = [];
  for (let i = 0; i + 1 < TOUR.length; i++) {
    const a = TOUR[i], b = TOUR[i + 1], p = portalOf(a, b), A = centre(a), B = centre(b);
    if (a === 'Palace') pts.push({ x: 0, z: p.z });
    if (p.axis) {
      const s = p.axis === 'x' ? Math.sign(B.x - A.x) || 1 : Math.sign(B.z - A.z) || 1;
      const off = k => p.axis === 'x' ? { x: p.x + s * k, z: p.z } : { x: p.x, z: p.z + s * k };
      pts.push(off(-2.2));
      if (/^[KTL]\d/.test(b)) pts.push({ wait: 0.6 });
      pts.push({ ...off(0), door: p.id, toRoom: b });
      pts.push(off(2.0));
    } else pts.push({ x: p.x, z: p.z });
    if (b === 'Palace') pts.push({ x: 0, z: p.z });
    if (DEAD_ENDS.has(b) && TOUR[i + 2] === a) {
      pts.push({ x: p.axis === 'x' ? p.x + Math.sign(B.x - A.x) * 5 : p.x, z: p.axis === 'z' ? p.z + Math.sign(B.z - A.z) * 5 : p.z });
      pts.push({ spin: 3.6 });
    }
  }
  // ---- streamer ---------------------------------------------------------------
  let now = 0;
  const pending = new Map();
  const zs = (policy === 'old' ? ZOld : Z).create({
    processBudgetMB: P.budget, gpuBudgetMB: 0, cpuBudgetMB: 0, cacheZones: P.cacheZones, graceMs: P.graceMs,
    estimate: () => {
      let mb = P.base;
      for (const id of STREAMED) if (zs.status(id) !== 'cold') mb += EST[id][P.constrained ? 1 : 0];
      return { processMB: mb, gpuMB: 0, cpuMB: 0 };
    }
  });
  let loads = 0, peak = 0;
  // zone-streamer reads performance.now(); drive it from the simulation clock.
  const realNow = performance.now.bind(performance);
  performance.now = () => now;
  for (const id of STREAMED) {
    zs.register({ id, requireComplete: true, serialPreparation: true, prefetchHops: PREFETCH_HOPS[id] || 1,
      estProcessMB: EST[id][P.constrained ? 1 : 0], estGpuMB: 0, estCpuMB: 0,
      load(api) { loads++; pending.set(id, { at: now + P.fixedMs + P.msPerMB * EST[id][P.constrained ? 1 : 0], api }); },
      unload() { pending.delete(id); } });
  }
  const ready = id => !STREAMED.includes(id) || zs.status(id) === 'ready';
  const streamedSet = new Set(STREAMED);
  const manager = policy.startsWith('new') ? M.create({ streamed: streamedSet, constrained: P.constrained }) : null;
  const hopsFrom = origin => { const d = new Map([[origin, 0]]), q = [origin]; while (q.length) { const a = q.shift(); for (const b of routes.neighbours(a)) if (!d.has(b)) { d.set(b, d.get(a) + 1); q.push(b); } } return d; };
  // ---- hero / camera ------------------------------------------------------------
  const first = pts[0];
  const hero = { x: 0, z: 8, vx: 0, vz: 0 };
  let camYaw = Math.atan2(first.x - hero.x, first.z - hero.z);
  const halfFov = Math.atan(Math.tan(36.5 * Math.PI / 180));
  const regionAt = (x, z) => {
    for (const r of regions) if (r.kind === 'room' && x >= r.bbox.x0 && x <= r.bbox.x1 && z >= r.bbox.z0 && z <= r.bbox.z1) return r.id;
    for (const r of regions) if (r.kind !== 'room' && r.kind !== 'threshold' && x >= r.bbox.x0 && x <= r.bbox.x1 && z >= r.bbox.z0 && z <= r.bbox.z1) return r.id;
    for (const r of regions) if (r.kind === 'threshold' && x >= r.bbox.x0 && x <= r.bbox.x1 && z >= r.bbox.z0 && z <= r.bbox.z1) return r.id;
    return 'Palace';
  };
  const thresholdRoom = { ARCH_L3: 'K1', ARCH_R3: 'T1', ARCH_R1: 'L1' };
  const physicallyOpen = portal => { const d = doors.get(portal.id); return !d || d.state !== 'Closed'; };
  const dt = 1 / 60;
  let i = 0, waitS = 0, doorWait = 0, unreadySight = 0, insideUnready = 0, frames = 0, stopT = 0;
  const waits = {}, holes = {};
  let st = { approached: null, recent: null, lastOrigin: null };
  let prevRegion = null;
  while (i < pts.length && now < 30 * 60 * 1000) {
    frames++;
    now += dt * 1000;
    const p = pts[i];
    let moving = false;
    if (p.wait != null) { stopT += dt; if (stopT >= p.wait) { stopT = 0; i++; } }
    else if (p.spin != null) { stopT += dt; camYaw += dt * 2 * Math.PI / p.spin; if (stopT >= p.spin) { stopT = 0; i++; } }
    else {
      const dx = p.x - hero.x, dz = p.z - hero.z, d = Math.hypot(dx, dz);
      // A closed door ahead: open it if the room behind is ready, else wait.
      let blocked = false;
      for (const door of doors.values()) {
        const n = door.axis === 'x' ? hero.x - door.x : hero.z - door.z, s = door.axis === 'x' ? hero.z - door.z : hero.x - door.x;
        if (Math.abs(s) > door.width / 2 || Math.abs(n) > 1.3 || door.state === 'Open') continue;
        const ahead = door.axis === 'x' ? (p.x - door.x) * n < 0 : (p.z - door.z) * n < 0;
        if (!ahead && Math.abs(n) > 0.2) continue;
        if (door.state === 'Closed') {
          const beyond = [door.from, door.to].filter(id => id !== regionAt(hero.x, hero.z) && streamedSet.has(id));
          if (beyond.every(ready)) { door.state = 'Opening'; door.t = 0; }
          else {
            doorWait += dt; waits[door.id] = (waits[door.id] || 0) + dt; door.waiting = beyond.find(id => !ready(id));
            if (!door.temple && (!door._fl || now - door._fl > 400)) { door._fl = now; beyond.forEach(id => zs.forceLoad(id)); }
          }
        }
        if (door.state !== 'Open') blocked = true;
      }
      if (!blocked) {
        const step = Math.min(d, 7.15 * dt);
        if (d > 1e-6) { hero.x += dx / d * step; hero.z += dz / d * step; hero.vx = dx / d * 7.15; hero.vz = dz / d * 7.15; moving = true;
          const want = Math.atan2(dx, dz); let diff = Math.atan2(Math.sin(want - camYaw), Math.cos(want - camYaw)); camYaw += diff * (1 - Math.exp(-dt * 3.4)); }
        if (d < 0.05) i++;
      }
    }
    if (!moving) { hero.vx *= 0.65; hero.vz *= 0.65; }
    for (const door of doors.values()) {
      if (door.state === 'Opening') { door.t += dt; if (door.t > 1.1) door.state = 'Open'; }
      else if (door.state === 'Open' && door.temple && Math.hypot(hero.x - door.x, hero.z - door.z) > 3.2) { door.state = 'Closing'; door.t = 0; }
      else if (door.state === 'Closing') { door.t += dt; if (door.t > 1.47) door.state = 'Closed'; }
      if (door.state !== 'Closed') door.waiting = null;
    }
    // ---- visibility truth -------------------------------------------------------
    const camX = hero.x - Math.sin(camYaw) * 3.2, camZ = hero.z - Math.cos(camYaw) * 3.2;
    const view = { x: camX, z: camZ, dirX: Math.sin(camYaw), dirZ: Math.cos(camYaw), halfFov };
    let heroId = regionAt(hero.x, hero.z); if (thresholdRoom[heroId]) heroId = thresholdRoom[heroId];
    let camId = regionAt(camX, camZ); if (thresholdRoom[camId]) camId = thresholdRoom[camId];
    const sight = routes.connectedView(camId, view, Vis.throughOpenings, physicallyOpen);
    sight.add(heroId);
    let hole = false;
    for (const id of sight) if (streamedSet.has(id) && !ready(id)) { hole = true; holes[id] = (holes[id] || 0) + 1; }
    if (hole) unreadySight++;
    if (streamedSet.has(heroId) && !ready(heroId)) insideUnready++;
    // ---- streaming policy (every frame, as wings.tick) -------------------------
    const origin = heroId;
    const dist = hopsFrom(origin);
    const move = { x: hero.x, z: hero.z, vx: hero.vx, vz: hero.vz };
    const readyTime = id => zs.leadTime(id);
    const next = routes.nextRoom(origin, move, streamedSet, readyTime);
    const upcoming = next && ready(next.id) && routes.nextRoom(origin, move, streamedSet, readyTime, ready);
    const nearby = routes.nearRoom(origin, move, streamedSet, () => false);
    const templeWaiting = [...doors.values()].find(d => d.temple && d.waiting);
    const demand = (templeWaiting && templeWaiting.waiting) || (nearby && !ready(nearby) ? nearby : null);
    const approach = new Set([next && next.id, upcoming && upcoming.id, nearby, demand].filter(Boolean));
    const nextStream = demand || (upcoming && upcoming.id) || (next && next.id) || null;
    const retained = new Set();
    for (const d of doors.values()) if (d.temple) { if (d.waiting) retained.add(d.waiting); if (d.state !== 'Closed') [d.from, d.to].forEach(id => streamedSet.has(id) && retained.add(id)); }
    if (upcoming) retained.add(next.id);
    if (nextStream && nextStream !== origin) st.approached = { id: nextStream, until: now + 7500 };
    if (st.approached && now < st.approached.until && (dist.get(st.approached.id) ?? 99) <= 4) retained.add(st.approached.id);
    if (st.lastOrigin !== origin) { if (streamedSet.has(st.lastOrigin)) st.recent = { id: st.lastOrigin, until: now + 11000 }; st.lastOrigin = origin; }
    if (st.recent && now < st.recent.until && (dist.get(st.recent.id) ?? 99) <= 2 && !approach.size) retained.add(st.recent.id);
    let keep = null, rank = null, demandRoom = demand;
    const visible = new Set([...sight].filter(ready));
    if (manager) {
      const distances = routes.pathDistances(origin, hero.x, hero.z);
      const r = manager.update({ now, heroRegion: heroId, camRegion: camId, origin, motion: move, drawn: visible, sight,
        predicted: [next && next.id, upcoming && upcoming.id, nearby].filter(Boolean), distances,
        status: id => zs.status(id), leadSec: id => zs.leadTime(id), memoryLevel: 'normal' });
      if (!policy.includes('nosight')) for (const id of r.sight) { approach.add(id); retained.add(id); if (!demandRoom) demandRoom = id; }
      for (const id of r.approach) approach.add(id);
      for (const id of r.retained) retained.add(id);
      keep = r.keep; rank = policy.includes('norank') ? null : r.rank;
      if (!policy.includes('nodoor')) for (const d of doors.values()) if (!d.temple && (d.state === 'Opening' || (d.state !== 'Closed' && Math.hypot(hero.x - d.x, hero.z - d.z) <= 5)))
        [d.from, d.to].forEach(id => streamedSet.has(id) && retained.add(id));
    }
    zs.update({ current: origin, distances: dist, visible, memoryLevel: 'normal', approach, retained, demand: demandRoom,
      motionPrefetch: true, allowBackgroundWarm: false, keep, rank });
    if (/^K\d/.test(origin) && origin !== 'K1' && !ready(origin)) zs.forceLoad(origin);
    for (const [id, job] of pending) if (now >= job.at) { pending.delete(id); job.api.done(); }
    peak = Math.max(peak, zs.report().usage.processMB);
    prevRegion = heroId;
  }
  performance.now = realNow;
  return { policy, kind, seconds: +(now / 1000).toFixed(1), doorWaitS: +doorWait.toFixed(1), unreadySightF: unreadySight,
    unreadySightPct: +(100 * unreadySight / frames).toFixed(1), insideUnreadyF: insideUnready, loads, peakMB: Math.round(peak),
    holes, waits: Object.fromEntries(Object.entries(waits).map(([k, v]) => [k, +v.toFixed(1)])) };
}

if (require.main === module) {
  console.info = () => {};
  const kind = process.argv[2] === 'phone' ? 'phone' : 'desktop';
  const out = (process.argv[3] ? process.argv[3].split(',') : ['old', 'new']).map(p => simulate(p, kind, process.argv[4]));
  if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 1));
  else for (const r of out) console.log(JSON.stringify(r));
}
module.exports = { simulate };
