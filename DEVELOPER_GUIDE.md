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
- روابط الاختبار الآلي القديمة (`startInHall` و`royalDoorTest` و`play=1`) تتجاوز واجهة الدخول، فتعمل أدوات المستودع كما كانت. لم تعد أداة المطور تستخدمها.

## معرّفات المناطق وروابطها

**القائمة ديناميكية.** يبنيها وضع المطور من سجل المناطق الأساسي `sin-areas.js`، الذي تسجّل فيه كل وحدة من وحدات اللعبة مناطقها بنفسها. قواعد التسجيل في `AGENTS.md`.

- غرف القصر وممراته يكتشفها `solveLayout()` في `wing-architecture.js` من التخطيط الفعلي.
- كل غرفة جديدة تظهر تلقائياً باسمها ومعرّفها ورابطها ونقطة ظهورها، دون أي تعديل في واجهة المطور.

لعرض القائمة الحالية:

```
THREE_DIR=…/node_modules/three node tools/list-areas.cjs --md
```

الجدول التالي هو مخرجات هذا الأمر لحظة كتابة الدليل، وهو للاطلاع فقط وليس مصدراً:

### العالم الخارجي (Outdoor world)

| المعرّف | المنطقة | المرحلة | الرابط | المصدر |
| --- | --- | --- | --- | --- |
| `OUT-START` | نقطة البداية (Story start) | outdoor | `index.html?dev=1&level=OUT-START` | index.html |
| `OUT-GATE` | بوابة عشتار (Ishtar Gate) | outdoor | `index.html?dev=1&level=OUT-GATE` | index.html |
| `OUT-MARKET` | طريق الأسواق والقناة (Market & canal road) | outdoor | `index.html?dev=1&level=OUT-MARKET` | index.html |
| `OUT-PLAZA` | ساحة القصر (Palace plaza) | outdoor | `index.html?dev=1&level=OUT-PLAZA` | index.html |
| `OUT-PALACE` | واجهة القصر الملكي (Palace front) | outdoor | `index.html?dev=1&level=OUT-PALACE` | index.html |

### قاعة العرش (Throne hall)

| المعرّف | المنطقة | المرحلة | الرابط | المصدر |
| --- | --- | --- | --- | --- |
| `HALL` | قاعة العرش (Throne hall) | palace | `index.html?dev=1&level=HALL` | palaceInterior |

### الجناح الملكي (Royal wing)

| المعرّف | المنطقة | المرحلة | الرابط | المصدر |
| --- | --- | --- | --- | --- |
| `K1` | قاعة الاستقبال (Reception hall) | palace | `index.html?dev=1&level=K1` | palace-regions |
| `K2` | قاعة المجلس (Council hall) | palace | `index.html?dev=1&level=K2` | palace-regions |
| `K5` | جناح الملك الخاص (King private wing) | palace | `index.html?dev=1&level=K5` | palace-regions |
| `K3` | غرفة الخرائط (Map room) | palace | `index.html?dev=1&level=K3` | palace-regions |
| `K4` | الخزانة الملكية (Royal treasury) | palace | `index.html?dev=1&level=K4` | palace-regions |

### المكتبة والأرشيف (Library & archive)

| المعرّف | المنطقة | المرحلة | الرابط | المصدر |
| --- | --- | --- | --- | --- |
| `L1` | المكتبة الكبرى (Great library) | palace | `index.html?dev=1&level=L1` | palace-regions |
| `L2` | الأرشيف الملكي (Archive) | palace | `index.html?dev=1&level=L2` | palace-regions |
| `L3` | غرفة الكتبة (Scribes room) | palace | `index.html?dev=1&level=L3` | palace-regions |
| `L4` | المرصد (Observatory) | palace | `index.html?dev=1&level=L4` | palace-regions |

### معبد القمر (Moon temple)

| المعرّف | المنطقة | المرحلة | الرابط | المصدر |
| --- | --- | --- | --- | --- |
| `T1` | المدخل المقدس (Sacred entrance) | palace | `index.html?dev=1&level=T1` | palace-regions |
| `T2` | قاعة التطهير (Purification hall) | palace | `index.html?dev=1&level=T2` | palace-regions |
| `T3` | قاعة الأعمدة المقدسة (Sacred columns) | palace | `index.html?dev=1&level=T3` | palace-regions |
| `T4` | الحرم القمري (Holy sanctuary) | palace | `index.html?dev=1&level=T4` | palace-regions |
| `T5` | غرفة القرابين (Offering room) | palace | `index.html?dev=1&level=T5` | palace-regions |

