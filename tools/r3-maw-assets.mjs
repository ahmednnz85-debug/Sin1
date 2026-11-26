#!/usr/bin/env node
/* R3 «Maw of the Abyss» asset kit -> assets/R3_MawOfTheAbyss_Assets.glb

   Every element of the reference sheet, modelled in metres (Y up, +Z front),
   each asset independent and spaced out in one file:

     Elevator_Platform        moving platform (body + 4 sockets, shackles, links)
     Elevator_Mechanism       upper mechanism (drum, rotating hub, 6 brackets, 6 rings)
     Elevator_Chain           6 links sharing one mesh (pitch in extras)
     Elevator_Anchor_Upper    ceiling plate, clevis, ring
     Elevator_Anchor_Lower    rosette base block, shackle
     Abyss_Overlook           paved ledge on a broken rock underside, parapet, posts
     Abyss_Bridge_Ruined      two-arch bridge, silhouette traced from the sheet
     Abyss_Mural_Fragment     procession relief slab, outline traced from the sheet
     Abyss_Cliff_Ruins        rock cliff with stair, arcaded ruins and tower
     Abyss_Rock_Spire         columnar spire
     Abyss_Rock_Formation     columnar rock massif with scree

   Moving parts are pivot nodes (no mesh) with a "<name>_Geo" child, so
   rotating / translating a pivot behaves as authored even after quantization.
   Textures: tools/r3-maw-textures.py (PNG) -> KTX2 UASTC + Zstd here.
   Geometry: welded, reordered, quantized (KHR_mesh_quantization),
   EXT_meshopt_compression.

   Usage:
     python3 tools/r3-maw-textures.py --ref <sheet.png> --out /tmp/maw-tex
     node tools/r3-maw-assets.mjs --deps <node_modules> --tex /tmp/maw-tex [--out file.glb] [--png]
   deps: three@0.187.0 @gltf-transform/core|extensions|functions meshoptimizer ktx2-encoder sharp */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = k => args.includes(k) ? args[args.indexOf(k) + 1] : null;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEPS = path.resolve(opt('--deps') || path.join(ROOT, 'node_modules'));
const TEX = path.resolve(opt('--tex') || '/tmp/maw-tex');
const OUTFILE = path.resolve(opt('--out') || path.join(ROOT, 'assets', 'R3_MawOfTheAbyss_Assets.glb'));
const KEEP_PNG = args.includes('--png');
const FAST = args.includes('--fast');   // preview: keep PNG textures, skip KTX2 (not for shipping)
const mod = p => import(pathToFileURL(path.join(DEPS, p)).href);

const THREE = await mod('three/build/three.module.js');
const { ConvexGeometry } = await mod('three/examples/jsm/geometries/ConvexGeometry.js');
const { mergeGeometries, mergeVertices } = await mod('three/examples/jsm/utils/BufferGeometryUtils.js');
const core = await mod('@gltf-transform/core/dist/index.js');
const ext = await mod('@gltf-transform/extensions/dist/index.js');
const fn = await mod('@gltf-transform/functions/dist/index.js');
const { MeshoptEncoder } = await mod('meshoptimizer/index.js').catch(() => mod('meshoptimizer/meshopt_encoder.module.js'));
await MeshoptEncoder.ready;
const meta = JSON.parse(fs.readFileSync(path.join(TEX, 'outlines.json'), 'utf8'));
const LAYOUT = meta.trim_layout;
const { Vector3, Matrix4, Euler, Quaternion, BufferGeometry, Float32BufferAttribute } = THREE;

// ------------------------------------------------------------- utilities ---
function rngOf(seed) {
  let a = seed >>> 0;
  const f = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  f.r = (a0, b0) => a0 + (b0 - a0) * f();
  return f;
}
const D2R = Math.PI / 180;
const TILE = { ashlar: 2.0, rock: 3.0, bronze: 0.5 };
const INSET = 2 / 2048;

/** Atlas lookup: s,t in [0,1] (t = 0 at the top of the region). Full-width strips wrap in s. */
function trimUV(name, s, t) {
  const [u0, v0, u1, v1] = LAYOUT[name];
  const tt = Math.min(1, Math.max(0, t));
  const full = u0 === 0 && u1 === 1;
  const ss = full ? s : Math.min(1, Math.max(0, s));
  return [u0 + ss * (u1 - u0) + (full ? 0 : (0.5 - ss) * INSET * 2), v0 + INSET + tt * (v1 - v0 - 2 * INSET)];
}

/** Triangle soup: flat (face) normals unless explicit normals are given. */
class Soup {
  constructor() { this.p = []; this.n = []; this.u = []; }
  tri(a, b, c, ua, ub, uc, na, nb, nc, hint) {
    const e1 = new Vector3().subVectors(b, a), e2 = new Vector3().subVectors(c, a);
    const fnrm = new Vector3().crossVectors(e1, e2);
    if (fnrm.lengthSq() < 1e-14) return;
    const want = hint || na;
    if (want && fnrm.dot(want) < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; [nb, nc] = [nc, nb]; fnrm.negate(); }
    fnrm.normalize();
    for (const [v, uv, n] of [[a, ua, na], [b, ub, nb], [c, uc, nc]]) {
      this.p.push(v.x, v.y, v.z); const m = n || fnrm; this.n.push(m.x, m.y, m.z);
      this.u.push(uv ? uv[0] : 0, uv ? uv[1] : 0);
    }
  }
  quad(a, b, c, d, ua, ub, uc, ud, na, nb, nc, nd, hint) {
    this.tri(a, b, c, ua, ub, uc, na, nb, nc, hint); this.tri(a, c, d, ua, uc, ud, na, nc, nd, hint);
  }
  geo() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.u, 2));
    return g;
  }
}
const V = (x, y, z) => new Vector3(x, y, z);

function xf(g, { p = [0, 0, 0], r = [0, 0, 0], s = 1 } = {}) {
  const m = new Matrix4().compose(V(...p), new Quaternion().setFromEuler(new Euler(...r, 'YXZ')), Array.isArray(s) ? V(...s) : V(s, s, s));
  g.applyMatrix4(m); return g;
}
function nonIndexed(g) {
  g = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  g.clearGroups();
  if (!g.attributes.uv) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}

/** Box projection UVs, per triangle by dominant face axis (metres / tile). */
function boxUV(g, tile, off = [0, 0, 0]) {
  g = nonIndexed(g);
  const p = g.attributes.position, uv = g.attributes.uv;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(b, a).cross(c.clone().sub(a));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const x = p.getX(i + k) + off[0], y = p.getY(i + k) + off[1], z = p.getZ(i + k) + off[2];
      let u, v;
      if (ay >= ax && ay >= az) { u = x; v = n.y > 0 ? z : -z; }
      else if (ax >= az) { u = n.x > 0 ? -z : z; v = -y; }
      else { u = n.z > 0 ? x : -x; v = -y; }
      uv.setXY(i + k, u / tile, v / tile);
    }
  }
  return g;
}
/** Flat shading (for faceted rock / chunky masonry built from shared vertices). */
function flat(g) { g = nonIndexed(g); g.computeVertexNormals(); return g; }

/** Split triangles by face normal (in current space) against dir. */
function splitByNormal(g, dir, thresh = 0.9) {
  g = nonIndexed(g);
  const out = [new Soup(), new Soup()];
  const p = g.attributes.position, nn = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i += 3) {
    const vs = [0, 1, 2].map(k => V(p.getX(i + k), p.getY(i + k), p.getZ(i + k)));
    const fnrm = vs[1].clone().sub(vs[0]).cross(vs[2].clone().sub(vs[0])).normalize();
    const which = fnrm.dot(dir) > thresh ? 0 : 1;
    const ns = [0, 1, 2].map(k => V(nn.getX(i + k), nn.getY(i + k), nn.getZ(i + k)));
    const us = [0, 1, 2].map(k => [uv.getX(i + k), uv.getY(i + k)]);
    out[which].tri(vs[0], vs[1], vs[2], ...us, ...ns);
  }
  return out.map(s => s.geo());
}
function mapUV(g, f) {
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { const r = f(p.getX(i), p.getY(i), p.getZ(i)); uv.setXY(i, r[0], r[1]); }
  return g;
}

