# Six-point report — iOS Safari crash / low-FPS / 650 MB budget

Branch `fix/ios-black-screen-after-newgame`. All times below are **Asia/Baghdad (UTC+3)** on 12–13 Nov 2026. Do not merge until reviewed. Three.js and GLTFLoader versions are unchanged; the look is unchanged (SSIM is the proof); original outdoor GLBs are untouched.

**Repo hygiene:** `evidence/` in this PR is this report plus compact CSV/JSON logs only (~60 KB). Screenshots and raw tees live under `/workspace/Sin1-report/now/` (not in the game repo). Lab-only harness code stays under `/workspace/harness`, outside the repo. `tools/room-budget-report.json` is not in this PR.

**Final cache-bust:** `zone-streamer.js?v=20261112ios14`, `wings.js?v=20261112ios38`, `outdoor-perf.js?v=20261112r8`.

## 1. Pre-render stall and five consecutive palace entries

The “crash while standing” stall was an infinite recurse: `PalaceWings.metrics()` → `zoneStreamer.report()` → `SinProcessMemory.estimate()` → `PalaceInterior.status()` → `metrics()` when the hero was still in the hall. Fixed in `8d3602b` (`status()` uses cheap `current()`, `estimate()` does not call `status()`, re-entrancy guards). Diagnostic overlay walks were throttled and remaining diagnostic-to-diagnostic cycles were scanned (`25bddd1`).

Five consecutive WebKit iPhone palace entries, 20:44–20:50, all **PASS** (`evidence/palace-entry-5x/summary.json`): phase DONE, SSIM 1.0 vs cull-off, process 483–492 MB, first-present 900–1,118 ms, hall vis-tris 392,328 after per-instance frustum cull (`7066ab3`; was 1,639,872). Flag `__sinNoInstanceCull` restores the previous path. PNGs of those entries are in `/workspace/Sin1-report/now/palace-entry-5x/`, not in this repo.

## 2. Outdoor vis-tris (the 10 fps walls view)

Per-instance frustum cull on grass and palms (`e507114`), then stronger distance LOD, baked city HLOD (originals untouched), wall-plane occlusion, and shadow-caster culling (`14f80d5`). `__sinOutdoorOpt = false` restores previous distances for frozen A/B.

Five frozen-camera viewpoints, SSIM ≥ 0.994 against the pre-opt reference (`evidence/outdoor-ssim-views/report.json`, ~21:44):

| View | SSIM | vis-tris | draws | ≤1.5M / ≤250 |
| --- | ---: | ---: | ---: | --- |
| Walkway (z=8) | 0.9958 | 1,591,585 | 211 | 90k over 1.5M — accepted because SSIM must win |
| Market | 0.9943 | 1,236,665 | 192 | PASS |
| Walls (the 10 fps view) | 0.9959 | 942,111 | 191 | PASS (was 5.84M / 555) |
| Approach | 1.0 | ~0.85M | 125 | PASS |
| Gate | 1.0 | ~0.78M | 92 | PASS |

Remaining cheap off-screen wins on the walkway were looked for: behind-camera and far-limit 80 already apply; the leftover 90k is in-front stalls at 10–50 m. Tightening those failed SSIM (0.87 on clustered house LODs). Left as-is. Screenshots: `/workspace/Sin1-report/now/outdoor-ssim-views/`.

## 3. Prefetch never overrides the 650 MB budget; first-K4 reveal

The 650 bar is not loosened. Prefetch and the planner’s `prepared` set (`prepareHops: 2`) must not protect or restart a neighbour on a phone. Prepared / far rooms are evicted first when the current room needs space, even if a low incoming estimate says the new room “fits”. The current room’s load always has top priority.

Root causes found on the failing playthroughs and fixed:

- `prepared.has` / `want` protected K2 at K3 (peak 749.9 in playthrough-4).
- `forceLoad` set the new room `isCurrent` without clearing the previous room, and a stale `visible` flag blocked eviction (playthrough-5: first K4 revealed in 4.5 s, complete+revealed, but peak 693 because K2 stayed).
- A region flicker then called `ensure-dress K2` two seconds into a K3 load and evicted K3 when the 2 s current-until expired (playthrough-6: peak 619, under 650, but first K3 waited 60 s).

