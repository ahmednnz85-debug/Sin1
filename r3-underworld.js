/* U1 — Irkalla. The Anchorage is dressed over the approved walkable plan;
   the road, its lookouts and the gate retain their existing layout. Local
   coordinates are relative to the docked arrival cabin in the Maw frame. */
(function (root) {
  'use strict';
  const tau = Math.PI * 2;
  // Walkable plan, relative to the arrival cabin centre (y = 0 platform level).
  const DISCS = [
    ['U1-01', 0, 0, 16.0, 0], ['lookout-a', -42, 13, 3.1, 0], ['junction', -42, 0, 6.1, 0],
    ['landing', -42, -26, 4.9, -6], ['lookout-b', -98, -38.5, 3.1, -6], ['midway', -98, -26, 5.8, -6],
    ['U1-03', -139, -26, 18.2, -9]
  ];
  const PATHS = [
    ['causeway', -16.0, 0, -36.2, 0, 5.0, 0, 0],
    ['branch-a', -42, 5.8, -42, 10.3, 2.6, 0, 0],
    ['stair', -42, -5.8, -42, -21.4, 4.8, 0, -6],
    ['bridge', -46.2, -26, -92.3, -26, 5.2, -6, -6],
    ['branch-b', -98, -31.9, -98, -35.4, 2.6, -6, -6],
    ['descent', -103.9, -26, -121.4, -26, 5.2, -6, -9]
  ];
  const DAIS = [[4.86, 0.58], [5.12, 0.38], [5.46, 0.19]];
  // Registered spawns (relative): inside the arrival cabin, the bridge head,
  // the plaza facing the gate. yaw: toward -x.
  const SPAWNS = { 'U1-01': [0, 0.59, 0], 'U1-02': [-49, -6, -26], 'U1-03': [-124, -9, -26] };
  // Existing dock lamps and the paired lamps at the road's thresholds.
  const LAMPS = Array.from({ length: 6 }, (_, i) => {
    const angle = (i + 0.5) * tau / 6;
    return [Math.cos(angle) * 11.8, 0, Math.sin(angle) * 11.8, -angle];
  });
  const BRAZIERS = [
    ...[-1, 1].flatMap(side => [
      [-19.7, 0, side * 2.82], [-34.7, 0, side * 2.82], [-38.3, 0, side * 4.82],
      [-42 + side * 2.54, 0, -5.85], [-42 + side * 2.52, -6, -22.0],
      [-48.7, -6, -26 + side * 2.94], [-73.0, -6, -26 + side * 2.94], [-90.7, -6, -26 + side * 2.94],
      [-101.4, -6, -26 + side * 4.10], [-124.7, -9, -26 + side * 5.60], [-141.5, -9, -26 + side * 15.8]
    ])
  ];
  const roadLampScale=4.6;
  const lampBase=(x,z)=>x>-36 || (x>-93&&x<-46&&z<-23) ? .92 : .42;
  const COLD = [[-70, 22, -26, 46, 0.07, 0.11, 0.17], [-139, 24, -26, 40, 0.10, 0.14, 0.21]];
  const gateX = -155, gateZ = -26, gateFloor = -9;
  const gateScale = 2.85, gateBack = -167.6, gateHalfWidth = 3.55, hingeDepth = -1.345;
  const gateAsset = 'assets/بوابة اركالا.glb';
  const GUARDIANS = [-1, 1].map(side => [gateX + 7.5, -9, -26 + side * 8.2, side < 0 ? 0 : Math.PI]);

  function create({ T, group, lift, hit }) {
    const A = { x: lift.center[0], y: lift.drop, z: lift.center[1] };
    const L = (x, y, z) => [A.x + x, A.y + y, A.z + z];
    const world = new T.Group();
    world.name = 'U1_Irkalla';
    group.add(world);
    const status = { phase: 'idle', lights: 0 };
    let gate = null;

    // ---- shading: local braziers, cold cavern light, graded blue fog ------
    const transform = { value: new T.Matrix4() };
    const lights = [];
    for (const [x, y, z] of BRAZIERS) lights.push([x, y + lampBase(x,z) + 1.25, z, 6.1, 0.08, 0.55, 0.61]);
    lights.sort((a,b)=>b[0]-a[0]);
    const roadLights=lights.length;
    // Restrict each fragment to lamps close to its part of the route.
    const limits=[-15,-30,-44,-55,-66,-81,-96,-113,-132,-158];
    const lightRanges=limits.slice(1).map((left,i)=>{
      const active=lights.map(([x,,,radius],j)=>x+radius>left&&x-radius<limits[i]?j:-1).filter(j=>j>=0);
      const first=active[0]??0, last=active.length?active.at(-1)+1:0;
      return `if (uLocal.x > ${left.toFixed(1)}) lamps = ivec2(${first},${last});`;
    }).join(' else ');
    lights.push(...COLD);
    status.lights = lights.length;
    const spots = { value: lights.map(l => new T.Vector4(...L(l[0], l[1], l[2]), l[3])) };
    const tints = { value: lights.map(l => new T.Vector3(l[4], l[5], l[6])) };
    const n = lights.length;
    const flowTime = { value: 0 };
    // One small periodic noise tile serves the cavern and both low fog layers.
    const mistSize=128, mistPixels=new Uint8Array(mistSize*mistSize);
    function noiseTile(x,y,period,seed) {
      const cell=(a,b)=>{
        let n=Math.imul(a%period+seed,73856093)^Math.imul(b%period+31,19349663);
        n=Math.imul(n^(n>>>13),1274126177);
        return (n>>>8)/16777215;
      };
      const i=Math.floor(x), j=Math.floor(y), u=x-i, v=y-j;
      return T.MathUtils.lerp(T.MathUtils.lerp(cell(i,j),cell(i+1,j),u*u*(3-2*u)),
        T.MathUtils.lerp(cell(i,j+1),cell(i+1,j+1),u*u*(3-2*u)),v*v*(3-2*v));
    }
    for(let y=0;y<mistSize;y++) for(let x=0;x<mistSize;x++) {
      mistPixels[y*mistSize+x]=Math.round(255*(.69*noiseTile(x/16,y/16,8,71)+.31*noiseTile(x/4,y/4,32,157)));
    }
    const caveNoise=new T.DataTexture(mistPixels,mistSize,mistSize,T.RedFormat);
    caveNoise.wrapS=caveNoise.wrapT=T.RepeatWrapping;
    caveNoise.magFilter=T.LinearFilter;
    caveNoise.minFilter=T.LinearMipmapLinearFilter;
    caveNoise.generateMipmaps=true;
    caveNoise.needsUpdate=true;
    function finish(material, kind = 'stone') {
      material.fog = false;
      material.customProgramCacheKey = () => 'u1-' + kind + '-' + n;
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, { uW2L: transform, uSpots: spots, uTints: tints,
          uCaveNoise: { value: caveNoise } });
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform mat4 uW2L; varying vec3 vU; varying float vPropHeight;')
          .replace('#include <project_vertex>', `#include <project_vertex>
            vec4 uP = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
            uP = instanceMatrix * uP;
            #endif
            vU = (uW2L * modelMatrix * uP).xyz;
            vPropHeight = position.y;`);
        const lampMask = kind === 'roadLamp'
          ? 'smoothstep(0.230,0.276,vPropHeight)*smoothstep(.016,.11,min(diffuseColor.g,diffuseColor.b)-diffuseColor.r)'
          : `smoothstep(1.67, 1.96, vU.y - (${A.y.toFixed(2)}))`;
        if (kind === 'lamp' || kind === 'roadLamp') shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
          #include <emissivemap_fragment>
          totalEmissiveRadiance *= ${lampMask};
        `);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
            uniform mat4 uW2L; uniform vec4 uSpots[${n}]; uniform vec3 uTints[${n}]; uniform sampler2D uCaveNoise;
            varying vec3 vU; varying float vPropHeight;
            vec3 lampLight(int i, vec3 n) {
              vec3 d=uSpots[i].xyz-vU;
              float dist2=dot(d,d), radius=uSpots[i].w;
              if(dist2>radius*radius) return vec3(0.);
              float dist=sqrt(dist2), fall=1.-smoothstep(0.,radius,dist);
              return uTints[i]*(max(dot(n,d/max(dist,.001)),0.)*.8+.2)*fall*fall;
            }`)
          .replace('#include <opaque_fragment>', `
            vec3 uN = normalize(mat3(uW2L) * inverseTransformDirection(normal, viewMatrix));
            vec3 uEye = (uW2L * vec4(cameraPosition, 1.0)).xyz;
            vec3 uLocal = vU - vec3(${A.x.toFixed(2)}, ${A.y.toFixed(2)}, ${A.z.toFixed(2)});
            float uH = uLocal.y;
            float uRadius = length(uLocal.xz);
            vec3 uLit = vec3(0.0);
            if (uLocal.x < -15.0) {
              ivec2 lamps=ivec2(0);
              ${lightRanges}
              for(int i=lamps.x;i<lamps.y;i++) uLit+=lampLight(i,uN);
              for(int i=${roadLights};i<${n};i++) uLit+=lampLight(i,uN);
            }
            float lampIndex = floor(atan(uLocal.z, uLocal.x) / 1.04719755);
            float lampAngle = (lampIndex + 0.5) * 1.04719755;
            vec3 lamp = vec3(11.8 * cos(lampAngle), 1.95, 11.8 * sin(lampAngle));
            vec3 toLamp = lamp - uLocal;
            float lampDist = length(toLamp);
            float lampGlow = 1.0 - smoothstep(0.0, 6.0, lampDist);
            float facingLamp = max(dot(uN, toLamp / max(lampDist, 0.01)), 0.0);
            uLit += vec3(0.095, 0.70, 0.75) * lampGlow * lampGlow * (0.2 + 0.8 * facingLamp);
            vec2 aperture = uLocal.xz - vec2((14.6 - uH) * 0.27, (14.6 - uH) * 0.09);
            float shaft = exp(-dot(aperture, aperture) * 0.022);
            vec3 key = vec3(0.60, 0.49, 0.38) * shaft * (0.38 + 0.62 * max(uN.y, 0.0));
            float trimLight = max(0.0, dot(uN, normalize(vec3(-0.7, 0.36, 0.58))));
            vec3 uSky = vec3(0.21, 0.25, 0.28) * (0.45 + 0.43 * uN.y + 0.63 * trimLight);
            vec3 bounce = vec3(0.20, 0.12, 0.050) * (1.0 - smoothstep(0.0, 19.0, uRadius));
            if (uLocal.x < -16.0) {
              // A broad cave key and an amber grazing fill separate worn gold from blue stone.
              key += vec3(0.35, 0.32, 0.28) * max(0.0, dot(uN, normalize(vec3(0.54, 0.78, -0.22))));
              bounce += vec3(0.13, 0.085, 0.046) * max(0.0, dot(uN, normalize(vec3(0.8, 0.26, 0.45))));
            }
            outgoingLight = outgoingLight * 0.54 + diffuseColor.rgb * (uLit + uSky + key + bounce);
            ${kind === 'paving' || kind === 'roadPaving' ? `
              vec3 reflectRay = reflect(-normalize(uEye-vU), uN);
              float wash = pow(max(dot(reflectRay, normalize(vec3(-0.2, 0.9, 0.37))), 0.0), 10.0);
              outgoingLight += wash * shaft * vec3(0.16, 0.14, 0.115)
                + vec3(0.027, 0.20, 0.22) * facingLamp * lampGlow * lampGlow * (1.0 - roughnessFactor);
              ${kind === 'roadPaving' ? `
                float glancing = pow(max(0.0,dot(reflectRay, normalize(vec3(0.59, 0.72, -0.36)))), 13.0);
                outgoingLight += glancing * (1.0-roughnessFactor) * vec3(0.24,0.20,0.14);
              ` : ''}
            ` : ''}
            ${kind === 'lamp' || kind === 'roadLamp' ? `
              float orb = ${lampMask};
              float facets = dot(diffuseColor.rgb, vec3(0.30, 0.40, 0.30));
              outgoingLight = mix(outgoingLight, ${kind === 'roadLamp' ? 'vec3(.014,.51,.48)' : 'vec3(.015,.75,.62)'}
                * (0.62 + facets * 0.55), orb * 0.78);
            ` : ''}
            float travel = length(vU-uEye);
            float groundMist = exp(-max(uH + 13.0, 0.0) * 0.057);
            vec3 fog = mix(vec3(0.013, 0.031, 0.046), vec3(0.034, 0.136, 0.164), groundMist);
            float fade = 1.0 - exp(-travel * mix(0.0045, 0.0105, groundMist));
            ${kind === 'shell' ? `
              vec3 direction = normalize(vU-uEye);
              vec2 veil=direction.xz*.75+direction.y*vec2(.44,.23);
              float cloud=texture2D(uCaveNoise,veil).r;
              float fringe=texture2D(uCaveNoise,veil*1.65+.36).r;
              float horizon = exp(-max(direction.y+0.19,0.0)*3.1);
              float strata = smoothstep(0.22,0.84,cloud*0.78+fringe*0.22);
              outgoingLight = vec3(0.005,0.019,0.030) +
                vec3(0.021,0.126,0.165)*horizon*(0.13+0.96*strata);
              float shaftCap = pow(max(0.0, dot(direction, normalize(vec3(0.4,0.75,-0.28)))), 18.0);
              outgoingLight += vec3(0.040,0.19,0.24)*shaftCap;
              fade = 0.0;
            ` : ''}
            outgoingLight = mix(outgoingLight, fog, fade * 0.89);
            #include <opaque_fragment>`);
      };
      return material;
    }

    function scenicMaterial(map, waterfall = false, terrain = false) {
      return new T.ShaderMaterial({side:T.FrontSide,
        uniforms:{uW2L:transform,uFlowTime:flowTime,atlas:{value:map},isFall:{value:waterfall?1:0},
          rockNoise:{value:caveNoise},dock:{value:new T.Vector3(A.x,A.y,A.z)}},
        vertexShader:`uniform mat4 uW2L; uniform vec3 dock;
          varying vec2 vAtlas; varying vec3 vLocal; varying vec3 vCave;
          void main(){
            vAtlas=uv;
            vec4 p=vec4(position,1.);
            vec3 n=normal;
            #ifdef USE_INSTANCING
              p=instanceMatrix*p;
              mat3 basis=mat3(instanceMatrix);
              n=normalize(basis*(n/vec3(dot(basis[0],basis[0]),dot(basis[1],basis[1]),dot(basis[2],basis[2]))));
            #endif
            vec4 local=uW2L*modelMatrix*p;
            vec3 eye=(uW2L*vec4(cameraPosition,1.)).xyz;
            vLocal=local.xyz-dock;
            vCave.x=.28+.49*max(0.,dot(n,normalize(vec3(-.46,.69,.45))))+.24*max(0.,n.y);
            vCave.y=length(eye-local.xyz);
            vCave.z=.5+.31*sin(vLocal.x*.09+vLocal.y*.18)*sin(vLocal.z*.12-vLocal.y*.087)
              +.19*sin(vLocal.z*.063+vLocal.x*.053);
            gl_Position=projectionMatrix*modelViewMatrix*p;
          }`,
        fragmentShader:`uniform sampler2D atlas,rockNoise; uniform float uFlowTime,isFall;
          varying vec2 vAtlas; varying vec3 vLocal; varying vec3 vCave;
          void main(){
            ${terrain ? `
              vec2 seamUV=vec2(vLocal.x*.067+vLocal.z*.087,vLocal.y*.025+vLocal.z*.014);
              float seam=texture2D(rockNoise,seamUV).r;
              float layers=texture2D(rockNoise,vec2(vLocal.x*.033-vLocal.z*.021,vLocal.y*.073+seam*.18)).r;
              vec3 grain=texture2D(atlas,vec2(vLocal.x+vLocal.z*.78,vLocal.y*.88-vLocal.z*.54)*.18).rgb;
              float stone=smoothstep(.19,.81,seam*.47+layers*.53);
              vec3 color=mix(vec3(.006,.013,.019),vec3(.038,.050,.055),stone);
              color=(color+grain*vec3(.10,.17,.18))*(.29+.82*vCave.x);
            ` : `
            vec3 color=texture2D(atlas,vAtlas).rgb;
            float wet=smoothstep(.024,.17,min(color.g,color.b)-color.r*1.1);
            float flow=.72+.16*sin(vLocal.y*.94+uFlowTime*4.4+vLocal.x*.37)
              +.12*sin(vLocal.y*2.10+uFlowTime*8.7+vLocal.z*1.8);
            color=color*(vCave.x*vec3(.48,.60,.69)+wet*flow*vec3(.07,.28,.34));
            color+=isFall*vec3(.013,.16,.21)*flow*(.2+.8*wet);
            `}
            float depth=1.-smoothstep(-52.,-8.,vLocal.y);
            float haze=clamp(1.-exp(-vCave.y*(.0030+.0030*depth))+.10*depth*vCave.z,0.,.90);
            vec3 mist=mix(vec3(.010,.028,.045),vec3(.027,.088,.116),depth*(.44+.56*vCave.z));
            gl_FragColor=vec4(mix(color,mist,haze),1.);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`});
    }

    // ---- geometry batches (one draw per material) --------------------------
    const batches = new Map();
    function add(kind, geometry, unwrap = false) {
      const g = geometry.index ? geometry.toNonIndexed() : geometry;
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!batches.has(kind)) batches.set(kind, { position: [], normal: [], uv: [] });
      const b = batches.get(kind);
      b.position.push(...g.attributes.position.array);
      b.normal.push(...g.attributes.normal.array);
      const { position, normal, uv } = g.attributes;
      for (let i = 0; i < position.count; i++) {
        if (unwrap) b.uv.push(uv.getX(i), uv.getY(i));
        else {
          const x = position.getX(i) - A.x, y = position.getY(i) - A.y, z = position.getZ(i) - A.z;
          const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i)), nz = Math.abs(normal.getZ(i));
          const tileSize = kind === 'paving' ? 4.6 : kind.startsWith('road') ? 2.65 : 3.4;
          b.uv.push((nx > Math.max(ny, nz) ? z : x) / tileSize, (ny > Math.max(nx, nz) ? z : y) / tileSize);
        }
      }
      geometry.dispose();
      if (g !== geometry) g.dispose();
    }
    const at = (geometry, x, y, z, rx = 0, ry = 0, rz = 0) => {
      geometry.rotateX(rx).rotateZ(rz).rotateY(ry);
      return geometry.translate(...L(x, y, z));
    };
    function box(kind, x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0, unwrap = false) {
      add(kind, at(new T.BoxGeometry(sx, sy, sz), x, y, z, rx, ry, rz), unwrap);
    }
    function cyl(kind, x, y, z, top, bottom, h, seg = 32, open = false, repeat = 0) {
      const g = new T.CylinderGeometry(top, bottom, h, seg, 1, open);
      if (repeat) {
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * repeat);
      }
      add(kind, at(g, x, y, z), repeat > 0);
    }
    function ringTop(kind, x, y, z, r0, r1, seg = 64) {
      add(kind, at(new T.RingGeometry(r0, r1, seg, 1), x, y, z, -Math.PI / 2));
    }
    function inlay(kind, r0, r1, y, repeat = 1, x = 0, z = 0, segments = 144) {
      const points = [], uv = [], index = [];
      for (let i = 0; i <= segments; i++) {
        const t = i / segments, a = t * tau;
        for (const [r, v] of [[r0, 0], [r1, 1]]) {
          points.push(...L(x + Math.cos(a) * r, y, z + Math.sin(a) * r));
          uv.push(t * repeat, v);
        }
        if (i) { const k = i * 2; index.push(k - 2, k, k - 1, k - 1, k, k + 1); }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(points, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      g.setIndex(index);
      add(kind, g, true);
    }
    const solid = (x0, x1, y0, y1, z0, z1, player = true) => {
      const [a, b, c] = L(x0, y0, z0), [d, e, f] = L(x1, y1, z1);
      hit(Math.min(a, d), Math.max(a, d), Math.min(b, e), Math.max(b, e), Math.min(c, f), Math.max(c, f), player);
    };
    function face(kind, points, coords) {
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(points.flatMap(point => L(...point)), 3));
      if (coords) geometry.setAttribute('uv', new T.Float32BufferAttribute(coords, 2));
      const index = [];
      for (let i = 1; i < points.length - 1; i++) index.push(0, i, i + 1);
      geometry.setIndex(index);
      add(kind, geometry, Boolean(coords));
    }
    function panel(kind, points, u = 1) {
      face(kind, points, [0, 0, u, 0, u, 1, 0, 1]);
    }

    // The bridges enter the discs at the same elevation. Cut their top faces
    // against the actual disc edges, and build each inlay into the floor plane.
    const deckTops = [], platformEdges = [];
    function excludeDisc(patch, disc) {
      const pieces = [];
      let inside = patch;
      for (let i = 0; inside.length >= 3 && i < disc.length; i++) {
        const [x, z] = disc[i], [nx, nz] = disc[(i + 1) % disc.length];
        const signed = p => (nx - x) * (p[1] - z) - (nz - z) * (p[0] - x);
        const outer = [], inner = [];
        for (let j = 0; j < inside.length; j++) {
          const p = inside[j], q = inside[(j + 1) % inside.length];
          const a = signed(p), b = signed(q);
          (a >= 0 ? inner : outer).push(p);
          if ((a >= 0) !== (b >= 0)) {
            const cross = [T.MathUtils.lerp(p[0],q[0],a/(a-b)), T.MathUtils.lerp(p[1],q[1],a/(a-b))];
            inner.push(cross);
            outer.push(cross);
          }
        }
        if (outer.length >= 3) pieces.push(outer);
        inside = inner;
      }
      return pieces;
    }
    function queueTreads(x0,z0,x1,z1,y,width,bands) {
      const run = Math.hypot(x1-x0,z1-z0), dx=(x1-x0)/run, dz=(z1-z0)/run;
      const point = (s,t) => [x0+s*dx+t*dz,z0+s*dz-t*dx];
      let edge=-width/2;
      for (const [lo,hi,kind,period] of [...bands,[width/2,width/2]]) {
        if(lo>edge) deckTops.push({y,kind:'roadFloor',points:[point(0,edge),point(run,edge),point(run,lo),point(0,lo)]});
        if(kind) {
          const repeat=Math.max(1,Math.round(run/period));
          const uv=([x,z])=>[
            ((x-x0)*dx+(z-z0)*dz)*repeat/run,
            ((x-x0)*dz-(z-z0)*dx-lo)/(hi-lo)
          ];
          deckTops.push({y,kind,uv,points:[point(0,lo),point(run,lo),point(run,hi),point(0,hi)]});
        }
        edge=hi;
      }
    }
    function addPlatformEdge(x,y,z,radius,count) {
      platformEdges.push({x,y,z,radius,disc:Array.from({length:count},(_,i)=>[
        x+Math.cos(i*tau/count)*radius,z+Math.sin(i*tau/count)*radius
      ])});
    }
    function finishDeckTops() {
      for (const {y,kind,points,uv} of deckTops) {
        let pieces=[points];
        for (const {x,y:level,z,radius,disc} of platformEdges) {
          if (y!==level || [0,1].some((axis)=>{
            const center=axis===0?x:z;
            return points.every(p=>p[axis]<center-radius) || points.every(p=>p[axis]>center+radius);
          })) continue;
          pieces=pieces.flatMap(piece=>excludeDisc(piece,disc));
        }
        for (const piece of pieces) face(kind,piece.map(([x,z])=>[x,y,z]),uv && piece.flatMap(uv));
      }
    }

    function slab(x,y,z,sx,thick,sz) {
      const geometry=new T.BoxGeometry(sx,thick,sz);
      const index=geometry.index.array;
      // The top is emitted once by finishDeckTops, with no offset decals.
      geometry.setIndex([...index.subarray(0,12),...index.subarray(18)]);
      geometry.clearGroups();
      add('roadStone',at(geometry,x,y-thick/2,z));
    }

    function railing(x0,z0,x1,z1,y0,y1,height,radial) {
      const run=Math.hypot(x1-x0,z1-z0), yaw=Math.atan2(z0-z1,x1-x0);
      const sides=radial || [[(z1-z0)/run,(x0-x1)/run],[(z1-z0)/run,(x0-x1)/run]];
      const corner=(end,offset,elevation)=>end
        ? [x1+sides[1][0]*offset,y1+elevation,z1+sides[1][1]*offset]
        : [x0+sides[0][0]*offset,y0+elevation,z0+sides[0][1]*offset];
      const repeat=Math.max(1,Math.round(run/3.30));
      for (const [lo,hi,half,kind] of [[0,.15,.30,'roadTrim'],[.15,height-.17,.245,'roadRail'],[height-.17,height,.305,'roadTrim']]) {
        const a=corner(0,half,lo), b=corner(1,half,lo), c=corner(1,half,hi), d=corner(0,half,hi);
        const e=corner(0,-half,lo), f=corner(1,-half,lo), g=corner(1,-half,hi), h=corner(0,-half,hi);
        if(kind==='roadRail') {
          panel(kind,[b,a,d,c],repeat);
          panel(kind,[e,f,g,h],repeat);
        } else {
          face(kind,[b,a,d,c]); face(kind,[e,f,g,h]);
          face(kind,[h,g,c,d]); face(kind,[a,b,f,e]);
        }
        face('roadTrim',[a,e,h,d]); face('roadTrim',[f,b,c,g]);
      }
      const bays=Math.max(1,Math.round(run/3.3));
      for(let i=0;i<bays;i++){
        const t=i/bays, px=T.MathUtils.lerp(x0,x1,t), py=T.MathUtils.lerp(y0,y1,t), pz=T.MathUtils.lerp(z0,z1,t);
        box('roadStone',px,py+height*.50,pz,.47,height,.65,yaw);
        box('roadTrim',px,py+height+.09,pz,.57,.18,.74,yaw);
      }
    }
    // Low parapet, open at the road. The Anchorage retains its radius and
    // height with open balusters between the sill and the handrail.
    function parapet(x, y, z, r, gaps, height = 1.0, harbor = false) {
      const segments = Math.max(12, Math.round(r * 2.2));
      for (let i = 0; i < segments; i++) {
        const a = (i + 0.5) * tau / segments;
        if (gaps.some(([h, w]) => Math.abs(Math.atan2(Math.sin(a - h), Math.cos(a - h))) < w)) continue;
        const len = 2 * r * Math.sin(Math.PI / segments) + 0.05;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (harbor) {
          box('paving', px, y + 0.13, pz, 0.65, 0.26, len, -a);
          box('paving', px, y + height - 0.12, pz, 0.6, 0.24, len, -a);
          for (const shift of [-0.33, 0, 0.33]) {
            const t = a + shift * tau / segments;
            cyl('paving', x + Math.cos(t) * r, y + 0.50, z + Math.sin(t) * r, 0.19, 0.23, 0.66, 7);
          }
          const dx = 0.26 + Math.abs(Math.sin(a)) * len * 0.48;
          const dz = 0.26 + Math.abs(Math.cos(a)) * len * 0.48;
          solid(px - dx, px + dx, y, y + height, pz - dz, pz + dz, false);
        } else {
          const a0=i*tau/segments, a1=(i+1)*tau/segments;
          const n0=[Math.cos(a0),Math.sin(a0)], n1=[Math.cos(a1),Math.sin(a1)];
          railing(x+n0[0]*r,z+n0[1]*r,x+n1[0]*r,z+n1[1]*r,y,y,height,[n0,n1]);
        }
        if (harbor && i % 2 === 0) box('paving', px, y + height + 0.12, pz, 0.75, 0.24, 0.75, -a);
      }
    }
    // Straight deck with side parapets (x- or z-aligned).
    function deck(x0, z0, x1, z1, y0, y1, width, thick, rails = true) {
      const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      const len = Math.hypot(x1 - x0, z1 - z0);
      const pitch = Math.atan2((y1-y0)*Math.sign(alongX ? x1-x0 : z1-z0),len);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, cy = (y0 + y1) / 2;
      const tilt = alongX ? [0, 0, pitch] : [-pitch, 0, 0];
      const sx = alongX ? len / Math.cos(pitch) : width, sz = alongX ? width : len / Math.cos(pitch);
      if (!rails) {
        const stringer=new T.BoxGeometry(sx,thick,sz).translate(0,-thick/2,0);
        add('roadStone',at(stringer,cx,cy,cz,tilt[0],0,tilt[2]));
        return;
      }
      slab(cx,y0,cz,sx,thick,sz);
      const edge=width/2-.73, center=Math.min(width*.25,1.48)/2;
      queueTreads(x0,z0,x1,z1,y0,width,[
        [-edge-.075,-edge+.075,'roadEdge',3], [-center,center,'roadStars',1.58], [edge-.075,edge+.075,'roadEdge',3]
      ]);
      for (const side of [-1,1]) {
        const ox=alongX?0:side*(width/2-.27), oz=alongX?side*(width/2-.27):0;
        railing(x0+ox,z0+oz,x1+ox,z1+oz,y0,y1,1);
      }
    }
    // The staircase collision remains a ramp. The stone treads and noses are
    // level, with the gold band in the same plane as each tread.
    function steps(x0,z0,x1,z1,y0,y1,width,count) {
      const dx=x1-x0, dz=z1-z0, length=Math.hypot(dx,dz);
      const alongX=Math.abs(dx)>Math.abs(dz), run=length/count, treadWidth=width-1.0;
      deck(x0,z0,x1,z1,y0-.32,y1-.32,width,1.65,false);
      const rx=dx/length, rz=dz/length;
      for (let i=0;i<count;i++){
        const t=(i+.5)/count, y=T.MathUtils.lerp(y0,y1,t);
        const x=x0+dx*t, z=z0+dz*t;
        slab(x,y,z,alongX?run+.002:treadWidth,1.1,alongX?treadWidth:run+.002);
        queueTreads(x-rz*treadWidth/2,z+rx*treadWidth/2,
          x+rz*treadWidth/2,z-rx*treadWidth/2,y,run,[[-run/2+.014,-run/2+.078,'roadEdge',2.9]]);
      }
      for (const side of [-1,1]) {
        const ox=alongX?0:side*(width/2-.27), oz=alongX?side*(width/2-.27):0;
        railing(x0+ox,z0+oz,x1+ox,z1+oz,y0-.36,y1-.36,1.36);
      }
    }

    // Closed spandrel geometry with an open arch at the bottom and a stone rim.
    function vault(x, z, top, w, height, depth, yaw = 0) {
      const r = Math.min(w * 0.37, height * 0.62), spring = height - r - 0.7;
      const shape = new T.Shape();
      shape.moveTo(-w/2,0); shape.lineTo(-r,0); shape.lineTo(-r,spring);
      shape.absarc(0,spring,r,Math.PI,0,true);
      shape.lineTo(r,0); shape.lineTo(w/2,0); shape.lineTo(w/2,height); shape.lineTo(-w/2,height); shape.closePath();
      const geometry = new T.ExtrudeGeometry(shape, {depth, bevelEnabled:false, curveSegments:9}).translate(0,0,-depth/2);
      add('roadStone', at(geometry,x,top-height,z,0,yaw));
      for (const side of [-1,1]) {
        const rim = new T.RingGeometry(r,r+.26,14,1,0,Math.PI);
        if (side<0) rim.rotateY(Math.PI);
        rim.translate(0,spring,side*(depth/2+.012));
        add('roadTrim', at(rim,x,top-height,z,0,yaw));
      }
    }

    const pierFootings=[];
    function pier(x, y, z, width, depth, height, yaw = 0) {
      box('roadStone',x,y-(height+.58)/2,z,width,height-.58,depth,yaw);
      box('roadTrim',x,y-.29,z,width+.30,.58,depth+.26,yaw);
      box('roadTrim',x,y-1.18,z,width+.15,.24,depth+.16,yaw);
      pierFootings.push([x,y-height+.7,z,width*1.37,depth*1.33,yaw]);
    }

    function platform(x, y, z, radius, depth, medallion, piers = 0) {
      const count = radius > 10 ? 80 : 48;
      addPlatformEdge(x,y,z,radius,count);
      const upper=.22, lower=.24, fascia=depth-upper-lower;
      cyl('roadTrim',x,y-upper/2,z,radius,radius+.09,upper,count,true);
      cyl('roadRelief',x,y-upper-fascia/2,z,radius+.09,radius+.09,fascia,count,true,Math.round(tau*radius/(depth*2)));
      cyl('roadTrim',x,y-depth+lower/2,z,radius+.09,radius+.12,lower,count,true);
      add('roadStone',at(new T.CircleGeometry(radius+.12,count),x,y-depth,z,Math.PI/2));
      add('roadMedallion',at(new T.CircleGeometry(medallion,count),x,y,z,-Math.PI/2),true);
      const rings=radius>10?[[12.82,13.55,'roadStars',28],[13.55,13.70,'roadEdge',28]]:[];
      rings.push([radius-.62,radius-.47,'roadEdge',Math.round(tau*radius/2.9)]);
      let rim=medallion;
      for(const [inner,outer,kind,repeat] of rings){
        if(inner>rim) ringTop('roadFloor',x,y,z,rim,inner,count);
        inlay(kind,inner,outer,y,repeat,x,z,count);
        rim=outer;
      }
      ringTop('roadFloor',x,y,z,rim,radius,count);
      if (!piers) {
        pier(x,y-depth,z,radius*.64,radius*.78,23);
        return;
      }
      platformSupport(x,y-depth,z,radius,piers);
    }

    function platformSupport(x,top,z,radius,piers) {
      const ring = radius*.80, width = 2*ring*Math.sin(Math.PI/piers), inset=ring*Math.cos(Math.PI/piers);
      const archHeight = radius>10 ? 12 : 7.0;
      for (let i=0;i<piers;i++) {
        const a=i*tau/piers, b=a+Math.PI/piers;
        pier(x+ring*Math.cos(a),top,z+ring*Math.sin(a),1.9,2.2,31,b);
        vault(x+inset*Math.cos(b),z+inset*Math.sin(b),top+.08,width+.1,archHeight,1.65,-b-Math.PI/2);
      }
    }

    // ---- U1-01 Anchorage of Souls -----------------------------------------
    cyl('paving', 0, -1.5, 0, 17, 17, 3, 72);
    addPlatformEdge(0,0,0,17,72);
    platformSupport(0,-3,0,17,8);
    const plinths = [];
    // Wrap the carved friezes around the *vertical* face of each step.
    // A single motif spans 24–30 cm, in proportion to the 19–20 cm riser.
    DAIS.forEach(([r, y], i) => {
      const lower = DAIS[i + 1]?.[1] ?? 0;
      const frieze = i === 1 ? 'daisBorder' : 'daisGold';
      const repeats = Math.round(tau * r / (i === 1 ? 1.38 : 1.31));
      ringTop('paving', 0, y, 0, i === 0 ? 2.42 : r - 0.27, r, 120);
      inlay('daisBorder', r - 0.105, r - 0.036, y + 0.005, 18);
      cyl(frieze, 0, (y + lower) / 2, 0, r, r, y - lower, 120, true, repeats);
      cyl('daisLip', 0, y - 0.012, 0, r + 0.014, r + 0.014, 0.024, 120, true);
    });
    cyl('paving', 0, 0.13, 0, 2.42, 2.42, 0.9, 48, true);
    inlay('floorInlay', 11.63, 13.14, 0.009, 2);

    // Keep each stone column under its existing roof bearing.
    for (let i = 0; i < 10; i++) {
      const a = i * tau / 10;
      if (i === 5) continue;
      const x = Math.cos(a) * 14.2, z = Math.sin(a) * 14.2;
      plinths.push([x, 0, z, Math.PI - a]);
      const shaft = 0.98 * (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)));
      solid(x - shaft, x + shaft, 0, 12.59, z - shaft, z + shaft);
      solid(x - 1.22, x + 1.22, 0, 1.25, z - 1.22, z + 1.22);
    }
    for (const [x, y, z] of LAMPS) solid(x - 0.53, x + 0.53, y, y + 1.62, z - 0.53, z + 0.53);
    for (let i = 0; i < 30; i++) {
      const a = (i + 0.5) * tau / 30;
      box('roofStone', Math.cos(a) * 14.2, 13.2, Math.sin(a) * 14.2, 1.8, 1.2, 2 * 14.2 * Math.sin(Math.PI / 30) + 0.06, -a);
    }
    cyl('roofBand', 0, 13.2, 0, 13.235, 13.235, 1.20, 120, true, 6);
    // Finish the vault, original ribs and shaft without moving them.
    const ceiling = lift.arrivalVault;
    const shape = new T.Shape().absarc(0, 0, 18.5, 0, tau, false);
    shape.holes.push(new T.Path().absarc(0, 0, 3.7, 0, tau, true));
    const roofVault = new T.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: false, curveSegments: 48 });
    add('roofStone', roofVault.rotateX(-Math.PI / 2).translate(...L(0, ceiling + 0.05, 0)));
    cyl('roofStone', 0, ceiling + 6, 0, 3.7, 3.7, 12, 64, true);
    cyl('roofOculus', 0, ceiling + 0.35, 0, 3.68, 3.68, 0.56, 96, true, 3);
    const collar = new T.RingGeometry(3.66, 4.24, 96).rotateX(Math.PI / 2).translate(...L(0, ceiling + 0.03, 0));
    add('roofBand', collar);
    for (let i = 0; i < 12; i++) {
      const a = i * tau / 12;
      box('roofRib', Math.cos(a) * 9, ceiling - 0.25, Math.sin(a) * 9, 11, 0.5, 0.7, -a, 0, 0, true);
    }
    parapet(0, 0, 0, 16.6, [[Math.PI, 0.2]], 1.0, true);

    // ---- U1-02: the existing walks, landings and turns --------------------
    deck(-16.0, 0, -36.2, 0, 0, 0, 6.2, 1.6);
    for(const x of [-17.2,-26.1,-35.1]) pier(x,-1.6,0,1.75,6.15,32);
    for(const x of [-21.65,-30.6]) vault(x,0,-1.54,8.9,10,5.95);
    platform(-42,0,0,7,2,4.82,6);
    parapet(-42,0,0,6.65,[[0,.50],[Math.PI/2,.30],[-Math.PI/2,.45]]);
    // Carved terminus at the original guardian reservation, with the same footprint.
    box('roadStone',-46.6,2.2,0,1.48,4.4,1.88);
    box('roadTrim',-46.6,4.31,0,1.69,.28,2.1);
    panel('roadPalms',[[-45.854,.52,1.0],[-45.854,.52,-1.0],[-45.854,3.89,-1.0],[-45.854,3.89,1.0]]);
    solid(-47.8,-45.4,0,5.3,-1.2,1.2);

    deck(-42,5.8,-42,10.3,0,0,3.4,1.2);
    platform(-42,0,13,3.7,1.2,2.49);
    parapet(-42,0,13,3.6,[[-Math.PI/2,.50]]);
    steps(-42,-5.8,-42,-21.4,0,-6,5.6,30);
    pier(-42,-5.0,-11.28,3.1,2.7,25);
    pier(-42,-7.6,-18.0,3.2,2.6,29);
    platform(-42,-6,-26,5.6,2,3.68,5);
    parapet(-42,-6,-26,5.35,[[Math.PI/2,.60],[Math.PI,.65]]);
    // The long bridge keeps the authored 46 m straight run and existing footing rhythm.
    deck(-46.2,-26,-92.3,-26,-6,-6,6.4,1.4);
    for (let x=-48.5; x>-92; x-=9) {
      pier(x,-7.4,-26,2.5,6.25,39);
      if (x-9>-93) vault(x-4.5,-26,-7.31,9,12.7,6.1);
    }
    platform(-98,-6,-26,6.5,2,4.36,6);
    parapet(-98,-6,-26,6.25,[[0,.50],[Math.PI,.50],[-Math.PI/2,.30]]);
    deck(-98,-31.9,-98,-35.4,-6,-6,3.4,1.2);
    platform(-98,-6,-38.5,3.7,1.2,2.49);
    parapet(-98,-6,-38.5,3.6,[[Math.PI/2,.50]]);
    steps(-103.9,-26,-121.4,-26,-6,-9,6.2,14);
    pier(-108,-9.0,-26,2.5,5.8,29);
    pier(-117,-10.6,-26,2.5,5.8,31);
    vault(-112.5,-26,-10.68,9.1,10.3,5.35);

    // ---- U1-03: court, authored gate and its short landing ---------------
    platform(-139,gateFloor,gateZ,19,3,11.1,10);
    parapet(-139,gateFloor,gateZ,18.7,[[0,.18],[Math.PI,.62]]);
    // Seat the whole gate, including its return walls, on the existing court.
    // The matching stone plinth runs along both fortifications above the void.
    slab(-163,gateFloor,gateZ,17.2,3,59);
    queueTreads(-154.4,gateZ,-171.6,gateZ,gateFloor,59,[]);
    for (const side of [-1,1]) {
      const wingZ = gateZ + side*14.6;
      pier(-160,gateFloor-3,wingZ,8.6,8.2,32);
      pier(-166,gateFloor-3,gateZ+side*24,7,7,31);
      const near = gateZ + side*3.82, far = gateZ + side*31;
      solid(gateX-6.2,gateX+1.38,gateFloor,gateFloor+17,near,far);
      // Low rails continue behind the jambs and tie into the court's rim.
      railing(-154.25,gateZ+side*11.15,-167.5,gateZ+side*11.3,gateFloor,gateFloor,1.05);
      solid(-167.5,-154.25,gateFloor,gateFloor+1.05,gateZ+side*11.05,gateZ+side*11.6,false);
    }
    railing(gateBack-.32,gateZ-11.3,gateBack-.32,gateZ+11.3,gateFloor,gateFloor,1.05);
    solid(gateBack-.65,gateBack,gateFloor,gateFloor+2.6,gateZ-11.65,gateZ+11.65);
    for (const [x,y,z] of GUARDIANS) solid(x-2.8,x+2.8,y,y+6.65,z-2.8,z+2.8);
    for (const [x,y,z] of BRAZIERS) {
      const h=lampBase(x,z);
      box('roadStone',x,y+h*.47,z,.82,h*.94,.82);
      box('roadTrim',x,y+h-.065,z,.92,.13,.92);
      solid(x-.43,x+.43,y,y+h+1.52,z-.43,z+.43);
    }

    // Engaged portal columns have masonry foundations outside the walkable span.
    const roadColumns = [];
    for (const side of [-1,1]) {
      const z=side*3.54;
      pier(-17.38,0,z,2.62,2.0,13);
      roadColumns.push([-17.38,0,z,6.4,side*Math.PI/2]);
      solid(-18.17,-16.59,0,6.4,z-.64,z+.64);
      roadColumns.push([-130.1,-9,-26+side*11.8,7.7,side*Math.PI/2]);
      solid(-131.02,-129.18,-9,-1.3,-26+side*11.8-.93,-26+side*11.8+.93);
    }

    finishDeckTops();

    // ---- cavern and shared U1 materials -----------------------------------
    const shell = new T.SphereGeometry(330, 32, 16).scale(1, 0.55, 1);
    add('cavern', at(shell, -70, 20, -26));
    const materials = new Map();
    const surfaces = {
      paving: [0xd2cdc5, 0.76, 'paving'], daisGold: [0xffe2aa, 0.64, 'dais-gold'],
      daisBorder: [0xeccb9e, 0.66, 'dais-border'], floorInlay: [0xf3e2ca, 0.62, 'floor-inlay'],
      roofStone: [0xb8bec8, 0.88, 'roof-stone'], roofBand: [0xd5be9b, 0.82, 'roof-band'],
      roofRib: [0xe5c494, 0.76, 'roof-rib'], roofOculus: [0xd7c8b4, 0.78, 'roof-oculus'],
      roadFloor: [0xd2d5dc,.78,'road-stone'], roadStone: [0xa8b2c1,.87,'road-stone'],
      roadTrim: [0xcbbb9f,.81,'road-stone'],
      roadStars: [0xffecca,.66,'road-stars'], roadEdge: [0xffedc4,.76,'road-edge'],
      roadMedallion: [0xfdf2df,.74,'road-medallion'], roadRail: [0xffecd1,.80,'road-rail'],
      roadRelief: [0xfae9cd,.84,'road-relief'],
      roadPalms: [0xf8ebd5,.81,'road-palms']
    };
    const colours = { cavern: 0x2c323c, daisLip: 0x77624a };
    for (const [kind, data] of batches) {
      const geometry = new T.BufferGeometry();
      const count = data.position.length / 3;
      const packed = new Float32Array(count * 8);
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < 3; k++) {
          packed[i * 8 + k] = data.position[i * 3 + k];
          packed[i * 8 + 3 + k] = data.normal[i * 3 + k];
        }
        packed[i * 8 + 6] = data.uv[i * 2];
        packed[i * 8 + 7] = data.uv[i * 2 + 1];
      }
      const buffer = new T.InterleavedBuffer(packed, 8);
      geometry.setAttribute('position', new T.InterleavedBufferAttribute(buffer, 3, 0));
      geometry.setAttribute('normal', new T.InterleavedBufferAttribute(buffer, 3, 3));
      geometry.setAttribute('uv', new T.InterleavedBufferAttribute(buffer, 2, 6));
      geometry.computeBoundingSphere();
      const [color, roughness] = surfaces[kind] || [colours[kind], 0.94];
      const material = finish(new T.MeshStandardMaterial({ color, roughness, metalness: 0,
          side: kind === 'cavern' ? T.BackSide : (kind.startsWith('roof') || ['roadFloor','roadMedallion','roadStars','roadEdge'].includes(kind)) ? T.DoubleSide : T.FrontSide }),
        kind === 'cavern' ? 'shell' : ['paving','roadFloor','roadStars','roadMedallion'].includes(kind)
          ? (kind==='paving' ? 'paving' : 'roadPaving') : 'stone');
      const mesh = new T.Mesh(geometry, material);
      mesh.name = 'U1_' + kind;
      world.add(mesh);
      materials.set(kind, material);
    }
    const sharedLight = new T.HemisphereLight(0xb1e4ff, 0x455864, 1.40);
    sharedLight.name = 'U1_Cavern_Fill';
    world.add(sharedLight);
    status.batches = batches.size;
    batches.clear();

    let pending;
    const bedHeight=(x,z)=>-120+7*Math.sin(x*.023+z*.032)+5*Math.cos(z*.043-x*.015);

    let encounter = null;
    async function loadEncounterAssets(renderer, decoder) {
      const { KTX2Loader } = await T.loadKTX2Loader();
      const textures = new KTX2Loader().setTranscoderPath('vendor/basis/').setWorkerLimit(2).detectSupport(renderer);
      try {
        const loader = new T.GLTFLoader().setMeshoptDecoder(decoder).setKTX2Loader(textures);
        const paths = [gateAsset];
        if (root.SinGuardianEncounter) paths.push(root.SinGuardianEncounter.asset);
        const [gltf, guardian] = await Promise.all(paths.map(path => loader.loadAsync(root.__sinAsset?.(path) || encodeURI(path))));
        gate = mountGate(gltf);
        status.gate = gate.state;
        return guardian;
      } finally {
        textures.dispose();
      }
    }

    function mountGate({ scene: model, animations }) {
      const clip = animations.find(clip => clip.name === 'Arkila_Gate_Open');
      const sign = [-1, 1];
      const hinges = ['Left', 'Right'].map(side => model.getObjectByName(side + '_Door_Vertical_Hinge'));
      if (!clip?.duration || hinges.some(hinge => !hinge)) throw new Error('Missing Irkalla gate animation or hinges');
      const closed = new T.Box3().setFromObject(hinges[0], true).union(new T.Box3().setFromObject(hinges[1], true));
      model.name = 'U1_Authored_Gate';
      model.scale.setScalar(gateScale);
      model.rotation.y = Math.PI / 2;
      model.position.fromArray(L(gateX - hingeDepth * gateScale, gateFloor - .045 * gateScale, gateZ));
      const shared = new Set(), inscriptionMats = new Set();
      const inscriptionColor = new T.Color(0x51cfbb);
      model.traverse(mesh => {
        if (!mesh.isMesh) return;
        if (!shared.has(mesh.material)) {
          finish(mesh.material);
          shared.add(mesh.material);
          if (/Arkila_Inscribed|Arkila_Bronze_Door/.test(mesh.material.name)) {
            inscriptionMats.add(mesh.material);
            if (root.SinGuardianEncounter) mesh.material.emissiveMap = mesh.material.map;
          }
        }
      });
      world.add(model);
      const mixer = new T.AnimationMixer(model);
      const action = mixer.clipAction(clip).setLoop(T.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      action.paused = true;
      // Near the seam the bronze fills this depth through the hand-height band.
      const faceX = gateX + (closed.max.z - hingeDepth) * gateScale;
      const standX = faceX + .52, triggerX = standX + .85;
      const state = { phase: 'closed', time: 0, duration: clip.duration, contactError: null, camera: 0 };
      model.userData.gate = state;
      const palms = sign.map(side => new T.Vector3(-side * 1.19, 1.145 / gateScale, .15));
      const stance = new T.Vector3(), targetPosition = new T.Vector3(), cameraStart = new T.Vector3();
      const heroLocal = new T.Vector3(), collisionPoint = new T.Vector3();
      const cameraFrom = new T.Vector3(), cameraTo = new T.Vector3(), aimFrom = new T.Vector3(), aimTo = new T.Vector3();
      const cameraDirection = new T.Vector3();
      const slabs = sign.map(side => new T.Box3(
        new T.Vector3(Math.min(0, -side * 1.306), 0, -.205),
        new T.Vector3(Math.max(0, -side * 1.306), 3.86, .171)
      ));
      const cameraBounds = new T.Box3();
      const cameraBoxes = hinges.map(() => ({ _wing: true }));
      let needsCameraBoxes = true;
      const facing = Math.PI / 2;
      let hands, elapsed = 0;
      const smooth = t => T.MathUtils.smoothstep(t, 0, 1);
      function pose(time) {
        state.time = Math.min(time, clip.duration);
        action.time = state.time;
        mixer.update(0);
        model.updateWorldMatrix(true, true);
        needsCameraBoxes = true;
      }

      function update(dt, { hero, combat, setFacing, camera }, towardGate) {
        if (state.phase === 'open') return;
        const p = world.worldToLocal(heroLocal.copy(hero.position));
        const x = p.x - A.x, z = p.z - A.z;
        if (state.phase === 'closed') {
          if (!towardGate || x > triggerX || x < faceX || Math.abs(z - gateZ) > .87 ||
              Math.abs(p.y - A.y - gateFloor) > .3 || combat.locked()) return;
          hands = root.SinTempleDoors.armRig(hero);
          state.phase = 'approach';
        }
        if (state.phase === 'approach') {
          world.localToWorld(stance.fromArray(L(standX, gateFloor, gateZ)));
          const distance = Math.hypot(stance.x - hero.position.x, stance.z - hero.position.z);
          if (distance > .018) {
            hero.position.lerp(stance, Math.min(1, 1.45 * dt / distance));
            const turn = Math.atan2(Math.sin(facing - hero.rotation.y), Math.cos(facing - hero.rotation.y));
            setFacing(hero.rotation.y + turn * (1 - Math.exp(-dt * 12)));
            return;
          }
          hero.position.copy(stance);
          setFacing(facing);
          hero.rotation.y = facing;
          if (combat.startPush({ timeScale: 1 })) state.phase = 'reach';
          return;
        }
        const push = combat.pushState();
        if (state.phase === 'reach') {
          if (!push) { state.phase = 'closed'; return; }
          const plant = push.mode === 'enter' ? smooth((push.time / push.duration - .58) / .37) : 1;
          if (plant > 0) state.contactError = hands.plant(targets(), plant);
          if (plant < 1) return;
          state.phase = 'opening';
          cameraStart.copy(camera.position);
          camera.getWorldDirection(cameraDirection);
          aimFrom.copy(camera.position).addScaledVector(cameraDirection, camera.position.distanceTo(hero.position));
          elapsed = 0;
          pose(0);
          return;
        }
        if (state.phase === 'opening') {
          elapsed += dt;
          pose(elapsed);
          state.camera = smooth(elapsed / 2.35);
          if (elapsed <= 1.85) {
            const target = targets();
            // During the initial pressure the body follows the shallow part
            // of the arc. The palms then release as the massive leaves swing.
            const desired = (target[0].x + target[1].x) * .5;
            world.localToWorld(stance.fromArray(L(faceX, gateFloor, gateZ)));
            hero.position.x = stance.x - .52 + T.MathUtils.clamp(desired - stance.x, 0, .22);
            state.contactError = hands.plant(target, 1 - smooth((elapsed - 1.20) / .65));
          }
          if (elapsed >= 1.85 && push && push.mode !== 'out') combat.releasePush();
          if (state.time >= clip.duration) { state.phase = 'return'; elapsed = 0; }
          return;
        }
        if (state.phase === 'return') {
          elapsed += dt;
          if (elapsed >= .85) { state.camera = 0; state.phase = 'open'; }
        }
      }

      function targets() {
        // The actor's left arm reaches across to the asset's right leaf.
        return [1, 0].map(i => hinges[i].localToWorld(palms[i].clone()));
      }
      function frameCamera(camera, safeFollow) {
        if (state.phase !== 'opening' && state.phase !== 'return') return false;
        if (state.phase === 'return') {
          safeFollow();
          cameraFrom.copy(camera.position);
          camera.getWorldDirection(cameraDirection);
          const restore = smooth(elapsed / .85);
          aimFrom.copy(cameraFrom).addScaledVector(cameraDirection, 4.5);
          camera.position.lerpVectors(cameraTo, cameraFrom, restore);
          camera.lookAt(targetPosition.lerpVectors(aimTo, aimFrom, restore));
          return true;
        }
        // One move on contact, away from the hero and upward. The plaza's
        // central axis is clear of the guardian plinths throughout the shot.
        world.localToWorld(cameraTo.fromArray(L(faceX + 16.8, gateFloor + 6.2, gateZ + 3.1)));
        world.localToWorld(aimTo.fromArray(L(gateX + .5, gateFloor + 4.45, gateZ)));
        camera.position.lerpVectors(cameraStart, cameraTo, state.camera);
        camera.lookAt(targetPosition.lerpVectors(aimFrom, aimTo, state.camera));
        return true;
      }
      function blocks(x, z, radius) {
        if (x > faceX + .7 || x < gateX - 4.9 || Math.abs(z - gateZ) > gateHalfWidth + radius) return false;
        return hinges.some((hinge, i) => {
          const point = hinge.worldToLocal(world.localToWorld(collisionPoint.fromArray(L(x, gateFloor + 1, z))));
          return slabs[i].distanceToPoint(point) * gateScale < radius;
        });
      }
      function cameraBoxesAt(x, z) {
        if (Math.abs(x - gateX) > 13 || Math.abs(z - gateZ) > 11) return null;
        if (needsCameraBoxes) {
          model.updateWorldMatrix(true, true);
          hinges.forEach((hinge, i) => {
            const { min, max } = cameraBounds.copy(slabs[i]).applyMatrix4(hinge.matrixWorld);
            Object.assign(cameraBoxes[i], { minx: min.x, miny: min.y, minz: min.z, maxx: max.x, maxy: max.y, maxz: max.z });
          });
          needsCameraBoxes = false;
        }
        return cameraBoxes;
      }
      pose(0);
      return {
        state, model, update, frameCamera, blocks, cameraBoxesAt, restore: () => hands?.restore(),
        encounterPose(fraction, energy = 0) {
          for (const material of inscriptionMats) material.emissive.copy(inscriptionColor).multiplyScalar(.34 * energy);
          pose(Math.min(1, fraction) * clip.duration);
          state.phase = fraction >= 1 ? 'open' : fraction > 0 ? 'opening' : 'closed';
        }
      };
    }

    // A continuous ravine floor and terraced banks hold the authored ruins.
    // Build all the rock at once, with the same fog and no physics bodies.
    function addCanyon(terrain, landmarkFootings) {
      const vertices=[], indices=[];
      const vertex=(x,y,z)=>{vertices.push(...L(x,y,z)); return vertices.length/3-1;};
      function patch(rows, reverse) {
        for(let j=1;j<rows.length;j++) for(let i=1;i<rows[j].length;i++){
          const a=rows[j-1][i-1], b=rows[j][i-1], c=rows[j][i], d=rows[j-1][i];
          if(reverse) indices.push(a,d,b,b,d,c);
          else indices.push(a,b,d,b,c,d);
        }
      }
      const floorRows=Array.from({length:29},(_,i)=>Array.from({length:25},(_,j)=>{
        const x=-284+i*18, z=-220+j*17;
        return vertex(x,bedHeight(x,z),z);
      }));
      patch(floorRows,true);

      function bank(anchors,axis,side) {
        const rows=[];
        const profile=[[0,null],[7,-93],[5,-68],[11,-46],[9,-19],[18,-7],[31,0],[53,-5],[75,3],[104,1],[139,17],[182,39]];
        for(let i=1;i<anchors.length;i++) {
          const [start]=anchors[i-1], [end]=anchors[i];
          const divisions=Math.ceil((end-start)/7);
          for(let k=i===1?0:1;k<=divisions;k++) {
            const t=k/divisions;
            const [along,edge,crest]=anchors[i-1].map((v,j)=>T.MathUtils.lerp(v,anchors[i][j],t));
            const fissure=6.0*Math.sin(along*.071+side)+2.9*Math.sin(along*.23+axis);
            rows.push(profile.map(([offset,level],tier)=>{
              const across=edge+side*(offset+fissure+3.0*Math.sin(along*.15-tier*.89));
              const x=axis===0?along:across, z=axis===0?across:along;
              const height=tier===0?bedHeight(x,z)-3
                :(tier<4?level:crest+level)+4.8*Math.sin(along*.068+tier*.62)+3.4*Math.cos(along*.20-tier*.69);
              return vertex(x,height,z);
            }));
          }
        }
        patch(rows,axis===0?side>0:side<0);
      }
      bank([[-266,36,-4],[-224,25,-12],[-166,30,-12],[-116,27,-21],[-76,23,-19],
        [-42,27,-20],[3,27,-15],[58,23,-12],[109,22,-13],[157,24,-8],[213,12,5]],0,1);
      bank([[-270,-110,-3],[-215,-91,-14],[-163,-57,-17],[-115,-52,-23],[-72,-51,-22],
        [-40,-44,-18],[0,-40,-15],[61,-36,-13],[120,-36,-11],[180,-31,-7],[217,-26,2]],0,-1);
      bank([[-178,142,13],[-103,161,0],[-52,158,-14],[-11,154,-10],[38,146,-13],[97,156,0],[153,141,19]],1,1);
      bank([[-179,-228,6],[-114,-247,0],[-53,-223,-15],[-11,-237,-12],[46,-232,-3],[111,-221,17],[166,-204,22]],1,-1);
      const spine=[[-186,-27,-125,19],[-163,-27,-54,19],[-141,-27,-47,23],[-120,-26,-56,11],
        [-100,-26,-58,14],[-80,-26,-60,12],[-61,-26,-55,13],[-43,-22,-49,14],
        [-41,-4,-51,10],[-24,0,-62,13],[-12,0,-57,12],[12,0,-125,12]];
      const spineRows=spine.map(([x,z,crest,width])=>[-2.7,-1.53,-.68,0,.62,1.65,2.7].map((offset,i)=>{
        const edge=z+offset*width;
        const y=Math.max(bedHeight(x,edge)-2,crest-Math.pow(Math.abs(offset),1.8)*16+Math.cos(x*.49+i)*3);
        return vertex(x,y,edge);
      }));
      patch(spineRows,true);

      function footing([x,top,z,width,depth,yaw]) {
        const bottom=bedHeight(x,z)-8;
        const count=14, angle=x*.108+z*.073, cos=Math.cos(yaw), sin=Math.sin(yaw);
        const levels=[[0,1], [.049,1.07], [.14,.93], [.34,1.11], [.60,1.05], [.82,1.18], [1,1.22]];
        const rows=levels.map(([t,scale],tier)=>Array.from({length:count+1},(_,i)=>{
          const a=(i%count)*tau/count;
          const rough=1+.14*Math.sin(a*3+angle)+.085*Math.cos(a*5-tier*.52+angle)+.06*Math.sin(a*7+tier*.81);
          const u=Math.cos(a)*width*.5*scale*rough, v=Math.sin(a)*depth*.5*scale*rough;
          const y=T.MathUtils.lerp(top,bottom,t)-(tier===0?.20:2.9)*Math.cos(a*3+angle+tier);
          return vertex(x+u*cos+v*sin,y,z-u*sin+v*cos);
        }));
        patch(rows,true);
        const crown=vertex(x,top-.16,z), ring=rows[0];
        for(let i=0;i<count;i++) indices.push(crown,ring[i+1],ring[i]);
      }
      for(const support of [...pierFootings,...landmarkFootings]) footing(support);
      const geometry=new T.BufferGeometry();
      geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      const canyon=new T.Mesh(geometry,terrain);
      canyon.name='U1_Connected_Canyon';
      world.add(canyon);
    }

    async function loadHarbor(renderer, architecture) {
      const textureLoader = new T.TextureLoader();
      const files = 'assets/r3/harbor/';
      const maps = new Map();
      const loadMap = (name, srgb) => {
        if (!maps.has(name)) maps.set(name,textureLoader.loadAsync(files + name + '.webp').then(map => {
          if (srgb) map.colorSpace = T.SRGBColorSpace;
          if (name!=='road-medallion') map.wrapS = map.wrapT = T.RepeatWrapping;
          map.anisotropy = Math.min(name.startsWith('road-') ? 8 : 4, renderer.capabilities.getMaxAnisotropy());
          return map;
        }));
        return maps.get(name);
      };
      // The Maw loader already brings the shared decoder in on normal play.
      if (!root.MeshoptDecoder) await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'vendor/meshopt_decoder.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      const decoder = root.__sinMeshoptWorkers?.(root.MeshoptDecoder, true) || root.MeshoptDecoder;
      const loader = new T.GLTFLoader().setMeshoptDecoder(decoder);
      const loadingMaps = Object.entries(surfaces).map(async ([key, [, , file]]) => {
        const material = materials.get(key);
        material.map = await loadMap(file, true);
        material.needsUpdate = true;
      });
      for (const [key, file] of [['daisGold', 'dais-gold'], ['daisBorder', 'dais-border'], ['roadFloor','road-stone'],
        ['roadStone','road-stone'],['roadTrim','road-stone'],['roadStars','road-stars'],['roadRail','road-rail'],['roadRelief','road-relief']]) {
        loadingMaps.push(loadMap(file + '-normal').then(normal => {
          const frieze = materials.get(key);
          frieze.normalMap = normal;
          frieze.normalScale.setScalar(key.startsWith('road') ? .56 : .82);
          frieze.needsUpdate = true;
        }));
      }
      loadingMaps.push(Promise.all([loadMap('paving-normal'), loadMap('paving-rough')]).then(([normal, rough]) => {
        const paving = materials.get('paving');
        paving.normalMap = normal;
        paving.normalScale.setScalar(0.57);
        paving.roughnessMap = rough;
        paving.needsUpdate = true;
      }));
      loadingMaps.push(loadMap('road-stone-rough').then(rough => {
        for (const key of ['roadFloor','roadStone','roadTrim']) {
          materials.get(key).roughnessMap=rough;
          materials.get(key).needsUpdate=true;
        }
      }));
      const [kit, ruins, guardians, guardian] = await Promise.all([loader.loadAsync(files + 'architecture.glb'),
        loader.loadAsync(files + 'distant-ruins.glb'),loader.loadAsync(files + 'road-guardians.glb'), loadEncounterAssets(renderer, decoder), ...loadingMaps]);
      if (guardian) {
        const [, x, z, , y] = DISCS.find(disc => disc[0] === 'U1-03');
        encounter = root.SinGuardianEncounter.mount({
          T, model: guardian.scene, animations: guardian.animations, world,
          arena: new T.Vector3().fromArray(L(x, y, z)),
          checkpoint: new T.Vector3().fromArray(L(...SPAWNS['U1-03'])),
          gate: () => gate, architecture
        });
      }
      const stamp = new T.Object3D();
      function instance(name, geometry, material, positions, parent=world) {
        const mesh = new T.InstancedMesh(geometry, material, positions.length);
        mesh.name = name;
        positions.forEach(([position, scale, angle], i) => {
          stamp.position.fromArray(position);
          stamp.scale.fromArray(scale);
          if(typeof angle==='number') stamp.rotation.set(0,angle,0);
          else stamp.rotation.set(...angle);
          stamp.updateMatrix();
          mesh.setMatrixAt(i, stamp.matrix);
        });
        mesh.computeBoundingSphere();
        if (parent) parent.add(mesh);
        return mesh;
      }
      function instanceLOD(name, source, low, material, positions, distance) {
        const center = [0,1,2].map(axis=>positions.reduce((sum,[p])=>sum+p[axis],0)/positions.length);
        const local = positions.map(([p,s,a])=>[p.map((v,i)=>v-center[i]),s,a]);
        const lod=new T.LOD();
        lod.position.fromArray(center);
        lod.addLevel(instance(name,source.geometry,material,local,null),0);
        lod.addLevel(instance(name+'_Far',low.geometry,material,local,null),distance,.12);
        world.add(lod);
      }
      const column = kit.scene.getObjectByName('Harbor_Column');
      const lamp = kit.scene.getObjectByName('Harbor_Turquoise_Lamp');
      const columnFar=kit.scene.getObjectByName('Harbor_Column_Far');
      const lampFar=kit.scene.getObjectByName('Harbor_Turquoise_Lamp_Far');
      column.material.metalness *= 0.37;
      column.material.color.setHex(0xbcb5a6);
      const lampMaterial = lamp.material.clone();
      lampMaterial.emissive.setHex(0x15c3a9);
      lampMaterial.emissiveIntensity = 0.52;
      lampMaterial.metalness *= 0.40;
      instanceLOD('U1_Carved_Columns',column,columnFar,finish(column.material),plinths.map(([x,y,z,a])=>[L(x,y,z),[8.75,12.62,8.75],a]),42);
      instanceLOD('U1_Turquoise_Lamps',lamp,lampFar,finish(lampMaterial,'lamp'),LAMPS.map(([x,y,z,a])=>[L(x,y,z),[6.7,6.7,6.7],a]),31);
      const roadLamp = finish(lampMaterial.clone(),'roadLamp');
      roadLamp.emissiveIntensity=.61;
      for (const [part,x0,x1] of [['Causeway',-32,0],['Approach',-59,-32],['Bridge',-83,-59],['Midway',-117,-83],['Court',-165,-117]]) {
        const columns=roadColumns.filter(([x])=>x>=x0&&x<x1);
        if (columns.length) instanceLOD('U1_'+part+'_Columns',column,columnFar,column.material,
          columns.map(([x,y,z,s,a])=>[L(x,y,z),[s,s,s],a]),32);
        instanceLOD('U1_'+part+'_Lamps',lamp,lampFar,roadLamp,BRAZIERS.filter(([x])=>x>=x0&&x<x1)
          .map(([x,y,z])=>[L(x,y+lampBase(x,z),z),[roadLampScale,roadLampScale,roadLampScale],z<-26?Math.PI:0]),26);
      }
      const lion=guardians.scene.getObjectByName('Winged_Lion'), low=guardians.scene.getObjectByName('Winged_Lion_Far');
      lion.material.metalness*=.54;
      lion.material.color.setRGB(.79,.88,1.0);
      instanceLOD('U1_Winged_Lions',lion,low,finish(lion.material),
        GUARDIANS.map(([x,y,z,a])=>[L(x,y,z),[6.65,6.65,6.65],a]),32);

      // The authored city is scenery only. Use the nearest terraced complex
      // on the left, taller ruins set back on the right, and arcades between.
      // The outer terraces cover the oblique views through the side bays.
      const sites = {
        Cascade_Citadel: [[51, -12, 41, 135, -0.36], [81, -9, -40, 159, 1.25],
          [125, 4, 9, 151, 2.44], [52, -9.5, -76, 120, -1.78]],
        Upper_Precinct: [[66, -2, 5, 139, 0.52], [51, -8, -32, 113, -0.96],
          [84, 1, 49, 137, 2.25], [32, -4.5, 64, 141, 1.10]],
        Lower_Terrace: [[28, -25, 41, 132, -0.92], [60, -24, -42, 156, 0.94]],
        Watchtower: [[70, 4, 59, 121, 0.74], [113, 7, -47, 145, -0.28]],
        Temple_Stairs: [[40, -9, -48, 108, -0.78], [-8, -6, 35, 113, 0.21]],
        Round_Arcade: [[69, -6, -26, 119, -0.72]],
        Bridge_Arcade: [[48, -12, 50, 130, -0.35], [59, -14, -33, 166, 0.32],
          [103, -5, -54, 146, -1.21]]
      };
      const atlas=ruins.scene.children[0].material.map;
      const ruinMaterial = scenicMaterial(atlas);
      // Skyline tiers on both sides of the walk. The shelves carry the precincts,
      // support the ruined arcades and extend down into the same fog as the piers.
      const roadSites = {
        Cascade_Citadel: [[-56,-30,64,158,-.43],[-72,-37,-95,181,2.40],[-167,-26,-105,158,.90],[-187,-30,72,180,-.38]],
        Upper_Precinct: [[-114,-20,57,130,-.64],[-150,-10,-74,138,2.07],[-214,-3,0,166,.47]],
        Lower_Terrace: [[-43,-26,-57,151,1.04],[-116,-32,-68,144,1.44],[-113,-28,30,112,-.66]],
        Watchtower: [[-43,-10,93,158,-.5],[-157,-14,48,139,.44],[-124,-16,-89,120,1.15]],
        Temple_Stairs: [[-77,-19,38,116,-.39],[-94,-22,-65,133,2.44]],
        Bridge_Arcade: [[-83,-20,53,151,-.26],[-138,-17,43,155,.17],[-164,-12,-76,146,1.01]],
        Round_Arcade: [[-66,-18,-65,135,.80],[-180,-16,54,139,.64]],
        Ruin_Arch: [[-48,-17,48,150,-.94],[-173,-7,-57,138,.81],[-202,-11,-46,143,-.54]],
        Cliff_Shelf: [[-42,-52,-61,[204,460,165],.22],[-76,-60,38,[198,650,187],-.26],
          [-115,-55,55,[236,555,230],.12],[-120,-61,-65,[243,499,236],.51],[-149,-57,-77,[267,735,243],.71],
          [-167,-59,54,[278,710,219],1.32],[-185,-68,-28,[290,810,198],1.57],[-213,-65,6,[309,970,238],.15]],
        Rock_Buttress: [[-25,-77,-51,[250,950,282],1.33],[-62,-82,39,[211,1030,226],-.85],
          [-103,-77,-65,[207,880,217],.58],[-131,-86,29,[245,1000,239],-.35],
          [-170,-82,-52,[287,810,242],1.0],[-205,-83,32,[210,900,223],.37]],
        Spirit_Fall: [[-49,-61,-49,[98,580,82],1.57],[-80,-64,24,[99,657,85],.37],
          [-124,-69,-54,[112,657,86],2.8],[-155,-70,40,[93,718,96],.15]]
      };
      // The extra ruins occupy the outer terraces behind the near districts.
      // Stepped sanctuaries crown the shoulders, with bridges and smaller
      // precincts between them so the silhouette stays readable in both directions.
      const outerSites={
        Cascade_Citadel: [[178,-2,-107,180,-.35],[-111,-6,122,154,2.16]],
        Upper_Precinct: [[118,-5,106,148,.40],[-219,.8,73,144,-.57],[-92,-6,-122,131,2.13]],
        Lower_Terrace: [[140,-13,-89,147,1.17],[-14,-14,-92,130,-.76],[-170,-13,110,179,.25]],
        Temple_Stairs: [[190,-3,56,151,-1.27],[24,-10,113,121,.16],[-225,-7,-64,151,1.7]],
        Watchtower: [[185,2,-46,147,.53],[-43,-1,111,139,1.79],[-156,-4,-122,131,-1.23]],
        Bridge_Arcade: [[82,-5,101,153,1.17],[-53,-9,-120,146,-.35],[-195,-5,95,156,1.5]],
        Round_Arcade: [[68,-3,-125,126,.56],[-230,0,22,139,.12]],
        Ruin_Arch: [[164,-5,74,122,-1.05],[-137,-3,79,138,.67]]
      };
      const waterMaterial=scenicMaterial(atlas,true);
      const shelf=ruins.scene.getObjectByName('Cliff_Shelf');
      const footprint=new T.Vector3(), footings=[];
      const outlyingCities=outerSites.Cascade_Citadel;
      for (const [name,placements] of Object.entries(outerSites)) {
        if (name==='Cascade_Citadel') continue;
        for (const placement of placements) {
          const district=placement[0]<0 ? roadSites : sites;
          (district[name] ??= []).push(placement);
        }
      }
      const skylineGroups=[['U1_',sites],['U1_Road_',roadSites],['U1_Outer_',{Cascade_Citadel:outlyingCities}]];
      for(const [prefix,district] of skylineGroups) {
        for(const [name,placements] of Object.entries(district)) {
          const source=ruins.scene.getObjectByName(name);
          source.geometry.boundingBox.getSize(footprint);
          const positions=placements.map(([x,y,z,size,a])=>{
            const scale=typeof size==='number'?[size,size,size]:size;
            const width=footprint.x*scale[0], height=footprint.y*scale[1], depth=footprint.z*scale[2];
            // Rock overlaps the actual mesh base so no opening is visible
            // beneath an island or between the feet of an arcade.
            const water=name==='Spirit_Fall';
            if(water) {
              const crest=y+height;
              const bed=Math.max(bedHeight(x,z)+4,-98);
              footings.push([x,bed+.12,z,width*1.08,depth*1.08,a]);
              return [L(x,bed,z),[scale[0],(crest-bed)/footprint.y,scale[2]],a];
            }
            footings.push([x,y+T.MathUtils.clamp(height*.11,.65,2.3),z,width*1.12,depth*1.12,a]);
            return [L(x,y,z),scale,a];
          });
          if(name==='Cascade_Citadel') {
            const far=ruins.scene.getObjectByName('Cascade_Citadel_Far');
            if(prefix==='U1_Outer_') instance(prefix+name,far.geometry,ruinMaterial,positions);
            else for(const entry of positions) instanceLOD(prefix+name,source,far,ruinMaterial,[entry],108);
          } else {
            const water=name==='Spirit_Fall';
            const mesh=instance(prefix+name,source.geometry,water?waterMaterial:ruinMaterial,positions);
            if(water) mesh.onBeforeRender=()=>{flowTime.value=performance.now()*.001;};
          }
        }
      }
      addCanyon(scenicMaterial(materials.get('roadStone').map,false,true),footings);
      const roofRock=ruins.scene.getObjectByName('Rock_Buttress');
      const cavernRoof=[[-34,85,-55,640,790,690,.37],[-74,84,36,770,850,680,-.42],
        [-120,93,-88,810,1005,890,1.66],[-174,90,53,804,890,820,1.03],[-211,105,-31,1010,1080,910,-.26]];
      instance('U1_Cavern_Overhangs',roofRock.geometry,ruinMaterial,cavernRoof.map(([x,y,z,sx,sy,sz,a])=>
        [L(x,y,z),[sx,sy,sz],[Math.PI,a,0]]));
      instance('U1_Cavern_Ceiling',shelf.geometry,ruinMaterial,
        [[-55,109,-29,1020,785,1250,.08],[-172,122,-23,1120,810,1200,-.14]]
          .map(([x,y,z,sx,sy,sz,a])=>[L(x,y,z),[sx,sy,sz],[Math.PI,a,0]]));
      atmosphere();
      roadAtmosphere();
      status.phase = 'ready';
      status.columns = plinths.length+roadColumns.length;
      status.lamps = LAMPS.length+BRAZIERS.length;
      status.ruinLandmarks = new Set([...Object.keys(sites),...Object.keys(roadSites),...Object.keys(outerSites)]).size;
      status.skylineAdditions = Object.values(outerSites).reduce((count,sites)=>count+sites.length,0);
    }

    function atmosphere() {
      const beam = new T.ShaderMaterial({
        transparent: true, depthWrite: false, side: T.FrontSide, blending: T.AdditiveBlending,
        vertexShader: `varying vec2 beamUV; varying vec3 beamN; varying vec3 beamV;
          void main() {
            beamUV=uv; vec4 v=modelViewMatrix*vec4(position,1.0);
            beamN=normalize(normalMatrix*normal); beamV=-v.xyz; gl_Position=projectionMatrix*v;
          }`,
        fragmentShader: `varying vec2 beamUV; varying vec3 beamN; varying vec3 beamV;
          void main() {
            float edge=pow(abs(dot(normalize(beamN),normalize(beamV))),1.6);
            float fade=smoothstep(0.0,0.46,beamUV.y);
            float striae=0.62+0.38*sin(beamUV.x*53.4+beamUV.y*3.8)*sin(beamUV.x*34.6);
            gl_FragColor=vec4(0.35,0.66,0.78,edge*fade*striae*0.115);
          }`
      });
      const shaft = new T.Mesh(new T.CylinderGeometry(2.85, 5.65, ceiling - 0.25, 32, 1, true), beam);
      shaft.name = 'U1_Oculus_Light';
      shaft.position.fromArray(L(1.75, ceiling / 2 + 0.07, 0.2));
      shaft.rotation.z = 0.24;
      world.add(shaft);
      const oculus = new T.Mesh(new T.CircleGeometry(3.68, 56), new T.ShaderMaterial({
        vertexShader: `varying vec2 vO; void main() {
          vO = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
        fragmentShader: `varying vec2 vO;
          float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
          float cloud(vec2 v) {
            vec2 p=floor(v), f=fract(v); f=f*f*(3.0-2.0*f);
            return mix(mix(hash(p),hash(p+vec2(1,0)),f.x),
              mix(hash(p+vec2(0,1)),hash(p+vec2(1,1)),f.x),f.y);
          }
          void main() {
            float a=cloud(vO*5.4+3.0), b=cloud(vO*16.0+4.0), c=cloud(vO*42.0);
            float seam=1.0-smoothstep(0.0,0.21,abs(a*0.78+b*0.16+c*0.06-0.55));
            gl_FragColor=vec4(mix(vec3(0.045,0.13,0.19),vec3(0.22,0.68,0.77),pow(seam,4.0)),1.0);
          }`
      }));
      oculus.name = 'U1_Teal_Shaft_Ceiling';
      oculus.position.fromArray(L(0, ceiling + 1.55, 0));
      oculus.rotation.x = Math.PI / 2;
      world.add(oculus);
    }

    function roadAtmosphere() {
      // The fog cards are far below the walk and still depth-test against the piers.
      const mist = new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,
        forceSinglePass:true,uniforms:{uFlowTime:flowTime,uCaveNoise:{value:caveNoise}},
        vertexShader:`varying vec2 vMist; varying vec3 vEye;
          void main(){ vMist=uv; vec4 p=modelViewMatrix*vec4(position,1.0);
            vEye=-p.xyz; gl_Position=projectionMatrix*p; }`,
        fragmentShader:`uniform float uFlowTime; uniform sampler2D uCaveNoise; varying vec2 vMist; varying vec3 vEye;
          void main(){
            vec2 p=vMist*vec2(1.7,1.22);
            p.x+=uFlowTime*.011;
            float billow=texture2D(uCaveNoise,p).r*1.45;
            float edge=smoothstep(0.,.19,min(min(vMist.x,vMist.y),min(1.-vMist.x,1.-vMist.y)));
            float fade=smoothstep(12.,44.,length(vEye))*(1.-smoothstep(135.,285.,length(vEye)));
            float a=smoothstep(.47,1.21,billow)*edge*fade*.27;
            gl_FragColor=vec4(mix(vec3(.035,.12,.18),vec3(.07,.29,.35),billow*.65),a);
            #include <colorspace_fragment>
          }`});
      for (const [y,width,depth] of [[-32,212,124],[-48,257,163]]) {
        const geometry = new T.PlaneGeometry(width,depth).rotateX(-Math.PI/2);
        const cloud=new T.Mesh(geometry,mist);
        cloud.name='U1_Depth_Mist';
        cloud.position.fromArray(L(-113,y,-27));
        cloud.onBeforeRender=()=>{flowTime.value=performance.now()*.001;};
        world.add(cloud);
      }
      const shafts = new T.InstancedMesh(new T.CylinderGeometry(2.2,12.5,64,12,1,true),new T.ShaderMaterial({
        transparent:true,depthWrite:false,blending:T.AdditiveBlending,
        vertexShader:`varying vec3 vN,vEye; varying vec2 v;
          void main(){v=uv; vec4 p=modelViewMatrix*instanceMatrix*vec4(position,1.0);
            vN=normalMatrix*mat3(instanceMatrix)*normal; vEye=-p.xyz; gl_Position=projectionMatrix*p;}`,
        fragmentShader:`varying vec3 vN,vEye; varying vec2 v;
          void main(){
            float edge=pow(max(dot(normalize(vN),normalize(vEye)),0.),2.6);
            float fade=smoothstep(.04,.49,v.y)*(1.-smoothstep(.72,1.,v.y));
            float streak=.81+.19*sin(39.*v.x+2.*v.y)*sin(73.*v.x);
            gl_FragColor=vec4(.28,.57,.71,edge*fade*streak*.078);
            #include <colorspace_fragment>
          }`}),3);
      const pose = new T.Object3D();
      for (const [index,[x,y,z,tilt]] of [[-59,31,-48,-.36],[-105,38,31,.37],[-159,34,-47,.44]].entries()) {
        pose.position.fromArray(L(x,y,z)); pose.rotation.set(.18,0,tilt); pose.updateMatrix();
        shafts.setMatrixAt(index,pose.matrix);
      }
      shafts.name='U1_Cavern_Light_Shafts';
      shafts.computeBoundingSphere();
      world.add(shafts);
      const plane=new T.PlaneGeometry(.69,.85).translate(0,.40,0);
      const geometry=new T.InstancedBufferGeometry().copy(plane);
      plane.dispose();
      const origins=BRAZIERS.map(([x,y,z])=>L(x,y+lampBase(x,z)+1.42,z));
      geometry.setAttribute('lampAnchor',new T.InstancedBufferAttribute(new Float32Array(origins.flat()),3));
      geometry.instanceCount=origins.length;
      geometry.boundingSphere=new T.Box3().setFromPoints(origins.map(p=>new T.Vector3(...p)))
        .expandByScalar(1).getBoundingSphere(new T.Sphere());
      const wisps=new T.Mesh(geometry,new T.ShaderMaterial({transparent:true,depthWrite:false,
        blending:T.AdditiveBlending,uniforms:{uFlowTime:flowTime},
        vertexShader:`attribute vec3 lampAnchor; varying vec2 v; varying float phase,fade;
          void main(){v=uv; phase=lampAnchor.x*.28+lampAnchor.z*.4;
            vec4 p=modelViewMatrix*vec4(lampAnchor,1.0);
            fade=1.-smoothstep(15.,43.,length(p.xyz));
            p.xy+=position.xy; gl_Position=projectionMatrix*p;}`,
        fragmentShader:`uniform float uFlowTime; varying vec2 v; varying float phase,fade;
          void main(){
            float t=uFlowTime*1.65+phase;
            float y=v.y,x=v.x-.5;
            float shift=y*(.19*sin(9.1*y-t)+.10*sin(14.*y-t*1.5));
            float ribbon=1.-smoothstep(.010,.090,abs(x-shift));
            float trail=1.-smoothstep(.006,.059,abs(x+0.12*y+.12*y*sin(12.*y-t+1.)));
            float a=smoothstep(0.,.16,y)*(1.-smoothstep(.35,.98,y));
            gl_FragColor=vec4(.17,.82,.76,(ribbon+.38*trail)*a*fade*.20);
            #include <colorspace_fragment>
          }` }));
      wisps.name='U1_Spirit_Lamp_Wisps';
      wisps.onBeforeRender=()=>{flowTime.value=performance.now()*.001;};
      world.add(wisps);
    }

    function floor(x, z) {
      const rx = x - A.x, rz = z - A.z;
      const r = Math.hypot(rx, rz);
      for (const [radius, y] of DAIS) if (r <= radius) return A.y + y;
      for (const [, cx, cz, radius, y] of DISCS) if (Math.hypot(rx - cx, rz - cz) <= radius) return A.y + y;
      if (rx >= gateBack - .8 && rx <= gateX + 2.5 && Math.abs(rz - gateZ) <= gateHalfWidth) return A.y + gateFloor;
      for (const [, ax, az, bx, bz, w, ya, yb] of PATHS) {
        const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
        const projected = ((rx - ax) * dx + (rz - az) * dz) / len2;
        // The decks visibly overlap their landings. Keep the capsule's side
        // probes inside that overlap even on the two short lookout links.
        const overlap = Math.max(.03, .40 / Math.sqrt(len2));
        if (projected < -overlap || projected > 1 + overlap) continue;
        const t = Math.min(1, Math.max(0, projected));
        if (Math.hypot(rx - ax - dx * t, rz - az - dz * t) <= w / 2) return A.y + ya + (yb - ya) * t;
      }
      return null;
    }

    return {
      group: world, status, floor, finish,
      gateBlocks: (x, z, radius) => gate
        ? gate.blocks(x - A.x, z - A.z, radius)
        : Math.abs(z - A.z - gateZ) < gateHalfWidth && Math.abs(x - A.x - gateX) < 1.3,
      tickGate(dt, ctx, towardGate) {
        if (encounter) encounter.tick(dt, ctx);
        else gate?.update(dt, ctx, towardGate);
      },
      encounter: () => encounter,
      gateCamera: (camera, safeFollow) => gate?.frameCamera(camera, safeFollow),
      gateCameraBoxes: (x, z) => gate?.cameraBoxesAt(x - A.x, z - A.z),
      restoreGatePose: () => gate?.restore(),
      gateActive: () => encounter ? encounter.locked() : !!gate && gate.state.phase !== 'closed' && gate.state.phase !== 'open',
      gateApproach: () => gate?.state.phase === 'approach',
      ready(renderer, architecture) {
        if (!pending) pending = loadHarbor(renderer, architecture).catch(error => {
          status.phase = 'failed';
          status.error = error.message;
          console.error('[U1] Anchorage assets', error);
        });
        return pending;
      },
      ceiling(x, z) {
        const r = Math.hypot(x - A.x, z - A.z);
        return r >= 3.7 && r <= 18.5 ? A.y + ceiling : Infinity;
      },
      spawns: Object.fromEntries(Object.entries(SPAWNS).map(([id, [x, y, z]]) => [id, L(x, y, z)])),
      update(visible, x, z) {
        world.visible = visible;
        const distance = Math.hypot(x-A.x, z-A.z);
        sharedLight.intensity = 1.40 * (1 - T.MathUtils.smoothstep(distance, 17, 26));
        if (!visible) return;
        world.updateWorldMatrix(true, false);
        transform.value.copy(world.matrixWorld).invert();
      }
    };
  }

  root.SinR3Underworld = { create, plan: { discs: DISCS, paths: PATHS, spawns: SPAWNS } };
})(window);
