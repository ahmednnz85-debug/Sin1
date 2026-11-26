#!/usr/bin/env python3
"""Package the selected Maw nodes and their authored textures; no third-party dependencies."""
import json
import subprocess
import struct
from tempfile import TemporaryDirectory
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
OUT = ASSETS / "r3" / "maw"
MAW = {
    "Elevator_Platform": {"Elevator_Platform_Body"},
    "Elevator_Mechanism": {"Elevator_Mechanism_Drum", "Elevator_Mechanism_Hub"},
    "Elevator_Chain_Link_01": None,
    "Elevator_Anchor_Upper": None,
    "Elevator_Anchor_Lower": None,
    "Abyss_Bridge_Ruined": None,
    "Abyss_Cliff_Ruins": None,
    "Abyss_Rock_Spire": None,
}
GUARDIAN = {"Lamassu_Left_Facing_Guardian_On_Inscribed_Plinth": None}
MAP_LIMITS = {
    "T_Maw_rock_orm": 512, "T_Maw_rock_normal": 512,
    "T_Maw_trim_base": 1024, "T_Maw_trim_normal": 1024,
}


def padded(length, alignment=4):
    return -length % alignment


def limit_mips(data, limit):
    fields = list(struct.unpack_from("<13I2Q", data, 12))
    width, height, count = fields[2], fields[3], fields[7]
    start = 0
    while max(width, height) > limit and start + 1 < count:
        width, height, start = max(1, width // 2), max(1, height // 2), start + 1
    if not start:
        return data
    levels = [struct.unpack_from("<3Q", data, 80 + i * 24) for i in range(start, count)]
    fields[2], fields[3], fields[7] = width, height, len(levels)
    output = bytearray(80 + len(levels) * 24)
    output[:12] = data[:12]
    for offset_field, length_field, alignment in [(9, 10, 4), (11, 12, 4), (13, 14, 8)]:
        offset, length = fields[offset_field], fields[length_field]
        if not length:
            continue
        output.extend(bytes(padded(len(output), alignment)))
        fields[offset_field] = len(output)
        output.extend(data[offset:offset + length])
    for i in reversed(range(len(levels))):
        offset, length, raw_length = levels[i]
        output.extend(bytes(padded(len(output), 4)))
        struct.pack_into("<3Q", output, 80 + i * 24, len(output), length, raw_length)
        output.extend(data[offset:offset + length])
    struct.pack_into("<13I2Q", output, 12, *fields)
    return output


def package(source, destination, selection, chain_indices=None):
    contents = source.read_bytes()
    length, = struct.unpack_from("<I", contents, 12)
    doc = json.loads(contents[20:20 + length])
    source_bin = memoryview(contents)[28 + length:]
    tables = ("nodes", "meshes", "materials", "textures", "images", "samplers", "accessors", "bufferViews")
    result = {"scene": 0}
    result.update({key: doc[key] for key in ("asset", "extensionsUsed", "extensionsRequired")})
    result.update({table: [] for table in tables})
    result["buffers"] = [{"byteLength": 0}, doc["buffers"][1]]
    mapped, binary = {}, bytearray()
    chain_node = next((n for n in doc["nodes"] if n.get("name") == "Elevator_Chain_Link_01_Geo"), None)
    chain_mesh = chain_node["mesh"] if chain_node else None
    crown_node = next((n for n in doc["nodes"] if n.get("name") == "Abyss_Cliff_Ruins_Body_Geo"), None)
    crown_mesh = crown_node["mesh"] if crown_node else None

    def store(data):
        offset = len(binary)
        binary.extend(data)
        binary.extend(bytes(padded(len(binary))))
        return offset

    def simplified_chain():
        view = len(result["bufferViews"])
        result["bufferViews"].append({
            "buffer": 0, "byteOffset": store(chain_indices), "byteLength": len(chain_indices), "target": 34963
        })
        accessor = len(result["accessors"])
        result["accessors"].append({
            "bufferView": view, "componentType": 5123, "type": "SCALAR", "count": len(chain_indices) // 2
        })
        return accessor

    def copy_view(view, image=None):
        ext = view.get("extensions", {}).get("EXT_meshopt_compression")
        payload = ext or view
        offset = payload.get("byteOffset", 0)
        data = source_bin[offset:offset + payload["byteLength"]]
        if image in MAP_LIMITS:
            data = limit_mips(data, MAP_LIMITS[image])
        payload["byteOffset"] = store(data)
        payload["byteLength"] = len(data)

    def select(table, index, image=None):
        key = table, index
        if key in mapped:
            return mapped[key]
        item = doc[table][index]
        target = mapped[key] = len(result[table])
        result[table].append(item)
        if table == "nodes":
            if "mesh" in item:
                item["mesh"] = select("meshes", item["mesh"])
            children = item.get("children", [])
            allowed = selection.get(item.get("name"))
            if children:
                item["children"] = [
                    select("nodes", child) for child in children
                    if allowed is None or doc["nodes"][child].get("name") in allowed
                ]
        elif table == "meshes":
            if index == crown_mesh:
                item["primitives"] = [p for p in item["primitives"]
                                      if doc["materials"][p["material"]]["name"] == "M_Stone_Ashlar"]
            for primitive in item["primitives"]:
                primitive["indices"] = (simplified_chain() if index == chain_mesh and chain_indices
                                        else select("accessors", primitive["indices"]))
                primitive["material"] = select("materials", primitive["material"])
                primitive["attributes"] = {
                    name: select("accessors", ref) for name, ref in primitive["attributes"].items()
                }
        elif table == "materials":
            channels = item["pbrMetallicRoughness"]
            for texture in (channels.get("baseColorTexture"), channels.get("metallicRoughnessTexture"),
                            item.get("normalTexture"), item.get("occlusionTexture")):
                if texture is not None:
                    texture["index"] = select("textures", texture["index"])
        elif table == "textures":
            if "sampler" in item:
                item["sampler"] = select("samplers", item["sampler"])
            ext = item["extensions"]["KHR_texture_basisu"]
            ext["source"] = select("images", ext["source"])
        elif table in ("images", "accessors"):
            item["bufferView"] = select("bufferViews", item["bufferView"], item.get("name"))
        elif table == "bufferViews":
            copy_view(item, image)
        return target

    named = {node.get("name"): i for i, node in enumerate(doc["nodes"])}
    result["scenes"] = [{"nodes": [select("nodes", named[name]) for name in selection]}]
    result["buffers"][0]["byteLength"] = len(binary)
    metadata = json.dumps(result, separators=(",", ":")).encode()
    metadata += b" " * padded(len(metadata))
    header = struct.pack("<4sIII4s", b"glTF", 2, 28 + len(metadata) + len(binary), len(metadata), b"JSON")
    destination.write_bytes(header + metadata + struct.pack("<I4s", len(binary), b"BIN\0") + binary)
    print(destination.relative_to(ROOT), destination.stat().st_size,
          "bytes,", len(result["meshes"]), "meshes,", len(result["images"]), "images")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    maw_source = ASSETS / "R3_MawOfTheAbyss_Assets.glb"
    with TemporaryDirectory() as directory:
        indices = Path(directory) / "chain.bin"
        subprocess.run(["node", str(ROOT / "tools" / "r3-maw-chain-lod.mjs"), str(maw_source), str(indices)], check=True)
        package(maw_source, OUT / "elevator-and-ruins.glb", MAW, indices.read_bytes())
    package(ASSETS / "اصول قاعة الختم.glb", OUT / "left-guardian.glb", GUARDIAN)
