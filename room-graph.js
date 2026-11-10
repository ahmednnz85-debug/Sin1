/* Sîn — Room Graph (Phase 1).
   Pure graph + residency states for palace rooms.
   States: permanent | active | warm | cold
   Kill switch: ?roomgraph=0 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    var params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
    root.SinRoomGraph = params.get('roomgraph') === '0' ? null : api;
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // Authoritative wing topology (logical rooms). Corridors are derived from
  // PalaceWings links at runtime so layout edits stay in one place.
  var WING_CHAIN = {
    Kings: ['K1', 'K2', 'K3', 'K4', 'K5'],
    Temple: ['T1', 'T2', 'T3', 'T4', 'T5'],
    Library: ['L1', 'L2', 'L3', 'L4']
  };
  var PERMANENT_IDS = new Set(['Palace']);
  var SHARED_ASSETS = [
    'assets/ارضية الممرات.JPG',
    'assets/سجاد الممرات.JPG',
    'ارضيات وسقوف/optimized/سقف-الممرات.webp',
    'assets/جدار الممرات.jpg',
    'assets/باب الاجنحة.glb'
  ];
  var ROOM_ASSETS = {
    Palace: [],
    K1: ['ارضيات وسقوف/optimized/K1_RoyalReceptionHall_lod25.glb'],
    K2: [
      'ارضيات وسقوف/optimized/جدار-المجلس.webp',
      'ارضيات وسقوف/optimized/سقف-المجلس.glb',
      'ارضيات وسقوف/optimized/ثريا-المجلس.glb',
      'ارضيات وسقوف/optimized/lion_winged.glb',
      'assets/ارضية المجلس.PNG',
      'ارضيات وسقوف/optimized/عمود-المجلس.glb',
      'assets/اجتماعات .glb'
    ],
    K3: [
      'assets/\u0627\u0631\u0636\u064A\u0629 \u0627\u0644\u062E\u0631\u0627\u064A\u0654\u0637.JPG',
      'assets/\u062C\u062F\u0627\u0631 \u0627\u0644\u062E\u0631\u0627\u064A\u0654\u0637.JPG',
      'assets/جدار الخرائط 2.JPG',
      'assets/سقف الخرائط .JPG',
      'assets/طاولة الخرائط.glb',
      'assets/اثاث_الخرائط.glb'
    ],
    K4: [
      'ارضيات وسقوف/optimized/k4/ارضية-الخزانة.jpg',
      'ارضيات وسقوف/optimized/k4/سقف-الخزانة.jpg',
      'ارضيات وسقوف/optimized/k4/جدارية-ايمن-الخزانة.jpg',
      'ارضيات وسقوف/optimized/k4/k4_kit_a.glb',
      'ارضيات وسقوف/optimized/k4/k4_kit_b.glb',
      'ارضيات وسقوف/optimized/k4/k4_kit_c.glb',
      'ارضيات وسقوف/optimized/k4/k4_front_mural.glb'
    ],
    K5: [],
    T1: [], T2: [], T3: [], T4: [], T5: [],
    L1: [], L2: [], L3: [], L4: []
  };

  function adjacencyFromLinks(links) {
    var adj = new Map();
    function add(a, b) {
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      if (adj.get(a).indexOf(b) < 0) adj.get(a).push(b);
      if (adj.get(b).indexOf(a) < 0) adj.get(b).push(a);
    }
    (links || []).forEach(function (l) {
      if (!l || l.length < 2) return;
      add(String(l[0]), String(l[1]));
    });
    return adj;
  }

  function hopsFrom(adj, startId, limit) {
    var dist = new Map();
    if (startId == null) return dist;
    var start = String(startId);
    dist.set(start, 0);
    var q = [start];
    var max = Number.isFinite(limit) ? limit : 32;
    while (q.length) {
      var a = q.shift();
      var d = dist.get(a);
      if (d >= max) continue;
      (adj.get(a) || []).forEach(function (b) {
        if (!dist.has(b)) { dist.set(b, d + 1); q.push(b); }
      });
    }
    return dist;
  }

  function createGraph(options) {
    var o = options || {};
    var links = o.links || [];
    var regionIds = (o.regionIds || []).map(String);
    var groups = o.groups || new Map();
    var adj = adjacencyFromLinks(links);
    regionIds.forEach(function (id) { if (!adj.has(id)) adj.set(id, []); });
    if (!adj.has('Palace')) adj.set('Palace', []);

    var nodes = new Map();
    function ensureNode(id) {
      if (nodes.has(id)) return nodes.get(id);
      var node = {
        id: id,
        group: groups.get ? groups.get(id) || null : null,
        neighbors: adj.get(id) || [],
        assets: (ROOM_ASSETS[id] || []).slice(),
        permanent: PERMANENT_IDS.has(id),
        state: PERMANENT_IDS.has(id) ? 'permanent' : 'cold',
        hops: Infinity
      };
      if (id === 'Palace') node.assets = SHARED_ASSETS.slice();
      nodes.set(id, node);
      return node;
    }
    regionIds.forEach(ensureNode);
    ensureNode('Palace');
    adj.forEach(function (_v, id) { ensureNode(id); });

    var last = { current: null, states: new Map(), active: null, warm: [], cold: [], permanent: ['Palace'] };

    function bindGroups(regionGroups) {
      if (!regionGroups || !regionGroups.forEach) return;
      regionGroups.forEach(function (g, id) {
        var n = ensureNode(String(id));
        n.group = g || null;
      });
    }

    function classify(currentId, extras) {
      var cur = currentId == null ? 'Palace' : String(currentId);
      // Thresholds / arches map to their linked room for residency.
      if (extras && extras.origin) cur = String(extras.origin);
      var hopLimit = extras && Number.isFinite(extras.warmHops) ? extras.warmHops : 1;
      var dist = hopsFrom(adj, cur, 12);
      var cameraVisible = extras && extras.visible instanceof Set ? extras.visible : null;
      var states = new Map();
      var warm = [], cold = [], active = cur;

      nodes.forEach(function (node, id) {
        var h = dist.has(id) ? dist.get(id) : Infinity;
        node.hops = h;
        node.neighbors = adj.get(id) || [];
        var state;
        if (PERMANENT_IDS.has(id) || node.permanent) state = 'permanent';
        else if (id === cur) state = 'active';
        else if (h <= hopLimit) state = 'warm';
        else if (cameraVisible && cameraVisible.has(id)) state = 'warm'; // seen through open door
        else state = 'cold';
        node.state = state;
        states.set(id, state);
        if (state === 'warm') warm.push(id);
        else if (state === 'cold') cold.push(id);
      });

      last = {
        current: cur,
        states: states,
        active: active,
        warm: warm.slice().sort(),
        cold: cold.slice().sort(),
        permanent: Array.from(PERMANENT_IDS)
      };
      return last;
    }

    /* Resident set the GPU / loader should keep: permanent + active + warm. */
    function residentIds(snapshot) {
      var snap = snapshot || last;
      var out = new Set(snap.permanent || []);
      if (snap.active) out.add(snap.active);
      (snap.warm || []).forEach(function (id) { out.add(id); });
      return out;
    }

    function report() {
      return {
        current: last.current,
        active: last.active,
        warm: last.warm.slice(),
        cold: last.cold.slice(),
        permanent: last.permanent.slice(),
        nodes: nodes.size,
        wingChain: WING_CHAIN
      };
    }

    return {
      nodes: nodes,
      adjacency: adj,
      bindGroups: bindGroups,
      classify: classify,
      residentIds: residentIds,
      report: report,
      sharedAssets: SHARED_ASSETS.slice(),
      roomAssets: function (id) { return (ROOM_ASSETS[id] || SHARED_ASSETS).slice(); },
      hopsFrom: function (id, limit) { return hopsFrom(adj, id, limit); }
    };
  }

  return {
    createGraph: createGraph,
    WING_CHAIN: WING_CHAIN,
    PERMANENT_IDS: PERMANENT_IDS,
    SHARED_ASSETS: SHARED_ASSETS,
    ROOM_ASSETS: ROOM_ASSETS,
    adjacencyFromLinks: adjacencyFromLinks,
    hopsFrom: hopsFrom
  };
});
