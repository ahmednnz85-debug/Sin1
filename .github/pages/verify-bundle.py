#!/usr/bin/env python3
"""Fail the Pages build if a file the game loads at start is missing from the bundle."""
import json, os, re, sys, pathlib
site = pathlib.Path(sys.argv[1])
html = (site / 'index.html').read_text(encoding='utf-8')
need = {'index.html', 'build.json', 'three-compat.js', 'sin-hero.js', 'sin-hud.css', 'assets/Sin_hero_runtime.glb'}
need |= {m.split('?')[0] for m in re.findall(r'data-src="([^"]+)"', html)}
need |= {m.split('?')[0] for m in re.findall(r'<script type="module" src="([^"]+)"', html)}
need |= {m.split('?')[0] for m in re.findall(r'<link rel="stylesheet" href="([^"]+)"', html)}
hero = re.search(r"const HERO_FILE='([^']+)'", html)
if hero: need.add('assets/' + hero.group(1) + '.glb')
missing = sorted(p for p in need if not (site / p).is_file())
build = json.loads((site / 'build.json').read_text())
if build.get('id') and build['id'] not in html: missing.append('build id %s not stamped in index.html' % build['id'])
size = sum(f.stat().st_size for f in site.rglob('*') if f.is_file())
print('bundle files:', sum(1 for f in site.rglob('*') if f.is_file()), ' size: %.1f MB' % (size / 1e6), ' build:', build.get('id'))
print('checked:', ', '.join(sorted(need)))
if size > 950e6: missing.append('bundle larger than the 1 GB Pages limit')
if missing:
    print('MISSING:', *missing, sep='\n  '); sys.exit(1)
