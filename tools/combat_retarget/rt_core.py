# Core retarget helpers (run inside bpy).
import bpy, math
from mathutils import Matrix, Vector, Quaternion

SIDES = (('L', 'l'), ('R', 'r'))
FINGERS = (('indexFinger', 'index'), ('middleFinger', 'middle'), ('ringFinger', 'ring'), ('pinky', 'pinky'), ('thumb', 'thumb'))


def humanm_map():
    m = {'B-hips': 'pelvis', 'B-spine': 'spine_01', 'B-chest': 'spine_03', 'B-neck': 'neck_01', 'B-head': 'head'}
    for S, s in SIDES:
        m.update({f'B-shoulder.{S}': f'clavicle_{s}', f'B-upperArm.{S}': f'upperarm_{s}', f'B-forearm.{S}': f'lowerarm_{s}',
                  f'B-hand.{S}': f'hand_{s}', f'B-thigh.{S}': f'thigh_{s}', f'B-shin.{S}': f'calf_{s}',
                  f'B-foot.{S}': f'foot_{s}', f'B-toe.{S}': f'ball_{s}'})
        for F, f in FINGERS:
            for i in (1, 2, 3):
                m[f'B-{F}0{i}.{S}'] = f'{f}_0{i}_{s}'
    return {v: k for k, v in m.items()}  # target -> source


def xsens_map():
    m = {'Hips': 'pelvis', 'Spine': 'spine_01', 'Spine2': 'spine_02', 'Spine3': 'spine_03', 'Neck': 'neck_01', 'Head': 'head'}
    for S, s in (('Left', 'l'), ('Right', 'r')):
        m.update({f'{S}Shoulder': f'clavicle_{s}', f'{S}Arm': f'upperarm_{s}', f'{S}ForeArm': f'lowerarm_{s}', f'{S}Hand': f'hand_{s}',
                  f'{S}UpLeg': f'thigh_{s}', f'{S}Leg': f'calf_{s}', f'{S}Foot': f'foot_{s}', f'{S}ToeBase': f'ball_{s}'})
    return {v: k for k, v in m.items()}


# direction child used for rest swing-alignment (limbs only)
def dir_child():
    d = {}
    for s in 'lr':
        d.update({f'upperarm_{s}': f'lowerarm_{s}', f'lowerarm_{s}': f'hand_{s}', f'hand_{s}': f'middle_01_{s}',
                  f'thigh_{s}': f'calf_{s}', f'calf_{s}': f'foot_{s}', f'foot_{s}': f'ball_{s}'})
        for _, f in FINGERS:
            d[f'{f}_01_{s}'] = f'{f}_02_{s}'
            d[f'{f}_02_{s}'] = f'{f}_03_{s}'
    return d


def rot3(m):
    q = m.to_3x3().normalized().to_quaternion()
    return q


class Target:
    def __init__(self, arm):
        self.arm = arm
        self.bones = arm.data.bones
        self.rest = {b.name: b.matrix_local.copy() for b in self.bones}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in self.bones}
        order = []
        def rec(b):
            order.append(b.name)
            for c in b.children:
                rec(c)
        for b in self.bones:
            if not b.parent:
                rec(b)
        self.order = order
        self.head = {n: self.rest[n].translation.copy() for n in self.rest}

    def local_rest(self, n):
        p = self.parent[n]
        return self.rest[n] if p is None else self.rest[p].inverted() @ self.rest[n]

    def chain_mat(self, M, n):
        """armature-space matrix of bone n with identity basis given posed parent"""
        p = self.parent[n]
        return self.rest[n].copy() if p is None else M[p] @ self.local_rest(n)

    def to_basis(self, M):
        out = {}
        for n in self.order:
            out[n] = self.chain_mat(M, n).inverted() @ M[n]
        return out

    def fk_from_basis(self, B):
        M = {}
        for n in self.order:
            M[n] = self.chain_mat(M, n) @ B.get(n, Matrix.Identity(4))
        return M


class Source:
    """Samples world-space bone matrices of an imported FBX armature."""
    def __init__(self, path, global_fix=Matrix.Identity(4)):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False)
        new = [o for o in bpy.data.objects if o not in before]
        self.objs = new
        self.arm = [o for o in new if o.type == 'ARMATURE'][0]
        self.G = global_fix
        a = self.arm.animation_data.action
        self.f0, self.f1 = a.frame_range
        self.rest = {b.name: self.G @ self.arm.matrix_world @ b.matrix_local for b in self.arm.data.bones}
        self.cache = {}

    def sample(self, f):
        key = round(f, 4)
        if key in self.cache:
            return self.cache[key]
        sc = bpy.context.scene
        fi = math.floor(f)
        sc.frame_set(fi, subframe=f - fi)
        out = {pb.name: self.G @ self.arm.matrix_world @ pb.matrix for pb in self.arm.pose.bones}
        self.cache[key] = out
        return out

    def remove(self):
        for o in self.objs:
            bpy.data.objects.remove(o, do_unlink=True)


