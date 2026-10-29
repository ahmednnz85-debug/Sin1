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

## البطل الجديد والقتال (v3)

- الموديل المستخدم: `assets/‎⁨سين_وقوف_ساكن_سينمائي⁩.glb` (يُحمَّل مرة واحدة عند البدء). `assets/hero_new.glb` لم يعد يُستخدم داخل اللعبة.
- ربط الحركات من ملف الشخصية الجديدة فقط: الوقوف = `Sin_Idle_Cinematic` (المقطع السينمائي الوحيد؛ لا يوجد مقطع اسمه `Idle_Cinematic` حرفياً)، المشي = `walk_casual`، الركض = `sprint_loop_quaternius` (حركة الركض الوحيدة داخل هذا الملف، مربوطة بهيكله).
- لم تُستخدم حركات الملف الآخر المشابهة: `Still Pose` و`sprint_enter_quaternius` من `hero_new.glb`، ولا `walk_relaxed` / `idle_impatient`.
- القتال: ملف الشخصية الجديدة لا يحتوي `riposte` ولا `aerial_punch_down`، والهيكل مختلف عن `hero_new` فلا تُنقل تلك الحركات. كود القتال كما هو، ويُخفى زر القتال تلقائياً إذا غابت الحركات.
- التحكم والكاميرا وسرعة المشي/الركض في العالم بلا تغيير.
