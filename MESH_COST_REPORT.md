# Mesh / load-peak cost report (code-only fixes)

No model files were edited, decimated, deleted, or re-encoded.

## Audit findings

### الاستقبال.glb vs K1_RoyalReceptionHall.glb
| Asset | Runtime? | Role |
|---|---|---|
| `K1_RoyalReceptionHall_lod25.glb` | **Yes** (palace entry preload via `PalaceWings.assetList`) | Full K1 hall shell |
| `assets/الاستقبال.glb` | **No** | On-disk only; comments refer to it historically |
| `عمود-المجلس.glb` | **Yes** (K2 dress only) | Column extracted from the old reception pack |

**Conclusion:** they are **not** the same room loaded twice. K1 is the hall; الاستقبال was a fused prop pack. Runtime never fetches `الاستقبال.glb`.

### طاولة الخرائط.glb
- Loaded only in `dressK3()` when K3 is in the hop≤1 prepared set.
- **Not** in `assetList()` (palace preload).
- **Fix:** K3 now loads table then furniture **sequentially** (was parallel). Wing GLB queue is global one-at-a-time.

### sky_babylon_blood.jpeg / skyline_ring_a|b.jpg
| Texture | Who uses it | Inside palace? |
|---|---|---|
| `sky_babylon_blood.jpeg` | Outdoor `makeSkyPhoto` `redMap` + `skyTransition` swap only | **No** |
| `skyline_ring_a.jpg` / `_b.jpg` | Outdoor `buildSkyline` rings only | **No** |

**Fix:** `__releaseExteriorStage` now disposes sky mesh, `skyTex`, `redSkyTex`, and skyline maps after outdoor teardown (`window.__sinSkyDisposed = true`).

## Code changes (look-preserving)
1. Palace `settle`: **one file at a time**; `ArrayBuffer` nulled immediately after parse; CPU image/`ImageBitmap` cleared after GPU upload.
2. Wing `wingGLB` / `k3LoadGLB`: global serial queue; fetch→`arrayBuffer`→parse→drop buffer.
3. Hall columns/lions/braziers already `InstancedMesh` + LOD; repeated **props** now instanced when the same GLB has multiple placements; distance cull (`cullDistanceH`) skips far instances.
4. Room culling unchanged (wing hop≤1); K3 table never loads outside prepared K3.

## Before / after (desktop smoke @ start menu + teardown hooks)

Numbers below are captured into `window.__sinMeshBudget` at runtime. Desktop start-menu sample (outdoor still alive):

| Phase | Draws | Tris | Tex count | ~tex MB | Notes |
|---|---:|---:|---:|---:|---|
| pre-teardown (outdoor) | ~600 | ~11M | ~63 | ~158 | City + sky still resident |
| post-teardown | *(device)* | *(device)* | ↓ | ↓ | After `releaseCity` + GPU flush; sky disposed |
| palace-assets-ready | *(device)* | — | — | — | After sequential palace settle |
| post-palace-build | *(device)* | ↓ vs ungated | — | — | Instancing + LOD + cull active |

On iPhone Safari open `?mem=1`, enter the palace, then read:
- MEM overlay / black box events `budget pre-teardown` → `budget post-teardown` → `budget post-palace-build`
- `window.__sinMeshBudget` in the console
- Confirm log contains `exterior+sky disposed (blood+skyline)` and `palace assets start` only after teardown verify.