/** Chamfered box, centred. */
function bbox(w, h, d, b = 0.025) {
  b = Math.min(b, w / 4, h / 4, d / 4);
  const s = new THREE.Shape();
  const hw = w / 2 - b, hh = h / 2 - b;
  s.moveTo(-hw, -hh); s.lineTo(hw, -hh); s.lineTo(hw, hh); s.lineTo(-hw, hh); s.lineTo(-hw, -hh);
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -(d - 2 * b) / 2);
  return flat(g);
}

/** Surface of revolution with crisp profile corners. profile: [[r,y,mode],...];
    mode(seg) chooses the uv of the segment starting at that point. phi: x=r sin, z=r cos. */
function revolve(profile, a0, a1, segs, uvf) {
  const s = new Soup();
  for (let j = 0; j < profile.length - 1; j++) {
    const [r0, y0, mode] = profile[j], [r1, y1] = profile[j + 1];
    const dr = r1 - r0, dy = y1 - y0, L = Math.hypot(dr, dy);
    if (L < 1e-6) continue;
    const nr = -dy / L, ny = dr / L;
    for (let i = 0; i < segs; i++) {
      const pa = a0 + (a1 - a0) * i / segs, pb = a0 + (a1 - a0) * (i + 1) / segs;
      const P = (r, y, ph) => V(r * Math.sin(ph), y, r * Math.cos(ph));
      const N = ph => V(nr * Math.sin(ph), ny, nr * Math.cos(ph));
      const A = P(r0, y0, pa), B = P(r0, y0, pb), C = P(r1, y1, pb), Dd = P(r1, y1, pa);
      const uv = (r, y, ph) => uvf(mode, r, y, ph, { r0, y0, r1, y1 });
      s.quad(A, B, C, Dd, uv(r0, y0, pa), uv(r0, y0, pb), uv(r1, y1, pb), uv(r1, y1, pa), N(pa), N(pb), N(pb), N(pa), N((pa + pb) / 2));
    }
  }
  return s.geo();
}
/** Planar disk (fan) at height y, facing up (dir=1) or down (-1). */
function disk(R, y, segs, dir, uvf, a0 = 0, a1 = Math.PI * 2) {
  const s = new Soup(); const n = V(0, dir, 0);
  for (let i = 0; i < segs; i++) {
    const pa = a0 + (a1 - a0) * i / segs, pb = a0 + (a1 - a0) * (i + 1) / segs;
    const A = V(0, y, 0), B = V(R * Math.sin(pa), y, R * Math.cos(pa)), C = V(R * Math.sin(pb), y, R * Math.cos(pb));
    s.tri(A, B, C, uvf(A), uvf(B), uvf(C), n, n, n);
  }
  return s.geo();
}

/** Irregular rock column (closed), possibly segmented; returns geometry in world/part space. */
function column(rng, { x, z, y0, y1, r, sides = 7, flare = 1.15, taper = 0.85, tilt = [0, 0], segs = 2, wob = 0.12, cap = 0.15 }) {
  const parts = [];
  let cx = x, cz = z;
  const angles = []; for (let i = 0; i < sides; i++) angles.push((i + rng.r(-.3, .3)) / sides * Math.PI * 2);
  const radii = angles.map(() => r * rng.r(.75, 1.12));
  const H = y1 - y0;
  const cuts = [y0]; for (let k = 1; k < segs; k++) cuts.push(y0 + H * (k / segs + rng.r(-.12, .12) / segs)); cuts.push(y1);
  for (let k = 0; k < segs; k++) {
    const ya = cuts[k], yb = cuts[k + 1];
    const fa = flare + (taper - flare) * (ya - y0) / (H || 1), fb = flare + (taper - flare) * (yb - y0) / (H || 1);
    const ox = rng.r(-wob, wob) * r, oz = rng.r(-wob, wob) * r;
    const last = k === segs - 1;
    const tx = last ? tilt[0] : rng.r(-.08, .08), tz = last ? tilt[1] : rng.r(-.08, .08);
    const ring = (f, y, dx, dz, top) => angles.map((a, i) => {
      const rr = radii[i] * f * rng.r(.93, 1.07);
      const px = cx + dx + Math.cos(a) * rr, pz = cz + dz + Math.sin(a) * rr;
      return V(px, top ? y + tx * (px - cx) + tz * (pz - cz) : y, pz);
    });
    const bot = ring(fa, ya, 0, 0, false);
    const midF = (fa + fb) / 2 * rng.r(.97, 1.08);
    const mid = ring(midF, (ya + yb) / 2 + rng.r(-.1, .1) * (yb - ya), ox * .5, oz * .5, false);
    const top = ring(fb, yb, ox, oz, true);
    const s = new Soup();
    const ctr = V(cx, (ya + yb) / 2, cz);
    for (const [A, B] of [[bot, mid], [mid, top]]) for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const h1 = A[i].clone().add(A[j]).add(B[i]).sub(ctr.clone().multiplyScalar(3)); h1.y = 0;
      s.tri(A[i], A[j], B[j], null, null, null, null, null, null, h1);
      s.tri(A[i], B[j], B[i], null, null, null, null, null, null, h1);
    }
    const tc = top.reduce((m, v) => m.add(v), V(0, 0, 0)).multiplyScalar(1 / sides); tc.y += rng.r(0, cap) * r;
    const bc = bot.reduce((m, v) => m.add(v), V(0, 0, 0)).multiplyScalar(1 / sides);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      s.tri(tc, top[i], top[j], null, null, null, null, null, null, V(0, 1, 0));
      s.tri(bc, bot[j], bot[i], null, null, null, null, null, null, V(0, -1, 0));
    }
    parts.push(s.geo());
    cx += ox; cz += oz;
  }
  return parts;
}
function chunk(rng, x, y, z, sx, sy, sz, n = 14) {
  const pts = []; for (let i = 0; i < n; i++) {
    const t = rng() * Math.PI * 2, u = rng.r(-1, 1), w = Math.sqrt(1 - u * u) * rng.r(.75, 1);
    pts.push(V(Math.cos(t) * w * sx, u * sy, Math.sin(t) * w * sz));
  }
  const g = new ConvexGeometry(pts);
  return xf(flat(g), { p: [x, y, z], r: [rng.r(-.3, .3), rng() * 6.28, rng.r(-.3, .3)] });
}

/** Wall with arched niches (holes through the wall, closed by a back slab). Local:
    x 0..w along the wall, y up, front face at z=t, back slab to z=-back. */
function archPath(cx, w, y0, h, cw = false) {
  const p = new THREE.Path(), r = w / 2, ys = y0 + h - r;
  p.moveTo(cx - r, y0); p.lineTo(cx + r, y0); p.lineTo(cx + r, ys);
  p.absarc(cx, ys, r, 0, Math.PI, false); p.lineTo(cx - r, y0);
  return p;
}
function nicheWall(rng, { w, h, t = 0.8, back = 0.35, niches = [], jag = 0.8, jagFrom = 0, cornice = null, pilasters = [] }) {
  const top = [];
  const n = Math.max(3, Math.round(w / 0.45));
  for (let i = 0; i <= n; i++) {
    const x = w * i / n;
    const drop = x >= jagFrom ? rng.r(0, jag) + (Math.floor(rng() * 3) === 0 ? rng.r(.2, .6) * jag : 0) : rng.r(0, .15);
    top.push([x, h - drop]);
  }
  const mk = holes => {
    const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(w, 0);
    for (let i = top.length - 1; i >= 0; i--) s.lineTo(top[i][0], top[i][1]);
    s.lineTo(0, 0);
    if (holes) for (const nc of niches) s.holes.push(archPath(nc.cx, nc.w, nc.y0, nc.h));
    return s;
  };
  const ex = { bevelEnabled: false, curveSegments: 14 };
  const front = flat(new THREE.ExtrudeGeometry(mk(true), { ...ex, depth: t }));
  const backG = flat(new THREE.ExtrudeGeometry(mk(false), { ...ex, depth: back }));
  backG.translate(0, 0, -back);
  const out = [front, backG];
  const minTop = Math.min(...top.map(p => p[1]));
  for (const nc of niches) out.push(archRing(nc.cx, nc.y0 + nc.h - nc.w / 2, nc.w / 2, nc.w / 2 + 0.22, 0.1, t));
  for (const nc of niches) out.push(xf(bbox(nc.w + 0.3, 0.14, 0.16), { p: [nc.cx, nc.y0 - 0.02, t + 0.02] }));
  for (const px of pilasters) { const ph = (cornice ?? minTop) - 0.05; out.push(xf(bbox(0.42, ph, 0.18), { p: [px, ph / 2, t + 0.05] })); }
  if (cornice != null) {
    // cornice only where the wall still stands above it
    let a = null;
    for (let i = 0; i <= top.length; i++) {
      const ok = i < top.length && top[i][1] > cornice + 0.3;
      if (ok && a == null) a = top[i][0];
      if (!ok && a != null) { const b = top[i - 1][0]; if (b - a > .5) out.push(xf(bbox(b - a, 0.26, 0.24), { p: [(a + b) / 2, cornice, t + 0.06] })); a = null; }
    }
  }
  return out;
}
/** Half annulus (arch voussoir ring) extruded, front face at z = zf. */
function archRing(cx, cy, r0, r1, depth, zf, a0 = 0, a1 = Math.PI) {
  const s = new THREE.Shape();
  s.absarc(cx, cy, r1, a0, a1, false);
  s.absarc(cx, cy, r0, a1, a0, true);
  s.closePath();
  const g = flat(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 16 }));
  return g.translate(0, 0, zf - 0.02);
}

