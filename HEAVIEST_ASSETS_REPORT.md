# Heaviest assets report (diagnostic only — nothing removed or converted)

Decoded texture MB ≈ `width × height × 4 × 1.333 / 1048576` (RGBA8 + mipmaps).
Mesh triangles are from GLB accessor index/position counts (file content; runtime instance counts may multiply these).

Live per-phase tables also print via `console.table` at `pre-teardown`, `post-teardown`, and `post-palace-build`, and are stored in `sessionStorage.sinHeaviest`.

## Outdoor / city phase (on-disk)

### Top textures (decoded estimate)

| MB | Resolution | Path |
|---:|---|---|
| 12.01 | 3768×627 | assets/skyline_ring_b.jpg |
| 12.01 | 3768×627 | assets/skyline_ring_a.jpg |
| 10.96 | 1186×1818 | assets/سجاد الاستقبال.jpg |
| 9.82 | 1067×1809 | assets/سجاد الارضية.jpg |
| 9.37 | 1920×960 | assets/sky_babylon_blood.jpeg |
| 8.00 | 1536×1024 | assets/جدار خلف عرش البطل.PNG |
| 8.00 | 1536×1024 | assets/جدار المجلس .PNG |
| 8.00 | 2086×754 | assets/سماء سين.JPG |
| 8.00 | 2172×724 | assets/جدار الخرائط.JPG |
| 8.00 | 2172×724 | assets/جدار الخرائط 2.JPG |

### Top meshes (GLB triangle totals)

| Tris | Path |
|---:|---|
| 296,741 | assets/اربع اعمده مختلفة.glb |
| 222,014 | assets/طاولة الخرائط.glb |
| 181,780 | assets/الاستقبال.glb |
| 175,536 | assets/K1_RoyalReceptionHall.glb |
| 94,359 | assets/الجدارية.glb |
| 93,824 | assets/اجتماعات .glb |
| 93,561 | assets/lion_winged.glb.glb |
| 89,735 | assets/المباخر.glb |
| 77,262 | assets/اثاث_الخرائط.glb |
| 75,137 | assets/مجموعة غراض.glb |

## Palace / hall phase (on-disk)

### Top textures (decoded estimate)

| MB | Resolution | Path |
|---:|---|---|
| 9.82 | 1067×1809 | ارضيات وسقوف/optimized/سجاد-الارضية.webp |
| 8.00 | 1672×941 | ارضيات وسقوف/optimized/k4/سقف-الخزانة.jpg |
| 8.00 | 1672×941 | ارضيات وسقوف/optimized/k4/ارضية-الخزانة.jpg |
| 8.00 | 1536×1024 | ارضيات وسقوف/optimized/جدار-خلف-العرش.webp |
| 8.00 | 1536×1024 | ارضيات وسقوف/optimized/جدار-المجلس.webp |

### Top meshes (GLB triangle totals)

| Tris | Path |
|---:|---|
| 296,741 | ارضيات وسقوف/optimized/اربع اعمده مختلفة.glb |
| 175,536 | ارضيات وسقوف/optimized/K1_RoyalReceptionHall.glb |
| 93,561 | ارضيات وسقوف/optimized/lion_winged.glb |
| 89,735 | ارضيات وسقوف/optimized/المباخر.glb |
| 84,863 | ارضيات وسقوف/optimized/k4/k4_kit_b.glb |

No assets were deleted, renamed, or re-encoded for this report.
