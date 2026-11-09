import * as ThreeModule from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const THREE = { ...ThreeModule, GLTFLoader, DRACOLoader };
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
  if (!entry || entry.dirty) {
    const lights = [];
    if (scene && scene.traverse) {
      scene.traverse(object => {
        if (object.isLight && Number.isFinite(object.intensity)) lights.push(object);
      });
    }
    entry = { dirty: false, lights, intensities: new Array(lights.length) };
    lightCacheByScene.set(scene, entry);
  }
  return entry;
}
// Point/spot attenuation itself changed in modern Three.js and cannot be
// restored by intensity scaling alone.
const renderWithModernLights = ThreeModule.WebGLRenderer.prototype.render;
ThreeModule.WebGLRenderer.prototype.render = function (scene, camera) {
  const entry = scene && typeof scene === 'object' ? lightsFor(scene) : null;
  if (entry) for (let i = 0; i < entry.lights.length; i++) {
    const light = entry.lights[i];
    const intensity = light.intensity;
    entry.intensities[i] = intensity;
    if (intensity !== 0 && Number.isFinite(intensity)) light.intensity = intensity * Math.PI;
  }
  try {
    return renderWithModernLights.call(this, scene, camera);
  } finally {
    if (entry) for (let i = 0; i < entry.lights.length; i++) {
      entry.lights[i].intensity = entry.intensities[i];
    }
  }
};

window.THREE = THREE;
window.__SIN_THREE_VERSION__ = ThreeModule.REVISION;

async function bootLegacyScripts() {
  const scripts = [...document.querySelectorAll('script[data-legacy-script]')];
  for (const original of scripts) {
    if (original.dataset.src) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = original.dataset.src;
        script.async = false;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`تعذر تحميل السكربت: ${script.src}`));
        document.body.appendChild(script);
      });
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