def swing(a, b):
    return a.normalized().rotation_difference(b.normalized())


def two_bone_ik(H, K_fk, T, la, lb, hint=None):
    """returns new knee/elbow position. H root, T target, pole from FK joint."""
    d = (T - H)
    dist = d.length
    dist = min(max(dist, abs(la - lb) + 1e-4), (la + lb) * 0.9995)
    dn = d.normalized()
    T2 = H + dn * dist
    # distance along dn to the knee projection
    x = (la * la - lb * lb + dist * dist) / (2 * dist)
    h = math.sqrt(max(la * la - x * x, 0.0))
    pole = (K_fk - H)
    pole = pole - dn * pole.dot(dn)
    if hint is not None:
        hp = hint - dn * hint.dot(dn)
        if hp.length > 1e-6:
            # a straight limb has no reliable FK pole: lean on the anatomical hint
            k = max(0.0, 1.0 - pole.length / (0.25 * la))
            pole = pole.normalized() * (1 - k) + hp.normalized() * (k + 0.02) if pole.length > 1e-6 else hp
    if pole.length < 1e-6:
        pole = Vector((0, -1, 0)) - dn * dn.y
    pole.normalize()
    return H + dn * x + pole * h, T2


def set_rot(M, n, q):
    t = M[n].translation.copy()
    M[n] = Matrix.Translation(t) @ q.to_matrix().to_4x4()


def apply_chain_ik(tg, M, upper, lower, end, T, end_rot=None, hint=None):
    """Re-aim upper/lower so that `end` head reaches T. Keeps children rigidly attached (recomputed by caller)."""
    H = M[upper].translation.copy()
    K = M[lower].translation.copy()
    E = M[end].translation.copy()
    la = (tg.head[lower] - tg.head[upper]).length
    lb = (tg.head[end] - tg.head[lower]).length
    K2, T2 = two_bone_ik(H, K, T, la, lb, hint)
    qu = rot3(M[upper])
    du = swing(K - H, K2 - H)
    qu2 = du @ qu
    set_rot(M, upper, qu2)
    # lower: first carried by upper change, then re-aimed
    ql = du @ rot3(M[lower])
    E_carried = K2 + du @ (E - K)
    dl = swing(E_carried - K2, T2 - K2)
    ql2 = dl @ ql
    M[lower] = Matrix.Translation(K2) @ ql2.to_matrix().to_4x4()
    qe = end_rot if end_rot is not None else rot3(M[end])
    M[end] = Matrix.Translation(T2) @ qe.to_matrix().to_4x4()
    return T2


def refresh_children(tg, M, B, roots_fixed):
    """recompute all bones that are descendants of the fixed bones keeping their basis B"""
    fixed = set(roots_fixed)
    for n in tg.order:
        if n in fixed:
            continue
        p = tg.parent[n]
        if p is None:
            continue
        M[n] = tg.chain_mat(M, n) @ B[n]


def key_action(arm, name, frames_basis, fps_out):
    """frames_basis: list of dict bone->basis matrix. Creates an action keyed every frame."""
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = act
    prevq = {}
    for fi, B in enumerate(frames_basis):
        for n, mb in B.items():
            pb = arm.pose.bones[n]
            pb.rotation_mode = 'QUATERNION'
            loc, rq, _ = mb.decompose()
            if n in prevq and prevq[n].dot(rq) < 0:
                rq = -rq
            prevq[n] = rq
            pb.location = loc
            pb.rotation_quaternion = rq
            pb.scale = (1, 1, 1)
        for n in B:
            pb = arm.pose.bones[n]
            pb.keyframe_insert('location', frame=fi)
            pb.keyframe_insert('rotation_quaternion', frame=fi)
    # make quaternions continuous & linear interpolation
    fcs = []
    for l in act.layers:
        for st in l.strips:
            for cb in st.channelbags:
                fcs += list(cb.fcurves)
    for fc in fcs:
        for k in fc.keyframe_points:
            k.interpolation = 'LINEAR'
    return act
