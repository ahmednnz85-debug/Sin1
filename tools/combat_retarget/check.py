# Quantitative QA of clips: axe-vs-body penetration, hand-vs-handle penetration, floor, foot sliding.
# usage: check.py -- file.(blend|glb) act1,act2
import bpy, sys, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree
a = sys.argv[sys.argv.index('--') + 1:]
f = a[0]
if f.endswith('.blend'):
    bpy.ops.wm.open_mainfile(filepath=f)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f)
arm = bpy.data.objects['Armature']
body = bpy.data.objects['Sin']
axe = bpy.data.objects['Axe']
if arm.animation_data:
    for t in arm.animation_data.nla_tracks:
        t.mute = True
FLOOR = -0.4973
vg = {g.index: g.name for g in body.vertex_groups}
HAND_L, HAND_R = set(), set()
for v in body.data.vertices:
    best = max(v.groups, key=lambda g: g.weight, default=None)
    if best is None:
        continue
    n = vg[best.group]
    if n.endswith('_r') and any(n.startswith(p) for p in ('hand', 'index', 'middle', 'ring', 'pinky', 'thumb')):
        HAND_R.add(v.index)
    if n.endswith('_l') and any(n.startswith(p) for p in ('hand', 'index', 'middle', 'ring', 'pinky', 'thumb')):
        HAND_L.add(v.index)
HANDS = HAND_L | HAND_R
FOOT = set()
for v in body.data.vertices:
    for g in v.groups:
        if g.weight > 0.5 and vg[g.group].startswith(('foot', 'ball')):
            FOOT.add(v.index)
axv = [v.co.copy() for v in axe.data.vertices]
head_idx = [i for i, c in enumerate(axv) if c.z > 0.19 or c.z < -0.035][::3]
import os
VERB=os.environ.get('VERB')
REG={}
BONE_OF={v.index: vg[max(v.groups,key=lambda g:g.weight).group] for v in body.data.vertices if v.groups}
dg = bpy.context.evaluated_depsgraph_get()
for act in a[1].split(','):
    A = bpy.data.actions[act]
    arm.animation_data.action = A
    if A.slots:
        arm.animation_data.action_slot = A.slots[0]
    f0, f1 = map(int, A.frame_range)
    worst = []
    prev_ball = None
    slide = {'l': 0.0, 'r': 0.0}
    for fr in range(f0, f1 + 1):
        bpy.context.scene.frame_set(fr)
        dg = bpy.context.evaluated_depsgraph_get()
        be = body.evaluated_get(dg)
        me = be.to_mesh()
        mw = body.matrix_world
        verts = [mw @ v.co for v in me.vertices]
        polys = [p.vertices[:] for p in me.polygons]
        # body BVH without hands (hands legitimately touch the handle)
        polys_nh=[p for p in polys if not any(i in HANDS for i in p)]
        bvh = BVHTree.FromPolygons(verts, polys_nh)
        AW = axe.matrix_world
        AI = AW.inverted()
        pen = 0.0
        npen = 0
        for i in head_idx:
            p = AW @ axv[i]
            loc, nor, idx, dist = bvh.find_nearest(p, 0.05)
            if loc is not None and (p - loc).dot(nor) < -0.002:
                # confirm with a ray along -normal: inside points hit the back of a face
                npen += 1
                pen = max(pen, dist)
                if VERB: REG[fr] = REG.get(fr, set()) | {BONE_OF.get(polys_nh[idx][0], '?') + ('/pommel' if axv[i].z < 0 else '/head')}
        # hand inside handle
        hpen = 0
        for i in HANDS:
            q = AI @ verts[i]
            if -0.03 < q.z < 0.19 and math.hypot(q.x, q.y) < 0.0055:
                hpen += 1
        axe_low = min((AW @ axv[i]).z for i in head_idx)
        foot_low = min(verts[i].z for i in FOOT)
        be.to_mesh_clear()
        ball = {s: arm.matrix_world @ arm.pose.bones[f'ball_{s}'].head for s in 'lr'}
        if prev_ball:
            for s in 'lr':
                if ball[s].z < FLOOR + 0.03 and prev_ball[s].z < FLOOR + 0.03:
                    d = (ball[s].xy - prev_ball[s].xy).length
                    slide[s] += d
        prev_ball = ball
        worst.append((fr, npen, round(pen, 4), hpen, round(axe_low - FLOOR, 4), round(foot_low - FLOOR, 4)))
    bad = [w for w in worst if w[1] > 0 or w[3] > 0 or w[4] < 0 or w[5] < -0.01]
    print(f'== {act}: frames={len(worst)} axe-body-pen frames={sum(1 for w in worst if w[1])} '
          f'maxdepth={max(w[2] for w in worst)} hand-in-handle frames={sum(1 for w in worst if w[3])} max={max(w[3] for w in worst)} '
          f'axe-below-floor={min(w[4] for w in worst)} foot-low=[{min(w[5] for w in worst)},{max(w[5] for w in worst)}] '
          f'planted-slide l={slide["l"]:.4f} r={slide["r"]:.4f}')
    for w in bad[:12]:
        print('   frame', w)
    if VERB: print('   regions', {k: sorted(v) for k, v in REG.items()}); REG.clear()
