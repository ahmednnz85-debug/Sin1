# Build retargeted combat clips on Sin's rig.  usage: build.py -- <Sin.glb> <indir> <out.blend> [clips]
import bpy, sys, math, os
sys.path.insert(0, os.path.dirname(__file__))
from mathutils import Matrix, Vector, Quaternion
import rt_core as R

args = sys.argv[sys.argv.index('--') + 1:]
GLB, IND, OUT = args[0], args[1], args[2]
ONLY = args[3].split(',') if len(args) > 3 else None
FPS = 48.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
sc = bpy.context.scene
arm = bpy.data.objects['Armature']
for t in arm.animation_data.nla_tracks:
    t.mute = True
TG = R.Target(arm)

# ---------- authored grip of the right hand (constant in every original clip) ----------
arm.animation_data.action = bpy.data.actions['idle_impatient']
sc.frame_set(0)
FINGER_BONES = [b.name for b in arm.data.bones if any(b.name.startswith(f) for f in ('index', 'middle', 'ring', 'pinky', 'thumb'))]
GRIP_R = {n: arm.pose.bones[n].matrix_basis.copy() for n in FINGER_BONES if n.endswith('_r')}
arm.animation_data.action = None
for pb in arm.pose.bones:
    pb.matrix_basis.identity()
bpy.context.view_layer.update()

MX = Matrix.Diagonal((-1, 1, 1, 1))


def mirror_basis(n_r, B_r):
    """mirror a right-bone basis matrix onto the matching left bone (rest frames are near-mirrors)."""
    n_l = n_r[:-1] + 'l'
    Rr = TG.rest[n_r].to_3x3().normalized().to_4x4()
    Rl = TG.rest[n_l].to_3x3().normalized().to_4x4()
    D = Rr @ B_r.to_3x3().to_4x4() @ Rr.inverted()
    Dm = MX @ D @ MX
    return n_l, (Rl.inverted() @ Dm @ Rl)


GRIP_L = dict(mirror_basis(n, b) for n, b in GRIP_R.items())

# ---------- axe geometry (rest pose) ----------
axe = bpy.data.objects['Axe']
AXE_REL = TG.rest['weapon_r'].inverted() @ (arm.matrix_world.inverted() @ axe.matrix_world)
HANDLE_UP = Vector((0, 0, 1))          # axe local +Z: pommel -> head
hand_in_axe = (arm.matrix_world.inverted() @ axe.matrix_world).inverted() @ TG.head['hand_r']
GRIP_Z_R = hand_in_axe.z               # right wrist height along the handle
RIGHT_PALM_Z = GRIP_Z_R + 0.02         # centre of the right fist on the handle
print('right wrist on handle z=', GRIP_Z_R)


def axe_mat(M):
    return M['weapon_r'] @ AXE_REL


# grip offset of right wrist -> handle line, in hand_r local; mirrored for the left hand
_axe_rest = TG.rest['weapon_r'] @ AXE_REL
_line_pt = _axe_rest @ Vector((0, 0, GRIP_Z_R))
C_R = TG.rest['hand_r'].to_3x3().inverted() @ (_line_pt - TG.head['hand_r'])
U_R = TG.rest['hand_r'].to_3x3().inverted() @ (_axe_rest.to_3x3() @ HANDLE_UP).normalized()
C_L = TG.rest['hand_l'].to_3x3().inverted() @ (MX.to_3x3() @ (TG.rest['hand_r'].to_3x3() @ C_R))
U_L = (TG.rest['hand_l'].to_3x3().inverted() @ (MX.to_3x3() @ (TG.rest['hand_r'].to_3x3() @ U_R))).normalized()

# ---------- grip solve (finger curl + palm clearance) ----------
import grip_solve
_GS = grip_solve.run(globals(), os.path.join(os.path.dirname(OUT), 'grip_solution.json'))


