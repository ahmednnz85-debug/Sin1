/* R3-03 approach: the four corridor legs and three landings between the
   First Seal hall and the Mouth of the Abyss.
   Coordinates are Maw-local (x = u - MAW_ENTRY, y above the ledge,
   z = v - MAW_LANE), the frame of SinR3Maw. Props reuse the resident
   R3-01 stair kit (shared geometry and maps) with Maw materials, so the
   dressing adds no download and no texture memory. */
(function (root) {
  'use strict';

  // Corridor legs: axis, transverse half-width (walls), start/end along the
  // axis and floor heights at each end. Matches the tunnels/landings built
  // in r3-sealed-zone.js (bound = 2.32 + 0.68).
  const HALF = 3, OPEN = 2.32;
  const ARCHES = [
    // [x, z, along x?, floor]
    [-20, 16, false, 3.1],   // ramp -> first landing
    [-17, 13, true, 3.1],    // first landing -> jog
    [-12, 13, true, 2.2],    // jog -> second landing
    [-9, 10, false, 2.2],    // second landing -> drop
    [-9, 3, false, 0.9],     // drop -> third landing
    [-6, 0, true, 0.9]       // third landing -> mouth
  ];
  // Focal reliefs on the wall each landing presents to the arriving hero.
  const RELIEFS = [
    ['Relief_Winged_Guardian_And_Attendants', -20, 3.1, 10, [0, 1], 3.9],
    ['Relief_Royal_Procession', -6, 2.2, 13, [-1, 0], 3.9],
    ['Relief_Moon_Phases_And_Cuneiform', -9, 0.9, -3, [0, 1], 3.9]
  ];
  // Wall planes for the dado / cornice registers: [x0, z0, x1, z1, floor0, floor1, inward normal].
  const WALLS = [
    [-23, 16.4, -23, 21.0, 3.1, 3.8, [1, 0]], [-17, 16.4, -17, 21.0, 3.1, 3.8, [-1, 0]],
    [-23, 10, -23, 16.4, 3.1, 3.1, [1, 0]], [-23, 10, -17.6, 10, 3.1, 3.1, [0, 1]],
    [-16.4, 10, -12.6, 10, 3.0, 2.3, [0, 1]], [-16.4, 16, -12.6, 16, 3.0, 2.3, [0, -1]],
    [-12, 16, -6, 16, 2.2, 2.2, [0, -1]], [-6, 10.6, -6, 16, 2.2, 2.2, [-1, 0]],
    [-12, 3.6, -12, 9.4, 1.0, 2.1, [1, 0]], [-6, 3.6, -6, 9.4, 1.0, 2.1, [-1, 0]],
    [-12, -3, -12, 2.4, 0.9, 0.9, [1, 0]], [-12, -3, -6.6, -3, 0.9, 0.9, [0, 1]],
    [-5.4, -3, -0.2, -3, 0.85, 0.05, [0, 1]], [-5.4, 3, -0.2, 3, 0.85, 0.05, [0, -1]]
  ];
  // Fallen masonry, kept to the wall feet and the dead corners of landings.
  const DEBRIS = [
    ['Collapsed_Masonry_Rubble_Cluster', -7.55, 15.25, 0.08, 0.9],
    ['Fractured_Inscribed_Slab_Large', -22.35, 14.6, 1.45, 0.85],
    ['Inscribed_Broken_Column_Drum', -11.35, 1.75, 0.6, 0.85],
    ['Fractured_Inscribed_Slab_Small', -14.9, 15.45, -0.4, 0.95],
    ['Detached_Rough_Stone_Fragment', -11.45, 6.6, 2.1, 0.8],
    ['Detached_Rough_Stone_Fragment', -3.6, 2.5, 0.7, 0.7],
    ['Collapsed_Masonry_Rubble_Cluster', -21.4, 10.65, 0.0, 0.6]
  ];
  const FOOTPRINT = {
    Collapsed_Masonry_Rubble_Cluster: [2.62, 0.77, 1.37], Fractured_Inscribed_Slab_Large: [1.17, 0.88, 1.6],
    Fractured_Inscribed_Slab_Small: [0.68, 0.56, 0.91], Detached_Rough_Stone_Fragment: [0.86, 0.57, 0.71],
    Inscribed_Broken_Column_Drum: [0.93, 1.0, 0.93]
  };
  // Engaged columns in the dead corner of each landing.
  const COLUMNS = [[-22.45, 10.55, 3.1], [-6.55, 15.45, 2.2], [-11.45, -2.45, 0.9]];
  // Cool daylight through vault fissures: [top xyz, floor xyz, radius].
  const SHAFTS = [
    [[-19.4, 11.4, 13.6], [-20.3, 3.1, 12.4], 1.05],
    [[-8.6, 10.5, 12.4], [-9.4, 2.2, 13.6], 0.95],
    [[-9.6, 9.3, 0.6], [-8.8, 0.9, -0.7], 0.9]
  ];
  // Cheap analytic lights evaluated only by the Maw stone shader
  // ([x, y, z, radius], linear colour). Pools under the shafts, a grazing
  // key on each relief and the cold spill of the abyss down the last leg.
  const LIGHTS = [
    [-20.2, 5.6, 12.8, 9.0, 0.405, 0.486, 0.594],
    [-20.0, 4.6, 12.0, 4.6, 0.405, 0.419, 0.446],
    [-19.8, 6.2, 19.0, 7.5, 0.216, 0.257, 0.324],
    [-9.3, 5.2, 13.2, 9.0, 0.378, 0.459, 0.567],
    [-8.2, 3.7, 13.0, 4.6, 0.405, 0.419, 0.446],
    [-9.0, 5.8, 6.6, 7.0, 0.176, 0.23, 0.311],
    [-9.0, 4.0, 0.2, 8.0, 0.324, 0.419, 0.54],
    [-9.0, 2.4, -1.2, 4.4, 0.378, 0.405, 0.446],
    [-1.0, 4.8, 0.0, 10.5, 0.216, 0.405, 0.567]
  ];

  function create({ T, kit, finish, hit, floorAt }) {
    const group = new T.Group();
    group.name = 'MawApproach_Dressing';
    // The R3 root is mirrored; this child is not, so carvings read correctly.
    const dress = new T.Group();
    dress.scale.x = -1;
    group.add(dress);
    const status = { phase: 'idle', props: 0, missing: [] };
    const D = (x, y, z) => new T.Vector3(-x, y, z);
    const yawFor = (dx, dz) => Math.atan2(dx, dz); // asset front +z, dress space (-x)
    const floor = (x, z, fallback) => {
      const h = floorAt(x, z);
      return h == null ? fallback : h;
    };

    // Collision: arch piers, columns and debris stay out of the walk line.
    for (const [x, z, alongX, base] of ARCHES) {
      for (const side of [-1, 1]) {
        if (alongX) hit(x - 0.5, x + 0.5, base - 0.4, base + 6, z + side * OPEN, z + side * (HALF + 0.2));
        else hit(x + side * OPEN, x + side * (HALF + 0.2), base - 0.4, base + 6, z - 0.5, z + 0.5);
      }
    }
    for (const [x, z, base] of COLUMNS) hit(x - 0.62, x + 0.62, base, base + 7.5, z - 0.62, z + 0.62);
    for (const [node, x, z, yaw, s] of DEBRIS) {
      const [sx, , sz] = FOOTPRINT[node].map(n => n * s);
      const hx = (Math.abs(Math.cos(yaw)) * sx + Math.abs(Math.sin(yaw)) * sz) * 0.4;
      const hz = (Math.abs(Math.sin(yaw)) * sx + Math.abs(Math.cos(yaw)) * sz) * 0.4;
      const y = floor(x, z, 0);
      hit(x - hx, x + hx, y, y + 1.2, z - hz, z + hz);
    }

    // Light shafts: open cones, additive, faded at both ends and at grazing.
    const shaftMaterial = new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false,
      uniforms: { tint: { value: new T.Color(0.32, 0.42, 0.55) } },
      vertexShader: `
        varying float vAlong; varying float vFacing;
        void main() {
          vAlong = uv.y;
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          vec3 n = normalize(normalMatrix * normal);
          vFacing = abs(dot(n, normalize(-view.xyz)));
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: `
        uniform vec3 tint; varying float vAlong; varying float vFacing;
        void main() {
          float ends = smoothstep(0.0, 0.25, vAlong) * (1.0 - smoothstep(0.78, 1.0, vAlong));
          gl_FragColor = vec4(tint * ends * pow(vFacing, 2.2) * 0.30, 1.0);
        }`
    });
    for (const [top, bottom, radius] of SHAFTS) {
      const a = D(...top), b = D(...bottom);
      const length = a.distanceTo(b);
      const cone = new T.CylinderGeometry(radius * 0.45, radius, length, 14, 1, true);
      const mesh = new T.Mesh(cone, shaftMaterial);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), a.clone().sub(b).normalize());
      mesh.name = 'MawApproach_Shaft';
      mesh.renderOrder = 24;
      dress.add(mesh);
    }

    function build() {
      const source = kit();
      if (!source) {
        status.phase = 'no-kit';
        return false;
      }
      const materials = new Map();
      const own = material => {
        if (!materials.has(material)) {
          const copy = finish(material.clone(), 0);
          copy.envMap = null;
          copy.side = T.FrontSide;
          materials.set(material, copy);
        }
        return materials.get(material);
      };
      function place(name, position, yaw, scale) {
        const entry = source.nodes[name];
        if (!entry) {
          status.missing.push(name);
          return null;
        }
        const level = parts => {
          const holder = new T.Group();
          for (const part of parts) {
            const mesh = new T.Mesh(part.geometry, own(part.material));
            mesh.matrixAutoUpdate = false;
            mesh.matrix.copy(part.matrix);
            holder.add(mesh);
          }
          return holder;
        };
        let object;
        if (entry.levels.length > 1) {
          object = new T.LOD();
          object.addLevel(level(entry.levels[0]), 0);
          object.addLevel(level(entry.levels[1]), 7.5);
        } else object = level(entry.levels[0]);
        object.name = 'MawApproach_' + name;
        object.position.copy(position);
        object.rotation.y = yaw;
        object.scale.copy(scale);
        dress.add(object);
        status.props++;
        return object;
      }
      for (const [x, z, alongX, base] of ARCHES) {
        const scale = new T.Vector3(OPEN / 1.02, 7.2 / 2.96, 1.0);
        place('Masonry_Archway_Large', D(x, base - 0.3, z), alongX ? Math.PI / 2 : 0, scale);
      }
      for (const [x, z, base] of COLUMNS) {
        place('Fluted_Stone_Column_Tall', D(x, base - 0.02, z), 0, new T.Vector3(1.15, 1.55, 1.15));
      }
      for (const [name, x, y, z, face, width] of RELIEFS) {
        const s = width / 4.21, depth = 0.343 * s;
        const inset = depth / 2 - 0.12;
        place(name, D(x + face[0] * inset, y + 1.25, z + face[1] * inset), yawFor(-face[0], face[1]),
          new T.Vector3(s, s, s));
      }
      for (const [name, x, z, yaw, s] of DEBRIS) {
        const y = floor(x, z, 0) - 0.04;
        place(name, D(x, y, z), yaw, new T.Vector3(s, s, s));
      }
      registers(source.reliefs);
      status.phase = 'ready';
      return true;
    }

    // Dado of cuneiform and a rosette cornice, one draw call each.
    function registers(reliefs) {
      if (!reliefs) return;
      for (const [name, offset, height] of [['band_cuneiform', 0.62, 0.30], ['band_rosettes', 5.25, 0.46]]) {
        const maps = reliefs[name];
        if (!maps) continue;
        const tile = height * (name === 'band_cuneiform' ? 8.0 : 6.0);
        const position = [], uv = [], normal = [], index = [];
        for (const [x0, z0, x1, z1, f0, f1, n] of WALLS) {
          // Reading direction for a viewer facing the wall, in dress space.
          const a = D(x0 + n[0] * 0.015, 0, z0 + n[1] * 0.015), b = D(x1 + n[0] * 0.015, 0, z1 + n[1] * 0.015);
          const nx = -n[0], nz = n[1];
          const right = new T.Vector2(nz, -nx);
          const span = new T.Vector2(b.x - a.x, b.z - a.z);
          const flip = span.dot(right) < 0;
          const length = span.length();
          const base = position.length / 3;
          const u0 = 0, u1 = length / tile;
          const corners = [[a, f0, flip ? u1 : u0], [b, f1, flip ? u0 : u1]];
          for (const [p, f, u] of corners) {
            position.push(p.x, f + offset, p.z, p.x, f + offset + height, p.z);
            uv.push(u, 0, u, 1);
            normal.push(nx, 0, nz, nx, 0, nz);
          }
          // Front faces point into the corridor (lit normal, not its flip).
          if (-span.y * nx + span.x * nz >= 0) index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
          else index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
        const geometry = new T.BufferGeometry();
        geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3));
        geometry.setAttribute('normal', new T.Float32BufferAttribute(normal, 3));
        geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
        geometry.setIndex(index);
        geometry.computeBoundingSphere();
        const band = finish(new T.MeshStandardMaterial({
          map: maps.map, normalMap: maps.normal, roughness: 0.94, metalness: 0, side: T.DoubleSide,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
        }), 0);
        band.normalScale.setScalar(1.4);
        const mesh = new T.Mesh(geometry, band);
        mesh.name = 'MawApproach_' + name;
        dress.add(mesh);
      }
    }

    return {
      group, status, build, lights: LIGHTS,
      update(x, inside) {
        // Only the corridor legs need these; the overlook hides them.
        group.visible = inside && x < 2.5 && x > -34;
      }
    };
  }

  root.SinR3MawApproach = { create, lights: LIGHTS };
})(window);