### الممرات والأروقة (Corridors & galleries)

| المعرّف | المنطقة | المرحلة | الرابط | المصدر |
| --- | --- | --- | --- | --- |
| `KC12` | ممر الملوك (Kings corridor) | palace | `index.html?dev=1&level=KC12` | palace-regions |
| `REAR` | الرواق الخلفي (Rear Gallery) | palace | `index.html?dev=1&level=REAR` | palace-regions |
| `KC2` | ممر الملوك الجنوبي (Kings L corridor) | palace | `index.html?dev=1&level=KC2` | palace-regions |
| `KC1` | ممر الملوك الشمالي (Kings L corridor) | palace | `index.html?dev=1&level=KC1` | palace-regions |
| `KC3` | ممر الخرائط (Map corridor) | palace | `index.html?dev=1&level=KC3` | palace-regions |
| `KC4` | ممر الخزانة (Treasury corridor) | palace | `index.html?dev=1&level=KC4` | palace-regions |
| `KC5R` | الممر الخلفي (Rear approach) | palace | `index.html?dev=1&level=KC5R` | palace-regions |
| `TR1` | ممر المعبد الخلفي (Rear temple approach) | palace | `index.html?dev=1&level=TR1` | palace-regions |
| `TC12` | ممر التطهير (Temple corridor) | palace | `index.html?dev=1&level=TC12` | palace-regions |
| `TC23` | ممر الأعمدة (Temple corridor) | palace | `index.html?dev=1&level=TC23` | palace-regions |
| `TC34` | ممر الحرم (Sanctuary corridor) | palace | `index.html?dev=1&level=TC34` | palace-regions |
| `TC5` | ممر القرابين (Offering side passage) | palace | `index.html?dev=1&level=TC5` | palace-regions |
| `LC2` | ممر الأرشيف (Archive corridor) | palace | `index.html?dev=1&level=LC2` | palace-regions |
| `LC3` | ممر الكتبة (Scribes corridor) | palace | `index.html?dev=1&level=LC3` | palace-regions |
| `LC4` | ممر المرصد (Observatory opening) | palace | `index.html?dev=1&level=LC4` | palace-regions |
| `MP1` | الممر القمري الأول (Moon Passage) | palace | `index.html?dev=1&level=MP1` | palace-regions |
| `MP2` | الممر القمري الثاني (Moon Passage) | palace | `index.html?dev=1&level=MP2` | palace-regions |

### المنطقة المختومة R3 (Sealed zone R3)

| المعرّف | المنطقة | المرحلة | الرابط | المصدر |
| --- | --- | --- | --- | --- |
| `R3-01` | درج السنين المدفونة (Buried Years Stair) | r3 | `index.html?dev=1&level=R3-01` | r3-sealed-zone |
| `R3-02` | قاعة الختم الأول (First Seal Hall) | r3 | `index.html?dev=1&level=R3-02` | r3-sealed-zone |
| `R3-03` | فم الهاوية (Mouth of the Abyss) | r3 | `index.html?dev=1&level=R3-03` | r3-sealed-zone |

## كيف تُحمَّل كل منطقة: التحميل حسب الفصل (Chapter-Based Direct Loading)

القصة سلسلة فصول، تفصل بينها نقاط لاعودة: الباب الملكي، ثم `passage-L0`، ثم مصعد فم الهاوية. كل فصل تسجّله وحدته المالكة في `sin-areas.js` بـ`SinAreas.chapter`، مع ترتيبه وحدّه ودالة البدء المباشر عنده. يُعرض السجل بـ`SinAreas.chapters()`.

الرابط المباشر يحمّل **فصل المنطقة وحده** بمحمّله الأصلي، ولا يحمّل أي فصل سابق ولو مؤقتاً.

