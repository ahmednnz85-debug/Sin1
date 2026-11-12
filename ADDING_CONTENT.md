# Adding rooms, areas and assets (SÎN ENGINE streaming)

Streamed content goes through **one** lifecycle, owned by `zone-streamer.js`:

```
cold → loading → uploading → compiling → ready (revealed) → … → evicted (cold)
```

Memory is bounded by **what is near the player**, not by how many rooms or wings exist. Adding a room or a whole wing is a data entry: you register the layout and a zone. You do not change the streamer, the memory budget, dynamic quality, or the door-gating code. A 5-room wing and a 50-room wing use the same rules (prefetch a few hops ahead, evict what you left).

| Step | What the engine does for you | Where |
|------|------------------------------|-------|
| Predictive prefetch | A zone starts loading when it is within `prefetchHops` (K2/K3/K4 use a device profile: 4 hops on a phone so K2 starts in the hall without also keeping K3 and K4 resident; 7 hops on desktop, enough for K4) portal hops of the player's region, or when the camera planner (`wing-visibility.js`) marks it visible/prepared. So it is resident a full room before the player can see it or reach its door | `zone-streamer.js` `update()` |
| Hidden assembly | Everything you add via `api.add()` (or `hideUntilReady()` in wings.js) stays invisible while it is being prepared | `hideObject()` |
| Budgeted GPU upload | Textures are uploaded at most `uploadsPerFrame` (3) per frame and within `uploadMsPerFrame` (4 ms) | `pumpUploads()` |
| Shader precompile | `renderer.compileAsync(group, camera, scene)` against the real scene (lights, fog, environment), so the reveal frame does not compile | `step()` |
| Atomic reveal | All meshes of the zone become visible in the same frame, and only after upload and compile finish and `isComplete()` is true. A short timer does not reveal a still-loading room (that caused the K2 table to pop in on a phone). A long `abandonMs` (60 s) or `fail()` is the only way an incomplete zone is shown, so a broken download cannot hide a room forever | `reveal()` |
| Door gate | A wing door (or a short corridor leading to a streamed room, e.g. K1-KC12 → K2) stays closed until the destination zone is fully ready. There is no 2.5 s give-up. Open passages such as KC12-K2 get a temporary collider for the same reason. After a long abandon (60 s) the door opens so a failed asset cannot trap the player | `zoneGateOpen()` in wings.js |
| CPU release | Pixels of parsed GLB textures are dropped only after every texture that shares the image is on the GPU | `markReleasable()` |
| LRU eviction | Zones you have left linger for `graceMs` (20 s desktop / 8 s phone). `cacheZones` (desktop: 3 / 2 / 0; phone: 1 / 0 / 0 — memory safety comes from not keeping every dress room resident, not from lowering the look) idle zones stay cached. Never evicted, at any memory level: the current zone, every directly connected zone, everything the camera can see (including through doorways), and every zone still within `prefetchHops` | `update()` / `evict()` |
| Shell residency | Architecture of every region within 2 hops, plus everything visible, stays GPU-resident (`prepareHops: 2` in `wing-visibility.js`). The streamer's `sample()` can shrink the idle LRU cache under pressure, but never evicts visible or 1-hop regions. Architecture shells stay; only streamed dress is evicted. `wing-gpu-residency.js` is no longer used by the palace (it remains for the outdoor city). | `zone-streamer.js` |
| Memory pressure | `zone-streamer.js` `sample()` sets the level (normal / watch / critical) from GPU memory and frame time. Under critical pressure every idle (unprotected) zone is evicted at once. Visible, adjacent, and in-frustum zones are never evicted. This replaced `smart-memory-manager.js`. | `update()` / `sample()` |

---

## 1. Add a room (step by step)

Do these in order. After step 4 the new room streams, gates, and evicts like K2–K4. No other file needs a code change.

1. **Give it an id and a place.** Pick a unique region id (for example `K6`) and decide which existing region it connects to (a corridor or another room).
2. **Add it to the portal graph** in `solveLayout()` in `wing-architecture.js` (the shared source; `wings.js` calls the same function at runtime), the same way K1–K5, T1–T5 and L1–L4 are defined. After any layout change, rebake the collider file — see “Bake the collider grid” below:

