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
    prefetchMargin: 0.55,  // wider hidden look-ahead; it never makes a room visible
    prefetchDistance: 25,  // extra metres beyond the sight line that are uploaded ahead
    nearPad: 1.25,         // only the immediate camera volume bypasses the wedge
    maxHops: 6,            // portal hops from the camera's region that can be seen
    linger: 0.45,          // short hysteresis prevents stale rooms after a turn
    memory: 0              // regions outside the prefetch wedge are released from GPU memory
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

  function openLinks(links, doors) {
    const byId = new Map((doors || []).filter(d => d && d.id != null).map(d => [d.id, d]));
    return (links || []).filter(link => {
      if (!link || link.length < 3) return true;
      const door = byId.get(link[2]);
      if (!door) return true;
      return door.kind === 'arch' || door.state === 'Open' || door.state === 'Opening';
    });
  }

  function nearestDistance(b, x, z) {
    const dx = Math.max(b.x0 - x, 0, x - b.x1);
    const dz = Math.max(b.z0 - z, 0, z - b.z1);
    return Math.hypot(dx, dz);
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
      const reach = hops(links, currentId, opt.maxHops);
      const half = (cam.halfFov || 0.6) + opt.frustumMargin;
      const visible = new Set(), prepared = new Set(), meta = new Map();
      regions.forEach(r => {
        const h = reach.has(r.id) ? reach.get(r.id) : Infinity;
        const near = nearestDistance(r.bbox, cam.x, cam.z);
        let seen = false;
        if (r.id === currentId || near <= opt.nearPad) seen = true;
        else if (h <= opt.maxHops && inWedge(r.bbox, cam, half, opt.viewDistance)) seen = true;
        if (seen) lastSeen.set(r.id, t);
        const lingering = lastSeen.has(r.id) && t - lastSeen.get(r.id) <= opt.linger && h <= opt.maxHops;
        if (seen || lingering) { visible.add(r.id); touch(r.id); }
        // Prepared = GPU-resident. Only what is drawn or about to enter the view
        // (wider prefetch wedge, slightly past the sight line) stays in memory;
        // everything else is released until it approaches the view again.
        if (visible.has(r.id) || (h <= opt.maxHops && inWedge(r.bbox, cam, half + opt.prefetchMargin, opt.viewDistance + opt.prefetchDistance))) prepared.add(r.id);
        meta.set(r.id, { hops: h, distance: near, inView: seen });
      });
      if (opt.memory > 0) recent.forEach(id => prepared.add(id));
      return { visible, prepared, meta };
    }
    function reset() { lastSeen.clear(); recent.length = 0; }
    return { plan, reset, options: opt };
  }

  const api = { createPlanner, inWedge, hops, openLinks, nearestDistance, DEFAULTS };
  root.SinWingVisibility = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
