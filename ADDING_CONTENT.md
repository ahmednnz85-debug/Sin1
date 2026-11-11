# Adding rooms, areas and assets (SÎN ENGINE streaming)

Streamed content goes through **one** lifecycle, owned by `zone-streamer.js`:

```
cold → loading → uploading → compiling → ready (revealed) → … → evicted (cold)
```

| Step | What the engine does for you | Where |
|------|------------------------------|-------|
| Predictive prefetch | A zone starts loading when it is within `prefetchHops` (default 2; K2/K3/K4 use 8 so they start loading as soon as the player is in the hall — a 7.15 m/s sprint then arrives on a settled first frame) portal hops of the player's region, or when the camera planner (`wing-visibility.js`) marks it visible/prepared. So it is resident a full room before the player can see it or reach its door | `zone-streamer.js` `update()` |
| Hidden assembly | Everything you add via `api.add()` (or `hideUntilReady()` in wings.js) stays invisible while it is being prepared | `hideObject()` |
| Budgeted GPU upload | Textures are uploaded at most `uploadsPerFrame` (3) per frame and within `uploadMsPerFrame` (4 ms) | `pumpUploads()` |
| Shader precompile | `renderer.compileAsync(group, camera, scene)` against the real scene (lights, fog, environment), so the reveal frame does not compile | `step()` |
| Atomic reveal | All meshes of the zone become visible in the same frame, and only after upload and compile finish (or after `timeoutMs`, so a failed download does not hide a room forever) | `reveal()` |
| Door gate | A wing door into a zone that is still preparing stays closed for up to 2.5 s | `zoneGateOpen()` in wings.js |
| CPU release | Pixels of parsed GLB textures are dropped only after every texture that shares the image is on the GPU | `markReleasable()` |
| LRU eviction | Zones you have left linger for `graceMs` (20 s). `cacheZones` (palace: 3 / 2 / 0 for normal / watch / critical memory, enough to keep K2+K3+K4 resident) idle zones stay cached. Never evicted, at any memory level: the current zone, every directly connected zone, everything the camera can see (including through doorways), and every zone still within `prefetchHops` | `update()` / `evict()` |
| Shell residency | Architecture of every region within 2 hops, plus everything visible, stays GPU-resident (`prepareHops: 2` in `wing-visibility.js`). The streamer's `sample()` can shrink the idle LRU cache under pressure, but never evicts visible or 1-hop regions. Architecture shells stay; only streamed dress is evicted. `wing-gpu-residency.js` is no longer used by the palace (it remains for the outdoor city). | `zone-streamer.js` |
| Memory pressure | `zone-streamer.js` `sample()` sets the level (normal / watch / critical) from GPU memory and frame time. Under critical pressure every idle (unprotected) zone is evicted at once. Visible, adjacent, and in-frustum zones are never evicted. This replaced `smart-memory-manager.js`. | `update()` / `sample()` |

## 1. Add a new room to the palace wings

1. **Layout / portal graph.** Add the room polygon and its links in `solveLayout()` (wings.js), the same way K1–K4 and the corridors are defined. The link list (`state.links`) is the adjacency graph. Prefetch hops, visibility through doorways, and the "never evict adjacent" rule all use it automatically.
2. **Shell.** Floors, walls and ceilings are built at palace entry by `buildVisuals()`. They are cheap and stay resident.
3. **Streamed dress (heavy props).** Add one entry to `WING_ZONES` in wings.js:

```js
{ id: 'K5',                 // the region id from step 1
  prefetchHops: 1,          // 1 = start when the player is in an adjacent room/corridor
  priority: 3,              // tie-breaker for upload order
  timeoutMs: 14000,         // reveal anyway after this long
  load: function (api) {    // start downloads; add every object through api.add()
    wingGLB('assets/my_room.glb', function (gltf) {
      const m = gltf.scene; m.name = 'K5-props';
      m.position.set(/* room-local position */);
      api.add(m);           // hidden until the zone is ready
      api.done();           // everything requested has arrived
    }, function (e) { api.fail(e); });
  },
  unload: function (api) { /* drop colliders / references you created */ },
  ownsObject: streamedName('K5') }  // children named "K5-*" (or flagged streamDress) are evicted
```

You do not need to write any visibility, residency, upload, compile, or reveal code yourself.

At runtime (for example from a mod or a test), the same spec can be registered with `PalaceWings.registerZone(spec)`.

## 2. Add assets to an existing room

- Load the model with `wingGLB(url, onLoad, onError)`. It gives you the serial download queue (no parallel GLB parse spikes), meshopt decoding, and texture CPU release after upload.
- Add the object through `api.add(obj)`, or call `hideUntilReady(obj)` and then `group.add(obj)` inside the existing `dressK2/K3/K4` builders.
- If the room's completeness predicate (`isComplete`) has to wait for the new asset, extend it. Otherwise the reveal can happen before the asset arrives. A late asset is then shown the moment it arrives, with its textures queued for upload, which is a small pop.

## 3. LOD

Use `THREE.LOD` (instant level switch, no cross-fade or dither) or the existing palace prop LOD in `palaceInterior.js` (`lodDistanceH`, `cullDistanceH`). Keep `cullDistanceH` at or above the room diagonal so nothing the player can see is culled by distance. Register every LOD level in the zone (add the whole `LOD` object through `api.add`). That way all levels are uploaded and compiled before the reveal, and a level switch never compiles or uploads.

## 4. Budgets and tuning

`SinZoneStreamer.create({...})` in wings.js accepts:
`uploadsPerFrame`, `uploadMsPerFrame`, `graceMs`, `cacheZones`, `maxConcurrentLoads` (1: GLB parse is the peak-RAM step on iPhone), `defaultTimeoutMs`.

Inspect the state with `PalaceWings.zones()`. It returns the per-zone state, pending uploads, and stats (uploads, worst upload ms per frame, compiles, reveals, evictions, CPU-released textures).

## 5. Lighting and materials (automatic)

`cinematic.js` (`SinGfx.look`) applies the interior look to everything under `PalaceInterior` / `PalaceWings` every frame, by light type:

- hemisphere lights become a cool fill with a warm bounce;
- point and spot lights become warm fire practicals;
- `scene.environment` is one shared HDR interior environment for PBR reflections;
- the camera gets a warm depth haze in the existing fog chunk and a CSS vignette.

New rooms and assets get this with no code. Use `MeshStandardMaterial` / `MeshPhysicalMaterial` (a glTF loads as these). Color maps (`map`, `emissiveMap`) must be sRGB, and data maps (normal / roughness / metalness / AO) must be linear. GLTFLoader sets this correctly. Do not add post-processing passes or extra shadow-casting lights: the look is designed to cost nothing per frame.

## 6. Rules (do not break these)

- Do not set `texture.image = null` yourself. Use `markReleasable()` (done by `wingGLB`). Dropping pixels before upload caused the black/gold regression.
- Do not compile without the real scene as `targetScene`.
- Do not toggle room visibility by hand. The planner and the streamer own it.
- Do not add PointLights inside streamed zones. Changing the light count recompiles every material in the scene. Use emissive materials or the shared palace lights instead.
