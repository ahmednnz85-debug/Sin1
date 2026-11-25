/* Sîn — core area registry (game-level; the single source of truth).
   ---------------------------------------------------------------------------
   Every playable stage, zone and room is declared here by the module that
   OWNS it, next to the data that defines it:
     • index.html (exterior)      — its named places, from the world constants
     • palaceInterior.js          — the throne hall
     • wing-architecture.js       — a provider: every room and connector that
                                    solveLayout() builds (new rooms appear
                                    automatically, nothing else to edit)
     • r3-sealed-zone.js          — the three R3 sections
   Tools (the developer hub, tests, agents) only READ this registry. The game
   never depends on any reader. See AGENTS.md → "Area registry".

   Area definition:
     { id, stage, group, ar, en, spawn, order? }
       id     stable, unique; used in links (?dev=1&level=<id>)
       stage  'outdoor' | 'palace' | 'r3' — the game stage that must be booted
       group  menu section id (declared with SinAreas.group)
       ar/en  display names
       spawn  outdoor: { x, z, yaw }   palace: { teleport: '<region id>' }
              r3: { u, v, y, yaw } in R3 stage space, or { stageSpawn: true }
   Providers: SinAreas.provide(name, async () => [definitions]) for areas
   derived from data that is only known at runtime (e.g. the palace layout).
   Providers run only when something calls SinAreas.list(). */
(function (root) {
  'use strict';
  if (root.SinAreas) return;
  const STAGES = ['outdoor', 'palace', 'r3'];
  const statics = [], providers = new Map(), groups = new Map();
  let resolved = null, seq = 0;

  function check(a, from) {
    if (!a || typeof a.id !== 'string' || !a.id) throw new Error('SinAreas: area without id (' + from + ')');
    if (!STAGES.includes(a.stage)) throw new Error('SinAreas: unknown stage "' + a.stage + '" for ' + a.id);
    if (!a.group) throw new Error('SinAreas: area ' + a.id + ' has no group');
    if (!a.spawn || typeof a.spawn !== 'object') throw new Error('SinAreas: area ' + a.id + ' has no spawn');
    if (a.stage === 'palace' && !a.spawn.teleport) throw new Error('SinAreas: palace area ' + a.id + ' needs spawn.teleport');
    return Object.assign({ ar: a.en || a.id, en: a.ar || a.id }, a, { source: from, seq: seq++ });
  }
  const api = {
    STAGES,
    // Menu section: id, Arabic and English labels, sort order.
    group(id, ar, en, order = 100) { if (!groups.has(id)) groups.set(id, { id, ar, en, order }); return api; },
    register(a, from = 'static') { statics.push(check(a, from)); resolved = null; return api; },
    provide(name, fn) { providers.set(name, fn); resolved = null; return api; },
    groups: () => [...groups.values()].sort((a, b) => a.order - b.order),
    // All areas: static registrations plus every provider, de-duplicated,
    // grouped and ordered. A failing provider is reported, not fatal.
    list() {
      if (resolved) return resolved;
      resolved = (async () => {
        const out = statics.slice(), errors = [];
        for (const [name, fn] of providers) {
          try { for (const a of (await fn()) || []) out.push(check(a, name)); }
          catch (e) { errors.push(name + ': ' + (e && e.message || e)); }
        }
        const seen = new Set(), areas = [];
        for (const a of out) {
          if (seen.has(a.id)) { errors.push('duplicate id ' + a.id + ' (' + a.source + ')'); continue; }
          seen.add(a.id); areas.push(a);
        }
        const order = id => (groups.get(id) || { order: 1000 }).order;
        areas.sort((a, b) => order(a.group) - order(b.group) || (a.order || 0) - (b.order || 0) || a.seq - b.seq);
        areas.errors = errors;
        return areas;
      })();
      return resolved;
    },
    async get(id) { return (await api.list()).find(a => a.id === id) || null; }
  };
  root.SinAreas = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
