# Palace Wings — Verification Report

Branch: `feat/watertight-palace-wings`

Starting tag: `wings-start`

Final implementation commit: recorded in Git after this report is added.

## Delivered

- `wings.js`: data-driven Kings, Temple and Library plans, connectors, doors, wall/floor/ceiling generation, shared collider output, sealed L1 slab with eight decorative discs, round L4 floor, oculus ring and shaft, T4 raised platform steps, runtime labels and debug tools.
- `wings-test.html`: standalone harness that draws the plan, runs the validators, and performs a real Three.js geometry-build smoke test.
- `palaceInterior.js`: minimal integration, `CONFIG.useWings`, open-arch alcove removal, wing colliders, wing floor heights, wing bounds, current-region updates and culling/camera integration.
- `index.html`: minimal script hook and `?startInHall=1` real-door shortcut.

## Validator result

The current plan returns:

```json
{
  "boundaryEdges": 0,
  "visualLeaks": 0,
  "physicalLeaks": 0,
  "floorMisses": 0,
  "footprintOverlaps": 0,
  "graphMissing": [],
  "pass": true
}
```

The graph contains shortest routes from the Hall to all 14 rooms. The Three.js build smoke test creates the instanced floor/wall/ceiling meshes and feature geometry successfully in Chromium.

## Debug controls

Open the game with `?debug=1&startInHall=1`. The debug panel includes the current wing/room label. The wings control panel provides:

- Teleport selector for Hall and every room; door identifiers are also available for inspection.
- Validators button.
- Ceiling cutaway mode.
- Fullbright mode.
- Minimap with the hero marker.

## Assumptions

- Hall-local coordinates use the existing hall portal as origin, with positive `z` toward the throne and negative `x` on the hero's left.
- `R1` is the first right-hand hall arch at approximately `z=9m`; `L3` and `R3` are the deep arches at approximately `z=45m`.
- The existing hall's measured opening is used as the interface; the procedural wing door span is 4.5m and 6m high where the adjacent ceiling permits.
- All procedural materials are neutral stone and use no new image or model request.
- `useWings=false` gates all new build, collider, floor, camera and debug integration paths, preserving the previous hall behavior.

## Checks run

```text
node --check wings.js
node --check palaceInterior.js
git diff --check
Node validator execution
Chromium headless wings-test.html execution
Three.js geometry-build smoke test
```

The branch is intentionally not merged into `main`.
