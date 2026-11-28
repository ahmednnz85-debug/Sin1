(function (root) {
  'use strict';
  const areas = root.SinAreas;
  if (!areas) return;
  const stage = 'vfx-lab';
  const spawn = { x: 0, y: 0, z: -1.2, yaw: 0 };
  const entry = new URL('vfx-lab/laboratory.mjs', document.baseURI).href;
  areas.group(stage, 'مختبر المؤثرات', 'Effects Laboratory', 90);
  areas.chapter({
    stage, order: 90, ar: 'مختبر المؤثرات', en: 'Effects Laboratory',
    sandbox: area => import(entry).then(module => module.open(area))
  }, 'vfx-lab/area.js');
  areas.register({
    id: 'VFX-LAB', stage, group: stage, ar: 'مختبر مؤثرات القتال', en: 'Combat VFX Laboratory', spawn
  }, 'vfx-lab/area.js');
})(window);
