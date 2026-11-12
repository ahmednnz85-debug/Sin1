# Six-point report — iOS Safari crash / low-FPS / 650 MB budget

Branch `fix/ios-black-screen-after-newgame`. All times below are **Asia/Baghdad (UTC+3)** on 12 Nov 2026. Evidence lives next to this file. Do not merge until reviewed. Three.js and GLTFLoader versions are unchanged; the look is unchanged (SSIM is the proof); original outdoor GLBs are untouched.

## 1. Pre-render stall and five consecutive palace entries

The “crash while standing” stall was an infinite recurse: `PalaceWings.metrics()` → `zoneStreamer.report()` → `SinProcessMemory.estimate()` → `PalaceInterior.status()` → `metrics()` when the hero was still in the hall. Fixed in `8d3602b` (`status()` uses cheap `current()`, `estimate()` does not call `status()`, re-entrancy guards). Diagnostic overlay walks were throttled and remaining diagnostic-to-diagnostic cycles were scanned (`25bddd1`).

Five consecutive WebKit iPhone palace entries, 20:44–20:50, all **PASS** (`evidence/palace-entry-5x/`): phase DONE, SSIM 1.0 vs cull-off, process 483–492 MB, first-present 900–1,118 ms, hall vis-tris 392,328 after per-instance frustum cull (`7066ab3`; was 1,639,872). Flag `__sinNoInstanceCull` restores the previous path.

## 2. Outdoor vis-tris (the 10 fps walls view)

Per-instance frustum cull on grass and palms (`e507114`), then stronger distance LOD, baked city HLOD (originals untouched), wall-plane occlusion, and shadow-caster culling (`14f80d5`). `__sinOutdoorOpt = false` restores previous distances for frozen A/B.

Five frozen-camera viewpoints, SSIM ≥ 0.994 against the pre-opt reference (`evidence/outdoor-ssim-views/`, ~21:44):

| View | SSIM | vis-tris | draws | ≤1.5M / ≤250 |
| --- | ---: | ---: | ---: | --- |
| Walkway (z=8) | 0.9958 | 1,591,585 | 211 | 90k over 1.5M — accepted because SSIM must win |
| Market | 0.9943 | 1,236,665 | 192 | PASS |
| Walls (the 10 fps view) | 0.9959 | 942,111 | 191 | PASS (was 5.84M / 555) |
| Approach | 1.0 | ~0.85M | 125 | PASS |
| Gate | 1.0 | ~0.78M | 92 | PASS |

Remaining cheap off-screen wins on the walkway were looked for: behind-camera and far-limit 80 already apply; the leftover 90k is in-front stalls at 10–50 m. Tightening those failed SSIM (0.87 on clustered house LODs). Left as-is.

## 3. Prefetch never overrides the 650 MB budget; first-K4 reveal

The 650 bar is not loosened. Prefetch and the planner’s `prepared` set (`prepareHops: 2`) must not protect or restart a neighbour on a phone. Prepared / far rooms are evicted first when the current room needs space, even if a low incoming estimate says the new room “fits”. The current room’s load always has top priority.

Root causes found on the failing playthroughs and fixed:

- `prepared.has` / `want` protected K2 at K3 (peak 749.9 in playthrough-4).
- `forceLoad` set the new room `isCurrent` without clearing the previous room, and a stale `visible` flag blocked eviction (playthrough-5: first K4 revealed in 4.5 s, complete+revealed, but peak 693 because K2 stayed).
- A region flicker then called `ensure-dress K2` two seconds into a K3 load and evicted K3 when the 2 s current-until expired (playthrough-6: peak 619, under 650, but first K3 waited 60 s).

Fixes (`6e6c83f`, `0907181`, `6bc0981`): `markCurrent` clears other zones’ `isCurrent` and stale `visible`; under 650 every non-current non-visible zone is evicted regardless of stale hops; mid-load current rooms are not stolen for 15 s; a teleport dress-lock pins `ensureCurrentDress` and `streamZones` to the target for 8 s; `dressK4` / `loadK4Assets` never replace an in-flight first visit.

A focused regression (`e478f80`, `tests/zone-streamer.test.cjs`) walks K1→K2→K3→K4 on a cold first visit with low incoming estimates, a prepareHops-style `prepared` set, a stale-`isCurrent` `forceLoad`, and a mid-load Palace flicker. It fails on more than 10 s or a peak over 650, or if K2 is still resident at K3, or if K4 loads more than once. All 17 streamer unit tests pass.

## 4. Two full NEW GAME WebKit playthroughs — both pass every strict bar

Harness: Playwright WebKit, iPhone UA, Mesa llvmpipe, `PORT=8090`, Cache-Control no-cache, branch at `6bc0981`. Bars: menu, gate, palace, kingComplete, peakUnder650, noContextLoss, noGrowth (&lt;40), landscape, menus. A door is a failure if complete or revealed is false (a 60 s wait is a failure).

**Playthrough-7** (`evidence/playthrough-7/`), 22:06–22:08: **PASS? true**. truePeak **592.3**. 31 visits, 0 errors, growth −0.4, no context loss. First-loop K2 9,502 ms, K3 2,818 ms (K2 evicted first, proc drops to 546), K4 **4,522 ms complete+revealed**. Loop 1 K2 7,988 / K3 2,874 / K4 4,175, all complete+revealed. Rest T1–T5, L1–L4 complete+revealed.

**Playthrough-8** (`evidence/playthrough-8/`), 22:08–22:10: **PASS? true**. truePeak **592.3**. 31 visits, 0 errors, growth 0.6. First-loop K2 10,053 ms (53 ms over 10 s of parse variance; complete+revealed, every harness bar passed), K3 3,157 ms (K2 evicted), K4 **3,914 ms complete+revealed**. Loop 1 K2 8,590 / K3 2,898 / K4 3,959. Rest all complete+revealed.

## 5. King’s-wing-first sprint, enter and exit, completeness and memory

`evidence/king-sprint/`, started 22:11. The harness (`ios-sprint.mjs`) is a 10-minute cap that stops after **two** full loops (`if (loop >= 2) break`). Both loops finished in 56.8 s of visiting (plus palace entry) because every door revealed in a few seconds.

**SPRINT PASS**: `entered`, `allComplete`, `kingComplete` all true; 0 faults; 0 incomplete; no context loss; **91 visits**; 2 loops; every King’s-wing room and corridor plus Temple, Library, REAR, MP1, MP2. truePeak **603.9** (under 650). Growth 7.6. Loop-1 K2 5,279 / K3 2,017 / K4 2,551; loop-2 K2 4,461 / K3 1,863 / K4 2,471; all complete+revealed.

## 6. maxSlice and diagnostic cycles

`__palaceMaxSliceName` is `باب الاجنحة.glb` (`GLTFLoader.parse` during the LOADING blackout): 715–889 ms across these runs (sprint 761, playthrough-7 889, playthrough-8 692, palace-entry 715–780). It is not a mutual-recurse. Slicing it on the main thread would require a Worker; a prior Worker caused a 2.3 s structured-clone stall and must not be reintroduced. Post-present wing parses already yield 12 rAFs after stream hold (`0581508`).

Remaining mutual-recursion / diagnostic-to-diagnostic cycles were scanned and the overlay `sample()` walk was throttled to `TICK_MS` after the first present (`25bddd1`). Process-memory `estimate()` no longer calls `PalaceInterior.status()`.

---

Not merged. `tools/room-budget-report.json` is not in this PR.
