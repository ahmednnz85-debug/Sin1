/* The two rooms share atlas and masonry helpers, but keep their individual
   floor plans, lighting and streaming ownership. Coordinates are room-local. */
(function () {
  'use strict';
  const PI=Math.PI;
  const files={
    study:'assets/اثاث غرفة المكتبة.glb', studyAtlas:'assets/نقوش غرفة المكتبة .JPG',
    studyRoof:'assets/سقف الارشيف.JPG', kingAtlas:'assets/نقوش جناح ملك.JPG',
    kingRoof:'assets/سقف جناح ملك.JPG', curtain:'assets/ستارة الشرفة.glb', sky:'assets/سماء الشرفة.JPG',
    throneColumn:'ارضيات وسقوف/optimized/اعمدة.glb', throneAtlas:'assets/نقوش قاعة العرش.JPG'
  };
  const studyParts={21219:'desk',5190:'stool',7782:'armillary',4062:'torch',6410:'vase',18273:'shelf',9923:'palm',4670:'column'};
  const studyExpected=['walls','window-jamb','lattice','mural','roof','desk','stool','armillary','shelf','rug','torch','flame']
    .map(name=>'L3-'+name);

  function aperture(room) {
    const b=room.bbox;
    const s=room.id==='L3'?{centre:-3.2,half:1.32,bottom:1.23,top:4.68}:
      {centre:0,half:5.43,bottom:.39,top:5.78};
    return {...s,x:b.x1,z:b.cz+s.centre};
  }
  async function image(url,signal) {
    const res=await fetch(encodeURI(url),{signal});
    if(!res.ok)throw Error(res.status+' '+url);
    const blob=await res.blob(); signal.throwIfAborted();
    if(typeof createImageBitmap==='function')return createImageBitmap(blob);
    const object=URL.createObjectURL(blob);
    try {
      const img=new Image();img.src=object;await img.decode();return img;
    } finally { URL.revokeObjectURL(object); }
  }
  function canvasTexture(img,baseW,baseH,rect,repeat=false,limit=768) {
    const [x,y,r,b]=rect,sx=img.width/baseW,sy=img.height/baseH;
    const scale=Math.min(1,limit/Math.max((r-x)*sx,(b-y)*sy));
    const cv=document.createElement('canvas');
    cv.width=Math.max(2,Math.round((r-x)*sx*scale));cv.height=Math.max(2,Math.round((b-y)*sy*scale));
    cv.getContext('2d').drawImage(img,x*sx,y*sy,(r-x)*sx,(b-y)*sy,0,0,cv.width,cv.height);
    const map=new THREE.CanvasTexture(cv);
    map.colorSpace=THREE.SRGBColorSpace;
    if(repeat)map.wrapS=map.wrapT=THREE.RepeatWrapping;
    map.anisotropy=4;
    return map;
  }
  function textured(map,color=0xffffff,roughness=.74,metalness=.02) {
    return new THREE.MeshStandardMaterial({map,color,roughness,metalness});
  }
  function sheet(w,h,u=1,v=1) {
    const geo=new THREE.PlaneGeometry(w,h),uv=geo.attributes.uv;
    for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*u,uv.getY(i)*v);
    return geo;
  }
  function shapePanel(left,right,height,holes) {
    const shape=new THREE.Shape();
    shape.moveTo(left,0);shape.lineTo(right,0);shape.lineTo(right,height);shape.lineTo(left,height);shape.closePath();
    shape.holes.push(...holes);
    return shape;
  }
  function extrusion(shape,depth,tile) {
    const geo=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:22});
    const a=geo.attributes.position,n=geo.attributes.normal,uv=geo.attributes.uv;
    for(let i=0;i<a.count;i++){
      if(Math.abs(n.getY(i))>.65)uv.setXY(i,a.getX(i)/tile,a.getZ(i)/tile);
      else uv.setXY(i,(Math.abs(n.getZ(i))>.65?a.getX(i):a.getZ(i))/tile,a.getY(i)/tile);
    }
    return geo;
  }
  function inwardArchitecture(room,prefix,root) {
    const b=room.bbox, X=(b.x1-b.x0)/2,Z=(b.z1-b.z0)/2;
    const d=SinGreatLibrary.builder(root,prefix);
    const box=(id,m,x,y,z,w,h,l,t)=>d.box(id,m,null,x,y,z,w,h,l,t);
    const place=(id,m,g,x,y,z,yaw=0)=>d.surface(id,m,g,null,x,y,z,yaw);
    const panel=(id,m,w,h,x,y,z,yaw,u=1,v=1)=>place(id,m,sheet(w,h,u,v),x,y,z,yaw);
    const flat=(id,m,w,l,x,y,z,u=1,v=1,up=true)=>
      place(id,m,sheet(w,l,u,v).rotateX(up?-PI/2:PI/2),x,y,z);
    // Wall-local horizontal coordinate u follows the room perimeter.
    const sides=[
      {edge:-Z,yaw:0,half:X,face:u=>[u,-Z+.025]},
      {edge:X,yaw:-PI/2,half:Z,face:u=>[X-.025,u]},
      {edge:Z,yaw:PI,half:X,face:u=>[-u,Z-.025]},
      {edge:-X,yaw:PI/2,half:Z,face:u=>[-X+.025,-u]}
    ];
    function wall(side,id,mat,l,r,low,high,thick=.21,tile=2.1) {
      if(r-l<.032||high-low<.032)return;
      const [x,z]=side.face((l+r)/2);
      const g=new THREE.BoxGeometry(r-l,high-low,thick);
      const uv=g.attributes.uv,scale=[[thick,high-low],[thick,high-low],[r-l,thick],[r-l,thick],[r-l,high-low],[r-l,high-low]];
      for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*scale[i>>2][0]/tile,uv.getY(i)*scale[i>>2][1]/tile);
      place(id,mat,g,x,(low+high)/2,z,side.yaw);
    }
    function strip(side,id,mat,l,r,y,h,step,inset=.135) {
      const count=Math.max(1,Math.round((r-l)/step)),w=(r-l)/count;
      for(let i=0;i<count;i++){
        const [x,z]=side.face(l+(i+.5)*w);
        panel(id,mat,w+.002,h,x+Math.sin(side.yaw)*inset,y,z+Math.cos(side.yaw)*inset,side.yaw);
      }
    }
    function doorsAt(side,doors) {
      return doors.filter(v=>v.axis==='z'&&Math.abs(v.z-(b.cz+side.edge))<.72).map(v=>{
        const middle=(v.x-b.cx)*Math.cos(side.yaw);
        return {l:middle-v.width/2,r:middle+v.width/2,low:0,high:v.height};
      });
    }
    function wallWithCuts(side,id,mat,cuts) {
      let start=-side.half;
      for(const {l,r,low,high} of cuts){
        wall(side,id,mat,start,l,0,room.height);
        wall(side,id,mat,l,r,0,low);
        wall(side,id,mat,l,r,high,room.height);
        start=r;
      }
      wall(side,id,mat,start,side.half,0,room.height);
    }
    function bands(side,mat,cuts,y,h,step,id) {
      let at=-side.half;
      for(const c of cuts.filter(c=>c.low<y+h*.5&&c.high>y-h*.5)){
        if(c.l-at>.05)strip(side,id,mat,at,c.l,y,h,step);
        at=c.r;
      }
      if(side.half-at>.05)strip(side,id,mat,at,side.half,y,h,step);
    }
    return {X,Z,d,box,place,panel,flat,sides,wallWithCuts,bands,doorsAt,strip};
  }
  function floorObstacle(room,boxes,x,z,w,d,bottom,top,tag) {
    boxes.push({minx:room.bbox.cx+x-w/2,maxx:room.bbox.cx+x+w/2,
      minz:room.bbox.cz+z-d/2,maxz:room.bbox.cz+z+d/2,miny:bottom,maxy:top,_wing:true,[tag]:true});
  }
  function partBase(part,yaw=0){
    const g=part.geometry;
    if(yaw)g.rotateY(yaw);
    g.computeBoundingBox();
    const b=g.boundingBox,c=b.getCenter(new THREE.Vector3());
    part.size=b.getSize(new THREE.Vector3());
    g.translate(-c.x,-b.min.y,-c.z);
  }
  function localLight(root,color,intensity,range,x,y,z) {
    const light=new THREE.PointLight(color,intensity,range,2);
    light.position.set(x,y,z);root.add(light);return light;
  }
  function firedTorch(root,x,y,z,clock) {
    const material=new THREE.ShaderMaterial({
      uniforms:{clock},transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
      vertexShader:`varying vec2 p;void main(){p=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader:`varying vec2 p;uniform float clock;
        void main(){
          float t=p.y, bend=sin(t*18.0-clock*9.0)*.055+sin(t*7.0+clock*4.0)*.035;
          float core=abs(p.x-.50-bend), taper=(1.-t)*(.41+.074*sin(clock*12.+t*12.));
          float heat=1.-smoothstep(taper*.23,max(taper,.004),core);
          float base=smoothstep(0.,.12,t), top=1.-smoothstep(.48,.99,t);
          gl_FragColor=vec4(mix(vec3(1.,.64,.16),vec3(1.,.22,.018),t),heat*base*top*.86);
        }`
    });
    const a=new THREE.Mesh(new THREE.PlaneGeometry(.40,.67),material);
    const b=new THREE.Mesh(a.geometry,material);
    a.name=b.name='L3-flame';a.position.set(x,y+.31,z);b.position.copy(a.position);b.rotation.y=PI/2;
    root.add(a,b);
    const smoke=new THREE.Mesh(new THREE.PlaneGeometry(.48,.85),new THREE.ShaderMaterial({
      uniforms:{clock},transparent:true,depthWrite:false,side:THREE.DoubleSide,
      vertexShader:material.vertexShader,
      fragmentShader:`varying vec2 p;uniform float clock;void main(){float x=p.x-.5+sin(p.y*6.-clock*1.8)*.11;
        float a=exp(-x*x*33.)*sin(p.y*3.14159)*(.47+.45*sin(p.y*24.-clock*3.1));
        gl_FragColor=vec4(.49,.38,.30,a*.15);}`
    }));
    smoke.name='L3-smoke';smoke.position.set(x,y+.88,z);root.add(smoke);
  }

  function windowLattice(arch,opening,stone,wood,gilt,root) {
    const {X,box,place,panel}=arch, z0=opening.centre, y0=opening.bottom,y1=opening.top,a=opening.half;
    const g=new THREE.Group();g.name='L3-window-lightwell';root.add(g);
    const yaw=-PI/2, width=a*2, grille=X+.46;
    box('window-jamb',stone,X+.30,y0-.105,z0,1.54,.20,width+.45);
    box('window-jamb',stone,X+.34,y1+.105,z0,1.37,.21,width+.22);
    for(const side of [-1,1]){
      box('window-jamb',stone,X+.36,(y1+y0)*.5,z0+side*(a+.11),1.39,y1-y0,.22);
      box('window-frame',wood,grille,(y1+y0)*.5,z0+side*(a-.047),.19,y1-y0,.11);
      panel('window-gilding',gilt,.068,y1-y0,grille-.105,(y1+y0)*.5,z0+side*(a-.038),yaw);
    }
    for(const y of [y0+.05,y1-.05])box('window-frame',wood,grille,y,z0,.19,.11,width);
    // A real diagonal grille. Cut every bar against the opening rectangle.
    const pitch=.59, slope=1.16;
    for(const sign of [-1,1])for(let k=-10;k<16;k++){
      const c=y0+k*pitch;
      const b0=(y0+.055-c)/(slope*sign), b1=(y1-.055-c)/(slope*sign);
      const l=Math.max(-a+.055,Math.min(b0,b1)), r=Math.min(a-.055,Math.max(b0,b1));
      if(r-l<.02)continue;
      const u=(l+r)/2,h=c+slope*sign*u;
      const bar=new THREE.BoxGeometry(Math.hypot(r-l,slope*(r-l)),.092,.18).rotateZ(Math.atan(slope*sign));
      place('lattice',stone,bar,grille,h,z0+u,yaw);
    }
    // Set daylight behind the physical recess so it has brightness and depth
    // without exposing the palace's discarded exterior or an adjacent room.
    const back=new THREE.Mesh(new THREE.PlaneGeometry(width+.7,y1-y0+.72),
      new THREE.ShaderMaterial({side:THREE.DoubleSide,vertexShader:`varying vec2 p;
        void main(){p=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader:`varying vec2 p;void main(){
          vec3 c=mix(vec3(.86,.64,.34),vec3(1.,.92,.73),smoothstep(.06,.77,p.y));
          gl_FragColor=vec4(c,1.);}`}));
    back.position.set(X+1.26,(y0+y1)/2,z0);back.rotation.y=yaw;g.add(back);
    const rays=new THREE.ShaderMaterial({side:THREE.DoubleSide,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      vertexShader:`varying vec2 p;void main(){p=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:`varying vec2 p;void main(){
        float a=sin(p.x*3.14159)*pow(sin(p.y*3.14159),.6)*mix(.175,.015,p.y);
        gl_FragColor=vec4(1.,.68,.33,a);}`});
    for(let i=0;i<5;i++){
      const y=y0+.78+i*.29,u=z0+(i-2)*.36,drop=(y-.09)/.68;
      const ray=new THREE.BufferGeometry();
      ray.setAttribute('position',new THREE.Float32BufferAttribute([
        grille-.09,y,u-.080,grille-.09,y+.089,u+.082,
        grille-drop,.09,u+drop*.53+.29,grille-drop,.09,u+drop*.53-.29
      ],3));
      ray.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,1,1,0,1],2));
      ray.setIndex([0,1,2,0,2,3]);
      const light=new THREE.Mesh(ray,rays);light.name='L3-sunlight-rays';g.add(light);
    }
    return {pitch,slope};
  }
  // A single projected grille function gives the floor, wall and tabletop
  // the same sharp diamonds without allocating a dynamic shadow map.
  function sunlight(material,origin,opening,{pitch,slope}) {
    const old=material.onBeforeCompile;
    material.customProgramCacheKey=()=> 'L3-study-window-light';
    material.onBeforeCompile=function(shader,renderer){
      old.call(this,shader,renderer);
      shader.uniforms.studyOrigin={value:origin};
      shader.uniforms.studyWindow={value:new THREE.Vector4(opening.localX,opening.centre,opening.bottom,opening.top)};
      shader.uniforms.studyPattern={value:new THREE.Vector3(opening.half,pitch,slope)};
      const vary='varying vec3 vStudyWorld;';
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+vary)
        .replace('#include <project_vertex>',`
          vec4 studyPoint=vec4(transformed,1.);
          #ifdef USE_INSTANCING
          studyPoint=instanceMatrix*studyPoint;
          #endif
          vStudyWorld=(modelMatrix*studyPoint).xyz;
          #include <project_vertex>
        `);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+vary+`
        uniform vec3 studyOrigin;uniform vec4 studyWindow;uniform vec3 studyPattern;
      `).replace('#include <opaque_fragment>',`
        vec3 local=vStudyWorld-studyOrigin;
        float d=studyWindow.x-local.x;
        vec2 p=vec2(local.z-.53*d-studyWindow.y,local.y+.68*d-studyWindow.z);
        float edge=min(studyPattern.x-abs(p.x),min(p.y,studyWindow.w-studyWindow.z-p.y));
        vec2 grid=abs(fract((vec2(p.y)+vec2(-1.,1.)*p.x*studyPattern.z)/studyPattern.y+.5)-.5);
        float diamonds=smoothstep(.105,.225,min(grid.x,grid.y));
        float lightwell=smoothstep(-.03,.04,edge)*exp(-.055*max(0.,d))*step(.015,d);
        outgoingLight*=1.-.39*lightwell*(1.-diamonds);
        outgoingLight+=diffuseColor.rgb*vec3(1.73,.98,.47)*lightwell*diamonds;
        #include <opaque_fragment>
      `);
    };
  }
  async function study(room,doors,loadModel,signal,constrained) {
    const [atlas,roofImage,gltf]=await Promise.all([image(files.studyAtlas,signal),image(files.studyRoof,signal),loadModel(files.study,signal)]);
    signal.throwIfAborted();
    const parts=SinGreatLibrary.split(gltf,studyParts);
    // The cup and flame are welded in the upload. Clip away the static flame
    // above the cup opening while retaining the source bracket and bronze.
    const torchGeo=parts.torch.geometry, oldIndex=torchGeo.index.array, p=torchGeo.attributes.position;
    const cut=[];
    for(let i=0;i<oldIndex.length;i+=3){
      if((p.getY(oldIndex[i])+p.getY(oldIndex[i+1])+p.getY(oldIndex[i+2]))/3<=-.133)cut.push(oldIndex[i],oldIndex[i+1],oldIndex[i+2]);
    }
    torchGeo.setIndex(cut);
    for(const [id,part] of Object.entries(parts))partBase(part,['column','palm','vase','armillary'].includes(id)?0:-PI/2);
    const mat=parts.desk.material;
    mat.color.setHex(0xddcbc3);mat.roughness=.85;mat.metalness=.44;
    const root=new THREE.Group();root.name='L3-Scribes-Study';root.position.set(room.bbox.cx,0,room.bbox.cz);
    const arch=inwardArchitecture(room,'L3-',root),{X,Z,d,box,place,panel,flat,sides}=arch;
    const tex=(r,rep)=>canvasTexture(atlas,520,390,r,rep,constrained?616:880);
    const roof=(r,rep)=>canvasTexture(roofImage,545,273,r,rep,512);
    const stone=textured(tex([9,8,121,129],true),0xc8ae92,.84);
    const floor=textured(stone.map,0xa99079,.53,.058);
    const blue=textured(tex([135,85,348,129],true),0x9495ad,.73);
    const rosette=textured(tex([135,11,348,46]),0xc8b090,.66);
    const glyphs=textured(tex([10,143,244,163]),0xd1b38e,.85);
    const mural=textured(tex([13,174,245,312]),0xe5cfc0,.65);
    const carpet=textured(tex([267,145,511,311]),0xc8b6ac,.9);
    const wood=textured(roof([443,8,489,57],true),0x8d6e5a,.82);
    const beams=textured(roof([444,222,485,235],true),0x725544,.82);
    const gold=textured(roof([439,72,536,94]),0xcaa784,.66,.04);
    const opening={...aperture(room),localX:X+.46};
    const pattern=windowLattice(arch,opening,stone,beams,gold,root);
    const lightOrigin=new THREE.Vector3();
    for(const material of [stone,floor,mat,carpet,blue,rosette,mural])sunlight(material,lightOrigin,opening,pattern);
    for(const [i,side] of sides.entries()){
      const cuts=i===1?[{l:opening.centre-opening.half,r:opening.centre+opening.half,low:opening.bottom,high:opening.top}]:i===2?arch.doorsAt(side,doors):[];
      arch.wallWithCuts(side,'walls',stone,cuts);
      arch.bands(side,blue,cuts,.48,.91,3.8,'dado');
      arch.bands(side,rosette,cuts,1.08,.23,2.55,'dado-frieze');
      arch.bands(side,rosette,cuts,4.83,.42,2.60,'cornice');
      arch.bands(side,glyphs,cuts,4.48,.19,2.65,'inscriptions');
    }
    panel('mural',mural,4.85,2.82,-.63,3.04,-Z+.154,0);
    flat('floor',floor,X*2,Z*2,0,.013,0,X/1.57,Z/1.5);
    flat('rug',carpet,7.15,4.68,-.61,.025,.09);
    const h=room.height;
    for(let x=-X;x<X-.01;x+=2.5)for(let z=-Z;z<Z-.01;z+=2.32){
      const w=Math.min(2.5,X-x),l=Math.min(2.32,Z-z);
      flat('roof',wood,w,l,x+w/2,h-.055,z+l/2,1,1,false);
    }
    for(let x=-X;x<=X+.01;x+=2.5)box('roof-beams',beams,x,h-.21,0,.25,.41,2*Z,2.6);
    for(let z=-Z;z<Z+.15;z+=2.33)box('roof-beams',beams,0,h-.17,z,2*X,.33,.21,2.6);
    for(const z of [-Z+.21,Z-.21])box('roof-borders',beams,0,h-.27,z,2*X,.38,.38,2.7);
    const boxes=[], put=(id,x,z,y,w,h,l,rot=0,collision=true)=>{
      d.asset(id,parts[id],null,x,y,z,w,h,l,rot);
      if(collision){
        const side=Math.abs(Math.sin(rot))>.7;
        floorObstacle(room,boxes,x,z,side?l:w,side?w:l,y,y+h,'_studyProp');
      }
    };
    put('desk',-.62,-.75,.03,4.35,1.56,2.07);
    put('stool',-.60,1.16,.03,1.04,.71,.86);
    put('armillary',.74,-.91,1.185,1.20,1.41,1.16,.12,false);
    // One original shelf next to a repeated, shared instance along the left wall.
    for(const z of [-3.51,.87])put('shelf',-X+.61,z,.015,4.29,4.47,1.17,PI/2);
    put('shelf',X-.53,1.17,.015,2.63,3.70,.98,-PI/2);
    for(const [x,z] of [[-3.65,-Z+.62],[2.39,-Z+.62],[-X+.58,3.36],[X-.61,4.57]])
      put('column',x,z,.015,1.11,h-.30,1.11);
    put('palm',X-1.08,-5.63,.025,1.46,2.58,1.40,-.35);
    put('vase',X-1.03,3.28,.025,.85,1.19,.84,.14);
    const clock={value:0}, lamps=[];
    for(const x of [-4.80,3.55]){
      put('torch',x,-Z+.26,2.32,.70,.85,.45,0,false);
      firedTorch(root,x,2.93,-Z+.40,clock);
      lamps.push(localLight(root,0xffa04a,15,6.8,x,3.46,-Z+.73));
    }
    localLight(root,0xffddac,25,12,X-1.03,3.40,-3.38);
    localLight(root,0xffc894,18,14,-.75,4.55,1.91);
    d.flush();
    SinGreatLibrary.setLibraryExposure(root,.59);
    root.traverse(node=>{if(/^L3-roof/.test(node.name))node.userData.ceiling=true;});
    floorObstacle(room,boxes,X+.46,opening.centre,.22,opening.half*2,opening.bottom,opening.top,'_studyProp');
    if(atlas.close)atlas.close();
    if(roofImage.close)roofImage.close();
    return {root,boxes,warmup:SinGreatLibrary.geometryWarmup(root), lightOrigin,
      tick(t){clock.value=t;lamps.forEach((l,i)=>l.intensity=15+1.2*Math.sin(t*8.9+i*2.3));},
      dispose(){SinGreatLibrary.disposeResources(root);}
    };
  }

  function pointedCrown(path,u,r,spring,rise,direction) {
    const k=direction;
    path.bezierCurveTo(u-k*r*.94,spring+rise*.49,u-k*r*.46,spring+rise*.80,u,spring+rise);
    path.bezierCurveTo(u+k*r*.46,spring+rise*.80,u+k*r*.94,spring+rise*.49,u+k*r,spring);
  }
  function archHole(u,r,bottom,spring,rise) {
    const path=new THREE.Path();
    path.moveTo(u-r,bottom);path.lineTo(u-r,spring);
    pointedCrown(path,u,r,spring,rise,1);
    path.lineTo(u+r,bottom);path.closePath();
    return path;
  }
  function archRing(u,r,bottom,spring,rise,width) {
    const shape=new THREE.Shape();
    shape.moveTo(u-r-width,bottom);shape.lineTo(u-r-width,spring);
    pointedCrown(shape,u,r+width,spring,rise+width,1);
    shape.lineTo(u+r+width,bottom);shape.lineTo(u+r,bottom);
    shape.lineTo(u+r,spring);pointedCrown(shape,u,r,spring,rise,-1);
    shape.lineTo(u-r,bottom);shape.closePath();return shape;
  }
  function archInlay(u,r,bottom,spring,rise,width,repeat=2.1) {
    function line(radius,peak) {
      const p=new THREE.Path();
      p.moveTo(u-radius,bottom);p.lineTo(u-radius,spring);
      pointedCrown(p,u,radius,spring,peak,1);
      p.lineTo(u+radius,bottom);
      return p.getPoints(29);
    }
    const inner=line(r,rise),outer=line(r+width,rise+width);
    const pos=[],uv=[],indices=[];
    let distance=0;
    for(let i=0;i<inner.length;i++){
      if(i)distance+=inner[i].distanceTo(inner[i-1]);
      pos.push(inner[i].x,inner[i].y,0,outer[i].x,outer[i].y,0);
      uv.push(distance/repeat,0,distance/repeat,1);
      if(i){const j=2*i;indices.push(j-2,j,j-1,j-1,j,j+1);}
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    g.setIndex(indices);g.computeVertexNormals();return g;
  }
  function balconySpandrel(spans,r,spring,rise,half) {
    // Fit the surviving pieces of the original spandrel artwork between the
    // outer curves. UV boundaries follow the blue field outside its gold trim.
    const leftCurve=archHole(spans[0],r,spring-.1,spring,rise).curves[1];
    const edges=[
      [352,358,442,449,533,536], [352,358,441,450,532,536],
      [352,361,438,454,529,536], [352,367,433,458,524,536],
      [352,375,426,466,517,536], [352,384,416,476,507,536],
      [352,398,404,486,491,536]
    ];
    const sourceRows=[55,47,39,32,26,22,17];
    const x=[],uv=[],indices=[];
    const rows=30;
    for(let i=0;i<=rows;i++){
      const p=leftCurve.getPoint(i/rows);
      const j=Math.min(edges.length-2,Math.floor((p.y-spring)/rise*(edges.length-1)));
      const f=(p.y-spring)/rise*(edges.length-1)-j;
      const sy=THREE.MathUtils.lerp(sourceRows[j],sourceRows[j+1],f);
      const xRight=2*spans[0]-p.x;
      const offset=spans[1]-spans[0];
      const xs=[-half,p.x,xRight,p.x+offset,xRight+offset,half];
      xs.forEach((u,k)=>{
        x.push(u,p.y,0);
        uv.push((THREE.MathUtils.lerp(edges[j][k],edges[j+1][k],f)-352)/184,1-(sy-17)/38);
      });
      if(i)for(const k of [0,2,4]){
        const a=(i-1)*6+k,b=i*6+k;
        indices.push(a,a+1,b,a+1,b+1,b);
      }
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(x,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    g.setIndex(indices);g.computeVertexNormals();
    return g;
  }
  function curtainPanel(source,side) {
    const geometry=source.geometry,t=geometry.attributes;
    const p=[],n=[],uv=[],index=geometry.index;
    function vert(i){
      return [t.position.getX(i),t.position.getY(i),t.position.getZ(i),t.normal.getX(i),
        t.normal.getY(i),t.normal.getZ(i),t.uv.getX(i),t.uv.getY(i)];
    }
    for(let i=0;i<index.count;i+=3){
      const tri=[vert(index.getX(i)),vert(index.getX(i+1)),vert(index.getX(i+2))], clipped=[];
      for(let k=0;k<3;k++){
        const a=tri[k],b=tri[(k+1)%3],da=side*a[0]-.235,db=side*b[0]-.235;
        if(da>=0)clipped.push(a);
        if((da<0)!==(db<0)){
          const f=da/(da-db);
          clipped.push(a.map((x,j)=>x+(b[j]-x)*f));
        }
      }
      for(let k=1;k+1<clipped.length;k++)for(const v of [clipped[0],clipped[k],clipped[k+1]]){
        p.push(...v.slice(0,3));n.push(...v.slice(3,6));uv.push(...v.slice(6));
      }
    }
    const cloth=new THREE.BufferGeometry();
    cloth.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
    cloth.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));
    cloth.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    return {geometry:cloth,material:source.material};
  }
  async function king(room,doors,loadModel,signal,constrained) {
    const [atlas,roofImage,skyImage,throneAtlas,curtain,decor,columnModel]=await Promise.all([
      image(files.kingAtlas,signal),image(files.kingRoof,signal),image(files.sky,signal),image(files.throneAtlas,signal),
      loadModel(files.curtain,signal),loadModel(files.study,signal),loadModel(files.throneColumn,signal,true)
    ]);
    signal.throwIfAborted();
    const root=new THREE.Group();root.name='K5-Royal-Apartments';root.position.set(room.bbox.cx,0,room.bbox.cz);
    const arch=inwardArchitecture(room,'K5-',root),{X,Z,d,box,place,panel,flat,sides}=arch;
    const tex=(r,rep)=>canvasTexture(atlas,545,363,r,rep,constrained?768:1024);
    const roof=(r,rep)=>canvasTexture(roofImage,545,307,r,rep,900);
    const throne=(r,rep)=>canvasTexture(throneAtlas,545,409,r,rep,640);
    const marble=textured(tex([232,252,373,351],true),0xaaa4ae,.27,.08);
    const stone=textured(throne([7,66,126,132],true),0x9294aa,.63,.045);
    const ornament=textured(tex([226,170,378,185]),0xe0c6ad,.58,.10);
    const fauna=textured(tex([138,91,337,110]),0xe9d8c2,.59,.07);
    const cuneiform=textured(throne([254,8,535,29],true),0xffe4c5,.54,.09);
    const vine=textured(throne([255,57,518,75],true),0xf4dbbd,.60,.10);
    const gilt=new THREE.MeshStandardMaterial({color:0x9f683a,roughness:.40,metalness:.26});
    const plinth=textured(throne([138,7,186,65],true),0xa59b9c,.74,.035);
    const rose=textured(tex([240,126,275,163]),0xe9ceb0,.57,.07);
    const relief={
      moon:textured(tex([79,8,123,115]),0xe1c7ad,.65,.04),
      lionLeft:textured(throne([154,199,263,265]),0xd9c2a7,.61,.07),
      lionRight:textured(throne([420,199,539,265]),0xd9c2a7,.61,.07),
      court:textured(tex([113,126,184,163]),0xe2cdb1,.64,.05),
      procession:textured(tex([138,17,339,55]),0xd9c2a7,.64,.06)
    };
    const rug=textured(tex([11,250,217,352]),0xd8bfab,.87);
    const ceilingField=textured(roof([426,113,460,186],true),0x9b9ab2,.76,.025);
    const ceilingBand=textured(roof([43,14,246,33],true),0xc7aa86,.64,.065);
    const ceilingReliefs=[
      textured(roof([47,42,110,86]),0xccb9a7,.67,.06),
      textured(roof([435,44,498,86]),0xccb9a7,.67,.06),
      textured(roof([47,212,110,259]),0xccb9a7,.67,.06),
      textured(roof([435,212,498,259]),0xccb9a7,.67,.06)
    ];
    const medallionRim=textured(tex([323,228,389,269],true),0xae8c69,.74,.045);
    const medallion=textured(roof([185,67,359,240]),0xc4b5ab,.72,.05);
    for(const [i,side] of sides.entries()){
      const cuts=i===0||i===2?arch.doorsAt(side,doors):[];
      if(i===1)continue;
      arch.wallWithCuts(side,i===3?'king-mural-walls-west':'king-mural-walls-sides',stone,cuts);
      arch.bands(side,plinth,cuts,.32,.58,2.34,'dado');
      arch.bands(side,ornament,cuts,.70,.20,3.65,'border');
      arch.bands(side,fauna,cuts,5.57,.25,4.7,'frieze');
      arch.bands(side,cuneiform,cuts,5.30,.16,4.7,'lintel-script');
      const panels=i===3?[
        [-5.46,1.47,3.50,2.74,'moon'],[0,4.33,2.08,3.68,'court'],[5.46,1.47,3.50,2.74,'moon']
      ]:i===0?[
        [-7.35,3.49,2.04,3.33,'lionLeft'],[-.10,4.41,1.20,3.73,'procession'],[7.35,1.43,3.44,2.76,'moon']
      ]:[
        [-7.35,1.43,3.44,2.76,'moon'],[.10,4.41,1.20,3.73,'procession'],[7.35,3.49,2.04,3.33,'lionRight']
      ];
      for(const [u,w,h,y,key] of panels){
        if(cuts.some(c=>u+w/2+.12>c.l&&u-w/2-.12<c.r))continue;
        const face=(id,mat,width,height,at,yy,inset)=>{
          const [x,z]=side.face(at);
          panel(id,mat,width,height,x+Math.sin(side.yaw)*inset,yy,z+Math.cos(side.yaw)*inset,side.yaw);
        };
        face('mural-frames',gilt,w+.11,h+.11,u,y,.144);
        face('mural-'+key,relief[key],w,h,u,y,.148);
      }
    }
    flat('king-floor',marble,X*2,Z*2,0,.018,0,5.6,4.7);
    flat('royal-rug',rug,11.45,6.00,2.60,.03,1.91);
    const h=room.height;
    flat('king-ceiling',ceilingField,X*2,Z*2,0,h-.045,0,11,8,false);
    for(const [x,z,depth,width] of [[X-.28,Z-.26,.26,.38],[X-1.33,Z-1.28,.17,.22],[X-3.63,Z-2.86,.22,.20]]){
      const soffit=h-.045-depth;
      for(const sign of [-1,1]){
        box('coffer-beams',stone,sign*x,soffit+depth/2,0,width,depth,z*2+width,3.4);
        box('coffer-beams',stone,0,soffit+depth/2,sign*z,x*2-width,depth,width,3.4);
        place('coffer-inlay',ceilingBand,sheet(z*2,width*.91,z*.38,1).rotateX(PI/2),sign*x,soffit-.003,0,sign*PI/2);
        flat('coffer-inlay',ceilingBand,x*2-width,width*.91,0,soffit-.003,sign*z,x*.39,1,false);
      }
    }
    let corner=0;
    for(const x of [-8.96,8.96])for(const z of [-5.87,5.87]){
      flat('coffer-corner-frames',gilt,1.64,1.14,x,h-.113,z,1,1,false);
      flat('coffer-corner-relief',ceilingReliefs[corner++],1.60,1.10,x,h-.116,z,1,1,false);
    }
    for(const radius of [3.62,3.35,3.10]){
      const g=new THREE.TorusGeometry(radius,.07,6,72).rotateX(PI/2);
      place('coffer-rings',medallionRim,g,0,h-.42+(3.62-radius)*.13,0);
    }
    const disk=new THREE.CircleGeometry(3.07,72).rotateX(PI/2);
    place('coffer-astrolabe',medallion,disk,0,h-.285,0);
    const e=sides[1], opening=aperture(room), w=opening.half;
    const spans=[-2.46,2.46],r=2.22,spring=3.16,rise=2.19;
    for(const [l,q] of [[-Z,-w],[w,Z]]) arch.wallWithCuts(
      {...e,half:(q-l)/2,face:t=>e.face(t+(l+q)/2)},'balcony-wall-returns',stone,[]);
    const holes=spans.map(u=>archHole(u,r,opening.bottom,spring,rise));
    const surround=extrusion(shapePanel(-w,w,h,holes),.73,2.28);
    place('balcony-arches',stone,surround,X+.22,0,0,-PI/2);
    const spandrel=textured(tex([352,17,536,55]),0xe7d7c5,.64,.04);
    place('balcony-spandrel',spandrel,balconySpandrel(spans,r+.218,spring,rise+.218,w),X-.519,0,0,-PI/2);
    for(const u of spans){
      place('balcony-mouldings',gilt,extrusion(archRing(u,r,opening.bottom,spring,rise,.219),.145,1.32),
        X-.506,0,0,-PI/2);
      place('balcony-arch-inlay',cuneiform,archInlay(u,r+.033,opening.bottom,spring,rise+.033,.153,2.83),
        X-.657,0,0,-PI/2);
    }
    for(const [y,height,material] of [[5.69,.15,vine],[5.88,.181,fauna]]){
      box('balcony-cornice',gilt,X-.57,y,0,.19,height+.035,10.92);
      arch.strip(e,'balcony-crown',material,-5.43,5.43,y,height,3.62,.65);
    }
    // The throne hall's authored lapis column belongs beside the curtains.
    // The shared spring of the two arches keeps its thinner masonry pier.
    columnModel.scene.updateMatrixWorld(true);
    let columnSource;
    columnModel.scene.traverse(node=>{if(node.isMesh)columnSource=node;});
    if(!columnSource)throw Error('Throne hall pillar geometry is missing');
    const royalColumn={geometry:columnSource.geometry.applyMatrix4(columnSource.matrixWorld),material:columnSource.material};
    partBase(royalColumn);
    for(const z of [-5.62,5.62])d.asset('throne-columns',royalColumn,null,X-.62,.03,z,.93,h-.46,.93,0);
    for(const z of [-6.28,6.28])d.asset('throne-columns',royalColumn,null,-X+.60,.03,z,.92,h-.38,.92,0);
    const columnLapis=textured(tex([415,177,438,226]),0xc6b3af,.48,.09);
    const acanthus=textured(tex([405,128,445,156]),0xf5dbb7,.50,.15);
    place('balcony-centre-pier',columnLapis,new THREE.CylinderGeometry(.213,.24,2.56,28),X-.38,1.67,0);
    for(const [radius,y,width] of [[.275,.40,.062],[.234,2.93,.042],[.257,3.02,.047],[.342,3.29,.055]]){
      place('balcony-pier-rings',gilt,new THREE.CylinderGeometry(radius,radius,width,28),X-.38,y,0);
    }
    place('balcony-capital',acanthus,new THREE.LatheGeometry([
      [.234,0],[.26,.06],[.278,.14],[.329,.23],[.338,.275]
    ].map(([radius,y])=>new THREE.Vector2(radius,y)),24),X-.38,3.005,0);
    box('balcony-bases',plinth,X-.37,.20,0,.62,.40,.62,1.1);
    box('balcony-bases',gilt,X-.38,3.34,0,.72,.091,.72);
    box('balcony-threshold',plinth,X+.61,.13,0,1.82,.26,10.59,1.84);
    // The handrail, piers and individually turned balusters form an open
    // stone balustrade. The architectural wall stops below its openings.
    box('balcony-parapet',stone,X+.14,.25,0,.43,.21,10.62,1.7);
    box('balcony-parapet',stone,X+.14,.99,0,.49,.16,10.62,1.7);
    box('balcony-rail-cap',gilt,X+.14,1.086,0,.56,.065,10.63);
    box('balcony-rail-cap',gilt,X+.14,.351,0,.50,.035,10.63);
    for(const y of [.272,1.005])arch.strip(e,'balcony-rail-relief',vine,-5.28,5.28,y,.091,1.66,.114);
    const turned=[[.106,0],[.109,.048],[.077,.081],[.055,.15],[.082,.22],[.112,.31],
      [.105,.385],[.058,.45],[.077,.507],[.106,.55]].map(([a,b])=>new THREE.Vector2(a,b));
    const baluster=new THREE.LatheGeometry(turned,12);
    const post={geometry:baluster,material:gilt};
    partBase(post);
    for(let z=-5.02;z<=5.03;z+=.363){
      if(Math.abs(z)<.19)continue;
      d.asset('balcony-balusters',post,null,X+.13,.35,z,.224,.56,.224);
    }
    for(const z of [-5.24,0,5.24]){
      box('balcony-rail-post',stone,X+.13,.55,z,.55,.92,.36,1.4);
      box('balcony-rail-post-cap',gilt,X+.13,1.05,z,.62,.14,.44);
      panel('balcony-rail-post-inlay',rose,.28,.28,X-.151,.69,z,-PI/2);
      panel('balcony-rail-post-inlay',vine,.28,.085,X-.151,.44,z,-PI/2);
    }
    const skyMap=canvasTexture(skyImage,2172,724,[0,0,2172,724],false,constrained?1536:2048);
    // Fit a wide, shallow panoramic surface immediately past the masonry.
    // Its curvature provides a perspective shift from the two openings
    // and the short setback prevents distant palace walls crossing the view.
    const skyMat=new THREE.MeshBasicMaterial({map:skyMap,side:THREE.DoubleSide,color:0xd1afa9});
    const skyGeo=new THREE.PlaneGeometry(34,34/3,52,1);
    const pixels=skyGeo.attributes.position;
    for(let i=0;i<pixels.count;i++){
      const z=pixels.getX(i), y=pixels.getY(i), arc=z/17;
      pixels.setXYZ(i,X+1.26+.85*(1-arc*arc),y+2.37,z);
    }
    skyGeo.computeVertexNormals();
    const panorama=new THREE.Mesh(skyGeo,skyMat);panorama.name='K5-blood-sky-panorama';
    root.add(panorama);
    let source;
    curtain.scene.traverse(node=>{if(node.isMesh)source=node;});
    if(!source)throw Error('K5 curtain geometry is missing');
    source.material.color.setHex(0xb4b2c8);
    source.material.roughness=.86;source.material.metalness=.13;
    for(const sign of [-1,1]){
      const part=curtainPanel(source,sign);
      partBase(part);
      d.asset(sign<0?'balcony-curtain-left':'balcony-curtain-right',part,null,X-.62,.22,sign*4.86,1.43,5.41,.72,-PI/2);
    }
    source.geometry.dispose();
    // Use the already authored palace props for the requested furnishings
    // absent from the original K5 kit. No room geometry is duplicated.
    const furnishings=SinGreatLibrary.split(decor,studyParts);
    const retained=new Set(['shelf','armillary']);
    for(const [key,part] of Object.entries(furnishings)){
      if(retained.has(key))partBase(part,key==='armillary'?0:-PI/2);
      else part.geometry.dispose();
    }
    const extra=(name,key,x,z,y,width,height,depth,angle)=>
      d.asset(name,furnishings[key],null,x,y,z,width,height,depth,angle);
    extra('cabinet','shelf',8.93,-5.87,.027,2.39,1.58,1.04,-PI/2);
    extra('armillary','armillary',8.83,-5.87,1.594,1.48,1.65,1.40,-.28);

    // Keep the sitting group low enough to leave the balustrade and the
    // shared balcony column visible from the palace entrance.
    const wood=new THREE.MeshStandardMaterial({color:0x4d2e24,roughness:.43});
    const velvet=new THREE.MeshStandardMaterial({color:0x16294f,roughness:.91});
    const furniture=(name,x,z,yaw)=>{
      const host=new THREE.Matrix4().makeRotationY(yaw).setPosition(x,.023,z);
      return (mat,w,height,depth,rx,y,rz)=>d.surface(name,mat,new THREE.BoxGeometry(w,height,depth),host,rx,y,rz);
    };
    const seatPositions=[[8.76,-2.03,-1.02,1.16],[8.75,2.08,-2.06,1.42]];
    for(const [x,z,yaw,width] of seatPositions){
      const put=furniture('balcony-seats',x,z,yaw);
      put(wood,width,.16,.90,0,.42,0);
      put(velvet,width-.12,.15,.75,0,.555,.035);
      put(wood,width-.04,.54,.11,0,.78,-.41);
      put(velvet,width-.14,.45,.12,0,.818,-.339);
      put(gilt,width+.03,.041,.139,0,1.063,-.406);
      for(const dx of [-width/2+.09,width/2-.09]){
        for(const dz of [-.36,.36])put(wood,.086,.37,.086,dx,.191,dz);
        put(wood,.084,.25,.084,dx,.66,.31);
        put(gilt,.118,.055,.81,dx,.785,.018);
        put(velvet,.098,.075,.69,dx,.825,.023);
      }
    }
    const table=furniture('balcony-table',8.05,.025,-PI/2);
    table(wood,1.69,.14,.76,0,.48,0);
    table(gilt,1.72,.039,.79,0,.558,0);
    table(marble,1.62,.023,.69,0,.588,0);
    for(const x of [-.708,.708])for(const z of [-.27,.27])table(wood,.087,.43,.087,x,.229,z);
    table(vine,1.54,.084,.002,0,.475,.381);

    localLight(root,0xffbe84,47,13.5,-6.25,3.95,-.63);
    localLight(root,0xffd0a0,33,12,0,3.75,.15);
    localLight(root,0xff9d66,23,6,X-1.25,2.9,-3.24);
    localLight(root,0xcbbcfd,9,10,4.2,3.7,3.55);
    d.flush();
    root.traverse(node=>{if(/^K5-(king-ceiling|coffer)/.test(node.name))node.userData.ceiling=true;});
    const boxes=[];
    floorObstacle(room,boxes,X-.12,0,.66,10.72,0,1.1,'_k5Prop');
    for(const z of [-5.13,0,5.13])floorObstacle(room,boxes,X-.42,z,.84,.86,0,5.40,'_k5Prop');
    for(const z of [-5.62,5.62])floorObstacle(room,boxes,X-.62,z,.93,.93,0,h-.40,'_k5Prop');
    for(const z of [-6.28,6.28])floorObstacle(room,boxes,-X+.60,z,.92,.92,0,h-.35,'_k5Prop');
    for(const z of [-4.84,4.84])floorObstacle(room,boxes,X-.79,z,.50,.63,.2,5.42,'_k5Prop');
    floorObstacle(room,boxes,8.05,.025,.79,1.72,0,.63,'_k5Prop');
    for(const [x,z,yaw,w] of seatPositions){
      const a=Math.abs(Math.cos(yaw)),b=Math.abs(Math.sin(yaw));
      floorObstacle(room,boxes,x,z,w*a+.90*b,w*b+.90*a,0,1.11,'_k5Prop');
    }
    floorObstacle(room,boxes,8.93,-5.87,1.04,2.39,0,1.6,'_k5Prop');
    for(const img of [atlas,roofImage,skyImage,throneAtlas])if(img.close)img.close();
    return {root,boxes,warmup:SinGreatLibrary.geometryWarmup(root),dispose(){SinGreatLibrary.disposeResources(root);}};
  }

  window.SinPrivateRooms={aperture,study,king,studyExpected};
})();
