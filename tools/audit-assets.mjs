#!/usr/bin/env node
/**
 * Exhaustive GLB + image audit. Writes JSON used by assets-audit.html.
 * No sampling — every file under assets/ and ارضيات وسقوف/.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_JSON = path.join(ROOT, 'assets-audit-data.json');
const OUT_HTML = path.join(ROOT, 'assets-audit.html');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.ktx2', '.basis']);
const ROOTS = ['assets', 'ارضيات وسقوف'].map((r) => path.join(ROOT, r));

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

function parseGlb(buf) {
  if (buf.length < 20 || buf.toString('utf8', 0, 4) !== 'glTF') {
    throw new Error('not glTF binary');
  }
  const version = buf.readUInt32LE(4);
  const length = buf.readUInt32LE(8);
  let offset = 12;
  let json = null;
  const bins = [];
  while (offset + 8 <= buf.length && offset < length) {
    const chunkLen = buf.readUInt32LE(offset);
    const chunkType = buf.readUInt32LE(offset + 4);
    offset += 8;
    const chunk = buf.subarray(offset, offset + chunkLen);
    offset += chunkLen;
    if (chunkType === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (chunkType === 0x004e4942) bins.push(chunk);
  }
  return { version, json, bins };
}

function texInfo(json, index) {
  if (index == null || !json.textures || !json.textures[index]) return null;
  const t = json.textures[index];
  const img = t.source != null && json.images ? json.images[t.source] : null;
  const samp = t.sampler != null && json.samplers ? json.samplers[t.sampler] : null;
  const ext = (t.extensions && t.extensions.KHR_texture_transform) || null;
  let imgName = null;
  if (img) {
    if (img.uri) imgName = img.uri;
    else if (img.bufferView != null) imgName = `bufferView#${img.bufferView} (${img.mimeType || 'embedded'})`;
  }
  return {
    textureIndex: index,
    image: imgName,
    mimeType: img && img.mimeType,
    sampler: samp || null,
    khrTextureTransform: ext
  };
}

function materialReport(json, mat, idx) {
  const pbr = mat.pbrMetallicRoughness || {};
  const exts = mat.extensions || {};
  const baseTex = pbr.baseColorTexture ? texInfo(json, pbr.baseColorTexture.index) : null;
  const mrTex = pbr.metallicRoughnessTexture ? texInfo(json, pbr.metallicRoughnessTexture.index) : null;
  const nrm = mat.normalTexture
    ? { ...texInfo(json, mat.normalTexture.index), scale: mat.normalTexture.scale == null ? 1 : mat.normalTexture.scale }
    : null;
  const occ = mat.occlusionTexture
    ? {
        ...texInfo(json, mat.occlusionTexture.index),
        strength: mat.occlusionTexture.strength == null ? 1 : mat.occlusionTexture.strength
      }
    : null;
  const emi = mat.emissiveTexture ? texInfo(json, mat.emissiveTexture.index) : null;
  const khrEmissiveStrength =
    (exts.KHR_materials_emissive_strength && exts.KHR_materials_emissive_strength.emissiveStrength) ?? null;
  const otherKhr = Object.keys(exts).filter((k) => k !== 'KHR_materials_emissive_strength');
  return {
    index: idx,
    name: mat.name || `(material ${idx})`,
    baseColorFactor: pbr.baseColorFactor || [1, 1, 1, 1],
    baseColorTexture: baseTex,
    metallicFactor: pbr.metallicFactor == null ? 1 : pbr.metallicFactor,
    roughnessFactor: pbr.roughnessFactor == null ? 1 : pbr.roughnessFactor,
    metallicRoughnessTexture: mrTex,
    normalTexture: nrm,
    occlusionTexture: occ,
    emissiveFactor: mat.emissiveFactor || [0, 0, 0],
    emissiveTexture: emi,
    KHR_materials_emissive_strength: khrEmissiveStrength,
    otherKHR: otherKhr.map((k) => ({ name: k, value: exts[k] })),
    alphaMode: mat.alphaMode || 'OPAQUE',
    alphaCutoff: mat.alphaCutoff == null ? 0.5 : mat.alphaCutoff,
    doubleSided: !!mat.doubleSided
  };
}

function meshAttrs(json) {
  const out = [];
  (json.meshes || []).forEach((mesh, mi) => {
    (mesh.primitives || []).forEach((prim, pi) => {
      const attrs = Object.keys(prim.attributes || {});
      out.push({
        mesh: mesh.name || `mesh${mi}`,
        primitive: pi,
        material: prim.material,
        attributes: attrs,
        hasCOLOR_0: attrs.includes('COLOR_0'),
        uvSets: attrs.filter((a) => /^TEXCOORD_/.test(a)),
        mode: prim.mode == null ? 4 : prim.mode
      });
    });
  });
  return out;
}

function nodeReport(json) {
  return (json.nodes || []).map((n, i) => ({
    index: i,
    name: n.name || `(node ${i})`,
    translation: n.translation || null,
    rotation: n.rotation || null,
    scale: n.scale || null,
    matrix: n.matrix ? true : false,
    mesh: n.mesh,
    camera: n.camera,
    skin: n.skin,
    children: n.children || []
  }));
}

function auditGlb(filePath) {
  const buf = fs.readFileSync(filePath);
  const { version, json } = parseGlb(buf);
  const mats = (json.materials || []).map((m, i) => materialReport(json, m, i));
  const extensionsUsed = json.extensionsUsed || [];
  const extensionsRequired = json.extensionsRequired || [];
  const lights =
    (json.extensions && json.extensions.KHR_lights_punctual && json.extensions.KHR_lights_punctual.lights) ||
    [];
  const cameras = json.cameras || [];
  const animations = (json.animations || []).map((a, i) => ({
    index: i,
    name: a.name || `(anim ${i})`,
    channels: (a.channels || []).length,
    samplers: (a.samplers || []).length
  }));
  return {
    path: rel(filePath),
    kind: 'glb',
    bytes: buf.length,
    version,
    generator: json.asset && json.asset.generator,
    materials: mats,
    meshes: meshAttrs(json),
    nodes: nodeReport(json),
    embeddedLights: lights,
    cameras: cameras.map((c, i) => ({ index: i, type: c.type, name: c.name })),
    animations,
    extensionsUsed,
    extensionsRequired,
    images: (json.images || []).map((im, i) => ({
      index: i,
      uri: im.uri || null,
      mimeType: im.mimeType || null,
      bufferView: im.bufferView,
      colorSpaceHint: 'depends on slot (baseColor/emissive=sRGB; normal/mr/ao=linear)'
    }))
  };
}

function readImageMeta(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  let width = null;
  let height = null;
  let format = ext.slice(1);
  try {
    if (ext === '.png' && buf[0] === 0x89) {
      width = buf.readUInt32BE(16);
      height = buf.readUInt32BE(20);
      format = 'png';
    } else if ((ext === '.jpg' || ext === '.jpeg') && buf[0] === 0xff && buf[1] === 0xd8) {
      format = 'jpeg';
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) break;
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
          height = buf.readUInt16BE(i + 5);
          width = buf.readUInt16BE(i + 7);
          break;
        }
        i += 2 + len;
      }
    } else if (ext === '.webp' && buf.toString('utf8', 0, 4) === 'RIFF') {
      format = 'webp';
      if (buf.toString('utf8', 12, 16) === 'VP8 ') {
        width = buf.readUInt16LE(26) & 0x3fff;
        height = buf.readUInt16LE(28) & 0x3fff;
      } else if (buf.toString('utf8', 12, 16) === 'VP8L') {
        const b = buf.readUInt32LE(21);
        width = (b & 0x3fff) + 1;
        height = ((b >> 14) & 0x3fff) + 1;
      } else if (buf.toString('utf8', 12, 16) === 'VP8X') {
        width = 1 + buf[24] + (buf[25] << 8) + (buf[26] << 16);
        height = 1 + buf[27] + (buf[28] << 8) + (buf[29] << 16);
      }
    }
  } catch (_) {}
  return { path: rel(filePath), kind: 'image', bytes: buf.length, width, height, format };
}

function slotColorSpace(slot) {
  if (/baseColor|emissive|diffuse|map$/i.test(slot) && !/metal|rough|normal|occlusion|ao/i.test(slot)) {
    return 'sRGB';
  }
  if (/normal|metallicRoughness|occlusion|ao|roughness|metalness/i.test(slot)) return 'linear';
  return 'unknown';
}

function buildHtml(data) {
  const glbs = data.glbs;
  const images = data.images;
  const rowsGlb = glbs
    .map((g) => {
      const mats = (g.materials || [])
        .map((m) => {
          const khr = m.otherKHR.length
            ? m.otherKHR.map((k) => `<code>${k.name}</code>`).join(', ')
            : '—';
          return `<tr>
          <td>${escape(m.name)}</td>
          <td><code>${JSON.stringify(m.baseColorFactor)}</code></td>
          <td>${m.baseColorTexture ? escape(m.baseColorTexture.image) : '—'}</td>
          <td>${m.metallicFactor}</td>
          <td>${m.roughnessFactor}</td>
          <td>${m.metallicRoughnessTexture ? escape(m.metallicRoughnessTexture.image) : '—'}</td>
          <td>${m.normalTexture ? escape(m.normalTexture.image) + ' ×' + m.normalTexture.scale : '—'}</td>
          <td>${m.occlusionTexture ? escape(m.occlusionTexture.image) + ' s=' + m.occlusionTexture.strength : '—'}</td>
          <td><code>${JSON.stringify(m.emissiveFactor)}</code></td>
          <td>${m.emissiveTexture ? escape(m.emissiveTexture.image) : '—'}</td>
          <td>${m.KHR_materials_emissive_strength ?? '—'}</td>
          <td>${khr}</td>
          <td>${m.alphaMode}${m.alphaMode === 'MASK' ? '@' + m.alphaCutoff : ''}</td>
          <td>${m.doubleSided}</td>
        </tr>`;
        })
        .join('');
      const meshBits = (g.meshes || [])
        .map(
          (p) =>
            `${escape(p.mesh)}#${p.primitive}: COLOR_0=${p.hasCOLOR_0} UVs=${p.uvSets.join('|') || 'none'} mat=${p.material}`
        )
        .join('<br>');
      const nodesWithXform = (g.nodes || []).filter((n) => n.translation || n.rotation || n.scale || n.matrix);
      const anims = (g.animations || []).map((a) => escape(a.name)).join(', ') || '—';
      const lights = g.embeddedLights.length ? JSON.stringify(g.embeddedLights) : '—';
      const cams = g.cameras.length ? JSON.stringify(g.cameras) : '—';
      return `<section class="card" id="${escapeAttr(g.path)}">
        <h2>${escape(g.path)} <small>${(g.bytes / 1e6).toFixed(2)} MB · glTF ${g.version}</small></h2>
        <p>generator: ${escape(g.generator || '—')} · extensions: ${(g.extensionsUsed || []).map(escape).join(', ') || '—'}</p>
        <p>animations: ${anims} · embedded lights: ${escape(lights)} · cameras: ${escape(cams)}</p>
        <p>primitives: ${meshBits || '—'}</p>
        <p>nodes with TRS/matrix: ${nodesWithXform.length} / ${(g.nodes || []).length}</p>
        <div class="scroll"><table>
          <thead><tr>
            <th>material</th><th>baseColorFactor</th><th>baseColorTexture</th>
            <th>metal</th><th>rough</th><th>mrMap</th><th>normal</th><th>occlusion</th>
            <th>emissive</th><th>emissiveMap</th><th>emiStrength</th><th>other KHR</th>
            <th>alpha</th><th>doubleSided</th>
          </tr></thead>
          <tbody>${mats || '<tr><td colspan="14">no materials</td></tr>'}</tbody>
        </table></div>
      </section>`;
    })
    .join('\n');

  const imgRows = images
    .map((im) => {
      const used = (data.imageUsage[im.path] || []).map((u) => `${u.glb} → ${u.material}.${u.slot} (${u.colorSpace})`);
      return `<tr>
        <td>${escape(im.path)}</td>
        <td>${im.width || '?'}×${im.height || '?'}</td>
        <td>${im.format}</td>
        <td>${(im.bytes / 1024).toFixed(1)} KB</td>
        <td>${used.length ? used.map(escape).join('<br>') : '<em>not referenced by audited GLB uri (may be loaded by code path / embedded)</em>'}</td>
      </tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Sin1 — full asset audit</title>
<style>
  :root{--bg:#0e0c0a;--fg:#f3e6cf;--muted:#a89478;--line:#3a2f22;--accent:#e1b76f}
  body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif;padding:16px}
  h1{font-size:22px;margin:0 0 8px;color:var(--accent)}
  h2{font-size:16px;margin:0 0 8px;word-break:break-all}
  .meta{color:var(--muted);margin-bottom:18px}
  .toc a{color:var(--accent);display:block;padding:2px 0;text-decoration:none;font-size:12px;word-break:break-all}
  .card{border:1px solid var(--line);border-radius:10px;padding:12px;margin:14px 0;background:#15110d}
  .scroll{overflow:auto;-webkit-overflow-scrolling:touch}
  table{border-collapse:collapse;min-width:1100px;width:100%;font-size:12px}
  th,td{border:1px solid var(--line);padding:6px 8px;vertical-align:top;text-align:left}
  th{background:#241c14;position:sticky;top:0}
  code{font-size:11px;color:#ffd9a0}
  small{color:var(--muted);font-weight:400}
  .nav{position:sticky;top:0;z-index:5;background:rgba(14,12,10,.94);padding:8px 0;border-bottom:1px solid var(--line);margin-bottom:12px}
  .nav a{color:var(--accent);margin-right:12px}
</style>
</head>
<body>
  <div class="nav">
    <a href="#glbs">GLBs (${glbs.length})</a>
    <a href="#images">Images (${images.length})</a>
    <a href="compare.html">compare.html</a>
    <a href="index.html">game</a>
  </div>
  <h1>Full asset audit (no sampling)</h1>
  <p class="meta">Generated ${escape(data.generatedAt)} · ${glbs.length} GLBs · ${images.length} images · primary reference = file values</p>
  <p class="meta">Color space rule: baseColor + emissive = <strong>sRGB</strong>; normal + metallicRoughness + occlusion = <strong>linear</strong>.</p>
  <h2 id="glbs">GLB materials</h2>
  <div class="toc">${glbs.map((g) => `<a href="#${escapeAttr(g.path)}">${escape(g.path)}</a>`).join('')}</div>
  ${rowsGlb}
  <h2 id="images">Image files</h2>
  <div class="scroll"><table>
    <thead><tr><th>path</th><th>resolution</th><th>format</th><th>size</th><th>used by (slot → colorSpace)</th></tr></thead>
    <tbody>${imgRows}</tbody>
  </table></div>
</body>
</html>`;
}

function escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(s) {
  return escape(s).replace(/'/g, '&#39;');
}

function main() {
  const files = [];
  for (const root of ROOTS) walk(root, files);
  files.sort((a, b) => a.localeCompare(b));

  const glbs = [];
  const images = [];
  const errors = [];
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    try {
      if (ext === '.glb' || ext === '.gltf') {
        if (ext === '.gltf') {
          // rare; still record
          const json = JSON.parse(fs.readFileSync(f, 'utf8'));
          glbs.push({
            path: rel(f),
            kind: 'gltf',
            bytes: fs.statSync(f).size,
            version: json.asset && json.asset.version,
            materials: (json.materials || []).map((m, i) => materialReport(json, m, i)),
            meshes: meshAttrs(json),
            nodes: nodeReport(json),
            embeddedLights: [],
            cameras: [],
            animations: [],
            extensionsUsed: json.extensionsUsed || [],
            extensionsRequired: json.extensionsRequired || [],
            images: json.images || []
          });
        } else glbs.push(auditGlb(f));
      } else if (IMAGE_EXT.has(ext)) images.push(readImageMeta(f));
    } catch (e) {
      errors.push({ path: rel(f), error: String(e && e.message ? e.message : e) });
    }
  }

  // Map image URI usage from GLBs (external only; embedded noted separately)
  const imageUsage = {};
  for (const g of glbs) {
    for (const m of g.materials || []) {
      const slots = [
        ['baseColorTexture', m.baseColorTexture, 'sRGB'],
        ['metallicRoughnessTexture', m.metallicRoughnessTexture, 'linear'],
        ['normalTexture', m.normalTexture, 'linear'],
        ['occlusionTexture', m.occlusionTexture, 'linear'],
        ['emissiveTexture', m.emissiveTexture, 'sRGB']
      ];
      for (const [slot, info, cs] of slots) {
        if (!info || !info.image || String(info.image).startsWith('bufferView')) continue;
        // resolve relative to glb folder
        const base = path.posix.dirname(g.path);
        let key = info.image;
        if (!key.startsWith('data:') && !key.includes('://')) {
          key = path.posix.normalize(path.posix.join(base, key));
        }
        (imageUsage[key] || (imageUsage[key] = [])).push({
          glb: g.path,
          material: m.name,
          slot,
          colorSpace: cs
        });
      }
    }
  }

  // Also note code-loaded images (index/palace/wings file lists) as unknown-slot until runtime
  const data = {
    generatedAt: new Date().toISOString(),
    roots: ROOTS.map((r) => rel(r)),
    glbCount: glbs.length,
    imageCount: images.length,
    errors,
    glbs,
    images,
    imageUsage,
    colorSpaceRules: {
      baseColor: 'sRGB',
      emissive: 'sRGB',
      normal: 'linear',
      metallicRoughness: 'linear',
      occlusion: 'linear'
    }
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(data));
  fs.writeFileSync(OUT_HTML, buildHtml(data));
  console.log(
    JSON.stringify(
      {
        ok: true,
        glbs: glbs.length,
        images: images.length,
        errors: errors.length,
        outHtml: rel(OUT_HTML),
        outJson: rel(OUT_JSON),
        jsonBytes: fs.statSync(OUT_JSON).size
      },
      null,
      2
    )
  );
}

main();
