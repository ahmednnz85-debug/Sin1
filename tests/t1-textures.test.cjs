const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { solveLayout } = require('../wing-architecture');

const root = path.join(__dirname,'..');
const layout = solveLayout(require('../data/palace-colliders.json').hall);
const context = { window:{} };
vm.runInNewContext(fs.readFileSync(path.join(root,'t1-entrance.js'),'utf8'),context);
const { assets, expected, treads, stairFloor, halfStair, maxStep } = context.window.SinT1Entrance;

test('T1 uses the uploaded GLB and atlases under their exact repository paths', ()=>{
  assert.equal(assets.length,4);
  for(const file of assets) assert.ok(fs.statSync(path.join(root,file)).size>1000,file);
  assert.equal(fs.readFileSync(path.join(root,assets[0])).readUInt32LE(0),0x46546c67);
  assert.ok(expected.includes('T1-portal-band'));
  assert.ok(expected.includes('T1-hanging-bowl'));
  assert.ok(expected.includes('T1-casting'));
  assert.ok(expected.includes('T1-flames')&&expected.includes('T1-smoke'));
});

test('T1 remains connected through both original corridors and the palace arch', ()=>{
  const room=layout.rooms.find(r=>r.id==='T1');
  assert.ok(Math.abs(room.bbox.x1-room.bbox.x0-16)<1e-6);
  assert.equal(room.bbox.z1-room.bbox.z0,12);
  assert.equal(room.height,8.5);
  const portals=layout.doors.filter(d=>d.from==='T1'||d.to==='T1');
  assert.deepEqual(portals.map(d=>d.id),['PalaceR3','T1-TR1','T1-TC12']);
  assert.ok(layout.links.some(([a,b])=>a==='TC12'&&b==='T2'));
  assert.ok(portals.find(d=>d.id==='T1-TC12').width<2*halfStair);
});

test('the stair climbs to the arch and descends gently to the unchanged T2 floor', ()=>{
  const samples=[stairFloor(2,0),...treads.map(([a,b])=>stairFloor((a+b)*.5,0)),stairFloor(7.8,0)];
  assert.ok(samples[4]>.6);
  assert.equal(samples[0],0);
  assert.equal(samples.at(-1),0);
  for(let i=1;i<samples.length;i++) assert.ok(Math.abs(samples[i]-samples[i-1])<maxStep);
  assert.equal(stairFloor(4.45,halfStair+.04),0);
  assert.equal(stairFloor(0,5.8),0);
});
