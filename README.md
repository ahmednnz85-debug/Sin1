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

- الموديل: `assets/hero_new.glb` (يُحمَّل مرة واحدة عند البدء، وحركاته مدمجة داخله). حُذف البطل القديم من `index.html`.
- ربط الحركات (في `ANIM_CFG` داخل `index.html`): Idle = `Still Pose`، Walk = `walk_casual`، Run = `sprint_enter_quaternius`، Counterattack = `riposte`، Sword Air Punch = `aerial_punch_down`.
- غير مفعّلة عمداً: `walk_relaxed`، `Fast Thrust`، `Quick Stab` (ولا يوجد لها زر).
- القتال: زر «قتال» فوق زر «ركض» يفتح خيارين (رد / لكمة السيف الهوائية). من لوحة المفاتيح: J = رد، K = لكمة السيف.
- التحكم والكاميرا بلا تغيير. أثناء الجزء الأول من حركة القتال تُقفل الحركة فقط، ثم يلغيها أي إدخال حركة.
