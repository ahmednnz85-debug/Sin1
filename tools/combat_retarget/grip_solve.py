# Solve finger curl (per finger) and palm offset so each hand wraps the axe handle without penetration.
# Imported by build.py (needs TG, GRIP_R, GRIP_L, C_R, U_R, C_L, U_L, arm in its namespace) -> returns dict.
import bpy, math, json, os
from mathutils import Vector, Quaternion, Matrix

R_HANDLE = 0.0092      # handle radius in the grip zone (measured 0.009) + skin contact
R_CONTACT = 0.0108


def run(ns, cache_path):
    if os.path.exists(cache_path):
        return json.load(open(cache_path))
    TG, arm = ns['TG'], ns['arm']
    body = bpy.data.objects['Sin']
    vg = {g.index: g.name for g in body.vertex_groups}
    groups = {}
    for v in body.data.vertices:
        if not v.groups:
            continue
        g = max(v.groups, key=lambda g: g.weight)
        groups.setdefault(vg[g.group], []).append(v.index)
    out = {}
    for side in 'rl':
        grip = dict(ns['GRIP_R'] if side == 'r' else ns['GRIP_L'])
        C = (ns['C_R'] if side == 'r' else ns['C_L']).copy()
        U = (ns['U_R'] if side == 'r' else ns['U_L']).copy()
        Rh = TG.rest[f'hand_{side}'].to_3x3().normalized()
        head = TG.head[f'hand_{side}']
        palm = groups.get(f'hand_{side}', [])
        fingers = {f: sum((groups.get(f'{f}_0{i}_{side}', []) for i in (1, 2, 3)), []) for f in ('index', 'middle', 'ring', 'pinky', 'thumb')}
        scale = {f: 1.0 for f in fingers}

        def pose_and_eval(ids):
            for pb in arm.pose.bones:
                pb.matrix_basis = Matrix.Identity(4)
            for n, b in grip.items():
                f = n.split('_')[0]
                q = b.to_quaternion()
                k = scale[f]
                arm.pose.bones[n].matrix_basis = Quaternion(q.axis, q.angle * k).to_matrix().to_4x4() if q.angle > 1e-6 else Matrix.Identity(4)
            bpy.context.view_layer.update()
            dg = bpy.context.evaluated_depsgraph_get()
            be = body.evaluated_get(dg)
            me = be.to_mesh()
            pts = [arm.matrix_world.inverted() @ body.matrix_world @ me.vertices[i].co for i in ids]
            be.to_mesh_clear()
            return pts

        def dist(pts, P0, D, zr=(-0.035, 0.075)):
            best, bp = 9, None
            for p in pts:
                w = p - P0
                a = w.dot(D)
                if not (zr[0] < a < zr[1]):
                    continue
                d = (w - D * a).length
                if d < best:
                    best, bp = d, p
            return best, bp

        def fit_line(C, U, zr=(-0.035, 0.075)):
            """fit the handle line inside the fist: all contact groups ~R_CONTACT, nothing inside R_HANDLE."""
            import numpy as np
            from scipy.optimize import minimize
            grp = {'palm': palm}
            grp.update(fingers)
            ids = sum(grp.values(), [])
            pts = pose_and_eval(ids)
            arr, off = {}, 0
            for g, gi in grp.items():
                arr[g] = np.array([tuple(p) for p in pts[off:off + len(gi)]])
                off += len(gi)
            P00 = np.array(tuple(head + Rh @ C))
            D0 = np.array(tuple((Rh @ U).normalized()))
            e1 = np.cross(D0, [0, 0, 1.0]); e1 /= np.linalg.norm(e1)
            e2 = np.cross(D0, e1)

            def line(x):
                P0 = P00 + e1 * x[0] + e2 * x[1]
                D = D0 + e1 * x[2] + e2 * x[3]
                return P0, D / np.linalg.norm(D)

            def gd(P0, D, A):
                w = A - P0
                a = w @ D
                m = (a > zr[0]) & (a < zr[1])
                if not m.any():
                    return 0.05
                return np.min(np.linalg.norm(w[m] - np.outer(a[m], D), axis=1))

            def cost(x):
                P0, D = line(x)
                c = 0.0
                for g, A in arr.items():
                    d = gd(P0, D, A)
                    if g in ('palm', 'index', 'middle', 'ring'):
                        c += (d - 0.0101) ** 2
                    elif g == 'pinky':
                        c += 0.3 * (d - 0.0103) ** 2
                    c += 40 * max(0.0, R_HANDLE - d) ** 2
                return c * 1e6 + 0.02 * (x[2] ** 2 + x[3] ** 2)
            r = minimize(cost, np.zeros(4), method='Nelder-Mead', options={'xatol': 1e-5, 'fatol': 1e-7, 'maxiter': 4000})
            P0, D = line(r.x)
            P0, D = Vector(P0), Vector(D)
            Cn = Rh.inverted() @ (P0 - head)
            Un = (Rh.inverted() @ D).normalized()
            print('FIT', side, 'cost', round(r.fun, 4), {g: round(gd(np.array(tuple(P0)), np.array(tuple(D)), A), 4) for g, A in arr.items()})
            return Cn, Un

        if side == 'l':
            C, U = fit_line(C, U)
        P0 = head + Rh @ C
        D = (Rh @ U).normalized()
        # 2) per-finger curl
        report = {}
        for f, ids in fingers.items():
            ks = [x / 20 for x in range(12, 41)] if f != 'thumb' else [x / 20 for x in range(12, 33)]
            chosen, last_ok = None, 1.0
            for k in ks:
                scale[f] = k
                d, _ = dist(pose_and_eval(ids), P0, D, (-0.05, 0.09))
                if d < R_HANDLE:
                    break
                last_ok = k
                if d <= R_CONTACT:
                    chosen = k
                    break
            scale[f] = chosen if chosen is not None else last_ok
            d, _ = dist(pose_and_eval(ids), P0, D, (-0.05, 0.09))
            report[f] = (scale[f], round(d, 4))
        if side == 'l':
            C, U = fit_line(C, U)
            P0 = head + Rh @ C
            D = (Rh @ U).normalized()
            for f, ids in fingers.items():
                report[f] = (scale[f], round(dist(pose_and_eval(ids), P0, D, (-0.05, 0.09))[0], 4))
        out[side] = {'scale': scale, 'C': list(C), 'U': list(U), 'report': report}
        print('GRIP', side, report, 'C', [round(x, 4) for x in C])
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    json.dump(out, open(cache_path, 'w'))
    return out
