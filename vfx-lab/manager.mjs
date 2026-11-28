import '../sin-combat-vfx.js';
import { canvasTexture } from './atlas.mjs';
import { effects } from './presets.mjs';

const layerNames = ['edge','ribbon','sparks','dust','debris','decal','wave'];
export const defaults = Object.freeze({
  speed: 1, scale: 1, density: 1, glow: 1, opacity: 1, duration: 1, force: 1,
  quality: 'auto', surface: 'auto', color: '#e4a05d', recolor: false, shake: .65, repeat: false
});
export const limits = {
  speed:[.15,1.65], scale:[.45,1.8], density:[.25,1.55], glow:[.2,1.8],
  opacity:[.2,1], duration:[.5,2.4], force:[.45,1.65], shake:[0,1]
};
export const layers = layerNames;
const choices = {
  quality: ['auto','high','medium','low'],
  surface: ['auto','armor','metal','stone','wall','flesh','spirit']
};

export function normalizeSettings(input) {
  const out = { ...defaults };
  for (const [name, [min,max]] of Object.entries(limits)) {
    if (typeof input?.[name] === 'number' && Number.isFinite(input[name])) out[name] = Math.max(min,Math.min(max,input[name]));
  }
  for (const [name, values] of Object.entries(choices)) if (values.includes(input?.[name])) out[name] = input[name];
  if (/^#[a-f\d]{6}$/i.test(input?.color || '')) out.color = input.color;
  out.recolor = input?.recolor === true;
  out.repeat = input?.repeat === true;
  return out;
}

async function readShader(name) {
  const response = await fetch(new URL('shaders/' + name + '.glsl', import.meta.url));
  if (!response.ok) throw new Error('تعذّر تحميل GLSL: ' + name);
  return response.text();
}

export async function createManager(T, root, displayQuality) {
  const variants = layerNames.filter(name => name !== 'debris');
  const [common, ...fragments] = await Promise.all([readShader('material'),...variants.map(name => readShader(name + '.frag'))]);
  const shaders = Object.fromEntries(variants.map((name,i) => [name,common + '\n' + fragments[i]]));
  const local = Object.fromEntries(layerNames.map(key => [key, true]));
  const settings = { ...defaults };
  const uniforms = {
    uOpacity: {value:1}, uGlow: {value:1}, uRecolor:{value:0}, uPalette:{value:new T.Color(defaults.color)}
  };
  const placeholder = new T.DataTexture(new Uint8Array([255,255,255,0]),1,1);
  placeholder.needsUpdate = true;
  const atlasUniforms = () => ({
    uSheet: {value:placeholder}, uHasSheet: {value:0},
    uRegion: {value:new T.Vector4(0,0,1,1)}, uRegionGold: {value:new T.Vector4(0,0,1,1)}
  });
  const atlases = Object.fromEntries(variants.map(name => [name,atlasUniforms()]));
  const fx = window.SinCombatVFX.create(T,root,displayQuality,undefined,{shaders,uniforms,atlases,layers:local,settings});
  const sheetTextures = new Map();
  const point = new T.Vector3(), direction = new T.Vector3(), normal = new T.Vector3(), up = new T.Vector3(0,1,0);
  const front = new T.Vector3(), worldInverse = new T.Matrix4();
  const cameraKick = new T.Vector3();
  const wave = { point:new T.Vector3(), radius:0, max:0, age:0, speed:10, variant:'ground', palette:0xe6a367 };
  const impulses = [];
  const scheduled=new Map();
  fx.bindRibbon('claw',0xd89a50,.14);
  let last = null, total = 0, age = 0;

  function configure(value) {
    Object.assign(settings,normalizeSettings(value));
    uniforms.uOpacity.value=settings.opacity;
    uniforms.uGlow.value=settings.glow;
    uniforms.uRecolor.value=Number(settings.recolor);
    uniforms.uPalette.value.set(settings.color);
    fx.setTier(settings.quality);
  }
  function installAtlas(kind,result) {
    const texture=canvasTexture(T,result.atlas);
    const targets={ ground:['decal'], sparks:['sparks'], energy:['ribbon','edge','wave'] }[kind];
    for (const name of targets) {
      const u=atlases[name];
      u.uHasSheet.value=1;
      u.uSheet.value=texture;
      const region=kind==='ground' ? 3 : 0;
      u.uRegion.value.fromArray(result.regions[region]);
      u.uRegionGold.value.fromArray(result.regions[kind==='energy' ? 1 : region]);
    }
    sheetTextures.get(kind)?.dispose();
    sheetTextures.set(kind,texture);
    return texture;
  }

  /** Verified contact events or authored markers are supplied by the caller. */
  function play(id, {
    worldPosition, surfaceNormal=up, direction: velocity=up, scale=1, intensity=1, duration,
    weaponSocket=null, surfaceType=null, kind, groundHeight, variant, decalScale=1
  } = {}) {
    const preset=effects[id];
    if(!preset) throw new Error('Unknown VFX effect ' + id);
    kind=kind || (preset.contact==='none' ? 'trail' : 'impact');
    if(kind==='trail' && preset.channel!=='claw' && preset.channel!=='seal'){
      scheduled.set(preset.channel,{until:age+(duration??.48)*settings.duration,intensity:intensity*preset.strength});
      last={id,kind,surface:'none',at:age};total++;
      return last;
    }
    if (!worldPosition && weaponSocket) worldPosition=weaponSocket.getWorldPosition(front);
    if(!worldPosition) throw new Error('A contact point or a weapon socket is required');
    root.updateWorldMatrix(true,false);
    worldInverse.copy(root.matrixWorld).invert();
    point.copy(worldPosition).applyMatrix4(worldInverse);
    direction.copy(velocity).transformDirection(worldInverse);
    normal.copy(surfaceNormal).transformDirection(worldInverse);
    const surface=surfaceType || preset.contact;
    const goldSeal=preset.actor==='guardian' && (surface==='seal'||surface==='spirit');
    const tint=settings.recolor ? uniforms.uPalette.value.getHex() : goldSeal ? 0xffab57 : undefined;
    const physical=surface==='wall' ? 'stone' : surface;
    const force=intensity*settings.force*preset.strength;
    const size=scale*settings.scale;
    if (physical!=='none') {
      fx.impact(point, {
        surface:physical==='seal' ? 'spirit' : physical, velocity:direction, normal, strength:force,
        moon:preset.moon, scale:size, decalScale, floor:groundHeight ?? 0, fracture:physical==='stone', palette:tint, durationScale:duration ? Math.min(3,duration/.6) : 1
      });
    }
    const type=variant||preset.wave||preset.burst;
    if (type && kind!=='charge') {
      wave.point.copy(point);
      if(groundHeight!=null) wave.point.y=groundHeight + .013;
      wave.radius=wave.age=0;
      wave.max=(type==='moon' ? 1.8 : type==='seal' ? 4.9 : 3.65)*size;
      wave.speed=wave.max/Math.max(.24,duration??(type==='seal'?.61:.42)*settings.duration);
      wave.variant=type==='seal'?'spirit':'ground';
      wave.palette=tint??(type==='moon'?0x98bbff:type==='seal'?0xffbb70:0xeb9e4b);
    }
    if (kind==='impact' && physical==='stone') {
      front.copy(direction).multiplyScalar(.46).addScaledVector(normal,.68);
      impulses.push({at:age,strength:Math.min(.23,force*.095)*settings.shake,direction:front.clone()});
      if(impulses.length>6)impulses.shift();
    }
    last={id,kind,surface,point:worldPosition.toArray(),at:age};
    total++;
    return last;
  }

  function weapon(channel, amount, dt) { fx.weapon(channel,amount,dt); }
  function tick(dt) {
    age+=dt;
    for(const [channel,item] of scheduled) {
      fx.weapon(channel,item.until>=age?item.intensity:0,dt);
      if(item.until+.5<age)scheduled.delete(channel);
    }
    fx.update(dt,0);
    if(wave.max) {
      wave.age+=dt;
      wave.radius=Math.min(wave.max,wave.age*wave.speed);
      fx.shockwave(wave.point,wave.radius,wave.max,wave.variant,wave.palette);
      if(wave.radius>=wave.max) wave.max=0;
    } else fx.shockwave(null);
  }
  function cameraImpulse() {
    cameraKick.set(0,0,0);
    for(const i of impulses) {
      const t=age-i.at;
      if(t>.28)continue;
      cameraKick.addScaledVector(i.direction,Math.sin(t*80)*Math.exp(-t*20)*i.strength);
    }
    return cameraKick;
  }
  return {
    play, configure, installAtlas, weapon, tick, cameraImpulse,
    frame:fx.frame, traceRibbon:fx.traceRibbon, setLayer(name,value){ if(name in local)local[name]=value; },
    bind(axe,staff){ fx.bindWeapon(axe,['axe']); fx.bindWeapon(staff,['blade','crown']); },
    prepare:fx.prepare, sample:fx.sample, lowest:fx.lowest, surface:fx.surface, preview:fx.preview,
    clear(){ fx.clear(); wave.max=0; impulses.length=0; scheduled.clear(); },
    stats(){ return {...fx.stats(), total, last, atlases:[...sheetTextures.keys()]}; },
    dispose(){ fx.dispose(); placeholder.dispose(); for(const texture of sheetTextures.values())texture.dispose(); }
  };
}
