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
2. **Add it to the portal graph** in `solveLayout()` in `wings.js`, the same way K1–K5, T1–T5 and L1–L4 are defined:

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
2. **Lay out every region in `solveLayout()`.** For each room: `addRoom(rectRegion(...))`. For each corridor: `addCon(rectRegion(..., 'corridor'))`. Connect them with `door(...)` or `links.push([a, b, id])`. Connect the first corridor to the attach point so the hop graph reaches the hall. Look at the Temple (`T1`…`T5`) or Library (`L1`…`L4`) block in `solveLayout()` and copy that pattern.
3. **Shells are automatic.** `buildVisuals()` builds floors, walls and ceilings for every region in the layout. A new wing of 5 or 15 rooms does not need new shell code.
4. **Register a streamed zone only for rooms with heavy props.** Light rooms (shell only) need no `WING_ZONES` entry. Heavy rooms each get one entry as in section 1, step 4, with that room's id. Use `priority` so nearer rooms upload first (0, 1, 2, …).
5. **Doors.** Room doors on a streamed zone stay closed until that zone is `ready`. If two dress rooms are joined by a short open corridor, `streamedTargets()` already treats “one hop past a short corridor” the same way (K1-KC12 holds for K2). You do not add a special case for the new wing.
6. **You are done.** Do not change `zone-streamer.js`, `device-profile.js`, `dynamic-resolution.js`, or the memory budgets. Prefetch, eviction, the iOS-safe cache (`cacheZones` 1/0/0 on a phone), and dynamic resolution already key off the player's region. Ten more rooms far away stay `cold` and use no GPU dress memory.

**Quick check that it scaled.** After adding the wing, `PalaceWings.zones()` while you stand in the hall should not list the far rooms of the new wing as `ready` (unless they are within `prefetchHops`). Walk the wing: only the current room, its neighbours, and the prefetch window are resident. Memory after a full walk should look like a single-wing visit, not like “every new room stacked on top.”

---

## 3. Add assets to an existing room

- Load the model with `wingGLB(url, onLoad, onError)`. It gives you the serial download queue (no parallel GLB parse spikes), meshopt decoding, and texture CPU release after upload.
- Add the object through `api.add(obj)`, or call `hideUntilReady(obj)` and then `group.add(obj)` inside the existing `dressK2/K3/K4` builders.
- If the room's completeness predicate (`isComplete`) has to wait for the new asset, extend it. Otherwise the reveal can happen before the asset arrives. A late asset is then shown the moment it arrives, with its textures queued for upload, which is a small pop.

## 4. LOD

Use `THREE.LOD` (instant level switch, no cross-fade or dither) or the existing palace prop LOD in `palaceInterior.js` (`lodDistanceH`, `cullDistanceH`). Keep `cullDistanceH` at or above the room diagonal so nothing the player can see is culled by distance. Register every LOD level in the zone (add the whole `LOD` object through `api.add`). That way all levels are uploaded and compiled before the reveal, and a level switch never compiles or uploads.

## 5. Budgets and tuning

`SinZoneStreamer.create({...})` in wings.js is already filled from `SinDevice.detect()` (phone vs desktop). You normally do not touch: `uploadsPerFrame`, `uploadMsPerFrame`, `graceMs`, `cacheZones`, `maxConcurrentLoads` (1: GLB parse is the peak-RAM step on iPhone), `defaultTimeoutMs`, `maxTextureSize`.

Inspect the state with `PalaceWings.zones()`. It returns the per-zone state, pending uploads, and stats (uploads, worst upload ms per frame, compiles, reveals, evictions, CPU-released textures).

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
