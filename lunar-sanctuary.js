/* Moon sanctuary dressing, inside the original T4 walls and openings. */
(function () {
  'use strict';

  const furniture = 'assets/اثاث الحرم المقدس.glb';
  const imageFiles = ['assets/نقوش الحرم المقدس.JPG', 'assets/سقف الحرم المقدم.JPG', 'assets/ارضية الحرم المقدس.JPG'];
  // The export has one indexed primitive. These are its six position-welded
  // islands. Keep the entire shrine together, including the statue and steps.
  const components = { 37321: 'shrine', 8689: 'censer', 5851: 'banner', 5596: 'brazier', 5466: 'column', 856: 'staticSmoke' };
  const expected = ['shrine', 'column', 'banner', 'censer', 'brazier', 'walls', 'priest-mural', 'moon-mural',
    'sandstone-floor', 'moon-floor', 'ceiling-fields', 'ceiling-beams', 'ceiling-recess', 'ceiling-moon',
    'flames', 'incense', 'moonlight'].map(name => 'T4-' + name);

  const shrineHeight = 8.85;
  const shrineDepth = .2100348 / .5642434 * shrineHeight;
  const shrineWidth = .5931148 / .5642434 * shrineHeight;
  // Stone levels measured on the center of the original GLB treads.
  const treads = [[.002, .032, .515], [.029, .062, .505], [.055, .094, .495], [.088, .111, .477]];
  function shrinePlacement(room) {
    return { front: room.bbox.x1 - .065 - shrineDepth, end: room.bbox.x1 - .065, axis: room.bbox.cz };
  }

  function stairs(room) {
    const { front, end, axis } = shrinePlacement(room);
    return treads.map(([run, rise, halfWidth]) => ({
      minx: front + run * shrineHeight, maxx: end, miny: 0, maxy: rise * shrineHeight,
      minz: axis - halfWidth * shrineHeight, maxz: axis + halfWidth * shrineHeight, _wing: true
    }));
  }

  function treadHeight(boxes, x, z) {
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      if (x >= b.minx && x <= b.maxx && z >= b.minz && z <= b.maxz) return b.maxy;
    }
    return 0;
  }

  function crop(source, w, h, [x0, y0, x1, y1], limit, repeat = false) {
    const img = source.image;
    const sx = img.width / w, sy = img.height / h;
    const width = (x1 - x0) * sx, height = (y1 - y0) * sy;
    const scale = Math.min(1, limit / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext('2d').drawImage(img, x0 * sx, y0 * sy, width, height, 0, 0, canvas.width, canvas.height);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  function wallSheet(width, height, tiling) {
    const g = new THREE.PlaneGeometry(width, height);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * width / tiling, uv.getY(i) * height / tiling);
    return g;
  }

  // Project the photographed floor roundel back onto a regular disc. The
  // center star and the near/far rims determine the perspective denominator.
  function floorProjection(x, z) {
    const t = -x, q = 1 - .4234 * t;
    return [(166.5 + 124.1 * z / q - 27) / 279, 1 - ((315 - 87.83 * t) / q - 281) / 115];
  }

  function circle(radius, radial, down, projection) {
    const g = new THREE.RingGeometry(0, radius, 96, radial);
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / radius;
      const z = pos.getY(i) / radius * (down ? 1 : -1);
      uv.setXY(i, ...projection(x, z));
    }
    return g.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
  }

  function ringGeometry(inner, outer, lower, upper) {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outer, 0, Math.PI * 2);
    const hole = new THREE.Path();
    hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    return new THREE.ExtrudeGeometry(shape, { depth: upper - lower, bevelEnabled: false, curveSegments: 48 })
      .rotateX(-Math.PI / 2).translate(0, lower, 0);
  }

  function trimFlame(part) {
    const g = part.geometry, index = g.index.array, y = g.attributes.position;
    const bowl = [];
    // The baked flame is connected to the bowl; retain the sculpted lip and
    // remove the tall flame triangles above the point where it meets the rim.
    for (let i = 0; i < index.length; i += 3) {
      if (y.getY(index[i]) <= .246 && y.getY(index[i + 1]) <= .246 && y.getY(index[i + 2]) <= .246) {
        bowl.push(index[i], index[i + 1], index[i + 2]);
      }
    }
    g.setIndex(bowl);
  }

  function prepParts(parts, constrained) {
    trimFlame(parts.brazier);
    parts.staticSmoke.geometry.dispose();
    delete parts.staticSmoke;
    for (const [name, part] of Object.entries(parts)) {
      const geo = part.geometry;
      if (name === 'shrine') geo.rotateY(Math.PI);
      geo.computeBoundingBox();
      const center = geo.boundingBox.getCenter(new THREE.Vector3());
      let top = geo.boundingBox.max.y;
      if (name === 'brazier') {
        const pos = geo.attributes.position, index = geo.index;
        top = -Infinity;
        for (let i = 0; i < index.count; i++) top = Math.max(top, pos.getY(index.getX(i)));
      }
      part.size = geo.boundingBox.getSize(new THREE.Vector3());
      part.size.y = top - geo.boundingBox.min.y;
      geo.translate(-center.x, -geo.boundingBox.min.y, -center.z);
    }
    const mat = parts.shrine.material;
    mat.name = 'T4 original GLB PBR';
    // Keep the native RGB/normal/roughness/metallic maps. A small diffuse
    // component keeps the textured bronze and stone readable without an IBL.
    mat.metalness = .76;
    mat.roughness = .93;
    for (const map of new Set([mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap])) {
      if (!map) continue;
      if (constrained && window.SinDevice) SinDevice.capTexture(map, 1024);
      map.anisotropy = 4;
    }
  }

  const effectVertex = `
    varying vec2 tex; varying float phase;
    void main() {
      tex=uv; phase=position.x*.91+position.z*1.41;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
    }
  `;

  function effect(root, name, geometry, clock, fragment, additive, order, color) {
    const m = new THREE.ShaderMaterial({
      uniforms: { clock, tint: { value: new THREE.Color(color) } },
      vertexShader: effectVertex, fragmentShader: fragment, transparent: true, depthWrite: false,
      toneMapped: false, side: THREE.DoubleSide, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    const mesh = new THREE.Mesh(geometry, m);
    mesh.name = 'T4-' + name;
    mesh.renderOrder = order;
    root.add(mesh);
    return mesh;
  }

  function cardField(sources) {
    const pos = [], uv = [], index = [];
    for (const [x, y, z, width, height] of sources) for (const angle of [.45, 1.98]) {
      const dx = Math.cos(angle) * width / 2, dz = Math.sin(angle) * width / 2;
      const start = pos.length / 3;
      pos.push(x - dx,y,z - dz, x + dx,y,z + dz, x - dx,y + height,z - dz, x + dx,y + height,z + dz);
      uv.push(0,0,1,0,0,1,1,1);
      index.push(start,start+1,start+2,start+1,start+3,start+2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    return g;
  }

  function addEffects(root, blue, amber, incense, clock, ceiling, constrained) {
    const flame = `
      uniform float clock; uniform vec3 tint; varying vec2 tex; varying float phase;
      void main() {
        float y=tex.y,t=clock+phase;
        float x=abs(tex.x-.5 + .115*y*sin(5.2*t+y*6.8));
        float w=.31*pow(1.-y,.85);
        float foot=smoothstep(.0,.12,y);
        float body=1.-smoothstep(w*.30,w+.035,x);
        float crest=(1.-smoothstep(w*.13,w*.62+.024,abs(tex.x-.47-.155*y*sin(t*6.1-y*7.))))*.54;
        float core=(1.-smoothstep(w*.10,w*.69,x))*(1.-smoothstep(.16,.62,y));
        gl_FragColor=vec4(mix(tint,vec3(1.,.93,.71),core*.86),max(body,crest)*foot*(1.-smoothstep(.64,1.,y))*(.74+.12*sin(t*6.)));
        #include <colorspace_fragment>
      }
    `;
    effect(root, 'flames', cardField(blue), clock, flame, true, 5, 0x4291ff);
    effect(root, 'amber-flames', cardField(amber), clock, flame, true, 5, 0xff6815);
    effect(root, 'incense', cardField(incense), clock, `
      uniform float clock; uniform vec3 tint; varying vec2 tex; varying float phase;
      float hash(vec2 p){return fract(sin(dot(p,vec2(125.7,72.3)))*43758.5453);}
      float noise(vec2 p){
        vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);
      }
      void main(){
        float y=tex.y, t=clock*.41+phase;
        float bend=(.11*sin(9.*y-t)+.047*sin(21.*y-t*1.3))*smoothstep(.03,.65,y);
        float d=abs(tex.x-.5-bend), r=mix(.036,.38,y);
        vec2 p=vec2((tex.x-bend)*7.5,y*9.-t);
        float n=noise(p)*.67+noise(p*2.17)*.33;
        float a=(1.-smoothstep(r*.15,r,d))*smoothstep(.28,.77,n)*smoothstep(0.,.08,y)*(1.-smoothstep(.42,1.,y));
        gl_FragColor=vec4(tint,a*.66);
        #include <colorspace_fragment>
      }
    `, false, 6, 0xa5b5d4);
    const rays = [];
    const width = constrained ? .42 : .56;
    for (const shift of [-.69, 0, .69]) {
      const g = new THREE.PlaneGeometry(width, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const u = g.attributes.uv.getX(i) - .5, v = g.attributes.uv.getY(i);
        p.setXYZ(i, THREE.MathUtils.lerp(7.6, 3.0, v) + u * .6,
          THREE.MathUtils.lerp(3.25, ceiling, v), shift * (1.45 - .45 * v) + u * width * (3.8 - 2.8 * v));
      }
      rays.push(g);
    }
    const g = new THREE.BufferGeometry();
    const p = [], uv = [], idx = [];
    for (const ray of rays) {
      const base = p.length / 3;
      p.push(...ray.attributes.position.array); uv.push(...ray.attributes.uv.array);
      for (const i of ray.index.array) idx.push(base + i);
      ray.dispose();
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    effect(root, 'moonlight', g, clock, `
      uniform vec3 tint; varying vec2 tex;
      void main(){
        float edge=pow(max(0.,sin(tex.x*3.14159)),2.1);
        float a=edge*smoothstep(.08,.81,tex.y)*(1.-smoothstep(.93,1.,tex.y));
        gl_FragColor=vec4(tint,a*.17);
        #include <colorspace_fragment>
      }
    `, true, 4, 0x7094ff).userData.ceiling = true;
  }

  function assemble(room, doors, parts, maps, constrained, root) {
    const { cx, cz, x0, x1, z0, z1 } = room.bbox, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2, h = room.height;
    const draw = SinGreatLibrary.builder(root, 'T4-');
    const [art, roof, flooring] = maps;
    const textures = [];
    const max = constrained ? 768 : 1536;
    const atlas = (rect, repeat) => makeMap(art, 600, 400, rect, repeat);
    const ceiling = (rect, repeat) => makeMap(roof, 700, 394, rect, repeat);
    const floor = (rect, repeat) => makeMap(flooring, 400, 400, rect, repeat);
    function makeMap(t, w, h, rect, repeat) {
      const mapped = crop(t,w,h,rect,max,repeat);
      textures.push(mapped);
      return mapped;
    }
    const material = (map,color,roughness,bump=0) => new THREE.MeshStandardMaterial({
      map,color,roughness,metalness:.04,bumpMap:!constrained&&bump?map:null,bumpScale:bump
    });
    const sandstone = material(atlas([453,330,513,387],true),0xcdb69f,.83,.026);
    const glaze = material(atlas([386,330,442,387],true),0xd0c9cf,.66,.016);
    const goldTrim = material(atlas([386,191,590,205],true),0xdfcbb4,.71);
    const roses = material(atlas([386,214,590,231],true),0xe9d1b3,.68);
    const priests = material(atlas([7,8,175,150]),0xe2cbbb,.73,.023);
    const lunar = material(atlas([423,9,592,151]),0xe2ccbe,.73,.023);
    const floorStone = material(floor([76,1,324,398],true),0xe0cbb9,.64,.032);
    const border = material(floor([20,4,59,396],true),0xebd6b8,.6);
    const inlay = material(atlas([27,281,306,396]),0xf8e5c8,.61,.018);
    const roofStone = material(sandstone.map,0xae9a8c,.86,.019);
    const crown = material(ceiling([214,28,489,53],true),0xe0c7ae,.74);
    const moon = material(ceiling([216,63,485,321]),0xbac9f3,.69);
    const ember = new THREE.MeshBasicMaterial({ color:0xffbe7c, toneMapped:true });
    moon.emissiveMap = moon.map; moon.emissive.setHex(0x4f70da); moon.emissiveIntensity = .31;

    const box = (name,mat,x,y,z,w,dY,d,tile) => draw.box(name,mat,null,x,y,z,w,dY,d,tile);
    const surface = (name,mat,g,x,y,z,angle) => draw.surface(name,mat,g,null,x,y,z,angle);
    const plate = (name,mat,w,height,x,y,z,angle,tile) =>
      surface(name,mat,tile?wallSheet(w,height,tile):new THREE.PlaneGeometry(w,height),x,y,z,angle);

    const floorUV = (width, depth, u, v) => {
      const g = new THREE.PlaneGeometry(width,depth).rotateX(-Math.PI/2);
      const uv = g.attributes.uv;
      for(let i=0;i<uv.count;i++) uv.setXY(i,uv.getX(i)*u,uv.getY(i)*v);
      return g;
    };
    surface('sandstone-floor',floorStone,floorUV(hx*2,hz*2,hx*2/3.65,hz*2/5.76),0,.009,0);
    for (const sign of [-1,1]) {
      surface('floor-trim',border,floorUV(.34,hx*2,1,hx*2/5.8),0,.014,sign*(hz-.79),Math.PI/2);
    }
    surface('moon-floor',inlay,circle(5.62,15,false,floorProjection),.04,.015,0);

    // Split the two walls at the real portal rectangles. The palace shell and
    // its baked collision continue to close the other sides of the room.
    const walls = [
      { axis:'x', fixed:-hx+.021, width:hz, angle:Math.PI/2 },
      { axis:'x', fixed:hx-.021, width:hz, angle:-Math.PI/2 },
      { axis:'z', fixed:-hz+.021, width:hx, angle:0 },
      { axis:'z', fixed:hz-.021, width:hx, angle:Math.PI }
    ];
    for (const wall of walls) {
      const { axis,fixed,width,angle } = wall;
      const door = doors.find(d => d.axis===axis && Math.sign((axis==='x' ? d.x-cx : d.z-cz))===Math.sign(fixed));
      const center = door ? (axis==='x' ? door.z-cz : door.x-cx) : 0;
      const half = door ? door.width/2 + .025 : 0;
      const wallPlate = (name,mat,left,right,bottom,top,offset=0,tile) => {
        const a = (left+right)/2, y=(bottom+top)/2, b=fixed-Math.sign(fixed)*offset;
        plate(name,mat,right-left,top-bottom,axis==='x'?b:a,y,axis==='x'?a:b,angle,tile);
      };
      const runs = door ? [[-width,center-half],[center+half,width]] : [[-width,width]];
      for (const [left,right] of runs) {
        wallPlate('walls',sandstone,left,right,0,h,0,2.35);
        wallPlate('wall-glazed-dado',glaze,left,right,.10,1.56,.016,2.25);
        wallPlate('wall-rosettes',roses,left,right,1.56,1.91,.022,4.2);
      }
      if (door) {
        wallPlate('walls',sandstone,center-half,center+half,door.height,h,0,2.35);
        wallPlate('portal-lintel',roses,center-half,center+half,door.height+.16,door.height+.54,.027,4.2);
      }
      wallPlate('wall-crown',goldTrim,-width,width,h-1.26,h-.86,.025,5.6);
      if (axis==='x' && fixed>0) wallPlate('shrine-backwall',glaze,-6.75,6.75,.1,8.96,.029,2.35);
      if (axis==='z') for (const u of [-6.6,6.1]) {
        const left=u-2.76,right=u+2.76;
        wallPlate('mural-frames',sandstone,left-.25,right+.25,1.94,7.07,.13,1.75);
        const edge = .21;
        wallPlate('mural-borders',goldTrim,left-edge,right+edge,1.96,2.15,.146,4.05);
        wallPlate('mural-borders',goldTrim,left-edge,right+edge,6.86,7.07,.146,4.05);
        wallPlate(fixed<0?'priest-mural':'moon-mural',fixed<0?priests:lunar,left,right,2.15,6.86,.145);
      }
    }

    const ceilingY = h-.39, recessX=3.0, outer=4.28, radius=3.61;
    const beamBottom = h-.99, beamHeight = ceilingY-beamBottom;
    const col = parts.column.size;
    const beamRows = [
      { z:5.50, columnScale:.72 },
      { z:8.85, columnScale:.64 }
    ];
    const shape = new THREE.Shape();
    shape.moveTo(-hx,-hz); shape.lineTo(hx,-hz); shape.lineTo(hx,hz); shape.lineTo(-hx,hz); shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(recessX,0,outer,0,Math.PI*2,true);
    shape.holes.push(hole);
    const field = new THREE.ShapeGeometry(shape,48).rotateX(Math.PI/2);
    const pp = field.attributes.position, uv = field.attributes.uv;
    for(let i=0;i<uv.count;i++) uv.setXY(i,pp.getX(i)/2.5,pp.getZ(i)/2.5);
    surface('ceiling-fields',roofStone,field,0,ceilingY,0);
    surface('ceiling-recess',sandstone,ringGeometry(radius,outer,ceilingY-.24,h-.013),recessX,0,0);
    surface('ceiling-recess',glaze,ringGeometry(3.78,4.04,ceilingY-.33,ceilingY-.225),recessX,0,0);
    surface('ceiling-recess',roses,ringGeometry(3.61,3.74,ceilingY-.29,ceilingY-.205),recessX,0,0);
    surface('ceiling-moon',moon,circle(radius+.013,1,true,(x,z)=>[.5+z*.468,.5+x*.470]),recessX,h-.026,0);
    for (const sign of [-1,1]) {
      for (const x of [-6.75, 4.6]) {
        const wall = sign*(hz-.11);
        box('ceiling-lamp-frames',sandstone,x,8.39,wall,.64,.93,.23);
        box('ceiling-lamp-fixtures',ember,x,8.42,wall-sign*.13,.25,.51,.04);
        box('ceiling-lamp-frames',crown,x,8.10,wall-sign*.17,.56,.12,.29);
      }
      for (const { z, columnScale } of beamRows) {
        const width = col.z * beamBottom / col.y * columnScale + .16;
        box('ceiling-beams',roofStone,0,beamBottom+beamHeight/2,z*sign,hx*2,beamHeight,width,2.25);
        for (const edge of [-1,1]) {
          box('ceiling-friezes',crown,0,beamBottom+.17,z*sign+edge*(width/2+.006),hx*2,.26,.022,6.4);
        }
      }
      for (const x of [-11.59,-7.25,7.81,11.56]) {
        box('ceiling-beams',roofStone,x,beamBottom+beamHeight/2,sign*7.18,.64,beamHeight,3.35,2.4);
      }
      box('ceiling-beams',roofStone,sign*11.6,beamBottom+beamHeight/2,0,.79,beamHeight,10.33,2.4);
    }

    const boxes=[], stairBoxes=stairs(room), blue=[], amber=[], incense=[];
    const clock={ value:0 }, localLights=[];
    function obstacle(x,z,w,d,y,top) {
      boxes.push({ minx:cx+x-w/2,maxx:cx+x+w/2,minz:cz+z-d/2,maxz:cz+z+d/2,miny:y,maxy:top,
        _wing:true,_lunarSanctuary:true });
    }
    function asset(name,x,y,z,height,angle=0,widthScale=1) {
      const part = parts[name], s=height/part.size.y;
      draw.asset(name,part,null,x,y,z,part.size.x*s*widthScale,height,part.size.z*s*widthScale,angle);
    }
    const location = shrinePlacement(room);
    const front = location.front-cx;
    draw.asset('shrine',parts.shrine,null,front+shrineDepth/2,0,0,shrineDepth,shrineHeight,shrineWidth);
    // Low first risers are walked via floorAt. The decorated altar is a solid
    // object above the upper tread; the side paths remain on the room floor.
    obstacle((front+.134*shrineHeight+hx)/2,0,hx-front-.134*shrineHeight-.055,shrineWidth*.80,.96,8.88);

    for (const side of [-1,1]) {
      const [inner, outer] = beamRows;
      for (const [x, row] of [[-9.20, outer], [-.89, outer], [7.42, inner]]) {
        asset('column',x,0,side*row.z,beamBottom,0,row.columnScale);
        obstacle(x,side*row.z,1.46,1.41,0,beamBottom);
      }
      asset('banner',1.42,5.34,side*5.43,3.47,Math.PI);
      asset('censer',-.14,0,side*5.68,1.45,0);
      obstacle(-.14,side*5.68,.74,.76,0,1.45);
      incense.push([-.14,1.39,side*5.68,1.33,3.1]);
      for (const [x,z,y,height,isBlue] of [
        [-8.0,7.94,0,1.20,false],[-4.64,8.95,.69,.96,false],
        [3.03,8.80,.68,.96,false],[6.0,5.46,.91,.76,false],
        [front-.30,3.68,0,.78,true],[-.14,5.68,1.37,.06,true]
      ]) {
        if(height>.1) {
          if(y>0) {
            box('torch-plinths',sandstone,x,y/2,side*z,.66,y,.68,1.13);
            box('torch-plinths',roses,x,y*.87,side*z,.72,.17,.74,1.25);
          }
          asset('brazier',x,y,side*z,height,0);
          if(Math.abs(z)>6 || x < 6) obstacle(x,side*z,.61,.64,0,y+height);
        }
        const incenseGlow = height <= .1;
        (isBlue?blue:amber).push([x,y+height-.042,side*z,incenseGlow?.39:isBlue?.53:.64,incenseGlow?.35:isBlue?.69:.82]);
      }
    }
    draw.flush();

    for (const node of root.children) {
      if (/^T4-ceiling-/.test(node.name)) node.userData.ceiling=true;
      if (node.isMesh) node.castShadow=false;
    }
    function lamp(color,power,radius,x,y,z,flicker=false) {
      const light=new THREE.PointLight(color,power,radius,2);
      light.position.set(x,y,z); light.userData.physicalFalloff=true;
      root.add(light);
      if(flicker) localLights.push([light,power]);
    }
    lamp(0x819aff,42,13,6.38,5.8,0);
    lamp(0xffd0a0,19,9,6.22,3.25,0);
    for (const side of [-1,1]) {
      lamp(0xffaa62,25,7,6.92,2.3,side*5.2,true);
      lamp(0xffb772,22,7,-5.4,2.28,side*7.15,true);
      lamp(0x91aeff,10,5.4,-.21,2.16,side*5.68);
    }
    addEffects(root,blue,amber,incense,clock,h-.1,constrained);
    SinGreatLibrary.setLibraryExposure(root,.315);

    const camera = new THREE.PerspectiveCamera(55,1280/720,.1,140);
    camera.name='T4-Presentation-Camera';
    camera.position.set(-hx+.54,2.24,0);
    camera.lookAt(7.4,3.65,0);
    root.add(camera);
    const warmup = SinGreatLibrary.geometryWarmup(root);
    return {
      root,camera,boxes,stairBoxes,warmup,front:location.front,
      floorAt(x,z){return treadHeight(stairBoxes,x,z);},
      tick(time){
        clock.value=time;
        localLights.forEach(([light,strength],index)=>{light.intensity=strength*(.97+.03*Math.sin(time*3.85+index*2.23));});
      },
      dispose(){warmup.dispose();SinGreatLibrary.disposeResources(root);}
    };
  }

  async function build(room, doors, load, signal, constrained) {
    const root = new THREE.Group();
    root.name = 'T4-Lunar-Sanctuary'; root.position.set(room.bbox.cx,0,room.bbox.cz);
    const maps = [];
    let source, parts;
    try {
      source = await load(furniture,signal);
      signal.throwIfAborted();
      parts = SinGreatLibrary.split(source,components);
      prepParts(parts,constrained);
      const loader = new THREE.TextureLoader();
      for(const file of imageFiles) {
        signal.throwIfAborted();
        maps.push(await loader.loadAsync(encodeURI(file)));
      }
      signal.throwIfAborted();
      return assemble(room,doors,parts,maps,constrained,root);
    } catch (error) {
      if (parts) for (const part of Object.values(parts)) root.add(new THREE.Mesh(part.geometry, part.material));
      else if (source) root.add(source.scene);
      SinGreatLibrary.disposeResources(root);
      throw error;
    } finally {
      maps.forEach(t=>t.dispose());
    }
  }

  window.SinLunarSanctuary = { build,expected,stairs,treadHeight,floorProjection };
})();