def _scaled(grip, scale):
    out = {}
    for n, b in grip.items():
        q = b.to_quaternion()
        k = scale[n.split('_')[0]]
        out[n] = Quaternion(q.axis, q.angle * k).to_matrix().to_4x4() if q.angle > 1e-6 else Matrix.Identity(4)
    return out


GRIP_R = _scaled(GRIP_R, _GS['r']['scale'])
GRIP_L = _scaled(GRIP_L, _GS['l']['scale'])
GRIP_L_OPEN = {n: Quaternion(b.to_quaternion().axis, b.to_quaternion().angle * 0.3).to_matrix().to_4x4() for n, b in GRIP_L.items()}
FIST_L = _scaled(dict(mirror_basis(n, b) for n, b in GRIP_R.items()), {'index': 1.45, 'middle': 1.45, 'ring': 1.45, 'pinky': 1.45, 'thumb': 1.15})
_C_R_new = Vector(_GS['r']['C'])
C_L = Vector(_GS['l']['C'])
U_L = Vector(_GS['l']['U']).normalized()
# right palm clearance -> shift the axe inside the fist (weapon_r local)
_RW = TG.rest['weapon_r'].to_3x3().normalized()
_RH = TG.rest['hand_r'].to_3x3().normalized()
AXE_FIX = _RW.inverted() @ (_RH @ (_C_R_new - C_R))
print('AXE_FIX', AXE_FIX, 'grip', _GS['r']['report'], _GS['l']['report'])

# ---------- leg / scale ----------
def leglen(h):
    return (h['foot_l'] - h['thigh_l']).length


