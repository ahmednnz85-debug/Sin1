#!/usr/bin/env node
/* Renders every asset of assets/R3_MawOfTheAbyss_Assets.glb from several angles
   through tests/r3-maw-lab.html (real GLTFLoader + KTX2 + meshopt path) and
   writes one contact sheet per asset plus report.json.

   node tools/r3-maw-shots.cjs --out <dir> [--three <node_modules/three>] [--glb <file>] [--views lit,normal]
   --three serves three@0.187.0 locally instead of the CDN in the import map. */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const opt = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(opt('--out', 'maw-shots'));
const THREE_DIR = opt('--three', null);
const GLB = opt('--glb', null);
const VIEWS = opt('--views', 'lit').split(',');
const ANGLES = [[35, 18], [125, 14], [215, 18], [305, 14], [0, 70], [20, -35]];
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = url === '/__glb' && GLB ? path.resolve(GLB) : path.join(ROOT, url);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(data);
  });
}).listen(0);

(async () => {
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const logs = [];
  page.on('console', m => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', e => logs.push('pageerror: ' + e.message));
  if (THREE_DIR) await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.187\.0\/(.*)$/, (route) => {
    const rel = route.request().url().split('three@0.187.0/')[1];
    route.fulfill({ path: path.join(THREE_DIR, rel), contentType: 'text/javascript' });
  });
  const src = GLB ? '&src=/__glb' : '';
  await page.goto(`http://127.0.0.1:${port}/tests/r3-maw-lab.html?x=1${src}`);
  await page.waitForFunction(() => window.__maw && window.__maw.ready, null, { timeout: 180000 });
  const report = await page.evaluate(() => { window.__mawManual = true; return window.__maw.report; });
  report.console = logs.filter(l => /error|warn/i.test(l)).slice(0, 40);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ errors: report.errors, textures: report.textures, gpuMiB: +(report.gpuTextureBytes / 1048576).toFixed(1) }));
  for (const a of report.assets) console.log(a.name.padEnd(26), String(a.tris).padStart(7), 'tris', a.drawCalls, 'draws', a.size.join(' x '));
  const names = [null, ...report.assets.map(a => a.name)];
  for (const view of VIEWS) for (const name of names) {
    const shots = [];
    for (const [yaw, pitch] of (name ? ANGLES : [[30, 30]])) {
      await page.evaluate(([n, y, p, v]) => window.__maw.shoot(n, y, p, 1, v), [name, yaw, pitch, view]);
      shots.push(await page.locator('canvas').screenshot());
    }
    // contact sheet: 3 x 2 via a throwaway page
    const file = path.join(OUT, `${name || 'ALL'}_${view}.png`);
    if (shots.length === 1) { fs.writeFileSync(file, shots[0]); continue; }
    const sheet = await browser.newPage({ viewport: { width: 1350, height: 700 } });
    await sheet.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(3,450px)">${shots.map(b => `<img style="width:450px;height:350px" src="data:image/png;base64,${b.toString('base64')}">`).join('')}</body>`);
    await sheet.screenshot({ path: file }); await sheet.close();
    console.log('shot', file);
  }
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
