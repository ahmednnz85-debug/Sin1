/* Palace interior. Assets load only after the hero walks through the open royal door.
   Originals stay in assets/. Optimized copies live in ارضيات وسقوف/optimized/.
   Build hall12 — asset URLs carry ?v=hall12 so Safari cannot reuse a stale copy.
   Final hall: wall modules, columns, marble, carpet, lions, braziers, procedural fire. */
(function () {
  const BUILD = 'hall18';
  const CONFIG = {
    useOptimizedAssets: true,
    useWings: true,
    disposeExteriorAfterEntry: false,
    hallWidthH: 14,
    hallLengthH: 30,
    hallHeightH: 8,
    carpetWidthH: 2.5,
    spawnOffsetH: 3,
    fadeOutSeconds: 2.0,
    fadeInSeconds: 2.5,
    minBlackHoldSeconds: 0.35,
    revealHoldSeconds: 0.45,
    autoWalkH: 1.5,
    lightCount: 6,
    torchFlicker: 0,
    stallMs: 30000,
    retries: 3,
    columnHeightH: 6.35,
    medallionSizeH: 4.6,
    columnSpacingH: 4.4,
    throneHeightH: 2,
    stairSteps: 12,
    stairRiseH: 0.12,
    stairTreadH: 0.32,
    stairWidthH: 8,
    platformDepthH: 3.2,
    backMarginH: 0.65,
    plinthHeightH: 0,
    maxPropBytes: 3 * 1024 * 1024,
    maxPropTris: 22000,
    maxPalaceBytes: 25 * 1024 * 1024,
    archWidthRatio: 0.30,
    archHeightRatio: 0.64,
    lodDistanceH: 14
  };

  const PLAN = (function () {
    const L = CONFIG.hallLengthH;
    const platformBackZ = L - CONFIG.backMarginH;
    const platformFrontZ = platformBackZ - CONFIG.platformDepthH;
    const stairFootZ = platformFrontZ - CONFIG.stairSteps * CONFIG.stairTreadH;
    const topY = CONFIG.stairSteps * CONFIG.stairRiseH;
    const throneZ = (platformFrontZ + platformBackZ) * 0.5;
    return { platformBackZ: platformBackZ, platformFrontZ: platformFrontZ, stairFootZ: stairFootZ, topY: topY, throneZ: throneZ };
  })();

  function mirrorXZ(rows) {
    const out = [];
    rows.forEach(function (p) {
      out.push(p.slice());
      const q = p.slice();
      q[0] = -q[0];
      out.push(q);
    });
    return out;
  }

  CONFIG.PASSAGES = [];
  CONFIG.PROPS = [
    { id: 'lantern', type: 'lantern', positions: [[-1.6, 0, 8.2], [1.6, 0, 13.4], [-1.6, 0, 18.8], [1.6, 0, 24.2]], rotY: 0, targetHeightH: 0.62, glbPath: null, collider: 'none', colliderSize: { x: 0.4, y: 0.62, z: 0.4 } }
  ];

  const FILES = {
    floor: ['marble.webp', 'IMG_2962.JPG'],
    floorOrm: ['floor-orm.webp', 'floor-orm.webp'],
    floorBorder: ['ارضية.webp', 'ارضية.JPG'],
    carpet: ['سجاد-الارضية.webp', 'سجاد الارضية.jpg'],
    ceiling: ['سقف-القصر.webp', 'سقف القصر .PNG'],
    medallion: ['المدالية المركزية.webp', 'المدالية المركزية.JPG'],
    back: ['جدار-خلف-العرش.webp', 'جدار خلف عرش البطل.PNG'],
    doorWall: ['جدران-الباب.webp', 'جدران الباب.PNG'],
    wall: ['الجدارية.glb', 'الجدارية.glb'],
    columns: ['اعمدة.glb', 'اعمدة.glb'],
    columnsLod: ['اعمدة-lod1.glb', ''],
    brazier: ['المباخر.glb', 'المباخر.glb'],
    brazierLod: ['المباخر-lod1.glb', ''],
    lion: ['lion_winged.glb', 'lion_winged.glb.glb'],
    lionLod: ['lion_winged-lod1.glb', ''],
    stairs: ['درج.glb', 'درج.glb'],
    door: ['مجسم الباب.glb', 'مجسم الباب.glb'],
    props: ['props-set.glb', 'مجموعة غراض.glb'],
    throne: ['عرش البطل.glb', 'عرش البطل.glb']
  };


  let camBack = 3.6;
  let entranceLeft = 0;
  let state = 'IDLE';
  let busy = false;
  let fadeT = 0;
  let holdT = 0;
  let loadPromise = null;
  let loadOk = null;
  let loadError = null;
  let H = 1.8;
  let group = null;
  let floorY = 0;
  let approachY = null;
  let colliders = [];
  let lights = [];
  let clock = 0;
  let loadEl = null;
  let barFill = null;
  let statusEl = null;
  let pctEl = null;
  let errEl = null;
  let retryBtn = null;
  let debugEl = null;
  let saved = null;
  let assets = null;
  let specs = null;
  let occupant = false;
  let portalFront = 0;
  let portalX = 0;
  let hallLen = 0;
  let hallW = 0;
  let exteriorHidden = false;
  let hallBuilt = false;
  let warmFrame = false;
  let loadStartedAt = 0;
  let contextWatch = false;
  let lastDoor = false;
  let heroSnap = '—';
  let ramp = null;
  let flames = [];
  let slotModes = [];
  let palaceEnv = null;
  let fireMats = [];
  let lodPacks = [];
  let fireList = [];
  let wingRuntime = null;
  let lightAssignAt = 0;
  let overlapNotes = [];
  let propsProbed = false;
  let wingsProbed = false;
  let warmMeshes = null;
  let warmIndex = 0;
  let warmSlow = 0;
  let warmProxy = null;
  let warmProxyI = null;
  const aniso = { v: 4 };
  const runtimeErrors = [];
  const LOG = [];
  const MARKS = [];
  let paintQueued = false;
  let perfNote = '';
  function mark(msg) {
    MARKS.push(Math.round(performance.now()) + ' ' + msg);
    if (MARKS.length > 240) MARKS.shift();
    note(msg);
  }

  function debugOn() {
    const href = String(location.href || '');
    return /(?:[?&#])debug=1(?:&|#|$)/.test(href);
  }
  function wingArchOpen(side, index) {
    return CONFIG.useWings && ((side < 0 && index === 2) || (side > 0 && (index === 0 || index === 2)));
  }

  function note(msg) {
    LOG.push(Math.round(performance.now()) + ' ' + msg);
    if (LOG.length > 50) LOG.shift();
    renderDebug();
  }

  window.addEventListener('error', function (ev) {
    runtimeErrors.push(String(ev.message || 'error') + (ev.filename ? ' @ ' + String(ev.filename).split('/').pop() + ':' + ev.lineno + ':' + ev.colno : ''));
    renderDebug();
  });
  window.addEventListener('unhandledrejection', function (ev) {
    const r = ev.reason;
    runtimeErrors.push('unhandledrejection: ' + (r && (r.stack || r.message) || r));
    renderDebug();
  });

  function dir() { return CONFIG.useOptimizedAssets ? 'ارضيات وسقوف/optimized/' : 'assets/'; }
  function bust(url) { return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'v=' + BUILD; }

  function easeInOut(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function ensureLoadScreen() {
    if (loadEl) return loadEl;
    const css = document.createElement('style');
    css.textContent = [
      '#palace-load{position:fixed;inset:0;z-index:90;background:#050403;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;color:#f6e8d0}',
      '#palace-load .pl-inner{display:flex;flex-direction:column;align-items:flex-start;gap:14px;width:min(440px,88vw);direction:ltr}',
      '#palace-load .pl-mark{font:700 clamp(48px,12vw,78px)/.9 Georgia,"Times New Roman",serif;letter-spacing:.12em;color:#edcf91;text-shadow:0 3px 18px #000}',
      '#palace-load .pl-sub{font:600 13px/1.4 Georgia,serif;letter-spacing:.22em;color:#d4b783}',
      '#palace-load .pl-bar{width:min(340px,78vw);height:7px;border:1px solid rgba(225,183,111,.72);background:rgba(12,9,7,.85);overflow:hidden}',
      '#palace-load .pl-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#8a5a28,#f1d18d)}',
      '#palace-load .pl-status{font:600 15px/1.6 system-ui,-apple-system,Tahoma,sans-serif;color:#f6e8d0;direction:rtl;width:100%}',
      '#palace-load .pl-pct{font:600 13px/1 Georgia,serif;letter-spacing:.18em;color:#e1b76f}',
      '#palace-load .pl-err{display:none;white-space:pre-wrap;font:14px/1.65 system-ui,Tahoma,sans-serif;color:#ffb4a0;direction:rtl;width:100%}',
      '#palace-load button{display:none;margin-top:4px;padding:12px 22px;border:1px solid #efce87;background:linear-gradient(100deg,#a9783e,#60421f 58%,#241b12);color:#fff2d1;font:700 16px/1 system-ui,sans-serif;cursor:pointer}',
      '#palace-debug{display:none;position:fixed;z-index:140;left:4px;right:4px;bottom:4px;max-height:42vh;overflow:auto;background:rgba(0,0,0,.86);color:#d6ffd0;font:11px/1.35 ui-monospace,Menlo,monospace;white-space:pre-wrap;padding:8px;direction:ltr;pointer-events:auto}'
    ].join('\n');
    document.head.appendChild(css);
    loadEl = document.createElement('div');
    loadEl.id = 'palace-load';
    loadEl.innerHTML = '<div class="pl-inner"><div class="pl-mark">SIN</div><div class="pl-sub">THE CURSE OF BABYLON</div><div class="pl-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="palace-bar-fill"></i></div><div class="pl-status" id="palace-status">جارٍ تحميل: القصر الملكي</div><div class="pl-pct" id="palace-pct">0%</div><div class="pl-err" id="palace-err"></div><button type="button" id="palace-retry">إعادة المحاولة</button></div>';
    document.body.appendChild(loadEl);
    barFill = loadEl.querySelector('#palace-bar-fill');
    statusEl = loadEl.querySelector('#palace-status');
    pctEl = loadEl.querySelector('#palace-pct');
    errEl = loadEl.querySelector('#palace-err');
    retryBtn = loadEl.querySelector('#palace-retry');
    retryBtn.addEventListener('click', onRetry);
    debugEl = document.createElement('div');
    debugEl.id = 'palace-debug';
    document.body.appendChild(debugEl);
    if (debugOn()) debugEl.style.display = 'block';
    return loadEl;
  }

  function fileURL(pair) {
    const name = CONFIG.useOptimizedAssets ? pair[0] : (pair[1] || pair[0]);
    if (!name) return '';
    const folder = CONFIG.useOptimizedAssets ? 'ارضيات وسقوف/optimized/' : 'assets/';
    return bust(encodeURI(folder + name));
  }

  function makeSpecs() {
    const list = [];
    if (CONFIG.useOptimizedAssets) {
      list.push({ id: 'decoder', key: 'decoder', name: 'meshopt_decoder.js', kind: 'js', url: bust(encodeURI('vendor/meshopt_decoder.js')) });
    }
    ['floor', 'floorOrm', 'floorBorder', 'carpet', 'ceiling', 'back', 'doorWall'].forEach(function (key) {
      const pair = FILES[key];
      const name = CONFIG.useOptimizedAssets ? pair[0] : pair[1];
      list.push({ id: 'tex:' + key, key: key, name: name, kind: 'tex', url: fileURL(pair), linear: key === 'floorOrm' });
    });
    ['wall', 'columns', 'columnsLod', 'brazier', 'brazierLod', 'lion', 'lionLod', 'stairs', 'door', 'props', 'throne'].forEach(function (key) {
      const pair = FILES[key];
      const name = CONFIG.useOptimizedAssets ? pair[0] : pair[1];
      if (!name) return;
      list.push({ id: 'glb:' + key, key: key, name: name, kind: 'glb', url: fileURL(pair), optional: /Lod$/.test(key) || key === 'stairs' || key === 'door' });
    });
    list.forEach(function (s) {
      s.status = 'pending'; s.loaded = 0; s.total = 0; s.error = ''; s.attempt = 0; s.buf = null; s.result = null;
      if (s.optional == null) s.optional = false;
    });
    return list;
  }

  function byteTotals() {
    let loaded = 0, total = 0, unknown = 0;
    (specs || []).forEach(function (s) {
      if (!specCounts(s)) return;
      const t = s.total || (s.buf ? s.buf.byteLength : 0);
      const l = s.loaded || 0;
      loaded += l;
      if (t > 0) total += Math.max(t, l);
      else unknown++;
    });
    return { loaded: loaded, total: total, unknown: unknown };
  }

  function progressRatio() {
    if (!specs || !specs.length) return 0;
    const done = specs.filter(function (s) { return s.status === 'loaded' || (s.optional && (s.status === 'skipped' || s.status === 'missing')); }).length;
    const b = byteTotals();
    if (b.total <= 0) return done / specs.length;
    const byteRatio = Math.min(1, b.loaded / b.total);
    if (!b.unknown) return byteRatio;
    return byteRatio * ((specs.length - b.unknown) / specs.length) + (done / specs.length) * (b.unknown / specs.length);
  }

  function specCounts(s) {
    return !(s.optional && (s.status === 'skipped' || s.status === 'missing'));
  }

  function filesReady() {
    return !!specs && specs.length > 0 && specs.every(function (s) {
      if (s.optional && (s.status === 'skipped' || s.status === 'missing')) return true;
      return s.status === 'loaded' && s.result;
    });
  }

  function shownPercent() {
    if (warmFrame && hallBuilt && filesReady()) return 100;
    if (state === 'REVEAL' && warmMeshes && warmMeshes.length) {
      return Math.min(99, 92 + Math.floor((7 * warmIndex) / warmMeshes.length));
    }
    return Math.min(99, Math.floor(progressRatio() * 100));
  }

  function renderUI() {
    ensureLoadScreen();
    const pct = shownPercent();
    if (barFill) barFill.style.width = pct + '%';
    const bar = loadEl.querySelector('.pl-bar');
    if (bar) bar.setAttribute('aria-valuenow', String(pct));
    if (pctEl) pctEl.textContent = pct + '%';
    if (statusEl) {
      if (state === 'FAILED') statusEl.textContent = 'توقف تحميل القصر الملكي';
      else if (state === 'REVEAL') statusEl.textContent = 'جارٍ تجهيز القاعة';
      else if (filesReady() && !warmFrame) statusEl.textContent = 'جارٍ بناء القاعة';
      else if (pct >= 100) statusEl.textContent = 'القصر الملكي';
      else statusEl.textContent = 'جارٍ تحميل: القصر الملكي';
    }
    renderDebug();
  }

  function paint() {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(function () { paintQueued = false; renderUI(); });
  }

  function debugText() {
    const elapsed = loadStartedAt ? Math.round(performance.now() - loadStartedAt) : 0;
    const b = byteTotals();
    const lines = [];
    lines.push('build: ' + BUILD);
    lines.push('state: ' + state);
    lines.push('doorOpen: ' + lastDoor);
    lines.push('hero: ' + heroSnap);
    lines.push('elapsed_ms: ' + elapsed);
    lines.push('percent: ' + shownPercent());
    lines.push('hallBuilt: ' + hallBuilt + ' warmFrame: ' + warmFrame + ' loadOk: ' + loadOk);
    lines.push('bytes: ' + b.loaded + '/' + (b.total || '?') + (b.unknown ? ' unknown=' + b.unknown : ''));
    lines.push('perf: ' + (perfNote || '—'));
    lines.push('passages: ' + ((CONFIG.PASSAGES && CONFIG.PASSAGES.length) || 0) + ' ceilingH=' + (CONFIG.hallHeightH || 0).toFixed(2));
    lines.push('slots: ' + (slotModes.length ? slotModes.map(function (s) { return s.id + 'x' + s.count + ':' + s.mode; }).join(' ') : CONFIG.PROPS.map(function (s) { return s.id + 'x' + s.positions.length; }).join(' ')));
    if (overlapNotes.length) lines.push('overlaps: ' + overlapNotes.slice(0, 8).join(' | '));
    lines.push('--- files ---');
    (specs || []).forEach(function (s) {
      lines.push(s.status + ' ' + (s.loaded || 0) + '/' + (s.total || '?') + ' try=' + s.attempt + ' ' + s.url);
      if (s.error) lines.push('  error: ' + s.error);
    });
    lines.push('--- window errors ---');
    if (!runtimeErrors.length) lines.push('(none)');
    runtimeErrors.forEach(function (e) { lines.push(e); });
    lines.push('--- log ---');
    LOG.forEach(function (l) { lines.push(l); });
    lines.push('--- marks ---');
    MARKS.forEach(function (l) { lines.push(l); });
    return lines.join('\n');
  }

  let debugStamp = 0;
  let debugLast = '';
  function renderDebug() {
    if (!debugOn()) return;
    const now = performance.now();
    if (now - debugStamp < 200 && state !== 'FAILED' && state !== 'DONE') return;
    debugStamp = now;
    ensureLoadScreen();
    const text = debugText();
    if (text === debugLast) return;
    debugLast = text;
    debugEl.style.display = 'block';
    debugEl.textContent = text;
  }

  function showFail(err) {
    ensureLoadScreen();
    const failed = (specs || []).filter(function (s) { return s.status !== 'loaded'; });
    const lines = [];
    failed.forEach(function (s) {
      if (s.status === 'pending' && !s.error) return;
      lines.push('الملف: ' + s.name + '\n' + (s.error || 'فشل غير معروف'));
    });
    if (!lines.length && err) lines.push(String((err && (err.stack || err.message)) || err));
    if (!lines.length) lines.push('تعذّر بناء القاعة');
    errEl.style.display = 'block';
    errEl.textContent = lines.join('\n\n');
    retryBtn.style.display = 'inline-block';
    loadEl.style.opacity = '1';
    loadEl.style.pointerEvents = 'auto';
    renderUI();
    note('FAIL ' + lines[0]);
  }

  function onRetry() {
    if (state !== 'FAILED') return;
    note('retry');
    errEl.style.display = 'none';
    errEl.textContent = '';
    retryBtn.style.display = 'none';
    (specs || []).forEach(function (s) {
      if (s.status !== 'loaded') {
        s.buf = null; s.result = null; s.loaded = 0; s.total = 0; s.error = ''; s.status = 'pending'; s.attempt = 0;
      }
    });
    if (!filesReady()) assets = null;
    hallBuilt = false;
    warmFrame = false;
    warmMeshes = null;
    loadOk = null;
    loadError = null;
    holdT = CONFIG.minBlackHoldSeconds;
    state = 'LOADING';
    renderUI();
    loadPalaceAssets().then(function () { loadOk = true; }, function (e) { loadError = e; loadOk = false; });
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

  function fetchOnce(spec) {
    return new Promise(function (resolve, reject) {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', spec.url, true);
      xhr.responseType = 'arraybuffer';
      let lastBytes = -1;
      let lastMove = performance.now();
      let settled = false;
      let stalled = false;
      const timer = setInterval(function () {
        if (settled) return;
        if (performance.now() - lastMove >= CONFIG.stallMs) {
          stalled = true;
          try { xhr.abort(); } catch (e) {}
          fail(new Error('توقف التنزيل لأكثر من ٣٠ ثانية — ' + spec.name));
        }
      }, 400);
      function fail(err) {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        reject(err);
      }
      function ok(buf) {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        resolve(buf);
      }
      function bump(n, total) {
        if (n > lastBytes) { lastBytes = n; lastMove = performance.now(); }
        spec.loaded = n;
        if (total > 0) spec.total = total;
        spec.status = 'loading';
        paint();
      }
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 2) return;
        const n = parseInt(xhr.getResponseHeader('Content-Length') || '0', 10);
        if (n > 0 && !(spec.total > 0)) { spec.total = n; paint(); }
      };
      xhr.onprogress = function (e) { bump(e.loaded, e.lengthComputable ? e.total : 0); };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300 && xhr.response) {
          bump(xhr.response.byteLength, xhr.response.byteLength);
          ok(xhr.response);
        } else fail(new Error('HTTP ' + xhr.status + ' — ' + spec.name));
      };
      xhr.onerror = function () { fail(new Error('خطأ في الشبكة — ' + spec.name)); };
      xhr.onabort = function () {
        if (stalled) fail(new Error('توقف التنزيل لأكثر من ٣٠ ثانية — ' + spec.name));
        else fail(new Error('انقطع التنزيل — ' + spec.name));
      };
      xhr.send();
    });
  }

  const MAX_INFLIGHT = 4;
  let inflight = 0;
  const slotQueue = [];
  function acquireSlot() {
    if (inflight < MAX_INFLIGHT) { inflight++; return Promise.resolve(); }
    return new Promise(function (resolve) { slotQueue.push(resolve); });
  }
  function releaseSlot() {
    const next = slotQueue.shift();
    if (next) next();
    else inflight = Math.max(0, inflight - 1);
  }

  function fetchWithRetry(spec) {
    const waits = [1000, 2000, 4000].slice(0, CONFIG.retries);
    return (async function () {
      let err;
      for (let i = 0; i < waits.length + 1; i++) {
        spec.attempt = i + 1;
        spec.status = 'loading';
        spec.error = '';
        if (i > 0) spec.loaded = 0;
        await acquireSlot();
        let buf = null;
        let failed = false;
        try { buf = await fetchOnce(spec); }
        catch (e) {
          failed = true;
          err = e;
          spec.status = 'failed';
          spec.error = (e && e.message) || String(e);
          note('retry ' + spec.name + ' #' + spec.attempt + ' ' + spec.error);
          paint();
        }
        finally { releaseSlot(); }
        if (!failed) return buf;
        if (i < waits.length) await new Promise(function (r) { setTimeout(r, waits[i]); });
      }
      throw err;
    })();
  }

  function installDecoder(buf) {
    if (window.MeshoptDecoder && MeshoptDecoder.ready) return MeshoptDecoder.ready.then(function () { return MeshoptDecoder; });
    const code = new TextDecoder().decode(new Uint8Array(buf));
    (0, eval)(code);
    if (!window.MeshoptDecoder) throw new Error('MeshoptDecoder لم يعمل على هذا المتصفح');
    return MeshoptDecoder.ready.then(function () {
      if (MeshoptDecoder.supported === false) throw new Error('MeshoptDecoder غير مدعوم على هذا الجهاز');
      return MeshoptDecoder;
    });
  }

  function textureFromBytes(buf, name, linear) {
    const mime = /\.png$/i.test(name) ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'image/webp';
    const blob = new Blob([buf], { type: mime });
    const url = URL.createObjectURL(blob);
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        if (!img.naturalWidth) { reject(new Error('صورة فارغة — ' + name)); return; }
        const tex = new THREE.Texture(img);
        tex.needsUpdate = true;
        if (linear) {
          tex.anisotropy = aniso.v;
          tex.generateMipmaps = true;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.needsUpdate = true;
        } else srgb(tex);
        resolve(tex);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('المتصفح رفض الصورة — ' + name));
      };
      img.src = url;
    });
  }

  function tuneGLTF(gltf) {
    gltf.scene.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) {
        ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'].forEach(function (k) {
          if (!m[k]) return;
          m[k].userData.palaceShared = true;
          if (k === 'map' || k === 'emissiveMap') srgb(m[k]);
          else { m[k].anisotropy = aniso.v; m[k].needsUpdate = true; }
        });
        m.userData.palaceShared = true;
        if ((m.metalness == null || m.metalness >= 0.99) && !m.metalnessMap) {
          m.metalness = 0.3;
          m.roughness = 0.5;
        }
      });
    });
    return gltf;
  }

  function decoderResult() {
    const d = (specs || []).find(function (s) { return s.kind === 'js'; });
    return d && d.result ? d.result : null;
  }

  function waitDecoder() {
    if (!CONFIG.useOptimizedAssets) return Promise.resolve(null);
    const ready = decoderResult();
    if (ready) return Promise.resolve(ready);
    return new Promise(function (resolve, reject) {
      const timer = setInterval(function () {
        const d = (specs || []).find(function (s) { return s.kind === 'js'; });
        if (!d) { clearInterval(timer); reject(new Error('ملف MeshoptDecoder غير موجود')); return; }
        if (d.result) { clearInterval(timer); resolve(d.result); return; }
        if (d.status === 'failed') { clearInterval(timer); reject(new Error(d.error || 'MeshoptDecoder')); }
      }, 40);
    });
  }

  function parseGLB(buf) {
    const loader = new THREE.GLTFLoader();
    return waitDecoder().then(function (dec) {
      if (dec) loader.setMeshoptDecoder(dec);
      return new Promise(function (resolve, reject) {
        loader.parse(buf, '', function (g) { resolve(tuneGLTF(g)); }, function (e) {
          reject(new Error('تعذّر قراءة النموذج — ' + ((e && (e.message || e)) || 'GLB')));
        });
      });
    });
  }

  // Wing models are handed to PalaceWings untouched (no tuneGLTF), exactly as
  // its own GLTFLoader used to read them.
  function parseRawGLB(buf) {
    const loader = new THREE.GLTFLoader();
    return waitDecoder().then(function (dec) {
      if (dec) loader.setMeshoptDecoder(dec);
      return new Promise(function (resolve, reject) {
        loader.parse(buf, '', resolve, function (e) {
          reject(new Error('تعذّر قراءة النموذج — ' + ((e && (e.message || e)) || 'GLB')));
        });
      });
    });
  }

  // Wing (K1, K2, corridors) files join the palace loading screen so the wings
  // never appear undressed. They are optional: a failed file falls back to the
  // wing's own on-demand loader instead of blocking the palace.
  function attachWingSpecs() {
    if (wingsProbed || !CONFIG.useWings || !window.PalaceWings || typeof PalaceWings.assetList !== 'function') return;
    wingsProbed = true;
    PalaceWings.assetList().forEach(function (a) {
      const url = bust(encodeURI(a.url));
      if (specs.some(function (s) { return s.url === url; })) return; // same file as a palace asset: shared below
      specs.push({
        id: 'wing:' + a.url, key: 'wing:' + a.url, name: a.url.split('/').pop(), kind: a.kind === 'tex' ? 'wtex' : 'wglb',
        wingPath: a.url, url: url, optional: true,
        status: 'pending', loaded: 0, total: 0, error: '', attempt: 0, buf: null, result: null
      });
    });
  }

  async function shareWingAssets() {
    if (!wingsProbed || !window.PalaceWings) return;
    const jobs = PalaceWings.assetList().map(async function (a) {
      const url = bust(encodeURI(a.url));
      const own = specs.find(function (s) { return s.url === url && !s.wingPath; });
      if (!own || !own.buf || own.wingShared) return;
      try {
        PalaceWings.provideAsset(a.url, a.kind === 'tex' ? await textureFromBytes(own.buf, own.name, false) : await parseRawGLB(own.buf));
        own.wingShared = true;
      } catch (e) { console.warn('تعذّر تجهيز ملف الجناح مسبقاً', a.url, e); }
    });
    await Promise.all(jobs);
  }

  async function settle(spec) {
    if (spec.status === 'loaded' && spec.result) return spec.result;
    try {
      if (!spec.buf) spec.buf = await fetchWithRetry(spec);
      if (spec.kind === 'js') spec.result = await installDecoder(spec.buf);
      else if (spec.kind === 'tex') spec.result = await textureFromBytes(spec.buf, spec.name, spec.linear);
      else if (spec.kind === 'wtex') spec.result = await textureFromBytes(spec.buf, spec.name, false);
      else if (spec.kind === 'wglb') spec.result = await parseRawGLB(spec.buf);
      else {
        await waitDecoder();
        spec.result = await parseGLB(spec.buf);
      }
      if (spec.wingPath && window.PalaceWings) PalaceWings.provideAsset(spec.wingPath, spec.result);
      spec.status = 'loaded';
      spec.error = '';
      spec.loaded = spec.buf.byteLength;
      spec.total = spec.buf.byteLength;
      if (spec.optional && spec.kind === 'glb' && spec.result && spec.result.scene) {
        let tris = 0;
        spec.result.scene.traverse(function (o) {
          if (!o.isMesh || !o.geometry) return;
          const g = o.geometry;
          tris += g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
        });
        if (tris > CONFIG.maxPropTris) console.warn('الدعامة تتجاوز ٢٠ ألف مثلث', spec.name, Math.round(tris));
      }
      paint();
      return spec.result;
    } catch (err) {
      spec.status = 'failed';
      spec.error = (err && err.message) || String(err);
      paint();
      throw err;
    }
  }

  function assembleFromSpecs() {
    const tex = {};
    const props = {};
    let payload = 0;
    specs.forEach(function (s) {
      if (s.buf) payload += s.buf.byteLength;
      if (s.kind === 'tex') tex[s.key] = s.result;
      if (s.optional && s.kind === 'glb' && s.result) props[s.name] = s.result;
    });
    if (payload > CONFIG.maxPalaceBytes) console.warn('حمولة القصر تتجاوز ٢٥ ميجابايت', payload);
    if (payload > 30 * 1024 * 1024) console.warn('حمولة القصر تجاوزت السقف الصلب ٣٠ ميجابايت', payload);
    const grab = function (key) {
      const s = specs.find(function (x) { return x.key === key; });
      return s && s.result ? s.result : null;
    };
    assets = {
      tex: tex,
      wall: grab('wall'),
      columns: grab('columns'),
      columnsLod: grab('columnsLod'),
      brazier: grab('brazier'),
      brazierLod: grab('brazierLod'),
      lion: grab('lion'),
      lionLod: grab('lionLod'),
      stairs: grab('stairs'),
      door: grab('door'),
      props: grab('props'),
      throne: grab('throne'),
      propFiles: props,
      payload: payload
    };
    return assets;
  }

  function propFileURL(name) {
    const folder = CONFIG.useOptimizedAssets ? 'ارضيات وسقوف/optimized/' : 'ارضيات وسقوف/props/';
    return bust(encodeURI(folder + name));
  }

  async function attachExistingPropSpecs() {
    if (propsProbed) return;
    propsProbed = true;
    const seen = {};
    const jobs = [];
    CONFIG.PROPS.forEach(function (slot) {
      if (!slot.glbPath || seen[slot.glbPath]) return;
      seen[slot.glbPath] = true;
      jobs.push((async function () {
        const url = propFileURL(slot.glbPath);
        let status = 0;
        let len = 0;
        try {
          const res = await fetch(url, { method: 'HEAD' });
          status = res.status;
          len = parseInt(res.headers.get('content-length') || '0', 10);
        } catch (e) {
          console.warn('تعذّر فحص ملف الدعامة', slot.id, slot.glbPath);
          return;
        }
        if (status === 404 || status === 403) {
          console.warn('الدعامة غير موجودة، يُبقى الشكل المؤقت', slot.id, slot.glbPath);
          return;
        }
        if (status < 200 || status >= 300) {
          console.warn('تعذّر فحص الدعامة', slot.id, status, slot.glbPath);
          return;
        }
        if (len > CONFIG.maxPropBytes) console.warn('حجم الدعامة يتجاوز ٣ ميجابايت', slot.glbPath, len);
        specs.push({
          id: 'prop:' + slot.glbPath, key: 'prop:' + slot.glbPath, name: slot.glbPath, kind: 'glb', url: url, optional: true,
          status: 'pending', loaded: 0, total: len, error: '', attempt: 0, buf: null, result: null
        });
      })());
    });
    await Promise.all(jobs);
  }

  function loadPalaceAssets() {
    if (assets && filesReady()) return Promise.resolve(assets);
    if (loadPromise) return loadPromise;
    if (!specs) specs = makeSpecs();
    loadPromise = (async function () {
      await attachExistingPropSpecs();
      attachWingSpecs();
      const jobs = specs.map(function (s) {
        return settle(s).catch(function (err) {
          if (s.optional) {
            s.status = 'skipped';
            console.warn('فشل تحميل الدعامة، يُبقى الشكل المؤقت', s.name, s.error || (err && err.message) || err);
            return null;
          }
          return null;
        });
      });
      await Promise.all(jobs);
      await shareWingAssets();
      specs.forEach(function (s) { s.buf = null; });
      const failed = specs.filter(function (s) { return !s.optional && (s.status !== 'loaded' || !s.result); });
      if (failed.length) {
        const err = new Error(failed.map(function (s) { return s.name + ': ' + (s.error || 'فشل'); }).join(' | '));
        err.file = failed[0].name;
        throw err;
      }
      return assembleFromSpecs();
    })().catch(function (err) { loadPromise = null; throw err; });
    return loadPromise;
  }

  specs = makeSpecs();

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
    if (!flameSprite.mat) {
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
      flameSprite.mat = new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
    }
    return new THREE.Sprite(flameSprite.mat);
  }

  function addBox(min, max) {
    colliders.push({ minx: min.x, miny: min.y, minz: min.z, maxx: max.x, maxy: max.y, maxz: max.z });
  }

  function releaseCity(scene, hero) {
    if (!scene || scene.userData.cityReleased) return;
    scene.userData.cityReleased = true;
    const keep = new Set();
    function hold(root) {
      if (!root) return;
      root.traverse(function (o) { keep.add(o); });
    }
    hold(hero);
    hold(group);
    scene.traverse(function (o) {
      if (o.isLight || o.isCamera || o.isPoints || o.name === 'SkyPhoto') hold(o);
    });
    const drop = [];
    scene.children.forEach(function (ch) {
      if (keep.has(ch) || ch === group || ch === hero) return;
      drop.push(ch);
    });
    drop.forEach(function (ch) {
      scene.remove(ch);
      try { disposeObject(ch); } catch (e) { /* keep going */ }
    });
    if (scene.userData) scene.userData.cityReleased = true;
    note('city released ' + drop.length);
  }

  let lightsCulled = false;
  function cullOutsideLights(scene, on) {
    if (!scene) return;
    scene.traverse(function (o) {
      if (!o.isLight) return;
      let p = o.parent, inside = false;
      while (p) {
        if (p === group || p.name === 'PalaceWings') { inside = true; break; }
        p = p.parent;
      }
      if (inside) return;
      if (on) {
        if (o.userData._palaceLight == null) o.userData._palaceLight = o.visible;
        o.visible = false;
      } else if (o.userData._palaceLight != null) {
        o.visible = o.userData._palaceLight;
        o.userData._palaceLight = null;
      }
    });
    lightsCulled = on;
    if (on) {
      let n = 0;
      scene.traverse(function (o) { if (o.isLight && o.visible) n++; });
      mark('palace lights ' + n);
    }
  }

  function holdCull(scene, hero) {
    if (!scene || !group) return;
    const on = state === 'SETUP' || state === 'REVEAL' || state === 'FADING_IN' || state === 'ENTRANCE' || state === 'SETTLE' || state === 'FAILED' || (state === 'DONE' && occupant);
    scene.children.forEach(function (ch) {
      if (ch === group || ch === hero || ch.name === 'SkyPhoto' || ch.name === 'PalaceInterior' || ch.name === 'PalaceWings') return;
      if (on) {
        if (ch.userData._palaceWas == null) ch.userData._palaceWas = ch.visible;
        ch.visible = false;
      } else if (ch.userData._palaceWas != null) {
        ch.visible = ch.userData._palaceWas;
        ch.userData._palaceWas = null;
      }
    });
    const onLights = state === 'SETUP' || state === 'REVEAL' || state === 'FADING_IN' || state === 'ENTRANCE' || state === 'SETTLE' || state === 'FAILED' || (state === 'DONE' && occupant);
    if (onLights && !lightsCulled) cullOutsideLights(scene, true);
    if (!onLights && lightsCulled) cullOutsideLights(scene, false);
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
      if (o.geometry && !o.geometry.userData.palaceShared && o.geometry.dispose) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      mats.forEach(m => {
        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'envMap'].forEach(k => {
          if (m[k] && m[k].dispose && !m[k].userData.palaceShared) m[k].dispose();
        });
        if (m.dispose && !m.userData.palaceShared) m.dispose();
      });
    });
  }

  function removeGroup(scene) {
    if (wingRuntime && window.PalaceWings) { PalaceWings.dispose(); wingRuntime = null; }
    if (!group) return;
    scene.remove(group);
    disposeObject(group);
    if (palaceEnv && palaceEnv.dispose && !palaceEnv.userData.keep) palaceEnv.dispose();
    palaceEnv = null;
    flameSprite.mat = null;
    group = null;
    colliders = [];
    lights = [];
    ramp = null;
    flames = [];
    fireMats = [];
    lodPacks = [];
    fireList = [];
    lightAssignAt = 0;
  }

  const poser = new THREE.Object3D();

  const FIRE_VS = [
    'varying vec2 vUv;',
    'varying float vSeed;',
    'attribute float aSeed;',
    'void main() {',
    '  vUv = uv;',
    '  vSeed = aSeed;',
    '  vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, position.y, 0.0, 1.0)).xyz;',
    '  float sx = length(instanceMatrix[0].xyz);',
    '  vec3 toCam = cameraPosition - center;',
    '  toCam.y = 0.0;',
    '  float dlen = length(toCam);',
    '  vec3 side = dlen > 0.0001 ? vec3(toCam.z, 0.0, -toCam.x) / dlen : vec3(1.0, 0.0, 0.0);',
    '  vec3 worldPos = center + side * position.x * sx;',
    '  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);',
    '}'
  ].join('\n');
  const FIRE_FS = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'varying float vSeed;',
    'uniform float uTime;',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float noise(vec2 p){',
    '  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
    '}',
    'float fbm(vec2 p){ float v = 0.0; float a = 0.5; v += a * noise(p); p *= 2.03; a *= 0.5; v += a * noise(p); p *= 2.03; a *= 0.5; v += a * noise(p); p *= 2.03; a *= 0.5; v += a * noise(p); return v; }',
    'void main() {',
    '  vec2 uv = vUv;',
    '  float t = uTime * (0.65 + fract(vSeed) * 0.45);',
    '  float n = fbm(vec2(uv.x * 3.0 + vSeed, uv.y * 2.2 - t));',
    '  float n2 = fbm(vec2(uv.x * 6.0 - t * 0.4, uv.y * 4.0 - t * 1.35));',
    '  float flick = n * 0.65 + n2 * 0.35;',
    '  float width = mix(0.46, 0.07, uv.y);',
    '  width *= mix(0.72, 1.18, flick);',
    '  float dx = abs(uv.x - 0.5);',
    '  float mask = smoothstep(width, width * 0.42, dx);',
    '  float top = smoothstep(1.0, 0.7, uv.y);',
    '  float body = mask * top * smoothstep(0.0, 0.07, uv.y);',
    '  body *= smoothstep(0.12, 0.55, flick + uv.y * 0.22);',
    '  vec3 col = mix(vec3(0.32, 0.02, 0.0), vec3(1.0, 0.28, 0.02), smoothstep(0.0, 0.5, uv.y));',
    '  col = mix(col, vec3(1.0, 0.7, 0.18), smoothstep(0.4, 0.82, 1.0 - uv.y));',
    '  col = mix(col, vec3(1.0, 0.95, 0.8), smoothstep(0.55, 0.95, flick) * (1.0 - uv.y));',
    '  float alpha = body * (0.5 + 0.5 * flick);',
    '  if (alpha < 0.02) discard;',
    '  gl_FragColor = vec4(col, alpha);',
    '}'
  ].join('\n');
  const GLOW_VS = [
    'varying vec2 vUv;',
    'attribute float aSeed;',
    'void main() {',
    '  vUv = uv;',
    '  vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;',
    '  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);',
    '  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);',
    '  float sx = length(instanceMatrix[0].xyz);',
    '  float sy = length(instanceMatrix[1].xyz);',
    '  vec3 worldPos = center + camRight * position.x * sx + camUp * position.y * sy;',
    '  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);',
    '}'
  ].join('\n');
  const GLOW_FS = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'void main() {',
    '  float d = length(vUv - 0.5);',
    '  float a = smoothstep(0.5, 0.0, d);',
    '  a *= a;',
    '  if (a < 0.02) discard;',
    '  gl_FragColor = vec4(1.0, 0.55, 0.18, a * 0.45);',
    '}'
  ].join('\n');
  const EMBER_VS = [
    'attribute float aSeed;',
    'uniform float uTime;',
    'void main() {',
    '  float life = fract(uTime * (0.28 + aSeed * 0.35) + aSeed);',
    '  vec3 p = position;',
    '  float ang = aSeed * 6.28318;',
    '  p.x += cos(ang + life * 3.0) * life * 0.16;',
    '  p.z += sin(ang + life * 2.2) * life * 0.16;',
    '  p.y += life * (0.45 + fract(aSeed * 7.1) * 0.65);',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  gl_PointSize = max(1.0, (1.0 - life) * 12.0 * (7.0 / max(0.25, -mv.z)));',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');
  const EMBER_FS = [
    'precision mediump float;',
    'void main() {',
    '  float d = length(gl_PointCoord - 0.5);',
    '  if (d > 0.5) discard;',
    '  float a = smoothstep(0.5, 0.05, d);',
    '  gl_FragColor = vec4(1.0, 0.46, 0.12, a);',
    '}'
  ].join('\n');

  function pose(x, y, z, rot, sx, sy, sz) {
    poser.position.set(x, y, z);
    poser.rotation.set(0, rot || 0, 0);
    poser.scale.set(sx, sy, sz);
    poser.updateMatrix();
    return poser.matrix.clone();
  }

  function geoSize(geo) {
    geo.computeBoundingBox();
    return geo.boundingBox.getSize(new THREE.Vector3());
  }

  function recenterGeo(geo) {
    geo.computeBoundingBox();
    const b = geo.boundingBox;
    geo.translate(-(b.min.x + b.max.x) * 0.5, -b.min.y, -(b.min.z + b.max.z) * 0.5);
    geo.computeBoundingBox();
  }

  function prepMesh(gltf) {
    if (!gltf || !gltf.scene) return null;
    gltf.scene.updateMatrixWorld(true);
    let mesh = null;
    gltf.scene.traverse(function (o) { if (!mesh && o.isMesh) mesh = o; });
    if (!mesh) return null;
    const geo = mesh.geometry.clone();
    geo.userData.palaceShared = false;
    geo.applyMatrix4(mesh.matrixWorld);
    recenterGeo(geo);
    return { geo: geo, size: geoSize(geo), material: mesh.material };
  }

  function palaceMat(src) {
    const base = Array.isArray(src) ? src[0] : src;
    const m = base.clone();
    m.userData = Object.assign({}, m.userData, { palaceShared: false });
    if ((m.metalness == null || m.metalness >= 0.99) && !m.metalnessMap) {
      m.metalness = 0.3;
      m.roughness = 0.5;
    }
    m.side = THREE.DoubleSide;
    if (palaceEnv) {
      m.envMap = palaceEnv;
      m.envMapIntensity = 0.6;
    }
    return m;
  }

  function addLOD(geo0, mat0, geo1, mat1, matrices, locals, limitH) {
    const n = matrices.length;
    const near = new THREE.InstancedMesh(geo0, mat0, n);
    const far = new THREE.InstancedMesh(geo1, mat1, n);
    near.frustumCulled = false;
    far.frustumCulled = false;
    near.castShadow = far.castShadow = false;
    near.receiveShadow = far.receiveShadow = true;
    for (let i = 0; i < n; i++) near.setMatrixAt(i, matrices[i]);
    near.count = n;
    far.count = 0;
    far.visible = false;
    near.instanceMatrix.needsUpdate = true;
    near.name = 'lod-near';
    far.name = 'lod-far';
    group.add(near, far);
    lodPacks.push({ near: near, far: far, matrices: matrices, local: locals, limitH: limitH });
  }

  function makePalaceEnv(renderer) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 64);
    grd.addColorStop(0, '#100e0c');
    grd.addColorStop(0.4, '#3a2618');
    grd.addColorStop(0.52, '#e39a45');
    grd.addColorStop(0.64, '#5c381f');
    grd.addColorStop(1, '#0c0a09');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = 'rgba(255,214,150,0.95)';
    [[18, 34], [46, 36], [74, 33], [104, 35]].forEach(function (p) {
      g.beginPath();
      g.arc(p[0], p[1], 3.2, 0, 6.283);
      g.fill();
    });
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.encoding = THREE.sRGBEncoding;
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const env = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose();
    tex.dispose();
    return env;
  }

  function attachFloorShader(material) {
    material.onBeforeCompile = function (shader) {
      shader.uniforms.slabSize = { value: 1.8 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPalaceWorld;')
        .replace('#include <project_vertex>', 'vec4 palaceWorldV = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\npalaceWorldV = instanceMatrix * palaceWorldV;\n#endif\npalaceWorldV = modelMatrix * palaceWorldV;\nvPalaceWorld = palaceWorldV.xyz;\n#include <project_vertex>');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPalaceWorld;\nuniform float slabSize;')
        .replace('#include <map_fragment>', [
          '#ifdef USE_MAP',
          'vec4 sampledDiffuseColor = texture2D(map, vUv);',
          'vec4 sampledHalf = texture2D(map, vUv + vec2(0.5, 0.5));',
          'sampledDiffuseColor = mix(sampledDiffuseColor, sampledHalf, 0.16);',
          'diffuseColor *= sampledDiffuseColor;',
          '#endif',
          '{',
          '  vec2 wp = vPalaceWorld.xz / max(0.001, slabSize);',
          '  vec2 cell = floor(wp);',
          '  vec2 f = fract(wp);',
          '  float jw = 0.028;',
          '  float joint = smoothstep(jw, jw + 0.018, f.x) * smoothstep(jw, jw + 0.018, 1.0 - f.x);',
          '  joint *= smoothstep(jw, jw + 0.018, f.y) * smoothstep(jw, jw + 0.018, 1.0 - f.y);',
          '  float ncell = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);',
          '  vec3 tint = mix(vec3(0.93, 0.90, 0.86), vec3(1.06, 1.02, 0.96), ncell);',
          '  float macro = 0.93 + 0.07 * sin(vPalaceWorld.x * 0.17) * cos(vPalaceWorld.z * 0.11);',
          '  diffuseColor.rgb *= mix(vec3(0.42, 0.38, 0.34), tint, joint) * macro;',
          '}'
        ].join('\n'))
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * (0.82 + 0.36 * fract(sin(dot(floor(vPalaceWorld.xz / max(0.001, slabSize)), vec2(12.9, 78.2))) * 437.1)), 0.14, 0.55);');
    };
    material.customProgramCacheKey = function () { return 'palaceMarble6'; };
  }

  function updateLODs(cam) {
    if (!cam || !group || !lodPacks.length) return;
    group.updateMatrixWorld(true);
    const wp = new THREE.Vector3();
    for (let p = 0; p < lodPacks.length; p++) {
      const pack = lodPacks[p];
      const lim = (pack.limitH || CONFIG.lodDistanceH) * H;
      let ni = 0;
      let fi = 0;
      for (let i = 0; i < pack.local.length; i++) {
        wp.copy(pack.local[i]);
        group.localToWorld(wp);
        if (cam.position.distanceTo(wp) > lim) pack.far.setMatrixAt(fi++, pack.matrices[i]);
        else pack.near.setMatrixAt(ni++, pack.matrices[i]);
      }
      pack.near.count = ni;
      pack.far.count = fi;
      pack.near.visible = ni > 0;
      pack.far.visible = fi > 0;
      if (ni) pack.near.instanceMatrix.needsUpdate = true;
      if (fi) pack.far.instanceMatrix.needsUpdate = true;
    }
  }

  function animateHall(dt, ctx) {
    if (!group) return;
    const cam = ctx.camera;
    if (cam) updateLODs(cam);
    if (wingRuntime && window.PalaceWings) PalaceWings.tick(dt, ctx);
  }


  function build(ctx) {
    const W = CONFIG.hallWidthH * H, L = CONFIG.hallLengthH * H;
    let CH = CONFIG.hallHeightH * H;
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
    if (ctx.renderer && ctx.renderer.shadowMap) ctx.renderer.shadowMap.enabled = false;
    // disposeExteriorAfterEntry is off: deleting the whole city here freezes the
    // loading screen long enough for the tab to be killed and sent back to the start.
    // holdCull already hides the exterior while the hero is inside.
    if (CONFIG.disposeExteriorAfterEntry) {
      try { releaseCity(ctx.scene, ctx.hero); } catch (relErr) { note('release ' + (relErr && relErr.message)); }
    }
    flames = [];
    slotModes = [];
    overlapNotes = [];
    ramp = null;
    lodPacks = [];
    fireList = [];
    fireMats = [];
    lightAssignAt = 0;
    const dummy = new THREE.Object3D();
    const extras = [];
    const pendingWatch = [];
    const tex = assets.tex;
    Object.keys(tex).forEach(function (k) { if (tex[k]) tex[k].userData.palaceShared = true; });
    if (!assets.props) console.warn('مجموعة الأغراض غير محمّلة — القاعة بلا أثاث مفصول.');
    try {
      palaceEnv = ctx.renderer ? makePalaceEnv(ctx.renderer) : null;
      if (palaceEnv) palaceEnv.userData.palaceShared = true;
    } catch (envErr) {
      palaceEnv = null;
      console.warn('تعذّر إنشاء انعكاس القاعة', envErr && envErr.message);
    }

    const stairFootZ = PLAN.stairFootZ * H;
    let platformFrontZ = PLAN.platformFrontZ * H;
    let topY = PLAN.topY * H;
    let throneZ = PLAN.throneZ * H;
    const stepDepth = CONFIG.stairTreadH * H;
    const stepH = CONFIG.stairRiseH * H;
    const stepsN = CONFIG.stairSteps;
    let stairW = CONFIG.stairWidthH * H;
    let stairOuter = stairW * 0.5;

    const wallSrc = prepMesh(assets.wall);
    if (!wallSrc) throw new Error('نموذج الجدارية بلا شبكة');
    if (wallSrc.size.x > wallSrc.size.z) {
      wallSrc.geo.rotateY(Math.PI / 2);
      recenterGeo(wallSrc.geo);
      wallSrc.size = geoSize(wallSrc.geo);
    }
    let n = 3;
    for (let k = 2; k <= 6; k++) {
      const hTry = wallSrc.size.y * ((L / k) / Math.max(1e-4, wallSrc.size.z));
      if (hTry >= 5.5 * H && hTry <= 8 * H) { n = k; break; }
    }
    const moduleLen = L / n;
    const wallScale = moduleLen / Math.max(1e-4, wallSrc.size.z);
    CH = wallSrc.size.y * wallScale;
    if (CH > 8 * H) {
      const fit = (8 * H) / CH;
      CH = 8 * H;
      console.warn('ارتفاع الجدارية مقصوص عند 8H', fit);
    }
    CONFIG.hallHeightH = CH / H;
    const wallThick = wallSrc.size.x * wallScale;
    const halfT = wallThick * 0.5;
    const wallMat = palaceMat(wallSrc.material);
    const wallMats = [];
    const wallLocals = [];
    for (let i = 0; i < n; i++) {
      const zc = (i + 0.5) * moduleLen;
      [-1, 1].forEach(function (side) {
        const x = side < 0 ? (-W / 2 - halfT) : (W / 2 + halfT);
        const scx = side < 0 ? wallScale : -wallScale;
        wallMats.push(pose(x, -0.05, zc, 0, scx, wallScale, wallScale * 1.08));
        wallLocals.push(new THREE.Vector3(x, CH * 0.5, zc));
      });
    }
    const wallsMesh = new THREE.InstancedMesh(wallSrc.geo, wallMat, wallMats.length);
    wallsMesh.name = 'wall-module';
    wallsMesh.frustumCulled = false;
    wallsMesh.castShadow = false;
    wallMats.forEach(function (m, i) { wallsMesh.setMatrixAt(i, m); });
    wallsMesh.instanceMatrix.needsUpdate = true;
    group.add(wallsMesh);
    slotModes.push({ id: 'wall', count: wallMats.length, mode: 'real' });
    mark('phase walls n=' + wallMats.length);

    const archW = CONFIG.archWidthRatio * moduleLen;
    const archH = CONFIG.archHeightRatio * CH;
    CONFIG.PASSAGES = [];
    const alcoveMat = new THREE.MeshStandardMaterial({ color: 0x14110e, roughness: 0.96, metalness: 0.02 });
    if (palaceEnv) { alcoveMat.envMap = palaceEnv; alcoveMat.envMapIntensity = 0.15; }
    function inArch(z) {
      for (let i = 0; i < n; i++) {
        if (Math.abs(z - (i + 0.5) * moduleLen) < archW * 0.5 + 0.25 * H) return true;
      }
      return false;
    }
    for (let i = 0; i < n; i++) {
      const zc = (i + 0.5) * moduleLen;
      [-1, 1].forEach(function (side) {
        const depth = 1.15 * H;
        const inner = side * (W / 2);
        const outer = inner + side * wallThick;
        const backX = outer + side * depth;
        if (!wingArchOpen(side, i)) {
        const back = new THREE.Mesh(new THREE.PlaneGeometry(archW, archH), alcoveMat);
        back.position.set(backX, archH * 0.5, zc);
        back.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
        back.name = 'passage-back';
        group.add(back);
        const sideGeo = new THREE.BoxGeometry(depth, archH, 0.08 * H);
        [-1, 1].forEach(function (k) {
          const jamb = new THREE.Mesh(sideGeo, alcoveMat);
          jamb.position.set((outer + backX) / 2, archH * 0.5, zc + k * (archW / 2));
          jamb.name = 'passage-jamb';
          group.add(jamb);
        });
        const ceilGeo = new THREE.BoxGeometry(depth, 0.06 * H, archW);
        const cl = new THREE.Mesh(ceilGeo, alcoveMat);
        cl.position.set((outer + backX) / 2, archH, zc);
        cl.name = 'passage-slab';
        const floorSpan = Math.abs(backX - inner) + 0.2 * H;
        const fl = new THREE.Mesh(new THREE.BoxGeometry(floorSpan, 0.1 * H, archW + 0.2 * H), alcoveMat);
        fl.position.set((inner + backX) / 2, -0.02, zc);
        fl.name = 'passage-slab';
        group.add(fl, cl);
        const span = 0.22 * H;
        const x0 = Math.min(inner, inner - side * span);
        const x1 = Math.max(inner, inner - side * span);
        extras.push({ min: new THREE.Vector3(x0, 0, zc - archW / 2), max: new THREE.Vector3(x1, archH, zc + archW / 2) });
        }
        CONFIG.PASSAGES.push({
          id: 'passage-' + (side < 0 ? 'L' : 'R') + i,
          position: [inner, 0, zc],
          rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
          width: archW,
          height: archH,
          state: wingArchOpen(side, i) ? 'open' : (CONFIG.useWings && side < 0 && i === 0 ? 'sealed' : 'closed')
        });
      });
    }

    const colSrc = prepMesh(assets.columns);
    const colLod = prepMesh(assets.columnsLod) || colSrc;
    if (!colSrc) throw new Error('نموذج الأعمدة بلا شبكة');
    const colH = Math.max(H, CH - 0.05);
    const colScale = colH / Math.max(1e-4, colSrc.size.y);
    const colRad = Math.max(colSrc.size.x, colSrc.size.z) * 0.5 * colScale;
    let colX = W / 2 - colRad - 1.22 * H;
    const minColX = 1.5 * H + colRad + 0.15 * H;
    if (colX < minColX) {
      console.warn('صف الأعمدة زاحم الممر', (colX / H).toFixed(2));
      colX = minColX;
    }
    const aisle = 2 * (colX - colRad);
    if (aisle < 3 * H) console.warn('الممر أضيق من 3H', (aisle / H).toFixed(2));
    const colZs = [];
    for (let i = 0; i <= n; i++) {
      let z = i * moduleLen;
      if (i === 0) z = Math.min(colRad * 0.92, moduleLen * 0.12);
      if (i === n) z = Math.max(L - colRad * 0.92, L - moduleLen * 0.12);
      colZs.push(z);
    }
    for (let i = 0; i < n; i++) {
      const mid = (colZs[i] + colZs[i + 1]) * 0.5;
      const archZ = (i + 0.5) * moduleLen;
      if (Math.abs(mid - archZ) > 0.75 * H) console.warn('قوس بعيد عن منتصف عمودين', i, (mid / H).toFixed(2), (archZ / H).toFixed(2));
    }
    const colMat = palaceMat(colSrc.material);
    const colMatrices = [];
    const colLocals = [];
    colZs.forEach(function (z) {
      [-1, 1].forEach(function (side) {
        const x = side * colX;
        colMatrices.push(pose(x, 0, z, 0, colScale, colScale, colScale));
        colLocals.push(new THREE.Vector3(x, colH * 0.5, z));
        extras.push({ min: new THREE.Vector3(x - colRad * 0.72, 0, z - colRad * 0.72), max: new THREE.Vector3(x + colRad * 0.72, colH, z + colRad * 0.72) });
        pendingWatch.push({ name: 'column', min: new THREE.Vector3(x - colRad, 0, z - colRad), max: new THREE.Vector3(x + colRad, colH, z + colRad) });
      });
    });
    addLOD(colSrc.geo, colMat, colLod.geo === colSrc.geo ? colSrc.geo.clone() : colLod.geo, colMat, colMatrices, colLocals, 5.2);
    slotModes.push({ id: 'column', count: colMatrices.length, mode: 'real' });
    mark('phase columns n=' + colMatrices.length);

    const floorPadX = Math.max(0.5 * H, wallThick * 0.9);
    const floorPadZ = 0.05 * H;
    const marble = tex.floor.clone();
    srgb(marble);
    marble.wrapS = marble.wrapT = THREE.RepeatWrapping;
    marble.repeat.set((W + floorPadX * 2) / 1.8, (L + floorPadZ * 2) / 1.8);
    const orm = tex.floorOrm ? tex.floorOrm.clone() : null;
    if (orm) {
      orm.wrapS = orm.wrapT = THREE.RepeatWrapping;
      orm.repeat.copy(marble.repeat);
    }
    const floorGeo = new THREE.PlaneGeometry(W + floorPadX * 2, L + floorPadZ * 2);
    floorGeo.setAttribute('uv2', floorGeo.attributes.uv);
    const floorMat = new THREE.MeshStandardMaterial({
      map: marble, roughness: 1, metalness: 0, roughnessMap: orm, aoMap: orm, aoMapIntensity: 0.85
    });
    if (palaceEnv) { floorMat.envMap = palaceEnv; floorMat.envMapIntensity = 0.6; }
    attachFloorShader(floorMat);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.015, L / 2);
    floor.name = 'floor';
    floor.receiveShadow = true;
    group.add(floor);

    const borderMap = tex.floorBorder.clone();
    srgb(borderMap);
    borderMap.wrapS = borderMap.wrapT = THREE.RepeatWrapping;
    const borderMat = new THREE.MeshStandardMaterial({ map: borderMap, roughness: 0.72, metalness: 0.08 });
    if (palaceEnv) { borderMat.envMap = palaceEnv; borderMat.envMapIntensity = 0.35; }
    const bw = 0.48 * H;
    function borderStrip(w, len, x, z, alongX) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), borderMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.006 * H, z);
      m.material = borderMat.clone();
      m.material.map = borderMap.clone();
      srgb(m.material.map);
      m.material.map.wrapS = m.material.map.wrapT = THREE.RepeatWrapping;
      m.material.map.repeat.set(alongX ? w / (1.2 * H) : 1, alongX ? 1 : len / (1.2 * H));
      if (palaceEnv) { m.material.envMap = palaceEnv; m.material.envMapIntensity = 0.35; }
      m.material.polygonOffset = true;
      m.material.polygonOffsetFactor = -1;
      m.material.polygonOffsetUnits = -1;
      m.name = 'floor-border';
      group.add(m);
    }
    borderStrip(W, bw, 0, bw / 2, true);
    borderStrip(W - bw * 2, bw, 0, stairFootZ - bw * 0.65, true);
    borderStrip(bw, stairFootZ - bw, -W / 2 + bw / 2, (stairFootZ - bw) / 2, false);
    borderStrip(bw, stairFootZ - bw, W / 2 - bw / 2, (stairFootZ - bw) / 2, false);

    const cw = CONFIG.carpetWidthH * H;
    const carpetSrc = tex.carpet;
    const img = carpetSrc.image || { width: 1067, height: 1809 };
    const iw = img.naturalWidth || img.width || 1067;
    const ih = img.naturalHeight || img.height || 1809;
    const portrait = ih >= iw;
    const tileLen = portrait ? cw * (ih / Math.max(1, iw)) : cw * (iw / Math.max(1, ih));
    function carpetSeg(z0, z1) {
      const len = Math.max(0.2, z1 - z0);
      const map = carpetSrc.clone();
      srgb(map);
      map.wrapS = THREE.ClampToEdgeWrapping;
      map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(1, len / tileLen);
      if (!portrait) { map.rotation = Math.PI / 2; map.center.set(0.5, 0.5); }
      const m = plane(cw, len, 0.012 * H, map, 0, (z0 + z1) / 2);
      m.material.roughness = 0.84;
      m.material.metalness = 0.02;
      m.material.polygonOffset = true;
      m.material.polygonOffsetFactor = -4;
      m.material.polygonOffsetUnits = -4;
      m.name = 'carpet';
      return m;
    }
    const carpetEnd = stairFootZ + 0.04 * H;
    group.add(carpetSeg(0.4 * H, carpetEnd));

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xcbb9a4, roughness: 0.62, metalness: 0.04 });
    if (palaceEnv) { stoneMat.envMap = palaceEnv; stoneMat.envMapIntensity = 0.28; }
    if (assets.stairs && assets.stairs.scene) {
      const model = assets.stairs.scene.clone(true);
      model.rotation.y = Math.PI;
      const holder = new THREE.Group();
      holder.name = 'stairs';
      const fit = H / 1.8;
      holder.scale.setScalar(fit);
      holder.add(model);
      holder.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(holder);
      const size = box.getSize(new THREE.Vector3());
      const fitOk = [size.x, size.y, size.z].every(Number.isFinite) && size.y > 0.2 && size.z > 0.2 && size.x > 0.2;
      if (!fitOk) {
        console.warn('قياس الدرج غير صالح — يُبقى الدرج البرمجي', size.x, size.y, size.z);
      } else {
      holder.position.x -= (box.min.x + box.max.x) * 0.5;
      holder.position.y -= box.min.y;
      holder.position.z += stairFootZ - box.min.z;
      model.traverse(function (o) {
        if (!o.isMesh) return;
        o.castShadow = false;
        o.receiveShadow = true;
        o.frustumCulled = true;
      });
      group.add(holder);
      const rise = size.y * (3.09022 / 4.49554);
      const run = size.z * (7.17277 / 7.45301);
      stairW = size.x * (8.84 / 11.26);
      stairOuter = size.x * 0.5;
      platformFrontZ = stairFootZ + run;
      topY = rise;
      const platBack = L - CONFIG.backMarginH * H;
      throneZ = (platformFrontZ + platBack) * 0.5;
      const stepHalf = stairW * 0.5;
      extras.push({ min: new THREE.Vector3(-stairOuter, 0, stairFootZ), max: new THREE.Vector3(-stepHalf + 0.04 * H, topY + 0.4 * H, platformFrontZ) });
      extras.push({ min: new THREE.Vector3(stepHalf - 0.04 * H, 0, stairFootZ), max: new THREE.Vector3(stairOuter, topY + 0.4 * H, platformFrontZ) });
      }
    }
    if (!group.getObjectByName('stairs')) {
      console.warn('درج.glb غير موجود — يُبقى الدرج البرمجي');
      for (let i = 0; i < stepsN; i++) {
        const zFront = stairFootZ + i * stepDepth;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(stairW, stepH, stepDepth + 0.02 * H), stoneMat);
        mesh.position.set(0, stepH * 0.5 + i * stepH, zFront + stepDepth * 0.5);
        mesh.name = 'step';
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      stairOuter = stairW * 0.5;
    }
    const platLen = Math.max(1.2 * H, (L - 0.08 * H) - platformFrontZ);
    const platform = new THREE.Mesh(new THREE.BoxGeometry(stairW, 0.12 * H, platLen), stoneMat);
    platform.position.set(0, topY - 0.06 * H, platformFrontZ + platLen * 0.5);
    platform.name = 'platform';
    platform.receiveShadow = true;
    group.add(platform);
    ramp = { x0: -stairW / 2, x1: stairW / 2, z0: stairFootZ, z1: platformFrontZ, zPlat: L - 0.2 * H, yTop: topY };

    let throneObj;
    if (assets.throne) {
      throneObj = wrapFitted(assets.throne.scene.clone(true), CONFIG.throneHeightH * H);
      throneObj.name = 'throne';
      throneObj.position.set(0, topY, throneZ);
      throneObj.rotation.y = Math.PI;
    } else {
      console.error('عرش البطل.glb غير موجود — وُضع عرش بديل.');
      throneObj = new THREE.Group();
      throneObj.name = 'throne-stand-in';
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.35 * H, 0.42 * H, 1.05 * H), stoneMat);
      seat.position.y = 0.21 * H;
      throneObj.add(seat);
      throneObj.position.set(0, topY, throneZ);
    }
    group.add(throneObj);

    const backImg = tex.back.image || { width: 1536, height: 1024 };
    const bwA = (backImg.naturalWidth || backImg.width || 1536) / Math.max(1, backImg.naturalHeight || backImg.height || 1024);
    let panelH = CH * 0.94;
    let panelW = panelH * bwA;
    if (panelW > W * 0.94) { panelW = W * 0.94; panelH = panelW / bwA; }
    const backMap = tex.back.clone();
    srgb(backMap);
    const backEmit = backMap.clone();
    srgb(backEmit);
    const backMat = new THREE.MeshStandardMaterial({
      map: backMap, emissive: new THREE.Color(0xffffff), emissiveMap: backEmit, emissiveIntensity: 0.2,
      roughness: 0.9, metalness: 0.05
    });
    if (palaceEnv) { backMat.envMap = palaceEnv; backMat.envMapIntensity = 0.25; }
    const northFill = new THREE.Mesh(new THREE.PlaneGeometry(W + wallThick * 2 + 0.8, CH + 0.5), new THREE.MeshStandardMaterial({ color: 0x1a140f, roughness: 0.94, metalness: 0.02 }));
    northFill.position.set(0, CH / 2, L + 0.04);
    northFill.rotation.y = Math.PI;
    northFill.name = 'north-wall';
    group.add(northFill);
    const backPanel = new THREE.Mesh(new THREE.PlaneGeometry(panelW, panelH), backMat);
    backPanel.position.set(0, 0.04 * H + panelH / 2, L - 0.06);
    backPanel.rotation.y = Math.PI;
    backPanel.name = 'back-relief';
    group.add(backPanel);
    (function fillThroneGaps() {
      const gapW = (W - panelW) * 0.5;
      if (gapW < 0.2 * H) return;
      const overlapSide = 0.7 * H;
      const overlapMural = 0.35 * H;
      const span = gapW + overlapSide + overlapMural;
      const naturalH = span * (wallSrc.size.y / Math.max(1e-4, wallSrc.size.z));
      const rows = Math.max(1, Math.ceil((CH + 0.04) / Math.max(0.35 * H, naturalH)));
      const rowH = (CH + 0.05) / rows;
      const sy = (rowH * 1.04) / wallSrc.size.y;
      const sz = span / wallSrc.size.z;
      const sx = Math.min(wallScale * 0.7, (0.7 * H) / Math.max(1e-4, wallSrc.size.x));
      const thick = wallSrc.size.x * sx;
      const z = L - thick * 0.35;
      const mats = [];
      for (let r = 0; r < rows; r++) {
        const y = r * rowH - 0.04;
        [-1, 1].forEach(function (side) {
          const x = side * (panelW * 0.5 - overlapMural + span * 0.5);
          mats.push(pose(x, y, z, Math.PI / 2, sx, sy, sz));
        });
      }
      const fill = new THREE.InstancedMesh(wallSrc.geo, wallMat, mats.length);
      fill.name = 'back-wall-fill';
      fill.frustumCulled = false;
      fill.castShadow = false;
      mats.forEach(function (m, i) { fill.setMatrixAt(i, m); });
      fill.instanceMatrix.needsUpdate = true;
      group.add(fill);
      slotModes.push({ id: 'backFill', count: mats.length, mode: 'real' });
      const seamMat = new THREE.MeshStandardMaterial({ color: 0x4a3824, roughness: 0.72, metalness: 0.18 });
      if (palaceEnv) { seamMat.envMap = palaceEnv; seamMat.envMapIntensity = 0.2; }
      [-1, 1].forEach(function (side) {
        const seam = new THREE.Mesh(new THREE.BoxGeometry(0.28, CH + 0.2, 0.28), seamMat);
        seam.position.set(side * (W / 2), (CH + 0.2) * 0.5 - 0.08, L - 0.12);
        seam.name = 'corner-seal';
        group.add(seam);
      });
    })();

    const tile = 3.15 * H;
    const doorMap = tex.doorWall ? tiledMap(tex.doorWall, (W + wallThick * 2) / tile, (CH + 0.4) / tile) : null;
    if (doorMap) doorMap.anisotropy = aniso.v;
    const southMat = new THREE.MeshStandardMaterial({
      map: doorMap, color: doorMap ? 0xfff1d4 : 0x2a241e,
      roughness: 0.58, metalness: 0.22
    });
    if (palaceEnv) { southMat.envMap = palaceEnv; southMat.envMapIntensity = 0.42; }
    const southWall = new THREE.Mesh(new THREE.BoxGeometry(W + wallThick * 2, CH + 0.45, 0.28), southMat);
    southWall.position.set(0, (CH + 0.45) * 0.5 - 0.08, 0.02);
    southWall.name = 'south-wall';
    southWall.receiveShadow = true;
    group.add(southWall);
    if (assets.door && assets.door.scene) {
      const model = assets.door.scene.clone(true);
      model.traverse(function (o) {
        if (!o.isMesh) return;
        o.castShadow = false;
        o.receiveShadow = true;
        o.frustumCulled = true;
        if (o.material) {
          o.material = o.material.clone();
          o.material.side = THREE.DoubleSide;
        }
      });
      const holder = new THREE.Group();
      holder.name = 'entry-door';
      holder.add(model);
      holder.updateMatrixWorld(true);
      let box = new THREE.Box3().setFromObject(holder);
      let size = box.getSize(new THREE.Vector3());
      if (size.z > size.x) {
        model.rotation.y = Math.PI / 2;
        holder.updateMatrixWorld(true);
        box = new THREE.Box3().setFromObject(holder);
        size = box.getSize(new THREE.Vector3());
      }
      const fitW = Math.max(1.2, portal.width);
      const fitH = Math.min(CH * 0.78, fitW * (size.y / Math.max(0.01, size.x)));
      const s = Math.min(fitW / Math.max(0.01, size.x), fitH / Math.max(0.01, size.y));
      holder.scale.setScalar(s);
      holder.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(holder);
      holder.position.x -= (box.min.x + box.max.x) * 0.5;
      holder.position.y -= box.min.y;
      holder.position.z += 0.28 - box.min.z;
      group.add(holder);
      slotModes.push({ id: 'entryDoor', count: 1, mode: 'real' });
    } else {
      console.warn('مجسم الباب غير موجود — فتحة الدخول مغلقة بجدار فقط');
    }

    const ceilOver = wallThick + 0.4 * H;
    const ceilSpanX = W + ceilOver * 2;
    const ceilSpanZ = L + 0.7 * H;
    const ceilMap = tex.ceiling.clone();
    srgb(ceilMap);
    ceilMap.wrapS = ceilMap.wrapT = THREE.RepeatWrapping;
    const ceilTile = 4.2 * H;
    ceilMap.repeat.set(ceilSpanX / ceilTile, ceilSpanZ / ceilTile);
    const ceiling = plane(ceilSpanX, ceilSpanZ, CH, ceilMap, 0, L / 2);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = CH - 0.22;
    ceiling.name = 'ceiling';
    ceiling.material.color = new THREE.Color(0xffffff);
    ceiling.material.roughness = 0.62;
    ceiling.material.metalness = 0.16;
    ceiling.material.emissive = new THREE.Color(0x3a2a16);
    ceiling.material.emissiveIntensity = 0.08;
    group.add(ceiling);
    const corniceMat = new THREE.MeshStandardMaterial({ color: 0x8d6840, roughness: 0.62, metalness: 0.28 });
    if (palaceEnv) { corniceMat.envMap = palaceEnv; corniceMat.envMapIntensity = 0.3; }
    const beamH = 0.26 * H;
    const beamT = 0.34 * H;
    function cornice(w, d, x, z) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, beamH, d), corniceMat);
      m.position.set(x, CH - beamH * 0.42, z);
      m.name = 'cornice';
      group.add(m);
    }
    cornice(W + wallThick, beamT, 0, beamT * 0.2);
    cornice(W + wallThick, beamT, 0, L - beamT * 0.2);
    cornice(beamT, L, -W / 2 + beamT * 0.12, L / 2);
    cornice(beamT, L, W / 2 - beamT * 0.12, L / 2);
    mark('phase ceiling');

    const lionSrc = prepMesh(assets.lion);
    const lionLod = prepMesh(assets.lionLod) || lionSrc;
    if (!lionSrc) throw new Error('نموذج الأسد بلا شبكة');
    const lionMat = palaceMat(lionSrc.material);
    const lionMatrices = [];
    const lionLocals = [];
    function addLion(x, y, z, scale, rot, name) {
      lionMatrices.push(pose(x, y, z, rot, scale, scale, scale));
      lionLocals.push(new THREE.Vector3(x, y + lionSrc.size.y * scale * 0.5, z));
      const sx = lionSrc.size.x * scale * 0.5;
      const sz = lionSrc.size.z * scale * 0.5;
      const swap = Math.abs(Math.sin(rot)) > 0.7;
      const hx = swap ? sz : sx;
      const hz = swap ? sx : sz;
      const hy = lionSrc.size.y * scale;
      const box = { name: name, min: new THREE.Vector3(x - hx, y, z - hz), max: new THREE.Vector3(x + hx, y + hy, z + hz) };
      pendingWatch.push(box);
      extras.push({ min: box.min.clone(), max: box.max.clone() });
    }
    const lionH = 4.25;
    const lionS = lionH / Math.max(1e-4, lionSrc.size.y);
    const lionLen = lionSrc.size.z * lionS;
    const carpetHalf = CONFIG.carpetWidthH * H * 0.5;
    const lionCenterX = carpetHalf + 0.42 * H + lionLen * 0.5;
    const lionZ = stairFootZ - 1.2 * H;
    [-1, 1].forEach(function (side) {
      addLion(side * lionCenterX, 0, lionZ, lionS, side < 0 ? Math.PI / 2 : -Math.PI / 2, 'lion');
    });
    const smallS = 2.2 / Math.max(1e-4, lionSrc.size.y);
    [-1, 1].forEach(function (side) {
      addLion(side * 1.65 * H, topY, throneZ + 0.22 * H, smallS, Math.PI, 'lionSmall');
    });
    addLOD(lionSrc.geo, lionMat, lionLod.geo === lionSrc.geo ? lionSrc.geo.clone() : lionLod.geo, lionMat, lionMatrices, lionLocals, 9);
    slotModes.push({ id: 'lion', count: 2, mode: 'real' });
    slotModes.push({ id: 'lionSmall', count: 2, mode: 'real' });

    const brzSrc = prepMesh(assets.brazier);
    const brzLod = prepMesh(assets.brazierLod) || brzSrc;
    if (!brzSrc) throw new Error('نموذج المباخر بلا شبكة');
    const brzMat = palaceMat(brzSrc.material);
    const brzMatrices = [];
    const brzLocals = [];
    function addBrazier(x, z, y, targetMeters, intensity, rot) {
      const s = targetMeters / Math.max(1e-4, brzSrc.size.y);
      brzMatrices.push(pose(x, y, z, rot || 0, s, s, s));
      brzLocals.push(new THREE.Vector3(x, y + targetMeters * 0.5, z));
      const r = Math.max(brzSrc.size.x, brzSrc.size.z) * s * 0.5;
      extras.push({ min: new THREE.Vector3(x - r, y, z - r), max: new THREE.Vector3(x + r, y + targetMeters, z + r) });
      pendingWatch.push({ name: 'brazier', min: new THREE.Vector3(x - r, y, z - r), max: new THREE.Vector3(x + r, y + targetMeters, z + r) });
      fireList.push({ x: x, y: y + targetMeters * 0.66, z: z, intensity: intensity, seed: fireList.length * 1.7 + 0.2 });
    }
    [4.2, 9.0, 13.8, 18.6].forEach(function (zH) {
      [-1, 1].forEach(function (side) {
        addBrazier(side * 2.2 * H, zH * H, 0, 3.05, 1.55, side < 0 ? Math.PI / 2 : -Math.PI / 2);
      });
    });
    [-1, 1].forEach(function (side) {
      const rot = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      addBrazier(side * (stairOuter + 0.55 * H), stairFootZ - 0.35 * H, 0, 3.25, 1.75, rot);
      addBrazier(side * 2.15 * H, platformFrontZ + 0.55 * H, topY, 2.55, 1.4, rot);
    });
    addLOD(brzSrc.geo, brzMat, brzLod.geo === brzSrc.geo ? brzSrc.geo.clone() : brzLod.geo, brzMat, brzMatrices, brzLocals, 7);
    slotModes.push({ id: 'brazier', count: brzMatrices.length, mode: 'real' });

    function splitProps(gltf) {
      const parts = [];
      if (!gltf || !gltf.scene) return parts;
      gltf.scene.updateMatrixWorld(true);
      const meshes = [];
      gltf.scene.traverse(function (o) { if (o.isMesh) meshes.push(o); });
      if (!meshes.length) return parts;
      if (meshes.length > 2) {
        meshes.forEach(function (o, i) {
          const geo = o.geometry.clone();
          geo.applyMatrix4(o.matrixWorld);
          recenterGeo(geo);
          parts.push({ geo: geo, size: geoSize(geo), material: o.material, name: o.name || ('part' + i) });
        });
        return parts;
      }
      const mesh = meshes[0];
      const src = mesh.geometry;
      const index = src.index;
      const posAttr = src.attributes.position;
      if (!index || !posAttr) return parts;
      const nrm = src.attributes.normal;
      const uv = src.attributes.uv;
      const ntri = index.count / 3;
      const voxel = 0.012;
      const parent = new Uint32Array(ntri);
      for (let i = 0; i < ntri; i++) parent[i] = i;
      function find(a) {
        while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
        return a;
      }
      function union(a, b) {
        const ra = find(a), rb = find(b);
        if (ra !== rb) parent[rb] = ra;
      }
      const cells = new Map();
      const v = new THREE.Vector3();
      const mw = mesh.matrixWorld;
      for (let t = 0; t < ntri; t++) {
        let sx = 0, sy = 0, sz = 0;
        for (let k = 0; k < 3; k++) {
          v.fromBufferAttribute(posAttr, index.getX(t * 3 + k)).applyMatrix4(mw);
          sx += v.x; sy += v.y; sz += v.z;
        }
        const key = Math.floor(sx / 3 / voxel) + ',' + Math.floor(sy / 3 / voxel) + ',' + Math.floor(sz / 3 / voxel);
        const list = cells.get(key);
        if (list) list.push(t);
        else cells.set(key, [t]);
      }
      cells.forEach(function (tris, key) {
        for (let i = 1; i < tris.length; i++) union(tris[0], tris[i]);
        const bits = key.split(',');
        const x = parseInt(bits[0], 10), y = parseInt(bits[1], 10), z = parseInt(bits[2], 10);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              if (!dx && !dy && !dz) continue;
              const nb = cells.get((x + dx) + ',' + (y + dy) + ',' + (z + dz));
              if (nb) union(tris[0], nb[0]);
            }
          }
        }
      });
      const groups = new Map();
      for (let t = 0; t < ntri; t++) {
        const r = find(t);
        const g = groups.get(r);
        if (g) g.push(t);
        else groups.set(r, [t]);
      }
      let pi = 0;
      groups.forEach(function (tris) {
        if (tris.length < 40) return;
        const mapV = new Map();
        const positions = [];
        const normals = [];
        const uvs = [];
        const indices = [];
        function add(vi) {
          let n = mapV.get(vi);
          if (n == null) {
            n = positions.length / 3;
            mapV.set(vi, n);
            v.fromBufferAttribute(posAttr, vi).applyMatrix4(mw);
            positions.push(v.x, v.y, v.z);
            if (nrm) {
              v.fromBufferAttribute(nrm, vi).transformDirection(mw);
              normals.push(v.x, v.y, v.z);
            }
            if (uv) uvs.push(uv.getX(vi), uv.getY(vi));
          }
          indices.push(n);
        }
        tris.forEach(function (t) {
          add(index.getX(t * 3));
          add(index.getX(t * 3 + 1));
          add(index.getX(t * 3 + 2));
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        if (normals.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        else geo.computeVertexNormals();
        if (uvs.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(indices);
        recenterGeo(geo);
        const size = geoSize(geo);
        parts.push({ geo: geo, size: size, material: mesh.material, name: 'piece' + (pi++) });
      });
      return parts;
    }
    let propParts = [];
    try { propParts = splitProps(assets.props); }
    catch (propErr) { console.warn('فصل الأغراض فشل', propErr); note('props split ' + (propErr && propErr.message)); }
    note('props parts=' + propParts.length);
    const propMat = propParts.length ? palaceMat(propParts[0].material) : null;
    function dropProp(part, x, z, rot, targetH, y) {
      if (!part) return;
      y = y || 0;
      const s = targetH / Math.max(1e-4, part.size.y);
      const mesh = new THREE.Mesh(part.geo, propMat);
      mesh.position.set(x, y, z);
      mesh.rotation.y = rot || 0;
      mesh.scale.setScalar(s);
      mesh.name = 'prop-real';
      group.add(mesh);
      const sx = part.size.x * s * 0.5;
      const sz = part.size.z * s * 0.5;
      const swap = Math.abs(Math.sin(rot || 0)) > 0.7;
      const hx = swap ? sz : sx;
      const hz = swap ? sx : sz;
      extras.push({ min: new THREE.Vector3(x - hx, y, z - hz), max: new THREE.Vector3(x + hx, y + targetH, z + hz) });
    }
    function roleOf(size) {
      const thin = Math.min(size.x, size.z);
      const wide = Math.max(size.x, size.z);
      const tall = Math.max(size.y, wide);
      if (thin / tall < 0.26 && size.y > thin * 2.2) return 'banner';
      if (size.y / Math.max(1e-4, wide) < 0.62) return 'low';
      return 'vessel';
    }
    function splitBanner(part) {
      const size = part.size;
      const flat = Math.min(size.x, size.z) / Math.max(size.x, size.y, size.z);
      if (flat > 0.26) return [part];
      const axis = size.x < size.z ? 2 : 0;
      const geo = part.geo;
      const pos = geo.attributes.position;
      const index = geo.index;
      if (!index) return [part];
      const ntri = index.count / 3;
      let min = Infinity, max = -Infinity;
      const cents = new Float32Array(ntri);
      const read = axis === 0 ? function (i) { return pos.getX(i); } : (axis === 1 ? function (i) { return pos.getY(i); } : function (i) { return pos.getZ(i); });
      for (let t = 0; t < ntri; t++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += read(index.getX(t * 3 + k));
        cents[t] = s / 3;
        if (cents[t] < min) min = cents[t];
        if (cents[t] > max) max = cents[t];
      }
      const bins = 16;
      const hist = new Array(bins).fill(0);
      const span = Math.max(1e-6, max - min);
      for (let t = 0; t < ntri; t++) hist[Math.min(bins - 1, Math.floor((cents[t] - min) / span * bins))]++;
      let gap = 6, gapV = Infinity;
      for (let b = 5; b <= 10; b++) if (hist[b] < gapV) { gapV = hist[b]; gap = b; }
      const avg = (hist[Math.max(0, gap - 1)] + hist[Math.min(bins - 1, gap + 1)]) * 0.5;
      if (!(gapV < avg * 0.4 && avg > 8)) return [part];
      const cut = min + (gap + 0.5) / bins * span;
      function take(side) {
        const mapV = new Map();
        const positions = [], normals = [], uvs = [], indices = [];
        const nrm = geo.attributes.normal, uv = geo.attributes.uv;
        const v = new THREE.Vector3();
        function add(vi) {
          let n = mapV.get(vi);
          if (n == null) {
            n = positions.length / 3;
            mapV.set(vi, n);
            v.fromBufferAttribute(pos, vi);
            positions.push(v.x, v.y, v.z);
            if (nrm) { v.fromBufferAttribute(nrm, vi); normals.push(v.x, v.y, v.z); }
            if (uv) uvs.push(uv.getX(vi), uv.getY(vi));
          }
          indices.push(n);
        }
        for (let t = 0; t < ntri; t++) {
          if (side < 0 ? cents[t] < cut : cents[t] >= cut) {
            add(index.getX(t * 3)); add(index.getX(t * 3 + 1)); add(index.getX(t * 3 + 2));
          }
        }
        if (indices.length < 30) return null;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        if (normals.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        if (uvs.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        g.setIndex(indices);
        recenterGeo(g);
        return { geo: g, size: geoSize(g), material: part.material, name: part.name + (side < 0 ? 'L' : 'R') };
      }
      const a = take(-1), b = take(1);
      return a && b ? [a, b] : [part];
    }
    const banners = [], lows = [], vessels = [];
    propParts.forEach(function (part) {
      const role = roleOf(part.size);
      if (role === 'banner') splitBanner(part).forEach(function (b) { banners.push(b); });
      else if (role === 'low') lows.push(part);
      else vessels.push(part);
    });
    lows.sort(function (a, b) { return (b.size.x * b.size.z) - (a.size.x * a.size.z); });
    vessels.sort(function (a, b) { return b.size.y - a.size.y; });
    const couch = lows[0] || null;
    const chest = lows[1] || lows[0] || null;
    const vase = vessels[0] || null;
    const jar = vessels[1] || vessels[0] || null;
    const pot = vessels.length > 2 ? vessels[vessels.length - 1] : jar;
    function seatOf(part, height) {
      const pos = part.geo.attributes.position;
      const ys = [];
      const step = Math.max(1, Math.floor(pos.count / 700));
      for (let i = 0; i < pos.count; i += step) {
        if (Math.abs(pos.getX(i)) > part.size.x * 0.3 || Math.abs(pos.getZ(i)) > part.size.z * 0.3) continue;
        ys.push(pos.getY(i));
      }
      if (!ys.length) return height * 0.74;
      ys.sort(function (a, b) { return a - b; });
      const y = ys[Math.min(ys.length - 1, Math.floor(ys.length * 0.78))];
      return Math.max(0.2, (y / Math.max(1e-4, part.size.y)) * height - 0.02);
    }
    function fitted(part, height) {
      const s = height / Math.max(1e-4, part.size.y);
      const longIsX = part.size.x >= part.size.z;
      return {
        along: (longIsX ? part.size.x : part.size.z) * s,
        across: (longIsX ? part.size.z : part.size.x) * s,
        rot: longIsX ? Math.PI / 2 : 0
      };
    }
    if (couch && chest) {
      const stations = 3;
      const z0 = 4.2 * H;
      const z1 = Math.max(z0 + 8, stairFootZ - 1.7 * H);
      const couchH = 1.08, chestH = 1.2, vaseH = 1.9, jarH = 0.78, potH = 0.46;
      const couchFit = fitted(couch, couchH);
      const chestFit = fitted(chest, chestH);
      const carpetEdge = CONFIG.carpetWidthH * H * 0.5;
      for (let s = 0; s < stations; s++) {
        const zc = stations === 1 ? (z0 + z1) * 0.5 : z0 + (z1 - z0) * (s / (stations - 1));
        [-1, 1].forEach(function (side) {
          const couchX = side * (carpetEdge + couchFit.across * 0.5 + 0.42);
          const gap = couchFit.along * 0.58;
          dropProp(couch, couchX, zc - gap, side < 0 ? couchFit.rot : -couchFit.rot, couchH, 0);
          dropProp(couch, couchX, zc + gap, side < 0 ? couchFit.rot : -couchFit.rot, couchH, 0);
          const chestX = side * (Math.abs(couchX) + couchFit.across * 0.5 + 0.55 + chestFit.across * 0.5);
          dropProp(chest, chestX, zc, side < 0 ? chestFit.rot : -chestFit.rot, chestH, 0);
          if (vase) {
            const vaseFit = fitted(vase, vaseH);
            const vaseX = side * (Math.abs(chestX) + chestFit.across * 0.5 + vaseFit.across * 0.5 + 0.28);
            dropProp(vase, vaseX, zc - chestFit.along * 0.15, 0, vaseH, 0);
          }
          if (jar) dropProp(jar, chestX, zc - chestFit.along * 0.12, 0, jarH, seatOf(chest, chestH));
          if (pot && pot !== jar) dropProp(pot, chestX, zc + chestFit.along * 0.12, 0, potH, seatOf(chest, chestH));
        });
      }
      slotModes.push({ id: 'furniture', count: stations * 2, mode: 'arranged' });
    }
    (function hangBanners() {
      const flags = banners.length ? banners : [];
      if (!flags.length) return;
      const left = flags[0];
      const right = flags[1] || flags[0];
      const bannerH = Math.max(4.2, Math.min(CH * 0.58, CH - topY - 0.7));
      const bottom = topY + 0.1;
      const x = 2.45 * H;
      const z = L - 0.48;
      function hang(part, px) {
        const thinIsX = part.size.x <= part.size.z;
        const face = thinIsX ? part.size.z : part.size.x;
        const sH = bannerH / Math.max(1e-4, part.size.y);
        const sFace = 1.65 / Math.max(1e-4, face);
        const sThin = sH;
        const mesh = new THREE.Mesh(part.geo, propMat);
        if (thinIsX) mesh.scale.set(sThin, sH, sFace);
        else mesh.scale.set(sFace, sH, sThin);
        mesh.rotation.y = thinIsX ? Math.PI / 2 : 0;
        mesh.position.set(px, bottom, z);
        mesh.name = 'throne-banner';
        group.add(mesh);
      }
      hang(left, -x);
      hang(right, x);
      slotModes.push({ id: 'banner', count: 2, mode: 'throne-wall' });
    })();
    if (!propParts.length) slotModes.push({ id: 'propsSheet', count: 0, mode: 'missing' });

    const hemi = new THREE.HemisphereLight(0xffe2b8, 0x5c3a28, 0.78);
    group.add(hemi);
    const fill = new THREE.AmbientLight(0xffd0a4, 0.12);
    group.add(fill);
    const wash = new THREE.DirectionalLight(0xfff0d0, 0.5);
    wash.position.set(-0.2 * H, CH * 0.86, L * 0.18);
    wash.target.position.set(0, CH * 0.28, L * 0.66);
    wash.castShadow = false;
    group.add(wash);
    group.add(wash.target);
    lights = [];
    for (let i = 0; i < CONFIG.lightCount; i++) {
      const pl = new THREE.PointLight(0xffb15a, 2.15, 16 * H, 2);
      pl.castShadow = false;
      pl.position.set(0, 2.2 * H, L * 0.45);
      group.add(pl);
      lights.push(pl);
    }
    console.info('قاعة', n, 'وحدات، ارتفاع', (CH / H).toFixed(2), 'H، مباخر', brzMatrices.length, 'أقواس', CONFIG.PASSAGES.length);

    function buildFires() {
      if (!fireList.length) return;
      const layers = [
        { w: 0.16 * H, h: 0.32 * H, seed: 0 },
        { w: 0.26 * H, h: 0.48 * H, seed: 2.3 },
        { w: 0.36 * H, h: 0.62 * H, seed: 5.1 }
      ];
      const count = fireList.length * layers.length;
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.translate(0, 0.5, 0);
      const seeds = new Float32Array(count);
      const matrices = new Array(count);
      let si = 0;
      layers.forEach(function (layer) {
        fireList.forEach(function (f, i) {
          seeds[si] = f.seed + layer.seed;
          matrices[si] = pose(f.x, f.y, f.z, 0, layer.w, layer.h, 1);
          si++;
        });
      });
      geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
      const fireMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: FIRE_VS,
        fragmentShader: FIRE_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      const fireMesh = new THREE.InstancedMesh(geo, fireMat, count);
      fireMesh.name = 'fire';
      fireMesh.frustumCulled = false;
      fireMesh.renderOrder = 2;
      matrices.forEach(function (m, i) { fireMesh.setMatrixAt(i, m); });
      fireMesh.instanceMatrix.needsUpdate = true;
      group.add(fireMesh);
      fireMats.push(fireMat);

      const ggeo = new THREE.PlaneGeometry(1, 1);
      const gseeds = new Float32Array(fireList.length);
      ggeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(gseeds, 1));
      const gmat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: GLOW_VS,
        fragmentShader: GLOW_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      const glowMesh = new THREE.InstancedMesh(ggeo, gmat, fireList.length);
      glowMesh.name = 'fire-glow';
      glowMesh.frustumCulled = false;
      glowMesh.renderOrder = 1;
      fireList.forEach(function (f, i) {
        gseeds[i] = f.seed;
        glowMesh.setMatrixAt(i, pose(f.x, f.y + 0.08 * H, f.z, 0, 0.55 * H, 0.55 * H, 1));
      });
      glowMesh.instanceMatrix.needsUpdate = true;
      group.add(glowMesh);
      fireMats.push(gmat);

      const per = 8;
      const en = fireList.length * per;
      const epos = new Float32Array(en * 3);
      const eseed = new Float32Array(en);
      fireList.forEach(function (f, fi) {
        for (let k = 0; k < per; k++) {
          const ei = fi * per + k;
          epos[ei * 3] = f.x;
          epos[ei * 3 + 1] = f.y;
          epos[ei * 3 + 2] = f.z;
          eseed[ei] = (fi * 0.17 + k * 0.13) % 1;
        }
      });
      const egeo = new THREE.BufferGeometry();
      egeo.setAttribute('position', new THREE.BufferAttribute(epos, 3));
      egeo.setAttribute('aSeed', new THREE.BufferAttribute(eseed, 1));
      const emat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: EMBER_VS,
        fragmentShader: EMBER_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const embers = new THREE.Points(egeo, emat);
      embers.name = 'embers';
      embers.frustumCulled = false;
      embers.renderOrder = 3;
      group.add(embers);
      fireMats.push(emat);

      fireMats.forEach(function (m) {
        if (m.uniforms && m.uniforms.uTime) m.uniforms.uTime.value = 1.15;
      });
      const sorted = fireList.filter(function (f) { return !f._wing; }).sort(function (a, b) { return a.z - b.z || a.x - b.x; });
      const ly = Math.min(CH * 0.46, 3.1 * H);
      for (let i = 0; i < lights.length; i++) {
        const f = sorted[Math.min(sorted.length - 1, Math.round(i * (sorted.length - 1) / Math.max(1, lights.length - 1)))];
        lights[i].position.set(f.x, ly, f.z);
        lights[i].intensity = 2.15;
        lights[i].distance = 16 * H;
      }
    }

    const TYPE_COLOR = {
      lionWinged: 0xd4652f, pedestal: 0xa0845c, brazier: 0xe07a2f, lantern: 0xf0c14a,
      banner: 0x2f6fbe, statueAlcove: 0xc49a7a, tableLow: 0x8d6b4a, benchCushion: 0xa33b48, vase: 0x3e7d9a,
      daybed: 0x8a3a34, lampStand: 0xe0b15a
    };
    const matCache = {};
    function phMat(type, part) {
      const key = (debugOn() ? 'd:' : 'n:') + type + ':' + (part || '');
      if (matCache[key]) return matCache[key];
      let color = 0xc6ae86, rough = 0.62, metal = 0.16;
      if (debugOn()) color = TYPE_COLOR[type] || 0xff00aa;
      else if (type === 'banner' && part === 'disc') { color = 0xe6c36a; metal = 0.45; rough = 0.4; }
      else if (type === 'banner') { color = 0x163e78; metal = 0.02; rough = 0.82; }
      else if (type === 'brazier') { color = part === 'bowl' ? 0xc4923e : 0x4a3b32; metal = 0.55; rough = 0.42; }
      else if (type === 'lantern') { color = 0xc4923e; metal = 0.6; rough = 0.38; }
      else if (part === 'gold' || part === 'cushion') { color = part === 'cushion' ? 0x8a3a34 : 0xd4b06a; metal = 0.35; }
      else if (type === 'vase') { color = 0xb9925a; metal = 0.28; }
      else if (type === 'daybed') { color = 0x6a3a32; metal = 0.08; rough = 0.72; }
      else if (type === 'lampStand') { color = 0xc4923e; metal = 0.55; rough = 0.4; }
      const m = new THREE.MeshStandardMaterial({ color: color, roughness: rough, metalness: metal });
      matCache[key] = m;
      return m;
    }
    function mergeParts(parts) {
      let vcount = 0, icount = 0;
      parts.forEach(function (g) {
        const pc = g.attributes.position.count;
        vcount += pc;
        icount += g.index ? g.index.count : pc;
      });
      const pos = new Float32Array(vcount * 3);
      const nrm = new Float32Array(vcount * 3);
      const idx = new Uint32Array(icount);
      let vo = 0, io = 0;
      parts.forEach(function (g) {
        const p = g.attributes.position;
        const n = g.attributes.normal;
        const base = vo;
        for (let i = 0; i < p.count; i++) {
          pos[(vo + i) * 3] = p.getX(i);
          pos[(vo + i) * 3 + 1] = p.getY(i);
          pos[(vo + i) * 3 + 2] = p.getZ(i);
          if (n) {
            nrm[(vo + i) * 3] = n.getX(i);
            nrm[(vo + i) * 3 + 1] = n.getY(i);
            nrm[(vo + i) * 3 + 2] = n.getZ(i);
          }
        }
        vo += p.count;
        if (g.index) {
          for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + base;
        } else {
          for (let i = 0; i < p.count; i++) idx[io++] = base + i;
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      return g;
    }
    function xformBox(w, h, d, x, y, z, rotZ, rotY) {
      const g = new THREE.BoxGeometry(w, h, d);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY || 0, rotZ || 0));
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)));
      return g;
    }
    function fitGeo(geo, targetH) {
      geo.computeBoundingBox();
      const b = geo.boundingBox;
      const h = Math.max(0.001, b.max.y - b.min.y);
      const cx = (b.max.x + b.min.x) / 2;
      const cz = (b.max.z + b.min.z) / 2;
      geo.translate(-cx, -b.min.y, -cz);
      const s = targetH / h;
      geo.scale(s, s, s);
      return geo;
    }
    function lionGeo(h) {
      return fitGeo(mergeParts([
        xformBox(0.42 * h, 0.32 * h, 0.72 * h, 0, 0.36 * h, 0, 0, 0),
        xformBox(0.3 * h, 0.24 * h, 0.26 * h, 0, 0.5 * h, 0.36 * h, 0, 0),
        xformBox(0.22 * h, 0.2 * h, 0.22 * h, 0, 0.66 * h, 0.5 * h, 0, 0),
        xformBox(0.08 * h, 0.46 * h, 0.55 * h, -0.28 * h, 0.62 * h, -0.02 * h, 0.7, 0.2),
        xformBox(0.08 * h, 0.46 * h, 0.55 * h, 0.28 * h, 0.62 * h, -0.02 * h, -0.7, -0.2)
      ]), h);
    }
    function pedestalGeo(h) {
      return fitGeo(mergeParts([
        xformBox(1.05 * h, 0.22 * h, 0.9 * h, 0, 0.11 * h, 0),
        xformBox(0.78 * h, 0.78 * h, 0.66 * h, 0, 0.6 * h, 0)
      ]), h);
    }
    function brazierGeo(h) {
      const foot = new THREE.CylinderGeometry(0.22 * h, 0.26 * h, 0.1 * h, 8);
      foot.translate(0, 0.05 * h, 0);
      const stem = new THREE.CylinderGeometry(0.07 * h, 0.09 * h, 0.48 * h, 6);
      stem.translate(0, 0.34 * h, 0);
      const bowl = new THREE.CylinderGeometry(0.32 * h, 0.2 * h, 0.2 * h, 8);
      bowl.translate(0, 0.64 * h, 0);
      return fitGeo(mergeParts([foot, stem, bowl]), h);
    }
    function lanternGeo(h) {
      const body = new THREE.CylinderGeometry(0.16 * h, 0.18 * h, 0.55 * h, 6);
      body.translate(0, 0.32 * h, 0);
      const cap = new THREE.ConeGeometry(0.2 * h, 0.22 * h, 6);
      cap.translate(0, 0.68 * h, 0);
      return fitGeo(mergeParts([body, cap]), h);
    }
    function statueGeo(h) {
      const base = new THREE.BoxGeometry(0.46 * h, 0.12 * h, 0.4 * h);
      base.translate(0, 0.06 * h, 0);
      const body = new THREE.CylinderGeometry(0.12 * h, 0.16 * h, 0.48 * h, 6);
      body.translate(0, 0.38 * h, 0);
      const head = new THREE.SphereGeometry(0.12 * h, 8, 6);
      head.translate(0, 0.72 * h, 0);
      return fitGeo(mergeParts([base, body, head]), h);
    }
    function tableGeo(h) {
      const top = new THREE.BoxGeometry(1.7 * h, 0.12 * h, 0.9 * h);
      top.translate(0, 0.9 * h, 0);
      const parts = [top];
      [[-0.7, -0.32], [0.7, -0.32], [-0.7, 0.32], [0.7, 0.32]].forEach(function (p) {
        const leg = new THREE.BoxGeometry(0.1 * h, 0.84 * h, 0.1 * h);
        leg.translate(p[0] * h, 0.42 * h, p[1] * h);
        parts.push(leg);
      });
      return fitGeo(mergeParts(parts), h);
    }
    function benchGeo(h) {
      const seat = new THREE.BoxGeometry(0.7 * h, 0.16 * h, 1.5 * h);
      seat.translate(0, 0.55 * h, 0);
      const parts = [seat];
      [[-0.24, -0.55], [0.24, -0.55], [-0.24, 0.55], [0.24, 0.55]].forEach(function (p) {
        const leg = new THREE.BoxGeometry(0.1 * h, 0.48 * h, 0.1 * h);
        leg.translate(p[0] * h, 0.24 * h, p[1] * h);
        parts.push(leg);
      });
      return fitGeo(mergeParts(parts), h);
    }
    function cushionGeo(h) {
      const g = new THREE.BoxGeometry(h * 0.95, h * 0.1, h * 2.0);
      g.translate(0, h + h * 0.05, 0);
      return g;
    }
    function vaseGeo(h) {
      const belly = new THREE.CylinderGeometry(0.22 * h, 0.16 * h, 0.55 * h, 8);
      belly.translate(0, 0.32 * h, 0);
      const neck = new THREE.CylinderGeometry(0.1 * h, 0.14 * h, 0.28 * h, 8);
      neck.translate(0, 0.7 * h, 0);
      return fitGeo(mergeParts([belly, neck]), h);
    }
    function clothGeo(h) {
      const g = new THREE.PlaneGeometry(h * (1.2 / 3.5), h);
      g.translate(0, h / 2, 0);
      return g;
    }
    function daybedGeo(h) {
      const base = new THREE.BoxGeometry(h * 1.15, h * 0.28, h * 2.35);
      base.translate(0, h * 0.34, 0);
      const head = new THREE.BoxGeometry(h * 1.15, h * 0.42, h * 0.16);
      head.translate(0, h * 0.62, -h * 1.05);
      const pad = new THREE.BoxGeometry(h * 0.9, h * 0.12, h * 1.7);
      pad.translate(0, h * 0.52, 0.08 * h);
      return fitGeo(mergeParts([base, head, pad]), h);
    }
    function lampStandGeo(h) {
      const foot = new THREE.CylinderGeometry(0.12 * h, 0.14 * h, 0.06 * h, 6);
      foot.translate(0, 0.03 * h, 0);
      const pole = new THREE.CylinderGeometry(0.035 * h, 0.05 * h, 0.78 * h, 6);
      pole.translate(0, 0.42 * h, 0);
      const cup = new THREE.CylinderGeometry(0.11 * h, 0.07 * h, 0.1 * h, 6);
      cup.translate(0, 0.86 * h, 0);
      return fitGeo(mergeParts([foot, pole, cup]), h);
    }
    function discGeo(h) {
      const g = new THREE.CircleGeometry(h * 0.075, 16);
      g.translate(0, h * 0.72, 0.02 * H);
      return g;
    }
    function slotRot(slot, i) {
      if (slot.rotYs && slot.rotYs[i] != null) return slot.rotYs[i];
      return slot.rotY || 0;
    }
    const slotMeshes = {};
    function stamp(slot, geo, material, name) {
      const mesh = new THREE.InstancedMesh(geo, material, slot.positions.length);
      mesh.name = name || ('prop:' + slot.id);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      slot.positions.forEach(function (p, i) {
        dummy.position.set(p[0] * H, p[1] * H, p[2] * H);
        dummy.rotation.set(0, slotRot(slot, i), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
      (slotMeshes[slot.id] || (slotMeshes[slot.id] = [])).push(mesh);
      return mesh;
    }
    const builders = {
      lionWinged: function (slot) { stamp(slot, lionGeo(slot.targetHeightH * H), phMat(slot.type), 'prop:' + slot.id); },
      pedestal: function (slot) { stamp(slot, pedestalGeo(slot.targetHeightH * H), phMat(slot.type), 'prop:' + slot.id); },
      brazier: function (slot) {
        stamp(slot, brazierGeo(slot.targetHeightH * H), phMat(slot.type), 'prop:' + slot.id);
        slot.positions.forEach(function (p) {
          const f = flameSprite();
          f.position.set(p[0] * H, p[1] * H + slot.targetHeightH * H * 0.92, p[2] * H);
          const sc = 0.42 * H;
          f.scale.setScalar(sc);
          f.userData.base = sc;
          f.userData.seed = p[0] * 3 + p[2];
          f.name = 'flame';
          group.add(f);
          flames.push(f);
        });
      },
      lantern: function (slot) {
        const h = slot.targetHeightH * H;
        const yHang = Math.max(0.8 * H, CH - h - 0.85 * H);
        const fake = Object.assign({}, slot, { positions: slot.positions.map(function (p) { return [p[0], yHang / H, p[2]]; }) });
        stamp(fake, lanternGeo(h), phMat(slot.type, 'gold'), 'prop:' + slot.id);
        const chainLen = Math.max(0.2 * H, CH - (yHang + h));
        const chainGeo = new THREE.CylinderGeometry(0.012 * H, 0.012 * H, chainLen, 4);
        chainGeo.translate(0, chainLen / 2, 0);
        const chains = new THREE.InstancedMesh(chainGeo, phMat(slot.type), fake.positions.length);
        chains.name = 'lantern-chain';
        chains.frustumCulled = false;
        fake.positions.forEach(function (p, i) {
          dummy.position.set(p[0] * H, p[1] * H + h, p[2] * H);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          chains.setMatrixAt(i, dummy.matrix);
        });
        chains.instanceMatrix.needsUpdate = true;
        group.add(chains);
        (slotMeshes[slot.id] || (slotMeshes[slot.id] = [])).push(chains);
      },
      banner: function (slot) {
        const h = slot.targetHeightH * H;
        const yHang = Math.max(0.4 * H, CH - h - 0.3 * H);
        const fake = Object.assign({}, slot, { positions: slot.positions.map(function (p) { return [p[0], yHang / H, p[2]]; }) });
        stamp(fake, clothGeo(h), phMat(slot.type), 'prop:' + slot.id);
        stamp(fake, discGeo(h), phMat(slot.type, 'disc'), 'prop:' + slot.id + ':disc');
      },
      statueAlcove: function (slot) { stamp(slot, statueGeo(slot.targetHeightH * H), phMat(slot.type), 'prop:' + slot.id); },
      tableLow: function (slot) { stamp(slot, tableGeo(slot.targetHeightH * H), phMat(slot.type), 'prop:' + slot.id); },
      benchCushion: function (slot) {
        stamp(slot, benchGeo(slot.targetHeightH * H), phMat(slot.type), 'prop:' + slot.id);
        stamp(slot, cushionGeo(slot.targetHeightH * H), phMat(slot.type, 'cushion'), 'prop:' + slot.id + ':cushion');
      },
      vase: function (slot) { stamp(slot, vaseGeo(slot.targetHeightH * H), phMat(slot.type), 'prop:' + slot.id); },
      daybed: function (slot) { stamp(slot, daybedGeo(slot.targetHeightH * H), phMat(slot.type), 'prop:' + slot.id); },
      lampStand: function (slot) {
        const h = slot.targetHeightH * H;
        stamp(slot, lampStandGeo(h), phMat(slot.type, 'gold'), 'prop:' + slot.id);
        slot.positions.forEach(function (p, i) {
          fireList.push({ x: p[0] * H, y: p[1] * H + h * 0.92, z: p[2] * H, intensity: 0.9, seed: 50 + i });
        });
      }
    };
    const labelTex = {};
    function labelSprite(id) {
      if (!labelTex[id]) {
        const c = document.createElement('canvas');
        c.width = 512; c.height = 96;
        const g = c.getContext('2d');
        g.fillStyle = 'rgba(0,0,0,.72)';
        g.fillRect(0, 8, 512, 80);
        g.fillStyle = '#ffe7a8';
        g.font = 'bold 36px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(id, 256, 48);
        const t = new THREE.CanvasTexture(c);
        labelTex[id] = t;
      }
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex[id], transparent: true, depthWrite: false, depthTest: false }));
      s.scale.set(1.7 * H, 0.32 * H, 1);
      s.name = 'label:' + id;
      return s;
    }
    CONFIG.PROPS.forEach(function (slot) {
      if (slot.rotYs && slot.rotYs.length !== slot.positions.length) console.warn('rotYs لا يطابق المواضع', slot.id);
      const gltf = slot.glbPath && assets.propFiles && assets.propFiles[slot.glbPath];
      const buildPh = builders[slot.type] || builders[slot.id];
      if (!buildPh) { console.warn('لا يوجد شكل مؤقت لهذا النوع', slot.type); return; }
      buildPh(slot);
      if (gltf) {
        (slotMeshes[slot.id] || []).forEach(function (m) {
          group.remove(m);
          if (m.geometry && m.geometry.dispose) m.geometry.dispose();
        });
        slot.positions.forEach(function (p, i) {
          const obj = wrapFitted(gltf.scene.clone(true), slot.targetHeightH * H);
          obj.name = 'prop:' + slot.id;
          obj.position.set(p[0] * H, p[1] * H, p[2] * H);
          obj.rotation.y = slotRot(slot, i);
          group.add(obj);
        });
        slotModes.push({ id: slot.id, count: slot.positions.length, mode: 'real' });
      } else {
        if (slot.glbPath) console.warn('الدعامة غير جاهزة، يُبقى الشكل المؤقت', slot.id, slot.glbPath);
        slotModes.push({ id: slot.id, count: slot.positions.length, mode: 'placeholder' });
      }
      if (debugOn()) {
        slot.positions.forEach(function (p) {
          const s = labelSprite(slot.id);
          s.position.set(p[0] * H, p[1] * H + slot.targetHeightH * H + 0.28 * H, p[2] * H);
          group.add(s);
        });
      }
    });

    if (CONFIG.useWings && window.PalaceWings) {
      const tWings = performance.now();
      mark('phase wings start');
      wingRuntime = PalaceWings.build(ctx, {
        width: W, length: L, wallThickness: wallThick, alcoveDepth: 1.15 * H,
        floorY: gy, passages: CONFIG.PASSAGES
      });
      note('wings ' + Math.round(performance.now() - tWings) + 'ms');
      wingRuntime.fires.forEach(function (f) { f._wing = true; fireList.push(f); });
    }
    buildFires();
    if (wingRuntime) {
      ['fire', 'fire-glow', 'embers'].forEach(function (name) {
        const obj = group.children.find(function (ch) { return ch.name === name; });
        if (obj) { group.remove(obj); wingRuntime.root.add(obj); }
      });
    }
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
    [-1, 1].forEach(function (side) {
      if (!CONFIG.useWings) {
        worldBox(new THREE.Vector3(side * (W / 2) - 0.45, 0, 0), new THREE.Vector3(side * (W / 2) + 0.45, CH, L));
        return;
      }
      const cuts = [];
      for (let i = 0; i < 3; i++) if (wingArchOpen(side, i)) {
        const zc = (i + 0.5) * (L / 3);
        cuts.push({ z0: zc - archW / 2, z1: zc + archW / 2 });
      }
      let cursor = 0;
      cuts.forEach(function (cut) {
        if (cut.z0 > cursor) worldBox(new THREE.Vector3(side * (W / 2) - 0.45, 0, cursor), new THREE.Vector3(side * (W / 2) + 0.45, CH, cut.z0));
        worldBox(new THREE.Vector3(side * (W / 2) - 0.45, archH, cut.z0), new THREE.Vector3(side * (W / 2) + 0.45, CH, cut.z1));
        cursor = cut.z1;
      });
      if (cursor < L) worldBox(new THREE.Vector3(side * (W / 2) - 0.45, 0, cursor), new THREE.Vector3(side * (W / 2) + 0.45, CH, L));
    });
    worldBox(new THREE.Vector3(-W / 2, 0, L - 0.45), new THREE.Vector3(W / 2, CH, L + 0.45));
    worldBox(new THREE.Vector3(-W / 2 - 0.3, 0, -0.4), new THREE.Vector3(W / 2 + 0.3, CH, 0.85));
    const hx = stairW / 2;
    worldBox(new THREE.Vector3(-hx - 0.3 * H, 0, platformFrontZ), new THREE.Vector3(-hx + 0.04 * H, topY + H, L));
    worldBox(new THREE.Vector3(hx - 0.04 * H, 0, platformFrontZ), new THREE.Vector3(hx + 0.3 * H, topY + H, L));
    extras.forEach(function (b) { worldBox(b.min, b.max); });
    if (wingRuntime) wingRuntime.colliders.forEach(function (b) {
      colliders.push({
        minx: ox + b.minx, maxx: ox + b.maxx, miny: gy + b.miny, maxy: gy + b.maxy,
        minz: oz + b.minz, maxz: oz + b.maxz, _wing: true
      });
    });
    group.traverse(function (o) {
      if (o.name !== 'throne' && o.name !== 'throne-stand-in') return;
      const b = new THREE.Box3().setFromObject(o);
      b.expandByScalar(-0.05);
      addBox(b.min, b.max);
    });
    const watch = [];
    function watchBox(name, min, max) { watch.push({ name: name, min: min, max: max }); }
    pendingWatch.forEach(function (w) {
      watchBox(w.name, new THREE.Vector3(ox + w.min.x, gy + w.min.y, oz + w.min.z), new THREE.Vector3(ox + w.max.x, gy + w.max.y, oz + w.max.z));
    });
    const tb = new THREE.Box3().setFromObject(throneObj); watchBox('throne', tb.min, tb.max);
    CONFIG.PROPS.forEach(function (slot) {
      if (slot.collider !== 'box' || !slot.colliderSize) return;
      slot.positions.forEach(function (p, i) {
        const ry = slotRot(slot, i);
        const swap = Math.abs(Math.sin(ry)) > 0.7;
        const sx = slot.colliderSize.x * H * 0.5;
        const sz = slot.colliderSize.z * H * 0.5;
        const ex = swap ? sz : sx;
        const ez = swap ? sx : sz;
        const cx = ox + p[0] * H, cy = gy + p[1] * H, cz = oz + p[2] * H;
        const sy = slot.colliderSize.y * H;
        const min = new THREE.Vector3(cx - ex, cy, cz - ez);
        const max = new THREE.Vector3(cx + ex, cy + sy, cz + ez);
        watchBox(slot.id, min, max);
        worldBox(new THREE.Vector3(p[0] * H - ex, p[1] * H, p[2] * H - ez), new THREE.Vector3(p[0] * H + ex, p[1] * H + sy, p[2] * H + ez));
      });
    });
    function allowOverlap(a, b) {
      const pair = [a.name, b.name].sort().join('+');
      if (pair !== 'lion+pedestal' && pair !== 'lionSmall+pedestalThrone') return false;
      const acx = (a.min.x + a.max.x) / 2, acz = (a.min.z + a.max.z) / 2;
      const bcx = (b.min.x + b.max.x) / 2, bcz = (b.min.z + b.max.z) / 2;
      return Math.hypot(acx - bcx, acz - bcz) < 1.35 * H;
    }
    for (let i = 0; i < watch.length; i++) {
      for (let j = i + 1; j < watch.length; j++) {
        const a = watch[i], b = watch[j];
        if (allowOverlap(a, b)) continue;
        if (a.min.x >= b.max.x || b.min.x >= a.max.x || a.min.y >= b.max.y || b.min.y >= a.max.y || a.min.z >= b.max.z || b.min.z >= a.max.z) continue;
        const msg = a.name + '/' + b.name;
        if (overlapNotes.length < 12) overlapNotes.push(msg);
        console.warn('تداخل في القاعة', a.name, b.name);
      }
    }

    group.traverse(function (o) { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    setExteriorVisible(ctx.scene, false);
    if (CONFIG.disposeExteriorAfterEntry) {
      const ext = ctx.scene.getObjectByName('PalaceExterior');
      if (ext) ext.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    }
    if (palaceEnv) {
      group.traverse(function (o) {
        if (!o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(function (m) {
          if (!m.isMeshStandardMaterial || m.envMap) return;
          m.envMap = palaceEnv;
          if (!m.envMapIntensity) m.envMapIntensity = 0.45;
        });
      });
    }
    function geomLoad() {
      let draws = 0, tris = 0;
      group.traverse(function (o) {
        if (!o.visible) return;
        if (o.isSprite || o.isPoints) { draws++; return; }
        if (!o.isMesh || !o.geometry) return;
        draws++;
        const g = o.geometry;
        const t = g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
        tris += t * (o.isInstancedMesh ? o.count : 1);
      });
      return { draws: draws, tris: tris };
    }
    let worst = { draws: 0, tris: 0, at: '—' };
    [[0, 3], [0, 12], [0, 20], [2.4, 20], [0, PLAN.throneZ]].forEach(function (s) {
      updateLODs({ position: new THREE.Vector3(portal.x + s[0] * H, gy + 1.6 * H, portal.frontZ + s[1] * H) });
      const gstat = geomLoad();
      if (gstat.tris > worst.tris) worst = { draws: gstat.draws, tris: gstat.tris, at: s[0] + ',' + s[1] };
    });
    if (ctx.camera) updateLODs(ctx.camera);
    const live = geomLoad();
    let blockedZ = -1;
    for (let z = 0.6 * H; z < stairFootZ - 0.2 * H; z += 0.45 * H) {
      if (blocks(ox, oz + z)) { blockedZ = z; break; }
    }
    note('hall built points=' + lights.length + ' hemi=1 draws~' + live.draws + ' tris~' + Math.round(live.tris) + ' worst~' + Math.round(worst.tris) + '@' + worst.at + ' passages=' + CONFIG.PASSAGES.length + ' centerBlock=' + (blockedZ < 0 ? 'clear' : blockedZ.toFixed(1)));
  }

  function aimCamera(ctx, snap) {
    const hp = ctx.hero.position;
    if (hallBuilt && colliders.length) {
      // ENTRANCE SHOT. The hero spawns ~1 m in front of the hall's inner front wall,
      // between the two open door leaves, so a chase camera was crushed against that
      // wall (≈1 m behind his head) and shook as the old lerp + collision clamp
      // fought every frame; any side angle is blocked by a door leaf.
      // Instead: a fixed camera inside the hall, facing him, framed by the doorway.
      // He walks in towards it, then the shot cuts cleanly to the normal follow
      // camera straight behind him (same collision rig as play, so no hand-off jump).
      if (state === 'SETTLE' || state === 'DONE') {
        followCamera(ctx.camera, ctx.hero, 0, FOLLOW_PITCH, FOLLOW_DIST, lastDt, !entryCut, true);
        entryCut = true;
        return;
      }
      if (snap || !entryCam) {
        entryCut = false;
        const px = hp.x, py = hp.y + CAM_PIVOT, pz = hp.z;
        const cp = Math.cos(ENTRY_PITCH), uy = Math.sin(ENTRY_PITCH), uz = cp;
        let d = castCamera(px, py, pz, 0, uy, uz, ENTRY_DIST, hp.y, false);
        d = Math.min(d, castCamera(px, py, pz, 0, uy, uz, d, hp.y, true));
        entryCam = new THREE.Vector3(px, py + uy * d, pz + uz * d);
      }
      ctx.camera.position.copy(entryCam);
      ctx.camera.lookAt(hp.x, hp.y + ENTRY_LOOK, hp.z);
      rig.fresh = true; // already collision-checked: nothing else may move this shot
      return;
    }
    const goal = 6.2;
    if (snap) camBack = 3.5;
    else camBack += (goal - camBack) * (1 - Math.exp(-Math.max(0.001, lastDt) * 0.62));
    const dest = new THREE.Vector3(hp.x, hp.y + 1.75, hp.z - camBack);
    if (snap || !ctx.camera.position.distanceTo(dest)) ctx.camera.position.copy(dest);
    else ctx.camera.position.lerp(dest, 1 - Math.exp(-Math.max(0.001, lastDt) * 2.2));
    ctx.camera.lookAt(hp.x, hp.y + 1.28, hp.z + 12);
  }

  function placeHero(ctx) {
    const spawnZ = ctx.portal.frontZ + 1.05 * H;
    ctx.hero.position.set(ctx.portal.x, floorY, spawnZ);
    ctx.setFacing(0);
    occupant = true;
    entranceLeft = 1.7;
    aimCamera(ctx, true);
    constrainCamera(ctx.camera, ctx.hero);
    const blockedSpawn = blocks(ctx.hero.position.x, ctx.hero.position.z);
    if (blockedSpawn) ctx.hero.position.z = ctx.portal.frontZ + Math.min(hallLen * 0.35, 2.4);
  }

  function watchContext(renderer) {
    if (contextWatch || !renderer || !renderer.getContext) return;
    const gl = renderer.getContext();
    if (!gl || !gl.canvas) return;
    contextWatch = true;
    gl.canvas.addEventListener('webglcontextlost', function (e) {
      if (e && e.preventDefault) e.preventDefault();
      runtimeErrors.push('webglcontextlost');
      loadError = new Error('فُقد سياق الرسم WebGL — ذاكرة الجهاز لا تكفي لعرض القاعة');
      if (state !== 'DONE' && state !== 'IDLE') {
        state = 'FAILED';
        showFail(loadError);
      }
      renderDebug();
    }, false);
  }

  function floorAt(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return floorY;
    const lx = x - portalX;
    const lz = z - portalFront;
    if (wingRuntime && window.PalaceWings) {
      const wh = PalaceWings.floorAt(lx, lz);
      if (wh != null) return floorY + wh;
    }
    if (!ramp) return floorY;
    let h = 0;
    if (lx >= ramp.x0 && lx <= ramp.x1) {
      if (lz >= ramp.z1 && lz <= ramp.zPlat) h = ramp.yTop;
      else if (lz > ramp.z0 && lz < ramp.z1) h = ramp.yTop * ((lz - ramp.z0) / Math.max(0.001, ramp.z1 - ramp.z0));
    }
    return floorY + h;
  }

  let lastDt = 0.016;
  function tick(dt, ctx) {
    rig.idle++; // frames since the camera rig last ran (a re-entry snaps instead of swinging)
    try { tickInner(dt, ctx); }
    catch (err) {
      console.error(err);
      runtimeErrors.push('tick: ' + (err && (err.stack || err.message) || err));
      if (state !== 'IDLE' && state !== 'FAILED') {
        loadError = err;
        state = 'FAILED';
        try { showFail(err); } catch (e2) { /* keep the page alive */ }
      }
    }
  }
  function tickInner(dt, ctx) {
    lastDt = dt;
    clock += dt;
    if (group && hallBuilt && (state === 'REVEAL' || state === 'FADING_IN' || state === 'ENTRANCE' || state === 'SETTLE' || state === 'DONE')) animateHall(dt, ctx);
    if (ctx.hero) heroSnap = ctx.hero.position.x.toFixed(2) + ', ' + ctx.hero.position.y.toFixed(2) + ', ' + ctx.hero.position.z.toFixed(2);
    lastDoor = !!ctx.doorOpen;
    if (ctx.renderer) {
      aniso.v = ctx.renderer.capabilities.getMaxAnisotropy();
      watchContext(ctx.renderer);
    }
    const portal = ctx.portal;
    if (!portal) return;
    if (debugOn()) renderDebug();
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
        ensureLoadScreen();
        loadEl.style.opacity = '0';
        loadEl.style.pointerEvents = 'auto';
        if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
        if (retryBtn) retryBtn.style.display = 'none';
        state = 'FADING_OUT';
        fadeT = 0;
        holdT = 0;
        loadOk = null;
        loadError = null;
        hallBuilt = false;
        warmFrame = false;
    warmMeshes = null;
        occupant = true;
        loadStartedAt = performance.now();
        note('threshold x=' + p.x.toFixed(2) + ' z=' + p.z.toFixed(2) + ' door=' + ctx.doorOpen);
        renderUI();
        loadPalaceAssets().then(function () { loadOk = true; note('assets ready'); }, function (err) { loadError = err; loadOk = false; note('assets failed ' + (err && err.message)); });
      }
      return;
    }
    if (state === 'FADING_OUT') {
      fadeT += dt;
      const u = Math.min(1, fadeT / CONFIG.fadeOutSeconds);
      loadEl.style.opacity = String(easeInOut(u));
      ctx.hero.position.y = floorY;
      ctx.hero.position.z += 1.28 * dt;
      ctx.setFacing(0);
      aimCamera(ctx, false);
      if (u >= 1) { state = 'LOADING'; holdT = 0; note('black'); }
      return;
    }
    if (state === 'LOADING') {
      holdT += dt;
      ctx.hero.position.y = floorY;
      aimCamera(ctx, false);
      renderUI();
      if (loadOk === true && holdT >= CONFIG.minBlackHoldSeconds) state = 'SETUP';
      if (loadOk === false && holdT >= CONFIG.minBlackHoldSeconds) { state = 'FAILED'; showFail(loadError); }
      return;
    }
    if (state === 'FAILED') {
      ctx.hero.position.y = floorY;
      loadEl.style.opacity = '1';
      return;
    }
    if (state === 'SETUP') {
      try {
        if (statusEl) statusEl.textContent = 'جارٍ بناء القاعة';
        renderUI();
        const tBuild = performance.now();
        build(ctx);
        hallBuilt = true;
        placeHero(ctx);
        // Hide the city before any palace frame. Drawing the whole avenue
        // together with the new hall uploads enough geometry to kill the tab,
        // which reloads the game back to the opening loading screen at 99%.
        holdCull(ctx.scene, ctx.hero);
        note('built ' + Math.round(performance.now() - tBuild) + 'ms');
        renderUI();
        state = 'REVEAL';
        fadeT = 0;
        warmFrame = false;
    warmMeshes = null;
      } catch (err) {
        console.error(err);
        runtimeErrors.push('SETUP: ' + (err && (err.stack || err.message) || err));
        loadError = err;
        state = 'FAILED';
        showFail(err);
      }
      return;
    }
    if (state === 'REVEAL') {
      // One full palace frame used to compile every new shader and draw the
      // whole hall at once. The browser treats that as a dead tab and reloads
      // the opening screen while the bar is stuck at 99%. Compile one material
      // per frame on a tiny stand-in, then draw the real hall once.
      if (!warmFrame) {
        holdCull(ctx.scene, ctx.hero);
        if (!warmMeshes) {
          const seen = new Set();
          warmMeshes = [];
          const consider = function (root) {
            if (!root) return;
            root.traverse(function (o) {
              if (!o.isMesh && !o.isSprite && !o.isPoints) return;
              const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
              if (!mats.length || mats.every(function (m) { return !m || seen.has(m.uuid); })) return;
              mats.forEach(function (m) {
                if (!m || seen.has(m.uuid)) return;
                seen.add(m.uuid);
                warmMeshes.push({ obj: o, mat: m });
              });
            });
          };
          consider(group);
          if (wingRuntime && wingRuntime.root) consider(wingRuntime.root);
          if (ctx.hero) consider(ctx.hero);
          warmMeshes.forEach(function (e) {
            if (e.obj.userData._warmVis == null) e.obj.userData._warmVis = e.obj.visible;
            e.obj.visible = false;
          });
          if (ctx.hero && ctx.hero.userData._warmHero == null) {
            ctx.hero.userData._warmHero = ctx.hero.visible;
            ctx.hero.visible = false;
          }
          const tiny = new THREE.BufferGeometry();
          tiny.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.04, 0, 0, 0, 0.04, 0], 3));
          tiny.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
          tiny.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1], 2));
          tiny.setIndex([0, 1, 2]);
          warmProxy = new THREE.Mesh(tiny, new THREE.MeshBasicMaterial());
          warmProxy.frustumCulled = false;
          warmProxy.visible = false;
          warmProxy.name = 'warm-proxy';
          ctx.scene.add(warmProxy);
          warmProxyI = new THREE.InstancedMesh(tiny.clone(), new THREE.MeshBasicMaterial(), 1);
          warmProxyI.frustumCulled = false;
          warmProxyI.visible = false;
          warmProxyI.name = 'warm-proxy-i';
          const idm = new THREE.Object3D();
          idm.updateMatrix();
          warmProxyI.setMatrixAt(0, idm.matrix);
          warmProxyI.instanceMatrix.needsUpdate = true;
          ctx.scene.add(warmProxyI);
          warmIndex = 0;
          warmSlow = 0;
          mark('warm materials ' + warmMeshes.length);
        }
        const e = warmMeshes[warmIndex];
        const o = e && e.obj;
        const heavy = o && (o.isSprite || o.isPoints || o.isSkinnedMesh);
        const proxy = !o ? null : heavy ? o : (o.isInstancedMesh ? warmProxyI : warmProxy);
        if (proxy && proxy !== o) {
          proxy.material = e.mat;
          const dir = new THREE.Vector3();
          ctx.camera.getWorldDirection(dir);
          proxy.position.copy(ctx.camera.position).addScaledVector(dir, 0.45);
          proxy.quaternion.copy(ctx.camera.quaternion);
          proxy.visible = true;
        } else if (o) {
          o.visible = o.userData._warmVis !== false;
          if (e.mat) o.material = o.material;
        }
        const tWarm = performance.now();
        try { ctx.renderer.render(ctx.scene, ctx.camera); }
        catch (renderErr) { mark('render ' + (renderErr && renderErr.message)); }
        const took = performance.now() - tWarm;
        if (took > warmSlow) warmSlow = took;
        if (took > 120) mark('warm ' + Math.round(took) + 'ms ' + ((e && e.mat && (e.mat.name || e.mat.type)) || (o && (o.name || o.type)) || '?'));
        if (proxy && proxy !== o) proxy.visible = false;
        else if (o) o.visible = false;
        warmIndex += 1;
        if (statusEl) statusEl.textContent = 'جارٍ تجهيز القاعة';
        renderUI();
        if (warmIndex >= warmMeshes.length) {
          const restored = new Set();
          warmMeshes.forEach(function (e2) {
            if (restored.has(e2.obj)) return;
            restored.add(e2.obj);
            e2.obj.visible = e2.obj.userData._warmVis !== false;
            delete e2.obj.userData._warmVis;
          });
          if (ctx.hero && ctx.hero.userData._warmHero != null) {
            ctx.hero.visible = ctx.hero.userData._warmHero !== false;
            delete ctx.hero.userData._warmHero;
          }
          if (warmProxy) { ctx.scene.remove(warmProxy); warmProxy.geometry.dispose(); warmProxy = null; }
          if (warmProxyI) { ctx.scene.remove(warmProxyI); warmProxyI.geometry.dispose(); warmProxyI = null; }
          const tFull = performance.now();
          try { ctx.renderer.render(ctx.scene, ctx.camera); }
          catch (renderErr) { mark('render ' + (renderErr && renderErr.message)); }
          warmFrame = true;
          mark('warm slices max=' + Math.round(warmSlow) + 'ms full=' + Math.round(performance.now() - tFull) + 'ms n=' + warmMeshes.length);
          warmMeshes = null;
          renderUI();
        }
        return;
      }
      fadeT += dt;
      loadEl.style.opacity = '1';
      renderUI();
      ctx.hero.position.y = floorY;
      aimCamera(ctx, false);
      if (fadeT >= CONFIG.revealHoldSeconds && shownPercent() >= 100) {
        state = 'FADING_IN';
        fadeT = 0;
        note('reveal');
      }
      return;
    }
    if (state === 'FADING_IN') {
      fadeT += dt;
      const u = Math.min(1, fadeT / CONFIG.fadeInSeconds);
      loadEl.style.opacity = String(1 - easeOut(u));
      ctx.hero.position.y = floorY;
      aimCamera(ctx, false);
      if (u >= 1) {
        loadEl.style.opacity = '0';
        loadEl.style.pointerEvents = 'none';
        state = 'ENTRANCE';
        fadeT = 0;
        entranceLeft = 1.7;
        note('entrance');
        renderDebug();
      }
      return;
    }
    if (state === 'ENTRANCE') {
      const step = Math.min(entranceLeft, 0.48 * dt);
      const p = ctx.hero.position;
      const nz = p.z + step;
      if (!blocks(p.x, nz)) p.z = nz;
      else entranceLeft = 0;
      entranceLeft = Math.max(0, entranceLeft - step);
      p.y = floorAt(p.x, p.z);
      ctx.setFacing(0);
      aimCamera(ctx, false);
      if (entranceLeft <= 0) { state = 'SETTLE'; fadeT = 0; note('settle'); }
      return;
    }
    if (state === 'SETTLE') {
      fadeT += dt;
      ctx.hero.position.y = floorAt(ctx.hero.position.x, ctx.hero.position.z);
      ctx.setFacing(0);
      aimCamera(ctx, false);
      if (fadeT >= 0.9) { state = 'DONE'; note('done'); renderDebug(); }
      return;
    }
    if (state === 'DONE') {
      const lx = ctx.hero.position.x - portalX;
      const lz = ctx.hero.position.z - portalFront;
      const inHall = lz >= -0.08 && lz <= hallLen + 0.4 && Math.abs(lx) <= hallW / 2 + 0.2;
      const inWings = !!(wingRuntime && window.PalaceWings && PalaceWings.contains(lx, lz));
      occupant = inHall || inWings;
      // Keep the palace hall drawn from nearby wing rooms so the arch behind the player is not a void.
      const palaceSeen = inWings && (typeof PalaceWings.palaceVisible !== 'function' || PalaceWings.palaceVisible());
      if (group) group.visible = wingRuntime ? (inHall || palaceSeen) : occupant;
      setExteriorVisible(ctx.scene, !occupant);
      if (ctx.renderer && ctx.renderer.info && ctx.renderer.info.render) {
        const inf = ctx.renderer.info.render;
        if (inf.calls) perfNote = 'calls=' + inf.calls + ' tris=' + inf.triangles;
      }
    }
  }

  function blocks(x, z) {
    const active = state === 'FADING_IN' || state === 'REVEAL' || state === 'SETUP' || state === 'ENTRANCE' || state === 'SETTLE' || (state === 'DONE' && occupant);
    if (!active) return false;
    if (wingRuntime && window.PalaceWings && PalaceWings.capsuleBlocked(x - portalX, z - portalFront, 0.32)) return true;
    // Height-aware: boxes entirely above the hero's head (arch lintels over the open wing
    // passages) or below the feet must not act as full-height walls in this 2D check.
    const feet = floorAt(x, z), head = feet + Math.max(1.9, H * 1.05);
    for (const c of colliders) {
      if (c.miny >= head || c.maxy <= feet + 0.08) continue;
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

  // ---------------------------------------------------------------------------
  // THIRD-PERSON CAMERA RIG (palace hall + wings)
  // The camera always sits on the ray from a pivot at the hero's shoulders,
  // pointing back along the view yaw/pitch, at the longest distance that keeps a
  // CAM_RADIUS sphere clear of walls, door jambs, lintels, floor and ceiling.
  //   - it pulls IN instantly when something comes between (never clips through);
  //   - it eases back OUT slowly (no pumping);
  //   - it is rigidly attached to the hero (no position lerp that lags behind on
  //     a sprint and then gets snapped by a collision clamp: that fight was the
  //     shake on entry and the "camera flies away" in the narrow wing corridors).
  // Small free-standing hall props (throne, braziers) do not yank the camera in
  // when they pass between it and the hero; the camera is only stopped in front
  // of one when it would otherwise end up inside it. Every wing box (walls, door
  // jambs, columns, lions, plants) is a full obstacle.
  const CAM_RADIUS = 0.3;      // clearance kept around the lens (m)
  const CAM_PIVOT = 1.18;      // look height; matches index.html CAM_LOOK so the body stays framed
  const CAM_MIN = 0.35;        // closest the lens may get to the pivot (m)
  const CAM_OUT = 2.4;         // ease-out rate after an obstruction clears (1/s)
  const CAM_ZOOM = 4;          // ease rate for requested distance changes (1/s)
  const CAM_TURN = 10;         // yaw/pitch smoothing (1/s) — light, keeps touch drag responsive
  const FOLLOW_DIST = 3.45, FOLLOW_PITCH = 0.22;                // = index.html CAM_DIST / CAM_PITCH
  const ENTRY_DIST = 3.85, ENTRY_PITCH = 0.24, ENTRY_LOOK = 1.12; // entrance: doorway shot, same cinematic scale
  let entryCam = null, entryCut = false;
  const rig = { d: -1, ds: FOLLOW_DIST, yaw: 0, pitch: FOLLOW_PITCH, idle: 0, fresh: false };
  const camBox = { minx: 0, maxx: 0, miny: 0, maxy: 0, minz: 0, maxz: 0 };
  function wrapAngle(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

  function insideBox(x, y, z, b) { return x >= b.minx && x <= b.maxx && y >= b.miny && y <= b.maxy && z >= b.minz && z <= b.maxz; }

  // Ceiling height (world y) above a point, or +Infinity when unknown.
  function ceilingAt(x, z) {
    if (wingRuntime && window.PalaceWings && PalaceWings.state && PalaceWings.state.root) {
      const root = PalaceWings.state.root.position, lx = x - root.x, lz = z - root.z;
      if (PalaceWings.contains(lx, lz)) {
        const r = PalaceWings.regionAt(lx, lz);
        if (r && r.height > 0) return root.y + r.height;
      }
    }
    const lx = x - portalX, lz = z - portalFront;
    if (Math.abs(lx) <= hallW / 2 + 0.6 && lz >= -0.5 && lz <= hallLen + 0.6) return floorY + CONFIG.hallHeightH * H;
    return Infinity;
  }

  function isProp(b) { return !b._wing && Math.max(b.maxx - b.minx, b.maxz - b.minz) < 8; }
  function padBox(b, r) {
    camBox.minx = b.minx - r; camBox.maxx = b.maxx + r;
    camBox.miny = b.miny - r; camBox.maxy = b.maxy + r;
    camBox.minz = b.minz - r; camBox.maxz = b.maxz + r;
    return camBox;
  }
  // Longest clear distance (≤ len) along the unit ray (ux,uy,uz) from the pivot.
  // props=false: walls only. props=true: only props that would contain the lens at len.
  function castCamera(px, py, pz, ux, uy, uz, len, feetY, props) {
    const r = CAM_RADIUS;
    const ex = px + ux * len, ey = py + uy * len, ez = pz + uz * len;
    const lox = Math.min(px, ex) - r, hix = Math.max(px, ex) + r;
    const loy = Math.min(py, ey) - r, hiy = Math.max(py, ey) + r;
    const loz = Math.min(pz, ez) - r, hiz = Math.max(pz, ez) + r;
    let best = len;
    for (let i = 0; i < colliders.length; i++) {
      const b = colliders[i];
      if (b.maxx < lox || b.minx > hix || b.maxy < loy || b.miny > hiy || b.maxz < loz || b.minz > hiz) continue;
      if (isProp(b) !== !!props) continue;
      let box = padBox(b, r);
      if (insideBox(px, py, pz, camBox)) {
        // Hero hugging a wall / brushing a plant: the padded box already contains (or
        // touches) the pivot. Test the real box instead; a box the pivot is in or on
        // cannot be between the hero and the lens.
        if (insideBox(px, py, pz, b)) continue;
        box = b;
      }
      if (props && !insideBox(ex, ey, ez, box)) continue;
      const t = rayHit(px, py, pz, ux * len, uy * len, uz * len, box);
      if (t != null && t * len < best) best = t * len;
    }
    if (props) return best;
    // Ceiling / floor planes (rooms and corridors have different heights).
    const ceil = Math.min(ceilingAt(px, pz), ceilingAt(ex, ez));
    if (uy > 1e-4 && Number.isFinite(ceil)) best = Math.min(best, Math.max(0, (ceil - r - py) / uy));
    if (uy < -1e-4) best = Math.min(best, Math.max(0, (feetY + r - py) / uy));
    return Math.max(0, best - 0.03);
  }

  // Positions + aims the camera. Returns false when the rig is not in charge.
  function followCamera(cam, hero, yaw, pitch, dist, dt, snap, cinematic) {
    if (!cam || !hero || !hallBuilt || colliders.length === 0) return false;
    if (!cinematic && !(state === 'DONE' && occupant)) return false;
    const p = hero.isObject3D ? hero.position : hero;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return false;
    if (![yaw, pitch, dist].every(Number.isFinite)) return false;
    dt = Math.min(0.1, Math.max(0.001, dt || lastDt));
    if (snap || rig.d < 0 || rig.idle > 3) { snap = true; rig.yaw = yaw; rig.pitch = pitch; rig.ds = dist; }
    rig.idle = 0;
    const turn = 1 - Math.exp(-dt * CAM_TURN);
    rig.yaw += wrapAngle(yaw - rig.yaw) * turn;
    rig.pitch += (pitch - rig.pitch) * turn;
    rig.ds += (dist - rig.ds) * (1 - Math.exp(-dt * CAM_ZOOM));
    const pt = Math.max(-0.1, Math.min(1.2, rig.pitch)), cp = Math.cos(pt);
    const ux = -Math.sin(rig.yaw) * cp, uy = Math.sin(pt), uz = -Math.cos(rig.yaw) * cp;
    const px = p.x, py = p.y + CAM_PIVOT, pz = p.z;
    const safe = castCamera(px, py, pz, ux, uy, uz, rig.ds, p.y, false);
    const want = Math.max(Math.min(CAM_MIN, safe), Math.min(rig.ds, safe));
    if (snap || want < rig.d) rig.d = want;
    else rig.d += (want - rig.d) * (1 - Math.exp(-dt * CAM_OUT));
    if (rig.d > 0.05) rig.d = Math.max(Math.min(CAM_MIN, rig.d), Math.min(rig.d, castCamera(px, py, pz, ux, uy, uz, rig.d, p.y, true)));
    cam.position.set(px + ux * rig.d, py + uy * rig.d, pz + uz * rig.d);
    cam.lookAt(px, py, pz);
    rig.fresh = true;
    return true;
  }

  function constrainCamera(cam, hero) {
    if (!cam || !hero || colliders.length === 0) return;
    // The rig already placed this frame's camera collision-free; a second,
    // different clamp on top of it is what used to make the view shake.
    if (rig.fresh) { rig.fresh = false; return; }
    if (state === 'IDLE' || state === 'FAILED' || state === 'FADING_OUT' || state === 'LOADING') return;
    if (state === 'DONE' && !occupant) return;
    const p = hero.isObject3D ? hero.position : hero;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return;
    const inWings = !!(wingRuntime && window.PalaceWings && PalaceWings.contains(p.x - portalX, p.z - portalFront));
    const ox = p.x, oy = p.y + 1.45, oz = p.z;
    const savedCam = cam.position.clone();
    const dx = cam.position.x - ox, dy = cam.position.y - oy, dz = cam.position.z - oz;
    let hit = 1;
    for (let i = 0; i < colliders.length; i++) {
      const b = colliders[i];
      if (!b._wing && Math.max(b.maxx - b.minx, b.maxz - b.minz) < 8) continue;
      const t = rayHit(ox, oy, oz, dx, dy, dz, b);
      if (t != null && t < hit) hit = t;
    }
    const margin = 0.35 * H;
    const minX = portalX - hallW / 2 + margin, maxX = portalX + hallW / 2 - margin;
    const minZ = portalFront + margin, maxZ = portalFront + hallLen - margin;
    if (hit < 0.98) {
      const t = Math.max(0.18, hit - 0.05);
      cam.position.set(ox + dx * t, oy + dy * t, oz + dz * t);
    }
    if (inWings) {
      // The main follow rig already applies the player's touch yaw/pitch.
      // Do not re-anchor behind hero.rotation here: that erased camera
      // rotation every frame while the player stood inside K1.
      PalaceWings.resolveCamera(cam);
      cam.position.y = Math.max(p.y + 0.45, Math.min(p.y + 10.0, cam.position.y));
    } else {
      cam.position.x = Math.max(minX, Math.min(maxX, cam.position.x));
      cam.position.z = Math.max(minZ, Math.min(maxZ, cam.position.z));
      cam.position.y = Math.max(floorY + 0.35, Math.min(floorY + CONFIG.hallHeightH * H - 0.25, cam.position.y));
    }
    if (![cam.position.x, cam.position.y, cam.position.z].every(Number.isFinite)) cam.position.copy(savedCam);
  }

  function clampFollowTarget(want) {
    if (!want || state !== 'DONE' || !occupant) return;
    if (wingRuntime && window.PalaceWings && PalaceWings.contains(want.x - portalX, want.z - portalFront)) {
      PalaceWings.clampFollowTarget(want); return;
    }
    const margin = 0.7 * H;
    want.x = Math.max(portalX - hallW / 2 + margin, Math.min(portalX + hallW / 2 - margin, want.x));
    want.z = Math.max(portalFront + 0.9, Math.min(portalFront + hallLen - margin, want.z));
    want.y = Math.max(floorY + 1.2, Math.min(floorY + Math.max(2.4, CONFIG.hallHeightH * H * 0.55), want.y));
  }

  window.PalaceInterior = {
    CONFIG: CONFIG,
    BUILD: BUILD,
    tick: tick,
    locksControl: function () { return state === 'FADING_OUT' || state === 'LOADING' || state === 'SETUP' || state === 'REVEAL' || state === 'FADING_IN' || state === 'ENTRANCE' || state === 'SETTLE' || state === 'FAILED'; },
    ownsCamera: function () { return state === 'FADING_OUT' || state === 'LOADING' || state === 'SETUP' || state === 'REVEAL' || state === 'FADING_IN' || state === 'ENTRANCE' || state === 'SETTLE' || state === 'FAILED'; },
    wantsWalk: function () { return state === 'ENTRANCE'; },
    clampFollowTarget: clampFollowTarget,
    ownsGround: function () { return state === 'FADING_OUT' || state === 'LOADING' || state === 'SETUP' || state === 'REVEAL' || state === 'FADING_IN' || state === 'FAILED' || (state === 'DONE' && occupant); },
    blocks: blocks,
    constrainCamera: constrainCamera,
    followCamera: function (cam, hero, yaw, pitch, dist, dt) { return followCamera(cam, hero, yaw, pitch, dist, dt, false, false); },
    floorY: function () { return floorY; },
    floorAt: floorAt,
    holdCull: holdCull,
    slots: function () {
      if (slotModes.length) return slotModes.map(function (s) { return { id: s.id, count: s.count, mode: s.mode }; });
      return CONFIG.PROPS.map(function (s) { return { id: s.id, count: s.positions.length, mode: s.glbPath ? 'pending' : 'placeholder' }; });
    },
    loadPalaceAssets: loadPalaceAssets,
    state: function () { return state; },
    percent: shownPercent,
    debugText: debugText,
    mark: mark,
    metrics: function () { return { H: H, length: hallLen, width: hallW, front: portalFront, x: portalX, state: state, occupant: occupant, lights: lights.length + 1, ramp: ramp ? ramp.yTop : 0 }; }
  };
  if (debugOn()) { ensureLoadScreen(); renderDebug(); }
})();
