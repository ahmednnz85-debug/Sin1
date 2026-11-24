/* Sîn — Advanced Character & Combat Controller V1
   Hero: assets/Sin_combat_FINAL3_axe.glb (70-bone rig, axe with back / hand sockets).

   Modules (one file, loaded as a legacy script after three-compat exposes THREE):
     InputController      analog stick (6 zones + hysteresis), action buttons, keyboard, camera drag (multi-touch)
     ClipLibrary          picks the clips that passed visual review, strips the rest, builds the jog cycle, bone masks
     AnimationController  layered state blender (lower / upper / right arm / right fingers), phase-synced
                          locomotion blend space, inertial blending, hit-stop
     AnimationEvents      clip-time markers -> callbacks (equip switch, impact, landing, footsteps)
     LocomotionController speed bands, acceleration, turning, stride-synced playback rate
     CharacterMotor       moves the hero root with the game's collision callback, root-motion / motion warping
     WeaponController     Holstered / Equipping / Equipped / Unequipping (+ Thrown / Recalling reserved)
     CombatController     light / heavy chains, sprint attacks, dodge, block, hit windows on the real axe path
     InteractionController context button (registered interactables)
     CharacterIK          two-bone leg IK + pelvis drop on uneven ground, procedural turn lean
     CameraController     exploration <-> combat framing, impact shake (small, decaying)
   The palace door modules keep using the same facade as before (startPush / releasePush / pushState ...). */
