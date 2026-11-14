#!/usr/bin/env python3
"""Extract T1 texture panels and surface-ready maps from the supplied atlas.

All coordinates are native source pixels in assets/خامات T1.PNG (1536x1024).
The source panel crops are retained losslessly; runtime maps are native-resolution
WebP crops selected to avoid titles, frames, and black object-render backdrops.
No crop is upscaled, and the source atlas is never modified.
"""
from __future__ import annotations

import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ATLAS = ROOT / "assets" / "خامات T1.PNG"
OUT = ROOT / "assets" / "textures" / "rooms" / "T1"
SOURCE_DIR = OUT / "source"
MAP_DIR = OUT / "maps"

# name: source panel crop, actual clean surface crop, material slot, physical UV tile (m)
TEXTURES = {
    "wall_tile": ((12, 45, 270, 233), (12, 45, 270, 233), "wallTile", (2.2, 1.45)),
    "relief": ((348, 48, 578, 232), (385, 118, 420, 153), "relief", (0.42, 0.42)),
    "frieze": ((652, 47, 884, 232), (652, 47, 884, 232), "frieze", (2.8, 0.42)),
    "column": ((14, 286, 130, 497), (20, 376, 122, 427), "column", (2.55, 0.9)),
    "capital": ((276, 286, 493, 496), (300, 335, 467, 414), "capital", (1.5, 0.9)),
    "column_base": ((506, 286, 719, 497), (506, 366, 719, 425), "base", (2.1, 0.58)),
    "floor": ((780, 285, 1035, 498), (780, 285, 1035, 498), "floor", (1.5, 1.5)),
    "mosaic": ((956, 44, 1194, 234), (1160, 49, 1193, 82), "mosaic", (0.42, 0.42)),
    "mosaic_moon": ((1274, 44, 1521, 234), (1326, 144, 1347, 164), "mosaicMoon", (0.3, 0.3)),
    "inlay": ((1055, 285, 1274, 498), (1069, 285, 1107, 498), "inlay", (0.18, 1.6)),
    # The door illustration is retained as its own source crop, but its full
    # illustrated leaves are never pasted onto the procedural door. The real
    # surface map uses the atlas's clean dark timber boards (beam panel).
    "door": ((14, 545, 263, 740), (1035, 553, 1263, 735), "door", (2.1, 1.8)),
    "door_relief": ((280, 545, 507, 740), (294, 545, 497, 571), "doorRelief", (2.0, 0.34)),
    "door_frame": ((520, 545, 764, 740), (525, 586, 546, 715), "doorFrame", (0.28, 1.45)),
    "portal": ((1291, 286, 1522, 497), (1303, 335, 1325, 495), "portal", (0.3, 1.4)),
    "gallery": ((782, 545, 1015, 740), (782, 622, 1004, 680), "gallery", (2.2, 0.58)),
    "beam": ((1025, 545, 1272, 740), (1035, 553, 1263, 735), "beam", (2.1, 0.52)),
    "ceiling": ((1293, 545, 1520, 740), (1298, 548, 1368, 618), "ceiling", (0.9, 0.9)),
    "window": ((13, 790, 285, 1008), (48, 840, 128, 930), "window", (0.9, 1.25)),
    "brazier": ((305, 790, 527, 1008), (320, 862, 507, 901), "brazier", (1.4, 0.38)),
    "metal": ((543, 790, 774, 1008), (543, 790, 774, 1008), "metal", (0.95, 0.65)),
}
SURFACE_NOTES = {
    "relief": "قصاصة دقيقة من نقش القماش الحجري؛ تُحفظ لوحة الشخصيات كاملة في المصدر ولا تُلصق على الجدار.",
    "mosaic": "فسيفساء البلاط الأزرق فقط، دون الهلال أو إطار اللوحة.",
    "mosaic_moon": "بلاط ذهبي من داخل الهلال، لا صورة الهلال كاملة.",
    "door": "خشب داكن نظيف من لوحة العوارض؛ تُحفظ صورة الباب الأصلية منفصلة ولا تُستخدم كملصق.",
    "door_frame": "شريط حجري ضيق من قائم إطار الباب الزخرفي.",
    "portal": "شريط نحت حجري ضيق من لوحة البوابة.",
    "window": "زجاج أزرق وشبكة فقط؛ دون صورة النافذة المقوسة كاملة.",
    "brazier": "شريط زخرفي معدني من حوض المبخرة، دون صورة الجسم كاملة.",
}


