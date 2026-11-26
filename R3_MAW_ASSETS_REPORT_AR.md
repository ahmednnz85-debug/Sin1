# أصول «فم الهاوية» R3: `assets/R3_MawOfTheAbyss_Assets.glb`

## المحتوى
11 أصلاً مستقلاً ومتباعداً، بالمتر، والمحور Y للأعلى والواجهة باتجاه +Z:

| الجذر | الأجزاء المنفصلة |
| --- | --- |
| `Elevator_Platform` | `_Body` و`_Socket_*` و`_Shackle_*` و`_Link_*` (لكل من الزوايا FR وBR وBL وFL) |
| `Elevator_Mechanism` | `_Drum` و`_Hub` (يدور حول Y) و`_Bracket_01..06` و`_Ring_01..06` (يتأرجح حول المسمار) |
| `Elevator_Chain` | `_Link_01..06` تشترك في Mesh واحد، وخطوة الحلقة 0.31 م في `extras` |
| `Elevator_Anchor_Upper` | `_Plate` و`_Clevis` و`_Ring` |
| `Elevator_Anchor_Lower` | `_Base` و`_Shackle` |
| `Abyss_Overlook` و`Abyss_Bridge_Ruined` و`Abyss_Mural_Fragment` و`Abyss_Cliff_Ruins` و`Abyss_Rock_Spire` و`Abyss_Rock_Formation` | Mesh مستقل لكل أصل |

- كل جزء متحرك عقدةُ محور بلا Mesh، وتحتها ابن `<name>_Geo`. يبقى تدوير المحور وتحريكه صحيحين بعد التكميم.
- مفاتيح `extras` لا تستخدم الاسم `pivot`، لأن three r187 يفسده ويجعل الموضع NaN. استُخدم `origin` بدلاً منه.

## الخامات (PBR)
6 مواد مشتركة: حجر مشذّب، وصخر عمودي، وبرونز مطروق، وأرضية المنصة، وأطلس النقوش، والجدارية.
- الأفاريز (الثيران المجنحة) ولوحة الموكب ولوحة العمود مأخوذة من الصورة المرجعية نفسها، بعد تصحيح المنظور وفرد الأسطوانة.
- محيطا الجسر والجدارية مستخرجان من قناع الصورة المرجعية.

## الضغط
- **الهندسة:** دمج الرؤوس المتطابقة وإعادة الترتيب، ثم KHR_mesh_quantization (موضع 16 بت) وEXT_meshopt_compression.
- **الخامات:** KTX2 UASTC مع Zstd وخرائط mip كاملة. تُفك على الآيفون إلى ASTC 4x4، أي بايت واحد لكل بكسل.

## الأرقام
- حجم الملف 23.9 MiB.
- الخامات في ذاكرة GPU نحو 33 MiB.
- 61.5k مثلث فريد، و18 خامة.

## التحقق
`node tools/r3-maw-shots.cjs --out <dir> --three <node_modules/three>` يحمّل الملف عبر GLTFLoader وKTX2Loader وMeshoptDecoder كما في اللعبة، ويصوّر كل أصل من 6 زوايا، منها الأعلى والأسفل، بوضعين: مُضاء وNormals.
- النتيجة: 0 أخطاء، 18 خامة مفكوكة، ولا NaN.
- المعاينة اليدوية: `tests/r3-maw-lab.html?asset=<name>`.

## إعادة التوليد
```
python3 tools/r3-maw-textures.py --ref <الصورة المرجعية> --out /tmp/maw-tex
node tools/r3-maw-assets.mjs --deps <node_modules> --tex /tmp/maw-tex
```
تحتاج الأداة إلى الحزم: `three@0.187.0`، و`@gltf-transform/*`، و`meshoptimizer`، و`ktx2-encoder`، و`sharp`.
