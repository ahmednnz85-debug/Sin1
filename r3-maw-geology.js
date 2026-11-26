/* The traversable ledge ends at x=20.4. This cave is visual geometry only. */
(function (root) {
  'use strict';
  const DEPTH = -96;
  const LEFT = [
    [18, 12.6, 0.0], [24, 10.8, -6.8], [29, 11.8, 2.1], [36, 10.3, 6.0],
    [45, 16.8, 4.8], [54, 12.9, 8.0], [65, 16.4, 5.8], [75, 12.9, 8.8],
    [87, 16.0, 11.1], [101, 12.7, 13.8], [115, 16.1, 14.1], [140, 12.4, 16.4]
  ];
  const RIGHT = [
    [18, 14.1, 1.3], [24, 14.5, -7.5], [31, 17.1, -0.8], [40, 18.8, 2.5],
    [47, 20.7, 6.0], [56, 19.9, 8.2], [64, 23.0, 11.4], [72, 25.3, 16.0],
    [82, 24.6, 14.4], [88, 20.2, 17.7], [101, 23.5, 19.6], [117, 18.9, 19.8], [140, 15.6, 21.5]
  ];
  const OUTCROPS = [[47, 1.73, 9.8, 6.9, 12.2, 2], [54.7, -22.6, 9.1, 7.5, 6.9, 9],
    [91.3, -6.7, 7.1, 5.3, 18.8, 16]];
  const sin = Math.sin, cos = Math.cos, fract = n => n - Math.floor(n);
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = t => t * t * (3 - 2 * t);
  const hash = (x, y) => fract(sin(x * 127.1 + y * 311.7) * 43758.5453123);

  function noise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const sx = smooth(x - ix), sy = smooth(y - iy);
    return mix(mix(hash(ix, iy), hash(ix + 1, iy), sx), mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), sx), sy);
  }

  function sampleProfile(profile, x) {
    const right = Math.max(1, profile.findIndex(knot => knot[0] >= x));
    const [a, aw, ay] = profile[right - 1], [b, bw, by] = profile[right];
    const t = smooth((x - a) / (b - a));
    return [mix(aw, bw, t), mix(ay, by, t)];
  }

  function grid(T, columns, rows, point) {
    const positions = [], indices = [], uvs = [], colors = [];
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= columns; i++) {
        const [x, y, z, u, v, shade] = point(i / columns, j / rows);
        positions.push(x, y, z);
        uvs.push(u, v);
        colors.push(shade, shade, shade);
        if (i === columns || j === rows) continue;
        const a = j * (columns + 1) + i, b = a + 1, c = a + columns + 1, d = c + 1;
        if ((i + j) % 2) indices.push(a, b, d, a, d, c);
        else indices.push(a, b, c, b, d, c);
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  function create(T, material) {
    const shell = new T.Group();
    shell.name = 'Maw_Canyon_Geology';
    const add = (name, geometry) => {
      const mesh = new T.Mesh(geometry, material);
      mesh.name = name;
      shell.add(mesh);
    };
    for (const [side, profile] of [[1, LEFT], [-1, RIGHT]]) {
      const ridgeline = x => {
        const [edge, grade] = sampleProfile(profile, x);
        return [
          edge + noise(x * 0.66, side * 18) * 1.8 + noise(x * 0.21, 70 + side) * 2.5,
          grade + (noise(x * 0.42, side * 7.9) - 0.5) * 4.4 + (noise(x * 0.92, side * 21) - 0.5) * 1.5
        ];
      };
      add('Maw_Eroded_Fault_Face', grid(T, 150, 45, (s, t) => {
        const x = mix(18, 140, s), [edge, crest] = ridgeline(x);
        const y = mix(crest, DEPTH, t ** 1.31);
        const fracture = noise(x * 1.46 + y * 0.043, side * 2.6);
        const bedding = noise(x * 0.30 + y * 0.016, y * 0.30 + side * 6);
        const recess = (fracture ** 3 * 3.8 + bedding * 1.62) * Math.min(1, t * 18);
        const dip = sin(x * 0.3 + t * 13) * t * 1.9;
        const z = side * (edge + recess + dip - t * 6.2);
        const shade = 0.47 + 0.30 * (1 - fracture ** 2) + bedding * 0.19;
        return [x, y, z, x / 3.45, -y / 5.7, shade];
      }));
      add('Maw_Fractured_Rock_Shelf', grid(T, 150, 18, (s, t) => {
        const x = mix(18, 140, s), [edge, crest] = ridgeline(x);
        const span = t * 65;
        const h = noise(x * 0.22, span * 0.38 + side * 7);
        const fine = noise(x * 0.65, span * 0.63 + side * 9);
        const y = crest + span * 0.16 + (h * 5.3 + fine * 1.65) * Math.min(1, span / 3);
        return [x, y, (edge + span) * side, x / 3.8, (edge + span) / 3.8, 0.70 + h * 0.25];
      }));
    }

    // The nearest promontory carries the broken masonry. Farther out, two
    // stepped buttresses separate the deep channel from the upper bridge.
    for (const [cx, cz, rx, rz, crest, seed] of OUTCROPS) {
      const column = (a, t) => {
        const angle = Math.PI * 2 * a;
        const h = noise(cos(angle) * 3 + seed, sin(angle) * 3);
        const out = noise(cos(angle) * 6.4 + t * 0.76, sin(angle) * 6.4 + seed);
        const radius = (1 + (out - 0.5) * 0.41) * (0.92 + t * 0.44);
        const y = mix(crest + (h - 0.5) * 4.8, DEPTH, t ** 1.27);
        return [cx + cos(angle) * rx * radius, y, cz + sin(angle) * rz * radius, a * 8, -y / 5, 0.56 + out * 0.40];
      };
      add('Maw_Split_Rock_Island', grid(T, 52, 32, column));
      add('Maw_Cratered_Island_Top', grid(T, 52, 7, (a, t) => {
        const [x, y, z] = column(a, 0);
        return [mix(x, cx, t), mix(y, crest + 0.6, t) + sin(t * Math.PI) * noise(x, z) * 0.9, mix(z, cz, t),
          x / 4.2, z / 4.2, 0.76 + noise(x * 0.7, z) * 0.24];
      }));
    }
    // The far rock wall and the upper vault close the space from oblique views.
    // Both participate in the same depth integral as the near cliff surfaces.
    add('Maw_Deep_Cavern_Wall', grid(T, 80, 42, (s, t) => {
      const z = mix(-158, 158, s), y = mix(-116, 117, t);
      const coarse = noise(z * 0.12, y * 0.13), cracks = noise(z * 0.55, y * 0.035);
      return [148 + coarse * 11 + cracks * 5, y, z, z / 5, y / 6, 0.45 + cracks * 0.29];
    }));
    add('Maw_Cavern_Vault', grid(T, 110, 40, (s, t) => {
      const x = mix(18, 159, s), z = mix(-110, 110, t);
      const ridge = noise(x * 0.095, z * 0.15), cracks = noise(x * 0.27, z * 0.42);
      const y = 22 + Math.sqrt(x - 16) * 2.05 + ridge * 12 + cracks * 5 - Math.min(19, Math.abs(z) * 0.25);
      return [x, y, z, x / 4, z / 5, 0.42 + cracks * 0.31];
    }));
    return shell;
  }

  // Surface-limited single scattering. The GPU integrates only as far as
  // the rendered fragment, so cliff faces and ruins naturally stop the fog.
  const scattering = `
    uniform float mawTime;
    float mSquare(float n) { return n*n; }
    float mHash(vec3 p) {
      p=fract(p*0.1031); p+=dot(p,p.yzx+33.33);
      return fract((p.x+p.y)*p.z);
    }
    float mNoise(vec3 p) {
      vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(
        mix(mix(mHash(i),mHash(i+vec3(1,0,0)),f.x),
            mix(mHash(i+vec3(0,1,0)),mHash(i+vec3(1,1,0)),f.x),f.y),
        mix(mix(mHash(i+vec3(0,0,1)),mHash(i+vec3(1,0,1)),f.x),
            mix(mHash(i+vec3(0,1,1)),mHash(i+vec3(1,1,1)),f.x),f.y),f.z);
    }
    float mBeam(vec3 eye, vec3 view, float start, float end,
        vec3 source, vec3 base, float radius) {
      vec3 axis=normalize(base-source), from=eye-source;
      vec3 offset=from-axis*dot(from,axis);
      vec3 direction=view-axis*dot(view,axis);
      float nonparallel=dot(direction,direction);
      float crossing=-dot(offset,direction)/max(0.007,nonparallel);
      float closest=clamp(crossing,start,end);
      vec3 p=eye+view*closest;
      float lengthwise=dot(p-source,axis)/length(base-source);
      float tapered=radius*(0.53+0.80*clamp(lengthwise,0.0,1.0));
      vec3 off=offset+direction*closest;
      float window=smoothstep(-0.08,0.21,lengthwise)*(1.0-smoothstep(0.70,1.05,lengthwise));
      float depth=smoothstep(0.0,tapered*1.6,end-max(start,crossing));
      float haze=0.62+0.38*mNoise(p*vec3(0.091,0.132,0.105));
      return window*depth*exp(-dot(off,off)/(tapered*tapered))*haze;
    }
    vec3 mawScatter(vec3 color, vec3 eye, vec3 surface) {
      vec3 ray=surface-eye;
      float distanceToSurface=length(ray);
      vec3 travel=ray/max(distanceToSurface,0.001);
      float start=eye.x<18.6 ? max(0.0,(18.6-eye.x)/max(travel.x,0.01)) : 0.0;
      float stride=max(0.0,distanceToSurface-start)*0.1;
      float remaining=1.0;
      vec3 light=vec3(0.0);
      for(int i=0;i<10;i++) {
        vec3 p=eye+travel*(start+(float(i)+0.5)*stride);
        float drift=mawTime*0.033;
        float billow=mNoise(p*vec3(0.049,0.116,0.092)+vec3(drift,0.0,-drift*0.43));
        float detail=mNoise(p*vec3(0.137,0.246,0.173)+vec3(drift*1.6,0.0,drift*0.18));
        float bed=-18.0+5.0*sin(p.x*0.094)+2.0*cos(p.z*0.25);
        float low=exp(-mSquare((p.y-bed+3.4*(billow-0.5))/10.9));
        float channel=exp(-mSquare((p.z+8.1+2.7*sin(p.x*0.065))/19.0));
        float shelves=exp(-mSquare((p.y+5.8+4.2*sin(p.x*0.106)+3.6*(detail-0.5))/5.4));
        shelves*=smoothstep(22.0,41.0,p.x)*(1.0-smoothstep(117.0,147.0,p.x));
        float pockets=low*smoothstep(0.22,0.79,billow*0.86+detail*0.14);
        float lips=shelves*smoothstep(0.34,0.77,billow)*0.44;
        float density=0.0055+(0.025+channel*0.029)*(pockets+lips);
        float alpha=1.0-exp(-density*stride);
        vec3 ambient=mix(vec3(0.035,0.069,0.096),vec3(0.074,0.179,0.235),min(1.0,(low+0.72*shelves)*channel));
        light+=remaining*alpha*ambient;
        remaining*=1.0-alpha;
      }
      float key=mBeam(eye,travel,start,distanceToSurface,vec3(27,31,13.5),vec3(48,-30,1.2),2.35);
      float fill=mBeam(eye,travel,start,distanceToSurface,vec3(45,35,-23),vec3(66,-39,-8),3.1);
      float farKey=mBeam(eye,travel,start,distanceToSurface,vec3(81,47,3),vec3(110,-32,1),4.7);
      vec3 shafts=vec3(0.045,0.067,0.086)*key+vec3(0.032,0.058,0.083)*fill+
        vec3(0.019,0.033,0.048)*farKey;
      return color*remaining+light+shafts*(0.62+0.38*remaining);
    }
  `;
  root.SinR3MawGeology = { create, scattering };
})(window);
