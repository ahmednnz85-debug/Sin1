/* Runtime vs file probe. Loads assets-audit-data.json and compares live materials. */
(function (root) {
  'use strict';
  var audit = null;
  var diffs = [];

  function fetchAudit() {
    return fetch('assets-audit-data.json')
      .then(function (r) { return r.json(); })
      .then(function (j) { audit = j; return j; })
      .catch(function () { audit = null; });
  }

  function colorSpaceName(tex) {
    if (!tex) return null;
    return tex.colorSpace || tex.encoding || null;
  }

  function probeObject(rootObj, tag) {
    if (!rootObj || !rootObj.traverse) return [];
    var rows = [];
    rootObj.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m, i) {
        if (!m || !m.isMeshStandardMaterial) return;
        rows.push({
          tag: tag,
          mesh: o.name || '(unnamed)',
          matIndex: i,
          metalness: m.metalness,
          roughness: m.roughness,
          side: m.side,
          envMap: !!m.envMap,
          envMapIntensity: m.envMapIntensity,
          mapCS: colorSpaceName(m.map),
          normalCS: colorSpaceName(m.normalMap),
          mrCS: colorSpaceName(m.metalnessMap || m.roughnessMap),
          aoCS: colorSpaceName(m.aoMap),
          emissiveCS: colorSpaceName(m.emissiveMap)
        });
      });
    });
    return rows;
  }

  function compareToAudit(runtimeRows, glbPathHint) {
    if (!audit) return [];
    var out = [];
    runtimeRows.forEach(function (r) {
      if (r.envMap) {
        out.push({
          kind: 'envMap-present',
          mesh: r.mesh,
          fileValue: 'no envMap in GLB',
          runtimeValue: 'envMap on, intensity=' + r.envMapIntensity,
          cause: 'code override (should be absent on authored GLB mats)'
        });
      }
      // Heuristic: metalness changed from typical authored 1.0
      if (r.metalness != null && r.metalness < 0.85) {
        out.push({
          kind: 'metalness-possibly-clamped',
          mesh: r.mesh,
          fileValue: 'often metallicFactor=1.0 in audit',
          runtimeValue: r.metalness,
          cause: 'check against assets-audit for this mesh source'
        });
      }
    });
    return out;
  }

  function snapshot(tag, rootObj) {
    var rows = probeObject(rootObj, tag);
    var d = compareToAudit(rows, tag);
    diffs = diffs.concat(d);
    try {
      sessionStorage.setItem('sinFidelityProbe', JSON.stringify({
        at: Date.now(),
        tag: tag,
        rows: rows.slice(0, 80),
        diffs: diffs.slice(-80)
      }));
    } catch (_) {}
    if (typeof console !== 'undefined' && console.table) {
      console.info('[fidelity]', tag, 'mats', rows.length, 'diffs', d.length);
      if (d.length) console.table(d.slice(0, 20));
    }
    return { rows: rows, diffs: d };
  }

  root.SinFidelityProbe = {
    ready: fetchAudit,
    snapshot: snapshot,
    diffs: function () { return diffs.slice(); }
  };
  fetchAudit();
})(window);
