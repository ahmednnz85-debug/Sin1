const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {read,save,scenes,phases} = require('../lunar-discoveries.js');

function memory(initial) {
  let value = initial;
  return {getItem:()=>value,setItem:(key,v)=>{assert.equal(key,'sin.lunarClues');value=v;}};
}

test('lunar progress persists in any order, preserves other clues and rejects corrupt data', () => {
  const storage=memory('not valid JSON');
  assert.deepEqual(read(storage),{k3NewMoon:false,l2MoonPhases:false,t4MoonSeal:false});
  save(storage,'t4MoonSeal');
  save(storage,'k3NewMoon');
  assert.deepEqual(read(storage),{k3NewMoon:true,l2MoonPhases:false,t4MoonSeal:true});
  save(storage,'l2MoonPhases');
  assert.deepEqual(Object.values(read(storage)),[true,true,true]);
  assert.deepEqual(read(memory('{"k3NewMoon":"true"}')), {k3NewMoon:false,l2MoonPhases:false,t4MoonSeal:false});
});

test('archive highlights are measured across all eight ordered phases and Arabic captions match', () => {
  assert.equal(phases.length,8);
  phases.slice(1).forEach((center,i)=>assert.ok(center>phases[i]));
  assert.equal(scenes.K3.text,'من ظلام القمر تبدأ دورة الأختام الثمانية.');
  assert.equal(scenes.L2.text,'ثمانية أوجهٍ للقمر، من الظلام إلى الاكتمال، ثم العودة إلى الظلام.');
  assert.equal(scenes.T4.text,'حين تكتمل أطوار القمر الثمانية، أيقظ ختم سين في قلب الباب.');
});

test('a K3 scene triggers only near the front, restores its camera on interruption and saves once on completion', () => {
  class Vector {
    constructor(x=0,y=0,z=0){this.set(x,y,z);}
    set(x,y,z){Object.assign(this,{x,y,z});return this;}
    clone(){return new Vector(this.x,this.y,this.z);}
    copy(v){return this.set(v.x,v.y,v.z);}
    lerp(v,t){return this.set(this.x+(v.x-this.x)*t,this.y+(v.y-this.y)*t,this.z+(v.z-this.z)*t);}
  }
  class Rotation {
    clone(){return new Rotation();}
    copy(){return this;}
    slerp(){return this;}
  }
  class Camera {
    constructor(){this.position=new Vector(4,2,0);this.quaternion=new Rotation();this.fov=46;}
    lookAt(){}
    updateProjectionMatrix(){}
  }
  const window={};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lunar-discoveries.js'),'utf8'),{
    window,THREE:{Vector3:Vector,PerspectiveCamera:Camera},performance:{now:()=>10}
  });
  const storage=memory(), camera=new Camera(), subtitle={style:{}}, classList=new Set();
  const body={classList:{add:k=>classList.add(k),remove:k=>classList.delete(k)}};
  const controller=window.SinLunarDiscoveries.create({camera,subtitle,body,storage,onEnter:()=>{}});
  const uniforms=Object.fromEntries(['Clock','Reveal','Phase','Dust','Seal'].map(k=>['lunar'+k,{value:0}]));
  const clue={id:'K3',height:.65,edge:.22,axis:0,trigger:{min:.4,max:1,half:.6,maxY:.5},uniforms,
    frame:{position:{y:0},worldToLocal:v=>v,localToWorld:v=>v}};
  const hero={position:new Vector(0,0,3),rotation:{y:Math.PI}};
  controller.advance(.05,clue,hero,true);
  assert.equal(controller.active(),false);
  hero.position.z=.7;hero.rotation.y=0;
  controller.advance(.05,clue,hero,true);
  assert.equal(controller.active(),false);
  hero.rotation.y=Math.PI;
  controller.advance(.08,clue,hero,true);
  assert.equal(controller.active(),true);
  assert.ok(classList.has('lunar-cinematic'));
  assert.equal(typeof controller.skip,'undefined');
  controller.advance(.07,null,hero,false);
  assert.equal(controller.active(),false);
  assert.deepEqual(camera.position,new Vector(4,2,0));
  assert.equal(read(storage).k3NewMoon,false);
  hero.position.z=3;controller.advance(.05,clue,hero,true);
  hero.position.z=.7;
  for(let i=0;i<150;i++)controller.advance(.08,clue,hero,true);
  assert.equal(controller.active(),false);
  assert.equal(read(storage).k3NewMoon,true);
  assert.equal(camera.fov,46);
  assert.equal(subtitle.textContent,'');
  controller.advance(.05,clue,hero,true);
  assert.equal(controller.active(),false);
});
