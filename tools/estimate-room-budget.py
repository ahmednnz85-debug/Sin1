#!/usr/bin/env python3
"""Estimate per-room GPU/CPU/process memory after the iPhone texture cap.

Used by tests/room-budget-ci.test.cjs so a single room that cannot fit the
iPhone budget (650 MB process, 480 MB GPU) fails CI and can never ship.

Run:  python3 tools/estimate-room-budget.py
Exit 0 if every room (and hall+room) fits, 1 otherwise.
"""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OPT = ROOT / "ارضيات وسقوف" / "optimized"
ASSETS = ROOT / "assets"
MAX_TEX = 1024  # iPhone SinDevice maxTextureSize
PROCESS_BUDGET = 650
GPU_BUDGET = 480
CPU_BUDGET = 80
# Irreducible hall + WebKit + programs, added only to the hall+room check.
SHARED_OVERHEAD_MB = 80

# RGBA GPU with mipmaps, in MB.
def gpu_tex_mb(w: int, h: int, max_size: int = MAX_TEX) -> float:
    if not w or not h:
        return 0.0
    m = max(w, h)
    if m > max_size:
        scale = max_size / m
        w = max(1, int(round(w * scale)))
        h = max(1, int(round(h * scale)))
    return (w * h * 4 * 4 / 3) / (1024 * 1024)


def image_size(path: Path):
    try:
        from PIL import Image
        with Image.open(path) as im:
            return im.size
    except Exception:
        return _header_size(path)


def _header_size(path: Path):
    data = path.read_bytes()
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        w, h = struct.unpack(">II", data[16:24])
        return w, h
    if data[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xD8, 0xD9):
                i += 2
                continue
            length = struct.unpack(">H", data[i + 2 : i + 4])[0]
            if marker in (0xC0, 0xC1, 0xC2) and i + 9 <= len(data):
                h, w = struct.unpack(">HH", data[i + 5 : i + 9])
                return w, h
            i += 2 + length
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        kind = data[12:16]
        if kind == b"VP8X" and len(data) >= 30:
            w = 1 + int.from_bytes(data[24:27], "little")
            h = 1 + int.from_bytes(data[27:30], "little")
            return w, h
        if kind == b"VP8 " and len(data) >= 30:
            # lossy: 14-byte VP8 payload header after chunk size
            w = struct.unpack("<H", data[26:28])[0] & 0x3FFF
            h = struct.unpack("<H", data[28:30])[0] & 0x3FFF
            return w, h
        if kind == b"VP8L" and len(data) >= 25:
            bits = struct.unpack("<I", data[21:25])[0]
            w = (bits & 0x3FFF) + 1
            h = ((bits >> 14) & 0x3FFF) + 1
            return w, h
    return None


def parse_glb(path: Path):
    data = path.read_bytes()
    if data[:4] != b"glTF":
        return {"images": [], "geoBytes": 0}
    json_len = struct.unpack("<I", data[12:16])[0]
    json_start = 20
    meta = json.loads(data[json_start : json_start + json_len])
    bin_start = json_start + json_len
    if bin_start + 8 <= len(data):
        bin_len = struct.unpack("<I", data[bin_start : bin_start + 4])[0]
        blob = data[bin_start + 8 : bin_start + 8 + bin_len]
    else:
        blob = b""
    views = meta.get("bufferViews") or []

    def view_bytes(i):
        if i is None or i >= len(views):
            return b""
        v = views[i]
        off = v.get("byteOffset", 0)
        ln = v.get("byteLength", 0)
        return blob[off : off + ln]

    images = []
    for img in meta.get("images") or []:
        raw = b""
        if "bufferView" in img:
            raw = view_bytes(img["bufferView"])
        elif "uri" in img and isinstance(img["uri"], str) and img["uri"].startswith("data:"):
            continue
        if not raw:
            continue
        # Write a temp sniff via PIL from bytes
        try:
            from PIL import Image
            import io
            with Image.open(io.BytesIO(raw)) as im:
                images.append({"w": im.size[0], "h": im.size[1], "name": img.get("name") or img.get("mimeType")})
        except Exception:
            # try headers
            tmp = Path("/tmp/_sin_img_sniff")
            tmp.write_bytes(raw)
            sz = _header_size(tmp)
            if sz:
                images.append({"w": sz[0], "h": sz[1], "name": img.get("name") or ""})
    # Geometry: accessors whose bufferViews are not used by images
    img_views = {img.get("bufferView") for img in (meta.get("images") or []) if "bufferView" in img}
    # also skip image-related buffer views via images->bufferView
    geo = 0
    for acc in meta.get("accessors") or []:
        bv = acc.get("bufferView")
        if bv in img_views:
            continue
        if bv is not None and bv < len(views):
            geo += views[bv].get("byteLength", 0)
    return {"images": images, "geoBytes": geo}


