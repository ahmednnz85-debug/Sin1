/* L2 decoration. The three source GLBs each contain one indexed mesh and
   one UV atlas; their connected islands are fitted without remeshing. */
(function () {
  'use strict';
  const models = [
    ['assets/اثاث الارشيف.glb', {
      37130: 'tableLeft', 39240: 'tableSpare', 40142: 'tableRight', 2052: 'tabletA',
      2456: 'smallChest', 980: 'rolled', 1348: 'tabletB', 1470: 'quills',
      1046: 'book', 1812: 'flameBowl', 3024: 'openScroll', 1451: 'urnBlue', 3448: 'urnTall'
    }],
    ['assets/اثاث ونقوش.glb', {
      1974: 'tabletsStack', 3496: 'columnA', 3402: 'columnB', 5727: 'arch',
      3418: 'plinth', 7683: 'guardA', 7804: 'guardB', 7354: 'secretGate',
      2796: 'reliefA', 2560: 'reliefB', 1638: 'scroll', 1206: 'blueAnimals',
      870: 'inscriptionA', 866: 'blueRosettes', 1536: 'wingedSun',
      2351: 'lionBand', 1474: 'inscriptionB', 3546: 'carvedFigures',
      1436: 'potRound', 1807: 'scrollBundle', 2977: 'banner', 1350: 'potTall',
      3464: 'armillary', 1630: 'uprightTablet', 1220: 'brazier', 1384: 'lectern'
    }],
    ['assets/رفوف الارشيف.glb', { 31778: 'shelfA', 26582: 'shelfB', 19353: 'shelfC' }]
  ];
  const images = [
    'assets/حجر الارشيف.JPG', 'assets/سقف الارشيف.JPG', 'assets/سجاد الارضية.jpg'
  ];
  const atlas = { coffer: [584, 11, 647, 77], grille: [662, 11, 711, 77],
    flowers: [578, 99, 712, 121], script: [578, 140, 712, 165] };
  const floor = 0.022;
  const expected = [
    'stone-walls', 'stone-floor', 'ceiling-coffers', 'skylight-grille', 'blue-runner',
    'tableLeft', 'tableRight', 'shelfA', 'shelfB', 'shelfC', 'columnA', 'columnB',
    'guardA', 'guardB', 'arch', 'secretGate', 'reliefA', 'reliefB', 'brazier'
  ].map(name => 'L2-' + name);

  function normalizedParts(parts) {
    const rotate = /^(shelf|arch|secretGate|relief|blue|inscription|wingedSun|lionBand|carvedFigures|banner)/;
    Object.entries(parts).forEach(([name, part]) => {
      const geometry = part.geometry;
      if (rotate.test(name)) geometry.rotateY(-Math.PI / 2);
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      const centre = bounds.getCenter(new THREE.Vector3());
      part.size = bounds.getSize(new THREE.Vector3());
      geometry.translate(-centre.x, -bounds.min.y, -centre.z);
      part.material.roughness = 0.97;
      part.material.metalness = 0.63;
      if (part.material.map) part.material.map.anisotropy = 4;
    });
  }

  function atlasPlane(width, height, region, angle = 0) {
    const g = new THREE.PlaneGeometry(width, height);
    const [x0, y0, x1, y1] = atlas[region], uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (x0 + (x1 - x0) * uv.getX(i)) / 720,
        1 - (y1 + (y0 - y1) * uv.getY(i)) / 360);
    }
    return g.rotateX(angle);
  }

  function lighting(root, x, z, height) {
    const source = new THREE.Vector3(x + 0.1, height + 0.52, z - 0.8);
    const aim = new THREE.Vector3(x - 1.1, 0.08, z + 4.25);
    const sun = new THREE.SpotLight(0xffdbab, 88, 21, 0.42, 0.87, 2);
    sun.name = 'L2-skylight-key';
    sun.position.copy(source);
    sun.target.position.copy(aim);
    root.add(sun, sun.target);
    for (const [px, pz] of [[x - 3.26, 2.8], [x + 3.1, 2.8]]) {
      const light = new THREE.PointLight(0xffa559, 5.7, 5.3, 2);
      light.position.set(px, 1.15, pz);
      root.add(light);
    }
    root.traverse(o => {
      if (o.isPointLight || o.isSpotLight) {
        o.userData.physicalFalloff = true;
        // The shared r187 shader uses a negative exponent to opt in to
        // inverse-square attenuation for authored photometric lights.
        o.decay = -Math.abs(o.decay);
      }
    });
    const positions = [], uvs = [];
    for (const offset of [-0.78, 0.28, 0.96]) {
      const from = new THREE.Vector3(x + offset, height + 0.018, z + 0.18);
      const to = from.clone().add(aim.clone().sub(source).multiplyScalar(0.86));
      const a = from.clone().add(new THREE.Vector3(-0.43, 0, 0));
      const b = from.clone().add(new THREE.Vector3(0.43, 0, 0));
      const c = to.clone().add(new THREE.Vector3(-0.74, 0, 0.06));
      const d = to.clone().add(new THREE.Vector3(0.74, 0, -0.06));
      [a, b, c, b, d, c].forEach(p => positions.push(p.x, p.y, p.z));
      uvs.push(0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 v; void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'varying vec2 v; void main(){float a=sin(v.x*3.14159)*smoothstep(0.0,0.1,v.y)*(1.0-smoothstep(0.27,1.0,v.y)); gl_FragColor=vec4(0.95,0.67,0.39,0.113*a);}'
    });
    const rays = new THREE.Mesh(g, mat);
    rays.name = 'L2-sunlight-shafts';
    root.add(rays);
  }

  function geometryWarmup(root) {
    const unique = new Set();
    root.traverse(node => { if (node.isMesh) unique.add(node.geometry); });
    const queue = Array.from(unique);
    let target, scene, camera, material, mesh, nextAt = 0;
    const centre = new THREE.Vector3();
    function dispose() {
      queue.length = 0;
      if (target) target.dispose();
      if (material) material.dispose();
      if (scene) scene.clear();
      target = scene = camera = material = mesh = null;
    }
    function step(renderer) {
      if (!queue.length) return true;
      if (!renderer || renderer.getContext().isContextLost()) throw new Error('Archive GPU unavailable');
      const now = performance.now();
      if (now < nextAt) return false;
      nextAt = now + 15;
      if (!target) {
        target = new THREE.WebGLRenderTarget(8, 8, { depthBuffer: false });
        scene = new THREE.Scene();
        camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5);
        camera.position.z = 2;
        material = new THREE.MeshBasicMaterial({ toneMapped: false });
        mesh = new THREE.Mesh(queue[0], material);
        scene.add(mesh);
      }
      const previous = renderer.getRenderTarget();
      try {
        renderer.setRenderTarget(target);
        const limit = performance.now() + 2.5;
        for (let i = 0; i < 3 && queue.length; i++) {
          mesh.geometry = queue.shift();
          mesh.geometry.computeBoundingSphere();
          const bounds = mesh.geometry.boundingSphere;
          const scale = 0.90 / Math.max(bounds.radius, 0.001);
          mesh.scale.setScalar(scale);
          mesh.position.copy(centre.copy(bounds.center).multiplyScalar(-scale));
          renderer.render(scene, camera);
          if (performance.now() > limit) break;
        }
      } finally {
        renderer.setRenderTarget(previous);
      }
      if (queue.length) return false;
      dispose();
      return true;
    }
    return { step, dispose };
  }

  function assemble(room, entrance, parts, textures) {
    const bounds = room.bbox, w = bounds.x1 - bounds.x0, d = bounds.z1 - bounds.z0, h = room.height;
    const entranceX = entrance.x - bounds.x0;
    const axis = entranceX - 2.15;
    const root = new THREE.Group();
    root.name = 'L2-Royal-Archive';
    root.position.set(bounds.x0, 0, bounds.z0);
    const [stoneMap, ceilingMap, carpetMap] = textures;
    textures.forEach(tex => { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; });
    stoneMap.wrapS = stoneMap.wrapT = THREE.RepeatWrapping;
    const standard = (map, color, bump, roughness = 0.87) => new THREE.MeshStandardMaterial({
      map, color, roughness, bumpMap: bump ? map : null, bumpScale: bump
    });
    const stone = standard(stoneMap, 0xc4a984, 0.026);
    const slab = standard(stoneMap, 0xd6bda0, 0.018, 0.76);
    const recess = standard(stoneMap, 0x9d7656, 0.027);
    const coffer = standard(ceilingMap, 0x99795c, 0.020);
    const gilt = standard(ceilingMap, 0xdfbd8d, 0.012);
    const timber = new THREE.MeshStandardMaterial({ color: 0x382313, roughness: 0.94 });
    const grille = new THREE.MeshBasicMaterial({ map: ceilingMap, color: 0xffe9ce });
    const rug = standard(carpetMap, 0xb9a686, 0, 0.98);
    const draw = SinGreatLibrary.builder(root, 'L2-');
    const colliders = [], used = new Set();
    const point = new THREE.Vector3();
    function solid(minx, maxx, miny, maxy, minz, maxz) {
      colliders.push({ minx: bounds.x0 + minx, maxx: bounds.x0 + maxx, miny, maxy,
        minz: bounds.z0 + minz, maxz: bounds.z0 + maxz, _wing: true, _archive: true });
    }
    function box(name, mat, x, y, z, width, height, depth, tile) {
      draw.box(name, mat, null, x, y, z, width, height, depth, tile);
    }
    function fit(name, x, y, z, height, rotation = 0, obstacle = false) {
      const part = parts[name], s = height / part.size.y;
      used.add(name);
      const matrix = draw.asset(name, part, null, x, y, z, part.size.x * s, height, part.size.z * s, rotation);
      if (obstacle) {
        part.geometry.computeBoundingBox();
        const b = part.geometry.boundingBox.clone().applyMatrix4(matrix);
        const inset = 0.035;
        solid(b.min.x + inset, b.max.x - inset, b.min.y, b.max.y, b.min.z + inset, b.max.z - inset);
      }
      return part.size.clone().multiplyScalar(s);
    }
    function surface(name, mat, geo, x, y, z, rotate = 0) {
      draw.surface(name, mat, geo, null, x, y, z, rotate);
    }

    box('stone-floor', slab, w / 2, floor - 0.095, d / 2, w, 0.19, d, 2.46);
    box('stone-walls', stone, 0.03, h / 2, d / 2, 0.21, h, d, 2.62);
    box('stone-walls', stone, w - 0.03, h / 2, d / 2, 0.21, h, d, 2.62);
    box('stone-walls', stone, w / 2, h / 2, 0.055, w, h, 0.21, 2.62);
    const openingHalf = entrance.width / 2;
    // The existing wall/cap behind these sandstone faces keeps the exact
    // portal dimensions and its baked collision. No extra door leaf.
    const left = entranceX - openingHalf, right = entranceX + openingHalf;
    box('stone-walls', stone, left / 2, h / 2, d - 0.04, left, h, 0.20, 2.62);
    box('stone-walls', stone, (right + w) / 2, h / 2, d - 0.04, w - right, h, 0.20, 2.62);
    if (entrance.height < h) box('stone-walls', stone, entranceX, (h + entrance.height) / 2,
      d - 0.04, entrance.width, h - entrance.height, 0.20, 2.62);

    const bays = [['shelfA', 2.51, 4.26], ['shelfB', 7.15, 4.46], ['shelfC', 11.54, 4.45]];
    for (const side of [-1, 1]) {
      const x = side < 0 ? 0.87 : w - 0.87;
      const angle = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      bays.forEach(([name, z, height], i) => {
        const sz = side < 0 ? z : z + (i === 0 ? 0.12 : 0);
        fit(name, x, floor, sz, height, angle, true);
      });
      const columnX = side < 0 ? 1.30 : w - 1.30;
      [4.71, 9.66].forEach((z, i) => {
        fit(i % 2 ? 'columnA' : 'columnB', columnX, floor, z, 4.57, angle, true);
        box('column-head-stone', stone, columnX, (floor + 4.57 + h - 0.43) / 2,
          z, 0.98, h - 0.43 - floor - 4.57, 0.93, 2.4);
      });
      box('cornice-backing', timber, x, h - 0.26, d / 2, 1.95, 0.33, d, 2.5);
      for (let z = 1; z < d; z += 2) {
        surface('royal-frieze', gilt, atlasPlane(2, 0.23, 'flowers'),
          side < 0 ? 1.87 : w - 1.87, h - 0.25, z, angle);
      }
    }

    const guardLevel = floor + 0.64;
    [[4.97, 11.94, 'guardA', Math.PI / 2], [15.97, 11.94, 'guardB', -Math.PI / 2]].forEach(([x, z, name, angle]) => {
      box('guard-pedestals', recess, x, floor + 0.32, z, 1.39, 0.64, 1.32, 2.9);
      surface('royal-frieze', gilt, atlasPlane(1.34, 0.16, 'flowers'), x, guardLevel - 0.12, z - 0.665, Math.PI);
      fit(name, x, guardLevel - 0.015, z, 1.60, angle);
      solid(x - 0.70, x + 0.70, floor, guardLevel + 1.53, z - 0.66, z + 0.66);
    });

    fit('tableLeft', axis - 3.45, floor, 8.22, 1.51, Math.PI / 2, true);
    fit('tableRight', axis + 3.98, floor, 7.42, 1.39, -Math.PI / 2, true);
    const runner = new THREE.PlaneGeometry(2.50, 10.8).rotateX(-Math.PI / 2);
    surface('blue-runner', rug, runner, axis + 0.38, floor + 0.014, 7.10, Math.PI);

    // The closed ceremonial gate stands against the existing rear wall.
    // Its shallow risers stay inside the room perimeter.
    for (let i = 0; i < 4; i++) {
      const depth = 1.74 - 0.34 * i;
      box('gate-risers', slab, axis, floor + 0.07 + 0.14 * i, depth / 2 + 0.10, 3.92, 0.14, depth, 2.5);
    }
    solid(axis - 1.96, axis + 1.96, floor, 0.60, 0.1, 1.85);
    fit('secretGate', axis, floor + 0.55, 0.43, 2.63);
    const archH = 1.91;
    fit('arch', axis, 3.15, 0.57, archH);
    fit('columnA', axis - 1.39, floor + 0.39, 0.87, 2.78, 0, true);
    fit('columnB', axis + 1.39, floor + 0.39, 0.87, 2.78, 0, true);
    fit('reliefA', axis - 2.65, 0.37, 0.36, 3.34);
    fit('reliefB', axis + 2.65, 0.37, 0.36, 3.34);
    fit('shelfC', 3.18, floor, 0.50, 3.84, 0, true);
    fit('shelfB', 5.82, floor, 0.54, 3.71, 0, true);
    fit('shelfC', w - 1.53, floor, 0.50, 3.84, 0, true);
    fit('lionBand', axis - 2.72, 3.83, 0.27, 0.43);
    fit('wingedSun', axis + 2.73, 3.81, 0.27, 0.45);
    fit('inscriptionA', axis, 5.23, 0.25, 0.20);
    fit('blueAnimals', axis - 5.26, 4.78, 0.24, 0.34);
    fit('blueRosettes', axis + 5.20, 4.77, 0.24, 0.36);
    fit('banner', 5.83, 2.23, 1.03, 2.34);
    fit('banner', w - 1.50, 2.23, 0.94, 2.34);
    fit('potRound', axis - 2.20, floor, 1.64, 0.81, -0.21, true);
    fit('potTall', axis + 2.17, floor, 1.66, 0.92, 0.35, true);
    fit('brazier', axis - 3.26, floor, 2.83, 0.85, 0, true);
    fit('brazier', axis + 3.10, floor, 2.83, 0.85, 0, true);
    fit('flameBowl', axis - 3.26, 0.793, 2.83, 0.36);
    fit('flameBowl', axis + 3.10, 0.793, 2.83, 0.36);
    fit('lectern', axis - 4.2, floor, 2.86, 1.05, 0.32, true);

    const skyZ = 5.26, skyX = axis - 0.34, skyWidth = 4.34, skyDepth = 3.42;
    const a = skyX - skyWidth / 2, b = skyX + skyWidth / 2;
    const c = skyZ - skyDepth / 2, e = skyZ + skyDepth / 2;
    const roofFields = [[0, a, 0, d], [b, w, 0, d], [a, b, 0, c], [a, b, e, d]];
    for (const [x0, x1, z0, z1] of roofFields) {
      const cols = Math.ceil((x1 - x0) / 1.65), rows = Math.ceil((z1 - z0) / 1.75);
      const dx = (x1 - x0) / cols, dz = (z1 - z0) / rows;
      box('ceiling-deck', timber, (x0 + x1) / 2, h + 0.125, (z0 + z1) / 2, x1 - x0, 0.25, z1 - z0);
      for (let col = 0; col < cols; col++) {
        for (let row = 0; row < rows; row++) {
          surface('ceiling-coffers', coffer, atlasPlane(dx - 0.12, dz - 0.15, 'coffer', Math.PI / 2),
            x0 + (col + 0.5) * dx, h - 0.022, z0 + (row + 0.5) * dz);
        }
        if (col > 0) box('ceiling-joists', timber, x0 + col * dx, h - 0.068,
          (z0 + z1) / 2, 0.13, 0.15, z1 - z0);
      }
    }
    for (const x of [a, b]) {
      box('skylight-reveals', recess, x, h + 0.32, skyZ, 0.25, 0.68, skyDepth + 0.26, 2.5);
      surface('skylight-border', gilt, atlasPlane(skyDepth, 0.25, 'flowers', Math.PI / 2), x, h - 0.038, skyZ, Math.PI / 2);
    }
    for (const z of [c, e]) {
      box('skylight-reveals', recess, skyX, h + 0.32, z, skyWidth + 0.24, 0.68, 0.25, 2.5);
      surface('skylight-border', gilt, atlasPlane(skyWidth - 0.25, 0.25, 'script', Math.PI / 2), skyX, h - 0.039, z);
    }
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 3; row++) {
        surface('skylight-grille', grille, atlasPlane(skyWidth / 4, skyDepth / 3, 'grille', Math.PI / 2),
          a + (col + 0.5) * skyWidth / 4, h + 0.54, c + (row + 0.5) * skyDepth / 3);
      }
    }
    draw.flush();
    lighting(root, skyX, skyZ, h);
    SinGreatLibrary.setLibraryExposure(root, 0.66);
    root.traverse(obj => { if (obj.isMesh) obj.castShadow = false; });
    Object.entries(parts).forEach(([name, part]) => { if (!used.has(name)) part.geometry.dispose(); });
    const camera = new THREE.PerspectiveCamera(54, 1280 / 720, 0.12, 100);
    camera.name = 'L2-Presentation-Camera';
    camera.position.set(entranceX - 1.07, 2.52, d - 0.18);
    point.set(axis - 0.57, 2.39, 1.4);
    camera.lookAt(point);
    root.add(camera);
    const warmup = geometryWarmup(root);
    return {
      root, camera, colliders, warmup,
      dispose() { warmup.dispose(); SinGreatLibrary.disposeResources(root); }
    };
  }

  async function build(room, entrance, loadModel, signal) {
    const parts = {}, textures = [];
    const waitTurn = () => new Promise(resolve => setTimeout(resolve, 0));
    try {
      for (const [url, names] of models) {
        signal.throwIfAborted();
        const model = await loadModel(url, signal);
        try {
          signal.throwIfAborted();
          Object.assign(parts, SinGreatLibrary.split(model, names));
        } catch (error) {
          SinGreatLibrary.disposeResources(model.scene);
          throw error;
        }
        await waitTurn();
      }
      const loader = new THREE.TextureLoader();
      for (const url of images) {
        signal.throwIfAborted();
        textures.push(await loader.loadAsync(encodeURI(url)));
      }
      signal.throwIfAborted();
      normalizedParts(parts);
      return assemble(room, entrance, parts, textures);
    } catch (error) {
      const discarded = new THREE.Group();
      Object.values(parts).forEach(part => discarded.add(new THREE.Mesh(part.geometry, part.material)));
      SinGreatLibrary.disposeResources(discarded);
      textures.forEach(texture => texture.dispose());
      throw error;
    }
  }

  window.SinRoyalArchive = { build, expected };
})();
