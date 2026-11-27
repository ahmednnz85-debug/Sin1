#!/usr/bin/env python3
"""Extract the authored Babylon meshes and the paving/relief reference sheet.

Run from any directory with numpy, scipy and Pillow. The source GLBs and JPG
are read-only. Disconnected models share their three maps in each output pack.
"""
import io
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

ROOT = Path(__file__).resolve().parents[1] / "assets"
OUT = ROOT / "babylon"
DTYPES = {5126: "<f4", 5123: "<u2", 5125: "<u4"}
SHAPES = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}


def read_glb(source):
    data = source.read_bytes()
    length = struct.unpack_from("<I", data, 12)[0]
    return json.loads(data[20:20 + length]), data[28 + length:]


def accessor(doc, binary, index):
    a = doc["accessors"][index]
    v = doc["bufferViews"][a["bufferView"]]
    dtype = np.dtype(DTYPES[a["componentType"]])
    width = SHAPES[a["type"]]
    return np.ndarray((a["count"], width), dtype=dtype, buffer=binary,
                      offset=v.get("byteOffset", 0) + a.get("byteOffset", 0),
                      strides=(v.get("byteStride", width * dtype.itemsize), dtype.itemsize))


def image_payload(doc, binary, image, limit):
    view = doc["bufferViews"][image["bufferView"]]
    offset = view.get("byteOffset", 0)
    im = Image.open(io.BytesIO(binary[offset:offset + view["byteLength"]])).convert("RGB")
    im.thumbnail((limit, limit), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=88, method=6)
    return buf.getvalue()


def connected_indices(vertices, faces):
    # Weld for connectivity only. The original UVs, normals and indices are
    # still used at seams and on both sides of thin cloth.
    _, welded = np.unique(np.rint(vertices / 0.00001).astype(np.int64), axis=0, return_inverse=True)
    mapped = welded[faces]
    size = int(welded.max() + 1)
    graph = coo_matrix((np.ones(mapped.size, dtype=bool),
                        (mapped.ravel(), mapped[:, [1, 2, 0]].ravel())), shape=(size, size))
    count, labels = connected_components(graph.tocsr(), directed=False)
    result = labels[mapped[:, 0]]
    return [faces[result == i] for i in range(count)]


def pack(source, target, names, limits, select_parts=None):
    doc, binary = read_glb(ROOT / source)
    prim = doc["meshes"][0]["primitives"][0]
    attrs = {key: accessor(doc, binary, i) for key, i in prim["attributes"].items()}
    pos = attrs["POSITION"]
    faces = accessor(doc, binary, prim["indices"]).reshape(-1, 3)
    parts = connected_indices(pos, faces)
    if select_parts:
        parts = select_parts(pos, parts)
    if len(parts) != len(names):
        raise ValueError(f"{source} has {len(parts)} connected models, expected {len(names)}")
    payloads, views, acc, meshes = [], [], [], []
    offsets = [0]

    def add(buf, target=None):
        view = dict(buffer=0, byteOffset=offsets[-1], byteLength=len(buf))
        if target:
            view["target"] = target
        views.append(view)
        padded = buf + bytes((-len(buf)) % 4)
        payloads.append(padded)
        offsets.append(offsets[-1] + len(padded))
        return len(views) - 1

    def write(a, type_code, target, bounds=False):
        a = np.ascontiguousarray(a)
        entry = dict(bufferView=add(a.tobytes(), target), componentType=type_code,
                     count=len(a), type={1: "SCALAR", 2: "VEC2", 3: "VEC3"}[a.shape[1]])
        if bounds:
            entry.update(min=a.min(axis=0).tolist(), max=a.max(axis=0).tolist())
        acc.append(entry)
        return len(acc) - 1

    images = [{"bufferView": add(image_payload(doc, binary, img, limit)), "mimeType": "image/webp"}
              for img,limit in zip(doc["images"], limits, strict=True)]
    for name, triangles in zip(names, parts):
        ids, local = np.unique(triangles, return_inverse=True)
        positions = pos[ids].copy()
        low, high = positions.min(axis=0), positions.max(axis=0)
        positions -= [(low[0] + high[0]) / 2, low[1], (low[2] + high[2]) / 2]
        buffers = {key: write(positions if key == "POSITION" else data[ids], 5126, 34962, key == "POSITION")
                   for key, data in attrs.items()}
        dtype, component = ("<u2", 5123) if len(ids) <= 65535 else ("<u4", 5125)
        indices = write(local.astype(dtype).reshape(-1, 1), component, 34963)
        meshes.append({"name": name, "primitives": [{"attributes": buffers, "indices": indices, "material": 0}]})
        print(name, len(triangles), (high - low).round(5))
    textures = [{**{k: v for k, v in item.items() if k != "source"},
                 "extensions": {"EXT_texture_webp": {"source": item["source"]}}} for item in doc["textures"]]
    output = dict(asset={"version": "2.0", "generator": "Sin1 Babylon asset extraction"},
                  scene=0, scenes=[{"nodes": list(range(len(meshes)))}],
                  nodes=[{"name": item["name"], "mesh": i} for i, item in enumerate(meshes)],
                  meshes=meshes, accessors=acc, bufferViews=views, buffers=[{"byteLength": offsets[-1]}],
                  images=images, textures=textures, materials=doc["materials"],
                  extensionsUsed=["EXT_texture_webp"], extensionsRequired=["EXT_texture_webp"])
    if "samplers" in doc:
        output["samplers"] = doc["samplers"]
    j = json.dumps(output, separators=(",", ":")).encode()
    j += b" " * (-len(j) % 4)
    with (OUT / target).open("wb") as file:
        file.write(struct.pack("<4sII", b"glTF", 2, 28 + len(j) + offsets[-1]))
        file.write(struct.pack("<I4s", len(j), b"JSON"))
        file.write(j)
        file.write(struct.pack("<I4s", offsets[-1], b"BIN\x00"))
        file.writelines(payloads)


