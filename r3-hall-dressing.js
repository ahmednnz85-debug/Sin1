/* R3-02 visual dressing and props. Coordinates are metres in the R3 root. */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const DIR = 'assets/r3/hall/';
  const PROP = 'assets/اصول قاعة الختم.glb';
  const NODES = {
    platform: 'Astral_Platform_Circular_Ruins',
    guardian: 'Lamassu_Left_Facing_Guardian_On_Inscribed_Plinth',
    column: 'Engraved_Sandstone_Column_Complete',
    stele: 'Sun_Medallion_Cuneiform_Stele',
    rubble: 'Collapsed_Stone_And_Broken_Drum_Rubble'
  };
  const metres = { ashlar: [2.6, 2.25], paving: [2.85, 2.75], dust: [2.6, 2.6] };
  const skin = {
    Treads: 'ashlar', Walls: 'ashlar', Vault: 'ashlar', ArchRibs: 'ashlar',
    Buttresses: 'ashlar', Plinths: 'ashlar', MuralBays: 'ashlar', Capitals: 'ashlar',
    Gallery: 'paving', Basin: 'paving', Dais: 'ashlar', Columns: 'ashlar',
    Guardstones: 'ashlar', RoofEdge: 'ashlar', PlatformSteps: 'ashlar', RailAshlar: 'ashlar', Sin: 'sin', Ziggurat: 'ziggurat', Seal: 'seal',
    Cuneiform: 'cuneiform', Procession: 'procession', Rail: 'rail', Niches: 'arch',
    Dust: 'dust'
  };
  const colors = {
    Vault: 0xc6b6a7, Basin: 0xd4cabe, Gallery: 0xd4cabe,
    MuralBays: 0x816e60, Niches: 0x998e82, Dust: 0xa99480
  };
  const platformScale = [1.38, 0.70, 1.38];
  const platformYaw = Math.PI * 0.125;
  const access = a => Math.abs(Math.sin(a)) < 0.18;
  const range = r => r * platformScale[0];

  // The deck jumps above the perimeter steps except at the two service stairs.
  // Radii and elevations are taken from the authored platform's surface.
  function platformFloor(r, a) {
    if (r > range(4.69) && (!access(a) || r > 7.50)) return 0;
    if (r > range(4.14)) {
      if (access(a)) return Math.max(0, Math.min(5, 1 + Math.floor((7.50 - r) / 0.39))) * 0.18;
      return r < range(4.32) ? 0.30 : r < range(4.49) ? 0.20 : 0.10;
    }
    const localRadius = r / platformScale[0];
    const top = localRadius > 2.3 ? 1.30 :
      localRadius > 1.6 ? 1.30 + (2.3 - localRadius) * 1.27 :
      localRadius > 0.89 ? 2.18 : 2.24;
    return top * platformScale[1];
  }

  function uv(A, slot, x, y, z, nx, ny, nz) {
    const type = skin[slot];
    const [w, h] = metres[type] || metres.ashlar;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    if (ay >= ax && ay >= az) return [(x + z) * 0.7071 / w, (x - z) * 0.7071 / h];
    if (slot === 'Walls' || slot === 'MuralBays' || slot === 'Guardstones') {
      let angle = Math.atan2(z - A.HALL_V, x - A.HALL_U);
      if (angle < 0) angle += TAU;
      return [angle * Math.round(TAU * A.RADIUS / w) / TAU, y / h];
    }
    return ax > az ? [z * Math.sign(nx) / w, y / h] : [-x * Math.sign(nz) / w, y / h];
  }

  function create(A) {
    const { THREE: T, group, root, HALL_U: u, HALL_V: v, BASIN: basin,
      GALLERY: gallery, SPRING: spring, RADIUS: radius } = A;
    const materials = new Map();
    const assets = new T.Group();
    assets.name = 'FirstSeal_AuthoredAssets';
    const fx = new T.Group();
    fx.name = 'FirstSeal_Atmosphere';
    const rig = new T.Group();
    rig.name = 'FirstSeal_Lighting';
    const lods = [];
    const time = { value: 0 };
    let installed = false;
    let shared;
    let lodX = Infinity, lodZ = Infinity;
    let wasInside = false;
    // The game's shader adapter reserves a negative exponent for
    // inverse-square falloff. WebGLRenderer installs render() on the
    // instance, so the adapter's prototype hook cannot supply the sign.
    const lampDecay = T.ShaderChunk.lights_pars_begin.includes('decayExponent < 0.0') ? -2 : 2;
    const pigment = hex => {
      const color = new T.Color(hex);
      return T.ColorManagement.enabled ? color : color.convertSRGBToLinear();
    };

    function stone(slot) {
      if (materials.has(slot)) return materials.get(slot);
      if (slot === 'RoofGlow') {
        return new T.MeshBasicMaterial({ color: pigment(0xc1a583), side: T.DoubleSide });
      }
      const material = new T.MeshStandardMaterial({
        color: pigment(colors[slot] || 0xffffff), metalness: 0, roughness: 1,
        side: T.DoubleSide
      });
      material.normalScale.set(1.18, 1.18);
      if (slot === 'Dust') {
        material.transparent = true;
        material.depthWrite = false;
        material.forceSinglePass = true;
        material.onBeforeCompile = shader => {
          shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>',
            '#ifdef USE_MAP\n diffuseColor.a *= 0.82 * (1.0 - smoothstep(0.24, 0.49, length(vMapUv - 0.5)));\n#endif');
        };
      }
      // Retain the shade inside the carved recesses under the moonlight.
      if (slot === 'Niches') {
        material.emissive.copy(pigment(0x506d9b));
        material.emissiveIntensity = 0.20;
      }
      materials.set(slot, material);
      return material;
    }

    function band(slot, radius, a0, a1, y0, y1, repeats = 1) {
      const steps = Math.max(2, Math.ceil((a1 - a0) * 24));
      for (let i = 0; i < steps; i++) {
        const lo = i / steps, hi = (i + 1) / steps;
        const a = a0 + (a1 - a0) * lo, b = a0 + (a1 - a0) * hi;
        // The root is reflected. From the hall, lower angles are screen right
        // when looking east, so U runs in the opposite direction to the arc.
        A.surface(slot, [A.point(radius, a, y0), A.point(radius, b, y0),
          A.point(radius, b, y1), A.point(radius, a, y1)], 1,
        [[(1 - lo) * repeats, 0], [(1 - hi) * repeats, 0],
          [(1 - hi) * repeats, 1], [(1 - lo) * repeats, 1]]);
      }
    }

    function shell() {
      const murals = [
        ['Sin', -0.279, 0.255, 2.47, 8.64],
        ['Ziggurat', 0.43, 1.00, 2.62, 7.48],
        ['Seal', -1.03, -0.49, 2.62, 7.48]
      ];
      for (const [slot, a, b, lo, hi] of murals) {
        band(slot, radius - 0.31, a, b, gallery + lo, gallery + hi);
        for (const y of [gallery + lo - 0.10, gallery + hi + 0.10]) {
          band('Capitals', radius - 0.39, a - 0.012, b + 0.012, y - 0.10, y + 0.10, 4);
        }
      }

      for (let i = 0; i < 26; i++) {
        const a = (i + 0.5) * TAU / 26;
        if (![a - 0.11, a, a + 0.11].some(A.opening)) alcove(a);
      }
      for (const [low, high, r, slot, periods] of [
        [gallery + 2.27, gallery + 2.58, radius - 0.43, 'Cuneiform', 25],
        [gallery + 8.77, gallery + 9.12, radius - 0.43, 'Cuneiform', 22],
        [spring - 1.28, spring - 0.45, radius - 0.40, 'Procession', 18]
      ]) {
        for (let i = 0; i < periods; i++) {
          const a = i * TAU / periods, b = a + TAU / periods;
          if (low > gallery + 8.4 || ![a, (a + b) / 2, b].some(A.opening)) band(slot, r, a, b, low, high);
        }
      }
      // Top coping and recesses run over the existing handrail collision.
      for (let i = 0; i < 48; i++) {
        const a = i * TAU / 48;
        const half = TAU / 96;
        if ([a - half, a, a + half].some(A.inStair)) continue;
        band('Rail', 15.785, a - half, a + half, gallery + 0.805, gallery + 0.932);
        band('Rail', 16.175, a - half, a + half, gallery + 0.805, gallery + 0.932);
      }
    }

    function alcove(angle) {
      const r = radius - 0.14;
      const front = r - 0.54, back = r;
      const half = 1.18, lip = 0.25, floor = gallery + 0.012, impost = gallery + 1.33;
      const c = Math.cos(angle), s = Math.sin(angle);
      const frame = (depth, y, t) => [u + depth * c - t * s, y, v + depth * s + t * c];
      function stoneFace(slot, depth, x0, x1, y0, y1, uv) {
        A.surface(slot, [frame(depth, y0, x0), frame(depth, y0, x1),
          frame(depth, y1, x1), frame(depth, y1, x0)], 1, uv);
      }
      const view = (x, y) => [0.5 - x / 3.15, 0.04 + (y - floor) / 2.84];
      stoneFace('Niches', back, -half, half, floor, impost,
        [[1, 0], [0, 0], [0, 0.46], [1, 0.46]]);
      for (const sign of [-1, 1]) {
        const x0 = sign * half, x1 = sign * (half + lip);
        stoneFace('ArchRibs', front, x0, x1, floor, impost);
        A.surface('RoofEdge', [frame(front, floor, x0), frame(back, floor, x0),
          frame(back, impost, x0), frame(front, impost, x0)]);
      }
      for (let i = 0; i < 9; i++) {
        const a = i * Math.PI / 9, b = (i + 1) * Math.PI / 9;
        const x0 = Math.cos(a) * half, x1 = Math.cos(b) * half;
        const y0 = impost + Math.sin(a) * half * 0.84, y1 = impost + Math.sin(b) * half * 0.84;
        const rim = (depth, theta, width) => frame(depth, impost + Math.sin(theta) * width * 0.84, Math.cos(theta) * width);
        A.surface('Niches', [frame(back, impost, 0), frame(back, y0, x0), frame(back, y1, x1)], 1,
          [view(0, impost), view(x0, y0), view(x1, y1)]);
        A.surface('ArchRibs', [rim(front, a, half), rim(front, b, half),
          rim(front, b, half + lip), rim(front, a, half + lip)]);
        A.surface('RoofEdge', [rim(front, a, half), rim(back, a, half), rim(back, b, half), rim(front, b, half)]);
      }
    }

    function debrisDust() {
      for (const [r, a, y, w, d] of [
        [14.85, 2.83, basin, 4.8, 2.1], [14.6, -2.81, basin, 4.3, 2.5],
        [14.45, -0.66, basin, 3.9, 2.1], [14.45, 1.66, basin, 4.6, 2.1],
        [10.6, 2.59, basin, 3.5, 1.65], [9.7, -0.29, basin, 3.8, 1.4],
        [18.5, 2.56, gallery, 4.1, 1.5], [18.45, -0.81, gallery, 3.4, 1.5],
        [18.4, -2.42, gallery, 3.6, 1.7], [18.35, 1.27, gallery, 3.6, 1.7]
      ]) {
        const [x, , z] = A.point(r, a, y);
        const corners = [[-w, -d], [-w, d], [w, d], [w, -d]].map(([t, f]) =>
          [x + (f * Math.cos(a) - t * Math.sin(a)) / 2, y + 0.017,
            z + (f * Math.sin(a) + t * Math.cos(a)) / 2]);
        A.surface('Dust', corners, 1, [[0, 0], [0, 1], [1, 1], [1, 0]]);
      }
    }

    function stairs() {
      for (const direction of [-1, 1]) {
        for (let step = 0; step < 5; step++) {
          const outer = 7.50 - step * 0.39;
          const inner = step === 4 ? range(4.12) : outer - 0.39;
          const x = [u + inner * direction, u + outer * direction].sort((a, b) => a - b);
          A.box('PlatformSteps', x[0], x[1], basin + step * 0.18, basin + (step + 1) * 0.18, v - 1.25, v + 1.25);
        }
      }
    }

    const propPlan = Object.fromEntries(Object.keys(NODES).map(key => [key, []]));
    function place(type, r, angle, y, yaw, scale, footprint, tilt = 0) {
      const [x, , z] = A.point(r, angle, y);
      propPlan[type].push({ x, y, z, yaw, scale, tilt });
      if (footprint) {
        const [w, d, h] = footprint;
        // A tight inset footprint permits walking beside sculpted silhouettes.
        const hx = Math.abs(Math.cos(yaw)) * w / 2 + Math.abs(Math.sin(yaw)) * d / 2;
        const hz = Math.abs(Math.sin(yaw)) * w / 2 + Math.abs(Math.cos(yaw)) * d / 2;
        A.propCollision(x - hx, x + hx, y, y + h, z - hz, z + hz);
      }
    }

    function plan() {
      debrisDust();
      place('platform', 0, 0, basin, platformYaw, platformScale);
      for (const angle of A.columns) {
        place('column', 19.00, angle, gallery + 0.16, -angle - Math.PI / 2,
          [1.37, (spring - gallery - 0.16) / 4.698, 1.37], [1.55, 1.55, spring - gallery]);
      }
      place('guardian', 13.7, 0.41, basin, -1.13, [1.05, 1.13, 1.12], [3.0, 1.16, 5.15]);
      place('guardian', 13.7, -0.41, basin, 1.13, [1.05, 1.13, 1.12], [3.0, 1.16, 5.15]);
      const steles = [
        [18.5, 2.45, gallery, 0.55, 0.75, -0.16],
        [18.05, 3.73, gallery, 2.05, 0.60, -0.23],
        [14.2, 1.82, basin, -2.45, 0.54, -0.18],
        [18.54, -0.79, gallery, -0.69, 0.62, -0.12]
      ];
      for (const [r, a, y, yaw, s, tilt] of steles) {
        place('stele', r, a, y, yaw, [s, s, s], [1.95 * s, 0.71 * s, 3.4 * s], tilt);
      }
      const piles = [
        [15.2, 2.86, 0.71], [14.95, -2.85, 0.68], [15.0, -1.09, 0.73],
        [14.8, 0.89, 0.59], [14.9, 1.67, 0.87], [14.3, -1.89, 0.60],
        [9.8, -0.29, 0.52], [11.0, 2.61, 0.50], [7.85, 1.92, 0.48],
        [7.9, -2.38, 0.50], [18.4, 2.61, 0.63], [18.82, 3.86, 0.68],
        [18.85, 1.27, 0.56], [18.8, -0.94, 0.61], [14.65, -0.61, 0.69]
      ];
      piles.forEach(([r, a, s], i) => {
        const yaw = Math.PI / 2 - a + Math.sin(i * 12.47) * 0.58;
        place('rubble', r, a, r > 16 ? gallery - 0.03 : basin - 0.05,
          yaw, [s, s * (0.76 + 0.15 * Math.sin(i)), s], [3.2 * s, 1.2 * s, 1.25 * s]);
      });
      // The raised drums are part of the authored platform mesh.
      for (const angle of [0.18, 0.88, 1.20, 1.92, 2.35, 2.98, 4.02, 4.33, 5.06, 6.18]) {
        const [x, , z] = A.point(range(3.75), angle - platformYaw, basin);
        A.propCollision(x - 0.37, x + 0.37, basin + 0.92, basin + 1.44, z - 0.37, z + 0.37);
      }
    }

    function addLight(color, intensity, falloff, position, target) {
      const light = target
        ? new T.SpotLight(color, intensity, falloff, 0.53, 0.69, lampDecay)
        : new T.PointLight(color, intensity, falloff, lampDecay);
      light.color.copy(pigment(color));
      light.position.set(...position);
      if (target) {
        light.target.position.set(...target);
        rig.add(light.target);
      }
      rig.add(light);
      return light;
    }

    function shaft(top, end, topWidth, baseWidth, color, density) {
      const origin = new T.Vector3(...top), target = new T.Vector3(...end);
      const span = target.clone().sub(origin);
      const geometry = new T.CylinderGeometry(topWidth, baseWidth, span.length(), 16, 1, true);
      const material = new T.ShaderMaterial({
        transparent: true, depthWrite: false, side: T.DoubleSide,
        blending: T.AdditiveBlending, forceSinglePass: true,
        uniforms: { tint: { value: pigment(color) }, density: { value: density }, time },
        vertexShader: `
          varying vec2 vTex;
          varying vec3 vView, vNrm;
          void main() {
            vTex = uv;
            vec4 p = modelViewMatrix * vec4(position,1.0);
            vView = -p.xyz;
            vNrm = normalMatrix * normal;
            gl_Position = projectionMatrix * p;
          }`,
        fragmentShader: `
          uniform vec3 tint;
          uniform float density,time;
          varying vec2 vTex;
          varying vec3 vView,vNrm;
          void main() {
            float rim = abs(dot(normalize(vNrm),normalize(vView)));
            float y = vTex.y;
            float fade = smoothstep(0.0,0.38,y) * (1.0-smoothstep(0.91,1.0,y));
            float roll = sin(81.68*vTex.x + 3.0*y + 0.08*time) *
                         sin(31.416*vTex.x - 5.0*y - 0.05*time);
            gl_FragColor = vec4(tint, density*fade*pow(rim,2.3)*(0.84+0.16*roll));
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`
      });
      const mesh = new T.Mesh(geometry, material);
      mesh.position.copy(origin).addScaledVector(span, 0.5);
      mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), span.normalize().negate());
      fx.add(mesh);
    }

    function dust() {
      let seed = 49813;
      const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
      const positions = [], strengths = [];
      for (let i = 0; i < 320; i++) {
        const a = random() * TAU, r = i < 190 ? 11 * Math.sqrt(random()) : 17 * Math.sqrt(random());
        positions.push(u + r * Math.cos(a), basin + 0.75 + 13 * random(), v + r * Math.sin(a));
        strengths.push(random());
      }
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('strength', new T.Float32BufferAttribute(strengths, 1));
      const material = new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending,
        uniforms: { time },
        vertexShader: `
          uniform float time;
          attribute float strength;
          varying float opacity;
          void main(){
            vec3 p = position;
            p += vec3(sin(time*.29+strength*29.),sin(time*.20+strength*63.),
                      cos(time*.25+strength*41.)) * .42;
            vec4 q = modelViewMatrix * vec4(p,1.0);
            opacity = smoothstep(1.0,4.0,-q.z) * (0.15+0.25*strength);
            gl_PointSize = clamp((6.0+9.0*strength)/max(1.0,-q.z),1.,3.0);
            gl_Position = projectionMatrix*q;
          }`,
        fragmentShader: `
          varying float opacity;
          void main() {
            float d = length(gl_PointCoord-.5)*2.;
            gl_FragColor = vec4(.77,.61,.44,opacity*(1.-smoothstep(.05,1.,d)));
          }`
      });
      fx.add(new T.Points(geometry, material));
    }

    function atmosphere() {
      const overhead = A.apertures.map(({ r, a, glow, width }) => ({
        position: A.point(r, a, A.domeY(r) - 0.12), glow, width
      }));
      for (const [i, light] of overhead.entries()) {
        const target = [light.position[0] + 2.5 - i * 0.5, basin + 0.16, light.position[2] - 2.1 + i * 0.48];
        const spot = addLight(0xffe3c0, light.glow, 38, light.position, target);
        if (i === 0) {
          spot.castShadow = true;
          spot.shadow.mapSize.set(1024, 1024);
          spot.shadow.camera.near = 1.5;
          spot.shadow.camera.far = 33;
          spot.shadow.normalBias = 0.045;
          spot.shadow.bias = -0.0004;
          spot.shadow.autoUpdate = false;
        }
        shaft(light.position, target, light.width, light.width * 2.2, 0xffe1b9, i === 0 ? 0.092 : 0.073);
      }
      addLight(0x8fb8ff, 62, 15, [u, basin + 3.2, v]);
      addLight(0x8aa6cf, 38, 10, [u + 14.5, gallery + 0.75, v + 5]);
      addLight(0x8aa6cf, 33, 10, [u + 14.5, gallery + 0.75, v - 6]);
      addLight(0xffe4bc, 100, 24, [u + 11, gallery + 8.6, v]);
      shaft([u, basin + 5.9, v], [u, basin + 1.05, v], 1.5, 2.45, 0x80a7e4, 0.065);
      dust();
    }

    async function loadMaps(renderer) {
      const loader = new T.TextureLoader();
      const names = [...new Set([...materials.keys()].map(slot => skin[slot]))];
      const maps = new Map();
      const settled = await Promise.allSettled(names.map(async name => {
        const set = {};
        maps.set(name, set);
        const results = await Promise.allSettled(['base', 'normal', 'rough'].map(async channel => {
          const map = await loader.loadAsync(A.url(DIR + name + '-' + channel + '.webp'));
          map.colorSpace = channel === 'base' ? T.SRGBColorSpace : T.NoColorSpace;
          map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
          if (metres[name]) map.wrapS = map.wrapT = T.RepeatWrapping;
          if (['cuneiform', 'procession', 'rail'].includes(name)) map.wrapS = T.RepeatWrapping;
          set[channel] = map;
        }));
        const failure = results.find(result => result.status === 'rejected');
        if (failure) throw new Error('Missing hall texture: ' + name);
      }));
      const failure = settled.find(result => result.status === 'rejected');
      if (failure) {
        for (const set of maps.values()) for (const texture of Object.values(set)) texture.dispose();
        throw failure.reason;
      }
      for (const [slot, material] of materials) {
        const set = maps.get(skin[slot]);
        material.map = set.base;
        material.normalMap = set.normal;
        material.roughnessMap = set.rough;
        if (slot === 'Niches') material.emissiveMap = set.base;
        material.needsUpdate = true;
      }
      return [...maps.values()].flatMap(set => Object.values(set));
    }

    async function loadProps(renderer) {
      // The stair normally initializes the same decoders first. Wait for it
      // in the stage loader so both areas use one copy of the Meshopt decoder.
      if (!window.MeshoptDecoder) await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = A.url('vendor/meshopt_decoder.js');
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      const { KTX2Loader } = await window.THREE.loadKTX2Loader();
      const ktx = new KTX2Loader().setTranscoderPath(A.url('vendor/basis/')).setWorkerLimit(2).detectSupport(renderer);
      try {
        const loader = new window.THREE.GLTFLoader().setKTX2Loader(ktx).setMeshoptDecoder(window.MeshoptDecoder);
        const result = await fetch(A.url(PROP));
        if (!result.ok) throw new Error('Hall GLB HTTP ' + result.status);
        const buffer = await result.arrayBuffer();
        const gltf = await loader.parseAsync(buffer, A.url('assets/'));
        return { gltf, bytes: buffer.byteLength };
      } finally {
        ktx.dispose();
      }
    }

    function setProps(gltf, renderer, reduced) {
      const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      const count = {};
      const nodeList = Object.entries(NODES).map(([type, name]) => {
        const node = gltf.scene.getObjectByName(name);
        if (!node) throw new Error('Missing hall asset ' + name);
        return [type, node];
      });
      gltf.scene.updateMatrixWorld(true);
      for (const [type, node] of nodeList) {
        const parts = [];
        node.traverse(mesh => { if (mesh.isMesh) parts.push(mesh); });
        const bounds = new T.Box3().setFromObject(node);
        if (bounds.isEmpty()) throw new Error('Empty hall asset ' + node.name);
        const center = bounds.getCenter(new T.Vector3());
        const shift = new T.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z);
        const placements = propPlan[type];
        const transforms = placements.map(p => new T.Matrix4().compose(
          new T.Vector3(p.x, p.y, p.z), new T.Quaternion().setFromEuler(new T.Euler(p.tilt, p.yaw, 0, 'YXZ')),
          new T.Vector3(...p.scale)));
        count[type] = { instances: placements.length, triangles: 0, lodTriangles: 0 };
        for (const part of parts) {
          const inner = shift.clone().multiply(part.matrixWorld);
          const material = part.material;
          const geometry = part.geometry;
          const lowIndex = reduced.get(node.name + '/' + material.name);
          const triangleCount = (geometry.index?.count || geometry.attributes.position.count) / 3;
          count[type].triangles += triangleCount;
          count[type].lodTriangles += lowIndex ? lowIndex.length / 3 : triangleCount;
          const low = lowIndex ? new T.BufferGeometry().setIndex(new T.BufferAttribute(lowIndex, 1)) : null;
          if (low) {
            for (const [name, attribute] of Object.entries(geometry.attributes)) low.setAttribute(name, attribute);
            low.boundingBox = geometry.boundingBox;
            low.boundingSphere = geometry.boundingSphere;
          }
          for (const field of ['map', 'normalMap', 'roughnessMap', 'aoMap']) {
            if (material[field]) material[field].anisotropy = anisotropy;
          }
          if (material.name === 'Astral_Platform_Engraved_Dial') {
            material.emissive.copy(pigment(0x5b8ddd));
            material.emissiveMap = material.map;
            material.emissiveIntensity = 0.16;
          }
          const make = g => {
            const mesh = new T.InstancedMesh(g, material, transforms.length);
            mesh.name = node.name + '/' + material.name;
            mesh.castShadow = type === 'platform' || type === 'guardian' || type === 'column';
            mesh.receiveShadow = true;
            // Matrices are repacked on distance changes. Bounds must include
            // every possible instance; disabling culling is inexpensive here.
            mesh.frustumCulled = false;
            assets.add(mesh);
            return mesh;
          };
          const near = make(geometry);
          const far = low && make(low);
          const matrices = transforms.map(matrix => matrix.clone().multiply(inner));
          if (far) lods.push({ near, far, matrices, placements, split: type === 'guardian' ? 12 : 8, previous: '' });
          else {
            matrices.forEach((matrix, i) => near.setMatrixAt(i, matrix));
            near.instanceMatrix.needsUpdate = true;
          }
        }
      }
      return count;
    }

    function updateLods(x, z) {
      if (Math.hypot(x - lodX, z - lodZ) < 0.22) return;
      lodX = x;
      lodZ = z;
      for (const state of lods) {
        const { near, far, matrices, placements, split } = state;
        const mask = placements.map(p => Math.hypot(p.x - x, p.z - z) < split);
        const signature = mask.join(',');
        if (signature === state.previous) continue;
        state.previous = signature;
        near.count = far.count = 0;
        matrices.forEach((matrix, i) => {
          const target = mask[i] ? near : far;
          target.setMatrixAt(target.count++, matrix);
        });
        near.visible = near.count > 0;
        far.visible = far.count > 0;
        near.instanceMatrix.needsUpdate = far.instanceMatrix.needsUpdate = true;
      }
    }

    async function loadLods() {
      const response = await fetch(A.url(DIR + 'prop-lod.bin'));
      if (!response.ok) throw new Error('Hall LOD HTTP ' + response.status);
      const buffer = await response.arrayBuffer();
      const size = new DataView(buffer).getUint32(0, true);
      const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, size)));
      let offset = 4 + Math.ceil(size / 4) * 4;
      const entries = new Map();
      for (const [key, count] of manifest) {
        entries.set(key, new Uint32Array(buffer, offset, count));
        offset += count * 4;
      }
      return entries;
    }

    async function load(renderer) {
      const start = performance.now();
      shared = root.parent.children.filter(node => node.isLight).map(light =>
        [light, light.intensity, light.color.clone(), light.groundColor?.clone()]);
      const results = await Promise.allSettled([loadMaps(renderer), loadProps(renderer), loadLods()]);
      const glb = results[1].status === 'fulfilled' ? results[1].value : null;
      try {
        for (const result of results) if (result.status === 'rejected') throw result.reason;
        const props = setProps(glb.gltf, renderer, results[2].value);
        updateLods(u - 18, v);
        const maps = results[0].value;
        const resources = window.SinR3SealedZone.resources([assets]);
        const propTextureBytes = [...resources.textures].reduce((total, tex) => {
          if (tex.mipmaps?.length) return total + tex.mipmaps.reduce((sum, level) => sum + (level.data?.byteLength || 0), 0);
          return total + (tex.image?.width || 0) * (tex.image?.height || 0) * 16 / 3;
        }, 0);
        atmosphere();
        const architecture = group.children.filter(node => node.isMesh);
        const fallback = architecture.filter(node => A.fallbackSlots.includes(node.name));
        const stairsGroup = architecture.find(node => node.name === 'PlatformSteps');
        for (const node of fallback) {
          node.removeFromParent();
          node.geometry.dispose();
          node.material.dispose();
        }
        if (stairsGroup) stairsGroup.visible = true;
        group.add(assets, fx);
        root.add(rig);
        installed = true;
        return {
          glbBytes: glb.bytes, props, maps: maps.length, propTextures: resources.textures.size,
          propTextureBytes: Math.round(propTextureBytes), loadMs: Math.round(performance.now() - start),
          mapBytesWithMipmaps: Math.round(maps.reduce((sum, map) => sum + map.image.width * map.image.height * 16 / 3, 0))
        };
      } catch (error) {
        if (glb) {
          const drop = window.SinR3SealedZone.resources([glb.gltf.scene, assets, fx, rig]);
          window.SinR3SealedZone.release(drop, window.SinR3SealedZone.resources([]));
        }
        console.error('[R3-02] hall dressing', error);
        return { error: error.message };
      }
    }

    const fog = new T.FogExp2(pigment(0x4c403a), 0.018);
    const fillColor = pigment(0xffeee0), bounceColor = pigment(0x6b5650), rimColor = pigment(0xffdfc1);
    function update(x, z, inside, visible) {
      if (!installed) return;
      updateLods(x, z);
      time.value = performance.now() / 1000 % 10000;
      rig.visible = inside;
      if (visible && !inside) {
        // The entrance can glimpse the hall without contributing its lights
        // to the previous flight. The base stage rig still lights that view.
        fx.visible = false;
      } else fx.visible = inside;
      const scene = root.parent?.parent;
      if (!scene) return;
      if (inside) {
        for (const [light] of shared) {
          light.intensity = light.isHemisphereLight ? 1.12 : 0.42;
          light.color.copy(light.isHemisphereLight ? fillColor : rimColor);
          light.groundColor?.copy(bounceColor);
        }
        scene.fog = fog;
        if (!wasInside) {
          const key = rig.children.find(node => node.castShadow);
          if (key) key.shadow.needsUpdate = true;
        }
      } else if (wasInside) {
        // The stair updates its own lighting before this function. Restore
        // only when that update has left the hall's fog as the active fog.
        if (scene.fog === fog) {
          scene.fog = null;
          for (const [light, intensity, color, ground] of shared) {
            light.intensity = intensity;
            light.color.copy(color);
            if (ground) light.groundColor.copy(ground);
          }
        }
      }
      wasInside = inside;
    }

    return { stone, shell, stairs, plan, load, update, ready: () => installed };
  }

  window.SinR3Hall = { create, platformFloor, uv };
})();