// ---------------------------------------------------------- part container ---
class Part {
  constructor(name) { this.name = name; this.m = {}; }
  add(mat, ...gs) { (this.m[mat] ||= []).push(...gs.flat().map(nonIndexed)); return this; }
  ashlar(...gs) { return this.add('ashlar', gs.flat().map(g => boxUV(g, TILE.ashlar))); }
  rock(...gs) { return this.add('rock', gs.flat().map(g => boxUV(g, TILE.rock))); }
  bronzeBox(...gs) { return this.add('bronze', gs.flat().map(g => boxUV(g, TILE.bronze))); }
  tris() { return Object.values(this.m).flat().reduce((n, g) => n + g.attributes.position.count / 3, 0); }
}
const UV_TUBE = (g, lenU, lenV) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * lenU / TILE.bronze, uv.getY(i) * lenV / TILE.bronze); return g; };
function tube(points, radius, tubular = 64, radial = 12, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  const g = new THREE.TubeGeometry(curve, tubular, radius, radial, closed);
  return UV_TUBE(g, curve.getLength(), 2 * Math.PI * radius);
}
function torus(R, r, radial = 14, tubular = 48) {
  const g = new THREE.TorusGeometry(R, r, radial, tubular);
  return UV_TUBE(g, 2 * Math.PI * R, 2 * Math.PI * r);
}
function cyl(r0, r1, h, segs = 24) {
  const g = new THREE.CylinderGeometry(r0, r1, h, segs, 1, false);
  return boxUV(g, TILE.bronze);
}

// ============================================================ ASSETS =========
const assets = [];   // { name, pos, extras, children: [{ name, part|ref, t:{p,r}, extras }] }

// -------------------------------------------------- A. Elevator platform ----
{
  const DECK_Y = 1.10, RIM_IN = 2.70, RIM_Y = 1.16;
  const body = new Part('Elevator_Platform_Body');
  // deck
  body.add('top', disk(RIM_IN, DECK_Y, 128, 1, v => [(v.x / RIM_IN + 1) / 2, (v.z / RIM_IN + 1) / 2]));
  const uvAsh = (mode, r, y, ph, seg) => {
    if (mode === 'p') return [r * Math.sin(ph) / TILE.ashlar, r * Math.cos(ph) / TILE.ashlar];
    if (mode === 'c') return [ph * (seg.r0 + seg.r1) / 2 / TILE.ashlar, -y / TILE.ashlar];
    return [0, 0];
  };
  const SIDE = [[RIM_IN, DECK_Y, 'c'], [RIM_IN, RIM_Y, 'p'], [3.0, RIM_Y, 'c'], [3.0, 0.75, 'p'], [3.28, 0.75, 'c'], [3.28, 0.38, 'p'], [3.55, 0.38, 'c'], [3.55, 0, 'p'], [0, 0]];
  const FAC_A = [[RIM_IN, DECK_Y, 'c'], [RIM_IN, RIM_Y, 'p'], [3.6, RIM_Y]];
  const FAC_B = [[3.6, RIM_Y, 'rosT'], [3.6, 0.96, 'lip'], [3.55, 0.96, 'frieze'], [3.55, 0.18, 'lip'], [3.6, 0.18, 'rosB'], [3.6, 0.0, 'p'], [0, 0]];
  for (const c of [Math.PI / 2, Math.PI * 1.5]) body.add('ashlar', revolve(SIDE, c - Math.PI / 4, c + Math.PI / 4, 40, uvAsh));
  for (const c of [0, Math.PI]) {
    body.add('ashlar', revolve(FAC_A, c - Math.PI / 4, c + Math.PI / 4, 40, uvAsh));
    const facUV = (mode, r, y, ph) => {
      const arc = (ph - c) * r;
      if (mode === 'rosT') return trimUV('rosette_band', arc / 2.304 + 8, (RIM_Y - y) / (RIM_Y - 0.96));
      if (mode === 'rosB') return trimUV('rosette_band', arc / 2.304 + 8, (0.18 - y) / 0.18);
      if (mode === 'frieze') return trimUV('platform_frieze', ((ph - c) / D2R + 40) / 80, (0.96 - y) / 0.78);
      if (mode === 'lip') return trimUV('plain', 0.5, 0.5);
      return uvAsh(mode, r, y, ph, { r0: r, r1: r });
    };
    const g = revolve(FAC_B, c - Math.PI / 4, c + Math.PI / 4, 64, facUV);
    // ashlar for the bottom segment, trim for the facade
    const [down, rest] = splitByNormal(g, V(0, -1, 0), 0.9);
    body.add('ashlar', down); body.add('trim', rest);
  }
  // corner pillars
  const PIL_R = 3.3, corners = [['FR', 45], ['BR', 135], ['BL', 225], ['FL', 315]];
  for (const [, deg] of corners) {
    const t = { p: [PIL_R * Math.sin(deg * D2R), 0, PIL_R * Math.cos(deg * D2R)], r: [0, deg * D2R, 0] };
    const [front, rest] = splitByNormal(nonIndexed(new THREE.BoxGeometry(0.72, 1.0, 0.72)), V(0, 0, 1), 0.9);
    mapUV(front, (x, y) => trimUV('pillar_panel', (x + .36) / .72, (0.5 - y) / 1.0));
    body.add('trim', xf(xf(front, { p: [0, 0.72, 0] }), t));
    body.ashlar(xf(xf(rest, { p: [0, 0.72, 0] }), t));
    body.ashlar(xf(xf(bbox(0.88, 0.22, 0.88, .03), { p: [0, 0.11, 0] }), t));
    body.ashlar(xf(xf(bbox(0.86, 0.18, 0.86, .03), { p: [0, 1.31, 0] }), t));
  }
  // bronze: socket, shackle, link (one mesh each, 4 placements)
  const socket = new Part('Elevator_Platform_Socket');
  socket.add('bronze', revolve([[0, 0.22, 'p'], [0.165, 0.22, 'c'], [0.19, 0.195, 'c'], [0.19, 0.05, 'c'], [0.215, 0.03, 'c'], [0.215, 0, 'p'], [0, 0]], 0, Math.PI * 2, 36,
    (m, r, y, ph) => m === 'p' ? [r * Math.sin(ph) / .5, r * Math.cos(ph) / .5] : [ph * r / .5, -y / .5]));
  const shackle = new Part('Elevator_Platform_Shackle');
  const U = []; for (let i = 0; i <= 24; i++) {
    const a = Math.PI * i / 24;
    U.push(V(-0.13 * Math.cos(a), 0.42 + 0.13 * Math.sin(a), 0));
  }
  shackle.add('bronze', tube([V(-0.13, 0.12, 0), V(-0.13, 0.3, 0), ...U, V(0.13, 0.3, 0), V(0.13, 0.12, 0)], 0.042, 72, 14));
  const link = new Part('Elevator_Platform_Link');
  link.add('bronze', xf(torus(0.085, 0.024), { p: [0.13, 0.27, 0], r: [Math.PI / 2 - 0.9, 0, 0.25] }));
  const kids = [{ name: 'Elevator_Platform_Body', part: body }];
  for (const [tag, deg] of corners) {
    const t = { p: [PIL_R * Math.sin(deg * D2R), 1.40, PIL_R * Math.cos(deg * D2R)], r: [0, deg * D2R + Math.PI / 2, 0] };
    kids.push({ name: `Elevator_Platform_Socket_${tag}`, part: socket, t });
    kids.push({ name: `Elevator_Platform_Shackle_${tag}`, part: shackle, t, extras: { origin: 'socket top centre; chain attaches at the top of the bow (y = 0.55)' } });
    kids.push({ name: `Elevator_Platform_Link_${tag}`, part: link, t });
  }
  assets.push({ name: 'Elevator_Platform', pos: [0, 0, 0], children: kids,
    extras: { role: 'moving elevator platform', origin: 'bottom centre', deckHeight: DECK_Y, radius: 3.6, chainAttachHeight: 1.95 } });
}