def resolve(rel: str) -> Path | None:
    rel = rel.lstrip("/")
    candidates = [
        ROOT / rel,
        OPT / Path(rel).name,
        ASSETS / Path(rel).name,
        OPT / rel,
        ASSETS / rel,
    ]
    # k4 subdir
    if "k4/" in rel.replace("\\", "/"):
        candidates.insert(0, OPT / "k4" / Path(rel).name)
    for c in candidates:
        if c.is_file():
            return c
    return None


# Room → asset paths (relative to repo or as written in wings.js / palaceInterior.js).
# Hall (K1 / Palace) is always resident inside the palace; other rooms are streamed.
ROOMS = {
    "Palace": [
        "ارضيات وسقوف/optimized/marble.webp",
        "ارضيات وسقوف/optimized/floor-orm.webp",
        "ارضيات وسقوف/optimized/ارضية.webp",
        "ارضيات وسقوف/optimized/سجاد-الارضية.webp",
        "ارضيات وسقوف/optimized/سقف-القصر.webp",
        "ارضيات وسقوف/optimized/المدالية المركزية.webp",
        "ارضيات وسقوف/optimized/جدار-خلف-العرش.webp",
        "ارضيات وسقوف/optimized/جدران-الباب.webp",
        "ارضيات وسقوف/optimized/الجدارية.glb",
        "ارضيات وسقوف/optimized/اعمدة.glb",
        "ارضيات وسقوف/optimized/المباخر.glb",
        "ارضيات وسقوف/optimized/lion_winged.glb",
        "ارضيات وسقوف/optimized/درج.glb",
        "ارضيات وسقوف/optimized/مجسم الباب.glb",
        "ارضيات وسقوف/optimized/props-set.glb",
        "ارضيات وسقوف/optimized/عرش البطل.glb",
        "ارضيات وسقوف/optimized/K1_RoyalReceptionHall_lod25.glb",
    ],
    "K2": [
        "ارضيات وسقوف/optimized/جدار-المجلس.webp",
        "ارضيات وسقوف/optimized/سقف-المجلس.glb",
        "ارضيات وسقوف/optimized/ثريا-المجلس.glb",
        "ارضيات وسقوف/optimized/lion_winged.glb",
        "assets/ارضية المجلس.PNG",
        "ارضيات وسقوف/optimized/عمود-المجلس.glb",
        "assets/اجتماعات .glb",
        "ارضيات وسقوف/optimized/شتله.glb",
    ],
    "K3": [
        "assets/ارضية الخرائط.JPG",
        "assets/جدار الخرائط.JPG",
        "assets/جدار الخرائط 2.JPG",
        "assets/سقف الخرائط .JPG",
        "assets/طاولة الخرائط.glb",
        "assets/اثاث_الخرائط.glb",
    ],
    "K4": [
        "ارضيات وسقوف/optimized/k4/ارضية-الخزانة.jpg",
        "ارضيات وسقوف/optimized/k4/سقف-الخزانة.jpg",
        "ارضيات وسقوف/optimized/k4/جدارية-ايمن-الخزانة.jpg",
        "ارضيات وسقوف/optimized/k4/k4_kit_a.glb",
        "ارضيات وسقوف/optimized/k4/k4_kit_b.glb",
        "ارضيات وسقوف/optimized/k4/k4_kit_c.glb",
        "ارضيات وسقوف/optimized/k4/k4_front_mural.glb",
    ],
    "Corridors": [
        "assets/ارضية الممرات.JPG",
        "assets/سجاد الممرات.JPG",
        "ارضيات وسقوف/optimized/سقف-الممرات.webp",
        "assets/جدار الممرات.jpg",
        "ارضيات وسقوف/optimized/مشعل اسود.glb",
        "ارضيات وسقوف/optimized/مشعل خشب.glb",
    ],
}


def find_k3_names():
    """K3 filenames in source use Unicode variation; glob assets."""
    out = []
    for pat in ["*الخراي*", "*الخرائ*", "*طاولة*", "*اثاث*"]:
        out += list(ASSETS.glob(pat))
        out += list(OPT.glob(pat))
    return out


