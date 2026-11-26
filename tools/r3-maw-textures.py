#!/usr/bin/env python3
"""R3 «Maw of the Abyss» kit — PBR texture sets (numpy + Pillow + OpenCV + SciPy).

Builds every map used by tools/r3-maw-assets.mjs into an output folder:
  <set>_base.png  (sRGB albedo)      <set>_normal.png (OpenGL / glTF tangent space)
  <set>_orm.png   (R occlusion, G roughness, B metallic)

Sets
  ashlar   1024²  tileable dressed-block masonry (2 m tile)
  rock     1024²  tileable fractured columnar rock (3 m tile)
  bronze    512²  tileable hammered bronze (0.5 m tile)
  top      2048²  elevator platform deck: concentric paving + crescent medallion
  mural    1024²  procession relief, rectified from the reference sheet
  trim     2048²  atlas: rosette band, cuneiform band, platform lamassu frieze
                  and drum lamassu frieze (both rectified from the reference),
                  rivet band, crescent plaque, rosette plaque, bronze medallion,
                  pillar figure panel
  outlines.json   silhouettes traced from the reference (mural slab, bridge)

Usage: python3 tools/r3-maw-textures.py --ref <reference.png> --out <dir>
"""
import argparse, json, math
from pathlib import Path
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFilter
from scipy.spatial import cKDTree
from scipy import ndimage as ndi

