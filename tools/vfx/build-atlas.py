#!/usr/bin/env python3
"""Sîn Advanced VFX Engine: texture pipeline.

Reads the three static texture boards in assets/vfx/source and writes the
runtime textures in assets/vfx:

  vfx-energy.webp       (2048², RGBA) lunar / cursed-gold energy elements and metal
                        sparks, black removed, additive (rgb) + coverage (a)
  vfx-energy-1k.webp    the same atlas at half resolution (Low tier / phones)
  vfx-stone.webp        (2048×1536, RGBA) stone cracks and relief breaks, straight
                        alpha, colour bled under transparent texels (no dark fringe)
  vfx-stone-aux.webp    normal map (rgb, from the stone height) + crack-seam glow mask (a)
  vfx-noise.webp        (512², tileable) R fbm, G cellular, BA curl flow vectors
  vfx-shapes.webp       (1024×512) procedural dust puffs, soft glow, spark streak, shard
  vfx-ramps.png         (256×16) colour-over-lifetime ramps
  atlas.json            UV regions (GL convention, v up, half-texel inset), sizes, kinds

Each element of a board is extracted on its own (region + connected-component
isolation, so a neighbour's spill is removed) and never treated as a frame of a
flipbook. Deterministic: same input → same output.

  python3 tools/vfx/build-atlas.py            (writes assets/vfx/*, assets/vfx/atlas.json)
  python3 tools/vfx/build-atlas.py --preview  (also writes contact sheets to assets/vfx/preview)
"""
import json, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from regions import REGIONS  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(ROOT, 'assets', 'vfx', 'source')
OUT = os.path.join(ROOT, 'assets', 'vfx')
PAD = 8                      # texels between elements (mip 0..3 never mix neighbours)
RNG = np.random.default_rng(1729)


# ------------------------------------------------------------------ helpers
def load(sheet):
    return np.asarray(Image.open(os.path.join(SRC, sheet + '.png')).convert('RGB')).astype(np.float32) / 255.0


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def box_max(m, r):
    """Square max filter (dilation) of radius r, separable."""
    out = m.copy()
    for ax in (0, 1):
        acc = out.copy()
        for d in range(1, r + 1):
            acc = np.maximum(acc, np.roll(out, d, ax))
            acc = np.maximum(acc, np.roll(out, -d, ax))
        out = acc
    return out


def box_min(m, r):
    return -box_max(-m, r)


def blur(a, r):
    """Cheap separable box blur (3 passes ≈ gaussian)."""
    out = a.astype(np.float32)
    for _ in range(3):
        for ax in (0, 1):
            c = np.cumsum(np.pad(out, [(r + 1, r) if i == ax else (0, 0) for i in range(out.ndim)], mode='edge'), axis=ax)
            sl_hi = [slice(None)] * out.ndim
            sl_lo = [slice(None)] * out.ndim
            sl_hi[ax] = slice(2 * r + 1, None)
            sl_lo[ax] = slice(0, -(2 * r + 1))
            out = (c[tuple(sl_hi)] - c[tuple(sl_lo)]) / (2 * r + 1)
    return out


def label(mask):
    """Connected components (4-neighbour) by iterative min-label propagation."""
    h, w = mask.shape
    big = h * w + 1
    lab = np.where(mask, np.arange(h * w).reshape(h, w), big)
    while True:
        n = lab.copy()
        for ax, d in ((0, 1), (0, -1), (1, 1), (1, -1)):
            s = np.roll(lab, d, ax)
            if ax == 0:
                if d == 1: s[0, :] = big
                else: s[-1, :] = big
            else:
                if d == 1: s[:, 0] = big
                else: s[:, -1] = big
            n = np.minimum(n, s)
        n = np.where(mask, n, big)
        if np.array_equal(n, lab):
            return lab
        lab = n


_COMPONENTS = {}