def validate_box(box: tuple[int, int, int, int], size: tuple[int, int]) -> None:
    x0, y0, x1, y1 = box
    w, h = size
    if not (0 <= x0 < x1 <= w and 0 <= y0 < y1 <= h):
        raise ValueError(f"Crop {box} is outside atlas size {size}")


def main() -> None:
    atlas = Image.open(ATLAS).convert("RGB")
    if atlas.size != (1536, 1024):
        raise ValueError(f"Expected atlas 1536x1024, got {atlas.size}")
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    MAP_DIR.mkdir(parents=True, exist_ok=True)

    manifest = {
        "source_atlas": "assets/خامات T1.PNG",
        "source_size": list(atlas.size),
        "runtime_format": "WebP",
        "upscaled": False,
        "resolution_note": "الأطلس المصدر 1536x1024 بكسل فقط، والقصاصات أصغر؛ حُفظت بدقتها الحقيقية بدلاً من تكبير 2K/4K استيفائياً، لأن ذلك لا يضيف تفاصيل أصلية ويزيد استهلاك ذاكرة GPU على الأجهزة المحمولة. يلزم أطلس مصدر أعلى دقة للحصول على تفاصيل أصلية بدقة 2K/4K.",
        "entries": [],
    }
    total_pixels = 0
    total_bytes = 0

    for name, (panel_box, surface_box, slot, repeat_m) in TEXTURES.items():
        validate_box(panel_box, atlas.size)
        validate_box(surface_box, atlas.size)
        panel = atlas.crop(panel_box)
        surface = atlas.crop(surface_box)
        source_path = SOURCE_DIR / f"t1_{name}.png"
        map_path = MAP_DIR / f"t1_{name}.webp"
        panel.save(source_path, format="PNG", optimize=True)
        surface.save(map_path, format="WEBP", quality=92, method=6)
        total_pixels += surface.width * surface.height
        total_bytes += map_path.stat().st_size
        manifest["entries"].append({
            "name": f"t1_{name}",
            "source_panel_crop_px": list(panel_box),
            "surface_crop_px": list(surface_box),
            "surface_origin_panel": "لوحة العوارض الخشبية الداكنة" if name == "door" else name,
            "surface_note": SURFACE_NOTES.get(name, "قصاصة سطح أُعدت من القسم المطابق في الأطلس."),
            "source_file": source_path.relative_to(ROOT).as_posix(),
            "runtime_map": map_path.relative_to(ROOT).as_posix(),
            "material_slot": slot,
            "uv_repeat_meters": {"width": repeat_m[0], "height": repeat_m[1]},
            "panel_size_px": list(panel.size),
            "map_size_px": list(surface.size),
            "map_bytes": map_path.stat().st_size,
        })

    manifest["estimated_decoded_rgba_bytes_with_full_mip_chain"] = int(total_pixels * 4 * 4 / 3)
    manifest["runtime_map_bytes_total"] = total_bytes
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "textures_extracted": len(TEXTURES),
        "source_dir": str(SOURCE_DIR),
        "maps_dir": str(MAP_DIR),
        "runtime_map_bytes_total": total_bytes,
        "estimated_gpu_rgba_mip_bytes": manifest["estimated_decoded_rgba_bytes_with_full_mip_chain"],
        "manifest": str(OUT / "manifest.json"),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
