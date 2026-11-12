# Outdoor LODs

Baked with meshopt (`simplify` / `simplifyWithAttributes` / `simplifySloppy`) from the **original** GLBs, which are not modified:

- `assets/babylonian_wall.glb` (50,680 tris → near 9,414 / mid 1,343 / far 191)
- `assets/grass_tuft_a.glb`, `assets/grass_tuft_b.glb` (LOD0 10,268 → 1,799; LOD1 4,023 → 700; LOD2 1,514 → 137 / far 53)
- `assets/palm_new.glb` high-poly leaves (20,864 → 6,499, etc.)

Errors were kept tight (typically 0.005–0.02). `outdoor-perf.js` swaps these geometries at runtime and also occludes vegetation behind the processional-way walls. Visuals are verified with SSIM at gameplay camera stations.

To rebuild (dev only, not a game dependency):

```
node /tmp/bake-outdoor-lod2.mjs
```

The bake script lives outside the shipped game; only this JSON is loaded at runtime.