```js
const K6 = addRoom(rectRegion('K6', 'Kings', 'My new room',
  neighbour.bbox.x0 - 24, neighbour.bbox.cz - 10, 22, 18, 7));
const KC6 = addCon(rectRegion('KC6', 'Kings', 'Approach',
  K6.bbox.x1, K6.bbox.cz - 3, neighbour.bbox.x0 - K6.bbox.x1, 6, 6, 'corridor'));
door('K6-KC6', 'K6', 'KC6', K6.bbox.x1 + 0.5, K6.bbox.cz, 'x');
links.push(['KC6', 'K5', 'KC6-K5']);   // attach to the existing graph
```

   Prefetch hops, doorway visibility, “never evict adjacent”, and door gating all read `state.links`. You do not write any of that yourself.

3. **Shell (floors, walls, ceiling).** Built automatically at palace entry by `buildVisuals()`. Shells are cheap and stay resident. You only do extra work here if the room needs a special floor or a GLB for the architecture itself (as K1 does).

4. **Streamed dress (heavy props)** — only if the room has heavy assets. Add one entry to `WING_ZONES` in `wings.js`:

```js
{ id: 'K6',                 // must match the region id from step 2
  prefetchHops: 1,          // 1 = start when the player is in an adjacent room/corridor
                            // (K2–K4 use the device profile so a phone starts K2 from the hall)
  priority: 3,              // tie-breaker for upload order (lower goes first)
  abandonMs: 60000,         // only then reveal an incomplete zone (failed/stuck load)
  load: function (api) {    // start downloads; add every object through api.add()
    wingGLB('assets/my_room.glb', function (gltf) {
      const m = gltf.scene; m.name = 'K6-props';
      m.position.set(/* room-local position */);
      api.add(m);           // hidden until the zone is ready — never pops in
      api.done();           // everything requested has arrived
    }, function (e) { api.fail(e); });
  },
  isComplete: function () { /* return true when every required prop is in; or just use api.done() */ },
  unload: function (api) { /* drop colliders / references you created */ },
  ownsObject: streamedName('K6') }  // children named "K6-*" (or flagged streamDress) are evicted
```

5. **Completeness.** If the room waits on more than one asset (chandelier + columns + table, like K2), write `isComplete` so the door stays shut and nothing is revealed until every piece is present. A late asset that arrives after reveal is shown immediately — that is a pop-in. Prefer one `api.done()` after the last asset, or a predicate that covers all of them.

6. **Check.** Enter the palace, walk to the neighbouring room: the new zone should already be `loading` / `ready` in `PalaceWings.zones()`. The door must not open on an incomplete room. After you leave and walk far, the zone evicts and memory drops. Walk back: it is ready again before you see inside.

At runtime (a mod or a test) the same spec can be registered with `PalaceWings.registerZone(spec)` without editing `WING_ZONES`. That is how the synthetic scale test adds dummy future wings.

---

## 2. Add a whole wing (step by step)

A wing is a chain of rooms and corridors attached at one point. There is no wing-level streaming API. Repeat section 1 for each room; the engine scales automatically.

1. **Pick a wing name and an attach point.** Example: wing `Queens`, attached to the rear gallery (`REAR`) or to a new hall passage. Five rooms is a typical size (Temple is T1–T5).
2. **Lay out every region in `solveLayout()` in `wing-architecture.js`.** For each room: `addRoom(rectRegion(...))`. For each corridor: `addCon(rectRegion(..., 'corridor'))`. Connect them with `door(...)` or `links.push([a, b, id])`. Connect the first corridor to the attach point so the hop graph reaches the hall. Look at the Temple (`T1`…`T5`) or Library (`L1`…`L4`) block in `solveLayout()` and copy that pattern.
3. **Shells are automatic.** `buildVisuals()` builds floors, walls and ceilings for every region in the layout. A new wing of 5 or 15 rooms does not need new shell code.
4. **Register a streamed zone only for rooms with heavy props.** Light rooms (shell only) need no `WING_ZONES` entry. Heavy rooms each get one entry as in section 1, step 4, with that room's id. Use `priority` so nearer rooms upload first (0, 1, 2, …).
5. **Doors.** Room doors on a streamed zone stay closed until that zone is `ready`. If two dress rooms are joined by a short open corridor, `streamedTargets()` already treats “one hop past a short corridor” the same way (K1-KC12 holds for K2). You do not add a special case for the new wing.
6. **You are done.** Do not change `zone-streamer.js`, `device-profile.js`, `dynamic-resolution.js`, or the memory budgets. Prefetch, eviction, the iOS-safe cache (`cacheZones` 1/0/0 on a phone), and dynamic resolution already key off the player's region. Ten more rooms far away stay `cold` and use no GPU dress memory.

