// Sîn VFX — weapon energy overlay fragment. Energy rides the real edges of the part:
// edge closeness (from the mesh) × fresnel rim × flowing energy texture from the
// atlas (the supplied boards are used as texture only, never as a shape).
uniform sampler2D tEnergy;
uniform sampler2D tNoise;
uniform sampler2D tRamp;
uniform sampler2D tSigil;
uniform vec4 uParts;      // glow level of part 0..3
uniform vec4 uRegion;     // flowing energy element of the atlas
uniform float uSigilAmt;
uniform float uRampRow;
uniform float uTime;
uniform float uFlow;      // flow speed along the part
uniform float uEdgeOnly;  // 1: energy only on the edge, 0: whole part surface
uniform float uScale;     // texture scale (1 / metres)
uniform vec3 uTint;
uniform float uRecolor;
varying vec4 vMask;
varying float vSigil;
varying float vEdge;
varying vec3 vN;
varying vec3 vV;
varying vec3 vLocal;
varying vec2 vUv;
varying float vViewZ;
void main() {
#ifdef SOFT
  // the shell sits on the weapon: accept it a few cm behind the weapon's own depth
  vec2 suv = gl_FragCoord.xy / uRes;
  if (sceneViewZ(suv) - vViewZ < -0.035) discard;
#endif
  float part = dot(vMask, uParts);
  float sig = vSigil * uSigilAmt;
  if (part < 0.002 && sig < 0.002) discard;
  vec3 N = normalize(vN);
  float fres = pow(1.0 - abs(dot(N, normalize(vV))), 2.2);
  vec2 q = vLocal.yz * uScale;
  vec2 flow = (texture2D(tNoise, q * 0.35 + vec2(uTime * 0.11, 0.0)).ba - 0.5) * 0.35;
  vec2 st = fract(vec2(q.x * 0.5 - uTime * uFlow, q.y * 0.9 + vLocal.x * uScale * 0.4) + flow);
  vec3 en = texture2D(tEnergy, mix(uRegion.xy, uRegion.zw, st)).rgb;
  float n = texture2D(tNoise, q * 0.6 + vec2(-uTime * uFlow * 0.7, uTime * 0.05)).r;
  float edge = mix(1.0, vEdge, uEdgeOnly);
  float body = edge * (0.25 + fres * 1.3) * (0.55 + n * 0.9);
  vec3 ramp = texture2D(tRamp, vec2(clamp(0.3 + (1.0 - vEdge) * 0.4, 0.01, 0.99), uRampRow)).rgb;
  vec3 c = recolor(ramp * 0.6 + en * 1.3, uTint, uRecolor) * body * part;
  c += ramp * pow(vEdge, 8.0) * part * 0.7;                     // hot line on the cutting edge itself
  c += texture2D(tSigil, vUv).rgb * sig * (0.8 + 0.4 * n);       // the weapon's own engraved sigils
  gl_FragColor = vec4(c * uGlow * uOpacity, 0.0);
}