// -------------------------------------------------- B. Upper mechanism ------
{
  const drum = new Part('Elevator_Mechanism_Drum');
  const uv = (mode, r, y, ph, seg) => {
    if (mode === 'p') return [r * Math.sin(ph) / TILE.ashlar, r * Math.cos(ph) / TILE.ashlar];
    if (mode === 'c') return [ph * (seg.r0 + seg.r1) / 2 / TILE.ashlar, -y / TILE.ashlar];
    if (mode === 'frieze') return trimUV('drum_frieze', ph / (Math.PI * 2 / 3), (-0.2 - y) / 0.75);
    if (mode === 'ros') return trimUV('rosette_band', ph * r / 2.304, (-0.95 - y) / 0.17);
    if (mode === 'lip') return trimUV('plain', .5, .5);
    return [0, 0];
  };
  const prof = [[1.95, -1.12, 'c'], [1.95, 0, 'p'], [2.6, 0, 'c'], [2.6, -0.2, 'lip'], [2.55, -0.2, 'frieze'], [2.55, -0.95, 'lip'], [2.62, -0.95, 'ros'], [2.62, -1.12, 'p'], [1.95, -1.12]];
  // stone vs trim per profile segment
  const stoneModes = new Set(['c', 'p']);
  const sp = [], tp = [];
  for (let j = 0; j < prof.length - 1; j++) (stoneModes.has(prof[j][2]) ? sp : tp).push([prof[j], prof[j + 1]]);
  for (const [a, b] of sp) drum.add('ashlar', revolve([a, b], 0, Math.PI * 2, 120, uv));
  for (const [a, b] of tp) drum.add('trim', revolve([a, b], 0, Math.PI * 2, 120, uv));
  const pl = v => [v.x / TILE.ashlar, v.z / TILE.ashlar];
  drum.add('ashlar', disk(1.95, 0, 96, 1, pl), disk(1.95, -0.5, 96, -1, pl));
  for (let k = 0; k < 6; k++) {
    const ph = k * Math.PI / 3, R = 2.66;
    const t = { p: [R * Math.sin(ph), 0, R * Math.cos(ph)], r: [0, ph, 0] };
    drum.ashlar(xf(xf(bbox(0.62, 1.36, 0.5, .03), { p: [0, -0.58, 0] }), t));
    drum.ashlar(xf(xf(bbox(0.74, 0.16, 0.62, .03), { p: [0, 0.18, 0] }), t));
    drum.ashlar(xf(xf(bbox(0.7, 0.16, 0.58, .03), { p: [0, -1.34, 0] }), t));
    const pq = bbox(0.46, 0.46, 0.07, .015);
    const [face, rim] = splitByNormal(pq, V(0, 0, 1), 0.95);
    mapUV(face, (x, y) => trimUV('crescent_plaque', (x + .23) / .46, (.23 - y) / .46));
    drum.add('trim', xf(xf(face, { p: [0, -0.55, 0.27] }), t));
    drum.ashlar(xf(xf(rim, { p: [0, -0.55, 0.27] }), t));
    const sp2 = ph + Math.PI / 6;
    drum.ashlar(xf(bbox(0.18, 0.45, 0.18, .02), { p: [1.8 * Math.sin(sp2), -0.72, 1.8 * Math.cos(sp2)], r: [0, sp2, 0] }));
  }
  const hub = new Part('Elevator_Mechanism_Hub');
  const huv = (mode, r, y, ph, seg) => {
    if (mode === 'p') return [r * Math.sin(ph) / TILE.ashlar, r * Math.cos(ph) / TILE.ashlar];
    if (mode === 'c') return [ph * r / TILE.ashlar, -y / TILE.ashlar];
    if (mode === 'cun') return trimUV('cuneiform_band', ph * r / 6.4, (-0.72 - y) / 0.8);
    if (mode === 'riv') return trimUV('rivet_band', ph * r / 1.92 * 2, (-1.78 - y) / 0.52);
    if (mode === 'med') return trimUV('medallion', (r * Math.sin(ph) / 1.1 + 1) / 2, (r * Math.cos(ph) / 1.1 + 1) / 2);
    if (mode === 'lip') return trimUV('rivet_band', ph * r / 1.92 * 2, 0.04);
    return [0, 0];
  };
  const hp = [[0, -0.55, 'p'], [1.6, -0.55, 'c'], [1.6, -0.72, 'cun'], [1.6, -1.52, 'c'], [1.6, -1.6, 'p'], [1.85, -1.6, 'c'], [1.85, -1.78, 'p'], [1.15, -1.78, 'riv'], [1.15, -2.3, 'lip'], [1.1, -2.36, 'med'], [0, -2.36]];
  for (let j = 0; j < hp.length - 1; j++) {
    const m = hp[j][2];
    hub.add(m === 'p' || m === 'c' ? 'ashlar' : 'trim', revolve([hp[j], hp[j + 1]], 0, Math.PI * 2, m === 'med' ? 96 : 96, huv));
  }
  const bracket = new Part('Elevator_Mechanism_Bracket');
  bracket.bronzeBox(xf(bbox(0.36, 0.06, 0.32, .012), { p: [0, -0.03, 0] }));
  for (const sx of [-1, 1]) {
    bracket.bronzeBox(xf(bbox(0.05, 0.30, 0.2, .012), { p: [sx * 0.1, -0.2, 0] }));
    bracket.add('bronze', xf(cyl(0.055, 0.055, 0.03, 20), { p: [sx * 0.14, -0.30, 0], r: [0, 0, Math.PI / 2] }));
  }
  bracket.add('bronze', xf(cyl(0.035, 0.035, 0.27, 16), { p: [0, -0.30, 0], r: [0, 0, Math.PI / 2] }));
  const ring = new Part('Elevator_Mechanism_Ring');
  ring.add('bronze', xf(torus(0.2, 0.04), { p: [0, -0.125, 0], r: [0, Math.PI / 2, 0] }));
  const kids = [{ name: 'Elevator_Mechanism_Drum', part: drum },
    { name: 'Elevator_Mechanism_Hub', part: hub, extras: { origin: 'drum axis; rotate about Y to wind' } }];
  for (let k = 0; k < 6; k++) {
    const ph = k * Math.PI / 3, R = 2.66;
    const id = String(k + 1).padStart(2, '0');
    kids.push({ name: `Elevator_Mechanism_Bracket_${id}`, part: bracket, t: { p: [R * Math.sin(ph), -1.42, R * Math.cos(ph)], r: [0, ph, 0] } });
    kids.push({ name: `Elevator_Mechanism_Ring_${id}`, part: ring, t: { p: [R * Math.sin(ph), -1.72, R * Math.cos(ph)], r: [0, ph, 0] }, extras: { origin: 'bracket pin; swings about local X' } });
  }
  assets.push({ name: 'Elevator_Mechanism', pos: [10, 2.6, 0], children: kids,
    extras: { role: 'upper elevator mechanism', origin: 'top centre (ceiling side), geometry hangs below' } });
}

