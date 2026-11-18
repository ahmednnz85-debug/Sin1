/* L1, in palace-local metres. The original GLBs each contain one indexed mesh
   and one PBR atlas. Their disconnected components remain in the original files. */
(function () {
  'use strict';

  const files = {
    collection: 'assets/المكتبة الكبرى l1.glb',
    architecture: 'assets/المكتبة الكبرى l1 2.glb',
    stone: 'assets/حجر المكتبة الكبرى.JPG',
    ceiling: 'assets/ارضية المكتبة الكبرى.JPG',
    ornaments: 'assets/نقوش صغيرة.PNG'
  };
  const collection = {
    4448: 'stele', 11708: 'instrument', 3496: 'medallion',
    7279: 'niche', 8611: 'shelf', 9205: 'armillary'
  };
  const architecture = {
    4540: 'stairs', 15677: 'northRail', 7956: 'arch',
    15605: 'southRail', 4132: 'lantern', 11447: 'upperShelf'
  };
  // Pixel rectangles in the artist's ornament atlas, measured on a 630×420 grid.
  const relief = {
    inscriptions: [12, 13, 206, 61], wingedSun: [230, 13, 404, 61],
    scroll: [13, 87, 207, 125], lotus: [480, 92, 555, 123],
    jamb: [382, 144, 411, 278], narrowJamb: [431, 144, 461, 277],
    tablet: [295, 306, 391, 397]
  };
  const floorY = 0.014;

  function split(gltf, names) {
    const parts = {};
    let source;
    gltf.scene.traverse(node => { if (node.isMesh) source = node; });
    const geometry = source.geometry, positions = geometry.attributes.position;
    const indices = geometry.index.array;
    const parents = new Int32Array(positions.count);
    const vertices = new Map();

    function root(i) {
      while (parents[i] !== i) {
        parents[i] = parents[parents[i]];
        i = parents[i];
      }
      return i;
    }
    function join(a, b) {
      parents[root(a)] = root(b);
    }

    // Weld only for the connectivity search. Keep all original UV seams and normals.
    for (let i = 0; i < positions.count; i++) {
      parents[i] = i;
      const key = [positions.getX(i), positions.getY(i), positions.getZ(i)]
        .map(n => Math.round(n * 100000)).join(',');
      if (vertices.has(key)) join(i, vertices.get(key));
      else vertices.set(key, i);
    }
    for (let i = 0; i < indices.length; i += 3) {
      join(indices[i], indices[i + 1]);
      join(indices[i], indices[i + 2]);
    }
    const components = new Map();
    for (let i = 0; i < indices.length; i += 3) {
      const id = root(indices[i]);
      if (!components.has(id)) components.set(id, []);
      components.get(id).push(indices[i], indices[i + 1], indices[i + 2]);
    }
    components.forEach(faces => {
      // The source collections have no semantic names. Triangle counts identify
      // the twelve inspected components and make an asset revision fail clearly.
      const name = names[faces.length / 3];
      if (!name || parts[name]) throw new Error('Unexpected Great Library mesh component');
      const vertices = new Map(), original = [], compact = [];
      faces.forEach(i => {
        if (!vertices.has(i)) {
          vertices.set(i, original.length);
          original.push(i);
        }
        compact.push(vertices.get(i));
      });
      const part = new THREE.BufferGeometry();
      ['position', 'normal', 'uv'].forEach(key => {
        const attr = geometry.attributes[key];
        const values = new Float32Array(original.length * attr.itemSize);
        original.forEach((i, j) => {
          for (let k = 0; k < attr.itemSize; k++) values[j * attr.itemSize + k] = attr.getComponent(i, k);
        });
        part.setAttribute(key, new THREE.BufferAttribute(values, attr.itemSize));
      });
      part.setIndex(compact);
      parts[name] = { geometry: part, material: source.material };
    });
    if (Object.keys(parts).length !== Object.keys(names).length) throw new Error('Incomplete Great Library asset collection');
    geometry.dispose();
    return parts;
  }

  function fitParts(parts) {
    ['stele', 'niche', 'shelf', 'upperShelf'].forEach(name => parts[name].geometry.rotateY(-Math.PI / 2));
    parts.arch.geometry.rotateY(-1.719);
    parts.medallion.geometry.rotateZ(Math.atan(0.50355));

    // Take a repeatable straight run from each of the two bent gallery modules.
    // The joints land inside the new structural posts. All rails retain their
    // source balusters, underside, material and atlas UVs.
    trimRail(parts.northRail, 0.268, 0.441, 0.25);
    trimRail(parts.southRail, -0.229, -0.131, 0.59);
    Object.values(parts).forEach(part => {
      const geo = part.geometry;
      geo.computeBoundingBox();
      const bounds = geo.boundingBox;
      const centre = bounds.getCenter(new THREE.Vector3());
      part.size = bounds.getSize(new THREE.Vector3());
      geo.translate(-centre.x, -bounds.min.y, -centre.z);
    });
  }

  function trimRail(part, start, end, slope) {
    const source = part.geometry;
    const position = source.attributes.position;
    const uv = source.attributes.uv;
    const positions = [], texcoords = [];
    const index = source.index.array;
    function cut(poly, z, sign) {
      const result = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const inside = sign * (a[2] - z) >= 0;
        if (inside) result.push(a);
        if (inside !== (sign * (b[2] - z) >= 0)) {
          const t = (z - a[2]) / (b[2] - a[2]);
          result.push(a.map((v, k) => v + t * (b[k] - v)));
        }
      }
      return result;
    }
    for (let i = 0; i < index.length; i += 3) {
      const triangle = [index[i], index[i + 1], index[i + 2]].map(j => [
        position.getX(j), position.getY(j), position.getZ(j), uv.getX(j), uv.getY(j)
      ]);
      const poly = cut(cut(triangle, start, 1), end, -1);
      for (let j = 1; j < poly.length - 1; j++) {
        [poly[0], poly[j], poly[j + 1]].forEach(([x, y, z, u, v]) => {
          positions.push(z, y, -x + slope * (z - start));
          texcoords.push(u, v);
        });
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(texcoords, 2));
    geometry.computeVertexNormals();
    part.geometry = geometry;
    source.dispose();
  }

  function materialSet(stone, tiles, carving) {
    [stone, tiles, carving].forEach(texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
    });
    stone.wrapS = stone.wrapT = THREE.RepeatWrapping;
    tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping;
    function standard(name, color, map, bumpScale, roughness = 0.88) {
      return new THREE.MeshStandardMaterial({ name, color, map, bumpMap: map, bumpScale, roughness });
    }
    const ceiling = standard('L1 carved ceiling stone', 0xd4b58d, tiles, 0.055);
    const ceilingField = standard('L1 weathered ceiling stone', 0xd6b993, tiles, 0.012);
    ceilingField.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        diffuseColor.rgb = mix(vec3(0.50, 0.38, 0.27), diffuseColor.rgb, 0.16);
      `);
    };
    return {
      wall: standard('L1 sandstone walls', 0xe5c8a4, stone, 0.032),
      floor: standard('L1 sandstone floor', 0xe9cfad, stone, 0.021, 0.76),
      darkStone: standard('L1 recessed sandstone', 0x342c24, stone, 0.032),
      ceiling, ceilingField,
      carving: standard('L1 sandstone ornament atlas', 0xdcc39e, carving, 0.032),
      timber: standard('L1 dark cedar', 0xd7b18e, cedarTexture(), 0.011, 0.82),
      brass: new THREE.MeshStandardMaterial({ name: 'L1 aged bronze', color: 0x655038, roughness: 0.56, metalness: 0.62 })
    };
  }

  function cedarTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const wood = ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      const board = Math.floor(y / 32);
      for (let x = 0; x < 256; x++) {
        const grain = Math.sin(y * 0.62 + Math.sin(x * 0.024 + board) * 1.8) * 8
          + Math.sin(y * 2.58 + Math.cos(x * 0.051 + board) * 1.1) * 5;
        const joint = y % 32 < 2 ? -20 : 0;
        const warmth = 60 + grain + joint + Math.sin(board * 5.79) * 9;
        const i = (y * 256 + x) * 4;
        wood.data[i] = warmth;
        wood.data[i + 1] = warmth * 0.64;
        wood.data[i + 2] = warmth * 0.40;
        wood.data[i + 3] = 255;
      }
    }
    ctx.putImageData(wood, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  function builder(group, prefix = 'L1-') {
    const surfaces = new Map(), instances = new Map();
    const transform = new THREE.Object3D();
    function matrix(x, y, z, angle, sx = 1, sy = 1, sz = 1) {
      transform.position.set(x, y, z);
      transform.rotation.set(0, angle, 0);
      transform.scale.set(sx, sy, sz);
      transform.updateMatrix();
      return transform.matrix;
    }
    function surface(name, material, geometry, host, x, y, z, angle = 0) {
      geometry.applyMatrix4(matrix(x, y, z, angle));
      if (host) geometry.applyMatrix4(host);
      const key = name + ':' + material.id;
      if (!surfaces.has(key)) surfaces.set(key, { name, material, geometries: [] });
      surfaces.get(key).geometries.push(geometry);
    }
    function box(name, mat, host, x, y, z, w, h, d, tile = 4.0) {
      const g = new THREE.BoxGeometry(w, h, d);
      const uv = g.attributes.uv;
      const dimensions = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
      dimensions.forEach(([a, b], side) => {
        for (let i = side * 4; i < side * 4 + 4; i++) uv.setXY(i, uv.getX(i) * a / tile, uv.getY(i) * b / tile);
      });
      surface(name, mat, g, host, x, y, z);
    }
    function asset(name, part, host, x, y, z, w, h, d, angle = 0) {
      const m = matrix(x, y, z, angle, w / part.size.x, h / part.size.y, d / part.size.z).clone();
      if (host) m.premultiply(host);
      if (!instances.has(name)) instances.set(name, { part, matrices: [] });
      instances.get(name).matrices.push(m);
      return m;
    }
    function flush() {
      surfaces.forEach(({ name, material, geometries }) => {
        const p = [], n = [], t = [];
        geometries.forEach(geometry => {
          const g = geometry.index ? geometry.toNonIndexed() : geometry;
          for (const v of g.attributes.position.array) p.push(v);
          for (const v of g.attributes.normal.array) n.push(v);
          for (const v of g.attributes.uv.array) t.push(v);
          g.dispose();
          if (g !== geometry) geometry.dispose();
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(t, 2));
        const mesh = new THREE.Mesh(g, material);
        mesh.name = prefix + name;
        mesh.receiveShadow = true;
        mesh.castShadow = !material.transparent && material.name !== 'L1 sandstone ornament atlas' && name !== 'floor';
        group.add(mesh);
      });
      instances.forEach(({ part, matrices }, name) => {
        let mesh;
        if (matrices.length === 1) {
          mesh = new THREE.Mesh(part.geometry, part.material);
          mesh.matrixAutoUpdate = false;
          mesh.matrix.copy(matrices[0]);
        } else {
          mesh = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
          matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere();
        }
        mesh.name = prefix + name;
        mesh.receiveShadow = true;
        mesh.castShadow = name !== 'floor-medallion' && name !== 'lanterns';
        group.add(mesh);
      });
    }
    return { surface, box, asset, flush };
  }

  function atlasUV(u, v, rect) {
    const [x0, y0, x1, y1] = rect;
    return [(x0 + (x1 - x0) * u) / 630, 1 - (y1 + (y0 - y1) * v) / 420];
  }

  function reliefPlane(w, h, type) {
    const geo = new THREE.PlaneGeometry(w, h);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, ...atlasUV(uv.getX(i), uv.getY(i), relief[type]));
    return geo;
  }

  function walls(build, group, materials, parts, { boxCollider, width, length, height, doors, x0, z0 }) {
    const { box, surface, asset } = build;
    const { wall, darkStone, carving } = materials;
    const hosts = [
      ['north', 0, 0, 0, length],
      ['south', length, width, Math.PI, length],
      ['east', length, 0, -Math.PI / 2, width],
      ['west', 0, width, Math.PI / 2, width]
    ];
    function reliefPanel(host, type, u, y, z, w, h) {
      surface('carved-borders', carving, reliefPlane(w, h, type), host, u, y, z);
    }
    function band(host, type, a, b, y, depth, h, pitch) {
      const n = Math.max(1, Math.round((b - a) / pitch));
      const w = (b - a) / n;
      for (let i = 0; i < n; i++) reliefPanel(host, type, a + w * (i + 0.5), y, depth, w, h);
    }
    function light(host, u, y, z, intensity, reach, color = 0xffad58) {
      const l = new THREE.PointLight(color, intensity, reach, 2);
      l.position.set(u, y, z).applyMatrix4(host);
      group.add(l);
    }
    function lantern(host, u, y, intensity) {
      asset('lanterns', parts.lantern, host, u, y, 0.54, 0.43, 0.99, 0.42);
      if (intensity > 0) light(host, u, y + 0.60, 0.96, intensity, 7);
    }
    function shelf(host, u, y, w, h, upper) {
      const d = upper ? 0.82 : 1.1;
      asset(upper ? 'upper-bookcases' : 'bookcases', upper ? parts.upperShelf : parts.shelf, host,
        u, y, d / 2 + 0.15, w, h, d);
      if (!upper) {
        // The base and jambs of the case sit inside the dressed wall.
        const b = new THREE.Box3(new THREE.Vector3(u - w / 2, y, 0),
          new THREE.Vector3(u + w / 2, y + h, d + 0.14)).applyMatrix4(host);
        boxCollider(b);
      }
    }
    function niche(host, u, w, h) {
      asset('statue-niches', parts.niche, host, u, 0.08, 0.68, w, h, 1.2);
      // The asset has the statue and its back wall, so the sconce sits beside it.
      lantern(host, u + w * 0.38, h * 0.67, 0);
      light(host, u + w * 0.16, h * 0.72, 1.32, 7.4, 6.1);
      boxCollider(new THREE.Box3(new THREE.Vector3(u - w * 0.45, 0, 0),
        new THREE.Vector3(u + w * 0.45, h, 1.21)).applyMatrix4(host));
    }
    function pilaster(host, u, y, h, w = 0.68) {
      box('pilasters', wall, host, u, y + h / 2, 0.25, w, h, 0.58);
      box('pilaster-mouldings', wall, host, u, y + 0.16, 0.27, w + 0.22, 0.32, 0.7);
      box('pilaster-mouldings', wall, host, u, y + h - 0.16, 0.27, w + 0.24, 0.32, 0.70);
      reliefPanel(host, 'jamb', u, y + h / 2, 0.543, w * 0.69, Math.min(h - 0.62, w * 3.5));
    }
    function arch(host, opening) {
      const { u, span, top, main, id } = opening;
      const exterior = span + (main ? 3.7 : 3.1);
      const depth = main ? 1.38 : 1.04;
      asset('open-arch-' + id, parts.arch, host, u, floorY, depth / 2 + 0.05,
        exterior, top, depth);
      // Sandstone infill follows the inside of the supplied arch's opening.
      // This creates a curved, walk-through opening with a stone reveal.
      const half = Math.min(span * 0.51, exterior * 0.237), spring = top * 0.57;
      const crown = top * 0.829;
      const shape = new THREE.Shape();
      shape.moveTo(-half, height);
      shape.lineTo(-half, spring);
      for (let i = 1; i <= 28; i++) {
        const a = Math.PI * (1 - i / 28);
        shape.lineTo(half * Math.cos(a), spring + (crown - spring) * Math.sin(a));
      }
      shape.lineTo(half, height);
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: false, curveSegments: 1 });
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3.25, uv.getY(i) / 3.25);
      surface('sandstone-walls', wall, g, host, u, 0, 0.018);

      for (const side of [-1, 1]) {
        const jamb = u + side * exterior * 0.34;
        reliefPanel(host, side === -1 ? 'jamb' : 'narrowJamb', jamb, top * 0.33,
          depth + 0.085, exterior * 0.071, top * 0.46);
      }
      if (main) {
        band(host, 'wingedSun', u - exterior * 0.5, u + exterior * 0.5,
          top + 0.32, 0.29, 0.40, 3.3);
      } else {
        // Tympanum ornament above the openings leaves the walkline clear.
        band(host, 'inscriptions', u - exterior * 0.46, u + exterior * 0.46,
          top + 0.17, 0.269, 0.37, 3.3);
      }

      // Keep the playable width synchronized with the visible arch jambs.
      for (const side of [-1, 1]) {
        const a = u + side * half, b = u + side * (half + 0.38);
        boxCollider(new THREE.Box3(new THREE.Vector3(Math.min(a, b), 0, 0),
          new THREE.Vector3(Math.max(a, b), spring, depth * 0.63)).applyMatrix4(host));
      }
    }
    function passage(host, { u, span, main, id }) {
      // Line the boundary of the existing passages with sandstone returns.
      // The sleeve remains hollow and the original corridor continues beyond it.
      if (id === 'PalaceR1') return;
      const depth = main ? 5.46 : 2.48;
      const revealWidth = span - 0.036;
      const soffit = main ? 5.1 : 4.81;
      box('passage-inverts', darkStone, host, u, floorY + 0.019, -depth / 2,
        revealWidth, 0.038, depth);
      box('passage-soffits', darkStone, host, u, soffit + 0.12, -depth / 2,
        revealWidth + 0.16, 0.24, depth);
      for (const side of [-1, 1]) {
        const jamb = u + side * (revealWidth / 2 + 0.061);
        box('passage-sides', darkStone, host, jamb,
          soffit * 0.5, -depth / 2, 0.122, soffit, depth);
        boxCollider(new THREE.Box3(new THREE.Vector3(jamb - 0.061, 0, -depth),
          new THREE.Vector3(jamb + 0.061, soffit, 0)).applyMatrix4(host));
      }
      if (id === 'L1-LC2') {
        const sconceU = u - revealWidth / 2 + 0.29;
        asset('lanterns', parts.lantern, host, sconceU, 2.6, -1.47, 0.36, 0.83, 0.34, Math.PI / 2);
        light(host, sconceU + 0.47, 3.06, -1.39, 7.3, 5.3);
      }
      if (main) {
        // A recessed stone return shades the observatory approach. The
        // passage turns around its free end with 1.85 m of clear width.
        const clear = 1.85;
        const slab = revealWidth - clear + 0.1;
        const u0 = u - revealWidth / 2 + clear;
        const u1 = u0 + slab;
        const front = -4.09, back = -4.49;
        box('passage-sides', darkStone, host, (u0 + u1) / 2, soffit / 2,
          (front + back) / 2, slab, soffit, front - back);
        boxCollider(new THREE.Box3(new THREE.Vector3(u0, 0, back),
          new THREE.Vector3(u1, soffit, front)).applyMatrix4(host));
        // The rear ceiling drops below the ceremonial arch. Its stone
        // transom sits back in the opening, above the playable clearance.
        box('passage-soffits', darkStone, host, u, (soffit + 8.0) / 2, -1.1,
          revealWidth, 8.0 - soffit, 0.24);
      }
    }
    for (const [name, x, z, angle, span] of hosts) {
      const host = new THREE.Matrix4().makeRotationY(angle).setPosition(x, 0, z);
      const openingList = doors.flatMap(d => {
        if (name === 'east' && d.id === 'L1-LC4') return [{ u: d.z - z0, span: d.width, top: 9.28, main: true, id: d.id }];
        if (name === 'west' && d.id === 'PalaceR1') return [{ u: width - (d.z - z0), span: d.width, top: 8.65, id: d.id }];
        if (name === 'north' && d.axis === 'z') return [{ u: d.x - x0, span: d.width, top: 6.25, id: d.id }];
        return [];
      }).sort((a, b) => a.u - b.u);
      let start = 0;
      const sections = [];
      openingList.forEach(op => {
        const half = Math.min(op.span * 0.51, (op.span + (op.main ? 3.7 : 3.1)) * 0.237);
        sections.push([start, op.u - half]);
        arch(host, op);
        passage(host, op);
        start = op.u + half;
      });
      sections.push([start, span]);
      sections.forEach(([a, b]) => {
        box('sandstone-walls', wall, host, (a + b) / 2, height / 2, 0.127,
          b - a, height, 0.24);
        box('wall-plinth', darkStone, host, (a + b) / 2, 0.25, 0.23, b - a, 0.5, 0.38);
      });
      const sides = name === 'north' || name === 'south';
      const corniceY = sides || name === 'west' ? 6.11 : 6.25;
      const friezeSections = (name === 'east' || name === 'west') ? sections : [[0.12, span - 0.12]];
      friezeSections.forEach(([a, b]) => {
        box('cornices', wall, host, (a + b) / 2, corniceY, 0.26, b - a, 0.38, 0.53);
        band(host, 'scroll', a, b, corniceY, 0.529, 0.30, 2.14);
      });
      box('cornices', wall, host, span / 2, height - 0.35, 0.20, span, 0.45, 0.41);
      band(host, 'lotus', 0.12, span - 0.12, height - 0.36, 0.408, 0.27, 1.57);

      if (sides) {
        if (name === 'north') {
          [[6.2, 4.0], [11.1, 4.05], [26.5, 3.7]].forEach(([u, w]) => shelf(host, u, 0.17, w, 4.45, false));
          niche(host, 22.65, 2.65, 4.28);
          [1.4, 3.65, 8.82, 13.4, 24.48, 28.7, 38.4].forEach(u => pilaster(host, u, 0, 5.93));
          [[6.2, 4.0], [11.1, 4.05], [26.5, 3.7]].forEach(([u, w]) =>
            reliefPanel(host, 'inscriptions', u, 4.99, 0.251, w * 0.85, 0.53));
        } else {
          [[5.0, 4.9], [10.5, 4.2], [19.5, 4.4], [24.3, 3.7], [35.9, 3.45]].forEach(([u, w]) => {
            shelf(host, u, 0.17, w, 4.52, false);
            reliefPanel(host, 'inscriptions', u, 5.02, 0.251, w * 0.85, 0.50);
          });
          niche(host, 15.0, 2.8, 4.2);
          [2.0, 7.8, 13.0, 17.2, 22.08, 26.6, 33.2, 38.3].forEach(u => pilaster(host, u, 0, 5.93));
        }
        const shelfBays = name === 'north' ? [3.4, 7.78, 12.18, 20.5, 24.85, 33.75, 37.83] : [4.3, 10.2, 19.7, 25.1, 35.8];
        shelfBays.forEach(u => shelf(host, u, 6.43, 3.70, 3.89, true));
        [15.8, 28.8].forEach((u, index) => {
          pilaster(host, u, 6.38, 3.89, 1.0);
          lantern(host, u, 8.0, name === 'north' || index === 0 ? 14 : 0);
        });
      } else {
        [3.3, width - 3.3].forEach(u => {
          shelf(host, u, 0.17, 4.5, 4.46, false);
          shelf(host, u, 6.43, 4.0, 3.87, true);
        });
        if (name === 'east') {
          [7.7, width - 7.7].forEach(u => niche(host, u, 2.9, 4.32));
          [5.97, width - 5.97, 8.65, width - 8.65].forEach(u => pilaster(host, u, 0, 10.42, 0.56));
          [7.1, width - 7.1].forEach(u => {
            shelf(host, u, 6.45, 3.65, 3.9, true);
            reliefPanel(host, 'tablet', u, 5.0, 0.264, 1.92, 0.68);
          });
        }
      }
      // Add a small shadowed return and threshold course at each actual portal.
      openingList.forEach(op => {
        box('thresholds', materials.floor, host, op.u, floorY - 0.045, -0.31,
          op.span, 0.09, 0.74);
      });
    }
  }

  function medallionBorder(draw, material, x, z) {
    const length = 14.21, distance = length / 2, tiles = 10;
    const trim = 0.24;
    const step = (length - trim) / tiles;
    for (const side of [-1, 1]) {
      for (let i = 0; i < tiles; i++) {
        const t = (i + 0.5) * step - distance + trim / 2;
        const slab = reliefPlane(step, trim, 'scroll');
        const stile = reliefPlane(step, trim, 'scroll');
        slab.rotateX(-Math.PI / 2);
        stile.rotateX(-Math.PI / 2);
        draw.surface('floor-mosaic-border', material, slab, null, x + t, floorY + 0.006, z + side * distance);
        draw.surface('floor-mosaic-border', material, stile, null, x + side * distance, floorY + 0.006, z + t, Math.PI / 2);
      }
      for (const corner of [-1, 1]) {
        const tile = reliefPlane(trim, trim, 'tablet').rotateX(-Math.PI / 2);
        draw.surface('floor-mosaic-border', material, tile, null,
          x + corner * distance, floorY + 0.006, z + side * distance);
      }
    }
  }

  function contactShadow() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const fade = ctx.createRadialGradient(32, 32, 6, 32, 32, 32);
    fade.addColorStop(0, 'rgba(29,20,13,0.46)');
    fade.addColorStop(0.65, 'rgba(29,20,13,0.23)');
    fade.addColorStop(1, 'rgba(29,20,13,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, 64, 64);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false });
  }

  // Measure the imported treads before placing the flights. The mesh has
  // rounded nosings and uneven step spacing, so an inclined floor cuts through it.
  function stairProfile(part) {
    const mesh = new THREE.Mesh(part.geometry, part.material);
    const ray = new THREE.Raycaster();
    const samples = new Float32Array(241);
    const hits = [];
    samples.forEach((_, i) => {
      const x = (i / (samples.length - 1) - 0.5) * part.size.x;
      for (const across of [-0.28, 0, 0.28]) {
        ray.ray.origin.set(x, part.size.y * 2, part.size.z * across);
        ray.ray.direction.set(0, -1, 0);
        hits.length = 0;
        ray.intersectObject(mesh, false, hits);
        if (hits.length) samples[i] = Math.max(samples[i], hits[0].point.y / part.size.y);
      }
    });
    // The join at the upper edge has a stone threshold, level with the landing.
    return function (fraction) {
      if (fraction < 0.022) return 1;
      const i = THREE.MathUtils.clamp(fraction, 0, 1) * (samples.length - 1);
      return Math.max(samples[Math.floor(i)], samples[Math.ceil(i)]);
    };
  }

  function libraryStaircase(draw, materials, part, bridge, deck, z, width) {
    const flightCount = 3, run = 4.16, landing = 0.68;
    const rise = (deck - floorY) / flightCount;
    const end = bridge + run * flightCount + landing * (flightCount - 1);
    const profile = stairProfile(part);
    let edge = bridge;
    for (let i = 0; i < flightCount; i++) {
      const base = deck - (i + 1) * rise;
      draw.asset('stairs', part, null, edge + run / 2, base, z, run, rise, width);
      draw.box('stair-thresholds', materials.wall, null, edge + 0.045, deck - i * rise - 0.055,
        z, 0.09, 0.11, width - 0.012, 3.2);
      if (i < flightCount - 1) {
        draw.box('stair-foundations', materials.darkStone, null, edge + run / 2,
          (base + floorY) / 2, z, run, base - floorY, width - 0.018);
        draw.box('stair-landings', materials.wall, null, edge + run + landing / 2,
          (base + floorY) / 2, z, landing, base - floorY, width, 3.2);
      }
      edge += run + landing;
    }
    return {
      contains(x, atZ, margin = 0) {
        return x >= bridge - margin && x <= end + margin && Math.abs(atZ - z) <= width / 2;
      },
      floor(x) {
        const distance = THREE.MathUtils.clamp(x - bridge, 0, end - bridge);
        const flight = Math.min(flightCount - 1, Math.floor(distance / (run + landing)));
        const progress = (distance - flight * (run + landing)) / run;
        const base = deck - (flight + 1) * rise;
        return progress >= 1 ? base : base + rise * profile(progress);
      }
    };
  }

  function galleries(build, materials, parts, room) {
    const { box, asset } = build;
    const { timber, wall } = materials;
    const { length, width } = room;
    const deck = 6.38, aisle = 3.05, bridge = 4.06;
    const stairZ = width - 4.52, stairWidth = 2.12;
    const railY = deck - 0.32;
    function joists(a, b, alongX, at) {
      const columns = Math.ceil((b - a) / 1.45);
      for (let i = 0; i < columns; i++) {
        const u = a + (i + 0.5) * (b - a) / columns;
        box('gallery-joists', timber, null, alongX ? u : at, deck - 0.49,
          alongX ? at : u, alongX ? 0.18 : aisle, 0.23, alongX ? aisle : 0.18);
      }
    }
    function railing(part, a, b, alongX, at, angle) {
      const count = Math.max(1, Math.round((b - a) / 3.0));
      const step = (b - a) / count;
      for (let i = 0; i < count; i++) {
        const u = a + (i + 0.5) * step;
        asset(part === parts.northRail ? 'north-gallery-rail' : 'south-gallery-rail', part,
          null, alongX ? u : at, railY, alongX ? at : u, step, 1.55, 1.75, angle);
      }
      // Finish the cut ends of each modular run with substantial posts.
      for (let i = 0; i <= count; i++) {
        const u = a + i * step;
        box('gallery-posts', timber, null, alongX ? u : at, deck + 0.64,
          alongX ? at : u, 0.21, 1.43, 0.21);
      }
    }
    for (const north of [true, false]) {
      const z = north ? aisle / 2 : width - aisle / 2;
      box('gallery-decks', timber, null, length / 2, deck - 0.19, z, length, 0.38, aisle);
      joists(0, length, true, z);
      const edge = north ? aisle - 0.39 : width - aisle + 0.39;
      railing(north ? parts.northRail : parts.southRail, bridge, length - 0.25, true, edge, north ? Math.PI : 0);
      for (const x of [5.1, 10, 18.5, 24.9, 30.0, 38.0]) {
        const supportZ = north ? 0.64 : width - 0.64;
        box('gallery-stone-corbels', wall, null, x, 5.69, supportZ, 0.74, 0.76, 1.23);
        box('gallery-stone-corbels', wall, null, x, 5.95, supportZ, 0.91, 0.29, 1.93);
      }
    }

    const crossSpan = width - 2 * aisle;
    box('gallery-decks', timber, null, bridge / 2, deck - 0.19, width / 2, bridge, 0.38, crossSpan);
    joists(aisle, width - aisle, false, bridge - aisle / 2);
    railing(parts.northRail, aisle, stairZ - stairWidth / 2, false, bridge - 0.31, -Math.PI / 2);
    box('gallery-posts', timber, null, bridge - 0.25, deck + 0.63,
      stairZ + stairWidth / 2, 0.27, 1.48, 0.27);

    const stairs = libraryStaircase(build, materials, parts.stairs, bridge, deck, stairZ, stairWidth);
    return {
      onStairs(x, z, feet) {
        return stairs.contains(x, z, 0.30) && (x >= bridge || feet >= deck - 0.6);
      },
      crossesStairSide(x0, z0, x1, z1) {
        return stairs.contains(x0, z0) !== stairs.contains(x1, z1) &&
          stairs.contains(x0, stairZ) && stairs.contains(x1, stairZ);
      },
      floor(x, z, feet) {
        if (x < 0 || x > length || z < 0 || z > width) return 0;
        if (stairs.contains(x, z)) return stairs.floor(x);
        if (feet >= deck - 0.95 && (x <= bridge || z <= aisle || z >= width - aisle)) return deck;
        return 0;
      }
    };
  }

  function bootSamples(mesh, ankle, toe) {
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
    const ankleIndex = mesh.skeleton.bones.indexOf(ankle);
    const toeIndex = mesh.skeleton.bones.indexOf(toe);
    const bindInverse = mesh.skeleton.boneInverses[ankleIndex];
    const bounds = new THREE.Box3(), point = new THREE.Vector3();
    const vertices = [];
    for (let i = 0; i < position.count; i++) {
      let weight = 0;
      for (let k = 0; k < 4; k++) {
        const joint = skinIndex.getComponent(i, k);
        if (joint === ankleIndex || joint === toeIndex) weight += skinWeight.getComponent(i, k);
      }
      if (weight < 0.5) continue;
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(bindInverse);
      bounds.expandByPoint(point);
      vertices.push({ i, x: point.x, y: point.y, z: point.z });
    }
    // Keep the lowest point and leading edges in each section of the sole.
    // Edge points can already be over a riser while the sole centre is behind it.
    const size = bounds.getSize(point);
    const sections = new Map();
    const columns = 5, rows = 9;
    vertices.forEach(vertex => {
      if (vertex.y > bounds.min.y + 0.085) return;
      const x = Math.min(columns - 1, Math.floor(columns * (vertex.x - bounds.min.x) / Math.max(size.x, 1e-6)));
      const z = Math.min(rows - 1, Math.floor(rows * (vertex.z - bounds.min.z) / Math.max(size.z, 1e-6)));
      const key = x + z * columns;
      if (!sections.has(key)) sections.set(key, [vertex, vertex, vertex, vertex, vertex]);
      const group = sections.get(key);
      if (vertex.y < group[0].y) group[0] = vertex;
      if (vertex.z < group[1].z) group[1] = vertex;
      if (vertex.z > group[2].z) group[2] = vertex;
      if (vertex.x < group[3].x) group[3] = vertex;
      if (vertex.x > group[4].x) group[4] = vertex;
    });
    return Array.from(new Set(Array.from(sections.values()).flat().map(vertex => vertex.i)));
  }

  function stairPose(hero) {
    let mesh;
    hero.traverse(node => { if (node.isSkinnedMesh) mesh = node; });
    if (!mesh) return null;
    const legs = ['Left', 'Right'].map(side => {
      const bones = ['UpLeg', 'Leg', 'Foot', 'ToeBase'].map(name => mesh.skeleton.getBoneByName(side + name));
      if (bones.some(bone => !bone)) return null;
      const [hip, knee, ankle, toe] = bones;
      return { hip, knee, ankle, samples: bootSamples(mesh, ankle, toe),
        rest: bones.slice(0, 3).map(bone => ({ bone, q: bone.quaternion.clone() })) };
    }).filter(Boolean);
    const upper = new THREE.Vector3(), joint = new THREE.Vector3(), lower = new THREE.Vector3();
    const direction = new THREE.Vector3(), bend = new THREE.Vector3(), target = new THREE.Vector3();
    const newJoint = new THREE.Vector3(), sample = new THREE.Vector3();
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    const current = new THREE.Quaternion(), desired = new THREE.Quaternion(), ankleWorld = new THREE.Quaternion();
    const parent = new THREE.Quaternion();
    let applied = false;
    function worldRotation(bone, q) {
      bone.parent.getWorldQuaternion(parent).invert();
      bone.quaternion.copy(parent.multiply(q));
      bone.updateWorldMatrix(false, true);
    }
    function aim(bone, from, to) {
      bone.getWorldQuaternion(current);
      desired.setFromUnitVectors(from.normalize(), to.normalize()).multiply(current);
      worldRotation(bone, desired);
    }
    function restore() {
      if (!applied) return;
      legs.forEach(leg => leg.rest.forEach(({ bone, q }) => bone.quaternion.copy(q)));
      applied = false;
    }
    function liftSole({ hip, knee, ankle, samples }, surface) {
      let lift = 0;
      for (const vertex of samples) {
        mesh.getVertexPosition(vertex, sample).applyMatrix4(mesh.matrixWorld);
        const tread = Math.max(surface(sample.x - 0.018, sample.z), surface(sample.x + 0.018, sample.z));
        lift = Math.max(lift, tread + 0.014 - sample.y);
      }
      if (lift < 0.005) return false;
      hip.getWorldPosition(upper);
      knee.getWorldPosition(joint);
      ankle.getWorldPosition(lower);
      ankle.getWorldQuaternion(ankleWorld);
      const upperLength = upper.distanceTo(joint), lowerLength = joint.distanceTo(lower);
      target.copy(lower);
      target.y += lift;
      direction.subVectors(target, upper);
      const distance = THREE.MathUtils.clamp(direction.length(),
        Math.abs(upperLength - lowerLength) + 0.002, upperLength + lowerLength - 0.002);
      direction.normalize();
      bend.subVectors(joint, upper).addScaledVector(direction, -a.subVectors(joint, upper).dot(direction));
      if (bend.lengthSq() < 1e-7) {
        bend.set(0, 0, 1).applyQuaternion(ankleWorld);
        bend.addScaledVector(direction, -bend.dot(direction));
      }
      bend.normalize();
      const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
      const sideways = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
      newJoint.copy(upper).addScaledVector(direction, along).addScaledVector(bend, sideways);
      target.copy(upper).addScaledVector(direction, distance);
      aim(hip, a.subVectors(joint, upper), b.subVectors(newJoint, upper));
      ankle.getWorldPosition(lower);
      knee.getWorldPosition(joint);
      aim(knee, a.subVectors(lower, joint), b.subVectors(target, joint));
      worldRotation(ankle, ankleWorld);
      return true;
    }
    function ground(surface) {
      if (!legs.length) return;
      hero.updateMatrixWorld(true);
      legs.forEach(leg => {
        leg.rest.forEach(({ bone, q }) => q.copy(bone.quaternion));
        if (liftSole(leg, surface)) {
          // Blended ankle and shin weights can leave a small residual after IK.
          liftSole(leg, surface);
          applied = true;
        }
      });
    }
    return { restore, ground };
  }

  function chartTexture(floor = false) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    const c = canvas.getContext('2d');
    c.translate(512, 512);
    const tau = Math.PI * 2;
    function ring(radius, color, width) {
      c.strokeStyle = color;
      c.lineWidth = width;
      c.beginPath();
      c.arc(0, 0, radius, 0, tau);
      c.stroke();
    }
    function line(a, b, angle) {
      const cos = Math.cos(angle), sin = Math.sin(angle);
      c.beginPath();
      c.moveTo(cos * a, sin * a);
      c.lineTo(cos * b, sin * b);
      c.stroke();
    }
    c.fillStyle = '#bea27f';
    c.fillRect(-512, -512, 1024, 1024);
    ring(458, '#b79870', 58);
    ring(479, '#5e472f', 4);
    ring(442, '#53412e', 5);
    ring(418, floor ? '#445c59' : '#354b52', 38);
    ring(392, '#614937', 5);
    ring(340, '#846548', 2);
    ring(293, '#70533b', 3);
    ring(224, '#70533b', 4);
    ring(153, '#5a4935', 4);
    ring(119, floor ? '#927657' : '#384b53', floor ? 6 : 55);
    ring(88, '#6a5138', 4);
    ring(50, '#805e40', 2);
    for (let i = 0; i < 240; i++) {
      const a = i * tau / 240;
      c.strokeStyle = i % 10 === 0 ? '#75583a' : '#876b4e';
      c.lineWidth = i % 10 === 0 ? 4 : 1.4;
      line(i % 10 === 0 ? 446 : 453, 475, a);
      if (i % 5 === 0) {
        c.strokeStyle = '#b8a27d';
        c.lineWidth = 2;
        line(406, 429, a);
      }
    }
    const signs = [
      'M0 12 Q0 -13 -8 -10 Q-14 -9 -10 -1 M0 12 Q0 -13 8 -10 Q14 -9 10 -1',
      'M-9 -11 Q-4 -2 0 -4 Q5 -2 9 -11 M0 -4 A7 7 0 1 1 -0.1 -4',
      'M-9 -9 Q0 -6 9 -9 M-9 9 Q0 6 9 9 M-4 -7 L-4 7 M4 -7 L4 7',
      'M-9 0 Q-8 -8 7 -8 M9 0 Q8 8 -7 8 M-6 -3 A3 3 0 1 1 -6.1 -3 M6 3 A3 3 0 1 1 5.9 3',
      'M-7 2 A4 4 0 1 1 -3 -2 C-9 -15 4 -14 6 -8 C8 -3 -1 8 6 10 Q10 11 12 7',
      'M-11 -6 Q-8 -9 -7 -4 L-7 7 M-7 -5 Q-2 -11 0 -5 L0 7 M0 -5 Q6 -10 7 -4 L7 4 Q11 -5 13 0 Q15 5 5 11',
      'M-11 8 H11 M-11 3 H-5 C-11 -10 11 -10 5 3 H11',
      'M-12 -6 Q-8 -9 -7 -4 V7 M-7 -5 Q-2 -10 0 -5 V7 M0 -5 Q6 -10 7 -4 V5 Q7 12 14 8 M11 6 L15 8 L12 12',
      'M-8 9 L10 -9 M2 -9 H10 V-1 M-6 -1 L4 9',
      'M-12 -6 Q-8 -8 -7 -3 L-6 6 M-7 -3 Q-3 -11 0 -5 L2 6 C4 14 15 9 10 3 C7 0 3 3 -1 10',
      'M-12 -2 L-6 -7 L0 -2 L6 -7 L12 -2 M-12 6 L-6 1 L0 6 L6 1 L12 6',
      'M-8 -11 Q0 0 -8 11 M8 -11 Q0 0 8 11 M-10 0 H10'
    ];
    for (let i = 0; i < 12; i++) {
      const a = i * tau / 12;
      c.strokeStyle = '#74583e';
      c.lineWidth = 2.4;
      line(155, 390, a);
      c.save();
      c.rotate(a + tau / 24);
      c.translate(362, 0);
      c.rotate(tau / 4);
      c.strokeStyle = '#493727';
      c.lineWidth = 2.1;
      c.stroke(new Path2D(signs[i]));
      c.restore();
    }
    // Engraved star groups use fixed positions so the chart remains unchanged
    // between visits. The dust below has its own independent animation.
    let seed = 2427;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 102; i++) {
      const a = random() * tau, r = 100 + random() * 228;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      c.fillStyle = r < 147 && !floor ? '#cfb48c' : '#614934';
      c.beginPath();
      c.arc(x, y, 1.25 + random() * 1.9, 0, tau);
      c.fill();
      if (i % 4 === 0 && r > 160) {
        c.strokeStyle = '#8d7259';
        c.lineWidth = 1.4;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + 9 - random() * 19, y + 8 - random() * 19);
        c.stroke();
      }
    }
    for (let i = 0; i < 20000; i++) {
      c.fillStyle = i % 2 ? '#291b1031' : '#ead0a53a';
      c.fillRect(random() * 1024 - 512, random() * 1024 - 512, 1 + random() * 3, 1 + random() * 2);
    }
    if (floor) {
      // Blend the re-engraved lines over the body of the original mosaic.
      // Its authored turquoise edge and chip geometry remain exposed.
      const fade = c.createRadialGradient(0, 0, 430, 0, 0, 510);
      fade.addColorStop(0, '#fff');
      fade.addColorStop(1, 'transparent');
      c.globalCompositeOperation = 'destination-in';
      c.fillStyle = fade;
      c.fillRect(-512, -512, 1024, 1024);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }

  function roof(build, group, materials, length, width, height) {
    const { box, surface } = build;
    const { ceiling, ceilingField, wall, darkStone } = materials;
    const z = width / 2;
    const well = { x: length - 4.1, z, w: 4.7, d: 7.1 };
    const x0 = well.x - well.w / 2, x1 = well.x + well.w / 2;
    const z0 = z - well.d / 2, z1 = z + well.d / 2;
    function slab(a, b, c, d) {
      box('ceiling', ceilingField, null, (a + b) / 2, height + 0.15, (c + d) / 2,
        b - a, 0.30, d - c, 5.2);
    }
    slab(0, x0, 0, width);
    slab(x1, length, 0, width);
    slab(x0, x1, 0, z0);
    slab(x0, x1, z1, width);
    for (const side of [-1, 1]) {
      const ex = well.x + side * well.w / 2;
      const ez = z + side * well.d / 2;
      box('skylight-reveals', wall, null, ex, height + 0.71, z, 0.22, 1.46, well.d + 0.2);
      box('skylight-reveals', wall, null, well.x, height + 0.71, ez, well.w, 1.46, 0.22);
      box('skylight-mouldings', ceiling, null, ex, height - 0.07, z, 0.4, 0.24, well.d + 0.42, 1.3);
      box('skylight-mouldings', ceiling, null, well.x, height - 0.07, ez, well.w, 0.24, 0.4, 1.3);
      box('skylight-mullions', darkStone, null, well.x, height + 0.36, z + side * well.d / 6,
        well.w, 0.21, 0.17);
    }
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(well.w, well.d),
      new THREE.MeshBasicMaterial({ color: 0xfffbe9, toneMapped: false }));
    sky.name = 'L1-skylight';
    sky.rotation.x = Math.PI / 2;
    sky.position.set(well.x, height + 1.38, z);
    group.add(sky);

    const chart = chartTexture();
    const cx = length * 0.588, cz = z - 1.7, radius = 6.36;
    const lip = new THREE.RingGeometry(radius - 0.17, radius + 0.38, 96);
    lip.rotateX(Math.PI / 2);
    surface('ceiling-chart-border', ceilingField, lip, null, cx, height - 0.028, cz);
    const disk = new THREE.CircleGeometry(radius, 108);
    disk.rotateX(Math.PI / 2);
    surface('ceiling-zodiac', new THREE.MeshStandardMaterial({
      name: 'L1 incised zodiac', map: chart, bumpMap: chart, bumpScale: 0.032, roughness: 0.86
    }), disk, null, cx, height - 0.055, cz);
    return { well, chartX: cx, chartZ: cz };
  }

  function skylightProjection(source, aim, angle, paneWidth) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#131313';
    ctx.fillRect(0, 0, 128, 128);
    ctx.filter = 'blur(1.2px)';
    ctx.fillStyle = '#fff';
    const projector = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(angle * 2), 1, 0.5, 34);
    projector.position.copy(source);
    projector.lookAt(aim);
    projector.updateMatrixWorld(true);
    for (let i = -1; i <= 1; i++) {
      const z = aim.z + i * paneWidth;
      ctx.beginPath();
      [[-2.65, -0.44], [2.65, -0.44], [2.65, 0.44], [-2.65, 0.44]].forEach(([x, offset], j) => {
        const p = new THREE.Vector3(aim.x + x, 0, z + offset * paneWidth).project(projector);
        const u = (p.x + 1) * 64, v = (1 - p.y) * 64;
        if (j === 0) ctx.moveTo(u, v); else ctx.lineTo(u, v);
      });
      ctx.closePath();
      ctx.fill();
    }
    return new THREE.CanvasTexture(canvas);
  }

  function atmosphere(group, well, height, constrained) {
    const source = new THREE.Vector3(well.x + 0.63, height + 1.61, well.z + 0.36);
    const aim = new THREE.Vector3(well.x - 12.5, 0.04, well.z - 9.1);
    const sun = new THREE.SpotLight(0xffe2b4, 345, 37, 0.48, 0.59, 2);
    sun.name = 'L1-skylight-sun';
    sun.position.copy(source);
    sun.target.position.copy(aim);
    // A projected skylight mask separates the three panes even under the
    // palace renderer's shadow-map-free performance policy.
    sun.map = skylightProjection(source, aim, sun.angle, well.d / 3);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(constrained ? 512 : 1024);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 34;
    sun.shadow.normalBias = 0.028;
    sun.shadow.bias = -0.00013;
    sun.shadow.autoUpdate = false;
    sun.shadow.needsUpdate = true;
    group.add(sun, sun.target);
    const reflected = new THREE.PointLight(0xffdaa8, 19, 17, 2);
    reflected.name = 'L1-skylight-reflection';
    reflected.position.set(well.x - 0.8, height - 0.47, well.z);
    group.add(reflected);
    const bounce = new THREE.PointLight(0xf6cfaa, 9, 14, 2);
    bounce.name = 'L1-floor-bounce';
    bounce.position.set(well.x - 16.7, 2.7, well.z - 1.35);
    group.add(bounce);

    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec2 rayUv;
        void main() {
          rayUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 rayUv;
        void main() {
          float edge = pow(sin(3.141593 * rayUv.x), 1.8);
          float falloff = smoothstep(0.0, 0.12, rayUv.y) * (1.0 - smoothstep(0.38, 1.0, rayUv.y));
          float streaks = 0.69 + 0.19*sin(26.0 * rayUv.x) + 0.10*sin(78.0 * rayUv.x);
          gl_FragColor = vec4(0.83, 0.63, 0.38, edge * falloff * streaks * 0.137);
        }
      `
    });
    const positions = [], uvs = [], indices = [];
    const direction = aim.clone().sub(source);
    for (let i = -1; i <= 1; i++) {
      const start = new THREE.Vector3(well.x - 0.50 + i * 0.12, height + 0.08, well.z + i * well.d / 3);
      const end = start.clone().addScaledVector(direction, 0.87);
      for (const axis of [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0.6, -0.22, -0.43)]) {
        const k = positions.length / 3;
        positions.push(...start.clone().addScaledVector(axis, -1.08).toArray(),
          ...start.clone().addScaledVector(axis, 1.08).toArray(),
          ...end.clone().addScaledVector(axis, -1.91).toArray(),
          ...end.clone().addScaledVector(axis, 1.91).toArray());
        uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
        indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const rays = new THREE.BufferGeometry();
    rays.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    rays.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    rays.setIndex(indices);
    const shafts = new THREE.Mesh(rays, material);
    shafts.name = 'L1-sun-shafts';
    group.add(shafts);

    const n = constrained ? 65 : 133, motes = [];
    let seed = 112;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < n; i++) {
      const t = 0.13 + random() * 0.71;
      motes.push(well.x + direction.x * t + (random() - 0.5) * 3.4,
        height - (height - 0.65) * t, well.z + direction.z * t + (random() - 0.5) * well.d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(motes, 3));
    const dustMaterial = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        uniform float time;
        varying float fade;
        void main() {
          vec3 p = position;
          p.xz += vec2(sin(time*0.44+p.y), cos(time*0.31+p.x)) * 0.16;
          p.y += sin(time*0.23+p.z) * 0.21;
          vec4 view = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * view;
          gl_PointSize = clamp(36.0 / max(1.0, -view.z), 0.7, 2.6);
          fade = 0.18 + 0.23 * abs(sin(p.x * 4.19));
        }
      `,
      fragmentShader: `
        varying float fade;
        void main() {
          float a = 1.0 - smoothstep(0.05, 0.49, length(gl_PointCoord - 0.5));
          gl_FragColor = vec4(0.93, 0.74, 0.52, a * fade);
        }
      `
    });
    const dust = new THREE.Points(geometry, dustMaterial);
    dust.name = 'L1-skylight-dust';
    group.add(dust);
    return { dustMaterial, sun };
  }

  function disposeResources(group) {
    const textures = new Set(), materials = new Set(), geometries = new Set();
    group.traverse(node => {
      if (node.isLight && node.shadow) node.shadow.dispose();
      if (node.isLight && node.map) textures.add(node.map);
      if (node.geometry) geometries.add(node.geometry);
      if (node.material) materials.add(node.material);
    });
    materials.forEach(material => {
      ['map', 'bumpMap', 'normalMap', 'metalnessMap', 'roughnessMap'].forEach(key => {
        if (material[key]) textures.add(material[key]);
      });
      material.dispose();
    });
    geometries.forEach(geometry => geometry.dispose());
    textures.forEach(texture => texture.dispose());
  }

  function setLibraryExposure(root, multiplier = 0.63) {
    const materials = new Set();
    root.traverse(node => {
      if (node.material && node.material.isMeshStandardMaterial) materials.add(node.material);
    });
    // Unshadowed palace fill still reaches L1 through its shared renderer.
    // Balance it in linear space on the library surfaces, including reflections.
    materials.forEach(material => {
      const compile = material.onBeforeCompile;
      const key = material.customProgramCacheKey();
      material.onBeforeCompile = function (shader, renderer) {
        compile.call(this, shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
          'outgoingLight *= ' + multiplier.toFixed(3) + ';\n#include <opaque_fragment>');
      };
      material.customProgramCacheKey = () => key + ':room-exposure:' + multiplier;
    });
  }

  async function build(room, doors, loadModel, constrained) {
    const base = room.bbox, length = base.x1 - base.x0, width = base.z1 - base.z0, height = room.height;
    const loader = new THREE.TextureLoader();
    const requests = await Promise.allSettled([
      loadModel(files.collection), loadModel(files.architecture),
      ...['stone', 'ceiling', 'ornaments'].map(key => loader.loadAsync(encodeURI(files[key])))
    ]);
    const bad = requests.find(request => request.status === 'rejected');
    if (bad) {
      requests.filter(request => request.status === 'fulfilled').forEach(({ value }) => {
        if (value.isTexture) value.dispose();
        else disposeResources(value.scene);
      });
      throw bad.reason;
    }
    const [kitA, kitB, stone, tiles, ornaments] = requests.map(request => request.value);
    const parts = Object.assign(split(kitA, collection), split(kitB, architecture));
    fitParts(parts);
    const materials = materialSet(stone, tiles, ornaments);
    materials.wall.color.multiplyScalar(0.66);
    materials.floor.color.multiplyScalar(0.57);
    materials.carving.color.multiplyScalar(0.68);
    new Set(Object.values(parts).map(part => part.material)).forEach(material => {
      material.color.multiplyScalar(0.70);
      material.envMapIntensity = 0.68;
    });
    const root = new THREE.Group();
    root.name = 'L1-Grand-Library';
    root.position.set(base.x0, 0, base.z0);
    const colliders = [];
    function boxCollider(b) {
      colliders.push({
        minx: base.x0 + b.min.x, maxx: base.x0 + b.max.x,
        miny: b.min.y, maxy: b.max.y,
        minz: base.z0 + b.min.z, maxz: base.z0 + b.max.z,
        _wing: true, _library: true
      });
    }
    const draw = builder(root);
    const { box, asset } = draw;
    const centre = width / 2;
    box('floor', materials.floor, null, length / 2, floorY - 0.10, centre,
      length + 0.018, 0.20, width + 0.018, 2.85);
    walls(draw, root, materials, parts, { boxCollider, width, length, height, doors, x0: base.x0, z0: base.z0 });
    const gallery = galleries(draw, materials, parts, { length, width });
    const { well, chartX, chartZ } = roof(draw, root, materials, length, width, height);

    const medalX = length * 0.54, medalZ = centre - 2.15;
    asset('floor-medallion', parts.medallion, null, medalX, floorY - 0.035,
      medalZ, 13.15, 0.062, 13.15, Math.PI * 0.34);
    medallionBorder(draw, materials.carving, medalX, medalZ);
    const engraved = new THREE.CircleGeometry(5.67, 128);
    engraved.rotateX(-Math.PI / 2);
    draw.surface('medallion-engraving', new THREE.MeshStandardMaterial({
      map: chartTexture(true), transparent: true, depthWrite: false, roughness: 0.82,
      opacity: 0.61, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
    }), engraved, null, medalX, 0.044, medalZ, Math.PI * 0.34);
    // The stele stands just beyond the medallion's rim, leaving the chart
    // unobstructed for the player and the presentation camera.
    const placements = [
      ['stele', 29.48, centre + 0.48, 2.15, 4.05, 1.89, -Math.PI * 0.56],
      ['instrument', 32.17, centre - 5.1, 3.35, 4.12, 3.08, -0.34]
    ];
    const contact = contactShadow();
    placements.forEach(([name, x, z, w, h, d, angle]) => {
      asset(name, parts[name], null, x, floorY, z, w, h, d, angle);
      const shadow = new THREE.PlaneGeometry(w * 1.47, d * 1.45).rotateX(-Math.PI / 2);
      draw.surface('prop-contact-shadows', contact, shadow, null, x, floorY + 0.003, z, angle);
      const half = name === 'stele' ? 0.92 : 1.1;
      boxCollider(new THREE.Box3(new THREE.Vector3(x - half, 0, z - half),
        new THREE.Vector3(x + half, h, z + half)));
    });
    asset('suspended-armillary', parts.armillary, null, chartX, height - 4.44, chartZ,
      3.62, 3.90, 3.58, -0.4);
    const rod = new THREE.CylinderGeometry(0.063, 0.063, 0.57, 12);
    draw.surface('armillary-suspension', materials.brass, rod, null, chartX, height - 0.275, chartZ);
    const plate = new THREE.CylinderGeometry(0.28, 0.30, 0.11, 20);
    draw.surface('armillary-suspension', materials.brass, plate, null, chartX, height - 0.09, chartZ);
    draw.flush();
    const { dustMaterial, sun } = atmosphere(root, well, height, constrained);
    root.traverse(node => {
      if (node.isPointLight || node.isSpotLight) node.userData.physicalFalloff = true;
    });
    setLibraryExposure(root);

    const camera = new THREE.PerspectiveCamera(51, 1280 / 698, 0.12, 150);
    camera.name = 'L1-Presentation-Camera';
    camera.position.set(length * 0.146, 3.45, centre - 5.98);
    camera.lookAt(length - 2, 5.0, centre - 5.63);
    // Attach after lookAt so the camera is aimed in L1-local space.
    root.add(camera);

    let pose;
    const origin = new THREE.Vector3();
    return {
      root, camera, colliders, sun,
      floor(x, z, feet) { return gallery.floor(x - base.x0, z - base.z0, feet); },
      onStairs(x, z, feet) { return gallery.onStairs(x - base.x0, z - base.z0, feet); },
      crossesStairSide(x0, z0, x1, z1) {
        return gallery.crossesStairSide(x0 - base.x0, z0 - base.z0, x1 - base.x0, z1 - base.z0);
      },
      restoreGroundPose() { if (pose) pose.restore(); },
      groundHero(hero) {
        if (pose === undefined) pose = stairPose(hero);
        if (!pose) return;
        root.getWorldPosition(origin);
        const feet = hero.position.y - origin.y;
        pose.ground((x, z) => Math.max(floorY, gallery.floor(x - origin.x, z - origin.z, feet)) + origin.y);
      },
      tick(t) { dustMaterial.uniforms.time.value = t; },
      dispose() {
        if (pose) pose.restore();
        disposeResources(root);
      }
    };
  }

  window.SinGreatLibrary = { build, split, builder, disposeResources, setLibraryExposure };
})();
