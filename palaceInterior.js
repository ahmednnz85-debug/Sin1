/* Palace interior. Assets load only after the hero walks through the open royal door.
   Originals stay in assets/. Optimized copies live in ارضيات وسقوف/optimized/.
   Build hall5 — asset URLs carry ?v=hall5 so Safari cannot reuse a stale copy.
   Hall blockout: proportions and swappable prop slots. Real prop GLBs replace placeholders later. */
(function () {
  const BUILD = 'hall5';
  const CONFIG = {
    useOptimizedAssets: true,
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
    lightCount: 5,
    torchFlicker: 0.08,
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
    plinthHeightH: 0.5,
    maxPropBytes: 3 * 1024 * 1024,
    maxPropTris: 20000,
    maxPalaceBytes: 20 * 1024 * 1024
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

  const lionLarge = [[2.55, 0.72, PLAN.stairFootZ - 1.05], [2.62, 0.72, PLAN.stairFootZ - 4.9]];
  const lionSmall = [[1.42, PLAN.topY + 0.36, PLAN.throneZ + 0.12]];
  const PI = Math.PI;
  CONFIG.PROPS = [
    { id: 'lionWinged', type: 'lionWinged', positions: mirrorXZ(lionLarge), rotY: PI, targetHeightH: 1.85, glbPath: null, collider: 'box', colliderSize: { x: 0.9, y: 1.85, z: 1.4 } },
    { id: 'lionWingedThrone', type: 'lionWinged', positions: mirrorXZ(lionSmall), rotY: PI, targetHeightH: 1.1, glbPath: null, collider: 'box', colliderSize: { x: 0.55, y: 1.1, z: 0.9 } },
    { id: 'pedestal', type: 'pedestal', positions: mirrorXZ(lionLarge.map(function (p) { return [p[0], 0, p[2]]; })), rotY: 0, targetHeightH: 0.72, glbPath: null, collider: 'box', colliderSize: { x: 1.35, y: 0.72, z: 1.2 } },
    { id: 'pedestalThrone', type: 'pedestal', positions: mirrorXZ(lionSmall.map(function (p) { return [p[0], PLAN.topY, p[2]]; })), rotY: 0, targetHeightH: 0.36, glbPath: null, collider: 'box', colliderSize: { x: 0.85, y: 0.36, z: 0.75 } },
    { id: 'brazier', type: 'brazier', positions: mirrorXZ([[5.15, 0, 6.5], [5.15, 0, 10.3], [5.15, 0, 14.1], [5.15, 0, 17.8], [5.05, 0, 21.15]]), rotY: 0, targetHeightH: 0.95, glbPath: null, collider: 'box', colliderSize: { x: 0.72, y: 0.95, z: 0.72 } },
    { id: 'lantern', type: 'lantern', positions: [[0, 6.15, 7.2], [1.65, 6.15, 12.0], [-1.65, 6.15, 16.4], [1.35, 6.15, 20.6], [-1.15, 6.25, 24.4]], rotY: 0, targetHeightH: 0.62, glbPath: null, collider: 'none', colliderSize: { x: 0.4, y: 0.62, z: 0.4 } },
    { id: 'banner', type: 'banner', positions: [[4.75, 1.7, 11.6], [-4.75, 1.7, 11.6], [4.75, 1.7, 16.6], [-4.75, 1.7, 16.6], [2.25, PLAN.topY + 0.85, PLAN.platformBackZ - 0.55], [-2.25, PLAN.topY + 0.85, PLAN.platformBackZ - 0.55]], rotY: 0, rotYs: [PI / 2, -PI / 2, PI / 2, -PI / 2, PI, PI], targetHeightH: 3.05, glbPath: null, collider: 'none', colliderSize: { x: 0.12, y: 3.05, z: 0.72 } },
    { id: 'statueAlcove', type: 'statueAlcove', positions: mirrorXZ([[6.42, 0, 8.0], [6.42, 0, 12.0], [6.42, 0, 16.0], [6.42, 0, 20.0]]), rotY: 0, rotYs: [PI / 2, -PI / 2, PI / 2, -PI / 2, PI / 2, -PI / 2, PI / 2, -PI / 2], targetHeightH: 1.65, glbPath: null, collider: 'box', colliderSize: { x: 0.5, y: 1.65, z: 0.48 } },
    { id: 'tableLow', type: 'tableLow', positions: mirrorXZ([[5.05, 0, 2.75]]), rotY: 0, targetHeightH: 0.42, glbPath: null, collider: 'box', colliderSize: { x: 1.2, y: 0.42, z: 0.62 } },
    { id: 'benchCushion', type: 'benchCushion', positions: mirrorXZ([[5.05, 0, 1.5], [5.05, 0, 4.0]]), rotY: 0, targetHeightH: 0.48, glbPath: null, collider: 'box', colliderSize: { x: 0.62, y: 0.48, z: 1.28 } },
    { id: 'vase', type: 'vase', positions: mirrorXZ([[6.18, 0, 1.85], [6.18, 0, 3.7]]), rotY: 0, targetHeightH: 0.8, glbPath: null, collider: 'box', colliderSize: { x: 0.42, y: 0.8, z: 0.42 } }
  ];

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
  let overlapNotes = [];
  let propsProbed = false;
  let perfNote = '';
  const aniso = { v: 4 };
  const runtimeErrors = [];
  const LOG = [];
  let paintQueued = false;

  function debugOn() {
    const href = String(location.href || '');
    return /(?:[?&#])debug=1(?:&|#|$)/.test(href);
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

  function makeSpecs() {
    const list = [];
    if (CONFIG.useOptimizedAssets) {
      list.push({ id: 'decoder', key: 'decoder', name: 'meshopt_decoder.js', kind: 'js', url: bust(encodeURI('vendor/meshopt_decoder.js')) });
    }
    [FILES.floor, FILES.carpet, FILES.ceiling, FILES.medallion, FILES.wall, FILES.frieze].forEach(function (n) {
      const file = n + (CONFIG.useOptimizedAssets ? '.webp' : '.JPG');
      list.push({ id: 'tex:' + n, key: n, name: file, kind: 'tex', url: bust(encodeURI(dir() + file)) });
    });
    [['columns', FILES.columns], ['torchWood', FILES.torchWood], ['torchBlack', FILES.torchBlack], ['throne', FILES.throne]].forEach(function (pair) {
      list.push({ id: 'glb:' + pair[0], key: pair[0], name: pair[1], kind: 'glb', url: bust(encodeURI(dir() + pair[1])) });
    });
    list.forEach(function (s) {
      s.status = 'pending'; s.loaded = 0; s.total = 0; s.error = ''; s.attempt = 0; s.buf = null; s.result = null;
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

  function textureFromBytes(buf, name) {
    const mime = /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'image/webp';
    const blob = new Blob([buf], { type: mime });
    const url = URL.createObjectURL(blob);
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        if (!img.naturalWidth) { reject(new Error('صورة فارغة — ' + name)); return; }
        const tex = new THREE.Texture(img);
        tex.needsUpdate = true;
        srgb(tex);
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
        ['map', 'emissiveMap'].forEach(function (k) { if (m[k]) srgb(m[k]); });
        ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'].forEach(function (k) {
          if (m[k]) { m[k].anisotropy = aniso.v; m[k].needsUpdate = true; }
        });
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

  async function settle(spec) {
    if (spec.status === 'loaded' && spec.result) return spec.result;
    try {
      if (!spec.buf) spec.buf = await fetchWithRetry(spec);
      if (spec.kind === 'js') spec.result = await installDecoder(spec.buf);
      else if (spec.kind === 'tex') spec.result = await textureFromBytes(spec.buf, spec.name);
      else {
        await waitDecoder();
        spec.result = await parseGLB(spec.buf);
      }
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
    if (payload > CONFIG.maxPalaceBytes) console.warn('حمولة القصر تتجاوز ٢٠ ميجابايت', payload);
    const get = function (key) { return specs.find(function (s) { return s.key === key; }).result; };
    assets = { tex: tex, columns: get('columns'), torchWood: get('torchWood'), torchBlack: get('torchBlack'), throne: get('throne'), props: props, payload: payload };
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

  function holdCull(scene, hero) {
    if (!scene || !group) return;
    const on = state === 'SETUP' || state === 'REVEAL' || state === 'FADING_IN' || state === 'FAILED' || (state === 'DONE' && occupant);
    scene.children.forEach(function (ch) {
      if (ch === group || ch === hero || ch.name === 'SkyPhoto' || ch.name === 'PalaceInterior') return;
      if (on) {
        if (ch.userData._palaceWas == null) ch.userData._palaceWas = ch.visible;
        ch.visible = false;
      } else if (ch.userData._palaceWas != null) {
        ch.visible = ch.userData._palaceWas;
        ch.userData._palaceWas = null;
      }
    });
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
    flameSprite.mat = null;
    group = null;
    colliders = [];
    lights = [];
    ramp = null;
    flames = [];
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
    flames = [];
    slotModes = [];
    overlapNotes = [];
    ramp = null;

    const tex = assets.tex;
    const tile = 2.2 * H;
    const floor = plane(W, L, 0, tiledMap(tex[FILES.floor], W / tile, L / tile), 0, L / 2);
    floor.name = 'floor';
    group.add(floor);

    const stairFootZ = PLAN.stairFootZ * H;
    const platformFrontZ = PLAN.platformFrontZ * H;
    const topY = PLAN.topY * H;
    const throneZ = PLAN.throneZ * H;
    const stepDepth = CONFIG.stairTreadH * H;
    const stepH = CONFIG.stairRiseH * H;
    const stepsN = CONFIG.stairSteps;
    const stairW = CONFIG.stairWidthH * H;

    const med = CONFIG.medallionSizeH * H;
    const medallion = plane(med, med, 0.012 * H, tex[FILES.medallion].clone(), 0, L / 2);
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
      const m = plane(cw, len, 0.01 * H, map, 0, (z0 + z1) / 2);
      m.material.polygonOffset = true;
      m.material.polygonOffsetFactor = -4;
      m.material.polygonOffsetUnits = -4;
      m.name = 'carpet';
      return m;
    }
    const gap = med * 0.55;
    const carpetEnd = stairFootZ - 0.2 * H;
    const carpetA = carpetSeg(0.55 * H, Math.min(carpetEnd, L / 2 - gap));
    const carpetB = carpetSeg(L / 2 + gap, carpetEnd);
    group.add(carpetA, carpetB);

    const gold = new THREE.MeshStandardMaterial({ color: 0xd4b06a, roughness: 0.4, metalness: 0.52 });
    const blueMat = new THREE.MeshStandardMaterial({ color: 0x1a3d78, roughness: 0.58, metalness: 0.08 });
    const stoneMat = mat(tiledMap(tex[FILES.floor], 2, 2), { roughness: 0.9, color: 0xcbb59a });
    const stoneDark = mat(tiledMap(tex[FILES.floor], 1, 1), { roughness: 0.92, color: 0x6d5c4c });
    function addBorder(z0, z1) {
      const len = Math.max(0.2, z1 - z0);
      const bw = 0.16 * H;
      [-1, 1].forEach(function (side) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.018 * H, len), gold);
        m.position.set(side * (cw / 2 + bw / 2), 0.008 * H, (z0 + z1) / 2);
        m.name = 'carpet-border';
        m.castShadow = false;
        m.receiveShadow = true;
        group.add(m);
      });
    }
    addBorder(0.55 * H, Math.min(carpetEnd, L / 2 - gap));
    addBorder(L / 2 + gap, carpetEnd);
    const perimZ1 = stairFootZ - 0.15 * H;
    [-1, 1].forEach(function (side) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.22 * H, 0.02 * H, perimZ1 - 0.7 * H), gold);
      m.position.set(side * (W / 2 - 0.5 * H), 0.006 * H, (0.7 * H + perimZ1) / 2);
      m.name = 'floor-border';
      m.castShadow = false;
      group.add(m);
    });
    const frontBorder = new THREE.Mesh(new THREE.BoxGeometry(W - 1.4 * H, 0.02 * H, 0.18 * H), gold);
    frontBorder.position.set(0, 0.006 * H, 0.32 * H);
    frontBorder.name = 'floor-border';
    group.add(frontBorder);

    for (let i = 0; i < stepsN; i++) {
      const zFront = stairFootZ + i * stepDepth;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(stairW, stepH, stepDepth + 0.03 * H), stoneMat);
      mesh.position.set(0, stepH * 0.5 + i * stepH, zFront + stepDepth * 0.5);
      mesh.name = 'step';
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    const platLen = (L - 0.08 * H) - platformFrontZ;
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
      const wood = mat(tex[FILES.wall].clone(), { roughness: .72, color: 0x6a3a22 });
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.35 * H, 0.42 * H, 1.05 * H), wood);
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.35 * H, 1.45 * H, 0.16 * H), wood);
      throneObj = new THREE.Group();
      throneObj.name = 'throne-stand-in';
      seat.position.y = 0.21 * H;
      back.position.set(0, 0.95 * H, 0.46 * H);
      throneObj.add(seat, back);
      throneObj.position.set(0, topY, throneZ);
    }
    group.add(throneObj);

    const archW = 6.4 * H, archR = 2.55 * H, archBase = topY + 0.15 * H;
    const archZ = L - 0.42 * H;
    const vous = [];
    const vousGeo = new THREE.BoxGeometry(0.38 * H, 0.42 * H, 0.28 * H);
    const dummy = new THREE.Object3D();
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * (1 - i / 10);
      dummy.position.set(Math.cos(a) * archR, archBase + Math.sin(a) * archR, archZ);
      dummy.rotation.set(0, 0, a - Math.PI / 2);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      vous.push(dummy.matrix.clone());
    }
    const vousMesh = new THREE.InstancedMesh(vousGeo, gold, vous.length);
    vousMesh.name = 'arch';
    vousMesh.frustumCulled = false;
    vous.forEach(function (m, i) { vousMesh.setMatrixAt(i, m); });
    vousMesh.instanceMatrix.needsUpdate = true;
    group.add(vousMesh);
    [-1, 1].forEach(function (side) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(0.42 * H, archBase + 0.2 * H, 0.32 * H), gold);
      pier.position.set(side * archR, (archBase + 0.2 * H) / 2, archZ);
      pier.name = 'arch-pier';
      group.add(pier);
    });
    const emblemZ = L - 0.22 * H;
    const emblemY = archBase + archR * 0.72;
    const bluePanel = new THREE.Mesh(new THREE.PlaneGeometry(archR * 1.85, archR * 1.35), blueMat);
    bluePanel.position.set(0, emblemY - 0.15 * H, emblemZ);
    bluePanel.rotation.y = Math.PI;
    bluePanel.name = 'winged-disc-panel';
    group.add(bluePanel);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.72 * H, 20), gold);
    disc.position.set(0, emblemY, emblemZ - 0.04 * H);
    disc.rotation.y = Math.PI;
    disc.name = 'winged-disc';
    group.add(disc);
    [-1, 1].forEach(function (side) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.55 * H, 0.38 * H, 0.06 * H), gold);
      wing.position.set(side * 1.35 * H, emblemY + 0.05 * H, emblemZ - 0.05 * H);
      wing.rotation.z = side * 0.38;
      wing.name = 'wing';
      group.add(wing);
      const feather = new THREE.Mesh(new THREE.BoxGeometry(1.15 * H, 0.22 * H, 0.05 * H), gold);
      feather.position.set(side * 1.15 * H, emblemY - 0.28 * H, emblemZ - 0.05 * H);
      feather.rotation.z = side * 0.22;
      group.add(feather);
    });

    const trimH = 0.48 * H;
    const galleryBase = 6.05 * H;
    const galleryH = 1.12 * H;
    const panelH = Math.max(1.2 * H, galleryBase - trimH);
    const alcoveZs = [8, 12, 16, 20].map(function (z) { return z * H; });
    const alcoveW = 1.62 * H;
    const alcoveH = 2.4 * H;
    const alcoveSill = 0.18 * H;
    const prefabs = columnPrefabs(assets.columns, CONFIG.columnHeightH * H);
    const colBox = new THREE.Box3().setFromObject(prefabs[0]);
    const colSize = colBox.getSize(new THREE.Vector3());
    const colLocalZ = [7.8, 11.6, 15.4, 19.2];
    const colLocalX = [3.55, 3.42, 3.2, 2.92];
    const columns = [];

    function sideWall(side, zA, zB) {
      const seg = Math.max(0.35, zB - zA);
      const map = tiledMap(tex[FILES.wall], seg / tile, panelH / tile);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(seg, panelH), mat(map));
      panel.position.set(side * (W / 2 - 0.12), trimH + panelH / 2, (zA + zB) / 2);
      panel.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      panel.name = 'wall-panel';
      panel.castShadow = false;
      group.add(panel);
    }
    [-1, 1].forEach(function (side) {
      const holes = alcoveZs.map(function (z) { return [z - alcoveW / 2, z + alcoveW / 2]; });
      let zc = 0.25 * H;
      const zMax = L - 0.3 * H;
      const segs = [];
      holes.forEach(function (h) {
        if (h[0] > zc + 0.25) segs.push([zc, h[0]]);
        zc = Math.max(zc, h[1]);
      });
      if (zMax > zc + 0.25) segs.push([zc, zMax]);
      segs.forEach(function (s) { sideWall(side, s[0], s[1]); });
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.22, trimH, L), mat(tiledMap(tex[FILES.floor], L / tile, 1), { color: 0x3a3128, roughness: .95 }));
      trim.position.set(side * (W / 2 - 0.02), trimH / 2, L / 2);
      trim.name = 'trim';
      group.add(trim);
      const topH = Math.max(0.4 * H, CH - galleryBase - galleryH);
      const friezeAspect = (tex[FILES.frieze].image ? tex[FILES.frieze].image.width / tex[FILES.frieze].image.height : 2);
      const fmap = tex[FILES.frieze].clone();
      srgb(fmap);
      fmap.wrapS = THREE.RepeatWrapping;
      fmap.wrapT = THREE.ClampToEdgeWrapping;
      fmap.repeat.set(L / (topH * friezeAspect), 1);
      const fr = new THREE.Mesh(new THREE.PlaneGeometry(L, topH), mat(fmap));
      fr.position.set(side * (W / 2 - 0.1), galleryBase + galleryH + topH / 2, L / 2);
      fr.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      fr.name = 'frieze';
      group.add(fr);
      const ledge = new THREE.Mesh(new THREE.BoxGeometry(0.55 * H, 0.14 * H, L - 0.8 * H), stoneDark);
      ledge.position.set(side * (W / 2 - 0.38 * H), galleryBase, L / 2);
      ledge.name = 'gallery';
      group.add(ledge);
    });

    const nicheBacks = [];
    const nicheJambs = [];
    const nicheLintels = [];
    const backGeo = new THREE.PlaneGeometry(alcoveW * 0.92, alcoveH * 0.92);
    const jambGeo = new THREE.BoxGeometry(0.42 * H, alcoveH, 0.12 * H);
    const lintelGeo = new THREE.BoxGeometry(0.42 * H, 0.18 * H, alcoveW);
    [-1, 1].forEach(function (side) {
      alcoveZs.forEach(function (z) {
        dummy.position.set(side * (W / 2 + 0.08 * H), alcoveSill + alcoveH / 2, z);
        dummy.rotation.set(0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        nicheBacks.push(dummy.matrix.clone());
        [-1, 1].forEach(function (k) {
          dummy.position.set(side * (W / 2 - 0.18 * H), alcoveSill + alcoveH / 2, z + k * (alcoveW / 2));
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          nicheJambs.push(dummy.matrix.clone());
        });
        dummy.position.set(side * (W / 2 - 0.18 * H), alcoveSill + alcoveH, z);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        nicheLintels.push(dummy.matrix.clone());
      });
    });
    function addInstances(geo, material, matrices, name) {
      const mesh = new THREE.InstancedMesh(geo, material, matrices.length);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      matrices.forEach(function (m, i) { mesh.setMatrixAt(i, m); });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
      return mesh;
    }
    addInstances(backGeo, mat(tex[FILES.wall].clone(), { color: 0x5c4c40 }), nicheBacks, 'alcove');
    addInstances(jambGeo, stoneDark, nicheJambs, 'alcove-jamb');
    addInstances(lintelGeo, stoneDark, nicheLintels, 'alcove-lintel');

    const gArchZ = [];
    for (let i = 0; i < 8; i++) gArchZ.push((2.2 + i * 3.35) * H);
    const gPiers = [];
    const gHoles = [];
    const pierGeo = new THREE.BoxGeometry(0.16 * H, galleryH * 0.82, 0.16 * H);
    const holeGeo = new THREE.PlaneGeometry(1.15 * H, galleryH * 0.62);
    [-1, 1].forEach(function (side) {
      gArchZ.forEach(function (z) {
        dummy.position.set(side * (W / 2 - 0.16 * H), galleryBase + galleryH * 0.48, z);
        dummy.rotation.set(0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0);
        dummy.updateMatrix();
        gHoles.push(dummy.matrix.clone());
        [-1, 1].forEach(function (k) {
          dummy.position.set(side * (W / 2 - 0.28 * H), galleryBase + 0.2 * H + galleryH * 0.4, z + k * 0.72 * H);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          gPiers.push(dummy.matrix.clone());
        });
      });
    });
    const holeMat = new THREE.MeshBasicMaterial({ color: 0xffe2b8, transparent: true, opacity: 0.22, depthWrite: false });
    addInstances(holeGeo, holeMat, gHoles, 'gallery-arch');
    addInstances(pierGeo, stoneDark, gPiers, 'gallery-pier');

    const shaftMat = new THREE.MeshBasicMaterial({ color: 0xffe6c0, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const shaftGeo = new THREE.PlaneGeometry(1, 1);
    const shafts = [];
    const up = new THREE.Vector3(0, 1, 0);
    [-1, 1].forEach(function (side) {
      [7.4, 13.6, 19.6].forEach(function (zH) {
        const x0 = side * (W / 2 - 0.2 * H), y0 = galleryBase + galleryH * 0.45, z0 = zH * H;
        const x1 = side * 1.4 * H, y1 = 0.35 * H, z1 = z0 + 1.2 * H;
        const dir = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0);
        const len = dir.length();
        dummy.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        dummy.quaternion.setFromUnitVectors(up, dir.normalize());
        dummy.scale.set(1.15 * H, len, 1);
        dummy.updateMatrix();
        shafts.push(dummy.matrix.clone());
      });
    });
    addInstances(shaftGeo, shaftMat, shafts, 'light-shaft');

    const plinthH = CONFIG.plinthHeightH * H;
    const plinthW = Math.min(1.45 * H, Math.max(colSize.x * 1.05, 1.05 * H));
    const plinthGeo = new THREE.BoxGeometry(plinthW, plinthH, plinthW);
    plinthGeo.translate(0, plinthH / 2, 0);
    const plinthMats = [];
    const torchSrc = [assets.torchWood, assets.torchBlack];
    colLocalZ.forEach(function (zH, i) {
      [-1, 1].forEach(function (side) {
        const prefab = prefabs[i % prefabs.length];
        const rig = new THREE.Group();
        rig.name = 'column';
        const col = prefab.clone(true);
        col.position.y = plinthH;
        rig.add(col);
        rig.position.set(side * colLocalX[i] * H, 0, zH * H);
        if (side < 0) rig.scale.x = -1;
        group.add(rig);
        columns.push(rig);
        dummy.position.set(side * colLocalX[i] * H, 0, zH * H);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        plinthMats.push(dummy.matrix.clone());
        if (i % 2 === 0) {
          const torch = wrapFitted(torchSrc[(i + (side < 0 ? 1 : 0)) % 2].scene.clone(true), 1.15 * H);
          torch.name = 'torch';
          torch.position.set(side * (colLocalX[i] * H - colSize.x * 0.42), plinthH + 1.25 * H, zH * H);
          torch.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
          const flame = flameSprite();
          flame.position.set(0, 1.05 * H, 0.05 * H);
          flame.scale.setScalar(0.5 * H);
          flame.userData.base = 0.5 * H;
          flame.userData.seed = i + side;
          flame.name = 'flame';
          torch.add(flame);
          flames.push(flame);
          group.add(torch);
        }
      });
    });
    addInstances(plinthGeo, stoneDark, plinthMats, 'plinth');

    const northMap = tiledMap(tex[FILES.wall], W / tile, CH / tile);
    const endWall = new THREE.Mesh(new THREE.PlaneGeometry(W, CH), mat(northMap));
    endWall.position.set(0, CH / 2, L - 0.04);
    endWall.rotation.y = Math.PI;
    endWall.name = 'north-wall';
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

    const hemi = new THREE.HemisphereLight(0xffc896, 0x3a2a22, 0.7);
    group.add(hemi);
    lights = [];
    const pointSpots = [
      [0, topY + 2.3 * H, throneZ - 0.4 * H, 1.7, 9 * H],
      [-2.4 * H, 2.5 * H, 8 * H, 1.35, 8 * H],
      [2.6 * H, 2.5 * H, 13.5 * H, 1.35, 8 * H],
      [-2.2 * H, 2.6 * H, 18.5 * H, 1.25, 8 * H],
      [0, topY + 1.8 * H, stairFootZ - 1.2 * H, 1.4, 9 * H]
    ];
    pointSpots.forEach(function (s, i) {
      if (i >= CONFIG.lightCount) return;
      const pl = new THREE.PointLight(0xffb46a, s[3], s[4], 2);
      pl.position.set(s[0], s[1], s[2]);
      pl.castShadow = false;
      pl.userData.base = pl.intensity;
      pl.userData.seed = i * 1.7;
      group.add(pl);
      lights.push(pl);
    });

    const TYPE_COLOR = {
      lionWinged: 0xd4652f, pedestal: 0xa0845c, brazier: 0xe07a2f, lantern: 0xf0c14a,
      banner: 0x2f6fbe, statueAlcove: 0xc49a7a, tableLow: 0x8d6b4a, benchCushion: 0xa33b48, vase: 0x3e7d9a
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
      const g = new THREE.PlaneGeometry(h * 0.23, h);
      g.translate(0, h / 2, 0);
      return g;
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
        stamp(slot, lanternGeo(slot.targetHeightH * H), phMat(slot.type, 'gold'), 'prop:' + slot.id);
        const chainH = Math.max(0.3 * H, CH - 6.7 * H);
        const chainGeo = new THREE.CylinderGeometry(0.015 * H, 0.015 * H, chainH, 4);
        chainGeo.translate(0, chainH / 2, 0);
        const chains = new THREE.InstancedMesh(chainGeo, phMat(slot.type), slot.positions.length);
        chains.name = 'lantern-chain';
        chains.frustumCulled = false;
        slot.positions.forEach(function (p, i) {
          dummy.position.set(p[0] * H, p[1] * H + slot.targetHeightH * H, p[2] * H);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          chains.setMatrixAt(i, dummy.matrix);
          const f = flameSprite();
          f.position.set(p[0] * H, p[1] * H + slot.targetHeightH * H * 0.45, p[2] * H);
          const sc = 0.28 * H;
          f.scale.setScalar(sc);
          f.userData.base = sc;
          f.userData.seed = i + 2;
          f.name = 'flame';
          group.add(f);
          flames.push(f);
        });
        chains.instanceMatrix.needsUpdate = true;
        group.add(chains);
        (slotMeshes[slot.id] || (slotMeshes[slot.id] = [])).push(chains);
      },
      banner: function (slot) {
        const h = slot.targetHeightH * H;
        stamp(slot, clothGeo(h), phMat(slot.type), 'prop:' + slot.id);
        stamp(slot, discGeo(h), phMat(slot.type, 'disc'), 'prop:' + slot.id + ':disc');
      },
      statueAlcove: function (slot) { stamp(slot, statueGeo(slot.targetHeightH * H), phMat(slot.type), 'prop:' + slot.id); },
      tableLow: function (slot) { stamp(slot, tableGeo(slot.targetHeightH * H), phMat(slot.type), 'prop:' + slot.id); },
      benchCushion: function (slot) {
        stamp(slot, benchGeo(slot.targetHeightH * H), phMat(slot.type), 'prop:' + slot.id);
        stamp(slot, cushionGeo(slot.targetHeightH * H), phMat(slot.type, 'cushion'), 'prop:' + slot.id + ':cushion');
      },
      vase: function (slot) { stamp(slot, vaseGeo(slot.targetHeightH * H), phMat(slot.type), 'prop:' + slot.id); }
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
      const gltf = slot.glbPath && assets.props && assets.props[slot.glbPath];
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
    [-1, 1].forEach(function (side) { worldBox(new THREE.Vector3(side * (W / 2) - 0.45, 0, 0), new THREE.Vector3(side * (W / 2) + 0.45, CH, L)); });
    worldBox(new THREE.Vector3(-W / 2, 0, L - 0.45), new THREE.Vector3(W / 2, CH, L + 0.45));
    worldBox(new THREE.Vector3(-W / 2, 0, -0.45), new THREE.Vector3(-portal.width / 2, CH, 0.4));
    worldBox(new THREE.Vector3(portal.width / 2, 0, -0.45), new THREE.Vector3(W / 2, CH, 0.4));
    const hx = stairW / 2;
    worldBox(new THREE.Vector3(-hx - 0.3 * H, 0, platformFrontZ), new THREE.Vector3(-hx + 0.04 * H, topY + H, L));
    worldBox(new THREE.Vector3(hx - 0.04 * H, 0, platformFrontZ), new THREE.Vector3(hx + 0.3 * H, topY + H, L));
    colLocalZ.forEach(function (zH, i) {
      [-1, 1].forEach(function (side) {
        const px = side * colLocalX[i] * H;
        const pz = zH * H;
        const rad = Math.min(plinthW * 0.46, 0.55 * H);
        worldBox(new THREE.Vector3(px - rad, 0, pz - rad), new THREE.Vector3(px + rad, CONFIG.columnHeightH * H + plinthH, pz + rad));
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
    columns.forEach(function (c, i) { const b = new THREE.Box3().setFromObject(c); watchBox('column' + i, b.min, b.max); });
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
      const pair = [a, b].sort().join('+');
      return pair === 'lionWinged+pedestal' || pair === 'lionWingedThrone+pedestalThrone';
    }
    for (let i = 0; i < watch.length; i++) {
      for (let j = i + 1; j < watch.length; j++) {
        const a = watch[i], b = watch[j];
        if (allowOverlap(a.name, b.name)) continue;
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
    let geomDraws = 0, geomTris = 0;
    group.traverse(function (o) {
      if (o.isSprite) { geomDraws++; return; }
      if (!o.isMesh || !o.geometry) return;
      geomDraws++;
      const g = o.geometry;
      const t = g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
      geomTris += t * (o.isInstancedMesh ? o.count : 1);
    });
    let blockedZ = -1;
    for (let z = 0.6 * H; z < stairFootZ - 0.2 * H; z += 0.45 * H) {
      if (blocks(ox, oz + z)) { blockedZ = z; break; }
    }
    note('hall built lights=' + (lights.length + 1) + ' draws~' + geomDraws + ' tris~' + Math.round(geomTris) + ' centerBlock=' + (blockedZ < 0 ? 'clear' : blockedZ.toFixed(1)));
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
    if (!ramp || !Number.isFinite(x) || !Number.isFinite(z)) return floorY;
    const lx = x - portalX;
    const lz = z - portalFront;
    let h = 0;
    if (lx >= ramp.x0 && lx <= ramp.x1) {
      if (lz >= ramp.z1 && lz <= ramp.zPlat) h = ramp.yTop;
      else if (lz > ramp.z0 && lz < ramp.z1) h = ramp.yTop * ((lz - ramp.z0) / Math.max(0.001, ramp.z1 - ramp.z0));
    }
    return floorY + h;
  }

  let lastDt = 0.016;
  function tick(dt, ctx) {
    lastDt = dt;
    clock += dt;
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
      ctx.hero.position.z += ((CONFIG.autoWalkH * H) / CONFIG.fadeOutSeconds) * dt;
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
        build(ctx);
        hallBuilt = true;
        placeHero(ctx);
        renderUI();
        if (ctx.renderer.compile) {
          try { ctx.renderer.compile(ctx.scene, ctx.camera); }
          catch (compileErr) { note('compile ' + (compileErr && compileErr.message)); }
        }
        ctx.renderer.render(ctx.scene, ctx.camera);
        warmFrame = true;
        renderUI();
        note('warm frame percent=' + shownPercent());
        state = 'REVEAL';
        fadeT = 0;
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
        state = 'DONE';
        note('done');
        renderDebug();
      }
      return;
    }
    if (state === 'DONE') {
      const lx = ctx.hero.position.x - portalX;
      const lz = ctx.hero.position.z - portalFront;
      occupant = lz >= -0.08 && lz <= hallLen + 0.4 && Math.abs(lx) <= hallW / 2 + 0.2;
      if (group) group.visible = occupant;
      setExteriorVisible(ctx.scene, !occupant);
      if (occupant) ctx.hero.position.y = floorAt(ctx.hero.position.x, ctx.hero.position.z);
      for (const L of lights) {
        const n = Math.sin(clock * 3.1 + L.userData.seed) * .6 + Math.sin(clock * 7.7 + L.userData.seed * 2) * .4;
        L.intensity = L.userData.base * (1 + CONFIG.torchFlicker * n);
      }
      for (let i = 0; i < flames.length; i++) {
        const f = flames[i];
        const n = Math.sin(clock * 9 + f.userData.seed) * 0.5 + Math.sin(clock * 17 + f.userData.seed) * 0.5;
        const s = (f.userData.base || 1) * (1 + 0.12 * n);
        f.scale.setScalar(s);
      }
      if (ctx.renderer && ctx.renderer.info && ctx.renderer.info.render) {
        const inf = ctx.renderer.info.render;
        if (inf.calls) perfNote = 'calls=' + inf.calls + ' tris=' + inf.triangles;
      }
    }
  }

  function blocks(x, z) {
    const active = state === 'FADING_IN' || state === 'REVEAL' || state === 'SETUP' || (state === 'DONE' && occupant);
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
    if (state === 'IDLE' || state === 'FAILED' || state === 'FADING_OUT' || state === 'LOADING') return;
    if (state === 'DONE' && !occupant) return;
    const p = hero.isObject3D ? hero.position : hero;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return;
    const ox = p.x, oy = p.y + 1.45, oz = p.z;
    const savedCam = cam.position.clone();
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
    if (![cam.position.x, cam.position.y, cam.position.z].every(Number.isFinite)) cam.position.copy(savedCam);
  }

  window.PalaceInterior = {
    CONFIG: CONFIG,
    BUILD: BUILD,
    tick: tick,
    locksControl: function () { return state === 'FADING_OUT' || state === 'LOADING' || state === 'SETUP' || state === 'REVEAL' || state === 'FADING_IN' || state === 'FAILED'; },
    ownsCamera: function () { return state === 'FADING_OUT' || state === 'LOADING' || state === 'SETUP' || state === 'REVEAL' || state === 'FADING_IN' || state === 'FAILED'; },
    ownsGround: function () { return state === 'FADING_OUT' || state === 'LOADING' || state === 'SETUP' || state === 'REVEAL' || state === 'FADING_IN' || state === 'FAILED' || (state === 'DONE' && occupant); },
    blocks: blocks,
    constrainCamera: constrainCamera,
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
    metrics: function () { return { H: H, length: hallLen, width: hallW, front: portalFront, x: portalX, state: state, occupant: occupant, lights: lights.length + 1, ramp: ramp ? ramp.yTop : 0 }; }
  };
  if (debugOn()) { ensureLoadScreen(); renderDebug(); }
})();
