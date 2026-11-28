// Sîn VFX — animated shockwave. KIND 0: ground ring band, eroded by moving noise.
// KIND 1: low rising energy wall using a ground-wave element of the atlas.
// KIND 2: distortion ring (writes screen offsets).
uniform sampler2D tEnergy;
uniform sampler2D tNoise;
uniform sampler2D tRamp;
uniform vec4 uRegion;
uniform vec3 uTint;
uniform float uRecolor;
uniform float uIntensity;
uniform float uAge;        // 0 → 1 over the life of the wave
uniform float uRampRow;
uniform float uTime;
uniform float uSeed;
uniform float uRepeat;
varying vec2 vUv;
varying float vViewZ;
void main() {
  float ang = vUv.x, r = vUv.y;
  vec4 nz = texture2D(tNoise, vec2(ang * 6.0 + uSeed, r * 0.6 - uTime * 0.4));
  float fade = (1.0 - smoothstep(0.35, 1.0, uAge)) * smoothstep(0.0, 0.04, uAge);
#if KIND == 0
  float band = exp(-pow((r - mix(0.85, 0.45, uAge)) * 5.5, 2.0));
  float erode = smoothstep(uAge * 0.8, uAge * 0.8 + 0.25, nz.r);
  vec3 ramp = texture2D(tRamp, vec2(clamp(0.08 + uAge * 0.7 + (1.0 - band) * 0.2, 0.01, 0.99), uRampRow)).rgb;
  vec3 c = recolor(ramp, uTint, uRecolor) * band * erode * (0.6 + nz.g * 0.8);
  gl_FragColor = vec4(c * fade * uIntensity * uGlow * uOpacity * softFade(vViewZ, 0.25), 0.0);
#elif KIND == 1
  float x = fract(ang * uRepeat);
  float seam = sin(3.14159 * x);
  vec2 st = vec2(x, clamp(r + (nz.b - 0.5) * 0.06, 0.0, 1.0));
  vec3 a = texture2D(tEnergy, mix(uRegion.xy, uRegion.zw, st)).rgb;
  float erode = smoothstep(uAge * 0.9, uAge * 0.9 + 0.3, nz.r + (1.0 - r) * 0.3);
  vec3 c = recolor(a, uTint, uRecolor) * seam * erode * (1.0 - smoothstep(0.75, 1.0, r));
  gl_FragColor = vec4(c * fade * uIntensity * uGlow * uOpacity * softFade(vViewZ, 0.3), 0.0);
#else
  float band = exp(-pow((r - 0.7) * 6.0, 2.0)) * fade;
  vec2 dir = vec2(cos(ang * 6.28318), sin(ang * 6.28318));
  gl_FragColor = vec4(dir * band * uIntensity * 0.035 * (0.7 + nz.r * 0.6), 0.0, 0.0);
#endif
}
