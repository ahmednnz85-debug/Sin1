#!/usr/bin/env python3
"""Before / after comparison of tools/palace-room-shots.cjs captures.

For every room present in both folders: mean absolute difference (0-255),
share of pixels that differ by more than 24 levels, and PSNR. Animated
details (fire, embers, water, dust) differ between any two captures, so a
small non-zero difference is expected even for identical builds.
Writes <after>/compare/<room>.jpg (before | after | difference x4) and
<after>/compare/summary.json.

Usage: python3 tools/compare-shots.py BEFORE_DIR AFTER_DIR
"""
import json, math, os, sys
from PIL import Image, ImageChops
import numpy as np

before, after = sys.argv[1], sys.argv[2]
out = os.path.join(after, 'compare')
os.makedirs(out, exist_ok=True)
rows = []
for name in sorted(os.listdir(after)):
    if not name.endswith('.png') or not os.path.exists(os.path.join(before, name)):
        continue
    a = Image.open(os.path.join(before, name)).convert('RGB')
    b = Image.open(os.path.join(after, name)).convert('RGB')
    if a.size != b.size:
        b = b.resize(a.size)
    x, y = np.asarray(a, dtype=np.int16), np.asarray(b, dtype=np.int16)
    d = np.abs(x - y)
    mse = float((d.astype(np.float64) ** 2).mean())
    row = {'room': name[:-4], 'meanAbs': round(float(d.mean()), 2), 'over24Pct': round(float((d.max(axis=2) > 24).mean() * 100), 2),
           'psnr': round(10 * math.log10(255 ** 2 / mse), 2) if mse > 0 else 99.0}
    rows.append(row)
    diff = ImageChops.difference(a, b).point(lambda v: min(255, v * 4))
    w, h = a.size
    sheet = Image.new('RGB', (w * 3, h))
    sheet.paste(a, (0, 0)); sheet.paste(b, (w, 0)); sheet.paste(diff, (2 * w, 0))
    sheet.thumbnail((2400, 2400))
    sheet.save(os.path.join(out, name[:-4] + '.jpg'), quality=85)
    print(json.dumps(row))
json.dump(rows, open(os.path.join(out, 'summary.json'), 'w'), indent=1)
