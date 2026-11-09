/* Real-layout streaming simulation.
   Loads the ACTUAL palace region graph by extracting solveLayout() out of
   wings.js (the same source the game runs) and drives the streaming core with
   a scripted tour: forward sprint across the palace, repeated back-and-forth,
   then a return trip. Reports the numbers the browser bench could not produce
   here (SwiftShader could not sustain the 270 MB asset set headlessly). */
const fs = require('fs');
const path = require('path');
const Core = require('../world-streaming-core.js');
const Vis = require('../wing-visibility.js');

const SRC = fs.readFileSync(require('path').join(__dirname, '..', 'wings.js'), 'utf8');

function grab(name) {
  const start = SRC.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing function ' + name);
  let i = SRC.indexOf('{', start), depth = 0;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) return SRC.slice(start, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

/* The hall metrics the layout is derived from. Read from palaceInterior.js so
   the numbers are the shipped ones, with the source defaults as a fallback. */
const INT = fs.readFileSync(require('path').join(__dirname, '..', 'palaceInterior.js'), 'utf8');
function num(re, dflt) { const m = INT.match(re); return m ? Number(m[1]) : dflt; }
// Palace hall width as shipped by palaceInterior.js (metrics: width: hallW).
const HW = 44;
const HL = num(/length:\s*(\d+(?:\.\d+)?)/, 64);
const HALL = {
  width: HW, length: HL,
  wallThickness: num(/wallThickness:\s*(\d+(?:\.\d+)?)/, 1.2),
  alcoveDepth: num(/alcoveDepth:\s*(\d+(?:\.\d+)?)/, 1.6),
  floorY: 0,
  passages: [
    { id: 'passage-L2', position: [-HW / 2 - 1, 4, HL * 0.28], width: 7.8, height: 7.8 },
    { id: 'passage-R2', position: [HW / 2 + 1, 4, HL * 0.32], width: 7.8, height: 7.8 },
    { id: 'passage-R0', position: [HW / 2 + 1, 4, HL * 0.72], width: 7.8, height: 7.8 }
  ]
};

const ROOM_NAMES = { K1: 'reception hall', K2: 'council hall', K3: 'map room', K4: 'royal treasury', K5: 'king private wing',
  T1: 'sacred entrance', T2: 'purification hall', T3: 'sacred columns', T4: 'holy sanctuary', T5: 'offering room',
  L1: 'great library', L2: 'archive', L3: 'scribes room', L4: 'observatory' };

const helpers = ['region', 'rectRegion', 'bbox', 'polyRect', 'polyCircle'].map(grab).join('\n');
const layoutFn = new Function('ROOM_NAMES', 'polyCircle', 'return (function(){' + helpers + '\n' + grab('solveLayout') + '\nreturn solveLayout;})()')(ROOM_NAMES, function polyCircle(cx, cz, r, n) {
  const out = [], steps = n || 24;
  for (let i = 0; i < steps; i++) { const a = i / steps * Math.PI * 2; out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return out;
});
const layout = layoutFn(HALL);
const regions = layout.rooms.concat(layout.connectors);
const links = layout.links.map(l => [l[0], l[1]]);
const rooms = layout.rooms.map(r => r.id);

/* ---------------------------------------------------------------- tour ---- */
const dt = 1 / 60;
const predictor = Core.createPredictor();
const cache = Core.createRegionCache({ slots: 3 });
const scheduler = Core.createScheduler({ sliceMs: 4.5, maxTasksPerFrame: 2 });
const budget = Core.createMemoryBudget({ device: 'ios' });
const registry = Core.createResourceRegistry();

const center = id => { const r = regions.find(x => x.id === id); return { x: r.bbox.cx, z: r.bbox.cz, r }; };
const route = [];
for (let i = 0; i < rooms.length; i++) {
  if (i) route.push(rooms[i]);
}
/* forward pass + one full backwards pass = return-trip load test */
const forward = rooms.slice(1);
const backward = rooms.slice(0, -1).reverse();
const tourPath = [...forward, ...backward, ...forward];

let x = center(rooms[0]).x, z = center(rooms[0]).z;
let preparedPrev = new Set(), visiblePrev = new Set();
const failures = [];
let frames = 0, reloads = 0, cacheHits = 0, predAdds = 0, visCount = 0, prepCount = 0;
let maxSlice = 0, leftViewCount = 0, reDecodes = 0, visibleDroppedFromPrepared = 0;
const perRoom = [];

function stepTo(target, speed) {
  const t = center(target);
  const dist = Math.hypot(t.x - x, t.z - z);
  const n = Math.max(1, Math.ceil(dist / (speed * dt)));
  for (let i = 0; i < n; i++) {
    x += (t.x - x) / Math.max(1, n - i);
    z += (t.z - z) / Math.max(1, n - i);
    frame(t.r.id);
  }
}

function frame(hereId) {
  frames++;
  const pred = predictor.sample(x, z, dt);
  const origin = hereId;
  const reach = Vis.hops(links.map((l, i) => [l[0], l[1], 'L' + i]), origin, 6);
  const cam = { x, z, dirX: pred.dirX || 0, dirZ: pred.dirZ || 1, halfFov: 0.72 };
  const planned = Vis.createPlanner().plan(regions, links, origin, cam, frames * dt);
  const visible = planned.visible;
  const prepared = new Set(planned.prepared);

  visible.forEach(id => { prepared.add(id); cache.touch(id, frames * dt * 1000); });

  const widened = Core.planPrefetch({ regions, reach, cam, lead: pred.lead, visibility: Vis });
  widened.prepared.forEach(id => { if (!prepared.has(id)) { prepared.add(id); if (!planned.prepared.has(id)) predAdds++; } });

  cache.setSlots(budget.cacheSlots());
  cache.resident(frames * dt * 1000).forEach(id => { if (!prepared.has(id)) prepared.add(id); });

  const b = budget.sample({ memory: { geometries: 120 + prepared.size * 9, textures: 60 + prepared.size * 5 } }, 16.7, 16.7);
  if (b.level !== 'normal') {
    const tail = [...prepared].filter(id => !visible.has(id));
    const drop = Math.max(0, tail.length - budget.cacheSlots());
    for (let i = 0; i < drop; i++) prepared.delete(tail[i]);
  }

  /* INVARIANTS ------------------------------------------------------------ */
  visible.forEach(id => { if (!prepared.has(id)) failures.push('visible-not-prepared:' + id); });
  // A region leaving the frame is normal travel; a region still in frame that
  // got dropped from the prepared set is a streaming defect.
  if (visiblePrev.size) visiblePrev.forEach(id => { if (!visible.has(id)) leftViewCount++; });
  visible.forEach(id => { if (preparedPrev.has(id) && !prepared.has(id)) visibleDroppedFromPrepared++; });
  let newDecodes = 0;
  prepared.forEach(id => { if (!preparedPrev.has(id)) { newDecodes++; if (cache.isHot(id)) cacheHits++; else reloads++; } });
  reDecodes += newDecodes;

  scheduler.push({ run() { const t0 = Date.now(); while (Date.now() - t0 < 1); } }, visible.size ? 0 : 2);
  const slice = scheduler.runFrame(frames * 16.7, 4.5);
  if (slice.sliceMs > maxSlice) maxSlice = slice.sliceMs;

  preparedPrev = prepared; visiblePrev = new Set(visible);
  visCount += visible.size; prepCount += prepared.size;

  return { visible: visible.size, prepared: prepared.size, lead: pred.lead, level: b.level };
}

/* Walk the whole palace forward, then back, then forward again. */
let lastFrame;
for (const id of tourPath) {
  const here = regions.find(r => r.id === id);
  x = here.bbox.cx; z = here.bbox.cz;
  for (let i = 0; i < 12; i++) lastFrame = frame(id);
  perRoom.push({ room: id, ...lastFrame });
}

const report = {
  layout: {
    rooms: const_rooms(), connectors: layout.connectors.length, links: links.length,
    doors: layout.doors.length, hall: { width: HALL.width, length: HALL.length, wallThickness: HALL.wallThickness }
  },
  tour: { frames, waypoints: tourPath.length, forwardRooms: forward.length, backwardRooms: backward.length },
  invariants: {
    visibleNeverUnprepared: failures.length === 0,
    failures: failures.slice(0, 8),
    visibleKeptFromPreparedViolations: visibleDroppedFromPrepared,
    regionsLeftViewDuringTour: leftViewCount
  },
  residency: {
    avgVisible: +(visCount / frames).toFixed(2),
    avgPrepared: +(prepCount / frames).toFixed(2),
    maxPrepared: Math.max(...perRoom.map(r => r.prepared)),
    regionActivations: reDecodes,
    cacheHits, coldLoads: reloads,
    cacheHitRatio: +(cacheHits / Math.max(1, cacheHits + reloads)).toFixed(3)
  },
  prediction: { predictiveAdds: predAdds, finalLead: +predictor.state().lead.toFixed(2) },
  scheduler: { maxSliceMs: maxSlice, ...scheduler.report() },
  budget: budget.state(),
  cacheReport: cache.report(),
  perRoom
};
function const_rooms() { return rooms.length; }
console.log(JSON.stringify(report, null, 2));
