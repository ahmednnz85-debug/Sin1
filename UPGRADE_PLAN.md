# Engine Upgrade Plan — Curse of Babylon

## Discovery (STEP 0)

| Item | Current state |
|---|---|
| Engine on `origin/main` (2026-11-11) | **Three.js r147** via jsDelivr `<script>` tags |
| This branch target | **Three.js r187** (`three@0.187.0`) via CDN importmap |
| Bootstrap | `three-compat.js` (ES module) exposes `window.THREE` + boots legacy scripts |
| Addons | `GLTFLoader`, `DRACOLoader` from `three/addons/` (same 0.187.0) |
| Local decoders | `vendor/draco/*` (WASM), `vendor/meshopt_decoder.js` (decode-only) |
| Other | `vendor/clipper.js` (2D polygon; not Three) |
| Latest stable (npm / GitHub, 2026-11-11) | **r187 / 0.187.0** — no r188 published |

## Target

`r147` → **`r187`**. No newer stable release exists beyond r187.

This branch restores/completes the r187 upgrade (previously landed then removed from `main` by force-push), locks visual defaults to match r147, clears deprecation console noise, and applies only safe runtime performance fixes. **No asset re-encode, no KTX2, no meshopt/Draco geometry conversion.**

## Breaking changes that affect THIS codebase

| Change (migration guide) | Affects | Action |
|---|---|---|
| r152+: `outputEncoding` → `outputColorSpace`; `encoding` → `colorSpace` | `index.html`, `palaceInterior.js`, `wings.js` (many `.encoding =`) | **Keep** `three-compat.js` aliases (`encoding`/`outputEncoding`/`sRGBEncoding`) |
| r152+: `ColorManagement.enabled = true` default | whole look | **Keep** `ColorManagement.enabled = false` in `three-compat.js` (r147 look) |
| r155+: physically correct lights / intensity scale | all lights | **Keep** `* Math.PI` intensity wrap in `three-compat.js` render hook |
| r181+: `PCFSoftShadowMap` deprecated; PCF is soft | `index.html:196`, `cinematic.js:110` | Set `PCFShadowMap` only (removes console warn; same filter) |
| r185+: `DRACOLoader.setDecoderConfig()` deprecated | `palaceInterior.js` (~634,640), `wings.js` (~3073) | Remove calls (WASM is default); keep `setDecoderPath('vendor/draco/')` |
| r152+ shader chunk `encodings_fragment` → `colorspace_fragment` | sky shaders in `index.html` | Already fixed in PR #30 |
| r187: custom shaders must use `vMapUv` not `vUv` for maps | palace marble / plaza | Already fixed (`5c631ac` + PR #30) |
| Asset compression / meshopt re-bake (PR #32) | markets, kiosks, walls | **Out of scope** — violates hard rules; not applied |

## Performance (safe only, measured, one at a time)

Allowed: renderer / shadow / pixel-ratio / allocation / culling code paths.  
Forbidden: re-encoding GLBs, deleting props, changing level layout, lowering clarity silently.

1. Eliminate `PCFSoftShadowMap` path → no warn + no materials `needsUpdate` thrash when soft flag flips.
2. Keep existing shadow texel snap (`cinematic.js` `snapShadow`) — already prevents shimmer/pop.
3. Cap mobile shadow map via existing tiers (medium=1024) — do not disable shadows.
4. Do **not** merge `perf/r187-city-budget` asset cuts.

## Rollback

```bash
git checkout main
# or: gh workflow dispatch Pages from main
```

One-liner: restore `main` and redeploy Pages from `main`.
