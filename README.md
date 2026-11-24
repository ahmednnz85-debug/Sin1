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

## البطل والتحكم والقتال

- **الموديل وملفات النظام:**
  - الموديل الوحيد للبطل: `assets/Sin_hero_runtime.glb`، نسخة تشغيل من `assets/Sin_combat_FINAL3_axe.glb` تُبنى بـ`tools/trim-hero-clips.py`.
  - النظام في `sin-hero.js`، والواجهة في `sin-hud.css`.
- **العصا:** عصا واحدة بثلاث حالات، دون زر ركض:
  - أقل من 10%: وقوف.
  - من 10% حتى 58%: مشي (1.28 م/ث).
  - 58% فأكثر: ركض (9.4 م/ث)، والعودة إلى المشي عند 52%.
- **سرعات المشي والركض:** مقاسة من خطوات المقطعين عند التحميل، والمقاطع تعمل بإيقاعها الأصلي دون أي تسريع أو إبطاء.
- **التوقف:** يتزامن مع وضع القدمين، مع تثبيت القدم الحاملة (Foot Locking). المراوغة تتحرك بالـRoot Motion المؤلف في الملف، والهجمات في مكانها.
- **الكاميرا:** مطابقة للنسخة السابقة للبطل الجديد (`4fe79f0`)، دون أي اهتزاز أو تقريب قتالي.
- **لوحة المفاتيح:**

  | المفتاح | الوظيفة |
  |---|---|
  | WASD | مشي |
  | WASD + Shift | ركض |
  | J | هجوم خفيف |
  | K | هجوم ثقيل |
  | Space | مراوغة |
  | R | الفأس |
  | U | صد |
  | F | تفاعل |
  | Q/E | تدوير الكاميرا |

- **بيئة الاختبار المعزولة:** `tests/hero-lab.html`.
- **الفحوص الآلية:**
  - `tests/hero-motion-audit.cjs` (انزلاق، توقف، التفاف، FPS).
  - `tests/hero-lab-run.cjs` (الفأس، الكومبو، المراوغة، الدفع).
- **التفاصيل:** `HERO_LOCOMOTION_CAMERA_RESTORE_REPORT_AR.md`.
