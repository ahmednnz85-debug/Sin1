# دليل المطور: Sîn Developer Hub

أداة تطوير **مؤقتة** تفتح أي منطقة من اللعبة مباشرة، دون المرور بالتسلسل القصصي. اللعبة الأصلية لا تعتمد عليها، ويمكن إزالتها بالكامل في خطوة واحدة. طريقة الإزالة في آخر هذا الدليل.

## التشغيل

شغّل من جذر المستودع:

```
PORT=8080 node static-server.mjs
```

ثم افتح `http://localhost:8080/`.

- **الرابط المعتاد** يُظهر واجهة دخول قبل تحميل أي مورد من موارد العالم:
  - **بدء اللعبة**: يستدعي `init()` الأصلي، فتعمل اللعبة بقصتها الكاملة كما كانت.
  - **وضع المطور**: يفتح قائمة المناطق مجمّعة في أقسام قابلة للطي، مع بحث بالمعرّف أو الاسم.
- **الرابط المباشر** `index.html?dev=1&level=<المعرّف>` يشغّل المنطقة فوراً بلا واجهة ولا قائمة ولا قصة.
- روابط الاختبار الآلي القديمة (`startInHall` و`royalDoorTest` و`play=1`) تتجاوز واجهة الدخول، فتعمل أدوات المستودع كما كانت.

## معرّفات المناطق وروابطها

### العالم الخارجي

| المعرّف | المنطقة | الرابط |
| --- | --- | --- |
| `OUT-START` | نقطة البداية (Story start) | `index.html?dev=1&level=OUT-START` |
| `OUT-GATE` | بوابة عشتار (Ishtar Gate) | `index.html?dev=1&level=OUT-GATE` |
| `OUT-MARKET` | طريق الأسواق (Market road) | `index.html?dev=1&level=OUT-MARKET` |
| `OUT-PLAZA` | ساحة القصر (Palace plaza) | `index.html?dev=1&level=OUT-PLAZA` |
| `OUT-PALACE` | مدخل القصر (Palace royal door) | `index.html?dev=1&level=OUT-PALACE` |

### قاعة العرش

| المعرّف | المنطقة | الرابط |
| --- | --- | --- |
| `HALL` | قاعة العرش (Throne hall) | `index.html?dev=1&level=HALL` |

### الجناح الملكي

| المعرّف | المنطقة | الرابط |
| --- | --- | --- |
| `K1` | قاعة الاستقبال (Reception hall) | `index.html?dev=1&level=K1` |
| `K2` | قاعة المجلس (Council hall) | `index.html?dev=1&level=K2` |
| `K3` | غرفة الخرائط (Map room) | `index.html?dev=1&level=K3` |
| `K4` | الخزانة الملكية (Royal treasury) | `index.html?dev=1&level=K4` |
| `K5` | جناح الملك الخاص (King private wing) | `index.html?dev=1&level=K5` |

### المكتبة والأرشيف

| المعرّف | المنطقة | الرابط |
| --- | --- | --- |
| `L1` | المكتبة الكبرى (Great library) | `index.html?dev=1&level=L1` |
| `L2` | الأرشيف الملكي (Royal archive) | `index.html?dev=1&level=L2` |
| `L3` | غرفة الكتبة (Scribes room) | `index.html?dev=1&level=L3` |
| `L4` | المرصد (Observatory) | `index.html?dev=1&level=L4` |

### معبد القمر

| المعرّف | المنطقة | الرابط |
| --- | --- | --- |
| `T1` | المدخل المقدس (Sacred entrance) | `index.html?dev=1&level=T1` |
| `T2` | قاعة التطهير (Purification hall) | `index.html?dev=1&level=T2` |
| `T3` | قاعة الأعمدة المقدسة (Sacred columns) | `index.html?dev=1&level=T3` |
| `T4` | الحرم القمري (Holy sanctuary) | `index.html?dev=1&level=T4` |
| `T5` | غرفة القرابين (Offering room) | `index.html?dev=1&level=T5` |

### الممرات والأروقة

