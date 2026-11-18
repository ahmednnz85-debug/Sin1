/* Authored dressing for the existing royal offerings room (T5). */
(function () {
  'use strict';

  const furnitureFile = 'assets/اثاث القرابين.glb';
  const facadeFile = 'assets/جدار الامامي للقرابين.glb';
  const atlasFiles = ['assets/ارضية القرابين.JPG', 'assets/جدار الاقواس.JPG',
    'assets/نقوش القرابين.JPG', 'assets/سقف القرابين.JPG'];
  const components = {
    26902: 'altar', 13569: 'tableHarvest', 10112: 'tableFruit', 4118: 'fruitBowl',
    4012: 'roast', 3358: 'libation', 3326: 'incenseStand', 2986: 'incenseBowl',
    2844: 'pedestal', 2700: 'brazier', 2617: 'grapes', 2272: 'blueJar',
    1788: 'cakes', 1774: 'goldJar', 1760: 'dates', 1756: 'bread',
    1230: 'fig', 1196: 'grain', 1176: 'blueEwer', 1128: 'clayJar'
  };
  const expected = ['sacred-facade', 'altar', 'tableHarvest', 'tableFruit', 'niche-masonry',
    'arch-glazed-frames', 'niche-backs', 'wall-processions', 'floor-stone', 'floor-inlay',
    'ceiling-fields', 'ceiling-beams', 'clerestory-masonry', 'light-well-liners',
    'brazier', 'incenseStand', 'animated-flames', 'incense-smoke'].map(name => 'T5-' + name);

  // Pixel rectangles measured on the normalized previews of the original atlases.
  const floorAtlas = { w:650, h:650, stone:[122,81,526,568], border:[18,5,117,647] };
  const archAtlas = { w:900, h:450, parade:[15,17,455,285], stone:[649,137,711,249],
    arch:[767,17,796,279], rosettes:[15,319,744,374], script:[533,399,884,431] };
  const reliefAtlas = { w:900, h:600, priests:[304,16,590,152], ox:[216,176,383,261],
    procession:[17,287,591,360], stars:[315,382,590,421],
    gold:[616,442,885,469] };
  const ceilingAtlas = { w:867, h:650, masonry:[354,271,375,311],
    roses:[42,13,823,35], solar:[70,156,797,185] };
  const floorY = .017;
  const altar = { x:0, z:-.44, width:5.05, height:1.84, depth:3.38 };
  const treads = [
    { front:.493, back:.493, halfWidth:.493, height:.122 },
    { front:.423, back:.446, halfWidth:.455, height:.215 },
    { front:.306, back:.366, halfWidth:.365, height:.296 }
  ];
  const shrineSteps = [
    { width:9.89, depth:2.07, height:.14 },
    { width:9.76, depth:1.85, height:.28 },
    { width:9.63, depth:1.63, height:.42 }
  ];

  function altarFloor(x, z) {
    const run = (altar.z - z) / altar.depth;
    const lateral = Math.abs(x - altar.x) / altar.width;
    for(let i=treads.length-1;i>=0;i--){
      const step=treads[i];
      if(lateral<=step.halfWidth&&run<=step.front&&run>=-step.back)return floorY+step.height*altar.height;
    }
    return 0;
  }

  function shrineFloor(x,z,wall){
    if(z>wall)return 0;
    for(let i=shrineSteps.length-1;i>=0;i--){
      const step=shrineSteps[i];
      if(Math.abs(x)<=step.width/2&&z>=wall-step.depth)return step.height;
    }
    return 0;
  }

  function crop(map, atlas, rect, saturation=1) {
    const [left, top, right, bottom] = rect;
    const image = map.image;
    const sx = image.width / atlas.w, sy = image.height / atlas.h;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((right-left)*sx));
    canvas.height = Math.max(1, Math.round((bottom-top)*sy));
    const ctx=canvas.getContext('2d');
    ctx.drawImage(image, left*sx, top*sy, (right-left)*sx, (bottom-top)*sy,
      0, 0, canvas.width, canvas.height);
    if(saturation<1){
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
      const data=pixels.data;
      for(let i=0;i<data.length;i+=4){
        const luminance=(data[i]*.24+data[i+1]*.64+data[i+2]*.12)*(1-saturation);
        for(let channel=0;channel<3;channel++)data[i+channel]=luminance+data[i+channel]*saturation;
      }
      ctx.putImageData(pixels,0,0);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  function panelGeometry(width, height, atlas, rect) {
    const geometry = new THREE.PlaneGeometry(width,height);
    const uv = geometry.attributes.uv;
    const [l,t,r,b] = rect;
    for (let i=0;i<uv.count;i++) uv.setXY(i,(l+(r-l)*uv.getX(i))/atlas.w,1-(b-(b-t)*uv.getY(i))/atlas.h);
    return geometry;
  }

  function floorSheet(w,d,u,v,angle=0) {
    const g=new THREE.PlaneGeometry(w,d).rotateX(-Math.PI/2);
    const uv=g.attributes.uv;
    for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*u,uv.getY(i)*v);
    return g.rotateY(angle);
  }

  function filterTriangles(part, keep) {
    const g=part.geometry, p=g.attributes.position, index=g.index.array, next=[];
    for(let i=0;i<index.length;i+=3){
      const a=index[i],b=index[i+1],c=index[i+2];
      const x=(p.getX(a)+p.getX(b)+p.getX(c))/3;
      const y=(p.getY(a)+p.getY(b)+p.getY(c))/3;
      const z=(p.getZ(a)+p.getZ(b)+p.getZ(c))/3;
      if(keep(x,y,z)) next.push(a,b,c);
    }
    g.setIndex(next);
  }

  function prepareFurniture(parts, constrained) {
    const material=parts.altar.material;
    material.metalness=.64;
    material.roughness=.91;
    material.color.setHex(0xdcc4ab);
    if(constrained&&window.SinDevice){
      SinDevice.capTexture(material.map,1024);
      SinDevice.capTexture(material.normalMap,512);
      SinDevice.capTexture(material.metalnessMap,384);
    }
    for(const [name,part] of Object.entries(parts)){
      const g=part.geometry;
      g.computeBoundingBox();
      const bounds=g.boundingBox, centre=bounds.getCenter(new THREE.Vector3());
      part.size=bounds.getSize(new THREE.Vector3());
      g.translate(-centre.x,-bounds.min.y,-centre.z);
      const s=part.size;
      // These GLBs weld the opaque smoke/flame silhouettes to their containers.
      // Keep the vessel surfaces and drop only the upright central silhouettes.
      if(name==='incenseStand') filterTriangles(part,(x,y)=>y/s.y<=.664||Math.abs(x)/s.x>.16);
      if(name==='incenseBowl') filterTriangles(part,(x,y)=>y/s.y<=.411||Math.abs(x)/s.x>.17);
      if(name==='brazier') filterTriangles(part,(x,y)=>y/s.y<=.652||Math.abs(x)/s.x>.16);
      if(name==='altar') filterTriangles(part,(x,y,z)=>!(y/s.y>.658&&x/s.x>.245&&Math.abs(z)/s.z>.31));
      if(/^(altar|table)/.test(name)){
        g.rotateY(Math.PI/2);
        part.size.set(s.z,s.y,s.x);
      }
      g.computeBoundingBox();
      if(/^(incense|brazier)/.test(name)){
        const p=new THREE.Vector3(), box=new THREE.Box3();
        for(const index of g.index.array)box.expandByPoint(p.fromBufferAttribute(g.attributes.position,index));
        g.boundingBox=box;
      }
    }
  }

  function prepareFacade(gltf, constrained) {
    let mesh;
    gltf.scene.traverse(node=>{if(node.isMesh) mesh=node;});
    if(!mesh || !mesh.geometry.index || mesh.geometry.index.count!==49074) throw new Error('Unexpected T5 wall geometry');
    // The imported root is angled for asset presentation. Recenter the complete
    // local geometry so both lamassu and the recessed palm face the entrance.
    const src=mesh.geometry, geometry=new THREE.BufferGeometry();
    for(const name of ['position','normal','uv']){
      const a=src.attributes[name];
      const data=new Float32Array(a.count*a.itemSize);
      for(let i=0;i<a.count;i++) for(let j=0;j<a.itemSize;j++) data[i*a.itemSize+j]=a.getComponent(i,j);
      geometry.setAttribute(name,new THREE.BufferAttribute(data,a.itemSize));
    }
    geometry.setIndex(src.index.clone());
    geometry.computeBoundingBox();
    const b=geometry.boundingBox, size=b.getSize(new THREE.Vector3()), c=b.getCenter(new THREE.Vector3());
    geometry.translate(-c.x,-b.min.y,-c.z);
    src.dispose();
    const material=mesh.material;
    material.color.setHex(0xe1cfb7);
    material.roughness=.88;
    material.metalness=.70;
    if(constrained&&window.SinDevice){
      SinDevice.capTexture(material.normalMap,512);
      SinDevice.capTexture(material.metalnessMap,384);
    }
    return {geometry,material,size};
  }

  function archLine(x,r,sill,spring) {
    const trace=[[x-r,sill]];
    for(let i=0;i<=24;i++){
      const angle=Math.PI*(1-i/24);
      trace.push([x+Math.cos(angle)*r,spring+Math.sin(angle)*r]);
    }
    trace.push([x+r,sill]);
    return trace;
  }

  function archFrame(x,r,sill,spring,width) {
    const inside=archLine(x,r,sill,spring), outside=archLine(x,r+width,sill,spring);
    const points=[],indices=[],uv=[];
    let run=0;
    for(let i=0;i<inside.length;i++){
      const a=inside[i],b=outside[i];
      if(i)run+=Math.hypot(a[0]-inside[i-1][0],a[1]-inside[i-1][1]);
      points.push(a[0],a[1],0,b[0],b[1],0);
      uv.push(0,run/.82,1,run/.82);
      if(i){const j=i*2;indices.push(j-2,j-1,j,j-1,j+1,j);}
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
    return g;
  }

  function effectGeometry(emitters) {
    const p=[],uv=[],ind=[];
    for(const [x,y,z,w,h] of emitters) for(const angle of [.25,Math.PI/2+.25]){
      const a=Math.cos(angle)*w/2,b=Math.sin(angle)*w/2,i=p.length/3;
      p.push(x-a,y,z-b,x+a,y,z+b,x-a,y+h,z-b,x+a,y+h,z+b);
      uv.push(0,0,1,0,0,1,1,1);ind.push(i,i+1,i+2,i+1,i+3,i+2);
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ind);
    return g;
  }

  const effectVertex = `
    varying vec2 v; varying float seed;
    void main(){
      v=uv;
      seed=floor(position.x*1.08+.4)*.73+floor(position.z*1.31+.6)*1.17;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
    }
  `;

  function addEffect(root,name,geometry,clock,fragment,blend,order) {
    const material=new THREE.ShaderMaterial({
      uniforms:{time:clock},transparent:true,depthWrite:false,
      side:THREE.DoubleSide,blending:blend,toneMapped:false,
      vertexShader:effectVertex,fragmentShader:fragment
    });
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name='T5-'+name;
    mesh.renderOrder=order;
    root.add(mesh);
  }

  function offeringsEffects(root, fire, smoke, slots, height, clock, constrained) {
    addEffect(root,'animated-flames',effectGeometry(fire),clock,`
      uniform float time; varying vec2 v; varying float seed;
      void main(){
        float y=v.y; float t=time+seed;
        float x=abs(v.x-.5+.11*sin(t*4.7+y*7.)*y);
        float w=(1.-y)*(.22+.08*sin(3.5*y));
        float foot=smoothstep(0.,.08,y);
        float a=(1.-smoothstep(w*.45,w+.06,x))*(1.-smoothstep(.72,.99,y))*foot;
        float tip=abs(v.x-.42-.12*sin(t*5.8-y*5.)*y);
        a=max(a,(1.-smoothstep(w*.26,w*.66+.035,tip))*(1.-smoothstep(.52,.88,y))*foot*.7);
        float core=(1.-smoothstep(w*.08,w*.74,x))*(1.-smoothstep(.12,.67,y));
        gl_FragColor=vec4(mix(vec3(.94,.19,.008),vec3(1.,.88,.35),core),a*(.80+.10*sin(t*6.3+y*6.)));
      }
    `,THREE.AdditiveBlending,5);
    addEffect(root,'incense-smoke',effectGeometry(smoke),clock,`
      uniform float time; varying vec2 v; varying float seed;
      float hash(vec2 p){return fract(sin(dot(p,vec2(125.7,72.3)))*43758.5453);}
      float noise(vec2 p){
        vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
      }
      void main(){
        float y=v.y,t=time*.39+seed;
        float bend=(.068*sin(y*8.-t)+.036*sin(y*22.-t*1.44))*smoothstep(.02,.74,y);
        float plume=abs(v.x-.5-bend);
        float radius=mix(.03,.36,y);
        float soft=1.-smoothstep(radius*.15,radius,plume);
        vec2 p=vec2((v.x+bend)*8.,y*10.-t);
        float cloud=noise(p)*.68+noise(p*2.07+2.)*.32;
        float a=soft*pow(smoothstep(.12,.75,cloud),1.34)*smoothstep(0.,.05,y)*(1.-smoothstep(.40,1.,y));
        gl_FragColor=vec4(.77,.73,.67,a*.46);
      }
    `,THREE.NormalBlending,6);
    const vertices=[],uv=[],indices=[];
    for(const {x,z,w,d} of slots){
      if(Math.abs(x)>2.6&&Math.abs(z)>4.3)continue;
      // Keep the central skylight shafts on constrained GPUs. Side wells
      // still light the room without a transparent layer across the walls.
      if(constrained&&(Math.abs(x)>2.6||x===0||Math.abs(x)===1.47))continue;
      const i=vertices.length/3;
      vertices.push(x-w*.42,height+.02,z-d*.52,x+w*.42,height+.02,z+d*.52,
        x-2.1-w*1.65,.3,z-1.6-d*.87,x-2.1+w*1.65,.3,z-1.6+d*.87);
      uv.push(0,0,1,0,0,1,1,1);indices.push(i,i+1,i+2,i+1,i+3,i+2);
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);
    addEffect(root,'warm-light-rays',g,clock,`
      varying vec2 v; varying float seed;
      void main(){
        float edge=pow(max(0.,sin(v.x*3.14159)),1.46);
        float dust=.92+.08*sin(v.y*16.+seed);
        gl_FragColor=vec4(.84,.57,.33,(1.-smoothstep(.04,1.,v.y))*edge* dust*.187);
      }
    `,THREE.AdditiveBlending,4);
  }

  function ceilingLayout(hx,hz) {
    const slots=[];
    for(const z of [-3.65,.12,3.89]){
      for(const x of [-2.21,-1.47,-.73,0,.73,1.47,2.21])slots.push({x,z,w:.425,d:1.41});
    }
    for(const x of [-6.24,6.24])for(const z of [-4.02,-1.31,1.39,4.09])slots.push({x,z,w:.60,d:.36});
    const xs=[-hx,...new Set(slots.flatMap(s=>[s.x-s.w/2,s.x+s.w/2])),hx].sort((a,b)=>a-b);
    const zs=[-hz,...new Set(slots.flatMap(s=>[s.z-s.d/2,s.z+s.d/2])),hz].sort((a,b)=>a-b);
    const fields=[];
    for(let i=1;i<xs.length;i++){
      const l=xs[i-1],r=xs[i],x=(l+r)/2;
      let start=zs[0];
      for(let j=1;j<zs.length;j++){
        const z=(zs[j-1]+zs[j])/2;
        if(!slots.some(s=>Math.abs(x-s.x)<s.w/2&&Math.abs(z-s.z)<s.d/2))continue;
        if(zs[j-1]>start)fields.push([l,r,start,zs[j-1]]);
        start=zs[j];
      }
      if(start<hz)fields.push([l,r,start,hz]);
    }
    return {slots,fields};
  }

  function assemble(room,entry,parts,facade,maps,constrained) {
    const {cx,cz,x0,x1,z0,z1}=room.bbox, hx=(x1-x0)/2, hz=(z1-z0)/2, h=room.height;
    const root=new THREE.Group();
    root.name='T5-Royal-Offerings';
    root.position.set(cx,0,cz);
    const draw=SinGreatLibrary.builder(root,'T5-');
    const [floorTex,arches,reliefs,roof]=maps;
    maps.forEach(t=>{t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;});
    const floorMap=crop(floorTex,floorAtlas,floorAtlas.stone);
    const floorBorder=crop(floorTex,floorAtlas,floorAtlas.border);
    const stoneMap=crop(arches,archAtlas,archAtlas.stone,.52);
    const frameMap=crop(arches,archAtlas,archAtlas.arch);
    const roofMap=crop(roof,ceilingAtlas,ceilingAtlas.masonry,.58);
    const mat=(map,color,roughness,bump=0)=>new THREE.MeshStandardMaterial({
      map,color,roughness,metalness:0,bumpMap:!constrained&&bump?map:null,bumpScale:bump
    });
    const sandstone=mat(stoneMap,0xd5bb9e,.89,.023);
    const nicheStone=mat(stoneMap,0xa88a73,.91,.028);
    const stoneFloor=mat(floorMap,0xd9bea6,.48,.025);
    const inlay=mat(floorBorder,0xd6c5ae,.62,.022);
    const ark=mat(arches,0xd1ae91,.87,.023);
    const panels=mat(reliefs,0xd4c4b4,.89,.023);
    const trim=mat(frameMap,0xe5ceb8,.76,.016);trim.side=THREE.DoubleSide;
    const roofStone=mat(roofMap,0xbfa48a,.93,.028);
    const roofBands=mat(roof,0xd1b89b,.89,.018);
    const sky=new THREE.MeshBasicMaterial({color:0xffd6a2,toneMapped:false});
    const boxes=[], stairBoxes=[], fire=[], smoke=[], clock={value:0};
    const localLights=[];
    const box=(name,m,x,y,z,width,height,depth,tile)=>draw.box(name,m,null,x,y,z,width,height,depth,tile);
    const plate=(name,m,g,x,y,z,a=0)=>draw.surface(name,m,g,null,x,y,z,a);
    function obstacle(minx,maxx,miny,maxy,minz,maxz,destination=boxes){
      destination.push({minx:cx+minx,maxx:cx+maxx,miny,maxy,minz:cz+minz,maxz:cz+maxz,_wing:true,_royalOfferings:true});
    }
    function asset(name,x,y,z,w,height,d,yaw=0,blocking=false){
      const p=parts[name], transform=draw.asset(name,p,null,x,y,z,w,height,d,yaw);
      if(blocking){
        const b=p.geometry.boundingBox.clone().applyMatrix4(transform), clearance=.035;
        obstacle(b.min.x+clearance,b.max.x-clearance,b.min.y,b.max.y,b.min.z+clearance,b.max.z-clearance);
      }
    }
    function prop(name,x,y,z,visibleHeight,yaw=0,blocking=false,remaining=1){
      const p=parts[name], height=visibleHeight/remaining,s=height/p.size.y;
      asset(name,x,y,z,p.size.x*s,height,p.size.z*s,yaw,blocking);
    }
    function band(name,material,atlas,rect,w,height,x,y,z,yaw){
      plate(name,material,panelGeometry(w,height,atlas,rect),x,y,z,yaw);
    }

    plate('floor-stone',stoneFloor,floorSheet(2*hx-.012,2*hz-.012,hx/1.62,hz/1.97),0,floorY,0);
    const rx=3.62,rz=2.63,edge=.57;
    for(const side of [-1,1]){
      plate('floor-inlay',inlay,floorSheet(edge,2*rz,1,2*rz/3.6),side*rx,floorY+.007,-.32);
      plate('floor-inlay',inlay,floorSheet(edge,2*rx+edge,1,(2*rx+edge)/3.6,Math.PI/2),
        0,floorY+.007,-.32+side*(rz+edge/2));
    }

    const entryX=entry.x-cx, doorHalf=entry.width/2+.035;
    for(const sign of [-1,1]){
      const width=hx-doorHalf;
      box('entry-stone',sandstone,entryX+sign*(hx+doorHalf)/2,h/2,-hz+.105,width,h,.19,2.75);
    }
    const header=Math.max(.24,h-entry.height);
    box('entry-stone',sandstone,entryX,h-header/2,-hz+.105,entry.width+.09,header,.19,2.75);
    box('rear-sandstone',sandstone,0,h/2,hz-.077,2*hx,h,.16,2.86);
    for(const side of [-1,1]){
      box('rear-piers',sandstone,side*5.55,h/2,hz-.40,.50,h,.59,2.65);
      band('rear-bands',panels,reliefAtlas,reliefAtlas.procession,2.70,.61,side*7.15,4.51,hz-.171,Math.PI);
    }
    const facadeWidth=9.65, facadeHeight=4.77, facadeZ=hz-.72, plinth=.42;
    draw.asset('sacred-facade',facade,null,0,plinth,facadeZ,facadeWidth,facadeHeight,1.40);
    for(const {width,depth,height} of shrineSteps){
      box('rear-plinth',sandstone,0,height-.07,hz-depth/2,width,.14,depth,1.55);
      obstacle(-width/2,width/2,height-.14,height,hz-depth,hz,stairBoxes);
    }
    obstacle(-facadeWidth*.492,facadeWidth*.492,plinth,facadeHeight+plinth,facadeZ-.67,facadeZ+.70);
    band('rear-glaze',panels,reliefAtlas,reliefAtlas.stars,16.1,.25,0,5.343,hz-.174,Math.PI);

    const archWall=new THREE.Matrix4().makeRotationY(-Math.PI/2).setPosition(hx-.025,0,0);
    const nicheCenters=[1.34,4.20], radius=1.02, sill=.72, spring=2.43;
    const front=new THREE.Shape();
    front.moveTo(-hz,0);front.lineTo(hz,0);front.lineTo(hz,4.33);front.lineTo(-hz,4.33);front.closePath();
    for(const u of nicheCenters){
      const route=archLine(u,radius,sill,spring);
      const hole=new THREE.Path();
      hole.moveTo(...route[0]);
      for(const p of route.slice(1))hole.lineTo(...p);
      hole.closePath();
      front.holes.push(hole);
    }
    const wall=new THREE.ExtrudeGeometry(front,{depth:.62,bevelEnabled:false,curveSegments:1});
    const wallUv=wall.attributes.uv;
    for(let i=0;i<wallUv.count;i++)wallUv.setXY(i,wallUv.getX(i)/1.85,wallUv.getY(i)/1.85);
    draw.surface('niche-masonry',sandstone,wall,archWall,0,0,.045);
    for(const u of nicheCenters){
      draw.box('niche-backs',nicheStone,archWall,u,2.08,.054,2.17,2.79,.085,1.8);
      draw.box('niche-sills',sandstone,archWall,u,sill-.065,.37,2.24,.13,.68,1.55);
      obstacle(hx-.67,hx,0,sill,u-radius,u+radius);
      draw.surface('arch-glazed-frames',trim,archFrame(u,radius,sill,spring,.23),archWall,0,0,.683);
      draw.surface('arch-gold-lip',trim,archFrame(u,radius-.042,sill,spring,.047),archWall,0,0,.674);
      for(const side of [-1,1]) draw.box('niche-jambs',sandstone,archWall,u+side*1.12,1.62,.674,.16,1.89,.12,1.7);
    }
    obstacle(hx-.67,hx,0,4.33,-hz,nicheCenters[0]-radius);
    obstacle(hx-.67,hx,0,4.33,nicheCenters[0]+radius,nicheCenters[1]-radius);
    obstacle(hx-.67,hx,0,4.33,nicheCenters[1]+radius,hz);
    band('wall-processions',ark,archAtlas,archAtlas.parade,6.60,2.93,hx-.715,2.65,-3.18,-Math.PI/2);
    band('wall-friezes',ark,archAtlas,archAtlas.rosettes,13.78,.39,hx-.718,4.17,0,-Math.PI/2);
    band('wall-friezes',ark,archAtlas,archAtlas.rosettes,6.52,.37,hx-.718,1.03,-3.36,-Math.PI/2);
    band('cuneiform',ark,archAtlas,archAtlas.script,5.40,.28,hx-.720,3.63,2.75,-Math.PI/2);

    box('opposite-stone',sandstone,-hx+.24,2.16,0,.43,4.32,2*hz,2.16);
    obstacle(-hx,-hx+.44,0,4.32,-hz,hz);
    band('wall-processions',panels,reliefAtlas,reliefAtlas.priests,6.11,2.80,-hx+.469,2.67,-3.60,Math.PI/2);
    band('wall-processions',panels,reliefAtlas,reliefAtlas.procession,5.77,1.42,-hx+.470,2.55,3.33,Math.PI/2);
    band('offering-animals',panels,reliefAtlas,reliefAtlas.ox,2.34,.99,-hx+.471,1.75,3.34,Math.PI/2);
    for(const y of [1.03,4.16]){
      band('wall-friezes',ark,archAtlas,archAtlas.rosettes,13.78,.40,-hx+.474,y,0,Math.PI/2);
    }
    band('cuneiform',panels,reliefAtlas,reliefAtlas.gold,5.71,.28,-hx+.475,3.62,3.35,Math.PI/2);

    for(const side of [-1,1]){
      const face=side*(hx-.54), yaw=-side*Math.PI/2;
      const windows=[-4.64,-1.69,1.29,4.35];
      box('clerestory-masonry',roofStone,face,5.37,0,.47,.27,2*hz,2.27);
      let last=-hz;
      for(const z of windows){
        const start=z-.335,end=z+.335;
        box('clerestory-masonry',roofStone,face,4.74,(start+last)/2,.47,1.01,start-last,1.63);
        box('clerestory-reveals',roofStone,face,4.44,z,.47,.27,.67,1.25);
        box('clerestory-reveals',roofStone,face,5.12,z,.47,.12,.67,1.25);
        box('clerestory-glow',sky,side*(hx-.13),4.83,z,.027,.55,.57,1);
        last=end;
      }
      box('clerestory-masonry',roofStone,face,4.74,(hz+last)/2,.47,1.01,hz-last,1.63);
      for(let z=-6.66;z<6.9;z+=.42){
        box('stone-merlons',sandstone,side*(hx-.78),4.45,z,.22,.25,.22,1.28);
      }
      band('clerestory-frieze',roofBands,ceilingAtlas,ceilingAtlas.roses,13.78,.21,side*(hx-.81),4.29,0,yaw);
    }

    const roofParts=ceilingLayout(hx,hz);
    for(const [l,r,n,f] of roofParts.fields){
      box('ceiling-fields',roofStone,(l+r)/2,h+.12,(n+f)/2,r-l,.24,f-n,1.43);
    }
    for(const z of [-5.95,-2.15,1.65,5.42]){
      box('ceiling-beams',roofStone,0,h-.19,z,2*hx,.38,.32,1.74);
      band('ceiling-decoration',roofBands,ceilingAtlas,ceilingAtlas.solar,16.89,.19,0,h-.22,z-.162,Math.PI);
    }
    for(const x of [-8.38,-6.84,-5.44,-3.25,3.25,5.44,6.84,8.38]){
      box('ceiling-beams',roofStone,x,h-.143,0,.30,.286,2*hz,1.65);
    }
    for(const {x,z,w,d} of roofParts.slots){
      const bottom=h-.01,top=h+.50,span=w+.21,len=d+.22;
      for(const side of [-1,1]){
        box('light-well-liners',roofStone,x+side*(w/2+.043),(top+bottom)/2,z,.092,top-bottom,len,1.28);
        box('light-well-liners',roofStone,x,(top+bottom)/2,z+side*(d/2+.046),span,top-bottom,.095,1.28);
      }
      box('light-well-caps',sky,x,top+.036,z,span,.072,len,1.28);
    }

    asset('altar',altar.x,floorY,altar.z,altar.width,altar.height,altar.depth);
    // The outer moulding projects ahead of the altar body. The player's
    // radius already covers part of that projection on the upper tread.
    obstacle(-1.42,1.42,.55,1.62,altar.z-altar.depth*.158,altar.z+altar.depth*.245);
    obstacle(-1.42,1.42,.55,1.62,altar.z-altar.depth*.209,altar.z+altar.depth*.245,stairBoxes);
    for(const side of [-1,1]){
      const x=side*altar.width*.345, z=altar.z-altar.depth*.299;
      obstacle(x-.30,x+.30,.50,1.41,z-.27,z+.31);
      fire.push([x,floorY+altar.height*.647,z,.58,.54]);
    }
    for(const {front,back,halfWidth,height} of treads){
      obstacle(-altar.width*halfWidth,altar.width*halfWidth,0,floorY+height*altar.height,
        altar.z-altar.depth*front,altar.z+altar.depth*back,stairBoxes);
    }

    for(const side of [-1,1]){
      const x=side*7.17, yaw=-side*Math.PI/2;
      asset('tableHarvest',side*5.54,floorY,-2.81,3.23,1.50,1.33,yaw,true);
      asset('tableFruit',x,floorY,1.44,3.20,1.42,1.31,yaw,true);
      prop('blueJar',side*4.46,floorY,-3.42,1.13,yaw,true);
      prop('clayJar',side*7.45,floorY,3.72,.72,yaw,true);
      prop('goldJar',side*5.43,floorY,4.92,.92,yaw,true);
      const bx=side*3.91,bz=4.55;
      prop('brazier',bx,floorY,bz,1.05,0,true,.652);
      fire.push([bx,floorY+1.01,bz,.73,.67]);
    }
    for(const [x,z,y] of [[hx-.39,1.34,sill+.002],[hx-.39,4.20,sill+.002]]){
      prop('blueEwer',x,y,z,1.19,-Math.PI/2,false);
      prop('brazier',x-.39,y,z,.51,0,false,.652);
      fire.push([x-.39,y+.50,z,.41,.48]);
    }
    for(const [x,z] of [[3.44,-3.25],[-3.59,-2.75]]){
      prop('incenseStand',x,floorY,z,.99,Math.PI/2,true,.664);
      smoke.push([x,floorY+.97,z,1.13,2.25]);
    }
    prop('incenseBowl',4.75,floorY,3.45,.43,0,false,.411);
    smoke.push([4.75,floorY+.40,3.45,.86,1.82]);

    draw.flush();
    offeringsEffects(root,fire,smoke,roofParts.slots,h,clock,constrained);
    const sun=new THREE.SpotLight(0xffdab0,86,16,.67,.88,2);
    sun.name='T5-skylight-key';
    sun.position.set(2.65,h+.45,3.18);sun.target.position.set(.05,.28,-1.58);
    const bounce=new THREE.SpotLight(0xffe0ba,48,17,.76,.86,2);
    bounce.name='T5-skylight-bounce';
    bounce.position.set(-3.8,h+.29,-2.55);bounce.target.position.set(.38,.12,1.18);
    for(const l of [sun,bounce]){l.userData.physicalFalloff=true;l.decay=-2;root.add(l,l.target);}
    const lamps=constrained ? [[7.52,1.64,2.60,7.2,4.1],[0,1.58,5.75,10.8,5.1]] :
      [[3.91,1.61,4.63,10.2,5.2],[-3.91,1.61,4.63,10.2,5.2],
        [7.52,1.64,2.60,7.2,4.1],[0,1.58,6.00,7.5,4.5]];
    for(const [x,y,z,power,radius] of lamps){
      const light=new THREE.PointLight(0xffa257,power,radius,-2);
      light.position.set(x,y,z);light.userData.physicalFalloff=true;root.add(light);
      localLights.push([light,power]);
    }
    root.traverse(o=>{if(o.isMesh)o.castShadow=false;});
    SinGreatLibrary.setLibraryExposure(root,.72);

    const camera=new THREE.PerspectiveCamera(59,1280/720,.11,125);
    camera.name='T5-Presentation-Camera';
    camera.position.set(entryX+.77,2.42,-hz+.38);
    camera.lookAt(.28,2.45,hz-.58);
    root.add(camera);
    floorTex.dispose();
    const used=new Set();root.traverse(o=>{if(o.geometry)used.add(o.geometry);});
    for(const p of Object.values(parts))if(!used.has(p.geometry))p.geometry.dispose();
    const warmup=SinGreatLibrary.geometryWarmup(root);
    return {
      root,camera,boxes,stairBoxes,warmup,
      floorAt(x,z){return altarFloor(x-cx,z-cz)||shrineFloor(x-cx,z-cz,hz);},
      tick(time){
        clock.value=time;
        localLights.forEach(([light,strength],i)=>{light.intensity=strength*(.97+.03*Math.sin(time*3.2+i*1.9));});
      },
      dispose(){warmup.dispose();SinGreatLibrary.disposeResources(root);}
    };
  }

  async function build(room,entry,load,signal,constrained) {
    const parts={},maps=[];
    let front, model;
    try{
      model=await load(furnitureFile,signal);
      signal.throwIfAborted();
      Object.assign(parts,SinGreatLibrary.split(model,components));model=null;
      prepareFurniture(parts,constrained);
      await new Promise(resolve=>setTimeout(resolve,0));
      model=await load(facadeFile,signal,true);
      signal.throwIfAborted();
      front=prepareFacade(model,constrained);model=null;
      const loader=new THREE.TextureLoader();
      for(const url of atlasFiles){
        signal.throwIfAborted();
        const t=await loader.loadAsync(encodeURI(url));
        if(constrained&&window.SinDevice)SinDevice.capTexture(t,1024);
        maps.push(t);
      }
      signal.throwIfAborted();
      return assemble(room,entry,parts,front,maps,constrained);
    }catch(error){
      if(model)SinGreatLibrary.disposeResources(model.scene);
      const discarded=new THREE.Group();
      for(const p of [...Object.values(parts),front].filter(Boolean))discarded.add(new THREE.Mesh(p.geometry,p.material));
      SinGreatLibrary.disposeResources(discarded);
      maps.forEach(t=>t.dispose());
      throw error;
    }
  }

  window.SinRoyalOfferings={build,expected,altarFloor,ceilingLayout};
})();
