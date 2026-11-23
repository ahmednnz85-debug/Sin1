/* Sîn review controller — single AnimationMixer, 70-bone hero, no duplicated axe.
   The world owns collision, moving the hero root, camera and damage.
   GLB axeHolster metadata owns switching timestamps and socket offsets. */
(function(){
'use strict';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
window.SinReviewGameplay={create({THREE,model,mixer,animations,gltf}){
  const byName=new Map(animations.map(c=>[c.name,c]));
  const names={idle:'idle_impatient',walk:'walk_casual',run:'sprint_loop_quaternius',
    combatIdle:'Axe_CombatIdle',light:'Attack_Right',follow:'Attack_Left',
    heavy:'Finisher_Heavy',slam:'Finisher_Jump',dodge:'km_dodge_back',
    draw:'Axe_Equip',sheath:'Axe_Unequip',push:'push_object'};
  const meta=gltf?.parser?.json?.scenes?.[0]?.extras?.axeHolster||model.userData?.axeHolster||{};
  const axe=model.getObjectByName('Axe');
  const back=model.getObjectByName('Axe_Back_Socket');
  const hand=model.getObjectByName('Axe_RightHand_Socket');
  const handBone=model.getObjectByName('weapon_r');
  const working=!!(axe&&back&&hand&&handBone&&byName.has(names.draw)&&byName.has(names.sheath));
  const arm=new Set(meta.clipsMeta?.Axe_Equip?.layerBones || ['clavicle_r','upperarm_r','lowerarm_r','lowerarm_twist_01_r','hand_r','index_01_r','index_02_r','index_03_r','middle_01_r','middle_02_r','middle_03_r','pinky_01_r','pinky_02_r','pinky_03_r','ring_01_r','ring_02_r','ring_03_r','thumb_01_r','thumb_02_r','thumb_03_r']);
  const getNode=t=>t.name.slice(0,t.name.lastIndexOf('.'));
  const lower=new Map(),upper=new Map();
  function filtered(source,mode,suffix){
    if(!source)return null;
    return new THREE.AnimationClip(source.name+'__'+suffix,source.duration,source.tracks.filter(t=>{
      const n=getNode(t);
      if(n==='Axe')return false;
      if(mode==='lower')return !arm.has(n)&&n!=='Axe_RightHand_Socket';
      if(mode==='upper')return arm.has(n);
      return true;
    }));
  }
  for(const k of ['idle','walk','run']){
    lower.set(k,filtered(byName.get(names[k]),'lower',k+'-lower'));
  }
  const combatUpper=filtered(byName.get(names.combatIdle),'upper','combat-upper');
  const drawClip=filtered(byName.get(names.draw),'axe','draw-no-axe');
  const sheathClip=filtered(byName.get(names.sheath),'axe','sheath-no-axe');
  const actions=new Map();
  function action(clip,loop){
    if(!clip)return null;
    let a=mixer.clipAction(clip);a.enabled=true;a.setEffectiveTimeScale(1);
    a.setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);
    a.clampWhenFinished=!loop;
    return a;
  }
  let base=null,baseKey='',layer=null,upperHold=null,attack=null,push=null,weapon=working?'BACK':'UNAVAILABLE',transition=null;
  let canAct=false,moving=false,running=false,guard=false,walkScale=1.5,quiet=0,queuedAttack=null,combo=0,hitFired=false;
  let progress=0,mode='idle';
  function stop(a,t=.12){if(a){try{a.fadeOut(t);}catch(_){a.stop();}}}
  function start(clip,loop=true,fade=.13){
    const a=action(clip,loop);if(!a)return null;a.reset();a.setEffectiveWeight(1);a.setEffectiveTimeScale(1);a.play();
    if(fade)a.fadeIn(fade);return a;
  }
  function parentAxe(node,tr,world=false){
    if(!working)return;
    if(world&&node.attach){model.updateMatrixWorld(true);node.attach(axe);return;}
    node.add(axe);
    if(tr){axe.position.fromArray(tr.translation);axe.quaternion.fromArray(tr.rotation);axe.scale.fromArray(tr.scale||[1,1,1]);}
  }
  if(working)parentAxe(back,meta.attach?.back);
  function setBase(key,masked){
    const id=key+(masked?'_masked':'');
    if(id===baseKey)return;
    const c=masked?lower.get(key):byName.get(names[key]);
    if(!c)return;
    const prev=base;
    base=start(c,true,prev?.13:0);
    if(base&&key==='walk')base.setEffectiveTimeScale(walkScale);
    baseKey=id;
    if(prev&&prev!==base)stop(prev,.13);
  }
  function setUpperHold(v){
    if(v&&!upperHold&&combatUpper)upperHold=start(combatUpper,true,.1);
    if(!v&&upperHold){stop(upperHold,.1);upperHold=null;}
  }
  function playAttack(k){
    if(!canAct||!!transition||!!push)return false;
    const clip=byName.get(names[k]);if(!clip)return false;
    if(attack){if(progress<attack.clip.duration*.62)return false;stop(attack.action,.1);}
    setUpperHold(false);stop(layer,.08);layer=null;
    const a=start(clip,false,.1);if(!a)return false;
    attack={key:k,action:a,clip,hit:clip.extras?.combat?.hitWindow||null};
    progress=0;mode='attack';hitFired=false;quiet=0;
    return true;
  }
  function drawOrSheath(next){
    if(!working||transition||push||attack||!canAct)return false;
    if(next==='DRAWING'&&weapon!=='BACK')return false;
    if(next==='SHEATHING'&&weapon!=='HAND')return false;
    if(next==='SHEATHING')setUpperHold(false);
    const type=next==='DRAWING'?'draw':'sheath';
    const clip=type==='draw'?drawClip:sheathClip;
    layer=start(clip,false,.02);if(!layer)return false;
    transition={type,t:0,switched:false};
    weapon=next;quiet=0;mode='transition';
    return true;
  }
  function switchSocket(which,live){
    if(which==='HAND')parentAxe(hand,meta.attach?.hand,!!live);
    else parentAxe(back,meta.attach?.back,!!live);
  }
  function attackRequest(k){
    k= k==='counter'?'light':k==='airpunch'?'heavy':k;
    if(weapon==='BACK'){queuedAttack=k;return drawOrSheath('DRAWING');}
    if(weapon==='DRAWING'){queuedAttack=k;return true;}
    if(weapon!=='HAND')return false;
    return playAttack(k);
  }
  function startPush(enterClip,clip,opts){
    if(push||attack||transition||!clip)return false;
    setUpperHold(false);
    const a=start(enterClip||clip,false,.1);if(!a)return false;
    if(!enterClip&&opts?.startFrac)a.time=clip.duration*opts.startFrac;
    if(opts?.timeScale)a.setEffectiveTimeScale(opts.timeScale);
    push={action:a,clip,main:clip,enter:!!enterClip,opts:opts||{},mode:enterClip?'enter':'play'};
    mode='interact';return true;
  }
  function releasePush(){if(push)push.mode='out';}
  function getPushState(){return push?{mode:push.mode,time:push.action.time,duration:push.action.getClip().duration,weight:1,name:push.action.getClip().name}:null;}
  function step(dt,wantMove,wantRun,allowed){
    dt=clamp(dt||0,0,.1);canAct=!!allowed;
    moving=!!wantMove;running=!!wantRun&&moving;
    if(push){
      setBase('idle',false);
      if(push.mode==='enter'&&push.action.time>=push.action.getClip().duration-.025){
        stop(push.action,.08);push.action=start(push.main,false,.08);push.action.setEffectiveTimeScale(push.opts.timeScale||.52);push.mode='play';
      }
      if(push.mode==='out'){stop(push.action,.12);push=null;}
    }
    if(transition){
      transition.t+=dt;const data=meta.clips?.[transition.type==='draw'?'Axe_Equip':'Axe_Unequip'];
      const switchAt=data?.switch?.time??(transition.type==='draw'?.0668:.2168);
      if(!transition.switched&&transition.t>=switchAt){
        transition.switched=true;switchSocket(transition.type==='draw'?'HAND':'BACK',true);
      }
      const duration=(transition.type==='draw'?drawClip:sheathClip)?.duration||.4;
      if(transition.t>=duration){
        if(!transition.switched)switchSocket(transition.type==='draw'?'HAND':'BACK',false);
        if(transition.type==='draw'){parentAxe(handBone,meta.attach?.hand);weapon='HAND';}
        else {parentAxe(back,meta.attach?.back);weapon='BACK';}
        stop(layer,.06);layer=null;transition=null;mode='idle';
        if(weapon==='HAND'&&queuedAttack){const k=queuedAttack;queuedAttack=null;playAttack(k);}
      }
    }
    if(attack){
      progress+=dt;
      const t=attack.action.time;
      const bounds=({light:[.33,.42],follow:[.33,.42],heavy:[.80,.92],slam:[.80,.92],dodge:[]})[attack.key]||[];
      if(bounds.length===2&&!hitFired&&t>=bounds[0]&&t<=bounds[1]){hitFired=true;window.dispatchEvent(new CustomEvent('sin-hit-window',{detail:{attack:attack.key}}));}
      if(t>=attack.clip.duration-.06){
        stop(attack.action,.13);attack=null;mode='idle';progress=0;
      }
    }
    const masked=!!transition||(weapon==='HAND'&&moving&&!attack&&!push);
    const loco=attack?null:push?'idle':moving?(running?'run':'walk'):(weapon==='HAND'?'combatIdle':'idle');
    if(!attack&&loco){
      setBase(loco,masked&&loco!=='combatIdle');
      setUpperHold(weapon==='HAND'&&moving&&!transition&&!push);
    }else if(attack){setUpperHold(false);if(base){stop(base,.08);base=null;baseKey='';}}
    if(!attack&&!transition&&!push&&weapon==='HAND'){
      quiet+=dt;
      // No automatic sheath without a reliable "no nearby threats" signal.
      if(quiet>7&&window.SinThreatDetector?.isSafe?.()===true)drawOrSheath('SHEATHING');
    }
    if(guard&&weapon==='HAND'&&!moving&&!attack&&!transition)setBase('combatIdle',false);
    mixer.update(dt);
    window.SinReviewHud?.setState({weapon,combat:working,interact:false});
  }
  return {
    hasCombat:working,step,attack:attackRequest,
    locked:()=>!!push||!!transition||!!attack&&progress<attack.clip.duration*.55,
    busy:()=>!!push||!!transition||!!attack,
    state:()=>mode,
    startPush,releasePush,pushing:()=>!!push,pushState:getPushState,
    setWalkScale(v){walkScale=v;if(base&&baseKey.startsWith('walk'))base.setEffectiveTimeScale(v);},
    runSample(){return {time:base?.time||0,dur:base?.getClip()?.duration||0,loop:THREE.LoopRepeat,w:running?1:0};},
    toggleAxe(){if(weapon==='BACK')return drawOrSheath('DRAWING');if(weapon==='HAND')return drawOrSheath('SHEATHING');return false;},
    guard(v){guard=!!v;}, weapon:()=>weapon, ready:()=>working
  };
}};
})();