/* Static host for the Babylon scene.
   Arabic paths, explicit MIME types, Content-Length, gzip and brotli for text. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '.');
const HOST = '0.0.0.0';
const PORT = Number(process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon'
};

const RATE = 1.5 * 1000 * 1000 / 8;
const LATENCY_MS = 150;

function wantsLte(req) {
  return /(?:^|;\s*)lte=1(?:;|$)/.test(String(req.headers.cookie || ''));
}

function isPalaceAsset(url) {
  let path = String(url || '').split('?')[0];
  try { path = decodeURIComponent(path); } catch { /* keep */ }
  return path.includes('ارضيات وسقوف/optimized/') || path.includes('ارضيات وسقوف/props/') || path.endsWith('/vendor/meshopt_decoder.js') || path.endsWith('vendor/meshopt_decoder.js');
}

function drip(res, body) {
  const tick = 50;
  const chunk = Math.max(1, Math.round(RATE * tick / 1000));
  let offset = 0;
  setTimeout(() => {
    const iv = setInterval(() => {
      if (res.writableEnded || res.destroyed) { clearInterval(iv); return; }
      if (offset >= body.length) { clearInterval(iv); res.end(); return; }
      const end = Math.min(body.length, offset + chunk);
      res.write(body.subarray(offset, end));
      offset = end;
    }, tick);
  }, LATENCY_MS);
}
const COMPRESS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg']);
const cache = new Map();

function mimeOf(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function safeFile(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath.split('?')[0]); }
  catch { return null; }
  if (decoded.endsWith('/')) decoded += 'index.html';
  const rel = decoded.replace(/^\/+/, '');
  const abs = path.resolve(ROOT, rel || 'index.html');
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  return abs;
}

function compressed(file, buf, kind) {
  const st = fs.statSync(file);
  const key = kind + ':' + file + ':' + st.mtimeMs + ':' + st.size;
  const hit = cache.get(key);
  if (hit) return hit;
  const out = kind === 'br'
    ? zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
    : zlib.gzipSync(buf, { level: 6 });
  cache.set(key, out);
  return out;
}

const server = http.createServer((req, res) => {
  const file = safeFile(req.url || '/');
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    const body = Buffer.from('Not found');
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length });
    if (req.method === 'HEAD') { res.end(); return; }
    res.end(body);
    return;
  }
  const raw = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  const accept = String(req.headers['accept-encoding'] || '');
  let body = raw;
  let encoding = '';
  const lte = wantsLte(req) && isPalaceAsset(req.url || '');
  if (!lte && COMPRESS.has(ext) && raw.length > 256) {
    if (/\bbr\b/.test(accept)) { body = compressed(file, raw, 'br'); encoding = 'br'; }
    else if (/\bgzip\b/.test(accept)) { body = compressed(file, raw, 'gzip'); encoding = 'gzip'; }
  }
  const headers = {
    'Content-Type': mimeOf(file),
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'none'
  };
  if (encoding) {
    headers['Content-Encoding'] = encoding;
    headers['Vary'] = 'Accept-Encoding';
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  if (lte) { drip(res, body); return; }
  res.end(body);
});

server.listen(PORT, HOST, () => {
  console.log('sin static ' + HOST + ':' + PORT + ' root ' + ROOT);
});