| الفصل | ما يُحمَّل | كيف يُوضع سين |
| --- | --- | --- |
| `outdoor` | الفصل الأول، وهو تمهيد اللعبة الأصلي `init()` بكامل موارده، ثم زر «NEW GAME». | على نقطة الظهور، بعد البحث عن أقرب نقطة حرة باستعلام التصادم `blocked(x,z)`. |
| `palace` | `bootChapter()` يحمّل سين وحده ويضعه على عتبة الباب الملكي المفتوح. ثم يأخذ دخول القصر الأصلي مكانه: الإظلام، وواجهة تحميل القصر، وبناء القاعة، والكشف. لا تُطلب أي سماء ولا مدينة ولا بوابة ولا واجهة قصر. | `PalaceWings.teleport(id)` الأصلية، مع انتظار جاهزية الغرفة في الـStreaming. |
| `r3` | سين وحده، ثم `PalaceInterior.enterR3Direct()`، وهو محمّل انتقال `passage-L0` نفسه. يقرأ تخطيط القاعة من `data/palace-colliders.json` ويركّب مرحلة R3 وحدها. يبقى الستار مسدلاً حتى تكتمل المنطقة المختارة. | يصل مباشرة إلى نقطة ظهور المنطقة. R3-01 عند بداية المرحلة. |
| `u1` | المحمّل نفسه بفصل `u1`: المصعد والعالم السفلي فقط. تُحمَّل تجهيزات R3-01 إلى R3-03 خلف ستار المصعد عند أول صعود. | عند نقطة ظهور المنطقة، وU1-01 داخل المقصورة. |

**التنقل:**
- داخل الفصل الواحد يبقى سين في المكان نفسه دون إعادة تحميل: غرف القصر عبر الـStreaming الحالي، ومناطق R3 بإحداثيات المرحلة. المشي الطبيعي بين المناطق متاح كما في اللعب، ومنه المصعد بين R3-03 وU1.
- اختيار منطقة من فصل آخر يعيد تحميل الصفحة على رابطها. بذلك يحرر المتصفح كل موارد الفصل الحالي (CPU وGPU) قبل بدء الفصل الجديد، ولا يبقى مشتركاً إلا ما في ذاكرة HTTP المؤقتة، مثل ملف البطل.

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

لا تُضاف المناطق في أداة المطور. تسجّلها وحدة اللعبة المالكة في `sin-areas.js`، كما يشرح `AGENTS.md`:

- **غرفة في القصر:** تكفي إضافتها إلى `solveLayout()` واسمها العربي إلى `REGION_NAMES_AR`.
- **منطقة أخرى:** `SinAreas.register({...})` من الوحدة المالكة.
- **مرحلة (فصل) جديدة كلياً:** سجّل `SinAreas.chapter({ stage, order, boundary, boot })` من وحدتها المالكة. `boot(ctx, area)` يبدأ اللعب عند حدّها بمحمّلها الخاص. لا يتطلب ذلك أي تعديل في `dev-hub.js`، إلا إن احتاجت المرحلة صيغة نقطة ظهور جديدة.

## التعطيل والإزالة

- **تعطيل فوري:** في `dev-hub.js` غيّر `const ENABLED = true;` إلى `false`. لن تظهر واجهة الدخول، وستعمل الروابط كلها كاللعبة الأصلية، ولن يُعزل الحفظ.
- **إزالة كاملة:**
  1. احذف `dev-hub.js` و`tools/dev-hub-check.cjs` و`tests/dev-hub.test.cjs` و`DEVELOPER_GUIDE.md`.
  2. احذف وسم `<script>` الخاص بـ`dev-hub.js` في `index.html`، ومعه التعليق فوقه.
  - يبقى `sin-areas.js` والتسجيلات في وحدات اللعبة، لأنها جزء من اللعبة نفسها: سجل المناطق الموحد. لا تحمّل أي مورد، ولا تغيّر اللعب.
  - يبقى `tools/list-areas.cjs` أيضاً، لكنه يقرأ السجل عبر قائمة المطور (`index.html?dev=1`)، فيتوقف بعد إزالة الأداة. إن أردت الاحتفاظ به فاجعله يقرأ `SinAreas.list()` مباشرة.
  3. السطر الأخير في سكربت اللعبة يعمل دونهما، لأنه يستدعي `init()` الأصلي حين لا توجد الأداة. يمكن إرجاعه إلى أصله: `init().catch(e=>{$('st').textContent='حدث خطأ أثناء التحميل';showErr(e);});`
  4. لا يحتاج أي ملف آخر في اللعبة إلى تعديل.
