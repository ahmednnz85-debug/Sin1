# Palace throne-hall slots

Blockout contract for the Babylon hall. The live layout is `CONFIG` in `palaceInterior.js` (build `hall5`). Positions are stored in **hero-heights** (H). This sheet converts them with **hero = 1.8 m**, so 1 H = 1.8 m. The game measures the real hero at the door (about 1.84 m) and scales the hall to that; model files should still be authored to the meters below.

## Modeling rules

- Origin: **base center**. +Y up. The mesh sits on y = 0 and is centered on x and z.
- Forward: local **+Z**. The hall door is **−Z**. Slots that face the door are placed with `rotation.y = π`.
- `rotation.y = π/2` turns forward toward **−X** (a statue on the right wall looks at the carpet). `rotation.y = −π/2` looks toward **+X**.
- Scale is applied so the mesh height matches the slot. Do not bake the hall position into the file.
- One file is shared by every copy of that slot. Large and small lions are the **same** file, scaled apart. Same for pedestals.
- Put the authored GLB in `ارضيات وسقوف/props/<filename>`. The optimized copy the game loads is `ارضيات وسقوف/optimized/<filename>`.
- Optimize like the columns: `dedup`, `prune`, WebP textures, `meshopt`. **No decimation / no simplify.**
- Budget per file: **≤ 3 MB** and **≤ 20,000 triangles**. Whole palace payload (textures + columns + torches + throne + props) should stay **≤ 20 MB**. The game logs a warning past either limit and keeps the placeholder if a file is missing or fails.
- To swap a placeholder for the real mesh, set that slot's `glbPath` to the filename (for example `lionWinged.glb`). `null` keeps the placeholder. A missing file never fails the loading screen.

## Architecture (not a swappable prop)

| Piece | Size (at hero 1.8 m) |
|---|---|
| Hall | 25.2 m wide × 54.0 m long × 14.4 m high (14 × 30 × 8 H) |
| Carpet runner | 4.5 m wide, door to the foot of the stairs, broken by the medallion |
| Stairs | 12 rises × 0.216 m = 2.59 m rise, tread 0.576 m, width 14.4 m. Gameplay uses one smooth ramp, not 12 colliders |
| Platform | top at 2.59 m, throne centered |
| Columns | 4 prefab types, mirrored, 8 instances, height 11.43 m, on a 0.90 m plinth |
| Arch + winged disc | gold arch and a blue panel with a gold disc and wings behind the throne |

## Slots

Heights and footprints below are the **collider / target size** in meters (hero = 1.8 m). Footprint is full width × full depth, x then z, before rotation.

| id | type | count | target height | footprint | origin | facing | triangle budget | max file | filename |
|---|---|---:|---:|---|---|---|---:|---:|---|
| lionWinged | lionWinged | 4 | 3.33 m | 1.62 × 2.52 m | base center | +Z, placed at π (faces the door) | 8,000 | 3 MB | `lionWinged.glb` |
| lionWingedThrone | lionWinged | 2 | 1.98 m | 0.99 × 1.62 m | base center | same, π | same file | 3 MB | `lionWinged.glb` |
| pedestal | pedestal | 4 | 1.30 m | 2.43 × 2.16 m | base center | none (0) | 2,000 | 3 MB | `pedestal.glb` |
| pedestalThrone | pedestal | 2 | 0.65 m | 1.53 × 1.35 m | base center | none | same file | 3 MB | `pedestal.glb` |
| brazier | brazier | 10 | 1.71 m | 1.30 × 1.30 m | base center | none | 3,000 | 3 MB | `brazier.glb` |
| lantern | lantern | 5 | 1.12 m | 0.72 × 0.72 m | bottom of the body | none | 3,000 | 3 MB | `lantern.glb` |
| banner | banner | 6 | 5.49 m | 0.22 × 1.30 m | base center | cloth faces +Z; four side banners use ±π/2, two behind the throne use π | 1,500 | 3 MB | `banner.glb` |
| statueAlcove | statueAlcove | 8 | 2.97 m | 0.90 × 0.86 m | base center | +Z, then ±π/2 so each one faces the aisle | 8,000 | 3 MB | `statueAlcove.glb` |
| tableLow | tableLow | 2 | 0.76 m | 2.16 × 1.12 m | base center | none | 2,000 | 3 MB | `tableLow.glb` |
| benchCushion | benchCushion | 4 | 0.86 m | 1.12 × 2.30 m | base center | long axis along +Z | 3,000 | 3 MB | `benchCushion.glb` |
| vase | vase | 4 | 1.44 m | 0.76 × 0.76 m | base center | none | 2,000 | 3 MB | `vase.glb` |

## Where they sit (H units, hall local: door at z = 0, throne toward +z, +x to the right)

- **lionWinged** (4): on the tall pedestals, x = ±2.55 and ±2.62, just in front of the stair foot (two pairs).
- **lionWingedThrone** (2): x = ±1.42 on the small pedestals, beside the throne, on the platform.
- **pedestal** under each lion, same xz, y = 0. **pedestalThrone** on the platform top.
- **brazier** (10): five per side at x ≈ ±5.15, spaced from the front third of the hall to the stair foot. Flame is the existing torch sprite, not a light.
- **lantern** (5): hanging on the center line, body bottom near y = 6.15 H. Chain up to the ceiling. Flame sprite inside.
- **banner** (6): four on the column line (x = ±4.75, z = 11.6 and 16.6) and two flanking the winged disc.
- **statueAlcove** (8): one in each side niche, x = ±6.42, z = 8, 12, 16, 20.
- **tableLow / benchCushion / vase**: front clusters, both sides, z ≈ 1.5–4.0, x ≈ 5.05 (vases closer to the wall at x ≈ 6.18).

Collider `box` blocks the hero. `none` (lanterns, banners) does not. The staircase itself is not a wall: one ramp raises the hero with the slope so the climb does not jitter and the camera is not pushed through the steps.
