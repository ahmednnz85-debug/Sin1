/* Sîn Developer Hub — TEMPORARY developer tool, removable in one step.
   ---------------------------------------------------------------------------
   CENTRAL SWITCH: set ENABLED to false (or delete this file and its
   <script> tag) and the game boots exactly as before: the index.html hook
   falls back to the original init().

   Areas: read from the core registry sin-areas.js (see AGENTS.md); this
   module keeps no list of its own.

   What it does (only when ENABLED):
     • Normal link: an entry screen before any world asset loads.
         "بدء اللعبة" → the original init() and story, unchanged.
         "وضع المطور" → the area menu, built from SinAreas.
     • ?dev=1&level=<id>: boots straight into that area, no menu, no story.
         outdoor: original boot, story start skipped, Sîn placed at the spawn.
         palace : the existing quick hall path (startInHall + royalDoorTest:
                  minimal exterior, released at the door), then the game's own
                  PalaceWings.teleport into the room.
         r3     : as palace, then Sîn crosses passage-L0 through the real R3
                  transition (palace retired), then is placed in the section.
     • Dev sessions keep their own storage (prefix "sin-dev:") so the
       player's real settings, discoveries and crash records are never read
       or written by a developer session.
     • Toolbar (dev sessions only): areas, reload, respawn, FPS, memory,
       free camera, collision view, clean frame (hide HUD), copy link.

   The game never calls into this module; it only reads window.SinDevHub in
   the single boot hook. Nothing here edits game systems, assets or the hero. */
