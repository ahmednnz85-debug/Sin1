/* R3-03. Local x follows the final approach, z crosses it, and y starts at the landing. */
(function (root) {
  'use strict';
  const CENTER = [12.9, -1.40], DECK = 0.58, PLATFORM_SCALE = 1.38;
  const DECK_RADIUS = 4.86, ARCH = 8.18, SPRING = 5.9, RISE = 6.9, ARCH_Z = -1.3;
  const FAR_RIM = 20.4, HALF = 9.55, SHOULDER = 13.4;
  const geology = root.SinR3MawGeology;
  const BUDGET = Object.freeze({ glbMiB: 22, drawCalls: 85, trianglesInView: 515000 });
  const tau = 2 * Math.PI;
  const anchors = [-1, 1].flatMap(x => [-1, 1].map(z => [
    CENTER[0] + x * 2.33345238 * PLATFORM_SCALE, CENTER[1] + z * 2.33345238 * PLATFORM_SCALE
  ]));
  const halfWidth = x => Math.min(HALF, 3 + Math.max(0, x) * 2.1);

  function floor(x, z) {
    if (x < -0.04 || x > FAR_RIM || Math.abs(z) > halfWidth(x)) return null;
    if (x > SHOULDER && ((x - SHOULDER) / (FAR_RIM - SHOULDER)) ** 2 + (z / HALF) ** 2 > 1) return null;
    const radius = Math.hypot(x - CENTER[0], z - CENTER[1]);
    return radius <= DECK_RADIUS ? DECK : radius <= 5.12 ? 0.38 : radius <= 5.46 ? 0.19 : 0;
  }

  function create({ THREE: T, group, entry, lane, level, collision }) {
    const room = new T.Group();
    room.name = 'MawOfTheAbyss_Dressing';
    room.position.set(entry, level, lane);
    group.add(room);
    room.visible = false;
    const status = room.userData.maw = { phase: 'idle', selected: [], anchors: [], budget: BUDGET };
    let renderer, pending;
    const transform = { value: new T.Matrix4() }, clock = { value: 0 };

    // Local world-space attenuation keeps the cliff mist and the entrance
    // contact shade independent of the fog/lights used in the neighbouring rooms.
    function finish(material, kind = 0) {
      material.fog = false;
      material.customProgramCacheKey = () => 'r3-maw-stone-' + kind;
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, { mawW2L: transform, mawTime: clock });
        shader.vertexShader = shader.vertexShader.replace('#include <common>',
          '#include <common>\nuniform mat4 mawW2L; varying vec3 vMaw;')
          .replace('#include <project_vertex>', `
            #include <project_vertex>
            vec4 mawP = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
            mawP = instanceMatrix * mawP;
            #endif
            vMaw = (mawW2L * modelMatrix * mawP).xyz;
          `);
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
          #include <common>
          uniform mat4 mawW2L;
          varying vec3 vMaw;
          float mawSquare(float n) { return n*n; }
          ${kind === 2 ? geology.scattering : ''}
        `)
          .replace('#include <color_fragment>', `
            #include <color_fragment>
            float mawWear = sin(vMaw.x * 2.62 + sin(vMaw.z * 1.37)) *
              cos(vMaw.z * 1.73 - vMaw.y * 0.31);
            float mawTone = dot(diffuseColor.rgb,vec3(0.263,0.655,0.082));
            diffuseColor.rgb = mix(vec3(mawTone), diffuseColor.rgb, ${kind === 2 ? '0.52' : '0.72'}) *
              (0.94 + mawWear * 0.09);
          `)
          .replace('#include <opaque_fragment>', `
            float mao = 1.0;
            ${kind === 1 ? `
              vec2 p = vMaw.xz;
              mao -= 0.40 * exp(-dot((p-vec2(8.2,5.45))/vec2(2.0,1.15),
                (p-vec2(8.2,5.45))/vec2(2.0,1.15)));
              mao -= 0.18 * smoothstep(6.3, 9.6, abs(p.y));
              mao -= 0.14 * exp(-abs(length(p-vec2(12.9,-1.4))-4.9)*7.0);
            ` : ''}
            float topLight = smoothstep(-1.6, 13.0, vMaw.x) *
              (0.45 + 0.55 * exp(-mawSquare((vMaw.z+1.1)*0.12)));
            ${kind === 2 ? `
              vec3 eye=(mawW2L * vec4(cameraPosition,1.0)).xyz;
              float cracks=mNoise(vec3(vMaw.x*1.8,vMaw.y*0.22,vMaw.z*1.4));
              float strata=0.49 + 0.50*smoothstep(0.12,0.72,cracks);
              float depthShade=0.53+0.47*smoothstep(-54.0,7.0,vMaw.y);
              vec3 bounce=diffuseColor.rgb*vec3(0.014,0.033,0.049);
              vec3 charcoal=(outgoingLight*vec3(0.18,0.215,0.24)*strata+bounce)*depthShade;
              outgoingLight=mawScatter(charcoal,eye,vMaw);
            ` : `
              outgoingLight *= mao * mix(vec3(0.58,0.59,0.61),vec3(0.86,0.94,1.02),topLight);
              float bounceKey=exp(-mawSquare((vMaw.x-12.75)*0.14)-mawSquare((vMaw.z+1.5)*0.15));
              bounceKey*=1.0-0.58*smoothstep(4.8,10.0,vMaw.y);
              float bounceLeft=exp(-mawSquare((vMaw.x-7.9)*0.30)-mawSquare((vMaw.z-5.1)*0.19));
              outgoingLight += diffuseColor.rgb * mao * (vec3(0.032,0.046,0.066) * topLight +
                vec3(0.16,0.20,0.24) * bounceKey + vec3(0.055,0.063,0.08)*bounceLeft +
                vec3(0.072,0.081,0.10) * smoothstep(7.0,11.0,vMaw.y));
            `}
            #include <opaque_fragment>
          `);
      };
      return material;
    }

    const stone = finish(new T.MeshStandardMaterial({ color: 0x9c9389, roughness: 0.95, side: T.DoubleSide }));
    const paving = finish(new T.MeshStandardMaterial({ color: 0xb1a49a, roughness: 0.96, side: T.DoubleSide }), 1);
    const bands = finish(new T.MeshStandardMaterial({ color: 0x716459, roughness: 0.97, side: T.DoubleSide }));
    const pairs = new Map([[stone, []], [paving, []], [bands, []]]);
    const scratch = new T.Vector3();

    function collect(material, geo, metres) {
      const pos = geo.attributes.position, nor = geo.attributes.normal;
      const n = geo.index?.count ?? pos.count;
      const batch = pairs.get(material);
      for (let i = 0; i < n; i++) {
        const at = geo.index ? geo.index.getX(i) : i;
        scratch.fromBufferAttribute(pos, at);
        const { x, y, z } = scratch;
        const ax = nor.getX(at), ay = nor.getY(at), az = nor.getZ(at);
        const uv = Math.abs(ay) > 0.65 ? [x, z] : Math.abs(ax) > Math.abs(az) ? [z, y] : [x, y];
        batch.push(x, y, z, ax, ay, az, uv[0] / metres, uv[1] / metres);
      }
      geo.dispose();
    }

    function slab(x, y, z, width, height, depth, material = stone, yaw = 0) {
      // Small irregular chamfers catch the cool shafts along the edges.
      const c = Math.min(width, height, depth) * 0.13;
      const w = width / 2 - c, d = depth / 2 - c;
      const shape = new T.Shape([[-w, -d], [w, -d], [w, d], [-w, d]].map(p => new T.Vector2(...p)));
      const block = new T.ExtrudeGeometry(shape, { depth: height - c * 2, bevelThickness: c, bevelSize: c,
        bevelSegments: 1, steps: 1, curveSegments: 1 });
      block.rotateX(-Math.PI / 2).translate(0, -height / 2 + c, 0).rotateY(yaw).translate(x, y, z);
      collect(material, block, material === bands ? 1.6 : 2.35);
    }
    const hit = (minX, maxX, minY, maxY, minZ, maxZ) =>
      collision(entry + minX, entry + maxX, level + minY, level + maxY, lane + minZ, lane + maxZ, true);

    // The walkable envelope and its visible paving share the same outline.
    const outline = [[-0.08, -3], [3.12, -HALF], [SHOULDER, -HALF]];
    for (let i = 1; i <= 32; i++) {
      const a = Math.PI * i / 32;
      outline.push([SHOULDER + (FAR_RIM - SHOULDER) * Math.sin(a), -HALF * Math.cos(a)]);
    }
    outline.push([3.12, HALF], [-0.08, 3]);
    const shape = new T.Shape(outline.map(([x, z]) => new T.Vector2(x, -z)));
    const hole = new T.Path();
    hole.absarc(CENTER[0], -CENTER[1], 5.63, 0, tau, true);
    shape.holes.push(hole);
    collect(paving, new T.ShapeGeometry(shape, 48).rotateX(-Math.PI / 2), 2.9);
    for (const [inner, outer, height] of [[5.46, 5.66, 0], [5.12, 5.46, 0.19], [4.85, 5.12, 0.38]]) {
      const ring = new T.RingGeometry(inner, outer, 72);
      ring.rotateX(-Math.PI / 2).translate(CENTER[0], height, CENTER[1]);
      collect(paving, ring, 2.85);
      const curb = new T.CylinderGeometry(outer, outer, 0.19, 72, 1, true)
        .translate(CENTER[0], height - 0.095, CENTER[1]);
      collect(bands, curb, 1.8);
    }
    // Solid masonry below the movement joint keeps the blue gorge from
    // showing through when the camera looks across the back of the platform.
    const collar = new T.RingGeometry(3.82, 5.74, 80).rotateX(-Math.PI / 2)
      .translate(CENTER[0], -0.09, CENTER[1]);
    collect(bands, collar, 2.15);

    // Main opening. Individual voussoirs share one stone batch; the reveal
    // has real depth and sits behind the two close stone supports.
    for (let i = 0; i < 26; i++) {
      const a = Math.PI * (i + 0.027) / 26, b = Math.PI * (i + 0.97) / 26;
      const section = new T.Shape([
        new T.Vector2(ARCH * Math.cos(a), SPRING + RISE * Math.sin(a)),
        new T.Vector2(ARCH * Math.cos(b), SPRING + RISE * Math.sin(b)),
        new T.Vector2((ARCH + 1.5) * Math.cos(b), SPRING + (RISE + 1.52) * Math.sin(b)),
        new T.Vector2((ARCH + 1.5) * Math.cos(a), SPRING + (RISE + 1.52) * Math.sin(a))
      ]);
      const block = new T.ExtrudeGeometry(section, { depth: 2.2, bevelSize: 0.052, bevelThickness: 0.055,
        bevelSegments: 1, curveSegments: 1 });
      block.rotateY(-Math.PI / 2).translate(11.35, 0, ARCH_Z);
      collect(i === 0 || i === 25 ? bands : stone, block, 2.65);
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const centerY = i * 0.81 + 0.41;
        slab(10.21, centerY, ARCH_Z + side * 8.90, i === 0 ? 2.77 : 2.38, 0.82,
          i === 0 ? 1.9 : 1.65, i === 0 || i === 6 ? bands : stone);
      }
      for (let i = 0; i < 7; i++) {
        for (let j = 0; j < 4; j++) {
          slab(2.2 + j * 1.88 + (i % 2) * 0.29, 0.65 + i * 1.18, side * (9.72 + (3 - j) * 0.23),
            1.92, 1.21, 1.48, i === 3 ? bands : stone, side * 0.04);
        }
      }
      hit(8.81, 11.59, 0, 6.2, ARCH_Z + side * 8.9 - 0.92, ARCH_Z + side * 8.9 + 0.92);
    }
    // The left guardian is seated against a solid return. Back the individual
    // courses so neither their joints nor the space behind the plinth leak blue.
    for (let i = 0; i < 9; i++) {
      slab(9.35 + (i % 2) * 0.09, 0.66 + i * 1.36, 9.13,
        1.73, 1.39, 3.26, i === 3 || i === 6 ? bands : stone);
    }
    // Lock the camera/character out of the narrow side footings and rear rail.
    // The rear rail uses a slightly irregular curved profile facing the void.
    const deckEdge = a => [SHOULDER + (FAR_RIM - SHOULDER) * Math.sin(a), -HALF * Math.cos(a)];
    for (let i = 0; i < 16; i++) {
      const a = Math.PI * i / 16, b = Math.PI * (i + 1) / 16;
      const [x, z] = deckEdge(a), [nx, nz] = deckEdge(b);
      const d = Math.hypot(nx - x, nz - z);
      const yaw = -Math.atan2(nz - z, nx - x);
      slab((x + nx) / 2, 0.79, (z + nz) / 2, d + 0.06, 0.26, 0.40, bands, yaw);
      slab(x, 0.41, z, 0.41, 0.83, 0.43, stone);
      if (i === 15) slab(nx, 0.42, nz, 0.42, 0.84, 0.45);
      // Closely sampled narrow boxes maintain a smooth curved capsule stop.
      for (let k = 0; k <= 3; k++) {
        const [u, v] = deckEdge(a + (b - a) * k / 3);
        hit(u - 0.19, u + 0.19, 0, 0.98, v - 0.19, v + 0.19);
      }
    }
    for (const [x, z] of anchors) hit(x - 0.57, x + 0.57, DECK, DECK + 1.6, z - 0.55, z + 0.55);
    hit(6.55, 9.77, 0, 5.75, 4.47, 6.43);

    for (const [material, values] of pairs) {
      const geometry = new T.BufferGeometry();
      const data = new T.InterleavedBuffer(new Float32Array(values), 8);
      geometry.setAttribute('position', new T.InterleavedBufferAttribute(data, 3, 0));
      geometry.setAttribute('normal', new T.InterleavedBufferAttribute(data, 3, 3));
      geometry.setAttribute('uv', new T.InterleavedBufferAttribute(data, 2, 6));
      geometry.computeBoundingSphere();
      const mesh = new T.Mesh(geometry, material);
      mesh.name = material === paving ? 'Maw_Paving_And_Collar' : 'Maw_Arch_And_Stonework';
      room.add(mesh);
    }

    driftDust(T, room, clock);
    const approach = new Map();
    function material(slot) {
      const walk = slot === 'Landings' || slot === 'Treads';
      const key = walk ? 'ground' : 'wall';
      if (!approach.has(key)) {
        const m = finish(new T.MeshStandardMaterial({
          color: walk ? 0x787069 : 0x71645b, side: T.DoubleSide, roughness: 0.98
        }), walk ? 1 : 0);
        approach.set(key, m);
      }
      return approach.get(key);
    }
    function transferMaps(to, from) {
      for (const key of ['map', 'normalMap', 'roughnessMap', 'aoMap']) {
        if (from[key]) {
          from[key].wrapS = from[key].wrapT = T.RepeatWrapping;
          to[key] = from[key];
        }
      }
      to.aoMapIntensity = 0.86;
      to.normalScale.setScalar(0.94);
      to.needsUpdate = true;
    }
    async function load() {
      status.phase = 'loading';
      const started = performance.now();
      const mod = await import('three/addons/loaders/KTX2Loader.js');
      const basis = new mod.KTX2Loader().setTranscoderPath('vendor/basis/').setWorkerLimit(2).detectSupport(renderer);
      const loader = new T.GLTFLoader().setKTX2Loader(basis).setMeshoptDecoder(root.MeshoptDecoder);
      const files = ['elevator-and-ruins.glb', 'left-guardian.glb'];
      try {
        const textureLoader = new T.TextureLoader();
        const assets = await Promise.all([
          ...files.map(file => loader.loadAsync('assets/r3/maw/' + file)),
          ...['base', 'normal', 'rough'].map(channel => textureLoader.loadAsync('assets/r3/hall/paving-' + channel + '.webp')),
          ...['albedo', 'normal', 'orm'].map(channel => textureLoader.loadAsync('assets/r3/stair/ashlar_wall_' + channel + '.jpg'))
        ]);
        const [maw, guardian, color, normal, rough, wallColor, wallNormal, wallOrm] = assets;
        color.colorSpace = wallColor.colorSpace = T.SRGBColorSpace;
        const pbr = { map: color, normalMap: normal, roughnessMap: rough };
        const stonePbr = { map: wallColor, normalMap: wallNormal, roughnessMap: wallOrm, aoMap: wallOrm };
        transferMaps(paving, pbr);
        const kits = new Map(maw.scene.children.map(node => [node.name, node]));
        const built = new Set();
        const farMats = new Map();
        function place(name, x, y, z, scale, yaw = 0, distance = false) {
          const template = kits.get(name);
          if (!template) throw new Error('Missing Maw node ' + name);
          const model = template.clone(true);
          model.position.set(x, y, z);
          model.scale.set(...scale);
          model.rotation.y = yaw;
          model.traverse(mesh => {
            if (!mesh.isMesh) return;
            if (distance) {
              if (!farMats.has(mesh.material)) farMats.set(mesh.material, finish(mesh.material.clone(), 2));
              mesh.material = farMats.get(mesh.material);
            } else if (!built.has(mesh.material)) {
              finish(mesh.material, mesh.material.name === 'M_Platform_Deck' ? 1 : 0);
              if (mesh.material.name === 'M_Bronze_Hammered') mesh.material.color.multiplyScalar(0.71);
              built.add(mesh.material);
            }
          });
          room.add(model);
          if (!status.selected.includes(name)) status.selected.push(name);
          return model;
        }
        place('Elevator_Platform', CENTER[0], DECK - 0.8 * 1.10004, CENTER[1],
          [PLATFORM_SCALE, 0.8, PLATFORM_SCALE]);
        transferMaps(stone, stonePbr);
        transferMaps(bands, stonePbr);
        for (const [key, value] of approach) transferMaps(value, key === 'ground' ? pbr : stonePbr);

        const upperY = 11.35, lowerY = 0.79;
        place('Elevator_Mechanism', CENTER[0], upperY, CENTER[1], [1.58, 1.13, 1.58]);
        for (const [x, z] of anchors) {
          const yaw = Math.atan2(x - CENTER[0], z - CENTER[1]);
          place('Elevator_Anchor_Lower', x, lowerY, z, [0.96, 1, 0.96], yaw);
          place('Elevator_Anchor_Upper', x, upperY - 0.37, z, [1.29, 1.15, 1.29], yaw);
        }
        const specimen = kits.get('Elevator_Chain_Link_01');
        const link = specimen.getObjectByProperty('isMesh', true);
        const startY = lowerY + 1.37, endY = upperY - 1.35;
        const count = Math.round((endY - startY) / 0.41) + 1;
        const stride = (endY - startY) / (count - 1);
        const unit = stride / 0.31;
        const chain = new T.InstancedMesh(link.geometry, finish(link.material), count * 4);
        chain.name = 'Elevator_Chain_FourSuspensions';
        const linkPose = new T.Object3D();
        linkPose.scale.copy(link.scale).multiplyScalar(unit);
        for (let j = 0; j < anchors.length; j++) {
          const [x, z] = anchors[j];
          for (let i = 0; i < count; i++) {
            linkPose.position.set(x, startY + i * stride, z);
            linkPose.rotation.y = Math.atan2(x - CENTER[0], z - CENTER[1]) + (i % 2) * Math.PI / 2;
            linkPose.updateMatrix();
            chain.setMatrixAt(j * count + i, linkPose.matrix);
          }
          status.anchors.push({ x, z, bottom: startY, top: endY, links: count });
        }
        chain.computeBoundingSphere();
        room.add(chain);
        status.selected.push('Elevator_Chain_Link_01');

        const lamassu = guardian.scene.children[0];
        const stand = new T.Group();
        stand.name = 'Maw_Left_Lamassu';
        room.add(stand);
        stand.add(lamassu);
        // Preserve the quantization scale carried by the authored mesh root.
        lamassu.position.set(0, 0, 0);
        lamassu.rotation.y = -Math.PI / 2;
        stand.updateWorldMatrix(true, true);
        const worldSize = new T.Box3().setFromObject(lamassu).getSize(new T.Vector3());
        const scale = 5.5 / worldSize.y;
        stand.scale.setScalar(scale);
        stand.position.set(8.2, 2.75, 5.47);
        lamassu.traverse(mesh => { if (mesh.isMesh) finish(mesh.material); });
        status.selected.push(lamassu.name);

        // The canyon consists of bounded landforms with tops, depth and a
        // vault. A single rock map set is shared by all of its surfaces.
        const rock = kits.get('Abyss_Rock_Spire').getObjectByProperty('isMesh', true).material;
        const basalt = finish(rock.clone(), 2);
        basalt.side = T.DoubleSide;
        basalt.vertexColors = true;
        basalt.color.setHex(0x7b7871);
        basalt.normalScale.setScalar(0.82);
        room.add(geology.create(T, basalt));
        place('Abyss_Bridge_Ruined', 61.5, 4.15, -21.8, [1.59, 1.2, 1.07], -1.12, true);
        place('Abyss_Bridge_Ruined', 102.5, 4.37, 0.3, [1.92, 1.23, 1.13], 1.64, true);
        place('Abyss_Rock_Spire', 2.45, 0.18, 6.45, [0.47, 0.11, 0.37], 0.68);
        place('Abyss_Rock_Spire', 2.12, 0.05, 5.04, [0.22, 0.089, 0.23], -0.82);
        place('Abyss_Rock_Spire', 3.92, -0.07, 7.51, [0.37, 0.105, 0.23], -0.76);
        status.phase = 'ready';
        status.loadMs = Math.round(performance.now() - started);
      } finally {
        basis.dispose();
      }
    }

    return {
      room, material, status,
      configure(value) { renderer = value; },
      update(u, v, inside) {
        const near = inside && u > entry - 9 && Math.abs(v - lane) < 11;
        room.visible = inside && u > entry - 4 && Math.abs(v - lane) < 11;
        if (!near) return;
        room.updateWorldMatrix(true, false);
        transform.value.copy(room.matrixWorld).invert();
        clock.value = performance.now() / 1000;
        if (!pending && renderer) pending = load().catch(error => {
          status.phase = 'failed';
          status.error = String(error.message || error);
          console.error('[R3-03] ' + status.error);
        });
      }
    };
  }

  function driftDust(T, room, time) {
    const motes = [];
    for (let i = 0; i < 76; i++) {
      const f = (seed, mul) => (Math.sin((i + 1) * seed) * mul % 1 + 1) % 1;
      motes.push(6 + f(17.8, 12345) * 25, 0.48 + f(39.81, 14395) * 13, (f(79.3, 9421) - 0.5) * 23);
    }
    const dust = new T.BufferGeometry();
    dust.setAttribute('position', new T.Float32BufferAttribute(motes, 3));
    const particles = new T.Points(dust, new T.ShaderMaterial({
      uniforms: { elapsed: time }, depthWrite: false, transparent: true,
      blending: T.AdditiveBlending,
      vertexShader: `
        uniform float elapsed; varying float vAlpha;
        void main() {
          vec3 p=position+vec3(0.19*sin(position.z+elapsed*0.45),0.33*sin(position.x+elapsed*0.37),0.13*cos(position.y+elapsed*0.72));
          vec4 view=modelViewMatrix*vec4(p,1.0);
          vAlpha=0.11+0.11*sin(elapsed*0.8+position.z*2.1);
          gl_PointSize=clamp(28.0/max(-view.z,0.1),1.0,3.8);
          gl_Position=projectionMatrix*view;
        }`,
      fragmentShader: `
        varying float vAlpha;
        void main() { float d=length(gl_PointCoord-0.5); gl_FragColor=vec4(0.53,0.68,0.78,vAlpha*max(0.0,1.0-d*2.0)); }`
    }));
    particles.renderOrder = 26;
    particles.name = "Maw_Faint_Dust";
    room.add(particles);
  }

  root.SinR3Maw = { create, floor, limits: { far: FAR_RIM, half: HALF }, budget: BUDGET };
})(window);
