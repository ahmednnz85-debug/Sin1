# Asset fidelity restore

Branch: `cursor/asset-fidelity-render-5ced` (from `main`, memory/teardown/streaming kept).

## Step 1 — full file audit
- Generator: `tools/audit-assets.mjs`
- Live page: `/assets-audit.html` (+ `assets-audit-data.json`)
- Coverage: **60 GLBs**, **57 images**, **0 parse errors** (no sampling)

## Step 2 — runtime vs file
- Live page: `/runtime-diff.html`
- 12 override classes catalogued; 60 authored high-metalness materials listed for approval
- Runtime probe: `fidelity-probe.js` → `sessionStorage.sinFidelityProbe` after palace build

## Step 3 — apply file values (this branch)
Removed inventiveness on authored GLB materials:
- `tuneGLTF` metalness/roughness clamp
- `palaceMat` metal clamp + forced DoubleSide + envMap
- Final hall traverse that stamped `palaceEnv` on every MeshStandardMaterial
- Outdoor `prep()` invented `envMapIntensity`
- Door path now uses `palaceMat` (colorSpace only)

Kept:
- Memory management / teardown / serial loads / room streaming
- `three-compat` ColorManagement=false, ×π on dir/hemi, r147 point falloff (engine units parity)
- Light-cache coalesce fixed to 32ms (fidelity of authored intensities, not new values)
- Procedural (non-GLB) hall/wing materials that are code-authored (floor plane, corridor mats, etc.)

## Broken metals (awaiting approval)
Default = file value. Many GLBs ship `metallicFactor=1` + mrMap. Without IBL they can read black.
See the table in `runtime-diff.html` — **do not apply a global soften**. Propose only per-material fixes after you review.

## Step 4 — lighting / color pipeline
Outdoor + hall light **literals unchanged from main**. Migration remains the official r147→r187 path in `three-compat.js` (not invented “better” intensities from the lighting PR).

## Step 5 — sharpness
Dynres min 0.58 / tiers unchanged from main. AUTO:LOW is mobile `detectTier`. Measure without `mem=1&perf=1`.

## Step 6 — compare
`/compare.html` lists fixed camera slots. Screenshots go in `compare-shots/`.

## Step 7 — fallback
If a zone still mismatches after this pass: **STOP**. Prepare `cursor/memory-only-r147-5ced` from old-engine main with **only** memory/teardown/streaming and no r187 / no material edits.
