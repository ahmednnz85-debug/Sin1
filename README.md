# قصر بابل — التشغيل المحلي

1. فكّ ضغط الحزمة.
2. افتح الطرفية داخل المجلد الذي يحتوي `index.html`، ثم شغّل:

   ```bash
   python3 -m http.server 8000
   ```

3. افتح `http://localhost:8000` في المتصفح.

تحتاج اللعبة إلى اتصال بالإنترنت لتحميل Three.js وGLTFLoader من jsDelivr، مثل النسخة الأصلية. أصول السور والنخيل والقوارير موجودة في مجلد `assets`.

## إسناد الأصول المضافة (CC BY 4.0)

- Ancient Clay Pot — AO-INTERACTIVE: https://sketchfab.com/3d-models/ancient-clay-pot-d43e8a36001043c99e7e6c8549a4d7a7
- Ancient Clay Pots — Tiberiu Uncu: https://sketchfab.com/3d-models/ancient-clay-pots-6f40f39a1d694cb381f135a3e9f45206
- Realistic Palm Tree Free — Next Spring: https://sketchfab.com/3d-models/realistic-palm-tree-free-39052ea764c945858449e699318efa53
- Realistic Palm Tree 4 Free — Next Spring: https://sketchfab.com/3d-models/realistic-palm-tree-4-free-917c18d6b2d04d33950dea6e20bc074f
- Medieval Door — HASSAN: https://sketchfab.com/3d-models/medieval-door-581dc6a53d2d4cafb5f781127f137c6f

## مشهد الباب الملكي

- يبدأ الباب مغلقًا، ويفتح تلقائيًا عند وصول Sîn إلى منطقة الاقتراب أعلى الدرج؛ لا يحتاج المشهد إلى زر تفاعل إضافي.
- يستخدم المشهد مجسم `assets/مجسم الباب.glb` وخاماته ومقطع الفتح الأصلي، مع إعادة توقيت المقطع ببطء. الملف الأصلي يحتوي ضلفة واحدة متحركة.
- حركة الدفع مولّدة على عظام الشخصية الحالية، وتبقى حركات الوقوف والمشي والركض الأصلية دون تعديل. بعد الفتح يعود التحكم ويمكن العبور، ولا يتكرر المشهد.

## البطل والتحكم والقتال (Advanced Character & Combat Controller V1)

- الموديل الوحيد للبطل: `assets/Sin_combat_FINAL3_axe.glb` (هيكل 70 عظمة + الفأس + مقبس الظهر ومقبس اليد). حُذف البطل القديم (Mixamo) ونسخة `Sin_combat_FINAL.glb` السابقة.
- النظام كله في `sin-hero.js` (وحدات منفصلة: Input / Locomotion / Animation / AnimationEvents / Weapon / Combat / Interaction / IK / Camera) والواجهة في `sin-hud.css`.
- عصا واحدة للمشي والركض حسب مقدار الإزاحة (لا يوجد زر ركض): ‎0–10% وقوف، 10–55% مشي، 55–75% هرولة، 75–90% ركض، 90–100% ركض سريع (حتى 6.6 م/ث).
- الأزرار: هجوم خفيف، هجوم ثقيل، مراوغة، الفأس (سحب/إرجاع)، صد، تفاعل (يظهر فقط قرب عنصر قابل للتفاعل).
- لوحة المفاتيح: WASD حركة (Shift ركض سريع، Ctrl مشي)، J خفيف، K ثقيل، Space مراوغة، R الفأس، U صد (مطوّل)، F تفاعل، Q/E تدوير الكاميرا.
- بيئة الاختبار المعزولة: `tests/hero-lab.html` (أرضية، درجات، جدران، دُمى تدريب). الفحص الآلي: `tests/hero-lab-run.cjs`.
- التفاصيل والحركات الناقصة: `HERO_COMBAT_CONTROLLER_REPORT_AR.md`.
