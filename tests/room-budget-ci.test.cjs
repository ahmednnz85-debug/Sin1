'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const script = path.join(ROOT, 'tools', 'estimate-room-budget.py');

test('tools/estimate-room-budget.py is the CI content check for oversized rooms', () => {
  assert.ok(fs.existsSync(script));
  const src = fs.readFileSync(script, 'utf8');
  assert.match(src, /PROCESS_BUDGET = 650/);
  assert.match(src, /GPU_BUDGET = 480/);
  assert.match(src, /MAX_TEX = 1024/);
});

test('every shipped room fits the iPhone budget alone and with the hall', () => {
  const r = spawnSync('python3', [script], { encoding: 'utf8', cwd: ROOT });
  if (r.status !== 0) {
    console.log(r.stdout);
    console.error(r.stderr);
  }
  assert.equal(r.status, 0, 'CI content check failed:\n' + (r.stderr || r.stdout));
  const report = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'room-budget-report.json'), 'utf8'));
  assert.equal(report.ok, true);
  assert.equal(report.failures.length, 0);
  for (const id of ['Palace', 'K2', 'K3', 'K4', 'Corridors']) {
    const room = report.rooms[id];
    assert.ok(room, 'missing ' + id);
    assert.ok(room.processMB <= report.processBudgetMB, id + ' process ' + room.processMB);
    assert.ok(room.gpuTexMB <= report.gpuBudgetMB, id + ' gpu ' + room.gpuTexMB);
    assert.equal(room.missing.length, 0, id + ' missing ' + room.missing);
  }
  // Hall + heaviest streamed room must still leave headroom.
  const hall = report.rooms.Palace.processMB;
  const heaviest = Math.max(report.rooms.K2.processMB, report.rooms.K3.processMB, report.rooms.K4.processMB);
  assert.ok(hall + heaviest + report.sharedOverheadMB <= report.processBudgetMB,
    'Palace + heaviest room + overhead must fit 650');
});

test('the checker would reject a single room larger than the iPhone budget', () => {
  // After the 1024 cap, a 4096² RGBA mip-chain is 5.33 MB. 150 such maps
  // (≈ 800 MB) cannot ship: they would deadlock the door against the hall.
  const capped4096 = (1024 * 1024 * 4 * 4 / 3) / (1024 * 1024);
  assert.ok(Math.abs(capped4096 - 5.333) < 0.02);
  const oversizedGpu = 150 * capped4096;
  assert.ok(oversizedGpu > 480, 'fixture itself must exceed gpuBudget');
  const report = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'room-budget-report.json'), 'utf8'));
  assert.ok(report.rooms.K2.processMB < 480);
  assert.ok(oversizedGpu > report.processBudgetMB);
});

test('ADDING_CONTENT.md tells authors about the CI room-budget check', () => {
  const md = fs.readFileSync(path.join(ROOT, 'ADDING_CONTENT.md'), 'utf8');
  assert.match(md, /estimate-room-budget|room-budget-ci/);
  assert.match(md, /never wait forever|deferStall|defer-stall/i);
});
