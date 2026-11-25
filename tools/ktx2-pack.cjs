#!/usr/bin/env node
/* Packs the phone's GPU-compressed twins of the palace textures (ktx2-textures.js).

   1. Every image embedded in the palace GLBs, and every hall surface picture,
      is found by CONTENT (the same key the game computes at runtime).
   2. Only images the palace actually loads are packed: --capture is a
      recording of a full palace tour (ktx2-textures.js ?ktxcapture=1, see
      tools/palace-stream-probe.cjs / the capture script in the report).
   3. Each one is resized exactly like the phone does today (longest side
      capped at 1024 px — 512 for the K4 treasury kit — same rounding,
      high-quality filter), flipped when the game uploads it flipped, and
      encoded as KTX2 / UASTC (level 2, no rate-distortion loss, Zstandard)
      with mip levels box-filtered like the GPU's own generateMipmap, in
      linear light for colour maps and raw for data maps (normal, ORM).
   4. assets/ktx2/manifest.json maps content key -> file, size, role.

   Usage: node tools/ktx2-pack.cjs --capture capture.json --basisu /path/to/basisu [--jobs 2] [--only key,key]
   Needs python3 with Pillow for decoding / resizing. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync, execFile } = require('child_process');
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'ktx2');
const BASISU = opt('basisu') || 'basisu';
const JOBS = +(opt('jobs') || 2);
const CAPTURE = opt('capture');
const ONLY = opt('only') ? new Set(opt('only').split(',')) : null;
const PHONE_MAX = 1024, K4_MAX = 512;

// ---- content key: keep identical to ktx2-textures.js key() --------------------
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

// ---- GLB images and their material roles -----------------------------------
const COLOR_SLOTS = ['baseColorTexture', 'emissiveTexture'];
function glbImages(file) {
  const b = fs.readFileSync(file);
  if (b.length < 20 || b.toString('ascii', 0, 4) !== 'glTF') return [];
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.toString('utf8', 20, 20 + jsonLen));
  let bin = null, off = 20 + jsonLen;
  while (off + 8 <= b.length) {
    const len = b.readUInt32LE(off), type = b.readUInt32LE(off + 4);
    if (type === 0x004E4942) { bin = b.subarray(off + 8, off + 8 + len); break; }
    off += 8 + len;
  }
  if (!bin || !json.images) return [];
  const role = new Map(); // image index -> Set(roles)
  const mark = (texInfo, r) => {
    if (!texInfo || texInfo.index == null || !json.textures) return;
    const t = json.textures[texInfo.index]; if (!t) return;
    const e = t.extensions || {};
    const src = e.EXT_texture_webp ? e.EXT_texture_webp.source : e.EXT_texture_avif ? e.EXT_texture_avif.source : t.source;
    if (src == null) return;
    if (!role.has(src)) role.set(src, new Set());
    role.get(src).add(r);
  };
  (json.materials || []).forEach(m => {
    const pbr = m.pbrMetallicRoughness || {};
    mark(pbr.baseColorTexture, 'color'); mark(m.emissiveTexture, 'color');
    mark(pbr.metallicRoughnessTexture, 'data'); mark(m.occlusionTexture, 'data');
    mark(m.normalTexture, 'normal');
    const ext = m.extensions || {};
    Object.values(ext).forEach(e => { if (e && typeof e === 'object') for (const [k, v] of Object.entries(e)) if (v && v.index != null) mark(v, /color/i.test(k) ? 'color' : 'data'); });
  });
  return json.images.map((img, i) => {
    if (img.bufferView == null) return null;
    const bv = json.bufferViews[img.bufferView];
    const bytes = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    const r = role.get(i) || new Set(['color']);
    return { key: key(bytes), bytes, mime: img.mimeType || '', roles: r, file };
  }).filter(Boolean);
}
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/^(ktx2|\.git|node_modules)$/.test(e.name)) walk(p, out); }
    else out.push(p);
  }
  return out;
}

// ---- encode ----------------------------------------------------------------
const PY = `
import sys
from PIL import Image
src, dst, cap, flip = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4] == '1'
im = Image.open(src)
im.load()
alpha = im.mode in ('RGBA', 'LA', 'PA') or (im.mode == 'P' and 'transparency' in im.info)
im = im.convert('RGBA' if alpha else 'RGB')
w, h = im.size
m = max(w, h)
if m > cap:
    s = cap / m
    w2, h2 = max(1, round(w * s)), max(1, round(h * s))
    im = im.resize((w2, h2), Image.LANCZOS)
if flip:
    im = im.transpose(Image.FLIP_TOP_BOTTOM)
im.save(dst)
print(im.size[0], im.size[1], 1 if alpha else 0)
`;
function run(cmd, argv) {
  return new Promise((resolve, reject) => execFile(cmd, argv, { maxBuffer: 1 << 26 }, (err, stdout, stderr) => err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
}
async function encode(item, tmp) {
  const src = path.join(tmp, item.key + '.src'), png = path.join(tmp, item.key + '.png');
  fs.writeFileSync(src, item.bytes);
  const [w, h] = (await run('python3', ['-I', '-c', PY, src, png, String(item.cap), item.flip ? '1' : '0'])).trim().split(/\s+/).map(Number);
  const out = path.join(OUT, item.key + '.ktx2');
  const flags = ['-ktx2', '-uastc', '-uastc_level', '2', '-mipmap', '-mip_filter', 'box', '-ktx2_zstandard_level', '18'];
  if (item.role === 'color') flags.push('-mip_srgb');
  else flags.push('-linear', '-mip_linear');
  if (item.role === 'normal') flags.push('-normal_map');
  await run(BASISU, [...flags, '-output_file', out, png]);
  fs.unlinkSync(src); fs.unlinkSync(png);
  return { file: 'assets/ktx2/' + item.key + '.ktx2', w, h, role: item.role, bytes: fs.statSync(out).size };
}

(async () => {
  const want = CAPTURE ? JSON.parse(fs.readFileSync(CAPTURE, 'utf8')) : null;
  const seen = want ? (want.seen || {}) : null;
  const k4Keys = new Set();
  const items = new Map();
  const files = [...walk(path.join(ROOT, 'assets')), ...walk(path.join(ROOT, 'ارضيات وسقوف'))];
  for (const f of files) {
    if (/\.glb$/i.test(f)) {
      for (const im of glbImages(f)) {
        if (/\/k4\//.test(f)) k4Keys.add(im.key);
        const prev = items.get(im.key);
        if (prev) { im.roles.forEach(r => prev.roles.add(r)); prev.files.add(f); continue; }
        items.set(im.key, { key: im.key, bytes: im.bytes, roles: im.roles, files: new Set([f]), flip: false });
      }
    } else if (/\.(jpe?g|png|webp)$/i.test(f)) {
      const bytes = fs.readFileSync(f), k = key(bytes);
      if (!items.has(k)) items.set(k, { key: k, bytes, roles: new Set(), files: new Set([f]), hallBytes: true });
    }
  }
  const selected = [];
  for (const it of items.values()) {
    if (ONLY && !ONLY.has(it.key)) continue;
    const s = seen && seen[it.key];
    if (seen && !s) continue;
    if (s && s.mime === 'hall-bytes') { it.flip = true; it.role = s.linear ? 'data' : 'color'; }
    else if (it.hallBytes) continue; // a loose picture the palace never loads through textureFromBytes
    else it.role = it.roles.has('color') ? 'color' : it.roles.has('normal') ? 'normal' : 'data';
    it.cap = k4Keys.has(it.key) ? K4_MAX : PHONE_MAX;
    selected.push(it);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const manifestPath = path.join(OUT, 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { version: 1, items: {} };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ktx2-'));
  const missing = seen ? Object.keys(seen).filter(k => !items.has(k)) : [];
  console.log('images found', items.size, 'selected', selected.length, 'captured but not found on disk', missing.length);
  let done = 0, bytes = 0;
  const queue = selected.filter(it => !manifest.items[it.key] || !fs.existsSync(path.join(ROOT, manifest.items[it.key].file)));
  async function worker() {
    for (;;) {
      const it = queue.shift(); if (!it) return;
      try {
        const r = await encode(it, tmp);
        manifest.items[it.key] = { file: r.file, w: r.w, h: r.h, role: r.role, src: [...it.files].map(f => path.relative(ROOT, f)).slice(0, 3) };
        bytes += r.bytes; done++;
        if (done % 10 === 0) { fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1)); console.log(done + '/' + selected.length, (bytes / 1048576).toFixed(1) + ' MB'); }
      } catch (e) { console.error('FAILED', it.key, [...it.files][0], String(e.message || e).slice(0, 300)); }
    }
  }
  await Promise.all(Array.from({ length: JOBS }, worker));
  manifest.generated = new Date().toISOString();
  manifest.encoder = String(execFileSync(BASISU, ['-version']).toString().split('\n')[0]).trim();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
  console.log('done', done, 'files,', (bytes / 1048576).toFixed(1), 'MB; manifest', Object.keys(manifest.items).length, 'items');
})().catch(e => { console.error(e); process.exit(1); });
