/* Sîn Developer Hub — area registry (temporary developer tool).
   ---------------------------------------------------------------------------
   Every entry becomes a menu item and a direct link: ?dev=1&level=<id>.
   To add an area, call SinDevHub.register({...}) here (or from any module
   loaded after dev-hub.js). Fields:
     id      stable id used in the link (never rename a published id)
     group   menu section (see GROUPS)
     ar, en  display names
     stage   'outdoor' | 'palace' | 'r3' — which game stage must be booted
     spawn   stage-specific spawn description:
               outdoor: { x, z, yaw }          world metres, yaw 0 = +z
               palace:  { teleport: '<region id>' }  PalaceWings.teleport target
               r3:      { u, v, y, yaw }       R3 stage space (u out of
                        passage-L0, v along the hall, y below the hall floor)
   Remove this file together with dev-hub.js to remove the tool. */
(function (root) {
  'use strict';
  const H = root.SinDevHub;
  if (!H) return;

  H.groups([
    ['outdoor', 'العالم الخارجي', 'Outdoor world'],
    ['hall', 'قاعة العرش', 'Throne hall'],
    ['kings', 'الجناح الملكي', 'Royal wing'],
    ['library', 'المكتبة والأرشيف', 'Library & archive'],
    ['temple', 'معبد القمر', 'Moon temple'],
    ['corridors', 'الممرات والأروقة', 'Corridors & galleries'],
    ['r3', 'المنطقة المختومة R3', 'Sealed zone R3']
  ]);

  // Outdoor stage (index.html world): the road runs along +z from the start
  // (z = -30) through the Ishtar gate (z ≈ 0), the canal market road
  // (z 7–76), the palace plaza (z 76–160) to the royal door (z ≈ 184).
  const out = (id, ar, en, x, z, yaw = 0) => H.register({ id, group: 'outdoor', ar, en, stage: 'outdoor', spawn: { x, z, yaw } });
  out('OUT-START', 'نقطة البداية', 'Story start', 0, -30);
  out('OUT-GATE', 'بوابة عشتار', 'Ishtar Gate', 0, -13);
  out('OUT-MARKET', 'طريق الأسواق', 'Market road', 0, 32);
  out('OUT-PLAZA', 'ساحة القصر', 'Palace plaza', 0, 96);
  out('OUT-PALACE', 'مدخل القصر', 'Palace royal door', 1, 166);

  // Palace stage: throne hall and every region of wing-architecture.js
  // (rooms and connectors), entered through PalaceWings.teleport.
  const pal = (id, group, ar, en, teleport = id) => H.register({ id, group, ar, en, stage: 'palace', spawn: { teleport } });
  pal('HALL', 'hall', 'قاعة العرش', 'Throne hall', 'Palace');
  [['K1', 'قاعة الاستقبال', 'Reception hall'], ['K2', 'قاعة المجلس', 'Council hall'], ['K3', 'غرفة الخرائط', 'Map room'],
    ['K4', 'الخزانة الملكية', 'Royal treasury'], ['K5', 'جناح الملك الخاص', 'King private wing']]
    .forEach(([id, ar, en]) => pal(id, 'kings', ar, en));
  [['L1', 'المكتبة الكبرى', 'Great library'], ['L2', 'الأرشيف الملكي', 'Royal archive'], ['L3', 'غرفة الكتبة', 'Scribes room'],
    ['L4', 'المرصد', 'Observatory']]
    .forEach(([id, ar, en]) => pal(id, 'library', ar, en));
  [['T1', 'المدخل المقدس', 'Sacred entrance'], ['T2', 'قاعة التطهير', 'Purification hall'], ['T3', 'قاعة الأعمدة المقدسة', 'Sacred columns'],
    ['T4', 'الحرم القمري', 'Holy sanctuary'], ['T5', 'غرفة القرابين', 'Offering room']]
    .forEach(([id, ar, en]) => pal(id, 'temple', ar, en));
  [['KC12', 'ممر الملوك', 'Kings corridor'], ['KC1', 'ممر الملوك الشمالي', 'Kings L corridor (north)'],
    ['KC2', 'ممر الملوك الجنوبي', 'Kings L corridor (south)'], ['KC3', 'ممر الخرائط', 'Map corridor'],
    ['KC4', 'ممر الخزانة', 'Treasury corridor'], ['KC5R', 'الممر الخلفي', 'Rear approach'], ['REAR', 'الرواق الخلفي', 'Rear gallery'],
    ['TR1', 'ممر المعبد الخلفي', 'Temple rear corridor'], ['TC12', 'ممر التطهير', 'Temple corridor T1–T2'],
    ['TC23', 'ممر الأعمدة', 'Temple corridor T2–T3'], ['TC34', 'ممر الحرم', 'Temple corridor T3–T4'],
    ['TC5', 'ممر القرابين', 'Temple corridor T3–T5'], ['LC2', 'ممر الأرشيف', 'Library corridor L1–L2'],
    ['LC3', 'ممر الكتبة', 'Library corridor L1–L3'], ['LC4', 'ممر المرصد', 'Library corridor L1–L4'],
    ['MP1', 'الممر القمري الأول', 'Moon passage 1'], ['MP2', 'الممر القمري الثاني', 'Moon passage 2']]
    .forEach(([id, ar, en]) => pal(id, 'corridors', ar, en));

  // R3 (independent stage behind passage-L0). Stage-space spawns match
  // r3-sealed-zone.js: TURN 34, HALL_U 59, HALL_V 24, gallery floor -15.
  const r3 = (id, ar, en, spawn) => H.register({ id, group: 'r3', ar, en, stage: 'r3', spawn });
  r3('R3-01', 'درج السنين المدفونة', 'Buried Years Stair', { stageSpawn: true });
  r3('R3-02', 'قاعة الختم الأول', 'First Seal Hall', { u: 40.9, v: 24, y: -15, yaw: -Math.PI / 2 });
  r3('R3-03', 'فم الهاوية', 'Mouth of the Abyss', { u: 59, v: -4.2, y: -15.8, yaw: -Math.PI / 2 });
})(typeof window !== 'undefined' ? window : globalThis);
