/* L4 uses the existing palace wall, floor, openings and collision bake. */
(function () {
  'use strict';

  const modelUrl = 'assets/اثاث المرصد.glb';
  const maps = ['assets/سقف المرصد.JPG', 'assets/نقوش الجدارية والارضية.JPG', 'assets/سماء سين.JPG'];
  const stoneUrl = 'assets/حجر المكتبة الكبرى.JPG';
  const islands = {
    1864: 'lamp', 23876: 'armillary', 5775: 'cupboard', 5548: 'suspended-sextant',
    2186: 'display-pedestal', 7858: 'observation-desk', 3706: 'column',
    938: 'scroll', 6660: 'chart-desk', 1298: 'star-dial',
    1234: 'angle-gauge', 2142: 'small-armillary', 1008: 'stool'
  };
  const expected = ['armillary', 'column', 'cupboard', 'observation-desk', 'chart-desk', 'lamp',
    'dome-chart', 'dome-starfield', 'oculus-moulding', 'floor-chart', 'sandstone-paving-finish',
    'wall-relief', 'wall-moon', 'oculus-sky'].map(name => 'L4-' + name);

  // Coordinates measured on proportional previews of the two actual JPEGs.
  const ceilingAtlas = { width: 747, height: 560, chart: [370, 121, 103], stars: [125, 120, 115] };
  const wallAtlas = { width: 1000, height: 500, floor: [89.5, 407.5, 85.7],
    wallStrip: [333, 18, 988, 195], lunarPanel: [329, 207, 459, 371],
    reliefs: [[461, 207, 598, 372], [600, 207, 736, 372], [739, 207, 875, 372], [877, 207, 994, 372]],
    sandstone: [185, 382, 298, 496], royalBand: [312, 389, 559, 442] };

  const tau = 2 * Math.PI, ground = 0.024;
  const treadProfile = [[0.2335, 0.017], [0.2115, 0.0305], [0.1910, 0.0425]];
  const drumRadius = 0.157;
  const point = (angle, radius) => [Math.cos(angle) * radius, Math.sin(angle) * radius];

  function uvPixels(s, x, y) { return [x / s.width, 1 - y / s.height]; }
  function polarUV(s, disk, u, angle) {
    return uvPixels(s, disk[0] + disk[2] * u * Math.cos(angle), disk[1] - disk[2] * u * Math.sin(angle));
  }
  function rectUV(s, r, u, v) { return uvPixels(s, r[0] + (r[2] - r[0]) * u, r[3] - (r[3] - r[1]) * v); }


  // Sweep a meridian or a wall panel. Position and UV use the real angle;
  // normals are welded along the U seam so the dome lights as one surface.
  function sweep(profile, start, end, count, inside, uv) {
    const vertices = [], tex = [], indices = [], stride = count + 1;
    profile.forEach(([radius, y], row) => {
      for (let col = 0; col <= count; col++) {
        const u = col / count, a = start + (end - start) * u;
        const [x, z] = point(a, radius);
        vertices.push(x, y, z);
        tex.push(...uv(row, u, a, radius, y));
        if (row && col) {
          const b = row * stride + col;
          const quad = [b - stride - 1, b - stride, b - 1, b - stride, b, b - 1];
          if (inside) quad.reverse();
          indices.push(...quad);
        }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(tex, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    if (Math.abs(end - start - tau) < 0.00001) {
      const normal = g.attributes.normal, n = new THREE.Vector3(), m = n.clone();
      for (let i = 0; i < profile.length; i++) {
        const a = i * stride, b = a + count;
        n.fromBufferAttribute(normal, a).add(m.fromBufferAttribute(normal, b)).normalize();
        normal.setXYZ(a, n.x, n.y, n.z);
        normal.setXYZ(b, n.x, n.y, n.z);
      }
    }
    return g;
  }

  function bloodSky(radius, height, photo) {
    // Use the game's far-depth, back-face sky projection. This instance is
    // above L4 only and leaves the innermost stone ring physically open.
    const sky = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 22, 0, tau, 0, Math.PI / 2),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false,
        uniforms: { photo: { value: photo } },
        vertexShader: [
          'varying vec3 direction;',
          'void main(){ direction=position; vec4 clip=projectionMatrix*modelViewMatrix*vec4(position,1.0);',
          'clip.z=0.9999*clip.w; gl_Position=clip; }'
        ].join('\n'),
        fragmentShader: [
          'varying vec3 direction; uniform sampler2D photo;',
          'void main(){',
          'vec3 d=normalize(direction), center=normalize(vec3(.54,.83,-.12));',
          'vec3 right=normalize(cross(center,vec3(0,1,0))), up=cross(right,center);',
          'float facing=dot(d,center);',
          'vec2 offset=vec2(dot(d,right),dot(d,up))/max(.21,facing);',
          'vec2 uv=vec2(.592,.48)+offset*vec2(.49,1.356);',
          'vec3 clouds=texture2D(photo,clamp(uv,vec2(.006),vec2(.994))).rgb;',
          'float edge=1.-smoothstep(.46,.69,max(abs(uv.x-.5),abs(uv.y-.5)));',
          'vec3 col=mix(vec3(.058,.019,.023),clouds*.83,edge*smoothstep(.1,.43,facing));',
          'gl_FragColor=vec4(col,1.0);',
          '#include <colorspace_fragment>',
          '}'
        ].join('\n')
      }));
    // The streamer accounts for and disposes mapped textures as well as
    // uploading the shader uniform. Both references point to one texture.
    sky.material.map = photo;
    sky.name = 'L4-oculus-sky';
    sky.position.y = height;
    sky.renderOrder = -10;
    return sky;
  }

  function buildDome(root, radius, height, ceiling, sand, band, photo) {
    const put = (name, material, geo) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = 'L4-' + name;
      root.add(mesh);
    };
    const outer = radius + 0.012, chartR = radius * 0.756, opening = radius * 0.278;
    const stoneUV = (row, u) => rectUV(wallAtlas, wallAtlas.sandstone, (u * 16) % 1, (row % 7) / 6);
    const field = [[outer, height - 0.14], [outer - 0.11, height + 0.07],
      [outer - 0.47, height + 0.18], [chartR + 0.57, height + 0.35]];
    put('dome-starfield', ceiling, sweep(field, 0, tau, 96, false,
      (i, u, a, r) => polarUV(ceilingAtlas, ceilingAtlas.stars, r / outer, a)));
    const stepped = [[chartR + 0.57, height + 0.35], [chartR + 0.49, height + 0.35],
      [chartR + 0.43, height + 0.53], [chartR + 0.31, height + 0.61],
      [chartR + 0.22, height + 0.65], [chartR + 0.20, height + 0.81],
      [chartR + 0.09, height + 0.87], [chartR, height + 0.97]];
    put('dome-stone-steps', sand, sweep(stepped, 0, tau, 96, false, stoneUV));

    const chart = [], n = 19;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      chart.push([chartR + (opening - chartR) * t, height + 0.97 + 3.18 * (1 - Math.pow(1 - t, 1.37))]);
    }
    put('dome-chart', ceiling, sweep(chart, 0, tau, 96, false, (row, u, a) =>
      polarUV(ceilingAtlas, ceilingAtlas.chart, 1 - 0.606 * row / n, a)));
    const top = chart[n][1];
    const lip = [[opening, top], [opening - .09, top + .04], [opening - .17, top + .18],
      [opening - .17, top + .43], [opening - .04, top + .55], [opening + .22, top + .55]];
    put('oculus-moulding', band, sweep(lip, 0, tau, 96, false, (i, u) =>
      rectUV(wallAtlas, wallAtlas.royalBand, u, i / (lip.length - 1))));
    root.add(bloodSky(42, height - 1.1, photo));
  }

  function assemble(room, entrances, parts, textures, sharedStone) {
    const root = new THREE.Group(), { bbox, height, poly } = room;
    const { cx, cz } = bbox, radius = (bbox.x1 - bbox.x0) / 2;
    root.name = 'L4-Babylonian-Observatory';
    root.position.set(cx, 0, cz);
    textures.forEach(t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; });
    const [ceilMap, wallMap, skyMap, ownStone] = textures;
    const stoneMap = sharedStone || ownStone;
    stoneMap.wrapS = stoneMap.wrapT = THREE.RepeatWrapping;
    const stone = (map, color, roughness = .91) => new THREE.MeshStandardMaterial({
      map, color, roughness, side: THREE.FrontSide
    });
    const ceiling = stone(ceilMap, 0xe9d8cb);
    const carving = stone(wallMap, 0xe5c9ad);
    const panel = stone(wallMap, 0xf0decc);
    const floorMat = stone(wallMap, 0xd8c0ad, .81);
    const pavingMat = stone(stoneMap, 0xe4c8ac, .81);
    const lip = stone(wallMap, 0xffbb98, .88);
    const decor = SinGreatLibrary.builder(root, 'L4-');
    const facing = [];
    const solid = [];
    const boxes = [];
    const roomLight = parts.armillary.material;
    roomLight.roughness = .93;
    // The metallic-roughness atlas is retained; slightly lift the exposed sandstone.
    roomLight.metalness = .85;
    roomLight.normalScale.setScalar(.86);

    Object.values(parts).forEach(part => {
      const geometry = part.geometry;
      geometry.computeBoundingBox();
      const b = geometry.boundingBox;
      const p = b.getCenter(new THREE.Vector3());
      part.size = b.getSize(new THREE.Vector3());
      geometry.translate(-p.x, -b.min.y, -p.z);
      geometry.computeBoundingBox();
    });
    function colorInsert(name, mask, tint, glow) {
      // Material variants for the glass portions of the original continuous
      // meshes. The mask uses inspected GLB-local bounds; rings and mounts
      // keep the atlas material and their original normals.
      const m = roomLight.clone();
      m.customProgramCacheKey = () => 'L4-insert-' + name;
      m.onBeforeCompile = s => {
        s.vertexShader = 'varying float l4Glass;\n' + s.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\nl4Glass = ' + mask + ';');
        s.fragmentShader = 'varying float l4Glass;\n' + s.fragmentShader.replace('#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb *= mix(vec3(1.), vec3(' + tint + '), l4Glass);')
          .replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(' + glow + ') * l4Glass;');
      };
      parts[name].material = m;
    }
    colorInsert('armillary', '1.0-smoothstep(.042,.054,length(position-vec3(.010,.230,0.0)))',
      '.34,.68,1.0', '.01,.034,.090');
    colorInsert('lamp', 'smoothstep(.073,.108,position.y)', '1.0,.61,.30', '.38,.125,.026');
    function fit(name, x, z, y, size, yaw, obstacle = false, widthScale = 1) {
      const part = parts[name], scale = size / part.size.y;
      const { x: w, z: d } = part.size;
      const horizontal = scale * widthScale;
      const m = decor.asset(name, part, null, x, y, z, w * horizontal, size, d * horizontal, yaw);
      if (obstacle) {
        const maxX = w * horizontal * .48, maxZ = d * horizontal * .48;
        solid.push({ x, z, y, maxY: y + size, cos: Math.cos(yaw), sin: Math.sin(yaw), maxX, maxZ });
        const b = part.geometry.boundingBox.clone().applyMatrix4(m);
        boxes.push({ minx: cx + b.min.x, maxx: cx + b.max.x, miny: b.min.y, maxy: b.max.y,
          minz: cz + b.min.z, maxz: cz + b.max.z, _wing: true });
      }
      return scale;
    }
    const centralScale = radius * 0.322 / .2358;
    fit('armillary', 0, 0, ground, parts.armillary.size.y * centralScale, .29);
    const shade = Math.PI * .5;
    const allowed = (a, margin) => entrances.every(d => {
      const da = Math.atan2(d.z - cz, d.x - cx);
      return Math.abs(Math.atan2(Math.sin(a-da), Math.cos(a-da))) >
        Math.asin((d.width / 2 + margin) / radius);
    });

    const facetedWall = a => {
      const step = tau / poly.length;
      return radius * Math.cos(step / 2) / Math.cos((a % step + step) % step - step / 2) - .068;
    };
    function wallPanel(name, mat, start, end, bottom, top, region, inset = 0) {
      const g = sweep([[radius, bottom], [radius, top]], start, end, 9, false,
        (row, u) => rectUV(wallAtlas, region, u, row));
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const a = Math.atan2(p.getZ(i), p.getX(i)), r = facetedWall(a) - inset;
        p.setXYZ(i, Math.cos(a) * r, p.getY(i), Math.sin(a) * r);
      }
      g.computeVertexNormals();
      decor.surface(name, mat, g, null, 0, 0, 0);
    }
    function raisedArch(a) {
      const pos = [], uv = [], indices = [];
      const profiles = [[2.09,2.43,.12], [2.08,2.41,.22], [1.91,2.25,.22], [1.87,2.20,.13]];
      for (const [width,rise,inset] of profiles) {
        for (let j=0; j<=24; j++) {
          const b = Math.PI*j/24, t = a + width*Math.cos(b)/radius;
          const [x,z] = point(t, facetedWall(t)-inset);
          pos.push(x, 4.58+rise*Math.sin(b), z);
          uv.push(...rectUV(wallAtlas, wallAtlas.sandstone, j/24, (inset-.09)*3));
        }
      }
      for (let row=0; row<3; row++) for (let j=0; j<24; j++) {
        const i=25*row+j;
        indices.push(i,i+25,i+1,i+1,i+25,i+26);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
      g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
      g.setIndex(indices);
      g.computeVertexNormals();
      decor.surface('raised-lunar-arches', carving, g, null, 0, 0, 0);
    }
    // Relief cladding follows individual bays of the existing stone wall.
    // Do not bridge either of the two openings below its actual lintel.
    for (let i = 0; i < 16; i++) {
      const a = i * tau / 16, half = tau / 32;
      wallPanel('wall-frieze', carving, a-half, a+half, 7.45, height - .03, wallAtlas.wallStrip, .027);
      if (!allowed(a, 1.0)) continue;
      const lunar = i === 3 || i === 13;
      const rect = lunar ? wallAtlas.lunarPanel : wallAtlas.reliefs[i % wallAtlas.reliefs.length];
      wallPanel(lunar ? 'wall-moon' : 'wall-relief', panel, a-half, a+half, .26, 7.55, rect);
      if (lunar) raisedArch(a);
    }
    for (const d of entrances) {
      const dir = Math.sign(d.x-cx);
      const x = d.x-cx-dir*.72, z = d.z-cz;
      const bandBottom = d.height + .012;
      function trim(name, width, y0, y1, z0, rect) {
        const g = new THREE.PlaneGeometry(width, y1-y0);
        const uv = g.attributes.uv;
        for (let i=0;i<uv.count;i++) uv.setXY(i, ...rectUV(wallAtlas, rect, uv.getX(i),uv.getY(i)));
        decor.surface(name, panel, g, null, x, (y0+y1)/2, z0, -dir*Math.PI/2);
      }
      trim('opening-overhead', d.width+2.10, bandBottom, height+.48, z, wallAtlas.wallStrip);
      for (const side of [-1,1]) trim('opening-jamb', 1.02, .023, bandBottom,
        z + side*(d.width/2+.515), [472,273,477,370]);
    }

    const chartRadius = radius * .77;
    const floorGeo = sweep([[chartRadius, ground], [radius * .30, ground]], 0, tau, 96, true,
      (i, u, a, r) => polarUV(wallAtlas, wallAtlas.floor, r / chartRadius, a + shade));
    decor.surface('floor-chart', floorMat, floorGeo, null, 0, 0, 0);
    const paving = new THREE.CircleGeometry(radius - .014, poly.length).rotateX(-Math.PI / 2);
    const coords = paving.attributes.position, pavingUV = paving.attributes.uv;
    for (let i = 0; i < coords.count; i++) pavingUV.setXY(i, coords.getX(i)/5.0, coords.getZ(i)/5.0);
    decor.surface('sandstone-paving-finish', pavingMat, paving, null, 0, .014, 0);

    const columnRadius = radius - 1.16;
    const shaft = height + .69 - ground;
    const shaftWidth = height * .80 / shaft;
    const lampHeight = .66, lampBase = 2.48;
    const lampScale = lampHeight / parts.lamp.size.y;
    // Local -X is the back of the sconce plate; the shaft tapers at
    // this elevation. Seat the plate just into the visible stone face.
    const shaftAtMount = .0335 * shaft * shaftWidth / parts.column.size.y;
    const lampRadius = columnRadius - shaftAtMount - .072 * lampScale + .052;
    for (const a of [27, 63, 117, 153, 207, 243, 297, 333].map(v => v * Math.PI / 180)) {
      if (!allowed(a, 1.7)) continue;
      const [x, z] = point(a, columnRadius);
      fit('column', x, z, ground, shaft, Math.PI-a, true, shaftWidth);
      const [lx, lz] = point(a, lampRadius);
      fit('lamp', lx, lz, lampBase, lampHeight, Math.PI-a);
      facing.push(point(a, lampRadius - .042 * lampScale));
    }
    for (const [deg, name, h] of [[140,'chart-desk',1.64], [220,'observation-desk',1.59],
      [46,'chart-desk',1.53], [316,'observation-desk',1.56]]) {
      const a = deg * Math.PI / 180, [x,z] = point(a,radius - 2.94);
      fit(name, x, z, ground, h, Math.PI-a, true);
    }
    for (const deg of [77, 102, 256, 283]) {
      const a = deg * Math.PI / 180, [x,z] = point(a,radius - 1.58);
      fit('cupboard',x,z,ground,1.66,Math.PI-a,true);
    }
    for (const [deg, tool] of [[57,'star-dial'], [235,'small-armillary'], [123,'angle-gauge'],
      [306,'scroll'], [90,'suspended-sextant']]) {
      const a = deg * Math.PI / 180, [x,z] = point(a,radius - 4.78);
      const support = tool === 'star-dial' || tool === 'suspended-sextant' ? 'display-pedestal' : 'stool';
      const y = support === 'stool' ? .64 : .88;
      fit(support,x,z,ground,y,Math.PI-a,true);
      fit(tool,x,z,ground+y-.022,tool === 'scroll' ? .18 : .63,Math.PI-a);
    }
    decor.flush();
    buildDome(root, radius, height, ceiling, carving, lip, skyMap);

    const moonTarget = new THREE.Object3D();
    moonTarget.position.set(-1.0, 0, 1.3);
    const moon = new THREE.SpotLight(0xff6648, 243, 34, .59, .89, -2);
    moon.name = 'L4-oculus-key';
    moon.position.set(1.1, height + 3.65, -.7);
    moon.target = moonTarget;
    moon.userData.physicalFalloff = true;
    root.add(moon, moonTarget);
    const bounce = new THREE.PointLight(0xff956f, 13, 17, -2);
    bounce.name = 'L4-warm-stone-fill';
    bounce.position.set(-3.3, 7.15, 2);
    bounce.userData.physicalFalloff = true;
    root.add(bounce);
    for (let i = 0; i < facing.length; i += 2) {
      const [x,z] = facing[i];
      const l = new THREE.PointLight(0xffa263, 14, 7.4, -2);
      l.position.set(x, lampBase + .128 * lampScale, z);
      l.userData.physicalFalloff = true;
      root.add(l);
    }
    root.traverse(node => { if (node.isMesh) node.castShadow = false; });
    SinGreatLibrary.setLibraryExposure(root, .81);

    const view = new THREE.PerspectiveCamera(77.5, 1280/698, .1, 120);
    view.name = 'L4-Presentation-Camera';
    view.position.set(-radius*.945, 3.15, radius*.15);
    view.lookAt(0.9, 6.9, -.40);
    root.add(view);
    const floorAt = (x,z) => {
      const r = Math.hypot(x-cx,z-cz);
      for (let i = treadProfile.length-1; i >= 0; i--) {
        if (r <= treadProfile[i][0] * centralScale) return ground + treadProfile[i][1] * centralScale;
      }
      return 0;
    };
    function blocks(x,z,r,feet) {
      x -= cx; z -= cz;
      if (Math.hypot(x,z) < drumRadius * centralScale + r && feet < ground + .079 * centralScale) return true;
      return solid.some(b => {
        if (b.y > feet + 1.65 || b.maxY < feet + .07) return false;
        const dx = x-b.x, dz = z-b.z;
        const qx = Math.max(0, Math.abs(dx*b.cos-dz*b.sin)-b.maxX);
        const qz = Math.max(0, Math.abs(dx*b.sin+dz*b.cos)-b.maxZ);
        return qx*qx+qz*qz < r*r;
      });
    }
    const warmup = SinGreatLibrary.geometryWarmup(root);
    return { root, camera: view, floorAt, blocks, boxes, warmup, sharedStone, dispose(keepStone) {
      warmup.dispose();
      SinGreatLibrary.disposeResources(root, keepStone ? sharedStone : null);
    } };
  }

  async function build(room, entrances, load, signal, getSharedStone) {
    const textures = [];
    let gltf, parts, result;
    try {
      gltf = await load(modelUrl, signal);
      signal.throwIfAborted();
      parts = SinGreatLibrary.split(gltf, islands);
      gltf = null;
      const loader = new THREE.TextureLoader();
      for (const url of maps) {
        signal.throwIfAborted();
        textures.push(await loader.loadAsync(encodeURI(url)));
      }
      const sharedStone = getSharedStone();
      if (!sharedStone) textures.push(await loader.loadAsync(encodeURI(stoneUrl)));
      signal.throwIfAborted();
      result = assemble(room, entrances, parts, textures, sharedStone);
      return result;
    } catch (error) {
      if (gltf) SinGreatLibrary.disposeResources(gltf.scene);
      if (parts && !result) {
        const group = new THREE.Group();
        Object.values(parts).forEach(p => group.add(new THREE.Mesh(p.geometry, p.material)));
        SinGreatLibrary.disposeResources(group);
      }
      textures.forEach(t => t.dispose());
      throw error;
    }
  }

  window.SinObservatory = { build, expected };
})();