**Quick check that it scaled.** After adding the wing, `PalaceWings.zones()` while you stand in the hall should not list the far rooms of the new wing as `ready` (unless they are within `prefetchHops`). Walk the wing: only the current room, its neighbours, and the prefetch window are resident. Memory after a full walk should look like a single-wing visit, not like “every new room stacked on top.”

---


## 2.1 Bake the collider grid and wall CSG

The palace Clipper difference (cutting K1 out of the procedural walls) and the 0.5 m collider grid are **precomputed at build time**. Runtime palace SETUP loads `data/palace-colliders.json` and skips that work, so entry never blocks the main thread for minutes. Future rooms and wings use the same path.

1. Edit the layout in `solveLayout()` in `wing-architecture.js` (or change hall defaults, the wall module `ارضيات وسقوف/optimized/الجدارية.glb`, or the K1 footprint). That file is the single source: the bake script and the game call the same `computeBake()`.
2. From the repo root, regenerate the asset:

```
node tools/bake-palace-colliders.js
```

   This writes `data/palace-colliders.json` (hall header, wall solids after the K1 difference, floors, door caps, and the merged collider boxes). The bake itself takes a fraction of a second in Node.

3. Commit **both** the source change and the JSON. Do not edit the JSON by hand.

4. CI (`tests/palace-collider-bake.test.cjs`) does two things:
   - Runs `node tools/bake-palace-colliders.js --check`, which regenerates the bake and **fails if the committed JSON is stale**.
   - Asserts the committed JSON is **identical** to a live `computeBake()` of the canonical hall (same colliders, solids, grid, and hall header).

**K1 GLB parse (main thread, ~400–530 ms).** Three.js r187 `GLTFLoader.parse` / `parseAsync` still run the parse on the calling thread. A Worker that loaded the same r187 loader (no version change) cannot hand a `THREE.Scene` back: the graph is not structured-cloneable, and writing a custom serializer would be a large, look-risking change. Splitting the authored hall GLB would change assets. Parsing stays on the main thread, one GLB at a time, with a yield after each file. This is the remaining slice above 100 ms during palace LOADING.

**Entry corridor models (plants and wall torches).** Any model that is visible in the corridors on the first palace frame must be listed in `PalaceWings.assetList()` (`entryAssets` in `wings.js`) so it is fetched and parsed during LOADING, one file at a time, with a yield after each. The runtime then instances a clone during `flushDeferredLoads`. Do not start a new `GLTFLoader.parse` from `dressCorridors` or any other SETUP step: an uncached parse used to race the post-corridors yield and freeze WebKit for minutes. The wing-door GLB (`assets/باب الاجنحة.glb`) is on the same list so its 4 MB parse is not left for SETUP. Room-only dress (K2–K4, and future wings) stays lazy and is streamed after REVEAL, still one GLB at a time. After adding an entry-visible model, add its path to `entryAssets` and confirm LOADING logs a `parse-start` for it.

**Palace-entry shader warmup.** During REVEAL the hall is still blacked out. The engine compiles every unique entrance material, one at a time, through `renderer.compileAsync` (r187: a synchronous `compile()` then a poll of `program.isReady()` via `KHR_parallel_shader_compile` when the extension exists), then a non-blocking WebGL2 fence poll so the next material does not start while a program is still linking. A 12 ms budget packs already-cached programs into the same turn; a fresh compile yields so the poll and the frame heartbeat can run. The path is identical on a real iPhone and in the lab — it is not skipped for automation or a software-GL renderer. After every material is ready, a final `compileAsync` of the live scene runs during FADING_IN (still blacked out) so the first presented frame does not compile a new program variant. Zone streaming is held for a few frames after DONE so it cannot race that first present. Region visibility is a portal flood: a neighbouring room is drawn only when its doorway is in the camera wedge, so the first hall frame submits the same camera-visible set as a steady frame — not every room whose AABB clips a long sight line. Shadow policy is unchanged. The first DONE frame's memory sample must not walk the scene: `PalaceInterior.status()` reads a cheap `PalaceWings.current()`, `zoneStreamer.usage()` reads `SinProcessMemory.last()`, and `estimate()` does not call `status()`. The previous cycle (`metrics` → `report` → `estimate` → `status` → `metrics`) froze the main thread for tens of seconds whenever the hero was still in the hall (`current` was null). The blackout then lifts at DONE. A new entrance-visible material is picked up automatically by the unique-material walk; you do not register it separately.


