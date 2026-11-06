/* Sîn's permanent sky lighting, for the existing THREE r147 runtime.
 * The displayed JPG-derived panorama is LDR, not measured HDR radiance.
 * Create a SEPARATE low-resolution linear lighting source, then calibrate it
 * with neutral bounce and a restrained warm moon lobe before PMREM filtering.
 * No dynamic cube capture, new shadows, loaders, or per-frame work.
 */
(function () {
  'use strict';

  function linear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function makeLightingSource(image) {
    const w = 256, h = 128;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Cannot process the permanent sky lighting source');
    context.drawImage(image, 0, 0, w, h);
    const pixels = context.getImageData(0, 0, w, h).data;
    const values = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      for (let c = 0; c < 3; c++) values[i * 3 + c] = linear(pixels[i * 4 + c]);
    }
    // Small wrapped box filter, in LINEAR space; prevents noisy specular pixels.
    // CPU work runs once at startup. The temporary map is not the displayed sky.
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sum = [0, 0, 0];
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.max(0, Math.min(h - 1, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const xx = (x + dx + w) % w, i = (yy * w + xx) * 3;
            for (let c = 0; c < 3; c++) sum[c] += values[i + c];
          }
        }
        const i = ((h - 1 - y) * w + x) * 4;
        for (let c = 0; c < 3; c++) data[i + c] = Math.round(sum[c] * 255 / 9);
        data[i + 3] = 255;
      }
    }
    const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.encoding = THREE.LinearEncoding;
    // Rows above were reversed explicitly: do not rely on typed-array UNPACK_FLIP_Y.
    texture.flipY = false;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  function create(renderer, image, rotation, moonDirection) {
    const source = makeLightingSource(image);
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
      uniforms: { map: { value: source }, rot: { value: rotation }, moonDir: { value: moonDirection.clone() } },
      vertexShader: 'varying vec3 vD;void main(){vD=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: [
        'uniform sampler2D map;uniform float rot;uniform vec3 moonDir;varying vec3 vD;',
        'void main(){',
        ' vec3 d=normalize(vD);',
        ' vec2 uv=vec2(fract(atan(d.z,d.x)*0.1591549431+0.5+rot),0.5+asin(clamp(d.y,-1.0,1.0))*0.3183098862);',
        ' vec3 skyLinear=texture2D(map,uv).rgb;',
        ' float luminance=dot(skyLinear,vec3(0.2126,0.7152,0.0722));',
        // Neutral bounce dominates: warm accents must not paint every material red.
        ' float upper=smoothstep(-0.3,0.5,d.y);',
        ' vec3 bounce=mix(vec3(0.18,0.16,0.15),vec3(0.36,0.38,0.43),upper);',
        ' vec3 radiance=bounce+vec3(luminance)*0.55+skyLinear*0.28;',
        // Authored radiance, not false recovered HDR: unclipped output goes to PMREM.
        ' float m=max(dot(d,normalize(moonDir)),0.0);',
        ' radiance+=vec3(1.0,0.56,0.27)*(pow(m,96.0)*1.8+pow(m,8.0)*0.08);',
        ' gl_FragColor=vec4(radiance,1.0);',
        '}'
      ].join('\n')
    });
    const geometry = new THREE.SphereGeometry(50, 32, 16);
    const probeScene = new THREE.Scene();
    probeScene.add(new THREE.Mesh(geometry, material));
    const pmrem = new THREE.PMREMGenerator(renderer);
    let target;
    try {
      target = pmrem.fromScene(probeScene, 0.035, 0.1, 100);
      target.texture.name = 'SinPermanentSkyEnvironment';
      // Palace unload must never dispose the game's persistent shared lighting.
      target.texture.userData.palaceShared = true;
      target.texture.userData.keep = true;
      target.texture.userData.sinPermanentSky = true;
      return target;
    } finally {
      source.dispose(); geometry.dispose(); material.dispose(); pmrem.dispose();
    }
  }

  window.SinSkyEnvironment = { create: create };
})();
