#!/usr/bin/env python3
"""Package the approved Maw elevator ("مصعد فم الهاوية.glb") for R3.

The source keeps its meshopt-compressed geometry untouched; only the three
authored maps are resized for the phone (longest side 1024 px), which keeps
the cabin, chains and crown at the same design and UV layout.
Also repacks the abyss ruins without the retired elevator nodes.
Run from anywhere: python3 tools/r3-maw-elevator.py  (needs Pillow)."""
import importlib.util
import io
import json
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "مصعد فم الهاوية.glb"
OUT = ROOT / "assets" / "r3" / "maw"
LIMIT = 1024


def pad(data, alignment=4):
    return data + b"\0" * (-len(data) % alignment)


def elevator():
    raw = SOURCE.read_bytes()
    length, = struct.unpack_from("<I", raw, 12)
    doc = json.loads(raw[20:20 + length])
    blob = memoryview(raw)[28 + length:]
    images = {image["bufferView"]: image for image in doc["images"]}
    out = bytearray()
    for index, view in enumerate(doc["bufferViews"]):
        if index in images:
            image = images[index]
            start = view.get("byteOffset", 0)
            picture = Image.open(io.BytesIO(bytes(blob[start:start + view["byteLength"]])))
            if max(picture.size) > LIMIT:
                picture = picture.resize((LIMIT, LIMIT), Image.LANCZOS)
            encoded = io.BytesIO()
            if image["mimeType"] == "image/png":
                picture.save(encoded, "PNG", optimize=True)
            else:
                picture.convert("RGB").save(encoded, "JPEG", quality=90)
            data = encoded.getvalue()
            view["byteOffset"] = len(out)
            view["byteLength"] = len(data)
            out += pad(data)
    for view in doc["bufferViews"]:
        ext = view.get("extensions", {}).get("EXT_meshopt_compression")
        if ext:
            start = ext.get("byteOffset", 0)
            data = bytes(blob[start:start + ext["byteLength"]])
            ext["byteOffset"] = len(out)
            out += pad(data)
    doc["buffers"][0]["byteLength"] = len(out)
    meta = json.dumps(doc, separators=(",", ":")).encode()
    meta += b" " * (-len(meta) % 4)
    total = 28 + len(meta) + len(out)
    target = OUT / "elevator.glb"
    target.write_bytes(struct.pack("<4sIII4s", b"glTF", 2, total, len(meta), b"JSON") + meta +
                      struct.pack("<I4s", len(out), b"BIN\0") + out)
    print(target.relative_to(ROOT), target.stat().st_size, "bytes")


def ruins():
    spec = importlib.util.spec_from_file_location("maw_assets", ROOT / "tools" / "r3-maw-assets.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    selection = {"Abyss_Bridge_Ruined": None, "Abyss_Cliff_Ruins": None, "Abyss_Rock_Spire": None}
    module.package(ROOT / "assets" / "R3_MawOfTheAbyss_Assets.glb", OUT / "abyss-ruins.glb", selection)


if __name__ == "__main__":
    elevator()
    ruins()
