/* Palace interior. Assets load only after the hero walks through the open royal door.
   Originals stay in assets/. Optimized copies live in ارضيات وسقوف/optimized/. */
(function () {
  const CONFIG = {
    useOptimizedAssets: true,
    disposeExteriorAfterEntry: false,
    hallWidthH: 14,
    hallLengthH: 30,
    hallHeightH: 6,
    carpetWidthH: 2.5,
    spawnOffsetH: 3,
    fadeOutSeconds: 2.0,
    fadeInSeconds: 2.5,
    minBlackHoldSeconds: 0.5,
    autoWalkH: 1.5,
    lightCount: 5,
    torchFlicker: 0.08,
    fileTimeoutMs: 20000,
    columnHeightH: 5.2,
    medallionSizeH: 4.6,
    columnSpacingH: 4.4
  };

  const FILES = {
    floor: 'ارضية',
    carpet: 'السجاد',
    ceiling: 'السقف',
    medallion: 'المدالية المركزية',
    wall: 'نقوش جدارية',
    frieze: 'نقوش جدارية 2',
    columns: 'اربع اعمده مختلفة.glb',
    torchWood: 'مشعل خشب.glb',
    torchBlack: 'مشعل اسود.glb',
    throne: 'عرش البطل.glb'
  };

  let state = 'IDLE';
  let busy = false;
  let fadeT = 0;
  let holdT = 0;
  let loadPromise = null;
  let loadOk = null;
  let H = 1.8;
  let group = null;
  let floorY = 0;
  let approachY = null;
  let colliders = [];
  let lights = [];
  let clock = 0;
  let overlay = null;
  let saved = null;
  let assets = null;
  let decoderReady = null;
  let occupant = false;
  let portalFront = 0;
  let portalX = 0;
  let hallLen = 0;
  let hallW = 0;
  let exteriorHidden = false;
  const aniso = { v: 4 };

  function dir() { return CONFIG.useOptimizedAssets ? 'ارضيات وسقوف/optimized/' : 'assets/'; }
  function texURL(base) { return encodeURI(dir() + base + (CONFIG.useOptimizedAssets ? '.webp' : '.JPG')); }
  function glbURL(name) { return encodeURI(dir() + name); }

  function easeInOut(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'palace-fade';
    overlay.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;z-index:80;pointer-events:none;';
    document.body.appendChild(overlay);
    return overlay;
  }

  function srgb(tex) {
    if (!tex) return tex;
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = aniso.v;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  function withTimeout(url, run) {
    const once = () => new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('انتهت مهلة تحميل ' + url)), CONFIG.fileTimeoutMs);
      run().then(v => { clearTimeout(timer); res(v); }, e => { clearTimeout(timer); rej(e); });
    });
    return once().catch(err => { console.error(err); return once(); });
  }

  function fetchBuf(url) {
    return withTimeout(url, () => fetch(url).then(r => {
      if (!r.ok) throw new Error(r.status + ' ' + url);
      return r.arrayBuffer();
    }));
  }

  function loadTexture(url) {
    return withTimeout(url, () => new Promise((res, rej) => {
      new THREE.TextureLoader().load(url, t => { srgb(t); res(t); }, undefined, rej);
    }));
  }

  function ensureDecoder() {
    if (!CONFIG.useOptimizedAssets) return Promise.resolve(null);
    if (decoderReady) return decoderReady;
    decoderReady = new Promise((res, rej) => {
      if (window.MeshoptDecoder) { MeshoptDecoder.ready.then(() => res(MeshoptDecoder), rej); return; }
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/libs/meshopt_decoder.js';
      s.onload = () => MeshoptDecoder.ready.then(() => res(MeshoptDecoder), rej);
      s.onerror = () => rej(new Error('تعذّر تحميل MeshoptDecoder'));
      document.head.appendChild(s);
    });
    return decoderReady;
  }

  function tuneGLTF(gltf) {
    gltf.scene.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => {
        ['map', 'emissiveMap'].forEach(k => { if (m[k]) srgb(m[k]); });
        ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'].forEach(k => {
          if (m[k]) { m[k].anisotropy = aniso.v; m[k].needsUpdate = true; }
        });
      });
    });
    return gltf;
  }

  function parseGLB(buf) {
    const loader = new THREE.GLTFLoader();
    return ensureDecoder().then(dec => {
      if (dec) loader.setMeshoptDecoder(dec);
      return new Promise((res, rej) => loader.parse(buf, '', g => res(tuneGLTF(g)), rej));
    });
  }

  function loadGLB(name) { return fetchBuf(glbURL(name)).then(parseGLB); }

  function loadPalaceAssets() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const names = [FILES.floor, FILES.carpet, FILES.ceiling, FILES.medallion, FILES.wall, FILES.frieze];
      const texP = Promise.all(names.map(n => loadTexture(texURL(n)).then(t => [n, t])));
      const glbP = Promise.all([loadGLB(FILES.columns), loadGLB(FILES.torchWood), loadGLB(FILES.torchBlack)]);
      const throneP = fetch(glbURL(FILES.throne)).then(r => r.ok ? r.arrayBuffer().then(parseGLB) : null).catch(() => null);
      const [texPairs, glbs, throne] = await Promise.all([texP, glbP, throneP]);
      const tex = {};
      texPairs.forEach(([n, t]) => { tex[n] = t; });
      assets = { tex, columns: glbs[0], torchWood: glbs[1], torchBlack: glbs[2], throne };
      return assets;
    })().catch(err => { loadPromise = null; throw err; });
    return loadPromise;
  }

  function mat(map, opts) {
    const m = new THREE.MeshStandardMaterial(Object.assign({ map: map || null, roughness: .86, metalness: .04 }, opts || {}));
    if (map) srgb(map);
    return m;
  }

  function plane(w, h, y, map, ox, oz) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(map));
    g.rotation.x = -Math.PI / 2;
    g.position.set(ox || 0, y, oz || 0);
    g.receiveShadow = true;
    g.castShadow = false;
    return g;
  }

  function tiledMap(src, rx, ry) {
    const map = src.clone();
    srgb(map);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(rx, ry);
    return map;
  }

  function normalizeColumn(node, targetH) {
    const inner = new THREE.Group();
    inner.add(node.clone(true));
    inner.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(inner);
    const size = box.getSize(new THREE.Vector3());
    const h = Math.max(0.001, size.y);
    inner.scale.setScalar(targetH / h);
    inner.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(inner);
    const c = b2.getCenter(new THREE.Vector3());
    inner.position.set(-c.x, -b2.min.y, -c.z);
    const outer = new THREE.Group();
    outer.name = node.name || 'column';
    outer.add(inner);
    outer.updateMatrixWorld(true);
    return outer;
  }

  function columnPrefabs(gltf, targetH) {
    let root = null;
    gltf.scene.traverse(o => { if (o.name === 'GLTF_SceneRootNode') root = o; });
    const kids = (root ? root.children : gltf.scene.children).slice();
    const made = kids.map(k => {
      const tmp = k.clone(true);
      tmp.updateMatrixWorld(true);
      const h = new THREE.Box3().setFromObject(tmp).getSize(new THREE.Vector3()).y;
      return { node: k, h };
    }).sort((a, b) => b.h - a.h).slice(0, 4);
    console.info('أعمدة القاعة:', made.map(m => m.node.name + ' h=' + m.h.toFixed(2)).join(' | '));
    return made.map(m => normalizeColumn(m.node, targetH));
  }

  function wrapFitted(obj, targetH) {
    obj.updateMatrixWorld(true);
    const h = Math.max(0.001, new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3()).y);
    obj.scale.multiplyScalar(targetH / h);
    obj.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(obj);
    const c = b.getCenter(new THREE.Vector3());
    obj.position.x -= c.x;
    obj.position.y -= b.min.y;
    obj.position.z -= c.z;
    const outer = new THREE.Group();
    outer.add(obj);
    return outer;
  }

  function flameSprite() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(32, 28, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,236,190,1)');
    r.addColorStop(.4, 'rgba(255,140,40,.7)');
    r.addColorStop(1, 'rgba(255,60,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
  }

  function addBox(min, max) {
    colliders.push({ minx: min.x, miny: min.y, minz: min.z, maxx: max.x, maxy: max.y, maxz: max.z });
  }

  function setExteriorVisible(scene, visible) {
    if (CONFIG.disposeExteriorAfterEntry && exteriorHidden) return;
    const ext = scene.getObjectByName('PalaceExterior');
    if (!ext) return;
    ext.visible = visible;
    exteriorHidden = !visible;
  }

  function disposeObject(obj) {
    obj.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      mats.forEach(m => {
        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach(k => {
          if (m[k] && m[k].dispose) m[k].dispose();
        });
        if (m.dispose) m.dispose();
      });
    });
  }

  function removeGroup(scene) {
    if (!group) return;
    scene.remove(group);
    disposeObject(group);
    group = null;
    colliders = [];
    lights = [];
  }

  function build(ctx) {
    const W = CONFIG.hallWidthH * H, L = CONFIG.hallLengthH * H, CH = CONFIG.hallHeightH * H;
    const portal = ctx.portal;
    hallW = W;
    hallLen = L;
    portalFront = portal.frontZ;
    portalX = portal.x;
    if (group) removeGroup(ctx.scene);
    group = new THREE.Group();
    group.name = 'PalaceInterior';
    const gy = floorY;
    group.position.set(portal.x, gy, portal.frontZ);
    ctx.scene.add(group);

    const tex = assets.tex;
    const tile = 2.2 * H;
    const floor = plane(W, L, 0, tiledMap(tex[FILES.floor], W / tile, L / tile), 0, L / 2);
    floor.name = 'floor';
    group.add(floor);

    const med = CONFIG.medallionSizeH * H;
    const medallion = plane(med, med, 0.002 * H, tex[FILES.medallion].clone(), 0, L / 2);
    srgb(medallion.material.map);
    medallion.name = 'medallion';
    medallion.material.polygonOffset = true;
    medallion.material.polygonOffsetFactor = -2;
    medallion.material.polygonOffsetUnits = -2;
    group.add(medallion);

    const cw = CONFIG.carpetWidthH * H;
    const carpetSrc = tex[FILES.carpet];
    const img = carpetSrc.image || { width: 512, height: 2064 };
    const tileLen = cw * (img.height / Math.max(1, img.width));
    function carpetSeg(z0, z1) {
      const len = Math.max(0.2, z1 - z0);
      const map = carpetSrc.clone();
      srgb(map);
      map.wrapS = THREE.ClampToEdgeWrapping;
      map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(1, len / tileLen);
      const m = plane(cw, len, 0.004 * H, map, 0, (z0 + z1) / 2);
      m.material.polygonOffset = true;
      m.material.polygonOffsetFactor = -4;
      m.material.polygonOffsetUnits = -4;
      m.name = 'carpet';
      return m;
    }
    const gap = med * 0.55;
    const stepDepth = 0.75 * H, stepH = 0.16 * H, steps = 3;
    const platformZ = L - stepDepth * steps - 0.6 * H;
    const carpetA = carpetSeg(0.35 * H, L / 2 - gap);
    const carpetB = carpetSeg(L / 2 + gap, platformZ - 0.12 * H);
    group.add(carpetA, carpetB);

    const stone = mat(tiledMap(tex[FILES.floor], 2, 2), { roughness: .92, color: 0x8d7562 });
    for (let i = 0; i < steps; i++) {
      const d = stepDepth * (steps - i);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(cw * 1.85, stepH, d), stone);
      mesh.position.set(0, 0.004 + stepH / 2 + i * stepH, platformZ + stepDepth * steps - d / 2);
      mesh.name = 'step' + i;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    const topY = 0.004 + steps * stepH;

    let throneObj;
    if (assets.throne) {
      throneObj = wrapFitted(assets.throne.scene.clone(true), 1.7 * H);
      throneObj.name = 'throne';
      throneObj.position.set(0, topY, L - 1.35 * H);
      throneObj.rotation.y = Math.PI;
    } else {
      console.error('عرش البطل.glb غير موجود في المستودع — وُضعت منصة وكرسي بديل حتى تبقى القاعة قابلة للعب.');
      const wood = mat(tex[FILES.wall].clone(), { roughness: .72, color: 0x6a3a22 });
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.35 * H, 0.42 * H, 1.05 * H), wood);
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.35 * H, 1.45 * H, 0.16 * H), wood);
      throneObj = new THREE.Group();
      throneObj.name = 'throne-stand-in';
      seat.position.y = 0.21 * H;
      back.position.set(0, 0.95 * H, 0.46 * H);
      throneObj.add(seat, back);
      throneObj.position.set(0, topY, L - 1.55 * H);
    }
    group.add(throneObj);

    const trimH = 0.7 * H, friezeH = 0.78 * H, panelH = Math.max(1.2 * H, CH - trimH - friezeH);
    const prefabs = columnPrefabs(assets.columns, CONFIG.columnHeightH * H);
    const colBox = new THREE.Box3().setFromObject(prefabs[0]);
    const colSize = colBox.getSize(new THREE.Vector3());
    const z0 = Math.max(4.6, CONFIG.spawnOffsetH * H + 2.6);
    const z1 = Math.max(z0 + 4 * H, platformZ - colSize.z - 0.4 * H);
    const count = Math.min(6, Math.max(4, Math.round((z1 - z0) / (CONFIG.columnSpacingH * H)) + 1));
    const inset = W / 2 - Math.max(1.55 * H, colSize.x * 0.5 + 0.9 * H);
    const zs = [];
    for (let i = 0; i < count; i++) zs.push(z0 + (z1 - z0) * (i / Math.max(1, count - 1)));
    const columns = [];
    const torchSrc = [assets.torchWood, assets.torchBlack];
    let lightN = 0;
    const hemi = new THREE.HemisphereLight(0xffc896, 0x3a2a22, 0.62);
    group.add(hemi);
    lights = [];
    const throneLight = new THREE.PointLight(0xffb46a, 1.55, 8 * H, 2);
    throneLight.position.set(0, topY + 2.2 * H, L - 2.4 * H);
    throneLight.castShadow = false;
    throneLight.userData.base = throneLight.intensity;
    throneLight.userData.seed = 0.4;
    group.add(throneLight);
    lights.push(throneLight);
    lightN = 1;

    function sideWall(side, zA, zB, name) {
      const seg = Math.max(0.35, zB - zA);
      const map = tiledMap(tex[FILES.wall], seg / tile, panelH / tile);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(seg, panelH), mat(map));
      panel.position.set(side * (W / 2 - 0.12), trimH + panelH / 2, (zA + zB) / 2);
      panel.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      panel.name = name || 'wall-panel';
      panel.castShadow = false;
      group.add(panel);
    }
    [-1, 1].forEach(side => {
      const seams = [0.15].concat(zs).concat([L - 0.15]);
      for (let i = 0; i < seams.length - 1; i++) {
        const a = seams[i], b = seams[i + 1];
        if (b - a < 0.35) continue;
        sideWall(side, a, b, 'wall-panel');
      }
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.22, trimH, L), mat(tiledMap(tex[FILES.floor], L / tile, 1), { color: 0x3a3128, roughness: .95 }));
      trim.position.set(side * (W / 2 - 0.02), trimH / 2, L / 2);
      trim.name = 'trim';
      trim.castShadow = false;
      group.add(trim);
      const friezeAspect = (tex[FILES.frieze].image ? tex[FILES.frieze].image.width / tex[FILES.frieze].image.height : 2);
      const fmap = tex[FILES.frieze].clone();
      srgb(fmap);
      fmap.wrapS = THREE.RepeatWrapping;
      fmap.wrapT = THREE.ClampToEdgeWrapping;
      fmap.repeat.set(L / (friezeH * friezeAspect), 1);
      const fr = new THREE.Mesh(new THREE.PlaneGeometry(L, friezeH), mat(fmap));
      fr.position.set(side * (W / 2 - 0.1), trimH + panelH + friezeH / 2, L / 2);
      fr.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      fr.name = 'frieze';
      fr.castShadow = false;
      group.add(fr);
    });

    zs.forEach((z, i) => {
      [-1, 1].forEach(side => {
        const prefab = prefabs[(i + (side < 0 ? 2 : 0)) % prefabs.length];
        const col = prefab.clone(true);
        col.position.set(side * inset, 0, z);
        if (side < 0) col.scale.x = -1;
        col.name = 'column';
        group.add(col);
        columns.push(col);
        const src = torchSrc[(i + (side < 0 ? 1 : 0)) % 2];
        const torch = wrapFitted(src.scene.clone(true), 1.15 * H);
        torch.name = 'torch';
        torch.position.set(side * (inset - colSize.x * 0.42), 1.55 * H, z);
        torch.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
        const flame = flameSprite();
        flame.position.set(0, 1.05 * H, 0.05 * H);
        flame.scale.setScalar(0.5 * H);
        torch.add(flame);
        group.add(torch);
        if (lightN < CONFIG.lightCount && (i % 2 === 0)) {
          const pl = new THREE.PointLight(0xffb46a, 1.85, 7.2 * H, 2);
          pl.position.set(side * (inset - colSize.x * 0.42), 2.35 * H, z);
          pl.castShadow = false;
          pl.userData.base = pl.intensity;
          pl.userData.seed = lightN * 1.7 + side;
          group.add(pl);
          lights.push(pl);
          lightN++;
        }
      });
    });

    const northMap = tiledMap(tex[FILES.wall], W / tile, CH / tile);
    const endWall = new THREE.Mesh(new THREE.PlaneGeometry(W, CH), mat(northMap));
    endWall.position.set(0, CH / 2, L - 0.04);
    endWall.rotation.y = Math.PI;
    endWall.name = 'north-wall';
    endWall.castShadow = false;
    group.add(endWall);
    const southW = Math.max(0.4, (W - portal.width) / 2);
    const southMap = tiledMap(tex[FILES.wall], southW / tile, CH / tile);
    const southL = new THREE.Mesh(new THREE.PlaneGeometry(southW, CH), mat(southMap));
    const southR = new THREE.Mesh(new THREE.PlaneGeometry(southW, CH), mat(southMap.clone()));
    srgb(southR.material.map);
    const doorHalf = portal.width / 2;
    southL.position.set(-(doorHalf + southW / 2), CH / 2, 0.04);
    southR.position.set(doorHalf + southW / 2, CH / 2, 0.04);
    southL.name = southR.name = 'south-wall';
    group.add(southL, southR);

    const ceiling = plane(W, L, CH, tiledMap(tex[FILES.ceiling], W / tile, L / tile), 0, L / 2);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = CH - 0.02;
    ceiling.name = 'ceiling';
    group.add(ceiling);

    const dustN = 48;
    const pos = new Float32Array(dustN * 3);
    for (let i = 0; i < dustN; i++) {
      pos[i * 3] = (Math.random() - .5) * (W - 2);
      pos[i * 3 + 1] = 0.5 + Math.random() * (CH - 1.4);
      pos[i * 3 + 2] = 1 + Math.random() * (L - 2);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xffd2a0, size: 0.045 * H, transparent: true, opacity: .22, depthWrite: false, fog: false }));
    dust.name = 'haze';
    dust.frustumCulled = false;
    group.add(dust);

    group.updateMatrixWorld(true);
    const ox = portal.x, oz = portal.frontZ;
    colliders = [];
    function worldBox(min, max) {
      addBox(new THREE.Vector3(ox + min.x, gy + min.y, oz + min.z), new THREE.Vector3(ox + max.x, gy + max.y, oz + max.z));
    }
    [-1, 1].forEach(side => worldBox(new THREE.Vector3(side * (W / 2) - 0.45, 0, 0), new THREE.Vector3(side * (W / 2) + 0.45, CH, L)));
    worldBox(new THREE.Vector3(-W / 2, 0, L - 0.45), new THREE.Vector3(W / 2, CH, L + 0.45));
    worldBox(new THREE.Vector3(-W / 2, 0, -0.45), new THREE.Vector3(-portal.width / 2, CH, 0.4));
    worldBox(new THREE.Vector3(portal.width / 2, 0, -0.45), new THREE.Vector3(W / 2, CH, 0.4));
    group.traverse(o => {
      if (o.name !== 'column' && o.name !== 'throne' && o.name !== 'throne-stand-in') return;
      const b = new THREE.Box3().setFromObject(o);
      b.expandByScalar(-0.05);
      addBox(b.min, b.max);
    });
    const platformBox = new THREE.Box3().setFromObject(throneObj);
    group.children.forEach(o => { if (o.name && o.name.indexOf('step') === 0) platformBox.union(new THREE.Box3().setFromObject(o)); });
    addBox(new THREE.Vector3(platformBox.min.x, platformBox.min.y, platformBox.min.z), new THREE.Vector3(platformBox.max.x, platformBox.max.y, platformBox.max.z));

    const watch = columns.concat([throneObj, medallion, carpetA, carpetB]);
    for (let i = 0; i < watch.length; i++) {
      for (let j = i + 1; j < watch.length; j++) {
        const a = new THREE.Box3().setFromObject(watch[i]);
        const b = new THREE.Box3().setFromObject(watch[j]);
        a.expandByScalar(-0.06);
        if (a.intersectsBox(b)) console.warn('تداخل في القاعة', watch[i].name, watch[j].name);
      }
    }

    group.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    setExteriorVisible(ctx.scene, false);
    if (CONFIG.disposeExteriorAfterEntry) {
      const ext = ctx.scene.getObjectByName('PalaceExterior');
      if (ext) ext.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
  }

  function aimCamera(ctx, snap) {
    const hp = ctx.hero.position;
    const dest = new THREE.Vector3(hp.x, hp.y + 1.62, hp.z - 4.3);
    if (snap) ctx.camera.position.copy(dest);
    else ctx.camera.position.lerp(dest, 1 - Math.exp(-Math.max(0.001, lastDt) * 3));
    ctx.camera.lookAt(hp.x, hp.y + 1.32, hp.z + 16);
  }

  function placeHero(ctx) {
    const spawnZ = ctx.portal.frontZ + CONFIG.spawnOffsetH * H;
    ctx.hero.position.set(ctx.portal.x, floorY, spawnZ);
    ctx.setFacing(0);
    occupant = true;
    aimCamera(ctx, true);
    constrainCamera(ctx.camera, ctx.hero);
    const blockedSpawn = blocks(ctx.hero.position.x, ctx.hero.position.z);
    if (blockedSpawn) console.warn('نقطة الظهور داخل عائق — أُزيحت نحو وسط القاعة');
    if (blockedSpawn) ctx.hero.position.z = ctx.portal.frontZ + Math.min(hallLen * 0.5, CONFIG.spawnOffsetH * H + 1.5);
  }

  function fail(ctx) {
    if (saved && ctx.hero) ctx.hero.position.copy(saved);
    removeGroup(ctx.scene);
    setExteriorVisible(ctx.scene, true);
    occupant = false;
    state = 'FAIL_IN';
    fadeT = 0;
  }

  let lastDt = 0.016;
  function tick(dt, ctx) {
    lastDt = dt;
    clock += dt;
    if (ctx.renderer) aniso.v = ctx.renderer.capabilities.getMaxAnisotropy();
    const portal = ctx.portal;
    if (!portal) return;
    if (state === 'IDLE') {
      if (!ctx.doorOpen || busy) return;
      const p = ctx.hero.position;
      if (p.z <= portal.frontZ + 0.02) approachY = p.y;
      if (p.z > portal.frontZ + 0.05 && Math.abs(p.x - portal.x) < portal.width * 0.42) {
        busy = true;
        saved = p.clone();
        const box = new THREE.Box3().setFromObject(ctx.hero);
        H = Math.max(1.2, box.getSize(new THREE.Vector3()).y);
        floorY = approachY == null ? p.y : approachY;
        p.y = floorY;
        ensureOverlay();
        overlay.style.opacity = '0';
        state = 'FADING_OUT';
        fadeT = 0;
        holdT = 0;
        loadOk = null;
        occupant = true;
        loadPalaceAssets().then(() => { loadOk = true; }, err => { loadOk = false; console.error(err); });
      }
      return;
    }
    if (state === 'FADING_OUT') {
      fadeT += dt;
      const u = Math.min(1, fadeT / CONFIG.fadeOutSeconds);
      overlay.style.opacity = String(easeInOut(u));
      ctx.hero.position.y = floorY;
      ctx.hero.position.z += ((CONFIG.autoWalkH * H) / CONFIG.fadeOutSeconds) * dt;
      ctx.setFacing(0);
      aimCamera(ctx, false);
      if (u >= 1) state = 'LOADING';
      return;
    }
    if (state === 'LOADING') {
      holdT += dt;
      ctx.hero.position.y = floorY;
      aimCamera(ctx, false);
      if (loadOk === true && holdT >= CONFIG.minBlackHoldSeconds) state = 'SETUP';
      if (loadOk === false && holdT >= CONFIG.minBlackHoldSeconds) fail(ctx);
      return;
    }
    if (state === 'SETUP') {
      try {
        build(ctx);
        placeHero(ctx);
        if (ctx.renderer.compile) ctx.renderer.compile(ctx.scene, ctx.camera);
        ctx.renderer.render(ctx.scene, ctx.camera);
        state = 'FADING_IN';
        fadeT = 0;
      } catch (err) {
        console.error(err);
        fail(ctx);
      }
      return;
    }
    if (state === 'FADING_IN' || state === 'FAIL_IN') {
      fadeT += dt;
      const u = Math.min(1, fadeT / CONFIG.fadeInSeconds);
      overlay.style.opacity = String(1 - easeOut(u));
      if (state === 'FADING_IN') {
        ctx.hero.position.y = floorY;
        aimCamera(ctx, false);
      }
      if (u >= 1) {
        overlay.style.opacity = '0';
        if (state === 'FAIL_IN') { state = 'IDLE'; busy = false; }
        else state = 'DONE';
      }
      return;
    }
    if (state === 'DONE') {
      const lx = ctx.hero.position.x - portalX;
      const lz = ctx.hero.position.z - portalFront;
      occupant = lz >= -0.08 && lz <= hallLen + 0.4 && Math.abs(lx) <= hallW / 2 + 0.2;
      if (group) group.visible = occupant;
      setExteriorVisible(ctx.scene, !occupant);
      if (occupant) ctx.hero.position.y = floorY;
      for (const L of lights) {
        const n = Math.sin(clock * 3.1 + L.userData.seed) * .6 + Math.sin(clock * 7.7 + L.userData.seed * 2) * .4;
        L.intensity = L.userData.base * (1 + CONFIG.torchFlicker * n);
      }
    }
  }

  function blocks(x, z) {
    const active = state === 'FADING_IN' || state === 'SETUP' || (state === 'DONE' && occupant);
    if (!active) return false;
    for (const c of colliders) {
      if (x > c.minx && x < c.maxx && z > c.minz && z < c.maxz) return true;
    }
    return false;
  }

  function rayHit(ox, oy, oz, dx, dy, dz, b) {
    let tmin = 0, tmax = 1;
    const slabs = [[ox, dx, b.minx, b.maxx], [oy, dy, b.miny, b.maxy], [oz, dz, b.minz, b.maxz]];
    for (let i = 0; i < slabs.length; i++) {
      const o = slabs[i][0], d = slabs[i][1], mn = slabs[i][2], mx = slabs[i][3];
      if (Math.abs(d) < 1e-8) { if (o < mn || o > mx) return null; }
      else {
        let t1 = (mn - o) / d, t2 = (mx - o) / d;
        if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return null;
      }
    }
    if (tmax < 0 || tmin > 1) return null;
    return tmin;
  }

  function constrainCamera(cam, hero) {
    if (!cam || !hero || colliders.length === 0) return;
    if (state === 'IDLE' || state === 'FAIL_IN' || state === 'FADING_OUT' || state === 'LOADING') return;
    if (state === 'DONE' && !occupant) return;
    const p = hero.isObject3D ? hero.position : hero;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return;
    const ox = p.x, oy = p.y + 1.45, oz = p.z;
    const saved = cam.position.clone();
    const dx = cam.position.x - ox, dy = cam.position.y - oy, dz = cam.position.z - oz;
    let hit = 1;
    for (let i = 0; i < colliders.length; i++) {
      const t = rayHit(ox, oy, oz, dx, dy, dz, colliders[i]);
      if (t != null && t < hit) hit = t;
    }
    const margin = 0.35 * H;
    const minX = portalX - hallW / 2 + margin, maxX = portalX + hallW / 2 - margin;
    const minZ = portalFront + margin, maxZ = portalFront + hallLen - margin;
    if (hit < 0.98) {
      const t = Math.max(0.18, hit - 0.05);
      cam.position.set(ox + dx * t, oy + dy * t, oz + dz * t);
    }
    cam.position.x = Math.max(minX, Math.min(maxX, cam.position.x));
    cam.position.z = Math.max(minZ, Math.min(maxZ, cam.position.z));
    cam.position.y = Math.max(floorY + 0.35, Math.min(floorY + CONFIG.hallHeightH * H - 0.25, cam.position.y));
    if (![cam.position.x, cam.position.y, cam.position.z].every(Number.isFinite)) cam.position.copy(saved);
  }

  window.PalaceInterior = {
    CONFIG,
    tick,
    locksControl() { return state === 'FADING_OUT' || state === 'LOADING' || state === 'SETUP' || state === 'FADING_IN' || state === 'FAIL_IN'; },
    ownsCamera() { return state === 'FADING_OUT' || state === 'LOADING' || state === 'SETUP' || state === 'FADING_IN'; },
    ownsGround() { return state === 'FADING_OUT' || state === 'LOADING' || state === 'SETUP' || state === 'FADING_IN' || (state === 'DONE' && occupant); },
    blocks,
    constrainCamera,
    floorY() { return floorY; },
    loadPalaceAssets,
    state() { return state; },
    metrics() { return { H: H, length: hallLen, width: hallW, front: portalFront, x: portalX, state: state, occupant: occupant, lights: lights.length }; }
  };
})();
