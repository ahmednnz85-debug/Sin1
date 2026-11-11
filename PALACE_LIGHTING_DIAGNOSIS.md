# Palace lighting / black meshes — diagnosis (no code changes in this step)

iPhone findings: no crash; FPS 50–60 with dips to 24–34 on room load; doors/columns pure black; floors/walls dim; ceilings missing/black; overlay stuck on `Zone courtyard`; shadowMap OFF; scale x0.58–0.63; duplicate run-like button after entry.

## 1. Black meshes (doors / columns / props)

GLB PBR factors (optimized + assets copies):

| Asset | type | metalness | roughness | map | normalMap | emissive | mrMap | doubleSided | vertexColors |
|---|---|---|---|---|---|---|---|---|---|
| `مجسم الباب.glb` | MeshStandard (PBR) | **1.0** | 1.0 | yes | yes | none | **yes** | true | no |
| `اعمدة.glb` / lod1 | MeshStandard (PBR) | **1.0** | 1.0 | yes | yes | none | **yes** | true | no |
| `props-set.glb` | MeshStandard (PBR) | **1.0** | 1.0 | yes | yes | none | **yes** | true | no |

Runtime handling (`palaceInterior.js`):

- `tuneGLTF` / `palaceMat` only clamp metalness when `metalness >= 0.99` **and** `!metalnessMap`. Because these GLBs ship a metallicRoughness texture, the clamp is **skipped** → factor stays **1.0**.
- Door path clones materials, sets `side=DoubleSide`, but does **not** run `palaceMat` (env intensity / metal clamp).
- Final hall traverse assigns `palaceEnv` only if missing, at default `envMapIntensity=0.45`.
- `palaceEnv` exists (tiny 128×64 canvas → PMREM). No `scene.environment` after outdoor teardown.
- Wings column extract clones source material with **no envMap**.

**Verdict:** Fully metallic stone assets + weak IBL + weak hall lights → doors/columns read as pure black. Not a missing texture; metalness path + lighting.

colorSpace: albedo/emissive maps go through `srgb()` → `SRGBColorSpace` via three-compat encoding alias. ColorManagement is **disabled** (legacy r147 path).

## 2. Lights per room (before / after engine upgrade)

`engine-upgrade` and current `main` share the **same** palace light literals (no intensity edit in the r187 merge). Historical memory-bound pass already dropped hall fill before the upgrade.

| Source | Type | Intensity | Distance | Decay | Notes |
|---|---|---|---|---|---|
| Outdoor `hemi` | Hemisphere | 0.9 (created 0.55) | — | — | zeroed on city release |
| Outdoor `sun` | Directional | 2.6 | — | — | zeroed; shadows disposed |
| Outdoor `fillL` | Directional | 0.55 | — | — | zeroed |
| Hall hemi | Hemisphere | **0.18** (was ~0.65 historically) | — | — | in `PalaceInterior` group |
| Hall fill | Ambient | **0.035** | — | — | |
| Hall Point×8 (`lightCount: 8`) | Point | ~0.49–1.39 (`0.82 * clamp(fire,0.6..1.7)`), start at **0** until `buildFires` | `9*H` | 2 | fixed to braziers; `updatePalaceLights` is a no-op |
| Wings | Hemisphere only | **0.78** | — | — | **no** room PointLights (cap / budget comments) |

Cap: `CONFIG.lightCount: 8` (constraint tests). Wings deliberately add **zero** PointLights so the hall budget is not exceeded → rooms beyond brazier range are hemi-only → underlit metal meshes.

Rebuild: hall `removeGroup` clears lights; `build()` recreates. Wings `dispose()` / `build()` recreates unified ambient. **Streaming dress does not recreate lights** when a room unloads/reloads — only geometry. If hall group is rebuilt, lights return; wing ambient survives dispose of dress meshes.

### three-compat light cache (extra darkening)

`lightsFor(scene)` rate-limits dirty rebuilds to **≥1s**. New palace Hemisphere/Ambient lights can miss the cache for up to a second after add, so they **do not** receive the r147 `× π` scale applied to non-point lights during `render`. Effective hemi ≈ `0.18` instead of `~0.57` until rebuild.

## 3. Zone stuck on `courtyard`

`cinematic.js` `updateAtmo`:

- While `ctx.interior()` → **early return**; `zoneName` is **never** cleared.
- Last outdoor value is `courtyard` (from `hp.z>PL_Z0+4 && !interior`).
- HUD always prints `Zone ` + frozen `zoneName`.
- Side effects of freeze: fog / exposure / outdoor hemi·sun multipliers stop updating (good), but status lies; courtyard fog density remains.

Shadow policy: palace build forces `shadowMap.enabled = false` (intentional mobile budget). Overlay correctly shows OFF.

## 4. Ceilings / floors

- Floor: `PlaneGeometry`, `rotation.x = -π/2`, FrontSide default, `frustumCulled` default true, metalness 0, has map + optional AO + env.
- Ceiling: built via `plane()` then `rotation.x = +π/2`, metalness **0.16**, emissive `0x3a2a16@0.08`, **no DoubleSide**, **no** explicit `frustumCulled=false`, env only via final pass.
- Dim look matches underlit + remaining FogExp2 + metalness on ceiling. “Missing” can be FrontSide + wrong bbox after group placement, or simply near-black under current lights.

## 5. Dynamic scale x0.58–0.63

`SinDynamicResolution` min **0.58**, FPS-only (not triangle-aware). Room-load hitch drops FPS → scale floors; recovery is slow (`upStep 0.01` / 3s). Explains x0.58–0.63 while inside.

## 6. Duplicate “run” button

Only one `#run` in DOM. `#fight` shares the same circular bronze CSS (`#run,#fight{display:flex…}`) and sits directly above run. Shown on New Game when combat clips exist (`okCombat`). After palace entry the fight control remains — reads as a second run affordance on iPhone. No second sprint control is created in code.

## 7. Load timing (to log in Step 2)

Settle currently measures aggregate progress only. Need per-asset `downloadMs` / `parseMs` / `uploadMs` (GPU `initTexture` / first compile). Network vs parse will be visible in `sessionStorage` / console once instrumentation lands.

## Root-cause priority

1. Metalness=1 + metalnessMap bypasses clamp → black doors/columns.
2. Hall light intensities too low after outdoor sun/hemi zeroed; wings hemi-only.
3. Light-cache 1s delay skips π scale on new hemi/ambient.
4. Zone label frozen; fog not switched to an interior profile.
5. Dynres min 0.58 with no triangle floor.
6. Fight button looks like duplicate run indoors.

## Before → after (code)

| Item | Before | After |
|---|---|---|
| Door/column metalness | factor 1.0 + mrMap (clamp skipped) | soften to ~0.22 + stronger env |
| Hall hemi / ambient | 0.18 / 0.035 | 0.58 / 0.12 |
| Hall point lights | 8 always on, ~0.82×fire, dist 9H | 4 nearest active, ~1.45×fire, dist 11H + glow sprites |
| PMREM | 128×64 dim probe | 256×128 brighter + `scene.environment` |
| Light cache dirty | ≤1000 ms stale | ≤32 ms |
| Zone HUD | frozen `courtyard` | `palace` + fog×0.18 |
| Fight button indoors | visible (looks like 2nd run) | hidden |
| Dynres @ <600k tris | can sit at 0.58 | floor ≥0.85 |
| Room dress | streams in gradually | hidden until ready + compileAsync / spread uploads |
| Load timing | none | `downloadMs` / `parseMs` / `uploadMs` → `sessionStorage.sinLoadTiming` |
