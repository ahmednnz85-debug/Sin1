# محرك المؤثرات البصرية — Sîn Advanced VFX Engine

دليل البنية والاستخدام والدمج المستقبلي مع نظام القتال.

> **الحالة:** المحرك ومختبره يعملان باستقلال تام عن اللعبة. لا يحمّل `index.html` ولا أي ملف من ملفات اللعبة `vfx/sin-vfx.js`، ولم يُربط أي مؤثر بالمواجهة القصصية. الربط بالحركات الموجود حالياً مؤقت داخل المختبر فقط، ويُستبدل بعد اعتماد الجودة.

## 1. الملفات

| المسار | الدور |
| --- | --- |
| `vfx/sin-vfx.js` | المحرك (`window.SinVFX`): مدير المؤثرات، والأنظمة، والتجميع النهائي، ومستويات الجودة. |
| `vfx/shaders/*.glsl` | جميع الـShaders: الجسيمات، والآثار الشريطية، والموجات الصدمية، والملصقات الأرضية الإسقاطية، والـBloom، والتجميع. |
| `vfx/effects/sin-axe.json` | مؤثرات فأس سين (الطاقة القمرية). |
| `vfx/effects/guardian.json` | مؤثرات حارس العهد (الطاقة الذهبية الملعونة). |
| `vfx/effects/surface-impacts.json` | نظام الاصطدام حسب السطح: جدول السلاح × السطح، وخصائص كل مادة، ومؤثرات الاصطدام العامة. |
| `vfx/data/combat-bindings.json` | ربط مؤقت للمؤثرات بحركات الشخصيتين، داخل المختبر فقط. |
| `vfx/data/guardian-combat-events.json` | توقيتات حركات الحارس، مقاسة من حركة نقاط اتصال الـGLB. |
| `assets/vfx/source/*.png` | الصور الثلاث الأصلية كما سُلّمت، دون تعديل. |
| `assets/vfx/*.webp`، `vfx-ramps.png`، `atlas.json` | الخامات المستخرجة والمعالجة، ومناطق UV. |
| `tools/vfx/regions.py`، `tools/vfx/build-atlas.py` | تعريف مناطق العناصر في اللوحات الثلاث، وخط المعالجة الكامل. |
| `vfx-lab.html`، `vfx/vfx-lab.js` | مختبر المؤثرات المستقل. |
| `tools/vfx/lab-check.cjs` | فحص المختبر آلياً في متصفح حقيقي: صور، وفيديو، وأداء، وتسرّب. |
| `tests/vfx-engine.test.cjs` | فحوص ثابتة للتعريفات والخامات والربط. |

## 2. خط معالجة الخامات

```bash
python3 tools/vfx/build-atlas.py --preview
```

- كل عنصر في اللوحات الثلاث له منطقة مسمّاة في `tools/vfx/regions.py`، ويُستخرج منفرداً. اللوحات خامات ثابتة، فلا يُعامل أي عنصر على أنه إطار من Flipbook.
- **عزل العنصر:** تُحسب المكوّنات المتصلة للّوحة كلها، ويُبقى في كل منطقة ما يخصّها فقط. يزيل ذلك ما يتسرّب إليها من العناصر المجاورة، ثم تُليَّن حوافها.
- **عناصر الطاقة والشرر (Additive):** تُطرح أرضية السواد الخاصة بكل عنصر، مع الحفاظ على اللون والتدرّج الأصليين. تُخزَّن RGB للمزج الجمعي، وقناة Alpha للتغطية.
- **التشققات (Alpha):** تُستخرج الحجارة بقناع Alpha سليم، ويُزال سواد الحواف (un-premultiply). تبقى الشقوق الضيقة والحفر المغلقة جزءاً من الملصق، فلا تظهر جزر حجرية عائمة. يُمدّد اللون تحت الشفافية (color bleed) ليمنع الحواف السوداء عند الفلترة.
- **الخرائط المشتقة:** خريطة Normal من ارتفاع الحجر. وقناع توهّج الشقوق في قناة Alpha للخامة المساعدة، ومنه تتسرب الطاقة الذهبية أو القمرية من بين الحجارة.
- **خامات إجرائية:**
  - `vfx-noise.webp`: Fbm وCellular وحقل Curl للتدفق، قابلة للتكرار.
  - `vfx-shapes.webp`: نفثات غبار، وتوهج ناعم، وخط شرارة، وذرة طاقة، وحلقة، ولسان لهب.
  - `vfx-ramps.png`: ألوان عبر العمر: تبريد الشرر، والذهب، والقمر، والغبار، والجمر، والختم.
- **الأطلس:** هوامش 8 بكسل، وUV بإزاحة نصف بكسل. Mipmaps وفلترة Trilinear وAnisotropy تصل إلى 4×. فضاء الألوان sRGB للألوان وLinear للبيانات. نسخة 1K لمستوى Low.

