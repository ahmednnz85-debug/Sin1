/* R3 doorway in the throne hall. The original GLB supplies all visible parts. */
(function () {
  'use strict';

  const FILE = 'assets/الباب المختوم.glb';
  const HINGES = ['Door_Left_Hinge_Pivot', 'Door_Right_Hinge_Pivot'];
  const FIXED = ['Left_Column_Box', 'Right_Column_Box', 'Lintel_Box', 'Threshold_Box'];
  const DURATION = 4.2;
  const OPEN = 88.5 * Math.PI / 180;
  const RADIUS = 0.32;

  function outlineOf(points) {
    points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const edge = ordered => {
      const hull = [];
      for (const p of ordered) {
        while (hull.length > 1) {
          const a = hull.at(-2), b = hull.at(-1);
          if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) > 1e-8) break;
          hull.pop();
        }
        hull.push(p);
      }
      hull.pop();
      return hull;
    };
    return [...edge(points), ...edge(points.reverse())];
  }

  function cutWall(T, geometry, toGate, outline, rear) {
    const gatePoints = [];
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      gatePoints.push(new T.Vector3().fromBufferAttribute(positions, i).applyMatrix4(toGate));
    }
    const limits = [Math.min(...outline.map(p => p[0])), Math.max(...outline.map(p => p[0])),
      Math.min(...outline.map(p => p[1])), Math.max(...outline.map(p => p[1]))];
    const planes = [p => p.z - rear, ...outline.map(([x, y], i) => {
      const [nextX, nextY] = outline[(i + 1) % outline.length];
      const dx = nextX - x, dy = nextY - y;
      // Leave a narrow seating joint under the decorative frame.
      const seat = Math.hypot(dx, dy) * 0.009;
      return p => dx * (p.y - y) - dy * (p.x - x) - seat;
    })];
    const copied = Object.entries(geometry.attributes)
      .map(([name, attr]) => {
        const data = [];
        for (let i = 0; i < attr.count; i++) for (let j = 0; j < attr.itemSize; j++) data.push(attr.getComponent(i, j));
        return { name, attr, data };
      });
    const indices = [];
    const source = geometry.index;
    const count = source?.count || positions.count;
    let added = positions.count;
    for (let i = 0; i < count; i += 3) {
      const corners = [i, i + 1, i + 2].map(index => source ? source.getX(index) : index);
      const points = corners.map(index => gatePoints[index]);
      const [left, right, bottom, top] = limits;
      if (points.every(p => p.x <= left) || points.every(p => p.x >= right) ||
          points.every(p => p.y <= bottom) || points.every(p => p.y >= top) || points.every(p => p.z <= rear)) {
        indices.push(...corners);
        continue;
      }
      const distances = planes.map(distance => points.map(distance));
      if (distances.some(d => d.every(x => x <= 0))) {
        indices.push(...corners);
        continue;
      }
      // Barycentric interpolation keeps the wall's UVs/normals at the
      // cut, and only the portion in front of the fitted door is removed.
      let remainder = [[0, 0], [1, 0], [0, 1]];
      for (const [a, b, c] of distances) {
        const inside = [], outside = [];
        const distance = ([u, v]) => a + (b - a) * u + (c - a) * v;
        for (let j = 0; j < remainder.length; j++) {
          const p = remainder[j], q = remainder[(j + 1) % remainder.length];
          const dp = distance(p), dq = distance(q);
          (dp >= 0 ? inside : outside).push(p);
          if ((dp >= 0) !== (dq >= 0)) {
            const t = dp / (dp - dq);
            const crossing = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
            inside.push(crossing);
            outside.push(crossing);
          }
        }
        if (outside.length >= 3) {
          const ids = outside.map(([u, v]) => {
            for (const { attr, data } of copied) {
              for (let k = 0; k < attr.itemSize; k++) {
                const a = attr.getComponent(corners[0], k);
                const b = attr.getComponent(corners[1], k);
                const c = attr.getComponent(corners[2], k);
                data.push(a + (b - a) * u + (c - a) * v);
              }
            }
            return added++;
          });
          for (let j = 1; j + 1 < ids.length; j++) indices.push(ids[0], ids[j], ids[j + 1]);
        }
        remainder = inside;
        if (remainder.length < 3) break;
      }
    }
    const cut = new T.BufferGeometry().setIndex(indices);
    for (const { name, attr, data } of copied) cut.setAttribute(name, new T.Float32BufferAttribute(data, attr.itemSize));
    cut.computeBoundingSphere();
    return cut;
  }

  function addLining(T, asset) {
    const { scene, outline, size, edgeMaterial, archMaterial } = asset;
    if (!edgeMaterial || scene.getObjectByName('R3DoorRebateLining')) return;
    const root = new T.Group();
    root.name = 'R3DoorRebateLining';
    const segments = new Map([
      [edgeMaterial, { positions: [], uvs: [] }],
      [archMaterial, { positions: [], uvs: [] }]
    ]);
    const points = outline.map(([x, y]) => new T.Vector2(x, y));
    const inward = points.map((point, i) => {
      const next = points[(i + 1) % points.length];
      return new T.Vector2(point.y - next.y, next.x - point.x).normalize();
    });
    const offset = points.map((p, i) => {
      const edge = inward[i], adjacent = inward[(i + points.length - 1) % points.length];
      const bisector = edge.clone().add(adjacent).normalize();
      return bisector.multiplyScalar(1 / Math.max(0.5, edge.dot(bisector)));
    });
    const inner = points.map((point, i) => point.clone().addScaledVector(offset[i], 0.048));
    const outer = points.map((point, i) => point.clone().addScaledVector(offset[i], -0.012));
    const front = size.max.z - 0.012, rear = size.min.z - 0.020;
    const quad = (batch, corners, u0, u1, height) => {
      const uvs = [[u0, 0], [u1, 0], [u1, height], [u0, height]];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        batch.positions.push(...corners[i]);
        batch.uvs.push(...uvs[i]);
      }
    };
    let u = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const nextU = u + points[i].distanceTo(points[j]);
      const batch = segments.get(Math.min(points[i].y, points[j].y) > 5.5 ? archMaterial : edgeMaterial);
      const o0 = [...outer[i], front], o1 = [...outer[j], front];
      const f0 = [...inner[i], front], f1 = [...inner[j], front];
      // The front strip covers the joint; the return lines it through the
      // depth of the recess so an oblique view cannot see behind the frame.
      quad(batch, [o0, o1, f1, f0], u, nextU, 0.06);
      quad(batch, [f0, f1, [...inner[j], rear], [...inner[i], rear]], u, nextU, front - rear);
      u = nextU;
    }
    for (const [material, batch] of segments) {
      if (!batch.positions.length) continue;
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(batch.positions, 3));
      geometry.setAttribute('uv', new T.Float32BufferAttribute(batch.uvs, 2));
      geometry.computeVertexNormals();
      geometry.userData.palaceShared = true;
      const mesh = new T.Mesh(geometry, material);
      mesh.name = 'R3DoorLining/' + material.name;
      mesh.userData.r3DoorTrim = true;
      root.add(mesh);
    }
    scene.add(root);
  }

  function stoneSurface(geometry) {
    // The SideStone map is an atlas of reliefs and stone. Use the stone on
    // either side of its cuneiform panel for the larger architectural faces.
    const result = geometry.toNonIndexed();
    const uv = result.attributes.uv;
    const corners = [[0, 1], [0, 0], [1, 1], [0, 0], [1, 0], [1, 1]];
    for (let i = 0; i < uv.count; i += 6) {
      const tile = i / 6;
      const left = (tile * 7 % 11) < 5;
      const start = left ? 9 : 388;
      const flip = Math.floor(tile * 11 / 7) % 2;
      for (let j = 0; j < corners.length; j++) {
        const [x, y] = corners[j];
        uv.setXY(i + j, (start + (flip ? 1 - x : x) * 65) / 512, (119 + y * 113) / 1024);
      }
    }
    geometry.dispose();
    return result;
  }

  async function prepare(T, buffer) {
    const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
    const loader = new T.GLTFLoader();
    loader.register(parser => {
      // This source uses embedded PNGs. Keep their pixels at source
      // resolution and share the identical Front/GoldRings bufferView
      // through GLTFLoader's texture cache.
      parser.textureLoader = new T.TextureLoader(parser.options.manager);
      return { name: 'R3SealedDoorTextures' };
    });
    const { scene } = await loader.parseAsync(buffer, '');
    scene.traverse(node => {
      if (!node.isMesh || !node.material.map) return;
      const { userData } = node.material.map;
      userData.r3DoorOriginal = true;
      userData.palaceShared = true;
      userData.sinKeepCpu = true;
    });
    const frame = scene.getObjectByName('world');
    const hinges = HINGES.map(name => scene.getObjectByName(name));
    const fixed = FIXED.map(name => scene.getObjectByName(name));
    if (!frame || [...hinges, ...fixed].some(node => !node)) throw new Error('Invalid sealed door hierarchy');
    scene.updateMatrixWorld(true);
    const size = new T.Box3().setFromObject(frame);
    const fixedBoxes = fixed.map(node => new T.Box3().setFromObject(node));
    const leafBoxes = [], framePoints = [];
    for (const part of [...hinges, frame]) {
      const inverse = part.matrixWorld.clone().invert();
      const sets = new Map(), originals = new Set();
      const bounds = new T.Box3();
      for (const child of [...part.children]) {
        if (hinges.includes(child)) continue;
        child.traverse(mesh => {
          if (!mesh.isMesh) return;
          const copy = mesh.geometry.clone().applyMatrix4(inverse.clone().multiply(mesh.matrixWorld));
          copy.computeBoundingBox();
          bounds.union(copy.boundingBox);
          if (part === frame) {
            const pos = copy.getAttribute('position');
            for (let i = 0; i < pos.count; i++) framePoints.push([pos.getX(i), pos.getY(i)]);
          }
          originals.add(mesh.geometry);
          const name = mesh.material.name;
          if (!sets.has(name)) sets.set(name, { material: mesh.material, geometries: [] });
          sets.get(name).geometries.push(copy);
        });
        part.remove(child);
      }
      // Batch by rigid part and authored material. Vertices, UVs, triangle
      // order within each source mesh, and the original hinge transforms survive.
      for (const [name, set] of sets) {
        const geometry = mergeGeometries(set.geometries);
        if (!geometry) throw new Error('Incompatible sealed door geometry ' + name);
        geometry.userData.palaceShared = true;
        set.material.userData.palaceShared = true;
        const batch = new T.Mesh(geometry, set.material);
        batch.name = part.name + '/' + name;
        batch.receiveShadow = true;
        part.add(batch);
        set.geometries.forEach(g => g.dispose());
      }
      originals.forEach(g => g.dispose());
      if (part !== frame) leafBoxes.push(bounds);
    }
    scene.name = 'R3SealedDoor';
    const materials = new Map(frame.children.filter(node => node.isMesh).map(node => [node.material.name, node.material]));
    return { scene, hinges, size, fixedBoxes, leafBoxes, outline: outlineOf(framePoints),
      edgeMaterial: materials.get('SideStone'), archMaterial: materials.get('ArchSide') };
  }

  function mount(T, asset, parent, passage) {
    const { scene, hinges, size, fixedBoxes, leafBoxes } = asset;
    const threshold = fixedBoxes[3];
    const bottom = fixedBoxes[0].min.y;
    const center = (size.min.x + size.max.x) / 2;
    // The original wall arch extends above the logic height. Fit to its
    // crown; both horizontal axes use the same scale for rigid rotation.
    const horizontal = passage.width / (size.max.x - size.min.x);
    const vertical = passage.height * 1.075 / (size.max.y - bottom);
    const facing = passage.rotY;
    const s = Math.sin(facing), c = Math.cos(facing);
    // The outer sculpted face meets the mural plane. Only the wall at
    // this opening receives a shallow rebate for the thickness of the frame.
    const face = -size.max.z * horizontal;
    // The column bases share the hall floor datum. The authored threshold
    // seats below it, while the leaves clear the finished alcove floor.
    scene.position.set(
      passage.position[0] + face * s - center * c * horizontal,
      passage.position[1] - bottom * vertical,
      passage.position[2] + face * c + center * s * horizontal
    );
    scene.rotation.y = facing;
    scene.scale.set(horizontal, vertical, horizontal);
    addLining(T, asset);
    parent.add(scene);
    scene.updateWorldMatrix(true, false);
    const origin = scene.getWorldPosition(new T.Vector3());
    const floor = origin.y + threshold.max.y * vertical;
    const leaves = hinges.map((hinge, i) => ({
      hinge, bounds: leafBoxes[i], sign: i === 0 ? 1 : -1, sin: 0, cos: 1,
      reach: Math.hypot(Math.max(Math.abs(leafBoxes[i].min.x), Math.abs(leafBoxes[i].max.x)),
        Math.max(Math.abs(leafBoxes[i].min.z), Math.abs(leafBoxes[i].max.z)))
    }));
    const staticParts = fixedBoxes.map(bounds => ({ bounds, sin: 0, cos: 1 }));
    const solidParts = [...leaves, ...staticParts.slice(0, -1)];
    const cameraParts = [...solidParts, staticParts.at(-1)];
    const local = { x: 0, z: 0 };
    const padded = {};
    let elapsed = 0, phase = 'closed';

    function nearby(x, z, extra) {
      const radius = passage.width * 0.6 + extra;
      return Math.abs(x - origin.x) < radius && Math.abs(z - origin.z) < radius;
    }

    function toModel(x, z) {
      x -= origin.x; z -= origin.z;
      local.x = (c * x - s * z) / horizontal;
      local.z = (s * x + c * z) / horizontal;
    }

    function angleAt(seconds) {
      const t = seconds / DURATION;
      return OPEN * t * t * t * (10 + t * (-15 + 6 * t));
    }

    function setAngle(angle) {
      for (const leaf of leaves) {
        const signed = leaf.sign * angle;
        leaf.hinge.rotation.y = signed;
        leaf.sin = Math.sin(signed);
        leaf.cos = Math.cos(signed);
      }
    }

    function touches(part, y0, y1, radius, sin = part.sin, cos = part.cos) {
      const { hinge, bounds } = part;
      if (bounds.min.y >= y1 || bounds.max.y <= y0) return false;
      const x = local.x - (hinge?.position.x || 0), z = local.z - (hinge?.position.z || 0);
      const u = cos * x - sin * z, v = sin * x + cos * z;
      const du = u - Math.max(bounds.min.x, Math.min(u, bounds.max.x));
      const dv = v - Math.max(bounds.min.z, Math.min(v, bounds.max.z));
      return du * du + dv * dv < radius * radius;
    }

    function blocks(x, z, feet, head, radius = RADIUS) {
      if (!nearby(x, z, radius)) return false;
      toModel(x, z);
      const y0 = (feet + 0.08 - origin.y) / vertical, y1 = (head - origin.y) / vertical;
      return solidParts.some(part => touches(part, y0, y1, radius / horizontal));
    }

    function support(x, z) {
      if (!nearby(x, z, 0)) return null;
      toModel(x, z);
      return local.x >= threshold.min.x && local.x <= threshold.max.x &&
        local.z >= threshold.min.z && local.z <= threshold.max.z ? floor : null;
    }

    function update(dt, hero, height) {
      if (phase !== 'opening' || !(dt > 0)) return;
      const next = Math.min(DURATION, elapsed + Math.min(0.1, dt));
      const start = angleAt(elapsed), end = angleAt(next);
      if (nearby(hero.x, hero.z, RADIUS)) {
        toModel(hero.x, hero.z);
        const low = (hero.y + 0.08 - origin.y) / vertical, high = (hero.y + height - origin.y) / vertical;
        // A midpoint box expanded by the most a vertex can travel in half
        // the increment covers the entire continuous sweep of either leaf.
        const middle = (start + end) / 2;
        if (leaves.some(leaf => touches(leaf, low, high, RADIUS / horizontal + leaf.reach * (end - start) / 2,
          Math.sin(leaf.sign * middle), Math.cos(middle)))) return;
      }
      elapsed = next;
      setAngle(end);
      if (elapsed === DURATION) phase = 'open';
    }

    function cameraFraction(x, y, z, dx, dy, dz, radius, rayHit) {
      if (!nearby(x, z, Math.hypot(dx, dz) + radius)) return 1;
      toModel(x, z);
      const mx = (c * dx - s * dz) / horizontal, mz = (s * dx + c * dz) / horizontal;
      const my = (y - origin.y) / vertical, sy = dy / vertical;
      const rx = radius / horizontal, ry = radius / vertical;
      let best = 1;
      for (const { hinge, bounds: b, sin, cos } of cameraParts) {
        const lx = local.x - (hinge?.position.x || 0), lz = local.z - (hinge?.position.z || 0);
        const px = lx * cos - lz * sin, pz = lx * sin + lz * cos;
        // A hinge-hugging pivot may already be inside the safety padding.
        const contains = (r, h) => px >= b.min.x - r && px <= b.max.x + r &&
          my >= b.min.y - h && my <= b.max.y + h && pz >= b.min.z - r && pz <= b.max.z + r;
        if (contains(0, 0)) continue;
        const pad = contains(rx, ry) ? 0 : 1;
        padded.minx = b.min.x - rx * pad; padded.maxx = b.max.x + rx * pad;
        padded.miny = b.min.y - ry * pad; padded.maxy = b.max.y + ry * pad;
        padded.minz = b.min.z - rx * pad; padded.maxz = b.max.z + rx * pad;
        const hit = rayHit(px, my, pz, cos * mx - sin * mz, sy, sin * mx + cos * mz, padded);
        if (hit !== null) best = Math.min(best, hit);
      }
      return best;
    }

    return {
      open() { if (phase !== 'closed') return false; phase = 'opening'; return true; },
      isOpen() { return phase === 'open'; },
      resetForTest(hero) {
        if (nearby(hero.x, hero.z, RADIUS)) return false;
        elapsed = 0;
        phase = 'closed';
        setAngle(0);
        return true;
      },
      state() {
        return { phase, elapsed, duration: DURATION, angles: hinges.map(node => node.rotation.y),
          origin: origin.toArray(), floor, columnBase: origin.y + bottom * vertical, scale: [horizontal, vertical],
          jambs: hinges.map(node => node.position.toArray()) };
      },
      recessWall(geometry, matrix) {
        const toGate = scene.matrix.clone().invert().multiply(matrix);
        return cutWall(T, geometry, toGate, asset.outline, size.min.z - 0.018);
      },
      update, blocks, support, cameraFraction
    };
  }

  window.SinR3SealedDoor = { FILE, prepare, mount, stoneSurface };
})();
