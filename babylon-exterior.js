/* Babylon processional route. The palace and its threshold are owned by index.html. */
(function (root) {
  'use strict';
  const layout = Object.freeze({
    start: -30, south: -79, north: 218, gate: 0, gateHalfDepth: 8.45, gateHeight: 22.5, pass: 3.65,
    market: 34, road: 7.4, plaza: 76, palaceApproach: 160
  });
  const wallWidth=1.6, capsuleRadius=.31;
  // Distances from the center line to the inside face of both walls.
  const perimeter=Object.freeze([
    {end:70.2, west:16.1, east:16.1, height:5.6},
    {end:149.5, west:29.2, east:29.2, height:5.1},
    {end:layout.north, west:29.2, east:36.8, height:5.1}
  ].map(Object.freeze));
  const PACK = 'assets/babylon/';
  const road=layout.road;
  const roads = [
    [layout.south,-9,road,road], [-9,9,road,road], [9,67,road,road],
    [67,82,road,13], [82,143,13,13], [143,layout.palaceApproach,13,road]
  ];
  const panels = [-64,-44,-24,16.5,38,56.5,87,111,135.5,152];
  const panelHalfWidth=2.52, panelHalfDepth=2.16, inlayWidth=.72;
  const stalls = [
    ['Stall_Rugs', 'Stall_Pottery', 'Stall_Fruit'],
    ['Stall_Fruit', 'Stall_Rugs', 'Stall_Pottery']
  ];
  const houses = ['House_Cloth', 'House_Court', 'House_Lion'];
  // The bowls and static flames are welded onto four stone seats in the gate GLB.
  const gateHearth={x:11.69,z:7.0,seatY:3.24};
  // Paired landmarks mark the arch exit and the market curbs.
  const brazierRows = [
    ...[-gateHearth.z,gateHearth.z].map(z=>({name:'GateBrazier',x:gateHearth.x,z,vesselHeight:1.2,seatY:gateHearth.seatY,flameHeight:1.02})),
    {name:'IncenseStand', x:8.04, z:10.85, vesselHeight:1.29, plinthHeight:0, plinthWidth:0, flameHeight:.47},
    {name:'IncenseBowl', x:8.02, z:25.1, vesselHeight:.31, plinthHeight:.73, plinthWidth:.72, flameHeight:.38},
    {name:'IncenseBowl', x:8.02, z:51.8, vesselHeight:.31, plinthHeight:.73, plinthWidth:.72, flameHeight:.36}
  ];
  function spatialBatches(points, span, splitSides = false) {
    const cells = new Map();
    for (const p of points) {
      const cell = Math.floor((p.z - layout.south) / span) + (splitSides ? '_'+Math.sign(p.x) : '');
      if (!cells.has(cell)) cells.set(cell, []);
      cells.get(cell).push(p);
    }
    return cells;
  }
  const vista = [
    ['Ziggurat_Sanctuary', -87, 113, 51, .16], ['Ziggurat_Terraces', 58, 104, 38, -.20],
    ['City_West', -53, 89, 14, .16], ['City_East', 53, 83, 13, -.25],
    ['Ziggurat_Low', -101, 183, 31, .19], ['City_Mid', 90, 173, 29, -.16],
    ['City_East', -153, 222, 32, .18], ['Ziggurat_Sanctuary', 136, 243, 49, -.22],
    ['City_West', 144, 202, 26, -.31], ['Ziggurat_Terraces', -98, 260, 50, .22],
    ['City_Mid', -42, 273, 43, -.13], ['City_East', 34, 278, 49, -.26],
    ['Ziggurat_Low', 101, 307, 53, -.30], ['City_West', -203, 295, 46, .03]
  ];

  function widthAt(z) {
    const zone = roads.find(([, end]) => z <= end) || roads.at(-1);
    const [start, end, a, b] = zone;
    return a + (b - a) * Math.max(0, Math.min(1, (z - start) / (end - start)));
  }

  function createCollision() {
    const cells = new Map(), size = 7;
    function obstacle(x0, x1, z0, z1, pad = .22) {
      x0-=pad; x1+=pad; z0-=pad; z1+=pad;
      for (let x = Math.floor(x0 / size); x <= Math.floor(x1 / size); x++) {
        for (let z = Math.floor(z0 / size); z <= Math.floor(z1 / size); z++) {
          const key = x + ',' + z;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push([x0, x1, z0, z1]);
        }
      }
    }
    function blocked(x, z) {
      const r=capsuleRadius;
      if(z-r<layout.south+wallWidth || z+r>layout.north)return true;
      if(Math.abs(z-layout.gate)<layout.gateHalfDepth+r && Math.abs(x)>layout.pass)return true;
      let start=layout.south;
      for(const {end,west,east} of perimeter){
        // Keep the narrower section solid through the depth of its return
        // wall, including a capsule that overlaps the corner diagonally.
        if(z+r>=start && z-r<=end+wallWidth && (x-r<-west || x+r>east))return true;
        start=end;
      }
      return (cells.get(Math.floor(x / size) + ',' + Math.floor(z / size)) || []).some(([x0, x1, z0, z1]) =>
        x > x0 && x < x1 && z > z0 && z < z1);
    }
    const floor = (x, z) => z > layout.south && z <= layout.palaceApproach &&
      Math.abs(z - layout.gate) > layout.gateHalfDepth + 1 &&
      Math.abs(x) > widthAt(z) + .02 ? .16 : 0;
    return { obstacle, blocked, floor, clear: () => cells.clear() };
  }

  async function create({ THREE: T, renderer, loader, loadDecoder, status }) {
    const stage = new T.Group();
    stage.name = 'BabylonExterior';
    const collision = createCollision();
    const textureLoader = new T.TextureLoader();
    const texture = async (name, srgb) => {
      const tex = await textureLoader.loadAsync(PACK + name + '.webp');
      if (srgb) tex.colorSpace = T.SRGBColorSpace;
      tex.wrapS = tex.wrapT = T.MirroredRepeatWrapping;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return tex;
    };
    const materials = Object.create(null);
    const surface = async (name, tint = 0xffffff) => {
      const [map, normalMap, roughnessMap] = await Promise.all([
        texture(name, true), texture(name + '-normal'), texture(name + '-rough')
      ]);
      const m = new T.MeshStandardMaterial({ map, normalMap, roughnessMap, color: tint, roughness: 1 });
      m.normalScale.set(.75, .75);
      materials[name] = m;
      return m;
    };
    status('جارٍ تركيب بوابة عشتار وطريق الموكب');
    const [gatePack, marketPack, cityPack, palmPack, brazierPack, paving, medallion, brick, stone, rosette, binding, lion, lotus] = await Promise.all([
      loadDecoder().then(decoder => loader.setMeshoptDecoder(decoder).loadAsync('assets/بوابة عشتار.glb')),
      loader.loadAsync(PACK + 'market.glb'), loader.loadAsync(PACK + 'city.glb'), loader.loadAsync('assets/palm_new.glb'),
      loader.loadAsync(PACK + 'braziers.glb'),
      surface('paving'), surface('medallion'), surface('brick'), surface('sandstone'),
      surface('rosette'), surface('binding'), surface('lion'), surface('lotus')
    ]);
    const box = new T.Box3(), dims = new T.Vector3();
    const gate = gatePack.scene;
    const rawGate = new T.Group();
    rawGate.add(gate);
    gate.rotation.y = Math.PI / 2;
    box.setFromObject(rawGate, true);
    const gateScale = layout.gateHeight / (box.max.y - box.min.y);
    rawGate.scale.setScalar(gateScale);
    rawGate.position.set(-(box.max.x + box.min.x) * gateScale / 2, -box.min.y * gateScale - .06, layout.gate);
    rawGate.name = 'IshtarGate_Authored';
    rawGate.updateMatrixWorld(true);
    gate.traverse(node => {
      if (!node.isMesh) return;
      trimGateHearths(T,node);
      node.receiveShadow = true;
      node.castShadow = true;
      node.material.metalness *= .70;
    });
    stage.add(rawGate);

    // Buffer the masonry by material. Architectural detailing adds silhouette
    // and reveals without making each brick or merlon a separate draw call.
    const batches = new Map();
    function quad(mat, vertices, u = 1, v = 1, texUV = null) {
      if (!batches.has(mat)) batches.set(mat, { position: [], uv: [], index: [] });
      const b = batches.get(mat);
      const n = b.position.length / 3;
      b.position.push(...vertices.flat());
      b.uv.push(...(texUV || [0, 0, u, 0, u, v, 0, v]));
      b.index.push(n, n + 1, n + 2, n, n + 2, n + 3);
    }
    function slab(mat, x0, x1, y0, y1, z0, z1, tile = 3.2) {
      const [u, v, w] = [(x1 - x0) / tile, (y1 - y0) / tile, (z1 - z0) / tile];
      quad(mat, [[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]], w, v);
      quad(mat, [[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]], w, v);
      quad(mat, [[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]], u, v);
      quad(mat, [[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]], u, v);
      quad(mat, [[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0]], u, w);
    }
    function strip(mat, a, b, c, d, z0, z1, y, u, v) {
      quad(mat, [[a,y,z1],[b,y,z1],[d,y,z0],[c,y,z0]], u, v);
    }
    const joints=stone.clone();
    joints.color.setHex(0x4a3a32);
    materials.joints=joints;
    let row=0;
    const stoneWidths=[1.77,2.14,1.58,1.93,2.28,1.6];
    function slabs(z0,z1,left0,right0,left1,right1) {
      const n=Math.max(1,Math.round((z1-z0)/1.12));
      for (let i=0;i<n;i++,row++) {
        const start=T.MathUtils.lerp(z0,z1,i/n);
        const end=T.MathUtils.lerp(z0,z1,(i+1)/n);
        const x0=T.MathUtils.lerp(left0,left1,i/n), x1=T.MathUtils.lerp(right0,right1,i/n);
        const x2=T.MathUtils.lerp(left0,left1,(i+1)/n), x3=T.MathUtils.lerp(right0,right1,(i+1)/n);
        const width=(x1-x0+x3-x2)*.5;
        let run=0, column=0;
        while(run<width-.03){
          const base=stoneWidths[(row*7+column*3)%stoneWidths.length];
          let next=Math.min(width,run+(column===0&&row%2 ? base*.54 : base));
          if(width-next<.47)next=width;
          const u=(run+.012)/width, v=(next-.012)/width;
          const tile=(row*7+column*5+(row>>2))%12;
          const a=(tile%4)/4+.006, b=a+.238;
          const d=1-(Math.floor(tile/4)+1)/3+.013, c=d+.307;
          const map=column%2 ? [b,d,a,d,a,c,b,c] : [a,d,b,d,b,c,a,c];
          quad(paving,[[T.MathUtils.lerp(x2,x3,u),.002,end-.012],[T.MathUtils.lerp(x2,x3,v),.002,end-.012],
            [T.MathUtils.lerp(x0,x1,v),.002,start+.012],[T.MathUtils.lerp(x0,x1,u),.002,start+.012]],1,1,map);
          run=next;
          column++;
        }
      }
    }
    function ribbon(mat,a,b,c,d,z0,z1) {
      quad(mat,[[a,.002,z0],[c,.002,z1],[d,.002,z1],[b,.002,z0]],(z1-z0)/3.4,1);
    }
    for (const [z0,z1,a,b] of roads) {
      strip(joints,-a,a,-b,b,z0,z1,-.014,(a+b)/4,(z1-z0)/2);
      const cuts=[z0,z1];
      for (const p of panels) {
        for (const edge of [p-panelHalfDepth,p+panelHalfDepth]) if(edge>z0&&edge<z1)cuts.push(edge);
      }
      cuts.sort((x,y)=>x-y);
      for(let i=1;i<cuts.length;i++){
        const start=cuts[i-1],end=cuts[i];
        const w0=widthAt(start)-inlayWidth,w1=widthAt(end)-inlayWidth;
        const center=(start+end)*.5;
        const panel=panels.find(p=>Math.abs(center-p)<panelHalfDepth);
        if (panel===undefined) slabs(start,end,-w0,w0,-w1,w1);
        else {
          slabs(start,end,-w0,-panelHalfWidth,-w1,-panelHalfWidth);
          slabs(start,end,panelHalfWidth,w0,panelHalfWidth,w1);
        }
      }
      for (const s of [-1,1]) {
        const left=s<0;
        const [q,r,t,k]=left?[-a,-a+.12,-b,-b+.12]:[a-.12,a,b-.12,b];
        ribbon(binding,q,r,t,k,z0,z1);
        if(left) ribbon(rosette,r,-a+inlayWidth,k,-b+inlayWidth,z0,z1);
        else ribbon(rosette,a-inlayWidth,q,b-inlayWidth,t,z0,z1);
        const sidewalk=z0>=82?31:16.2;
        if(left)strip(stone,-sidewalk,-a,-sidewalk,-b,z0,z1,.16,3,(z1-z0)/2.2);
        else strip(stone,a,sidewalk,b,sidewalk,z0,z1,.16,3,(z1-z0)/2.2);
        quad(stone,left?[[-b,.02,z1],[-a,.02,z0],[-a,.16,z0],[-b,.16,z1]]:
          [[a,.02,z0],[b,.02,z1],[b,.16,z1],[a,.16,z0]],(z1-z0)/2,1);
      }
    }
    // Medallions fill openings in the stone courses at the same elevation.
    for (const z of panels) {
      const [x,z0,z1,y]=[panelHalfWidth,z-panelHalfDepth,z+panelHalfDepth,.002];
      // From the south the motif reads upright, with the lion facing screen right.
      quad(medallion,[[-x,y,z1],[x,y,z1],[x,y,z0],[-x,y,z0]],1,1,[1,1,0,1,0,0,1,0]);
    }
    strip(stone,-39,40,-39,40,layout.south,layout.north+2,-.025,23,99);
    const outerStone=stone.clone();
    outerStone.color.setHex(0x8b7867);
    materials.outerStone=outerStone;
    // Fabric outside the walls carries the distant structures up to the
    // skyline. It is scenery and has no collision mesh.
    strip(outerStone,-300,300,-340,340,-88,465,-2.015,94,76);

    function frieze(mat, alongX, cross, from, to, low, high) {
      const nudge = .016;
      if (alongX) {
        quad(mat, [[to,low,cross-nudge],[from,low,cross-nudge],[from,high,cross-nudge],[to,high,cross-nudge]], (to-from)/3.4, 1);
      } else {
        quad(mat, [[cross,low,from],[cross,low,to],[cross,high,to],[cross,high,from]], (to-from)/3.4, 1);
      }
    }

    function transverse(from, to, z, h, panel = lion) {
      slab(stone, from-.14,to+.14,0,.88,z-.14,z+1.75);
      slab(brick, from,to,.88,h,z,z+1.6);
      slab(stone, from-.12,to+.12,h,h+.24,z-.14,z+1.74);
      frieze(rosette,true,z,from,to,h-.61,h-.13);
      const count = Math.floor((to-from) / 1.5);
      for (let i=0;i<count;i++) {
        const x = from+(i+.45)*(to-from)/count;
        slab(brick,x-.38,x+.38,h+.24,h+.9,z-.04,z+1.66);
        slab(brick,x-.25,x+.25,h+.9,h+1.15,z+.06,z+1.56);
      }
      for (let x=from+1.9;x+1.4<to;x+=3.9) {
        quad(panel, [[x+1.4,1.18,z-.023],[x-1.4,1.18,z-.023],[x-1.4,3.45,z-.023],[x+1.4,3.45,z-.023]]);
      }
    }
    // The cross-wall meets the authored towers by overlapping their stone
    // foundations; its lowest course is level with the gate's plinth.
    transverse(-39,-16.6,-1.6,9.3);
    transverse(16.6,39,-1.6,9.3);
    const front=perimeter[0], back=perimeter.at(-1);
    transverse(-front.west-wallWidth,front.east+wallWidth,layout.south,5.2,lotus);
    transverse(-back.west-wallWidth,back.east+wallWidth,layout.north,4.9,lotus);

    for(const side of ['west','east']){
      const s=side==='west'?-1:1;
      let start=layout.south, prior=null;
      for(const section of perimeter){
        const {end,height:h}=section,x=section[side];
        if(prior!==null && x!==prior){
          const a=s*prior,b=s*x;
          transverse(Math.min(a,b),Math.max(a,b),start,h,lotus);
        }
        for (let z=start;z<end;z+=7.2) {
          const upper=Math.min(end,z+7.2);
          const a=s*x, b=s*(x+wallWidth), x0=Math.min(a,b), x1=Math.max(a,b);
          slab(stone,x0-.13,x1+.13,.02,.82,z,upper);
          slab(brick,x0,x1,.82,h,z,upper);
          slab(stone,x0-.13,x1+.13,h,h+.23,z,upper);
          if (s<0) {
            // Inner east-facing panel; reverse its winding.
            quad(rosette, [[a+.02,h-.67,upper],[a+.02,h-.67,z],[a+.02,h-.15,z],[a+.02,h-.15,upper]], (upper-z)/3,1);
          } else frieze(rosette,false,a-.02,z,upper,h-.67,h-.15);
          for (let t=z+.5;t+.65<upper;t+=1.25) {
            slab(brick,x0,x1,h+.23,h+.85,t,t+.61);
            slab(brick,x0+.14,x1-.14,h+.85,h+1.05,t+.10,t+.51);
          }
          if (Math.floor((z-start)/7.2)%3===0) {
            const tx0=x0-.4, tx1=x1+.4;
            slab(brick,tx0,tx1,.4,h+1.05,z,z+1.85);
            slab(stone,tx0-.1,tx1+.1,h+1.04,h+1.26,z-.1,z+1.95);
            slab(brick,tx0,tx1,h+1.26,h+1.85,z,z+.47);
            slab(brick,tx0,tx1,h+1.26,h+1.85,z+1.39,z+1.85);
          }
        }
        start=end;
        prior=x;
      }
    }
    const vessels = new Map(brazierPack.scene.children.map(mesh => [mesh.name, mesh]));
    const vesselPlacements = new Map();
    const hearths = [];
    for (const row of brazierRows) {
      const {name,z,vesselHeight,seatY,plinthHeight=0,plinthWidth=0,flameHeight}=row;
      const d=box.setFromObject(vessels.get(name)).getSize(dims);
      const scale=vesselHeight/d.y, radius=Math.max(d.x,d.z)*scale*.5;
      const placements=vesselPlacements.get(name)||[];
      vesselPlacements.set(name,placements);
      for (const side of [-1,1]) {
        const x=side*row.x, floor=collision.floor(x,z), y=seatY??floor+plinthHeight;
        const foot=plinthWidth*.5, footprint=Math.max(foot,radius*.84);
        if (plinthHeight) {
          slab(stone,x-foot,x+foot,floor,floor+.13,z-foot,z+foot,1);
          const shaft=foot*.89;
          slab(stone,x-shaft,x+shaft,floor+.13,y-.12,z-shaft,z+shaft,1);
          slab(stone,x-foot,x+foot,y-.12,y,z-foot,z+foot,1);
          const low=floor+.18, high=y-.17, faceX=x-side*(shaft+.006), faceZ=z-shaft-.006;
          quad(lotus,[[x+shaft,low,faceZ],[x-shaft,low,faceZ],[x-shaft,high,faceZ],[x+shaft,high,faceZ]]);
          quad(lotus,[[faceX,low,z-side*shaft],[faceX,low,z+side*shaft],
            [faceX,high,z+side*shaft],[faceX,high,z-side*shaft]]);
        }
        placements.push({x,y,z,yaw:side<0?0:Math.PI,scale});
        if(seatY==null)collision.obstacle(x-footprint,x+footprint,z-footprint,z+footprint);
        hearths.push({x,y:y+vesselHeight-radius*.19,z,radius,flameHeight});
      }
    }
    for (const [mat, b] of batches) {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(b.position,3));
      g.setAttribute('uv', new T.Float32BufferAttribute(b.uv,2));
      g.setIndex(b.index);
      g.computeVertexNormals();
      const mesh = new T.Mesh(g, mat);
      mesh.name = 'Babylon_' + Object.keys(materials).find(k => materials[k] === mat);
      mesh.receiveShadow = true;
      stage.add(mesh);
    }
    batches.clear();

    const dummy = new T.Object3D();
    const cityGroups = [];
    function instance(mesh, placements, parent, name, shadow = false) {
      const batch = new T.InstancedMesh(mesh.geometry, mesh.material, placements.length);
      batch.name = name;
      batch.receiveShadow = true;
      batch.castShadow = shadow;
      for (const [i, p] of placements.entries()) {
        dummy.position.set(p.x,p.y,p.z);
        dummy.rotation.set(0,p.yaw,0);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        batch.setMatrixAt(i,dummy.matrix);
      }
      batch.computeBoundingSphere();
      parent.add(batch);
      return batch;
    }
    const sources = new Map(marketPack.scene.children.map(mesh => [mesh.name, mesh]));
    const placed = new Map();
    function put(name, x, y, z, yaw, height) {
      const mesh=sources.get(name);
      const d=box.setFromObject(mesh).getSize(dims);
      const scale=height/d.y;
      if (!placed.has(name)) placed.set(name,[]);
      placed.get(name).push({x,y,z,yaw,scale});
      return [d.x*scale,d.z*scale];
    }
    for (const [side,s] of [-1,1].entries()) {
      for (const [start,end,serial] of [[-70,-12,0],[12,68,1]]) {
        let z=start;
        for (let i=0;z<end-3;i++) {
          const name=stalls[side][(i+serial)%3];
          const h=[3.75,3.92,3.6,4.02][(i+side)%4];
          const d=box.setFromObject(sources.get(name)).getSize(dims);
          const frontage=d.z*h/d.y, depth=d.x*h/d.y;
          const x=s*(8.95+depth/2+[.04,.22,.10,.32][(i+2*side)%4]);
          const mid=z+frontage/2;
          const yaw=side*Math.PI+[.018,-.033,.025,0][(i+side)%4];
          put(name,x,.16,mid,yaw,h);
          collision.obstacle(Math.min(s*8.63,s*(9.05+depth)), Math.max(s*8.63,s*(9.05+depth)), z-.12,z+frontage+.12);
          z+=frontage-.015;
        }
        for (let i=0,j=start-2;j<end+1;i++) {
          const name=houses[(i*2+side+serial)%3];
          const h=[12.6,10.8,13.1,11.7,14.1][(i+serial+side)%5];
          const d=box.setFromObject(sources.get(name)).getSize(dims);
          const frontage=d.z*h/d.y, depth=d.x*h/d.y;
          const lean=[.04,-.035,.095,-.07][(i+side)%4];
          put(name,s*(12.85+depth*.49),.12,j+frontage/2,side*Math.PI+lean,h);
          collision.obstacle(Math.min(s*12.8,s*(12.8+depth)),Math.max(s*12.8,s*(12.8+depth)),j+.08,j+frontage-.08);

          j+=frontage*.91;
        }
      }
      for (const [i,z] of [81,99,119,137,152].entries()) {
        const x=s*(25+(i%2)*2.8), yaw=side*Math.PI-.22+i*.085;
        const [depth,frontage]=put(houses[(i+side)%3],x,.12,z,yaw,11+(i*2+side)%5);
        const c=Math.abs(Math.cos(yaw)), sn=Math.abs(Math.sin(yaw));
        const hx=(c*depth+sn*frontage)*.43, hz=(sn*depth+c*frontage)*.43;
        collision.obstacle(x-hx,x+hx,z-hz,z+hz);
      }
    }
    const marketLods=[];
    for (const [name, placements] of placed) {
      // Spatial batches let an entire street portion fall out of the frustum.
      const cells = spatialBatches(placements, 22, true);
      for (const [id,list] of cells) {
        const near=instance(sources.get(name),list,stage,name+'_'+id);
        const mid=instance(sources.get(name+'_LOD1'),list,stage,name+'_Mid_'+id);
        const far=instance(sources.get(name+'_LOD2'),list,stage,name+'_Far_'+id);
        near.computeBoundingBox();
        marketLods.push({z:list.reduce((sum,p)=>sum+p.z,0)/list.length,x:list[0].x,near,mid,far,bounds:near.boundingBox});
      }
    }

    const city = new Map(cityPack.scene.children.map(mesh => [mesh.name, mesh]));
    for (const [name,x,z,height,yaw] of vista) {
      const hi = city.get(name);
      const lo = city.get(name+'_LOD1');
      const scale=height/box.setFromObject(hi).getSize(dims).y;
      const lodge = new T.Group();
      lodge.position.set(x,-2,z);
      lodge.rotation.y=yaw;
      lodge.scale.setScalar(scale);
      const near = hi.clone(), far = lo.clone();
      near.name=name;
      far.name=name+'_Far';
      lodge.add(near,far);
      stage.add(lodge);
      cityGroups.push({ lodge, near, far });
    }
    for (const mat of new Set([...city.values()].map(mesh => mesh.material))) {
      mat.metalness *= .6;
      mat.roughness = .93;
    }
    // Static palms share their baked trunk and leaf geometry from palm_new.
    const palms = [];
    for (const s of [-1,1]) {
      for (const [i,z] of [-74,-48,-24,-10.1,10.1,27,48,64,83,101,125,145,153].entries()) {
        const x=s*(z>70 ? 15.4+(i%3)*1.95 : (Math.abs(z)<11 ? 14.1 : 12.4+(i%2)*.6));
        palms.push({x,y:.14,z,yaw:i*.97+s*.31,scale:10.1+(i*21+s+32)%37*.11});
        collision.obstacle(x-.27,x+.27,z-.27,z+.27);
      }
    }
    palmPack.scene.updateMatrixWorld(true);
    const palmBase=box.setFromObject(palmPack.scene,true).clone();
    const palmCells=spatialBatches(palms,26);
    const palmLods=new Map();
    palmPack.scene.traverse(src => {
      if (!src.isMesh) return;
      const geo=src.geometry.clone().applyMatrix4(src.matrixWorld);
      geo.translate(-(palmBase.min.x+palmBase.max.x)/2,-palmBase.min.y,-(palmBase.min.z+palmBase.max.z)/2);
      const scale=1/(palmBase.max.y-palmBase.min.y);
      geo.scale(scale,scale,scale);
      const level=src.name.startsWith('LOD1') ? 1 : src.name.startsWith('LOD2') ? 2 : 0;
      const trunk=/Trunk/.test(src.name);
      const m = new T.Mesh(geo,src.material);
      for (const [cell,list] of palmCells) {
        const batch=instance(m,list,stage,'RoyalPalms_'+cell+'_'+src.name);
        if (trunk) continue;
        if (!palmLods.has(cell)) palmLods.set(cell, {z:list[0].z, batches:[]});
        palmLods.get(cell).batches.push({ batch,level });
      }
    });

    for (const [name, placements] of vesselPlacements) {
      instance(vessels.get(name),placements,stage,'Babylon_Vessel_'+name);
    }
    const fire=makeBrazierFire(T,hearths);
    stage.add(fire);

    // Cull a row behind the gate only when its complete projected bounds
    // fit within one solid wing. The opening, crown and wing edges stay live.
    function behindGate(position, bounds) {
      const c=position.z, d=layout.gateHalfDepth;
      if (!(c < -d && bounds.min.z > d || c > d && bounds.max.z < -d)) return false;
      let left=true,right=true;
      for (const z of [bounds.min.z,bounds.max.z]) {
        const t=-c/(z-c);
        if (T.MathUtils.lerp(position.y,bounds.max.y,t)>14.5 ||
            T.MathUtils.lerp(position.y,bounds.min.y,t)<.03) return false;
        for (const x of [bounds.min.x,bounds.max.x]) {
          const p=T.MathUtils.lerp(position.x,x,t);
          left&&=p<=-5.1&&p>=-15.8;
          right&&=p>=5.1&&p<=15.8;
        }
      }
      return left||right;
    }

    function update(camera, show = (node,on) => { node.visible=on; }, elapsed) {
      for (const {lodge,near,far} of cityGroups) {
        const low= (lodge.position.x-camera.position.x)**2 + (lodge.position.z-camera.position.z)**2 > 115**2;
        show(near,!low);
        show(far,low);
      }
      for (const {x,z,near,mid,far,bounds} of marketLods) {
        const cutoff=near.name.startsWith('House') ? 31 : 25;
        const dist=(x-camera.position.x)**2+(z-camera.position.z)**2;
        const covered=behindGate(camera.position,bounds);
        show(near,!covered&&dist<=cutoff**2);
        show(mid,!covered&&dist>cutoff**2&&dist<=54**2);
        show(far,!covered&&dist>54**2);
      }
      for (const {z,batches} of palmLods.values()) {
        const d=Math.abs(camera.position.z-z);
        const lod=d>82 ? 2 : d>28 ? 1 : 0;
        for (const {batch,level} of batches) show(batch,lod===level);
      }
      fire.material.uniforms.time.value=elapsed??performance.now()*.001;
    }
    return {root:stage,collision,update,release(){
      collision.clear();
      stage.traverse(node=>{if(node.isInstancedMesh)node.dispose();});
    }};
  }

  function trimGateHearths(T, mesh) {
    // Filter just the bowls and flame silhouettes above the carved stone seats.
    // The measured profile widens at the bowl lip and narrows around the flame.
    const profile=[[gateHearth.seatY,.66],[3.47,.62],[3.72,.75],[3.95,1.20],[4.16,1.43],[4.35,1.46],[4.48,1.44],[4.52,.52],[6.55,.52]];
    const maxY=profile.at(-1)[0];
    const geometry=mesh.geometry, positions=geometry.attributes.position;
    const world=new Float32Array(positions.count*3), point=new T.Vector3();
    for(let i=0;i<positions.count;i++)point.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld).toArray(world,i*3);
    const indices=geometry.index.array;
    let kept=0;
    for(let i=0;i<indices.length;i+=3) {
      const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
      const y=(world[a+1]+world[b+1]+world[c+1])/3;
      if(y>gateHearth.seatY&&y<maxY) {
        const x=Math.abs((world[a]+world[b]+world[c])/3)-gateHearth.x;
        const z=Math.abs((world[a+2]+world[b+2]+world[c+2])/3)-gateHearth.z;
        const distance=x*x+z*z;
        if(distance<1.46**2) {
          const j=profile.findIndex(([height])=>y<height);
          const [low,inner]=profile[j-1], [high,outer]=profile[j];
          const radius=T.MathUtils.lerp(inner,outer,(y-low)/(high-low));
          if(distance<radius*radius)continue;
        }
      }
      indices[kept++]=indices[i];indices[kept++]=indices[i+1];indices[kept++]=indices[i+2];
    }
    geometry.setDrawRange(0,kept);
  }

  function makeBrazierFire(T, hearths) {
    const plane=new T.PlaneGeometry(1,1);
    const geometry=new T.InstancedBufferGeometry().copy(plane);
    plane.dispose();
    const anchors=[], shapes=[];
    const bounds=new T.Box3();
    for (const [i,{x,y,z,radius,flameHeight}] of hearths.entries()) {
      const spread=1.35+flameHeight*.9;
      anchors.push(x,y,z,0,x-Math.sign(x)*.53,.012,z,1);
      shapes.push(radius*2.38,flameHeight,i*1.37,spread*2,spread*1.8,i*1.37);
      bounds.expandByPoint(new T.Vector3(x-spread-.53,.012,z-spread));
      bounds.expandByPoint(new T.Vector3(x+spread+.53,y+flameHeight,z+spread));
    }
    geometry.setAttribute('anchor',new T.InstancedBufferAttribute(new Float32Array(anchors),4));
    geometry.setAttribute('shape',new T.InstancedBufferAttribute(new Float32Array(shapes),3));
    geometry.instanceCount=hearths.length*2;
    geometry.boundingSphere=bounds.getBoundingSphere(new T.Sphere());
    const material=new T.ShaderMaterial({
      uniforms:{time:{value:0},curb:{value:road}}, transparent:true, depthWrite:false,
      blending:T.AdditiveBlending, toneMapped:false,
      vertexShader:`
        attribute vec4 anchor;
        attribute vec3 shape;
        varying vec2 sampleUV;
        varying float spill, phase, fade, worldX;
        void main() {
          vec3 center=(modelMatrix*vec4(anchor.xyz,1.)).xyz;
          vec3 toEye=cameraPosition-center;
          spill=anchor.w;
          phase=shape.z;
          sampleUV=uv;
          fade=1.-smoothstep(1369.,5476.,dot(toEye,toEye));
          if(spill>0.5) {
            center.xz+=vec2(position.x,-position.y)*shape.xy;
          } else {
            vec2 across=normalize(vec2(toEye.z+0.0001,-toEye.x));
            center.xz+=across*position.x*shape.x;
            center.y+=uv.y*shape.y;
          }
          worldX=center.x;
          gl_Position=projectionMatrix*viewMatrix*vec4(center,1.);
        }`,
      fragmentShader:`
        uniform float time,curb;
        varying vec2 sampleUV;
        varying float spill, phase, fade, worldX;
        float tongue(float x,float y,float height,float width) {
          float taper=width*(0.94-0.78*y/height);
          float edge=1.-smoothstep(max(.006,taper*.36),max(.022,taper),abs(x));
          return edge*(1.-smoothstep(height-.19,height,y));
        }
        void main() {
          if(fade<.008) discard;
          float clock=time+phase;
          if(spill>0.5) {
            vec2 d=sampleUV*2.-1.;
            float edge=1.-smoothstep(0.,1.,dot(d,d));
            float street=smoothstep(0.,.45,curb-abs(worldX));
            float shimmer=.93+.07*sin(clock*8.)+.04*sin(clock*15.1);
            gl_FragColor=vec4(1.,.29,.057,edge*edge*street*fade*.21*shimmer);
          } else {
            float y=sampleUV.y;
            float x=sampleUV.x*2.-1.;
            float wobble=sin(y*17.-clock*8.)*.105+sin(y*8.-clock*5.)*.15;
            float center=x-wobble*y;
            float tall=.91+.06*sin(clock*7.6)+.028*sin(clock*15.);
            float main=tongue(center,y,tall,.55);
            float left=tongue(center+.40-.18*y,y,.59+.12*sin(clock*10.+1.),.31);
            float right=tongue(center-.37+.12*y,y,.70+.11*sin(clock*9.1+4.),.32);
            float base=smoothstep(0.,.16,y);
            float flame=max(main,max(left,right)*.88);
            float heat=tongue(center,y,.51,.37);
            float detail=.86+.14*sin(clock*18.-y*37.+x*6.);
            vec3 hue=mix(vec3(1.,.20,.016),vec3(1.,.82,.36),heat);
            float aura=pow(max(0.,1.-length(vec2(x*.79,(y-.21)*1.52))),3.)*.08;
            gl_FragColor=vec4(hue,(flame*base*detail*.85+aura*base)*fade);
          }
          #include <colorspace_fragment>
        }`
    });
    const fire=new T.Mesh(geometry,material);
    fire.name='Babylon_BrazierFire';
    return fire;
  }

  root.SinBabylonExterior = { layout, create };
  if (typeof module !== 'undefined') module.exports = { layout, perimeter, widthAt, createCollision };
})(typeof window !== 'undefined' ? window : globalThis);
