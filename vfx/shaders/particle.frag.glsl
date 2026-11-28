// Sîn VFX — particle fragment. MODE 0 additive emissive, 1 premultiplied alpha (dust),
// 2 screen distortion offsets (heat / air).
uniform sampler2D tEnergy;
uniform sampler2D tShapes;
uniform sampler2D tNoise;
uniform sampler2D tRamp;
uniform float uTime;
uniform vec3 uLightDir;    // view-independent key light for dust shading
uniform vec3 uAmbient;
varying vec2 vUv;
varying vec2 vLocal;
varying float vAge;
varying vec4 vCol;
varying vec4 vMisc;
varying vec4 vExtra;
varying vec2 vFade;
varying float vViewZ;

void main() {
  vec4 tex = vMisc.y < 0.5 ? texture2D(tEnergy, vUv) : texture2D(tShapes, vUv);
  float fade = smoothstep(0.0, max(vFade.x, 1e-3), vAge) * (1.0 - smoothstep(1.0 - max(vFade.y, 1e-3), 1.0, vAge));
  // shader dissolve: fbm threshold rises with age, edges burn brighter
  float n = texture2D(tNoise, vLocal * 0.85 + vMisc.w * 7.31 + vec2(0.0, uTime * 0.03)).r;
  float th = vMisc.z * smoothstep(0.25, 1.0, vAge);
  float keep = smoothstep(th - 0.06, th + 0.06, n);
  float burn = vMisc.z > 0.0 ? (1.0 - smoothstep(0.0, 0.12, n - th)) * keep * step(0.01, th) : 0.0;
  float soft = softFade(vViewZ, vExtra.y);
  vec4 ramp = vMisc.x >= 0.0 ? texture2D(tRamp, vec2(clamp(vAge, 0.01, 0.99), vMisc.x)) : vec4(1.0);
#if MODE == 0
  vec3 c = vMisc.y < 0.5 ? recolor(tex.rgb, vCol.rgb, vExtra.z) : tex.rgb * ramp.rgb * vCol.rgb;
  float a = fade * keep * soft * uOpacity * (vMisc.x >= 0.0 && vMisc.y > 0.5 ? ramp.a : 1.0);
  c *= vCol.a * uGlow * a;
  c += c * burn * 1.5;
  gl_FragColor = vec4(c, 0.0);
#elif MODE == 1
  float dens = tex.a * fade * keep * soft * ramp.a * vCol.a * uOpacity;
  // dust is lit: shading from the puff's own relief + key light from above + ambient
  float lit = clamp(dot(normalize(uLightDir), vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5, 0.0, 1.0);
  vec3 c = vCol.rgb * (uAmbient + lit * tex.rgb * 0.85);
  if (dens < 0.003) discard;
  gl_FragColor = vec4(c * dens, dens);
#else
  vec2 flow = texture2D(tNoise, vLocal * 0.6 + vMisc.w * 3.1 + vec2(uTime * 0.25, -uTime * 0.18)).ba - 0.5;
  float m = tex.a * fade * soft * vCol.a;
  gl_FragColor = vec4(flow * m * 0.06, 0.0, 0.0);
#endif
}
