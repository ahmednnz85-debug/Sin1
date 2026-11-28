// Sîn VFX — weapon trail. Atlas streak element along the trail, flow-mapped and
// UV-scrolled noise inside, white-hot edge line, speed-driven intensity, dissolve tail.
uniform sampler2D tEnergy;
uniform sampler2D tNoise;
uniform sampler2D tRamp;
uniform vec4 uRegion;      // main streak element
uniform vec4 uRegion2;     // secondary wisp element
uniform vec3 uTint;
uniform float uRecolor;
uniform float uIntensity;
uniform float uRampRow;
uniform float uTime;
uniform float uFade;       // 1 while emitting, → 0 after release
uniform float uFlow;
uniform float uDissolve;
uniform float uEdge;       // hot edge line strength
uniform float uSoftness;
uniform float uProfile;   // 0: rails across the blade (edge at v=1); 1: rails along the cutting-edge curve (v tip→tip)
varying vec4 vData;
varying float vViewZ;
varying vec3 vWorld;

void main() {
  float u = clamp(vData.x, 0.0, 1.0), v = clamp(vData.y, 0.0, 1.0), spd = vData.z;
  vec2 nuv = vec2(u * 1.6 - uTime * 1.7, v * 0.7);
  vec4 nz = texture2D(tNoise, nuv);
  vec2 flow = (texture2D(tNoise, vec2(u * 0.9 - uTime * 0.6, v * 0.5 + 0.37)).ba - 0.5) * uFlow;
  vec2 st = clamp(vec2(u, mix(mix(0.2, 0.8, v), 0.5 + (v - 0.5) * 0.5, uProfile)) + flow, 0.0, 1.0);
  vec3 a = texture2D(tEnergy, mix(uRegion.xy, uRegion.zw, st)).rgb;
  vec3 b = texture2D(tEnergy, mix(uRegion2.xy, uRegion2.zw, vec2(fract(st.x * 1.3 + 0.2), mix(0.15, 0.85, v)))).rgb;
  vec3 col = recolor(a * 1.6 + b * 0.6, uTint, uRecolor);
  // energy concentrated towards the blade edge, feathered to the inner rail and to the tip
  float acrossA = pow(smoothstep(0.0, 0.92, v), 1.4) * (1.0 - smoothstep(0.97, 1.0, v) * 0.6);
  float acrossB = pow(sin(3.14159 * v), 1.1) * (0.55 + 0.45 * smoothstep(0.15, 0.6, nz.b + v * 0.3));
  float across = mix(acrossA, acrossB, uProfile);
  float along = pow(1.0 - u, 1.2) * smoothstep(0.0, 0.03, u + 0.015);
  float internal = mix(0.6 + 0.8 * nz.r, 0.25 + 1.5 * nz.r * nz.r, uProfile);
  float th = uDissolve * u + uProfile * 0.18 * u;
  float keep = smoothstep(th - 0.08, th + 0.08, nz.g + 0.15);
  vec3 ramp = texture2D(tRamp, vec2(clamp(u * 0.85 + 0.05, 0.01, 0.99), uRampRow)).rgb;
  float edgeA = exp(-pow((1.0 - v) * 7.0, 2.0)) * pow(1.0 - u, 2.2);
  float edgeB = exp(-u * 14.0) * acrossB;                    // the swept cutting edge itself, at the head of the trail
  float edge = mix(edgeA, edgeB, uProfile) * uEdge;
  vec3 c = col * internal * across + ramp * edge * 1.4 + ramp * across * 0.18 * pow(1.0 - u, 2.0);
  float k = along * keep * uFade * spd * uIntensity * uGlow * uOpacity * softFade(vViewZ, uSoftness);
  gl_FragColor = vec4(c * k, 0.0);
}
