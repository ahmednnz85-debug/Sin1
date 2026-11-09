/* Opt-in performance laboratory. Loaded before the game bootstrap; dormant unless ?debug=1. */
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  if (params.get('debug') !== '1') return;

  var flags = {
    fireOff: false,
    lightsOff: false,
    gradeFogOff: false,
    pixelScale: 1
  };
  var samples = [];
  var records = [];
  var activeRecord = null;
  var frameStamp = null;
  var frameTotalJS = 0;
  var frameRenderJS = 0;
  var latestCalls = 0;
  var latestTris = 0;
  var rendererSet = new Set();
  var lastFinalizedAt = 0;
  var rafOriginal = window.requestAnimationFrame.bind(window);
  var renderOriginal = THREE.WebGLRenderer.prototype.render;
  var setPixelRatioOriginal = THREE.WebGLRenderer.prototype.setPixelRatio;

  function finishFrame(ts) {
    if (frameStamp === null) return;
    var delta = ts - frameStamp;
    if (delta > 0 && delta < 2000) {
      var item = { dt: delta, js: frameTotalJS, render: frameRenderJS, calls: latestCalls, tris: latestTris };
      samples.push(item);
      item.ts = ts;
      while (samples.length && ts - samples[0].ts > 12000) samples.shift();
      lastFinalizedAt = ts;
      if (activeRecord) activeRecord.data.push(item);
    }
  }

  window.requestAnimationFrame = function (callback) {
    return rafOriginal(function (ts) {
      if (frameStamp !== ts) {
        finishFrame(ts);
        frameStamp = ts;
        frameTotalJS = 0;
        frameRenderJS = 0;
      }
      var start = performance.now();
      try { callback(ts); }
      finally { frameTotalJS += performance.now() - start; }
    });
  };

  THREE.WebGLRenderer.prototype.setPixelRatio = function (ratio) {
    this.__perfLabRequestedPixelRatio = ratio;
    return setPixelRatioOriginal.call(this, ratio * flags.pixelScale);
  };

  function matchesFire(o) {
    return /fire|flame|ember|glow|torch|brazier|مشعل|نار|لهب|جمر/i.test(String(o.name || '')) && (o.isMesh || o.isPoints || o.isLine);
  }

  THREE.WebGLRenderer.prototype.render = function (scene, camera) {
    rendererSet.add(this);
    var visibility = [];
    var intensities = [];
    var fog = scene && scene.fog;
    var fogDensity = fog && 'density' in fog ? fog.density : null;
    var grade = document.getElementById('grade');
    var gradeDisplay = grade ? grade.style.display : null;

    if (scene && flags.fireOff) scene.traverse(function (o) {
      if (matchesFire(o) && o.visible) { visibility.push([o, o.visible]); o.visible = false; }
    });
    if (scene && flags.lightsOff) scene.traverse(function (o) {
      if (o.isLight && o.intensity !== 0) { intensities.push([o, o.intensity]); o.intensity = 0; }
    });
    if (fog && flags.gradeFogOff && 'density' in fog) fog.density = 0;
    if (grade && flags.gradeFogOff) grade.style.display = 'none';

    var start = performance.now();
    try {
      return renderOriginal.call(this, scene, camera);
    } finally {
      frameRenderJS += performance.now() - start;
      if (this.info && this.info.render) {
        latestCalls = this.info.render.calls || 0;
        latestTris = this.info.render.triangles || 0;
      }
      for (var i = 0; i < visibility.length; i++) visibility[i][0].visible = visibility[i][1];
      for (var j = 0; j < intensities.length; j++) intensities[j][0].intensity = intensities[j][1];
      if (fogDensity !== null) fog.density = fogDensity;
      if (grade) grade.style.display = gradeDisplay;
    }
  };

  var panel = document.createElement('section');
  panel.id = 'sin-perf-lab';
  panel.style.cssText = 'position:fixed;z-index:100000;right:8px;top:8px;width:min(380px,calc(100vw - 16px));max-height:calc(100dvh - 16px);overflow:auto;padding:10px;color:#f7ead5;background:rgba(14,12,11,.94);border:1px solid #b89565;border-radius:8px;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 6px 30px #0008;';
  panel.innerHTML = '<strong>مختبر الأداء (?debug=1)</strong><pre id="perf-lab-metrics" style="white-space:pre-wrap;margin:6px 0">تهيئة القياس…</pre>' +
    '<label>تجربة الدقة: <select id="perf-pixels"><option value="1">الأساس (×1)</option><option value="0.7">×0.70</option><option value="0.5">×0.50</option></select></label>' +
    '<label style="display:block"><input type="checkbox" data-flag="fireOff"> إخفاء نيران المشاعل/المباخر</label>' +
    '<label style="display:block"><input type="checkbox" data-flag="lightsOff"> شدة الأضواء = 0</label>' +
    '<label style="display:block"><input type="checkbox" data-flag="gradeFogOff"> إيقاف #grade والضباب (دون تبديل الشيدر)</label>' +
    '<label>النقطة: <select id="perf-point"><option>ساحة الطريق — courtyard</option><option>قاعة العرش</option><option>أول ممر الأجنحة</option></select></label>' +
    '<button id="perf-record">تسجيل 10 ثوانٍ</button> <button id="perf-clear">مسح القياسات</button> <button id="perf-csv">تصدير CSV</button>' +
    '<label>antialias: <select id="perf-aa"><option value="1">ON</option><option value="0">OFF</option></select></label> ' +
    '<label>P3: <select id="perf-p3"><option value="0">OFF</option><option value="1">ON (إن كان مدعومًا)</option></select></label>' +
    '<div id="perf-lab-status" style="margin-top:6px;color:#e1bd86">شغّل كل تجربة منفردة ثم سجّل القياس عند النقطة المختارة.</div>' +
    '<small id="perf-colour"></small>';
  document.body.appendChild(panel);
  var metricsEl = document.getElementById('perf-lab-metrics');
  var statusEl = document.getElementById('perf-lab-status');

  function percentileSummary(data) {
    if (!data.length) return null;
    var sorted = data.slice().sort(function (a, b) { return a.dt - b.dt; });
    var avgDt = data.reduce(function (a, x) { return a + x.dt; }, 0) / data.length;
    var slowCount = Math.max(1, Math.ceil(data.length * 0.01));
    var slow = sorted.slice(sorted.length - slowCount);
    var slowDt = slow.reduce(function (a, x) { return a + x.dt; }, 0) / slow.length;
    var js = data.reduce(function (a, x) { return a + x.js; }, 0) / data.length;
    var render = data.reduce(function (a, x) { return a + x.render; }, 0) / data.length;
    var calls = data.reduce(function (a, x) { return a + x.calls; }, 0) / data.length;
    var tris = data.reduce(function (a, x) { return a + x.tris; }, 0) / data.length;
    return { frames: data.length, fps: 1000 / avgDt, frameMs: avgDt, p1Ms: slowDt, low1: 1000 / slowDt, js: js, update: Math.max(0, js - render), render: render, calls: calls, tris: tris };
  }

  function renderSummary() {
    var s = percentileSummary(samples);
    var info = rendererSet.size ? Array.from(rendererSet)[0].info.render : null;
    var gpu = 'n/a (WebGL timer query غير مقاس هنا)';
    if (!s) { metricsEl.textContent = 'بانتظار أول إطارات اللعبة…'; return; }
    metricsEl.textContent = 'FPS متوسط: ' + s.fps.toFixed(1) + ' | 1% low: ' + s.low1.toFixed(1) + '\n' +
      'الإطار الإجمالي: ' + s.frameMs.toFixed(2) + ' ms | أسوأ 1%: ' + s.p1Ms.toFixed(2) + ' ms\n' +
      'JS/إطار: ' + s.js.toFixed(2) + ' ms (update≈' + s.update.toFixed(2) + ' + render JS ' + s.render.toFixed(2) + ')\n' +
      'Draw calls: ' + (info ? info.calls : s.calls).toFixed(0) + ' | triangles: ' + (info ? info.triangles : s.tris).toFixed(0) + '\n' + gpu + ' | الإطارات: ' + s.frames;
  }

  panel.querySelectorAll('[data-flag]').forEach(function (input) {
    input.addEventListener('change', function () {
      flags[input.dataset.flag] = input.checked;
    });
  });
  window.__perfLab = { flags: flags, samples: samples, records: records, summary: percentileSummary };
  document.getElementById('perf-pixels').addEventListener('change', function (ev) {
    flags.pixelScale = Number(ev.target.value) || 1;
    rendererSet.forEach(function (r) {
      var size = r.getSize(new THREE.Vector2());
      r.setPixelRatio(r.__perfLabRequestedPixelRatio || 1);
      r.setSize(size.x, size.y, false);
    });
  });
  document.getElementById('perf-record').addEventListener('click', function () {
    if (activeRecord) return;
    var point = document.getElementById('perf-point').value;
    var flagsNow = JSON.stringify(flags);
    activeRecord = { point: point, flags: flagsNow, data: [], started: performance.now() };
    statusEl.textContent = 'يسجل الآن: ' + point + ' — 10 ثوانٍ…';
    window.setTimeout(function () {
      if (!activeRecord) return;
      var rec = activeRecord;
      activeRecord = null;
      var s = percentileSummary(rec.data);
      if (!s) { statusEl.textContent = 'لم تتوفر إطارات كافية.'; return; }
      records.push({ point: rec.point, flags: rec.flags, fps: s.fps, low1: s.low1, frameMs: s.frameMs, p1Ms: s.p1Ms, js: s.js, update: s.update, render: s.render, calls: s.calls, tris: s.tris, frames: s.frames });
      statusEl.textContent = 'اكتمل ' + rec.point + ': ' + s.fps.toFixed(1) + ' FPS، 1% low ' + s.low1.toFixed(1) + '، JS ' + s.js.toFixed(2) + ' ms.';
    }, 10000);
  });
  document.getElementById('perf-clear').addEventListener('click', function () { records.length = 0; statusEl.textContent = 'مُسحت سجلات القياس.'; });
  document.getElementById('perf-csv').addEventListener('click', function () {
    var rows = [['point','flags','fps_avg','fps_1pct_low','frame_ms_avg','worst_1pct_frame_ms','js_ms','update_ms','render_js_ms','draw_calls','triangles','frames']];
    records.forEach(function (r) { rows.push([r.point,r.flags,r.fps.toFixed(2),r.low1.toFixed(2),r.frameMs.toFixed(3),r.p1Ms.toFixed(3),r.js.toFixed(3),r.update.toFixed(3),r.render.toFixed(3),r.calls.toFixed(0),r.tris.toFixed(0),r.frames]); });
    var csv = rows.map(function (r) { return r.map(function (x) { return '"' + String(x).replace(/"/g,'""') + '"'; }).join(','); }).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'sin1-performance.csv'; a.click(); URL.revokeObjectURL(a.href);
  });

  var p3Supported = (function () { try { var c = document.createElement('canvas'); var gl = c.getContext('webgl2'); return !!gl && 'drawingBufferColorSpace' in gl; } catch (_) { return false; } })();
  var aaSelect = document.getElementById('perf-aa'); aaSelect.value = params.get('aa') === '0' ? '0' : '1';
  var p3Select = document.getElementById('perf-p3'); p3Select.value = params.get('p3') === '1' ? '1' : '0'; p3Select.disabled = !p3Supported;
  function reloadWith(key, value) { var q = new URLSearchParams(location.search); q.set(key, value); q.set('debug', '1'); location.search = q.toString(); }
  aaSelect.addEventListener('change', function () { reloadWith('aa', aaSelect.value); });
  p3Select.addEventListener('change', function () { if (p3Supported) reloadWith('p3', p3Select.value); });
  document.getElementById('perf-colour').textContent = 'تغيير AA يعيد تحميل السياق؛ P3 ' + (p3Supported ? 'قابل للتبديل عبر reload' : 'غير مدعوم في WebGL بهذا المتصفح/الجهاز.');
  window.setInterval(renderSummary, 250);
})();
