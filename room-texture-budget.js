/* Sîn — live texture budget (Phase 3).
   Caps decoded textures in memory without recompressing source GLBs/KTX2.
   Floor / throne-wall: ≤2048. Everything else: ≤1024. Shared textures untouched twice.
   Kill switch: ?texbudget=0 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    var params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
    root.SinTextureBudget = params.get('texbudget') === '0' ? null : api;
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var FLOOR_EDGE = 2048;
  var DEFAULT_EDGE = 1024;
  var seen = new WeakSet();
  var resized = 0;

  function isFloorOrThrone(texture, hint) {
    var name = String(hint || (texture && texture.name) || '').toLowerCase();
    return /floor|ارض|عرش|throne|marble|سجاد|carpet/.test(name);
  }

  function imageSize(image) {
    if (!image) return { w: 0, h: 0 };
    return {
      w: image.naturalWidth || image.videoWidth || image.width || 0,
      h: image.naturalHeight || image.videoHeight || image.height || 0
    };
  }

  function capTexture(texture, hint) {
    if (!texture || !texture.isTexture || seen.has(texture)) return false;
    seen.add(texture);
    var image = texture.image || (texture.source && texture.source.data);
    var size = imageSize(image);
    if (!size.w || !size.h) return false;
    var maxEdge = isFloorOrThrone(texture, hint) ? FLOOR_EDGE : DEFAULT_EDGE;
    if (Math.max(size.w, size.h) <= maxEdge) {
      if (texture.generateMipmaps !== true) texture.generateMipmaps = true;
      return false;
    }
    if (typeof document === 'undefined') return false;
    var scale = maxEdge / Math.max(size.w, size.h);
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(size.w * scale));
    canvas.height = Math.max(1, Math.round(size.h * scale));
    var ctx = canvas.getContext('2d');
    if (!ctx) return false;
    try {
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      texture.image = canvas;
      if (texture.source && texture.source.data === image) texture.source.data = canvas;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
      resized++;
      return true;
    } catch (_) {
      return false;
    }
  }

  function capObject(root, hint) {
    if (!root || !root.traverse) return 0;
    var n = 0;
    root.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) {
        if (!m) return;
        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'lightMap'].forEach(function (k) {
          if (m[k] && m[k].isTexture && capTexture(m[k], hint || o.name || k)) n++;
        });
      });
    });
    return n;
  }

  function report() { return { resized: resized, floorEdge: FLOOR_EDGE, defaultEdge: DEFAULT_EDGE }; }
  function reset() { seen = new WeakSet(); resized = 0; }

  return { capTexture: capTexture, capObject: capObject, report: report, reset: reset, FLOOR_EDGE: FLOOR_EDGE, DEFAULT_EDGE: DEFAULT_EDGE };
});
