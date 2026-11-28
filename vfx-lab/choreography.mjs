import '../sin-combat.js';
import { effects, combo, demonstration } from './presets.mjs';

const T = window.THREE;
const C = window.SinCombat;
const EPSILON = .036;
const STEP = 1/120;
const clamp = (n,a,b) => Math.min(b,Math.max(a,n));
const smooth = t => { t=clamp(t,0,1);return t*t*(3-2*t); };
const vec = () => new T.Vector3();
const cap = (a,b,radius) => ({ a,b,radius });

export function createActor(gltf, name, size, idle) {
  const model = gltf.scene;
  const nodes = new Map();
  let skin;
  model.traverse(o => {
    if(o.name)nodes.set(o.name,o);
    if(o.isSkinnedMesh) {
      skin=skin||o.parent;
      o.frustumCulled=false;
    }
  });
  const body = name==='guardian' ? nodes.get('Guardian_Skinned_Body') : skin;
  const bounds = new T.Box3().setFromObject(body || model,true);
  const scale = size/Math.max(.3,bounds.max.y-bounds.min.y);
  model.scale.setScalar(scale);
  model.position.y=-bounds.min.y*scale;
  const root = new T.Group();
  root.name = name==='guardian' ? 'VFXLabGuardian' : 'VFXLabSin';
  root.add(model);
  const mixer = new T.AnimationMixer(model);
  const clips = new Map(gltf.animations.map(clip=>[clip.name,clip]));
  let previous, clip;
  function pose(name,time) {
    if(!clips.has(name)) throw new Error('حركة غير موجودة في الأصل: '+name);
    if(previous !== name) {
      mixer.stopAllAction();
      clip=mixer.clipAction(clips.get(name)).reset().setLoop(T.LoopOnce,1).play();
      clip.clampWhenFinished=true;
      clip.paused=true;
      previous=name;
    }
    clip.time=clamp(time,0,clips.get(name).duration-.00001);
    mixer.update(0);
    root.updateMatrixWorld(true);
  }
  return {
    root, nodes, model, pose, idle, mixer,
    length: name => clips.get(name)?.duration || 0,
    point(name,out){ return nodes.get(name)?.getWorldPosition(out) || out.copy(root.position); }
  };
}