def components(sheet, img):
    """Component labels of a whole board at 1/2 resolution (cached)."""
    if sheet in _COMPONENTS:
        return _COMPONENTS[sheet]
    lum = img.max(axis=2)
    h, w = lum.shape
    small = lum[:h // 2 * 2, :w // 2 * 2].reshape(h // 2, 2, w // 2, 2).max(axis=(1, 3))
    m = box_max((small > 0.07).astype(np.float32), 3) > 0
    lab = label(m)
    _COMPONENTS[sheet] = lab
    return lab


def isolate(sheet, img, x0, y0, x1, y1):
    """Weight map for a region: components that belong to this element are kept,
    spill of neighbouring elements is removed; region borders are feathered."""
    lab = components(sheet, img)
    big = lab.shape[0] * lab.shape[1] + 1
    sub = lab[y0 // 2:(y1 + 1) // 2, x0 // 2:(x1 + 1) // 2]
    ids, counts = np.unique(sub[sub != big], return_counts=True)
    keep = np.zeros(lab.shape, bool)
    for i, c in zip(ids, counts):
        total = np.count_nonzero(lab == i)
        if c / total >= 0.45 or c > 1500:   # mostly inside, or a large shared smoke body
            keep |= lab == i
    k = keep[y0 // 2:(y1 + 1) // 2, x0 // 2:(x1 + 1) // 2].astype(np.float32)
    k = np.asarray(Image.fromarray((k * 255).astype(np.uint8)).resize((x1 - x0, y1 - y0), Image.BILINEAR)).astype(np.float32) / 255
    k = blur(k, 3)
    h, w = k.shape
    fy = smoothstep(0, 12, np.minimum(np.arange(h), np.arange(h)[::-1]))[:, None]
    fx = smoothstep(0, 12, np.minimum(np.arange(w), np.arange(w)[::-1]))[None, :]
    return np.clip(k * 1.4, 0, 1) * fy * fx


def extract_additive(img, sheet, x0, y0, x1, y1):
    c = img[y0:y1, x0:x1].copy()
    w = isolate(sheet, img, x0, y0, x1, y1)
    # Black floor of the board (JPEG-like noise and the near-black backdrop) is
    # removed per element; above it the original colour and gradients are kept.
    floor = np.percentile(c.max(axis=2), 35)
    floor = min(max(floor, 0.012), 0.06)
    rgb = np.clip((c - floor) / (1 - floor), 0, 1) * w[..., None]
    lum = rgb.max(axis=2)
    a = smoothstep(0.0, 0.35, lum)            # coverage, used by alpha-premultiplied modes and soft depth fade
    return rgb, a


def extract_stone(img, sheet, x0, y0, x1, y1):
    c = img[y0:y1, x0:x1].copy()
    w = isolate(sheet, img, x0, y0, x1, y1)
    lum = c.max(axis=2)
    solid = smoothstep(0.045, 0.13, lum) * w
    # Narrow dark seams between plates and the dark pits stay part of the decal,
    # so the decal reads as broken stone and not as floating islands.
    m = (solid > 0.5).astype(np.float32)
    seams = np.clip(box_min(box_max(box_max(m, 2), 2), 4) - m, 0, 1)      # gaps up to ~8 px wide
    # pits: dark regions enclosed by stone (flood fill of the backdrop from the border)
    hull = box_min(box_max(m, 12), 12)
    free = (hull < 0.5).astype(np.float32)
    outside = np.zeros_like(m)
    outside[0, :] = outside[-1, :] = 1
    outside[:, 0] = outside[:, -1] = 1
    outside *= free
    for _ in range(600):
        n = np.maximum(outside, box_max(outside, 3) * free)
        if np.array_equal(n, outside):
            break
        outside = n
    pits = free * (1 - outside)
    pits = blur(box_max(pits, 2), 2) * (1 - m)
    interior = np.clip(np.maximum(seams, pits), 0, 1)
    interior = blur(interior, 1) * w
    alpha = np.clip(np.maximum(solid, interior * 0.96), 0, 1)
    # straight colour: un-premultiply the black backdrop out of the edge texels
    straight = np.clip(c / np.maximum(smoothstep(0.0, 0.13, lum)[..., None], 0.08), 0, 1)
    seam_dark = np.array([0.045, 0.03, 0.022], np.float32)
    rgb = straight * solid[..., None] + seam_dark * (1 - solid[..., None])
    # glow mask: where energy seeps from the seams (interior dark), plus the lit crack edges
    edge_light = np.clip((lum - blur(lum, 4)) * 6, 0, 1) * smoothstep(0.18, 0.4, lum) * 0.35
    glow = np.clip(blur(seams, 1) * w + pits * 0.65 + edge_light, 0, 1)
    height = blur(lum * solid, 1)
    return rgb, alpha, glow, height


def bleed(rgb, a, iters=24):
    """Push colour into transparent texels so filtering never pulls in black."""
    rgb = rgb.copy()
    known = a > 0.02
    for _ in range(iters):
        if known.all():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros(a.shape, np.float32)
        for ax, d in ((0, 1), (0, -1), (1, 1), (1, -1)):
            k = np.roll(known, d, ax)
            acc += np.roll(rgb, d, ax) * k[..., None]
            cnt += k
        grow = (~known) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][..., None]
        known = known | grow
    return rgb


def normal_from_height(h, strength=6.0):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.stack([-gx, gy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


# ------------------------------------------------------------------ packing
def pack(items, W, H):
    """Shelf packer, tallest first. items: list of (id, w, h). Returns {id: (x, y)} or None."""
    order = sorted(items, key=lambda t: (-t[2], -t[1]))
    x = y = PAD
    shelf = 0
    out = {}
    for iid, w, h in order:
        if x + w + PAD > W:
            x = PAD
            y += shelf + PAD
            shelf = 0
        if y + h + PAD > H:
            return None
        out[iid] = (x, y)
        x += w + PAD
        shelf = max(shelf, h)
    return out


def uv(x, y, w, h, W, H):
    # half-texel inset, GL convention (v up; textures are uploaded with flipY)
    return [round((x + 0.5) / W, 6), round(1 - (y + h - 0.5) / H, 6), round((x + w - 0.5) / W, 6), round(1 - (y + 0.5) / H, 6)]


# ------------------------------------------------------------------ procedural textures
def tile_noise(n, cells, seed):
    r = np.random.default_rng(seed)
    g = r.random((cells, cells)).astype(np.float32)
    # bicubic-ish periodic upsample: smooth interpolation of a wrapped grid
    t = np.arange(n) * cells / n
    i0 = np.floor(t).astype(int)
    f = t - i0
    f = f * f * (3 - 2 * f)
    i1 = (i0 + 1) % cells
    a = g[i0][:, i0] * (1 - f)[None, :] + g[i0][:, i1] * f[None, :]
    b = g[i1][:, i0] * (1 - f)[None, :] + g[i1][:, i1] * f[None, :]
    return a * (1 - f)[:, None] + b * f[:, None]


def fbm(n, seed, octaves=6, base=4):
    out = np.zeros((n, n), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += tile_noise(n, base * 2 ** o, seed + o) * amp
        tot += amp
        amp *= 0.5
    out /= tot
    return (out - out.min()) / (out.max() - out.min())


def cellular(n, cells, seed):
    r = np.random.default_rng(seed)
    pts = (np.stack(np.meshgrid(np.arange(cells), np.arange(cells), indexing='ij'), -1) + r.random((cells, cells, 2))) / cells
    yy, xx = np.meshgrid(np.arange(n) / n, np.arange(n) / n, indexing='ij')
    d = np.full((n, n), 9.0, np.float32)
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            for p in pts.reshape(-1, 2):
                dy = yy - (p[0] + oy)
                dx = xx - (p[1] + ox)
                d = np.minimum(d, np.sqrt(dx * dx + dy * dy))
    d = d / d.max()
    return d


def build_noise(n=512):
    f = fbm(n, 11)
    c = cellular(n, 8, 5)
    pot = blur(fbm(n, 31, octaves=4, base=3), 2)
    vx = np.roll(pot, -1, 0) - np.roll(pot, 1, 0)       # curl of a scalar potential: divergence-free flow
    vy = -(np.roll(pot, -1, 1) - np.roll(pot, 1, 1))
    s = max(np.abs(vx).max(), np.abs(vy).max())
    rgba = np.stack([f, c, vx / s * 0.5 + 0.5, vy / s * 0.5 + 0.5], -1)
    return rgba


def puff(n, seed):
    """Dust puff: fbm-eroded soft body, lit from above (density in a, shading in rgb)."""
    r = np.random.default_rng(seed)
    yy, xx = np.meshgrid(np.linspace(-1, 1, n), np.linspace(-1, 1, n), indexing='ij')
    lobes = np.zeros((n, n), np.float32)
    for _ in range(7):
        cx, cy = r.normal(0, 0.28, 2)
        rad = r.uniform(0.28, 0.5)
        lobes = np.maximum(lobes, np.clip(1 - ((xx - cx) ** 2 + (yy - cy) ** 2) / rad ** 2, 0, 1))
    nz = fbm(n, seed + 100, octaves=5, base=4)
    nz2 = fbm(n, seed + 200, octaves=4, base=8)
    d = np.clip(lobes * 1.15 - (1 - nz) * 0.55 - (1 - nz2) * 0.18, 0, 1)
    d = smoothstep(0.0, 0.7, d) * smoothstep(1.0, 0.72, np.sqrt(xx ** 2 + yy ** 2))
    d = blur(d, 1)
    shade = np.clip(0.62 + (-yy) * 0.25 + (nz - 0.5) * 0.45, 0.25, 1.0)
    return np.stack([shade, shade, shade, d], -1)


def build_shapes():
    W, H = 1024, 512
    out = np.zeros((H, W, 4), np.float32)
    regs = {}
    for i in range(4):                      # 4 dust puffs 256² on the top row
        out[0:256, i * 256:(i + 1) * 256] = puff(256, 70 + i * 13)
        regs['dust_%d' % i] = (i * 256, 0, 256, 256)
    yy, xx = np.meshgrid(np.linspace(-1, 1, 256), np.linspace(-1, 1, 256), indexing='ij')
    r2 = xx ** 2 + yy ** 2
    g = np.exp(-r2 * 5.0) + np.exp(-r2 * 40.0) * 0.6
    out[256:512, 0:256] = np.stack([g, g, g, np.clip(g, 0, 1)], -1)
    regs['soft_glow'] = (0, 256, 256, 256)
    # spark streak: hot white core, long tail along +x (velocity stretched in the shader)
    yy, xx = np.meshgrid(np.linspace(-1, 1, 64), np.linspace(-1, 1, 256), indexing='ij')
    tail = np.clip((xx + 1) / 2, 0, 1) ** 1.6
    core = np.exp(-(yy ** 2) * 60) * tail + np.exp(-((xx - 0.82) ** 2 * 40 + yy ** 2 * 60)) * 0.9
    out[256:320, 256:512] = np.stack([core, core, core, np.clip(core, 0, 1)], -1)
    regs['spark_dot'] = (256, 256, 256, 64)
    # energy mote: tiny star with 4 rays
    yy, xx = np.meshgrid(np.linspace(-1, 1, 128), np.linspace(-1, 1, 128), indexing='ij')
    ray = np.exp(-np.abs(xx) * 30) * np.exp(-np.abs(yy) * 3) + np.exp(-np.abs(yy) * 30) * np.exp(-np.abs(xx) * 3)
    mote = np.clip(np.exp(-(xx ** 2 + yy ** 2) * 18) + ray * 0.7, 0, 1)
    out[320:448, 256:384] = np.stack([mote, mote, mote, mote], -1)
    regs['mote'] = (256, 320, 128, 128)
    # ring falloff (shockwave cross-section) + radial shard silhouette
    rr = np.sqrt(xx ** 2 + yy ** 2)
    ring = np.exp(-((rr - 0.78) ** 2) * 260) * (0.6 + 0.4 * fbm(128, 9, 4, 4))
    out[320:448, 384:512] = np.stack([ring, ring, ring, np.clip(ring, 0, 1)], -1)
    regs['ring'] = (384, 320, 128, 128)
    # wisp: long soft flame tongue for auras
    yy, xx = np.meshgrid(np.linspace(-1, 1, 256), np.linspace(-1, 1, 128), indexing='ij')
    nz = fbm(256, 401, 4, 4)[:, :128]
    width = 0.55 * (1 - (yy + 1) / 2) ** 0.7 + 0.04
    body = np.clip(1 - np.abs(xx + (nz - 0.5) * 0.6) / width, 0, 1) * smoothstep(-1, -0.6, -yy) * smoothstep(1, 0.55, -yy)
    body = body ** 1.4
    out[256:512, 512:640] = np.stack([body, body, body, body], -1)
    regs['wisp'] = (512, 256, 128, 256)
    return out, regs, W, H


def build_ramps():
    def ramp(stops):
        xs = np.linspace(0, 1, 256)
        cols = np.zeros((256, 4), np.float32)
        p = [s[0] for s in stops]
        for c in range(4):
            cols[:, c] = np.interp(xs, p, [s[1][c] for s in stops])
        return cols
    rows = [
        # 0 spark cooling: white-hot → yellow → orange → deep red → off
        [(0, (1, 1, .92, 1)), (.12, (1, .86, .45, 1)), (.45, (1, .5, .12, 1)), (.8, (.6, .12, .03, .8)), (1, (.25, .04, .02, 0))],
        # 1 cursed gold energy
        [(0, (1, .97, .8, 1)), (.2, (1, .78, .32, 1)), (.6, (.9, .45, .12, .9)), (.85, (.45, .16, .42, .5)), (1, (.2, .05, .25, 0))],
        # 2 lunar silver-blue energy
        [(0, (1, 1, 1, 1)), (.2, (.82, .9, 1, 1)), (.6, (.45, .62, 1, .9)), (.85, (.32, .3, .8, .5)), (1, (.12, .1, .35, 0))],
        # 3 dust (alpha ramp: fade in quickly, long dissipation)
        [(0, (1, 1, 1, 0)), (.08, (1, 1, 1, .85)), (.35, (1, 1, 1, .6)), (1, (1, 1, 1, 0))],
        # 4 embers (spirit motes)
        [(0, (1, .95, .7, 0)), (.15, (1, .8, .4, 1)), (.7, (.95, .45, .15, .7)), (1, (.4, .1, .05, 0))],
        # 5 seal: violet undertone to gold
        [(0, (.5, .2, .7, 0)), (.3, (1, .7, .3, 1)), (.7, (1, .9, .6, 1)), (1, (1, .6, .2, 0))],
    ]
    img = np.zeros((16, 256, 4), np.float32)
    for i, r in enumerate(rows):
        img[i] = ramp(r)
    return img


# ------------------------------------------------------------------ main
def to_img(a, mode='RGBA'):
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), mode)


def main():
    preview = '--preview' in sys.argv
    boards = {}
    add_items, stone_items = {}, {}
    for rid, (sheet, x0, y0, x1, y1, kind) in REGIONS.items():
        if sheet not in boards:
            boards[sheet] = load(sheet)
        img = boards[sheet]
        if kind == 'add':
            add_items[rid] = extract_additive(img, sheet, x0, y0, x1, y1) + ((sheet, x0, y0, x1, y1),)
        else:
            stone_items[rid] = extract_stone(img, sheet, x0, y0, x1, y1) + ((sheet, x0, y0, x1, y1),)
        print('extracted', rid, x1 - x0, 'x', y1 - y0)

    atlas = {'version': 1, 'textures': {}, 'regions': {}}

    # ---- additive energy + sparks atlas
    W = H = 2048
    scale = 1.0
    while True:
        dims = [(k, int(round(v[0].shape[1] * scale)), int(round(v[0].shape[0] * scale))) for k, v in add_items.items()]
        pos = pack(dims, W, H)
        if pos:
            break
        scale *= 0.95
    canvas = np.zeros((H, W, 4), np.float32)
    for k, w, h in dims:
        rgb, a, src = add_items[k]
        im = np.concatenate([rgb, a[..., None]], -1)
        if scale != 1.0:
            im = np.asarray(to_img(im).resize((w, h), Image.LANCZOS)).astype(np.float32) / 255
        x, y = pos[k]
        canvas[y:y + h, x:x + w] = im
        atlas['regions'][k] = {'tex': 'energy', 'kind': 'add', 'uv': uv(x, y, w, h, W, H), 'px': [x, y, w, h],
                               'aspect': round(w / h, 4), 'source': {'sheet': src[0], 'rect': list(src[1:])}}
    to_img(canvas).save(os.path.join(OUT, 'vfx-energy.webp'), quality=92, method=6)
    to_img(canvas).resize((W // 2, H // 2), Image.LANCZOS).save(os.path.join(OUT, 'vfx-energy-1k.webp'), quality=90, method=6)
    atlas['textures']['energy'] = {'file': 'vfx-energy.webp', 'low': 'vfx-energy-1k.webp', 'size': [W, H], 'blend': 'additive', 'colorSpace': 'srgb', 'scale': round(scale, 4)}
    print('energy atlas scale', round(scale, 3))

    # ---- stone decal atlas: 4 × 3 cells of 512
    W, H, CELL = 2048, 1536, 512
    col = np.zeros((H, W, 3), np.float32)
    alp = np.zeros((H, W), np.float32)
    nrm = np.zeros((H, W, 3), np.float32) + 0.5
    nrm[..., 2] = 1
    glo = np.zeros((H, W), np.float32)
    for i, (k, (rgb, a, glow, height, src)) in enumerate(stone_items.items()):
        h0, w0 = a.shape
        s = (CELL - 2 * PAD) / max(h0, w0)
        w, h = int(w0 * s), int(h0 * s)
        def rs(x, m='RGB'):
            return np.asarray(to_img(x, m).resize((w, h), Image.LANCZOS)).astype(np.float32) / 255
        cx, cy = (i % 4) * CELL + (CELL - w) // 2, (i // 4) * CELL + (CELL - h) // 2
        col[cy:cy + h, cx:cx + w] = rs(rgb)
        alp[cy:cy + h, cx:cx + w] = rs(a, 'L')
        glo[cy:cy + h, cx:cx + w] = rs(glow, 'L')
        nrm[cy:cy + h, cx:cx + w] = normal_from_height(rs(height, 'L'), 5.0)
        atlas['regions'][k] = {'tex': 'stone', 'kind': 'stone', 'uv': uv(cx, cy, w, h, W, H), 'px': [cx, cy, w, h],
                               'aspect': round(w / h, 4), 'source': {'sheet': src[0], 'rect': list(src[1:])}}
    col = bleed(col, alp)
    to_img(np.concatenate([col, alp[..., None]], -1)).save(os.path.join(OUT, 'vfx-stone.webp'), quality=92, method=6)
    to_img(np.concatenate([nrm, glo[..., None]], -1)).save(os.path.join(OUT, 'vfx-stone-aux.webp'), quality=92, method=6)
    atlas['textures']['stone'] = {'file': 'vfx-stone.webp', 'aux': 'vfx-stone-aux.webp', 'size': [W, H], 'blend': 'alpha', 'colorSpace': 'srgb'}

    # ---- procedural
    noise = build_noise()
    to_img(noise).save(os.path.join(OUT, 'vfx-noise.webp'), lossless=True)
    atlas['textures']['noise'] = {'file': 'vfx-noise.webp', 'size': [512, 512], 'colorSpace': 'linear', 'wrap': 'repeat',
                                  'channels': {'r': 'fbm', 'g': 'cellular', 'ba': 'curl flow (0.5 = 0)'}}
    shapes, regs, W, H = build_shapes()
    to_img(shapes).save(os.path.join(OUT, 'vfx-shapes.webp'), lossless=True)
    for k, (x, y, w, h) in regs.items():
        atlas['regions'][k] = {'tex': 'shapes', 'kind': 'shape', 'uv': uv(x, y, w, h, W, H), 'px': [x, y, w, h], 'aspect': round(w / h, 4), 'source': 'procedural'}
    atlas['textures']['shapes'] = {'file': 'vfx-shapes.webp', 'size': [W, H], 'colorSpace': 'linear'}
    to_img(build_ramps()).save(os.path.join(OUT, 'vfx-ramps.png'))
    atlas['textures']['ramps'] = {'file': 'vfx-ramps.png', 'size': [256, 16], 'colorSpace': 'srgb',
                                  'rows': ['spark', 'gold', 'moon', 'dust', 'ember', 'seal']}
    with open(os.path.join(OUT, 'atlas.json'), 'w') as f:
        json.dump(atlas, f, indent=1, ensure_ascii=False)
    print('regions', len(atlas['regions']))

    if preview:
        pv = os.path.join(OUT, 'preview')
        os.makedirs(pv, exist_ok=True)
        checker = np.indices((2048, 2048)).sum(0) // 32 % 2 * 0.12 + 0.18
        en = np.asarray(Image.open(os.path.join(OUT, 'vfx-energy.webp')).convert('RGBA')).astype(np.float32) / 255
        Image.fromarray((np.clip(en[..., :3] + 0.0, 0, 1) * 255).astype(np.uint8)).resize((1024, 1024)).save(os.path.join(pv, 'energy-atlas.jpg'), quality=88)
        st = np.asarray(Image.open(os.path.join(OUT, 'vfx-stone.webp')).convert('RGBA')).astype(np.float32) / 255
        ch = np.dstack([checker[:1536, :2048]] * 3) * np.array([0.9, 0.85, 0.7])
        comp = st[..., :3] * st[..., 3:] + ch * (1 - st[..., 3:])
        Image.fromarray((comp * 255).astype(np.uint8)).resize((1024, 768)).save(os.path.join(pv, 'stone-atlas-over-checker.jpg'), quality=88)
        ax = np.asarray(Image.open(os.path.join(OUT, 'vfx-stone-aux.webp')).convert('RGBA'))
        Image.fromarray(ax[..., 3]).resize((1024, 768)).save(os.path.join(pv, 'stone-glow-mask.jpg'), quality=88)
        Image.fromarray(ax[..., :3]).resize((1024, 768)).save(os.path.join(pv, 'stone-normal.jpg'), quality=88)
        sh = np.asarray(Image.open(os.path.join(OUT, 'vfx-shapes.webp')).convert('RGBA')).astype(np.float32) / 255
        ch2 = np.dstack([checker[:512, :1024]] * 3)
        Image.fromarray(((sh[..., :3] * sh[..., 3:] + ch2 * (1 - sh[..., 3:])) * 255).astype(np.uint8)).save(os.path.join(pv, 'shapes-over-checker.jpg'), quality=88)
        print('preview written')


if __name__ == '__main__':
    main()
