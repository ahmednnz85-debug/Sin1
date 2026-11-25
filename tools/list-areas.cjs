#!/usr/bin/env node
/* Prints the game's live area registry (sin-areas.js), as the game builds it:
   every stage, zone and room its owners register, with id, names, group,
   stage, spawn and direct link. No world asset is loaded (?dev=1 stops at
   the developer menu).

   node static-server.mjs &
   THREE_DIR=/path/to/node_modules/three node tools/list-areas.cjs [--md] [--url http://127.0.0.1:8080/index.html] */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const args = process.argv.slice(2);
const URL = (args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:8080/index.html');
const THREE_DIR = process.env.THREE_DIR;
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  if (THREE_DIR) await page.route(/cdn\.jsdelivr\.net\/npm\/three@0\.187\.0\/(.*)$/, r => r.fulfill({ path: path.join(THREE_DIR, r.request().url().replace(/^.*three@0\.187\.0\//, '').split('?')[0]), contentType: 'text/javascript' }));
  await page.goto(URL + '?dev=1');
  // The menu is built after every game script has registered its areas.
  await page.waitForSelector('#sin-dev-list .area', { timeout: 180000 });
  const out = await page.evaluate(async () => {
    const list = await SinAreas.list();
    return { groups: SinAreas.groups(), errors: list.errors, areas: list.map(a => ({ id: a.id, stage: a.stage, group: a.group, ar: a.ar, en: a.en, spawn: a.spawn, source: a.source, link: SinDevHub.link(a.id) })) };
  });
  await browser.close();
  if (!args.includes('--md')) { console.log(JSON.stringify(out, null, 1)); return; }
  for (const g of out.groups) {
    const rows = out.areas.filter(a => a.group === g.id);
    if (!rows.length) continue;
    console.log(`\n### ${g.ar} (${g.en})\n\n| المعرّف | المنطقة | المرحلة | الرابط | المصدر |\n| --- | --- | --- | --- | --- |`);
    for (const a of rows) console.log(`| \`${a.id}\` | ${a.ar} (${a.en}) | ${a.stage} | \`index.html${a.link}\` | ${a.source} |`);
  }
  if (out.errors.length) console.log('\nErrors: ' + out.errors.join('; '));
})().catch(e => { console.error(e); process.exit(1); });
