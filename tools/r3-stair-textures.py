#!/usr/bin/env python3
"""R3-01 Buried Years Stair - texture and relief extraction.

Sources (authored by the art direction, kept untouched in assets/):
  assets/خامات درج السنين.JPG   3x3 sheet of stone materials on black
  assets/نقوش درج السنين .JPG   sheet of carved reliefs, friezes and moons

Output: assets/r3/stair/
  <tile>_albedo.jpg / <tile>_normal.jpg / <tile>_orm.jpg   seamless 512^2 PBR sets
  <relief>_albedo.jpg / <relief>_normal.jpg (+ alpha .png for cut-outs)
  manifest.json                                            sizes and roles

Each step is deterministic:
  1. Crop every tile / relief inside its black gutter (the gutters are found
     from the sheet itself, not hard-coded), with an inset that drops the
     dark anti-aliased border.
  2. Flatten the sheet's low-frequency lighting so the tile does not carry a
     baked gradient that would show as a grid when repeated.
  3. Make tiles wrap: image-quilting self-overlap with a minimum-error cut
     (no cross-fade ghosting of mortar lines), feathered over 3 px.
  4. Height = band-passed luminance; tangent-space normal (OpenGL, +Y up)
     from wrap-around Sobel; AO from cavity; roughness from albedo and cavity.
  5. Cut-outs (crescent, moon phases) get an alpha matte from the luminance
     against the black background, grown/shrunk to remove the black halo.

Usage: python3 tools/r3-stair-textures.py
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC_TILES = os.path.join(ROOT, 'assets', 'خامات درج السنين.JPG')
SRC_RELIEF = os.path.join(ROOT, 'assets', 'نقوش درج السنين .JPG')
OUT = os.path.join(ROOT, 'assets', 'r3', 'stair')
TILE = 512


def runs(mask, minlen=3):
    out, s = [], None
    for i, v in enumerate(mask):
        if v and s is None:
            s = i
        if not v and s is not None:
            if i - s >= minlen:
                out.append((s, i))
            s = None
    if s is not None:
        out.append((s, len(mask)))
    return out


# ---- wrap-around filters (FFT: tiles are periodic once seamless) ----------
def gauss(img, sigma):
    if sigma <= 0:
        return img
    h, w = img.shape[:2]
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    k = np.exp(-2 * (np.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2))
    if img.ndim == 2:
        return np.real(np.fft.ifft2(np.fft.fft2(img) * k))
    return np.stack([np.real(np.fft.ifft2(np.fft.fft2(img[..., c]) * k)) for c in range(img.shape[2])], -1)


def gauss_clamped(img, sigma):
    """Gaussian blur for non-periodic images (reliefs): reflect padding."""
    pad = int(sigma * 3) + 1
    if img.ndim == 2:
        p = np.pad(img, pad, mode='reflect')
    else:
        p = np.pad(img, ((pad, pad), (pad, pad), (0, 0)), mode='reflect')
    return gauss(p, sigma)[pad:-pad, pad:-pad]


def lum(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


# ---- seamless ------------------------------------------------------------
def min_cut(err):
    """Vertical minimum-error path through err (rows x overlap)."""
    h, w = err.shape
    cost = err.copy()
    back = np.zeros((h, w), dtype=np.int32)
    for y in range(1, h):
        prev = cost[y - 1]
        left = np.r_[np.inf, prev[:-1]]
        right = np.r_[prev[1:], np.inf]
        stack = np.stack([left, prev, right])
        idx = np.argmin(stack, 0)
        cost[y] += stack[idx, np.arange(w)]
        back[y] = idx - 1
    path = np.zeros(h, dtype=np.int32)
    path[-1] = int(np.argmin(cost[-1]))
    for y in range(h - 1, 0, -1):
        path[y - 1] = np.clip(path[y] + back[y, path[y]], 0, w - 1)
    return path


def wrap_x(img, overlap):
    h, w = img.shape[:2]
    n = w - overlap
    a = img[:, :overlap]          # original left strip
    b = img[:, n:n + overlap]     # continuation of the right edge
    err = ((a - b) ** 2).sum(-1)
    err = gauss_clamped(err, 1.2)
    cut = min_cut(err)
    x = np.arange(overlap)[None, :]
    # 0 -> take continuation (b), 1 -> take original (a); 3 px feather.
    t = np.clip((x - cut[:, None]) / 3.0 + 0.5, 0, 1)[..., None]
    out = img[:, :n].copy()
    out[:, :overlap] = b * (1 - t) + a * t
    return out


def seamless(img, overlap):
    img = wrap_x(img, overlap)
    img = np.transpose(wrap_x(np.transpose(img, (1, 0, 2)), overlap), (1, 0, 2))
    return img


def flatten_light(img, sigma, periodic=True, keep=0.25):
    """Remove the sheet's broad light gradient, keep a little macro variation."""
    blur = gauss if periodic else gauss_clamped
    L = lum(img)
    low = blur(L, sigma)
    gain = (L.mean() / np.maximum(low, 1e-3)) ** (1 - keep)
    return np.clip(img * gain[..., None], 0, 1)


