// Sîn VFX — GPU particle (instanced quad). Motion is analytic: linear drag + gravity,
// so particles are simulated entirely on the GPU and only written once at birth.
attribute vec4 aP0;    // birth position xyz, birth time
attribute vec4 aV0;    // initial velocity xyz, lifetime
attribute vec4 aPhys;  // gravity, drag, ground height, bounce (<0: stick)
attribute vec4 aSize;  // size start, size end, velocity stretch, size curve exponent
attribute vec4 aRot;   // rotation, spin, fade-in fraction, fade-out fraction
attribute vec4 aUV;    // atlas rect u0 v0 u1 v1
attribute vec4 aCol;   // tint rgb, intensity
attribute vec4 aMisc;  // ramp row (v, <0 none), texture (0 energy 1 shapes), dissolve, seed
attribute vec4 aExtra; // aspect, softness (m), recolour amount, orient mode
attribute vec3 aAxX;   // plane basis (orient 1) / axis (orient 3)
attribute vec3 aAxY;
uniform float uTime;
uniform float uSizeMul;
uniform float uPxScale;   // world size of one pixel at 1 m (2 / (P[1][1] * target height))
uniform float uMinPx;     // smallest on-screen size of a particle, in pixels
varying vec2 vUv;
varying vec2 vLocal;
varying float vAge;
varying vec4 vCol;
varying vec4 vMisc;
varying vec4 vExtra;
varying vec2 vFade;
varying float vViewZ;

void main() {
  float life = aV0.w;
  float t = uTime - aP0.w;
  float age = t / max(life, 1e-4);
  if (life <= 0.0 || age < 0.0 || age >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float k = max(aPhys.y, 1e-3);
  vec3 g = vec3(0.0, -aPhys.x, 0.0);
  float e = exp(-k * t);
  vec3 vel = (aV0.xyz - g / k) * e + g / k;
  vec3 p = aP0.xyz + g / k * t + (aV0.xyz - g / k) * (1.0 - e) / k;
  if (p.y < aPhys.z) {
    if (aPhys.w > 0.0) { p.y = aPhys.z + (aPhys.z - p.y) * aPhys.w; vel.y = abs(vel.y) * aPhys.w; vel.xz *= 0.55; }
    else { p.y = aPhys.z + 0.005; vel = vec3(0.0); }
  }
  float s = mix(aSize.x, aSize.y, pow(age, max(aSize.w, 0.05))) * uSizeMul;
  // tiny sparks keep a minimum on-screen footprint; their energy is spread so they do not get brighter
  float vz = max(0.05, -(viewMatrix * vec4(p, 1.0)).z);
  float sMin = uMinPx * vz * uPxScale;
  float energy = s / max(s, sMin);
  s = max(s, sMin);
  vec2 c = position.xy;                         // -0.5 .. 0.5
  float r = aRot.x + aRot.y * t;
  float cr = cos(r), sr = sin(r);
  vec2 rc = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr);
  float aspect = aExtra.x;
  float orient = aExtra.w;
  vec4 mv;
  if (orient > 0.5 && orient < 1.5) {           // plane: fixed basis (decal-like burst, swing-plane slash)
    vec3 w = p + aAxX * (rc.x * s * aspect) + aAxY * (rc.y * s);
    mv = viewMatrix * vec4(w, 1.0);
  } else if (orient > 1.5 && orient < 2.5) {    // velocity stretched spark (head at p, tail behind)
    mv = viewMatrix * vec4(p, 1.0);
    vec2 d = (viewMatrix * vec4(vel, 0.0)).xy;
    float L = length(d);
    vec2 dir = L > 1e-4 ? d / L : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    float len = s * aspect + L * aSize.z;
    mv.xy += dir * ((c.x - 0.42) * len) + nrm * (c.y * s);
  } else if (orient > 2.5) {                    // axial billboard: rises along aAxX, faces the camera
    mv = viewMatrix * vec4(p, 1.0);
    vec3 ax = normalize((viewMatrix * vec4(aAxX, 0.0)).xyz);
    vec3 side = normalize(cross(ax, vec3(0.0, 0.0, 1.0)));
    mv.xyz += side * (c.x * s * aspect) + ax * ((c.y + 0.5) * s);
  } else {                                      // camera-facing billboard
    mv = viewMatrix * vec4(p, 1.0);
    mv.xy += vec2(rc.x * aspect, rc.y) * s;
  }
  gl_Position = projectionMatrix * mv;
  vUv = mix(aUV.xy, aUV.zw, c + 0.5);
  vLocal = c + 0.5;
  vAge = age;
  vCol = vec4(aCol.rgb, aCol.a * mix(1.0, energy, 0.65));
  vMisc = aMisc;
  vExtra = aExtra;
  vFade = aRot.zw;
  vViewZ = -mv.z;
}
