/* T2 dressing built on the existing temple layout. Local X follows T1 to T3. */
(function () {
  'use strict';

  const files = ['assets/اثاث التطهير.glb', 'assets/نقوش وحجر التطهير.JPG',
    'assets/سقف الحرم المقدم.JPG', 'assets/ارضية الحرم المقدس.JPG'];
  const components = {
    7811:'planter', 7758:'sourceBasin', 5443:'lionNorth', 5032:'sourceSteps',
    5000:'lionSouth', 4606:'brazier', 2970:'plinth', 2630:'amphora',
    2228:'columnCarved', 2070:'bowl', 1822:'columnBlue', 1780:'columnSmooth', 1768:'linen', 1500:'jug'
  };
  const expected = ['floor', 'walls', 'roof', 'lightwell', 'pool-stone', 'water', 'lionNorth', 'lionSouth',
    'fountain-stone', 'fountain-palmettes', 'lion-streams', 'water-impact', 'rear-arch', 'door-arch', 'bull-relief', 'alcoves', 'steps',
    'brazier', 'linen', 'smoke'].map(name => 'T2-' + name);
  const deckHeight = .686;
  const poolLevel = .24;
  const fountain = { x:.36, baseY:1.01, height:1.02, mount:7.37, top:2.13, back:7.97, bed:-.59, reach:1.02 };
  const jetLift = .07;

  function pools(room) {
    const { cx, cz, x0, x1, z1 } = room.bbox;
    const inner = 2.63, outer = z1-cz-.76, l = x0-cx+3.83, r = x1-cx-5.35;
    return [-1,1].map(side => ({ l,r,n:side<0?-outer:inner,f:side<0?-inner:outer, level:poolLevel }));
  }

  function stairTreads() {
    return [0,1,2,3].flatMap(i => [-1,1].map(side => ({
      l:4.88+i*.47, r:6.80, n:side<0?-7.58:4.56, f:side<0?-4.56:7.58,
      level:deckHeight*(i+1)/4
    })));
  }

  function localFloor(x,z,treads) {
    let height = x>=6.79 && x<=9.94 && Math.abs(z)>=2.52 && Math.abs(z)<=7.99 ? deckHeight : 0;
    for (const {l,r,n,f,level} of treads) if (x>=l && x<=r && z>=n && z<=f) height = Math.max(height,level);
    return height;
  }

  function jetPoint(t,x,y,z,side,span) {
    return [x, y+jetLift*t-(y-poolLevel+jetLift)*t*t, z-side*span*t];
  }

  function crop(tex, baseW, baseH, [l,t,r,b], repeat=false) {
    const { image } = tex, sx=image.width/baseW, sy=image.height/baseH;
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round((r-l)*sx)); c.height=Math.max(1,Math.round((b-t)*sy));
    c.getContext('2d').drawImage(image,l*sx,t*sy,(r-l)*sx,(b-t)*sy,0,0,c.width,c.height);
    const map=new THREE.CanvasTexture(c);
    map.colorSpace=THREE.SRGBColorSpace; map.anisotropy=4;
    if(repeat) map.wrapS=map.wrapT=THREE.RepeatWrapping;
    return map;
  }

  function removeBakedEffect(part, keep) {
    const g=part.geometry, positions=g.attributes.position, idx=g.index.array, remaining=[];
    g.computeBoundingBox();
    const { min }=g.boundingBox, size=g.boundingBox.getSize(new THREE.Vector3());
    const bounds=new THREE.Box3(), point=new THREE.Vector3();
    for(let i=0;i<idx.length;i+=3) {
      const a=idx[i],b=idx[i+1],c=idx[i+2];
      const y=((positions.getY(a)+positions.getY(b)+positions.getY(c))/3-min.y)/size.y;
      const z=((positions.getZ(a)+positions.getZ(b)+positions.getZ(c))/3-min.z)/size.z;
      if(!keep(y,z)) continue;
      remaining.push(a,b,c);
      for(const j of [a,b,c]) bounds.expandByPoint(point.fromBufferAttribute(positions,j));
    }
    g.setIndex(remaining);
    return { bounds,min,size };
  }

  function fitParts(parts,constrained) {
    for (const key of ['sourceBasin','sourceSteps','columnBlue','columnSmooth','planter']) {
      parts[key].geometry.dispose();
      delete parts[key];
    }
    // Both sculpted spouts are in the source; point their faces along +Z.
    parts.lionSouth.geometry.rotateY(-Math.PI/2);
    const rawMouth = { lionNorth:[.665,.355,.81], lionSouth:[.553,.356,.745] };
    for (const [key,part] of Object.entries(parts)) {
      const g=part.geometry;
      let trim;
      if (key==='lionNorth') trim=removeBakedEffect(part,(y,z)=>y>=.347||z<.685);
      if (key==='lionSouth') trim=removeBakedEffect(part,(y,z)=>y>=.342||z<.545);
      if (key==='brazier') trim=removeBakedEffect(part,y=>y<.682);
      if (!trim) g.computeBoundingBox();
      const bounds=trim?.bounds||g.boundingBox, center=bounds.getCenter(new THREE.Vector3());
      part.size=bounds.getSize(new THREE.Vector3());
      if(rawMouth[key]) {
        part.mouth=rawMouth[key].map((f,axis)=>{
          const k=['x','y','z'][axis];
          return trim.min[k]+trim.size[k]*f-(axis===1?bounds.min.y:center[k]);
        });
      }
      const offset=new THREE.Vector3(-center.x,-bounds.min.y,-center.z);
      g.translate(...offset.toArray());
      g.boundingBox=bounds.clone().translate(offset);
      g.boundingSphere=g.boundingBox.getBoundingSphere(new THREE.Sphere());
    }
    const material=parts.lionNorth.material;
    material.roughness=1;
    material.metalness=.66;
    for(const map of new Set([material.map,material.normalMap,material.roughnessMap,material.metalnessMap])) {
      if(!map) continue;
      if(constrained&&window.SinDevice) SinDevice.capTexture(map,1024);
      map.anisotropy=4;
    }
  }

  function geometry(position,uv,index) {
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(position,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    g.setIndex(index);
    return g;
  }

  function sheet(w,d,u=1,v=1) {
    const g=new THREE.PlaneGeometry(w,d), uv=g.attributes.uv;
    for(let i=0;i<uv.count;i++) uv.setXY(i,uv.getX(i)*u,uv.getY(i)*v);
    return g;
  }

  // A single oscillator drives the pools, ballistic jets and their landing
  // effects. The reflected room is evaluated analytically in the pool shader.
  const effectVertex = `
    varying vec3 local; varying vec3 world; varying vec2 tex;
    void main() {
      local=position; tex=uv;
      vec4 p=modelMatrix*vec4(position,1.); world=p.xyz;
      gl_Position=projectionMatrix*viewMatrix*p;
    }
  `;

  function reflectionPass(root,water,basins,projection,sampler,enabled,constrained) {
    // Only T2's enclosing architecture and visible decoration are mirrored.
    // Both ground-level basins share this one image.
    const layer=30;
    const target=new THREE.WebGLRenderTarget(constrained?248:384,constrained?140:216);
    target.texture.name='T2 shared basin reflection';
    target.texture.generateMipmaps=false;
    const reflected=new THREE.PerspectiveCamera();
    reflected.layers.set(layer);
    const up=new THREE.Vector3(0,1,0), eye=new THREE.Vector3(), centre=new THREE.Vector3();
    const orientation=new THREE.Matrix4(), facing=new THREE.Vector3(), aim=new THREE.Vector3();
    const clip=new THREE.Plane(), coeff=new THREE.Vector4(), q=new THREE.Vector4();
    const clipSpace=new THREE.Matrix4(), frustum=new THREE.Frustum();
    const poolBounds=new THREE.Box3(
      new THREE.Vector3(basins[0].l,basins[0].level,basins[0].n),
      new THREE.Vector3(basins[0].r,basins[0].level,basins[1].f)
    );
    const viewBounds=new THREE.Box3(), prevEye=new THREE.Vector3(), prevFacing=new THREE.Vector3();
    const bias=new THREE.Matrix4().set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1);
    const localAmbient=new THREE.HemisphereLight(0xffe4ba,0x604637,.65);
    localAmbient.layers.set(layer);root.add(localAmbient);
    for(const n of root.children) {
      if(n.isLight&&n!==localAmbient) n.layers.enable(layer);
      if(n.isMesh && /^T2-(walls|upper-royal-lions|lower-glazed-band|rear-arch|bull-relief|lightwell-sky|roof-beams|pilasters|flames|brazier|lionNorth|lionSouth|fountain-stone|fountain-panel|fountain-underside|fountain-palmettes|amphora|fountain-edge|alcoves|steps|platform)$/.test(n.name)) n.layers.enable(layer);
    }
    const delay=constrained?196:129;
    let next=0,lastFrame=0,passes=0,drawCalls=0,cost=0;
    function refresh(renderer,scene,camera,prime=false) {
      const now=performance.now();
      if((!prime&&now<next)||!camera||renderer.getRenderTarget()||renderer.getContext().isContextLost())return;
      camera.updateWorldMatrix(true,false);
      water.updateWorldMatrix(true,false);
      centre.set(0,poolLevel,0).applyMatrix4(water.matrixWorld);
      eye.setFromMatrixPosition(camera.matrixWorld);
      if(eye.y<=centre.y+.05)return;
      orientation.extractRotation(camera.matrixWorld);
      facing.set(0,0,-1).applyMatrix4(orientation).reflect(up);
      if(!prime){
        if(now-lastFrame<670&&eye.distanceToSquared(prevEye)<.0016&&facing.dot(prevFacing)>.9996)return;
        clipSpace.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
        viewBounds.copy(poolBounds).applyMatrix4(water.matrixWorld);
        if(!frustum.setFromProjectionMatrix(clipSpace).intersectsBox(viewBounds))return;
      }
      reflected.position.copy(eye);
      reflected.position.y=2*centre.y-eye.y;
      reflected.up.copy(up).applyMatrix4(orientation).reflect(up);
      reflected.lookAt(aim.copy(reflected.position).add(facing));
      reflected.updateMatrixWorld();
      reflected.projectionMatrix.copy(camera.projectionMatrix);
      clip.setFromNormalAndCoplanarPoint(up,centre).applyMatrix4(reflected.matrixWorldInverse);
      const p=reflected.projectionMatrix.elements;
      coeff.set(clip.normal.x,clip.normal.y,clip.normal.z,clip.constant);
      q.set((Math.sign(coeff.x)+p[8])/p[0],(Math.sign(coeff.y)+p[9])/p[5],-1,(1+p[10])/p[14]);
      const scale=coeff.dot(q);
      if(Math.abs(scale)<.0001)return;
      coeff.multiplyScalar(2/scale);
      p[2]=coeff.x;p[6]=coeff.y;p[10]=coeff.z+1-.0025;p[14]=coeff.w;
      reflected.projectionMatrixInverse.copy(reflected.projectionMatrix).invert();
      projection.value.multiplyMatrices(bias,reflected.projectionMatrix).multiply(reflected.matrixWorldInverse);
      const xr=renderer.xr.enabled,shadows=renderer.shadowMap.autoUpdate;
      try {
        renderer.xr.enabled=false; renderer.shadowMap.autoUpdate=false;
        renderer.setRenderTarget(target);
        renderer.state.buffers.depth.setMask(true);
        renderer.clear();renderer.render(scene,reflected);
        sampler.value=target.texture; enabled.value=1; passes++;drawCalls=renderer.info.render.calls;
      } finally {
        renderer.setRenderTarget(null);
        renderer.xr.enabled=xr;renderer.shadowMap.autoUpdate=shadows;
      }
      const done=performance.now();
      lastFrame=done;prevEye.copy(eye);prevFacing.copy(facing);
      cost+=.2*(Math.min(done-now,40)-cost);
      next=done+Math.max(delay,Math.min(290,cost*7));
    }
    return { refresh,dispose(){target.dispose();},report(){return {passes,drawCalls,delay};} };
  }

  function waterEffects(root,basins,jets,clock) {
    const position=[], uv=[], indices=[];
    for(const {l,r,n,f,level} of basins) {
      const i=position.length/3;
      position.push(l,level,n, l,level,f, r,level,n, r,level,f);
      uv.push(0,0,0,1,1,0,1,1); indices.push(i,i+1,i+2,i+2,i+1,i+3);
    }
    const land = jets.map(j=>new THREE.Vector2(j.end[0],j.end[2]));
    function add(name,g,fragment,uniforms={},order=2,blend=THREE.NormalBlending) {
      const mat=new THREE.ShaderMaterial({
        uniforms:{ clock,...uniforms }, vertexShader:effectVertex,fragmentShader:fragment,
        transparent:true,side:THREE.DoubleSide,depthWrite:false,blending:blend
      });
      const m=new THREE.Mesh(g,mat);m.name='T2-'+name;m.renderOrder=order;root.add(m);
      return m;
    }
    const sampler={value:null}, projection={value:new THREE.Matrix4()}, enabled={value:0};
    const surface=add('water',geometry(position,uv,indices),`
      uniform float clock; uniform vec2 land[2];
      uniform sampler2D mirror; uniform mat4 waterProjection; uniform float reflected;
      varying vec3 local; varying vec3 world; varying vec2 tex;
      float splash(vec2 p,vec2 center) {
        float r=length(p-center);
        return cos(33.*r-5.6*clock)*exp(-3.4*r) *.026;
      }
      vec3 environment(vec3 p,vec3 ray) {
        vec3 maxBox=vec3(9.96,7.68,7.97), minBox=vec3(-9.96,-1.,-7.97);
        vec3 signDir=step(vec3(0.),ray);
        vec3 d=(mix(minBox,maxBox,signDir)-p)/(ray+vec3(1e-5));
        float travel=min(d.x,min(d.y,d.z));
        vec3 hit=p+max(0.,travel)*ray;
        float side=1.-smoothstep(6.8,7.7,abs(hit.z));
        float bands=max(
          (smoothstep(.71,.85,hit.y)*(1.-smoothstep(1.34,1.47,hit.y))),
          smoothstep(3.2,3.6,hit.y)*(1.-smoothstep(5.18,5.56,hit.y)));
        float tile=.49+.51*abs(sin(hit.x*3.08)*sin(hit.y*5.67+hit.z*4.12));
        vec3 stone=mix(vec3(.077,.043,.022),vec3(.24,.17,.10),tile);
        vec3 color=mix(stone,vec3(.016,.037,.10)+tile*vec3(.04,.04,.055),bands);
        float portal=(1.-smoothstep(1.9,2.32,abs(hit.z)))*smoothstep(8.9,9.9,abs(hit.x));
        color=mix(color,vec3(.12,.085,.048),portal*.6);
        float sky=smoothstep(7.35,7.63,hit.y)*(1.-smoothstep(1.15,1.70,abs(hit.z)))*
          smoothstep(-3.65,-3.1,hit.x)*(1.-smoothstep(3.0,3.71,hit.x));
        return color*.72+sky*vec3(.33,.27,.19)*(.8+.2*side);
      }
      float glint(vec3 p,vec3 reflected,vec3 lamp) {
        vec3 d=lamp-p;
        float cone=max(0.,dot(normalize(d),reflected));
        return pow(cone,88.)/(1.+.19*dot(d,d));
      }
      void main() {
        vec2 p=local.xz;float t=clock;
        vec3 V=normalize(cameraPosition-world);
        float w0=sin(p.x*3.66+p.y*2.24-t*1.93);
        float w1=sin(p.x*8.88-p.y*6.9+t*2.13);
        float w2=sin(p.y*12.71+p.x*2.04-t*1.7);
        float k0=splash(p,land[0]),k1=splash(p,land[1]);
        float impact=k0+k1;
        vec3 N=normalize(vec3(.008*w0+.007*w1+impact,1.,.010*w2+.006*w1-impact));
        float f=.17+.83*pow(1.-max(0.,dot(V,N)),4.);
        vec3 ray=reflect(-V,N);
        vec3 reflection=environment(local,ray);
        vec4 uvProjected=waterProjection*vec4(world,1.);
        vec2 uvR=uvProjected.xy/max(.001,uvProjected.w)+vec2(w0*.002+w1*.001,w2*.003+w1*.001+impact*.06);
        float inMirror=smoothstep(0.,.045,uvR.x)*smoothstep(0.,.045,uvR.y)*
          smoothstep(0.,.045,1.-uvR.x)*smoothstep(0.,.045,1.-uvR.y);
        vec3 image=texture2D(mirror,uvR).rgb;
        reflection=mix(reflection,image*vec3(.75,.78,.79),reflected*inMirror*.86);
        float g=glint(local,ray,vec3(3.82,1.22,2.89))+glint(local,ray,vec3(3.82,1.22,-2.89))+
          glint(local,ray,vec3(-4.6,3.12,7.54))+glint(local,ray,vec3(-4.6,3.12,-7.54))+
          glint(local,ray,vec3(7.1,3.12,4.5))+glint(local,ray,vec3(7.1,3.12,-4.5));
        float d=min(min(tex.x,1.-tex.x),min(tex.y,1.-tex.y));
        float caustic=pow(max(0.,w0*w2),3.);
        vec3 base=vec3(.008,.032,.039)+vec3(.004,.017,.018)*caustic+.007*smoothstep(.0,.045,d);
        vec3 rgb=mix(base,reflection,clamp(f+.23,0.,.90))+vec3(.95,.58,.29)*g*2.4;
        gl_FragColor=vec4(rgb,mix(.83,.98,f));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,{land:{value:land},mirror:sampler,waterProjection:projection,reflected:enabled});

    const vertices=[], coords=[], faces=[];
    for(const {side,start,span} of jets) {
      const ringSegments=12, sections=30, base=vertices.length/3;
      for(let i=0;i<=sections;i++){
        const t=i/sections, center=jetPoint(t,...start,side,span);
        // A flattened cross-section oriented perpendicular to the falling
        // stream. The fan contracts under gravity, then widens at impact.
        const slope=jetLift-2*(start[1]-poolLevel+jetLift)*t;
        const length=Math.hypot(span,slope);
        const opening=Math.min(1,t/.13);
        const width=(.077+.036*opening)*(1-.21*t+.22*t*t*t*t);
        const depth=(.014+.022*opening)*(1-.42*t+.31*t*t*t);
        for(let j=0;j<=ringSegments;j++){
          const theta=Math.PI*2*j/ringSegments, offset=Math.sin(theta)*depth;
          vertices.push(center[0]+Math.cos(theta)*width,
            center[1]+offset*span/length,center[2]+offset*side*slope/length);
          coords.push(j/ringSegments,t);
          if(i<sections&&j<ringSegments){
            const v=base+i*(ringSegments+1)+j;
            faces.push(v,v+1,v+ringSegments+1,v+1,v+ringSegments+2,v+ringSegments+1);
          }
        }
      }
    }
    add('lion-streams',geometry(vertices,coords,faces),`
      uniform float clock;
      varying vec3 world; varying vec2 tex;
      void main(){
        float t=tex.y, strand=.5+.5*cos(tex.x*6.283185);
        float twist=.19*sin(t*12.-clock*2.4)+.11*sin(t*27.-clock*6.3);
        float streak=pow(.5+.5*sin(strand*35.+twist),5.);
        float filaments=.5+.5*sin(strand*72.+1.1*sin(t*8.-clock*3.6));
        float flow=.55+.45*sin(t*46.-clock*11.+strand*5.1);
        vec3 N=normalize(cross(dFdx(world),dFdy(world)));
        vec3 V=normalize(cameraPosition-world);
        float fresnel=pow(1.-clamp(abs(dot(N,V)),0.,1.),2.1);
        float shine=streak*(.49+.51*flow)+filaments*.15*flow;
        vec3 c=mix(vec3(.17,.29,.29),vec3(.88,.94,.91),clamp(.13+shine*.82+fresnel*.43,0.,1.));
        float alpha=(.21+shine*.36+fresnel*.28+.15*smoothstep(.91,1.,t))*smoothstep(.0,.047,t);
        gl_FragColor=vec4(c,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,{},4);

    const impacts=jets.map(j=>[j.end[0],j.end[1]+.004,j.end[2],.57,.49]);
    const pp=[], uu=[], ii=[];
    for(const [x,y,z,w,h] of impacts){
      const n=pp.length/3;
      pp.push(x-w,y,z-h,x-w,y,z+h,x+w,y,z-h,x+w,y,z+h);
      uu.push(0,0,0,1,1,0,1,1);ii.push(n,n+1,n+2,n+2,n+1,n+3);
    }
    add('water-impact',geometry(pp,uu,ii),`
      uniform float clock; varying vec3 local; varying vec2 tex;
      void main(){
        vec2 centered=(tex-.5)*2.;
        float radius=length(centered);
        float phase=clock+.46*sin(local.z);
        float grains=sin(centered.x*103.+3.*sin(centered.y*42.+phase*9.))
          *sin(centered.y*117.+4.*cos(centered.x*43.-phase*8.));
        float broken=smoothstep(.03,.72,grains);
        float waves=pow(max(0.,cos(30.*radius-7.6*phase)),12.);
        float core=(.46+.54*broken)*(1.-smoothstep(.12,.52,radius+.035*sin(tex.y*58.)));
        float wake=(1.-smoothstep(.25,1.,radius))*waves*(.19+.36*broken);
        gl_FragColor=vec4(.80,.88,.84,min(.90,core*.70+wake));
        #include <colorspace_fragment>
      }
    `,{},5,THREE.AdditiveBlending);

    const specks=[], drops=[];
    impacts.forEach(([x,y,z,w,h],i)=>{
      const count=37;
      for(let j=0;j<count;j++){
        const seed=(i*173+j*43)%97/97, a=j*2.39996;
        specks.push(x,y,z);drops.push(seed,Math.cos(a)*w,Math.sin(a)*h);
      }
    });
    const spray=new THREE.BufferGeometry();
    spray.setAttribute('position',new THREE.Float32BufferAttribute(specks,3));
    spray.setAttribute('drop',new THREE.Float32BufferAttribute(drops,3));
    const mist=new THREE.Points(spray,new THREE.ShaderMaterial({
      uniforms:{clock},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      vertexShader:`
        uniform float clock; attribute vec3 drop; varying float life;
        void main(){
          life=fract(clock*(1.18+.31*drop.x)+drop.x);
          vec3 p=position+vec3(drop.y*life*.71,(1.-life)*life*(.76+drop.x*.72),drop.z*life*.71);
          gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
          gl_PointSize=clamp(19./max(1.,gl_Position.w),1.,3.1);
        }
      `,
      fragmentShader:`varying float life;void main(){
        float a=(1.-smoothstep(.12,.50,length(gl_PointCoord-.5)))*(.45-.35*life);
        gl_FragColor=vec4(.77,.87,.86,a);
      }`
    }));
    mist.name='T2-water-spray'; mist.renderOrder=6;root.add(mist);
    return {surface,projection,sampler,enabled};
  }

  function atmosphere(root, flames, smoke, clock, constrained) {
    function cards(sources) {
      const p=[],uv=[],ii=[];
      for(const [x,y,z,w,h] of sources) for(const a of [.23,1.8]){
        const b=p.length/3,dx=w*Math.cos(a)/2,dz=w*Math.sin(a)/2;
        p.push(x-dx,y,z-dz,x+dx,y,z+dz,x-dx,y+h,z-dz,x+dx,y+h,z+dz);
        uv.push(0,0,1,0,0,1,1,1);ii.push(b,b+1,b+2,b+1,b+3,b+2);
      }
      return geometry(p,uv,ii);
    }
    function add(name,g,shader,order,additive) {
      const material=new THREE.ShaderMaterial({
        uniforms:{clock},vertexShader:effectVertex,fragmentShader:shader,
        side:THREE.DoubleSide,transparent:true,depthWrite:false,
        blending:additive?THREE.AdditiveBlending:THREE.NormalBlending
      });
      const m=new THREE.Mesh(g,material);m.name='T2-'+name;m.renderOrder=order;root.add(m);
      return m;
    }
    add('flames',cards(flames),`
      uniform float clock; varying vec3 local; varying vec2 tex;
      void main(){
        float y=tex.y,t=clock+local.x*.82+local.z*.38;
        float x=abs(tex.x-.5+.10*sin(t*5.+y*10.)*y);
        float w=.30*pow(1.-y,.83);
        float a=(1.-smoothstep(w*.15,w+.052,x))*smoothstep(0.,.05,y)*(1.-smoothstep(.44,.99,y));
        float c=(1.-smoothstep(w*.17,w*.74,x))*(1.-smoothstep(.23,.80,y));
        gl_FragColor=vec4(mix(vec3(.95,.20,.016),vec3(1.,.84,.42),c),a*.80);
        #include <colorspace_fragment>
      }
    `,6,true);
    add('smoke',cards(smoke),`
      uniform float clock; varying vec3 local; varying vec2 tex;
      float hash(vec2 p){return fract(sin(dot(p,vec2(125.7,72.3)))*43758.5453);}
      float noise(vec2 p){
        vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);
      }
      void main(){
        float y=tex.y,t=clock*.48+local.z*.41;
        float bend=(.085*sin(y*14.-t)+.054*sin(y*32.-t*1.3))*smoothstep(.05,.76,y);
        vec2 p=vec2((tex.x-bend)*8.8,y*10.-t);
        float vapor=.71*noise(p)+.29*noise(p*2.3+2.);
        float r=mix(.046,.41,y);
        float a=(1.-smoothstep(r*.20,r,abs(tex.x-.5-bend)))*smoothstep(.29,.75,vapor)*
          smoothstep(0.,.06,y)*(1.-smoothstep(.42,1.,y));
        gl_FragColor=vec4(.73,.68,.60,a*.48);
        #include <colorspace_fragment>
      }
    `,7,false);

    const p=[],uv=[],ix=[];
    for(const z of constrained?[-.95,0,.95]:[-1.28,-.62,0,.62,1.28]){
      const i=p.length/3;
      p.push(-.96,7.82,z-.21,-.67,7.82,z+.21,3.01,1.05,z*1.82-.81,4.04,1.05,z*1.82+.81);
      uv.push(0,1,1,1,0,0,1,0);ix.push(i,i+1,i+2,i+1,i+3,i+2);
    }
    add('sunbeams',geometry(p,uv,ix),`
      varying vec2 tex;
      void main(){
        float edge=pow(max(0.,sin(tex.x*3.141593)),1.7);
        gl_FragColor=vec4(.87,.68,.41,edge*.15*smoothstep(.05,.82,tex.y));
      }
    `,3,true).userData.ceiling=true;
  }

  function rearArch(radius,spring,width) {
    const p=[],uv=[],tri=[];
    for(let i=0;i<=44;i++){
      const a=i*Math.PI/44;
      for (const r of [radius-width,radius]){
        const x=r*Math.cos(a),y=r*Math.sin(a);
        p.push(x,spring+y,0);uv.push(.5+.486*x/radius,.026+.95*y/radius);
      }
      if(i<44){const n=i*2;tri.push(n,n+1,n+2,n+1,n+3,n+2);}
    }
    const mesh=geometry(p,uv,tri);mesh.computeVertexNormals();
    return mesh;
  }

  function opening(half,sill,spring) {
    const path=new THREE.Shape();
    path.moveTo(-half,sill);path.lineTo(-half,spring);
    path.absarc(0,spring,half,Math.PI,0,true);
    path.lineTo(half,sill);path.closePath();
    return path;
  }

  function archMasonry(radius,spring,width) {
    const shape=new THREE.Shape();
    shape.absarc(0,spring,radius,0,Math.PI);
    shape.absarc(0,spring,radius-width,Math.PI,0,true);
    shape.closePath();
    const g=new THREE.ExtrudeGeometry(shape,{depth:.30,bevelEnabled:false,curveSegments:24});
    const p=g.attributes.position, uv=g.attributes.uv;
    for(let i=0;i<uv.count;i++) uv.setXY(i,p.getX(i)/2.6+p.getZ(i)*.54,p.getY(i)/2.6);
    return g;
  }

  function surround(w,h,leftBottom,hole) {
    const shape=new THREE.Shape();
    shape.moveTo(-w,leftBottom);shape.lineTo(w,leftBottom);shape.lineTo(w,h);shape.lineTo(-w,h);shape.closePath();
    shape.holes.push(hole);
    const geo=new THREE.ExtrudeGeometry(shape,{ depth:.39,bevelEnabled:false,curveSegments:18 });
    const pos=geo.attributes.position, uv=geo.attributes.uv, normals=geo.attributes.normal;
    for(let i=0;i<uv.count;i++){
      const face=Math.abs(normals.getX(i));
      uv.setXY(i,(face>.5?pos.getZ(i):pos.getX(i))/2.4,pos.getY(i)/2.4);
    }
    return geo;
  }

  function assemble(room,doors,kit,maps,constrained,root) {
    const {bbox:{cx,cz,x0,x1,z0,z1},height:h}=room, hx=(x1-x0)/2, hz=(z1-z0)/2;
    const [atlas,roof,floor]=maps;
    const texture=(rect,repeat)=>crop(atlas,707,530,rect,repeat);
    const material=(map,color,roughness,bump=0)=>new THREE.MeshStandardMaterial({
      map,color,roughness,metalness:.025,bumpMap:!constrained&&bump?map:null,bumpScale:bump
    });
    const stone=material(texture([371,264,523,426],true),0xe3ceb7,.80,.025);
    const dark=material(stone.map,0x867267,.89);
    const damp=material(texture([540,263,695,426],true),0xbdab97,.43,.020);
    const walkway=material(crop(floor,400,400,[76,2,324,398],true),0xd6b99e,.55,.021);
    const floorTrim=material(crop(floor,400,400,[20,4,59,395],true),0xd2bc9e,.56);
    const glaze=material(texture([11,423,286,451],true),0xcbc7bd,.65);
    const palm=material(texture([10,479,287,516],true),0xdec4a2,.58);
    const palmette=material(texture([15,253,79,317]),0xe4d0b1,.53);
    const gilt=material(texture([10,462,286,467],true),0xe2bc7c,.61);
    const lions=material(texture([11,10,340,97]),0xe0cbb5,.72,.022);
    const glyphs=material(texture([366,17,692,79],true),0xd9c0a3,.79,.025);
    const bull=material(texture([16,111,302,239]),0xe1cbb4,.65,.020);
    const ring=material(texture([313,104,561,234]),0xe0c89f,.68);
    ring.side=THREE.DoubleSide;
    const roofTrim=material(crop(roof,700,394,[213,26,490,52],true),0xae987a,.76);
    const sky=new THREE.MeshBasicMaterial({color:0xffdfae,toneMapped:false});
    const leaf=new THREE.MeshStandardMaterial({color:0x555d1e,roughness:.63});
    const petal=new THREE.MeshStandardMaterial({color:0xf3ddad,roughness:.74});

    const draw=SinGreatLibrary.builder(root,'T2-');
    const box=(name,mat,x,y,z,w,dy,d,tile)=>draw.box(name,mat,null,x,y,z,w,dy,d,tile);
    const surface=(name,mat,g,x,y,z,angle=0)=>draw.surface(name,mat,g,null,x,y,z,angle);
    function horizontal(name,mat,x,y,z,w,d,u=1,v=1,up=true) {
      surface(name,mat,sheet(w,d,u,v).rotateX(up?-Math.PI/2:Math.PI/2),x,y,z);
    }
    function wall(name,mat,x,y,z,w,d,angle,u=1,v=1) {
      surface(name,mat,sheet(w,d,u,v),x,y,z,angle);
    }
    const collision=[], steps=stairTreads(), channels=pools(room), flames=[], smoke=[], jets=[];
    const clock={value:0};
    function block(l,r,n,f,miny,maxy) {
      collision.push({minx:cx+l,maxx:cx+r,minz:cz+n,maxz:cz+f,miny,maxy,_wing:true,_purification:true});
    }
    function prop(key,x,y,z,height,yaw=0) {
      const obj=kit[key],scale=height/obj.size.y;
      const matrix=draw.asset(key,obj,null,x,y,z,obj.size.x*scale,height,obj.size.z*scale,yaw);
      return matrix;
    }
    function torch(x,y,z,h,smokes=false) {
      prop('brazier',x,y,z,h);
      flames.push([x,y+h-.031,z,h*1.02,h*1.32]);
      if(smokes) smoke.push([x,y+h+.10,z,.93,1.65]);
    }

    // The common floor has matching cutouts. All exposed T2 stone is on
    // the same walk plane, and the side pools carry solid dressed walls.
    const {l,r}=channels[0], inner=channels[1].n, outer=channels[1].f;
    const tiles=[[-hx,l,-hz,hz],[r,hx,-hz,hz],[l,r,-inner,inner],[l,r,-hz,-outer],[l,r,outer,hz]];
    for(const [a,b,n,f] of tiles) {
      const g=sheet(b-a,f-n).rotateX(-Math.PI/2), p=g.attributes.position, uv=g.attributes.uv;
      for(let i=0;i<uv.count;i++) uv.setXY(i,(p.getZ(i)+(n+f)/2)/3.78,(p.getX(i)+(a+b)/2)/5.95);
      surface('floor',walkway,g,(a+b)/2,.010,(n+f)/2);
    }
    for(const side of [-1,1]){
      const z=side*2.08;
      surface('floor-border',floorTrim,sheet(.30,2*hx,1,2*hx/4.6).rotateX(-Math.PI/2).rotateY(Math.PI/2),0,.013,z);
      horizontal('wet-floor',damp,0,.014,side*2.399,hx*2-.34,.29,hx*2/4.1,.11);
    }
    for(const basin of channels) {
      const {l,r,n,f}=basin, x=(l+r)/2,z=(n+f)/2;
      box('pool-stone',dark,x,-.66,z,r-l+.16,.16,f-n+.16,2.75);
      for(const xEdge of [l-.08,r+.08]) {
        box('pool-stone',damp,xEdge,-.10,z,.17,.92,f-n+.26,2.75);
        box('pool-coping',stone,xEdge,.415,z,.33,.14,f-n+.33,1.46);
      }
      for(const zEdge of [n-.075,f+.075]) {
        box('pool-stone',damp,x,-.10,zEdge,r-l+.17,.91,.17,2.75);
        box('pool-coping',stone,x,.415,zEdge,r-l+.20,.14,.31,1.59);
      }
      const sign=z<0?-1:1, frontZ=sign*(inner-.168);
      wall('pool-inlay',palm,x,.199,frontZ,r-l,.34,sign<0?0:Math.PI,(r-l)/3.8);
      wall('pool-inlay',palm,l-.168,.20,z,f-n,.35,-Math.PI/2,(f-n)/3.8);
      block(l-.23,r+.23,n-.22,f+.22,-.76,.485);
    }

    for(const sign of [-1,1]){
      const z=sign*(hz-.016), angle=sign<0?0:Math.PI;
      wall('walls',stone,0,h/2,z,2*hx,h,angle,2*hx/2.95,h/3.55);
      wall('stone-glyph-band',glyphs,-.40,2.985,z-sign*.026,18.68,.64,angle,3);
      wall('lower-glazed-band',palm,0,.91,z-sign*.023,2*hx,1.12,angle,4.7);
      wall('upper-royal-lions',lions,-4.42,4.26,z-sign*.030,9.66,2.62,angle);
      wall('upper-royal-lions',lions,5.09,4.26,z-sign*.030,9.29,2.55,angle);
      wall('upper-glyph-band',glyphs,-.29,5.87,z-sign*.024,18.91,.58,angle,3);
      box('wall-ledge',stone,0,1.464,z-sign*.218,2*hx,.133,.30,2.71);
      for(const x of [-8.65,2.03,8.88]){
        box('pilasters',stone,x,3.65,z-sign*.269,.66,7.30,.66,2.40);
        box('pilasters',stone,x,.27,z-sign*.31,.90,.54,.80,2.40);
        box('pilasters',stone,x,7.27,z-sign*.30,1.02,.34,.84,2.40);
        box('pier-glaze',palm,x,1.03,z-sign*.649,.73,.66,.084,.73);
      }
      for(const x of [-4.64,4.93]){
        box('wall-brackets',palm,x,2.23,z-sign*.40,.30,.93,.25,.47);
        box('wall-brackets',stone,x,2.70,z-sign*.52,.46,.15,.63,.8);
        torch(x,2.77,z-sign*.62,.47);
      }
      buildFountain(sign);
      prop('plinth',3.87,0,sign*3.04,.62);
      torch(3.87,.62,sign*3.04,.47,true);
      prop('bowl',3.87,.49,sign*4.15,.24);
      prop('linen',3.52,1.474,sign*7.52,.30,sign<0?0:Math.PI);
      for(const [x,z] of [[-5.42,5.48],[-4.04,6.42]]){
        for(let i=0;i<5;i++){
          const g=new THREE.CircleGeometry(.14+(.024*i),9).rotateX(-Math.PI/2);
          g.scale(1.4,1,.76);g.rotateY(i*.99);
          surface('lily-leaves',leaf,g,x+.26*Math.cos(i*1.26),.251,sign*z+.18*Math.sin(i*1.26));
        }
        for(let i=0;i<5;i++){
          const a=i*1.257,g=new THREE.SphereGeometry(.095,6,3).scale(.46,.26,1).rotateY(a);
          surface('lily-petals',petal,g,x+.071*Math.sin(a),.275,sign*z+.071*Math.cos(a));
        }
      }
    }

    function buildFountain(side) {
      const {x,baseY,height,mount,top,back,bed,reach}=fountain;
      const key=side<0?'lionNorth':'lionSouth', head=kit[key];
      const scale=height/head.size.y, depth=head.size.z*scale, width=head.size.x*scale;
      const facing=side<0?0:Math.PI;
      // Seat the geometry by its measured rear face. The square blue
      // panel and sandstone block remain wholly behind the carved head.
      const headCenter=side*(mount-depth/2);
      const matrix=prop(key,x,baseY,headCenter,height,facing);
      const nozzle=new THREE.Vector3(...head.mouth).applyMatrix4(matrix);
      const start=nozzle.toArray();
      // Begin just inside the mouth so there is no exposed end to the stream.
      start[1]+=.021;
      start[2]+=side*.038;
      const panelWidth=width+.20;
      const blockWidth=panelWidth+.45, stoneFace=mount+.034;
      box('fountain-stone',stone,x,(top+bed)/2,side*(stoneFace+back)/2,blockWidth,top-bed,back-stoneFace,1.42);
      box('fountain-panel',glaze,x,baseY+height*.49,side*(mount+.017),panelWidth,height*1.11,.034,1.38);

      // The lower shelf meets the foot of the sculpture and stops just
      // behind the mouth. Flow cannot enter stone anywhere along the arc.
      const front=Math.abs(nozzle.z)+.055;
      const shelfDepth=back-front, exposed=baseY-poolLevel;
      const cap=.092, bodyTop=baseY-cap;
      box('fountain-underside',glaze,x,(bodyTop+bed)/2,side*(front+back)/2,blockWidth-.11,bodyTop-bed,shelfDepth,1.4);
      box('fountain-edge',stone,x,baseY-cap/2,side*(front+back)/2,blockWidth-.085,cap,shelfDepth,1.12);
      const panelHeight=exposed-.108, panelY=poolLevel+panelHeight/2;
      const panelSize=(blockWidth-.19)/2;
      for(const edge of [-1,1]){
        wall('fountain-palmettes',palmette,x+edge*(panelSize/2+.007),panelY,
          side*(front-.003),panelSize-.025,panelHeight,facing);
        wall('fountain-palmettes',palmette,x+edge*(blockWidth-.106)/2,panelY,
          side*(front+shelfDepth*.5),shelfDepth-.07,panelHeight,edge*Math.PI/2);
        box('fountain-edge',gilt,x+edge*(blockWidth-.122)/2,panelY,side*(front-.009),.017,panelHeight,.023,.7);
        box('fountain-edge',gilt,x+edge*(panelWidth-.019)/2,baseY+height*.49,
          side*(mount-.004),.019,height*1.08,.018,.78);
      }
      box('fountain-edge',gilt,x,baseY-.104,side*(front-.005),blockWidth-.122,.024,.023,1.0);
      box('fountain-edge',gilt,x,baseY+height*1.037,side*(mount-.004),panelWidth,.022,.017,1.0);
      prop('amphora',x,top,side*(stoneFace+back)/2,.63,facing);
      block(x-blockWidth/2,x+blockWidth/2,Math.min(side*stoneFace,side*back),
        Math.max(side*stoneFace,side*back),bed,top);
      jets.push({side,start,span:reach,end:jetPoint(1,...start,side,reach)});
    }

    // Retain the baked portals. The east opening gets a shallow arch liner
    // and the bull relief remains above the full-height opening.
    for(const d of doors){
      const side=d.x<cx?-1:1, x=side*(hx-.013), a=side<0?Math.PI/2:-Math.PI/2;
      const half=d.width/2+.022, sideW=hz-half;
      for(const z of [-1,1]) wall('walls',stone,x,h/2,z*(half+sideW/2),sideW,h,a,sideW/2.7,h/2.7);
      wall('walls',stone,x,(d.height+h)/2,0,2*half,h-d.height,a,2,(h-d.height)/2.35);
    }

    for(const {l,r,n,f,level} of steps) {
      box('steps',stone,(l+r)/2,level/2,(n+f)/2,r-l,level,f-n,1.81);
    }
    for(const sign of [-1,1]){
      box('platform',stone,8.37,deckHeight/2,sign*5.25,3.15,deckHeight,5.46,2.40);
      wall('platform-fascia',palm,6.794,.525,sign*5.25,5.43,.30,-Math.PI/2,1.63);
      prop('columnCarved',7.53,deckHeight,sign*4.66,1.79);
      block(7.26,7.80,sign*4.66-.27,sign*4.66+.27,deckHeight,2.70);
      prop('bowl',7.53,deckHeight+1.79,sign*4.66,.32);
      prop('plinth',7.48,deckHeight,sign*7.08,.67);
      torch(7.48,deckHeight+.67,sign*7.08,.49);
    }

    const exit=doors.find(d=>d.x>cx);
    const half=exit.width/2, spring=exit.height-half, archX=9.70, heading=-Math.PI/2;
    surface('door-arch',ring,rearArch(half+.23,spring,.23),archX,0,0,heading);
    box('door-transom',stone,archX-.15,exit.height+.056,0,.32,.112,exit.width+.09,1.45);
    for(const hand of [-1,1]){
      wall('door-jambs',palm,archX,spring*.5,hand*(half+.115),.23,spring,heading,1,2.1);
      const corner=new THREE.Shape();
      corner.moveTo(0,exit.height);
      for(let i=0;i<=22;i++){
        const t=Math.PI*.5*i/22;
        corner.lineTo(hand*half*Math.sin(t),spring+half*Math.cos(t));
      }
      corner.lineTo(hand*half,exit.height);
      corner.closePath();
      surface('door-spandrels',stone,new THREE.ExtrudeGeometry(corner,{
        depth:.31,bevelEnabled:false,curveSegments:1
      }),archX+.322,0,0,heading);
    }
    wall('bull-relief',bull,9.48,6.26,0,3.15,1.41,heading);
    rearDesign();

    function rearDesign(){
      const wallX=9.31, angle=-Math.PI/2, spring=3.08;
      surface('rear-arch-masonry',stone,archMasonry(4.82,spring,.69),wallX+.324,0,0,angle);
      const backing=new THREE.Shape(), inner=4.25, sill=5.47;
      const start=Math.asin((sill-spring)/inner);
      backing.absarc(0,spring,inner,start,Math.PI-start);
      backing.closePath();
      const inset=new THREE.ShapeGeometry(backing,24), p=inset.attributes.position, tc=inset.attributes.uv;
      for(let i=0;i<tc.count;i++) tc.setXY(i,p.getX(i)/2.9,p.getY(i)/2.9);
      surface('rear-arch-inset',dark,inset,9.55,0,0,angle);
      let band=rearArch(4.68,spring,.472);
      surface('rear-arch',ring,band,wallX,0,0,angle);
      // Three-dimensional sandstone voussoirs back the glazed arch ring.
      band=rearArch(4.82,spring,.14);
      const uv=band.attributes.uv;
      for(let i=0;i<uv.count;i++) uv.setXY(i,uv.getX(i)*4.8,uv.getY(i)*2.5);
      surface('rear-arch',stone,band,wallX+.021,0,0,angle);
      for(const sign of [-1,1]){
        box('rear-arch-posts',stone,wallX+.043,2.04,sign*4.44,.53,2.72,.52,1.85);
        box('rear-arch-posts',palm,wallX-.235,2.09,sign*4.44,.11,1.55,.41,1.2);
        const z=sign*6.35, sill=deckHeight+.42, archSpring=4.23;
        block(9.22,9.97,z-1.62,z+1.62,deckHeight,5.73);
        const half=1.13;
        const niche=surround(1.62,5.72,deckHeight,opening(half,sill,archSpring));
        surface('alcoves',stone,niche,9.17,0,z,angle);
        const back=new THREE.ShapeGeometry(opening(half,sill,archSpring),18);
        surface('alcove-back',dark,back,9.92,0,z,angle);
        band=rearArch(1.31,archSpring,.194);
        surface('alcove-crown',ring,band,9.15,0,z,angle);
        for(const shoulder of [-1,1]){
          box('alcove-jambs',palm,9.151,(sill+archSpring)/2,z+shoulder*1.23,.13,archSpring-sill,.168,1.10);
        }
        for(const {level,content} of [
          {level:1.22,content:['linen','linen']},{level:2.13,content:['bowl','amphora']},
          {level:3.01,content:['amphora','jug']}
        ]){
          box('alcove-shelves',damp,9.48,level,z,.80,.127,2.27,1.29);
          for(let i=0;i<content.length;i++) {
            const key=content[i];
            prop(key,9.43,level+.066,z+(i-.5)*.85,key==='linen'?.24:key==='bowl'?.22:.51,-Math.PI/2);
          }
        }
      }
    }

    // Roof panels end at a true rectangular aperture. A stone light well and
    // luminous sky-facing cap keep the view sealed above this palace wing.
    const roofY=h-.162, roofBox=[-3.62,3.65,-1.60,1.60];
    const [rl,rr,rn,rf]=roofBox;
    for(const [a,b,n,f] of [[-hx,rl,-hz,hz],[rr,hx,-hz,hz],[rl,rr,-hz,rn],[rl,rr,rf,hz]]){
      horizontal('roof',stone,(a+b)/2,roofY,(n+f)/2,b-a,f-n,(b-a)/2.6,(f-n)/2.8,false);
    }
    for(const z of [-6.88,-3.18,3.18,6.88]){
      box('roof-beams',stone,0,roofY-.32,z,2*hx,.63,.68,2.62);
      box('roof-beam-inlay',roofTrim,0,roofY-.52,z,2*hx,.15,.72,5.4);
    }
    for(const x of [-8.73,rl-.22,rr+.22,8.75]){
      box('roof-beams',stone,x,roofY-.30,0,.65,.59,2*hz,2.6);
    }
    for(const z of [rn-.13,rf+.13]){
      box('lightwell',stone,(rl+rr)/2,roofY+.63,z,rr-rl+.31,1.26,.30,2.58);
    }
    for(const x of [rl-.13,rr+.13]){
      box('lightwell',stone,x,roofY+.63,0,.29,1.26,rf-rn+.32,2.58);
    }
    horizontal('lightwell-sky',sky,(rl+rr)/2,roofY+1.14,0,rr-rl+.29,rf-rn+.29,1,1,false);
    for(const x of [-2.38,-1.19,0,1.19,2.38]){
      box('lightwell-bars',stone,x,roofY+.92,0,.15,.22,rf-rn+.1,1.5);
    }
    // Small vines trail from the reference skylight without a foliage pass.
    for(const sign of [-1,1]) for(const x of [-2.98,-2.17,-1.72,-.83,.54,1.31,2.55,3.10]){
      for(let k=0;k<7;k++){
        const a=k*1.91+x, g=new THREE.CircleGeometry(.092+.034*Math.sin(a),6);
        g.scale(.67,1.6,1).rotateY(a);
        surface('roof-vines',leaf,g,x+Math.sin(a)*.114,roofY+.34-k*.158,sign*(1.63+Math.cos(a)*.12));
      }
    }

    draw.flush();
    for(const node of root.children){
      node.castShadow=false;
      if(/^T2-(roof|lightwell)/.test(node.name)) node.userData.ceiling=true;
    }
    leaf.side=THREE.DoubleSide;
    const water=waterEffects(root,channels,jets,clock);
    atmosphere(root,flames,smoke,clock,constrained);

    const glow=[];
    function light(color,power,radius,x,y,z,animated=false) {
      const l=new THREE.PointLight(color,power,radius,2);
      l.userData.physicalFalloff=true;l.position.set(x,y,z); root.add(l);
      if(animated) glow.push([l,power]);
    }
    light(0xffe2b8,28,15,-.45,6.62,0);
    light(0xffd4a2,19,10,6.78,5.48,0);
    for(const side of [-1,1]){
      light(0xffaa62,11.5,5.8,-4.55,3.17,side*7.05,true);
      light(0xffad6b,11.0,6.1,6.32,3.12,side*6.12,true);
    }
    const reflection=reflectionPass(root,water.surface,channels,water.projection,water.sampler,water.enabled,constrained);
    SinGreatLibrary.setLibraryExposure(root,.33);
    const camera=new THREE.PerspectiveCamera(54,16/9,.11,100);
    camera.name='T2-presentation'; camera.position.set(-hx+.40,1.74,0);camera.lookAt(6.8,3.00,0);root.add(camera);
    const warmup=SinGreatLibrary.geometryWarmup(root);
    const stairBoxes=steps.map(({l,r,n,f,level})=>({minx:cx+l,maxx:cx+r,minz:cz+n,maxz:cz+f,miny:0,maxy:level,_wing:true}));
    for(const sign of [-1,1]){
      stairBoxes.push({minx:cx+6.794,maxx:cx+9.945,minz:cz+sign*5.25-2.72,maxz:cz+sign*5.25+2.72,
        miny:0,maxy:deckHeight,_wing:true});
    }
    return {
      root,camera,jets,collision,stairBoxes,warmup,refreshWater:reflection.refresh,
      reflectionReport:reflection.report,disposeReflection:reflection.dispose,
      floorAt(x,z){ return localFloor(x-cx,z-cz,steps); },
      tick(t){
        clock.value=t;
        for(let i=0;i<glow.length;i++)glow[i][0].intensity=glow[i][1]*(.98+.02*Math.sin(t*3.9+i*2.17));
      },
      dispose(){ reflection.dispose();warmup.dispose();SinGreatLibrary.disposeResources(root); }
    };
  }

  async function build(room,doors,load,signal,constrained) {
    const root=new THREE.Group();
    root.name='T2-Purification-Hall';root.position.set(room.bbox.cx,0,room.bbox.cz);
    let source,parts;
    const maps=[];
    try{
      source=await load(files[0],signal);
      signal.throwIfAborted();
      parts=SinGreatLibrary.split(source,components);
      source=null;
      fitParts(parts,constrained);
      const loader=new THREE.TextureLoader();
      for(const path of files.slice(1)){
        signal.throwIfAborted();
        maps.push(await loader.loadAsync(encodeURI(path)));
      }
      signal.throwIfAborted();
      return assemble(room,doors,parts,maps,constrained,root);
    }catch(error){
      if(parts) Object.values(parts).forEach(part=>root.add(new THREE.Mesh(part.geometry,part.material)));
      else if(source) root.add(source.scene);
      SinGreatLibrary.disposeResources(root);
      throw error;
    }finally{maps.forEach(t=>t.dispose());}
  }
  window.SinPurificationHall = { build,expected,pools,stairTreads,localFloor,jetPoint,fountain };
})();
