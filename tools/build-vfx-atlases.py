#!/usr/bin/env python3
"""Process the repository's three static reference sheets and pack runtime atlases."""
import argparse
import hashlib
import json
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / 'vfx-lab'
SOURCES = {
    'energy': '0A9D3E21-25A7-4290-9722-B68258367588.png',
    'ground': '1F9C927B-4439-48C5-86A6-F5E9C8C2C7BD.png',
    'sparks': '3F580150-FF2A-4AD4-A87E-599574FB4ABA.png',
}
CELL = 256
PAD = 8
WIDTH, HEIGHT = 1024, 512


def unmatte(image, kind):
    result = bytearray(image.tobytes())
    width, height = image.size
    for index in range(0, len(result), 4):
        x, y = (index // 4) % width, (index // 4) // width
        radius = min(x, y, width - x - 1, height - y - 1) / 4
        peak = max(result[index:index + 3])
        coverage = max(0, min(1, (peak - (10 if kind == 'ground' else 4)) /
                                 (47 if kind == 'ground' else 251)))
        alpha = round(result[index + 3] * coverage * min(1, radius))
        if alpha:
            gain = min(1.38, 1 / coverage) if kind == 'ground' else 1 / coverage
            for c in range(3):
                result[index + c] = min(255, round(result[index + c] * gain))
        else:
            result[index:index + 3] = b'\0\0\0'
        result[index + 3] = alpha
    return Image.frombytes('RGBA', image.size, result)


def zipped(zip_file, name, data):
    info = ZipInfo(name)
    info.compress_type = ZIP_DEFLATED
    zip_file.writestr(info, data)


def section(zip_file, source_root, destination, kind, config, ref):
    source = source_root / SOURCES[kind]
    tiles = []
    data = []
    with Image.open(source) as image:
        assert image.width == image.height, 'expected a square sheet'
        size = image.width
        to_pixel = lambda v: round(v * size / ref)
        rgba = image.convert('RGBA')
        for number, row in enumerate(config['rows'], start=1):
            for column, (left, right) in enumerate(zip(row['edges'], row['edges'][1:]), start=1):
                bounds = tuple(map(to_pixel, (left, row['top'], right, row['bottom'])))
                tile = unmatte(rgba.crop(bounds), kind)
                if tile.getchannel('A').getbbox() is None:
                    raise ValueError(f'{kind} row {number}, column {column}: empty extraction')
                name = f'{kind}/{kind}-{number:02d}-{column:02d}.png'
                with BytesIO() as bytes_out:
                    tile.save(bytes_out, format='png', optimize=True)
                    zipped(zip_file, name, bytes_out.getvalue())
                tiles.append(tile)
                data.append({'file': name, 'sourceRect': bounds, 'size': tile.size})
    atlas = Image.new('RGBA', (WIDTH, HEIGHT))
    regions = []
    for index, tile_index in enumerate(config['detail']):
        tile = tiles[tile_index].copy()
        tile.thumbnail((CELL - PAD * 2, CELL - PAD * 2), Image.Resampling.LANCZOS)
        x = index % 4 * CELL + PAD
        y = index // 4 * CELL + PAD
        w, h = tile.size
        atlas.paste(tile, (x, y))
        regions.append([(x + .5) / WIDTH, 1 - (y + h - .5) / HEIGHT,
                        (w - 1) / WIDTH, (h - 1) / HEIGHT])
    out = destination / kind
    out.mkdir(parents=True, exist_ok=True)
    atlas.save(out / 'atlas.webp', method=6, lossless=True, exact=False)
    manifest = {
        'source': 'assets/' + source.name,
        'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'space': 'sRGB', 'coverage': 'straight alpha', 'gutter': PAD,
        'size': [WIDTH, HEIGHT], 'regions': regions, 'tiles': data,
        'regionTiles': [data[i]['file'] for i in config['detail']],
    }
    (out / 'regions.json').write_text(json.dumps(manifest, indent=2) + '\n')
    zipped(zip_file, kind + '/atlas.webp', (out / 'atlas.webp').read_bytes())
    zipped(zip_file, kind + '/regions.json', (out / 'regions.json').read_bytes())
    print(f'{kind}: {len(tiles)} RGBA textures, {len(regions)} runtime cells')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / 'assets')
    parser.add_argument('--out', type=Path, default=LAB / 'materials')
    args = parser.parse_args()
    spec = json.loads((LAB / 'atlas-layout.json').read_text())
    args.out.mkdir(parents=True, exist_ok=True)
    with ZipFile(args.out / 'extracted-textures.zip', 'w', compression=ZIP_DEFLATED) as archive:
        for kind, config in spec['sheets'].items():
            section(archive, args.source, args.out, kind, config, spec['referenceSize'])


if __name__ == '__main__':
    main()
