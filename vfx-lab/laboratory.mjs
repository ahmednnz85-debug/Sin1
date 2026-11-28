import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import '../zone-streamer.js';
import '../process-memory.js';
import { createManager, limits, defaults, layers, normalizeSettings } from './manager.mjs';
import { createActor, choreograph } from './choreography.mjs';
import { effects, groups } from './presets.mjs';
import { importSheet } from './atlas.mjs';

const T = window.THREE;
const STEP=1/120;
const STONE='assets/r3/harbor/';
const cssURL=new URL('laboratory.css',import.meta.url);
const STORE='sin.vfx-lab.presets.v1';
const controlNames={
  speed:'السرعة',scale:'الحجم',density:'كثافة الجسيمات',glow:'التوهج',opacity:'الشفافية',
  duration:'التلاشي',force:'قوة الارتطام',shake:'اهتزاز الكاميرا'
};
const layerLabels={edge:'حافة السلاح',ribbon:'آثار الحركة',sparks:'الشرر',dust:'الغبار',
  debris:'الشظايا',decal:'التشققات',wave:'الموجات'};
const surfaces={auto:'سطح الحركة',armor:'درع',metal:'معدن',stone:'حجر أرضي',wall:'جدار حجري',flesh:'جسم',spirit:'روح'};
const quality={auto:'تلقائي',high:'عالية',medium:'متوسطة',low:'منخفضة'};
const cameras={oblique:'جانبي',front:'أمامي',reverse:'خلفي',top:'علوي',close:'مقرب'};
const units={ground:'الحجر والتشققات',energy:'الطاقة',sparks:'الشرر'};
const vec=(...v)=>new T.Vector3(...v);

function createUI(area) {
  document.documentElement.classList.add('sin-vfx-lab');
  const style=document.createElement('link');
  style.rel='stylesheet';style.href=cssURL;
  document.head.append(style);
  const shell=document.createElement('main');
  shell.id='vfx-lab';
  shell.dir='rtl';
  const select = (name, values) => `<select data-setting="${name}">${Object.entries(values).map(([key,label]) =>
    `<option value="${key}">${label}</option>`).join('')}</select>`;
  shell.innerHTML = `
    <canvas aria-label="مشهد مختبر المؤثرات"></canvas>
    <button type="button" class="vfx-show" data-command="toggle" aria-expanded="true">لوحة المؤثرات</button>
    <aside class="vfx-controls" aria-label="لوحة مختبر المؤثرات">
      <header><p>SÎN <span>·</span> DEV</p><h1>${area.ar}</h1></header>
      <label class="vfx-field">المؤثر <select id="vfx-effect">
        ${groups.map(group=>`<optgroup label="${group.label}">${group.ids.map(id=>
          `<option value="${id}">${effects[id].label}</option>`).join('')}</optgroup>`).join('')}
      </select></label>
      <div class="vfx-buttons">
        <button type="button" class="vfx-primary" data-command="play">تشغيل</button>
        <button type="button" data-command="pause">إيقاف</button>
        <button type="button" data-command="step">إطار +</button>
        <button type="button" data-command="zero">إعادة</button>
      </div>
      <button type="button" data-command="demo" class="vfx-demo">تشغيل القتال التجريبي</button>
      <label class="vfx-check"><input type="checkbox" data-setting="repeat"> تكرار العرض</label>
      <div class="vfx-pair">
        <label class="vfx-field">الكاميرا ${select('camera',cameras)}</label>
        <label class="vfx-field">الجودة ${select('quality',quality)}</label>
      </div>
      <dl class="vfx-timeline"><div><dt>الحركة</dt><dd id="vfx-clip" dir="ltr">—</dd></div>
        <div><dt>الزمن / نافذة الإصابة</dt><dd id="vfx-window" dir="ltr">—</dd></div>
        <div><dt>التلامسات</dt><dd id="vfx-contacts">0</dd></div></dl>
      <details open><summary>الزمن والشدة</summary>
        <div class="vfx-sliders">${Object.entries(limits).map(([name,[min,max]])=>
          `<label><span>${controlNames[name]}</span><output data-value="${name}" dir="ltr">1.00</output>
            <input type="range" min="${min}" max="${max}" step=".01" data-setting="${name}" dir="ltr"></label>`).join('')}</div>
      </details>
      <details><summary>السطح وطبقات الرسم</summary>
        <label class="vfx-field">نوع السطح ${select('surface',surfaces)}</label>
        <label class="vfx-field">معاينة الحواف ${select('surfacePreview',{off:'حركة طبيعية',axe:'نصل الفأس',blade:'نصل الصولجان',crown:'رأس الصولجان'})}</label>
        <label class="vfx-color"><input type="checkbox" data-setting="recolor"> لون مخصص
          <input type="color" data-setting="color" value="#e4a05d" aria-label="لون المؤثر"></label>
        <div class="vfx-layers">${layers.map(name=>
          `<label><input type="checkbox" data-layer="${name}" checked> ${layerLabels[name]}</label>`).join('')}</div>
      </details>
      <details><summary>أطالس المصادر</summary>
        ${Object.entries(units).map(([type,label])=>`<label class="vfx-file">${label}
          <input type="file" accept="image/png,image/jpeg,image/webp" data-sheet="${type}"></label>`).join('')}
        <div id="vfx-sheets" role="status"></div><a class="vfx-download" href="vfx-lab/materials/extracted-textures.zip" download>تنزيل الخامات المعالجة</a>
      </details>
      <div class="vfx-buttons vfx-presets"><button type="button" data-command="save">حفظ الإعداد</button>
        <button type="button" data-command="restore">استعادة الإعداد</button></div>
      <output class="vfx-note" id="vfx-note" role="status">جارٍ تجهيز الشخصيات والخامات</output>
    </aside>
    <output class="vfx-perf" dir="ltr" id="vfx-perf">—</output>`;
  document.body.append(shell);
  return shell;
}

