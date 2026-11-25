// Developer hub: registry, links, boot routing, storage isolation, switch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HUB = fs.readFileSync(path.join(ROOT, 'dev-hub.js'), 'utf8');
const AREAS = fs.readFileSync(path.join(ROOT, 'dev-hub-areas.js'), 'utf8');

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
  const window = { location: { search, href: 'http://localhost/index.html' + search }, document, history: { replaceState() {} }, console };
  const ctx = vm.createContext({ window, Storage, URL, URLSearchParams, performance, console, setTimeout, Map, Set });
  ctx.globalThis = ctx;
  vm.runInContext(enabled ? HUB : HUB.replace('const ENABLED = true;', 'const ENABLED = false;'), ctx);
  vm.runInContext(AREAS, ctx);
  return { hub: window.SinDevHub, store, Storage };
}

test('registry covers every palace region of the real layout, R3 and the exterior', () => {
  const { hub } = load();
  const ids = hub.areas().map(a => a.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/palace-graph.json'), 'utf8'));
  const regions = graph.planRegions.filter(r => r.kind === 'room' || r.kind === 'corridor' || r.kind === 'gallery').map(r => r.id);
  for (const id of regions) assert.ok(ids.includes(id), 'palace region ' + id + ' registered');
  for (const id of ['HALL', 'R3-01', 'R3-02', 'R3-03', 'OUT-START', 'OUT-GATE', 'OUT-MARKET', 'OUT-PLAZA', 'OUT-PALACE']) assert.ok(ids.includes(id), id);
  for (const a of hub.areas()) {
    assert.ok(a.ar && a.en && a.group, a.id + ' labelled');
    if (a.stage === 'palace') assert.ok(a.spawn.teleport, a.id + ' teleport');
  }
  assert.equal(hub.area('R3-02').stage, 'r3');
});

test('direct links are stable and absolute on request', () => {
  const { hub } = load();
  assert.equal(hub.link('K3'), '?dev=1&level=K3');
  assert.equal(hub.link('R3-01', true), 'http://localhost/index.html?dev=1&level=R3-01');
});

test('registry rejects duplicates and unknown stages', () => {
  const { hub } = load();
  assert.throws(() => hub.register({ id: 'K3', stage: 'palace' }));
  assert.throws(() => hub.register({ id: 'NEW', stage: 'moon' }));
  hub.register({ id: 'NEW-ROOM', group: 'kings', ar: 'غرفة', en: 'Room', stage: 'palace', spawn: { teleport: 'K1' } });
  assert.ok(hub.areas().some(a => a.id === 'NEW-ROOM'));
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