def pack_braziers():
    # The furniture sheet is one mesh. Select the three vessels by the same
    # component counts as royal-offerings.js, then trim the welded smoke and
    # flame silhouettes at the rims. Leave the original stone and metal intact.
    vessels = [("GateBrazier", 2700, .649), ("IncenseStand", 3326, .653), ("IncenseBowl", 2986, .399)]

    def select(pos, parts):
        by_count = {len(part): part for part in parts}
        selected = []
        for _, count, rim in vessels:
            faces = by_count[count]
            heights = pos[faces, 1]
            cut = heights.min() + np.ptp(heights) * rim
            selected.append(faces[heights.mean(axis=1) <= cut])
        return selected

    pack("اثاث القرابين.glb", "braziers.glb", [name for name, _, _ in vessels], (1024, 512, 256), select)


def flatten(im, points, size):
    return im.transform(size, Image.Transform.QUAD, tuple(n for point in points for n in point),
                        Image.Resampling.BICUBIC)


def material_crop(name, crop, normal=0, rough=0):
    crop.save(OUT / f"{name}.webp", "WEBP", quality=91, method=6)
    if not normal:
        return
    lum = np.asarray(ImageOps.grayscale(crop)).astype(float) / 255
    base = np.asarray(ImageOps.grayscale(crop).filter(ImageFilter.GaussianBlur(11))).astype(float) / 255
    detail = lum - base
    gy, gx = np.gradient(detail)
    vectors = np.stack((-gx * normal, gy * normal, np.ones_like(lum)), axis=-1)
    vectors /= np.linalg.norm(vectors, axis=-1, keepdims=True)
    Image.fromarray(np.uint8((vectors * .5 + .5) * 255)).save(OUT / f"{name}-normal.webp", "WEBP", quality=88)
    result = np.uint8(np.clip(rough - 0.30 * detail, .52, .96) * 255)
    Image.fromarray(result).convert("RGB").save(OUT / f"{name}-rough.webp", "WEBP", quality=88)


def textures():
    im = Image.open(ROOT / "خامات البداية.JPG").convert("RGB")
    # Each selection lies inside an individual authored stone. The runtime
    # lays them in staggered courses, with independent joints and orientations.
    samples = [
        (106, 14, 207, 51), (221, 14, 286, 53), (299, 14, 405, 55),
        (21, 68, 85, 110), (103, 64, 199, 98), (218, 67, 387, 111),
        (23, 434, 100, 511), (115, 435, 178, 510), (191, 437, 271, 511),
        (284, 435, 449, 510), (466, 437, 533, 509), (431, 277, 495, 357),
    ]
    atlas = Image.new("RGB", (1024, 384))
    for index, region in enumerate(samples):
        tile = im.crop(region).resize((256, 128), Image.Resampling.LANCZOS)
        pixels = np.asarray(tile).astype(float)
        pixels = np.clip(pixels * np.array([1.10, 1.065, 1.009]) + [6, 5, 4], 0, 255)
        atlas.paste(Image.fromarray(pixels.astype("uint8")), ((index % 4)*256, (index // 4)*128))
    material_crop("paving", atlas, 3.25, .70)
    medallion = flatten(im, [(154, 122), (132, 352), (419, 351), (396, 121)], (512, 448))
    material_crop("medallion", medallion, 3.1, .68)
    material_crop("brick", im.crop((947, 14, 1214, 279)), 4.2, .73)
    material_crop("sandstone", im.crop((201, 540, 360, 688)), 3.6, .86)
    material_crop("rosette", im.crop((568, 768, 1046, 840)), 3.0, .72)
    material_crop("binding", im.crop((1070, 775, 1518, 843)), 3.0, .76)
    material_crop("lion", im.crop((1236, 31, 1518, 277)), 3.5, .72)
    material_crop("lotus", im.crop((1243, 305, 1518, 527)), 3.5, .72)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    pack("مباني واكشاك.glb", "market.glb",
         ["House_Cloth", "House_Court", "Stall_Rugs", "House_Lion", "Stall_Fruit", "Stall_Pottery"], (2048, 1024, 1024))
    pack("الزقورات والمدن البعيدة.glb", "city.glb",
         ["Ziggurat_Terraces", "City_West", "Ziggurat_Low", "City_Mid", "Ziggurat_Sanctuary", "City_East"], (1024, 512, 512))
    pack_braziers()
    textures()
