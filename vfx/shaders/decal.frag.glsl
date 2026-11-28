// Sîn VFX — cracked-stone decal: stone colour + normal from the atlas, lit by the key
// light, golden glow seeping from the seams, noise dissolve on the way out.
uniform sampler2D tStone;
uniform sampler2D tStoneAux;
uniform sampler2D tNoise;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform mat4 uInvDecal;
uniform mat3 uDecalBasis;  // world axes of the decal (x, up, z)
uniform vec4 uRegion;
uniform vec3 uLightDir;
uniform vec3 uLightCol;
uniform vec3 uAmbient;
uniform vec3 uGlowCol;
uniform float uGlowAmt;
uniform float uAlpha;
uniform float uDissolve;
uniform float uTime;
varying vec4 vClip;
varying vec2 vUv;
varying float vViewZ;
void main() {
  vec2 local;
  float facing = 1.0;
#ifdef PROJECTED
  vec2 suv = gl_FragCoord.xy / uRes;
  float d = texture2D(tDepth, suv).r;
  vec4 ndc = vec4(suv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 vp = uInvProj * ndc; vp /= vp.w;
  vec3 wp = (uCamWorld * vp).xyz;
  vec3 lp = (uInvDecal * vec4(wp, 1.0)).xyz;
  if (any(greaterThan(abs(lp), vec3(0.5)))) discard;
  vec3 sn = normalize(cross(dFdx(wp), dFdy(wp)));
  facing = smoothstep(0.35, 0.75, abs(dot(sn, uDecalBasis[1])));   // no stretching up walls
  local = lp.xz + 0.5;
  facing *= 1.0 - smoothstep(0.3, 0.5, abs(lp.y));
#else
  local = vUv;
#endif
  vec2 uv = mix(uRegion.xy, uRegion.zw, local);
  vec4 st = texture2D(tStone, uv);
  vec4 aux = texture2D(tStoneAux, uv);
  float n = texture2D(tNoise, local * 1.3 + uRegion.xy * 3.0).r;
  float keep = smoothstep(uDissolve - 0.08, uDissolve + 0.08, n * 0.9 + 0.1 * (1.0 - length(local - 0.5) * 2.0));
  float a = st.a * uAlpha * keep * facing;
  if (a < 0.004) discard;
  vec3 tn = aux.rgb * 2.0 - 1.0;
  vec3 N = normalize(uDecalBasis * vec3(tn.x, tn.z, -tn.y));
  float diff = max(dot(N, normalize(uLightDir)), 0.0);
  vec3 c = st.rgb * (uAmbient + uLightCol * diff);
  float flick = 0.75 + 0.25 * texture2D(tNoise, local * 2.0 + vec2(uTime * 0.2, 0.0)).g;
  vec3 glow = uGlowCol * aux.a * uGlowAmt * flick * keep * facing * uGlow;
  gl_FragColor = vec4(c * a + glow, a) * uOpacity;
}