(function () {
  'use strict';
  const T = window.THREE;
  if (!T) return;

  // ------------------------------------------------------------------ constants
  const HERO_SCALE = 1.85;                       // model is ~1 unit tall -> ~1.84 m
  const BAND = [[0, 0], [0.8, 1.8], [1.8, 3.2], [3.2, 4.8], [4.8, 6.6]];   // idle walk jog run sprint (m/s)
  const STICK_CURVE = [[0.10, 0.8], [0.30, 1.2], [0.55, 1.8], [0.75, 3.2], [0.90, 4.8], [1.0, 6.6]];
  const GAIT_UP = [0.10, 0.55, 0.75, 0.90];      // stick deflection that enters gait i+1
  const HYST = 0.04;
  const ACCEL = 10.5, DECEL = 13.5;              // m/s²
  const BUFFER = 0.22;                           // input buffer (s)

  // Clips used (everything else in the file is dropped after load).
  const CLIPS = {
    idle: 'idle_impatient', cidle: 'Axe_CombatIdle', walk: 'walk_casual', sprint: 'sprint_loop_quaternius',
    jogSrc: 'kr_run_to_sprint_sword',
    atkR: 'Attack_Right', atkL: 'Attack_Left', finH: 'Finisher_Heavy', finJ: 'Finisher_Jump',
    dodge: 'km_dodge_back', dodgeM: 'km_dodge_back_mirror', stagger: 'fall', knock: 'km_knockdown_getup_mirror',
    push: 'push_object', pushEnter: 'push_enter_quaternius', equip: 'Axe_Equip', unequip: 'Axe_Unequip'
  };
  // Jog: one steady stride of the MVN run (left contact 1.842 s -> next left contact 2.675 s).
  const JOG_CUT = [1.842, 2.675];

  // Locomotion nodes. nat = planted-foot speed of the in-place clip (model units / s, measured at 120 Hz),
  // cycles = strides in the clip, ph0 = time of the left-foot contact (phase 0) so the nodes stay in step.
  const LOCO = {
    walk: { nat: 0.705, cycles: 2, ph0: 0.417 },
    jog: { nat: 1.38, cycles: 1, ph0: 0.07 },
    sprint: { nat: 4.60, cycles: 1, ph0: 0.05 }
  };

  // Attack data, from the axe-head trajectory of each clip (speed peaks) + the file's combat metadata.
  //   wind = windup end, act = active (hit) window, cancel = earliest chain point, move = locomotion cancel,
  //   end = blend back to the base pose, open = combo input accepted from, ts = playback rate.
  const ATTACKS = {
    atkR: { clip: 'atkR', ts: 1.12, wind: 0.26, act: [0.27, 0.39], impact: 0.33, open: 0.22, cancel: 0.55, move: 0.66, end: 1.02, blendIn: 0.07, dmg: 10, push: 0.45, shake: 0.12 },
    atkL: { clip: 'atkL', ts: 1.12, wind: 0.15, act: [0.16, 0.42], impact: 0.33, open: 0.22, cancel: 0.55, move: 0.66, end: 1.02, blendIn: 0.08, dmg: 10, push: 0.4, shake: 0.12 },
    finH: { clip: 'finH', ts: 1.08, wind: 0.68, act: [0.70, 0.88], impact: 0.79, open: 1.0, cancel: 1.25, move: 1.22, end: 1.70, blendIn: 0.09, dmg: 26, push: 0.7, shake: 0.42, heavy: true },
    finJ: { clip: 'finJ', ts: 1.08, wind: 0.74, act: [0.74, 0.87], impact: 0.81, open: 1.0, cancel: 1.25, move: 1.22, end: 1.74, blendIn: 0.09, dmg: 32, push: 0.9, shake: 0.6, heavy: true, landing: 0.84, leap: 1.9 }
  };
  const COMBO = { light: ['atkR', 'atkL', 'finH'], heavyAfterLight: 'finJ', heavy: 'finH', sprintLight: 'atkR', sprintHeavy: 'finJ' };
  const DODGE = { from: 0.55, to: 1.75, ts: 1.45, dist: 1.25, iframes: [0.58, 0.95], cancel: 1.38, blendIn: 0.05 };
  const GUARD_T = 0.02;                           // guard pose: km_dodge_back frame 0 (axe raised across the head)
  const STAGGER = { to: 0.72, ts: 1.15 };         // light hit: first stumble of `fall`
  const KNOCK = { ts: 1.25 };

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
  function curve(pts, x) {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
    return pts[pts.length - 1][1];
  }

  // ================================================================== ClipLibrary
  function resample(clip, t0, t1, name, fps) {
    const n = Math.max(2, Math.round((t1 - t0) * fps) + 1), tracks = [];
    for (const tr of clip.tracks) {
      const size = tr.getValueSize(), it = tr.createInterpolant(), times = new Float32Array(n), vals = new Float32Array(n * size);
      for (let i = 0; i < n; i++) {
        const t = t0 + (t1 - t0) * i / (n - 1); times[i] = t - t0;
        const r = it.evaluate(t); for (let c = 0; c < size; c++) vals[i * size + c] = r[c];
      }
      tracks.push(new tr.constructor(tr.name, times, vals));
    }
    return new T.AnimationClip(name, t1 - t0, tracks);
  }
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
  // Remove the residual forward/side drift of an in-place clip's pelvis (keeps the vertical bob).
  function centerPelvis(clip, ref) {
    const tr = clip.tracks.find(t => t.name === 'pelvis.position'); if (!tr || !ref) return;
    const v = tr.values, n = v.length / 3; let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += v[i * 3]; my += v[i * 3 + 1]; }
    mx /= n; my /= n;
    // pelvis local frame: x / y are horizontal in this rig (z is up, see root/pelvis transforms)
    for (let i = 0; i < n; i++) { v[i * 3] += ref[0] - mx; v[i * 3 + 1] += ref[1] - my; }
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
    const jog = resample(lib.jogSrc, JOG_CUT[0], JOG_CUT[1], 'Sin_Jog_Cycle', 60);
    closeLoop(jog, 0.16);
    const idlePel = lib.idle.tracks.find(t => t.name === 'pelvis.position');
    const ref = idlePel ? [idlePel.values[0], idlePel.values[1]] : null;
    centerPelvis(jog, ref);
    lib.jog = jog; delete lib.jogSrc;
    closeLoop(lib.sprint, 0.06);
    // Drop every other clip: one hero, one set of clips in memory.
    gltf.animations.length = 0;
    for (const k in lib) gltf.animations.push(lib[k]);
    return lib;
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
    addState('walk', lib.walk, true); addState('jog', lib.jog, true); addState('sprint', lib.sprint, true);
    for (const k of ['atkR', 'atkL', 'finH', 'finJ']) addState(k, lib[k], false);
    addState('dodge', lib.dodge, false); addState('dodgeM', lib.dodgeM, false);
    addState('guard', lib.dodge, false, { time: GUARD_T });
    addState('grip', lib.cidle, false, { time: 0 });
    addState('stagger', lib.stagger, false); addState('knock', lib.knock, false);
    addState('push', lib.push, false); addState('pushEnter', lib.pushEnter, false);
    addState('equip', lib.equip, false); addState('unequip', lib.unequip, false);

    // ---------------- inertial blending: capture the shown pose, decay the offset to the new target
    const bones = []; model.traverse(o => { if (o.isBone || o.name === 'Axe_RightHand_Socket') bones.push(o); });
    const nB = bones.length;
    const lastQ = new Float32Array(nB * 4), lastP = new Float32Array(nB * 3), offQ = new Float32Array(nB * 4), offP = new Float32Array(nB * 3);
    let inert = { pending: 0, t: 0, dur: 0, active: false, have: false };
    const q1 = new T.Quaternion(), q2 = new T.Quaternion(), qI = new T.Quaternion();
    function inertialize(dur) { if (!inert.have) return; inert.pending = Math.max(inert.pending, dur); }
    function applyInertia(dt) {
      if (inert.pending > 0) {
        for (let i = 0; i < nB; i++) {
          const b = bones[i];
          q1.set(lastQ[i * 4], lastQ[i * 4 + 1], lastQ[i * 4 + 2], lastQ[i * 4 + 3]);
          q2.copy(b.quaternion).invert(); q1.multiply(q2);          // off = shown * target^-1
          if (q1.w < 0) { q1.x = -q1.x; q1.y = -q1.y; q1.z = -q1.z; q1.w = -q1.w; }
          offQ[i * 4] = q1.x; offQ[i * 4 + 1] = q1.y; offQ[i * 4 + 2] = q1.z; offQ[i * 4 + 3] = q1.w;
          offP[i * 3] = lastP[i * 3] - b.position.x; offP[i * 3 + 1] = lastP[i * 3 + 1] - b.position.y; offP[i * 3 + 2] = lastP[i * 3 + 2] - b.position.z;
        }
        inert.dur = inert.pending; inert.t = 0; inert.active = true; inert.pending = 0;
      }
      if (inert.active) {
        inert.t += dt; const x = clamp(inert.t / inert.dur, 0, 1);
        const k = 1 - x * x * x * (x * (x * 6 - 15) + 10);           // quintic decay (zero velocity at both ends)
        if (k <= 0.001) inert.active = false;
        else for (let i = 0; i < nB; i++) {
          const b = bones[i];
          q1.set(offQ[i * 4], offQ[i * 4 + 1], offQ[i * 4 + 2], offQ[i * 4 + 3]); qI.identity().slerp(q1, k);
          b.quaternion.premultiply(qI);
          b.position.x += offP[i * 3] * k; b.position.y += offP[i * 3 + 1] * k; b.position.z += offP[i * 3 + 2] * k;
        }
      }
    }
    function capture() {
      for (let i = 0; i < nB; i++) {
        const b = bones[i];
        lastQ[i * 4] = b.quaternion.x; lastQ[i * 4 + 1] = b.quaternion.y; lastQ[i * 4 + 2] = b.quaternion.z; lastQ[i * 4 + 3] = b.quaternion.w;
        lastP[i * 3] = b.position.x; lastP[i * 3 + 1] = b.position.y; lastP[i * 3 + 2] = b.position.z;
      }
      inert.have = true;
    }

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
      applyInertia(dt);
    }
    function activeActions() { let n = 0; for (const s of list) for (const a of s.acts) if (a && a.enabled) n++; return n; }
    return { S, list, mixer, evaluate, capture, inertialize, bones, activeActions, totalActions: () => mixer._actions.length };
  }

  // ================================================================== CharacterIK
  function CharacterIK(model, events) {
    const B = n => model.getObjectByName(n);
    const legs = ['l', 'r'].map(s => ({ thigh: B('thigh_' + s), calf: B('calf_' + s), foot: B('foot_' + s), ball: B('ball_' + s) }));
    const pelvis = B('pelvis'), spine = B('spine_01');
    const v1 = new T.Vector3(), v2 = new T.Vector3(), v3 = new T.Vector3(), tgt = new T.Vector3(), dir = new T.Vector3(), bend = new T.Vector3(), nj = new T.Vector3();
    const qa = new T.Quaternion(), qb = new T.Quaternion(), qp = new T.Quaternion(), qf = new T.Quaternion(), ax = new T.Vector3();
    let pelvisOff = 0; const footOff = [0, 0];
    function setWorldQ(bone, q) { bone.parent.getWorldQuaternion(qp).invert(); bone.quaternion.copy(qp.multiply(q)); bone.updateMatrixWorld(true); }
    function aim(bone, from, to) { bone.getWorldQuaternion(qa); qb.setFromUnitVectors(from.normalize(), to.normalize()).multiply(qa); setWorldQ(bone, qb); }
    function solve(leg, lift) {
      leg.thigh.getWorldPosition(v1); leg.calf.getWorldPosition(v2); leg.foot.getWorldPosition(v3); leg.foot.getWorldQuaternion(qf);
      const L1 = v1.distanceTo(v2), L2 = v2.distanceTo(v3);
      tgt.copy(v3); tgt.y += lift;
      dir.subVectors(tgt, v1); const d = clamp(dir.length(), Math.abs(L1 - L2) + 0.002, L1 + L2 - 0.002); dir.normalize();
      bend.subVectors(v2, v1); bend.addScaledVector(dir, -bend.dot(dir)); if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1); bend.normalize();
      const along = (L1 * L1 - L2 * L2 + d * d) / (2 * d), side = Math.sqrt(Math.max(0, L1 * L1 - along * along));
      nj.copy(v1).addScaledVector(dir, along).addScaledVector(bend, side);
      aim(leg.thigh, ax.subVectors(v2, v1), v3.subVectors(nj, v1));
      leg.calf.getWorldPosition(v2); leg.foot.getWorldPosition(v3);
      tgt.copy(v1).addScaledVector(dir, d);
      aim(leg.calf, ax.subVectors(v3, v2), v1.subVectors(tgt, v2));
      setWorldQ(leg.foot, qf);
    }
    // ground(x,z,y) -> floor height. Only engaged when the floor under the two feet differs (steps, stairs, ramps).
    function apply(root, ground, dt, enabled) {
      let want0 = 0, want1 = 0, drop = 0;
      if (enabled && ground) {
        const base = root.position.y;
        for (let i = 0; i < 2; i++) {
          const leg = legs[i]; leg.ball.getWorldPosition(v1);
          const contact = clamp(1 - (v1.y - base - 0.06) / 0.18, 0, 1);       // foot planted in the clip
          const h = ground(v1.x, v1.z, base + 0.5);
          const dh = Number.isFinite(h) ? clamp(h - base, -0.32, 0.32) : 0;
          if (i === 0) want0 = dh * contact; else want1 = dh * contact;
        }
        drop = Math.min(0, want0, want1);
      }
      const k = damp(14, dt);
      pelvisOff += (drop - pelvisOff) * k; footOff[0] += (want0 - pelvisOff - footOff[0]) * k; footOff[1] += (want1 - pelvisOff - footOff[1]) * k;
      if (Math.abs(pelvisOff) < 1e-4 && Math.abs(footOff[0]) < 2e-3 && Math.abs(footOff[1]) < 2e-3) return;
      model.position.y += pelvisOff;                       // whole body down; then lift the higher foot
      model.updateMatrixWorld(true);
      for (let i = 0; i < 2; i++) if (Math.abs(footOff[i]) > 2e-3) solve(legs[i], footOff[i]);
    }
    // turn lean: bank the spine into turns, slight forward lean on acceleration (additive, world space)
    const lq = new T.Quaternion(), fwd = new T.Vector3(), rgt = new T.Vector3(), wq = new T.Quaternion();
    let bank = 0, pitch = 0;
    function lean(root, yawRate, speed, accel, dt) {
      const tb = clamp(-yawRate * speed * 0.028, -0.13, 0.13), tp = clamp(accel * 0.012, -0.06, 0.07);
      bank += (tb - bank) * damp(8, dt); pitch += (tp - pitch) * damp(6, dt);
      if (Math.abs(bank) < 1e-3 && Math.abs(pitch) < 1e-3) return;
      fwd.set(Math.sin(root.rotation.y), 0, Math.cos(root.rotation.y)); rgt.set(fwd.z, 0, -fwd.x);
      lq.setFromAxisAngle(fwd, bank); wq.setFromAxisAngle(rgt, pitch); lq.multiply(wq);
      spine.getWorldQuaternion(qa); qb.copy(lq).multiply(qa); setWorldQ(spine, qb);
    }
    return { apply, lean, state: () => ({ pelvisOff, footOff: footOff.slice() }) };
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
      stick.dataset.zone = st.mag < GAIT_UP[0] ? '0' : st.mag < GAIT_UP[1] ? '1' : st.mag < GAIT_UP[2] ? '2' : st.mag < GAIT_UP[3] ? '3' : '4';
    }
    function releaseStick() { sId = null; st.x = st.y = st.mag = 0; knobAt(0, 0); stick.dataset.zone = '0'; stick.classList.remove('active'); }
    function playing() { return opts.enabled ? opts.enabled() : true; }
    surf.addEventListener('pointerdown', e => {
      if (!playing()) return; e.preventDefault();
      const r = stick.getBoundingClientRect(), pad = r.width * 0.45;
      if (sId === null && e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad) {
        try { surf.setPointerCapture(e.pointerId); } catch (_) {}
        sId = e.pointerId; sMax = Math.max(24, r.width * 0.5 - 6); sOx = r.left + r.width / 2; sOy = r.top + r.height / 2; stick.classList.add('active'); setStick(e);
      } else if (cId === null && e.clientX >= innerWidth * 0.42) {
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
        const l = Math.hypot(kf, ks), km = (k.ShiftLeft || k.ShiftRight) ? 1 : (k.ControlLeft || k.ControlRight || k.AltLeft) ? 0.42 : 0.86;
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
    model.traverse(o => { if (o.isSkinnedMesh) o.frustumCulled = false; });
    const meta = (gltf.scenes && gltf.scenes[0] && gltf.scenes[0].userData) || model.userData || {};
    const holster = meta.axeHolster || null;
    const lib = buildLibrary(gltf);
    const anim = AnimationController(model, lib, events);
    const S = anim.S;
    const ik = CharacterIK(model, events);

    // ---------------- weapon: sockets and data-driven attach transforms (no world-space jump on re-parent)
    const axe = model.getObjectByName('Axe'), backSock = model.getObjectByName('Axe_Back_Socket'), handSock = model.getObjectByName('Axe_RightHand_Socket');
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

    // ================================================================== controllers' state
    const weapon = { state: 'Holstered', t: 0, queued: null, seat: 'back', canThrow: false };
    const loco = { speed: 0, target: 0, gait: 0, phase: 0, yawRate: 0, accel: 0, lastSpeed: 0, ext: false, extSpeed: 0, turnStep: 0 };
    const combat = { act: null, chain: 0, lastAttackAt: -9, hits: new Set(), hitstop: 0, inCombatT: 0, block: 0, blocking: false, dodge: null, react: null, iframes: false, pending: null };
    const push = { mode: null, w: 0, blend: 0, scale: 0.52, main: null, alt: null };
    const targets = new Set();
    const interactables = [];
    const cam = { combat: 0, shake: 0, shakeT: 0, kick: new T.Vector3(), out: new T.Vector3(), roll: 0 };
    let facing = 0, lastPos = new T.Vector3(), hasLast = false, tNow = 0;
    const axeHead = new T.Vector3(), axeHeadPrev = new T.Vector3(), axeMid = new T.Vector3(), axeMidPrev = new T.Vector3();
    const HEAD_LOCAL = new T.Vector3(0, 0.40, 0), MID_LOCAL = new T.Vector3(0, 0.22, 0);
    seat('back');

    // ---------------- helpers
    let snap = false;
    // inertial transition: show the new target pose at once and let the captured pose offset decay into it
    function inertial(dur) { anim.inertialize(dur); snap = true; }
    function blendBase(goals, rate, dt) {
      const k = snap ? 1 : damp(rate, dt); snap = false;
      for (const s of anim.list) { const g = goals[s.key] || 0; s.b += (g - s.b) * k; if (g === 0 && s.b < 1e-3) s.b = 0; }
    }
    const goals = {};
    function clearGoals() { for (const k in goals) goals[k] = 0; }

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
      // right-hand grip around the handle whenever the axe is in the hand (locomotion clips have an open hand)
      const inHand = W.seat === 'hand';
      const gw = inHand && !combat.act ? 1 : 0;
      S.grip.g += (gw - S.grip.g) * damp(gw ? 30 : 18, dt); if (!gw && S.grip.g < 1e-3) S.grip.g = 0;
    }
    function forceHolster() { // cinematic push: put the axe away with the real clip, or seat it if a clip cannot play
      if (weapon.state === 'Equipped') requestUnequip();
      else if (weapon.state === 'Equipping') { weapon.queued = null; weapon.state = 'Unequipping'; weapon.t = Math.max(0, SW.unequip - 0.12); S.unequip.time = weapon.t; }
    }

    // ================================================================== CombatController
    function nearestTarget(maxDist, coneCos, dirx, dirz) {
      let best = null, bd = 1e9; const p = root.position;
      targets.forEach(t => {
        if (t.alive && !t.alive()) return; const tp = t.position();
        const dx = tp.x - p.x, dz = tp.z - p.z, d = Math.hypot(dx, dz); if (d > maxDist || d < 1e-3) return;
        if ((dx * dirx + dz * dirz) / d < coneCos) return; if (d < bd) { bd = d; best = t; }
      });
      return best;
    }
    function startAttack(key, entrySpeed, inDir) {
      const A = ATTACKS[key], s = S[key];
      if (combat.act) { combat.act.st.u = 0; }
      inertial(combat.act ? 0.085 : A.blendIn);
      for (const k of ['atkR', 'atkL', 'finH', 'finJ']) if (k !== key) { S[k].b = 0; S[k].u = 0; }
      s.time = 0; s.prev = 0; s.b = 1;
      // motion warping: face the nearest target in the input / facing cone and close the gap during the windup
      const fx = inDir ? inDir.x : Math.sin(facing), fz = inDir ? inDir.z : Math.cos(facing);
      const tg = nearestTarget(A.leap ? 5.5 : 3.4, 0.35, fx, fz);
      let warp = null;
      if (tg) {
        const tp = tg.position(), dx = tp.x - root.position.x, dz = tp.z - root.position.z, d = Math.hypot(dx, dz);
        const stop = (tg.radius || 0.45) + 0.95;
        warp = { yaw: Math.atan2(dx, dz), dist: Math.max(0, d - stop), t0: 0, t1: A.wind };
      } else if (inDir) warp = { yaw: Math.atan2(inDir.x, inDir.z), dist: 0, t0: 0, t1: Math.min(0.2, A.wind) };
      const carry = A.leap ? Math.max(entrySpeed, 3.2) : entrySpeed;       // momentum carried into the swing
      combat.act = { key, A, st: s, t: 0, warp, carry, moved: 0, hitDone: false, queued: null, impactFired: false, landFired: false };
      combat.hits.clear(); combat.lastAttackAt = tNow; combat.inCombatT = 0;
      updateAxeSamples(true);
      events.emit('combat:attack', { key });
    }
    function nextAttack(kind, act) {
      if (kind === 'heavy') return act && COMBO.light.indexOf(act.key) >= 0 && act.key !== 'finH' ? COMBO.heavyAfterLight : null;
      if (!act) return null;
      const i = COMBO.light.indexOf(act.key); return i >= 0 && i < COMBO.light.length - 1 ? COMBO.light[i + 1] : null;
    }
    function updateAxeSamples(reset) {
      axeHeadPrev.copy(axeHead); axeMidPrev.copy(axeMid);
      axe.updateMatrixWorld(true);
      axeHead.copy(HEAD_LOCAL).applyMatrix4(axe.matrixWorld); axeMid.copy(MID_LOCAL).applyMatrix4(axe.matrixWorld);
      if (reset) { axeHeadPrev.copy(axeHead); axeMidPrev.copy(axeMid); }
    }
    // swept test: blade segment (mid -> head) between two frames against each target's vertical capsule
    const segA = new T.Vector3(), segB = new T.Vector3();
    function sweepHits(act) {
      const A = act.A, t = act.st.time;
      if (t < A.act[0] || t > A.act[1]) return;
      const speed = axeHead.distanceTo(axeHeadPrev) / Math.max(1e-3, lastDt);
      if (speed < 2.2) return;                                              // a resting / slow axe does not wound
      targets.forEach(tg => {
        if (combat.hits.has(tg) || (tg.alive && !tg.alive())) return;
        const p = tg.position(), r = (tg.radius || 0.4) + 0.12, h0 = p.y + 0.1, h1 = p.y + (tg.height || 1.8);
        for (let i = 0; i <= 4; i++) {          // sample the swept quad
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
              shake(A.heavy ? A.shake : A.shake * 0.8);
              events.emit('combat:hit', info);
              return;
            }
          }
        }
      });
    }
    function shake(a) { cam.shake = Math.min(0.9, cam.shake + a); cam.shakeT = 0; }
    function startDodge(dirLocalX) {
      if (combat.act) { combat.act.st.b = 0; combat.act = null; }
      const s = dirLocalX < -0.25 ? S.dodgeM : S.dodge;
      inertial(DODGE.blendIn);
      s.time = DODGE.from; s.prev = s.time; s.b = 1;
      const side = clamp(dirLocalX, -0.7, 0.7);
      combat.dodge = { st: s, t: 0, yaw: facing + Math.PI + side * -0.8, moved: 0 };
      events.emit('combat:dodge');
    }
    function hitReaction(info) {
      if (combat.iframes) return false;
      if (combat.act) { combat.act.st.b = 0; combat.act = null; }
      if (combat.dodge) { combat.dodge.st.b = 0; combat.dodge = null; }
      const heavy = info && info.heavy, s = heavy ? S.knock : S.stagger;
      inertial(0.05);
      s.time = 0; s.prev = 0; s.b = 1;
      combat.react = { st: s, heavy, t: 0, end: heavy ? s.dur - 0.05 : STAGGER.to, ts: heavy ? KNOCK.ts : STAGGER.ts };
      if (info && info.dir) { combat.react.dir = info.dir.clone(); facing = Math.atan2(-info.dir.x, -info.dir.z); }
      shake(heavy ? 0.5 : 0.25);
      events.emit('hero:hit', info || {});
      return true;
    }

    // ================================================================== push (door cinematics) — same contract as before
    function startPush(opts) {
      if (push.mode) return false;
      const skip = opts && opts.skipEnter;
      if (combat.act) { combat.act.st.b = 0; combat.act = null; }
      if (combat.dodge) { combat.dodge.st.b = 0; combat.dodge = null; }
      combat.blocking = false; forceHolster();
      push.scale = (opts && opts.timeScale) || 0.52;
      push.main = S.push; push.alt = null; push.w = 0; push.blend = 0;
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
    function pushStep(dt) {   // returns true while the push owns the body
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
      if (push.mode === 'out' && push.w < 0.02) { push.mode = null; push.w = 0; S.push.b = 0; S.pushEnter.b = 0; return false; }
      const alt = push.mode === 'enter' ? 1 : push.mode === 'blend' ? push.blend : 0;
      S.pushEnter.b = push.w * alt; S.push.b = push.w * (1 - alt);
      return true;
    }

    // ================================================================== LocomotionController
    function gaitFor(mag) {
      let g = loco.gait;
      while (g < 4 && mag > GAIT_UP[g] + (g === 0 ? 0 : HYST)) g++;
      while (g > 0 && mag < GAIT_UP[g - 1] - (g === 1 ? 0 : HYST)) g--;
      return g;
    }
    function targetSpeed(mag, cap) {
      loco.gait = gaitFor(mag);
      if (loco.gait === 0) return 0;
      const b = BAND[loco.gait];
      return Math.min(cap, clamp(curve(STICK_CURVE, mag), b[0], b[1]));
    }
    // speed -> blend-space weights (idle/walk/jog/sprint) + shared phase advance, stride-synced
    const LC = cfg.loco ? { walk: Object.assign({}, LOCO.walk, cfg.loco.walk), jog: Object.assign({}, LOCO.jog, cfg.loco.jog), sprint: Object.assign({}, LOCO.sprint, cfg.loco.sprint) } : LOCO;
    const NAT = { walk: LC.walk.nat * hs, jog: LC.jog.nat * hs, sprint: LC.sprint.nat * hs };
    const CYC = { walk: S.walk.dur / LC.walk.cycles, jog: S.jog.dur / LC.jog.cycles, sprint: S.sprint.dur / LC.sprint.cycles };
    const STRIDE = { walk: NAT.walk * CYC.walk, jog: NAT.jog * CYC.jog, sprint: NAT.sprint * CYC.sprint };
    const lw = { idle: 0, walk: 0, jog: 0, sprint: 0 };
    function locoWeights(v, paced) {
      lw.idle = lw.walk = lw.jog = lw.sprint = 0;
      if (paced) { lw.walk = 1; return; }
      if (v < 0.03) { lw.idle = 1; return; }
      if (v < 0.8) { const k = sstep(v / 0.8); lw.idle = 1 - k; lw.walk = k; return; }
      if (v < 1.8) { lw.walk = 1; return; }
      if (v < 2.6) { const k = sstep((v - 1.8) / 0.8); lw.walk = 1 - k; lw.jog = k; return; }
      if (v < 3.4) { lw.jog = 1; return; }
      const k = sstep((v - 3.4) / 3.0); lw.jog = 1 - k; lw.sprint = k;
    }
    function locoStep(dt, v, paced, idleKey, turnStep) {
      locoWeights(v, paced);
      const m = 1 - lw.idle;
      const stride = (lw.walk * STRIDE.walk + lw.jog * STRIDE.jog + lw.sprint * STRIDE.sprint) / Math.max(1e-4, m);
      const vv = paced ? Math.max(0.62, v) : Math.max(v, 0.55);
      let dphi = m > 0 ? vv / stride * dt : 0;
      if (turnStep > 0 && m < 0.5) { dphi = Math.max(dphi, turnStep * dt / CYC.walk * 0.9); lw.walk = Math.max(lw.walk, turnStep * 0.55); }
      const ph0 = loco.phase; loco.phase = (loco.phase + dphi) % 1;
      if (m > 0.3 && dphi > 0) { if (loco.phase < ph0) events.emit('foot', { side: 'l', speed: v }); else if (ph0 < 0.5 && loco.phase >= 0.5) events.emit('foot', { side: 'r', speed: v }); }
      for (const k of ['walk', 'jog', 'sprint']) S[k].time = LC[k].ph0 + loco.phase * CYC[k];
      goals[idleKey] = (goals[idleKey] || 0) + Math.max(0, 1 - lw.walk - lw.jog - lw.sprint);
      goals.walk = lw.walk; goals.jog = lw.jog; goals.sprint = lw.sprint;
    }

    // ================================================================== InteractionController
    function registerInteractable(it) { interactables.push(it); return () => { const i = interactables.indexOf(it); if (i >= 0) interactables.splice(i, 1); }; }
    function availableInteract() { for (const it of interactables) { try { if (it.available(root.position)) return it; } catch (_) {} } return null; }

    // ================================================================== main update
    let lastDt = 1 / 60;
    const inDir = new T.Vector3(), mv = new T.Vector3();
    const result = { speed: 0, gait: 0, moving: false, facing: 0, running: false };
    /* ctx: { dt, input:{fw,st,mag} (camera-relative already resolved into world dir), dirX, dirZ, mag,
              allowMove, allowAct, paced, cap, collide(x,z), ground(x,z,y), facing, ik } */
    function update(ctx) {
      const dt0 = ctx.dt; tNow += dt0; lastDt = dt0;
      facing = ctx.facing;
      // hit-stop: the pose freezes for a few frames, motion and camera continue
      let dt = dt0;
      if (combat.hitstop > 0) { combat.hitstop -= dt0; dt = dt0 * 0.05; }
      clearGoals();
      const allowAct = !!ctx.allowAct && !push.mode;
      const mag = ctx.allowMove ? ctx.mag : 0;
      if (mag > 0.1) inDir.set(ctx.dirX, 0, ctx.dirZ).normalize(); else inDir.set(0, 0, 0);
      const hasDir = mag > 0.1;

      // ---------- inputs -> actions (buffered)
      const IN = cfg.input;
      let press = IN && allowAct ? IN.take(tNow, BUFFER) : null;
      if (!allowAct && IN) IN.take(tNow + 1, 0);   // drop presses made during cinematics
      const blockHeld = !!(IN && IN.st.held.block) && allowAct;
      if (press) {
        const n = press.name, act = combat.act, A = act && act.A;
        let used = false;
        if (n === 'axe') {
          if (!act && !combat.dodge && !combat.react) used = (weapon.state === 'Holstered' || weapon.state === 'Unequipping') ? requestEquip() : requestUnequip();
          else used = false;
        } else if (n === 'dodge') {
          const canD = !combat.react && !combat.dodge && (!act || act.st.time < A.act[0] || act.st.time >= A.impact);
          if (canD) { const lx = hasDir ? (inDir.x * Math.cos(facing) - inDir.z * Math.sin(facing)) : 0; startDodge(lx); used = true; }
        } else if (n === 'light' || n === 'heavy') {
          if (weapon.state !== 'Equipped') { if (!combat.react && !combat.dodge) { requestEquip(); combat.pending = { name: n, t: tNow }; } used = true; }   // draw, then swing
          else if (!combat.react && !combat.dodge) {
            if (!act) {
              const sprinting = loco.speed > 3.3;
              const key = n === 'light' ? (sprinting ? COMBO.sprintLight : COMBO.light[0]) : (sprinting ? COMBO.sprintHeavy : COMBO.heavy);
              startAttack(key, loco.speed, hasDir ? inDir : null); used = true;
            } else if (act.st.time >= A.open) {
              const nk = nextAttack(n, act);
              if (nk && !act.queued) { act.queued = nk; used = true; }
            }
          }
        } else if (n === 'interact') {
          const it = availableInteract(); if (it) { try { it.activate(); } catch (e) { console.warn(e); } used = true; } else used = true;
        } else if (n === 'block') used = true;
        if (used && IN) IN.consume();
      }

      // ---------- weapon
      weaponStep(dt);
      // auto-draw: an attack pressed with the axe on the back swings as soon as the grip is closed
      if (combat.pending) {
        const P = combat.pending;
        if (tNow - P.t > 1.0 || combat.react || combat.dodge || !allowAct) combat.pending = null;
        else if (!combat.act && (weapon.state === 'Equipped' || (weapon.state === 'Equipping' && weapon.t >= 0.3 && weapon.seat === 'hand'))) {
          if (weapon.state === 'Equipping') { weapon.state = 'Equipped'; S.equip.a = 0; events.emit('weapon:equipped'); }
          combat.pending = null;
          const sprinting = loco.speed > 3.3;
          startAttack(P.name === 'light' ? (sprinting ? COMBO.sprintLight : COMBO.light[0]) : (sprinting ? COMBO.sprintHeavy : COMBO.heavy), loco.speed, hasDir ? inDir : null);
        }
      }

      // ---------- motor + state
      let moveSpeed = 0, moveYaw = facing, owns = false;
      const pushing = pushStep(dt);
      if (pushing) { owns = true; loco.speed = 0; goals.push = S.push.b; goals.pushEnter = S.pushEnter.b; }
      if (!pushing && combat.react) {
        const R = combat.react; R.t += dt; R.st.time += dt * R.ts;
        owns = true; goals[R.st.key] = 1;
        if (R.dir) { moveSpeed = Math.max(0, 1.4 - R.t * 3); moveYaw = Math.atan2(R.dir.x, R.dir.z); }
        if (R.st.time >= R.end) { inertial(0.18); R.st.b = 0; combat.react = null; }
      } else if (!pushing && combat.dodge) {
        const D = combat.dodge; D.st.time += dt * DODGE.ts; D.t += dt;
        owns = true; goals[D.st.key] = 1;
        combat.iframes = D.st.time >= DODGE.iframes[0] && D.st.time <= DODGE.iframes[1];
        // warped root motion: the backstep's own timing (0.55 -> 1.55 s) carries DODGE.dist
        const u = clamp((D.st.time - 0.62) / 0.75, 0, 1), want = DODGE.dist * sstep(u);
        moveSpeed = (want - D.moved) / Math.max(1e-4, dt0); D.moved = want; moveYaw = D.yaw;
        const cancel = D.st.time >= DODGE.cancel && hasDir;
        if (D.st.time >= DODGE.to || cancel) { inertial(cancel ? 0.12 : 0.16); D.st.b = 0; combat.dodge = null; combat.iframes = false; }
      } else if (!pushing && combat.act) {
        const act = combat.act, A = act.A; act.t += dt; act.st.time += dt * A.ts;
        owns = true; goals[act.key] = 1;
        const tt = act.st.time;
        // steering during the windup, motion warp toward the target
        if (act.warp && tt <= act.warp.t1 + 0.02) {
          const k = damp(18, dt0); facing += wrapA(act.warp.yaw - facing) * k;
          if (act.warp.dist > 0) { const u = sstep(tt / act.warp.t1), want = act.warp.dist * u; moveSpeed = (want - act.moved) / Math.max(1e-4, dt0); act.moved = want; moveYaw = act.warp.yaw; }
        } else if (hasDir && tt < A.wind) { facing += wrapA(Math.atan2(inDir.x, inDir.z) - facing) * damp(10, dt0); }
        if (!act.warp || act.warp.dist <= 0) {
          // momentum from the run carries the first steps of the swing (leap: forward travel to the landing)
          const carryEnd = A.leap ? A.landing : A.wind;
          if (tt < carryEnd) { moveSpeed = act.carry * (A.leap ? 1 : (1 - tt / carryEnd)); moveYaw = facing; }
        }
        updateAxeSamples(false);
        sweepHits(act);
        if (!act.impactFired && tt >= A.impact) { act.impactFired = true; events.emit('combat:impact', { key: act.key, heavy: !!A.heavy }); if (A.heavy) shake(A.shake * 0.55); }
        if (A.landing && !act.landFired && tt >= A.landing) { act.landFired = true; events.emit('combat:land', { key: act.key }); shake(0.35); }
        // chain
        if (act.queued && tt >= A.cancel) { const q = act.queued; act.st.b = 0; startAttack(q, 0, hasDir ? inDir : null); }
        else if ((hasDir && tt >= A.move) || tt >= A.end) {
          inertial(hasDir ? 0.14 : 0.2); act.st.b = 0; combat.act = null; combat.inCombatT = 0;
        }
      }

      // ---------- locomotion (when nothing else owns the body)
      const blocking = blockHeld && weapon.state === 'Equipped' && !owns;
      if (blockHeld && weapon.state === 'Holstered' && !owns) requestEquip();
      combat.blocking = blocking;
      const cap = Math.min(ctx.cap == null ? 99 : ctx.cap, blocking ? 1.5 : 99);
      const prevFacing = facing;
      if (!owns) {
        loco.target = hasDir ? targetSpeed(mag, cap) : (loco.gait = 0, 0);
        // sharp reversals slow the hero down before he turns (no moon-walk)
        let diff = 0;
        if (hasDir) diff = wrapA(Math.atan2(inDir.x, inDir.z) - facing);
        const turnK = Math.abs(diff) > 2.2 && loco.speed > 2.4 ? 0.35 : 1;
        const tgt = loco.target * turnK;
        const a = tgt > loco.speed ? ACCEL : DECEL;
        loco.speed += clamp(tgt - loco.speed, -a * dt0, a * dt0);
        if (hasDir) {
          const rate = loco.speed < 0.3 ? 9.5 : loco.speed < 3.2 ? 11 : loco.speed < 4.8 ? 8.5 : 6.5;     // rad/s, heavier at speed
          facing += clamp(diff, -rate * dt0, rate * dt0);
        }
        moveSpeed = loco.speed; moveYaw = facing;
        loco.turnStep = loco.speed < 0.35 && hasDir ? clamp(Math.abs(diff) / 1.2, 0, 1) : loco.turnStep * Math.exp(-dt0 * 8);
      } else { loco.speed += (0 - loco.speed) * damp(10, dt0); loco.gait = 0; loco.turnStep = 0; }
      loco.yawRate = wrapA(facing - prevFacing) / Math.max(1e-4, dt0);
      loco.accel = (loco.speed - loco.lastSpeed) / Math.max(1e-4, dt0); loco.lastSpeed = loco.speed;
      facing = wrapA(facing);

      // ---------- move the root with the game's collision
      const p = root.position;
      if (moveSpeed > 1e-4 && ctx.collide && !ctx.paced) {
        mv.set(Math.sin(moveYaw), 0, Math.cos(moveYaw)).multiplyScalar(moveSpeed * dt0);
        const nx = p.x + mv.x; if (!ctx.collide(nx, p.z)) p.x = nx; else if (!owns) loco.speed *= 0.5;
        const nz = p.z + mv.z; if (!ctx.collide(p.x, nz)) p.z = nz; else if (!owns) loco.speed *= 0.5;
      }
      // external movers (door approach, hall entrance): animation follows the measured ground speed
      let measured = 0;
      if (hasLast) { const dx = p.x - lastPos.x, dz = p.z - lastPos.z; measured = Math.hypot(dx, dz) / Math.max(1e-4, dt0); if (measured > 12) measured = 0; }
      lastPos.copy(p); hasLast = true;
      loco.extSpeed += (measured - loco.extSpeed) * damp(10, dt0);

      // ---------- base animation goals
      const equipped = weapon.seat === 'hand' || weapon.state === 'Equipping';
      combat.inCombatT += dt0;
      const idleKey = equipped ? 'cidle' : 'idle';
      if (!owns || (pushing && push.mode === 'out')) {
        const animV = ctx.paced ? loco.extSpeed : loco.speed;
        locoStep(dt, animV, !!ctx.paced && ctx.pacedMove !== false, idleKey, loco.turnStep);
        if (pushing) { const k = 1 - push.w; for (const key of [idleKey, 'walk', 'jog', 'sprint']) goals[key] = (goals[key] || 0) * k; }
      }
      if (S.idle.b < 1e-3 && !goals.idle) S.idle.time = 0;
      S.idle.time += dt; S.cidle.time += dt;
      const fast = combat.act || combat.dodge || combat.react;
      blendBase(goals, fast ? 30 : owns ? 14 : 11, dt);
      // block: upper-body guard layer over whatever the legs do
      combat.block += ((blocking ? 1 : 0) - combat.block) * damp(blocking ? 16 : 10, dt);
      S.guard.u = combat.block < 1e-3 ? 0 : combat.block; S.guard.time = GUARD_T;
      S.grip.time = 0;

      // ---------- evaluate
      anim.evaluate(dt);
      // foot IK / pelvis on uneven ground, then turn lean
      model.position.y = modelBaseY;
      root.rotation.y = facing; root.updateMatrixWorld(true);
      if (ctx.ik !== false) ik.apply(root, ctx.ground, dt0, !owns || !!combat.react);
      if (!owns) ik.lean(root, loco.yawRate, loco.speed, loco.accel, dt0);
      anim.capture();
      if (!combat.act) updateAxeSamples(true);

      // ---------- camera intent
      const want = (weapon.seat === 'hand' || combat.act || combat.blocking) ? 1 : 0;
      cam.combat += (want - cam.combat) * damp(want ? 3.2 : 1.4, dt0);
      cam.shakeT += dt0; cam.shake *= Math.exp(-dt0 * 7.5);
      const s = cam.shake, f = tNow * 31;
      cam.out.set(Math.sin(f) * 0.6 + Math.sin(f * 2.3) * 0.4, Math.sin(f * 1.7 + 1) * 0.7, 0).multiplyScalar(s * 0.045);
      cam.roll = Math.sin(f * 0.9) * s * 0.008;

      result.speed = owns ? 0 : loco.speed; result.gait = loco.gait; result.moving = !owns && loco.speed > 0.05; result.facing = facing;
      result.running = !owns && loco.gait >= 3;
      return result;
    }

    // ================================================================== public
    const hero = {
      root, model, mixer: anim.mixer, events, lib,
      update,
      weapon: { state: () => weapon.state, equip: requestEquip, unequip: requestUnequip, seat: () => weapon.seat, canThrow: () => false },
      combat: {
        state: () => combat.act ? combat.act.key : combat.dodge ? 'dodge' : combat.react ? (combat.react.heavy ? 'knockdown' : 'stagger') : combat.blocking ? 'block' : 'none',
        registerTarget(t) { targets.add(t); return () => targets.delete(t); }, targets: () => targets.size,
        hit: hitReaction, blocking: () => combat.blocking, invulnerable: () => combat.iframes
      },
      interact: { register: registerInteractable, available: availableInteract },
      camera: cam,
      // compatibility facade used by the royal door, temple doors and wing doors
      compat: {
        startPush, releasePush, pushing: () => !!push.mode, pushState,
        locked: () => !!(combat.act || combat.dodge || combat.react) && !(combat.act && combat.act.st.time >= combat.act.A.move),
        state: () => push.mode ? 'push' : combat.act ? combat.act.key : combat.dodge ? 'dodge' : ['idle', 'walk', 'jog', 'run', 'sprint'][loco.gait],
        pushClipRef: () => lib.push, setWalkScale() {}, runSample: () => ({ time: S.sprint.time, dur: S.sprint.dur, loop: T.LoopRepeat, w: S.sprint.w[0] })
      },
      debug() {
        const w = {}; for (const s of anim.list) if (s.w[0] + s.w[1] + s.w[2] + s.w[3] > 1e-3) w[s.key] = s.w.map(x => +x.toFixed(3));
        return {
          weapon: weapon.state, seat: weapon.seat, axeParent: axe.parent && axe.parent.name, speed: +loco.speed.toFixed(3), target: +loco.target.toFixed(3), gait: loco.gait,
          phase: +loco.phase.toFixed(3), combat: hero.combat.state(), attackTime: combat.act ? +combat.act.st.time.toFixed(3) : null, queued: combat.act ? combat.act.queued : null,
          push: pushState(), weights: w, activeActions: anim.activeActions(), totalActions: anim.totalActions(), listeners: events.count(), camCombat: +cam.combat.toFixed(3), shake: +cam.shake.toFixed(3),
          ik: ik.state(), stride: STRIDE, nat: NAT
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

  window.SinHero = { create, InputController, buildHUD, hudSync, CONFIG: { BAND, STICK_CURVE, GAIT_UP, HYST, ACCEL, DECEL, BUFFER, ATTACKS, COMBO, DODGE, LOCO, CLIPS, JOG_CUT, HERO_SCALE } };
})();