// -------------------------------------------------- C. Chain ----------------
const PITCH = 0.31;
{
  const link = new Part('Elevator_Chain_Link');
  const pts = []; const s = 0.11, a = 0.09;
  for (let i = 0; i < 64; i++) {
    const t = i / 64 * 4;                                         // 4 pieces: right side, top arc, left side, bottom arc
    let p;
    if (t < 1) p = V(a, -s + 2 * s * t, 0);
    else if (t < 2) { const q = (t - 1) * Math.PI; p = V(a * Math.cos(q), s + a * Math.sin(q), 0); }
    else if (t < 3) p = V(-a, s - 2 * s * (t - 2), 0);
    else { const q = Math.PI + (t - 3) * Math.PI; p = V(a * Math.cos(q), -s + a * Math.sin(q), 0); }
    pts.push(p);
  }
  link.add('bronze', tube(pts, 0.045, 96, 14, true));
  // forge weld band
  link.add('bronze', xf(torus(0.049, 0.012, 8, 24), { p: [a, 0, 0], r: [Math.PI / 2, 0, 0] }));
  const kids = [];
  for (let i = 0; i < 6; i++) kids.push({ name: `Elevator_Chain_Link_${String(i + 1).padStart(2, '0')}`, part: link, t: { p: [0, -(s + a) - i * PITCH, 0], r: [0, i % 2 ? Math.PI / 2 : 0, 0] } });
  assets.push({ name: 'Elevator_Chain', pos: [16, 2.3, 0], children: kids,
    extras: { role: 'elevator chain (6 links, shared mesh)', origin: 'top of the first link', linkPitch: PITCH, linkOuterLength: 2 * (s + a + 0.045), linkWire: 0.045 } });
}

// -------------------------------------------------- D/E. Anchors ------------
{
  const plate = new Part('Elevator_Anchor_Upper_Plate');
  plate.ashlar(xf(bbox(0.95, 0.24, 0.75, .03), { p: [0, -0.12, 0] }));
  const clevis = new Part('Elevator_Anchor_Upper_Clevis');
  clevis.bronzeBox(xf(bbox(0.5, 0.36, 0.32, .03), { p: [0, -0.42, 0] }));
  clevis.bronzeBox(xf(bbox(0.56, 0.05, 0.38, .012), { p: [0, -0.265, 0] }));
  clevis.bronzeBox(xf(bbox(0.22, 0.12, 0.2, .02), { p: [0, -0.62, 0] }));
  clevis.add('bronze', xf(cyl(0.05, 0.05, 0.05, 20), { p: [0, -0.41, 0.17], r: [Math.PI / 2, 0, 0] }));
  for (const sx of [-1, 1]) clevis.add('bronze', xf(cyl(0.025, 0.025, 0.03, 12), { p: [sx * 0.18, -0.5, 0.165], r: [Math.PI / 2, 0, 0] }));
  clevis.add('bronze', xf(cyl(0.1, 0.1, 0.3, 28), { p: [0, -0.70, 0], r: [Math.PI / 2, 0, 0] }));
  const uring = new Part('Elevator_Anchor_Upper_Ring');
  uring.add('bronze', xf(torus(0.27, 0.055, 16, 56), { p: [0, -0.115, 0] }));
  assets.push({ name: 'Elevator_Anchor_Upper', pos: [19.5, 1.9, 0], children: [
    { name: 'Elevator_Anchor_Upper_Plate', part: plate },
    { name: 'Elevator_Anchor_Upper_Clevis', part: clevis },
    { name: 'Elevator_Anchor_Upper_Ring', part: uring, t: { p: [0, -0.70, 0] }, extras: { origin: 'knuckle pin; swings about local Z' } }],
    extras: { role: 'upper chain anchor (ceiling)', origin: 'top centre of the plate' } });

  const base = new Part('Elevator_Anchor_Lower_Base');
  base.ashlar(xf(bbox(1.36, 0.16, 1.12, .03), { p: [0, 0.08, 0] }));
  base.ashlar(xf(bbox(1.12, 0.52, 0.9, .03), { p: [0, 0.42, 0] }));
  base.ashlar(xf(bbox(0.84, 0.14, 0.68, .03), { p: [0, 0.75, 0] }));
  const plaqueAt = (part, w, h, t, rect) => {
    const [face, rim] = splitByNormal(bbox(w, h, 0.035, .01), V(0, 0, 1), 0.95);
    mapUV(face, (x, y) => trimUV(rect, (x + w / 2) / w, (h / 2 - y) / h));
    part.add('trim', xf(face, t)); part.ashlar(xf(rim, t));
  };
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) plaqueAt(base, 0.36, 0.34, { p: [sx * 0.27, 0.42, sz * 0.465], r: [0, sz > 0 ? 0 : Math.PI, 0] }, 'rosette_plaque');
  for (const sx of [-1, 1]) plaqueAt(base, 0.36, 0.34, { p: [sx * 0.575, 0.42, 0], r: [0, sx * Math.PI / 2, 0] }, 'rosette_plaque');
  const shk = new Part('Elevator_Anchor_Lower_Shackle');
  const s = new THREE.Shape();
  s.moveTo(-0.30, 0); s.lineTo(-0.30, 0.25); s.absarc(0, 0.25, 0.30, Math.PI, 0, true); s.lineTo(0.30, 0);
  s.lineTo(0.17, 0); s.lineTo(0.17, 0.25); s.absarc(0, 0.25, 0.17, 0, Math.PI, false); s.lineTo(-0.17, 0); s.lineTo(-0.30, 0);
  const sg = flat(new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1, curveSegments: 20 }));
  shk.bronzeBox(sg.translate(0, 0.015, -0.08));
  for (const sx of [-1, 1]) shk.bronzeBox(xf(bbox(0.2, 0.06, 0.24, .012), { p: [sx * 0.235, 0.03, 0] }));
  assets.push({ name: 'Elevator_Anchor_Lower', pos: [19.5, 0, 3.0], children: [
    { name: 'Elevator_Anchor_Lower_Base', part: base },
    { name: 'Elevator_Anchor_Lower_Shackle', part: shk, t: { p: [0, 0.82, 0] }, extras: { origin: 'shackle feet' } }],
    extras: { role: 'lower chain anchor (floor)', origin: 'bottom centre' } });
}