(function (root) {
  'use strict';
  const ENABLED = true;           // ← central switch
  const PREFIX = 'sin-dev:';
  const AUTOMATION = ['startInHall', 'royalDoorTest', 'royalDoorDebug', 'play'];

  const qs = new URLSearchParams(root.location ? root.location.search : '');
  const devSession = ENABLED && qs.get('dev') === '1';
  // Areas come from the game's core registry (sin-areas.js), never from a
  // list kept here: whatever the game registers appears in the menu.
  let areas = [], byId = new Map();
  async function catalog() {
    if (!root.SinAreas) throw new Error('SinAreas registry missing');
    areas = await SinAreas.list();
    byId = new Map(areas.map(a => [a.id, a]));
    if (areas.errors && areas.errors.length) console.warn('[dev-hub] registry', areas.errors);
    return areas;
  }

  // ---- storage isolation (must run before any game script reads storage) --
  function isolateStorage(proto) {
    if (!proto || proto.__sinDevIsolated) return;
    const get = proto.getItem, set = proto.setItem, del = proto.removeItem;
    proto.getItem = function (k) { return get.call(this, PREFIX + k); };
    proto.setItem = function (k, v) { return set.call(this, PREFIX + k, v); };
    proto.removeItem = function (k) { return del.call(this, PREFIX + k); };
    proto.__sinDevIsolated = true;
  }
  if (devSession && typeof Storage !== 'undefined') isolateStorage(Storage.prototype);

  // ---- links -------------------------------------------------------------
  function link(id, absolute) {
    const path = 'index.html?dev=1&level=' + encodeURIComponent(id);
    if (!absolute || !root.location) return '?dev=1&level=' + encodeURIComponent(id);
    return new URL(path, root.location.href).href;
  }

  // ---- small DOM helpers ---------------------------------------------------
  const doc = root.document;
  const el = (tag, attrs, html) => { const e = doc.createElement(tag); if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function style() {
    if (doc.getElementById('sin-dev-style')) return;
    const s = el('style', { id: 'sin-dev-style' });
    s.textContent = `
#sin-dev-gate{position:fixed;inset:0;z-index:13000;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at 50% 35%,#46301a,#080604 70%);color:#ead9b8;
  font-family:Georgia,'Times New Roman',serif;padding:calc(16px + env(safe-area-inset-top,0px)) calc(16px + env(safe-area-inset-right,0px)) calc(16px + env(safe-area-inset-bottom,0px)) calc(16px + env(safe-area-inset-left,0px));box-sizing:border-box;overflow:auto;-webkit-tap-highlight-color:transparent}
#sin-dev-gate *{box-sizing:border-box}
#sin-dev-gate .card{width:min(560px,100%);text-align:center}
#sin-dev-gate .mark{font-size:clamp(44px,9vw,76px);letter-spacing:.32em;color:#e1b76f;text-shadow:0 0 24px rgba(225,183,111,.35);margin-right:-.32em}
#sin-dev-gate .sub{font-size:12px;letter-spacing:.42em;color:#a98d61;margin:6px 0 26px}
#sin-dev-gate button{font:inherit;cursor:pointer;touch-action:manipulation}
#sin-dev-gate .choice{display:block;width:100%;min-height:58px;margin:10px 0;padding:12px 18px;border:1px solid rgba(225,183,111,.55);
  background:rgba(20,14,9,.72);color:#f1e2c4;font-size:18px;border-radius:3px;transition:background .15s,border-color .15s}
#sin-dev-gate .choice small{display:block;font-size:12px;color:#b39a70;margin-top:3px;letter-spacing:.08em}
#sin-dev-gate .choice:hover,#sin-dev-gate .choice:focus-visible{background:rgba(64,42,20,.86);border-color:#e1b76f;outline:none}
#sin-dev-gate .primary{background:linear-gradient(#6b4a22,#3c2812);border-color:#e1b76f}
#sin-dev-gate .note{font-size:11px;color:#8f7a59;margin-top:14px;direction:rtl}
#sin-dev-list{width:min(720px,100%);text-align:right;direction:rtl}
#sin-dev-list .bar{display:flex;gap:8px;align-items:center;margin-bottom:12px}
#sin-dev-list .bar h2{flex:1;margin:0;font-size:20px;color:#e1b76f;font-weight:normal}
#sin-dev-list .bar button,#sin-dev-list .area{border:1px solid rgba(225,183,111,.42);background:rgba(20,14,9,.75);color:#efdfc0;border-radius:3px}
#sin-dev-list .bar button{min-height:44px;padding:0 14px}
#sin-dev-list input{width:100%;min-height:44px;margin-bottom:10px;padding:0 12px;background:rgba(10,8,6,.8);border:1px solid rgba(225,183,111,.35);color:#efdfc0;font:inherit;font-size:16px;border-radius:3px}
#sin-dev-list details{margin:6px 0;border:1px solid rgba(225,183,111,.22);border-radius:3px;background:rgba(14,10,7,.55)}
#sin-dev-list summary{cursor:pointer;min-height:46px;display:flex;align-items:center;gap:8px;padding:0 14px;font-size:16px;color:#e6c98f;list-style:none}
#sin-dev-list summary::-webkit-details-marker{display:none}
#sin-dev-list summary::before{content:'▸';transition:transform .15s;color:#a98d61}
#sin-dev-list details[open] summary::before{transform:rotate(90deg)}
#sin-dev-list summary .count{margin-right:auto;font-size:12px;color:#8f7a59}
#sin-dev-list .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px;padding:4px 10px 12px}
#sin-dev-list .area{display:flex;align-items:center;gap:10px;min-height:48px;padding:6px 10px;text-align:right;font:inherit}
#sin-dev-list .area:hover,#sin-dev-list .area:focus-visible{border-color:#e1b76f;background:rgba(64,42,20,.8);outline:none}
#sin-dev-list .area code{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#e1b76f;direction:ltr;min-width:46px}
#sin-dev-list .area span{display:flex;flex-direction:column;line-height:1.25}
#sin-dev-list .area em{font-style:normal;font-size:11px;color:#9c8662;direction:ltr;text-align:right}
#sin-dev-tool{position:fixed;z-index:12500;top:calc(6px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);display:flex;gap:6px;align-items:center;font:12px/1 ui-monospace,Menlo,monospace;direction:ltr}
#sin-dev-tool>button{min-height:34px;padding:0 12px;border:1px solid rgba(225,183,111,.6);background:rgba(12,9,6,.78);color:#e1b76f;border-radius:3px;font:inherit;cursor:pointer;touch-action:manipulation}
#sin-dev-tool .tag{color:#efdfc0;background:rgba(12,9,6,.62);padding:9px 8px;border-radius:3px;white-space:nowrap}
#sin-dev-panel{position:fixed;z-index:12600;top:calc(46px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);width:min(560px,calc(100vw - 24px));max-height:calc(100vh - 60px);overflow:auto;
  background:rgba(10,8,6,.92);border:1px solid rgba(225,183,111,.5);border-radius:4px;padding:10px;display:none;direction:rtl;color:#efdfc0;font-family:Georgia,serif}
#sin-dev-panel.open{display:block}
#sin-dev-panel .tools{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px}
#sin-dev-panel .tools button{min-height:44px;border:1px solid rgba(225,183,111,.38);background:rgba(28,20,12,.85);color:#efdfc0;border-radius:3px;font:inherit;font-size:14px;cursor:pointer;touch-action:manipulation}
#sin-dev-panel .tools button.on{border-color:#e1b76f;background:rgba(92,62,26,.9);color:#fff3d6}
#sin-dev-panel .msg{font-size:12px;color:#b39a70;min-height:16px;margin-top:8px;direction:rtl}
#sin-dev-fps{position:fixed;z-index:12400;right:calc(8px + env(safe-area-inset-right,0px));top:calc(48px + env(safe-area-inset-top,0px));font:12px ui-monospace,Menlo,monospace;color:#b8f5a0;background:rgba(0,0,0,.6);padding:5px 7px;border-radius:3px;pointer-events:none;white-space:pre;direction:ltr}
#sin-dev-status{position:fixed;z-index:13100;left:50%;bottom:calc(18px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);font:13px Georgia,serif;color:#ead9b8;background:rgba(10,8,6,.86);border:1px solid rgba(225,183,111,.45);padding:9px 14px;border-radius:3px;direction:rtl;pointer-events:none}
#sin-dev-fly{position:fixed;z-index:12450;left:50%;bottom:calc(10px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);font:11px ui-monospace,monospace;color:#efdfc0;background:rgba(0,0,0,.55);padding:5px 9px;border-radius:3px;pointer-events:none;direction:ltr}
html.sin-dev-clean #hud,html.sin-dev-clean #stick,html.sin-dev-clean #combat-pad,html.sin-dev-clean #hint,html.sin-dev-clean #wings-label,
html.sin-dev-clean #sin-dev-fps,html.sin-dev-clean #sin-dev-fly,html.sin-dev-clean .sin-build-stamp,html.sin-dev-clean #sin-dev-tool .tag{opacity:0!important;pointer-events:none}
html.sin-dev-clean #sin-dev-tool>button{opacity:.25}
@media (max-width:520px){#sin-dev-list .grid{grid-template-columns:1fr}#sin-dev-gate .choice{font-size:16px}}`;
    doc.head.appendChild(s);
  }

  // ---- entry screen ----------------------------------------------------------
  let gateEl = null;
  function showGate(start) {
    style();
    gateEl = el('div', { id: 'sin-dev-gate', role: 'dialog', 'aria-label': 'Sîn' });
    gateEl.innerHTML = `<div class="card">
      <div class="mark">SIN</div><div class="sub">THE CURSE OF BABYLON</div>
      <button class="choice primary" data-act="play">بدء اللعبة<small>START GAME · القصة الكاملة</small></button>
      <button class="choice" data-act="dev">وضع المطور<small>DEVELOPER MODE · الدخول المباشر للمناطق</small></button>
      <div class="note">وضع المطور أداة تطوير مؤقتة ولا يغيّر حفظ اللعبة.</div></div>`;
    gateEl.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.act === 'play') { gateEl.remove(); gateEl = null; start(); }
      if (b.dataset.act === 'dev') showList(gateEl, null);
    });
    doc.body.appendChild(gateEl);
    gateEl.querySelector('.primary').focus({ preventScroll: true });
  }
  // Menu of all registered areas, grouped and collapsible.
  function showList(host, onClose) {
    style();
    const wrap = el('div', { id: 'sin-dev-list' });
    wrap.innerHTML = '<div class="bar"><h2>وضع المطور · المناطق</h2></div><p>جارٍ قراءة سجل المناطق…</p>';
    const card = host.querySelector('.card'); if (card) card.style.display = 'none';
    host.appendChild(wrap);
    catalog().then(() => fillList(wrap, card, onClose), e => { wrap.querySelector('p').textContent = 'تعذّرت قراءة سجل المناطق: ' + e.message; });
  }
  function fillList(wrap, card, onClose) {
    const by = {};
    areas.forEach(a => (by[a.group] || (by[a.group] = [])).push(a));
    let html = `<div class="bar"><h2>وضع المطور · المناطق</h2><button data-act="back">${onClose ? 'إغلاق' : 'رجوع'}</button></div>
      <input type="search" placeholder="بحث: K3 ، المكتبة ، R3-02 …" aria-label="search">`;
    const declared = SinAreas.groups();
    declared.map(g => [g.id, g.ar, g.en]).concat(Object.keys(by).filter(g => !declared.some(x => x.id === g)).map(g => [g, g, g])).forEach(([g, ar, en]) => {
      const list = by[g]; if (!list) return;
      html += `<details ${g === 'outdoor' || g === 'hall' || g === 'r3' ? 'open' : ''} data-group="${esc(g)}"><summary>${esc(ar)} <em style="font-style:normal;font-size:12px;color:#8f7a59;direction:ltr">${esc(en)}</em><span class="count">${list.length}</span></summary><div class="grid">`;
      list.forEach(a => { html += `<button class="area" data-id="${esc(a.id)}"><code>${esc(a.id)}</code><span>${esc(a.ar)}<em>${esc(a.en)}</em></span></button>`; });
      html += '</div></details>';
    });
    if (areas.errors && areas.errors.length) html += `<p style="color:#d98c6a;font-size:12px;direction:ltr">${esc(areas.errors.join(' · '))}</p>`;
    wrap.innerHTML = html;
    wrap.querySelector('input').addEventListener('input', ev => {
      const q = ev.target.value.trim().toLowerCase();
      wrap.querySelectorAll('.area').forEach(b => { b.style.display = !q || b.textContent.toLowerCase().includes(q) ? '' : 'none'; });
      wrap.querySelectorAll('details').forEach(d => { if (q) d.open = true; });
    });
    wrap.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.act === 'back') { wrap.remove(); if (card) card.style.display = ''; if (onClose) onClose(); return; }
      if (b.dataset.id) go(b.dataset.id);
    });
  }

  // ---- navigation -------------------------------------------------------------
  // Another stage (or the R3 point of no return) means a fresh page: the
  // browser releases every CPU/GPU resource of the previous area. Inside the
  // palace, rooms switch in place through the game's own streaming.
  function go(id) {
    const a = byId.get(id); if (!a) return;
    if (session && session.area && a.stage === 'palace' && session.area.stage === 'palace' && session.ready && palaceLive()) {
      session.area = a;
      root.history.replaceState(null, '', link(id));
      enterPalace(a).then(() => status('')).catch(fail);
      refreshTag();
      return;
    }
    root.location.href = link(id);
  }

  // ---- boot hook (called by index.html) ---------------------------------------
  let session = null;
  function boot(start) {
    if (!ENABLED) return start();
    if (devSession && qs.get('level')) return startSession(qs.get('level'), start);
    if (devSession) { showGate(start); showList(gateEl, null); return; }
    if (AUTOMATION.some(k => qs.has(k))) return start();
    showGate(start);
  }
  async function startSession(id, start) {
    let a = null;
    try { await catalog(); a = byId.get(id); } catch (e) { console.error('[dev-hub]', e); }
    if (!a) { showGate(start); showList(gateEl, null); status('معرّف غير معروف: ' + id); return; }
    session = { area: a, ready: false, t0: performance.now(), log: [] };
    root.__sinDev = session;
    // Palace / R3 areas reuse the game's quick hall path (minimal exterior).
    if (a.stage !== 'outdoor') {
      const p = new URLSearchParams(root.location.search);
      p.set('startInHall', '1'); p.set('royalDoorTest', '1');
      root.history.replaceState(null, '', '?' + p.toString());
    }
    style();
    status('وضع المطور: تحميل ' + a.ar + ' (' + a.id + ')');
    start();
    enter(a).then(() => {
      session.ready = true; session.ms = Math.round(performance.now() - session.t0);
      root.history.replaceState(null, '', link(a.id));
      status(''); toolbar();
      console.info('[dev-hub] ready ' + a.id + ' in ' + session.ms + ' ms');
    }).catch(fail);
  }
  function fail(e) { console.error('[dev-hub]', e); status('تعذّر فتح المنطقة: ' + (e && e.message || e)); if (session) session.error = String(e && e.message || e); toolbar(); }

  // ---- area entry --------------------------------------------------------------
  // Read-only bridge handed over by index.html's boot hook (the game code is
  // private to its own function scope; the game never calls the hub).
  let game = null;
  function bind(api) { game = api; }
  const waitFor = (fn, ms = 900000, every = 100) => new Promise((ok, bad) => {
    const t0 = performance.now();
    (function poll() {
      let v; try { v = fn(); } catch (_) { v = false; }
      if (v) return ok(v);
      if (performance.now() - t0 > ms) return bad(new Error('timeout'));
      setTimeout(poll, every);
    })();
  });
  const frames = n => new Promise(r => { let k = 0; (function f() { if (++k >= n) r(); else requestAnimationFrame(f); })(); });
  const face = yaw => game.setFacing(yaw);   // the game's own setFacing contract
  function enter(a) {
    if (a.stage === 'outdoor') return enterOutdoor(a);
    if (a.stage === 'palace') return enterPalace(a);
    return enterR3(a);
  }
  async function enterOutdoor(a) {
    await waitFor(() => game && game.phase() === 'ready');
    game.start();                            // the normal "NEW GAME" start
    await frames(3);
    spawnOutdoor(a);
  }
  function spawnOutdoor(a) {
    const hero = game.hero(), blocked = game.blocked, ground = game.ground, cam = game.camera;
    let { x, z } = a.spawn;
    // Nearest free spot by the hero's own collision query.
    outer: for (let r = 0; r <= 6; r += 0.5) for (let k = 0; k < Math.max(1, r * 8); k++) {
      const t = k / Math.max(1, r * 8) * Math.PI * 2, px = x + Math.cos(t) * r, pz = z + Math.sin(t) * r;
      if (!blocked(px, pz)) { x = px; z = pz; break outer; }
    }
    const y = ground(x, z, 30);
    hero.position.set(x, y, z);
    face(a.spawn.yaw || 0);
    cam.position.set(x - Math.sin(a.spawn.yaw || 0) * 4.4, y + 2.3, z - Math.cos(a.spawn.yaw || 0) * 4.4);
    cam.lookAt(x, y + 1.4, z);
  }
  async function hallReady() {
    await waitFor(() => root.PalaceInterior && PalaceInterior.state && (PalaceInterior.state() === 'DONE' || PalaceInterior.state() === 'FAILED') && root.__holdSim === false);
    if (PalaceInterior.state() === 'FAILED') throw new Error('palace failed');
  }
  const palaceLive = () => root.PalaceInterior && PalaceInterior.state && PalaceInterior.state() === 'DONE' && !PalaceInterior.inR3() && root.PalaceWings && PalaceWings.state && PalaceWings.state.built;
  async function enterPalace(a) {
    await hallReady();
    await waitFor(() => root.PalaceWings && PalaceWings.state && PalaceWings.state.built);
    const id = a.spawn.teleport;
    if (!PalaceWings.teleport(id)) throw new Error('teleport ' + id);
    if (id !== 'Palace') {
      await waitFor(() => { const z = PalaceWings.zones && PalaceWings.zones().zones[id]; const s = z ? z.state : 'resident'; return s === 'ready' || s === 'resident' || s === 'failed'; }, 600000, 250);
      stepInside(id);
    }
    await frames(4);
  }
  // The game's teleport stands in the doorway with the lens on the door
  // leaf. Step in from the entrance toward the room centre (the framing of
  // tools/palace-room-shots.cjs) to the first spot the wing colliders allow.
  function stepInside(id) {
    const S = PalaceWings.state, r = S.regions.find(x => x.id === id);
    if (!r || !r.bbox) return;
    const doors = (S.doors || []).filter(d => d.from === id || d.to === id);
    const d = doors.find(x => /Palace|C|REAR|MP/.test(x.from === id ? x.to : x.from)) || doors[0];
    const fx = d ? d.x : r.bbox.cx, fz = d ? d.z : r.bbox.z0, cx = r.bbox.cx, cz = r.bbox.cz;
    let x = null, z = null;
    for (const k of [0.55, 0.45, 0.65, 0.35, 0.75, 0.25, 0.85, 0.15]) {
      const px = fx + (cx - fx) * k, pz = fz + (cz - fz) * k;
      // Free for the wing colliders AND for the hero's own collision query.
      const o0 = S.root.position;
      if (!PalaceWings.capsuleBlocked(px, pz, 0.5) && !game.blocked(o0.x + px, o0.z + pz)) { x = px; z = pz; break; }
    }
    if (x == null) return;                 // keep the game's own teleport pose
    const y = PalaceWings.floorAt(x, z) || 0, o = S.root.position, hero = game.hero(), cam = game.camera;
    const yaw = Math.atan2(cx - fx, cz - fz);
    hero.position.set(o.x + x, o.y + y, o.z + z);
    face(yaw);
    cam.position.set(hero.position.x - Math.sin(yaw) * 3.6, hero.position.y + 2.0, hero.position.z - Math.cos(yaw) * 3.6);
    cam.lookAt(hero.position.x, hero.position.y + 1.3, hero.position.z);
    if (root.PalaceInterior && PalaceInterior.constrainCamera) PalaceInterior.constrainCamera(cam, hero);
    if (PalaceWings.resolveCamera) PalaceWings.resolveCamera(cam);
  }
  async function enterR3(a) {
    await hallReady();
    await waitFor(() => root.PalaceWings && PalaceWings.state && PalaceWings.state.hall);
    const hall = PalaceWings.state.hall, p = hall.passages.find(d => d.id === root.SinR3SealedZone.passageId);
    if (!p) throw new Error('passage-L0 not found');
    const m = PalaceInterior.metrics(), floorY = PalaceInterior.floorY();
    const frame = { portalX: m.x, front: m.front, floorY, px: p.position[0], pz: p.position[2] };
    session.r3 = frame;
    // Stand inside the authored threshold: the game's own beginR3() fires
    // on the next tick (fade, palace retired, R3 stage mounted).
    const hero = game.hero();
    hero.position.set(m.x + p.position[0] - 0.6, floorY, m.front + p.position[2]);
    face(-Math.PI / 2);
    await waitFor(() => PalaceInterior.state() === 'R3' || PalaceInterior.state() === 'R3_FAILED');
    if (PalaceInterior.state() === 'R3_FAILED') throw new Error('R3 failed');
    // Areas past R3-01 are dressed in the background after arrival. Keep the
    // screen covered until that dressing is complete so the area never shows
    // its untextured first pass (the game streams it long before a player
    // walks there; only a direct jump can outrun it).
    if (!a.spawn.stageSpawn && PalaceInterior.r3Settled) {
      const cover = el('div', { id: 'sin-dev-cover' });
      cover.style.cssText = 'position:fixed;inset:0;z-index:11999;background:#000;display:grid;place-items:center;color:#cbb994;font:15px system-ui';
      cover.textContent = 'وضع المطور: تجهيز ' + a.ar;
      doc.body.appendChild(cover);
      try { await PalaceInterior.r3Settled(); }
      finally {
        spawnR3(a);
        await frames(3);
        cover.remove();
      }
      return;
    }
    await frames(3);
    spawnR3(a);
  }
  function spawnR3(a) {
    const s = a.spawn, f = session.r3, hero = game.hero(), cam = game.camera;
    if (s.stageSpawn) {
      // R3-01: the stage's own spawn (where the transition placed Sîn).
      if (session.r3Spawn) { hero.position.copy(session.r3Spawn); face(-Math.PI / 2); }
      else session.r3Spawn = hero.position.clone();
      return;
    }
    const x = f.portalX + f.px - s.u, z = f.front + f.pz + s.v, y = f.floorY + s.y;
    hero.position.set(x, y, z);
    face(s.yaw);
    cam.position.set(x - Math.sin(s.yaw) * 4, y + 2.2, z - Math.cos(s.yaw) * 4);
    cam.lookAt(x, y + 1.3, z);
  }
  function respawn() {
    if (!session || !session.ready) return;
    const a = session.area;
    if (a.stage === 'outdoor') spawnOutdoor(a);
    else if (a.stage === 'palace') enterPalace(a).catch(fail);
    else spawnR3(a);
    msg('أُعيد البطل إلى نقطة الظهور');
  }

  // ---- toolbar and tools -------------------------------------------------------
  let tool = null, panel = null, statusEl = null, fpsEl = null, flags = { fps: false, mem: false, fly: false, col: false, clean: false };
  function status(text) {
    if (!doc.body) return;
    if (!statusEl) { style(); statusEl = el('div', { id: 'sin-dev-status' }); doc.body.appendChild(statusEl); }
    statusEl.textContent = text; statusEl.style.display = text ? '' : 'none';
  }
  function refreshTag() { if (tool) tool.querySelector('.tag').textContent = session.area.id + (session.error ? ' ✕' : ''); }
  function toolbar() {
    if (tool || !session) return;
    style();
    tool = el('div', { id: 'sin-dev-tool' });
    tool.innerHTML = '<button data-act="panel" aria-label="developer tools">DEV ▾</button><span class="tag"></span>';
    panel = el('div', { id: 'sin-dev-panel' });
    panel.innerHTML = `<div class="tools">
      <button data-t="areas">قائمة المناطق</button><button data-t="reload">إعادة تحميل المنطقة</button>
      <button data-t="respawn">إعادة البطل للظهور</button><button data-t="fps">عداد FPS</button>
      <button data-t="mem">مراقب الذاكرة</button><button data-t="fly">الكاميرا الحرة</button>
      <button data-t="col">إظهار التصادمات</button><button data-t="clean">إخفاء الواجهة</button>
      <button data-t="copy">نسخ رابط المنطقة</button><button data-t="exit">الخروج من وضع المطور</button></div><div class="msg"></div>`;
    doc.body.appendChild(tool); doc.body.appendChild(panel);
    refreshTag();
    tool.addEventListener('click', ev => { if (ev.target.closest('button')) panel.classList.toggle('open'); });
    panel.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      const t = b.dataset.t;
      if (t === 'areas') { panel.classList.remove('open'); openAreas(); }
      if (t === 'reload') root.location.reload();
      if (t === 'respawn') respawn();
      if (t === 'fps') setFps(!flags.fps);
      if (t === 'mem') setMem(!flags.mem);
      if (t === 'fly') setFly(!flags.fly);
      if (t === 'col') setCollisions(!flags.col);
      if (t === 'clean') { flags.clean = !flags.clean; doc.documentElement.classList.toggle('sin-dev-clean', flags.clean); if (flags.clean) panel.classList.remove('open'); }
      if (t === 'copy') copyLink();
      if (t === 'exit') root.location.href = new URL('index.html', root.location.href).href;
      syncButtons();
    });
    // Leave the clean frame with a tap on the faint DEV button.
    syncButtons();
  }
  function syncButtons() { if (panel) panel.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', !!flags[b.dataset.t])); }
  function msg(t) { if (panel) panel.querySelector('.msg').textContent = t; }
  function openAreas() {
    const host = el('div', { id: 'sin-dev-gate' });
    doc.body.appendChild(host);
    showList(host, () => host.remove());
  }
  function copyLink() {
    const url = link(session.area.id, true);
    const done = () => msg('نُسخ: ' + url);
    if (root.navigator.clipboard && root.isSecureContext) root.navigator.clipboard.writeText(url).then(done, () => fallback());
    else fallback();
    function fallback() {
      const t = el('textarea'); t.value = url; t.style.cssText = 'position:fixed;opacity:0;top:0'; doc.body.appendChild(t); t.select();
      try { doc.execCommand('copy'); done(); } catch (_) { msg(url); } t.remove();
    }
  }
  // FPS: frame times from requestAnimationFrame, plus draw calls / triangles.
  let fpsRaf = 0;
  function setFps(on) {
    flags.fps = on;
    if (!on) { cancelAnimationFrame(fpsRaf); if (fpsEl) fpsEl.remove(); fpsEl = null; return; }
    fpsEl = el('div', { id: 'sin-dev-fps' }); doc.body.appendChild(fpsEl);
    const times = []; let last = performance.now(), shown = 0;
    (function tick(now) {
      times.push(now - last); last = now; if (times.length > 120) times.shift();
      if (now - shown > 250 && times.length > 5) {
        shown = now;
        const avg = times.reduce((a, b) => a + b, 0) / times.length, worst = Math.max(...times);
        const r = root.__R, i = r && r.info;
        fpsEl.textContent = 'FPS ' + (1000 / avg).toFixed(0) + '  (' + avg.toFixed(1) + ' ms, worst ' + worst.toFixed(0) + ')' +
          (i ? '\ncalls ' + i.render.calls + '  tris ' + (i.render.triangles / 1000).toFixed(0) + 'k\ngeo ' + i.memory.geometries + '  tex ' + i.memory.textures : '');
      }
      fpsRaf = requestAnimationFrame(tick);
    })(performance.now());
  }
  // Memory: the game's own overlay (SinMemoryOverlay), shown and hidden.
  function setMem(on) {
    flags.mem = on;
    if (root.SinMemoryOverlay) SinMemoryOverlay.set(on); else msg('مراقب الذاكرة غير متاح');
  }
  // Free camera: the simulation holds (window.__holdSim, as the game's own
  // test hooks do) and only the camera moves; leaving restores everything.
  let fly = null;
  function setFly(on) {
    const cam = game && game.camera; if (!cam) return;
    if (on === flags.fly) return;
    flags.fly = on;
    if (on) {
      fly = { pos: cam.position.clone(), quat: cam.quaternion.clone(), hold: root.__holdSim, yaws: game.yaws(), keys: new Set(), raf: 0, last: performance.now() };
      const e = new (root.THREE.Euler)().setFromQuaternion(cam.quaternion, 'YXZ');
      fly.yaw = e.y; fly.pitch = e.x; fly.touches = new Map();
      root.__holdSim = true;
      const kd = ev => { fly.keys.add(ev.code); if (/^(Key[WASDQE]|Shift|Arrow)/.test(ev.code)) { ev.stopPropagation(); ev.preventDefault(); } };
      const ku = ev => { fly.keys.delete(ev.code); ev.stopPropagation(); };
      let drag = null;
      const pd = ev => { if (ev.target.closest && ev.target.closest('#sin-dev-tool,#sin-dev-panel')) return; drag = { x: ev.clientX, y: ev.clientY }; fly.touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); ev.stopPropagation(); };
      const pm = ev => {
        if (!fly.touches.has(ev.pointerId)) return;
        const prev = fly.touches.get(ev.pointerId), dx = ev.clientX - prev.x, dy = ev.clientY - prev.y;
        fly.touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (fly.touches.size >= 2) { fly.move = { f: -dy * 0.03, s: dx * 0.03 }; }
        else { fly.yaw -= dx * 0.004; fly.pitch = Math.max(-1.5, Math.min(1.5, fly.pitch - dy * 0.004)); }
        ev.stopPropagation(); ev.preventDefault();
      };
      const pu = ev => { fly.touches.delete(ev.pointerId); drag = null; ev.stopPropagation(); };
      fly.off = () => { root.removeEventListener('keydown', kd, true); root.removeEventListener('keyup', ku, true); root.removeEventListener('pointerdown', pd, true); root.removeEventListener('pointermove', pm, true); root.removeEventListener('pointerup', pu, true); root.removeEventListener('pointercancel', pu, true); };
      root.addEventListener('keydown', kd, true); root.addEventListener('keyup', ku, true);
      root.addEventListener('pointerdown', pd, true); root.addEventListener('pointermove', pm, { capture: true, passive: false });
      root.addEventListener('pointerup', pu, true); root.addEventListener('pointercancel', pu, true);
      const hint = el('div', { id: 'sin-dev-fly' }, 'FREE CAM · WASD move · Q/E down/up · Shift fast · drag look · two fingers move');
      doc.body.appendChild(hint); fly.hint = hint;
      const V = root.THREE.Vector3;
      (function step(now) {
        const dt = Math.min(0.05, (now - fly.last) / 1000); fly.last = now;
        const k = fly.keys, speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 14 : 4.5) * dt;
        cam.quaternion.setFromEuler(new (root.THREE.Euler)(fly.pitch, fly.yaw, 0, 'YXZ'));
        const fwd = new V(0, 0, -1).applyQuaternion(cam.quaternion), right = new V(1, 0, 0).applyQuaternion(cam.quaternion);
        const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + (fly.move ? fly.move.f : 0);
        const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + (fly.move ? fly.move.s : 0);
        const u = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
        fly.move = null;
        cam.position.addScaledVector(fwd, f * speed).addScaledVector(right, s * speed);
        cam.position.y += u * speed;
        fly.raf = requestAnimationFrame(step);
      })(performance.now());
    } else if (fly) {
      cancelAnimationFrame(fly.raf); fly.off(); fly.hint.remove();
      cam.position.copy(fly.pos); cam.quaternion.copy(fly.quat);
      game.setYaws(fly.yaws);
      root.__holdSim = fly.hold === true ? true : false;
      fly = null;
    }
  }
  // Collision view: cells around Sîn that the hero's own collision query
  // (index.html blocked(x, z): exterior, palace, wings and R3) refuses.
  let col = null;
  function setCollisions(on) {
    flags.col = on;
    const THREE = root.THREE, scene = game && game.scene, hero = game && game.hero(), blocked = game && game.blocked;
    if (!on) { if (col) { clearInterval(col.timer); col.mesh.removeFromParent(); col.mesh.geometry.dispose(); col.mesh.material.dispose(); col = null; } return; }
    if (!THREE || !scene || !hero || !blocked) { flags.col = false; msg('التصادمات غير متاحة'); return; }
    const R = 11, S = 0.4, N = Math.ceil(2 * R / S) ** 2;
    const geo = new THREE.PlaneGeometry(S * 0.92, S * 0.92); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.42, depthWrite: false, fog: false, toneMapped: false });
    const mesh = new THREE.InstancedMesh(geo, mat, N); mesh.name = 'SinDevCollisions'; mesh.frustumCulled = false; mesh.renderOrder = 20;
    scene.add(mesh);
    const m4 = new THREE.Matrix4();
    let lastAt = null;
    const refresh = () => {
      const p = hero.position;
      if (lastAt && Math.hypot(p.x - lastAt.x, p.z - lastAt.z) < 0.6 && Math.abs(p.y - lastAt.y) < 0.3) return;
      lastAt = p.clone();
      let n = 0;
      for (let x = -R; x < R; x += S) for (let z = -R; z < R; z += S) {
        const wx = p.x + x, wz = p.z + z;
        let b = false; try { b = blocked(wx, wz); } catch (_) {}
        if (b) { m4.makeTranslation(wx, p.y + 0.06, wz); mesh.setMatrixAt(n++, m4); }
      }
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
    };
    col = { mesh, timer: setInterval(refresh, 400) };
    refresh();
  }

  root.SinDevHub = {
    enabled: ENABLED, devSession, PREFIX,
    catalog, area: id => byId.get(id), link, bind, game: () => game,
    boot, go, respawn, session: () => session,
    tools: { setFps, setMem, setFly, setCollisions, copyLink }
  };
  if (typeof module === 'object' && module.exports) module.exports = root.SinDevHub;
})(typeof window !== 'undefined' ? window : globalThis);
