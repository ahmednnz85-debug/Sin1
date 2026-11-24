#!/usr/bin/env python3
"""Build the runtime hero file from the master hero file.

  python3 tools/trim-hero-clips.py [assets/Sin_combat_FINAL3_axe.glb] [assets/Sin_hero_runtime.glb]

Keeps the scene, nodes, mesh, skin, materials, textures, sockets and every extras block byte for byte;
removes only the animations the game never plays (talk / gesture / rifle mocap ...), plus their
keyframe data. The kept clip list is CONFIG.CLIPS in sin-hero.js (read from the file, so they never drift).
"""
import json, re, struct, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'assets/Sin_combat_FINAL3_axe.glb'
dst = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'assets/Sin_hero_runtime.glb'

js = (ROOT / 'sin-hero.js').read_text(encoding='utf-8')
block = re.search(r'const CLIPS = \{(.*?)\};', js, re.S).group(1)
keep = set(re.findall(r"'([A-Za-z0-9_]+)'", block))

data = src.read_bytes()
assert data[:4] == b'glTF'
jlen = struct.unpack('<I', data[12:16])[0]
j = json.loads(data[20:20 + jlen])
bin_off = 20 + jlen
blen = struct.unpack('<I', data[bin_off:bin_off + 4])[0]
binc = data[bin_off + 8:bin_off + 8 + blen]

names = {a['name'] for a in j['animations']}
missing = keep - names
if missing:
    sys.exit('master file lacks clips: ' + ', '.join(sorted(missing)))
anims = [a for a in j['animations'] if a['name'] in keep]

# accessors still referenced anywhere (meshes, skins, kept animations)
used = set()
def walk(o):
    if isinstance(o, dict):
        for k, v in o.items():
            if k in ('accessor', 'input', 'output', 'inverseBindMatrices', 'indices') and isinstance(v, int): used.add(v)
            elif k == 'attributes' and isinstance(v, dict): used.update(v.values())
            elif k == 'targets' and isinstance(v, list):
                for t in v: used.update(t.values())
            else: walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk(j.get('meshes', [])); walk(j.get('skins', [])); walk(anims)
acc_map = {}; accessors = []
for i, a in enumerate(j['accessors']):
    if i in used: acc_map[i] = len(accessors); accessors.append(a)
views_used = {a['bufferView'] for a in accessors if 'bufferView' in a} | {im['bufferView'] for im in j.get('images', []) if 'bufferView' in im}
view_map = {}; views = []; out = bytearray()
for i, v in enumerate(j['bufferViews']):
    if i not in views_used: continue
    while len(out) % 4: out.append(0)
    chunk = binc[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
    nv = dict(v); nv['byteOffset'] = len(out); out += chunk
    view_map[i] = len(views); views.append(nv)
for a in accessors:
    if 'bufferView' in a: a['bufferView'] = view_map[a['bufferView']]
for im in j.get('images', []):
    if 'bufferView' in im: im['bufferView'] = view_map[im['bufferView']]
def remap(o):
    if isinstance(o, dict):
        for k, v in list(o.items()):
            if k in ('accessor', 'input', 'output', 'inverseBindMatrices', 'indices') and isinstance(v, int): o[k] = acc_map[v]
            elif k == 'attributes' and isinstance(v, dict):
                for kk in v: v[kk] = acc_map[v[kk]]
            elif k == 'targets' and isinstance(v, list):
                for t in v:
                    for kk in t: t[kk] = acc_map[t[kk]]
            else: remap(v)
    elif isinstance(o, list):
        for v in o: remap(v)
remap(j.get('meshes', [])); remap(j.get('skins', [])); remap(anims)
j['accessors'] = accessors; j['bufferViews'] = views; j['animations'] = anims
j['buffers'] = [{'byteLength': len(out)}]
j['asset']['extras'] = {'runtimeOf': src.name, 'keptClips': sorted(keep)}
jb = json.dumps(j, separators=(',', ':')).encode('utf-8')
while len(jb) % 4: jb += b' '
while len(out) % 4: out.append(0)
total = 12 + 8 + len(jb) + 8 + len(out)
glb = b'glTF' + struct.pack('<II', 2, total) + struct.pack('<I', len(jb)) + b'JSON' + jb + struct.pack('<I', len(out)) + b'BIN\x00' + bytes(out)
dst.write_bytes(glb)
print(f'{src.name}: {len(data)/1e6:.2f} MB, {len(names)} clips -> {dst.name}: {len(glb)/1e6:.2f} MB, {len(anims)} clips')