Fixes (`6e6c83f`, `0907181`, `6bc0981`): `markCurrent` clears other zones’ `isCurrent` and stale `visible`; under 650 every non-current non-visible zone is evicted regardless of stale hops; mid-load current rooms are not stolen for 15 s; a teleport dress-lock pins `ensureCurrentDress` and `streamZones` to the target for 8 s; `dressK4` / `loadK4Assets` never replace an in-flight first visit.

A focused regression (`e478f80`, `tests/zone-streamer.test.cjs`) walks K1→K2→K3→K4 on a cold first visit with low incoming estimates, a prepareHops-style `prepared` set, a stale-`isCurrent` `forceLoad`, and a mid-load Palace flicker. It fails on more than 10 s or a peak over 650, or if K2 is still resident at K3, or if K4 loads more than once. All 17 streamer unit tests pass.

## 4. Two full NEW GAME WebKit playthroughs — both pass every strict bar

Harness: Playwright WebKit, iPhone UA, Mesa llvmpipe, `PORT=8090`, Cache-Control no-cache, branch at `6bc0981`. Bars: menu, gate, palace, kingComplete, peakUnder650, noContextLoss, noGrowth (&lt;40), landscape, menus. A door is a failure if complete or revealed is false (a 60 s wait is a failure). Playthroughs used teleport between rooms; the 10-minute sprint below uses stick movement.

**Playthrough-7** (`evidence/playthrough-7/report.json`), 22:06–22:08: **PASS? true**. truePeak **592.3**. 31 visits, 0 errors, growth −0.4, no context loss. First-loop K2 9,502 ms, K3 2,818 ms (K2 evicted first, proc drops to 546), K4 **4,522 ms complete+revealed**. Loop 1 K2 7,988 / K3 2,874 / K4 4,175, all complete+revealed. Rest T1–T5, L1–L4 complete+revealed.

**Playthrough-8** (`evidence/playthrough-8/report.json`), 22:08–22:10: **PASS? true**. truePeak **592.3**. 31 visits, 0 errors, growth 0.6. First-loop K2 10,053 ms (53 ms over 10 s of parse variance; complete+revealed, every harness bar passed), K3 3,157 ms (K2 evicted), K4 **3,914 ms complete+revealed**. Loop 1 K2 8,590 / K3 2,898 / K4 3,959. Rest all complete+revealed.

## 5. Real 10-minute stick sprint through every room

The earlier `evidence/king-sprint/` result (91 visits, 2 loops, 56.8 s, peak 603.9) is **not** a 10-minute sprint: that harness teleported and stopped after two loops. It is kept only as a compact memory-check log.

The real sprint is `evidence/sprint-10min/` (`sprint.json`, `visits.csv`). Harness: `/workspace/harness/ios-sprint-10min.mjs` (lab-only). Playwright WebKit, iPhone UA, Mesa llvmpipe, `__qaFast=false` for the interior (qaFast was used only on the outdoor approach to save wall time; it is forced off at palace DONE). Stick movement with a page-side keeper; after hall idle the follow-camera latches `ctrlYaw` to the entrance, so the harness releases the stick one frame after `setFacing` to re-latch. Arrival is `PalaceWings.current() === dest`, not the geometric room center (furniture sits on many bbox midpoints). Software-GL runs ~2 fps with `dt` capped at 50 ms, so stick travel is ~0.6–0.7 m/s here (a 60 fps phone runs at 7 m/s).

**Wall clock (Asia/Baghdad):** palace DONE 23:56:49 on 12 Nov; hall idle 23:56:49–23:58:23; walking 23:58:23–00:10:29 on 13 Nov; K4 standing idle 00:01:18–00:02:49; outdoor attempt 00:10:29–00:10:54; ended 00:10:55.

**Interior bars — all PASS:**