// -------------------------------------------------- F. Overlook -------------
{
  const rng = rngOf(101);
  const P = new Part('Abyss_Overlook');
  const TOP = 1.6;
  const outline = [[-3.7, -2.6], [3.6, -2.6]];
  for (let i = 1; i <= 9; i++) outline.push([3.6 - 0.25 * Math.sin(i * 1.7) - rng.r(0, .3), -2.6 + 4.6 * i / 9]);
  for (let i = 1; i < 14; i++) outline.push([3.3 - 7.0 * i / 14, 2.0 + rng.r(-.25, .3) + 0.2 * Math.sin(i * 1.3)]);
  outline.push([-3.7, 2.4]);
  const shp = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  const slab = flat(new THREE.ExtrudeGeometry(shp, { depth: 0.45, bevelEnabled: false }));
  P.ashlar(xf(slab, { p: [0, TOP - 0.45, 0], r: [-Math.PI / 2, 0, 0] }));
  const inside = (x, z) => { let c = false; for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) { const [xi, zi] = outline[i], [xj, zj] = outline[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  for (let x = -3.4; x <= 3.4; x += 0.7) for (let z = -2.3; z <= 2.2; z += 0.7) {
    const px = x + rng.r(-.18, .18), pz = z + rng.r(-.18, .18);
    if (!inside(px, pz)) continue;
    const edge = Math.min(3.7 - Math.abs(px), 2.4 - Math.abs(pz));
    P.rock(column(rng, { x: px, z: pz, y0: rng.r(0, .5) + Math.max(0, .5 - edge) * .4, y1: TOP - 0.42, r: rng.r(.62, .78), flare: .78, taper: 1.08, segs: 2, sides: 6 }));
  }
  // broken paving blocks along the jagged front / right edges
  for (let i = 2; i < outline.length - 1; i++) {
    if (rng() < .25) continue;
    const [x, z] = outline[i];
    const w = rng.r(.45, .7), d = rng.r(.4, .6), h = rng.r(.35, .5);
    P.ashlar(xf(bbox(w, h, d, .04), { p: [x * .97, TOP - h / 2 - rng.r(.02, .12), z * .97], r: [rng.r(-.12, .12), rng.r(-.4, .4), rng.r(-.12, .12)] }));
  }
  const plq = (t, w, h) => { const [face, rim] = splitByNormal(bbox(w, h, 0.03, .008), V(0, 0, 1), 0.95); mapUV(face, (x, y) => trimUV('rosette_plaque', (x + w / 2) / w, (h / 2 - y) / h)); P.add('trim', xf(face, t)); P.ashlar(xf(rim, t)); };
  // left parapet + posts
  P.ashlar(xf(bbox(0.45, 0.72, 3.7, .03), { p: [-3.42, TOP + 0.36, -0.2] }));
  P.ashlar(xf(bbox(0.55, 0.12, 3.75, .03), { p: [-3.42, TOP + 0.76, -0.2] }));
  for (const z of [-1.3, -0.2, 0.9]) plq({ p: [-3.18, TOP + 0.36, z], r: [0, Math.PI / 2, 0] }, 0.3, 0.3);
  const post = (x, z) => {
    P.ashlar(xf(bbox(0.84, 0.16, 0.84, .03), { p: [x, TOP + 0.08, z] }));
    P.ashlar(xf(bbox(0.68, 0.95, 0.68, .03), { p: [x, TOP + 0.635, z] }));
    P.ashlar(xf(bbox(0.82, 0.18, 0.82, .03), { p: [x, TOP + 1.2, z] }));
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; plq({ p: [x + Math.sin(a) * 0.355, TOP + 0.64, z + Math.cos(a) * 0.355], r: [0, a, 0] }, 0.44, 0.44); }
  };
  post(-3.42, 2.0); post(-3.42, -2.25); post(3.15, -2.25);
  // broken stub wall at the back right
  const sw = new THREE.Shape(); sw.moveTo(0, 0); sw.lineTo(1.55, 0); sw.lineTo(1.55, 0.62); sw.lineTo(1.1, 0.58); sw.lineTo(0.8, 0.5); sw.lineTo(0.45, 0.38); sw.lineTo(0.2, 0.3); sw.lineTo(0, 0.22); sw.lineTo(0, 0);
  P.ashlar(xf(flat(new THREE.ExtrudeGeometry(sw, { depth: 0.42, bevelEnabled: false })), { p: [1.18, TOP, -2.46] }));
  plq({ p: [2.05, TOP + 0.3, -2.03] }, 0.28, 0.28); plq({ p: [2.45, TOP + 0.3, -2.03] }, 0.28, 0.28);
  // loose stones on the deck
  for (const [x, z] of [[-2.9, 1.6], [-2.95, -0.9], [-2.8, 0.3], [0.9, -2.1], [1.5, -2.0], [2.6, -1.8], [-1.2, 1.7], [2.9, 0.4]])
    P.ashlar(chunk(rng, x + rng.r(-.15, .15), TOP + 0.05, z, rng.r(.08, .16), rng.r(.05, .09), rng.r(.08, .15), 12));
  assets.push({ name: 'Abyss_Overlook', pos: [0, 0, -14], part: P, extras: { role: 'stone overlook ledge', origin: 'bottom centre', deckHeight: TOP } });
}

// -------------------------------------------------- G. Ruined bridge -------
{
  const rng = rngOf(202);
  const P = new Part('Abyss_Bridge_Ruined');
  const o = meta.bridge.points;
  const xs = o.map(p => p[0]), ys = o.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), maxY = Math.max(...ys);
  const W = 16.5, k = W / (maxX - minX), ox = meta.bridge.rect[0], oy = meta.bridge.rect[1];
  const toM = (px, py) => [(px - minX) * k - W / 2, (maxY - py) * k];          // crop px -> metres
  const sheet = (sx, sy) => toM(sx - ox, sy - oy);                               // sheet px -> metres
  const shp = new THREE.Shape(o.map(p => new THREE.Vector2(...toM(p[0], p[1]))));
  const DEPTH = 2.6;
  const g = flat(new THREE.ExtrudeGeometry(shp, { depth: DEPTH, bevelEnabled: false }));
  P.ashlar(g.translate(0, 0, -DEPTH / 2));
  // arches: sheet centres x 857 / 992, springing y 437, intrados radius 55 px
  for (const sx of [857, 992]) {
    const [cx, cy] = sheet(sx, 437); const r = 55 * k;
    for (const side of [1, -1]) P.ashlar(archRing(cx, cy, r, r + 0.55, 0.12, side > 0 ? DEPTH / 2 : -DEPTH / 2 - 0.08));
    // impost bands at the springing on both piers
    for (const dx of [-1, 1]) P.ashlar(xf(bbox(1.25, 0.22, DEPTH + 0.22, .03), { p: [cx + dx * (r + 0.35), cy - 0.1, 0] }));
  }
  // cornice along the deck
  const [cxa, cy0] = sheet(722, 386), [cxb] = sheet(1112, 386);
  P.ashlar(xf(bbox(cxb - cxa, 0.3, DEPTH + 0.26, .03), { p: [(cxa + cxb) / 2, cy0, 0] }));
  // rock outcrop at the left abutment
  const [lx] = sheet(712, 0);
  for (let i = 0; i < 10; i++) {
    const x = lx + rng.r(0.1, 2.0), z = rng.r(-1.5, 1.5);
    P.rock(column(rng, { x, z, y0: 0, y1: rng.r(1.2, 4.8) * (1 - (x - lx) / 3), r: rng.r(.45, .7), segs: 2, sides: 6 }));
  }
  // rubble at the pier feet
  for (const sx of [800, 925, 1060]) {
    const [px] = sheet(sx, 0);
    for (let i = 0; i < 6; i++) P.ashlar(chunk(rng, px + rng.r(-.9, .9), rng.r(.05, .25), rng.r(-1.6, 1.6), rng.r(.2, .4), rng.r(.15, .3), rng.r(.2, .35)));
  }
  assets.push({ name: 'Abyss_Bridge_Ruined', pos: [15, 0, -14], part: P, extras: { role: 'ruined arched bridge', origin: 'bottom centre', length: W } });
}

// -------------------------------------------------- H. Mural fragment ------
{
  const P = new Part('Abyss_Mural_Fragment');
  const o = meta.mural.points, [rx, ry] = meta.mural.rect;
  const [m0x, m0y, m1x, m1y] = meta.mural_rect;                                   // texture rect (sheet px)
  const xs = o.map(p => p[0] + rx), ys = o.map(p => p[1] + ry);
  const W = 4.2, k = W / (Math.max(...xs) - Math.min(...xs));
  const cxp = (Math.max(...xs) + Math.min(...xs)) / 2, byp = Math.max(...ys);
  const toM = (sx, sy) => [(sx - cxp) * k, (byp - sy) * k];
  const shp = new THREE.Shape(o.map(p => new THREE.Vector2(...toM(p[0] + rx, p[1] + ry))));
  const D = 0.5;
  const g = flat(new THREE.ExtrudeGeometry(shp, { depth: D, bevelEnabled: false }));
  g.translate(0, 0, -D / 2);
  const [front, rest] = splitByNormal(g, V(0, 0, 1), 0.99);
  mapUV(front, (x, y) => { const sx = x / k + cxp, sy = byp - y / k; return [(sx - m0x) / (m1x - m0x), (sy - m0y) / (m1y - m0y)]; });
  P.add('mural', front);
  const [back, sides] = splitByNormal(rest, V(0, 0, -1), 0.99);
  P.ashlar(back); P.rock(sides);
  assets.push({ name: 'Abyss_Mural_Fragment', pos: [28.5, 0, -14], part: P, extras: { role: 'carved procession mural fragment', origin: 'bottom centre', width: W } });
}

