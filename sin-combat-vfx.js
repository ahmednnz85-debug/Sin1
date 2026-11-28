/* Transient combat presentation. Callers own contacts, damage, and timing. */
(function (root) {
  'use strict';

  const LIMITS = { sparks: 64, dust: 16, fragments: 28, decals: 3, samples: 18 };
  const SURFACES = {
    stone: { sparks: 22, dust: 11, fragments: 17, tint: 0xffa34d },
    metal: { sparks: 28, dust: 0, fragments: 0, tint: 0xffca74 },
    armor: { sparks: 18, dust: 0, fragments: 3, tint: 0xffae61 },
    flesh: { sparks: 3, dust: 2, fragments: 0, tint: 0x986b60 },
    spirit: { sparks: 21, dust: 5, fragments: 0, tint: 0x98eaf3 },
    parry: { sparks: 32, dust: 0, fragments: 0, tint: 0xffe1a2 }
  };
  const PROFILES = {
    axe: { y: [.206, .412], edge: 0, width: .022, tint: 0x709fff, length: .145 },
    blade: { y: [-2.55, -1.28], edge: 1, width: .042, tint: 0xffad46, length: .157 },
    crown: { y: [.62, 1.375], edge: 2, width: .09, tint: 0xffba64, length: .208 }
  };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const shaderNoise = `
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float grit(vec2 p) {
      vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
      return mix(mix(hash(i), hash(i+vec2(1.,0.)),f.x),
                 mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.,1.)),f.x),f.y);
    }
  `;
  const output = `
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  `;

  function create(T, parent, tier = () => 'high', profiles = PROFILES) {
    const clock = { value: 0 }, textureFallback = new T.DataTexture(new Uint8Array([255,255,255,255]), 1, 1);
    textureFallback.needsUpdate = true;
    const rootSpace = new T.Group();
    rootSpace.name = 'CombatVFX';
    parent.add(rootSpace);
    const keep = [], bindings = new Map();
    const tmp = new T.Vector3(), tmpB = new T.Vector3(), tmpC = new T.Vector3(), scratch = new T.Vector3();
    const inverse = new T.Matrix4(), transpose = new T.Matrix4();
    const color = new T.Color(), up = new T.Vector3(0, 1, 0);
    const prepared = [];
    let enabled = true, preview = '', forcedTier = 'auto', pressure = 0;
    let randomState = 118371;
    function random() {
      randomState ^= randomState << 13;
      randomState ^= randomState >>> 17;
      randomState ^= randomState << 5;
      return (randomState >>> 0) / 4294967296;
    }
    const metrics = { impacts: 0, stone: 0, metal: 0, armor: 0, flesh: 0, spirit: 0, parry: 0, samples: 0 };
    function budget() {
      const current = forcedTier === 'auto' ? tier() : forcedTier;
      return current === 'low' || (forcedTier === 'auto' && pressure > 1) ? .5 : current === 'medium' ? .72 : 1;
    }
    function own(object) { keep.push(object); return object; }
    function mount(mesh) {
      mesh.name = 'CombatFX_' + mesh.name;
      rootSpace.add(mesh);
      mesh.visible = false;
      prepared.push(mesh);
      return mesh;
    }

    // Instanced quads store immutable spawn parameters until a slot is
    // recycled. Motion, changing width and opacity are evaluated on the GPU.
    function particles(name, count, isDust) {
      const card = new T.PlaneGeometry(2, 2);
      const geometry = own(new T.InstancedBufferGeometry());
      geometry.index = card.index;
      for (const key of ['position', 'uv']) geometry.setAttribute(key, card.attributes[key]);
      const attr = {};
      for (const [key, size] of [['origin',3], ['velocity',3], ['timing',4], ['tint',3]]) {
        attr[key] = new T.InstancedBufferAttribute(new Float32Array(count * size), size).setUsage(T.DynamicDrawUsage);
        geometry.setAttribute(key, attr[key]);
      }
      geometry.instanceCount = 0;
      const material = own(new T.ShaderMaterial({
        // The card is already in lens space. Both sides also work when
        // the caller's authored chapter has a mirrored world transform.
        transparent: true, depthWrite: false, side: T.DoubleSide, forceSinglePass: true,
        blending: isDust ? T.NormalBlending : T.AdditiveBlending,
        uniforms: { now: clock, dust: { value: isDust ? 1 : 0 } },
        vertexShader: `
          uniform float now, dust;
          attribute vec3 origin, velocity, tint; attribute vec4 timing;
          varying vec2 vUv; varying vec4 vColor; varying float vTime, vSeed;
          void main() {
            float age=max(0.,now-timing.x), life=clamp(age/timing.y,0.,1.);
            float air=1.-exp(-age*2.0);
            vec3 motion=mix(velocity*age+vec3(0.,-4.5*age*age,0.),velocity*air*.63,dust);
            vec4 view=modelViewMatrix*vec4(origin+motion,1.);
            vec3 rate=mix(velocity-vec3(0.,age*9.,0.),velocity,dust);
            vec2 direction=(modelViewMatrix*vec4(rate,0.)).xy;
            direction=normalize(direction+vec2(.0001,0.));
            vec2 crossAxis=vec2(-direction.y,direction.x);
            float width=timing.z*mix(1.-life*.61,.4+life*1.8,dust);
            float axisLen=width*mix(clamp(length(rate)*2.2,2.5,13.),1.85,dust);
            vec2 xy=mix(direction*position.x*axisLen+crossAxis*position.y*width,
                        position.xy*vec2(axisLen,width),dust);
            view.xy+=xy;
            gl_Position=projectionMatrix*view;
            vUv=uv; vTime=life; vSeed=timing.w;
            float nearFade=smoothstep(.25,1.2,-view.z);
            vColor=vec4(tint, nearFade * step(age,timing.y) * step(.0001,timing.y));
          }
        `,
        fragmentShader: `
          uniform float dust;
          varying vec2 vUv; varying vec4 vColor; varying float vTime,vSeed;
          ${shaderNoise}
          void main() {
            vec2 p=(vUv-.5)*2.; float r=length(p);
            float fade=pow(max(0.,1.-vTime),1.4)*vColor.a;
            float cloud=grit(p*3.7+vSeed+vTime*.58)*.63+grit(p*8.3-vSeed*.16)*.37;
            float smoke=pow(clamp((1.-r)*1.5,0.,1.),1.4)*smoothstep(.21,.7,cloud);
            smoke*=smoothstep(-.96,-.5,p.y)*smoothstep(0.,.10,vTime);
            float line=exp(-p.y*p.y*11.)*pow(max(0.,1.-abs(p.x)),1.65);
            float glint=exp(-r*r*10.)*(.52+.48*exp(-abs(p.y)*14.))*pow(max(0.,1.-vTime),2.);
            line=mix(line,glint,step(vSeed,-.5));
            vec3 warm=vColor.rgb*mix(2.15,.68,vTime);
            gl_FragColor=vec4(mix(warm,vColor.rgb,dust),fade*mix(line,smoke*.45,dust));
            ${output}
          }
        `
      }));
      const mesh = new T.Mesh(geometry, material);
      mesh.name = name;
      mesh.frustumCulled = false;
      mount(mesh);
      const end = new Float32Array(count);
      let used = 0, cursor = 0, dirty = false;
      return {
        spawn(point, velocity, life, size, rgb, glint = false) {
          let slot = cursor;
          for (let i = 0; i < count; i++) {
            const candidate = (cursor + i) % count;
            if (end[candidate] <= clock.value) { slot = candidate; break; }
          }
          cursor = (slot + 1) % count;
          end[slot] = clock.value + life;
          used = Math.max(used, slot + 1);
          attr.origin.setXYZ(slot, point.x, point.y, point.z);
          attr.velocity.setXYZ(slot, velocity.x, velocity.y, velocity.z);
          attr.timing.setXYZW(slot, clock.value, life, size, glint ? -1 : random()*83);
          attr.tint.setXYZ(slot, rgb.r, rgb.g, rgb.b);
          dirty = true;
        },
        update() {
          while (used && end[used - 1] <= clock.value) used--;
          if (dirty) for (const buffer of Object.values(attr)) buffer.needsUpdate = true;
          dirty = false;
          geometry.instanceCount = used;
          mesh.visible = enabled && used !== 0;
        },
        clear() { end.fill(0); used = cursor = 0; mesh.visible = false; },
        count() {
          let active = 0;
          for (let i = 0; i < used; i++) if (end[i] > clock.value) active++;
          return active;
        }
      };
    }

    const spark = particles('Sparks', LIMITS.sparks, false), dust = particles('Dust', LIMITS.dust, true);
    const rock = new T.InstancedMesh(own(new T.IcosahedronGeometry(1,0)),
      own(new T.MeshStandardMaterial({ color: 0xb9a189, roughness: .94 })), LIMITS.fragments);
    rock.name = 'StoneFragments';
    rock.count = 0;
    rock.frustumCulled = false;
    mount(rock);
    const debris = Array.from({ length: LIMITS.fragments }, () => ({ point: new T.Vector3(), speed: new T.Vector3(), age: 0, life: 0, y: 0,
      rotation: 0, spin: 0, size: .015, tint: new T.Color() }));
    const fragmentMatrix = new T.Object3D();
    let nextRock = 0;
    function stone(point, normal, size, strength, count, floor) {
      for (let i = 0; i < count; i++) {
        const d = debris[nextRock++ % debris.length], angle = random() * 6.283;
        d.point.copy(point);
        d.y = floor ?? point.y;
        d.age = 0;
        d.life = .48 + random()*.8;
        d.speed.set(Math.cos(angle)*(1.25+2.6*random()), .8+random()*2.1, Math.sin(angle)*(1.25+2.6*random()))
          .addScaledVector(normal,.85).multiplyScalar(strength);
        d.rotation = random() * 6.283;
        d.spin = random()*12-6;
        d.size = size * (.38 + random()*.88);
        d.tint.setHex(random() > .5 ? 0x6b645d : 0x898078);
      }
    }
    function updateStone(dt) {
      let count = 0;
      for (const d of debris) {
        if (d.age >= d.life) continue;
        d.age += dt;
        d.speed.y -= dt*12;
        d.point.addScaledVector(d.speed, dt);
        if (d.point.y < d.y) {
          d.point.y = d.y;
          d.speed.y = Math.max(0, -d.speed.y*.28);
          d.speed.x *= .57;
          d.speed.z *= .57;
        }
        d.rotation += d.spin*dt;
        fragmentMatrix.position.copy(d.point);
        fragmentMatrix.rotation.set(d.rotation, d.rotation*.4, -d.rotation*.6);
        const f = d.size * clamp((d.life-d.age)*4,0,1);
        fragmentMatrix.scale.set(f, f*.64, f*.84);
        fragmentMatrix.updateMatrix();
        rock.setMatrixAt(count, fragmentMatrix.matrix);
        rock.setColorAt(count++, d.tint);
      }
      if (count) {
        rock.instanceMatrix.needsUpdate = true;
        rock.instanceColor.needsUpdate = true;
      }
      rock.count = count;
      rock.visible = enabled && count > 0;
    }

    const crackGeometry = own(new T.PlaneGeometry(2,2));
    const cracks = Array.from({ length: LIMITS.decals }, () => {
      const material = own(new T.ShaderMaterial({
        transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
        uniforms: { opacity: { value: 0 }, seed: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `
          uniform float opacity,seed; varying vec2 vUv;
          ${shaderNoise}
          void main() {
            vec2 p=vUv*2.-1.; float r=length(p),a=atan(p.y,p.x);
            float k=(a+.023*sin(r*72.+seed)+.1*grit(p*7.+seed))*2.7;
            float main=1.-smoothstep(.006,.051,abs(sin(k)));
            float branch=(1.-smoothstep(.008,.09,abs(sin(k*1.73+r*17.+seed))))*smoothstep(.35,.65,grit(p*14.+seed));
            float edge=(main+branch*.5)*(1.-smoothstep(.22,.98,r))*smoothstep(.018,.07,r);
            float lip=smoothstep(.024,.078,abs(sin(k)))*(1.-smoothstep(.07,.12,abs(sin(k))));
            gl_FragColor=vec4(mix(vec3(.025,.02,.018),vec3(.25,.17,.11),lip),opacity*edge);
            if(gl_FragColor.a<.01) discard;
            ${output}
          }
        `
      }));
      const mesh = new T.Mesh(crackGeometry, material);
      mesh.name = 'ImpactCracks';
      mesh.rotation.x = -Math.PI/2;
      mount(mesh);
      return { mesh, end: 0 };
    });
    let crackCursor = 0;
    function decal(point, strength) {
      const c = cracks[crackCursor++ % cracks.length];
      c.mesh.position.copy(point);
      c.mesh.position.y += .018;
      c.mesh.scale.setScalar(.62 + .68*strength);
      c.mesh.rotation.z = random()*6.283;
      c.mesh.material.uniforms.seed.value = 37*random();
      c.end = clock.value + 3.25;
    }

    const waveMesh = mount(new T.Mesh(own(new T.CylinderGeometry(1,1,1,52,4,true)),
      own(new T.ShaderMaterial({
        transparent: true, depthWrite: false, side: T.DoubleSide, forceSinglePass: true, blending: T.AdditiveBlending,
        uniforms: { now: clock, progress: {value:0}, hue: {value:new T.Color()}, energy: {value:1} },
        vertexShader: `
          uniform float now,progress,energy;
          varying vec2 v; varying float shear; varying vec3 viewDirection;
          void main() {
            v=uv; vec3 p=position;
            float t=sin(uv.x*75.398+now*16.)*.55+sin(uv.x*31.416-now*12.)*.45;
            shear=t;
            p.xz*=1.+t*uv.y*.028*energy;
            p.y+=.5+.14*t*uv.y;
            viewDirection=normalize(normalMatrix*normal);
            gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
          }
        `,
        fragmentShader: `
          uniform float now,progress,energy; uniform vec3 hue;
          varying vec2 v; varying float shear; varying vec3 viewDirection;
          ${shaderNoise}
          void main() {
            float upper=.58+.32*sin(v.x*31.416+shear);
            float crest=pow(max(0.,1.-v.y/upper),1.8);
            float wisps=grit(vec2(v.x*53.+now*2.,v.y*6.-now*3.));
            float stratum=exp(-abs(v.y-.15-.045*shear)*15.);
            float fade=(1.-pow(progress,1.8))*(.48+.52*abs(viewDirection.z));
            float a=(crest*wisps*.13 + stratum*.16*wisps)*fade*energy;
            gl_FragColor=vec4(hue*(.63+.58*stratum),a);
            ${output}
          }
        `
      }))));
    waveMesh.name = 'ShockFront';

    const transfer = mount(new T.Mesh(own(new T.CylinderGeometry(.025,.09,1,12,7,true)),
      own(new T.ShaderMaterial({
        transparent:true, depthWrite:false, blending:T.AdditiveBlending, side:T.DoubleSide,forceSinglePass:true,
        uniforms:{now:clock},
        vertexShader:`uniform float now;varying vec2 v;void main(){v=uv;vec3 p=position;
          p.x+=sin(v.y*36.-now*9.)*.045*sin(v.y*3.1416);p.z+=cos(v.y*39.-now*10.)*.038*sin(v.y*3.1416);
          gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
        fragmentShader:`uniform float now;varying vec2 v;
          void main(){float a=sin(v.y*3.1416)*(.13+.34*pow(.5+.5*sin(v.y*51.-now*15.+v.x*12.566),4.));
          gl_FragColor=vec4(.52,.94,.86,a);${output}}`
      }))));
    transfer.name = 'SealTransfer';

    const BIN_COUNT = 12, STRANDS = 4;
    const contourVertex = new T.Vector3();
    function edgeValue(point, config) {
      return config.edge === 0 ? point.z : config.edge === 1 ? -point.x : Math.abs(point.x);
    }
    function contourBin(y, limits) {
      return clamp(Math.round((y-limits[0])/(limits[1]-limits[0])*(BIN_COUNT-1)),0,BIN_COUNT-1);
    }
    function readSurface(weapon, config) {
      weapon.updateWorldMatrix(true, true);
      inverse.copy(weapon.matrixWorld).invert();
      const maxima = new Float32Array(BIN_COUNT).fill(-Infinity);
      const extrema = Array.from({length:BIN_COUNT},()=>new T.Vector3());
      const facingEdge = new Float32Array(BIN_COUNT).fill(-Infinity);
      const facingVertices = Array.from({length:BIN_COUNT},()=>new T.Vector3());
      const meshes = [];
      weapon.traverse(mesh => {
        if (!mesh.isMesh || !mesh.geometry.attributes.position || mesh.userData.combatGlow) return;
        const toWeapon = new T.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld);
        let intersects = false;
        const position=mesh.geometry.attributes.position;
        for(let i=0;i<position.count;i++) {
          contourVertex.fromBufferAttribute(position,i).applyMatrix4(toWeapon);
          if(contourVertex.y<config.y[0]||contourVertex.y>config.y[1]) continue;
          intersects = true;
          const k=contourBin(contourVertex.y,config.y);
          const measure=edgeValue(contourVertex,config);
          if (config.edge === 2 && contourVertex.x > facingEdge[k]) {
            facingEdge[k] = contourVertex.x;
            facingVertices[k].copy(contourVertex);
          }
          if (measure>maxima[k]) {
            maxima[k]=measure;
            extrema[k].copy(contourVertex);
          }
        }
        if(intersects) meshes.push({mesh,toWeapon});
      });
      const populated = extrema.filter((_,i)=>Number.isFinite(maxima[i]));
      if (populated.length<3) throw new Error('Combat weapon surface has too few profile samples');
      for(let k=0;k<BIN_COUNT;k++) {
        if(Number.isFinite(maxima[k])) continue;
        const y=config.y[0]+(config.y[1]-config.y[0])*k/(BIN_COUNT-1);
        const closest=populated.reduce((a,b)=>Math.abs(a.y-y)<Math.abs(b.y-y)?a:b);
        maxima[k]=edgeValue(closest,config);
        extrema[k].copy(closest);
      }
      const samples=[];
      // Choose area-weighted points from real triangles near the extracted
      // cutting edge, bevel or crown. Their world positions follow the grip.
      for(const {mesh,toWeapon} of meshes) {
        const geometry=mesh.geometry, p=geometry.attributes.position, index=geometry.index;
        const stride=Math.max(1,Math.floor((index?.count||p.count)/9000));
        const offset=new T.Vector3(), ca=new T.Vector3(), cb=new T.Vector3(), cc=new T.Vector3();
        let seen=0;
        for(let i=0;i+2<(index?.count||p.count);i+=3*stride) {
          ca.fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(toWeapon);
          cb.fromBufferAttribute(p,index?index.getX(i+1):i+1).applyMatrix4(toWeapon);
          cc.fromBufferAttribute(p,index?index.getX(i+2):i+2).applyMatrix4(toWeapon);
          const y=(ca.y+cb.y+cc.y)/3;
          if(y<config.y[0]||y>config.y[1]) continue;
          const u=Math.sqrt(.11+random()*.83),v=.12+random()*.76;
          offset.copy(ca).multiplyScalar(1-u).addScaledVector(cb,u*(1-v)).addScaledVector(cc,u*v);
          const edge=contourBin(offset.y,config.y);
          if(edgeValue(offset,config)<maxima[edge]-config.width*.85) continue;
          const area=tmpB.subVectors(cb,ca).cross(tmpC.subVectors(cc,ca)).length()*.5;
          const scale=weapon.name==='Axe'?.00011:.0017;
          if(area<scale*random()*.36) continue;
          seen++;
          const slot=samples.length<42?samples.length:Math.floor(random()*(42+seen));
          if(slot<42) { if(samples[slot]) samples[slot].copy(offset); else samples.push(offset.clone()); }
        }
      }
      const selection=config.edge===2?[2,5,8,11]:[1,4,7,10];
      const path=selection.map(i=>config.edge===2&&Number.isFinite(facingEdge[i])?facingVertices[i]:extrema[i]);
      return {meshes,maxima,extrema,path,samples:samples.length?samples:populated};
    }

    function glowLayer(source, toWeapon, maxima, config) {
      const sourceMaterial=source.material;
      const engraved=sourceMaterial.emissiveMap;
      const material=own(new T.ShaderMaterial({
        transparent:true, depthWrite:false, side:T.FrontSide,
        blending:T.AdditiveBlending, polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-2,
        uniforms:{
          now:clock, amount:{value:0}, shade:{value:new T.Color(config.tint)},
          toWeapon:{value:toWeapon}, line:{value:maxima}, limits:{value:new T.Vector2(...config.y)},
          width:{value:config.width}, part:{value:config.edge}, engraving:{value:engraved?1:0},
          mask:{value:engraved||sourceMaterial.map||textureFallback}, lift:{value:config.edge===0?.00085:.00069}
        },
        vertexShader:`
          uniform mat4 toWeapon; uniform float lift;
          varying vec3 weaponPoint,norm; varying vec2 mappedUv; varying vec3 lens;
          void main(){
            weaponPoint=(toWeapon*vec4(position,1.)).xyz;
            mappedUv=uv; norm=normalize(normalMatrix*normal);
            vec4 v=modelViewMatrix*vec4(position+normalize(normal)*lift,1.);
            lens=-v.xyz;
            gl_Position=projectionMatrix*v;
          }
        `,
        fragmentShader:`
          uniform float now,amount,width,part,engraving;
          uniform vec2 limits; uniform float line[12]; uniform vec3 shade; uniform sampler2D mask;
          varying vec3 weaponPoint,norm; varying vec2 mappedUv; varying vec3 lens;
          ${shaderNoise}
          void main(){
            float u=(weaponPoint.y-limits.x)/(limits.y-limits.x);
            if(u<0.||u>1.) discard;
            float edge=0.;
            for(int j=0;j<12;j++){edge+=line[j]*max(0.,1.-abs(u*11.-float(j)));}
            float coordinate=part<.5?weaponPoint.z:part<1.5?-weaponPoint.x:abs(weaponPoint.x);
            float dial=1.-smoothstep(width*.24,width,edge-coordinate);
            float ends=smoothstep(0.,.06,u)*(1.-smoothstep(.94,1.,u));
            vec3 detail=texture2D(mask,mappedUv).rgb;
            float engravingLuma=dot(detail,vec3(.27,.6,.13));
            float stamp=engraving*smoothstep(.26,.77,engravingLuma);
            float tang=pow(1.-abs(dot(normalize(lens),normalize(norm))),1.5);
            float flow=.52+.48*grit(vec2(u*18.-now*6.,coordinate*55.+now*.8));
            float a=max(stamp*.69,dial*ends*(.56+.44*tang)) * amount * flow;
            if(a<.012) discard;
            vec3 heat=part<.5?vec3(.58,.79,1.):vec3(1.,.82,.48);
            gl_FragColor=vec4(mix(shade,heat,stamp*.56+tang*.26)*1.53,a*.72);
            ${output}
          }
        `
      }));
      const shell=new T.Mesh(source.geometry,material);
      shell.name='CombatFX_WeaponSurface';
      shell.userData.combatGlow=true;
      shell.visible=false;
      source.add(shell);
      prepared.push(shell);
      return shell;
    }

    function ribbon(config) {
      const geometry=own(new T.BufferGeometry());
      const positions=new Float32Array(LIMITS.samples*STRANDS*3), ages=new Float32Array(LIMITS.samples*STRANDS);
      const uvs=new Float32Array(LIMITS.samples*STRANDS*2), indices=[];
      for(let n=0;n<LIMITS.samples;n++) for(let s=0;s<STRANDS;s++) {
        const i=n*STRANDS+s;
        uvs[i*2]=s/(STRANDS-1); uvs[i*2+1]=n/(LIMITS.samples-1);
        if(n>0&&s>0) indices.push(i-STRANDS-1,i-1,i,i-STRANDS-1,i,i-STRANDS);
      }
      const position=new T.BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage);
      const life=new T.BufferAttribute(ages,1).setUsage(T.DynamicDrawUsage);
      geometry.setAttribute('position',position); geometry.setAttribute('uv',new T.BufferAttribute(uvs,2));
      geometry.setAttribute('strength',life); geometry.setIndex(indices); geometry.setDrawRange(0,0);
      const material=own(new T.ShaderMaterial({
        transparent:true,depthWrite:false,side:T.DoubleSide,forceSinglePass:true,blending:T.AdditiveBlending,
        uniforms:{now:clock,glow:{value:new T.Color(config.tint)}},
        vertexShader:`attribute float strength; varying vec2 v; varying float a;
          void main(){v=uv;a=strength;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader:`
          uniform float now; uniform vec3 glow; varying vec2 v; varying float a;
          ${shaderNoise}
          void main(){
            float taper=smoothstep(.0,.23,v.x)*(1.-smoothstep(.74,1.,v.x));
            float warp=sin(v.y*33.-now*7.)*.12*min(1.,v.y*3.);
            float core=exp(-abs(v.x-.47-warp)*8.);
            float fray=grit(vec2(v.x*18.+v.y*4.,v.y*42.-now*8.));
            vec3 tint=mix(glow*.61,vec3(.93,.97,1.),core*.67);
            gl_FragColor=vec4(tint*(.67+core*.7),a*taper*(.17+core*.24)*(.28+fray*.72));
            ${output}
          }
        `
      }));
      const mesh=mount(new T.Mesh(geometry,material));
      mesh.name='WeaponRibbon';
      mesh.frustumCulled=false;
      const samples=Array.from({length:LIMITS.samples},()=>({time:-1,weight:0,points:Array.from({length:STRANDS},()=>new T.Vector3())}));
      let cursor=0,length=0,lastTime=-1,prevValid=false;
      const previous=new T.Vector3(),localMatrix=new T.Matrix4();
      function sample(weapon, path, intensity, dt) {
        if(clock.value-lastTime<.011) return 0;
        lastTime=clock.value;
        localMatrix.multiplyMatrices(transpose.copy(rootSpace.matrixWorld).invert(),weapon.matrixWorld);
        tmp.copy(path[1]).applyMatrix4(localMatrix);
        const speed=prevValid?tmp.distanceTo(previous)/Math.max(.012,dt):0;
        previous.copy(tmp); prevValid=true;
        if(speed<.58) return speed;
        const next=samples[cursor];
        next.time=clock.value;
        next.weight=clamp((speed-.5)*.15,.16,.92)*intensity;
        for(let i=0;i<STRANDS;i++) {
          const width=clamp(.48+speed*.066,.52,1.0);
          next.points[i].copy(path[1]).lerp(path[i],width).applyMatrix4(localMatrix);
        }
        cursor=(cursor+1)%samples.length;
        length=Math.min(samples.length,length+1);
        return speed;
      }
      function update(active) {
        if(!active) prevValid=false;
        let count=0, fade=0;
        for(let i=0;i<length;i++) {
          const s=samples[(cursor-1-i+samples.length)%samples.length];
          const age=clock.value-s.time;
          if(age>config.length) break;
          fade=(1-age/config.length)*s.weight;
          const leading=i===0&&!active?.65:1;
          for(let j=0;j<STRANDS;j++){
            const p=s.points[j],n=count*STRANDS+j;
            position.setXYZ(n,p.x,p.y,p.z);
            life.setX(n,fade*leading);
          }
          count++;
        }
        mesh.visible=enabled&&count>1;
        if(mesh.visible) {
          position.needsUpdate=true;
          life.needsUpdate=true;
          geometry.setDrawRange(0,(count-1)*(STRANDS-1)*6);
        }
      }
      return {sample,update,clear(){length=0;prevValid=false;mesh.visible=false;}};
    }

    function bindWeapon(weapon,names) {
      if(!weapon) return;
      for(const name of names) {
        if(bindings.has(name)) continue;
        const config = profiles[name];
        if (!config) throw new Error('Unknown combat weapon profile ' + name);
        const surface = readSurface(weapon,config);
        const masks=surface.meshes.map(({mesh,toWeapon})=>glowLayer(mesh,toWeapon,surface.maxima,config));
        bindings.set(name,{weapon,config,surface,masks,ribbon:ribbon(config),level:0,next:0,previous:new T.Vector3(),active:false});
        metrics.samples+=surface.samples.length;
      }
    }
    function weapon(name, intensity, dt) {
      const p=bindings.get(name);
      if(!p) return;
      const amount=enabled?Math.max(preview===name?.82:0,intensity):0;
      p.level+=(amount-p.level)*(1-Math.exp(-dt*(amount>p.level?31:15)));
      p.active=intensity>.13&&enabled;
      for(const mask of p.masks) {
        mask.visible=p.level>.018;
        mask.material.uniforms.amount.value=p.level;
      }
      if(!enabled||amount<.13) return;
      p.weapon.updateWorldMatrix(true,false);
      rootSpace.updateWorldMatrix(true,false);
      const speed=p.active?p.ribbon.sample(p.weapon,p.surface.path,amount,dt):0;
      if((speed>.7||amount>.95||preview===name)&&clock.value>=p.next) {
        p.next=clock.value+(speed<.7?.12:budget()<.75?.065:.034);
        const points=p.surface.samples;
        rootSpace.worldToLocal(tmp.copy(points[Math.floor(random()*points.length)]).applyMatrix4(p.weapon.matrixWorld));
        scratch.set((random()-.5)*.8,.25+random()*.7,(random()-.5)*.8);
        spark.spawn(tmp,scratch,.105+random()*.17,.005+random()*.005,color.setHex(p.config.tint));
      }
    }
    function impact(point, {surface='metal',velocity,normal=up,strength=1,moon=false,fracture=false,floor}={}) {
      if(!enabled) return;
      const spec=SURFACES[surface]||SURFACES.metal, quality=budget();
      metrics.impacts++;
      if(surface in metrics)metrics[surface]++;
      const force=clamp(strength,.4,1.8), mild=surface==='flesh';
      const rgb=color.setHex(moon&&surface!=='parry'?0x90bdff:spec.tint);
      if (surface !== 'flesh' && (surface === 'parry' || force > 1.12)) {
        scratch.copy(normal).multiplyScalar(.24);
        spark.spawn(point,scratch,.079,.043*force,rgb,true);
      }
      const direction=tmpB.copy(velocity||up);
      const length=direction.length();
      if(length>.02) direction.multiplyScalar(1/length);
      for(let n=0;n<Math.round(spec.sparks*quality*force);n++) {
        const a=random()*6.283,s=.64+random()*3.95;
        tmpC.set(Math.cos(a)*s,.24+random()*2.7,Math.sin(a)*s).multiplyScalar(force)
          .addScaledVector(direction,1.55+random()*1.55).addScaledVector(normal,.34);
        spark.spawn(point,tmpC,.095+random()*(mild?.13:.33),(.004+random()*.008)*force,rgb);
      }
      for(let n=0;n<Math.round(spec.dust*quality*force);n++){
        const a=random()*6.283,s=.65+random()*1.58;
        tmpC.set(Math.cos(a)*s,.065+random()*.24,Math.sin(a)*s).addScaledVector(direction,.28);
        tmp.copy(point).y+=.08+random()*.09;
        dust.spawn(tmp,tmpC,.5+random()*.65,(.15+random()*.19)*force,color.setHex(surface==='spirit'?0x47777d:0x68675d));
      }
      if(spec.fragments) stone(point,normal,mild?.017:.044,force,Math.round(spec.fragments*quality),floor);
      if(fracture&&surface==='stone') decal(point,force);
    }
    function shockwave(position,radius,maximum,variant) {
      const visible=enabled&&!!position&&radius>0;
      waveMesh.visible=visible;
      if(!visible) return;
      const uniforms=waveMesh.material.uniforms;
      const earth=variant==='ground';
      waveMesh.position.copy(position);
      waveMesh.scale.set(radius,(earth?.26:.55)+.18*radius,radius);
      uniforms.progress.value=clamp(radius/maximum,0,1);
      uniforms.energy.value=earth?.96:1.18;
      uniforms.hue.value.setHex(earth?0xe6a367:0x68d3d6);
    }
    function beam(from,to) {
      transfer.visible=enabled&&!!from;
      if(!transfer.visible) return;
      scratch.subVectors(to,from);
      transfer.position.copy(from).lerp(to,.5);
      transfer.scale.set(1,scratch.length(),1);
      transfer.quaternion.setFromUnitVectors(up,scratch.normalize());
    }
    function update(dt,frameDt=dt) {
      clock.value+=dt;
      if(frameDt>0) frame(frameDt);
      spark.update();dust.update();updateStone(dt);
      for(const c of cracks){
        c.mesh.visible=enabled&&c.end>clock.value;
        c.mesh.material.uniforms.opacity.value=.78*clamp((c.end-clock.value)*.64,0,1);
      }
      for(const part of bindings.values())part.ribbon.update(part.active);
    }
    function frame(dt) {
      pressure=clamp(pressure+((dt>.025?.95:-.75)*dt),0,1.4);
    }
    function clear() {
      spark.clear();dust.clear();rock.count=0;rock.visible=false;
      for(const d of debris)d.age=d.life;
      for(const c of cracks){c.end=0;c.mesh.visible=false;}
      for(const p of bindings.values()) {
        p.ribbon.clear();p.level=0;p.active=false;
        for(const m of p.masks)m.visible=false;
      }
      waveMesh.visible=transfer.visible=false;
    }

    return {
      prepare:prepared,bindWeapon,weapon,impact,update,frame,shockwave,beam,clear,
      preview(name){preview=profiles[name]?name:'';},
      enable(visible){enabled=visible;if(!enabled)clear();},
      setTier(value){forcedTier=['high','medium','low'].includes(value)?value:'auto';},
      lowest(name,out) {
        const part = bindings.get(name);
        if (!part) return null;
        part.weapon.updateWorldMatrix(true,false);
        out.y = Infinity;
        for (const vertex of part.surface.extrema) {
          tmp.copy(vertex).applyMatrix4(part.weapon.matrixWorld);
          if (tmp.y < out.y) out.copy(tmp);
        }
        return out;
      },
      surface(name) {
        const p=bindings.get(name);
        if(!p) return [];
        return p.surface.path.map(point=>p.weapon.localToWorld(point.clone()).toArray());
      },
      stats(){
        return {enabled,tier:budget(),...metrics,activeSparks:spark.count(),activeDust:dust.count(),rocks:rock.count,
          cracks:cracks.filter(c=>c.mesh.visible).length,wave:waveMesh.visible};
      },
      dispose() {
        clear();
        for(const p of bindings.values())for(const mask of p.masks)mask.removeFromParent();
        for(const object of keep)object.dispose();
        textureFallback.dispose();
        rootSpace.removeFromParent();
      }
    };
  }
  root.SinCombatVFX = { create, LIMITS };
})(globalThis);
