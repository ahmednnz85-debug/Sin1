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
  const gateX = -155;
  const GUARDIANS = [-1, 1].map(side => [gateX + 7.5, -9, -26 + side * 8.2, side < 0 ? 0 : Math.PI]);

  function create({ T, group, lift, hit }) {
    const A = { x: lift.center[0], y: lift.drop, z: lift.center[1] };
    const L = (x, y, z) => [A.x + x, A.y + y, A.z + z];
    const world = new T.Group();
    world.name = 'U1_Irkalla';
    group.add(world);
    const status = { phase: 'idle', lights: 0 };

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
                float glancing = pow(max(0.0,dot(reflectRay, normalize(vec3(0.59, 0.72, -0.36)))), 24.0);
                outgoingLight += glancing * (1.0-roughnessFactor) * vec3(0.36,0.29,0.18);
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

    function scenicMaterial(map, waterfall = false) {
      return new T.ShaderMaterial({side:T.FrontSide,
        uniforms:{uW2L:transform,uFlowTime:flowTime,atlas:{value:map},isFall:{value:waterfall?1:0},
          dock:{value:new T.Vector3(A.x,A.y,A.z)}},
        vertexShader:`uniform mat4 uW2L; uniform vec3 dock;
          varying vec2 vAtlas; varying vec3 vLocal; varying vec3 vCave;
          void main(){
            vAtlas=uv;
            vec4 p=instanceMatrix*vec4(position,1.);
            vec4 local=uW2L*modelMatrix*p;
            vec3 eye=(uW2L*vec4(cameraPosition,1.)).xyz;
            vLocal=local.xyz-dock;
            mat3 basis=mat3(instanceMatrix);
            vec3 n=normal/vec3(dot(basis[0],basis[0]),dot(basis[1],basis[1]),dot(basis[2],basis[2]));
            n=normalize(basis*n);
            vCave.x=.28+.49*max(0.,dot(n,normalize(vec3(-.46,.69,.45))))+.24*max(0.,n.y);
            vCave.y=length(eye-local.xyz);
            vCave.z=.5+.31*sin(vLocal.x*.09+vLocal.y*.18)*sin(vLocal.z*.12-vLocal.y*.087)
              +.19*sin(vLocal.z*.063+vLocal.x*.053);
            gl_Position=projectionMatrix*modelViewMatrix*p;
          }`,
        fragmentShader:`uniform sampler2D atlas; uniform float uFlowTime,isFall;
          varying vec2 vAtlas; varying vec3 vLocal; varying vec3 vCave;
          void main(){
            vec3 color=texture2D(atlas,vAtlas).rgb;
            float wet=smoothstep(.024,.17,min(color.g,color.b)-color.r*1.1);
            float flow=.72+.16*sin(vLocal.y*.94+uFlowTime*4.4+vLocal.x*.37)
              +.12*sin(vLocal.y*2.10+uFlowTime*8.7+vLocal.z*1.8);
            color=color*(vCave.x*vec3(.48,.60,.69)+wet*flow*vec3(.07,.28,.34));
            color+=isFall*vec3(.013,.16,.21)*flow*(.2+.8*wet);
            float depth=1.-smoothstep(-52.,-8.,vLocal.y);
            float haze=clamp(1.-exp(-vCave.y*(.0032+.0037*depth))+.18*depth*vCave.z,0.,.94);
            vec3 mist=mix(vec3(.010,.028,.045),vec3(.035,.125,.160),depth*(.44+.56*vCave.z));
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
    function inlay(kind, r0, r1, y, repeat = 1, x = 0, z = 0) {
      const points = [], uv = [], index = [];
      for (let i = 0; i <= 144; i++) {
        const t = i / 144, a = t * tau;
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
    function panel(kind, points, u = 1) {
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(points.flatMap(point => L(...point)), 3));
      geometry.setAttribute('uv', new T.Float32BufferAttribute([0, 0, u, 0, u, 1, 0, 1], 2));
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      add(kind, geometry, true);
    }

    function ribbon(kind, x0, z0, x1, z1, y0, y1, width, span, offset = 0) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const nx = (z1 - z0) / len, nz = (x0 - x1) / len;
      const side = (x, y, z, edge) => [x + nx * (offset + edge), y, z + nz * (offset + edge)];
      panel(kind, [side(x0,y0,z0,-width/2), side(x1,y1,z1,-width/2),
        side(x1,y1,z1,width/2), side(x0,y0,z0,width/2)], Math.max(1, Math.round(len / span)));
    }

    function railing(x0, z0, x1, z1, y0, y1, height) {
      const run = Math.hypot(x1 - x0, z1 - z0), len = Math.hypot(run, y1 - y0);
      const yaw = Math.atan2(z0 - z1, x1 - x0), slope = Math.atan2(y1 - y0, run);
      const x = (x0 + x1) / 2, z = (z0 + z1) / 2, y = (y0 + y1) / 2;
      box('roadStone', x, y + height / 2, z, len, height, 0.49, yaw, 0, slope);
      box('roadTrim', x, y + height - 0.085, z, len + 0.016, 0.17, 0.61, yaw, 0, slope);
      box('roadTrim', x, y + 0.075, z, len, 0.15, 0.60, yaw, 0, slope);
      const nx = (z1 - z0) / run * 0.253, nz = (x0 - x1) / run * 0.253;
      const repeat = Math.max(1, Math.round(run / 3.30));
      panel('roadRail', [[x1+nx,y1+.15,z1+nz],[x0+nx,y0+.15,z0+nz],
        [x0+nx,y0+height-.17,z0+nz],[x1+nx,y1+height-.17,z1+nz]], repeat);
      panel('roadRail', [[x0-nx,y0+.15,z0-nz],[x1-nx,y1+.15,z1-nz],
        [x1-nx,y1+height-.17,z1-nz],[x0-nx,y0+height-.17,z0-nz]], repeat);
      const bays = Math.max(1, Math.round(run / 3.3));
      for (let i = 0; i < bays; i++) {
        const t = i / bays;
        const px = T.MathUtils.lerp(x0,x1,t), py = T.MathUtils.lerp(y0,y1,t), pz = T.MathUtils.lerp(z0,z1,t);
        box('roadStone', px, py + height * 0.52, pz, 0.47, height * 1.04, 0.65, yaw);
        box('roadTrim', px, py + height + .09, pz, 0.57, 0.18, 0.74, yaw);
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
          const dx = -Math.sin(a) * len / 2, dz = Math.cos(a) * len / 2;
          railing(px - dx, pz - dz, px + dx, pz + dz, y, y, height);
        }
        if (harbor && i % 2 === 0) box('paving', px, y + height + 0.12, pz, 0.75, 0.24, 0.75, -a);
      }
    }
    // Straight deck with side parapets (x- or z-aligned).
    function deck(x0, z0, x1, z1, y0, y1, width, thick, rails = true) {
      const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      const len = Math.hypot(x1 - x0, z1 - z0), pitch = Math.atan2(y1 - y0, alongX ? x1 - x0 : z1 - z0);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, cy = (y0 + y1) / 2;
      const tilt = alongX ? [0, 0, pitch] : [-pitch, 0, 0];
      const sx = alongX ? len / Math.cos(pitch) : width, sz = alongX ? width : len / Math.cos(pitch);
      box('roadPaving', cx, cy - thick / 2, cz, sx, thick, sz, 0, tilt[0], tilt[2]);
      if (!rails) return;
      ribbon('roadStars', x0,z0,x1,z1,y0+.012,y1+.012,Math.min(width*.25,1.48),1.58);
      for (const side of [-1, 1]) {
        const ox = alongX ? 0 : side * (width / 2 - 0.27), oz = alongX ? side * (width / 2 - 0.27) : 0;
        railing(x0+ox,z0+oz,x1+ox,z1+oz,y0,y1,1.0);
        ribbon('roadEdge', x0,z0,x1,z1,y0+.013,y1+.013,.15,3.0,side*(width/2-.73));
      }
    }
    // Flight of steps over a straight ramp (visual treads; the walk is the ramp).
    function steps(x0, z0, x1, z1, y0, y1, width, count) {
      const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      const dx = x1 - x0, dz = z1 - z0, length = Math.hypot(dx, dz);
      const run = length / count + 0.02;
      deck(x0,z0,x1,z1,y0-.24,y1-.24,width,1.65,false);
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count, y = y0 + (y1 - y0) * t;
        const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
        box('roadPaving', x, y - 0.55, z, alongX ? run : width - 1.0, 1.1, alongX ? width - 1.0 : run);
        const noseX = x + dx / length * (run / 2 - .055), noseZ = z + dz / length * (run / 2 - .055);
        const tx = -dz / length * (width / 2 - .48), tz = dx / length * (width / 2 - .48);
        ribbon('roadEdge', noseX-tx,noseZ-tz,noseX+tx,noseZ+tz,y+.011,y+.011,.064,2.9);
      }
      for (const side of [-1, 1]) {
        const ox = alongX ? 0 : side * (width / 2 - 0.27), oz = alongX ? side * (width / 2 - 0.27) : 0;
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

    function pier(x, y, z, width, depth, height, yaw = 0) {
      box('roadStone',x,y-height/2,z,width,height,depth,yaw);
      box('roadTrim',x,y-.29,z,width+.30,.58,depth+.26,yaw);
      box('roadTrim',x,y-1.18,z,width+.15,.24,depth+.16,yaw);
    }

    function platform(x, y, z, radius, depth, medallion, piers = 0) {
      const count = radius > 10 ? 80 : 48;
      cyl('roadPaving',x,y-depth/2,z,radius,radius,depth,count);
      cyl('roadRelief',x,y-depth*.50,z,radius+.014,radius+.014,depth*.64,count,true,Math.round(tau*radius/(depth*2.0)));
      cyl('roadTrim',x,y-.11,z,radius+.12,radius+.09,.22,count,true);
      cyl('roadTrim',x,y-depth+.11,z,radius+.08,radius+.12,.24,count,true);
      add('roadMedallion',at(new T.CircleGeometry(medallion,count),x,y+.012,z,-Math.PI/2),true);
      inlay('roadEdge',radius-.62,radius-.47,y+.011,Math.round(tau*radius/2.9),x,z);
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

    // ---- U1-03: the principal court and the original closed threshold -----
    platform(-139,-9,-26,19,3,11.1,10);
    parapet(-139,-9,-26,18.7,[[0,.18],[Math.PI,.62]]);
    inlay('roadStars',12.82,13.55,-8.987,28,-139,-26);
    inlay('roadEdge',13.55,13.70,-8.985,28,-139,-26);
    const gx=gateX;
    for (const side of [-1,1]) {
      const z=-26+side*9.25, towerZ=-26+side*18.5;
      box('roadStone',gx-3,2,z,6,22,9.5);
      box('roadStone',gx-4.5,6,towerZ,11,30,9);
      for (const y of [-8.2,3.15,12.48,19.9]) {
        const tower=y>12.5;
        box('roadTrim',gx-(tower?4.50:3),y,tower?towerZ:z,tower?11.48:6.48,.32,tower?9.5:9.87);
      }
      for (let k=-1; k<=1; k++) {
        box('roadStone',gx-4.5+k*3.6,22.4,towerZ,1.6,2.8,9);
        box('roadTrim',gx-4.5+k*3.6,23.66,towerZ,1.83,.27,9.26);
      }
      panel('roadPalms', [[gx+.016,-6.9,z+3],[gx+.016,-6.9,z-3],
        [gx+.016,3.0,z-3],[gx+.016,3.0,z+3]]);
      panel('roadScript', [[gx+.018,8.5,z+4.55],[gx+.018,8.5,z-4.55],
        [gx+.018,9.45,z-4.55],[gx+.018,9.45,z+4.55]],2);
      panel('roadRelief',[[gx+1.018,3.76,towerZ+4.05],[gx+1.018,3.76,towerZ-4.05],
        [gx+1.018,6.05,towerZ-4.05],[gx+1.018,6.05,towerZ+4.05]]);
      panel('roadScript',[[gx+1.018,14.4,towerZ+4.11],[gx+1.018,14.4,towerZ-4.11],
        [gx+1.018,15.23,towerZ-4.11],[gx+1.018,15.23,towerZ+4.11]],2);
      for (const edge of [-1,1]) {
        box('roadTrim',gx+.93,6,towerZ+edge*4.18,.44,29.8,.54);
        box('roadTrim',gx+.25,-2.14,-26+side*5.24+edge*.36,1.06,13.44,.19);
      }
      pier(gx-3,-8.9,towerZ,9.1,8.9,34);
    }
    box('roadStone',gx-3,8.75,-26,6,8.5,9.0);
    vault(gx+.48,-26,6.5,12.4,15.5,1.34,-Math.PI/2);
    const archInner=12.4*.37, spring=5.8-archInner;
    for(let block=0;block<18;block++) {
      const a=block*Math.PI/18+.011, b=(block+1)*Math.PI/18-.011;
      const point=(angle,r)=>[gx+1.162,spring+Math.sin(angle)*r,-26+Math.cos(angle)*r];
      panel('roadEdge',[point(a,archInner+.16),point(b,archInner+.16),point(b,archInner+.65),point(a,archInner+.65)]);
    }
    box('roadDoor',gx-.9,-1.7,-26,.8,14.6,9.0);
    for (const side of [-1,1]) {
      const z=-26+2.24*side;
      panel('roadRelief',[[gx-.484,-7.45,z+1.91],[gx-.484,-7.45,z-1.91],
        [gx-.484,-2.1,z-1.91],[gx-.484,-2.1,z+1.91]]);
      box('roadTrim',gx-.41,-.87,z,.12,13.8,.14);
    }
    for (const height of [-7.7,-2.03,3.84]) box('roadTrim',gx-.42,height,-26,.16,.18,8.86);
    for (let k=-3; k<=3; k++) {
      box('roadStone',gx-3,13.9,-26+k*2.7,6,1.8,1.5);
      box('roadTrim',gx-3,14.72,-26+k*2.7,6.25,.18,1.69);
    }
    solid(gx-16,gx+1.3,-9,40,-50,-2);
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

    // ---- cavern and shared U1 materials -----------------------------------
    const shell = new T.SphereGeometry(330, 32, 16).scale(1, 0.55, 1);
    add('cavern', at(shell, -70, 20, -26));
    const materials = new Map();
    const surfaces = {
      paving: [0xd2cdc5, 0.76, 'paving'], daisGold: [0xffe2aa, 0.64, 'dais-gold'],
      daisBorder: [0xeccb9e, 0.66, 'dais-border'], floorInlay: [0xf3e2ca, 0.62, 'floor-inlay'],
      roofStone: [0xb8bec8, 0.88, 'roof-stone'], roofBand: [0xd5be9b, 0.82, 'roof-band'],
      roofRib: [0xe5c494, 0.76, 'roof-rib'], roofOculus: [0xd7c8b4, 0.78, 'roof-oculus'],
      roadPaving: [0xd2d5dc,.78,'road-stone'], roadStone: [0xa8b2c1,.87,'road-stone'],
      roadTrim: [0xcbbb9f,.81,'road-stone'], roadDoor: [0x9b8272,.87,'road-stone'],
      roadStars: [0xffecca,.66,'road-stars'], roadEdge: [0xffedc4,.76,'road-edge'],
      roadMedallion: [0xfdf2df,.74,'road-medallion'], roadRail: [0xffecd1,.80,'road-rail'],
      roadRelief: [0xfae9cd,.84,'road-relief'], roadScript: [0xf8e7c8,.79,'road-script'],
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
          side: kind === 'cavern' ? T.BackSide : kind.startsWith('roof') ? T.DoubleSide : T.FrontSide }),
        kind === 'cavern' ? 'shell' : ['paving','roadPaving','roadStars','roadMedallion'].includes(kind)
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
    async function loadHarbor(renderer) {
      const textureLoader = new T.TextureLoader();
      const files = 'assets/r3/harbor/';
      const maps = new Map();
      const loadMap = (name, srgb) => {
        if (!maps.has(name)) maps.set(name,textureLoader.loadAsync(files + name + '.webp').then(map => {
          if (srgb) map.colorSpace = T.SRGBColorSpace;
          if (name!=='road-medallion') map.wrapS = map.wrapT = T.RepeatWrapping;
          map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
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
      const loader = new T.GLTFLoader().setMeshoptDecoder(root.MeshoptDecoder);
      const loadingMaps = Object.entries(surfaces).map(async ([key, [, , file]]) => {
        const material = materials.get(key);
        material.map = await loadMap(file, true);
        material.needsUpdate = true;
      });
      for (const [key, file] of [['daisGold', 'dais-gold'], ['daisBorder', 'dais-border'], ['roadPaving','road-stone'],
        ['roadStone','road-stone'],['roadTrim','road-stone'],['roadStars','road-stars'],['roadRail','road-rail'],['roadRelief','road-relief']]) {
        loadingMaps.push(loadMap(file + '-normal').then(normal => {
          const frieze = materials.get(key);
          frieze.normalMap = normal;
          frieze.normalScale.setScalar(0.82);
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
        for (const key of ['roadPaving','roadStone','roadTrim','roadDoor']) {
          materials.get(key).roughnessMap=rough;
          materials.get(key).needsUpdate=true;
        }
      }));
      const [kit, ruins, guardians] = await Promise.all([loader.loadAsync(files + 'architecture.glb'),
        loader.loadAsync(files + 'distant-ruins.glb'),loader.loadAsync(files + 'road-guardians.glb'), ...loadingMaps]);
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
      for (const [name, layout] of Object.entries(sites)) {
        const source = ruins.scene.getObjectByName(name);
        const positions = layout.map(([x, y, z, size, a]) => [L(x, y, z), [size, size, size], a]);
        if(name==='Cascade_Citadel') for(const entry of positions) instanceLOD('U1_'+name,source,ruins.scene.getObjectByName('Cascade_Citadel_Far'),ruinMaterial,[entry],125);
        else instance('U1_' + name, source.geometry, ruinMaterial, positions);
      }
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
      const waterMaterial=scenicMaterial(atlas,true);
      const shelf=ruins.scene.getObjectByName('Cliff_Shelf');
      const shelfSize=shelf.geometry.boundingBox.getSize(new T.Vector3());
      const footprint = new T.Vector3();
      const footings=[];
      for (const [name, placements] of Object.entries(roadSites)) {
        const source=ruins.scene.getObjectByName(name);
        const positions=placements.map(([x,y,z,s,a])=>[L(x,y,z),typeof s==='number'?[s,s,s]:s,a]);
        if (!['Cliff_Shelf','Rock_Buttress','Spirit_Fall'].includes(name)) {
          source.geometry.boundingBox.getSize(footprint);
          for (const [x,y,z,s,a] of placements) {
            const bottom=-66-8*Math.sin(x*.043+z*.073), crest=y+footprint.y*s*.23;
            const width=footprint.x*s, depth=footprint.z*s;
            if (name==='Bridge_Arcade') {
              for (const edge of [-1,1]) {
                footings.push([L(x+Math.cos(a)*width*.29*edge,bottom,z-Math.sin(a)*width*.29*edge),
                  [width*.53/shelfSize.x,(crest-bottom)/shelfSize.y,depth*.62/shelfSize.z],a]);
              }
            } else footings.push([L(x,bottom,z),[width*.97/shelfSize.x,(crest-bottom)/shelfSize.y,depth*.97/shelfSize.z],a]);
          }
        }
        if (name==='Cascade_Citadel') {
          for(const entry of positions) instanceLOD('U1_Road_Citadel',source,ruins.scene.getObjectByName('Cascade_Citadel_Far'),ruinMaterial,[entry],108);
        } else {
          const mesh=instance('U1_Road_'+name,source.geometry,name==='Spirit_Fall'?waterMaterial:ruinMaterial,positions);
          if (name==='Spirit_Fall') mesh.onBeforeRender=()=>{flowTime.value=performance.now()*.001;};
        }
      }
      instance('U1_Rock_Foundations',shelf.geometry,ruinMaterial,footings);
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
      status.ruinLandmarks = new Set([...Object.keys(sites),...Object.keys(roadSites)]).size;
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
      ready(renderer) {
        if (!pending) pending = loadHarbor(renderer).catch(error => {
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