async function stage(T, renderer) {
  const ktx=new KTX2Loader().setTranscoderPath('vendor/basis/').setWorkerLimit(2).detectSupport(renderer);
  await MeshoptDecoder.ready;
  const loader=new GLTFLoader().setKTX2Loader(ktx).setMeshoptDecoder(MeshoptDecoder);
  const textures=new T.TextureLoader();
  const scene=new T.Scene();
  scene.name='VFXLabStage';
  scene.background=new T.Color(0x111722);
  scene.fog=new T.FogExp2(0x111924,.047);
  const creative = [
    ['road-stone.webp',true],['road-stone-normal.webp',false],['road-stone-rough.webp',false],['road-medallion.webp',true]
  ];
  let hero,guard,arch,maps;
  try {
    [hero,guard,arch,maps]=await Promise.all([
      loader.loadAsync('assets/Sin_hero_runtime.glb'),
      loader.loadAsync('assets/Guardian_of_the_Covenant.glb'),
      loader.loadAsync(STONE+'architecture.glb'),
      Promise.all(creative.map(([name,srgb])=>textures.loadAsync(STONE+name).then(texture=>{
        if(srgb)texture.colorSpace=T.SRGBColorSpace;
        texture.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
        return texture;
      })))
    ]);
  } finally {ktx.dispose();}
  const sin=createActor(hero,'sin',1.83,'Axe_CombatIdle');
  const guardian=createActor(guard,'guardian',3.52,'Combat_Idle');
  const groundMaterial=new T.MeshStandardMaterial({
    color:0xbdbdc0,map:maps[0],normalMap:maps[1],roughnessMap:maps[2],normalScale:new T.Vector2(.53,.53),roughness:.85
  });
  for (const texture of maps.slice(0,3)) {
    texture.wrapS=texture.wrapT=T.RepeatWrapping;
    texture.repeat.set(8,8);
  }
  const ground=new T.Mesh(new T.CircleGeometry(12,96),groundMaterial);
  ground.name='VFXLabFloor';ground.rotation.x=-Math.PI/2;
  const under=new T.Mesh(new T.CylinderGeometry(12,11.4,2.4,80),groundMaterial);
  under.position.y=-1.205;
  const inlay=new T.Mesh(new T.CircleGeometry(4.8,84),
    new T.MeshStandardMaterial({map:maps[3],roughness:.86,color:0xb6a58d}));
  inlay.rotation.x=-Math.PI/2;inlay.position.y=.005;
  scene.add(ground,under,inlay,sin.root,guardian.root);

  const column=arch.scene.getObjectByName('Harbor_Column');
  const lamp=arch.scene.getObjectByName('Harbor_Turquoise_Lamp');
  function place(template, height, x, z) {
    const asset=template.clone(true);
    const bounds=new T.Box3().setFromObject(asset,true);
    asset.scale.multiplyScalar(height/(bounds.max.y-bounds.min.y));
    bounds.setFromObject(asset,true);
    asset.position.x+=x-(bounds.min.x+bounds.max.x)/2;
    asset.position.y-=bounds.min.y;
    asset.position.z+=z-(bounds.min.z+bounds.max.z)/2;
    scene.add(asset);
  }
  for(let i=0;i<6;i++){
    const angle=.90+i*.48;
    const x=Math.cos(angle)*8.55,z=Math.sin(angle)*8.55;
    place(column,5.25,x,z);
    if(i%2===0)place(lamp,1.13,x*.79,z*.79);
  }
  scene.add(new T.HemisphereLight(0xb8ceea,0x59506a,.68));
  const key=new T.DirectionalLight(0xffe0b3,.96);
  key.position.set(1.2,9.3,-4.5);
  const rim=new T.DirectionalLight(0x8fc7f5,1);
  rim.position.set(-5.7,5.1,7.1);
  scene.add(key,rim);
  // The physical surface can be staged to meet an existing authored strike
  // arc without bending the limb or fabricating a contact point.
  const impactBlock=new T.Mesh(new T.BoxGeometry(1,1,1),groundMaterial);
  impactBlock.name='VFXLabContactSurface';
  impactBlock.visible=false;
  scene.add(impactBlock);
  function fixture(kind, point, plane) {
    impactBlock.visible=kind==='wall'||kind==='ledge';
    if(!impactBlock.visible)return;
    if(kind==='wall'){
      const sign=Math.sign(plane)||1;
      impactBlock.scale.set(2.1,2.5,.44);
      impactBlock.position.set(point.x,1.24,plane+sign*.22);
    }else{
      impactBlock.scale.set(2.26,plane,2.26);
      impactBlock.position.set(point.x,plane*.5,point.z);
    }
  }
  return { scene,sin,guardian,fixture };
}

