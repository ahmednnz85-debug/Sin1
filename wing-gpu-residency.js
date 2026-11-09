/* GPU residency for streamed palace regions. Geometry, material and texture
   CPU data stays intact; Three.js recreates their GPU handles when a region is
   shown again. Shared resources are released only when no visible region uses
   them. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  if (root) root.SinWingGpuResidency = factory;
})(typeof window !== 'undefined' ? window : null, function createWingGpuResidency() {
  'use strict';

  const textureKeys = [
    'map', 'alphaMap', 'aoMap', 'bumpMap', 'normalMap', 'roughnessMap',
    'metalnessMap', 'emissiveMap', 'specularMap', 'envMap', 'lightMap',
    'displacementMap', 'clearcoatMap', 'clearcoatRoughnessMap', 'clearcoatNormalMap',
    'transmissionMap', 'thicknessMap', 'iridescenceMap', 'iridescenceThicknessMap',
    'anisotropyMap', 'sheenColorMap', 'sheenRoughnessMap', 'specularIntensityMap',
    'specularColorMap', 'gradientMap', 'matcap'
  ];
  let disposed = new WeakMap();
  let syncCount = 0;
  let totals = { geometries: 0, materials: 0, textures: 0, instances: 0 };

  function sets() {
    return { geometries: new Set(), materials: new Set(), textures: new Set(), instances: new Set() };
  }
  function scanUniform(value, textures, seen) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return;
    if (value.isTexture) { textures.add(value); return; }
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { value.forEach(v => scanUniform(v, textures, seen)); return; }
    if (Object.prototype.hasOwnProperty.call(value, 'value')) {
      scanUniform(value.value, textures, seen);
      return;
    }
    // Shader uniforms may contain small structs/arrays, but do not recurse into
    // arbitrary renderer objects or images.
    if (Object.getPrototypeOf(value) === Object.prototype) {
      Object.keys(value).forEach(k => scanUniform(value[k], textures, seen));
    }
  }
  function collectMaterial(material, out) {
    if (!material) return;
    const list = Array.isArray(material) ? material : [material];
    list.forEach(m => {
      if (!m || typeof m !== 'object') return;
      out.materials.add(m);
      textureKeys.forEach(k => { if (m[k] && m[k].isTexture) out.textures.add(m[k]); });
      if (m.uniforms) scanUniform(m.uniforms, out.textures, new WeakSet());
    });
  }
  function collectObject(object, out) {
    if (object.geometry) out.geometries.add(object.geometry);
    collectMaterial(object.material, out);
    if (object.isInstancedMesh) out.instances.add(object);
    if (object.skeleton && object.skeleton.boneTexture && object.skeleton.boneTexture.isTexture) {
      out.textures.add(object.skeleton.boneTexture);
    }
  }
  function walk(node, out, respectVisibility, parentVisible) {
    if (!node) return;
    const visible = parentVisible && node.visible !== false;
    if (respectVisibility && !visible) return;
    collectObject(node, out);
    (node.children || []).forEach(child => walk(child, out, respectVisibility, visible));
  }
  function merge(into, from) {
    Object.keys(into).forEach(k => from[k].forEach(value => into[k].add(value)));
  }
  function releaseUnused(candidates, active) {
    let released = 0;
    Object.keys(candidates).forEach(kind => {
      // Materials/program variants are small and cheap to retain. Disposing
      // them would force shader recompilation at the next doorway and re-create
      // frame hitches; geometry buffers and texture storage are the real bulk.
      if (kind === 'materials') return;
      candidates[kind].forEach(resource => {
        if (active[kind].has(resource)) return;
        if (disposed.get(resource) === true) return;
        // Render-target / GPU-only textures (environment maps, shadow maps)
        // cannot be re-uploaded from CPU data, so they are never released.
        if (kind === 'textures' && (resource.isRenderTargetTexture || resource.isFramebufferTexture || !resource.image)) return;
        if (typeof resource.dispose === 'function') {
          resource.dispose();
          disposed.set(resource, true);
          totals[kind]++;
          released++;
        }
      });
    });
    return released;
  }

  function sync(scene, wingRoot, regionGroups, preparedIds) {
    const keep = preparedIds instanceof Set ? preparedIds : null;
    const groups = regionGroups || new Map();
    const regionSet = new Set();
    groups.forEach(group => { if (group) regionSet.add(group); });
    const active = sets();
    const candidates = sets();
    const activeIds = [];

    // Retain every resource used by visible non-wing scene objects.
    if (scene) (scene.children || []).forEach(child => {
      if (child !== wingRoot) walk(child, active, true, true);
    });
    // Palace-wide floors/walls and shared architecture sit directly below the
    // wing root rather than inside an individual region group.
    if (wingRoot) (wingRoot.children || []).forEach(child => {
      if (!regionSet.has(child)) walk(child, active, true, true);
    });

    groups.forEach((group, id) => {
      if (!group) return;
      if (group.visible !== false) {
        activeIds.push(id);
        walk(group, active, true, true);
      } else if (keep && keep.has(id)) {
        // Prepared (camera may look at it any moment): keep GPU-resident.
        walk(group, active, false, true);
      } else {
        walk(group, candidates, false, true);
      }
    });

    Object.keys(active).forEach(kind => active[kind].forEach(resource => disposed.set(resource, false)));
    const released = releaseUnused(candidates, active);
    syncCount++;
    return {
      syncs: syncCount,
      activeRegions: activeIds,
      resident: {
        geometries: active.geometries.size,
        materials: active.materials.size,
        textures: active.textures.size,
        instancedMeshes: active.instances.size
      },
      releasedThisSync: released,
      releasedTotal: Object.assign({}, totals)
    };
  }
  function reset() {
    disposed = new WeakMap();
    syncCount = 0;
    totals = { geometries: 0, materials: 0, textures: 0, instances: 0 };
  }
  return { sync, reset };
});