export function choreograph({ scene, sin, guardian, fx, fixture, focus, settings }) {
  const actors={sin,guardian};
  const contacts=[], roots=Object.keys(actors);
  const volumes = {
    guardian:[['Pelvis','body_hit',.53],['Thigh_L','Foot_L',.32],['Thigh_R','Foot_R',.32],
      ['UpperArm_L','Hand_L',.24],['UpperArm_R','Hand_R',.24],['head_hit','head_hit',.26]],
    sin:[['pelvis','spine_03',.24],['head','head',.21],['thigh_l','calf_l',.19],
      ['thigh_r','calf_r',.19],['upperarm_l','hand_l',.17],['upperarm_r','hand_r',.17]]
  };
  const clawTrace=['Index_03_L','Middle_03_L','Ring_03_L','claw_l'];
  const points=Array.from({length:4},vec);
  const prev=Array.from({length:4},vec);
  const guardPoints=Array.from({length:4},vec);
  const touch=vec(), oldLow=vec(), low=vec(), d=vec(), norm=vec(), midpoint=vec();
  const contactsByActor=Object.fromEntries(roots.map(name=>[name,volumes[name].map(()=>cap(vec(),vec(),0))]));
  const weaponVolumes=[cap(vec(),vec(),.075),cap(vec(),vec(),.075),cap(vec(),vec(),.075)];
  const profiles = { axe:.082, blade:.14, crown:.19, claw:.15 };
  const calibrations=new Map();
  let run, recipeId, at=0, elapsed=0, done=true, activeList=[], index=0, marker=0, quiet=0;
  let reacted=false, seen=false, validPrev=false, sequence = 'single', lastSummary=null, currentSurface='auto';
  let contactType, ideal, receiver, attacker, idleStyle, idleTime=0, transition=null;
  const impactVelocity=vec();

  function rootAt(actor,x,z,face) {
    actor.root.position.set(x,0,z);
    actor.root.rotation.y=face;
    actor.root.updateMatrixWorld(true);
  }
  function activeActor(preset) {
    return [actors[preset.actor],actors[preset.actor==='sin'?'guardian':'sin']];
  }
  function positions(part, actor, out) {
    if (part==='claw') {
      out.forEach((v,i)=>actor.point(clawTrace[i],v));
    } else fx.sample(part,out);
  }
  function lowest(part, actor, out) {
    if(part==='blade' && actor===guardian) {
      actor.point('staff_blade',out);
      // Use the authored lower-blade marker and the visible, sampled rim.
      const rim=fx.lowest(part,midpoint);
      if(rim && rim.y<out.y)out.copy(rim);
      return out;
    }
    return fx.lowest(part,out);
  }
  function readVolumes(name,actor) {
    const result=contactsByActor[name];
    volumes[name].forEach(([a,b,r],i)=>{
      const v=result[i];
      v.radius=r;
      actor.point(a,v.a);actor.point(b,v.b);
    });
    return result;
  }
  function parryTarget() {
    fx.sample('axe',guardPoints);
    weaponVolumes.forEach((v,i)=>{v.a.copy(guardPoints[i]);v.b.copy(guardPoints[i+1]);});
    return weaponVolumes;
  }
  function sweep(part, list, a=prev, b=points) {
    for (let i=0;i<3;i++){
      const volume=C.sweep(a[i],a[i+1],b[i],b[i+1],profiles[part],list,touch);
      if(volume) return volume;
    }
    return null;
  }
  function setPose(p,t) {
    const direction=p.actor==='sin'?1:-1;
    const distance=p.advance || 0;
    attacker.root.position.z=direction*distance*smooth((t-.66)/1.18);
    attacker.pose(p.clip,t);
    if(!reacted)receiver.pose(idleStyle,idleStyle==='km_dodge_back'?.015:.19);
  }
  function calibrate(p, surface) {
    const key=[p.clip,p.channel,surface].join('/');
    if(calibrations.has(key))return calibrations.get(key);
    const [source,target]=activeActor(p);
    const direction=p.actor==='sin'?1:-1;
    const yaw=p.actor==='sin'?0:Math.PI;
    rootAt(source,0,0,yaw);
    rootAt(target,0,0,yaw+Math.PI);
    const guard=surface==='parry';
    target.pose(guard?'km_dodge_back':target.idle, guard?.015:.19);
    const fallback={x:0,z:1.78*direction};
    if(surface==='none'||surface==='seal')return fallback;
    if(surface==='stone'||surface==='wall') {
      let minHeight=Infinity;
      let frame, min;
      for(let t=p.window[0];t<=p.window[1]+.0001;t+=STEP) {
        source.root.position.z=direction*(p.advance || 0)*smooth((t-.66)/1.18);
        source.pose(p.clip,t);
        if(surface==='wall') {
          positions(p.channel,source,points);
          low.copy(points[2]);
        } else if(!lowest(p.channel,source,low))continue;
        if(low.y<minHeight){minHeight=low.y;min=low.clone();frame=t;}
      }
      if(!min)return fallback;
      const plane=surface==='wall' ? Math.max(.42,Math.abs(min.z)-.08)*direction :
        Math.max(0,Math.ceil((min.y+.028)*20)/20);
      const best={...fallback,plane,frame,point:min,fixture:surface==='wall'?'wall':plane>.025?'ledge':'floor'};
      calibrations.set(key,best);
      return best;
    }
    const targetName=p.actor==='sin'?'guardian':'sin';
    const base=guard?parryTarget():readVolumes(targetName,target);
    const collision=base.map(v=>cap(vec(),vec(),v.radius));
    const sampled=[];
    for(let t=p.window[0]-STEP;t<p.window[1]+.0001;t+=STEP) {
      source.pose(p.clip,Math.max(0,t));
      positions(p.channel,source,points);
      sampled.push(points.map(v=>v.clone()));
    }
    let best=null, bestScore=Infinity;
    // Search the stage layout once per clip and material. Every candidate uses
    // the authored weapon trajectory and target geometry. No runtime homing.
    for(let x=-1.65;x<=1.66;x+=.15)for(let range=1.05;range<=3.55;range+=.13) {
      const z=range*direction;
      const score=Math.abs(x)*.75+Math.abs(range-(p.actor==='sin'?1.37:1.98))*.53;
      if(score>=bestScore)continue;
      base.forEach((v,i)=>{
        const test=collision[i];
        test.a.copy(v.a);test.b.copy(v.b);
        test.a.x+=x;test.b.x+=x;test.a.z+=z;test.b.z+=z;
      });
      for(let i=1;i<sampled.length;i++){
        if(sweep(p.channel,collision,sampled[i-1],sampled[i])) {
          best={x,z};bestScore=score;break;
        }
      }
    }
    const result=best || fallback;
    calibrations.set(key,result);
    return result;
  }
  function chooseSurface(p,value) {
    if(value==='auto'||p.contact==='parry'||p.contact==='seal'||p.contact==='none')return p.contact;
    return value;
  }
  function prepare(id,preset) {
    const route=sequence==='demo'&&index>1?[sin,guardian].map(actor=>({
      actor,from:actor.root.position.clone(),yaw:actor.root.rotation.y
    })):null;
    [attacker,receiver]=activeActor(preset);
    currentSurface=settings.surface;
    contactType=chooseSurface(preset,currentSurface);
    ideal=calibrate(preset,contactType);
    const yaw=preset.actor==='sin'?0:Math.PI;
    rootAt(attacker,0,0,yaw);
    rootAt(receiver,ideal.x,ideal.z,yaw+Math.PI);
    idleStyle=contactType==='parry'?'km_dodge_back':receiver.idle;
    fixture(ideal.fixture,ideal.point,ideal.plane);
    at=marker=quiet=0;seen=reacted=validPrev=false;
    setPose(preset,0);
    if(route){
      for(const node of route){
        node.to=node.actor.root.position.clone();
        node.goal=node.actor.root.rotation.y;
        node.actor.root.position.copy(node.from);
        node.actor.root.rotation.y=node.yaw;
      }
      transition={actors:route,t:0,duration:.38};
    } else transition=null;
    if(focus)focus(attacker,receiver,ideal);
    recipeId=id;
  }
  function next() {
    if(index>=activeList.length) {
      if(settings.repeat) { index=0; return next(); }
      done=true;lastSummary={mode:sequence,events:contacts.length,id:recipeId};return;
    }
    run=activeList[index++];
    prepare(run.id,run.p);
  }
  function play(id) {
    if(!effects[id])throw new Error('المؤثر غير مسجّل');
    contacts.length=0;
    fx.clear();
    done=false;elapsed=0;index=0;
    sequence=effects[id].sequence?'combo':'single';
    activeList=effects[id].sequence?combo.map(([clip,window,charge])=>({id,p:{...effects[id],clip,window,charge}})):
      [{id,p:effects[id]}];
    next();
  }
  function demo() {
    contacts.length=0;
    fx.clear();
    done=false;elapsed=0;index=0;sequence='demo';
    activeList=demonstration.flatMap(id=>effects[id].sequence?
      combo.map(([clip,window,charge])=>({id,p:{...effects[id],clip,window,charge}})):[{id,p:effects[id]}]);
    next();
  }
  function finishContact(p,point,normal,velocity, type=contactType) {
    seen=true;
    const hitError = point.toArray();
    const originHeight = type==='stone' ? ideal.plane : undefined;
    const result=fx.play(recipeId,{worldPosition:point,surfaceNormal:normal,direction:velocity,
      groundHeight:originHeight,surfaceType:type,kind:type==='seal'?'marker':'impact',
      decalScale:ideal.fixture==='ledge'?.64:ideal.fixture==='wall'?.63:1});
    contacts.push({ ...result,clip:p.clip, frame:Math.round(at/STEP),clipTime:+at.toFixed(4), sampled:hitError });
    if(type==='armor'||type==='flesh'||type==='metal') {
      reacted = true;
      receiver.pose(receiver===sin?'fall':'Hit_Light_Front',0);
      quiet = at;
    } else if(type==='parry') {
      reacted=true;
      attacker.pose('Stagger',.04);
      quiet=at;
    }
  }
  function ground(p) {
    const placed=ideal.plane??0;
    if(contactType==='wall') {
      const sign=Math.sign(placed)||1;
      for(const [i,point] of points.entries()){
        const previous=prev[i];
        if((previous.z-placed)*sign>.02 || (point.z-placed)*sign<-.03)continue;
        const f=clamp((placed-previous.z)/((point.z-previous.z)||.001),0,1);
        touch.copy(previous).lerp(point,f);
        touch.z=placed;
        finishContact(p,touch,norm.set(0,0,-sign),impactVelocity.subVectors(point,previous));
        return;
      }
    } else if(low.y<=placed+EPSILON && low.y>=placed-.21) {
      let point=low;
      if(oldLow.y>placed && low.y<placed){
        const f=(oldLow.y-placed)/(oldLow.y-low.y);
        point=touch.copy(oldLow).lerp(low,f);
      }
      finishContact(p,touch.copy(point).setY(placed),norm.set(0,1,0),impactVelocity.subVectors(low,oldLow));
    }
  }
  function step(dt) {
    if(done){
      for(const part of ['axe','blade','crown'])fx.weapon(part,0,dt);
      if(!run) {
        idleTime+=dt;
        for(const actor of [sin,guardian])actor.pose(actor.idle,idleTime%actor.length(actor.idle));
      }
      fx.tick(dt);
      return;
    }
    const p=run.p;
    elapsed+=dt;
    if(transition){
      transition.t+=dt;
      const progress=smooth(transition.t/transition.duration);
      for(const entry of transition.actors) {
        const actor=entry.actor;
        const length=entry.from.distanceTo(entry.to);
        actor.root.position.lerpVectors(entry.from,entry.to,progress);
        const angle=Math.atan2(Math.sin(entry.goal-entry.yaw),Math.cos(entry.goal-entry.yaw));
        actor.root.rotation.y=entry.yaw+angle*progress;
        actor.pose(length>.18?(actor===sin?'walk_casual':'Walk_Forward'):actor.idle,transition.t);
      }
      for(const part of ['axe','blade','crown'])fx.weapon(part,0,dt);
      fx.tick(dt);
      if(progress>=1){transition=null;setPose(p,0);}
      return;
    }
    at+=dt;
    if(reacted && contactType==='parry')attacker.pose('Stagger',Math.max(0,at-quiet));
    else setPose(p,at);
    if(reacted && contactType!=='parry')receiver.pose(receiver===sin?'fall':'Hit_Light_Front',Math.max(0,at-quiet));

    const [from,to]=p.window;
    const leading=smooth((at-from+p.charge)/p.charge);
    const trailing=1-smooth((at-to)/.21);
    const power=leading*trailing*p.strength;
    fx.weapon('axe',p.channel==='axe'?power:0,dt);
    fx.weapon('blade',p.channel==='blade'?power:0,dt);
    fx.weapon('crown',p.channel==='crown'?power:0,dt);
    const close=at>=from && at<=to+dt;
    if(p.channel==='seal') {
      if(at>=from-p.charge && at<from && at>=marker) {
        marker=at+(p.aura?.12:.23);
        fx.play(recipeId,{weaponSocket:guardian.nodes.get('chest_seal'),surfaceType:'spirit',
          intensity:.34+.3*leading,kind:'charge',scale:.46});
      }
      if(!seen && close)finishContact(p,guardian.point('chest_seal',touch),norm.set(0,1,0),d.set(0,.4,-1),'seal');
    } else {
      positions(p.channel,attacker,points);
      if(p.channel==='claw')fx.traceRibbon('claw',points,power,dt);
      if(contactType==='stone')lowest(p.channel,attacker,low);
      if(validPrev && !seen && close) {
        if(contactType==='stone'||contactType==='wall')ground(p);
        else if(contactType!=='none') {
          const targetName=p.actor==='sin'?'guardian':'sin';
          const list=contactType==='parry'?parryTarget():readVolumes(targetName,receiver);
          const hit=sweep(p.channel,list);
          if(hit){
            impactVelocity.subVectors(points[2],prev[2]);
            norm.copy(touch).sub(hit.b).normalize();
            finishContact(p,touch,norm,impactVelocity);
          }
        }
      }
      if(p.channel==='claw'&&power>.36 && at>=marker) {
        marker=at+.076;
        fx.play(recipeId,{weaponSocket:guardian.nodes.get('claw_l'),surfaceType:'spirit',intensity:.21,scale:.36,kind:'charge'});
      }
      points.forEach((v,i)=>prev[i].copy(v));
      oldLow.copy(low);validPrev=true;
    }
    if(p.channel==='seal') {
      for(const entry of sealMeshes) entry.material.emissiveIntensity=entry.base*(.38+power*.94);
    }
    fx.tick(dt);
    const duration=p.windupOnly ? from+.14 : attacker.length(p.clip);
    if(at>=duration+(sequence==='single'?.93:.1)){
      for(const entry of sealMeshes)entry.material.emissiveIntensity=entry.base;
      next();
    }
  }
  const sealMeshes=[];
  guardian.model.traverse(node=>{
    const material=node.material;
    if(!node.isMesh||!material?.name?.endsWith('_Emission')||material.name.includes('Staff'))return;
    node.material=material.clone();
    sealMeshes.push({material:node.material,base:node.material.emissiveIntensity});
  });
  const start=()=> {
    rootAt(sin,-.43,-1.12,0);rootAt(guardian,.43,1.06,Math.PI);
    sin.pose(sin.idle,0);guardian.pose(guardian.idle,0);
    fixture();
  };
  start();
  return {
    step,play,demo,hold(part){ fx.preview(part); },
    async prepareContacts(){
      const candidates=Object.values(effects).filter(p=>['armor','metal','parry','stone','flesh'].includes(p.contact));
      for(const p of candidates){
        await new Promise(resolve=>requestAnimationFrame(resolve));
        calibrate(p,p.contact);
      }
      for(const [clip,window,charge] of combo.slice(1))calibrate({...effects.SIN_AXE_COMBO_TRAIL,clip,window,charge},'armor');
      start();
      return calibrations.size;
    },
    reset(){ fx.clear();fx.preview('');contacts.length=0;done=true;lastSummary=null;run=transition=null;at=elapsed=idleTime=0;start(); },
    state(){return {id:recipeId,mode:sequence,time:+elapsed.toFixed(3),clipTime:+at.toFixed(3),
      clip:run?.p.clip,window:run?.p.window,surface:contactType,plan:ideal?.fixture||null,done,
      hitCount:contacts.length, contacts:contacts.slice(), summary:lastSummary};}
  };
}
