/* Doors stay with their wing when rooms are streamed out. Each wing decodes
   its model once and shares meshes and materials across its openings. */
(function () {
  'use strict';

  const asset = 'assets/باب جناح المعبد.glb';
  const libraryAsset = 'assets/باب جناح المكتبة.glb';
  const clipName = side => side > 0 ? 'Inward' : 'Outward';
  const kits={
    Temple:{hinge:1.288,sill:.092,leafTop:2.992,leafLength:1.276,room:/^T[1-5]$/,atlasWidth:.445,
      entrance:'PalaceR3',threshold:'ARCH_R3',firstRoom:'T1',group:'Temple Wing Doors'},
    Library:{hinge:1.392,sill:.076,leafTop:3.48,leafLength:1.380,room:/^L[1-4]$/,atlasWidth:.207,
      entrance:'PalaceR1',threshold:'ARCH_R1',firstRoom:'L1',group:'Library Wing Doors'}
  };
  const poseStart = .49, plant = .62, press = .665, release = .94, pullback = .285;
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const smooth = x => { const t = clamp(x); return t * t * (3 - 2*t); };

  function plan(doors, regions, wing='Temple') {
    const byId = new Map(regions.map(region => [region.id, region]));
    const list = doors.filter(d => byId.get(d.from)?.wing === wing || byId.get(d.to)?.wing === wing);
    // The rear gallery meets TR1 along a common edge. Use the edge only
    // for sightlines to internal doors, leaving the shared passage open.
    const t = byId.get('TR1'), rear = byId.get('REAR');
    if (wing==='Temple' && t && rear) {
      const x0 = Math.max(t.bbox.x0, rear.bbox.x0), x1 = Math.min(t.bbox.x1, rear.bbox.x1);
      if (x1 > x0 && Math.abs(t.bbox.z1-rear.bbox.z0)<.02) {
        list.push({ id:'TR1-REAR', from:'TR1', to:'REAR', axis:'z', x:(x0+x1)/2, z:t.bbox.z1,
          width:x1-x0, height:Math.min(t.height,rear.height), kind:'threshold' });
      }
    }
    const openings=[], passages=[];
    for (const d of list) {
      if (byId.get(d.from)?.wing !== wing || byId.get(d.to)?.wing !== wing) {
        passages.push(d);
        continue;
      }
      const from = byId.get(d.from)?.bbox;
      const coord = d.axis === 'x' ? 'cx' : 'cz';
      // The visible L1 arch is taller than its walking collider.
      const coverHeight=d.id==='L1-LC4'?9.33:d.height+.08;
      openings.push({portal:d,coverHeight,front:Math.sign((from?.[coord] ?? 0)-d[d.axis])||-1});
    }
    return {openings,passages};
  }

  function armRig(hero) {
    const mapped = window.SinHero && window.SinHero.resolveRig ? window.SinHero.resolveRig(hero) : null;
    if (!mapped || !mapped.valid) throw new Error('Temple door push requires the runtime hero arm and hand rig');
    const arms = [mapped.left, mapped.right].map(r => [r.upperarm, r.lowerarm, r.hand, r.palm || r.hand]);
    let saved = null;
    function restore() {
      if (!saved) return;
      for (const [bone, q] of saved) bone.quaternion.copy(q);
      saved = null;
    }
    function centre(arm) {
      return arm[2].getWorldPosition(new THREE.Vector3()).lerp(arm[3].getWorldPosition(new THREE.Vector3()),.48);
    }
    function rotate(node, current, desired, weight) {
      const delta = new THREE.Quaternion().setFromUnitVectors(current.normalize(),desired.normalize());
      const world = delta.multiply(node.getWorldQuaternion(new THREE.Quaternion()));
      const local = node.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world);
      node.quaternion.slerp(local,weight);
      node.updateMatrixWorld(true);
    }
    function aim(arm,target,weight) {
      const [upper, lower, hand] = arm;
      const a=upper.getWorldPosition(new THREE.Vector3()), b=lower.getWorldPosition(new THREE.Vector3());
      const c=hand.getWorldPosition(new THREE.Vector3()), palm=centre(arm), handQ=hand.getWorldQuaternion(new THREE.Quaternion());
      const wrist = target.clone().sub(palm.sub(c));
      const u=b.clone().sub(a), v=c.clone().sub(b), upperLen=u.length(), lowerLen=v.length();
      const axis=wrist.clone().sub(a), len=clamp(axis.length(),Math.abs(upperLen-lowerLen)+.002,upperLen+lowerLen-.003);
      axis.normalize();
      const across=u.clone().addScaledVector(axis,-u.dot(axis));
      if (across.lengthSq()<1e-6) across.set(0,-1,0).addScaledVector(axis,axis.y);
      across.normalize();
      const along=(upperLen**2-lowerLen**2+len**2)/(2*len);
      const elbow=a.clone().addScaledVector(axis,along).addScaledVector(across,Math.sqrt(Math.max(0,upperLen**2-along**2)));
      rotate(upper,u,elbow.sub(a),weight);
      const newElbow=lower.getWorldPosition(new THREE.Vector3());
      rotate(lower,hand.getWorldPosition(new THREE.Vector3()).sub(newElbow),wrist.sub(newElbow),weight);
      hand.quaternion.copy(hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(handQ));
      hand.updateMatrixWorld(true);
      return centre(arm).distanceTo(target);
    }
    return {
      restore,
      plant(targets,weight) {
        restore();
        hero.updateMatrixWorld(true);
        saved = arms.flatMap(arm=>arm.slice(0,3).map(bone=>[bone,bone.quaternion.clone()]));
        return Math.max(...arms.map((arm,i)=>aim(arm,targets[i],weight)));
      }
    };
  }

  function sandstone(map,atlasWidth) {
    const material=new THREE.MeshStandardMaterial({map,color:0xab9075,roughness:.91,metalness:.02});
    material.customProgramCacheKey=()=> 'wing-door-sandstone:'+atlasWidth;
    material.onBeforeCompile=shader=>{
      const varying='varying vec2 vTempleMasonryUv;';
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+varying)
        .replace('#include <project_vertex>',`
          vec3 stonePoint=(modelMatrix*vec4(transformed,1.0)).xyz;
          vec3 stoneNormal=abs(mat3(modelMatrix)*objectNormal);
          vTempleMasonryUv=vec2(stoneNormal.x>stoneNormal.z?stonePoint.z:stonePoint.x,
            stoneNormal.y>max(stoneNormal.x,stoneNormal.z)?stonePoint.z:stonePoint.y)/vec2(1.42,.53);
          #include <project_vertex>
        `);
      const sample=THREE.ShaderChunk.map_fragment.replace('vMapUv','stoneUv');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+varying)
        .replace('#include <map_fragment>',`
        vec2 course=vTempleMasonryUv;
        course.x+=mod(floor(course.y),2.0)*.5;
        vec2 face=fract(course);
        // Use the sandstone portion of the original door's atlas.
        vec2 stoneUv=vec2(.025,.035)+face*vec2(${atlasWidth},.43);
        ${sample}
        vec2 edge=min(face,1.0-face);
        float joint=smoothstep(.005,.018,min(edge.x*2.3,edge.y));
        diffuseColor.rgb*=mix(.69,1.0,joint);
      `);
    };
    return material;
  }

  function mount(template, rows, { root, hero, combat, setFacing, dark, ready, floor, passages=[], lintels=null, wing='Temple' }) {
    const kit=kits[wing],{hinge,sill,leafTop,leafLength}=kit;
    const clips = new Map(template.animations.map(c=>[c.name,c]));
    for (const name of ['Open_Inward','Open_Outward','Close_Inward','Close_Outward']) {
      if (!clips.has(name)) throw new Error(wing+' door animation missing: '+name);
    }
    const hands = armRig(hero);
    const group = new THREE.Group(); group.name=kit.group;
    root.add(group);
    const stone=sandstone(template.scene.getObjectByName('TempleDoor_Frame').material.map,kit.atlasWidth);
    // The real upper walls and soffits of the thresholds.
    // They stay present even when the adjacent corridor is culled.
    const liner=lintels&&new THREE.Mesh(lintels,stone);
    if(liner){
      liner.name=wing+' Door Sandstone Lintels';
      liner.receiveShadow=true;
      root.add(liner);
    }
    const brace = new THREE.BoxGeometry(1,1,1);
    const entries = new Map(), adjacent = new Map();
    const localBoxes=[], cameraBoxes=[];
    let active = null, waiting = null;
    const point = new THREE.Vector3();
    const slab = (parent,mat,x0,x1,y0,y1,z0,z1,name) => {
      const mesh=new THREE.Mesh(brace,mat);
      mesh.name=name;
      mesh.position.set((x0+x1)/2,(y0+y1)/2,(z0+z1)/2);
      mesh.scale.set(x1-x0,y1-y0,z1-z0);
      parent.add(mesh);
      return mesh;
    };

    function local(d,p=hero.position) {
      const x=p.x-root.position.x-d.p.x, z=p.z-root.position.z-d.p.z;
      return { span:x*d.t.x+z*d.t.z, side:x*d.n.x+z*d.n.z };
    }
    function box(d, x0, x1, y0, y1, z0, z1) {
      const out={_wing:true,_door:true,_templeDoor:true}, world={_wing:true};
      const f = d.s, p = d.p, o = root.position;
      const xa=p.x+f*(x0*d.t.x+z0*d.n.x), xb=p.x+f*(x1*d.t.x+z1*d.n.x);
      const za=p.z+f*(x0*d.t.z+z0*d.n.z), zb=p.z+f*(x1*d.t.z+z1*d.n.z);
      Object.assign(out,{minx:Math.min(xa,xb),maxx:Math.max(xa,xb),miny:y0*f,maxy:y1*f,minz:Math.min(za,zb),maxz:Math.max(za,zb)});
      Object.assign(world,{minx:out.minx+o.x,maxx:out.maxx+o.x,miny:out.miny+o.y,maxy:out.maxy+o.y,minz:out.minz+o.z,maxz:out.maxz+o.z});
      return [out,world];
    }
    function movingBoxes(d) {
      const result = [];
      for (const [i,leaf] of d.leaves.entries()) {
        const sign=i===0?1:-1, x0=-sign*hinge, length=leafLength*sign;
        const dir=point.set(length,0,0).applyQuaternion(leaf.quaternion);
        for(let k=0;k<4;k++) {
          const a=k*.25,b=(k+1)*.25;
          result.push(box(d, Math.min(x0+a*dir.x,x0+b*dir.x)-.055,Math.max(x0+a*dir.x,x0+b*dir.x)+.055,
            sill,leafTop,Math.min(dir.z*a,dir.z*b)-.105,Math.max(dir.z*a,dir.z*b)+.105));
        }
      }
      return result;
    }
    function syncBoxes() {
      localBoxes.length=0; cameraBoxes.length=0;
      for (const d of entries.values()) {
        for (const [l,w] of d.fixed) { localBoxes.push(l); cameraBoxes.push(w); }
        if (d.state==='Closed' || d.state==='Opening') {
          localBoxes.push(d.barrier[0]); cameraBoxes.push(d.barrier[1]);
        } else {
          for(const [l,w] of d.moving) { localBoxes.push(l); cameraBoxes.push(w); }
        }
      }
    }
    function connect(d) {
      for (const id of [d.p.from,d.p.to]) {
        if (!adjacent.has(id)) adjacent.set(id,[]);
        adjacent.get(id).push(d);
      }
    }
    for(const p of passages)connect({p,progress:1});

    for (const {portal:p,front,coverHeight=p.height+.08} of rows) {
      const n=new THREE.Vector3(p.axis==='x'?front:0,0,p.axis==='z'?front:0);
      const t=new THREE.Vector3(n.z,0,-n.x);
      const pivot=new THREE.Group();
      pivot.position.set(p.x,0,p.z);pivot.rotation.y=Math.atan2(n.x,n.z);
      pivot.name=wing+'Door-'+p.id; pivot.userData.isDoor=true;pivot.userData.sinKeepVisible=true;
      const model=template.scene.clone(true);
      const frame=model.getObjectByName('TempleDoor_Frame');
      const leaves=['TempleDoor_Left','TempleDoor_Right'].map(name=>model.getObjectByName(name));
      if(!frame?.isMesh||leaves.some(leaf=>!leaf||(!leaf.isMesh&&!leaf.isGroup))) throw new Error(wing+' door frame or leaves missing');
      const bounds=new THREE.Box3().setFromObject(frame), dimensions=bounds.getSize(new THREE.Vector3());
      // Uniform scaling preserves the carvings. Fit the remaining height
      // with masonry in the reveal, behind the decorated stone frame.
      const s=Math.min((p.width+.11)/dimensions.x,(p.height+.06)/dimensions.y);
      model.scale.setScalar(s); pivot.add(model);group.add(pivot);
      const outer=(p.width*.5+.10)/s, upper=coverHeight/s;
      slab(model,stone,-outer,-hinge+.018,-.019,upper,-.51,-.024,'TempleDoor-West-Reveal');
      slab(model,stone,hinge-.018,outer,-.019,upper,-.51,-.024,'TempleDoor-East-Reveal');
      slab(model,stone,-hinge-.035,hinge+.035,leafTop-.027,upper,-.51,-.031,'TempleDoor-Head');
      slab(model,stone,-outer,outer,-.022,sill+.016,-.45,.18,'TempleDoor-Sill');
      // Face both sides through the full cut in the host wall, including
      // the part in front of the GLB frame when the corridor is hidden.
      const edge=p.width*.5/s, depth=((p.thickness||1)*.5+.10)/s;
      slab(model,stone,-edge-.03,-edge+.013,0,p.height/s,-depth,depth,'TempleDoor-West-Jamb-Lining');
      slab(model,stone,edge-.013,edge+.03,0,p.height/s,-depth,depth,'TempleDoor-East-Jamb-Lining');
      slab(leaves[0],dark,hinge-.034,hinge+.040,sill-.003,leafTop+.002,-.077,.088,'TempleDoor-Centre-Overlap');
      model.traverse(node=>{if(node.isMesh){node.receiveShadow=true;node.castShadow=false;node.userData.isDoor=true;}});
      pivot.updateWorldMatrix(true,true);
      const sockets=new Map();
      const ray=new THREE.Raycaster(), dir=new THREE.Vector3();
      for (const side of [-1,1]) {
        sockets.set(side,leaves.map((leaf,i)=>{
          const x=(i===0?-1:1)*.33/s, y=1.05/s;
          const from=model.localToWorld(new THREE.Vector3(x,y,side*2));
          ray.set(from,dir.copy(n).multiplyScalar(-side));ray.far=4*s;
          const hit=ray.intersectObject(leaf,true)[0];
          if(!hit) throw new Error(wing+' door has no palm contact surface: '+p.id);
          return leaf.worldToLocal(hit.point.addScaledVector(n,side*.008));
        }));
      }
      const d={p,pivot,n,t,s,leaves,sockets,mixer:new THREE.AnimationMixer(model),model,
        state:'Closed',progress:0,rearm:0,fixed:[],moving:[],contactError:null};
      d.fixed=[
        box(d,-outer,-hinge+.018,0,upper,-.51,.13),box(d,hinge-.018,outer,0,upper,-.51,.13),
        box(d,-hinge,hinge,leafTop-.027,upper,-.51,.13)
      ];
      d.barrier=box(d,-hinge-.022,hinge+.022,0,leafTop,-.124,.154);
      entries.set(p.id,d);
      connect(d);
    }
    syncBoxes();

    function animate(d,name,amount) {
      if(d.clip!==name){
        if(d.action)d.action.stop();
        d.action=d.mixer.clipAction(clips.get(name));
        d.action.reset().setLoop(THREE.LoopOnce,1);
        d.action.clampWhenFinished=true;d.action.play();d.action.paused=true;d.clip=name;
      }
      d.action.time=clips.get(name).duration*clamp(amount);
      d.mixer.update(0);
      d.pivot.updateMatrixWorld(true);
    }
    function targets(d) {
      const ends=d.sockets.get(d.side).map((p,i)=>d.leaves[i].localToWorld(p.clone()));
      // The actor's left faces the model's right only on the uncarved side.
      // The idle clip can cross the wrists, so their current positions cannot
      // be used to assign a leaf to each hand.
      return d.side<0 ? [ends[1],ends[0]] : ends;
    }
    function positionHero(d,dt,follow) {
      const sockets=targets(d);
      const goal=sockets[0].clone().add(sockets[1]).multiplyScalar(.5);
      goal.addScaledVector(d.n,d.side*d.reach);
      const origin=d.pivot.getWorldPosition(new THREE.Vector3());
      const signed=goal.clone().sub(origin).dot(d.n)*d.side;
      if(signed<.21)goal.addScaledVector(d.n,(.21-signed)*d.side);
      const k=follow?1:1-Math.exp(-dt*20);
      hero.position.x+=(goal.x-hero.position.x)*k;
      hero.position.z+=(goal.z-hero.position.z)*k;
      hero.position.y=root.position.y+(floor(hero.position.x-root.position.x,hero.position.z-root.position.z)||0);
      const yaw=Math.atan2(-d.n.x*d.side,-d.n.z*d.side), diff=yaw-hero.rotation.y;
      const facing=hero.rotation.y+Math.atan2(Math.sin(diff),Math.cos(diff))*k;
      setFacing(facing);hero.rotation.y=facing;
      return sockets;
    }
    function begin(d,side) {
      if(!combat.startPush({skipEnter:true,timeScale:1.03,startFrac:poseStart}))return false;
      d.side=side;d.reach=.37;d.contactError=null;d.planted=false;d.progress=0;
      d.state='Opening';d.phase='Plant';d.elapsed=0;d.choice=clipName(side);
      animate(d,'Open_'+d.choice,0);
      active=d;waiting=null;
      return true;
    }
    function endPush(d) {
      combat.releasePush();
      d.phase='Swing';d.elapsed=0;d.releasedProgress=d.progress;
    }
    function advance(d,dt) {
      d.elapsed+=dt;
      if(d.phase==='Swing'){
        const t=clamp(d.elapsed/1.03);
        d.progress=d.releasedProgress+(1-d.releasedProgress)*smooth(t);
        animate(d,'Open_'+d.choice,d.progress);
        if(t===1){
          d.state='Open';d.phase=null;d.moving=movingBoxes(d);active=null;
        }
        return true;
      }
      const pose=combat.pushState();
      const u=pose ? pose.time/pose.duration : 0;
      if (!pose || d.elapsed>2.6) {
        combat.releasePush();
        if(d.progress>.01)endPush(d);
        else {d.state='Closed';d.rearm=.85;d.phase=null;active=null;}
        return true;
      }
      const points=positionHero(d,dt,false);
      if(u<plant)return false;
      const k=smooth((u-plant)/(press-plant));
      d.contactError=hands.plant(points,k);
      if (u<press) return false;
      if (!d.planted && d.contactError>.035) {
        d.reach=Math.max(.30,d.reach-dt*.28);
        if(u>=.985){combat.releasePush();d.state='Closed';d.rearm=.85;active=null;}
        return false;
      }
      d.planted=true;
      // Drive the first part of the real GLB clip with the push pose.
      // The palms track their individual leaves only during this stroke.
      d.progress=pullback*smooth((u-press)/(release-press));
      animate(d,'Open_'+d.choice,d.progress);
      const sockets=positionHero(d,dt,true);
      d.contactError=hands.plant(sockets,1);
      if(u>=release || (d.progress>.06&&d.contactError>.055))endPush(d);
      return true;
    }
    function intersectsPlayer(boxes) {
      const x=hero.position.x-root.position.x,z=hero.position.z-root.position.z;
      for(const [b] of boxes){
        if(Math.hypot(x-clamp(x,b.minx,b.maxx),z-clamp(z,b.minz,b.maxz))<.37)return true;
      }
      return false;
    }
    function clearedDoor(d,c) {
      if(c.side*d.side>=-.72)return false;
      // Both leaves open away from the hero. Leaving the portal plane is
      // not enough if the capsule is still inside either leaf's sweep.
      const hingeDistance=Math.hypot(Math.abs(Math.abs(c.span)-d.s*hinge),c.side);
      return hingeDistance>d.s*(leafLength+.114)+.37;
    }
    function tick(dt,motion) {
      let dirty=active ? advance(active,dt) : false, nearest=null;
      waiting=null;
      const faceX=Math.sin(hero.rotation.y), faceZ=Math.cos(hero.rotation.y);
      for(const d of entries.values()){
        d.rearm=Math.max(0,d.rearm-dt);
        const c=local(d);
        if(d.state==='Open'){
          if(clearedDoor(d,c) || Math.abs(c.side)>3.2 || Math.abs(c.span)>d.p.width*.67){
            d.state='Closing';d.elapsed=0;dirty=true;
          }
        }
        if(d.state==='Closing'){
          const next=Math.min(1,(d.elapsed+dt)/1.47);
          animate(d,'Close_'+d.choice,next);
          const boxes=movingBoxes(d);
          if(intersectsPlayer(boxes)){
            animate(d,'Close_'+d.choice,d.elapsed/1.47);
          }else{
            d.elapsed+=dt;d.progress=1-next;d.moving=boxes;
            if(next===1){d.state='Closed';d.rearm=.32;}
            dirty=true;
          }
        }
        if(active||d.state!=='Closed'||d.rearm||Math.abs(c.span)>.92*d.s)continue;
        const side=Math.sign(c.side)||1, distance=Math.abs(c.side);
        const toward=-(motion.vx*d.n.x+motion.vz*d.n.z)*side;
        const looking=-(faceX*d.n.x+faceZ*d.n.z)*side;
        if(distance>1.24 || (toward<.21 && (looking<.55 || distance>.88)))continue;
        if(!nearest || distance<nearest.distance)nearest={d,side,distance};
      }
      if(!active&&nearest){
        const {d,side}=nearest, target=destination(d,side);
        if(target&&!ready(target))waiting=target;
        else if(begin(d,side))dirty=true;
      }
      if(dirty)syncBoxes();
    }
    function destination(d,side=d.side) {
      const name=side>0?d.p.to:d.p.from;
      return kit.room.test(name)?name:null;
    }
    function retainZones() {
      const retained=new Set();
      if(waiting)retained.add(waiting);
      for(const d of entries.values()){
        if(d.state==='Closed')continue;
        for(const id of [d.p.from,d.p.to])if(kit.room.test(id))retained.add(id);
      }
      return retained;
    }
    function sight(viewer,view,through) {
      if(!view)return;
      if(viewer===kit.threshold){
        const arch=passages.find(p=>p.id===kit.entrance);
        viewer=arch&&view.x>=arch.x?kit.firstRoom:'Palace';
      }
      const shown=new Set(), seen=new Set([viewer]), queue=[[viewer,[]]];
      while(queue.length){
        const [region,route]=queue.shift();
        for(const d of adjacent.get(region)||[]){
          const chain=[...route,d.p];
          if(route.length&&!through(view,chain,.08))continue;
          if(d.pivot)shown.add(d);
          const next=d.p.from===region?d.p.to:d.p.from;
          if(d.progress>.024&&!seen.has(next)&&through(view,chain,.08)){
            seen.add(next);queue.push([next,chain]);
          }
        }
      }
      for(const d of entries.values())d.pivot.visible=shown.has(d);
    }
    function dispose() {
      hands.restore();
      if(active)combat.releasePush();
      for(const d of entries.values()){d.mixer.stopAllAction();d.mixer.uncacheRoot(d.model);}
      brace.dispose();group.removeFromParent();
      stone.dispose();
      if(liner){
        liner.removeFromParent();
        liner.geometry.dispose();
      }
      // No remaining door uses these shared GPU uploads after the wing unloads.
      const resources=new Set();
      template.scene.traverse(mesh=>{
        if(!mesh.isMesh)return;
        resources.add(mesh.geometry);
        for(const material of [mesh.material].flat()){
          resources.add(material);
          for(const value of Object.values(material))if(value?.isTexture)resources.add(value);
        }
      });
      for(const resource of resources)resource.dispose();
    }
    return { tick, sight, restore:hands.restore, dispose, localBoxes, cameraBoxes,
      locked:()=>!!active,
      waiting:()=>waiting,
      retainZones,
      allows:id=>!entries.has(id)||entries.get(id).progress>.024,
      report:()=>Array.from(entries.values(),d=>({id:d.p.id,state:d.state,progress:d.progress,
        clip:d.clip,contactError:d.contactError,planted:d.planted===true,loaded:true,collision:d.state!=='Open'}))
    };
  }

  window.SinTempleDoors={asset,libraryAsset,plan,mount,clipName};
})();