def resize(img, size):
    h, w = img.shape[:2]
    im = Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8))
    im = im.resize(size, Image.LANCZOS)
    if size[0] > w:
        im = im.filter(ImageFilter.UnsharpMask(radius=1.4, percent=55, threshold=1))
    return np.asarray(im).astype(np.float64) / 255


# ---- PBR derivation ------------------------------------------------------
def height_of(img, periodic, fine=0.8, broad=24.0):
    blur = gauss if periodic else gauss_clamped
    L = lum(img) ** (1 / 2.2)  # perceptual: grooves read as dark in the photo
    band = blur(L, fine) - blur(L, broad)
    band = band / (np.abs(band).max() + 1e-6)
    return band


def normal_of(height, strength, periodic):
    if periodic:
        dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.5
        dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 0.5
    else:
        p = np.pad(height, 1, mode='edge')
        dx = (p[1:-1, 2:] - p[1:-1, :-2]) * 0.5
        dy = (p[2:, 1:-1] - p[:-2, 1:-1]) * 0.5
    nx, ny, nz = -dx * strength, dy * strength, np.ones_like(height)
    n = np.stack([nx, ny, nz], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5  # OpenGL convention (+Y up in texture space)


def orm_of(img, height, periodic, rough_base):
    blur = gauss if periodic else gauss_clamped
    cavity = blur(height, 6.0) - height
    ao = np.clip(1.0 - np.maximum(cavity, 0) * 1.7, 0.35, 1.0)
    ao = ao * np.clip(0.75 + 0.25 * (blur(lum(img), 14.0) / (lum(img).mean() + 1e-6)), 0.6, 1.0)
    L = lum(img)
    rough = np.clip(rough_base + 0.10 * (1 - L / (L.max() + 1e-6)) + 0.05 * np.maximum(cavity, 0), 0.55, 1.0)
    return np.stack([ao, rough, np.zeros_like(ao)], -1)


def save(arr, name, quality=90):
    a = (np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)
    path = os.path.join(OUT, name)
    if a.ndim == 3 and a.shape[2] == 4:
        Image.fromarray(a, 'RGBA').save(path, optimize=True)
    else:
        Image.fromarray(a).save(path, quality=quality, subsampling=0 if 'normal' in name else 2)
    return {'file': 'assets/r3/stair/' + name, 'w': int(a.shape[1]), 'h': int(a.shape[0]), 'bytes': os.path.getsize(path)}


# ---- materials sheet -------------------------------------------------------
# Tile roles follow the reference picture (row, column on the sheet).
TILES = {
    (0, 0): ('ashlar_wall', 0.86, 2.6),      # big weathered blocks: wall courses
    (0, 1): ('frieze_band', 0.84, 2.2),      # procession frieze course
    (0, 2): ('slab_landing', 0.86, 2.2),     # large slabs: landings, plinths
    (1, 0): ('fluted_pier', 0.83, 2.6),      # fluted ashlar: buttresses / piers
    (1, 1): ('eroded_vault', 0.9, 3.0),      # spalled plaster stone: vault
    (1, 2): ('coursed_rib', 0.85, 2.6),      # regular courses: arch voussoirs
    (2, 0): ('dust_rubble', 0.95, 2.0),      # sand and grit: drifts, dust
    (2, 1): ('worn_tread', 0.82, 2.4),       # dark cracked flags: stair treads
    (2, 2): ('eroded_block', 0.88, 2.8),     # broken blocks: capitals, rims
}


def tiles(manifest):
    sheet = np.asarray(Image.open(SRC_TILES).convert('RGB')).astype(np.float64) / 255
    L = lum(sheet) * 255
    cols = runs(L.mean(0) > 25)
    rows = runs(L.mean(1) > 25)
    assert len(cols) == 3 and len(rows) == 3, (cols, rows)
    for (r, c), (name, rough, normal_strength) in TILES.items():
        y0, y1 = rows[r]
        x0, x1 = cols[c]
        inset = 3
        crop = sheet[y0 + inset:y1 - inset, x0 + inset:x1 - inset]
        side = min(crop.shape[:2])
        crop = crop[:side, :side]
        crop = flatten_light(crop, sigma=side / 5, periodic=False, keep=0.35)
        crop = seamless(crop, overlap=max(24, side // 7))
        img = resize(crop, (TILE, TILE))
        # Quilting can leave a faint DC step at the wrap after resampling:
        # flatten again periodically, keeping the material's own variation.
        img = flatten_light(img, sigma=TILE / 4, periodic=True, keep=0.5)
        h = height_of(img, True, fine=0.7, broad=TILE / 14)
        manifest['tiles'][name] = {
            'albedo': save(img, name + '_albedo.jpg', 88),
            'normal': save(normal_of(h, normal_strength * 6.0, True), name + '_normal.jpg', 92),
            'orm': save(orm_of(img, h, True, rough), name + '_orm.jpg', 88),
            'sheet': [int(x0), int(y0), int(x1), int(y1)],
        }


# ---- relief sheet ----------------------------------------------------------
def reliefs(manifest):
    sheet = np.asarray(Image.open(SRC_RELIEF).convert('RGB')).astype(np.float64) / 255
    L = lum(sheet) * 255
    H, W = L.shape

    def bbox(x0, y0, x1, y1, thr=22):
        sub = L[y0:y1, x0:x1]
        cs = runs(sub.mean(0) > thr)
        rs = runs(sub.mean(1) > thr)
        return x0 + cs[0][0], y0 + rs[0][0], x0 + cs[-1][1], y0 + rs[-1][1]

    mid = W // 2
    regions = {
        # name: (search box, output size, horizontally repeating?)
        'relief_sin_moon': ((0, 0, mid, 445), (1024, 512), False),
        'relief_lamassu_court': ((mid, 0, W, 445), (1024, 512), False),
        'frieze_offerings': ((0, 445, mid, 650), (1024, 224), False),
        'frieze_procession': ((mid, 445, W, 650), (1024, 224), False),
        'band_rosettes': ((0, 655, 860, 795), (1024, 144), True),
        'band_cuneiform': ((0, 795, 860, H), (1024, 80), True),
    }
    for name, (box, size, repeat) in regions.items():
        x0, y0, x1, y1 = bbox(*box)
        inset = 4
        crop = sheet[y0 + inset:y1 - inset, x0 + inset:x1 - inset]
        crop = flatten_light(crop, sigma=max(crop.shape[:2]) / 4, periodic=False, keep=0.55)
        if repeat:
            crop = wrap_x(crop, overlap=max(16, crop.shape[1] // 14))
        img = resize(crop, size)
        h = height_of(img, False, fine=0.8, broad=max(size) / 40)
        manifest['reliefs'][name] = {
            'albedo': save(img, name + '_albedo.jpg', 90),
            'normal': save(normal_of(h, 9.0, False), name + '_normal.jpg', 92),
            'aspect': round(crop.shape[1] / crop.shape[0], 4),
            'repeat': repeat,
            'sheet': [int(x0), int(y0), int(x1), int(y1)],
        }

    # Crescent and the eight moon phases: one RGBA atlas, black removed.
    y0, y1 = 650, H
    x0 = mid - 10
    sub = sheet[y0:y1, x0:W]
    Ls = lum(sub)
    mask = (Ls > 0.085).astype(np.float64)
    cols = runs(mask.max(0) > 0, minlen=20)
    pieces = []
    for a, b in cols:
        rs = runs(mask[:, a:b].max(1) > 0, minlen=10)
        r0, r1 = rs[0][0], rs[-1][1]
        pieces.append((a, r0, b, r1))
    # Matte: smooth threshold, shrink 1.5 px to drop the dark fringe.
    alpha = np.clip((Ls - 0.07) / 0.06, 0, 1)
    alpha = gauss_clamped(alpha, 0.8)
    alpha = np.clip((alpha - 0.35) / 0.5, 0, 1)
    cell = 256
    atlas = np.zeros((cell, cell * len(pieces), 4))
    natlas = np.zeros((cell, cell * len(pieces), 3)) + 0.5
    natlas[..., 2] = 1.0
    uvs = []
    for i, (a, r0, b, r1) in enumerate(pieces):
        pad = 6
        a0, b0 = max(0, a - pad), min(sub.shape[1], b + pad)
        c0, c1 = max(0, r0 - pad), min(sub.shape[0], r1 + pad)
        rgb = sub[c0:c1, a0:b0]
        al = alpha[c0:c1, a0:b0]
        # De-fringe: colour of the halo comes from the stone, not the black.
        bl = gauss_clamped(rgb * al[..., None], 3) / np.maximum(gauss_clamped(al, 3), 1e-3)[..., None]
        rgb = np.where(al[..., None] > 0.98, rgb, np.clip(bl, 0, 1))
        hgt, wid = rgb.shape[:2]
        s = (cell - 8) / max(hgt, wid)
        nw, nh = max(1, int(wid * s)), max(1, int(hgt * s))
        rgba = np.concatenate([rgb, al[..., None]], -1)
        im = Image.fromarray((np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').resize((nw, nh), Image.LANCZOS)
        arr = np.asarray(im).astype(np.float64) / 255
        ox, oy = i * cell + (cell - nw) // 2, (cell - nh) // 2
        atlas[oy:oy + nh, ox:ox + nw] = arr
        hh = height_of(arr[..., :3], False, fine=0.7, broad=10) + arr[..., 3] * 0.6
        natlas[oy:oy + nh, ox:ox + nw] = normal_of(hh, 7.0, False)
        uvs.append([round(ox / atlas.shape[1], 5), round(1 - (oy + nh) / cell, 5),
                    round((ox + nw) / atlas.shape[1], 5), round(1 - oy / cell, 5),
                    round(nw / nh, 4)])
    manifest['reliefs']['moons'] = {
        'albedo': save(atlas, 'moons_albedo.png'),
        'normal': save(natlas, 'moons_normal.jpg', 92),
        'pieces': uvs,
        'note': 'piece 0 is the large crescent, then the phases left to right; uv = [u0, v0, u1, v1, aspect]'
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {'source': {'tiles': 'assets/خامات درج السنين.JPG', 'reliefs': 'assets/نقوش درج السنين .JPG'},
                'tiles': {}, 'reliefs': {}}
    tiles(manifest)
    reliefs(manifest)
    total = sum(v['bytes'] for t in manifest['tiles'].values() for k, v in t.items() if isinstance(v, dict))
    total += sum(v['bytes'] for t in manifest['reliefs'].values() for k, v in t.items() if isinstance(v, dict))
    manifest['bytes'] = total
    with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print('wrote', len(manifest['tiles']), 'tiles,', len(manifest['reliefs']), 'reliefs,', total // 1024, 'KiB')


if __name__ == '__main__':
    sys.exit(main())
