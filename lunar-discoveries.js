/* Small, room-owned lunar discoveries. Game loop and streaming stay in charge. */
(function (root) {
  'use strict';

  const files = { K3: 'assets/لوح المحاق.glb', L2: 'assets/سجل القمر .glb' };
  const key = 'sin.lunarClues';
  const scenes = {
    K3: { id:'k3NewMoon', duration:10.5, subtitleAt:7.25, text:'من ظلام القمر تبدأ دورة الأختام الثمانية.' },
    L2: { id:'l2MoonPhases', duration:13.35, subtitleAt:10.05, text:'ثمانية أوجهٍ للقمر، من الظلام إلى الاكتمال، ثم العودة إلى الظلام.' },
    T4: { id:'t4MoonSeal', duration:13.2, subtitleAt:9.15, text:'حين تكتمل أطوار القمر الثمانية، أيقظ ختم سين في قلب الباب.' }
  };
  const ids = Object.values(scenes).map(scene => scene.id);
  // Orthographic centres measured on the authored +X face. Units are fractions
  // of the model's width and screen-right points along its original -Z.
  const phases = [-.3484,-.2484,-.1477,-.0469,.0497,.1492,.2508,.3508];
  const clamp = t => Math.max(0, Math.min(1, t));
  const smooth = t => { t=clamp(t); return t*t*(3-2*t); };
  const fade = (t,a,b) => smooth((t-a)/(b-a));

  function read(storage) {
    let data;
    try { data=JSON.parse(storage.getItem(key)); } catch (_) {}
    return Object.fromEntries(ids.map(id => [id,data?.[id]===true]));
  }

  function save(storage,id) {
    const progress=read(storage);
    if(ids.includes(id))progress[id]=true;
    try { storage.setItem(key,JSON.stringify(progress)); } catch (_) {}
    return progress;
  }

  function point(x,y,z) { return new THREE.Vector3(x,y,z); }

  function tabletop(parent,table,width,depth) {
    parent.updateWorldMatrix(true,true);
    const bounds=new THREE.Box3().setFromObject(table);
    const inverse=parent.matrixWorld.clone().invert();
    bounds.applyMatrix4(inverse);
    const ray=new THREE.Raycaster(), down=point(0,-1,0);
    const start=point(0,0,0);
    let best;
    const length=bounds.max.z-bounds.min.z;
    for(const edge of [.11,.21,.36,.51,.59,.70,.82])for(const offset of [0,.09,-.09,.15,-.15,.22,-.22,.32,-.32]){
      const x=bounds.max.x-depth/2-edge;
      const z=(bounds.min.z+bounds.max.z)*.5+offset*length;
      if(z-width/2<bounds.min.z+.04||z+width/2>bounds.max.z-.04)continue;
      let low=Infinity,high=-Infinity,count=0;
      for(const u of [-.40,-.2,0,.2,.4])for(const d of [-.32,.32]){
        start.set(x+d*depth,bounds.max.y+.25,z+u*width).applyMatrix4(parent.matrixWorld);
        ray.set(start,down);ray.far=bounds.max.y+.25-Math.max(.48,bounds.min.y);
        const hit=ray.intersectObject(table,true)[0];
        if(!hit)continue;
        const y=hit.point.applyMatrix4(inverse).y;
        low=Math.min(low,y);high=Math.max(high,y);count++;
      }
      if(count!==10||high-low>.063)continue;
      const score=(high-low)*7+edge*.25+Math.abs(offset)*.16;
      if(!best||score<best.score)best={x,y:high+.005,z,edge:bounds.max.x,score};
    }
    return best;
  }

  function surfaceLight(mesh,frame,id,width,height,uniforms) {
    frame.updateWorldMatrix(true,true);
    const transform=frame.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
    const base=mesh.material;
    const material=base.clone();
    const prior=base.onBeforeCompile;
    const cache=base.customProgramCacheKey();
    mesh.material=material;
    material.customProgramCacheKey=()=>cache+':lunar-'+id;
    material.onBeforeCompile=function(shader,renderer){
      prior.call(this,shader,renderer);
      Object.assign(shader.uniforms,uniforms,{
        lunarFrame:{value:transform}, lunarWidth:{value:width}, lunarHeight:{value:height}
      });
      shader.vertexShader=shader.vertexShader.replace('#include <common>',
        '#include <common>\nvarying vec3 vLunar;uniform mat4 lunarFrame;')
        .replace('#include <project_vertex>',
          'vLunar=(lunarFrame*vec4(transformed,1.)).xyz;\n#include <project_vertex>');
      const rings=id==='L2'?phases.map((x,i)=>`
        float d${i}=length(q-vec2(${x.toFixed(4)},lunarHeight/lunarWidth*.5-.0047));
        float phase${i}=smoothstep(${i}.0,${i}.63,lunarPhase);
        float lead${i}=1.-smoothstep(${i}.68,${i+1}.48,lunarPhase);
        energy+=(.022+pulse*.016+phase${i}*(.14+.39*lead${i}))*ring(d${i},.0394,.009);
        energy+=phase${i}*(.022+.075*lead${i})*(1.-smoothstep(.011,.039,d${i}));
      `).join('') : id==='K3'?`
        float d=length(q-vec2(0.,lunarHeight/lunarWidth*.5+.0344));
        energy+=(.039+.036*pulse+.51*lunarReveal)*ring(d,.112,.018);
        float frameDistance=max(abs(q.x)*2.,abs(q.y-lunarHeight/lunarWidth*.5)*2.*lunarWidth/lunarHeight);
        energy+=(.020+.012*pulse+.062*lunarReveal)*ring(frameDistance,.946,.038);
      `:`
        vec2 p=q-vec2(0.,.650);
        float under=1.-smoothstep(.13,.27,p.y);
        float metal=smoothstep(.008,.18,diffuseColor.r-diffuseColor.b);
        float arc=ring(length(vec2(p.x,p.y*.91)),.279,.060)*under;
        float script=ring(q.y,.179,.022)*(1.-smoothstep(.33,.44,abs(q.x)));
        energy=metal*(arc*(.029+.020*pulse+.52*lunarReveal)+script*.27*lunarReveal);
      `;
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`
        #include <common>
        varying vec3 vLunar;
        uniform float lunarClock, lunarReveal, lunarPhase, lunarWidth, lunarHeight;
        float ring(float d,float r,float w){return 1.-smoothstep(w*.21,w,abs(d-r));}
      `).replace('#include <opaque_fragment>',`
        vec2 q=vLunar.xy/lunarWidth;
        float pulse=.5+.5*sin(lunarClock*1.95);
        float energy=0.;
        ${rings}
        outgoingLight+=vec3(.21,.48,1.0)*energy*${id==='T4'?'1.':'smoothstep(-.005,.024,vLunar.z)'};
        #include <opaque_fragment>
      `);
    };
    // The shrine's old material can still be shared by the original kit.
    return base;
  }

  function dust(frame,kind,uniforms) {
    const count=kind==='T4'?42:36, data=[], seeds=[];
    for(let i=0;i<count;i++){
      const a=(i*.61803398875)%1, b=(i*.754877666)%1;
      data.push(kind==='T4'?((a-.5)*5.5):((a-.5)*1.44),
        kind==='T4'?.85+b*1.1:.19+b*.53,kind==='T4'?.55+b*1.6:.16+(i%4)*.023);
      seeds.push(a,b);
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(data,3));
    geometry.setAttribute('seed',new THREE.Float32BufferAttribute(seeds,2));
    const material=new THREE.ShaderMaterial({
      transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      uniforms,
      vertexShader:`
        attribute vec2 seed;varying float alpha;uniform float lunarDust,lunarReveal;
        void main(){
          float age=fract(lunarDust*.205+seed.x);
          vec3 p=position+vec3(sin(seed.x*19.+age*3.)*age*.21,age*(.24+.24*seed.y),age*.37);
          vec4 view=modelViewMatrix*vec4(p,1.);
          gl_Position=projectionMatrix*view;
          gl_PointSize=clamp((4.+seed.y*7.)/max(1.,-view.z),1.,3.9);
          alpha=sin(age*3.14159)*(.19+seed.y*.31)*lunarReveal;
        }`,
      fragmentShader:`
        varying float alpha;
        void main(){
          float a=1.-smoothstep(.02,.46,length(gl_PointCoord-.5));
          gl_FragColor=vec4(.55,.72,1.,alpha*a);
        }`
    });
    const cloud=new THREE.Points(geometry,material);
    cloud.name=kind+'-lunar-dust';cloud.frustumCulled=false;
    frame.add(cloud);
    return cloud;
  }

  function seal(frame,uniforms) {
    const material=new THREE.ShaderMaterial({
      uniforms,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      vertexShader:'varying vec2 p;void main(){p=uv*2.-1.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:`
        varying vec2 p;uniform float lunarSeal,lunarClock;
        float band(float x,float c,float w){return 1.-smoothstep(w*.25,w,abs(x-c));}
        void main(){
          float r=length(p), a=atan(p.y,p.x)+lunarClock*.20;
          float orbit=band(r,.78,.044)*(.56+.44*cos(a*4.));
          float marks=band(r,.88,.026)*pow(max(0.,cos(a*8.)),12.);
          float rim=band(r,.62,.035);
          float moon=(1.-smoothstep(.248,.291,length(p-vec2(.0,-.080))))*
            smoothstep(.195,.245,length(p-vec2(.072,.038)));
          vec2 star=p-vec2(.11,.18);
          float spark=max(1.-smoothstep(.012,.042,abs(star.x)+abs(star.y)*.17),
                          1.-smoothstep(.012,.042,abs(star.y)+abs(star.x)*.17));
          spark*=1.-smoothstep(.04,.105,length(star));
          float glow=exp(-r*r*5.)*.12;
          gl_FragColor=vec4(mix(vec3(.21,.49,1.),vec3(.82,.91,1.),moon+spark*.45),
            lunarSeal*(glow+orbit*.56+marks*.64+rim*.50+moon*.75+spark*.76));
        }`
    });
    const glyph=new THREE.Mesh(new THREE.PlaneGeometry(1.66,1.66),material);
    glyph.name='T4-lunar-seal';glyph.position.set(1.21,2.92,.66);
    frame.add(glyph);
    return glyph;
  }

  function site(id,frame,axis,trigger,uniforms,extra={}) {
    return {id,frame,axis,trigger,uniforms,...extra};
  }

  function metersFrame(id,parent) {
    const frame=new THREE.Group();
    frame.name=id+'-lunar-discovery';
    parent.add(frame);
    return frame;
  }

  function clockUniforms() {
    return {lunarClock:{value:0},lunarReveal:{value:0},lunarPhase:{value:0},
      lunarDust:{value:0},lunarSeal:{value:0}};
  }

  function monument(id,model,parent,table,fallback) {
    const w=id==='K3'?.91:1.60;
    const bounds=new THREE.Box3().setFromObject(model);
    const size=bounds.getSize(point(0,0,0)), c=bounds.getCenter(point(0,0,0));
    const scale=w/size.z, depth=size.x*scale, height=size.y*scale;
    const seat=tabletop(parent,table,w,depth) || fallback?.();
    if(!seat)throw Error('No clear tabletop for '+id+' lunar discovery');
    const frame=metersFrame(id,parent);
    frame.rotation.y=Math.PI*.5;
    frame.position.set(seat.x,seat.y,seat.z);
    const pivot=new THREE.Group();
    pivot.rotation.y=-Math.PI*.5;
    pivot.scale.setScalar(scale);
    // After rotation the side originally facing +X becomes local +Z.
    pivot.position.set(c.z*scale,-bounds.min.y*scale,-c.x*scale);
    pivot.add(model);
    frame.add(pivot);
    const uniforms=clockUniforms();
    const meshes=[];
    model.traverse(node=>{
      if(!node.isMesh)return;
      node.castShadow=false;node.receiveShadow=true;meshes.push(node);
    });
    const originalMaterials=new Set(meshes.map(node=>surfaceLight(node,frame,id,w,height,uniforms)));
    originalMaterials.forEach(m=>m.dispose());
    const edge=seat.edge-seat.x;
    const trigger={min:edge+.26,max:edge+(id==='K3'?.99:1.17),half:id==='K3'?.72:1.02,maxY:.52};
    const clue=site(id,frame,Math.PI*.5,trigger,uniforms,{height,edge});
    if(id==='L2')clue.cloud=dust(frame,id,uniforms);
    return clue;
  }

  function sanctuary(parent,shrine,room,front) {
    const frame=metersFrame('T4',parent), uniforms=clockUniforms();
    frame.position.set(front-room.bbox.cx,0,0);
    frame.rotation.y=-Math.PI*.5;
    const width=shrine.geometry.boundingBox?.getSize(point(0,0,0)).z;
    // The shrine's local geometry is scaled by the builder, so use its room
    // bounds in the same coordinate system as the masks and shot paths.
    const b=new THREE.Box3().setFromObject(shrine);
    const fittedWidth=b.max.z-b.min.z || width;
    surfaceLight(shrine,frame,'T4',fittedWidth,8.85,uniforms);
    return site('T4',frame,-Math.PI*.5,{min:.65,max:1.55,half:1.20,maxY:.65},uniforms,{
      glyph:seal(frame,uniforms),cloud:dust(frame,'T4',uniforms)
    });
  }

  function shots(clue) {
    const {id,height,edge}=clue;
    if(id==='K3')return [
      [0,[.22,height*.82,edge+1.21],[0,height*.49,0],43],
      [2.5,[.18,height*.80,edge+1.21],[0,height*.50,0],43],
      [4.7,[-.30,height*.61,edge+.83],[-.205,height*.57,0],34],
      [6.35,[-.08,height*.61,edge+.67],[0,height*.546,0],33],
      [8.85,[.032,height*.64,edge+.65],[0,height*.547,0],31]
    ];
    if(id==='L2')return [
      [0,[-.30,height*.94,edge+1.22],[-.13,height*.67,0],47],
      [2.8,[-.61,height*.75,edge+.83],[-.51,height*.65,0],36],
      [3.65,[-.60,height*.64,edge+.86],[-.56,height*.49,0],37],
      [9.6,[.68,height*.67,edge+.98],[.56,height*.49,0],37],
      [11.65,[.08,height*.90,edge+1.88],[0,height*.38,0],43]
    ];
    return [
      [0,[-.52,1.69,5.35],[0,3.91,-1.25],55],
      [3.45,[-1.10,1.65,4.45],[-.22,4.35,-1.56],53],
      [6.05,[-.70,3.44,4.82],[0,5.46,-1.42],54],
      [8.62,[.65,4.92,4.77],[.36,5.10,-1.29],52],
      [11.42,[1.00,3.52,3.82],[1.04,3.44,.33],39]
    ];
  }

  function sample(path,t,p,l) {
    let k=0;
    while(k<path.length-2&&t>path[k+1][0])k++;
    const [a,p0,l0,f0]=path[k], [b,p1,l1,f1]=path[k+1];
    // The pan over the phases follows the sequential highlights at constant
    // speed. The other shots settle at their focal marks.
    const u=k===2&&a===3.65?clamp((t-a)/(b-a)):fade(t,a,b);
    p.set(p0[0]+(p1[0]-p0[0])*u,p0[1]+(p1[1]-p0[1])*u,p0[2]+(p1[2]-p0[2])*u);
    l.set(l0[0]+(l1[0]-l0[0])*u,l0[1]+(l1[1]-l0[1])*u,l0[2]+(l1[2]-l0[2])*u);
    return f0+(f1-f0)*u;
  }

  function animation(clue,t,ambient) {
    const u=clue.uniforms;
    u.lunarClock.value=ambient;
    u.lunarDust.value=t;
    u.lunarReveal.value=clue.id==='K3'?fade(t,5.4,7.60)*(1-.8*fade(t,8.85,10.5)):
      fade(t,1.65,clue.id==='L2'?3.4:6.9);
    u.lunarPhase.value=clue.id==='L2'?Math.max(0, Math.min(8,(t-3.52)*1.335)):0;
    u.lunarSeal.value=clue.id==='T4'?fade(t,7.3,9.1)*(1-fade(t,11.2,13.08)):0;
    if(clue.cloud)clue.cloud.visible=t>1.60&&t<scenes[clue.id].duration-1.15;
    if(clue.glyph)clue.glyph.visible=u.lunarSeal.value>.001;
  }

  function releaseEffect(object) {
    if(!object)return;
    object.removeFromParent();
    object.geometry.dispose();
    object.material.dispose();
  }

  function create({camera,subtitle,body,storage,onEnter,onExit,constrain}) {
    let active=null, retryBlocked=null;
    let progress=read(storage);
    const p=point(0,0,0), l=point(0,0,0), tmp=point(0,0,0), lookCamera=new THREE.PerspectiveCamera();
    function restore(run) {
      camera.position.copy(run.start.position);camera.quaternion.copy(run.start.rotation);
      camera.fov=run.start.fov;camera.updateProjectionMatrix();
      run.hero.visible=run.start.heroVisible;
      body.classList.remove('lunar-cinematic');subtitle.textContent='';
      subtitle.style.opacity='0';
      onExit?.();
    }
    function finish(completed) {
      if(!active)return;
      const run=active;
      active=null;
      try {
        animation(run.clue,0,run.wallTime);
        releaseEffect(run.clue.cloud);
        releaseEffect(run.clue.glyph);
        run.clue.cloud=run.clue.glyph=null;
        if(completed){
          const saved=save(storage,scenes[run.clue.id].id);
          for(const id of ids)progress[id]=progress[id]||saved[id];
        }else retryBlocked=run.clue.id;
      } finally { restore(run); }
    }
    function advance(dt,clue,hero,canStart) {
      if(active&&active.clue!==clue){finish(false);return false;}
      if(!clue)return false;
      if(retryBlocked!==clue.id)retryBlocked=null;
      const now=performance.now()*.001;
      try {
        if(!active) {
          animation(clue,0,now);
          const feet=clue.frame.worldToLocal(tmp.copy(hero.position));
          const z=clue.trigger;
          // Measurements are relative to the room floor, not the tabletop.
          const floorY=feet.y+clue.frame.position.y;
          const near=feet.z>=z.min&&feet.z<=z.max&&Math.abs(feet.x)<=z.half&&floorY<z.maxY;
          if(retryBlocked===clue.id){if(!near)retryBlocked=null;return false;}
          // Character faces back toward the object, opposite its outward normal.
          if(!near||!canStart||progress[scenes[clue.id].id]||Math.cos(hero.rotation.y-clue.axis)>-.24)return false;
          active={clue,hero,t:0,wallTime:now,path:shots(clue),start:{
            position:camera.position.clone(),rotation:camera.quaternion.clone(),fov:camera.fov,heroVisible:hero.visible
          }};
          if((clue.id==='L2'||clue.id==='T4')&&!clue.cloud)clue.cloud=dust(clue.frame,clue.id,clue.uniforms);
          if(clue.id==='T4'&&!clue.glyph)clue.glyph=seal(clue.frame,clue.uniforms);
          body.classList.add('lunar-cinematic');
          subtitle.textContent=scenes[clue.id].text;
          onEnter();
        }
        const run=active, settings=scenes[clue.id];
        run.t=Math.min(settings.duration,run.t+Math.min(.080,Math.max(0,dt)));
        run.wallTime=now;
        const into=fade(run.t,0,1.38), out=fade(run.t,settings.duration-1.55,settings.duration);
        const blend=into*(1-out), fov=sample(run.path,run.t,p,l);
        hero.visible=blend<.59&&run.start.heroVisible;
        clue.frame.localToWorld(p);clue.frame.localToWorld(l);
        lookCamera.position.copy(p);lookCamera.lookAt(l);
        camera.position.copy(run.start.position).lerp(p,blend);
        camera.quaternion.copy(run.start.rotation).slerp(lookCamera.quaternion,blend);
        camera.fov=run.start.fov+(fov-run.start.fov)*blend;camera.updateProjectionMatrix();
        if(constrain)constrain(camera,hero);
        animation(clue,run.t,now);
        subtitle.style.opacity=String(fade(run.t,settings.subtitleAt,settings.subtitleAt+.55)*
          (1-fade(run.t,settings.duration-.86,settings.duration-.12)));
        if(run.t>=settings.duration)finish(true);
        return true;
      } catch(error) {
        try { finish(false); } finally { console.warn('[lunar discoveries]',error); }
        return false;
      }
    }
    return {advance,active:()=>active!==null,cancel:()=>finish(false),
      progress:()=>({...progress}),current:()=>active?.clue.id??null};
  }

  const api={files,create,monument,sanctuary,progress:()=>read(root.localStorage)};
  root.SinLunarDiscoveries=api;
  if(typeof module!=='undefined'&&module.exports)module.exports={read,save,scenes,phases};
})(typeof window==='undefined'?globalThis:window);