ap = argparse.ArgumentParser()
ap.add_argument('--ref', required=True)
ap.add_argument('--out', required=True)
args = ap.parse_args()
OUT = Path(args.out); OUT.mkdir(parents=True, exist_ok=True)
REF = cv2.cvtColor(cv2.imread(args.ref, cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB).astype(np.float32) / 255

# Reference palette (sRGB, measured on the sheet: median lit stone / rock / metal).
STONE = np.array([150, 108, 88]) / 255
STONE_DARK = np.array([92, 62, 48]) / 255
ROCK = np.array([128, 88, 68]) / 255
ROCK_DARK = np.array([70, 48, 38]) / 255
BRONZE = np.array([176, 112, 72]) / 255
PATINA = np.array([86, 58, 42]) / 255


# ---------------------------------------------------------------- helpers ----
def spectral(n, beta, rng, m=None):
    """Tileable fractal noise (1/f^beta) in [-1,1]."""
    m = m or n
    w = rng.standard_normal((m, n))
    fy = np.fft.fftfreq(m)[:, None]; fx = np.fft.fftfreq(n)[None, :]
    f = np.sqrt(fx * fx + fy * fy); f[0, 0] = 1
    out = np.real(np.fft.ifft2(np.fft.fft2(w) / f ** beta))
    out -= out.mean(); out /= np.abs(out).max() + 1e-9
    return out.astype(np.float32)


def blur(a, s, wrap=True):
    return ndi.gaussian_filter(a, s, mode='wrap' if wrap else 'reflect')


def normal_from_height(h, strength, wrap=True):
    if wrap:
        dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * .5
        dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * .5
    else:
        dy, dx = np.gradient(h)
    n = np.dstack((-dx * strength, dy * strength, np.ones_like(h)))
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n


def cavity_ao(h, radii=(2, 8, 24), k=(5., 3., 1.6), wrap=True):
    ao = np.ones_like(h)
    for r, kk in zip(radii, k):
        ao += np.minimum(0, h - blur(h, r, wrap)) * kk
    return np.clip(ao, .35, 1)


def save(name, base, normal, rough, ao, metal=None):
    metal = np.zeros_like(rough) if metal is None else metal
    Image.fromarray(np.uint8(np.clip(base, 0, 1) * 255 + .5)).save(OUT / f'{name}_base.png')
    Image.fromarray(np.uint8(np.clip(normal * .5 + .5, 0, 1) * 255 + .5)).save(OUT / f'{name}_normal.png')
    orm = np.dstack((ao, rough, metal))
    Image.fromarray(np.uint8(np.clip(orm, 0, 1) * 255 + .5)).save(OUT / f'{name}_orm.png')
    print('wrote', name, base.shape[1], 'x', base.shape[0])


def lerp(a, b, t):
    return a + (b - a) * t[..., None]


def stone_colour(h, grain, rng, base=STONE, dark=STONE_DARK, n=None):
    n = h.shape[0]
    mott = spectral(h.shape[1], 1.6, rng, h.shape[0]) * .5 + .5
    t = np.clip(.55 + grain * .25 + (mott - .5) * .5, 0, 1)
    col = lerp(dark, base * 1.1, t)
    return col


# ------------------------------------------------------------- ashlar 1024 ---
def ashlar(n=1024, seed=11):
    rng = np.random.default_rng(seed)
    h = np.zeros((n, n), np.float32); tint = np.zeros((n, n), np.float32)
    rows = 6; rh = n // rows
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    for r in range(rows):
        y0 = r * rh; y1 = y0 + rh
        x = rng.uniform(0, n); cuts = []
        total = 0
        while total < n:
            w = rng.uniform(.17, .42) * n; cuts.append(w); total += w
        cuts = np.array(cuts) * n / total
        x0 = x
        for w in cuts:
            gap = rng.uniform(4, 7)
            # local coords with wrap in x
            lx = (xx[y0:y1] - x0) % n
            m = lx < w
            dx = np.minimum(lx, w - lx); dy = np.minimum(yy[y0:y1] - y0, y1 - yy[y0:y1])
            d = np.minimum(dx, dy) - gap * .5
            chip = spectral(n, 1.2, rng)[y0:y1] * 9
            bev = np.clip((d + chip * .5) / 10, 0, 1) ** .6
            top = rng.uniform(.82, 1.0) + (lx / w - .5) * rng.uniform(-.06, .06) + ((yy[y0:y1] - y0) / rh - .5) * rng.uniform(-.06, .06)
            h[y0:y1][m] = (bev * top)[m]
            tint[y0:y1][m] = rng.uniform(-1, 1)
            x0 += w
    grain = spectral(n, 1.05, rng)
    pits = (spectral(n, .6, rng) > .55).astype(np.float32)
    cracks = np.abs(spectral(n, 1.4, rng)); cracks = np.clip(1 - cracks / .025, 0, 1) * (spectral(n, 2, rng) > .1)
    hh = h + grain * .05 - pits * .05 * (h > .2) - cracks * .18 * (h > .3)
    col = stone_colour(hh, grain, rng)
    col *= (1 + tint[..., None] * .09)
    col = lerp(col, STONE_DARK * .55, np.clip(1 - h * 1.6, 0, 1) * .8)          # mortar / joints
    ao = cavity_ao(hh)
    col *= (.55 + .45 * ao[..., None])
    rough = np.clip(.86 + grain * .06 - h * .05 + (1 - h) * .08, .7, .97)
    save('ashlar', col, normal_from_height(hh * 24, 1.0), rough, ao)
    return hh


# --------------------------------------------------------------- rock 1024 ---
def rock(n=1024, seed=23):
    rng = np.random.default_rng(seed)
    pts = rng.random((90, 2))
    pts[:, 1] *= 1  # cells
    tree = cKDTree(pts * [1, .55], boxsize=[1, .55])                        # vertically elongated facets
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / n
    q = np.column_stack((xx.ravel(), yy.ravel() * .55))
    warp = spectral(n, 1.7, rng) * .02
    q[:, 0] = (q[:, 0] + warp.ravel()) % 1
    d, idx = tree.query(q, k=2)
    f1 = d[:, 0].reshape(n, n); f2 = d[:, 1].reshape(n, n); cell = idx[:, 0].reshape(n, n)
    edge = (f2 - f1)
    slopes = rng.uniform(-1, 1, (len(pts), 2)) * .6
    off = rng.uniform(.6, 1, len(pts))
    rel = np.dstack((xx, yy * .55)) - pts[cell] * [1, .55]
    rel = (rel + .5) % 1 - .5
    plane = off[cell] + (rel[..., 0] * slopes[cell, 0] + rel[..., 1] * slopes[cell, 1]) * 2.2
    crack = np.clip(edge / .012, 0, 1) ** .5
    grain = spectral(n, 1.1, rng); coarse = spectral(n, 1.9, rng)
    strata = np.sin((yy * 38 + coarse * 3) * math.pi) * .5 + .5
    h = plane * crack + grain * .05 + strata * .02 + coarse * .08
    ao = cavity_ao(h, (2, 10, 30), (6, 3, 1.4))
    tone = np.clip(.5 + grain * .3 + (off[cell] - .8) * 1.4 + coarse * .25, 0, 1)
    col = lerp(ROCK_DARK, ROCK * 1.15, tone)
    col = lerp(col, ROCK_DARK * .45, (1 - crack) * .85)
    col *= (.5 + .5 * ao[..., None])
    rough = np.clip(.9 + grain * .05, .78, .98)
    save('rock', col, normal_from_height(h * 30, 1.0), rough, ao)


# -------------------------------------------------------------- bronze 512 ---
def bronze(n=512, seed=5):
    rng = np.random.default_rng(seed)
    pts = rng.random((160, 2)); tree = cKDTree(pts, boxsize=1)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / n
    d, _ = tree.query(np.column_stack((xx.ravel(), yy.ravel())), k=1)
    dent = -(1 - np.clip(d.reshape(n, n) / .05, 0, 1)) ** 2
    grain = spectral(n, 1.2, rng); patch = spectral(n, 1.45, rng) * .5 + .5
    scratches = np.clip(1 - np.abs(spectral(n, 1.6, rng)) / .01, 0, 1) * .4
    h = dent * .5 + grain * .08 - scratches * .1
    pat = np.clip((patch - .45) * 2.2, 0, 1) * .75
    col = lerp(BRONZE, PATINA, pat)
    col *= (1 + grain[..., None] * .06)
    rough = np.clip(.38 + pat * .38 + grain * .05 + scratches * .1, .25, .9)
    metal = np.clip(1 - pat * .45, .4, 1)
    ao = cavity_ao(h, (2, 6, 16), (4, 2, 1))
    save('bronze', col, normal_from_height(h * 10, 1.0), rough, ao, metal)


# ------------------------------------------------ platform deck 2048 (top) ---
def deck(n=2048, seed=31, R=2.70):
    """Planar UV over the disk r<=R. Concentric paving courses + medallion."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    x = (xx / n * 2 - 1) * R; y = -(yy / n * 2 - 1) * R
    r = np.hypot(x, y); th = np.arctan2(y, x)
    h = np.zeros((n, n), np.float32); tint = np.zeros_like(h)
    px = n / (2 * R)                                     # px per metre
    # medallion ring 0..0.95 m: flat disk with raised crescent, ring band 0.95..1.15
    rings = [1.15, 1.47, 1.79, 2.11, 2.43, R + .05]
    prev = 1.15
    for i, r1 in enumerate(rings[1:]):
        r0 = rings[i]
        m = (r >= r0) & (r < r1)
        circ = 2 * math.pi * (r0 + r1) / 2
        k = max(8, int(circ / rng.uniform(.38, .46)))
        phase = rng.uniform(0, 2 * math.pi)
        # uneven joints
        cuts = np.sort(rng.uniform(0, 1, k)); cuts = (np.arange(k) + .5 + (cuts - .5) * .5) / k
        a = ((th + phase) % (2 * math.pi)) / (2 * math.pi)
        idx = np.searchsorted(cuts, a) % k
        lo = cuts[(idx - 1) % k]; hi = cuts[idx]
        span = (hi - lo) % 1
        da = np.minimum((a - lo) % 1, (hi - a) % 1) * 2 * math.pi * r
        dr = np.minimum(r - r0, r1 - r)
        d = np.minimum(da, dr) * px - 3
        chip = spectral(n, 1.2, rng) * 6
        bev = np.clip((d + chip) / 9, 0, 1) ** .6
        top = .84 + rng.uniform(0, .16, k)[idx]
        h[m] = (bev * top)[m]; tint[m] = rng.uniform(-1, 1, k)[idx][m]
    # medallion
    m0 = r < 1.15
    ringband = np.clip(1 - np.abs(r - 1.05) / .08, 0, 1)
    disk = np.where(r < .95, .78, 0) + np.clip((.97 - r) * px / 5, 0, 1) * 0
    # crescent opening to upper right like the reference
    c1 = np.hypot(x + .05, y + .02) < .62; c2 = np.hypot(x - .2, y - .17) < .52
    cres = (c1 & ~c2).astype(np.float32)
    cres = blur(cres, 3, False)
    med = np.maximum(disk, .82 * np.clip((r - .95) * px / 3, 0, 1) * (r < 1.15)) + ringband * .12 + cres * .22
    h[m0] = med[m0]
    grain = spectral(n, 1.05, rng)
    cracks = np.clip(1 - np.abs(spectral(n, 1.45, rng)) / .02, 0, 1) * (spectral(n, 2, rng) > .2)
    hh = h + grain * .045 - cracks * .16 * (h > .3)
    col = stone_colour(hh, grain, rng)
    col *= (1 + tint[..., None] * .08)
    col = lerp(col, STONE_DARK * .55, np.clip(1 - h * 1.5, 0, 1) * .8)
    col = lerp(col, STONE * 1.18, cres * .35)
    ao = cavity_ao(hh, (2, 8, 24), (5, 3, 1.4), wrap=False)
    col *= (.55 + .45 * ao[..., None])
    rough = np.clip(.85 + grain * .06 - cres * .1 + (1 - h) * .08, .65, .97)
    save('top', col, normal_from_height(hh * 26, 1.0, wrap=False), rough, ao)


# --------------------------------------------------- reference extraction ---
def ref_quad(corners, size):
    """corners TL, TR, BR, BL in sheet pixels -> rectified RGB float image."""
    w, hgt = size
    M = cv2.getPerspectiveTransform(np.float32(corners), np.float32([[0, 0], [w, 0], [w, hgt], [0, hgt]]))
    return cv2.warpPerspective(REF, M, (w, hgt), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)


def ref_cylinder(x0, x1, top, bottom, size, half_angle):
    """Unroll a frontal cylindrical band: top(x)/bottom(x) are callables in sheet px."""
    w, hgt = size
    u = np.linspace(-1, 1, w, dtype=np.float32)
    cx = (x0 + x1) / 2; rad = (x1 - x0) / 2 / math.sin(half_angle)
    xs = cx + rad * np.sin(u * half_angle)
    v = np.linspace(0, 1, hgt, dtype=np.float32)[:, None]
    ys = top(xs)[None, :] * (1 - v) + bottom(xs)[None, :] * v
    mapx = np.broadcast_to(xs[None, :], (hgt, w)).astype(np.float32)
    return cv2.remap(REF, mapx, ys.astype(np.float32), cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)


def relief_from_photo(img, seed, depth=1.0, flatten=40):
    """Albedo + height from a lit reference crop. Broad lighting is divided
    out, local relief shading kept as cavity; upscaling softness is countered
    with an unsharp mask and fine stone grain."""
    rng = np.random.default_rng(seed)
    hgt, w = img.shape[:2]
    lum = img @ np.float32([.3, .59, .11])
    sharp = img + (img - cv2.GaussianBlur(img, (0, 0), 2.2)) * .9
    lum_s = sharp @ np.float32([.3, .59, .11])
    broad = cv2.GaussianBlur(lum, (0, 0), flatten) + 1e-3
    flat = sharp / broad[..., None] * .42
    grain = spectral(max(w, hgt), 1.05, rng)[:hgt, :w]
    detail = cv2.GaussianBlur(lum_s, (0, 0), 1.0)
    coarse = cv2.GaussianBlur(lum_s, (0, 0), 14)
    height = (detail - coarse * .6) / (broad * 1.2) + grain * .03
    # recolour toward the measured palette, keep relative tone
    tone = np.clip(flat @ np.float32([.3, .59, .11]) / .42, 0, 2)
    col = lerp(STONE_DARK * .6, STONE * 1.12, np.clip(tone * .62, 0, 1))
    col = col * .55 + np.clip(flat, 0, 1) * .45
    col *= (1 + grain[..., None] * .06)
    return col.astype(np.float32), height.astype(np.float32)


def periodic_u(a, radius):
    a = a.copy()
    for i in range(radius):
        t = .5 * (1 + math.cos(math.pi * i / radius)) * .5
        l, r = a[:, i].copy(), a[:, -1 - i].copy()
        a[:, i] = l + (r - l) * t; a[:, -1 - i] = r + (l - r) * t
    return a


# --------------------------------------------------- procedural reliefs ---
def draw_height(size, fn, ss=2):
    """Draw with PIL at ss× then downsample -> float height."""
    w, h = size
    im = Image.new('F', (w * ss, h * ss), 0.0)
    d = ImageDraw.Draw(im)
    fn(d, ss)
    a = np.asarray(im, np.float32)
    return cv2.resize(a, (w, h), interpolation=cv2.INTER_AREA)


def rosette_band(w=2048, h=160, period=128, seed=41):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    lx = (xx % period) - period / 2; ly = yy - h / 2
    r = np.hypot(lx, ly); th = np.arctan2(ly, lx)
    R = period * .38
    ring = np.clip(1 - np.abs(r - R) / 7, 0, 1) ** .7
    spiral_r = (th + math.pi) / (2 * math.pi) * R * .75 + 6
    spiral = np.zeros_like(r)
    for k in range(3):
        spiral = np.maximum(spiral, np.clip(1 - np.abs(r - (spiral_r + k * R * .26 - R * .26)) / 3.2, 0, 1) * (r < R - 6))
    boss = np.clip(1 - r / 7, 0, 1)
    fillet = (np.clip(1 - np.abs(yy - 8) / 5, 0, 1) + np.clip(1 - np.abs(yy - (h - 9)) / 5, 0, 1))
    hh = .35 + ring * .45 + spiral * .3 + boss * .4 + fillet * .45
    hh = np.where((yy < 3) | (yy > h - 4), .2, hh)
    return hh


def cuneiform_band(w=2048, h=320, cell=64, seed=43, rows=3):
    rng = np.random.default_rng(seed)

    def fn(d, s):
        rh = h / rows
        for r in range(rows):
            for c in range(w // cell):
                x0 = c * cell + 6; y0 = r * rh + 8; cw = cell - 12; ch = rh - 16
                d.rectangle([x0 * s, y0 * s, (x0 + cw) * s, (y0 + ch) * s], outline=.55, width=int(2.5 * s))
                for _ in range(rng.integers(2, 6)):
                    vert = rng.random() < .45
                    px = x0 + rng.uniform(6, cw - 10); py = y0 + rng.uniform(6, ch - 10)
                    L = rng.uniform(10, 26)
                    if vert:
                        d.polygon([((px - 4) * s, py * s), ((px + 4) * s, py * s), (px * s, (py + 6) * s)], fill=-.8)
                        d.line([(px * s, py * s), (px * s, min(py + L, y0 + ch - 3) * s)], fill=-.6, width=int(2.2 * s))
                    else:
                        d.polygon([(px * s, (py - 4) * s), (px * s, (py + 4) * s), ((px + 6) * s, py * s)], fill=-.8)
                        d.line([(px * s, py * s), (min(px + L, x0 + cw - 3) * s, py * s)], fill=-.6, width=int(2.2 * s))
    a = draw_height((w, h), fn)
    a = cv2.GaussianBlur(a, (0, 0), .9)
    return .6 + a * .35


def plaque(size, kind):
    s = size

    def frame(d, ss):
        m = int(s * .06)
        d.rectangle([0, 0, s * ss, s * ss], fill=.9)
        d.rectangle([m * ss, m * ss, (s - m) * ss, (s - m) * ss], fill=.55)
        d.rectangle([(m + 10) * ss, (m + 10) * ss, (s - m - 10) * ss, (s - m - 10) * ss], fill=.42)

    def fn(d, ss):
        frame(d, ss)
        c = s / 2
        if kind == 'crescent':
            R = s * .3
            d.ellipse([(c - R) * ss, (c - R) * ss, (c + R) * ss, (c + R) * ss], fill=.85)
            R2 = R * .82; ox, oy = R * .38, -R * .3
            d.ellipse([(c + ox - R2) * ss, (c + oy - R2) * ss, (c + ox + R2) * ss, (c + oy + R2) * ss], fill=.42)
        elif kind == 'rosette':
            R = s * .3
            d.ellipse([(c - R * 1.12) * ss, (c - R * 1.12) * ss, (c + R * 1.12) * ss, (c + R * 1.12) * ss], outline=.62, width=int(4 * ss))
            for k in range(8):
                a = k * math.pi / 4
                pts = []
                for t in np.linspace(-1, 1, 24):
                    rr = R * (1 - t * t) ** .5 * .32
                    along = (t + 1) / 2 * R
                    pts.append((c + math.cos(a) * along - math.sin(a) * rr * (1 if t > -2 else 1),
                                c + math.sin(a) * along + math.cos(a) * rr))
                for t in np.linspace(1, -1, 24):
                    rr = R * (1 - t * t) ** .5 * .32
                    along = (t + 1) / 2 * R
                    pts.append((c + math.cos(a) * along + math.sin(a) * rr, c + math.sin(a) * along - math.cos(a) * rr))
                d.polygon([(x * ss, y * ss) for x, y in pts], fill=.82)
            d.ellipse([(c - R * .18) * ss, (c - R * .18) * ss, (c + R * .18) * ss, (c + R * .18) * ss], fill=.95)
    a = draw_height((s, s), fn)
    a = cv2.GaussianBlur(a, (0, 0), 1.6)
    return a


def medallion(size=448, seed=47):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    c = size / 2; r = np.hypot(xx - c, yy - c) / c; th = np.arctan2(yy - c, xx - c)
    h = np.full_like(r, .5)
    for R in (.97, .82, .62, .42, .24):
        h += np.clip(1 - np.abs(r - R) / .018, 0, 1) * .35
    ticks = (np.abs(np.sin(th * 48)) > .82) & (r > .84) & (r < .95)
    h += ticks * .18
    dots = (np.hypot((r - .72) * 40, np.sin(th * 18) * 10) < 1.4)
    h += dots * .25
    glyph = (np.abs(np.sin(th * 30 + np.floor(r * 30))) > .9) & (r > .46) & (r < .58)
    h -= glyph * .2
    h += np.clip(1 - r / .14, 0, 1) * .5
    h = cv2.GaussianBlur(h.astype(np.float32), (0, 0), 1.0)
    return h, r


def trim():
    n = 2048
    rng = np.random.default_rng(53)
    H = np.zeros((n, n), np.float32); C = np.zeros((n, n, 3), np.float32)
    R = np.full((n, n), .86, np.float32); M = np.zeros((n, n), np.float32)
    grain = spectral(n, 1.05, rng)
    layout = {}

    def put(name, y0, x0, hgt, col=None, rough=None, metal=None, wrap=False):
        hh, ww = hgt.shape
        H[y0:y0 + hh, x0:x0 + ww] = hgt
        if col is None:
            g = grain[y0:y0 + hh, x0:x0 + ww]
            col = lerp(STONE_DARK, STONE * 1.1, np.clip(.25 + hgt * .7 + g * .2, 0, 1))
        C[y0:y0 + hh, x0:x0 + ww] = col
        if rough is not None: R[y0:y0 + hh, x0:x0 + ww] = rough
        if metal is not None: M[y0:y0 + hh, x0:x0 + ww] = metal
        layout[name] = [x0 / n, y0 / n, (x0 + ww) / n, (y0 + hh) / n]

    put('rosette_band', 0, 0, rosette_band())
    put('cuneiform_band', 160, 0, cuneiform_band())
    # platform frieze: sheet x 160..535, top 223(edges)/228(centre), bottom 290/297
    pc = 347.5
    top = lambda x: 228 - 5 * ((x - pc) / 187.5) ** 2
    bot = lambda x: 297 - 7 * ((x - pc) / 187.5) ** 2
    img = ref_cylinder(160, 535, top, bot, (2048, 512), math.radians(46))
    col, hgt = relief_from_photo(img, 61)
    hgt = periodic_u(hgt, 12); col = periodic_u(col, 12)
    put('platform_frieze', 480, 0, (hgt - hgt.mean()) * 1.0 + .5, col)
    # drum frieze: left / right panels between pillars (sheet px, quads TL TR BR BL)
    left = ref_quad([[762, 67], [905, 57], [905, 105], [762, 117]], (1024, 512))
    right = ref_quad([[972, 57], [1116, 68], [1116, 117], [972, 105]], (1024, 512))
    img = np.concatenate([left, right], axis=1)
    col, hgt = relief_from_photo(img, 67)
    hgt = periodic_u(hgt, 12); col = periodic_u(col, 12)
    put('drum_frieze', 992, 0, (hgt - hgt.mean()) * 1.0 + .5, col)
    # rivet band (bronze)
    yy, xx = np.mgrid[0:96, 0:n].astype(np.float32)
    lx = (xx % 64) - 32; ly = yy - 48
    riv = np.clip(1 - (lx * lx + ly * ly) / 110, 0, 1) ** .5
    band = .5 + riv * .5 + (np.abs(ly) > 40) * .15
    bcol = lerp(BRONZE, PATINA, np.clip(.4 - riv * .4 + grain[1504:1600] * .3, 0, 1))
    put('rivet_band', 1504, 0, band, bcol, np.full_like(band, .45), np.full_like(band, .95))
    # squares
    put('crescent_plaque', 1600, 0, plaque(448, 'crescent'))
    put('rosette_plaque', 1600, 448, plaque(448, 'rosette'))
    mh, mr = medallion()
    g = grain[1600:2048, 896:1344]
    mcol = lerp(BRONZE, PATINA, np.clip(.55 - (mh - .5) * .9 + g * .3, 0, 1))
    put('medallion', 1600, 896, mh, mcol, np.clip(.5 - (mh - .5) * .25, .3, .8), np.full_like(mh, .92))
    # pillar figure panel from the sheet (front pillar, sheet x 113..135, y 188..260)
    img = ref_quad([[112, 186], [137, 186], [137, 262], [112, 262]], (448, 1344 // 3 * 3 // 1 if False else 448))
    pimg = ref_quad([[112, 186], [137, 186], [137, 262], [112, 262]], (224, 448))
    col, hgt = relief_from_photo(pimg, 71, flatten=30)
    put('pillar_panel', 1600, 1344, (hgt - hgt.mean()) * 1.0 + .5, col)
    # plain stone remainder
    rest = .5 + grain[1600:2048, 1568:] * .05
    put('plain', 1600, 1568, rest)

    hh = H + grain * .025
    ao = cavity_ao(hh, (2, 6, 18), (5, 3, 1.4), wrap=False)
    stone = M < .5
    C *= np.where(stone[..., None], (.6 + .4 * ao[..., None]), (.75 + .25 * ao[..., None]))
    R = np.where(stone, np.clip(R + grain * .05 - (hh - .5) * .08, .6, .97), R)
    save('trim', C, normal_from_height(hh * 22, 1.0, wrap=False), R, ao, M)
    return layout


def mural():
    # mural slab, sheet rect x 1228..1490, y 338..582 (frontal view)
    x0, y0, x1, y1 = 1228, 338, 1490, 582
    img = ref_quad([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], (1024, 1024))
    # slab mask in texture space; everything outside (black sheet background)
    # is replaced by inpainted stone so no dark fringe can reach the slab edge
    mask = (cv2.GaussianBlur(img.max(axis=2), (0, 0), 1.5) > .09).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    mask = cv2.erode(mask, np.ones((7, 7), np.uint8))
    col, hgt = relief_from_photo(img, 73, flatten=60)
    hole = (1 - mask).astype(np.uint8)
    c8 = np.uint8(np.clip(col, 0, 1) * 255)
    small = cv2.inpaint(cv2.resize(c8, (256, 256)), cv2.resize(hole, (256, 256), interpolation=cv2.INTER_NEAREST), 6, cv2.INPAINT_TELEA)
    fill = cv2.resize(small, (1024, 1024), interpolation=cv2.INTER_CUBIC).astype(np.float32) / 255
    soft = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), 2)[..., None]
    col = col * soft + fill * (1 - soft)
    inside = hgt[mask > 0].mean()
    hgt = hgt * soft[..., 0] + inside * (1 - soft[..., 0])
    hh = hgt - inside
    ao = cavity_ao(hh, (2, 8, 22), (5, 3, 1.4), wrap=False)
    col *= (.6 + .4 * ao[..., None])
    rough = np.clip(.88 - hh * .1, .7, .97)
    save('mural', col, normal_from_height(hh * 30, 1.0, wrap=False), rough, ao)
    return [x0, y0, x1, y1]


def outline(rect, thresh=.07, eps=1.0, close=3):
    x0, y0, x1, y1 = rect
    crop = REF[y0:y1, x0:x1]
    lum = crop.max(axis=2)
    m = (lum > thresh).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((close, close), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    cs, hier = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    cs = sorted(cs, key=cv2.contourArea, reverse=True)
    c = cv2.approxPolyDP(cs[0], eps, True)[:, 0, :].astype(float)
    return {'rect': rect, 'points': c.tolist()}


if __name__ == '__main__':
    ashlar(); rock(); bronze(); deck()
    layout = trim()
    mrect = mural()
    outlines = {
        'mural': outline((1218, 330, 1500, 590)),
        'bridge': outline((695, 320, 1180, 585)),
        'mural_rect': mrect,
        'trim_layout': layout,
    }
    (OUT / 'outlines.json').write_text(json.dumps(outlines))
    print('outlines', {k: len(v['points']) for k, v in outlines.items() if isinstance(v, dict) and 'points' in v})
