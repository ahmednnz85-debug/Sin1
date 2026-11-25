/* SÎN ENGINE — GPU-compressed palace textures on phones (KTX2 / UASTC → ASTC).
   ---------------------------------------------------------------------------
   Why: on an iPhone the throne hall alone kept ~350 MB of uncompressed RGBA8
   textures resident (5.3 MB per 1024² map with mips), so the 650 MB budget
   could hold the hall and at most one room: rooms could not be prepared
   before the hero reached them. ASTC 4x4 is the GPU's native compressed
   format: 1 byte per texel instead of 4, sampled directly by the GPU, no
   CPU decode, no main-thread resize, a quarter of the upload.

   What: every palace texture image has a pre-encoded twin under
   assets/ktx2/ (tools/ktx2-pack.cjs). The twin is the same picture at the
   same size the phone shows today (≤ 1024 px, the phone cap), encoded as
   UASTC (the highest-quality Basis mode, transcoded losslessly to ASTC 4x4
   on the device) with mip levels filtered like the GPU's own mipmaps.
   Images are matched by CONTENT (a hash of the embedded image bytes), so a
   picture is found whatever GLB or loader it comes from.

   Where: phones only (SinDevice constrained profile), only when the GPU
   supports ASTC, and only for images in the manifest (recorded on a palace
   tour). Anything else — desktop, an older GPU, a
   missing file, a transcoder error — takes the exact original path.

   ?ktx2=off disables it (A/B), ?ktxcapture=1 records every palace image the
   game loads (window.__sinKtxSeen) for the packer. */
