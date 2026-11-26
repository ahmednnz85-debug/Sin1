// Developer hub: registry, links, boot routing, storage isolation, switch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HUB = fs.readFileSync(path.join(ROOT, 'dev-hub.js'), 'utf8');
const AREAS = fs.readFileSync(path.join(ROOT, 'sin-areas.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const PALACE = fs.readFileSync(path.join(ROOT, 'palaceInterior.js'), 'utf8');
const BAKE = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/palace-colliders.json'), 'utf8'));
// The registrations exactly as the owning files write them.
const outdoorStart = HTML.indexOf("if(window.SinAreas){SinAreas.chapter({stage:'outdoor'");
const outdoorBlock = HTML.slice(outdoorStart, HTML.indexOf("'index.html'));}", outdoorStart) + "'index.html'));}".length);
const marketBlock = HTML.split('\n').find(l => l.startsWith("if(window.SinAreas)SinAreas.register({id:'OUT-MARKET'"));
const hallStart = PALACE.indexOf('  if (window.SinAreas) SinAreas.group(\'hall\'');
const hallBlock = PALACE.slice(hallStart, PALACE.indexOf("'palaceInterior');", hallStart) + "'palaceInterior');".length);
const chapterStart = PALACE.indexOf("  if (window.SinAreas) SinAreas.chapter({ stage: 'palace'");
const palaceChapter = PALACE.slice(chapterStart, PALACE.indexOf("'palaceInterior');", chapterStart) + "'palaceInterior');".length);

function load({ search = '', enabled = true } = {}) {
  const store = new Map();
  class Storage {
    getItem(k) { return store.has(k) ? store.get(k) : null; }
    setItem(k, v) { store.set(k, String(v)); }
    removeItem(k) { store.delete(k); }
  }
  const body = { appendChild() {}, };
  const document = { head: { appendChild() {} }, body, getElementById: () => null,
    createElement: () => ({ setAttribute() {}, addEventListener() {}, appendChild() {}, querySelector: () => ({ focus() {}, style: {}, addEventListener() {} }), querySelectorAll: () => [], style: {}, remove() {} }) };
  const page = { location: { search, href: 'http://localhost/index.html' + search }, document, history: { replaceState() {} }, console };
  const fetch = async url => ({ ok: true, json: async () => { assert.match(url, /data\/palace-colliders\.json/); return BAKE; } });
  // As in the browser, window is the global object.
  const ctx = vm.createContext({ ...page, Storage, URL, URLSearchParams, performance, console, setTimeout, Map, Set, fetch });
  ctx.window = ctx.self = ctx.globalThis = ctx;
  const window = ctx;
  vm.runInContext(AREAS, ctx);
  vm.runInContext(enabled ? HUB : HUB.replace('const ENABLED = true;', 'const ENABLED = false;'), ctx);
  // Owners register in the browser as each script loads.
  window.fetch = fetch;
  window.ClipperLib = require(path.join(ROOT, 'vendor/clipper.js'));
  for (const f of ['wing-architecture.js', 'r3-maw-geology.js', 'r3-maw-approach.js', 'r3-maw-dressing.js', 'r3-underworld.js', 'r3-sealed-zone.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx);
  vm.runInContext('(function(){const CANAL_Z0=7,CANAL_Z1=76;' + marketBlock + '})()', ctx);
  vm.runInContext('(function(){const PL_Z0=76,PL_FRONT=160;' + outdoorBlock + '})()', ctx);
  vm.runInContext('(function(){const bootPalace=()=>Promise.resolve();' + palaceChapter + '})()', ctx);
  vm.runInContext(hallBlock, ctx);
  return { hub: window.SinDevHub, store, Storage, ctx };
}

test('menu = core registry: every palace region of the real layout, R3 and the exterior', async () => {
  const { hub } = load();
  const list = await hub.catalog();
  assert.equal(list.errors.length, 0, list.errors.join());
  const ids = list.map(a => a.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/palace-graph.json'), 'utf8'));
  const regions = graph.planRegions.filter(r => r.kind === 'room' || r.kind === 'corridor' || r.kind === 'gallery').map(r => r.id);
  for (const id of regions) assert.ok(ids.includes(id), 'palace region ' + id + ' registered');
  for (const id of ['HALL', 'R3-01', 'R3-02', 'R3-03', 'U1-01', 'U1-02', 'U1-03', 'OUT-START', 'OUT-GATE', 'OUT-MARKET', 'OUT-PLAZA', 'OUT-PALACE']) assert.ok(ids.includes(id), id);
  for (const a of list) {
    assert.ok(a.ar && a.en && a.group, a.id + ' labelled');
    if (a.stage === 'palace') assert.ok(a.spawn.teleport, a.id + ' teleport');
  }
  assert.equal(hub.area('R3-02').stage, 'r3');
  assert.equal(list.length, 12 + regions.length, 'nothing else is listed');
  assert.deepEqual(JSON.parse(JSON.stringify([...new Set(list.map(a => a.group))])), ['outdoor', 'hall', 'Kings', 'Library', 'Temple', 'corridors', 'r3', 'u1']);
});

test('a room added to the layout appears in the menu with no hub change', async () => {
  const { hub, ctx } = load({ keep: true });
  // A new room registered by its owner through the same registry.
  ctx.window.SinAreas.register({ id: 'K6', stage: 'palace', group: 'Kings', ar: 'غرفة جديدة', en: 'New room', spawn: { teleport: 'K6' } }, 'test');
  const list = await hub.catalog();
  const k6 = list.find(a => a.id === 'K6');
  assert.ok(k6 && hub.link('K6') === '?dev=1&level=K6');
  assert.ok(list.indexOf(k6) < list.findIndex(a => a.group === 'Library'), 'sorted into its wing');
});

test('direct links are stable and absolute on request', () => {
  const { hub } = load();
  assert.equal(hub.link('K3'), '?dev=1&level=K3');
  assert.equal(hub.link('R3-01', true), 'http://localhost/index.html?dev=1&level=R3-01');
});

test('registry rejects bad definitions and reports duplicate ids', async () => {
  const { ctx } = load();
  const A = ctx.window.SinAreas;
  assert.throws(() => A.register({ id: 'X', stage: 'moon', group: 'g', spawn: {} }));
  assert.throws(() => A.register({ id: 'X', stage: 'palace', group: 'g', spawn: {} }), /teleport/);
  A.register({ id: 'K3', stage: 'palace', group: 'Kings', spawn: { teleport: 'K3' } }, 'test');
  const list = await A.list();
  assert.ok(list.errors.some(e => /duplicate id K3/.test(e)));
  assert.equal(list.filter(a => a.id === 'K3').length, 1);
});

test('normal link: storage untouched; dev link: game keys are isolated', () => {
  const normal = load();
  assert.equal(normal.hub.devSession, false);
  const s = new normal.Storage(); s.setItem('quality', 'high');
  assert.deepEqual([...normal.store.keys()], ['quality']);

  const dev = load({ search: '?dev=1&level=K3' });
  assert.equal(dev.hub.devSession, true);
  const d = new dev.Storage();
  dev.store.set('quality', 'player-value');
  assert.equal(d.getItem('quality'), null, 'dev session does not read the player key');
  d.setItem('quality', 'low'); d.setItem('sin.lunar', 'x'); d.removeItem('quality');
  assert.equal(dev.store.get('quality'), 'player-value', 'player key unchanged');
  assert.deepEqual([...dev.store.keys()].sort(), ['quality', 'sin-dev:sin.lunar']);
});

test('boot: automation links and the off switch run the original start immediately', () => {
  for (const search of ['?startInHall=1&royalDoorTest=1', '?play=1']) {
    const { hub } = load({ search });
    let started = 0; hub.boot(() => started++);
    assert.equal(started, 1, search);
  }
  const off = load({ search: '?dev=1&level=K3', enabled: false });
  assert.equal(off.hub.enabled, false);
  assert.equal(off.hub.devSession, false, 'no dev session when disabled');
  let started = 0; off.hub.boot(() => started++);
  assert.equal(started, 1);
  const s = new off.Storage(); s.setItem('quality', 'x');
  assert.deepEqual([...off.store.keys()], ['quality'], 'no isolation when disabled');
});

test('index.html: one hook, original init() when the hub is absent', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /if\(window\.SinDevHub&&SinDevHub\.enabled\)\{SinDevHub\.bind\(\{[^\n]*\}\);SinDevHub\.boot\(startGame\);\}else startGame\(\);/);
  assert.equal((html.match(/SinDevHub/g) || []).length, 4, 'the hub is referenced only by the boot hook');
  assert.ok(html.indexOf('dev-hub.js') < html.indexOf('device-profile.js'), 'hub loads before any storage reader');
  for (const f of fs.readdirSync(ROOT).filter(f => /\.js$/.test(f) && !/^dev-hub/.test(f))) {
    assert.ok(!/SinDevHub/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f + ' does not depend on the hub');
  }
});

test('chapters: every stage is a registered chapter, ordered by its point of no return', async () => {
  const { ctx } = load();
  const A = ctx.window.SinAreas;
  const chapters = A.chapters();
  assert.deepEqual(JSON.parse(JSON.stringify(chapters.map(c => c.stage))), ['outdoor', 'palace', 'r3', 'u1']);
  assert.equal(chapters[0].boot, undefined, 'the first chapter is the game\'s own full start');
  for (const c of chapters.slice(1)) assert.equal(typeof c.boot, 'function', c.stage + ' boots directly');
  for (const a of await A.list()) assert.ok(A.chapterOf(a.stage), a.id + ' belongs to a chapter');
  // A new chapter adds its stage; its areas are then accepted with no hub change.
  A.chapter({ stage: 'u2', order: 50, boot: () => Promise.resolve() }, 'test');
  A.register({ id: 'U2-01', stage: 'u2', group: 'u1', ar: 'x', en: 'x', spawn: { u: 0, v: 0, y: 0, yaw: 0 } }, 'test');
  assert.throws(() => A.chapter({ stage: 'u2', order: 51 }), /twice/);
});

test('direct entry boots only the chosen chapter: later chapters never run the original start', async () => {
  for (const [id, direct] of [['OUT-GATE', false], ['K3', true], ['R3-02', true], ['U1-03', true]]) {
    const { hub, ctx } = load({ search: '?dev=1&level=' + id });
    const calls = [];
    hub.bind({ chapter: (stage, area) => { calls.push(['chapter', stage, area.id]); return new Promise(() => {}); },
      phase: () => 'ready', start() {}, hero: () => null });
    hub.boot(() => calls.push(['init']));
    await new Promise(r => setTimeout(r, 30));
    const stage = (await ctx.window.SinAreas.get(id)).stage;
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), direct ? [['chapter', stage, id]] : [['init']], id);
    assert.equal(ctx.window.location.search, '?dev=1&level=' + id, 'no automation parameters added');
  }
});

test('chapter starts and the exterior hold are reachable only from the developer entry', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const game = fs.readdirSync(ROOT).filter(f => /\.js$/.test(f) && !/^dev-hub/.test(f))
    .map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]).concat([['index.html', html]]);
  // Only the hub raises the exterior hold; the game only reads it.
  for (const [f, src] of game) assert.ok(!/__sinDeferExterior\s*=[^=]/.test(src), f + ' never sets __sinDeferExterior');
  assert.match(HUB, /root\.__sinDeferExterior = true/);
  // bootChapter is defined once and handed only to the hub's bind.
  assert.equal((html.match(/bootChapter\(/g) || []).length, 2);
  assert.match(html, /SinDevHub\.bind\(\{[^\n]*chapter:\(stage,area\)=>bootChapter\(stage,area\)/);
  // Chapter boots are called only by bootChapter; enterR3Direct only by a chapter boot.
  for (const [f, src] of game) {
    const calls = (src.match(/\.boot\(\{|chapter\.boot\(/g) || []).length;
    assert.ok(f === 'index.html' ? calls === 1 : calls === 0, f + ' calls a chapter boot');
  }
  const direct = game.filter(([, src]) => /enterR3Direct\(/.test(src)).map(([f]) => f).sort();
  assert.deepEqual(direct, ['palaceInterior.js', 'r3-sealed-zone.js']);
});

test('removing the hub: the boot hook falls back to the original start', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    .replace(/<!-- Temporary developer hub[^\n]*\n<script[^\n]*dev-hub\.js[^\n]*<\/script>\n/, '');
  assert.ok(!/data-src="dev-hub\.js/.test(html), 'hub tag removable as documented');
  const hook = html.split('\n').find(l => l.startsWith('if(window.SinDevHub&&SinDevHub.enabled)'));
  let started = 0;
  vm.runInNewContext(hook, { window: {}, SinDevHub: undefined, startGame: () => started++, bootChapter() {} });
  assert.equal(started, 1);
});