| المعرّف | المنطقة | الرابط |
| --- | --- | --- |
| `KC12` | ممر الملوك (Kings corridor) | `index.html?dev=1&level=KC12` |
| `KC1` | ممر الملوك الشمالي (Kings L corridor (north)) | `index.html?dev=1&level=KC1` |
| `KC2` | ممر الملوك الجنوبي (Kings L corridor (south)) | `index.html?dev=1&level=KC2` |
| `KC3` | ممر الخرائط (Map corridor) | `index.html?dev=1&level=KC3` |
| `KC4` | ممر الخزانة (Treasury corridor) | `index.html?dev=1&level=KC4` |
| `KC5R` | الممر الخلفي (Rear approach) | `index.html?dev=1&level=KC5R` |
| `REAR` | الرواق الخلفي (Rear gallery) | `index.html?dev=1&level=REAR` |
| `TR1` | ممر المعبد الخلفي (Temple rear corridor) | `index.html?dev=1&level=TR1` |
| `TC12` | ممر التطهير (Temple corridor T1–T2) | `index.html?dev=1&level=TC12` |
| `TC23` | ممر الأعمدة (Temple corridor T2–T3) | `index.html?dev=1&level=TC23` |
| `TC34` | ممر الحرم (Temple corridor T3–T4) | `index.html?dev=1&level=TC34` |
| `TC5` | ممر القرابين (Temple corridor T3–T5) | `index.html?dev=1&level=TC5` |
| `LC2` | ممر الأرشيف (Library corridor L1–L2) | `index.html?dev=1&level=LC2` |
| `LC3` | ممر الكتبة (Library corridor L1–L3) | `index.html?dev=1&level=LC3` |
| `LC4` | ممر المرصد (Library corridor L1–L4) | `index.html?dev=1&level=LC4` |
| `MP1` | الممر القمري الأول (Moon passage 1) | `index.html?dev=1&level=MP1` |
| `MP2` | الممر القمري الثاني (Moon passage 2) | `index.html?dev=1&level=MP2` |

### المنطقة المختومة R3

| المعرّف | المنطقة | الرابط |
| --- | --- | --- |
| `R3-01` | درج السنين المدفونة (Buried Years Stair) | `index.html?dev=1&level=R3-01` |
| `R3-02` | قاعة الختم الأول (First Seal Hall) | `index.html?dev=1&level=R3-02` |
| `R3-03` | فم الهاوية (Mouth of the Abyss) | `index.html?dev=1&level=R3-03` |

## كيف تُحمَّل كل منطقة

تستخدم الأداة أنظمة اللعبة الأصلية نفسها، ولا تصنع نسخة موازية منها:

| المرحلة | ما يُحمَّل | كيف يُوضع سين |
| --- | --- | --- |
| `outdoor` | تمهيد العالم الخارجي الأصلي، ثم زر «NEW GAME» نفسه. | على نقطة الظهور، بعد البحث عن أقرب نقطة حرة باستعلام التصادم الخاص بالبطل `blocked(x,z)`. |
| `palace` | المسار السريع الموجود في اللعبة (`startInHall` و`royalDoorTest`): خارج مختصر بلا امتدادات المدينة، يُفرَّغ عند الباب كالمعتاد، ثم قاعة العرش. | `PalaceWings.teleport(id)` الأصلية: عند مدخل الغرفة ووجهه نحو مركزها. تُنتظر جاهزية الغرفة في نظام الـStreaming. |
| `r3` | مثل `palace`، ثم يعبر سين `passage-L0` عبر الانتقال الحقيقي إلى R3: تقفيل التحكم، والإظلام، وتفريغ القصر، وتركيب مرحلة R3. | R3-01 عند نقطة ظهور المرحلة. R3-02 وR3-03 بإحداثيات مرحلة R3 نفسها. |

**التنقل:**
- بين غرف القصر وقاعة العرش يتم في المكان نفسه عبر نظام الـStreaming الحالي، وهو الذي يُخرج الغرف السابقة من الذاكرة.
- أي انتقال إلى مرحلة أخرى، أو إلى R3 ومنها، يعيد تحميل الصفحة على رابط المنطقة الجديدة. بذلك يحرر المتصفح كل موارد CPU وGPU للمنطقة السابقة، ويبقى مبدأ نقطة اللاعودة في R3 كما هو.

## أدوات المطور

تظهر في جلسات المطور فقط، عبر زر **DEV** أعلى الشاشة:

| الأداة | العمل |
| --- | --- |
| قائمة المناطق | فتح القائمة والانتقال إلى أي منطقة. |
| إعادة تحميل المنطقة | إعادة تحميل الصفحة على رابط المنطقة الحالية. |
| إعادة البطل للظهور | إعادة سين إلى نقطة ظهور المنطقة دون إعادة التحميل. |
| عداد FPS | زمن الإطار وأسوأه، ودفعات الرسم، والمثلثات، والهندسات والخامات المقيمة. |
| مراقب الذاكرة | مراقب الذاكرة الأصلي في اللعبة `SinMemoryOverlay`. |
| الكاميرا الحرة | تجميد المحاكاة (`__holdSim` كما في أدوات الاختبار الحالية) وتحريك الكاميرا فقط. التحكم: WASD للحركة، وQ وE للنزول والصعود، وShift للسرعة، والسحب للنظر، وإصبعان للتحريك باللمس. عند الإلغاء تعود الكاميرا والبطل كما كانا. |
| إظهار التصادمات | خلايا حمراء حول سين حيث يرفض استعلام التصادم الحقيقي للبطل `blocked(x,z)` المرور، في الخارج والقصر والأجنحة وR3. |
| إخفاء الواجهة | إخفاء العصا وأزرار القتال والنصوص للتصوير. يبقى زر DEV باهتاً للعودة. |
| نسخ رابط المنطقة | نسخ الرابط المباشر الكامل للمنطقة الحالية. |
| الخروج من وضع المطور | العودة إلى الرابط المعتاد. |

