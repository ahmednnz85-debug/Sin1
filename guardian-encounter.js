/* Guardian of the Covenant, U1-03. The timings below were measured on the
 * compressed GLB's contact socket trajectories at 60 samples per second. */
(function (root) {
  'use strict';

  const VITALS = { health: 1500, posture: 100, recovery: 18 };
  const HERO_DAMAGE = { atkR: [48, 14], atkL: [52, 17], finH: [106, 38], finJ: [122, 45] };
  const TUNING = { scale: .87, radius: .98, phaseAt: .5, activate: 10.1, pause: .95, enragedPause: .55,
    arenaRadius: 16.5, hearingRadius: 17, staggerGrace: 3.25, standOffset: -4.5, save: 'sin:irkalla-covenant:v1' };
  const DIALOG = 'عبرتَ طريق الموتى وأنت تحمل نبض الأحياء… لن تُفتح أبواب إركالا لمن لم يُكتب اسمه بين الموتى.';
  function strike(from, to, socket, damage, posture, options = {}) {
    return { from, to, socket, damage, posture, ...options };
  }
  function attack(name, range, hits, options = {}) {
    return { name, range, hits, ...options };
  }
  const shock = (from, socket, damage, wave) => strike(from, from + (socket === 'ground_impact' ? .22 : .01), socket, damage, 0, {
    wave, type: 'spirit', blockable: false
  });
  const ATTACKS = [
    attack('Attack_Staff_Swing_Left', [1.5, 3.05], [strike(.48, 1.06, 'blade', 13, 24)], { cooldown: 4 }),
    attack('Attack_Staff_Swing_Right', [1.5, 2.45], [strike(.56, 1.2, 'crown', 14, 27)], { cooldown: 5, yawOffset: -.38 }),
    attack('Attack_Staff_Overhead', [1.85, 3.15], [strike(1.1, 1.44, 'blade', 23, 52, { type: 'heavy', parryable: false })],
      { cooldown: 6, armor: true }),
    attack('Attack_Staff_Thrust', [2, 3.25], [strike(.29, .59, 'blade', 17, 31)], { cooldown: 5 }),
    attack('Attack_Staff_Sweep', [1.45, 2.8], [strike(.65, 1.32, 'blade', 17, 31)], { cooldown: 6 }),
    attack('Attack_Staff_Spin_360', [2.75, 3.62], [strike(.82, 1.62, 'blade', 21, 39, { type: 'heavy' })],
      { cooldown: 8, angle: 2.8 }),
    attack('Attack_Claw_Left', [1.12, 1.95], [strike(.64, .96, 'claw_l', 11, 20)], { cooldown: 4, yawOffset: .48 }),
    attack('Attack_Kick', [1.1, 1.82], [strike(.55, .82, 'foot_l', 13, 35)], { cooldown: 6, yawOffset: .43 }),
    attack('Attack_Combo_01', [1.55, 2.95],
      [strike(.49, .9, 'blade', 10, 20), strike(1.89, 2.27, 'blade', 15, 27)], { cooldown: 9 }),
    attack('Special_Ground_Slam', [1.5, 3.6], [shock(1.62, 'ground_impact', 19, 3.15)], { cooldown: 9, armor: true }),
    attack('Counter_Attack', [1.25, 2.45], [strike(.5, .87, 'crown', 15, 27)],
      { cooldown: 6, counter: true, yawOffset: -.34 }),
    attack('Special_Charge', [3.4, 7.4], [strike(.56, 2.29, 'blade', 20, 38, { type: 'heavy' })],
      { cooldown: 8, phase: 2, armor: true, advance: [.62, 1.55, 3.7] }),
    attack('Special_Leap_Slam', [2.7, 5.5], [shock(1.84, 'ground_impact', 24, 4.25)],
      { cooldown: 10, phase: 2, armor: true, advance: [.77, 1.85, 1.65] }),
    attack('Special_Enraged_Combo', [1.45, 3.15],
      [strike(.63, 1.13, 'blade', 13, 24), strike(1.69, 2.01, 'crown', 13, 25),
        strike(3.03, 3.47, 'blade', 22, 43, { type: 'heavy' })], { cooldown: 11, phase: 2, armor: true }),
    attack('Special_Seal_Activation', [2.5, 5.5], [shock(2.26, 'chest_seal', 18, 5.25)],
      { cooldown: 12, phase: 2 }),
    attack('Special_Energy_Release', [2.2, 6.2], [shock(1.07, 'chest_seal', 22, 6.5)],
      { cooldown: 10, phase: 2 })
  ];
  const LOCKED = new Set(['awakening', 'intro', 'heroFalling', 'lost', 'deathKneel', 'deathFinal', 'opening', 'return']);
  const BODILESS = new Set(['deathKneel', 'deathFinal', 'opening', 'return', 'won']);
  const LOOPS = new Set(['Idle', 'Combat_Idle', 'Enraged_Idle', 'Walk_Forward', 'Run_Forward',
    'Walk_Backward', 'Strafe_Left', 'Strafe_Right', 'Block_Idle', 'Death_Idle']);
  const SCRIPTS = ['Cinematic_Awakening', 'Cinematic_Intro', 'Phase_Transition', 'Stagger',
    'Block_Impact', 'Hit_Light_Front', 'Hit_Light_Back', 'Hit_Light_Left', 'Hit_Light_Right', 'Hit_Heavy',
    'Death_Kneel', 'Death_Final'];
  const SOCKETS = {
    blade: ['staff_base', 'staff_blade', .28], crown: ['staff_crown', 'staff_tip', .32],
    claw_l: ['Hand_L', 'claw_l', .28], foot_l: ['Foot_L', 'foot_l', .29]
  };
  const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  const wrap = t => Math.atan2(Math.sin(t), Math.cos(t));
  const mix = (a, b, t) => a + (b - a) * t;

  function presentation(retry, skip, toggleLock) {
    const element = document.createElement('section');
    element.className = 'covenant';
    element.dir = 'rtl';
    element.dataset.view = 'dormant';
    const bar = (name, marker = '') => `<div class="covenant-life ${name}" role="meter" aria-label="${name === 'sin' ? 'صحة سين' : 'صحة حارس العهد'}" aria-valuemin="0" aria-valuemax="100"><i></i><b></b>${marker}</div>`;
    element.innerHTML = `<div class="covenant-hero"><span aria-hidden="true">☾</span>${bar('sin')}</div>
      <div class="covenant-boss"><strong>حارس العهد</strong>${bar('guardian', '<em></em>')}<div class="covenant-posture"><i></i></div>
      <small></small></div><button class="covenant-lock" type="button" aria-pressed="false" aria-label="تثبيت الكاميرا على الحارس">◎</button><button class="covenant-skip" type="button">تخطي المشهد</button>
      <p class="covenant-dialog">${DIALOG}</p><div class="covenant-defeat"><strong>سقط سين</strong>
      <button type="button">إعادة المحاولة</button></div><p class="covenant-objective">اعبر بوابة إركالا</p>`;
    document.body.append(element);
    const values = ['.sin', '.guardian'].map(selector => {
      const el = element.querySelector(selector);
      return { el, lag: el.firstElementChild, fill: el.children[1], value: 1, target: 1, wait: 0 };
    });
    const post = element.querySelector('.covenant-posture i');
    const hint = element.querySelector('small');
    element.querySelector('.covenant-defeat button').addEventListener('click', retry);
    element.querySelector('.covenant-skip').addEventListener('click', skip);
    const lock = element.querySelector('.covenant-lock');
    lock.addEventListener('click', toggleLock);
    return {
      update(dt, state, hero, boss, move, objective, lockedOn) {
        const focus = state === 'awakening' || state === 'intro' || state === 'deathKneel' || state === 'deathFinal' ||
          state === 'opening' || state === 'return' || state === 'heroFalling' || state === 'lost';
        document.body.classList.toggle('covenant-cutscene', focus);
        const view = state === 'phase' ? 'active' : state;
        if (element.dataset.view !== view) element.dataset.view = view;
        const pressed = String(lockedOn);
        if (lock.getAttribute('aria-pressed') !== pressed) lock.setAttribute('aria-pressed', pressed);
        element.classList.toggle('has-objective', objective);
        element.classList.toggle('critical', hero.state.health / hero.maximum <= .25);
        element.classList.toggle('broken', boss.state.broken);
        element.classList.toggle('unblockable', !!move?.hits.some(hit => hit.blockable === false || hit.parryable === false));
        const label = move?.hits.some(hit => hit.blockable === false) ? 'موجة روحية — ابتعد أو راوغ' :
          move?.hits.some(hit => hit.parryable === false) ? 'ضربة ساحقة — راوغ' : boss.state.broken ? 'انكسر دفاع الحارس' : '';
        if (hint.textContent !== label) hint.textContent = label;
        for (let i = 0; i < values.length; i++) {
          const row = values[i], unit = i ? boss : hero, fraction = unit.state.health / unit.maximum;
          if (fraction !== row.target) {
            row.wait = .28;
            row.target = fraction;
            row.fill.style.transform = 'scaleX(' + fraction + ')';
            row.el.setAttribute('aria-valuenow', String(Math.ceil(fraction * 100)));
          }
          row.wait -= dt;
          if (row.wait <= 0 || row.value < fraction) row.value = mix(row.value, fraction, 1 - Math.exp(-dt * 6));
          row.lag.style.transform = 'scaleX(' + row.value + ')';
        }
        post.style.transform = 'scaleX(' + (boss.state.posture / boss.postureMaximum) + ')';
      },
      remove() { element.remove(); document.body.classList.remove('covenant-cutscene'); }
    };
  }

  function mount({ T, model, animations, world, arena, checkpoint, hero, gate, architecture }) {
    const C = root.SinCombat, vitals = C.createVitals(VITALS);
    const actor = new T.Group();
    actor.name = 'U1_Guardian_of_the_Covenant';
    actor.scale.x = -1; // U1's reflection is cancelled for the authored character.
    const stand = arena.clone();
    stand.x += TUNING.standOffset;
    actor.position.copy(stand);
    const space = new T.Group();
    space.name = 'U1_Covenant_Effects';
    // Compute the authored feet in model space before the skin inherits the
    // mirrored chapter transform and the underworld's large elevation offset.
    model.updateMatrixWorld(true);
    const rigMesh = model.getObjectByName('Guardian_Skinned_Body');
    const skinBounds = new T.Box3().setFromObject(rigMesh, true);
    model.scale.setScalar(TUNING.scale);
    model.position.y = -skinBounds.min.y * TUNING.scale;
    world.add(actor, space);
    actor.add(model);
    actor.rotation.y = Math.PI / 2; // the mirrored arena is approached from world -X.
    model.traverse(o => { if (o.isSkinnedMesh) o.frustumCulled = false; });

    const nodes = new Map();
    model.traverse(o => { if (o.name) nodes.set(o.name, o); });
    const required = ['Guardian_Staff', 'weapon_r', 'weapon_l', 'staff_blade', 'staff_crown', 'staff_tip', 'staff_base',
      'chest_seal', 'body_hit', 'head_hit', 'Pelvis', 'ground_impact', 'Foot_L', 'Foot_R', 'foot_l', 'claw_l', 'Hand_L'];
    if (required.some(name => !nodes.has(name))) throw new Error('Guardian sockets missing: ' + required.filter(name => !nodes.has(name)).join(', '));
    const staff = nodes.get('Guardian_Staff'), grip = nodes.get('weapon_r');
    const gripLocal = staff.position.clone(), gripRotation = staff.quaternion.clone(), gripScale = staff.scale.clone();
    const mixer = new T.AnimationMixer(model), actions = new Map(), clips = new Map(animations.map(clip => [clip.name, clip]));
    for (const name of [...LOOPS, ...SCRIPTS, ...ATTACKS.map(a => a.name)]) {
      const clip = clips.get(name);
      if (!clip) throw new Error('Guardian clip missing: ' + name);
      const a = mixer.clipAction(clip);
      if (!LOOPS.has(name)) { a.setLoop(T.LoopOnce, 1); a.clampWhenFinished = true; }
      actions.set(name, a);
    }
    // Skinned vertex geometry stays shared and is never reauthored.
    const emission = new Map();
    model.traverse(o => {
      if (o.isMesh && o.material?.name?.endsWith('_Emission')) emission.set(o.material, o.material.emissiveIntensity);
    });
    let clipName, action, animationTime, actionComplete, phase = 'dormant', phaseNumber = 1;
    let fighter, exitTarget, lastContext, hud, paused = false, seen = false, defeated = false, objective = false;
    let attackTime = 0, timer = 0, now = 0, cooldown = 0, staggerUntil = 0, lockOn = false;
    let selected, hitStop = 0, impulse = 0, flash = 0, strikeBody = 'watch', lastAttacks = [], decision = 0;
    let motionTotal = 0, guardUntil = 0, pendingCounter = false, retryPolicy = false;
    const nextReady = new Map(), log = [], seenStrikes = new Set(), vector = () => new T.Vector3();
    const [heroLocal, playerWorld, bossWorld, contact, contactLocal, desired, direction, chest, gateGlow] = Array.from({ length: 9 }, vector);
    const velocity = vector(), localVelocity = vector(), normal = vector(), axeLast = vector(), axePoint = vector();
    const trauma = vector(), floorTip = vector(), pointOffset = vector(), localInversion = new T.Matrix4();
    let bladeEvent = null, axeHeight = Infinity, hasAxeSample = false;
    let groundVelocity = vector(), groundPrev = vector(), groundCurr = vector();
    const previousA = vector(), previousB = vector(), currentA = vector(), currentB = vector(), shaft = vector();
    const sweepStartA = vector(), sweepStartB = vector(), sweepEndA = vector(), sweepEndB = vector();
    const pathStart = vector(), pathStop = vector(), staffPrev = vector(), staffVelocity = vector();
    const staffRest = new T.Quaternion().setFromAxisAngle(new T.Vector3(.4, 0, 1).normalize(), Math.PI / 2);
    const restTip = vector(), restBlade = vector();
    const wave = { position: vector(), variant: 'spirit', age: 0, maximum: 0, old: 0, radius: 0, strike: null, hit: false };
    const fx = root.SinCombatVFX.create(T, space, () => root.SinGfx?.tier() || 'high');
    fx.bindWeapon(staff, ['blade', 'crown']);
    const axe = root.SinHero?.resolveRig(hero).axe;
    if (axe) fx.bindWeapon(axe, ['axe']);
    const cameraFrom = vector(), cameraTo = vector(), aimFrom = vector(), aimTo = vector(), cameraDirection = vector();
    const cameraPosition = vector(), cameraAim = vector(), cameraPivot = vector();
    let deathYawFrom = 0, deathYawTo = 0;
    const guardianBox = { minx: 0, maxx: 0, miny: 0, maxy: 0, minz: 0, maxz: 0 };
    let revealed = 0, cameraBlend = 0, cinematic = false, dropTime = -1;

    const volume = (name, a, b, radius) => ({ name, start: a, end: b, a: vector(), b: vector(), radius });
    const bossVolumes = [volume('seal', 'chest_seal', 'chest_seal', .27), volume('head', 'head_hit', 'head_hit', .38),
      volume('torso', 'Pelvis', 'body_hit', .68), volume('leftLeg', 'Foot_L', 'Thigh_L', .38),
      volume('rightLeg', 'Foot_R', 'Thigh_R', .38), volume('leftArm', 'Hand_L', 'UpperArm_L', .28),
      volume('rightArm', 'Hand_R', 'UpperArm_R', .28)];
    const heroVolumes = [volume('torso', 'pelvis', 'spine_03', .32),
      volume('head', 'head', 'head', .24), volume('legL', 'calf_l', 'thigh_l', .22),
      volume('legR', 'calf_r', 'thigh_r', .22), volume('armL', 'hand_l', 'upperarm_l', .17),
      volume('armR', 'hand_r', 'upperarm_r', .17)];
    const heroNodes = new Map();
    const radius = TUNING.radius;
    const poseJoint = {
      spine: nodes.get('Spine_02'), staff: nodes.get('UpperArm_R'),
      claw_l: nodes.get('UpperArm_L'), foot_l: nodes.get('Thigh_L')
    };
    const strikeOrigin = vector(), strikeReach = vector(), strikeAxis = vector();
    const strikeLocalAxis = vector(), offHand = vector(), shaftStart = vector(), shaftEnd = vector();
    const authoredRotation = new T.Quaternion(), parentRotation = new T.Quaternion(), strikeRotation = new T.Quaternion();
    let correctedJoint = null, strikeHeight = 0;
    const posedAim = vector();
    const physicalContacts = { heroHits: 0, guardianHits: 0, heightAdjusted: 0, lastWeaponHeight: null };
    const at = (node, out) => nodes.get(node).getWorldPosition(out);
    const local = (node, out) => space.worldToLocal(at(node, out));
    function refresh(volumes, rig) {
      for (const v of volumes) {
        rig.get(v.start).getWorldPosition(v.a);
        rig.get(v.end).getWorldPosition(v.b);
      }
      return volumes;
    }
    function restorePose() {
      if (correctedJoint) {
        correctedJoint.quaternion.copy(authoredRotation);
        correctedJoint = null;
      }
    }
    function sampleAttack(name, blend = .18, offset = 0) {
      restorePose();
      if (clipName === name && LOOPS.has(name)) return;
      const next = actions.get(name);
      if (action === next) action.stop();
      next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
      next.time = offset;
      if (action && action !== next) next.crossFadeFrom(action, blend, false);
      action = next;
      clipName = name;
      animationTime = offset;
      actionComplete = false;
    }
    function transition(state, name, blend) {
      timer = 0;
      phase = state;
      if (name) sampleAttack(name, blend);
    }
    function emit(type, result, attackName = clipName) {
      const event = { type, at: +now.toFixed(3), attack: attackName, damage: result?.damage || 0,
        result: result?.kind || null, region: result?.region || null, hp: fighter?.vitals.state.health, bossHP: vitals.state.health };
      log.push(event);
      if (log.length > 120) log.shift();
      // The same real contact event can later trigger sound and haptics.
      fighter?.events.emit('covenant:' + type, event);
    }
    function save() {
      try {
        const pose = defeated ? { actor: actor.position.toArray(), yaw: actor.rotation.y,
          staff: staff.position.toArray(), rotation: staff.quaternion.toArray(), scale: staff.scale.toArray() } : null;
        localStorage.setItem(TUNING.save, JSON.stringify({ defeated, seen, health: fighter?.vitals.state.health || 100, pose }));
      }
      catch (_) { /* Continue playing if storage is disabled. */ }
    }
    function read() {
      try { return JSON.parse(localStorage.getItem(TUNING.save)) || {}; }
      catch (_) { return {}; }
    }
    function restoreStaff() {
      if (staff.parent !== grip) grip.add(staff);
      staff.position.copy(gripLocal);
      staff.quaternion.copy(gripRotation);
      staff.scale.copy(gripScale);
      dropTime = -1;
    }
    function releaseStaff() {
      local('Guardian_Staff', staffVelocity).sub(staffPrev).multiplyScalar(64);
      staffVelocity.y = Math.max(.45, Math.min(1.4, staffVelocity.y));
      staffVelocity.x *= .32;
      staffVelocity.z *= .32;
      space.attach(staff);
      dropTime = 0;
      emit('weapon_release');
    }
    function updateDrop(dt) {
      if (dropTime < 0) return;
      dropTime += dt;
      staffVelocity.y -= dt * 9.8;
      staff.position.addScaledVector(staffVelocity, dt);
      const weight = 1 - Math.exp(-dt * (dropTime < .55 ? 2 : 7));
      staff.quaternion.slerp(staffRest, weight);
      const foot = Math.min(local('staff_tip', restTip).y, local('staff_blade', restBlade).y);
      if (foot < stand.y + .14) {
        staff.position.y += stand.y + .14 - foot;
        staffVelocity.multiplyScalar(.6);
        staffVelocity.y = 0;
      }
    }
    function reset(place = true) {
      restoreStaff();
      fx.clear();
      fighter?.combat.reset();
      fighter?.combat.fight(null);
      fighter?.vitals.reset();
      vitals.reset();
      actor.position.copy(stand);
      actor.visible = true;
      paused = false;
      actor.rotation.y = Math.PI / 2;
      defeated = objective = false;
      selected = wave.strike = null;
      bladeEvent = null;
      axeHeight = Infinity;
      hasAxeSample = false;
      wave.radius = wave.old = 0;
      phaseNumber = 1;
      now = cooldown = staggerUntil = hitStop = impulse = flash = guardUntil = 0;
      physicalContacts.heroHits = physicalContacts.guardianHits = physicalContacts.heightAdjusted = 0;
      physicalContacts.lastWeaponHeight = null;
      revealed = cameraBlend = 0;
      cinematic = retryPolicy = pendingCounter = false;
      lockOn = false;
      strikeBody = 'watch';
      nextReady.clear();
      seenStrikes.clear();
      lastAttacks = [];
      decision = 0;
      time.reset();
      log.length = 0;
      gate()?.encounterPose(0);
      mixer.stopAllAction();
      action = null;
      clipName = null;
      sampleAttack('Cinematic_Awakening', 0);
      action.paused = true;
      mixer.update(0);
      for (const mat of emission.keys()) mat.emissiveIntensity = 0;
      transition('dormant');
      if (place && lastContext) {
        lastContext.onEncounterInput?.();
        world.localToWorld(fighter.root.position.copy(checkpoint));
        lastContext.setFacing(Math.PI / 2);
        lastContext.resetEncounterCamera?.();
      }
    }
    function bind(current) {
      if (fighter === current) return;
      if (!current?.vitals) return;
      fighter = current;
      fighter.model.traverse(o => { if (o.name) heroNodes.set(o.name, o); });
      for (const v of heroVolumes) {
        if (!heroNodes.has(v.start)) heroNodes.set(v.start, fighter.root);
        if (!heroNodes.has(v.end)) heroNodes.set(v.end, heroNodes.get(v.start));
      }
      exitTarget = fighter.combat.registerTarget({
        position: () => actor.getWorldPosition(bossWorld),
        alive: () => phase === 'active' && !!vitals.state.health,
        volumes: () => refresh(bossVolumes, nodes),
        validate: canContact,
        onHit: playerHit
      });
      hud = presentation(retry, skip, toggleLock);
      const saved = read();
      seen = saved.seen === true;
      if (saved.defeated === true) {
        defeated = objective = true;
        vitals.reset(0);
        fighter.vitals.reset(saved.health);
        gate()?.encounterPose(1);
        sampleAttack('Death_Idle', 0);
        const pose = saved.pose;
        const valid = (values, size) => Array.isArray(values) && values.length === size && values.every(Number.isFinite);
        if (pose && valid(pose.actor, 3) && valid(pose.staff, 3) && valid(pose.rotation, 4) &&
            valid(pose.scale, 3) && Number.isFinite(pose.yaw)) {
          actor.position.fromArray(pose.actor);
          actor.rotation.y = pose.yaw;
          space.add(staff);
          staff.position.fromArray(pose.staff);
          staff.quaternion.fromArray(pose.rotation);
          staff.scale.fromArray(pose.scale);
        } else {
          actor.visible = false;
        }
        mixer.update(0);
        transition('won');
      }
    }
    function heroPosition() {
      fighter.root.getWorldPosition(playerWorld);
      return world.worldToLocal(heroLocal.copy(playerWorld));
    }
    function aiming() {
      const distance = actor.position.distanceTo(heroPosition());
      return distance <= TUNING.hearingRadius ? actor.getWorldPosition(bossWorld) : null;
    }
    function startCombat() {
      seen = true;
      save();
      revealed = 1;
      lastContext?.onEncounterInput?.();
      fighter.combat.fight({ aim: aiming });
      fighter.weapon.equip();
      cooldown = .85;
      transition('active', 'Combat_Idle');
      cameraBlend = .65;
      emit('start');
    }
    function skip() {
      if (phase !== 'intro' && phase !== 'awakening') return false;
      startCombat();
      return true;
    }
    function retry() {
      if (phase !== 'lost') return false;
      reset();
      retryPolicy = true;
      return true;
    }
    function turn(yaw, dt, speed = 2.7) {
      actor.rotation.y += Math.max(-speed * dt, Math.min(speed * dt, wrap(yaw - actor.rotation.y)));
    }
    function shift(dx, dz, p) {
      const x = actor.position.x + dx, z = actor.position.z + dz;
      if (Math.hypot(x - arena.x, z - arena.z) > TUNING.arenaRadius ||
          x < arena.x - 13.4 || Math.hypot(x - p.x, z - p.z) < radius + .5 ||
          !architecture(x, z, actor.position, radius * .7)) return false;
      actor.position.x = x;
      actor.position.z = z;
      return true;
    }
    function lineClear(a, b, pad = .08) {
      pathStart.copy(a);
      pathStop.copy(b);
      // Collision space is sampled sparingly along plausible melee paths.
      const length = Math.hypot(pathStop.x - pathStart.x, pathStop.z - pathStart.z);
      const steps = Math.max(1, Math.ceil(length / .65));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        if (!architecture(mix(pathStart.x, pathStop.x, t), mix(pathStart.z, pathStop.z, t), pathStart, pad)) return false;
      }
      return true;
    }
    function canContact(point) {
      heroPosition();
      world.worldToLocal(contactLocal.copy(point));
      return Math.hypot(contactLocal.x - heroLocal.x, contactLocal.z - heroLocal.z) < 2.7 &&
        lineClear(heroLocal, contactLocal);
    }
    function localDirection(out, from) {
      return out.copy(from).transformDirection(localInversion.copy(space.matrixWorld).invert());
    }
    function contactImpulse(point, amount) {
      // Lateral recoil on the actual blow vector, with no camera vibration in idle.
      trauma.set(point.x - fighter.root.position.x,0,point.z - fighter.root.position.z);
      if (trauma.lengthSq() > .002) trauma.normalize();
      impulse = amount;
    }
    function playerHit(info) {
      if (phase !== 'active') return null;
      const [damage, pressure] = HERO_DAMAGE[info.attack] || [info.damage, info.heavy ? 22 : 9];
      const broken = vitals.state.broken;
      const dx = heroLocal.x - actor.position.x, dz = heroLocal.z - actor.position.z;
      const alignment = (Math.sin(actor.rotation.y) * dx + Math.cos(actor.rotation.y) * dz) / (Math.hypot(dx, dz) || 1);
      const guarded = strikeBody === 'guard' || strikeBody === 'guardImpact';
      const result = C.resolveDamage(vitals, { damage, pressure: now < staggerUntil ? 0 : pressure,
        posture: now < staggerUntil ? 0 : pressure * 1.2, type: info.heavy ? 'heavy' : 'normal', parryable: false }, {
        invulnerable: false, blocking: guarded, alignment, multiplier: broken && info.region === 'seal' ? 1.65 : 1
      }, info.point);
      if (!result) return null;
      result.region = info.region;
      physicalContacts.heroHits++;
      const surface = result.kind === 'block' ? 'metal' : info.region === 'seal' ? 'spirit' :
        /torso|head|Arm/.test(info.region) ? 'armor' : 'flesh';
      localDirection(localVelocity, info.weaponVelocity || info.dir);
      fx.impact(space.worldToLocal(contactLocal.copy(info.point)), {
        surface, velocity: localVelocity, normal: localDirection(normal, info.dir),
        strength: info.attack === 'finJ' ? 1.52 : info.heavy ? 1.28 : .85, moon: true, floor: stand.y
      });
      contactImpulse(info.point, info.heavy ? .135 : .055);
      hitStop = info.heavy ? .062 : .031;
      flash = .22;
      emit('guardian-hit', result, info.attack);
      if (result.killed) {
        win();
      } else if (result.broken) {
        stagger();
      } else if (result.kind === 'block') {
        sampleAttack('Block_Impact', .075);
        strikeBody = 'guardImpact';
        pendingCounter = true;
      } else if ((!selected || info.heavy && !selected.armor && attackTime < selected.hits[0].from) &&
          !vitals.state.broken && now >= staggerUntil && now > guardUntil) {
        if (selected) {
          selected = null;
          cooldown = .8;
        }
        const loc = wrap(Math.atan2(dx, dz) - actor.rotation.y);
        const name = info.heavy ? 'Hit_Heavy' : Math.abs(loc) < .85 ? 'Hit_Light_Front' :
          Math.abs(loc) > 2.28 ? 'Hit_Light_Back' : loc > 0 ? 'Hit_Light_Left' : 'Hit_Light_Right';
        sampleAttack(name, .08);
        strikeBody = 'recoil';
        guardUntil = now + 1.5;
      }
      return result;
    }
    function stagger() {
      selected = wave.strike = null;

      strikeBody = 'stagger';
      sampleAttack('Stagger', .1);
      impulse = .17;
      staggerUntil = now + TUNING.staggerGrace;
      pendingCounter = false;
      cooldown = .58;
      emit('stagger');
    }
    function enemyHit(hit, point, along) {
      const p = fighter.root.position;
      const origin = world.localToWorld(bossWorld.copy(actor.position));
      direction.subVectors(p, origin);
      direction.y = 0;
      const range = direction.length();
      direction.normalize();
      const yaw = fighter.root.rotation.y;
      const alignment = -Math.sin(yaw) * direction.x - Math.cos(yaw) * direction.z;
      const result = C.resolveDamage(fighter.vitals, hit, {
        invulnerable: fighter.combat.invulnerable(), blocking: fighter.combat.blocking(), alignment,
        guardAge: fighter.combat.guardAge()
      }, point);
      if (!result) { emit('evaded'); return; }
      if (!hit.wave) physicalContacts.guardianHits++;
      const impactType = result.kind === 'parry' ? 'parry' : result.kind === 'block' ? 'metal' :
        hit.type === 'spirit' ? 'spirit' : hit.socket === 'crown' ? 'armor' : 'flesh';
      const focusPoint = result.kind === 'parry' || result.kind === 'block' ? parryPoint(point) : point;
      fx.impact(space.worldToLocal(contactLocal.copy(focusPoint)), {
        surface: impactType, velocity: localDirection(localVelocity, along || direction),
        normal: localDirection(normal,direction), strength: hit.socket === 'crown' || hit.wave ? 1.32 : .9, floor: stand.y
      });
      contactImpulse(focusPoint, result.kind === 'parry' ? .11 : hit.type === 'heavy' || hit.type === 'spirit' ? .17 : .085);
      emit('sin-hit', result);
      if (result.kind === 'parry') {
        if (now >= staggerUntil) {
          vitals.pressure(35);
          // A perfect parry always creates an opening; a full break exposes the seal.
          stagger();
        }
      } else if (result.killed) {
        selected = wave.strike = null;
        fx.clear();
        lastContext?.onEncounterInput?.();
        fighter.combat.die(direction);
        transition('heroFalling');
      } else {
        if (result.kind === 'block') fighter.combat.guardImpact();
        else {
          fighter.combat.hit({ dir: direction, heavy: result.kind === 'break' || hit.type === 'heavy' && range < 2.4 });
          if (result.broken) fighter.vitals.recover(.4);
        }
        hitStop = hit.type === 'heavy' ? .055 : .027;
      }
    }
    function parryPoint(point) {
      const [base, tip] = fighter.combat.axeContact();
      axePoint.subVectors(tip,base);
      const t = axePoint.dot(pointOffset.subVectors(point,base)) / Math.max(.0001,axePoint.lengthSq());
      axePoint.multiplyScalar(Math.max(0,Math.min(1,t))).add(base);
      return point.distanceToSquared(axePoint) < .31 ? axePoint.lerp(point,.38) : point;
    }
    function waveStart(hit) {
      const earth = hit.socket === 'ground_impact';
      local(earth ? 'staff_blade' : hit.socket,wave.position);
      contactLocal.copy(wave.position);
      wave.position.y = stand.y + .045;
      wave.age = wave.old = wave.radius = 0;
      wave.maximum = hit.wave;
      wave.strike = hit;
      wave.hit = false;
      wave.variant = earth ? 'ground' : 'spirit';
      if (earth) {
        fx.impact(wave.position,{surface:'stone',velocity:groundVelocity,strength:hit.wave>4?1.52:1.27,fracture:true});
        world.localToWorld(contact.copy(wave.position));
        contactImpulse(contact,hit.wave>4?.21:.17);
        hitStop = hit.wave>4?.055:.04;
        emit('ground-impact');
        if (selected?.name === 'Special_Leap_Slam') emit('leap_land');
      } else {
        fx.impact(contactLocal,{surface:'spirit',strength:1.36});
        emit('seal-release');
      }
    }
    function advanceWave(dt,p) {
      if (!wave.strike) { fx.shockwave(null); return; }
      wave.old = wave.radius;
      wave.age += dt;
      wave.radius = Math.min(wave.maximum,wave.age*12);
      fx.shockwave(wave.position,wave.radius,wave.maximum,wave.variant);
      const d = Math.hypot(p.x-wave.position.x,p.z-wave.position.z);
      if (!wave.hit && d+.33>=wave.old && d-.33<=wave.radius && p.y-wave.position.y<.95 &&
          lineClear(wave.position,p)) {
        wave.hit = true;
        world.localToWorld(contact.copy(p));
        enemyHit(wave.strike,contact);
      }
      if (wave.radius>=wave.maximum) wave.strike=null;
    }
    function startMove(move) {
      selected = move;
      strikeBody = 'attack';
      // Capture the upper torso at commitment. Future dodges never move
      // this aim point or widen the live contact volumes.
      const torso = heroNodes.get('spine_03') || fighter.root;
      torso.getWorldPosition(posedAim);
      strikeHeight = Math.max(fighter.root.position.y + 1.08, posedAim.y - .08);
      attackTime = motionTotal = 0;
      seenStrikes.clear();
      nextReady.set(move, now + move.cooldown);
      lastAttacks.unshift(move);
      lastAttacks.length = Math.min(3, lastAttacks.length);
      sampleAttack(move.name, .15);
      emit('telegraph');
    }
    function pickMove(distance, angle, grounded) {
      if (!grounded) return null;
      let best = null, highest = -Infinity;
      for (const a of ATTACKS) {
        if (phaseNumber < (a.phase || 1) || a.counter && !pendingCounter || (nextReady.get(a) || 0) > now ||
            Math.abs(angle) > (a.angle ?? .95) || distance < a.range[0] || distance > a.range[1]) continue;
        const recent = lastAttacks.indexOf(a);
        if (recent === 0 && ATTACKS.length > 1) continue;
        const ideal = (a.range[0] + a.range[1]) / 2;
        const flavor = Math.sin(decision * 2.39996 + ATTACKS.indexOf(a) * 1.618) * .48;
        const score = -Math.abs(distance - ideal) * .8 + (a.phase === 2 ? .54 : 0) +
          (a.counter ? 2 : 0) + (recent > 0 ? -.77 : 0) + flavor;
        if (score > highest) { best = a; highest = score; }
      }
      decision++;
      return best;
    }
    function sampleSocket(socket, outA, outB) {
      const [a, b] = SOCKETS[socket];
      at(a, outA);
      at(b, outB);
      if (socket === 'blade') outA.addScaledVector(at('staff_crown', shaft).sub(outB).normalize(), .32);
    }
    function adaptStrikeHeight(hit) {
      if (!hit || hit.wave) return;
      const staffStrike = hit.socket === 'blade' || hit.socket === 'crown';
      const socket = SOCKETS[hit.socket][1];
      let joint = staffStrike ? poseJoint.staff : poseJoint[hit.socket];
      at(socket, strikeReach);
      const target = hit.socket === 'foot_l' ? strikeHeight - .56 : strikeHeight;
      const above = strikeReach.y - target - .09;
      if (above <= 0 || !joint) return;

      // Use the torso when both hands are on the staff. Their authored
      // relative pose survives the correction, including the grip and wrist.
      if (staffStrike && poseJoint.spine) {
        at('staff_blade', shaftStart);
        at('staff_crown', shaftEnd).sub(shaftStart);
        at('weapon_l', offHand).sub(shaftStart);
        const fraction = Math.max(0, Math.min(1, offHand.dot(shaftEnd) / Math.max(.001, shaftEnd.lengthSq())));
        if (offHand.addScaledVector(shaftEnd, -fraction).lengthSq() < .29 * .29) joint = poseJoint.spine;
      }
      joint.getWorldPosition(strikeOrigin);
      strikeReach.sub(strikeOrigin);
      const horizontal = Math.hypot(strikeReach.x, strikeReach.z);
      if (horizontal < .47) return;
      const envelope = smooth((attackTime - hit.from + .19) / .19) *
        (1 - smooth((attackTime - hit.to) / .2));
      const angle = Math.min(hit.socket === 'foot_l' ? .26 : .49, Math.atan2(above, horizontal) * .94) * envelope;
      if (angle < .003) return;
      // Rotate the anchor bone about the transverse axis of its actual
      // reach. The weapon, hand and contact sockets are descendants.
      strikeAxis.set(strikeReach.z, 0, -strikeReach.x).normalize();
      joint.parent.getWorldQuaternion(parentRotation).invert();
      strikeLocalAxis.copy(strikeAxis).applyQuaternion(parentRotation);
      authoredRotation.copy(joint.quaternion);
      joint.quaternion.premultiply(strikeRotation.setFromAxisAngle(strikeLocalAxis, angle));
      correctedJoint = joint;
      joint.updateWorldMatrix(false, true);
      physicalContacts.heightAdjusted++;
      physicalContacts.lastWeaponHeight = at(socket, strikeOrigin).y - fighter.root.position.y;
    }
    function attacksStep(dt, p, yaw) {
      const move = selected, previous = attackTime;
      attackTime += dt;
      if (previous < Math.min(.27, move.hits[0].from - .065)) {
        turn(yaw + (move.yawOffset || 0), dt, 3.3);
      }
      const oldSocket = move.hits.find(h => h.to >= previous && !h.wave)?.socket;
      if (oldSocket) sampleSocket(oldSocket, previousA, previousB);
      local('staff_blade', groundPrev);
      if (move.advance) {
        const [begin, end, meters] = move.advance;
        const walk = smooth((attackTime - begin) / (end - begin)) * meters;
        const step = walk - motionTotal;
        motionTotal = walk;
        if (step > 0) shift(Math.sin(actor.rotation.y) * step, Math.cos(actor.rotation.y) * step, p);
      }
      restorePose();
      mixer.update(dt);
      model.updateWorldMatrix(true, true);
      animationTime = action.time;
      const heightWindow = move.hits.find(hit => attackTime >= hit.from - .19 && attackTime <= hit.to + .2);
      adaptStrikeHeight(heightWindow);
      local('staff_blade', groundCurr);
      groundVelocity.subVectors(groundCurr,groundPrev).multiplyScalar(1/dt);
      for (const hit of move.hits) {
        if (seenStrikes.has(hit) || attackTime < hit.from || previous >= hit.to) continue;
        if (hit.wave) {
          // A marker narrows the search. Ground effects wait for the blade to
          // reach the visible surface within that authored contact window.
          if (hit.socket === 'ground_impact' && groundCurr.y > stand.y + .28) continue;
          seenStrikes.add(hit);
          waveStart(hit);
          continue;
        }
        const [, , r] = SOCKETS[hit.socket];
        sampleSocket(hit.socket, currentA, currentB);
        const begin = Math.max(0, (hit.from - previous) / dt);
        const end = Math.min(1, (hit.to - previous) / dt);
        const continuous = oldSocket === hit.socket;
        sweepStartA.lerpVectors(continuous ? previousA : currentA, currentA, begin);
        sweepStartB.lerpVectors(continuous ? previousB : currentB, currentB, begin);
        sweepEndA.lerpVectors(continuous ? previousA : currentA, currentA, end);
        sweepEndB.lerpVectors(continuous ? previousB : currentB, currentB, end);
        if (C.sweep(sweepStartA, sweepStartB, sweepEndA, sweepEndB,
          r, refresh(heroVolumes, heroNodes), contact)) {
          world.worldToLocal(contactLocal.copy(contact));
          if (lineClear(actor.position, contactLocal)) {
            seenStrikes.add(hit);
            enemyHit(hit, contact, velocity.subVectors(currentB,previousB));
            if (selected !== move) return;
          }
        }
      }
      if (attackTime >= action.getClip().duration - .012) {
        selected = null;
        cooldown = phaseNumber === 1 ? TUNING.pause : TUNING.enragedPause;
        strikeBody = 'recover';
        sampleAttack(phaseNumber === 1 ? 'Combat_Idle' : 'Enraged_Idle');
      }
    }
    function ai(dt, p) {
      const actorX = actor.position.x, actorZ = actor.position.z;
      const dx = p.x - actorX, dz = p.z - actorZ;
      const distance = Math.hypot(dx,dz), yaw = Math.atan2(dx,dz);
      const angle = wrap(yaw - actor.rotation.y);
      if (selected) { attacksStep(dt, p, yaw); return; }
      if (vitals.state.health <= VITALS.health * TUNING.phaseAt && phaseNumber === 1 && strikeBody !== 'stagger') {
        phaseNumber = 2;
        wave.strike = null;
        transition('phase', 'Phase_Transition');
        emit('phase');
        return;
      }
      if (strikeBody === 'stagger' || strikeBody === 'recoil' || strikeBody === 'guardImpact') {
        if (!actionComplete) return;
        if (strikeBody === 'stagger' && vitals.state.broken) vitals.recover(.18);
        strikeBody = 'watch';
      }
      const idle = phaseNumber === 1 ? 'Combat_Idle' : 'Enraged_Idle';
      if (distance > TUNING.hearingRadius || Math.abs(p.y - stand.y) > .65) {
        strikeBody = 'watch';
        sampleAttack(idle);
        return;
      }
      if (cooldown <= 0) {
        const candidate = pickMove(distance, angle, lineClear(actor.position, p));
        if (candidate) {
          pendingCounter = false;
          startMove(candidate);
          return;
        }
      }
      turn(yaw, dt);
      if (distance > 2.07 && cooldown <= .05 && Math.abs(angle) < 1.1) {
        const running = distance > 6;
        const speed = running ? 2.9 : 1.26;
        if (shift(dx / distance * speed * dt, dz / distance * speed * dt, p)) {
          strikeBody = running ? 'pursue' : 'approach';
          sampleAttack(running ? 'Run_Forward' : 'Walk_Forward');
          return;
        }
      }
      if (distance < 1.66 && cooldown > 0) {
        if (shift(-dx / distance * .85 * dt, -dz / distance * .85 * dt, p)) {
          strikeBody = 'retreat';
          sampleAttack('Walk_Backward');
          return;
        }
      }
      if (distance < 3.4 && cooldown > .45 && lastAttacks.length >= 2 && decision % 3 === 1) {
        strikeBody = 'guard';
        sampleAttack('Block_Idle');
        return;
      }
      if (distance > 1.8 && distance < 3.9 && cooldown > .32 && lastAttacks.length && decision % 2 === 0) {
        const side = decision % 4 ? 1 : -1;
        if (shift(dz / distance * side * dt * .9, -dx / distance * side * dt * .9, p)) {
          strikeBody = 'strafe';
          sampleAttack(side === 1 ? 'Strafe_Left' : 'Strafe_Right');
          return;
        }
      }
      strikeBody = cooldown > 0 ? 'recover' : Math.abs(angle) > .75 ? 'turn' : 'watch';
      sampleAttack(idle);
    }

    function win() {
      selected = wave.strike = null;
      fx.clear();
      deathYawFrom = actor.rotation.y;
      deathYawTo = deathYawFrom;
      let clearance = -Infinity;
      const hero = heroPosition();
      for (const offset of [0, .9, -.9, 1.45, -1.45, 2.2, -2.2]) {
        const candidate = deathYawFrom + offset;
        const x = actor.position.x + Math.sin(candidate) * 2.8;
        const z = actor.position.z + Math.cos(candidate) * 2.8;
        if (!architecture(x, z, actor.position, .8)) continue;
        const score = Math.hypot(x - hero.x, z - hero.z) - Math.abs(offset) * .68;
        if (score > clearance) { clearance = score; deathYawTo = candidate; }
      }
      fighter.combat.fight(null);
      lastContext?.onEncounterInput?.();
      transition('deathKneel', 'Death_Kneel', .23);
      emit('defeat');
    }
    function weaponFrame(dt) {
      const heroAttack = fighter.combat.timeline();
      const time = heroAttack.time ?? 0, window = heroAttack.window;
      const drawn = window && fighter.weapon.seat() === 'hand' && phase === 'active';
      const heavy = /Finisher/.test(heroAttack.clip);
      const active = drawn && time >= window[0] - .09 && time <= window[1] + .12;
      fx.weapon('axe', active ? heavy ? 1.32 : .82 : 0, dt);
      const tip = drawn && fx.lowest('axe',floorTip);
      if (tip) {
        space.worldToLocal(axePoint.copy(tip));
        const h = axePoint.y - stand.y;
        const realFloor = architecture(axePoint.x, axePoint.z, actor.position,.06);
        if (hasAxeSample && heavy && active && h <= .12 && axeHeight > .12 && realFloor && bladeEvent !== heroAttack.started) {
          bladeEvent = heroAttack.started;
          const delta = localVelocity.subVectors(axePoint,axeLast);
          axePoint.y = stand.y + .02;
          fx.impact(axePoint,{surface:'stone',velocity:delta,strength:1.15,moon:true,fracture:true});
          contactImpulse(tip,.105);
          emit('axe-ground-contact',null,heroAttack.clip);
        }
        axeHeight = h;
        axeLast.copy(axePoint);
      } else axeHeight = Infinity;
      hasAxeSample = !!tip;

      let blade = 0, crown = 0;
      for (const hit of selected?.hits || []) {
        const isSlam = hit.socket === 'ground_impact';
        const name = isSlam ? 'blade' : hit.socket;
        if (name !== 'blade' && name !== 'crown') continue;
        const lead = isSlam ? .68 : .21;
        const activeUntil = isSlam ? hit.from + .09 : hit.to + .07;
        const glow = smooth((attackTime - hit.from + lead) / lead) *
          (1 - smooth((attackTime - activeUntil) / .21)) * (isSlam ? 1.3 : .91);
        if (name === 'blade') blade = Math.max(glow,blade);
        else crown = Math.max(glow,crown);
      }
      const heat = phaseNumber === 2 ? 1.22 : 1;
      fx.weapon('blade',blade*heat,dt);
      fx.weapon('crown',crown*heat,dt);
    }
    function step(dt) {
      if (!fighter) return;
      now += dt;
      timer += dt;
      hitStop = Math.max(0, hitStop - dt);
      impulse *= Math.exp(-dt * 11);
      flash *= Math.exp(-dt * 7);
      fighter.vitals.step(dt);
      vitals.step(dt);
      cooldown -= dt;
      const p = heroPosition();
      const active = phase === 'active';
      const movingClip = active && selected;
      if (!movingClip && hitStop <= 0) {
        restorePose();
        if (clipName === 'Death_Final' && dropTime < 0) local('Guardian_Staff', staffPrev);
        mixer.update(dt);
        animationTime = action.time;
        actionComplete = !LOOPS.has(clipName) && animationTime >= action.getClip().duration - .01;
      }
      if (dropTime >= 0 && dropTime < 2.5) updateDrop(dt);
      if (phase === 'dormant') {
        if (Math.abs(p.y - stand.y) <= .65 && Math.hypot(p.x - stand.x, p.z - stand.z) < TUNING.activate) {
          if (seen || retryPolicy) startCombat();
          else {
            lastContext?.onEncounterInput?.();
            fighter.combat.reset();
            action.paused = false;
            transition('awakening');
            emit('awakening');
          }
        }
      } else if (phase === 'awakening') {
        revealed = smooth(timer / 4.8);
        if (actionComplete) transition('intro', 'Cinematic_Intro', .25);
      } else if (phase === 'intro') {
        if (actionComplete) startCombat();
      } else if (active) {
        if (hitStop <= 0) ai(dt, p);
        if (phase === 'active') advanceWave(dt, p);
      } else if (phase === 'phase') {
        if (timer > 1.47 && timer - dt <= 1.47) fx.impact(local('chest_seal', chest),{surface:'spirit',strength:1.64});
        if (timer > 2.64 && timer - dt <= 2.64) fx.impact(local('chest_seal', chest),{surface:'spirit',strength:.76});
        if (actionComplete) {
          cooldown = 1.05;
          transition('active', 'Enraged_Idle');
        }
      } else if (phase === 'heroFalling') {
        if (timer >= 1.9) transition('lost');
      } else if (phase === 'deathKneel') {
        actor.rotation.y = mix(deathYawFrom, deathYawTo, smooth(timer / 1.3));
        revealed = mix(1.65, .7, smooth(timer / 3));
        if (actionComplete) transition('deathFinal', 'Death_Final', .23);
      } else if (phase === 'deathFinal') {
        revealed = mix(.7, 0, smooth(timer / 3.6));
        if (animationTime > 1.74 && dropTime < 0) releaseStaff();
        if (actionComplete) transition('opening', 'Death_Idle', .22);
      } else if (phase === 'opening') {
        const delay = 1.3, period = gate()?.state.duration || 5.2;
        local('chest_seal', chest);
        chest.y = Math.max(stand.y + .14, chest.y);
        fx.beam(timer <= delay + .34 ? chest : null, gateGlow);
        gate()?.encounterPose(Math.max(0, (timer - delay) / period),
          smooth(timer / delay) * (1 - smooth((timer - delay) / (period * .65))));
        if (timer >= delay + period) {
          fx.beam(null);
          defeated = objective = true;
          save();
          transition('return');
          emit('gate-open');
        }
      } else if (phase === 'return' && timer >= .85) {
        transition('won');
        lastContext?.onEncounterInput?.();
      }
      if (objective && p.x < stand.x - 14) objective = false;
      const anger = phaseNumber === 2 && (phase === 'phase' ? smooth(timer / 2.3) : 1);
      const brightness = phase === 'deathKneel' || phase === 'deathFinal' || phase === 'opening' || defeated ? revealed :
        revealed * (1 + .75 * (anger || 0) + flash);
      for (const [mat, intensity] of emission) mat.emissiveIntensity = intensity * brightness;
      weaponFrame(dt);
      fx.update(dt,0);
    }

    const time = C.clock(step);
    if (gate()) {
      const g = gate().model.getWorldPosition(gateGlow);
      space.worldToLocal(g);
      g.y += 3.5;
    }
    reset(false);
    function toggleLock() {
      if (phase !== 'active') return false;
      lockOn = !lockOn;
      return true;
    }
    function locked() {
      return LOCKED.has(phase);
    }
    function frameCamera(camera, hero, dt, manual, follow, clipCamera) {
      if (!fighter || phase === 'lost') return false;
      const shot = locked() && phase !== 'heroFalling' && phase !== 'return';
      const active = phase === 'active' || phase === 'phase';
      const p = actor.getWorldPosition(bossWorld);
      const combat = active && Math.hypot(hero.x - p.x, hero.z - p.z) < TUNING.hearingRadius;
      if (!shot && !combat && !cinematic && cameraBlend <= .003) return false;
      if (shot && !cinematic) {
        cameraFrom.copy(camera.position);
        aimFrom.copy(cameraFrom).addScaledVector(camera.getWorldDirection(cameraDirection), 5.5);
        cinematic = true;
      }
      if (shot) {
        const intro = phase === 'awakening' || phase === 'intro';
        const gateShot = phase === 'opening';
        const p = actor.getWorldPosition(bossWorld);
        cameraTo.set(p.x - (gateShot ? 10 : intro ? 4.8 : 6.7), p.y + (gateShot ? 4.6 : intro ? 1.08 : 2.35),
          p.z + (gateShot ? 3.5 : intro ? 2.65 : -2.3));
        if (gateShot) space.localToWorld(aimTo.copy(gateGlow));
        else aimTo.copy(p).y += intro ? 2.05 : 1.25;
        const entered = phase === 'awakening' || phase === 'deathKneel' ? smooth(timer / 1.35) : 1 - Math.exp(-dt * 3.8);
        if (phase === 'awakening' || phase === 'deathKneel') {
          cameraPosition.lerpVectors(cameraFrom, cameraTo, entered);
          cameraAim.lerpVectors(aimFrom, aimTo, entered);
        } else {
          cameraPosition.lerp(cameraTo, entered);
          cameraAim.lerp(aimTo, entered);
        }
        camera.position.copy(cameraPosition);
        clipCamera(camera, hero);
        camera.lookAt(cameraAim);
        return true;
      }
      follow(combat && !manual ? 1.1 : 0);
      cameraPivot.copy(hero).y += 1.45;
      camera.getWorldDirection(cameraDirection);
      aimTo.copy(camera.position).addScaledVector(cameraDirection, camera.position.distanceTo(cameraPivot));
      if (cinematic) {
        cameraBlend = Math.max(cameraBlend, .95);
        cinematic = false;
      }
      cameraBlend *= Math.exp(-dt * 5.6);
      if (cameraBlend > .003) {
        camera.position.lerp(cameraPosition, cameraBlend);
        aimTo.lerp(cameraAim, cameraBlend);
      }
      if (combat && !manual && cameraBlend < .2) {
        actor.getWorldPosition(bossWorld).y += 1.85;
        const distance = bossWorld.distanceTo(cameraPivot);
        if (distance < 12) {
          cameraDirection.copy(bossWorld).sub(camera.position).normalize();
          const forward = camera.getWorldDirection(aimFrom);
          const influence = forward.dot(cameraDirection) > .25 ? lockOn ? .62 : .27 : lockOn ? .49 : 0;
          cameraAim.copy(cameraPivot).lerp(bossWorld, influence);
          aimTo.lerp(cameraAim, 1 - cameraBlend);
        }
      }
      // Fit the camera outside the guardian and reuse the sealed world's cast.
      actor.getWorldPosition(bossWorld);
      if (combat && Math.hypot(camera.position.x - bossWorld.x, camera.position.z - bossWorld.z) < 1.44 &&
          camera.position.y < bossWorld.y + 3.65) camera.position.y = bossWorld.y + 3.7;
      const shake = Math.sin(now * 86) * impulse;
      camera.position.y += shake*.66;
      camera.position.x -= trauma.z*shake*.42;
      camera.position.z += trauma.x*shake*.42;
      if (cameraBlend > .003 || combat) clipCamera(camera, hero);
      camera.lookAt(aimTo);
      return true;
    }

    return {
      prepare: fx.prepare,
      tick(dt, ctx) {
        lastContext = ctx;
        bind(ctx.fighter);
        if (!fighter) return;
        heroPosition();
        fx.frame(dt);
        const distance = actor.position.distanceTo(heroLocal);
        if (phase === 'dormant' && distance > 24) return;
        if (!paused) time.advance(dt);
        const view = phase === 'active' && distance > TUNING.hearingRadius ? 'dormant' : phase;
        hud.update(dt, view, fighter.vitals, vitals, selected, objective, lockOn);
      },
      locked, skip, frameCamera,
      cameraBox(x, z) {
        if (BODILESS.has(phase)) return null;
        const p = actor.getWorldPosition(bossWorld);
        if (Math.hypot(p.x - x, p.z - z) > 10) return null;
        guardianBox.minx = p.x - .65; guardianBox.maxx = p.x + .65;
        guardianBox.miny = p.y; guardianBox.maxy = p.y + 3.25;
        guardianBox.minz = p.z - .65; guardianBox.maxz = p.z + .65;
        return guardianBox;
      },
      blocks(x, z, previous, margin) {
        if (BODILESS.has(phase) || Math.abs(previous.y - stand.y) > .65) return false;
        const next = Math.hypot(x - actor.position.x, z - actor.position.z);
        return next < radius + margin && next + .001 < Math.hypot(previous.x - actor.position.x, previous.z - actor.position.z);
      },
      debug() {
        return { phase, ai: strikeBody, phaseNumber, clip: clipName, time: animationTime, attack: selected?.name, attackTime,
          windows: selected?.hits.map(({ from, to, socket }) => ({ from, to, socket })), guardian: { ...vitals.state },
          hero: fighter && { ...fighter.vitals.state }, sinClip: fighter?.combat.timeline(), parryAge: fighter?.combat.guardAge(),
          invulnerable: fighter?.combat.invulnerable(), blocking: fighter?.combat.blocking(), saved: defeated,
          staffDetached: staff.parent !== grip, heroPosition: fighter?.root.position.toArray(),
          guardianPosition: actor.getWorldPosition(bossWorld).toArray(),
          vfx: fx.stats(), physicalContacts: { ...physicalContacts }, hits: log.slice(), clips: [...actions.keys()], attacks: ATTACKS.map(a => a.name) };
      },
      toggleLock,
      dispose() { exitTarget?.(); fighter?.combat.fight(null); hud?.remove(); mixer.stopAllAction(); fx.dispose(); },
      lab: {
        weapons: (part) => fx.surface(part),
        preview(part) { fx.preview(part); weaponFrame(.2); fx.update(.016,0); },
        effects(on) { fx.enable(on); },
        vfxQuality(tier) { fx.setTier(tier); },
        pause(on) { paused = Boolean(on); },
        single() { if (paused) time.single(); },
        attack(name) {
          const move = ATTACKS.find(a => a.name === name);
          if (move && phase === 'active') { paused = false; startMove(move); return true; }
          return false;
        },
        fresh() { reset(); save(); },
        health(who, value) {
          const unit = who === 'hero' ? fighter.vitals : vitals;
          unit.state.health = Math.max(1, Math.min(unit.maximum, Number(value) || unit.maximum));
        },
        sockets() { return [...required, 'claw_r', 'foot_r'].map(name => [name, at(name, vector()).toArray()]); },
        volumes() { return [...refresh(bossVolumes, nodes), ...refresh(heroVolumes, heroNodes)]; },
        axe() { return fighter.combat.axeContact(); }
      }
    };
  }

  root.SinGuardianEncounter = { mount, asset: 'assets/Guardian_of_the_Covenant.glb', config: TUNING };
})(globalThis);