def smooth(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


class Retargeter:
    def __init__(self, src, tmap, scale, spine_mid=None):
        self.src, self.map, self.s = src, tmap, scale
        self.spine_mid = spine_mid
        dc = R.dir_child()
        self.A = {}
        for tb, sb in tmap.items():
            A = Quaternion()
            c = dc.get(tb)
            if c and c in tmap and tmap[c] in src.rest:
                td = TG.head[c] - TG.head[tb]
                sd = src.rest[tmap[c]].translation - src.rest[sb].translation
                A = R.swing(td, sd)
            elif tb.endswith(('_03_l', '_03_r')):
                A = self.A.get(tb.replace('_03_', '_02_'), Quaternion())
            self.A[tb] = A
        self.Rs0 = {sb: R.rot3(src.rest[sb]) for sb in src.rest}

    def delta(self, S, sb):
        return R.rot3(S[sb]) @ self.Rs0[sb].inverted()

    def fk(self, f, pelvis_offset=Vector()):
        S = self.src.sample(f)
        M = {}
        hips = self.map['pelvis']
        for n in TG.order:
            if n in self.map and self.map[n] in S:
                q = self.delta(S, self.map[n]) @ self.A[n] @ R.rot3(TG.rest[n])
                if n == 'pelvis':
                    pos = TG.head['pelvis'] + self.s * (S[hips].translation - self.src.rest[hips].translation) + pelvis_offset
                else:
                    pos = TG.chain_mat(M, n).translation
                M[n] = Matrix.Translation(pos) @ q.to_matrix().to_4x4()
            elif n == 'spine_02' and self.spine_mid:
                a, b = self.spine_mid
                q = self.delta(S, a).slerp(self.delta(S, b), 0.5) @ R.rot3(TG.rest[n])
                M[n] = Matrix.Translation(TG.chain_mat(M, n).translation) @ q.to_matrix().to_4x4()
            else:
                M[n] = TG.chain_mat(M, n)
        return M, S

    def foot_lift(self, side, f):
        """source steps are shuffled along the floor; add a short clearance arc while the foot travels."""
        if not hasattr(self, '_segs'):
            self._segs = {}
            for sd in 'lr':
                sb = self.map[f'foot_{sd}']
                fr = list(range(int(self.src.f0), int(self.src.f1) + 1))
                pos = [self.src.sample(x)[sb].translation for x in fr]
                mov = [False] + [(pos[i].xy - pos[i - 1].xy).length * self.s > 0.006 for i in range(1, len(pos))]
                segs, a = [], None
                for i, m in enumerate(mov + [False]):
                    if m and a is None:
                        a = i - 1
                    if not m and a is not None:
                        travel = (pos[i - 1].xy - pos[a].xy).length * self.s
                        if travel > 0.03:
                            segs.append((fr[a], fr[i - 1], min(1.0, travel / 0.12)))
                        a = None
                self._segs[sd] = segs
        for a, b, k in self._segs[side]:
            if a < f < b:
                return 0.028 * k * math.sin(math.pi * (f - a) / (b - a))
        return 0.0

    def foot_target(self, S, side, root_off=Vector(), f=None):
        sb = self.map[f'foot_{side}']
        lift = self.foot_lift(side, f) if f is not None else 0.0
        return TG.head[f'foot_{side}'] + self.s * (S[sb].translation - self.src.rest[sb].translation) + root_off + Vector((0, 0, lift))


def legs_ik(M, targets, weight=1.0):
    B = TG.to_basis(M)
    for side, T in targets.items():
        if T is None:
            continue
        fk_pos = M[f'foot_{side}'].translation
        Tw = fk_pos.lerp(T, weight)
        foot_rot = R.rot3(M[f'foot_{side}'])
        qp = R.rot3(M['pelvis']) @ R.rot3(TG.rest['pelvis']).inverted()
        R.apply_chain_ik(TG, M, f'thigh_{side}', f'calf_{side}', f'foot_{side}', Tw, foot_rot, qp @ Vector((0, -1, 0)))
    fixed = {'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'}
    for n in TG.order:
        if n in fixed:
            continue
        M[n] = TG.chain_mat(M, n) @ B[n]


def set_fingers(M, grip, which):
    B = TG.to_basis(M)
    for n, b in grip.items():
        B[n] = b
    return TG.fk_from_basis(B)


GAP_LOG = []


def ik_arm(M, side, T, q):
    B = TG.to_basis(M)
    qs = R.rot3(M['spine_03']) @ R.rot3(TG.rest['spine_03']).inverted()
    R.apply_chain_ik(TG, M, f'upperarm_{side}', f'lowerarm_{side}', f'hand_{side}', T, q, qs @ Vector((0.4 if side == 'l' else -0.4, 0.5, -1)))
    fixed = {f'upperarm_{side}', f'lowerarm_{side}', f'hand_{side}'}
    for n in TG.order:
        if n not in fixed:
            M[n] = TG.chain_mat(M, n) @ B[n]


REL_L = None   # rigid orientation of the left fist relative to the axe (set from the first full 2H frame)


def _left_target(M, z_offset):
    global REL_L
    AX = axe_mat(M)
    qa = AX.to_3x3().normalized().to_quaternion()
    h = (AX.to_3x3() @ HANDLE_UP).normalized()
    g = AX @ Vector((0, 0, GRIP_Z_R + z_offset))
    q_fk = R.rot3(M['hand_l'])
    if REL_L is None:
        q_ref = R.swing(q_fk @ U_L, h) @ q_fk
        return g - (q_ref @ C_L), q_ref, q_fk
    q_ik = qa @ REL_L
    return g - (q_ik @ C_L), q_ik, q_fk


def lock_left_grip(M, z_offset):
    """freeze the left-hand roll around the handle from this pose (rigid two-handed grip)."""
    global REL_L
    REL_L = None
    AX = axe_mat(M)
    qa = AX.to_3x3().normalized().to_quaternion()
    _, q_ref, _ = _left_target(M, z_offset)
    REL_L = qa.inverted() @ q_ref
    print('REL_L locked', [round(x, 3) for x in REL_L])


def left_hand_on_handle(M, w, z_offset=0.0):
    """2H grip: put the left hand on the axe handle, weight w. If the left arm cannot reach,
    the right fist (and the axe) is pulled toward the left shoulder just enough."""
    if w <= 1e-4:
        return M
    la = (TG.head['lowerarm_l'] - TG.head['upperarm_l']).length
    lb = (TG.head['hand_l'] - TG.head['lowerarm_l']).length
    reach = 0.975 * (la + lb)
    for _ in range(3):
        wrist, q_ik, q_fk = _left_target(M, z_offset)
        sh = M['upperarm_l'].translation
        d = (wrist - sh).length
        if d <= reach:
            break
        v = (sh - wrist).normalized() * (d - reach + 0.004) * w
        ik_arm(M, 'r', M['hand_r'].translation + v, R.rot3(M['hand_r']))
    wrist, q_ik, q_fk = _left_target(M, z_offset)
    q = q_fk.slerp(q_ik, w)
    T = M['hand_l'].translation.lerp(wrist, w)
    ik_arm(M, 'l', T, q)
    if w > 0.99:
        GAP_LOG.append(round((M['hand_l'].translation - wrist).length, 4))
    # fingers: blend toward mirrored grip
    B = TG.to_basis(M)
    wc = smooth((w - 0.7) / 0.3)            # close only on contact
    wo = min(1.0, w / 0.5) * (1 - wc)       # open the hand while it travels to the handle
    for n, gb in GRIP_L.items():
        qa = B[n].to_quaternion()
        qo = GRIP_L_OPEN[n].to_quaternion()
        qb = gb.to_quaternion()
        B[n] = qa.slerp(qo, wo).slerp(qb, wc).to_matrix().to_4x4()
    return TG.fk_from_basis(B)


def twist_fix(M):
    """distribute wrist twist onto the forearm twist bones (prevents candy-wrapping)."""
    B = TG.to_basis(M)
    for s in 'lr':
        q = B[f'hand_{s}'].to_quaternion()
        tw = Quaternion((q.w, 0, q.y, 0))
        if tw.magnitude < 1e-6:
            continue
        tw.normalize()
        ang = 2 * math.atan2(tw.y, tw.w)
        if ang > math.pi:
            ang -= 2 * math.pi
        if ang < -math.pi:
            ang += 2 * math.pi
        B[f'lowerarm_twist_01_{s}'] = Quaternion((0, 1, 0), ang * 0.5).to_matrix().to_4x4()
    return TG.fk_from_basis(B)


def blend_M(Ma, Mb, w):
    """blend two poses in basis space (rotation slerp, location lerp)."""
    Ba, Bb = TG.to_basis(Ma), TG.to_basis(Mb)
    out = {}
    for n in TG.order:
        la, ra, _ = Ba[n].decompose()
        lb, rb, _ = Bb[n].decompose()
        if ra.dot(rb) < 0:
            rb = -rb
        out[n] = Matrix.Translation(la.lerp(lb, w)) @ ra.slerp(rb, w).to_matrix().to_4x4()
    return TG.fk_from_basis(out)


def retime(keys):
    """piecewise-linear map from output seconds -> source frame. keys: [(t_out, src_frame), ...]"""
    def f(t):
        for (t0, s0), (t1, s1) in zip(keys, keys[1:]):
            if t <= t1:
                u = (t - t0) / (t1 - t0) if t1 > t0 else 0
                return s0 + (s1 - s0) * u
        return keys[-1][1]
    return f, keys[-1][0]



# ---------- body capsules for weapon clearance ----------
CAPS = [('pelvis', 'spine_01'), ('spine_01', 'spine_02'), ('spine_02', 'spine_03'), ('spine_03', 'neck_01'),
        ('neck_01', 'head'), ('head', None), ('thigh_l', 'calf_l'), ('calf_l', 'foot_l'), ('thigh_r', 'calf_r'),
        ('calf_r', 'foot_r'), ('clavicle_l', 'upperarm_l'), ('clavicle_r', 'upperarm_r'), ('upperarm_l', 'lowerarm_l'), ('lowerarm_l', 'hand_l')]
CAP_MARGIN = {'thigh_l': 0.035, 'thigh_r': 0.035, 'pelvis': 0.016, 'spine_02': 0.008, 'spine_03': 0.014, 'neck_01': 0.012, 'head': 0.012, 'clavicle_r': 0.03, 'clavicle_l': 0.015}


def _seg(M, a, b):
    pa = M[a].translation
    pb = M[b].translation if b else pa + (M[a].to_3x3().normalized() @ Vector((0, 0.1, 0)))
    return pa, pb


def _closest(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return a + ab * t


def _cap_radii():
    body = bpy.data.objects['Sin']
    vg = {g.index: g.name for g in body.vertex_groups}
    Mr = {n: TG.rest[n] for n in TG.order}
    rad = {}
    for a, b in CAPS:
        names = {a}
        pa, pb = _seg(Mr, a, b)
        d = []
        for v in body.data.vertices:
            if v.groups and vg[max(v.groups, key=lambda g: g.weight).group] in names:
                p = v.co
                d.append((p - _closest(p, pa, pb)).length)
        d.sort()
        rad[(a, b)] = d[int(len(d) * 0.80)] if d else 0.03
    return rad


CAP_R = _cap_radii()
print('CAP_R', {k[0]: round(v, 3) for k, v in CAP_R.items()})
_axv = [v.co.copy() for v in axe.data.vertices]
AXE_PTS = [c for c in _axv if c.z < -0.035] + [c for c in _axv if c.z > 0.19][::6]
CLEAR_LOG = []


def axe_clearance(M, margin=0.006):
    """push the right fist (axe is rigid in it) out of the body capsules."""
    moved = 0.0
    for it in range(8):
        AX = axe_mat(M)
        caps = [(_seg(M, a, b), CAP_R[(a, b)] + CAP_MARGIN.get(a, 0.0)) for a, b in CAPS]
        worst, push = 0.0, None
        for c in AXE_PTS:
            p = AX @ c
            for (pa, pb), r in caps:
                q = _closest(p, pa, pb)
                d = (p - q).length
                pen = r + margin - d
                if pen > worst:
                    worst, push = pen, (p - q).normalized() * pen
        if push is None:
            break
        moved += push.length
        ik_arm(M, 'r', M['hand_r'].translation + push * 1.05, R.rot3(M['hand_r']))
    # pommel vs. own right forearm: bend the wrist slightly instead of moving the fist
    for it in range(6):
        AX = axe_mat(M)
        pa, pb = M['lowerarm_r'].translation, M['hand_r'].translation
        worst, best = 0.0, None
        for c in AXE_PTS:
            if c.z > 0:
                continue
            p = AX @ c
            q = _closest(p, pa, pb)
            pen = 0.036 - (p - q).length
            if pen > worst:
                worst, best = pen, (p, q)
        if best is None:
            break
        p, q = best
        piv = AX @ Vector((0, 0, GRIP_Z_R + 0.02))
        lever = (p - piv)
        push = (p - q).normalized()
        axis = lever.cross(push)
        if axis.length < 1e-6:
            break
        ang = min(worst / max(lever.length, 0.02) * 1.15, 0.35)
        rot = Quaternion(axis.normalized(), ang)
        qh = rot @ R.rot3(M['hand_r'])
        ph = piv + rot @ (M['hand_r'].translation - piv)
        moved += worst
        ik_arm(M, 'r', ph, qh)
    CLEAR_LOG.append(round(moved, 4))
    return M

# ======================= clip construction =======================
HM = R.humanm_map()
HM_SPINE_MID = ('B-spine', 'B-chest')
HANDLE_IN_WEAPON = (AXE_REL.to_3x3() @ HANDLE_UP).normalized()   # handle axis in weapon_r bone space
SLIDE = float(os.environ.get("SLIDE", "0.0"))   # right fist slide along the handle for the 2H grip
LEFT_Z = float(os.environ.get("LEFT_Z", "0.062"))  # left wrist position above the right wrist on the handle
REACH_LOG = []


def load_humanm(fname):
    src = R.Source(os.path.join(IND, fname))
    s = leglen(TG.head) / (src.rest['B-foot.L'].translation - src.rest['B-thigh.L'].translation).length
    return src, Retargeter(src, HM, s, HM_SPINE_MID)


def base_pose(rt, f, pelvis_offset=Vector(), foot_offset=Vector()):
    M, S = rt.fk(f, pelvis_offset)
    legs_ik(M, {'l': rt.foot_target(S, 'l', f=f) + foot_offset, 'r': rt.foot_target(S, 'r', f=f) + foot_offset})
    return set_fingers(M, GRIP_R, 'r'), S


def with_slide(M, amount):
    B = TG.to_basis(M)
    B['weapon_r'] = Matrix.Translation(AXE_FIX - HANDLE_IN_WEAPON * amount)
    return TG.fk_from_basis(B)


def floor_guard(M):
    tg = {}
    for sd in 'lr':
        rest_dz = TG.head[f'ball_{sd}'].z - TG.head[f'foot_{sd}'].z
        dz = M[f'ball_{sd}'].translation.z - M[f'foot_{sd}'].translation.z
        extra = min(max((rest_dz - dz) * 0.6, 0.0), 0.014)
        d = max(TG.head[f'foot_{sd}'].z - M[f'foot_{sd}'].translation.z, TG.head[f'ball_{sd}'].z + extra - M[f'ball_{sd}'].translation.z)
        if d > 0.0005:
            tg[sd] = M[f'foot_{sd}'].translation + Vector((0, 0, d))
    if tg:
        legs_ik(M, tg)
    return M


def finish(M, w2h=0.0, slide=0.0, tag='', fist_l=0.0):
    M = floor_guard(M)
    M = with_slide(M, slide)
    M = axe_clearance(M)
    if fist_l > 0:
        B = TG.to_basis(M)
        for n, gb in FIST_L.items():
            B[n] = B[n].to_quaternion().slerp(gb.to_quaternion(), fist_l).to_matrix().to_4x4()
        M = TG.fk_from_basis(B)
    if w2h > 0:
        sh = M['upperarm_l'].translation
        la = (TG.head['lowerarm_l'] - TG.head['upperarm_l']).length + (TG.head['hand_l'] - TG.head['lowerarm_l']).length
        M = left_hand_on_handle(M, w2h, LEFT_Z)
        M = axe_clearance(M)
        M = left_hand_on_handle(M, w2h, LEFT_Z)
        REACH_LOG.append((tag, round((M['hand_l'].translation - sh).length / la, 3)))
    return twist_fix(M)


def lerp_keys(keys, t):
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t <= t1:
            u = (t - t0) / (t1 - t0) if t1 > t0 else 1
            return v0 + (v1 - v0) * smooth(u)
    return keys[-1][1]


CLIPS = {}
want = lambda n: ONLY is None or n in ONLY

# ---- combat idle (also provides the shared combat-ready pose) ----
src, rt = load_humanm('Idle.fbx')
fn, dur = retime([(0, 1), (40 / 30, 41)])
IDLE = []
for i in range(int(round(dur * FPS)) + 1):
    M, _ = base_pose(rt, fn(i / FPS))
    IDLE.append(M)
READY = IDLE[0]
CLIPS['Axe_CombatIdle'] = [finish(M) for M in IDLE]
src.remove()


_REL_HAND_AXE = (TG.rest['hand_r'].inverted() @ TG.rest['weapon_r'] @ AXE_REL).to_3x3().normalized()


def axe_frame_to_hand(h, e):
    """hand_r world rotation that puts the axe handle along h with the cutting edge facing e."""
    z = h.normalized()
    y = -(e - z * e.dot(z)).normalized()
    x = y.cross(z)
    Ra = Matrix((x, y, z)).transposed()
    return (Ra @ _REL_HAND_AXE.inverted()).to_quaternion()


def chop_windup(M, w, pos_off, handle_dir, edge_dir):
    """raise and cock the axe above the right shoulder (additive over the source swing)."""
    if w <= 1e-4:
        return M
    sh = M['upperarm_r'].translation
    T = M['hand_r'].translation.lerp(sh + pos_off, w)
    q = R.rot3(M['hand_r']).slerp(axe_frame_to_hand(handle_dir, edge_dir), w)
    ik_arm(M, 'r', T, q)
    return M


def one_hand(fname, keys, layer=None, fist=None):
    src, rt = load_humanm(fname)
    fn, dur = retime(keys)
    out = []
    for i in range(int(round(dur * FPS)) + 1):
        t = i / FPS
        M, _ = base_pose(rt, fn(t))
        if layer:
            M = layer(M, t)
        out.append(finish(M, fist_l=lerp_keys(fist, t) if fist else 0.0))
    src.remove()
    return out


# Attack 1H: windup 1-5, strike 5-11, impact 11-13, recover 13-34 (src @30fps)
ATK_KEYS = [(0, 1), (0.20, 5), (0.29, 8.8), (0.37, 10.3), (0.41, 11.5), (0.54, 13.5), (1.14, 34)]
if want('Attack_Right'):
    W_CHOP = [(0, 0.0), (0.08, 0.4), (0.20, 1.0), (0.27, 0.8), (0.37, 0.0), (2, 0.0)]
    CLIPS['Attack_Right'] = one_hand('AtkR.fbx', ATK_KEYS, layer=lambda M, t: chop_windup(
        M, lerp_keys(W_CHOP, t), Vector((-0.045, 0.055, 0.125)), Vector((-0.15, 0.55, 0.82)), Vector((0.0, -1.0, 0.25))))
if want('Attack_Left'):
    CLIPS['Attack_Left'] = one_hand('AtkL.fbx', ATK_KEYS, fist=[(0, 0.0), (0.12, 1.0), (0.62, 1.0), (0.95, 0.0), (2, 0.0)])

# ---- heavy two-handed finisher ----
# src Atk2H @30fps: windup 1-13, strike 13-21, impact hold 21-27, recover 27-49
HEAVY_KEYS = [(0, 1), (0.50, 12), (0.62, 13.2), (0.70, 15), (0.80, 18), (0.89, 20.5), (1.14, 26), (1.84, 49)]
HEAVY_IMPACT = 0.84
src2h, rt2h = load_humanm('Atk2H.fbx')


def heavy_frame(t, fnh, dur, in_blend=0.22, out_blend=0.40, pelvis_offset=Vector(), foot_offset=Vector()):
    M, S = base_pose(rt2h, fnh(t), pelvis_offset, foot_offset)
    b_in = smooth(t / in_blend)
    b_out = smooth((dur - t) / out_blend)
    b = min(b_in, b_out)
    if b < 1:
        M = blend_M(READY, M, b)
    w2h = lerp_keys([(0, 0.0), (0.10, 0.0), (0.30, 1.0), (dur - 0.42, 1.0), (dur - 0.12, 0.0), (dur, 0.0)], t)
    slide = SLIDE * lerp_keys([(0, 0.0), (0.08, 0.0), (0.30, 1.0), (dur - 0.42, 1.0), (dur - 0.10, 0.0), (dur, 0.0)], t)
    return M, w2h, slide, S


_fnh, _durh = retime(HEAVY_KEYS)
_Mref, _, _sl, _ = heavy_frame(0.34, _fnh, _durh)
_Mref = axe_clearance(with_slide(floor_guard(_Mref), _sl))
lock_left_grip(_Mref, LEFT_Z)

if want('Finisher_Heavy'):
    fnh, dur = retime(HEAVY_KEYS)
    out = []
    for i in range(int(round(dur * FPS)) + 1):
        t = i / FPS
        M, w2h, slide, _ = heavy_frame(t, fnh, dur)
        out.append(finish(M, w2h, slide, 'heavy%.2f' % t))
    CLIPS['Finisher_Heavy'] = out

# ---- leaping finisher: Atk2H upper body + tuck legs taken from the run-jump mocap flight ----
JUMP_KEYS = [(0, 1), (0.30, 8), (0.60, 13.2), (0.68, 13.6), (0.78, 16.8), (0.88, 20.5), (1.14, 26), (1.88, 49)]
T_OFF, T_LAND, T_IMPACT = 0.34, 0.84, 0.88
JUMP_H = 0.20
MOCAP_TAKEOFF, MOCAP_LAND = 412, 480


def pelvis_jump_offset(t):
    if t < T_OFF:
        z = lerp_keys([(0, 0.0), (0.26, -0.045), (T_OFF, 0.0)], t)
        y = 0.0
    elif t < T_LAND:
        u = (t - T_OFF) / (T_LAND - T_OFF)
        z = 4 * JUMP_H * u * (1 - u)
        y = -0.05 * math.sin(math.pi * u)
    else:
        z = lerp_keys([(T_LAND, 0.0), (0.93, -0.035), (1.18, 0.0)], t)
        y = 0.0
    return Vector((0, y, z))


if want('Finisher_Jump'):
    G = Matrix.Rotation(math.pi, 4, 'Z')
    srcj = R.Source(os.path.join(IND, 'Jump.fbx'), G)
    sj = leglen(TG.head) / (srcj.rest['LeftFoot'].translation - srcj.rest['LeftUpLeg'].translation).length
    rtj = Retargeter(srcj, R.xsens_map(), sj)
    fnj, dur = retime(JUMP_KEYS)
    LEG = [f'{b}_{s}' for s in 'lr' for b in ('thigh', 'calf', 'foot', 'ball')]
    out = []
    for i in range(int(round(dur * FPS)) + 1):
        t = i / FPS
        off = pelvis_jump_offset(t)
        foff = Vector((0, off.y, off.z * 0.92)) if T_OFF < t < T_LAND else Vector()
        M, w2h, slide, _ = heavy_frame(t, fnj, dur, 0.22, 0.40, off, foff)
        a = lerp_keys([(0, 0.0), (0.32, 0.0), (0.50, 1.0), (0.64, 1.0), (0.82, 0.0), (dur, 0.0)], t)
        if a > 0:
            u = min(max((t - T_OFF) / (T_LAND - T_OFF), 0), 1)
            Mj, _ = rtj.fk(MOCAP_TAKEOFF + u * (MOCAP_LAND - MOCAP_TAKEOFF))
            qpj = R.rot3(Mj['pelvis'])
            qp = R.rot3(M['pelvis'])
            Mt = dict(M)
            for n in TG.order:
                if n in LEG:
                    q = qp @ qpj.inverted() @ R.rot3(Mj[n])
                    Mt[n] = Matrix.Translation(TG.chain_mat(Mt, n).translation) @ q.to_matrix().to_4x4()
                elif TG.parent[n] in LEG or (TG.parent[n] and TG.parent[TG.parent[n]] in LEG):
                    Mt[n] = TG.chain_mat(Mt, n) @ TG.to_basis(M)[n]
            M = blend_M(M, Mt, a)
        out.append(finish(M, w2h, slide, 'jump%.2f' % t))
    CLIPS['Finisher_Jump'] = out
    srcj.remove()
src2h.remove()

sc.render.fps = 48
for name, frames in CLIPS.items():
    old = bpy.data.actions.get(name)
    if old:
        old.name = name + '_legacy'
    R.key_action(arm, name, [TG.to_basis(M) for M in frames], FPS)
    print('BUILT', name, len(frames), 'dur', (len(frames) - 1) / FPS)
far = [r for r in REACH_LOG if r[1] > 0.97]
print('CLEAR max', max(CLEAR_LOG or [0]), 'frames moved', sum(1 for x in CLEAR_LOG if x > 0))
print('GAP max', max(GAP_LOG or [0]), 'n', len(GAP_LOG))
print('REACH max', max([r[1] for r in REACH_LOG] or [0]), 'overreach frames', far[:10])
arm.animation_data.action = None
bpy.ops.wm.save_as_mainfile(filepath=OUT)
