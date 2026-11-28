const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const root = path.join(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file));
const json = file => JSON.parse(read(file));

test('the owning module registers a sandbox entry in the single area registry', async () => {
  const globals = { URL, document: { baseURI:'http://localhost/index.html' } };
  globals.window = globals;
  vm.runInNewContext(read('sin-areas.js').toString(),globals);
  vm.runInNewContext(read('vfx-lab/area.js').toString(),globals);
  const area = await globals.SinAreas.get('VFX-LAB');
  assert.equal(area.source,'vfx-lab/area.js');
  assert.equal(typeof globals.SinAreas.sandboxFor(area.id),'function');
  assert.equal(globals.SinAreas.sandboxFor('U1-03'),undefined);
  assert.equal(globals.SinAreas.chapterOf(area.stage).boot,undefined);
});

test('packed atlases reference every checked-in original cutout and keep texture gutters', () => {
  const layout = json('vfx-lab/atlas-layout.json');
  let tiles = 0;
  for(const [name, section] of Object.entries(layout.sheets)) {
    const atlas = json(`vfx-lab/materials/${name}/regions.json`);
    const expected = section.rows.reduce((sum,row)=>sum+row.edges.length-1,0);
    assert.equal(atlas.tiles.length,expected);
    assert.equal(atlas.coverage,'straight alpha');
    assert.deepEqual(atlas.size,[1024,512]);
    assert.equal(atlas.gutter,8);
    assert.equal(atlas.regions.length,6);
    assert.equal(crypto.createHash('sha256').update(read(atlas.source)).digest('hex'),atlas.sourceSha256);
    const [w,h]=atlas.size;
    for(const [x,y,dw,dh] of atlas.regions) {
      assert.ok(x*w>=atlas.gutter && y*h>=atlas.gutter);
      assert.ok(x+dw<1 && y+dh<1);
    }
    tiles+=expected;
  }
  assert.equal(tiles,105);
});

test('presets describe real clips and guard all persistent controls', async () => {
  const {effects,demonstration}=await import('../vfx-lab/presets.mjs');
  const {normalizeSettings}=await import('../vfx-lab/manager.mjs');
  const clips = f => {
    const buffer=read(f);
    const document=JSON.parse(buffer.toString('utf8',20,20+buffer.readUInt32LE(12)));
    return new Map(document.animations.map(a=>[a.name,Math.max(...a.samplers.map(s=>document.accessors[s.input].max[0]))]));
  };
  const actors = {sin:clips('assets/Sin_hero_runtime.glb'),guardian:clips('assets/Guardian_of_the_Covenant.glb')};
  const values=Object.values(effects);
  assert.equal(values.length,20);
  for(const item of values){
    assert.ok(actors[item.actor].has(item.clip),item.clip);
    assert.ok(item.window[1]>item.window[0] && item.window[1]<actors[item.actor].get(item.clip));
  }
  assert.ok(demonstration.every(id=>effects[id]));
  const sanitized=normalizeSettings({speed:Infinity,density:999,color:'red',surface:'wall',quality:'bad',repeat:true});
  assert.equal(sanitized.speed,1);
  assert.equal(sanitized.density,1.55);
  assert.equal(sanitized.color,'#e4a05d');
  assert.equal(sanitized.surface,'wall');
  assert.equal(sanitized.quality,'auto');
  assert.equal(sanitized.repeat,true);
});
