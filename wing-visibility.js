/* Camera-driven visibility & preparation planner for the palace wings.
   Pure logic (no THREE / DOM) so it can be unit-tested in Node.

   Three separate concerns:
     1. Loading     – assets are downloaded once and cached by the existing loaders.
     2. Preparation – "prepared" regions keep their GPU geometry/textures/shaders
                      resident (never disposed) so they can be drawn instantly.
     3. Rendering   – "visible" regions are the ones whose bounds intersect the
                      camera's (slightly widened) horizontal frustum within the view
                      distance, AND are reachable through open portals (door/arch
                      links) from the room the camera stands in. Rooms behind solid
                      walls with no portal path are not drawn.

   Visibility is decided by the CAMERA (position + direction), never by a
   short player-distance radius. Per-mesh frustum culling in Three.js stays on. */
(function (root) {
  'use strict';

  const DEFAULTS = {
    viewDistance: 400,     // the camera's full sight line (everything it can see is drawn)
    frustumMargin: 0.22,   // tight camera gate: do not treat side rooms as visible through walls
    prefetchMargin: 0.18,  // prepare the next doorway slightly before the hero arrives
    prefetchDistance: 6,   // start dress a few metres before the door (still hop-capped)
    nearPad: 1.25,         // only the immediate camera volume bypasses the wedge
    // Visibility reach (portal hops the camera can see through). Restored to
    // the pre-upgrade value: with 1 hop, a room seen through two doorways or
    // down a corridor was simply not drawn and popped in as the player walked.
    maxHops: 6,
    prepareHops: 2,      // visible + current + everything within 2 hops stays resident: resident a full room BEFORE it can be seen or reached
    linger: 0.45,          // pre-upgrade hysteresis; prevents flicker at doorways
    memory: 0              // no LRU in the planner — zone-streamer.js owns LRU eviction
  };

  function hops(links, startId, limit) {
    const adj = new Map();
    (links || []).forEach(l => {
      const a = l[0], b = l[1];
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b); adj.get(b).push(a);
    });
    const dist = new Map([[startId, 0]]), q = [startId];
    while (q.length) {
      const a = q.shift(), d = dist.get(a);
      if (d >= limit) continue;
      (adj.get(a) || []).forEach(b => { if (!dist.has(b)) { dist.set(b, d + 1); q.push(b); } });
    }
    return dist;
  }

  function nearestDistance(b, x, z) {
    const dx = Math.max(b.x0 - x, 0, x - b.x1);
    const dz = Math.max(b.z0 - z, 0, z - b.z1);
    return Math.hypot(dx, dz);
  }

  // Doorway between two axis-aligned rooms: the (padded) overlap of their
  // AABBs, or the shortest connecting strip if they only touch through a wall.
  function portalBox(a, b) {
    const pad = 0.75;
    let x0 = Math.max(a.x0, b.x0) - pad, x1 = Math.min(a.x1, b.x1) + pad;
    let z0 = Math.max(a.z0, b.z0) - pad, z1 = Math.min(a.z1, b.z1) + pad;
    if (x0 >= x1 || z0 >= z1) {
      const ax = Math.max(a.x0, Math.min(a.x1, (b.x0 + b.x1) / 2));
      const az = Math.max(a.z0, Math.min(a.z1, (b.z0 + b.z1) / 2));
      const bx = Math.max(b.x0, Math.min(b.x1, (a.x0 + a.x1) / 2));
      const bz = Math.max(b.z0, Math.min(b.z1, (a.z0 + a.z1) / 2));
      x0 = Math.min(ax, bx) - pad; x1 = Math.max(ax, bx) + pad;
      z0 = Math.min(az, bz) - pad; z1 = Math.max(az, bz) + pad;
    }
    return { x0: x0, z0: z0, x1: x1, z1: z1 };
  }

  // Does the AABB intersect the 2D wedge (camera at x,z looking along dir)?
  function inWedge(b, cam, halfAngle, maxDist) {
    if (nearestDistance(b, cam.x, cam.z) > maxDist) return false;
    if (cam.x >= b.x0 && cam.x <= b.x1 && cam.z >= b.z0 && cam.z <= b.z1) return true;
    const cosHalf = Math.cos(Math.min(Math.PI, halfAngle));
    const pts = [
      [b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1],
      [(b.x0 + b.x1) / 2, b.z0], [(b.x0 + b.x1) / 2, b.z1],
      [b.x0, (b.z0 + b.z1) / 2], [b.x1, (b.z0 + b.z1) / 2],
      [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2]
    ];
    let side = 0;
    for (const p of pts) {
      const vx = p[0] - cam.x, vz = p[1] - cam.z, len = Math.hypot(vx, vz) || 1e-6;
      const c = (vx * cam.dirX + vz * cam.dirZ) / len;
      if (c >= cosHalf) return true;
      // Track which side of the view axis each point is on; if points lie on
      // both sides in front of the camera, the box straddles the view.
      const cross = cam.dirX * vz - cam.dirZ * vx;
      if (vx * cam.dirX + vz * cam.dirZ > 0) side |= cross > 0 ? 1 : 2;
    }
    return side === 3;
  }

  function createPlanner(options) {
    const opt = Object.assign({}, DEFAULTS, options || {});
    const lastSeen = new Map();   // id -> time last inside view
    const recent = [];            // most-recently drawn ids (LRU)

    function touch(id) {
      const i = recent.indexOf(id);
      if (i >= 0) recent.splice(i, 1);
      recent.unshift(id);
      if (recent.length > opt.memory) recent.length = opt.memory;
    }

    /* regions: [{id,bbox}], links: [[a,b]], currentId: region the CAMERA is in,
       cam: {x,z,dirX,dirZ,halfFov}, now: seconds */
    function plan(regions, links, currentId, cam, now) {
      const t = Number.isFinite(now) ? now : 0;
      const hopLimit = Math.max(opt.maxHops, Number.isFinite(opt.prepareHops) ? opt.prepareHops : 0);
      const reach = hops(links, currentId, hopLimit);
      const half = (cam.halfFov || 0.6) + opt.frustumMargin;
      const visible = new Set(), prepared = new Set(), meta = new Map();
      const byId = new Map();
      (regions || []).forEach(function (r) { if (r && r.id) byId.set(r.id, r); });
      const adj = new Map();
      (links || []).forEach(function (l) {
        const a = l[0], b = l[1];
        if (!adj.has(a)) adj.set(a, []);
        if (!adj.has(b)) adj.set(b, []);
        adj.get(a).push(b); adj.get(b).push(a);
      });
      // Portal flood: a neighbour is drawn only when the doorway itself is
      // in the camera wedge. Testing the whole room AABB against a 400 m
      // sight line marked ~half the palace visible from the entrance, so
      // the first hall frame submitted far more than a steady visible frame.
      const q = [];
      function see(id) {
        if (!id || visible.has(id)) return;
        visible.add(id);
        q.push(id);
      }
      see(currentId);
      (regions || []).forEach(function (r) {
        if (r.id === currentId) return;
        if (nearestDistance(r.bbox, cam.x, cam.z) <= opt.nearPad) see(r.id);
      });
      while (q.length) {
        const a = q.shift();
        (adj.get(a) || []).forEach(function (b) {
          if (visible.has(b)) return;
          const h = reach.has(b) ? reach.get(b) : Infinity;
          if (h > opt.maxHops) return;
          const ra = byId.get(a), rb = byId.get(b);
          if (ra && ra.bbox && rb && rb.bbox) {
            if (!inWedge(portalBox(ra.bbox, rb.bbox), cam, half, opt.viewDistance)) return;
          } else if (rb && rb.bbox) {
            if (!inWedge(rb.bbox, cam, half, opt.viewDistance)) return;
          } else {
            return;
          }
          see(b);
        });
      }
      (regions || []).forEach(function (r) {
        const h = reach.has(r.id) ? reach.get(r.id) : Infinity;
        const near = nearestDistance(r.bbox, cam.x, cam.z);
        const seen = visible.has(r.id);
        if (seen) lastSeen.set(r.id, t);
        const lingering = lastSeen.has(r.id) && t - lastSeen.get(r.id) <= opt.linger && h <= opt.maxHops;
        if (lingering) { visible.add(r.id); touch(r.id); }
        else if (seen) touch(r.id);
        // Prepared (GPU-resident + prefetch) is based on the PLAYER'S region,
        // with a hop radius. Camera direction must not start loads or evicts
        // (a 360° spin must not churn zones). Visible rooms are still drawn,
        // and the streamer protects anything currently in the frustum from
        // eviction, but membership of `prepared` itself does not follow the camera.
        const prepHops = Number.isFinite(opt.prepareHops) ? opt.prepareHops : opt.maxHops;
        if (h <= prepHops) prepared.add(r.id);
        meta.set(r.id, { hops: h, distance: near, inView: visible.has(r.id) });
      });
      if (opt.memory > 0) recent.forEach(id => prepared.add(id));
      // Always keep the current room prepared even if hops map missed it.
      if (currentId) prepared.add(currentId);
      return { visible, prepared, meta };
    }
    function reset() { lastSeen.clear(); recent.length = 0; }
    return { plan, reset, options: opt };
  }

  const api = { createPlanner, inWedge, hops, nearestDistance, portalBox, DEFAULTS };
  root.SinWingVisibility = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