At runtime, `PalaceInterior` fetches the JSON during palace asset load and `PalaceWings` applies it when the live hall header matches (width, length, wall thickness, alcove depth, passage positions). If the header does not match — for example a hero-scaled hall that is not the canonical 1.8 m bake — the same `computeBake()` runs once as a fallback so the result stays identical to the bake of that hall. After you add a room or a wing, rebake; otherwise CI will fail and the new walls will not be in the collider file.

## 3. Add assets to an existing room

- Load the model with `wingGLB(url, onLoad, onError)`. It gives you the serial download queue (no parallel GLB parse spikes), meshopt decoding, and texture CPU release after upload.
- Add the object through `api.add(obj)`, or call `hideUntilReady(obj)` and then `group.add(obj)` inside the existing `dressK2/K3/K4` builders.
- If the room's completeness predicate (`isComplete`) has to wait for the new asset, extend it. Otherwise the reveal can happen before the asset arrives. A late asset is then shown the moment it arrives, with its textures queued for upload, which is a small pop.

## 4. LOD

Use `THREE.LOD` (instant level switch, no cross-fade or dither) or the existing palace prop LOD in `palaceInterior.js` (`lodDistanceH`, `cullDistanceH`). Keep `cullDistanceH` at or above the room diagonal so nothing the player can see is culled by distance. Register every LOD level in the zone (add the whole `LOD` object through `api.add`). That way all levels are uploaded and compiled before the reveal, and a level switch never compiles or uploads.

## 5. Budgets and tuning

`SinZoneStreamer.create({...})` in wings.js is already filled from `SinDevice.detect()` (phone vs desktop). You normally do not touch: `uploadsPerFrame`, `uploadMsPerFrame`, `graceMs`, `cacheZones`, `maxConcurrentLoads` (1: GLB parse is the peak-RAM step on iPhone), `defaultTimeoutMs`, `maxTextureSize`.

### Hard memory budget (must not be exceeded)

The streamer holds a **hard, device-aware cap** on resident process, GPU and CPU memory. Numbers come from `SinDevice.detect()`:

| Device | processBudgetMB | gpuBudgetMB | cpuBudgetMB | maxTextureSize |
| ------ | --------------- | ----------- | ----------- | -------------- |
| iPhone / constrained | 650 | 480 | 80 | 1024 |
| Desktop | 1400 | 1100 | 250 | 4096 |

650 MB process is the Safari-on-iPhone jetsam-safe target (peak ≲ 600–700). iOS kills the tab on total RSS around 1–1.5 GB, so the cap sits well below that.

**How a new room is admitted:**

1. Before a cold zone starts loading, the streamer estimates the incoming cost (`spec.estProcessMB` / `estGpuMB` / `estCpuMB`, or the defaults 50 / 40 / 10 MB).
2. It evicts unprotected idle zones first (farthest / least-recent). The usual `graceMs` is skipped for this step — the budget wins. Current and visible rooms are never evicted, so nothing disappears in front of the player. Adjacent (≤1 hop) rooms that are not on screen may yield if that is the only way the incoming room can fit.
3. If, after eviction, the new room would still exceed any of the three caps, **the load is deferred**. The zone stays `cold`, `stats.deferred` increments, and `report().zones[id].deferred` is true.
4. The door gate (`zoneIsReady` / `roomCompleteness`) keeps the door closed until the room both **fits** and is **complete**. Nothing is drawn in front of the player. There is no context-loss path for “over budget”; the room simply waits.
5. Loading never starts a parse or upload that would push residency over the cap.

