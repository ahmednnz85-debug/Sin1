/* Sacred entrance on the existing T1 footprint. Local +X leads to T2. */
(function () {
  'use strict';

  const assets = [
    'assets/اثاث المدخل المقدس.glb', 'assets/نقوش وحجر المدخل .JPG',
    'assets/ارضية الحرم المقدس.JPG', 'assets/سقف الحرم المقدم.JPG'
  ];
  const names = {
    17788:'vessels',11203:'lamassu',10290:'source-stairs',9885:'column-and-torch',7426:'source-frame',
    5054:'column',4890:'plinth',3628:'pedestal',2428:'blocks',1256:'capital'
  };
  const expected = ['floor','aisle-inlay','stairs','walls','emblem','portal-band','lamassu','columns',
    'side-niche','floor-brazier','hanging-bowl','chains','casting','flames','smoke','ceiling','lightwell','sunbeams']
    .map(name => 'T1-'+name);
  const rise=.168, halfStair=2.29;
  const treads = [
    [2.56,3.06,1], [3.06,3.56,2], [3.56,4.06,3], [4.06,5.78,4],
    [5.78,6.34,3], [6.34,6.90,2], [6.90,7.46,1]
  ];
  const maxStep= rise+.105;
  function stairFloor(x,z) {
    if (Math.abs(z)>halfStair) return 0;
    const step=treads.find(([a,b])=>x>=a&&x<b);
    return step ? step[2]*rise : 0;
  }

  // Trim only the inspected part of the atlas mesh, keeping its original
  // normals and material UVs. Clip the top plane of the vessel externally
  // so every face of the plant/fixed flame is removed below the new liner.
  function cut(source, belongs, top=1) {
    const g=source.geometry, pos=g.attributes.position, tex=g.attributes.uv, normal=g.attributes.normal;
    g.computeBoundingBox();
    const origin=g.boundingBox.min, size=g.boundingBox.getSize(new THREE.Vector3());
    const out=[], normals=[], uv=[], index=g.index.array, limit=origin.y+top*size.y;
    function vertex(i){
      return [pos.getX(i),pos.getY(i),pos.getZ(i),normal.getX(i),normal.getY(i),normal.getZ(i),tex.getX(i),tex.getY(i)];
    }
    for(let i=0;i<index.length;i+=3){
      const triangle=[vertex(index[i]),vertex(index[i+1]),vertex(index[i+2])];
      const x=(triangle.reduce((s,v)=>s+v[0],0)/3-origin.x)/size.x;
      const y=(triangle.reduce((s,v)=>s+v[1],0)/3-origin.y)/size.y;
      const z=(triangle.reduce((s,v)=>s+v[2],0)/3-origin.z)/size.z;
      if(!belongs(x,y,z)) continue;
      const poly=[];
      for(let e=0;e<3;e++){
        const a=triangle[e], b=triangle[(e+1)%3];
        const low=a[1]<=limit, next=b[1]<=limit;
        if(low) poly.push(a);
        if(low!==next){
          const t=(limit-a[1])/(b[1]-a[1]);
          poly.push(a.map((v,k)=>v+(b[k]-v)*t));
        }
      }
      for(let p=1;p+1<poly.length;p++) for(const v of [poly[0],poly[p],poly[p+1]]){
        out.push(v[0],v[1],v[2]);normals.push(v[3],v[4],v[5]);uv.push(v[6],v[7]);
      }
    }
    if(!out.length) throw new Error('Sacred entrance accessory slice was empty');
    const result=geometry(out,uv);
    result.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
    return {geometry:result,material:source.material};
  }

  function geometry(positions,uv,indices) {
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    if(indices) g.setIndex(indices);
    return g;
  }

  function prepare(parts,constrained) {
    const hanging=parts['column-and-torch'];
    // Its bowl is low and offset from the shaft. At the shared edge keep
    // only the portion towards the bowl's measured depth. Form new chains
    // separately to avoid bringing any shaft faces along.
    parts.hanging=cut(hanging,(x,y,z)=>{
      const bowl=x>.53||(y>.218&&x>.359&&z>.52);
      const centre=Math.hypot((x-.74)/.27,(z-.56)/.43)<.72;
      return bowl&&(y<.247||!centre);
    },.286);
    const vessels=parts.vessels;
    parts.brazier=cut(vessels,(x,y,z)=>{
      const centre=Math.hypot((x-.20)/.20,(z-.466)/.27)<.78;
      return x<.46&&(y<.382||!centre);
    },.510);
    parts.urn=cut(vessels,x=>x>.47,.555);
    for(const key of ['vessels','column-and-torch','source-stairs','source-frame','blocks','capital']){
      parts[key].geometry.dispose();
      delete parts[key];
    }
    for(const part of Object.values(parts)){
      const g=part.geometry;
      g.computeBoundingBox();
      const bounds=g.boundingBox;
      part.size=bounds.getSize(new THREE.Vector3());
      const c=bounds.getCenter(new THREE.Vector3());
      g.translate(-c.x,-bounds.min.y,-c.z);
      g.computeBoundingSphere();
    }
    const m=parts.column.material;
    m.roughness=.95;
    m.metalness=.57;
    m.normalScale.set(.71,.71);
    for(const texture of new Set([m.map,m.roughnessMap,m.metalnessMap,m.normalMap])){
      if(!texture) continue;
      if(constrained&&window.SinDevice) SinDevice.capTexture(texture,1024);
      texture.anisotropy=4;
    }
  }

  function crop(src,width,height,[l,t,r,b],repeat=false) {
    const img=src.image, sx=img.width/width, sy=img.height/height;
    const c=document.createElement('canvas');
    c.width=Math.round((r-l)*sx);c.height=Math.round((b-t)*sy);
    c.getContext('2d').drawImage(img,l*sx,t*sy,(r-l)*sx,(b-t)*sy,0,0,c.width,c.height);
    const tex=new THREE.CanvasTexture(c);
    tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;
    if(repeat) tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
    return tex;
  }

  function sheet(w,h,u=1,v=1) {
    const g=new THREE.PlaneGeometry(w,h),uv=g.attributes.uv;
    for(let i=0;i<uv.count;i++) uv.setXY(i,uv.getX(i)*u,uv.getY(i)*v);
    return g;
  }

  function archBand(radius,sill,thickness) {
    const vertices=[],uv=[],tri=[];
    for(let i=0;i<=48;i++){
      const a=Math.PI*i/48;
      for(const r of [radius-thickness,radius]){
        const x=r*Math.cos(a), y=r*Math.sin(a);
        vertices.push(x,sill+y,0);uv.push(.5+.486*x/radius,.02+.96*y/radius);
      }
      if(i<48){const k=i*2;tri.push(k,k+1,k+2,k+1,k+3,k+2);}
    }
    const g=geometry(vertices,uv,tri);g.computeVertexNormals();
    return g;
  }

  function arched(radius,bottom,spring) {
    const path=new THREE.Shape();
    path.moveTo(radius,bottom);path.lineTo(radius,spring);
    path.absarc(0,spring,radius,0,Math.PI);
    path.lineTo(-radius,bottom);path.closePath();
    return path;
  }

  function solid(shape,depth) {
    const g=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:22});
    const p=g.attributes.position, uv=g.attributes.uv, n=g.attributes.normal;
    for(let i=0;i<p.count;i++){
      const s=Math.abs(n.getX(i))>.55;
      uv.setXY(i,(s?p.getZ(i):p.getX(i))/2.45,p.getY(i)/2.45);
    }
    return g;
  }

  function effects(root,emitters,clock,low) {
    const vertex=`
      varying vec2 tex; varying vec3 local;
      void main(){tex=uv;local=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}
    `;
    function add(name,g,fragment,order,blend){
      const m=new THREE.Mesh(g,new THREE.ShaderMaterial({uniforms:{clock},
        vertexShader:vertex,fragmentShader:fragment,side:THREE.DoubleSide,transparent:true,
        depthWrite:false,blending:blend}));
      m.name='T1-'+name;m.renderOrder=order;root.add(m);
      return m;
    }
    function cards(sources){
      const p=[],uv=[],tri=[];
      for(const [x,y,z,w,h] of sources) for(const angle of [.32,1.88]){
        const i=p.length/3,a=Math.cos(angle)*w/2,b=Math.sin(angle)*w/2;
        p.push(x-a,y,z-b,x+a,y,z+b,x-a,y+h,z-b,x+a,y+h,z+b);
        uv.push(0,0,1,0,0,1,1,1);tri.push(i,i+1,i+2,i+1,i+3,i+2);
      }
      return geometry(p,uv,tri);
    }
    add('flames',cards(emitters.map(e=>[...e.slice(0,3),e[3],e[4]])),`
      uniform float clock; varying vec2 tex; varying vec3 local;
      void main(){
        float y=tex.y,t=clock+local.x*.94+local.z*.65;
        float x=abs(tex.x-.5+.14*sin(t*5.4+y*9.)*y);
        float width=pow(max(0.,1.-y),.8)*.33;
        float flicker=.59+.41*sin(19.*y-6.6*t+9.*tex.x);
        float a=(1.-smoothstep(.22*width,width+.05,x))*smoothstep(0.,.07,y)*(1.-smoothstep(.52,1.,y));
        float core=(1.-smoothstep(.16*width,.70*width,x))*(1.-smoothstep(.23,.75,y));
        gl_FragColor=vec4(mix(vec3(.85,.14,.006),vec3(1.,.84,.37),core),a*(.69+.22*flicker));
        #include <colorspace_fragment>
      }
    `,5,THREE.AdditiveBlending);
    add('smoke',cards(emitters.map(([x,y,z,w,h])=>[x,y+h*.53,z,w*1.7,h*2.8])),`
      uniform float clock; varying vec2 tex; varying vec3 local;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){
        vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);
      }
      void main(){
        float y=tex.y,t=clock*.47+local.z*.38;
        float bend=(.10*sin(12.*y-t)+.048*sin(24.*y-t*1.39))*smoothstep(.05,.78,y);
        float radius=mix(.029,.39,y);
        vec2 p=vec2((tex.x-bend)*8.5,10.*y-t);
        float n=noise(p)*.72+noise(p*2.17+2.)*.28;
        float a=(1.-smoothstep(.19*radius,radius,abs(tex.x-.5-bend)))*
          smoothstep(.29,.77,n)*smoothstep(0.,.12,y)*(1.-smoothstep(.39,1.,y));
        gl_FragColor=vec4(.65,.58,.51,a*.51);
        #include <colorspace_fragment>
      }
    `,6,THREE.NormalBlending);
    const rayPos=[],rayUV=[],rayInd=[];
    for(const z of low?[-.92,0,.92]:[-1.36,-.71,0,.71,1.36]){
      const i=rayPos.length/3;
      rayPos.push(-.3,8.37,z-.15,.06,8.37,z+.17,3.12,.69,z*1.77-.74,4.44,.69,z*1.77+.77);
      rayUV.push(0,1,1,1,0,0,1,0);rayInd.push(i,i+1,i+2,i+1,i+3,i+2);
    }
    add('sunbeams',geometry(rayPos,rayUV,rayInd),`
      varying vec2 tex;
      void main(){
        float a=pow(max(0.,sin(tex.x*3.141593)),2.0);
        gl_FragColor=vec4(.84,.67,.43,a*.27*smoothstep(.06,.86,tex.y));
      }
    `,3,THREE.AdditiveBlending).userData.ceiling=true;
  }

  function assemble(room,doors,kit,maps,low,root) {
    const {cx,cz}=room.bbox, h=room.height;
    const [atlas,floor,roof]=maps;
    const tex=(r,repeat)=>crop(atlas,828,552,r,repeat);
    const pbr=(map,color,roughness,metalness=.03,bump=0)=>new THREE.MeshStandardMaterial({
      map,color,roughness,metalness,bumpMap:!low&&bump?map:null,bumpScale:bump
    });
    const stone=pbr(tex([488,9,641,179],true),0xddcfbb,.81,.03,.033);
    const cave=pbr(stone.map,0x947b64,.88);
    const blue=pbr(tex([493,192,657,314],true),0xbdc2cb,.65,.045,.017);
    const gold=pbr(tex([487,450,599,538],true),0xe1bb77,.54,.17,.021);
    const cuneiform=pbr(tex([5,258,470,319],true),0xdac4a7,.79,.02,.022);
    const star=pbr(tex([4,386,470,414],true),0xf3dab0,.63,.10);
    const palms=pbr(tex([5,420,470,466],true),0xe3c6a0,.61,.075);
    const rosette=pbr(tex([5,200,473,245],true),0xe1c6a2,.66,.075);
    const arch=pbr(tex([473,322,666,432]),0xeacda4,.65,.085);
    arch.side=THREE.DoubleSide;
    function isolatedGold(rect) {
      const map=tex(rect), canvas=map.image, ctx=canvas.getContext('2d');
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
      for(let i=0;i<pixels.data.length;i+=4) {
        const gain=Math.max(pixels.data[i],pixels.data[i+1],pixels.data[i+2]);
        pixels.data[i+3]=Math.max(0,Math.min(255,(gain-22)*8));
      }
      ctx.putImageData(pixels,0,0);map.needsUpdate=true;
      const mat=pbr(map,0xeed5a8,.58,.12);
      mat.alphaTest=.35;
      return mat;
    }
    const moon=isolatedGold([709,330,765,380]), stars=isolatedGold([667,330,703,373]);
    const floorMap=pbr(crop(floor,400,400,[77,2,323,397],true),0xf4dcc5,.46,.04,.023);
    const trim=pbr(crop(floor,400,400,[20,4,59,395],true),0xedc79b,.59);
    const skylightTrim=pbr(crop(roof,700,394,[212,27,489,54],true),0xc5b09a,.68);
    const sky=new THREE.MeshBasicMaterial({color:0xffe1ab,toneMapped:false});
    const chain=new THREE.MeshStandardMaterial({color:0x684027,roughness:.75,metalness:.36});
    const liner=new THREE.MeshStandardMaterial({color:0x332217,roughness:.82,metalness:.19,side:THREE.DoubleSide});
    const leaf=new THREE.MeshStandardMaterial({color:0x5a5726,roughness:.73,side:THREE.DoubleSide});
    const draw=SinGreatLibrary.builder(root,'T1-');
    const box=(key,mat,x,y,z,w,dY,d,tile)=>draw.box(key,mat,null,x,y,z,w,dY,d,tile);
    const place=(key,mat,g,x,y,z,yaw=0)=>draw.surface(key,mat,g,null,x,y,z,yaw);
    const plate=(key,mat,x,y,z,w,h,yaw,u=1,v=1)=>place(key,mat,sheet(w,h,u,v),x,y,z,yaw);
    const horizontal=(key,mat,x,y,z,w,d,u=1,v=1,up=true)=>place(key,mat,
      sheet(w,d,u,v).rotateX(up?-Math.PI/2:Math.PI/2),x,y,z);
    const collision=[], stairBoxes=[], emitters=[], clock={value:0};
    function obstacle(x0,x1,z0,z1,miny,maxy){
      collision.push({minx:cx+x0,maxx:cx+x1,minz:cz+z0,maxz:cz+z1,miny,maxy,_wing:true,_entrance:true});
    }
    function prop(name,part,x,y,z,height,yaw=0,slender=1){
      const s=height/part.size.y;
      const w=part.size.x*s*slender,d=part.size.z*s*slender;
      draw.asset(name,part,null,x,y,z,w,height,d,yaw);
      return [w,d];
    }

    horizontal('floor',floorMap,0,.011,0,16,12,16/5.9,12/3.75);
    for(const side of [-1,1]){
      for(const [lo,hi] of [[-7.96,-3.90],[-3.90,-.28],[-.28,2.55]]){
        const g=sheet(.65,hi-lo,1,(hi-lo)/3.45).rotateX(-Math.PI/2).rotateY(Math.PI/2);
        place('aisle-inlay',trim,g,(hi+lo)/2,.016,side*1.67);
      }
      for(const z of [1.305,2.035]){
        horizontal('aisle-border',gold,-2.71,.016,side*z,10.48,.036,3.8,1);
      }
    }
    for(const [a,b,i] of treads){
      const y=rise*i;
      box('stairs',stone,(a+b)/2,y/2,0,b-a,y,halfStair*2,1.72);
      stairBoxes.push({minx:cx+a,maxx:cx+b,minz:cz-halfStair,maxz:cz+halfStair,miny:0,maxy:y,_wing:true});
    }

    // Face the existing shell; explicitly leave all three real openings.
    for(const side of [-1,1]){
      const doorway=side<0?doors.find(d=>d.kind==='arch'):doors.find(d=>d.axis==='x'&&d.x>cx);
      const gap=doorway.width*.5+.015,x=side*7.988,yaw=side<0?Math.PI/2:-Math.PI/2;
      for(const flank of [-1,1])
        plate('walls',stone,x,h/2,flank*(gap+6)/2,6-gap,h,yaw,(6-gap)/2.5,h/2.44);
      if(doorway.height<h)
        plate('walls',stone,x,(h+doorway.height)*.5,0,gap*2,h-doorway.height,yaw,1.83,.8);
    }
    const realSide=doors.find(d=>d.axis==='z');
    const sideOpening=realSide.width/2+.014;
    for(const side of [-1,1]){
      const z=side*5.982,yaw=side<0?0:Math.PI;
      const runs=side<0?[[-8,-1.26],[1.26,8]]:[[-8,-sideOpening],[sideOpening,8]];
      for(const [a,b] of runs){
        const x=(a+b)/2,w=b-a;
        plate('walls',stone,x,h/2,z,w,h,yaw,w/2.7,h/2.44);
        plate('dados',palms,x,.69,z-side*.025,w,1.27,yaw,w/3.9);
        plate('glyphs',cuneiform,x,4.69,z-side*.023,w,1.01,yaw,w/5.5);
        plate('wall-crown',rosette,x,7.34,z-side*.026,w,.41,yaw,w/3.4);
      }
      if(side>0){
        const header=h-realSide.height;
        box('side-door-stone',stone,0,realSide.height+header*.5,5.916,realSide.width+.09,header,.25,2.35);
        plate('wall-crown',rosette,0,7.34,5.765,realSide.width+.08,.41,yaw,1.4);
        const radius=realSide.width/2,sill=realSide.height-radius;
        const surround=new THREE.Shape();
        surround.moveTo(-sideOpening,sill);surround.lineTo(-radius,sill);
        surround.absarc(0,sill,radius,Math.PI,0,true);
        surround.lineTo(sideOpening,sill);surround.lineTo(sideOpening,realSide.height+.03);
        surround.lineTo(-sideOpening,realSide.height+.03);surround.closePath();
        place('side-door-stone',stone,solid(surround,.32),0,0,6.268,yaw);
        place('side-door-frame',arch,archBand(radius+.21,sill,.21),0,0,5.938,yaw);
      }else{
        const opening=arched(1.02,.68,3.22);
        const panel=new THREE.Shape();
        panel.moveTo(-1.27,0);panel.lineTo(1.27,0);panel.lineTo(1.27,h);panel.lineTo(-1.27,h);panel.closePath();
        panel.holes.push(opening);
        place('side-niche',stone,solid(panel,.34),0,0,-5.99);
        const backing=new THREE.ShapeGeometry(opening,22);
        place('niche-back',cave,backing,0,0,-5.971);
        place('side-niche',arch,archBand(1.13,3.22,.18),0,0,-5.631);
        box('niche-sill',stone,0,.55,-5.72,2.35,.28,.56,1.43);
        addPalm(0,.69,-5.57,.63);
        obstacle(-1.16,1.16,-6.01,-5.41,0,.70);
      }
    }

    const gateX=5.58, heading=-Math.PI/2;
    const spring=4.80, outer=3.18;
    const opening=arched(2.28,.67,3.37);
    const silhouette=arched(3.20,.56,spring);
    silhouette.holes.push(opening);
    place('portal-stone',stone,solid(silhouette,.40),gateX+.39,0,0,heading);
    const wallInlay=new THREE.Shape();
    wallInlay.moveTo(-3.50,5.24);wallInlay.lineTo(3.50,5.24);
    wallInlay.lineTo(3.50,8.02);wallInlay.lineTo(-3.50,8.02);wallInlay.closePath();
    const archClearance=new THREE.Path(),clearanceAngle=Math.asin((5.25-spring)/outer);
    archClearance.absarc(0,spring,outer,clearanceAngle,Math.PI-clearanceAngle);
    archClearance.closePath();wallInlay.holes.push(archClearance);
    const blueSurround=new THREE.ShapeGeometry(wallInlay,36);
    const surroundPosition=blueSurround.attributes.position,surroundUV=blueSurround.attributes.uv;
    for(let i=0;i<surroundPosition.count;i++) surroundUV.setXY(i,surroundPosition.getX(i)/1.65,surroundPosition.getY(i)/1.65);
    box('portal-header',stone,gateX+.19,7.56,0,.38,1.49,7.06,2.20);
    place('portal-header-glaze',blue,blueSurround,gateX+.001,0,0,heading);
    // Cut the blue tympanum horizontally above the passage. The contour
    // follows the same radius used by the monumental moulding.
    const tympanum=new THREE.Shape(), angle=Math.asin((5.70-spring)/2.98);
    tympanum.absarc(0,spring,2.98,angle,Math.PI-angle);tympanum.closePath();
    const lunette=new THREE.ShapeGeometry(tympanum,28), p=lunette.attributes.position, uv=lunette.attributes.uv;
    for(let i=0;i<p.count;i++) uv.setXY(i,p.getX(i)/1.65,p.getY(i)/1.65);
    place('portal-glaze',blue,lunette,gateX-.028,0,0,heading);
    place('portal-band',arch,archBand(outer,spring,.40),gateX-.053,0,0,heading);
    place('portal-inner-arch',arch,archBand(2.44,3.37,.16),gateX-.043,0,0,heading);
    plate('emblem',moon,gateX-.063,6.73,0,1.46,1.30,heading);
    for(const side of [-1,1]) plate('emblem',stars,gateX-.063,6.29,side*1.45,.49,.54,heading);
    plate('portal-stars',star,gateX-.064,5.69,0,4.43,.28,heading,1.27);
    for(const sign of [-1,1]){
      box('portal-piers',blue,gateX+.02,2.75,sign*2.85,.45,4.16,.74,1.32);
      box('portal-piers',gold,gateX-.21,2.12,sign*2.37,.22,2.90,.24,1.24);
      box('portal-piers',gold,gateX-.18,3.51,sign*2.38,.31,.36,.37,.77);
      obstacle(gateX-.26,gateX+.23,sign*2.83-.46,sign*2.83+.46,.49,5.5);
    }
    // Rear niches have an extruded ring and a recessed stone back. Their
    // platform and backstop lie outside both the stair and the side exit.
    for(const side of [-1,1]){
      const z=side*4.80,nicheX=6.77,profile=arched(.78,.79,2.39);
      const wall=new THREE.Shape();
      wall.moveTo(-1.17,.12);wall.lineTo(1.17,.12);wall.lineTo(1.17,5.23);wall.lineTo(-1.17,5.23);wall.closePath();
      wall.holes.push(profile);
      place('rear-niche',stone,solid(wall,.41),nicheX+.41,0,z,heading);
      place('niche-back',cave,new THREE.ShapeGeometry(profile,20),nicheX+.36,0,z,heading);
      place('rear-niche',arch,archBand(.89,2.39,.14),nicheX-.016,0,z,heading);
      box('niche-sill',blue,nicheX+.03,.50,z,.98,.59,1.94,1.63);
      plate('niche-carving',palms,nicheX-.47,.524,z,1.91,.49,heading,.67);
      plate('niche-scripts',cuneiform,nicheX-.034,3.72,z,2.15,.74,heading,.57);
      addPalm(nicheX+.13,.795,z,.52);
      obstacle(nicheX-.49,nicheX+.52,z-1.0,z+1.0,0,.84);
    }

    function addPalm(x,y,z,height){
      prop('urn',kit.urn,x,y,z,height);
      const p=[],uv=[],tri=[],top=y+height;
      for(let n=0;n<10;n++){
        const az=n*2.39996, bx=Math.cos(az),bz=Math.sin(az),len=.48+(n%4)*.12;
        for(let j=0;j<8;j++){
          const a=(j+1)/8,d=len*a,cy=top+.83*a-.21*a*a,px=x+bx*d,pz=z+bz*d;
          const leafLength=(1-a)*.21+.033;
          for(const side of [-1,1]){
            const i=p.length/3;
            p.push(px,cy,pz,px+bx*.18-bz*side*leafLength*.59,cy+.14,pz+bz*.18+bx*side*leafLength*.59,
              px+bx*.09-bz*side*leafLength,cy+.059,pz+bz*.09+bx*side*leafLength);
            uv.push(0,0,.5,1,1,0);tri.push(i,i+1,i+2);
          }
        }
      }
      const g=geometry(p,uv,tri);g.computeVertexNormals();
      place('niche-palms',leaf,g,0,0,0);
    }

    for(const side of [-1,1]){
      for(const [x,z,height] of [[-1.43,3.83,7.98],[5.06,3.66,7.94]]){
        const [w,d]=prop('columns',kit.column,x,.017,side*z,height,0,.56);
        obstacle(x-w*.5,x+w*.5,side*z-d*.5,side*z+d*.5,.016,height);
        box('column-pad',stone,x,height+.198,side*z,w+.17,.36,d+.19,1.40);
      }
      const x=-3.08,z=side*5.41;
      const [w,d]=prop('lamassu',kit.lamassu,x,.80,z,2.95,side<0?0:Math.PI);
      box('guardian-stone',stone,x,.40,z,w+.28,.80,d+.20,1.68);
      plate('guardian-inlay',palms,x,.471,z-side*(d*.5+.111),w+.20,.56,side<0?0:Math.PI,.81);
      obstacle(x-(w+.31)/2,x+(w+.31)/2,z-(d+.24)/2,z+(d+.24)/2,0,3.77);
      prop('ornament-block',kit.plinth,4.41,0,side*5.04,.59);
      prop('carved-block',kit.pedestal,-2.63,0,side*5.32,.51);
      const floorX=2.80,floorZ=side*3.12;
      const [fw,fd]=prop('floor-brazier',kit.brazier,floorX,.013,floorZ,1.19);
      bowlInset(floorX,1.204,floorZ,fw,fd);
      obstacle(floorX-fw*.47,floorX+fw*.47,floorZ-fd*.47,floorZ+fd*.47,0,1.21);
      emitters.push([floorX,1.192,floorZ,.69,.78]);
      for(const [px,pz,base] of [[-3.96,4.43,4.05],[2.38,4.60,4.22]]){
        const z=side*pz, size=prop('hanging-bowl',kit.hanging,px,base,z,.40);
        bowlInset(px,base+.398,z,...size);
        emitters.push([px,base+.39,z,.59,.69]);
        suspend(px,base+.38,z,size[0]*.45,size[1]*.45);
      }
    }

    function bowlInset(x,y,z,w,d){
      const g=new THREE.LatheGeometry([
        new THREE.Vector2(.015,-.19),new THREE.Vector2(.18,-.18),new THREE.Vector2(.33,-.11),
        new THREE.Vector2(.43,-.045),new THREE.Vector2(.49,0)
      ],20);
      g.scale(w,1,d);
      place('casting',liner,g,x,y,z);
    }

    function suspend(x,y,z,rx,rz){
      const cap=h-.44;
      for(let i=0;i<3;i++){
        const theta=i*Math.PI*2/3+Math.PI*.38, dx=Math.cos(theta)*rx,dz=Math.sin(theta)*rz;
        const segments=low?13:19;
        for(let j=0;j<=segments;j++){
          const t=j/segments, s=1-.96*t;
          const link=new THREE.TorusGeometry(.042,.010,4,7).scale(.70,1.52,.81);
          link.rotateY(theta+(j%2)*Math.PI*.5);
          place('chains',chain,link,x+dx*s,y+(cap-y)*t,z+dz*s);
        }
        // A dark slender core makes the run continuous in reduced resolution.
        const a=new THREE.Vector3(x+dx,y,z+dz), b=new THREE.Vector3(x+dx*.04,cap,z+dz*.04);
        const delta=b.clone().sub(a), g=new THREE.CylinderGeometry(.008,.008,delta.length(),5);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));
        const c=a.lerp(b,.5);
        place('chains',chain,g,c.x,c.y,c.z);
      }
    }

    const ceiling=h-.12,l=-3.95,r=2.65,n=-1.62,f=1.62;
    for(const [a,b,c,d] of [[-8,l,-6,6],[r,8,-6,6],[l,r,-6,n],[l,r,f,6]])
      horizontal('ceiling',stone,(a+b)/2,ceiling,(c+d)/2,b-a,d-c,(b-a)/2.6,(d-c)/2.6,false);
    for(const z of [-4.43,-2.14,2.14,4.43]){
      box('ceiling-beams',stone,0,8.16,z,16,.42,.55,2.42);
      box('ceil-frieze',skylightTrim,0,7.944,z,16,.047,.47,4.82);
    }
    for(const x of [-7.34,l-.32,r+.29,5.45,7.61])
      box('ceiling-beams',stone,x,8.17,0,.55,.40,12,2.24);
    for(const z of [n-.12,f+.12]) box('lightwell',stone,(l+r)/2,8.87,z,r-l+.26,.98,.29,2.26);
    for(const x of [l-.13,r+.13]) box('lightwell',stone,x,8.87,0,.27,.98,f-n+.34,2.26);
    horizontal('ceiling-sky',sky,(l+r)/2,9.26,0,r-l+.15,f-n+.23,1,1,false);
    for(let i=0;i<8;i++) box('lightwell',stone,l+(i+.45)*(r-l)/8,9.01,0,.115,.17,f-n+.08,1.0);
    for(let i=0;i<5;i++) box('lightwell',stone,(l+r)/2,9.02,n+(i+.5)*(f-n)/5,r-l+.09,.135,.082,1.0);
    for(const x of [-3.79,-2.07,-.80,.48]){
      const g=new THREE.BoxGeometry(.081,.13,.64).rotateY(.58);
      place('lightwell',stone,g,x,9.01,-.28);
    }

    draw.flush();
    for(const n of root.children){
      n.castShadow=false;
      if(/^T1-(ceiling|ceil-|lightwell)/.test(n.name)) n.userData.ceiling=true;
    }
    effects(root,emitters,clock,low);
    function light(color,intensity,distance,x,y,z){
      const l=new THREE.PointLight(color,intensity,distance,2);l.position.set(x,y,z);
      l.userData.physicalFalloff=true;root.add(l);
      return l;
    }
    light(0xffe2bd,37,14,-.33,7.31,0);
    const fire=[];
    for(const sign of [-1,1]){
      fire.push(light(0xff9b4b,12,5.4,2.87,1.94,sign*3.41));
      fire.push(light(0xffab63,13,6.1,-3.84,4.30,sign*4.62));
      light(0xffcd80,10,4.8,5.91,2.32,sign*4.91);
    }
    SinGreatLibrary.setLibraryExposure(root,.32);
    const camera=new THREE.PerspectiveCamera(60,16/9,.10,105);
    camera.name='T1-presentation';camera.position.set(-9.25,1.79,0);camera.lookAt(5.65,3.25,0);root.add(camera);
    const warmup=SinGreatLibrary.geometryWarmup(root);
    return {
      root,camera,collision,stairBoxes,warmup,
      floorAt(x,z){return stairFloor(x-cx,z-cz);},
      update(time){
        clock.value=time;fire.forEach((l,i)=>{l.intensity=(i%2===0?12:13)*(.97+.03*Math.sin(time*4.3+i*2.14));});
      },
      dispose(){warmup.dispose();SinGreatLibrary.disposeResources(root);}
    };
  }

  async function build(room,doors,load,signal,constrained) {
    const root=new THREE.Group(), maps=[];
    root.name='T1-Sacred-Entrance';root.position.set(room.bbox.cx,0,room.bbox.cz);
    let model,parts;
    try{
      model=await load(assets[0],signal);signal.throwIfAborted();
      parts=SinGreatLibrary.split(model,names);model=null;
      prepare(parts,constrained);
      const loader=new THREE.TextureLoader();
      for(const url of assets.slice(1)){
        signal.throwIfAborted();maps.push(await loader.loadAsync(encodeURI(url)));
      }
      signal.throwIfAborted();
      return assemble(room,doors,parts,maps,constrained,root);
    }catch(error){
      if(parts) Object.values(parts).forEach(part=>root.add(new THREE.Mesh(part.geometry,part.material)));
      else if(model)root.add(model.scene);
      SinGreatLibrary.disposeResources(root);throw error;
    }finally{maps.forEach(t=>t.dispose());}
  }

  window.SinT1Entrance={build,expected,assets,maxStep,stairFloor,treads,halfStair};
})();
