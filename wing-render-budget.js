(function (root) {
  'use strict';

  function choose(candidates, budget) {
    const cap = Number.isFinite(budget) ? Math.max(0, budget) : 750000;
    const ordered = (candidates || []).slice().sort((a, b) =>
      (a.priority - b.priority) || (a.distance - b.distance) || String(a.id).localeCompare(String(b.id))
    );
    const selected = [], ids = new Set();
    let triangles = 0;
    ordered.forEach(item => {
      if (!item || ids.has(item.id)) return;
      const count = Number.isFinite(item.triangles) ? Math.max(0, item.triangles) : 0;
      if (item.current || triangles + count <= cap) {
        ids.add(item.id);
        selected.push(item.id);
        triangles += count;
      }
    });
    return { ids: selected, triangles, budget: cap };
  }

  const api = { choose };
  root.SinWingRenderBudget = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