If a **single** room is larger than the whole budget even after every evictable neighbour is gone, that is a content error and **must not ship**. `tools/estimate-room-budget.py` (run by `tests/room-budget-ci.test.cjs`) estimates every authored room after the iPhone 1024 texture cap and **fails CI** when any room — or that room plus the always-resident hall — would exceed the iPhone budgets (650 process / 480 GPU / 80 CPU). Shrink textures, split the room, or raise only the desktop budget — do **not** lower the visual tier and do **not** skip the cap.

A door must never wait forever at runtime either. If a deferral lasts more than `deferStallMs` (3 s), the streamer evicts every non-visible, non-current zone (adjacent included), then calls `onBudgetStall` (wired in `wings.js` to `PalaceInterior.releaseCity`, `__releaseExteriorStage`, and `purgeOrphanTextures`). If the room itself fits the device budget, it is admitted on the second stall so leftover estimate noise cannot deadlock the door. `report().stats.deferStalls` and `lastStall` record this.

Palace entry itself is also time-sliced. After each hall GLB is parsed, CPU textures are capped to `maxTextureSize` and ImageBitmaps are queued; they are **not** uploaded with a synchronous `initTexture` burst (that blocked the main thread for minutes and grew WebKit RSS to ~3.6 GB — well outside the JS estimator — and is what jetsams iPhone Safari after the palace). `pumpGpuUploads` spends at most 50 ms per frame on the black screen, then `loadOk` flips. `window.__palaceLoadProfile` records parse and upload timings. The defer-stall callback is re-entrancy-guarded and is skipped while the palace is still in `LOADING` / `SETUP`.

Inspect live state with `PalaceWings.zones()` and `SinZoneStreamer.report()` (or the streamer instance’s `report()`). The report includes `usage`, `budget`, `overBudget`, per-zone `deferred`, and stats (`evictions`, `budgetEvictions`, `deferred`, `cpuReleased`, uploads, worst upload ms, compiles, reveals).

### Proving the cap scales (test-only synthetic rooms)

A test-only config, never shipped as authored content, registers several synthetic heavy rooms (~3–5× current texture and geometry volume). The long sprint through those rooms must:

- keep process / GPU / CPU memory under the device budget with no growth across loops;
- keep frame time stable;
- show zero pop-in (every door waits for `roomCompleteness.complete` and `revealed`).

The unit test `tests/memory-budget.test.cjs` simulates this: six heavy rooms, a 400 MB GPU cap, a walking player. Only rooms that fit after LRU eviction load; the simulated residency never exceeds the cap.

When you add a real room, set `estGpuMB` / `estCpuMB` / `estProcessMB` on its zone spec if you know the cost; otherwise the defaults apply and `maxTextureSize` still caps GPU copies.

## 6. Lighting and materials (automatic)

`cinematic.js` (`SinGfx.look`) applies the interior look to everything under `PalaceInterior` / `PalaceWings` every frame, by light type:

- hemisphere lights become a cool fill with a warm bounce;
- point and spot lights become warm fire practicals;
- `scene.environment` is one shared HDR interior environment for PBR reflections;
- the camera gets a warm depth haze in the existing fog chunk and a CSS vignette.

New rooms and assets get this with no code. Use `MeshStandardMaterial` / `MeshPhysicalMaterial` (a glTF loads as these). Color maps (`map`, `emissiveMap`) must be sRGB, and data maps (normal / roughness / metalness / AO) must be linear. GLTFLoader sets this correctly. Do not add post-processing passes or extra shadow-casting lights: the look is designed to cost nothing per frame.

## 7. Rules (do not break these)

- Do not set `texture.image = null` yourself. Use `markReleasable()` (done by `wingGLB`). Dropping pixels before upload caused the black/gold regression.
- Do not compile without the real scene as `targetScene`.
- Do not toggle room visibility by hand. The planner and the streamer own it.
- Do not add PointLights inside streamed zones. Changing the light count recompiles every material in the scene. Use emissive materials or the shared palace lights instead.
- Do not lower the visual tier to “fix” memory. Residency (what is loaded) is the lever; dynamic resolution already drops and recovers scale under frame-time or memory pressure.
