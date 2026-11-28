/* Sîn — character, locomotion and combat controller.
   Hero: assets/Sin_hero_runtime.glb (runtime copy of Sin_combat_FINAL3_axe.glb: 70-bone rig, axe with back / hand sockets).

   Update order each frame (deterministic, one writer per bone):
     1 InputController        stick (idle / walk / run zones), buttons, keyboard -> buffered presses
     2 WeaponController       Holstered / Equipping / Equipped / Unequipping, socket switch at the authored frame
     3 Action layer           attack / dodge / hit reaction / door push: one owner, linear crossfades
     4 LocomotionController   idle | walk | run at their authored playback rate, phase-matched walk<->run
     5 CharacterMotor         root velocity = sum(blend weight x measured clip speed) + authored root motion,
                              collision in sub-steps; nothing else moves the root
     6 AnimationController    one mixer, bone masks (lower / upper / right arm / right fingers), mixer.update(0)
     7 CharacterIK            pelvis drop + two-bone leg lift only where the floor under the feet differs
   Speeds, contact phases and root-motion curves are measured from the clips at load (MotionAnalysis), not typed in.
   The palace door modules keep the same facade as before (startPush / releasePush / pushState ...). */
(function () {
  'use strict';
  const T = window.THREE;
  if (!T) return;

  // ------------------------------------------------------------------ constants
  const HERO_SCALE = 1.85;                       // model is ~1 unit tall -> ~1.84 m
  // One analog stick, three locomotion states. Deflection only selects the state; speeds are not stick-driven.
  //   < dead: idle   dead..runIn: walk   >= runIn: run (leaves run below runOut: hysteresis at the walk/run edge only)
  const STICK = { dead: 0.10, runIn: 0.58, runOut: 0.52 };
  // Crossfade durations (s), one per transition. Root speed follows the blend weights, so a fade never slides.
  const XF = { idleWalk: 0.18, walkIdle: 0.20, walkRun: 0.20, runWalk: 0.22, runIdle: 0.24, idleRun: 0.22, idleSwap: 0.25,
               actionToIdle: 0.20, actionToMove: 0.15, chain: 0.08 };
  // Facing follows the stick like the pre-PR63 hero (1/6 of the remaining angle per 60 Hz frame), frame-rate independent.
  const TURN_K = 10.94;
  const TURN_MAX = [9.0, 6.0];                   // rad/s cap on the turn: walking, running
  const MAX_STEP = 0.25;                         // collision sub-step (m): no tunnelling at run speed or low FPS
  const BUFFER = 0.22;                           // input buffer (s)

  // Clips used (everything else in the file is dropped after load).
  const CLIPS = {
    idle: 'idle_impatient', cidle: 'Axe_CombatIdle', walk: 'walk_casual', run: 'sprint_loop_quaternius',
    atkR: 'Attack_Right', atkL: 'Attack_Left', finH: 'Finisher_Heavy', finJ: 'Finisher_Jump',
    dodge: 'km_dodge_back', dodgeM: 'km_dodge_back_mirror', stagger: 'fall', knock: 'km_knockdown_getup_mirror',
    push: 'push_object', pushEnter: 'push_enter_quaternius', equip: 'Axe_Equip', unequip: 'Axe_Unequip'
  };
  // Attack data, from the axe-head trajectory of each clip (speed peaks) + the file's combat metadata.
  //   wind = windup end, act = active (hit) window, cancel = earliest chain point, move = locomotion cancel,
  //   end = blend back to the base pose, open = combo input accepted from. Every clip plays at its authored rate.
  const ATTACKS = {
    atkR: { clip: 'atkR', ts: 1, wind: 0.26, act: [0.27, 0.39], impact: 0.33, open: 0.22, cancel: 0.55, move: 0.66, end: 1.02, blendIn: 0.07, dmg: 10, push: 0.45 },
    atkL: { clip: 'atkL', ts: 1, wind: 0.15, act: [0.16, 0.42], impact: 0.33, open: 0.22, cancel: 0.55, move: 0.66, end: 1.02, blendIn: 0.08, dmg: 10, push: 0.4 },
    finH: { clip: 'finH', ts: 1, wind: 0.68, act: [0.70, 0.88], impact: 0.79, open: 1.0, cancel: 1.25, move: 1.22, end: 1.70, blendIn: 0.09, dmg: 26, push: 0.7, heavy: true },
    finJ: { clip: 'finJ', ts: 1, wind: 0.74, act: [0.74, 0.87], impact: 0.81, open: 1.0, cancel: 1.25, move: 1.22, end: 1.74, blendIn: 0.09, dmg: 32, push: 0.9, heavy: true, landing: 0.84 }
  };
  const COMBO = { light: ['atkR', 'atkL', 'finH'], heavyAfterLight: 'finJ', heavy: 'finH', sprintLight: 'atkR', sprintHeavy: 'finJ' };
  // Dodge: km_dodge_back from the end of its idle lead-in; its own root motion (extracted from the planted feet) moves the hero.
  const DODGE = { from: 0.50, to: 1.75, iframes: [0.58, 0.95], cancel: 1.40, blendIn: 0.06 };
  const GUARD_T = 0.02;                           // guard pose: km_dodge_back frame 0 (axe raised across the head)
  const STAGGER = { to: 0.72 };                  // light hit: first stumble of `fall`

  // ------------------------------------------------------------------ masks
  const RFING = /^(index|middle|ring|pinky|thumb)_0[123]_r$/;
  const RARM = /^(clavicle_r|upperarm_r|upperarm_twist_01_r|lowerarm_r|lowerarm_twist_01_r|hand_r|weapon_r|pauldron_r|Axe_RightHand_Socket)$/;
  const LOWER = /^(root|pelvis|thigh_[lr]|thigh_twist_01_[lr]|calf_[lr]|calf_twist_01_[lr]|foot_[lr]|ball_[lr]|fauld_[a-z]+)$/;
  const nodeOf = n => n.slice(0, n.lastIndexOf('.'));
  const partOf = name => { const n = nodeOf(name); return LOWER.test(n) ? 0 : RFING.test(n) ? 3 : RARM.test(n) ? 2 : 1; };

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const sstep = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
  const damp = (k, dt) => 1 - Math.exp(-k * dt);
  // Canonical runtime rig map shared by combat, IK and streamed door scenes.
  function resolveRig(model) {
    const root = model && model.model ? model.model : model;
    const find = names => { for (const n of names) { const o = root && root.getObjectByName && root.getObjectByName(n); if (o) return o; } return null; };
    const side = s => ({
      clavicle: find(['clavicle_' + s, s === 'l' ? 'LeftShoulder' : 'RightShoulder']),
      upperarm: find(['upperarm_' + s, s === 'l' ? 'LeftArm' : 'RightArm']),
      lowerarm: find(['lowerarm_' + s, s === 'l' ? 'LeftForeArm' : 'RightForeArm']),
      hand: find(['hand_' + s, s === 'l' ? 'LeftHand' : 'RightHand']),
      palm: find(['middle_02_' + s, 'middle_01_' + s, 'index_02_' + s, 'thumb_02_' + s])
    });
    const out = { left: side('l'), right: side('r'), weapon: find(['weapon_r']), handSocket: find(['Axe_RightHand_Socket']), backSocket: find(['Axe_Back_Socket']), backHook: find(['Axe_Back_Hook']), axe: find(['Axe']) };
    out.valid = ['left', 'right'].every(s => out[s].upperarm && out[s].lowerarm && out[s].hand) && !!out.weapon;
    return out;
  }
  function curve(pts, x) {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
    return pts[pts.length - 1][1];
  }

  // ================================================================== ClipLibrary
  // Blend the tail of a loop onto its first frame so the cycle closes without a pop.
  function closeLoop(clip, seam) {
    for (const tr of clip.tracks) {
      const size = tr.getValueSize(), times = tr.times, v = tr.values, n = times.length, dur = times[n - 1];
      if (n < 3) continue;
      for (let i = 0; i < n; i++) {
        const k = sstep((times[i] - (dur - seam)) / seam); if (k <= 0) continue;
        if (size === 4) {
          let ax = v[0], ay = v[1], az = v[2], aw = v[3]; const bx = v[i * 4], by = v[i * 4 + 1], bz = v[i * 4 + 2], bw = v[i * 4 + 3];
          if (ax * bx + ay * by + az * bz + aw * bw < 0) { ax = -ax; ay = -ay; az = -az; aw = -aw; }
          let x = bx + (ax - bx) * k, y = by + (ay - by) * k, z = bz + (az - bz) * k, w = bw + (aw - bw) * k; const L = Math.hypot(x, y, z, w) || 1;
          v[i * 4] = x / L; v[i * 4 + 1] = y / L; v[i * 4 + 2] = z / L; v[i * 4 + 3] = w / L;
        } else for (let c = 0; c < size; c++) v[i * size + c] += (v[c] - v[i * size + c]) * k;
      }
    }
  }
  function buildLibrary(gltf) {
    const byName = new Map(gltf.animations.map(c => [c.name, c]));
    const need = Object.values(CLIPS), missing = need.filter(n => !byName.has(n));
    if (missing.length) throw new Error('Sin_combat_FINAL3_axe.glb: حركات ناقصة ' + missing.join(', '));
    const lib = {};
    for (const k in CLIPS) {
      const c = byName.get(CLIPS[k]);
      const keepSocket = k === 'equip' || k === 'unequip';
      // The axe is moved by re-parenting between the two sockets; tracks that key the Axe node itself would fight that.
      c.tracks = c.tracks.filter(t => { const n = nodeOf(t.name); return n !== 'Axe' && n !== 'Axe_Back_Socket' && n !== 'Axe_Back_Hook' && (keepSocket || n !== 'Axe_RightHand_Socket'); });
      lib[k] = c;
    }
    closeLoop(lib.run, 0.06);   // the authored last frame does not meet the first one; blend only the final 60 ms
    // Drop every other clip: one hero, one set of clips in memory.
    gltf.animations.length = 0;
    for (const k in lib) gltf.animations.push(lib[k]);
    return lib;
  }

  // ================================================================== MotionAnalysis
  // Measures the clips on the real rig once at load: stance speed of the planted ball of the foot (walk / run),
  // left-foot contact phases (phase matching), and root motion of in-place clips from the support foot.
  // Bone transforms are saved and restored, so the main mixer binds to the untouched bind pose.
  function analyseMotion(model, lib, hs) {
    const saved = [];
    model.traverse(o => { if (o.isBone || o.name === 'Axe_RightHand_Socket') saved.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]); });
    const mx = new T.AnimationMixer(model);
    const pts = ['ball_l', 'ball_r', 'foot_l', 'foot_r'].map(n => model.getObjectByName(n));
    const inv = new T.Matrix4(), v = new T.Vector3();
    function sample(clip, t0, t1, hz) {
      const a = mx.clipAction(clip); a.setLoop(T.LoopRepeat, Infinity); a.play();
      const n = Math.max(2, Math.round((t1 - t0) * hz) + 1), rows = [];
      for (let i = 0; i < n; i++) {
        const t = Math.min(clip.duration - 1e-4, t0 + (t1 - t0) * i / (n - 1));
        mx.setTime(t); model.updateMatrixWorld(true); inv.copy(model.matrixWorld).invert();
        const r = [t]; for (const p of pts) { p.getWorldPosition(v).applyMatrix4(inv); r.push(v.x, v.y, v.z); } rows.push(r);
      }
      a.stop(); mx.uncacheAction(clip); return rows;
    }
    const median = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
    // idle stance: fore-aft position of each ankle (model space)
    const idleRows = sample(lib.idle, 0, 0, 1), idleFoot = [idleRows[0][9], idleRows[0][12]];
    function gait(clip) {
      const hz = 240, rows = sample(clip, 0, clip.duration, hz), dt = clip.duration / (rows.length - 1);
      const footMin = [0, 1].map(k => Math.min(...rows.map(r => r[2 + k * 3]))), ankMin = [0, 1].map(k => Math.min(...rows.map(r => r[8 + k * 3])));
      const speeds = [], stance = [[], []];
      for (const k of [0, 1]) {
        const y = i => rows[i][2 + k * 3], z = i => rows[i][3 + k * 3];
        let mn = 1e9; for (let i = 0; i < rows.length; i++) mn = Math.min(mn, y(i));
        let open = -1;
        for (let i = 0; i < rows.length; i++) {
          const low = y(i) < mn + 0.012;
          if (low && i > 0 && i < rows.length - 1 && y(i - 1) < mn + 0.012 && y(i + 1) < mn + 0.012) speeds.push(-(z(i + 1) - z(i - 1)) / (2 * dt));
          if (low && open < 0) open = i; else if (!low && open >= 0) { stance[k].push([rows[open][0], rows[i - 1][0]]); open = -1; }
        }
        if (open >= 0) stance[k].push([rows[open][0], rows[rows.length - 1][0]]);
      }
      const L = stance[0].filter(s => s[1] - s[0] > 0.02), R = stance[1].filter(s => s[1] - s[0] > 0.02);
      const starts = L.map(s => s[0]), gaps = [];
      for (let i = 1; i < starts.length; i++) gaps.push(starts[i] - starts[i - 1]);
      const cycles = gaps.length ? Math.max(1, Math.round(clip.duration / median(gaps))) : 1, cycle = clip.duration / cycles;
      const ph0 = L.length ? L[0][0] : 0, mid = L.length ? (L[0][0] + L[0][1]) / 2 : 0;
      // stop-friendly phases: every foot that is on the ground lies within a natural stance distance of its idle
      // spot, so a stop that begins here can lock the feet where they are (no glide, no over-wide stance)
      // the body keeps moving during the walk->idle fade (speed x fade / 2), which brings a front foot back under it
      const bins = 48, good = new Uint8Array(bins), lim = 0.30 / hs, ahead = median(speeds) * XF.walkIdle * 0.5;
      for (let b = 0; b < bins; b++) {
        const t = ph0 + (b + 0.5) / bins * cycle, i = Math.min(rows.length - 1, Math.round(((t % clip.duration) + clip.duration) % clip.duration / dt));
        let ok = true;
        for (const k of [0, 1]) {
          const ballY = rows[i][2 + k * 3], ankY = rows[i][8 + k * 3], az = rows[i][9 + k * 3];
          const grounded = ballY < footMin[k] + 0.035 / hs || ankY < ankMin[k] + 0.035 / hs;
          const off = az - idleFoot[k];
          if (grounded && (off > lim + ahead || off < -lim + ahead)) ok = false;
        }
        good[b] = ok ? 1 : 0;
      }
      return { speed: median(speeds) * hs, units: median(speeds), cycle, cycles, ph0, start: ((mid - ph0) / cycle + 1) % 1,
        contactL: ph0, contactR: R.length ? R[0][0] : ph0 + cycle / 2, stopOk: good };
    }
    // root motion of an in-place clip: the support point (lowest of heels / balls, within 2 cm of its floor) stays put
    function rootCurve(clip, t0, t1) {
      const rows = sample(clip, t0, t1, 60), mins = [0, 1, 2, 3].map(k => Math.min(...rows.map(r => r[2 + k * 3])));
      const t = new Float32Array(rows.length), x = new Float32Array(rows.length), z = new Float32Array(rows.length);
      let cx = 0, cz = 0;
      for (let i = 0; i < rows.length; i++) {
        t[i] = rows[i][0];
        if (i > 0) {
          let k = 0, best = 1e9; for (let j = 0; j < 4; j++) { const h = rows[i][2 + j * 3] - mins[j]; if (h < best) { best = h; k = j; } }
          if (best < 0.02 && rows[i - 1][2 + k * 3] - mins[k] < 0.02) { cx -= rows[i][1 + k * 3] - rows[i - 1][1 + k * 3]; cz -= rows[i][3 + k * 3] - rows[i - 1][3 + k * 3]; }
        }
        x[i] = cx; z[i] = cz;
      }
      return { t, x, z, t0, t1 };
    }
    const out = {
      walk: gait(lib.walk), run: gait(lib.run),
      root: { dodge: rootCurve(lib.dodge, DODGE.from, DODGE.to), dodgeM: rootCurve(lib.dodgeM, DODGE.from, DODGE.to),
              stagger: rootCurve(lib.stagger, 0, STAGGER.to), knock: rootCurve(lib.knock, 0, lib.knock.duration - 1e-3) }
    };
    mx.stopAllAction(); mx.uncacheRoot(model);
    for (const [o, p, q, sc] of saved) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(sc); }
    model.updateMatrixWorld(true);
    return out;
  }
  // cumulative root motion (model units) at clip time t, linear between 60 Hz samples
  function curveAt(c, t, out) {
    const n = c.t.length; if (t <= c.t[0]) { out.x = c.x[0]; out.z = c.z[0]; return out; }
    if (t >= c.t[n - 1]) { out.x = c.x[n - 1]; out.z = c.z[n - 1]; return out; }
    let i = Math.min(n - 2, Math.floor((t - c.t[0]) / (c.t[1] - c.t[0])));
    while (i > 0 && c.t[i] > t) i--; while (i < n - 2 && c.t[i + 1] < t) i++;
    const k = (t - c.t[i]) / ((c.t[i + 1] - c.t[i]) || 1);
    out.x = c.x[i] + (c.x[i + 1] - c.x[i]) * k; out.z = c.z[i] + (c.z[i + 1] - c.z[i]) * k; return out;
  }

  // ================================================================== AnimationEvents
  function AnimationEvents() {
    const subs = new Map();
    return {
      on(name, fn) { if (!subs.has(name)) subs.set(name, new Set()); subs.get(name).add(fn); return () => subs.get(name).delete(fn); },
      emit(name, a) { const s = subs.get(name); if (s) s.forEach(fn => { try { fn(a); } catch (e) { console.warn('[SinHero event]', name, e); } }); },
      count() { let n = 0; subs.forEach(s => { n += s.size; }); return n; }
    };
  }

  // ================================================================== AnimationController
  function AnimationController(model, lib, events) {
    const mixer = new T.AnimationMixer(model);
    const S = {}; const list = [];
    function addState(key, clip, loop, opts) {
      const parts = [[], [], [], []];
      for (const tr of clip.tracks) parts[partOf(tr.name)].push(tr);
      const acts = parts.map((tr, p) => {
        if (!tr.length) return null;
        const pc = new T.AnimationClip(clip.name + '#' + key + p, clip.duration, tr);
        const a = mixer.clipAction(pc);
        a.setLoop(loop ? T.LoopRepeat : T.LoopOnce, loop ? Infinity : 1); a.clampWhenFinished = true;
        a.timeScale = 0; a.enabled = true; a.setEffectiveWeight(0); a.play();
        return a;
      });
      const s = { key, clip, loop, dur: clip.duration, time: (opts && opts.time) || 0, b: 0, u: 0, a: 0, g: 0, acts, w: [0, 0, 0, 0], marks: (opts && opts.marks) || null, prev: 0 };
      S[key] = s; list.push(s); return s;
    }
    addState('idle', lib.idle, true); addState('cidle', lib.cidle, true);
    addState('walk', lib.walk, true); addState('run', lib.run, true);
    for (const k of ['atkR', 'atkL', 'finH', 'finJ']) addState(k, lib[k], false);
    addState('dodge', lib.dodge, false); addState('dodgeM', lib.dodgeM, false);
    addState('guard', lib.dodge, false, { time: GUARD_T });
    addState('grip', lib.cidle, false, { time: 0 });
    addState('stagger', lib.stagger, false); addState('knock', lib.knock, false);
    addState('push', lib.push, false); addState('pushEnter', lib.pushEnter, false);
    addState('equip', lib.equip, false); addState('unequip', lib.unequip, false);

    // ---------------- per-frame evaluation
    // base b (sum 1) -> parts 0..3; upper layer u (total U) -> parts 1..3; grip g (total G) -> part 3; arm layer a (total A) -> parts 2,3.
    function evaluate(dt) {
      let B = 0, U = 0, A = 0, G = 0;
      for (const s of list) { B += s.b; U += s.u; A += s.a; G += s.g; }
      const ib = B > 1e-6 ? 1 / B : 0; U = clamp(U, 0, 1); A = clamp(A, 0, 1); G = clamp(G, 0, 1);
      for (const s of list) {
        const b = s.b * ib, w1 = b * (1 - U) + s.u;
        s.w[0] = b; s.w[1] = w1; s.w[2] = w1 * (1 - A) + s.a; s.w[3] = (w1 * (1 - G) + s.g) * (1 - A) + s.a;
        const on = s.w[0] + s.w[1] + s.w[2] + s.w[3] > 1e-4;
        const tt = s.loop ? ((s.time % s.dur) + s.dur) % s.dur : clamp(s.time, 0, s.dur - 1e-4);
        for (let p = 0; p < 4; p++) {
          const a = s.acts[p]; if (!a) continue;
          if (on) { a.enabled = true; a.time = tt; a.setEffectiveWeight(s.w[p]); }
          else if (a.enabled) { a.setEffectiveWeight(0); a.enabled = false; }
        }
        // markers
        if (s.marks && on) for (const m of s.marks) if (s.prev < m.t && s.time >= m.t) events.emit(m.name, { state: s.key, t: m.t });
        s.prev = s.time;
      }
      mixer.update(0);
    }
    function activeActions() { let n = 0; for (const s of list) for (const a of s.acts) if (a && a.enabled) n++; return n; }
    return { S, list, mixer, evaluate, activeActions, totalActions: () => mixer._actions.length };
  }

  // ================================================================== CharacterIK
  function CharacterIK(model, events) {
    const B = n => model.getObjectByName(n);
    const legs = ['l', 'r'].map(s => ({ thigh: B('thigh_' + s), calf: B('calf_' + s), foot: B('foot_' + s), ball: B('ball_' + s) }));
    const v1 = new T.Vector3(), v2 = new T.Vector3(), v3 = new T.Vector3(), tgt = new T.Vector3(), dir = new T.Vector3(), bend = new T.Vector3(), nj = new T.Vector3();
    const qa = new T.Quaternion(), qb = new T.Quaternion(), qp = new T.Quaternion(), qf = new T.Quaternion(), ax = new T.Vector3();
    const ankle = [new T.Vector3(), new T.Vector3()], ball = [new T.Vector3(), new T.Vector3()], goal = [new T.Vector3(), new T.Vector3()];
    let pelvisOff = 0; const footOff = [0, 0];
    // foot locking: a planted foot keeps its world position while the hero stops and stands
    const pins = [0, 1].map(() => ({ on: false, w: 0, x: 0, z: 0, ball: false, slow: false }));
    const flat = { ball: 0.035, ankle: 0.14 };                 // standing heights (set from the idle pose at load)
    function setWorldQ(bone, q) { bone.parent.getWorldQuaternion(qp).invert(); bone.quaternion.copy(qp.multiply(q)); bone.updateMatrixWorld(true); }
    function aim(bone, from, to) { bone.getWorldQuaternion(qa); qb.setFromUnitVectors(from.normalize(), to.normalize()).multiply(qa); setWorldQ(bone, qb); }
    // two-bone leg IK: ankle to `target` (world), knee stays in the animated bend plane, foot keeps its animated world rotation
    function solveTo(leg, target) {
      leg.thigh.getWorldPosition(v1); leg.calf.getWorldPosition(v2); leg.foot.getWorldPosition(v3); leg.foot.getWorldQuaternion(qf);
      const L1 = v1.distanceTo(v2), L2 = v2.distanceTo(v3);
      dir.subVectors(target, v1); const d = clamp(dir.length(), Math.abs(L1 - L2) + 0.002, L1 + L2 - 0.004); dir.normalize();
      bend.subVectors(v2, v1); bend.addScaledVector(dir, -bend.dot(dir)); if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1); bend.normalize();
      const along = (L1 * L1 - L2 * L2 + d * d) / (2 * d), side = Math.sqrt(Math.max(0, L1 * L1 - along * along));
      nj.copy(v1).addScaledVector(dir, along).addScaledVector(bend, side);
      aim(leg.thigh, ax.subVectors(v2, v1), v3.subVectors(nj, v1));
      leg.calf.getWorldPosition(v2); leg.foot.getWorldPosition(v3);
      tgt.copy(v1).addScaledVector(dir, d);
      aim(leg.calf, ax.subVectors(v3, v2), v1.subVectors(tgt, v2));
      setWorldQ(leg.foot, qf);
    }
    function planted(i, floor, tol) { return ball[i].y - floor < flat.ball + tol || ankle[i].y - floor < flat.ankle + tol; }
    /* mode: 'move' (locomotion / action drives the feet), 'stop-begin' (pin the feet that are on the floor now),
             'hold' (keep existing pins: stopping or standing). ground(x,z,y) -> floor height; uneven floors lift / drop. */
    function apply(root, ground, dt, enabled, mode) {
      const base = root.position.y;
      for (let i = 0; i < 2; i++) { legs[i].foot.getWorldPosition(ankle[i]); legs[i].ball.getWorldPosition(ball[i]); }
      // 1) uneven floor: pelvis drop + per-foot lift (no-op on flat ground)
      let want0 = 0, want1 = 0, drop = 0;
      if (enabled && ground) {
        for (let i = 0; i < 2; i++) {
          const contact = clamp(1 - (ball[i].y - base - 0.06) / 0.18, 0, 1);
          const h = ground(ball[i].x, ball[i].z, base + 0.5);
          const dh = Number.isFinite(h) ? clamp(h - base, -0.32, 0.32) : 0;
          if (i === 0) want0 = dh * contact; else want1 = dh * contact;
        }
        drop = Math.min(0, want0, want1);
      }
      const k = damp(14, dt);
      pelvisOff += (drop - pelvisOff) * k; footOff[0] += (want0 - pelvisOff - footOff[0]) * k; footOff[1] += (want1 - pelvisOff - footOff[1]) * k;
      // 2) foot locking
      for (let i = 0; i < 2; i++) {
        const P = pins[i];
        // the weight-bearing foot is pinned where it is when the stop begins (rolling sole: 3.5 cm tolerance);
        // the swing foot is pinned where it touches down (2 cm) instead of gliding on into the idle stance
        const pinNow = enabled && !P.on && P.w <= 0 && ((mode === 'stop-begin' && planted(i, base, 0.035)) || (mode === 'hold' && planted(i, base, 0.02)));
        if (pinNow) {
          // lock the point that carries the weight: the ball when the heel is up (toe-off), else the heel
          P.ball = ankle[i].y - base > flat.ankle + 0.02 && ball[i].y - base < flat.ball + 0.035;
          const c = P.ball ? ball[i] : ankle[i]; P.on = true; P.x = c.x; P.z = c.z; P.w = 1;
        }
        if (!enabled || mode === 'move') P.on = false;
        const away = P.w > 0 ? Math.hypot(P.x - (P.ball ? ball[i] : ankle[i]).x, P.z - (P.ball ? ball[i] : ankle[i]).z) : 0;
        if (away > 1.0) { P.on = false; P.w = 0; }                       // teleport (palace entry, test placement): drop at once
        else if (P.on && away > 0.45) { P.on = false; P.slow = true; }   // never stretch a leg past a natural stance
        P.w = P.on ? 1 : Math.max(0, P.w - dt / (P.slow ? 0.25 : 0.15));
        if (P.w <= 0) P.slow = false;
      }
      const lifting = Math.abs(pelvisOff) > 1e-4 || Math.abs(footOff[0]) > 2e-3 || Math.abs(footOff[1]) > 2e-3;
      if (!lifting && pins[0].w <= 0 && pins[1].w <= 0) return;
      if (Math.abs(pelvisOff) > 1e-4) { model.position.y += pelvisOff; model.updateMatrixWorld(true); }
      for (let i = 0; i < 2; i++) {
        const P = pins[i];
        legs[i].foot.getWorldPosition(goal[i]); goal[i].y += footOff[i];
        if (P.w > 0) {
          // horizontal lock of the contact point; height and foot roll stay animated (the foot settles flat with the idle pose)
          let ox = 0, oz = 0;
          if (P.ball) { legs[i].ball.getWorldPosition(v2); ox = goal[i].x - v2.x; oz = goal[i].z - v2.z; }
          goal[i].x += (P.x + ox - goal[i].x) * P.w; goal[i].z += (P.z + oz - goal[i].z) * P.w;
        }
        legs[i].foot.getWorldPosition(v3);
        if (goal[i].distanceToSquared(v3) > 4e-6) solveTo(legs[i], goal[i]);
      }
    }
    function setFlat(f) { flat.ball = f.ball; flat.ankle = f.ankle; }
    return { apply, setFlat, state: () => ({ pelvisOff, footOff: footOff.slice(), pins: pins.map(p => +p.w.toFixed(2)) }) };
  }

  // ================================================================== InputController
  function InputController(opts) {
    const st = { x: 0, y: 0, mag: 0, keys: {}, held: {}, presses: [], camActive: false };
    const el = opts.el;
    let sId = null, sOx = 0, sOy = 0, sMax = 1, cId = null, cLx = 0, cLy = 0;
    const knob = el.knob, stick = el.stick, surf = el.touch;
    function knobAt(dx, dy) { knob.style.transform = 'translate(calc(-50% + ' + dx.toFixed(1) + 'px), calc(-50% + ' + dy.toFixed(1) + 'px))'; }
    function setStick(e) {
      let dx = e.clientX - sOx, dy = e.clientY - sOy; const l = Math.hypot(dx, dy);
      if (l > sMax) { dx *= sMax / l; dy *= sMax / l; }
      st.x = dx / sMax; st.y = -dy / sMax; st.mag = Math.min(1, l / sMax); knobAt(dx, dy);
      stick.dataset.zone = st.mag < STICK.dead ? '0' : st.mag < STICK.runIn ? '1' : '2';
    }
    function releaseStick() { sId = null; st.x = st.y = st.mag = 0; knobAt(0, 0); stick.dataset.zone = '0'; stick.classList.remove('active'); }
    function playing() { return opts.enabled ? opts.enabled() : true; }
    surf.addEventListener('pointerdown', e => {
      if (!playing()) return; e.preventDefault();
      const r = stick.getBoundingClientRect(), pad = r.width * 0.45;
      if (sId === null && e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad) {
        try { surf.setPointerCapture(e.pointerId); } catch (_) {}
        sId = e.pointerId; sMax = Math.max(24, r.width * 0.5 - 6); sOx = r.left + r.width / 2; sOy = r.top + r.height / 2; stick.classList.add('active'); setStick(e);
      } else if (cId === null && e.clientX >= innerWidth * 0.48) {
        try { surf.setPointerCapture(e.pointerId); } catch (_) {}
        cId = e.pointerId; cLx = e.clientX; cLy = e.clientY; st.camActive = true;
      }
    });
    surf.addEventListener('pointermove', e => {
      if (e.pointerId === sId) setStick(e);
      else if (e.pointerId === cId) { if (opts.onCamera) opts.onCamera(e.clientX - cLx, e.clientY - cLy); cLx = e.clientX; cLy = e.clientY; }
    });
    const end = e => { if (e.pointerId === sId) releaseStick(); if (e.pointerId === cId) { cId = null; st.camActive = false; } };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => surf.addEventListener(n, end));
    // action buttons: each tracks its own pointer (multi-touch safe), released on up / cancel / lost capture
    const buttons = el.buttons || {};
    for (const name in buttons) {
      const b = buttons[name]; if (!b) continue; let pid = null;
      b.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation(); if (!playing() || b.classList.contains('disabled')) return;
        pid = e.pointerId; try { b.setPointerCapture(pid); } catch (_) {}
        st.held[name] = true; st.presses.push({ name, t: performance.now() / 1000 }); b.classList.add('pressed');
      });
      const up = e => { if (pid === null || e.pointerId !== pid) return; pid = null; st.held[name] = false; b.classList.remove('pressed'); };
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => b.addEventListener(n, up));
      b.addEventListener('contextmenu', e => e.preventDefault());
    }
    const KEYMAP = { KeyJ: 'light', KeyK: 'heavy', Space: 'dodge', KeyR: 'axe', KeyU: 'block', KeyF: 'interact' };
    addEventListener('keydown', e => {
      st.keys[e.code] = true; const a = KEYMAP[e.code];
      if (a && !e.repeat && playing()) { st.held[a] = true; st.presses.push({ name: a, t: performance.now() / 1000 }); if (e.code === 'Space') e.preventDefault(); }
    });
    addEventListener('keyup', e => { st.keys[e.code] = false; const a = KEYMAP[e.code]; if (a) st.held[a] = false; });
    function release() {
      if (sId !== null) { try { surf.releasePointerCapture(sId); } catch (_) {} releaseStick(); }
      if (cId !== null) { try { surf.releasePointerCapture(cId); } catch (_) {} cId = null; st.camActive = false; }
      for (const k in st.keys) st.keys[k] = false; for (const k in st.held) st.held[k] = false; st.presses.length = 0;
      for (const n in buttons) if (buttons[n]) buttons[n].classList.remove('pressed');
    }
    addEventListener('blur', release);
    // stick + keyboard -> local (forward, strafe, deflection)
    const out = { fw: 0, st: 0, mag: 0 };
    function read() {
      let fw = st.y, s = st.x, mag = st.mag; const k = st.keys;
      let kf = 0, ks = 0;
      if (k.KeyW || k.ArrowUp) kf += 1; if (k.KeyS || k.ArrowDown) kf -= 1; if (k.KeyD || k.ArrowRight) ks += 1; if (k.KeyA || k.ArrowLeft) ks -= 1;
      if (kf || ks) {
        const l = Math.hypot(kf, ks), km = (k.ShiftLeft || k.ShiftRight) ? 1 : 0.42;   // as before the new hero: WASD walks, Shift runs
        fw = kf / l * km; s = ks / l * km; mag = km;
      }
      out.fw = fw; out.st = s; out.mag = mag; return out;
    }
    // presses are stamped with the simulation clock the first time the controller sees them, so a frame hitch
    // never eats an input; anything older than maxAge (the buffer) is dropped
    function take(now, maxAge) {
      for (const p of st.presses) if (p.sim == null) p.sim = now;
      while (st.presses.length && now - st.presses[0].sim > maxAge) st.presses.shift();
      return st.presses.length ? st.presses[0] : null;
    }
    return { st, read, release, take, consume() { st.presses.shift(); }, cameraActive: () => cId !== null, stickActive: () => sId !== null };
  }


  // ================================================================== HUD (Babylonian bronze controls, built once)
  const ICON = {
    light: '<svg viewBox="0 0 64 64"><path class="f" d="M45 9c5 3 8 9 7 15l-9-4-4 3-3-4 3-3z"/><path d="M39 19 14 52"/><path d="M8 34c6-14 20-24 36-26" class="arc"/><path d="M6 44c5-6 11-10 18-12" class="arc"/></svg>',
    heavy: '<svg viewBox="0 0 64 64"><path class="f" d="M24 8c-6 1-10 7-9 13l9-2 3 4 4-3-2-4z"/><path d="M27 18l14 27"/><path d="M32 53h22M37 46l-5-6M46 44l2-8M52 50l7-4M27 49l-7-3"/><path d="M44 8a7 7 0 1 0 6 11 6 6 0 1 1-6-11z" class="f"/></svg>',
    dodge: '<svg viewBox="0 0 64 64"><circle cx="39" cy="12" r="5" class="f"/><path d="M36 20 28 34l9 6-3 14M28 34l-10 4-4 9M33 22l11 3 6 8M38 40l9 3"/><path d="M4 24h14M2 32h12M6 40h10" class="arc"/></svg>',
    axe: '<svg viewBox="0 0 64 64"><path d="M20 56 44 12"/><path class="f" d="M38 9c9-2 18 3 20 12-6-1-11 2-14 7l-8-4c3-4 3-10 2-15z"/><path class="f" d="M44 30c-1 8-8 13-16 13 3-4 4-10 2-15z"/><path d="M14 18a8 8 0 1 0 9 12 7 7 0 1 1-9-12z" class="f"/></svg>',
    block: '<svg viewBox="0 0 64 64"><path class="f2" d="M32 6 52 14v16c0 13-9 23-20 28C21 53 12 43 12 30V14z"/><path d="M32 6v52M12 24h40"/></svg>',
    interact: '<svg viewBox="0 0 64 64"><path class="f2" d="M24 54c-6-5-12-14-12-22 0-3 4-4 6-1l5 7V13c0-3 5-3 5 0v16-20c0-3 5-3 5 0v20-17c0-3 5-3 5 0v18-13c0-3 5-3 5 0v22c0 9-3 15-7 19z"/></svg>',
    lock: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="14"/><path d="M32 6v12M32 46v12M6 32h12M46 32h12"/></svg>'
  };
  const LABEL = { light: 'هجوم خفيف', heavy: 'هجوم ثقيل', dodge: 'مراوغة', axe: 'الفأس', block: 'صد', interact: 'تفاعل', lock: 'تثبيت' };
  function buildHUD(doc) {
    doc = doc || document;
    let stick = doc.getElementById('stick');
    if (!stick) { stick = doc.createElement('div'); stick.id = 'stick'; doc.body.appendChild(stick); }
    stick.className = 'sin-stick'; stick.innerHTML = '<i class="ring-walk"></i><div id="knob"><svg viewBox="0 0 64 64"><path d="M40 10a23 23 0 1 0 14 34A19 19 0 1 1 40 10z"/></svg></div>';
    stick.dataset.zone = '0';
    let pad = doc.getElementById('combat-pad');
    if (!pad) { pad = doc.createElement('div'); pad.id = 'combat-pad'; doc.body.appendChild(pad); }
    pad.innerHTML = '';
    const buttons = {};
    for (const k of ['light', 'heavy', 'dodge', 'axe', 'block', 'interact', 'lock']) {
      const b = doc.createElement('button'); b.type = 'button'; b.className = 'sin-btn b-' + k; b.id = 'b-' + k;
      b.setAttribute('aria-label', LABEL[k]); b.innerHTML = ICON[k] + '<span>' + LABEL[k] + '</span>';
      pad.appendChild(b); buttons[k] = b;
    }
    buttons.lock.classList.add('hidden'); buttons.interact.classList.add('hidden');
    return { stick, knob: stick.querySelector('#knob'), pad, buttons };
  }
  // reflect controller state on the HUD (cheap: only class toggles when something changed)
  function hudSync(hud, hero, canAct) {
    const B = hud.buttons, ws = hero.weapon.state(), inHand = hero.weapon.seat() === 'hand';
    const set = (el, cls, on) => { if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on); };
    set(hud.pad, 'off', !canAct);
    set(B.axe, 'on', inHand); set(B.axe, 'busy', ws === 'Equipping' || ws === 'Unequipping');
    set(B.block, 'disabled', !canAct); set(B.light, 'disabled', !canAct); set(B.heavy, 'disabled', !canAct); set(B.dodge, 'disabled', !canAct); set(B.axe, 'disabled', !canAct);
    set(B.interact, 'hidden', !(canAct && hero.interact.available()));
    set(B.lock, 'hidden', !(canAct && hero.combat.targets() > 0 && inHand));
    set(B.block, 'on', hero.combat.blocking());
  }

  // ================================================================== create
  function create(cfg) {
    const gltf = cfg.gltf, events = AnimationEvents();
    const model = gltf.scene, root = new T.Group(); root.name = 'SinHeroRoot';
    const hs = cfg.scale || HERO_SCALE; model.scale.setScalar(hs); root.add(model);
    // The hero is a session-persistent root. The weapon is attached to moving
    // bones, so its bounds are not reliable for camera frustum tests.
    root.userData.keepDuringPalace = true;
    root.userData.sinHeroRoot = true;                      // outdoor culling and teardown skip everything under this root
    model.userData.keepDuringPalace = true;
    model.traverse(o => { if (o.isSkinnedMesh) o.frustumCulled = false; });
    const meta = (gltf.scenes && gltf.scenes[0] && gltf.scenes[0].userData) || model.userData || {};
    const holster = meta.axeHolster || null;
    const lib = buildLibrary(gltf);
    const motion = analyseMotion(model, lib, hs);          // before the mixer binds: measured on the bind pose
    const anim = AnimationController(model, lib, events);
    const S = anim.S;
    const ik = CharacterIK(model, events);

    // ---------------- weapon: sockets and data-driven attach transforms (no world-space jump on re-parent)
    const rig = resolveRig(model);
    const axe = rig.axe, backSock = rig.backSocket, handSock = rig.handSocket;
    if (!rig.valid || !axe || !backSock || !handSock) throw new Error('SinHero: runtime rig mapping is incomplete');
    axe.userData.keepDuringPalace = true;
    axe.userData.sinPersistentWeapon = true;
    axe.traverse(o => {
      if (!o.userData) o.userData = {};
      o.userData.keepDuringPalace = true;
      o.userData.sinPersistentWeapon = true;
      if (o.isMesh) {
        // Do not disable culling for the whole hero: only the bone-attached
        // weapon needs this exception because its animated bounds can lag.
        o.frustumCulled = false;
        if (o.geometry) {
          if (o.geometry.computeBoundingBox) o.geometry.computeBoundingBox();
          if (o.geometry.computeBoundingSphere) o.geometry.computeBoundingSphere();
          o.geometry.userData.sinPersistentWeapon = true;
        }
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        mats.forEach(m => {
          if (!m) return;
          m.userData = m.userData || {};
          m.userData.sinPersistentWeapon = true;
          ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap'].forEach(k => {
            if (m[k]) { m[k].userData = m[k].userData || {}; m[k].userData.sinPersistentWeapon = true; }
          });
        });
      }
    });
    const ATT = holster && holster.attach ? holster.attach : {
      back: { translation: [0.0026894831, -0.2646781504, -0.0490150489], rotation: [0.0772297904, 0.8029142022, 0.1443045437, 0.5731846690] },
      hand: { translation: [0.0159736704, 0.0025291829, 0.0006476183], rotation: [0.1958154589, 0.7226944566, -0.0331940479, 0.6620175243] }
    };
    const SW = { equip: (holster && holster.clips && holster.clips.Axe_Equip.switch.time) || 0.0668, unequip: (holster && holster.clips && holster.clips.Axe_Unequip.switch.time) || 0.2168 };
    function seat(where) {
      const p = where === 'hand' ? handSock : backSock, a = ATT[where];
      if (axe.parent !== p) p.add(axe);
      axe.position.fromArray(a.translation); axe.quaternion.fromArray(a.rotation); axe.scale.set(1, 1, 1); axe.updateMatrixWorld(true);
      weapon.seat = where;
    }

    // ---------------- foot placement of the idle pose: sole on the ground, feet centred on the collision point
    S.idle.b = 1; anim.evaluate(0); model.updateMatrixWorld(true);
    {
      const fl = model.getObjectByName('foot_l').getWorldPosition(new T.Vector3()), fr = model.getObjectByName('foot_r').getWorldPosition(new T.Vector3());
      let sk = null; model.traverse(o => { if (o.isSkinnedMesh && !sk) sk = o; });
      const box = new T.Box3(); const v = new T.Vector3();
      const pos = sk.geometry.attributes.position; box.makeEmpty();
      for (let i = 0; i < pos.count; i += 3) { sk.getVertexPosition(i, v); v.applyMatrix4(sk.matrixWorld); box.expandByPoint(v); }
      model.position.set(-(fl.x + fr.x) / 2, -box.min.y, -(fl.z + fr.z) / 2);
    }
    const modelBaseY = model.position.y;
    model.updateMatrixWorld(true);
    { const v = new T.Vector3(); ik.setFlat({ ball: model.getObjectByName('ball_l').getWorldPosition(v).y, ankle: model.getObjectByName('foot_l').getWorldPosition(v).y }); }

    // ================================================================== controllers' state
    const weapon = { state: 'Holstered', t: 0, queued: null, seat: 'back', canThrow: false };
    const V = { walk: motion.walk.speed, run: motion.run.speed };       // m/s, from the clips' stance feet
    const G = { walk: motion.walk, run: motion.run };
    const LOCO_KEYS = ['idle', 'cidle', 'walk', 'run'];
    const loco = { target: 'idle', dur: XF.idleWalk, w: { idle: 1, cidle: 0, walk: 0, run: 0 }, run: false, settle: false, hold: 0, extSpeed: 0, speed: 0 };
    // action layer: one owner of the body (attack / dodge / reaction); the previous owner fades out linearly
    const action = { cur: null, fading: [] };
    const combat = { act: null, hits: new Set(), hitstop: 0, block: 0, blocking: false, dodge: null, react: null, iframes: false, pending: null };
    const push = { mode: null, w: 0, blend: 0, scale: 0.52 };
    const targets = new Set();
    const vitals = window.SinCombat?.createVitals(window.SinCombat.RULES.hero);
    let opponent = null, guardSince = -Infinity, guardHeld = false, guardRecoil = 0, dead = false;
    const interactables = [];
    let facing = 0, tNow = 0, lastDt = 1 / 60, wasIdle = true, lastIdleKey = 'idle';
    const lastPos = new T.Vector3(); let hasLast = false;
    const axeHead = new T.Vector3(), axeHeadPrev = new T.Vector3(), axeMid = new T.Vector3(), axeMidPrev = new T.Vector3();
    // The runtime axe's positive Z rim is the cutting surface. Recover
    // three real points once, leaving the older practice targets' sweep intact.
    const guide = [new T.Vector3(0,.24,.125), new T.Vector3(0,.30,.145), new T.Vector3(0,.37,.128)];
    const edge = guide.map(local => ({
      local: local.clone(), previous: new T.Vector3(), current: new T.Vector3(), score: -Infinity
    }));
    const axeVertices = axe.geometry?.attributes.position;
    if (axeVertices) {
      const vertex = new T.Vector3();
      for (let i = 0; i < axeVertices.count; i++) {
        vertex.fromBufferAttribute(axeVertices, i);
        for (let j = 0; j < edge.length; j++) {
          const offset = Math.abs(vertex.y - guide[j].y);
          if (offset > .027) continue;
          const score = vertex.z - offset * .62 - Math.abs(vertex.x) * .26;
          const point = edge[j];
          if (score > point.score) {
            point.score = score;
            point.local.copy(vertex);
          }
        }
      }
    }
    const HEAD_LOCAL = new T.Vector3(0, 0.40, 0), MID_LOCAL = new T.Vector3(0, 0.22, 0);
    const rmA = { x: 0, z: 0 }, rmB = { x: 0, z: 0 };
    seat('back');

    // ================================================================== WeaponController
    function requestEquip() {
      if (weapon.state === 'Holstered') { weapon.state = 'Equipping'; weapon.t = 0; S.equip.time = 0; S.equip.prev = 0; events.emit('weapon:equip-start'); return true; }
      if (weapon.state === 'Unequipping') { weapon.queued = 'equip'; return true; }
      return weapon.state === 'Equipped' || weapon.state === 'Equipping';
    }
    function requestUnequip() {
      if (weapon.state === 'Equipped' && !combat.act && !combat.dodge) { weapon.state = 'Unequipping'; weapon.t = 0; S.unequip.time = 0; S.unequip.prev = 0; events.emit('weapon:unequip-start'); return true; }
      if (weapon.state === 'Equipping') { weapon.queued = 'unequip'; return true; }
      return weapon.state === 'Holstered';
    }
    function weaponStep(dt) {
      const W = weapon;
      if (W.state === 'Equipping') {
        W.t += dt; S.equip.time = W.t;
        if (W.seat !== 'hand' && W.t >= SW.equip) { seat('hand'); events.emit('weapon:grip'); }
        const fi = clamp(W.t / 0.03, 0, 1), fo = 1 - clamp((W.t - 0.34) / 0.1, 0, 1);
        S.equip.a = Math.min(fi, fo);
        if (W.t >= 0.44) { W.state = 'Equipped'; S.equip.a = 0; events.emit('weapon:equipped'); if (W.queued === 'unequip') { W.queued = null; requestUnequip(); } }
      } else if (W.state === 'Unequipping') {
        W.t += dt; S.unequip.time = W.t;
        if (W.seat !== 'back' && W.t >= SW.unequip) { seat('back'); events.emit('weapon:sheathed'); }
        const fi = clamp(W.t / 0.05, 0, 1), fo = 1 - clamp((W.t - 0.245) / 0.12, 0, 1);
        S.unequip.a = Math.min(fi, fo);
        if (W.t >= 0.367) { W.state = 'Holstered'; S.unequip.a = 0; events.emit('weapon:holstered'); if (W.queued === 'equip') { W.queued = null; requestEquip(); } }
      } else { S.equip.a = 0; S.unequip.a = 0; }
      // the locomotion clips have an open right hand: while the axe is held (and no attack drives the fingers)
      // the fingers take the Axe_CombatIdle grip, so the handle never floats in an open palm
      const gw = W.seat === 'hand' && !combat.act ? 1 : 0;
      S.grip.g += (gw - S.grip.g) * damp(gw ? 30 : 18, dt); if (!gw && S.grip.g < 1e-3) S.grip.g = 0;
    }
    // The axe lives under exactly one socket. If anything re-parented it, put it back (never a second axe).
    function maintainWeaponAttachment() {
      const p = weapon.seat === 'hand' ? handSock : backSock;
      if (axe.parent !== p) seat(weapon.seat);
    }
    function forceHolster() { // cinematic push: put the axe away with the real clip
      if (weapon.state === 'Equipped') requestUnequip();
      else if (weapon.state === 'Equipping') { weapon.queued = null; weapon.state = 'Unequipping'; weapon.t = Math.max(0, SW.unequip - 0.12); S.unequip.time = weapon.t; }
    }

    // ================================================================== action layer
    function beginAction(obj, inDur) {
      if (action.cur) action.fading.push({ st: action.cur.st, w: action.cur.w, dur: inDur, adv: action.cur.adv });
      obj.w = 0; obj.inDur = Math.max(1e-3, inDur); action.cur = obj;
      for (const f of action.fading) if (f.st === obj.st) f.w = 0;     // same clip restarting: no double weight
    }
    function endAction(outDur) {
      const c = action.cur; if (!c) return;
      action.fading.push({ st: c.st, w: c.w, dur: Math.max(1e-3, outDur), adv: c.adv });
      action.cur = null;
    }
    function actionWeights(dt) {
      if (action.cur) action.cur.w = Math.min(1, action.cur.w + dt / action.cur.inDur);
      for (let i = action.fading.length - 1; i >= 0; i--) {
        const f = action.fading[i]; f.w -= dt / f.dur;
        if (f.adv) f.st.time = Math.min(f.st.dur - 1e-4, f.st.time + dt);      // a fading clip keeps playing, never freezes
        if (f.w <= 0) action.fading.splice(i, 1);
      }
    }

    // ================================================================== CombatController
    function startAttack(key, inDir) {
      const A = ATTACKS[key], s = S[key];
      let yaw = inDir ? Math.atan2(inDir.x, inDir.z) : null;
      const target = opponent?.aim();
      if (target) {
        const tx = target.x - root.position.x, tz = target.z - root.position.z;
        const bearing = Math.atan2(tx, tz), base = yaw ?? facing;
        const delta = wrapA(bearing - base);
        if (Math.hypot(tx, tz) < 5 && Math.abs(delta) < 1.05) yaw = base + clamp(delta, -.65, .65);
      }
      const chain = !!combat.act;
      if (combat.dodge) { combat.dodge = null; combat.iframes = false; }
      s.time = 0; s.prev = 0;
      combat.act = { key, A, st: s, queued: null, impactFired: false, landFired: false, yaw, started: tNow };
      beginAction({ kind: 'attack', st: s, adv: true }, chain ? XF.chain : A.blendIn);
      combat.hits.clear();
      events.emit('combat:attack', { key });
    }
    function nextAttack(kind, act) {
      if (kind === 'heavy') return act && COMBO.light.indexOf(act.key) >= 0 && act.key !== 'finH' ? COMBO.heavyAfterLight : null;
      if (!act) return null;
      const i = COMBO.light.indexOf(act.key); return i >= 0 && i < COMBO.light.length - 1 ? COMBO.light[i + 1] : null;
    }
    function updateAxeSamples(reset) {
      axeHeadPrev.copy(axeHead); axeMidPrev.copy(axeMid);
      axeHead.copy(HEAD_LOCAL).applyMatrix4(axe.matrixWorld); axeMid.copy(MID_LOCAL).applyMatrix4(axe.matrixWorld);
      if (reset) { axeHeadPrev.copy(axeHead); axeMidPrev.copy(axeMid); }
      for (const point of edge) {
        point.previous.copy(point.current);
        point.current.copy(point.local).applyMatrix4(axe.matrixWorld);
        if (reset) point.previous.copy(point.current);
      }
    }
    // swept test: blade segment (mid -> head) between two frames against each target's vertical capsule
    const segA = new T.Vector3(), segB = new T.Vector3();
    const [blade0, blade1, blade2, blade3, bladeVelocity] = Array.from({ length: 5 }, () => new T.Vector3());
    function sweepHits(act) {
      const A = act.A, t = act.st.time;
      const previous = act.sampleTime ?? t;
      act.sampleTime = t;
      if (t < A.act[0] || (t > A.act[1] && previous >= A.act[1])) return;
      const speed = axeHead.distanceTo(axeHeadPrev) / Math.max(1e-3, lastDt);
      if (speed < 2.2) return;                                              // a resting / slow axe does not wound
      targets.forEach(tg => {
        if (combat.hits.has(tg) || (tg.alive && !tg.alive())) return;
        if (tg.volumes && window.SinCombat) {
          const span = t - previous || 1;
          const start = clamp((A.act[0] - previous) / span, 0, 1);
          const end = clamp((A.act[1] - previous) / span, 0, 1);
          const volumes = tg.volumes();
          let hit = null;
          for (let i = 0; i < edge.length - 1 && !hit; i++) {
            const a = edge[i], b = edge[i + 1];
            blade0.lerpVectors(a.previous, a.current, start);
            blade1.lerpVectors(b.previous, b.current, start);
            blade2.lerpVectors(a.previous, a.current, end);
            blade3.lerpVectors(b.previous, b.current, end);
            hit = window.SinCombat.sweep(blade0, blade1, blade2, blade3, .085, volumes, segA);
          }
          if (hit && (!tg.validate || tg.validate(segA))) {
            combat.hits.add(tg);
            const dir = segB.copy(tg.position()).sub(root.position);
            dir.y = 0;
            dir.normalize();
            const info = { attack: act.key, damage: A.dmg, heavy: !!A.heavy, point: segA,
              dir, push: A.push, time: t, region: hit.name, weaponVelocity: bladeVelocity.subVectors(axeHead,axeHeadPrev).divideScalar(lastDt) };
            const result = tg.onHit?.(info);
            if (result) {
              combat.hitstop = A.heavy ? .075 : .035;
              events.emit('combat:hit', info);
            }
          }
          return;
        }
        if (t > A.act[1]) return;
        const p = tg.position(), r = (tg.radius || 0.4) + 0.12, h0 = p.y + 0.1, h1 = p.y + (tg.height || 1.8);
        for (let i = 0; i <= 4; i++) {
          const u = i / 4;
          segA.lerpVectors(axeMidPrev, axeHeadPrev, u); segB.lerpVectors(axeMid, axeHead, u);
          for (let j = 0; j <= 3; j++) {
            const x = segA.x + (segB.x - segA.x) * j / 3, y = segA.y + (segB.y - segA.y) * j / 3, z = segA.z + (segB.z - segA.z) * j / 3;
            if (y < h0 || y > h1) continue;
            const dx = x - p.x, dz = z - p.z;
            if (dx * dx + dz * dz <= r * r) {
              combat.hits.add(tg);
              const dirx = p.x - root.position.x, dirz = p.z - root.position.z, l = Math.hypot(dirx, dirz) || 1;
              const info = { attack: act.key, damage: A.dmg, heavy: !!A.heavy, point: new T.Vector3(x, y, z), dir: new T.Vector3(dirx / l, 0, dirz / l), push: A.push, time: t };
              try { tg.onHit && tg.onHit(info); } catch (e) { console.warn(e); }
              combat.hitstop = A.heavy ? 0.075 : 0.045;
              events.emit('combat:hit', info);
              return;
            }
          }
        }
      });
    }
    function startDodge(dirLocalX, direction) {
      combat.act = null;
      const s = dirLocalX < -0.25 ? S.dodgeM : S.dodge;
      const dodgeYaw = opponent && direction ? wrapA(Math.atan2(direction.x, direction.z) + Math.PI) : facing;
      facing = dodgeYaw;
      s.time = DODGE.from; s.prev = s.time;
      combat.dodge = { st: s, curve: dirLocalX < -0.25 ? motion.root.dodgeM : motion.root.dodge, yaw: dodgeYaw };
      beginAction({ kind: 'dodge', st: s, adv: true }, DODGE.blendIn);
      events.emit('combat:dodge');
    }
    function hitReaction(info) {
      if (combat.iframes) return false;
      combat.act = null; combat.dodge = null;
      const heavy = !!(info && info.heavy), s = heavy ? S.knock : S.stagger;
      if (info && info.dir) facing = Math.atan2(-info.dir.x, -info.dir.z);       // face the blow; the clip carries the stumble
      s.time = 0; s.prev = 0;
      combat.react = { st: s, heavy, end: heavy ? s.dur - 0.05 : STAGGER.to, curve: heavy ? motion.root.knock : motion.root.stagger, yaw: facing };
      beginAction({ kind: 'react', st: s, adv: true }, 0.05);
      events.emit('hero:hit', info || {});
      return true;
    }

    function resetCombat() {
      dead = false;
      combat.act = combat.dodge = combat.react = combat.pending = null;
      combat.iframes = combat.blocking = guardHeld = false;
      guardSince = -Infinity;
      guardRecoil = 0;
      combat.hitstop = 0;
      combat.hits.clear();
      action.cur = null;
      action.fading.length = 0;
      hasLast = false;
    }
    function die(direction) {
      combat.iframes = false;
      hitReaction({ dir: direction, heavy: false });
      dead = true;
      combat.pending = null;
      combat.blocking = false;
    }

    // ================================================================== push (door cinematics) — same contract as before
    function startPush(opts) {
      if (push.mode) return false;
      const skip = opts && opts.skipEnter;
      combat.act = null; combat.dodge = null; combat.react = null; combat.iframes = false;
      endAction(0.12);
      combat.blocking = false; forceHolster();
      push.scale = (opts && opts.timeScale) || 0.52;
      push.w = 0; push.blend = 0;
      if (skip) { S.push.time = (opts && opts.startFrac ? S.push.dur * opts.startFrac : 0); push.mode = 'play'; }
      else { S.pushEnter.time = 0; S.push.time = 0; push.mode = 'enter'; }
      return true;
    }
    function releasePush() { if (push.mode && push.mode !== 'out') push.mode = 'out'; }
    function pushState() {
      if (!push.mode) return null;
      const s = push.mode === 'enter' ? S.pushEnter : S.push;
      return { mode: push.mode, time: s.time, duration: s.dur, weight: push.w, name: s.clip.name };
    }
    function pushStep(dt) {   // timing contract shared with the door modules (unchanged)
      if (!push.mode) return false;
      const f = damp(push.mode === 'out' ? 12.5 : 6.25, dt);
      push.w += ((push.mode === 'out' ? 0 : 1) - push.w) * f;
      if (push.mode === 'enter') {
        S.pushEnter.time = Math.min(S.pushEnter.dur, S.pushEnter.time + dt * 0.62);
        if (S.pushEnter.time >= S.pushEnter.dur - 0.02) { push.mode = 'blend'; push.blend = 1; S.push.time = 0; }
      } else if (push.mode === 'blend') {
        S.push.time += dt * push.scale; push.blend = Math.max(0, push.blend - dt / 0.28); if (push.blend <= 0) push.mode = 'play';
      } else if (push.mode === 'play') {
        S.push.time = Math.min(S.push.dur, S.push.time + dt * push.scale);
      }
      if (push.mode === 'out' && push.w < 0.02) { push.mode = null; push.w = 0; return false; }
      return true;
    }

    // ================================================================== LocomotionController
    // normalized phase of a locomotion clip (0 = left-foot contact)
    const phaseOf = k => ((S[k].time - G[k].ph0) / G[k].cycle % 1 + 1) % 1;
    const timeAt = (k, ph) => G[k].ph0 + ((ph % 1) + 1) % 1 * G[k].cycle;
    function xfDur(from, to) {
      const mv = k => k === 'walk' || k === 'run';
      if (!mv(from) && !mv(to)) return XF.idleSwap;
      if (!mv(from)) return to === 'walk' ? XF.idleWalk : XF.idleRun;
      if (!mv(to)) return from === 'walk' ? XF.walkIdle : XF.runIdle;
      return from === 'walk' ? XF.walkRun : XF.runWalk;
    }
    function setLocoTarget(key) {
      if (key === loco.target) return;
      const from = loco.target;
      loco.dur = xfDur(from, key);
      if ((key === 'walk' || key === 'run') && loco.w[key] < 1e-3) {
        // a step that starts from a moving clip keeps its foot phase; from idle it starts at left mid-stance
        const other = key === 'walk' ? 'run' : 'walk';
        S[key].time = loco.w[other] > 0.05 ? timeAt(key, phaseOf(other)) : timeAt(key, G[key].start);
        S[key].prev = S[key].time;
      }
      loco.target = key;
    }
    function locoWeights(dt) {
      const r = dt / loco.dur;
      for (const k of LOCO_KEYS) { const g = k === loco.target ? 1 : 0, w = loco.w[k]; loco.w[k] = g > w ? Math.min(g, w + r) : Math.max(g, w - r); }
      for (const k of ['walk', 'run']) if (loco.w[k] > 0) {
        const s = S[k], t0 = s.time; s.time = (s.time + dt) % s.dur;
        const cl = G[k].contactL, cr = G[k].contactR;
        if (loco.w[k] > 0.5) {
          const crossed = c => (t0 < c && s.time >= c) || (s.time < t0 && (c >= t0 || c < s.time));
          if (crossed(cl)) events.emit('foot', { side: 'l', gait: k }); else if (crossed(cr)) events.emit('foot', { side: 'r', gait: k });
        }
      }
    }

    // ================================================================== InteractionController
    function registerInteractable(it) { interactables.push(it); return () => { const i = interactables.indexOf(it); if (i >= 0) interactables.splice(i, 1); }; }
    function availableInteract() { for (const it of interactables) { try { if (it.available(root.position)) return it; } catch (_) {} } return null; }

    // ================================================================== main update
    const inDir = new T.Vector3(), mv = new T.Vector3();
    const result = { speed: 0, gait: 0, moving: false, facing: 0, running: false };
    /* ctx: { dt, dirX, dirZ (camera-relative stick direction in world space), mag (0..1),
              allowMove, allowAct, paced (an outside module moves the root), cap (m/s), collide(x,z), ground(x,z,y), facing, ik } */
    function update(ctx) {
      const dt0 = ctx.dt; tNow += dt0; lastDt = dt0;
      facing = ctx.facing;
      // hit-stop: the pose holds for a few frames after a hit (nothing moves meanwhile: attacks are in place)
      let dt = dt0;
      if (combat.hitstop > 0) { combat.hitstop -= dt0; dt = dt0 * 0.05; }
      const allowAct = !!ctx.allowAct && !push.mode && !dead;
      const mag = ctx.allowMove && !dead ? ctx.mag : 0;
      const hasDir = mag >= STICK.dead;
      if (hasDir) inDir.set(ctx.dirX, 0, ctx.dirZ).normalize(); else inDir.set(0, 0, 0);

      // ---------- 1. inputs -> actions (buffered)
      const IN = cfg.input;
      const press = IN && allowAct ? IN.take(tNow, BUFFER) : null;
      if (!allowAct && IN) IN.take(tNow + 1, 0);   // presses made during cinematics are dropped, never replayed later
      const blockHeld = !!(IN && IN.st.held.block) && allowAct;
      if (press) {
        const n = press.name, act = combat.act, A = act && act.A;
        let used = true;
        if (n === 'axe') {
          if (!act && !combat.dodge && !combat.react) (weapon.state === 'Holstered' || weapon.state === 'Unequipping') ? requestEquip() : requestUnequip();
        } else if (n === 'dodge') {
          const canD = !combat.react && !combat.dodge && (!act || act.st.time < A.act[0] || act.st.time >= A.impact);
          if (canD) startDodge(hasDir ? (inDir.x * Math.cos(facing) - inDir.z * Math.sin(facing)) : 0, hasDir ? inDir : null); else used = false;
        } else if (n === 'light' || n === 'heavy') {
          if (weapon.state !== 'Equipped') { if (!combat.react && !combat.dodge) { requestEquip(); combat.pending = { name: n, t: tNow }; } }   // draw, then swing
          else if (!combat.react && !combat.dodge) {
            if (!act) startAttack(n === 'light' ? COMBO.light[0] : COMBO.heavy, hasDir ? inDir : null);
            else if (act.st.time >= A.open) { const nk = nextAttack(n, act); if (nk && !act.queued) act.queued = nk; else used = false; }
            else used = false;                                             // stays buffered until the combo window opens
          } else used = false;
        } else if (n === 'interact') {
          const it = availableInteract(); if (it) { try { it.activate(); } catch (e) { console.warn(e); } }
        }
        if (used) IN.consume();
      }

      // ---------- 2. weapon
      weaponStep(dt);
      if (combat.pending) {
        const P = combat.pending;
        if (tNow - P.t > 1.0 || combat.react || combat.dodge || !allowAct) combat.pending = null;
        else if (!combat.act && (weapon.state === 'Equipped' || (weapon.state === 'Equipping' && weapon.t >= 0.3 && weapon.seat === 'hand'))) {
          if (weapon.state === 'Equipping') { weapon.state = 'Equipped'; S.equip.a = 0; events.emit('weapon:equipped'); }
          combat.pending = null;
          startAttack(P.name === 'light' ? COMBO.light[0] : COMBO.heavy, hasDir ? inDir : null);
        }
      }

      // ---------- 3. action layer progress + authored root motion
      const pushing = pushStep(dt);
      let rmX = 0, rmZ = 0;                                           // root motion this frame (world metres)
      function rootMotion(curve, yaw, t0, t1, w) {
        curveAt(curve, t0, rmA); curveAt(curve, t1, rmB);
        const dx = (rmB.x - rmA.x) * hs * w, dz = (rmB.z - rmA.z) * hs * w, c = Math.cos(yaw), s = Math.sin(yaw);
        rmX += dx * c + dz * s; rmZ += -dx * s + dz * c;               // model space -> world (rotation about +Y by yaw)
      }
      if (combat.react) {
        const R = combat.react, t0 = R.st.time; R.st.time = Math.min(R.st.dur - 1e-4, t0 + dt);
        if (!dead) rootMotion(R.curve, R.yaw, t0, R.st.time, action.cur ? action.cur.w : 1);
        if (!dead && R.st.time >= R.end) { combat.react = null; endAction(XF.actionToIdle); }
      } else if (combat.dodge) {
        const D = combat.dodge, t0 = D.st.time; D.st.time = Math.min(DODGE.to, t0 + dt);
        rootMotion(D.curve, D.yaw, t0, D.st.time, action.cur ? action.cur.w : 1);
        combat.iframes = D.st.time >= DODGE.iframes[0] && D.st.time <= DODGE.iframes[1];
        const cancel = D.st.time >= DODGE.cancel && hasDir;
        if (D.st.time >= DODGE.to || cancel) { combat.dodge = null; combat.iframes = false; endAction(cancel ? XF.actionToMove : XF.actionToIdle); }
      } else if (combat.act) {
        const act = combat.act, A = act.A;
        act.st.time = Math.min(act.st.dur - 1e-4, act.st.time + dt * A.ts);
        const tt = act.st.time;
        // attacks are in place: the body only turns toward the stick while the swing blends in (feet not yet planted)
        if (act.yaw != null && action.cur && action.cur.w < 1) facing += wrapA(act.yaw - facing) * damp(TURN_K * 1.6, dt0);
        if (!act.impactFired && tt >= A.impact) { act.impactFired = true; events.emit('combat:impact', { key: act.key, heavy: !!A.heavy }); }
        if (A.landing && !act.landFired && tt >= A.landing) { act.landFired = true; events.emit('combat:land', { key: act.key }); }
        if (act.queued && tt >= A.cancel) startAttack(act.queued, hasDir ? inDir : null);
        else if ((hasDir && tt >= A.move) || tt >= A.end) { combat.act = null; endAction(hasDir ? XF.actionToMove : XF.actionToIdle); }
      }
      actionWeights(dt);
      let aw = action.cur ? action.cur.w : 0; for (const f of action.fading) aw += f.w;
      aw = Math.min(1, Math.max(aw, push.w));
      const owned = !!(action.cur || push.mode);                       // something other than locomotion drives the body

      // ---------- 4. locomotion state + facing
      const blocking = blockHeld && weapon.state === 'Equipped' && !owned;
      if (blockHeld && !guardHeld) guardSince = tNow;
      guardHeld = blockHeld;
      if (blockHeld && weapon.state === 'Holstered' && !owned) requestEquip();
      combat.blocking = blocking;
      const cap = Math.min(ctx.cap == null ? 99 : ctx.cap, blocking ? 1.5 : 99);
      const idleKey = (weapon.seat === 'hand' || weapon.state === 'Equipping') ? 'cidle' : 'idle';
      let diff = 0;
      if (hasDir) diff = wrapA(Math.atan2(inDir.x, inDir.z) - facing);
      if (ctx.paced) {
        // an outside module moves the root (door approach, hall entrance): walk blended by the measured ground speed
        setLocoTarget(loco.extSpeed > 0.05 ? 'walk' : idleKey);
      } else if (pushing) setLocoTarget(idleKey);
      else if (!hasDir) {
        // releasing the stick from a run steps down through the walk (phase-matched) before settling: a 9.4 m/s
        // stride cannot blend straight into a standing pose without the feet gliding
        if (loco.target === 'run' || (loco.target === 'walk' && loco.settle && loco.w.run > 0.05)) { loco.settle = true; loco.hold = 0; setLocoTarget('walk'); }
        else if (loco.target === 'walk' && loco.w.walk > 0.5) {
          // stop on a stop-friendly walk phase (feet within a natural stance), at most 0.25 s after the release
          loco.hold += dt0;
          const ok = G.walk.stopOk[Math.min(G.walk.stopOk.length - 1, Math.floor(phaseOf('walk') * G.walk.stopOk.length))];
          if (ok || loco.hold > 0.25) { loco.settle = false; setLocoTarget(idleKey); }
        } else { loco.settle = false; setLocoTarget(idleKey); }
        loco.run = false;
      } else {
        loco.settle = false; loco.hold = 0;
        loco.run = loco.run ? mag >= STICK.runOut : mag >= STICK.runIn;
        if (cap < V.run) loco.run = false;
        setLocoTarget(loco.run ? 'run' : 'walk');
      }
      // facing turns toward the stick only while locomotion owns the body
      if (hasDir && !owned) {
        // exponential approach as before the new hero, with a cap on angular speed: a planted foot is not swept
        // round by a 30 rad/s pivot on a sharp reversal (the cap is lower at run speed, where stance is short)
        const wMax = TURN_MAX[0] + (TURN_MAX[1] - TURN_MAX[0]) * clamp(loco.w.run, 0, 1);
        facing += clamp(diff * damp(TURN_K, dt0), -wMax * dt0, wMax * dt0);
      }
      facing = wrapA(facing);
      locoWeights(dt);
      if (ctx.paced) { const k = clamp(loco.extSpeed / V.walk, 0, 1); if (loco.w.walk > k) { loco.w[idleKey] += loco.w.walk - k; loco.w.walk = k; } }

      // ---------- 5. motor: root speed = sum(weight x measured clip speed), scaled by what locomotion still owns
      let lw = 0; for (const k of LOCO_KEYS) lw += loco.w[k];
      const lk = (1 - aw) / Math.max(1e-6, lw);
      loco.speed = (loco.w.walk * V.walk + loco.w.run * V.run) * lk;
      const p = root.position;
      let sx = 0, sz = 0;
      if (!ctx.paced) {
        sx = Math.sin(facing) * loco.speed * dt + rmX; sz = Math.cos(facing) * loco.speed * dt + rmZ;
        if (hitStopFrozen()) { sx = rmX; sz = rmZ; }
      }
      const dist = Math.hypot(sx, sz);
      if (dist > 1e-7) {
        const n = Math.max(1, Math.ceil(dist / MAX_STEP)), ix = sx / n, iz = sz / n;
        for (let i = 0; i < n; i++) {
          if (!ctx.collide || !ctx.collide(p.x + ix, p.z)) p.x += ix;
          if (!ctx.collide || !ctx.collide(p.x, p.z + iz)) p.z += iz;
        }
      }
      // external movers: the walk weight follows their measured ground speed
      let measured = 0;
      if (hasLast) { measured = Math.hypot(p.x - lastPos.x, p.z - lastPos.z) / Math.max(1e-4, dt0); if (measured > 12) measured = 0; }
      lastPos.copy(p); hasLast = true;
      loco.extSpeed += (measured - loco.extSpeed) * damp(12, dt0);

      // ---------- 6. animation: base weights from locomotion x (1 - action), then one mixer evaluation
      for (const s of anim.list) s.b = 0;
      for (const k of LOCO_KEYS) S[k].b = loco.w[k] * lk;
      if (action.cur) S[action.cur.st.key].b += action.cur.w;
      for (const f of action.fading) S[f.st.key].b += Math.max(0, f.w);
      if (pushing) { S.push.b = push.w * (push.mode === 'enter' ? 0 : push.mode === 'blend' ? 1 - push.blend : 1); S.pushEnter.b = push.w - S.push.b; }
      S.idle.time += dt; S.cidle.time += dt;
      combat.block += ((blocking ? 1 : 0) - combat.block) * damp(blocking ? 16 : 10, dt);
      guardRecoil = Math.max(0, guardRecoil - dt0 * 5.8);
      S.guard.u = combat.block < 1e-3 ? 0 : combat.block;
      S.guard.time = GUARD_T + .16 * Math.sin(guardRecoil * Math.PI);
      S.grip.time = 0;
      anim.evaluate(dt);
      maintainWeaponAttachment();

      // ---------- 7. root transform, then IK on the final pose
      model.position.y = modelBaseY;
      root.rotation.y = facing; root.updateMatrixWorld(true);
      const idleNow = loco.target === 'idle' || loco.target === 'cidle';
      const stanceSwap = idleNow && loco.target !== lastIdleKey; lastIdleKey = idleNow ? loco.target : lastIdleKey;
      const footMode = owned || !idleNow || ctx.paced || stanceSwap || loco.w.idle * loco.w.cidle > 0 ? 'move' : (!wasIdle ? 'stop-begin' : 'hold');
      wasIdle = idleNow && !owned;
      if (ctx.ik !== false) ik.apply(root, ctx.ground, dt0, !owned || !!combat.react, footMode); else ik.apply(root, null, dt0, false, 'move');
      if (combat.act) { updateAxeSamples(false); sweepHits(combat.act); } else updateAxeSamples(true);

      const moving = hasDir && !owned;
      result.speed = loco.speed; result.gait = moving ? (loco.target === 'run' ? 2 : 1) : 0;
      result.moving = moving; result.running = moving && loco.target === 'run'; result.facing = facing;
      return result;
    }
    function hitStopFrozen() { return combat.hitstop > 0 && !!combat.act; }

    // ================================================================== public
    const hero = {
      root, model, mixer: anim.mixer, events, lib, rig, motion, vitals,
      update,
      speeds: () => ({ walk: V.walk, run: V.run }),
      weapon: { state: () => weapon.state, equip: requestEquip, unequip: requestUnequip, seat: () => weapon.seat, canThrow: () => false },
      combat: {
        state: () => combat.act ? combat.act.key : combat.dodge ? 'dodge' : combat.react ? (combat.react.heavy ? 'knockdown' : 'stagger') : combat.blocking ? 'block' : 'none',
        registerTarget(t) { targets.add(t); return () => targets.delete(t); }, targets: () => targets.size,
        hit: hitReaction, guardImpact: () => { guardRecoil = .98; }, blocking: () => combat.blocking, guardAge: () => tNow - guardSince,
        invulnerable: () => combat.iframes, fight(target) { opponent = target; }, reset: resetCombat, die,
        timeline: () => ({ clip: action.cur?.st.clip.name ?? LOCO_KEYS.find(k => loco.w[k] > .5),
          time: action.cur?.st.time, window: combat.act?.A.act, started: combat.act?.started, dodge: combat.dodge ? DODGE.iframes : null }),
        axeContact: () => [edge[0].current, edge[2].current]
      },
      interact: { register: registerInteractable, available: availableInteract },
      // compatibility facade used by the royal door, temple doors and wing doors
      compat: {
        startPush, releasePush, pushing: () => !!push.mode, pushState,
        locked: () => !!(combat.act || combat.dodge || combat.react) && !(combat.act && combat.act.st.time >= combat.act.A.move),
        state: () => push.mode ? 'push' : combat.act ? combat.act.key : combat.dodge ? 'dodge' : loco.target === 'cidle' ? 'idle' : loco.target,
        pushClipRef: () => lib.push, setWalkScale() {}, runSample: () => ({ time: S.run.time, dur: S.run.dur, loop: T.LoopRepeat, w: S.run.w[0] })
      },
      debug() {
        const w = {}; for (const s of anim.list) if (s.w[0] + s.w[1] + s.w[2] + s.w[3] > 1e-3) w[s.key] = s.w.map(x => +x.toFixed(3));
        const clipTimes = {}, clipDur = {}; for (const k of ['idle', 'cidle', 'walk', 'run']) { clipTimes[k] = S[k].time; clipDur[k] = S[k].dur; }
        return {
          weapon: weapon.state, seat: weapon.seat, axeParent: axe.parent && axe.parent.name, axeVisible: axe.visible !== false, axeScale: +axe.scale.x.toFixed(3),
          speed: +loco.speed.toFixed(3), target: loco.target, gait: loco.target === 'run' ? 2 : loco.target === 'walk' ? 1 : 0, locoClip: loco.target,
          locoWeights: Object.fromEntries(LOCO_KEYS.map(k => [k, +loco.w[k].toFixed(3)])), clipTimes, clipDur,
          speeds: { walk: +V.walk.toFixed(3), run: +V.run.toFixed(3) }, cycle: { walk: +G.walk.cycle.toFixed(3), run: +G.run.cycle.toFixed(3) },
          combat: hero.combat.state(), action: action.cur ? action.cur.kind : null, actionWeight: action.cur ? +action.cur.w.toFixed(3) : 0, fading: action.fading.length,
          attackTime: combat.act ? +combat.act.st.time.toFixed(3) : null, queued: combat.act ? combat.act.queued : null,
          push: pushState(), weights: w, activeActions: anim.activeActions(), totalActions: anim.totalActions(), listeners: events.count(), ik: ik.state()
        };
      },
      dispose() {
        anim.mixer.stopAllAction(); for (const s of anim.list) for (const a of s.acts) if (a) anim.mixer.uncacheClip(a.getClip());
        anim.mixer.uncacheRoot(model);
        model.traverse(o => { if (o.isMesh) { o.geometry.dispose(); const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach(x => { for (const k in x) if (x[k] && x[k].isTexture) x[k].dispose(); x.dispose(); }); } });
      }
    };
    return hero;
  }

  window.SinHero = { create, resolveRig, InputController, buildHUD, hudSync, CONFIG: { STICK, XF, TURN_K, TURN_MAX, MAX_STEP, BUFFER, ATTACKS, COMBO, DODGE, STAGGER, CLIPS, HERO_SCALE } };
})();
