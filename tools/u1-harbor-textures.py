#!/usr/bin/env python3
"""Extract the U1-01 materials from the two authored reference sheets."""
from pathlib import Path
from tempfile import gettempdir
import io
import json
import math
import struct
from random import Random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps

ASSETS = Path(__file__).resolve().parents[1] / 'assets'
OUT = ASSETS / 'r3' / 'harbor'
FLOOR = Image.open(ASSETS / 'خامات المرسى.JPG').convert('RGB')
ROOF = Image.open(ASSETS / 'نقوش سقف المرسى.JPG').convert('RGB')


def crop(sheet, rect, size):
    factor = sheet.width / 780
    return sheet.crop(tuple(round(x * factor) for x in rect)).resize(size, Image.Resampling.LANCZOS)


def save(name, image):
    image.save(OUT / (name + '.webp'), 'WEBP', quality=89, method=6)


def tile(image, both_axes=False):
    """Crossfade opposing edge strips around the period boundary."""
    data = np.asarray(image, dtype=float).copy()
    for axis in ([1, 0] if both_axes else [1]):
        a = np.moveaxis(data, axis, 0)
        width = min(22, a.shape[0] // 10)
        for i in range(width):
            mix = .5 * (1 - i / width) ** 2
            near, far = a[i].copy(), a[-1-i].copy()
            a[i], a[-1-i] = near*(1-mix) + far*mix, far*(1-mix) + near*mix
    return Image.fromarray(data.astype('uint8'))


def paving_sheet():
    """Lay weathered flagstones with staggered joints in a 4.6 m square."""
    random = Random(891)
    size = 1024
    source = crop(FLOOR, (15, 12, 137, 132), (300, 300))
    source = Image.blend(source, ImageOps.grayscale(source).convert('RGB'), 0.72)
    joints = Image.new('RGB', (size, size), (45, 46, 47))
    height = Image.new('L', (size, size), 30)
    row_edges = [0, 151, 320, 497, 648, 838, size]
    for top, bottom in zip(row_edges, row_edges[1:]):
        length = bottom - top
        start = -random.randrange(32, 200)
        while start < size:
            width = random.randrange(128, 251)
            piece = source.crop((random.randrange(0, 28), random.randrange(0, 30), 282, 284))
            if random.randrange(2):
                piece = ImageOps.mirror(piece)
            piece = piece.rotate(90 * random.randrange(4)).resize((width, length), Image.Resampling.LANCZOS)
            stone = np.asarray(piece, dtype=float)
            tone = random.uniform(0.88, 1.12)
            tone = np.clip((stone - 90) * 0.73 + 100 * tone, 34, 197).astype('uint8')
            piece = Image.fromarray(tone)
            mask = Image.new('L', piece.size)
            d = ImageDraw.Draw(mask)
            d.polygon([(random.randrange(2, 6), 3), (width - 6, 2), (width - 3, 7),
                       (width - 3, length - 6), (width - 7, length - 3),
                       (5, length - 3), (2, length - 7)], fill=255)
            mask = mask.filter(ImageFilter.GaussianBlur(1.2))
            for shift in (-size, 0, size):
                joints.paste(piece, (start + shift, top), mask)
                height.paste(157, (start + shift, top, start + shift + width, bottom), mask)
            start += width
    # Mix shallow cracks from the source with the true stone edges.
    h = np.asarray(height.filter(ImageFilter.GaussianBlur(2.2)), dtype=float) / 255
    detail = np.asarray(joints.convert('L').filter(ImageFilter.GaussianBlur(.7)), dtype=float) / 255
    h = h * 0.65 + detail * 0.35
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 2.3
    dy = -(np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 2.3
    normal = np.stack((-dx, -dy, np.ones_like(h)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    save('paving-normal', Image.fromarray(np.clip((normal + 1) * 127.5, 0, 255).astype('uint8')))
    rough = np.clip(0.70 - h * 0.31, 0.40, 0.88)
    save('paving-rough', Image.fromarray((rough * 255).astype('uint8')).convert('RGB'))
    return joints


def unwrap_disk():
    """Rectify the full procession band, including both gold borders."""
    size = (1536, 160)
    angle = np.linspace(0, 2 * math.pi, size[0], endpoint=False)
    radius = np.linspace(143, 86, size[1])
    factor = FLOOR.width / 780
    x = (151.0 + np.cos(angle)[None, :] * radius[:, None]) * factor
    y = (291.2 + np.sin(angle)[None, :] * radius[:, None]) * factor
    coords = np.array(FLOOR, dtype=float)
    xx, yy = x.astype(int), y.astype(int)
    dx, dy = (x-xx)[..., None], (y-yy)[..., None]
    out = (coords[yy, xx] * (1-dx) + coords[yy, xx+1] * dx) * (1-dy)
    out += (coords[yy+1, xx] * (1-dx) + coords[yy+1, xx+1] * dx) * dy
    return Image.fromarray(out.astype('uint8'))


OUT.mkdir(exist_ok=True)
save('paving', paving_sheet())
save('floor-inlay', unwrap_disk())
def gilded_relief(name, image):
    image = tile(image)
    save(name, image)
    # The relief peaks follow the brighter raised bronze on the authored frieze.
    h = np.asarray(image.convert('L').filter(ImageFilter.GaussianBlur(1.35)), dtype=float) / 255
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 3.1
    dy = -(np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 3.1
    normals = np.stack((-dx, -dy, np.ones_like(h)), axis=-1)
    normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
    save(name + '-normal', Image.fromarray(((normals + 1) * 127.5).astype('uint8')))


gilded_relief('dais-gold', crop(FLOOR, (575, 151, 766, 186), (512, 112)))
gilded_relief('dais-border', crop(FLOOR, (568, 98, 767, 139), (512, 112)))
save('roof-stone', tile(crop(ROOF, (9, 7, 110, 109), (384, 384)), True))
save('roof-rib', crop(ROOF, (126, 7, 143, 109), (64, 384)).transpose(Image.Transpose.ROTATE_90))
save('roof-band', tile(crop(ROOF, (9, 118, 611, 169), (1024, 96))))
save('roof-oculus', tile(crop(ROOF, (9, 216, 611, 252), (1024, 80))))

# One shared atlas for the authored city. At scene distances the color atlas
# carries the weathering and blue falls; the original three 2K maps stay in the source.
source = ASSETS / 'البنايات البعيدة.glb'
raw = source.read_bytes()
json_size, = struct.unpack_from('<I', raw, 12)
doc = json.loads(raw[20:20 + json_size])
texture = doc['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']
image = doc['images'][doc['textures'][texture]['source']]
view = doc['bufferViews'][image['bufferView']]
start = 28 + json_size + view.get('byteOffset', 0)
with Image.open(io.BytesIO(raw[start:start + view['byteLength']])) as color:
    color.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    color.convert('RGB').save(Path(gettempdir()) / 'sin1-harbor-skyline-atlas.webp', 'WEBP', quality=86, method=6)
