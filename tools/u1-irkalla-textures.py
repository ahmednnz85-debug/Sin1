#!/usr/bin/env python3
"""Extract the road materials from the authored Irkalla sheet."""
from pathlib import Path
from tempfile import gettempdir
import io
import json
import struct

import numpy as np
from PIL import Image, ImageFilter, ImageOps

ASSETS = Path(__file__).resolve().parents[1] / 'assets'
OUT = ASSETS / 'r3' / 'harbor'
SHEET = Image.open(ASSETS / 'نقوش وخامات الارواح.JPG').convert('RGB')


def crop(bounds, size):
    # The crop rectangles were measured on an 820 px inspection image.
    return SHEET.crop(tuple(round(v * SHEET.width / 820) for v in bounds)).resize(size, Image.Resampling.LANCZOS)


def save(name, image):
    image.save(OUT / ('road-' + name + '.webp'), 'WEBP', quality=89, method=6)


def tile(image, axes=(1,)):
    pixels = np.array(image, dtype=float)
    for axis in axes:
        edge = np.moveaxis(pixels, axis, 0)
        span = min(12, len(edge) // 9)
        for i in range(span):
            w = 0.5 * (1 - i / span) ** 2
            a, b = edge[i].copy(), edge[-1-i].copy()
            edge[i], edge[-1-i] = a * (1-w) + b * w, b * (1-w) + a * w
    return Image.fromarray(pixels.astype('uint8'))


def normal(name, image, amount):
    h = np.asarray(image.convert('L').filter(ImageFilter.GaussianBlur(0.8)), dtype=float) / 255
    x = (np.roll(h, 1, 1) - np.roll(h, -1, 1)) * amount
    y = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * amount
    n = np.stack((x, y, np.ones_like(h)), axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    save(name + '-normal', Image.fromarray(np.uint8((n * 0.5 + 0.5) * 255)))


stone = crop((18, 17, 182, 177), (512, 512))
# Remove the broad painted hotspot and retain the tile joints and chips.
rgb = np.asarray(stone, dtype=float)
light = np.asarray(stone.convert('L').filter(ImageFilter.GaussianBlur(23)), dtype=float)
stone = tile(Image.fromarray(np.uint8(np.clip(rgb * ((78 / np.maximum(light, 32)) ** 0.7)[..., None], 0, 255))), (1, 0))
save('stone', stone)
normal('stone', stone, 2.1)
rough = np.asarray(ImageOps.grayscale(stone).resize((256, 256)), dtype=float) / 255
save('stone-rough', Image.fromarray(np.uint8(np.clip(.80 - .33 * rough, .55, .85) * 255)).convert('RGB'))

medallion = crop((458.4, 5.0, 737.8, 288.0), (512, 512))
# Extend the rim through unused UVs so filtering cannot sample the black sheet.
yy, xx = np.indices((512, 512))
radius = np.hypot(xx - 255.5, yy - 255.5)
f = np.minimum(1, 252 / np.maximum(radius, 1))
ix = np.rint(255.5 + (xx - 255.5) * f).astype(int)
iy = np.rint(255.5 + (yy - 255.5) * f).astype(int)
save('medallion', Image.fromarray(np.asarray(medallion)[iy, ix]))

stars = tile(crop((215, 80, 307, 157), (128, 128)).transpose(Image.Transpose.ROTATE_90))
save('stars', stars)
normal('stars', stars, 1.45)
for name, bounds, size in [
    ('edge', (216, 262.5, 436, 273), (512, 32)),
    ('rail', (47, 414, 349, 464), (512, 96)),
    ('relief', (12, 489, 338, 598), (512, 160)),
    ('script', (624, 394, 808, 425), (384, 64)),
    ('palms', (409, 397, 608, 463), (384, 128)),
]:
    detail = tile(crop(bounds, size))
    save(name, detail)
    if name in ('rail', 'relief'):
        normal(name, detail, 1.7)

# The statue and plinth are one authored mesh and keep all three original maps.
raw = (ASSETS / 'اسد مجنح .glb').read_bytes()
length, = struct.unpack_from('<I', raw, 12)
doc = json.loads(raw[20:20 + length])
for index, (image, size) in enumerate(zip(doc['images'], (1024, 512, 256), strict=True)):
    view = doc['bufferViews'][image['bufferView']]
    start = 28 + length + view.get('byteOffset', 0)
    with Image.open(io.BytesIO(raw[start:start + view['byteLength']])) as source:
        source.thumbnail((size, size), Image.Resampling.LANCZOS)
        source.convert('RGB').save(Path(gettempdir()) / f'sin1-irkalla-guardian-{index}.webp', 'WEBP', quality=89, method=6)
