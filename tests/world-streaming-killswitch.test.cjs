/* Kill-switch and "visible is sacred" verification.
   Runs the real world-streaming.js in a sandboxed global, so the flag paths are
   proven rather than assumed. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'world-streaming.js'), 'utf8');
const Core = require('../world-streaming-core.js');

function boot(search, opts) {
  const win = {};
  if (!(opts && opts.core === false)) win.SinStreamingCore = Core;
  if (opts && opts.visibility) win.SinWingVisibility = require('../wing-visibility.js');
  const fn = new Function('window', 'location', 'performance', 'URLSearchParams', 'console', 'THREE', SRC);
  fn(win, { search }, { now: () => (opts && Number.isFinite(opts.now) ? opts.now : 0) },
    URLSearchParams, { info() { }, warn() { }, error() { } },
    { Vector3: class { constructor() { this.x = 0; this.y = 0; this.z = 0; } getWorldDirection() { } } });
  return win;
}

test('?streaming=0 disables the system entirely (exact baseline path)', () => {
  const ctx = boot('?streaming=0');
  assert.equal(ctx.SinWorldStreaming, null);
});

test('?streaming=1 exposes the API and the platform profile', () => {
  const ctx = boot('?streaming=1');
  assert.ok(ctx.SinWorldStreaming);
  const s = ctx.SinWorldStreaming.stats();
  assert.ok(s.profile.geometryBudget > 0);
  assert.ok(s.profile.cacheSlots > 0);
});

test('refine() keeps every visible region prepared and never returns less', () => {
  const ctx = boot('?streaming=1');
  const visible = new Set(['K2', 'K3']);
  const out = ctx.SinWorldStreaming.refine({
    visible, prepared: new Set(['K2']),
    meta: new Map([['K2', { hops: 0, distance: 1 }], ['K3', { hops: 1, distance: 9 }]]),
    regions: [], links: [], origin: 'K2',
    regionGroups: new Map(),
    hero: { position: { x: 0, z: 0 } }, camera: null, renderer: null, now: 16
  });
  assert.ok(out instanceof Set);
  visible.forEach(id => assert.ok(out.has(id), 'visible region dropped: ' + id));
});

test('under critical memory pressure the tail is trimmed but visible stays', () => {
  const ctx = boot('?streaming=1');
  const visible = new Set(['K2', 'K3']);
  const prepared = new Set(visible);
  for (let i = 0; i < 12; i++) prepared.add('X' + i);
  const meta = new Map();
  prepared.forEach((id, i) => meta.set(id, { hops: i % 6, distance: i * 5 }));
  const out = ctx.SinWorldStreaming.refine({
    visible, prepared, meta,
    regions: [], links: [], origin: 'K2',
    regionGroups: new Map(),
    hero: { position: { x: 0, z: 0 } }, camera: null,
    renderer: { info: { memory: { geometries: 9000, textures: 9000 } } },
    now: 32
  });
  const st = ctx.SinWorldStreaming.stats();
  assert.equal(st.budget.level, 'critical');
  assert.ok(out.size < prepared.size, 'budget must trim the tail');
  visible.forEach(id => assert.ok(out.has(id), 'visible must survive trimming: ' + id));
});

test('integration is purely additive: no pre-existing line was removed', () => {
  const out = execFileSync('git', ['diff', '--numstat', 'baseline-r187', '--', 'wings.js', 'index.html'],
    { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
  assert.ok(out.length === 2, 'expected two touched files, got: ' + out.join(' | '));
  out.forEach(line => {
    const [add, del, file] = line.split('\t');
    assert.equal(Number(del), 0, file + ' removed ' + del + ' lines — the game would change');
    assert.ok(Number(add) > 0, file + ' shows no change');
  });
});
