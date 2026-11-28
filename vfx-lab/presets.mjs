const axe = (label, clip, window, charge, strength = 1, contact = 'armor', extra = {}) => ({
  label, actor: 'sin', clip, window, charge, strength, contact, channel: 'axe', moon: true, ...extra
});
const staff = (label, clip, window, charge, channel, strength = 1, contact = 'armor', extra = {}) => ({
  label, actor: 'guardian', clip, window, charge, strength, contact, channel, ...extra
});
const overhead = [1.10, 1.46];
const slam = [1.59, 1.88];
const leap = [1.81, 2.14];

export const effects = Object.freeze({
  SIN_AXE_LIGHT_TRAIL: axe('أثر الفأس الخفيف', 'Attack_Right', [.27,.42], .12,.78,'none'),
  SIN_AXE_HEAVY_TRAIL: axe('أثر الفأس الثقيل', 'Finisher_Heavy', [.70,.91], .46,1.25,'none'),
  SIN_AXE_COMBO_TRAIL: axe('كومبو الفأس', 'Attack_Right', [.27,.41], .12,.87,'armor', { sequence: true }),
  SIN_AXE_FINISHER: axe('ضربة سين الختامية', 'Finisher_Jump', [.74,.92], .42,1.48),
  SIN_AXE_METAL_IMPACT: axe('الفأس على الدرع', 'Attack_Right', [.27,.42], .12,1.05),
  SIN_AXE_GROUND_IMPACT: axe('الفأس على الحجر', 'Finisher_Heavy', [.70,.96], .35,1.21,'stone', { fixture: 'ledge' }),
  SIN_AXE_LUNAR_BURST: axe('دفعة قمرية', 'Finisher_Jump', [.74,.94], .48,1.40,'armor',{ burst: 'moon' }),
  SIN_AXE_PARRY: staff('التصدي بالفأس للصولجان', 'Attack_Staff_Thrust', [.28,.62], .12,'blade',1.35,'parry'),
  SIN_AXE_CHARGE: axe('شحن حافة الفأس', 'Finisher_Heavy', [.71,.87], .52,1.15,'none',{ windupOnly: true }),
  GUARDIAN_STAFF_LIGHT_TRAIL: staff('أثر نصل الصولجان', 'Attack_Staff_Swing_Left', [.47,1.09], .21,'blade',.94,'none'),
  GUARDIAN_STAFF_HEAVY_TRAIL: staff('أثر رأس الصولجان الثقيل', 'Attack_Staff_Swing_Right', [.53,1.22], .28,'crown',1.34,'none'),
  GUARDIAN_STAFF_BLADE_IMPACT: staff('إصابة نصل الصولجان', 'Attack_Staff_Overhead', overhead, .36,'blade',1.21),
  GUARDIAN_STAFF_CROWN_IMPACT: staff('إصابة رأس الصولجان', 'Attack_Combo_02', [1.72,1.97], .27,'crown',1.55),
  GUARDIAN_STAFF_GROUND_SLAM: staff('ضربة الصولجان الأرضية', 'Special_Ground_Slam', slam, .67,'blade',1.43,'stone',{ wave:'ground' }),
  GUARDIAN_STAFF_LEAP_SLAM: staff('قفزة الحارس الساحقة', 'Special_Leap_Slam', leap, .63,'blade',1.62,'stone',{ wave:'ground', advance:1.25 }),
  GUARDIAN_GOLDEN_SHOCKWAVE: staff('الموجة الذهبية', 'Special_Ground_Slam', slam, .49,'blade',1.27,'stone',{ wave:'ground' }),
  GUARDIAN_SPIRITUAL_BURST: staff('انبعاث الختم الروحي', 'Special_Energy_Release', [1.07,1.15], .65,'seal',1.20,'seal',{ wave:'seal' }),
  GUARDIAN_CHEST_SEAL_CHARGE: staff('شحن ختم الصدر', 'Special_Seal_Activation', [2.26,2.30], 1.6,'seal',1.18,'seal'),
  GUARDIAN_ENRAGED_AURA: staff('هالة غضب العهد', 'Phase_Transition', [1.46,1.51], 1.15,'seal',1.30,'seal',{ aura:true }),
  GUARDIAN_CLAW_SLASH: staff('ضربة مخلب الحارس', 'Attack_Claw_Left', [.62,1.00], .23,'claw',.96,'flesh')
});

export const groups = Object.freeze([
  { label: 'فأس سين', ids: Object.keys(effects).filter(id => id.startsWith('SIN_')) },
  { label: 'حارس العهد', ids: Object.keys(effects).filter(id => id.startsWith('GUARDIAN_')) }
]);
export const combo = [
  ['Attack_Right', [.27,.42], .12], ['Attack_Left', [.16,.42], .12], ['Finisher_Heavy',[.70,.9],.38]
];
export const demonstration = [
  'SIN_AXE_COMBO_TRAIL', 'GUARDIAN_STAFF_CROWN_IMPACT', 'SIN_AXE_PARRY',
  'GUARDIAN_STAFF_LEAP_SLAM', 'GUARDIAN_CHEST_SEAL_CHARGE',
  'GUARDIAN_ENRAGED_AURA', 'GUARDIAN_SPIRITUAL_BURST', 'SIN_AXE_LUNAR_BURST'
];
