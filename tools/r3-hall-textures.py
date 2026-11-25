#!/usr/bin/env python3
"""Rebuild R3-02 PBR maps from the two original hall sheets (Pillow + numpy)."""
from pathlib import Path
from PIL import Image, ImageFilter
import numpy as np

ROOT = Path(__file__).resolve().parents[1] / 'assets'
OUT = ROOT / 'r3' / 'hall'
STONE = Image.open(ROOT / 'خامات قاعة الختم.JPG').convert('RGB')
RELIEF = Image.open(ROOT / 'نقوش قاعة الختم.JPG').convert('RGB')


def extract(sheet, corners, size):
    # Control points on the interior of each piece, in 1050 x 788 contact-sheet
    # coordinates. QUAD in Pillow takes upper-left, lower-left, lower-right, upper-right.
    quad = [p * sheet.size[i % 2] / (1050, 788)[i % 2]
            for i, p in enumerate(value for corner in corners for value in corner)]
    return sheet.transform(size, Image.Transform.QUAD, quad, Image.Resampling.BICUBIC)


def rect(sheet, x0, y0, x1, y1, size):
    return extract(sheet, [(x0, y0), (x0, y1), (x1, y1), (x1, y0)], size)


def periodic(data, axis, radius):
    """Blend across cyclic edges while keeping the original sample scale."""
    data = np.swapaxes(data, axis, 0).copy()
    for i in range(radius):
        weight = 0.25 * (1 + np.cos(np.pi * i / radius))
        a, b = data[i].copy(), data[-1 - i].copy()
        data[i] = a + (b - a) * weight
        data[-1 - i] = b + (a - b) * weight
    return np.swapaxes(data, 0, axis)


def bake(name, image, repeat='', depth=3.0):
    pixels = np.asarray(image, dtype=np.float32) / 255
    if 'x' in repeat:
        pixels = periodic(pixels, 1, min(22, image.width // 8))
    if 'y' in repeat:
        pixels = periodic(pixels, 0, min(22, image.height // 8))
    albedo = Image.fromarray(np.uint8(np.clip(pixels * (1.035, 1.045, 1.055), 0, 1) * 255))
    height = albedo.convert('L')
    detail = np.asarray(height.filter(ImageFilter.GaussianBlur(0.8)), dtype=np.float32) / 255
    coarse = np.asarray(height.filter(ImageFilter.GaussianBlur(8)), dtype=np.float32) / 255
    h = detail - coarse * 0.57
    if 'x' in repeat:
        h = periodic(h, 1, 10)
    if 'y' in repeat:
        h = periodic(h, 0, 10)
    dy, dx = np.gradient(h)
    if 'x' in repeat:
        dx[:, 0] = dx[:, -1] = (h[:, 1] - h[:, -2]) / 2
    if 'y' in repeat:
        dy[0] = dy[-1] = (h[1] - h[-2]) / 2
    n = np.stack((-dx * depth, dy * depth, np.ones_like(h)), axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    normal = Image.fromarray(np.uint8((n * 0.5 + 0.5) * 255))
    roughness = Image.fromarray(np.uint8(np.clip(0.94 - detail * .19 + abs(h) * .06, .76, .97) * 255))
    for suffix, texture in [('base', albedo), ('normal', normal), ('rough', roughness)]:
        texture.save(OUT / f'{name}-{suffix}.webp', quality=91 if suffix == 'base' else 94, method=6)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    bake('ashlar', rect(STONE, 23, 46, 346, 367, (512, 512)), 'xy', 4.4)
    # Rectify the block face rather than stretching the shallow stair-top
    # strip across the floor. Keep stone grain close to square in world UVs.
    bake('paving', extract(STONE, [(24, 47), (24, 367), (346, 367), (345, 47)], (512, 512)), 'xy', 4.2)
    bake('dust', rect(STONE, 719, 44, 1029, 365, (384, 384)), 'xy')
    bake('arch', rect(STONE, 240, 414, 488, 736, (256, 384)))
    bake('sin', extract(RELIEF, [(343, 14), (344, 282), (705, 283), (705, 14)], (512, 384)), depth=6.0)
    bake('ziggurat', extract(RELIEF, [(12, 78), (12, 263), (323, 263), (322, 79)], (448, 256)), depth=5.6)
    bake('seal', extract(RELIEF, [(726, 81), (726, 264), (1038, 264), (1038, 79)], (448, 256)), depth=5.6)
    bake('cuneiform', rect(RELIEF, 260, 407, 788, 436, (640, 40)), 'x', 6.4)
    bake('procession', rect(RELIEF, 256, 303, 794, 385, (640, 96)), 'x', 5.7)
    bake('rail', rect(RELIEF, 265, 458, 783, 484, (640, 40)), 'x', 4.7)


if __name__ == '__main__':
    main()
