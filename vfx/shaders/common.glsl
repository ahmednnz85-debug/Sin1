// Sîn VFX — shared fragment helpers (prepended to every VFX shader).
// SOFT: composite pipeline. The scene depth is sampled to depth-test and soft-fade
// the effect against the world (no hard intersection lines with floor or bodies).
#include <packing>
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform float uOpacity;   // global opacity multiplier
uniform float uGlow;      // global emissive multiplier

float sceneViewZ(vec2 suv) {
  float d = texture2D(tDepth, suv).r;
  return -perspectiveDepthToViewZ(d, uNear, uFar);
}
// 0 when behind the world, ramps to 1 over `softness` metres in front of it.
float softFade(float fragViewZ, float softness) {
#ifdef SOFT
  vec2 suv = gl_FragCoord.xy / uRes;
  float dz = sceneViewZ(suv) - fragViewZ;
  if (dz < 0.0) return 0.0;
  return clamp(dz / max(softness, 1e-3), 0.0, 1.0);
#else
  return 1.0;
#endif
}
// Luminance-preserving recolour; white-hot cores keep their heat.
vec3 recolor(vec3 c, vec3 tint, float amt) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 t = tint * l * 1.7;
  return mix(c, mix(t, c, smoothstep(0.82, 1.0, l)), amt);
}
