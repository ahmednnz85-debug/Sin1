#!/usr/bin/env node
/**
 * Static runtime-vs-file override catalog + broken-metal proposal table.
 * Reads assets-audit-data.json and greps source for known mutation sites.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audit = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets-audit-data.json'), 'utf8'));

const overrides = [
  {
    id: 'tuneGLTF-metal-clamp',
    where: 'palaceInterior.js tuneGLTF',
    fileValue: 'metallicFactor as authored (often 1.0)',
    runtimeValue: 'metalness=0.3, roughness=0.5 when metalness>=0.99 && !metalnessMap',
    cause: 'old main code (pre-engine-upgrade look patch)',
    action: 'REMOVE — restore file values'
  },
  {
    id: 'palaceMat-metal-clamp',
    where: 'palaceInterior.js palaceMat',
    fileValue: 'authored metal/rough + doubleSided',
    runtimeValue: 'metalness/roughness clamp + side=DoubleSide + envMap + envMapIntensity=0.6',
    cause: 'old main code',
    action: 'REMOVE inventiveness — clone + colorSpace only; side from file'
  },
  {
    id: 'palaceEnv-final-traverse',
    where: 'palaceInterior.js build() final traverse',
    fileValue: 'no envMap in GLB',
    runtimeValue: 'assign palaceEnv @ intensity 0.45 if missing',
    cause: 'old main code',
    action: 'REMOVE from GLB-sourced materials'
  },
  {
    id: 'makePalaceEnv',
    where: 'palaceInterior.js makePalaceEnv',
    fileValue: 'n/a (not in assets)',
    runtimeValue: 'synthetic PMREM assigned onto materials',
    cause: 'old main code',
    action: 'Do not assign onto authored GLB materials; keep only if a procedural mesh historically used it — report'
  },
  {
    id: 'door-doubleSide',
    where: 'palaceInterior.js entry door clone',
    fileValue: 'doubleSided from GLB (often true)',
    runtimeValue: 'force DoubleSide',
    cause: 'old main code',
    action: 'Use GLTFLoader/file doubleSided'
  },
  {
    id: 'ceiling-invented-pbr',
    where: 'palaceInterior.js ceiling plane',
    fileValue: 'ceiling image only',
    runtimeValue: 'roughness=0.62 metalness=0.16 emissive invented',
    cause: 'old main code (procedural mesh)',
    action: 'KEEP as code-authored procedural (not a GLB) — listed separately'
  },
  {
    id: 'carpet-invented-pbr',
    where: 'palaceInterior.js carpet',
    fileValue: 'carpet image',
    runtimeValue: 'roughness=0.84 metalness=0.02',
    cause: 'old main code (procedural)',
    action: 'KEEP procedural; not a GLB material'
  },
  {
    id: 'srgb-on-maps',
    where: 'palaceInterior.js srgb() / tuneGLTF',
    fileValue: 'baseColor/emissive sRGB; normal/mr/ao linear',
    runtimeValue: 'srgb() on map/emissive; other maps anisotropy only (linear not forced)',
    cause: 'engine upgrade colorSpace + incomplete linear tagging',
    action: 'Set explicit colorSpace per slot'
  },
  {
    id: 'three-compat-colormanagement',
    where: 'three-compat.js',
    fileValue: 'n/a',
    runtimeValue: 'ColorManagement.enabled=false; dir/hemi ×π; point falloff r147',
    cause: 'engine upgrade migration (intentional r147 parity)',
    action: 'KEEP for original look under r187 units'
  },
  {
    id: 'light-cache-1s',
    where: 'three-compat.js lightsFor',
    fileValue: 'authored light intensity',
    runtimeValue: 'new hemi/ambient can miss ×π for up to 1s',
    cause: 'performance patch after engine upgrade',
    action: 'Rebuild promptly (not a value invent; fidelity)'
  },
  {
    id: 'lighting-fix-PR40',
    where: 'cursor/palace-lighting-zone-5ced (NOT on this branch)',
    fileValue: 'main hall hemi 0.18 / ambient 0.035 / metal clamp skipped with mrMap',
    runtimeValue: 'raised hemi/ambient, soften metal, brighter PMREM, palace fog zone',
    cause: 'recent lighting fix',
    action: 'NOT present on asset-fidelity branch (based on main)'
  },
  {
    id: 'wings-clone-metal',
    where: 'wings.js column extract / materials',
    fileValue: 'authored GLB factors',
    runtimeValue: 'clone as-is (usually); some procedural mats invent metalness 0.01–0.18',
    cause: 'old main code',
    action: 'GLB clones: no invent; procedural mats listed as code-authored'
  }
];

const brokenCandidates = [];
for (const g of audit.glbs) {
  for (const m of g.materials) {
    const metal = m.metallicFactor;
    const hasMr = !!m.metallicRoughnessTexture;
    const hasMap = !!m.baseColorTexture;
    if (metal >= 0.85) {
      brokenCandidates.push({
        file: g.path,
        material: m.name,
        metallicFactor: metal,
        roughnessFactor: m.roughnessFactor,
        hasBaseColorTexture: hasMap,
        hasMetallicRoughnessTexture: hasMr,
        doubleSided: m.doubleSided,
        risk: hasMr
          ? 'Factor×mrMap may still sample high metal → dark without IBL'
          : 'Full metal, no mrMap → black without envMap',
        proposedSmallestFix: hasMr
          ? 'Per-material: leave factors; add ONLY a tiny local envMapIntensity or leave as-authored pending approval'
          : 'Per-material: optional metalnessFactor override table (default = file 1.0)'
      });
    }
  }
}

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Runtime vs file — Sin1</title>
<style>
body{margin:0;background:#0e0c0a;color:#f3e6cf;font:14px/1.45 system-ui;padding:16px}
h1{color:#e1b76f} table{border-collapse:collapse;width:100%;font-size:12px}
th,td{border:1px solid #3a2f22;padding:6px;vertical-align:top;text-align:left}
th{background:#241c14} .nav a{color:#e1b76f;margin-right:12px}
.scroll{overflow:auto} code{color:#ffd9a0}
</style></head><body>
<div class="nav"><a href="assets-audit.html">assets-audit</a> <a href="compare.html">compare</a> <a href="index.html">game</a></div>
<h1>Runtime vs file</h1>
<p>Catalog of code paths that change authored GLB/image values. Asset-fidelity branch removes inventiveness; default remains the file.</p>
<h2>Known overrides</h2>
<div class="scroll"><table>
<thead><tr><th>id</th><th>where</th><th>file value</th><th>runtime value</th><th>cause</th><th>action</th></tr></thead>
<tbody>
${overrides
  .map(
    (o) =>
      `<tr><td><code>${o.id}</code></td><td>${o.where}</td><td>${o.fileValue}</td><td>${o.runtimeValue}</td><td>${o.cause}</td><td>${o.action}</td></tr>`
  )
  .join('')}
</tbody></table></div>
<h2>Authored high-metalness materials (need approval if black)</h2>
<p>${brokenCandidates.length} materials with metallicFactor ≥ 0.85. Default = file value. Smallest per-material fixes proposed only — no global soften.</p>
<div class="scroll"><table>
<thead><tr><th>file</th><th>material</th><th>metal</th><th>rough</th><th>map</th><th>mrMap</th><th>risk</th><th>proposed fix (awaiting approval)</th></tr></thead>
<tbody>
${brokenCandidates
  .map(
    (b) =>
      `<tr><td>${b.file}</td><td>${b.material}</td><td>${b.metallicFactor}</td><td>${b.roughnessFactor}</td><td>${b.hasBaseColorTexture}</td><td>${b.hasMetallicRoughnessTexture}</td><td>${b.risk}</td><td>${b.proposedSmallestFix}</td></tr>`
  )
  .join('')}
</tbody></table></div>
<script src="assets-audit-data.json" type="application/json" id="audit"></script>
</body></html>`;

fs.writeFileSync(path.join(ROOT, 'runtime-diff.html'), html);
fs.writeFileSync(
  path.join(ROOT, 'runtime-diff-data.json'),
  JSON.stringify({ overrides, brokenCandidates, generatedAt: new Date().toISOString() }, null, 2)
);
console.log(JSON.stringify({ overrides: overrides.length, brokenCandidates: brokenCandidates.length }, null, 2));