export async function open(area) {
  const shell=createUI(area);
  const canvas=shell.querySelector('canvas');
  const note=shell.querySelector('#vfx-note');
  const effectSelect=shell.querySelector('#vfx-effect');
  const performanceBox=shell.querySelector('#vfx-perf');
  const renderer=new T.WebGLRenderer({
    canvas,powerPreference:'high-performance',antialias:false,preserveDrawingBuffer:false
  });
  renderer.outputColorSpace=T.SRGBColorSpace;
  renderer.toneMapping=T.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.2;
  const camera=new T.PerspectiveCamera(45,1,.08,90);
  const controls=new OrbitControls(camera,canvas);
  controls.enableDamping=true;
  controls.minDistance=.8;
  controls.maxDistance=28;
  controls.maxPolarAngle=Math.PI-.06;
  const poseAim=vec(0,1.16,0);
  const orbit = {
    oblique:vec(5.7,1.75,-5.2), front:vec(.2,1.48,-7.6), reverse:vec(-.35,1.54,7.8),
    top:vec(2.9,6.8,3.4), close:vec(3.75,1.05,-3.1)
  };
  let qualityHint='high';
  const settings={...defaults};
  let frame=0, accumulator=0,last=null, paused=false, presentation=null, stepCount=0, disposed=false;
  let prewarm, view='oblique', centerStats=null, shown=true;
  const rafSamples=new Float32Array(150);
  let frameIndex=0, stamp=0, fps=0;
  const setView=(where='oblique')=>{
    view=orbit[where]?where:'oblique';
    controls.target.copy(poseAim);
    camera.position.copy(poseAim).add(orbit[view]);
    controls.update();
  };
  const fit=()=>{
    const width=canvas.clientWidth,height=canvas.clientHeight;
    camera.aspect=width/Math.max(height,1);
    camera.updateProjectionMatrix();
    const quality=settings.quality==='auto'?qualityHint:settings.quality;
    const cap={low:.78,medium:1,high:1.4}[quality];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,cap));
    renderer.setSize(width,height,false);
  };
  fit();setView();
  const effectsRoot=new T.Group();
  const [{scene,sin,guardian,fixture},manager]=await Promise.all([
    stage(T,renderer),createManager(T,effectsRoot,()=>qualityHint)
  ]);
  // Attach the effect root to the same scene as the tracked models.
  scene.add(effectsRoot);
  manager.bind(sin.nodes.get('Axe'),guardian.nodes.get('Guardian_Staff'));
  const action=choreograph({
    scene,sin,guardian,fx:manager,fixture,settings,
    focus(attacker,target){
      const previous=poseAim.clone();
      poseAim.copy(attacker.root.position).lerp(target.root.position,.43);
      poseAim.y=1.27;
      if(!presentation){
        camera.position.add(poseAim.clone().sub(previous));
        controls.target.copy(poseAim);
      }
    }
  });
  const packed=new Map();
  async function shipped(kind) {
    const data=await fetch(new URL('materials/' +kind+ '/regions.json',import.meta.url));
    if(!data.ok || !String(data.headers.get('content-type')).includes('json'))return;
    const parsed=await data.json();
    const image=await new T.ImageLoader().loadAsync(new URL('materials/'+kind+'/atlas.webp',import.meta.url).href);
    renderer.initTexture(manager.installAtlas(kind,{atlas:image,regions:parsed.regions}));
    packed.set(kind,true);
  }
  await Promise.all(Object.keys(units).map(shipped));
  const status=()=> {
    shell.querySelector('#vfx-sheets').textContent=packed.size===3?'أطالس الصور الثلاث محمّلة':
      'الأطالس المحمّلة '+packed.size+' / 3';
  };
  status();
  const calibrated=await action.prepareContacts();
  prewarm=await window.SinZoneStreamer.prepareRender(T,renderer,scene,camera,{
    roots:[scene,...manager.prepare],budgetMs:7
  });
  prewarm.calibrated=calibrated;
  note.textContent='اختر مؤثراً أو شغّل القتال التجريبي';
  function loadPrefs() {
    try{return JSON.parse(localStorage.getItem(STORE)) || {};}
    catch{return {};}
  }
  function controlsFromSettings(){
    for(const field of shell.querySelectorAll('[data-setting]')){
      const key=field.dataset.setting;
      if(!(key in settings))continue;
      if(field.type==='checkbox')field.checked=settings[key];
      else field.value=settings[key];
      const metric=shell.querySelector('[data-value="'+key+'"]');
      if(metric)metric.value=Number(settings[key]).toFixed(2);
    }
    manager.configure(settings);
  }
  controlsFromSettings();
  const inputs=new AbortController();
  const {signal}=inputs;
  window.addEventListener('resize',fit,{signal});
  const observer=new ResizeObserver(fit);
  observer.observe(canvas);
  function play(id=effectSelect.value) {
    if(!effects[id])return;
    effectSelect.value=id;
    paused=false;accumulator=0;
    action.play(id);
    note.textContent=effects[id].label;
    shell.querySelector('[data-command=pause]').textContent='إيقاف';
  }
  function setPause(value) {
    paused=value;accumulator=0;
    shell.querySelector('[data-command=pause]').textContent=paused?'استكمال':'إيقاف';
  }
  function toggle() {
    shown=!shown;
    shell.classList.toggle('vfx-hidden',!shown);
    shell.querySelector('.vfx-show').setAttribute('aria-expanded',String(shown));
  }
  shell.addEventListener('click',event=>{
    const control=event.target.closest('[data-command]');
    if(!control)return;
    switch(control.dataset.command) {
      case 'play': case 'zero': play();break;
      case 'pause': setPause(!paused);break;
      case 'step': setPause(true);action.step(STEP);stepCount++;break;
      case 'demo': setPause(false);action.demo();note.textContent='القتال التجريبي';break;
      case 'toggle':toggle();break;
      case 'save': {
        const values=loadPrefs();
        values[effectSelect.value]={ ...settings, layers:Object.fromEntries([...shell.querySelectorAll('[data-layer]')]
          .map(input=>[input.dataset.layer,input.checked])) };
        try {localStorage.setItem(STORE,JSON.stringify(values));note.textContent='حُفظ إعداد المؤثر';}
        catch {note.textContent='تعذّر حفظ الإعداد في هذا المتصفح';}
        break;
      }
      case 'restore': {
        const value=loadPrefs()[effectSelect.value];
        Object.assign(settings,normalizeSettings(value));
        for(const input of shell.querySelectorAll('[data-layer]')){
          input.checked=value?.layers?.[input.dataset.layer]!==false;
          manager.setLayer(input.dataset.layer,input.checked);
        }
        controlsFromSettings();fit();
        note.textContent=value?'استُعيد إعداد المؤثر':'استُعيد الإعداد الافتراضي';
        break;
      }
    }
  },{signal});
  shell.addEventListener('input',event=>{
    const input=event.target;
    const key=input.dataset.setting;
    if(key==='camera')return setView(input.value);
    if(key==='surfacePreview')return action.hold(input.value==='off'?'':input.value);
    if(!(key in settings))return;
    settings[key]=input.type==='checkbox'?input.checked:input.type==='range'?Number(input.value):input.value;
    if(key==='color'){
      settings.recolor=true;
      shell.querySelector('[data-setting=recolor]').checked=true;
    }
    const metric=shell.querySelector('[data-value="'+key+'"]');
    if(metric)metric.value=Number(settings[key]).toFixed(2);
    manager.configure(settings);
    if(key==='quality')fit();
  },{signal});
  shell.addEventListener('change',async event=>{
    const field=event.target;
    if(field.dataset.layer)manager.setLayer(field.dataset.layer,field.checked);
    if(field===effectSelect){
      const saved=loadPrefs()[effectSelect.value];
      if(saved)Object.assign(settings,normalizeSettings(saved));
      controlsFromSettings();fit();return;
    }
    const kind=field.dataset.sheet;
    if(kind&&field.files?.[0]){
      field.disabled=true;
      try{
        const result=await importSheet(field.files[0],kind);
        renderer.initTexture(manager.installAtlas(kind,result));
        packed.set(kind,true);status();
        note.textContent='استُخرجت '+result.images.length+' عينة من '+units[kind];
      }catch(error){note.textContent=error.message;}
      finally{field.disabled=false;}
    }
  },{signal});
  window.addEventListener('keydown',event=>{
    if (/INPUT|SELECT|BUTTON|TEXTAREA/.test(event.target.tagName) || presentation)return;
    if(event.code==='Space'){event.preventDefault();setPause(!paused);}
    if(event.code==='Period'){setPause(true);action.step(STEP);stepCount++;}
    if(event.code==='KeyH')toggle();
  },{signal});
  function refresh(ts) {
    if(ts-stamp<260)return;
    stamp=ts;
    const s=action.state(), f=manager.stats(), r=renderer.info;
    const values=Array.from(rafSamples).filter(Boolean).sort((a,b)=>a-b);
    const p95=values[Math.min(values.length-1,Math.floor(values.length*.95))];
    const frameAvg=values.reduce((one,t)=>one+t,0)/Math.max(1,values.length);
    fps=frameAvg?1000/frameAvg:0;
    if(frameIndex>=60 && settings.quality==='auto' && !paused && !presentation) {
      // Demand a large change between bands and never upshift from a static view.
      const target = fps<30?'low':fps<44?'medium':'high';
      if(target!==qualityHint && (target==='low'||target==='medium'&&qualityHint==='high'||fps>55)) {qualityHint=target;fit();}
    }
    shell.querySelector('#vfx-clip').textContent=s.clip||'Axe_CombatIdle / Combat_Idle';
    shell.querySelector('#vfx-window').textContent= s.window ? s.clipTime.toFixed(3)+' · '+s.window.join('–') : '—';
    shell.querySelector('#vfx-contacts').textContent=String(s.hitCount);
    if(!centerStats || ts-centerStats.t>1700) {
      centerStats={t:ts, estimate:window.SinProcessMemory?.estimate({scene,renderer,phase:'vfx-lab'})};
    }
    const gpu=centerStats.estimate?.gpuMB;
    performanceBox.textContent=`${fps.toFixed(0)} FPS · P95 ${p95?.toFixed(1)||'—'} ms · ${r.render.calls} draws · ${f.activeSparks+f.activeDust+f.rocks} particles · ${r.memory.textures} tex${gpu?' · GPU ~'+gpu.toFixed(0)+' MiB':''}`;
  }
  function loop(ts) {
    if(disposed)return;
    frame=requestAnimationFrame(loop);
    const elapsed=(ts-(last??ts))/1000;
    last=ts;
    if(elapsed>0)rafSamples[frameIndex++%rafSamples.length]=elapsed*1000;
    if(!paused){
      manager.frame(elapsed);
      accumulator+=Math.min(.12,elapsed)*settings.speed;
      while(accumulator>=STEP){action.step(STEP);stepCount++;accumulator-=STEP;}
    }
    if(presentation)presentation(ts);
    else {
      controls.update();
      const kick=manager.cameraImpulse();
      camera.position.add(kick);
      renderer.render(scene,camera);
      camera.position.sub(kick);
    }
    refresh(ts);
  }
  frame=requestAnimationFrame(loop);
  window.__sinVfxLab={
    effectIds:Object.keys(effects),prewarm,play,demo:()=>{setPause(false);action.demo();},
    pause:setPause,step(n=1){setPause(true);for(let i=0;i<Math.min(720,n);i++){action.step(STEP);stepCount++;}},
    setView,focus(part){action.hold(part);},
    settings(value){Object.assign(settings,normalizeSettings(value));controlsFromSettings();fit();},
    snapshot(){
      return { ...action.state(), paused,stepCount, fps, resize:renderer.getDrawingBufferSize(new T.Vector2()).toArray(),
        fx:manager.stats(), memory:{...renderer.info.memory}, draw:{...renderer.info.render},
        estimated:centerStats?.estimate, root:scene.name, assets:scene.children.map(o=>o.name).filter(Boolean) };
    },
    draw(target=camera){renderer.render(scene,target);},
    camera,renderer,scene
  };
  window.addEventListener('pagehide',event=>{
    if(event.persisted)return;
    disposed=true;
    cancelAnimationFrame(frame);observer.disconnect();controls.dispose();inputs.abort();manager.dispose();
    const buffers=new Set(),materials=new Set(),textures=new Set();
    scene.traverse(node=>{
      if(node.geometry)buffers.add(node.geometry);
      if(node.material) for(const material of Array.isArray(node.material)?node.material:[node.material]) {
        materials.add(material);
        for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
      }
      node.skeleton?.dispose();
    });
    for(const resource of [...buffers,...materials,...textures])resource.dispose();
    renderer.dispose();
  },{signal,once:true});
  return {
    renderer, scene, camera, hero:()=>sin.root, reset(){action.reset();setPause(true);setView();},
    holdPresentation(draw){presentation=draw;controls.enabled=!draw;},
    setFacing:yaw=>{sin.root.rotation.y=yaw;},ground:()=>0,blocked:()=>false,phase:()=> 'ready'
  };
}