## عزل الحفظ

في جلسات المطور (`?dev=1`) تُكتب كل قراءات وكتابات `localStorage` و`sessionStorage` تحت البادئة `sin-dev:`. وتشمل هذه الإعدادات والاكتشافات القمرية وسجلات الأعطال وعلامات الجهاز.

- جلسة المطور لا تقرأ حفظ اللاعب الحقيقي ولا تغيّره.
- الألغاز والأختام والأحداث في اللعب العادي لا تتأثر بها.
- لمسح جلسات المطور: احذف المفاتيح التي تبدأ بـ`sin-dev:`.

## الاختبار

- `node --test tests/dev-hub.test.cjs` يفحص:
  - أن السجل يغطي كل منطقة في تخطيط القصر الحقيقي.
  - الروابط.
  - توجيه التشغيل.
  - العزل.
  - مفتاح التعطيل.
  - أن ملفات اللعبة لا تعتمد على الأداة.
- `THREE_DIR=…/node_modules/three node tools/dev-hub-check.cjs --out hub-check --mode all` يفحص داخل اللعبة الحقيقية:
  - واجهة الدخول على الهاتف والكمبيوتر.
  - البدء العادي.
  - التعطيل.
  - الروابط المباشرة.
  - التنقل المتكرر بين غرف القصر.
  - عزل الحفظ.

  لروابط محددة: `--mode direct --levels K3,R3-02`.
- للوكلاء: افتح `index.html?dev=1&level=<id>`، ثم انتظر `window.__sinDev.ready === true` أو `window.__sinDev.error`.
  - `window.SinDevHub.go(id)` ينقل إلى منطقة أخرى.
  - `SinDevHub.respawn()` يعيد سين إلى نقطة الظهور.
  - `SinDevHub.tools` يتيح تشغيل الأدوات برمجياً.

## إضافة منطقة جديدة

سجّلها في `dev-hub-areas.js`، أو في أي ملف يُحمَّل بعد `dev-hub.js`:

```js
SinDevHub.register({ id: 'K6', group: 'kings', ar: 'اسم عربي', en: 'English name', stage: 'palace', spawn: { teleport: 'K6' } });
```

- `stage: 'outdoor'` مع `spawn: { x, z, yaw }` بالمتر في إحداثيات العالم الخارجي، و`yaw = 0` باتجاه +z.
- `stage: 'palace'` مع `spawn: { teleport: '<معرّف المنطقة في wing-architecture.js>' }`.
- `stage: 'r3'` مع `spawn: { u, v, y, yaw }` في فضاء مرحلة R3، أو `{ stageSpawn: true }`.
- لقسم جديد في القائمة: `SinDevHub.groups([['id', 'عربي', 'English']])`.

تظهر المنطقة تلقائياً في القائمة، ويعمل رابطها المباشر فوراً. لا تغيّر معرّفاً منشوراً، فالوكلاء والتقارير تعتمد عليه.

## التعطيل والإزالة

- **تعطيل فوري:** في `dev-hub.js` غيّر `const ENABLED = true;` إلى `false`. لن تظهر واجهة الدخول، وستعمل الروابط كلها كاللعبة الأصلية، ولن يُعزل الحفظ.
- **إزالة كاملة:**
  1. احذف `dev-hub.js` و`dev-hub-areas.js` و`tools/dev-hub-check.cjs` و`tests/dev-hub.test.cjs` و`DEVELOPER_GUIDE.md`.
  2. احذف وسمي `<script>` الخاصين بهما في `index.html`، ومعهما التعليق فوقهما.
  3. السطر الأخير في سكربت اللعبة يعمل دونهما، لأنه يستدعي `init()` الأصلي حين لا توجد الأداة. يمكن إرجاعه إلى أصله: `init().catch(e=>{$('st').textContent='حدث خطأ أثناء التحميل';showErr(e);});`
  4. لا يحتاج أي ملف آخر في اللعبة إلى تعديل.
