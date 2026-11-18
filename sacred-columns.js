/* Sacred Columns Hall. Transforms are relative to the baked room centre. */
(function () {
  'use strict';
  const model = 'assets/اثاث قاعة الاعمدة.glb';
  const images = ['assets/نقوش قاعة الاعمدة.JPG', 'assets/ارضية قاعة الاعمدة.JPG', 'assets/سقف قاعة الاعمدة.JPG'];
  const partsByTriangles = {
    13249:'gate', 7282:'stepped-gate', 4259:'lamassu-pier', 3880:'column-stone', 3866:'column-royal',
    3862:'paving-module', 2822:'basin', 1878:'royal-beam', 1688:'brazier-wide', 1556:'wide-steps',
    1510:'pillar-plinth', 1080:'brazier-tall', 849:'brazier-low', 660:'narrow-steps', 476:'glazed-rail'
  };
  const expected = ['axis-stone','lamassu-pier','column-stone','column-royal','basin','water',
    'gate-frame-main','gate-frame-side','sacred-mural','roof-coffers','roof-light-wells','sunbeams',
    'brazier-wide','flames'].map(name => 'T3-' + name);

  const muralAtlas = { w:975,h:650, kings:[786,54,963,218],
    bull:[461,17,641,244], guardian:[673,19,761,242], palms:[12,271,388,355],
    sun:[421,271,715,356], script:[12,380,350,442],
    rosettes:[12,472,250,511], masonry:[852,539,964,631] };
  const roofAtlas = { w:868,h:650, stone:[332,215,360,247], bead:[38,12,827,34],
    inscriptions:[206,121,295,144] };
  const floorAtlas = { w:650,h:650, tiles:[122,81,526,568], blue:[22,73,115,348] };
  const floorLevel = .026;
  const reflectionLayer = 31;

  function uvRect(atlas, r, u, v) {
    return [(r[0]+u*(r[2]-r[0]))/atlas.w, 1-(r[3]-v*(r[3]-r[1]))/atlas.h];
  }

  function atlasPlane(w,h,atlas,r) {
    const g = new THREE.PlaneGeometry(w,h), uv = g.attributes.uv;
    for(let i=0;i<uv.count;i++) uv.setXY(i,...uvRect(atlas,r,uv.getX(i),uv.getY(i)));
    return g;
  }

  function tile(texture, atlas, r) {
    const img=texture.image, scaleX=img.width/atlas.w, scaleY=img.height/atlas.h;
    const canvas=document.createElement('canvas');
    canvas.width=Math.round((r[2]-r[0])*scaleX);
    canvas.height=Math.round((r[3]-r[1])*scaleY);
    canvas.getContext('2d').drawImage(img,r[0]*scaleX,r[1]*scaleY,canvas.width,canvas.height,0,0,canvas.width,canvas.height);
    const t=new THREE.CanvasTexture(canvas);
    t.wrapS=t.wrapT=THREE.RepeatWrapping;
    t.colorSpace=THREE.SRGBColorSpace;
    t.anisotropy=4;
    return t;
  }

  function indexedGeometry(vertices, tex, indices) {
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(tex,2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  function removeFaces(part, predicate) {
    const g=part.geometry, p=g.attributes.position, original=g.index.array, keep=[];
    for(let i=0;i<original.length;i+=3) {
      const a=original[i], b=original[i+1], c=original[i+2];
      const x=(p.getX(a)+p.getX(b)+p.getX(c))/3;
      const y=(p.getY(a)+p.getY(b)+p.getY(c))/3;
      const z=(p.getZ(a)+p.getZ(b)+p.getZ(c))/3;
      if(!predicate(x,y,z)) keep.push(a,b,c);
    }
    g.setIndex(keep);
    const bounds=new THREE.Box3(), v=new THREE.Vector3();
    keep.forEach(index=>bounds.expandByPoint(v.fromBufferAttribute(p,index)));
    g.boundingBox=bounds;
  }

  function prepareParts(parts) {
    Object.values(parts).forEach(part => {
      const g=part.geometry;
      g.computeBoundingBox();
      const b=g.boundingBox, c=b.getCenter(new THREE.Vector3());
      part.size=b.getSize(new THREE.Vector3());
      g.translate(-c.x,-b.min.y,-c.z);
      g.computeBoundingBox();
      part.material.roughness=.94;
      part.material.metalness=.83;
    });
    const basin=parts.basin, s=basin.size;
    // The embedded water and sandstone are one connected indexed mesh.
    // Remove the measured blue planar patch only; the sloped wet perimeter
    // and every face of the authored carved, geometrical rim remain.
    removeFaces(basin,(x,y,z)=>Math.abs(x/s.x)<.419&&Math.abs(z/s.z)<.413&&y/s.y>.448&&y/s.y<.513);
    for(const [name,band] of [['brazier-wide',.793],['brazier-tall',.82],['brazier-low',.70]]) {
      const p=parts[name];
      removeFaces(p,(x,y)=>y/p.size.y>band);
      p.flameBase=band;
    }
  }

  function wetSurface(pools, time) {
    const positions=[],uv=[],indices=[];
    for(const {x,z,w,d,level} of pools) {
      const dx=w/2-.38,dz=d/2-.35,i=positions.length/3;
      positions.push(x-dx,level,z-dz,x-dx,level,z+dz,x+dx,level,z-dz,x+dx,level,z+dz);
      uv.push(0,0,0,1,1,0,1,1);
      indices.push(i,i+1,i+2,i+2,i+1,i+3);
    }
    const reflection={value:null}, textureMatrix={value:new THREE.Matrix4()};
    const material=new THREE.ShaderMaterial({
      transparent:true,depthWrite:false,
      uniforms:{time,reflection,textureMatrix},
      vertexShader:`
        uniform mat4 textureMatrix;
        varying vec3 local; varying vec3 world; varying vec2 edgeUV; varying vec4 reflected;
        void main(){
          local=position;
          vec4 wp=modelMatrix*vec4(position,1.0);
          world=wp.xyz; edgeUV=uv;
          reflected=textureMatrix*wp;
          gl_Position=projectionMatrix*viewMatrix*wp;
        }
      `,
      fragmentShader:`
        uniform float time; uniform sampler2D reflection;
        varying vec3 local; varying vec3 world; varying vec2 edgeUV; varying vec4 reflected;
        void main(){
          vec3 view=normalize(cameraPosition-world);
          float a=sin(local.x*2.92+local.z*1.47-time*.67);
          float b=sin(local.z*4.94-local.x*1.63+time*.40);
          float c=sin(local.z*1.84+local.x*.57-time*.29);
          vec3 normal=normalize(vec3(.006*a,1.,.008*(.55*b+.45*c)));
          float fresnel=pow(1.-clamp(dot(view,normal),0.,1.),3.6);
          vec2 projected=reflected.xy/max(.001,reflected.w);
          vec2 ruv=projected+vec2(a+.28*b,.54*b+.46*c)*vec2(.00105,.00153);
          float reveal=smoothstep(.0,.045,ruv.x)*smoothstep(.0,.045,ruv.y)
            *smoothstep(.0,.045,1.-ruv.x)*smoothstep(.0,.045,1.-ruv.y);
          vec3 mirror=texture2D(reflection,ruv).rgb*.60+
            (texture2D(reflection,ruv+vec2(.0019,.0012)).rgb+
            texture2D(reflection,ruv-vec2(.0019,.0012)).rgb)*.20;
          vec3 deep=mix(vec3(.0025,.006,.012),vec3(.012,.026,.040),fresnel);
          vec3 lit=deep+mirror*vec3(.70,.80,.87)*(.32+.53*fresnel)*reveal;
          float edge=min(min(edgeUV.x,1.-edgeUV.x),min(edgeUV.y,1.-edgeUV.y));
          lit*=mix(.61,1.,smoothstep(0.,.045,edge));
          gl_FragColor=vec4(lit,.981);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `
    });
    const water=new THREE.Mesh(indexedGeometry(positions,uv,indices),material);
    water.name='T3-water';
    water.renderOrder=2;

    const constrained=!!(window.SinDevice && SinDevice.detect().constrained);
    const resolution=constrained?[256,144]:[432,243];
    const cadence=constrained?118:85;
    const target=new THREE.WebGLRenderTarget(...resolution,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
    target.texture.name='T3 shared planar reflection';
    target.texture.generateMipmaps=false;
    const mirror=new THREE.PerspectiveCamera();
    const up=new THREE.Vector3(0,1,0), direction=up.clone(), centre=up.clone();
    const eye=up.clone(), look=up.clone(), rotation=new THREE.Matrix4(), clip=new THREE.Plane();
    const coeff=new THREE.Vector4(), q=new THREE.Vector4(), vp=new THREE.Matrix4(), frustum=new THREE.Frustum();
    const bias=new THREE.Matrix4().set(.5,0,0,.5, 0,.5,0,.5, 0,0,.5,.5, 0,0,0,1);
    let nextFrame=0,lastDraws=0,passes=0;

    function refresh(renderer, scene, camera, prime=false) {
      const now=performance.now();
      if(!camera || renderer.getRenderTarget() || renderer.getContext().isContextLost() || (!prime&&now<nextFrame))return;
      camera.updateWorldMatrix(true,false);
      water.updateWorldMatrix(true,false);
      centre.set(0,pools[0].level,0).applyMatrix4(water.matrixWorld);
      eye.setFromMatrixPosition(camera.matrixWorld);
      if(eye.y<=centre.y+.05)return;
      if(!prime){
        vp.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
        if(!frustum.setFromProjectionMatrix(vp).intersectsObject(water))return;
      }
      nextFrame=now+cadence;
      rotation.extractRotation(camera.matrixWorld);
      direction.set(0,0,-1).applyMatrix4(rotation).reflect(up);
      mirror.position.copy(eye);
      mirror.position.y=2*centre.y-eye.y;
      mirror.up.set(0,1,0).applyMatrix4(rotation).reflect(up);
      mirror.lookAt(look.copy(mirror.position).add(direction));
      mirror.layers.set(reflectionLayer);
      mirror.far=camera.far;
      mirror.updateMatrixWorld();
      mirror.projectionMatrix.copy(camera.projectionMatrix);

      // Move the near plane to the water so the mirror renders only the
      // architecture above it. This avoids global clipping shader variants.
      clip.setFromNormalAndCoplanarPoint(up,centre).applyMatrix4(mirror.matrixWorldInverse);
      coeff.set(clip.normal.x,clip.normal.y,clip.normal.z,clip.constant);
      const p=mirror.projectionMatrix.elements;
      q.set((Math.sign(coeff.x)+p[8])/p[0],(Math.sign(coeff.y)+p[9])/p[5],-1,(1+p[10])/p[14]);
      const scale=coeff.dot(q);
      if(Math.abs(scale)<.0001)return;
      coeff.multiplyScalar(2/scale);
      p[2]=coeff.x;p[6]=coeff.y;p[10]=coeff.z+1-.0025;p[14]=coeff.w;
      mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();
      textureMatrix.value.multiplyMatrices(bias,mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);

      const previous=renderer.getRenderTarget();
      const useXr=renderer.xr.enabled,autoShadow=renderer.shadowMap.autoUpdate,visible=water.visible;
      try{
        water.visible=false;
        renderer.xr.enabled=false;
        renderer.shadowMap.autoUpdate=false;
        renderer.setRenderTarget(target);
        renderer.state.buffers.depth.setMask(true);
        renderer.clear();
        renderer.render(scene,mirror);
        reflection.value=target.texture;
        passes++;
        lastDraws=renderer.info.render.calls;
      } finally {
        renderer.setRenderTarget(previous);
        renderer.xr.enabled=useXr;
        renderer.shadowMap.autoUpdate=autoShadow;
        water.visible=visible;
      }
    }

    return {water,refresh,dispose(){target.dispose();},
      report(){return {resolution,cadence,passes,lastDraws};}};
  }

  function flames(sources,time) {
    const vert=[],uv=[],ind=[];
    for(const [x,z,y] of sources) for(const angle of [0,Math.PI/2]) {
      const c=Math.cos(angle)*.29,s=Math.sin(angle)*.29,i=vert.length/3;
      vert.push(x-c,y,z-s,x+c,y,z+s,x-c,y+.61,z-s,x+c,y+.61,z+s);
      uv.push(0,0,1,0,0,1,1,1);ind.push(i,i+1,i+2,i+1,i+3,i+2);
    }
    const m=new THREE.ShaderMaterial({uniforms:{time},side:THREE.DoubleSide,transparent:true,
      depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false,
      vertexShader:`varying vec2 v; varying float phase;
        void main(){v=uv; phase=position.x*.94+position.z*.61; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:`uniform float time; varying vec2 v; varying float phase;
        void main(){
          float h=v.y; float swing=sin(h*7.+time*3.6+phase)*.13*h;
          float x=abs(v.x-.5-swing); float w=(1.-h)*(.190+.092*sin(3.1*h));
          float taper=smoothstep(0.,.14,h)*(1.-smoothstep(.82,1.,h));
          float f=(1.-smoothstep(w*.46,w+.085,x))*taper;
          float core=(1.-smoothstep(w*.10,w*.63,x))*(1.-smoothstep(.11,.79,h));
          float flutter=.88+.12*sin(time*5.3+phase*3.1+h*8.);
          gl_FragColor=vec4(mix(vec3(1.0,.245,.021),vec3(1.,.9,.38),core),f*flutter*.92);
        }`
    });
    const mesh=new THREE.Mesh(indexedGeometry(vert,uv,ind),m);
    mesh.name='T3-flames';
    mesh.renderOrder=4;
    return mesh;
  }

  function sunbeams(strips,height) {
    const vert=[],uv=[],indices=[];
    for(const {x,z,d} of strips) {
      for(const thin of [0,.40]) {
        const i=vert.length/3;
        vert.push(x-.32,height+.006,z-d*.44+thin,x+.30,height+.006,z+d*.44+thin,
          x-4.1,1.10,z-d*.76+3.2+thin,x-2.7,1.10,z+d*.85+3.2+thin);
        uv.push(0,0,1,0,0,1,1,1);indices.push(i,i+1,i+2,i+1,i+3,i+2);
      }
    }
    const m=new THREE.ShaderMaterial({side:THREE.DoubleSide,transparent:true,depthWrite:false,
      blending:THREE.AdditiveBlending,toneMapped:false,
      vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:'varying vec2 v;void main(){float f=sin(v.x*3.14159)*(1.-smoothstep(.15,1.,v.y))*smoothstep(0.,.07,v.y);gl_FragColor=vec4(.79,.51,.26,.125*f);}'
    });
    const mesh=new THREE.Mesh(indexedGeometry(vert,uv,indices),m);
    mesh.name='T3-sunbeams';
    mesh.renderOrder=3;
    return mesh;
  }

  function hall(room, doors, parts, textures) {
    const {cx,cz,x0,x1,z0,z1}=room.bbox, w=x1-x0, d=z1-z0, hx=w/2, hz=d/2, h=room.height;
    const root=new THREE.Group();
    root.name='T3-Sacred-Columns-Hall';
    root.position.set(cx,0,cz);
    const [art,floorAtlasMap,roofMap]=textures;
    textures.forEach(t=>{t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;});
    const paving=tile(floorAtlasMap,floorAtlas,floorAtlas.tiles), floorBand=tile(floorAtlasMap,floorAtlas,floorAtlas.blue);
    const rock=tile(art,muralAtlas,muralAtlas.masonry), beamRock=tile(roofMap,roofAtlas,roofAtlas.stone);
    const standard=(map,color,roughness,bump=0)=>new THREE.MeshStandardMaterial({
      map,color,roughness,metalness:0,bumpMap:bump?map:null,bumpScale:bump
    });
    const stone=standard(paving,0xdbc3a4,.76,.032), axisStone=standard(paving,0xe6c9a3,.43,.020);
    const trim=standard(floorBand,0xd1bc95,.72,.015);
    const stoneWall=standard(rock,0xbca086,.96,.026), engraving=standard(art,0xd6bf9d,.91,.025);
    const roofStone=standard(beamRock,0x9d8165,.96,.038), roofTrim=standard(roofMap,0xd5b595,.88,.026);
    roofStone.emissive.setHex(0x714b2c);
    roofStone.emissiveMap=beamRock;
    roofStone.emissiveIntensity=.37;
    const diffuser=new THREE.MeshBasicMaterial({color:0xffd4a1,toneMapped:false});
    const draw=SinGreatLibrary.builder(root,'T3-');
    const boxes=[],pools=[],sources=[];
    const time={value:0};
    function put(name,mat,g,x,y,z,a=0){draw.surface(name,mat,g,null,x,y,z,a);}
    function box(name,mat,x,y,z,width,height,depth,tile=3.0){draw.box(name,mat,null,x,y,z,width,height,depth,tile);}
    function solid(minx,maxx,miny,maxy,minz,maxz,water=false) {
      boxes.push({minx:cx+minx,maxx:cx+maxx,miny,maxy,minz:cz+minz,maxz:cz+maxz,_wing:true,_sacredHall:true,water});
    }
    function prop(name,source,x,y,z,width,height,depth,yaw=0,blocking=false) {
      const p=parts[source];
      const matrix=draw.asset(name,p,null,x,y,z,width,height,depth,yaw);
      if(blocking) {
        const b=p.geometry.boundingBox.clone().applyMatrix4(matrix),inset=.045;
        solid(b.min.x+inset,b.max.x-inset,b.min.y,b.max.y,b.min.z+inset,b.max.z-inset);
      }
    }
    function plane(name,mat,x,y,z,width,depth,tileX,tileZ,angle=0) {
      const g=new THREE.PlaneGeometry(width,depth).rotateX(-Math.PI/2);
      const uv=g.attributes.uv;
      for(let i=0;i<uv.count;i++) uv.setXY(i,uv.getX(i)*tileX,uv.getY(i)*tileZ);
      put(name,mat,g,x,y,z,angle);
    }

    // Keep the world floor continuous. Slabs and basin skirts sit on it.
    plane('side-paving',stone,0,floorLevel,0,w,d,w/4.8,d/5.94);
    const axisWidth=5.60;
    for(let i=0;i<4;i++) prop('axis-foundation','paving-module',-hx+w/8+i*w/4,-.28,0,w/4,.307,axisWidth);
    plane('axis-stone',axisStone,0,.043,0,w,axisWidth,w/5.90,1);
    for(const z of [-(axisWidth/2-.16),axisWidth/2-.16]){
      plane('axis-glazed-trim',trim,0,.049,z,.30,w,1,w/2.41,Math.PI/2);
    }
    plane('offering-crossing',stone,0,.039,(hz+axisWidth/2)/2,5.7,hz-axisWidth/2,1.12,1.60);

    const basinWidth=17.58,basinDepth=5.34;
    const basin=parts.basin, rim=basin.geometry.attributes.position;
    // Retain the original small rim width when the central body is
    // extended. A uniformly stretched square wastes metres at each end.
    function extend(value,rawSize,size,border){
      const u=value/rawSize+.5, lo=.098, hi=1-lo, edge=border/size;
      const v=u<lo?u*edge/lo:u>hi?1-(1-u)*edge/lo:edge+(u-lo)*(1-2*edge)/(hi-lo);
      return (v-.5)*rawSize;
    }
    for(let i=0;i<rim.count;i++)rim.setXYZ(i,extend(rim.getX(i),basin.size.x,basinWidth,.34),
      rim.getY(i),extend(rim.getZ(i),basin.size.z,basinDepth,.31));
    basin.material=basin.material.clone();
    basin.material.color.setHex(0xbba183);
    basin.material.roughness=.82;
    for(const x of [-11.98,11.98])for(const z of [-5.62,5.62]){
      const width=basinWidth,depth=basinDepth,body=.233,bottom=-.101;
      prop('basin','basin',x,bottom,z,width,body,depth);
      pools.push({x,z,w:width,d:depth,level:bottom+body*.575});
      solid(x-width/2+.035,x+width/2-.035,0,.145,z-depth/2+.035,z+depth/2-.035,true);
    }

    // Column grids leave 5.6 m on the main axis, 7.8 m at the transverse
    // crossing, and two continuous walks behind the basins.
    for(const x of [-17.15,-10.75,-4.30,4.30,10.75,17.15])for(const z of [-8.82,8.82]){
      const name=Math.abs(x)>10?'column-royal':'column-stone', p=parts[name];
      const height=h-.60, width=2.95, depth=width*p.size.z/p.size.x;
      prop(name,name,x,.223,z,width,height,depth,z>0?Math.PI:0,true);
      prop('plinth','pillar-plinth',x,-.117,z,3.32,.34,3.36,0,true);
    }
    for(const x of [-20.15,20.15])for(const z of [-10.40,10.40]){
      const yaw=x>0?Math.PI:0;
      prop('lamassu-pier','lamassu-pier',x,floorLevel,z,2.44,h-.39,2.35,yaw,true);
    }

    function wallFace(name,mat,width,height,x,y,z,yaw,rect) {
      put(name,mat,atlasPlane(width,height,muralAtlas,rect),x,y,z,yaw);
    }
    function wallStone(x,z,width,height,y,yaw){
      const g=new THREE.PlaneGeometry(width,height), v=g.attributes.uv;
      for(let i=0;i<v.count;i++)v.setXY(i,v.getX(i)*width/3.15,v.getY(i)*height/3.15);
      put('stone-wall-finish',stoneWall,g,x,y,z,yaw);
    }
    for (const side of [-1,1]) {
      const z=side*(hz-.054), yaw=side===1?Math.PI:0;
      const spans=side===1?[[-hx,-2.70],[2.70,hx]]:[[-hx,hx]];
      for(const [a,b] of spans) wallStone((a+b)/2,z,b-a,h,h/2,yaw);
      if(side===1) wallStone(0,hz-.72,8.2,h-5.52,(h+5.52)/2,yaw);
      for(let x=-hx+3.0;x<hx;x+=5.80){
        if(side===1&&Math.abs(x)<5.2) continue;
        wallFace('relief-frieze',engraving,5.7,1.75,x,9.71,z-side*.036,yaw,muralAtlas.palms);
        wallFace('lower-glazed-trim',engraving,5.70,.40,x,1.0,z-side*.037,yaw,muralAtlas.rosettes);
      }
      for(const [i,x] of [-18.2,-12.5,-6.7,6.7,12.5,18.2].entries()){
        wallFace('sacred-mural',engraving,4.96,4.54,x,4.68,z-side*.043,yaw,
          [muralAtlas.kings,muralAtlas.guardian,muralAtlas.bull][i%3]);
        wallFace('cuneiform-frieze',engraving,4.98,.64,x,7.40,z-side*.044,yaw,muralAtlas.script);
      }
    }

    const gate=parts.gate;
    // Preserve the original jambs and UVs, remapping the measured clear
    // interval .404–.601 independently so it never pinches the baked door.
    const gateParts=new Map();
    function frame(width,opening){
      const key=width+':'+opening;
      if(gateParts.has(key))return gateParts.get(key);
      const g=gate.geometry.clone(),p=g.attributes.position;
      for(let i=0;i<p.count;i++){
        const u=p.getZ(i)/gate.size.z+.5;
        const cut0=.403, cut1=.603, gap=opening/2;
        const z=u<cut0? -width/2+u/cut0*(width/2-gap) :
          u>cut1? gap+(u-cut1)/(1-cut1)*(width/2-gap) : -gap+(u-cut0)/(cut1-cut0)*opening;
        p.setXYZ(i,p.getX(i)/gate.size.x*.94,p.getY(i)/gate.size.y*9.55,z);
      }
      g.computeBoundingBox();
      const result={geometry:g,material:gate.material,size:new THREE.Vector3(1,1,1)};
      gateParts.set(key,result);
      return result;
    }
    for(const door of doors){
      const side=door.axis==='z', inward=door.x<cx?1:-1;
      const x=side?door.x-cx:inward*(-hx+.37),z=side?hz-.37:door.z-cz;
      const yaw=side?Math.PI/2:inward===1?0:Math.PI;
      const width=side?14.8:19.6, opening=door.width+.19;
      draw.asset(side?'gate-frame-side':'gate-frame-main',frame(width,opening),null,x,0,z,1,1,1,yaw);
      const half=opening/2+.03;
      if(side){
        solid(-width/2,-half,0,8.2,z-.24,z+.35);
        solid(half,width/2,0,8.2,z-.24,z+.35);
      } else {
        solid(x-.32,x+.32,0,8.2,z-width/2,z-half);
        solid(x-.32,x+.32,0,8.2,z+half,z+width/2);
        const facing=inward===1?Math.PI/2:-Math.PI/2;
        const wallX=inward*(-hx+.061);
        for(const sideZ of [-1,1]){
          wallStone(wallX,z+sideZ*(hz+half)/2,hz-half,h,h/2,facing);
          wallFace('portal-side-frieze',engraving,5.37,1.36,x+inward*.08,10.09,z+sideZ*8.00,facing,muralAtlas.palms);
        }
        wallStone(x-inward*.09,z,8.2,h-5.52,(h+5.52)/2,facing);
        wallFace('winged-sun',engraving,10.3,1.63,x+inward*.078,10.46,z,facing,muralAtlas.sun);
        for(const sideZ of [-1,1]) {
          wallStone(x-inward*.27,z+sideZ*10.99,2.1,h,h/2,facing);
          wallFace('cuneiform-frieze',engraving,2.12,2.08,x-inward*.18,8.52,z+sideZ*10.94,facing,muralAtlas.script);
        }
      }
    }

    // Subtract the slots from the visible ceiling only. They climb into
    // bright closed light wells above the palace envelope, with no sky leak.
    const slots=[];
    for(const x of [-15.2,-7.6,0,7.6,15.2]){
      for(let i=-3;i<=3;i++) slots.push({x,z:i*.75,w:2.18,d:.36});
      for(const z of [-9.7,9.7]) for(const dx of [-.9,0,.9]) slots.push({x:x+dx,z,w:.34,d:1.42});
    }
    let segments=[[-hx,hx,-hz,hz]];
    for(const s of slots){
      const a=s.x-s.w/2,b=s.x+s.w/2,c=s.z-s.d/2,e=s.z+s.d/2, next=[];
      for(const [l,r,n,f] of segments){
        const il=Math.max(l,a),ir=Math.min(r,b),iz=Math.max(n,c),ifz=Math.min(f,e);
        if(ir<=il||ifz<=iz){next.push([l,r,n,f]);continue;}
        if(l<il)next.push([l,il,n,f]);
        if(ir<r)next.push([ir,r,n,f]);
        if(n<iz)next.push([il,ir,n,iz]);
        if(ifz<f)next.push([il,ir,ifz,f]);
      }
      segments=next;
    }
    for(const [l,r,n,f] of segments) box('roof-coffers',roofStone,(l+r)/2,h+.13,(n+f)/2,r-l,.26,f-n,1.54);
    for(const x of [-20.2,-11.40,-3.8,3.8,11.40,20.2]){
      box('roof-coffers',roofStone,x,h-.205,0,.57,.405,d,1.76);
      for(const z of [-8.86,8.86]) {
        prop('carved-roof-beams','royal-beam',x,h-.415,z,.56,.244,3.62,0);
        put('roof-script',roofTrim,atlasPlane(.58,.25,roofAtlas,roofAtlas.inscriptions),
          x,h-.29,z>0?7.05:-7.05,z>0?Math.PI:0);
      }
    }
    for(const z of [-10.95,-8.85,-3.21,3.21,8.85,10.95]){
      box('roof-coffers',roofStone,0,h-.205,z,w,.41,.47,1.96);
      for(let x=-19;x<21;x+=5.42){
        const g=atlasPlane(5.38,.245,roofAtlas,roofAtlas.bead);
        put('roof-royal-bands',roofTrim,g,x,h-.251,z+(z<0?.242:-.242),z<0?0:Math.PI);
      }
    }
    const throat=[], shade=[], indices=[];
    for(const s of slots){
      const corners=[[-1,-1],[-1,1],[1,1],[1,-1]], top=h+.59;
      for(let i=0;i<4;i++){
        const a=corners[i],b=corners[(i+1)%4],k=throat.length/3;
        for(const [sy,grow,p] of [[h,0,a],[h,0,b],[top,.135,a],[top,.135,b]]){
          throat.push(s.x+p[0]*(s.w/2+grow),sy,s.z+p[1]*(s.d/2+grow));
          shade.push(...(grow?[1,.70,.38]:[.64,.35,.15]));
        }
        indices.push(k,k+1,k+2,k+1,k+3,k+2);
      }
      box('roof-visible-light',diffuser,s.x,top+.047,s.z,s.w+.27,.09,s.d+.27,.7);
    }

    function brazier(source,x,z,height) {
      const p=parts[source], y=floorLevel, scale=height/p.size.y;
      prop(source,source,x,y,z,p.size.x*scale,height,p.size.z*scale,0,true);
      sources.push([x,z,y+height*p.flameBase-.065]);
    }
    for(const x of [-19.75,-3.1,3.1,19.75])for(const z of [-2.67,2.67]) brazier('brazier-wide',x,z,1.34);
    for(const x of [-14.85,14.85])for(const z of [-10.52,10.52]) brazier('brazier-tall',x,z,1.24);
    for(const z of [-9.7,9.7]) for(const x of [-5.8,5.8]) brazier('brazier-low',x,z,.92);

    draw.flush();
    const shaft=new THREE.BufferGeometry();
    shaft.setAttribute('position',new THREE.Float32BufferAttribute(throat,3));
    shaft.setAttribute('color',new THREE.Float32BufferAttribute(shade,3));
    shaft.setIndex(indices);
    const liners=new THREE.Mesh(shaft,new THREE.MeshBasicMaterial({side:THREE.DoubleSide,vertexColors:true,toneMapped:false}));
    liners.name='T3-roof-light-wells';
    root.add(liners);
    const poolReflection=wetSurface(pools,time);
    root.add(poolReflection.water);
    root.add(flames(sources,time));
    root.add(sunbeams(slots.filter(s=>Math.abs(s.z)<2.7&&Math.abs(s.x)<13),h));
    const first=new THREE.SpotLight(0xffd2a0,350,38,.75,.91,-2);
    first.position.set(2.3,h+1.16,1.65);
    first.target.position.set(-3.7,0,0);
    first.name='T3-roof-key';
    first.userData.physicalFalloff=true;
    root.add(first,first.target);
    const second=new THREE.SpotLight(0xffdab3,305,33,.72,.91,-2);
    second.position.set(15.3,h+1.16,-1.0);
    second.target.position.set(18.0,0,0);
    second.name='T3-portal-key';
    second.userData.physicalFalloff=true;
    root.add(second,second.target);
    const local=[];
    for(const [x,z,y] of [sources[0],sources[3],sources[5],sources[6]]){
      const l=new THREE.PointLight(0xffa54d,11.5,7.4,-2);
      l.position.set(x,y+.23,z);
      l.userData.physicalFalloff=true;
      root.add(l);
      local.push(l);
    }
    root.traverse(n=>{
      if(n.isMesh)n.castShadow=false;
      if((n.isMesh&&n.name!=='T3-sunbeams')||n.isLight)n.layers.enable(reflectionLayer);
    });
    // Preserve the wing's ambient palette without submitting props or
    // lights from other rooms to the low-resolution mirror.
    const mirrorAmbient=new THREE.HemisphereLight(0xffe2b8,0x5c3a28,.78);
    mirrorAmbient.name='T3-reflection-ambient';
    mirrorAmbient.layers.set(reflectionLayer);
    root.add(mirrorAmbient);
    SinGreatLibrary.setLibraryExposure(root,.77);
    const camera=new THREE.PerspectiveCamera(56,1280/720,.10,200);
    camera.name='T3-Presentation-Camera';
    camera.position.set(-hx+.41,2.86,.04);
    camera.lookAt(hx-.4,4.36,0);
    root.add(camera);
    const warmup=SinGreatLibrary.geometryWarmup(root);
    const used=new Set();
    root.traverse(n=>{if(n.geometry)used.add(n.geometry);});
    Object.values(parts).forEach(p=>{if(!used.has(p.geometry))p.geometry.dispose();});
    floorAtlasMap.dispose();
    return {
      root,camera,boxes,warmup,
      refreshWater:poolReflection.refresh, reflectionReport:poolReflection.report, disposeWater:poolReflection.dispose,
      tick(t){time.value=t;local.forEach((light,i)=>{light.intensity=11.5*(.96+.04*Math.sin(t*3.70+i*1.92));});},
      dispose(){poolReflection.dispose();warmup.dispose();SinGreatLibrary.disposeResources(root);}
    };
  }

  async function build(room,doors,load,signal){
    const textures=[];
    let gltf,parts;
    try {
      gltf=await load(model,signal);
      signal.throwIfAborted();
      parts=SinGreatLibrary.split(gltf,partsByTriangles);
      gltf=null;
      prepareParts(parts);
      const loader=new THREE.TextureLoader();
      for(const path of images){signal.throwIfAborted();textures.push(await loader.loadAsync(encodeURI(path)));}
      signal.throwIfAborted();
      return hall(room,doors,parts,textures);
    } catch(e){
      if(gltf)SinGreatLibrary.disposeResources(gltf.scene);
      if(parts){
        const group=new THREE.Group();
        Object.values(parts).forEach(p=>group.add(new THREE.Mesh(p.geometry,p.material)));
        SinGreatLibrary.disposeResources(group);
      }
      textures.forEach(t=>t.dispose());
      throw e;
    }
  }

  window.SinSacredColumns={build,expected};
})();