def estimate_file(path: Path) -> dict:
    rec = {"path": str(path.relative_to(ROOT)) if str(path).startswith(str(ROOT)) else str(path),
           "gpuTexMB": 0.0, "geoMB": 0.0, "images": [], "missing": False}
    if not path or not path.is_file():
        rec["missing"] = True
        return rec
    suf = path.suffix.lower()
    if suf in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        sz = image_size(path)
        if sz:
            rec["images"].append({"w": sz[0], "h": sz[1], "name": path.name})
            rec["gpuTexMB"] += gpu_tex_mb(*sz)
    elif suf == ".glb":
        g = parse_glb(path)
        for im in g["images"]:
            rec["images"].append(im)
            rec["gpuTexMB"] += gpu_tex_mb(im["w"], im["h"])
        rec["geoMB"] = g["geoBytes"] / (1024 * 1024)
    return rec


def estimate_room(name: str, files: list[str]) -> dict:
    items = []
    missing = []
    gpu = geo = 0.0
    resolved = []
    for rel in files:
        p = resolve(rel)
        if p is None:
            # fuzzy: search by filename
            fn = Path(rel).name
            hits = list(OPT.rglob(fn)) + list(ASSETS.rglob(fn))
            # also try whitespace-normalized
            if not hits:
                for folder in (OPT, ASSETS, OPT / "k4"):
                    if not folder.is_dir():
                        continue
                    for c in folder.rglob("*"):
                        if c.is_file() and c.name.replace(" ", "") == fn.replace(" ", ""):
                            hits.append(c)
                            break
            p = hits[0] if hits else None
        if p is None:
            missing.append(rel)
            continue
        resolved.append(p)
        e = estimate_file(p)
        items.append(e)
        gpu += e["gpuTexMB"]
        geo += e["geoMB"]
    # Extra fuzzy for K3 if some names missed
    if name == "K3" and missing:
        for p in find_k3_names():
            if p not in resolved:
                e = estimate_file(p)
                items.append(e)
                gpu += e["gpuTexMB"]
                geo += e["geoMB"]
                # clear matching missing
                missing = [m for m in missing if Path(m).name not in p.name and p.name not in Path(m).name]
    process = gpu + geo * 2  # cpu+gpu geometry, CPU images released after upload
    return {
        "id": name,
        "gpuTexMB": round(gpu, 2),
        "geoMB": round(geo, 2),
        "processMB": round(process, 2),
        "files": items,
        "missing": missing,
    }


def main():
    rooms = {n: estimate_room(n, fs) for n, fs in ROOMS.items()}
    hall = rooms["Palace"]
    failures = []
    for n, r in rooms.items():
        if r["gpuTexMB"] > GPU_BUDGET:
            failures.append(f"{n} gpuTex {r['gpuTexMB']} MB exceeds iPhone gpuBudget {GPU_BUDGET}")
        if r["processMB"] > PROCESS_BUDGET:
            failures.append(f"{n} process {r['processMB']} MB exceeds iPhone processBudget {PROCESS_BUDGET}")
        if n != "Palace":
            combined = r["processMB"] + hall["processMB"] + SHARED_OVERHEAD_MB
            if combined > PROCESS_BUDGET:
                failures.append(
                    f"{n}+Palace process {combined:.1f} MB (room {r['processMB']} + hall {hall['processMB']} + overhead {SHARED_OVERHEAD_MB}) exceeds {PROCESS_BUDGET}"
                )
    report = {
        "maxTextureSize": MAX_TEX,
        "processBudgetMB": PROCESS_BUDGET,
        "gpuBudgetMB": GPU_BUDGET,
        "cpuBudgetMB": CPU_BUDGET,
        "sharedOverheadMB": SHARED_OVERHEAD_MB,
        "rooms": {n: {k: r[k] for k in ("id", "gpuTexMB", "geoMB", "processMB", "missing")} for n, r in rooms.items()},
        "details": rooms,
        "failures": failures,
        "ok": not failures,
    }
    out = ROOT / "tools" / "room-budget-report.json"
    # compact rooms for stdout
    print(json.dumps({**report, "details": "see tools/room-budget-report.json"}, ensure_ascii=False, indent=2))
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    if failures:
        for f in failures:
            print("FAIL:", f, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
