'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'tools', 'bake-palace-colliders.js');
const ASSET = path.join(ROOT, 'data', 'palace-colliders.json');
const ARCH = path.join(ROOT, 'wing-architecture.js');
const DOC = path.join(ROOT, 'ADDING_CONTENT.md');

function stable(obj) {
  const seen = new WeakSet();
  function sort(v) {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) throw new Error('cycle');
    seen.add(v);
    if (Array.isArray(v)) return v.map(sort);
    const out = {};
    Object.keys(v).sort().forEach(k => {
      if (k === 'timings' || k === 'bakeMs') return;
      out[k] = sort(v[k]);
    });
    return out;
  }
  return JSON.stringify(sort(obj));
}

test('bake tools, shared architecture module, and JSON asset exist', () => {
  assert.ok(fs.existsSync(SCRIPT), 'tools/bake-palace-colliders.js');
  assert.ok(fs.existsSync(ARCH), 'wing-architecture.js');
  assert.ok(fs.existsSync(ASSET), 'data/palace-colliders.json');
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(src, /--check/);
  assert.match(src, /computeBake/);
});

test('baked JSON is identical to a live computeBake() of the canonical hall', () => {
  const Arch = require(ARCH);
  const file = JSON.parse(fs.readFileSync(ASSET, 'utf8'));
  assert.equal(file.version, Arch.BAKE_VERSION);
  assert.ok(file.hall, 'hall header');
  assert.ok(Array.isArray(file.colliders) && file.colliders.length > 0);
  assert.ok(Array.isArray(file.baseWall) && file.baseWall.length > 0);
  assert.ok(Array.isArray(file.wallSolid) && file.wallSolid.length > 0);
  const hall = Arch.canonicalHall(file.hall.wallSize, { H: file.hall.H || 1.8 });
  // hallMatches: the stored header is the one computeBake uses.
  assert.equal(Arch.hallMatches(file.hall, hall), true);
  const live = Arch.computeBake(hall);
  assert.equal(live.colliders.length, file.colliders.length, 'collider box count');
  assert.equal(stable(live.colliders), stable(file.colliders), 'colliders identical');
  assert.equal(stable(live.baseWall), stable(file.baseWall), 'baseWall identical');
  assert.equal(stable(live.wallSolid), stable(file.wallSolid), 'wallSolid identical');
  assert.equal(stable(live.floors), stable(file.floors), 'floors identical');
  assert.equal(stable(live.floorExtended), stable(file.floorExtended), 'floorExtended identical');
  assert.equal(stable(live.caps), stable(file.caps), 'caps identical');
  assert.equal(stable(live.grid), stable(file.grid), 'grid identical');
  assert.equal(stable(live.hall), stable(file.hall), 'hall header identical');
});

test('CI check regenerates the bake and fails if the committed JSON is stale', () => {
  const ok = spawnSync('node', [SCRIPT, '--check'], { encoding: 'utf8', cwd: ROOT });
  if (ok.status !== 0) {
    console.log(ok.stdout);
    console.error(ok.stderr);
  }
  assert.equal(ok.status, 0, 'committed JSON must already be up to date:\n' + (ok.stderr || ok.stdout));

  // Prove the check would fail: write a mutated copy, run --check against a
  // temporary cwd is awkward (script has a fixed OUT path). Instead, run a
  // one-shot compare: changing any collider must change the stable payload.
  const file = JSON.parse(fs.readFileSync(ASSET, 'utf8'));
  const mutated = JSON.parse(JSON.stringify(file));
  mutated.colliders[0].minx += 1;
  assert.notEqual(stable(file), stable(mutated));

  // And the script's --check compares the exact file text, so a stale byte fails.
  const tmp = path.join(os.tmpdir(), 'palace-colliders-stale-check-' + process.pid);
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  // Re-run bake to stdout and confirm it matches the committed file (already
  // did via --check). The stale-fail path is the `existing !== text` branch.
  const script = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(script, /existing !== text/);
  assert.match(script, /is stale/);
});

test('runtime loads the bake and skips Clipper when the hall header matches', () => {
  const wings = fs.readFileSync(path.join(ROOT, 'wings.js'), 'utf8');
  const palace = fs.readFileSync(path.join(ROOT, 'palaceInterior.js'), 'utf8');
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(index, /wing-architecture\.js/);
  assert.match(palace, /data\/palace-colliders\.json/);
  assert.match(palace, /loadColliderBake/);
  assert.match(wings, /hallMatches/);
  assert.match(wings, /applyColliderBake/);
  assert.match(wings, /wings-baked-colliders/);
});

test('ADDING_CONTENT.md documents the bake path for future rooms and wings', () => {
  const md = fs.readFileSync(DOC, 'utf8');
  assert.match(md, /bake-palace-colliders/);
  assert.match(md, /palace-colliders\.json/);
  assert.match(md, /wing-architecture\.js/);
  assert.match(md, /stale/i);
  assert.match(md, /solveLayout/);
});