## 3. الواجهة البرمجية

```js
const vfx = await SinVFX.create({ THREE, renderer, scene, camera, base: '', quality: 'auto', groundY: 0 });
await vfx.prewarm();                          // يجهّز كل البرامج والخامات قبل أول مؤثر

vfx.registerRig('guardian', {                 // مرة واحدة لكل شخصية
  sockets:  { chest_seal, staff_blade, staff_crown, claw_r, root, ... },  // Object3D
  rails:    { staff_crown: [obj|fn, ...], staff_blade: [...], ... },       // نقاط تتبع على السلاح
  bones:    [ ...Object3D ],                  // لمؤثرات الهالة على الجسد
  materials:{ Covenant_Chest_Seal_Emission: mat, ... }                     // لتوهج النقوش
});

const h = vfx.play('GUARDIAN_STAFF_GROUND_SLAM', {
  position, normal, direction,                // موضع العالم، واتجاه السطح، واتجاه الضربة
  scale, intensity, duration, strength,       // الحجم، والشدة، والمدة، وقوة الارتطام
  rig: 'guardian', socket: 'staff_blade',     // نقطة اتصال السلاح
  surface: 'stone', seed, loop, timeLocked
});
h.stop(); h.kill(); h.alive;

vfx.impact({ weapon: 'axe', surface: 'armor', position, normal, velocity, strength });  // نظام الاصطدام حسب السطح

// كل إطار:
vfx.update(dt);   // dt بعد تطبيق الحركة البطيئة أو الإيقاف
vfx.render();     // يحل محل renderer.render(scene, camera)
```

- `settings`: `size`، `density`، `glow`، `opacity`، `duration`، `strength`، `shake`، `bloom`، `distortion`، `tint`، `tintAmount`.
- `muted`: إخفاء طبقة (`'EFFECT_ID/layer'`) أو نوع طبقة (`'type:debris'`).
- `shake.offset` و`shake.rot`: اهتزاز الكاميرا. يطبّقه مالك الكاميرا، وقوته قابلة للضبط.
- `stats()`: الجسيمات الحية، والآثار، والملصقات، والشظايا، والأضواء، وDraw Calls، والذاكرة التقديرية.
- `clearAll()` و`dispose()`.

## 4. تعريف المؤثر

```json
{ "id": "GUARDIAN_STAFF_CROWN_IMPACT", "group": "guardian", "ar": "…", "en": "…",
  "duration": 1.8, "tail": 7, "impactAt": 0.9, "loop": false, "surface": "stone",
  "layers": [ { "name": "sparks", "type": "burst", "start": 0.0, … } ] }
```

| النوع | الوظيفة | أهم المعاملات |
| --- | --- | --- |
| `trail` | أثر شريطي يتبع نقاط التتبع الحقيقية على السلاح، وعرضه وشدته من سرعة النصل. | `rails`، `length` (ث)، `speedRef`، `minSpeed`، `width`، `widthMin`، `sprite`، `sprite2`، `edge`، `flow`، `dissolve`، `sparks` (انبعاث حسب السرعة) |
| `burst` | دفعة جسيمات. | `count`، `life`، `speed`، `dir` (`normal`، `reflect`، `direction`، `radial`، `outward`، `inward`، `up`)، `spread`، `gravity`، `drag`، `bounce`، `size`، `sizeEnd`، `stretch`، `ramp`، `blend` (`add`، `alpha`، `distort`)، `soft`، `dissolve`، `surfaceKey`، `surfaceTint` |
| `stream` | انبعاث مستمر. | معاملات `burst`، و`rate`، و`at` (`socket`، `rails`، `bones`، `origin`)، و`ramp_up` |
| `sprite` | عنصر واحد من الأطلس يتحرك ويتلاشى. | `orient` (`billboard`، `normal`، `swing`، `axial`)، `size`/`sizeEnd`، `spin`، `follow` |
| `shockwave` | موجة صدمية. | `kind` (`ring`، `wall`، `distort`)، `radius0`/`radius`، `height`، `life` |
| `decal` | ملصق تشققات مُسقط على عمق المشهد. | `sprite`، `size`، `life`، `glow`، `glowColor`، `glowTime`، `glowHold` |
| `debris` | شظايا حجرية فيزيائية. | `count`، `speed`، `size`، `life`، `dir`، `spread` |
| `light` | ومضة ضوئية من مجموعة أضواء ثابتة العدد. | `color`، `intensity`، `life`، `range` |
| `shake` | اهتزاز الكاميرا. | `amount`، `freq` |
| `glow` | يرفع توهّج مادة من مواد الشخصية ثم يعيده إلى قيمته. | `material`، `peak`، `rise`، `pulse`، `release` |

