import * as ThreeModule from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// DRACOLoader is deliberately NOT taken from three@0.187 addons: its worker
// calls decoder.GetEncodedGeometryType(Int8Array), which the vendored
// vendor/draco decoder (draco 1.4.x wasm, shipped with the r147 game) does
// not support -> "THREE.DRACOLoader: Unexpected geometry type" and the K3 map
// room furniture/table never appeared. Leaving THREE.DRACOLoader undefined
// makes wings.js / palaceInterior.js load vendor/draco/DRACOLoader.js, the
// loader that matches the vendored wasm (exact pre-upgrade behaviour).
const THREE = { ...ThreeModule, GLTFLoader };
THREE.sRGBEncoding = ThreeModule.SRGBColorSpace;
THREE.LinearEncoding = ThreeModule.LinearSRGBColorSpace;

// Match r147's legacy color interpretation rather than r152+'s new default.
if (ThreeModule.ColorManagement) ThreeModule.ColorManagement.enabled = false;

// Retain the legacy game's texture.encoding writes while routing them to the
// equivalent r187 colorSpace property.
if (!Object.getOwnPropertyDescriptor(ThreeModule.Texture.prototype, 'encoding')) {
  Object.defineProperty(ThreeModule.Texture.prototype, 'encoding', {
    configurable: true,
    get() { return this.colorSpace; },
    set(value) { this.colorSpace = value; }
  });
}

// The game configures outputEncoding on its renderer. Preserve that API as a
// direct alias for r187's outputColorSpace property.
if (!Object.getOwnPropertyDescriptor(ThreeModule.WebGLRenderer.prototype, 'outputEncoding')) {
  Object.defineProperty(ThreeModule.WebGLRenderer.prototype, 'outputEncoding', {
    configurable: true,
    get() { return this.outputColorSpace; },
    set(value) { this.outputColorSpace = value; }
  });
}

// r147 applied an artist-friendly PI intensity scale to lights. Reapply that
// scale only while rendering so animation and scene code continue to read and
// write their original intensity values. Cache scene lights: walking the full
// world and allocating an array on every frame caused severe CPU/GC pressure.
const lightCacheByScene = new WeakMap();
function attachedScene(object) {
  for (let node = object; node; node = node.parent) {
    if (node.isScene) return node;
  }
  return null;
}
function invalidateScene(scene) {
  const entry = scene && lightCacheByScene.get(scene);
  if (entry) entry.dirty = true;
}
const originalAdd = ThreeModule.Object3D.prototype.add;
const originalRemove = ThreeModule.Object3D.prototype.remove;
ThreeModule.Object3D.prototype.add = function (...objects) {
  const result = originalAdd.apply(this, objects);
  invalidateScene(attachedScene(this));
  return result;
};
ThreeModule.Object3D.prototype.remove = function (...objects) {
  const scene = attachedScene(this);
  const result = originalRemove.apply(this, objects);
  invalidateScene(scene);
  return result;
};
function lightsFor(scene) {
  let entry = lightCacheByScene.get(scene);
  // Rebuild promptly when dirty so newly added palace hemi/ambient lights get
  // the r147 ×π scale on the next frame. Cap rebuild cost with a short
  // coalesce window only (was 1000ms and left interiors dark after entry).
  if (entry && entry.dirty && performance.now() - entry.builtAt < 32) return entry;
  if (!entry || entry.dirty) {
    const lights = [];
    if (scene && scene.traverse) {
      scene.traverse(object => {
        if (object.isLight && Number.isFinite(object.intensity)) lights.push(object);
      });
    }
    entry = { dirty: false, lights, intensities: new Array(lights.length), builtAt: performance.now() };
    lightCacheByScene.set(scene, entry);
  }
  return entry;
}
// r147 point/spot lights (physicallyCorrectLights off) faded with a windowed
// power, not inverse-square. r187 only has the physical formula, so restore
// the r147 falloff function here. NOTE: r147's WebGLLights multiplied EVERY
// punctual light (ambient, hemisphere, directional, point AND spot) by
// scaleFactor = Math.PI when physicallyCorrectLights was off, so the render
// hook below must scale point/spot lights too; skipping them left every
// brazier/torch PI-times (~3.1x) darker than the original game.
const lightsChunk = ThreeModule.ShaderChunk && ThreeModule.ShaderChunk.lights_pars_begin;
if (lightsChunk && lightsChunk.indexOf('getDistanceAttenuation') >= 0) {
  ThreeModule.ShaderChunk.lights_pars_begin = lightsChunk.replace(
    'float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );\n\tif ( cutoffDistance > 0.0 ) {\n\t\tdistanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );\n\t}\n\treturn distanceFalloff;',
    'if ( cutoffDistance > 0.0 && decayExponent > 0.0 ) {\n\t\treturn pow( saturate( - lightDistance / cutoffDistance + 1.0 ), decayExponent );\n\t}\n\treturn 1.0;'
  );
}
const renderWithModernLights = ThreeModule.WebGLRenderer.prototype.render;
ThreeModule.WebGLRenderer.prototype.render = function (scene, camera) {
  const entry = scene && typeof scene === 'object' ? lightsFor(scene) : null;
  if (entry) for (let i = 0; i < entry.lights.length; i++) {
    const light = entry.lights[i];
    const intensity = light.intensity;
    entry.intensities[i] = intensity;
    // RectAreaLight / LightProbe were never PI-scaled in r147; every other light was.
    const gain = light.userData && light.userData.lookGain != null ? light.userData.lookGain : 1; // cinematic look (cinematic.js)
        if (!light.isRectAreaLight && !light.isLightProbe && intensity !== 0 && Number.isFinite(intensity)) light.intensity = intensity * Math.PI * gain;
  }
  try {
    return renderWithModernLights.call(this, scene, camera);
  } finally {
    if (entry) for (let i = 0; i < entry.lights.length; i++) {
      entry.lights[i].intensity = entry.intensities[i];
    }
  }
};

