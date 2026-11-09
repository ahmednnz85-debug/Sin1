/* Adaptive GPU residency policy for streamed palace rooms.
   It never changes render resolution. It only changes which hidden rooms keep
   their GPU buffers resident, while visible/current rooms are always protected. */
(function (root) {
  'use strict';
  function create(options) {
    const o = Object.assign({
      geometryBudget: 420,
      textureBudget: 180,
      watchRatio: 0.82,
      criticalRatio: 0.96,
      frameWatchMs: 24,
      frameCriticalMs: 40,
      recoveryMs: 2500
    }, options || {});
    let level = 'normal';
    let stableMs = 0;
    let frameEma = 16.7;
    let last = { level, geometryRatio: 0, textureRatio: 0, frameMs: frameEma };
    function ratio(value, budget) {
      return Math.max(0, Number(value) || 0) / Math.max(1, budget);
    }
    function sample(renderer, frameMs) {
      const memory = renderer && renderer.info && renderer.info.memory || {};
      const geometryRatio = ratio(memory.geometries, o.geometryBudget);
      const textureRatio = ratio(memory.textures, o.textureBudget);
      const ms = Number.isFinite(frameMs) && frameMs > 0 ? frameMs : frameEma;
      frameEma = frameEma * 0.88 + ms * 0.12;
      const pressure = Math.max(geometryRatio, textureRatio);
      const critical = pressure >= o.criticalRatio || frameEma >= o.frameCriticalMs;
      const watch = pressure >= o.watchRatio || frameEma >= o.frameWatchMs;
      if (critical) {
        level = 'critical';
        stableMs = 0;
      } else if (watch) {
        level = 'watch';
        stableMs = 0;
      } else if (level !== 'normal') {
        stableMs += Math.max(0, ms);
        if (stableMs >= o.recoveryMs) level = 'normal';
      } else {
        stableMs = Math.min(o.recoveryMs, stableMs + Math.max(0, ms));
      }
      last = { level, geometryRatio, textureRatio, frameMs: frameEma };
      return last;
    }
    function selectPrepared(visibleIds, preparedIds, meta, currentId) {
      const visible = visibleIds instanceof Set ? visibleIds : new Set(visibleIds || []);
      const prepared = preparedIds instanceof Set ? preparedIds : new Set(preparedIds || []);
      if (level === 'normal') return new Set(prepared);
      const keep = new Set(visible);
      if (currentId) keep.add(currentId);
      if (level === 'watch') {
        let best = null;
        prepared.forEach(function (id) {
          if (keep.has(id)) return;
          const item = meta && meta.get ? meta.get(id) : null;
          const distance = item && Number.isFinite(item.distance) ? item.distance : Infinity;
          if (!best || distance < best.distance) best = { id, distance };
        });
        if (best) keep.add(best.id);
      }
      // Critical pressure keeps only what is visible now and the current room.
      // Hidden room CPU objects remain intact and will re-upload on re-entry.
      return keep;
    }
    function state() { return Object.assign({}, last); }
    return { sample, selectPrepared, state };
  }
  root.SinSmartMemory = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = { create };
})(typeof window !== 'undefined' ? window : globalThis);