- لكل طبقة `start` و`end` نسبةً إلى بداية المؤثر، ولذلك لا تظهر الطبقات كلها ولا تختفي معاً.
- `surfaces` و`notSurfaces` تقصر الطبقة على أنواع أسطح محددة، و`minTier` على مستوى جودة أدنى.

## 5. الدمج المستقبلي مع نظام القتال

الخطوات التالية بعد اعتماد الجودة فقط. اللعبة اليوم لا تحمّل المحرك.

1. **التحميل:** أضِف `vfx/sin-vfx.js` كبقية الوحدات. أنشئ المحرك بعد إنشاء الـrenderer. استدعِ `prewarm()` ضمن شاشة تحميل المواجهة، داخل ميزانية التجهيز الحالية (`zone-streamer`).
2. **حلقة الرسم:** في المواجهة يحل `vfx.render()` محل `renderer.render(scene, camera)`، ويُستدعى `vfx.update(dt)` بعد تحديث الشخصيات. في مستوى Low يرسم المحرك بالمسار الأمامي (forward)، فلا يغيّر طريقة الرسم.
3. **سين:** يطلق `sin-hero.js` أحداثه عبر `hero.events.on(name, fn)`. الربط المقترح:

   ```js
   vfx.registerRig('sin', { sockets: { axe_edge }, rails: { axe: axeRails } });
   let trail = null;
   hero.events.on('combat:attack', ({ key }) => {
     trail && trail.stop();
     trail = vfx.play(key === 'finH' || key === 'finJ' ? 'SIN_AXE_HEAVY_TRAIL' : 'SIN_AXE_COMBO_TRAIL', { rig: 'sin', timeLocked: true });
   });
   hero.events.on('combat:hit', info => vfx.impact({ weapon: 'axe', surface: target.surface, position: info.point, normal: info.dir.clone().negate(), strength: info.heavy ? 1.4 : 1 }));
   hero.events.on('combat:land', () => vfx.play('SIN_AXE_FINISHER', { position: groundUnder(axeEdge), normal: [0, 1, 0], direction: facing }));
   ```

   - نافذة الإصابة ولحظة الارتطام تأتيان من `SinHero.CONFIG.ATTACKS`، وهي نفسها المستخدمة في المختبر.
   - `combat:hit` يعطي نقطة الإصابة الحقيقية من تصادم الفأس.
4. **الحارس:** أوقِف الآثار وأطلِق الاصطدامات من نوافذ `vfx/data/guardian-combat-events.json`.
   - الحقول المستخدمة: `active` و`impact` و`contact` و`takeoff` و`landing`.
   - إن أُضيف ملف التوقيتات المعتمد `Guardian_Combat_Animations.json`، يقرؤه المختبر قبل القياس، فيُعتمد هو.
   - الضربات متعددة المراحل (`impactAt`) تبدأ عند `impact - impactAt`، فتقع ذروتها على إطار الارتطام تماماً.
5. **الضرر والتصادم:** المحرك بصري فقط. لا يقرر الإصابة ولا الضرر، ولا يغيّر توقيت أي منطق. يكفي نظام التصادم أن يمرّر للمحرك:
   - موضع الإصابة.
   - اتجاه السطح ونوع مادته (`surface`).
   - سرعة السلاح.
6. **الأداء:**
   - في وضع `auto`، يخفض المحرك كثافة الجسيمات الثانوية وحدها عند ضغط الإطارات. لا يغيّر التوقيت ولا البرامج.
   - عدد الأضواء ثابت منذ الإنشاء، فلا تُعاد ترجمة مواد المشهد.

## 6. المختبر

- الرابط: `vfx-lab.html`، ويُفتح أيضاً من وضع المطور بزر «مختبر المؤثرات».
- `?quality=high|medium|low|auto`: مستوى الجودة.
- `?effect=ID`: يشغّل مؤثراً عند الفتح.
- `?clean=1`: يخفي الواجهة.
- `?measure=1`: يعيد قياس توقيتات الحارس.

الاختصارات:

| المفتاح | الوظيفة |
| --- | --- |
| Space | إيقاف أو استكمال |
| `.` | إطار للأمام |
| `,` | إطار للخلف (إعادة محاكاة حتمية) |
| R | إعادة التشغيل |
| L | التكرار |
| Enter | تشغيل المؤثر المحدد |
| C | إخفاء الواجهة |
| WASD وQ/E | الكاميرا الحرة |

النقر على الأرضية أو الجدار يحدد موضع المؤثر واتجاه السطح ونوعه.

## 7. الفحص

```bash
node --test tests/vfx-engine.test.cjs
node static-server.mjs &
THREE_DIR=…/node_modules/three node tools/vfx/lab-check.cjs --mode smoke --out vfx-check
THREE_DIR=…/node_modules/three node tools/vfx/lab-check.cjs --mode perf  --out vfx-check
THREE_DIR=…/node_modules/three node tools/vfx/lab-check.cjs --mode video --size 800x450 --fps 24 --out vfx-check
```