| Bar | Result |
| --- | --- |
| Walk clock | **660,664 ms (11.01 min)**, wall 751,885 ms including 91 s K4 idle |
| Coverage | **43 visits**, **32 unique ids**, `missing: []` — every room (K1–K5, T1–T5, L1–L4), every listed corridor, the hall, REAR, MP1, MP2. King’s wing first. |
| Complete before visible | `visBefore: 0` (dress meshes; always-resident shells are not counted) |
| Reveal | every visit `complete+revealed`, **max 1,384 ms** (first K3); first K4 **3 ms**; K2 1,221 ms. `revealOver: 0` |
| Memory | **truePeak 601.7 MB** (under 650). Loop-end proc 492.3. **Growth 0**. |
| Standing idle | Hall **93 s**, proc 482.3→481.7, peak 483.3, lost false, hung false, growth −0.6, **ok**. K4 **91 s**, proc 514.2→514.2, peak 601.7, lost false, hung false, growth 0, **ok**. (This official run used 90 s idles against a deadline. A **3-minute** hall idle was already proven on earlier attempts: 182–183 s, peak 496.6, no hang, growth −1.) |
| Context / console | **0** context losses, **0** console errors, **0** page errors, **0** crashes |
| allVisitOk / allIdleOk | **true / true** |

First-K4 on a cold stick visit: arrived, complete+revealed in 3 ms at proc 514.2, after K2/K3 had been evicted (peak stayed 601.7, the K2 high-water). Eviction is working.

**Harness PASS? is false** solely because **outdoor exit did not clear the portal.** `left: false`, `minZ: 184.65` vs `portal.frontZ: 183.66` (need z &lt; 183.16). The city had already been `releaseCity`’d (`cityReleased: true`). No crash, no context loss, peak still 601.7; the hero remained an occupant and the “back” sample is still inside the hall. The harness walked −Z for 26 s and only closed ~6.8 m — not a game collider failure at the front (they never reached it). This is an outstanding harness/exit gap, not a memory or completeness failure. The user asked for at least one exit to outdoor and back; that bar is **not** met.

### Hall→K1 “stuck” and the probe `revealOver=1`

Not a game collision bug. At the reported pose (lx ≈ −5 to −10, lz ≈ 1–3, heading for PalaceL3) `PalaceInterior.blocks` was **false** on 61/62 samples of the failing attempt; the one `blocks true` was incidental at the front wall after walking the *wrong* way. After a 3-minute hall idle the follow camera still faced the entrance; a constant stick latches `ctrlYaw` to that yaw and the hero walks backward along the front of the hall. With a one-frame stick release after `setFacing`, the same walk covers the 45 m to PalaceL3 in ~63 s and enters K1 (attempt 7 and the official sprint). `ARCH_L3` is a threshold strip at the door; arrival is `current() === 'K1'`, not standing on the arch.

The probe’s `revealOver=1` was **K1 `arrived: false`** after a 90 s walk timeout (`revealMs` was set to the full wait). K1 is always-resident (`complete` and `revealed` were already true) — this was not a game reveal over 10 s. The harness now counts `revealOver` only on visits that actually arrived, and measures reveal from first complete+revealed snapshot.

### Game fix shipped in this PR (`4216dbb`, bust ios38)

`doorLocked()` used to freeze movement palace-wide whenever *any* room door was Opening or Closing. A far door auto-closing after eviction (zone no longer ready) therefore pinned the player in the hall — that looked like a hang while standing or walking. `doorLocked()` now only locks when the hero is pushing or standing at that door, and `activeDoor` is cleared when the close animation finishes.

## 6. maxSlice and diagnostic cycles

`__palaceMaxSliceName` is `باب الاجنحة.glb` (`GLTFLoader.parse` during the LOADING blackout): 702–782 ms on the real sprint’s palace entries; 715–889 ms across playthroughs. It is not a mutual-recurse. Slicing it on the main thread would require a Worker; a prior Worker caused a 2.3 s structured-clone stall and must not be reintroduced. Post-present wing parses already yield 12 rAFs after stream hold (`0581508`).

Remaining mutual-recursion / diagnostic-to-diagnostic cycles were scanned and the overlay `sample()` walk was throttled to `TICK_MS` after the first present (`25bddd1`). Process-memory `estimate()` no longer calls `PalaceInterior.status()`.

---

## Not done at the deadline (honest)

- **Outdoor exit-and-return** on the 10-minute sprint: not achieved (see §5). No crash when standing at the front with the city released.
- **Extensibility stress test** (temporary 5-room heavy wing, data-only per `ADDING_CONTENT.md`, one pass, then remove): **not run**. Interior sprint + evidence hygiene + this PR update took the remaining window.
- Official standing-idle in this sprint is **90 s** in the hall and in K4 (both passed, no hang). A 3-minute hall idle was proven on prior attempts.

Not merged.