// -------------------------------------------------- I. Cliff ruins ---------
{
  const rng = rngOf(303);
  const P = new Part('Abyss_Cliff_Ruins');
  const X0 = -9, X1 = 9, Z0 = -6.5, Z1 = 6.5;
  const LEFT = 8.0, RIGHT = 7.0, CH = [0.6, 3.9];
  const inChannel = (x, z) => x > CH[0] - 0.1 && x < CH[1] + 0.1 && z > -3.2;
  for (let x = X0 + 0.6; x <= X1 - 0.5; x += 1.45) for (let z = Z0 + 0.6; z <= Z1 - 0.5; z += 1.45) {
    const px = x + rng.r(-.35, .35), pz = z + rng.r(-.35, .35);
    if (inChannel(px, pz)) continue;
    const plateau = px < CH[0] ? LEFT : RIGHT;
    const edge = Math.min(px - X0, X1 - px, pz - Z0, Z1 - pz, inChannel(px - 1, pz) || inChannel(px + 1, pz) ? 0.5 : 9);
    const isEdge = edge < 1.4;
    const y1 = isEdge ? plateau + rng.r(-1.0, 0.35) : plateau - rng.r(.1, .4);
    P.rock(column(rng, { x: px, z: pz, y0: 0, y1, r: rng.r(.8, 1.0), sides: rng() < .5 ? 6 : 7, flare: isEdge ? 1.3 : 1.0, taper: .9, segs: isEdge ? 3 : 1, tilt: [rng.r(-.25, .25), rng.r(-.25, .25)] }));
  }
  // floors
  P.ashlar(xf(bbox(8.4, 0.4, 10.6, .04), { p: [-4.0, LEFT - 0.2, -0.7] }));
  P.ashlar(xf(bbox(4.3, 0.4, 10.4, .04), { p: [6.15, RIGHT - 0.2, -0.9] }));
  // stair: 22 steps up the channel, landing, 3 steps to the left terrace
  const N = 22, rise = RIGHT / N, run = 7.5 / N;
  for (let i = 0; i < N; i++) {
    const yt = (i + 1) * rise, z = 6.5 - (i + 0.5) * run;
    P.ashlar(xf(bbox(CH[1] - CH[0] - 0.05, yt, run + 0.02, .03), { p: [(CH[0] + CH[1]) / 2 + rng.r(-.03, .03), yt / 2 - rng.r(0, .03), z], r: [0, rng.r(-.015, .015), 0] }));
  }
  P.ashlar(xf(bbox(CH[1] - CH[0], RIGHT, 2.3, .03), { p: [(CH[0] + CH[1]) / 2, RIGHT / 2, -2.15] }));
  for (let i = 0; i < 3; i++) { const yt = RIGHT + (i + 1) * (LEFT - RIGHT) / 3; P.ashlar(xf(bbox(0.36, yt, 1.9, .03), { p: [1.25 - i * 0.36, yt / 2, -2.2] })); }
  // ruined steps / blocks scattered on the stair (wear)
  for (let i = 0; i < 9; i++) { const t = rng(); P.ashlar(chunk(rng, rng.r(CH[0] + .3, CH[1] - .3), (1 - t) * 0 + t * RIGHT * .9 + .15, 6.5 - t * 7.2, .22, .14, .2)); }
  // left building: front facade (z = -0.5 + t), side facade, mass behind
  const L = nicheWall(rng, { w: 7.7, h: 5.4, t: 0.9, back: 0.4, jag: 1.1, jagFrom: 4.5, cornice: 4.2,
    niches: [{ cx: 1.5, w: 1.25, y0: 0.5, h: 2.8 }, { cx: 3.6, w: 1.6, y0: 0.4, h: 3.4 }, { cx: 5.7, w: 1.25, y0: 0.5, h: 2.8 }], pilasters: [0.45, 2.55, 4.65, 6.75] });
  P.ashlar(L.map(g => xf(g, { p: [-8.7, LEFT, -1.4] })));
  const LS = nicheWall(rng, { w: 4.4, h: 5.4, t: 0.9, back: 0.4, jag: 0.6, cornice: 4.2,
    niches: [{ cx: 1.3, w: 1.1, y0: 0.6, h: 2.6 }, { cx: 3.1, w: 1.1, y0: 0.6, h: 2.6 }], pilasters: [0.3, 2.2, 4.1] });
  P.ashlar(LS.map(g => xf(g, { p: [-7.8, LEFT, -6.0], r: [0, -Math.PI / 2, 0] })));
  P.ashlar(xf(bbox(6.6, 4.4, 4.0, .04), { p: [-4.3, LEFT + 2.2, -4.0] }));
  for (let i = 0; i < 7; i++) P.ashlar(xf(bbox(rng.r(.6, 1.2), rng.r(.3, .6), rng.r(.5, .9), .03), { p: [rng.r(-7.6, -1.6), LEFT + 4.4 + rng.r(0, .3), rng.r(-5.6, -2.4)], r: [0, rng.r(-.1, .1), 0] }));
  // back wall with three niches
  const B = nicheWall(rng, { w: 6.6, h: 6.4, t: 0.9, back: 0.4, jag: 1.4, jagFrom: 0, cornice: 4.8,
    niches: [{ cx: 1.2, w: 1.3, y0: 1.1, h: 3.1 }, { cx: 3.3, w: 1.3, y0: 1.1, h: 3.1 }, { cx: 5.4, w: 1.3, y0: 1.1, h: 3.1 }], pilasters: [0.25, 2.25, 4.35, 6.35] });
  P.ashlar(B.map(g => xf(g, { p: [-1.0, RIGHT, -5.2] })));
  // right tower and terrace
  P.ashlar(xf(bbox(3.6, 7.6, 4.0, .05), { p: [7.0, RIGHT + 3.8, -4.2] }));
  for (let i = 0; i < 6; i++) P.ashlar(xf(bbox(rng.r(.7, 1.3), rng.r(.4, .9), rng.r(.7, 1.3), .04), { p: [rng.r(5.6, 8.4), RIGHT + 7.6 + rng.r(0, .3), rng.r(-5.6, -2.8)] }));
  for (let y = RIGHT + 1.0; y < RIGHT + 7.4; y += 1.3) P.ashlar(xf(bbox(3.75, 0.16, 4.15, .03), { p: [7.0, y, -4.2] }));
  P.ashlar(xf(bbox(4.6, 2.2, 3.6, .05), { p: [6.6, RIGHT + 1.1, -0.4] }));
  for (let i = 0; i < 8; i++) P.ashlar(chunk(rng, rng.r(4.6, 8.6), RIGHT + 2.25, rng.r(-2, 1.2), .3, .2, .3));
  assets.push({ name: 'Abyss_Cliff_Ruins', pos: [0, 0, -38], part: P, extras: { role: 'rock cliff with ruined arcade, stair and tower', origin: 'bottom centre', terraceHeights: [LEFT, RIGHT] } });
}

// -------------------------------------------------- J. Rock spire ----------
{
  const rng = rngOf(404);
  const P = new Part('Abyss_Rock_Spire');
  P.rock(column(rng, { x: 0, z: 0, y0: 0, y1: 13.5, r: 1.6, sides: 7, flare: 1.35, taper: .45, segs: 5, tilt: [0.9, -0.5], cap: .6, wob: .08 }));
  const ring = [[1.3, 0.2, 9.5, .9], [-1.1, 0.7, 8.2, .85], [0.4, -1.3, 10.5, .8], [-0.6, -1.0, 7.0, .75], [1.6, -0.9, 6.0, .8], [-1.7, -0.3, 5.0, .8], [0.9, 1.4, 5.5, .8], [-0.5, 1.6, 4.0, .75],
    [2.3, 0.9, 2.6, .7], [-2.4, 1.0, 2.0, .7], [2.2, -1.9, 2.4, .75], [-2.2, -1.8, 2.8, .7], [0.2, 2.4, 1.8, .7], [0.3, -2.5, 2.2, .7]];
  for (const [x, z, h, r] of ring) P.rock(column(rng, { x: x * .85, z: z * .85, y0: 0, y1: h * rng.r(.92, 1.08), r: r * 1.25, sides: 6, flare: 1.3, taper: .55, segs: Math.max(1, Math.round(h / 2.4)), tilt: [rng.r(-1, 1), rng.r(-1, 1)], cap: .5 }));
  for (let i = 0; i < 14; i++) { const a = rng() * 6.28, d = rng.r(2.4, 3.6); P.rock(chunk(rng, Math.cos(a) * d, .2, Math.sin(a) * d, rng.r(.25, .5), rng.r(.2, .35), rng.r(.25, .5))); }
  assets.push({ name: 'Abyss_Rock_Spire', pos: [20, 0, -38], part: P, extras: { role: 'columnar rock spire', origin: 'bottom centre' } });
}