// r151+ Box3.expandByObject() measures a SkinnedMesh in its CURRENT animated
// pose (and an InstancedMesh as the union of all instances). r147 used the
// bind-pose geometry box. The palace derives its whole scale from the hero
// box (H = hero height), so r187 built a ~2% smaller, pose-dependent hall and
// moved every brazier light. Restore r147 semantics for non-precise boxes.
{
  const Box3P = ThreeModule.Box3.prototype;
  const modernExpand = Box3P.expandByObject;
  const _b = new ThreeModule.Box3();
  Box3P.expandByObject = function (object, precise = false) {
    if (precise || !(object.isSkinnedMesh || object.isInstancedMesh || object.isBatchedMesh) || !object.geometry) return modernExpand.call(this, object, precise);
    object.updateWorldMatrix(false, false);
    const g = object.geometry;
    if (g.boundingBox === null) g.computeBoundingBox();
    _b.copy(g.boundingBox).applyMatrix4(object.matrixWorld);
    this.union(_b);
    const children = object.children;
    for (let i = 0, l = children.length; i < l; i++) this.expandByObject(children[i], precise);
    return this;
  };
}
window.THREE = THREE;
window.__SIN_THREE_VERSION__ = ThreeModule.REVISION;

// Version same-origin GLB / GLTF / JSON / BIN / WASM fetches going through
// FileLoader so a deploy cannot be held by a cached unversioned model URL.
// Do NOT wrap TextureLoader or ImageLoader and do NOT stamp image / data
// URLs: after #48 those wrappers were the prime suspect for the iPhone
// photo-sky going pitch black from the first outdoor frame (the sky is a
// data: JPEG; the blood sky and skyline rings are .jpeg/.jpg). JS cache
// busting is already handled by fetch({cache:'no-store'}).
(function hookSinAssetUrls() {
  function sinAssetUrl(url) {
    if (typeof url !== 'string' || !url) return url;
    if (/^(data:|blob:)/i.test(url)) return url;
    if (/jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|esm\.sh|googleapis\.com|gstatic\.com/i.test(url)) return url;
    if (/[?&](?:v|sin|fix)=/.test(url)) return url;
    // Only model / data manifests. Images, HDR, audio, etc. pass through.
    if (!/\.(glb|gltf|json|bin|wasm)(?:$|\?)/i.test(url)) return url;
    const b = (typeof window !== 'undefined' && window.__SIN_BUILD__) || 'dev';
    const sep = url.indexOf('?') >= 0 ? '&' : '?';
    return url + sep + 'v=' + encodeURIComponent(b);
  }
  window.__sinAsset = sinAssetUrl;
  function wrap(proto) {
    if (!proto || proto.__sinAssetHooked) return;
    const orig = proto.load;
    proto.load = function (url, onLoad, onProgress, onError) {
      return orig.call(this, sinAssetUrl(url), onLoad, onProgress, onError);
    };
    proto.__sinAssetHooked = true;
  }
  wrap(ThreeModule.FileLoader && ThreeModule.FileLoader.prototype);
})();


// Bypass Safari / Fastly HTTP caches when loading game scripts. A stale
// index.html that still points at an old ?v= would otherwise keep serving
// the previously cached JS body. fetch({cache:'no-store'}) always hits the
// origin body (GitHub Pages serves the same file for any query string).
async function bootLegacyScripts() {
  const scripts = [...document.querySelectorAll('script[data-legacy-script]')];
  for (const original of scripts) {
    if (original.dataset.src) {
      const url = new URL(original.dataset.src, document.baseURI).href;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`تعذر تحميل السكربت: ${url} (${res.status})`);
      const script = document.createElement('script');
      script.textContent = await res.text();
      document.body.appendChild(script);
    } else {
      const script = document.createElement('script');
      script.textContent = original.textContent;
      document.body.appendChild(script);
      script.remove();
    }
  }
}

bootLegacyScripts().catch(error => {
  console.error('[Three.js r187 compatibility bootstrap]', error);
  const status = document.getElementById('st');
  const message = document.getElementById('msg');
  if (status) status.textContent = 'تعذر تهيئة محرك الرسوميات.';
  if (message) message.textContent = String(error?.stack || error);
});