(function (root) {
  'use strict';
  if (!root) return;

  // ---- content key (identical in tools/ktx2-pack.cjs) ----------------------
  // Length + two FNV-1a hashes over a stride sample and the head / tail of
  // the encoded image bytes. Entropy-coded image data makes a collision
  // between two different pictures of the same length practically impossible.
  function key(bytes) {
    const n = bytes.length;
    let h1 = 0x811c9dc5 | 0, h2 = 0x01000193 ^ n;
    const mix = (h, b) => Math.imul(h ^ b, 16777619);
    const step = n > 65536 ? 7 : 1;
    for (let i = 0; i < n; i += step) h1 = mix(h1, bytes[i]);
    const head = Math.min(n, 4096);
    for (let i = 0; i < head; i++) h2 = mix(h2, bytes[i]);
    for (let i = Math.max(head, n - 4096); i < n; i++) h2 = mix(h2, bytes[i]);
    return n.toString(36) + '-' + (h1 >>> 0).toString(36) + '-' + (h2 >>> 0).toString(36);
  }

  const params = (() => { try { return new URLSearchParams(root.location.search); } catch (_) { return new URLSearchParams(''); } })();
  const disabled = params.get('ktx2') === 'off';
  const capture = params.get('ktxcapture') === '1';
  const seen = root.__sinKtxSeen = capture ? {} : null;
  const MANIFEST = 'assets/ktx2/manifest.json';
  const TRANSCODER = 'vendor/basis/';
  const stats = { matched: 0, missed: 0, failed: 0, fallbacks: 0, gpuBytes: 0 };
  let state = 'idle', manifest = null, loader = null, readyPromise = null, reason = '';

  function phone() {
    try { return !!(root.SinDevice && root.SinDevice.detect().constrained); } catch (_) { return false; }
  }
  // Resolves true when compressed twins can be used on this device.
  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      if (disabled) { reason = 'disabled (?ktx2=off)'; return false; }
      if (!phone()) { reason = 'not a phone profile'; return false; }
      const THREE = root.THREE, renderer = root.__R;
      if (!THREE || !THREE.loadKTX2Loader || !renderer) { reason = 'no KTX2 loader / renderer'; return false; }
      try {
        const res = await fetch(MANIFEST, { cache: 'no-cache' });
        if (!res.ok) { reason = 'no manifest'; return false; }
        manifest = await res.json();
        const { KTX2Loader } = await THREE.loadKTX2Loader();
        loader = new KTX2Loader().setTranscoderPath(TRANSCODER).setWorkerLimit(2).detectSupport(renderer);
        // ASTC only: UASTC → ASTC 4x4 is a lossless re-packing. Other targets
        // (ETC2 / BC7 / RGBA fallback) would not be the same picture.
        if (!(loader.workerConfig && loader.workerConfig.astcSupported)) { reason = 'GPU without ASTC'; loader.dispose(); loader = null; return false; }
        state = 'active';
        reason = 'active: ' + Object.keys(manifest.items || {}).length + ' compressed images';
        return true;
      } catch (e) { reason = 'init failed: ' + (e && e.message || e); return false; }
    })();
    readyPromise.then(ok => { if (!ok) state = 'off'; try { console.info('[ktx2] ' + reason); } catch (_) {} });
    return readyPromise;
  }

  function gpuBytesOf(tex) {
    let n = 0;
    (tex.mipmaps || []).forEach(m => { if (m && m.data) n += m.data.byteLength; });
    return n;
  }
  // ---- CPU copy release ------------------------------------------------------
  // Once a twin (or any clone of it) is on the GPU its compressed mip chain is
  // not needed in JS memory. Each texture drops only ITS OWN references, after
  // ITS OWN upload, so a clone that still has to upload keeps the data; the
  // buffers are freed when the last holder lets go. A released texture
  // ignores needsUpdate (its GPU copy is final and complete).
  const pending = new Set();
  let sweepTimer = 0;
  function hold(tex) {
    pending.add(typeof WeakRef === 'function' ? new WeakRef(tex) : { deref: () => tex });
    if (!sweepTimer && typeof setInterval === 'function') sweepTimer = setInterval(sweep, 1500);
  }
  function guard(tex) {
    try {
      Object.defineProperty(tex, 'needsUpdate', { configurable: true, get() { return false; }, set(v) { if (v) stats.ignoredUpdates = (stats.ignoredUpdates || 0) + 1; } });
    } catch (_) {}
  }
  function sweep() {
    const r = root.__R;
    if (!r || !r.properties) return;
    pending.forEach(ref => {
      const t = ref.deref();
      if (!t || !t.mipmaps || !t.mipmaps.length || !t.mipmaps[0] || !t.mipmaps[0].data) { pending.delete(ref); return; }
      // A texture something has cloned is a template: it keeps its data.
      if (t.userData.sinCloned) { pending.delete(ref); return; }
      let p = null;
      try { p = r.properties.get(t); } catch (_) {}
      if (!p || !p.__webglTexture || p.__version !== t.version) return;
      t.mipmaps = t.mipmaps.map(m => ({ width: m.width, height: m.height, data: null }));
      t.userData.sinCpuReleased = true;
      guard(t);
      stats.cpuReleased = (stats.cpuReleased || 0) + 1;
      pending.delete(ref);
    });
  }
  function loadTwin(item) {
    return new Promise((resolve, reject) => loader.load(item.file, resolve, undefined, reject)).then(tex => {
      tex.userData.sinKtx = item.file;
      tex.userData.sinGpuBytes = gpuBytesOf(tex);
      tex.userData.sinGpuW = item.w; tex.userData.sinGpuH = item.h;
      stats.gpuBytes += tex.userData.sinGpuBytes;
      hold(tex);
      return tex;
    });
  }

  // GLTFLoader plugin: an embedded image with a twin loads the twin; the
  // parser applies the glTF sampler, name and colour space as usual.
  class Plugin {
    constructor(parser) { this.parser = parser; this.name = 'SIN_ktx2_twin'; }
    loadTexture(textureIndex) {
      stats.calls = (stats.calls || 0) + 1;
      if (disabled || (!capture && !phone())) return null;
      // The hall's models are fetched and parsed ahead of the palace entry
      // (before PalaceInterior leaves IDLE), so this does not wait for the
      // palace phase: only images in the manifest (recorded on a palace
      // tour) are ever swapped; anything else takes the original path.
      const parser = this.parser, json = parser.json, def = json.textures && json.textures[textureIndex];
      if (!def) return null;
      // Plain images and EXT_texture_webp / EXT_texture_avif images (the
      // optimized hall models) are matched by the bytes of the image the
      // game would decode; any other texture extension keeps its own path.
      const ext = def.extensions || {}, names = Object.keys(ext);
      if (names.some(n => n !== 'EXT_texture_webp' && n !== 'EXT_texture_avif')) { stats.otherExtension = (stats.otherExtension || 0) + 1; return null; }
      const sourceIndex = ext.EXT_texture_webp ? ext.EXT_texture_webp.source : ext.EXT_texture_avif ? ext.EXT_texture_avif.source : def.source;
      if (sourceIndex == null) return null;
      const src = json.images[sourceIndex];
      if (!src || src.bufferView == null) { stats.uriImages = (stats.uriImages || 0) + 1; return null; }
      return Promise.all([capture ? Promise.resolve(false) : ready(), parser.getDependency('bufferView', src.bufferView)]).then(([ok, buf]) => {
        const k = key(new Uint8Array(buf));
        if (seen && !seen[k]) seen[k] = { mime: src.mimeType || '', bytes: buf.byteLength, name: def.name || src.name || '' };
        const item = ok && manifest.items[k];
        if (!item) { if (ok) stats.missed++; return parser.loadTextureImage(textureIndex, sourceIndex, parser.textureLoader); }
        const adapter = {
          load(url, onLoad, onProgress, onError) {
            loadTwin(item).then(tex => { stats.matched++; onLoad(tex); }, () => {
              // Twin unusable: the original image, exactly as GLTFLoader would.
              stats.failed++; stats.fallbacks++;
              const L = parser.textureLoader;
              L.load(url, img => { if (L.isImageBitmapLoader) { const t = new root.THREE.Texture(img); t.needsUpdate = true; onLoad(t); } else onLoad(img); }, onProgress, onError);
            });
          }
        };
        return parser.loadTextureImage(textureIndex, sourceIndex, adapter);
      });
    }
  }

  // Clones of a twin (GLTFLoader clones one per sampler) are released on
  // their own; the cloned texture becomes a template and keeps its data. A
  // clone of an already released twin reloads its file (browser-cached).
  function hookClone(THREE) {
    const P = THREE && THREE.CompressedTexture && THREE.CompressedTexture.prototype;
    if (!P || P.__sinKtxClone) return;
    const clone = P.clone;
    P.clone = function () {
      const twin = this.userData && this.userData.sinKtx;
      if (twin) this.userData.sinCloned = true;
      const c = clone.apply(this, arguments);
      if (!twin) return c;
      delete c.userData.sinCloned; delete c.userData.sinCpuReleased;
      if (this.userData.sinCpuReleased) {
        stats.reloads = (stats.reloads || 0) + 1;
        const item = { file: twin, w: this.userData.sinGpuW, h: this.userData.sinGpuH };
        if (loader) loadTwin(item).then(fresh => { c.mipmaps = fresh.mipmaps; c.needsUpdate = true; }, () => {});
      } else hold(c);
      return c;
    };
    P.__sinKtxClone = true;
  }
  // Every GLTFLoader the game creates gets the plugin.
  function hookLoader(THREE) {
    hookClone(THREE);
    if (!THREE || !THREE.GLTFLoader || THREE.GLTFLoader.__sinKtx) return false;
    const Base = THREE.GLTFLoader;
    class SinGLTFLoader extends Base {
      // First in line: GLTFLoader asks its plugins in registration order and
      // its own EXT_texture_webp handler would otherwise take webp images.
      constructor(manager) { super(manager); this.pluginCallbacks.unshift(parser => new Plugin(parser)); }
    }
    SinGLTFLoader.__sinKtx = true;
    THREE.GLTFLoader = SinGLTFLoader;
    return true;
  }

  // Hall surfaces (palaceInterior textureFromBytes): same lookup by content.
  // Returns a promise of the twin, or null when the original path applies.
  function textureFromBytes(buf, linear) {
    if (disabled) return null;
    const k = key(new Uint8Array(buf));
    if (seen && !seen[k]) seen[k] = { mime: 'hall-bytes', bytes: buf.byteLength, name: 'hall', linear: !!linear };
    if (capture || !phone()) return null;
    return ready().then(ok => {
      const item = ok && manifest.items[k];
      if (!item) return null;
      return loadTwin(item).then(tex => { stats.matched++; return tex; }, () => { stats.failed++; return null; });
    });
  }

  root.SinKtx = {
    key, ready, textureFromBytes, hookLoader, sweep,
    active: () => state === 'active',
    report: () => ({ state, reason, stats: Object.assign({}, stats), images: manifest ? Object.keys(manifest.items || {}).length : 0 })
  };
  hookLoader(root.THREE);
  if (typeof module === 'object' && module.exports) module.exports = root.SinKtx;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