// -------------------------------------------------- K. Rock formation ------
{
  const rng = rngOf(505);
  const P = new Part('Abyss_Rock_Formation');
  // sheet: summit right of centre with a long ridge falling to the left, a sheer
  // right face dropping onto a broad plateau, two lesser spires on the far left
  const H = (x, z) => {
    const ell = Math.pow(x / 11.5, 2) + Math.pow(z / 7.5, 2);
    if (ell > 1) return 0;
    const edge = 0.4 + 0.6 * Math.min(1, (1 - ell) / 0.3) ** 0.6;
    const peak = (x < 1.5 ? 19 - 1.05 * (1.5 - x) : 19 - 3.6 * (x - 1.5)) - 1.5 * Math.abs(z + 0.6);
    const plateau = x > 1.5 && x < 10.5 ? 11.5 - 0.25 * Math.abs(z) - 0.25 * Math.max(0, x - 8) : 0;
    const left1 = 9.5 - 2.6 * Math.hypot(x + 6.3, (z + 0.8) * 1.2);
    const left2 = 7.0 - 2.6 * Math.hypot(x + 9.0, (z - 0.6) * 1.2);
    return Math.max(peak, plateau, left1, left2, 1.6) * edge;
  };
  for (let x = -11; x <= 11; x += 1.35) for (let z = -7.2; z <= 7.2; z += 1.35) {
    const px = x + rng.r(-.3, .3), pz = z + rng.r(-.3, .3);
    const h = H(px, pz); if (h < 0.8) continue;
    const gx = (H(px + .5, pz) - H(px - .5, pz)), gz = (H(px, pz + .5) - H(px, pz - .5));
    P.rock(column(rng, { x: px, z: pz, y0: 0, y1: h * rng.r(.93, 1.05), r: rng.r(.82, 1.0), sides: rng() < .5 ? 6 : 7, flare: 1.15, taper: .85,
      segs: Math.max(1, Math.min(5, Math.round(h / 3.2))), tilt: [gx * rng.r(.6, 1.0) + rng.r(-.15, .15), gz * rng.r(.6, 1.0) + rng.r(-.15, .15)], cap: .25 }));
  }
  for (let i = 0; i < 70; i++) {
    const a = rng() * 6.28, d = rng.r(.92, 1.12);
    P.rock(chunk(rng, Math.cos(a) * 11.6 * d, .2, Math.sin(a) * 7.6 * d, rng.r(.25, .7), rng.r(.18, .45), rng.r(.25, .6)));
  }
  assets.push({ name: 'Abyss_Rock_Formation', pos: [42, 0, -38], part: P, extras: { role: 'columnar abyss rock massif', origin: 'bottom centre' } });
}

// ============================================================ glTF ==========
const doc = new core.Document().setLogger(new core.Logger(core.Logger.Verbosity.ERROR));
doc.createBuffer();
const scene = doc.createScene('R3_MawOfTheAbyss_Assets');
const basisu = FAST ? null : doc.createExtension(ext.KHRTextureBasisu).setRequired(true);
const TEXSETS = {
  ashlar: { wrap: true }, rock: { wrap: true }, bronze: { wrap: true, metal: true }, top: { wrap: false },
  trim: { wrap: true, metal: true }, mural: { wrap: false },
};
const MATNAMES = { ashlar: 'M_Stone_Ashlar', rock: 'M_Rock_Columnar', bronze: 'M_Bronze_Hammered', top: 'M_Platform_Deck', trim: 'M_Carved_Trim', mural: 'M_Mural_Procession' };
const mats = {}, texList = [];
for (const [k, o] of Object.entries(TEXSETS)) {
  const tex = role => {
    const t = doc.createTexture(`T_Maw_${k}_${role}`).setImage(fs.readFileSync(path.join(TEX, `${k}_${role}.png`))).setMimeType('image/png').setURI(`T_Maw_${k}_${role}.png`);
    texList.push({ t, role }); return t;
  };
  const m = doc.createMaterial(MATNAMES[k]).setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(o.metal ? 1 : 0).setRoughnessFactor(1);
  const orm = tex('orm');
  m.setBaseColorTexture(tex('base')).setNormalTexture(tex('normal')).setNormalScale(k === 'bronze' ? 0.55 : 1)
    .setOcclusionTexture(orm).setMetallicRoughnessTexture(orm).setOcclusionStrength(0.8);
  const wrap = o.wrap ? core.TextureInfo.WrapMode.REPEAT : core.TextureInfo.WrapMode.CLAMP_TO_EDGE;
  for (const info of [m.getBaseColorTextureInfo(), m.getNormalTextureInfo(), m.getOcclusionTextureInfo(), m.getMetallicRoughnessTextureInfo()])
    info.setWrapS(wrap).setWrapT(wrap).setMinFilter(core.TextureInfo.MinFilter.LINEAR_MIPMAP_LINEAR).setMagFilter(core.TextureInfo.MagFilter.LINEAR);
  mats[k] = m;
}
const meshCache = new Map();
const stats = [];
function meshFor(part) {
  if (meshCache.has(part)) return meshCache.get(part);
  const mesh = doc.createMesh(part.name);
  let tris = 0;
  for (const [mk, gs] of Object.entries(part.m)) {
    if (!gs.length) continue;
    let g = mergeGeometries(gs.map(nonIndexed), false);
    g = mergeVertices(g, 1e-5);
    const idx = g.index.array;
    const prim = doc.createPrimitive().setMaterial(mats[mk])
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.attributes.position.array)))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.attributes.normal.array)))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(g.attributes.uv.array)))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(g.attributes.position.count > 65535 ? new Uint32Array(idx) : new Uint16Array(idx)));
    mesh.addPrimitive(prim);
    tris += idx.length / 3;
  }
  stats.push([part.name, tris]);
  meshCache.set(part, mesh);
  return mesh;
}
for (const a of assets) {
  const root = doc.createNode(a.name).setTranslation(a.pos).setExtras(a.extras || {});
  scene.addChild(root);
  const kids = a.part ? [{ name: a.name + '_Body', part: a.part, mesh: true }] : a.children;
  for (const c of kids) {
    const t = c.t || {};
    const pivot = doc.createNode(c.name).setExtras(c.extras || {});
    if (t.p) pivot.setTranslation(t.p);
    if (t.r) { const q = new Quaternion().setFromEuler(new Euler(...t.r, 'YXZ')); pivot.setRotation([q.x, q.y, q.z, q.w]); }
    root.addChild(pivot);
    pivot.addChild(doc.createNode(c.name + '_Geo').setMesh(meshFor(c.part)));
  }
}
console.log('triangles per mesh:'); for (const [n, t] of stats) console.log('  ', n.padEnd(34), t);
console.log('  total unique', stats.reduce((s, x) => s + x[1], 0));

await doc.transform(
  fn.weld(),
  fn.reorder({ encoder: MeshoptEncoder, target: 'size' }),
  fn.quantize({ quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 14, quantizationVolume: 'mesh' }),
);

// KTX2 / UASTC + Zstd: colour maps perceptual (sRGB), data maps linear; normal-map tuning.
const { encodeToKTX2 } = await mod('ktx2-encoder/dist/node/index.js');
const { createRequire } = await import('node:module');
const sharp = createRequire(path.join(DEPS, 'x.cjs'))('sharp');
const imageDecoder = async buf => { const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data: new Uint8Array(data), width: info.width, height: info.height }; };
let gpuBytes = 0;
for (const { t, role } of FAST ? [] : texList) {
  let png = t.getImage();
  const cap = { T_Maw_top_normal: 1024, T_Maw_top_orm: 1024, T_Maw_trim_orm: 1024 }[t.getName()];
  if (cap) png = new Uint8Array(await sharp(png).resize(cap, cap, { kernel: 'lanczos3' }).png().toBuffer());
  const srgb = role === 'base';
  const out = await encodeToKTX2(png, {
    enableDebug: false, isUASTC: true, needSupercompression: true, generateMipmap: true, uastcLDRQualityLevel: 2,
    isPerceptual: srgb, isSetKTX2SRGBTransferFunc: srgb, isNormalMap: role === 'normal', imageDecoder,
    enableRDO: role !== 'normal', rdoQualityLevel: 0.6,
  });
  const { width, height } = await sharp(png).metadata();
  gpuBytes += width * height * 4 / 3;                                      // ASTC/BC7 4x4: 1 byte/texel + mips
  if (KEEP_PNG) fs.writeFileSync(path.join(TEX, t.getName() + '.ktx2'), out);
  t.setImage(out).setMimeType('image/ktx2').setURI(t.getName() + '.ktx2');
  console.log('ktx2', t.getName(), width + 'x' + height, (png.length / 1024).toFixed(0) + 'KB png ->', (out.length / 1024).toFixed(0) + 'KB');
}
doc.createExtension(ext.EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: ext.EXTMeshoptCompression.EncoderMethod.FILTER });
const io = new core.NodeIO().registerExtensions(ext.ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
doc.getRoot().getAsset().generator = 'Sin tools/r3-maw-assets.mjs';
doc.getRoot().setExtras({ kit: 'R3_MawOfTheAbyss', units: 'metres', up: '+Y', front: '+Z', gpuTextureMiB: +(gpuBytes / 1048576).toFixed(1) });
fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
await io.write(OUTFILE, doc);
console.log('wrote', OUTFILE, (fs.statSync(OUTFILE).size / 1048576).toFixed(2), 'MiB; GPU textures (ASTC/BC7)', (gpuBytes / 1048576).toFixed(1), 'MiB');
