const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { solveLayout } = require('../wing-architecture');
const layout = solveLayout(require('../data/palace-colliders.json').hall);
const room = layout.rooms.find(region => region.id === 'T2');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'purification-hall.js'), 'utf8'), context);
const { pools, stairTreads, localFloor, jetPoint, waterfall, bridgeHeight } = context.window.SinPurificationHall;

test('the temple route stays on the original T2 axis with both doorways unchanged', () => {
  const { x0, x1, z0, z1, cz } = room.bbox;
  assert.equal(x1-x0,20);
  assert.equal(z1-z0,16);
  assert.equal(room.height,8);
  const doors = layout.doors.filter(d => d.from==='T2'||d.to==='T2');
  assert.deepEqual(doors.map(d => d.id), ['TC12-T2','T2-TC23']);
  assert.deepEqual(doors.map(d => d.x), [x0-.5,x1+.5]);
  assert.ok(doors.every(d => d.axis==='x'&&d.z===cz&&d.width===4.5&&d.height===5.5));
  assert.ok(pools(room).every(b => b.l>-10&&b.r<10&&(b.f<=-2.25||b.n>=2.25)));
  const treads = stairTreads();
  for(let x=-10;x<=10;x+=.25) for(const z of [-2,0,2]) assert.equal(localFloor(x,z,treads),0);
  assert.ok(bridgeHeight>2.65);
});

test('both side platforms are reached over four shallow steps', () => {
  const treads = stairTreads();
  for(const side of [-1,1]) {
    const heights = [5.22,5.39,5.87,6.32,6.84].map(x => localFloor(x,side*5.93,treads));
    assert.equal(new Set(heights).size,4);
    assert.ok(heights[0]>.16&&heights[0]<.18);
    assert.equal(heights[3],heights[4]);
    assert.ok(heights[4]>.68&&heights[4]<.70);
  }
});

test('both spouts fall within the open bath volumes and the raised fall has dry headroom', () => {
  for(const side of [-1,1]) {
    const p = pools(room)[side<0?0:1];
    const a = jetPoint(0,.36,1.22,side*6.90,side,1.32);
    const b = jetPoint(1,.36,1.22,side*6.90,side,1.32);
    assert.equal(a[1],1.22);
    assert.ok(Math.abs(b[1]-p.level)<1e-6);
    assert.ok(b[0]>p.l&&b[0]<p.r&&b[2]>p.n&&b[2]<p.f);
  }
  assert.ok(waterfall.lip>waterfall.landing);
  assert.ok(waterfall.top>waterfall.bottom&&waterfall.bottom>waterfall.bed&&waterfall.bed>bridgeHeight);
});
