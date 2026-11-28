// Sîn VFX — final composite: scene (heat-distorted) + VFX layer (premultiplied) +
// localized bloom of the VFX layer only, then the renderer's tone mapping / sRGB.
uniform sampler2D tScene;
uniform sampler2D tVfx;
uniform sampler2D tBloomA;
uniform sampler2D tBloomB;
uniform sampler2D tDistort;
uniform float uBloom;
uniform float uDistort;
varying vec2 vUv;
void main() {
  vec2 off = texture2D(tDistort, vUv).xy * uDistort;
  vec3 scene = texture2D(tScene, vUv + off).rgb;
  vec4 fx = texture2D(tVfx, vUv + off * 0.35);
  vec3 bloom = texture2D(tBloomA, vUv).rgb * 0.32 + texture2D(tBloomB, vUv).rgb * 0.5;
  gl_FragColor = vec4(scene * (1.0 - clamp(fx.a, 0.0, 1.0)) + fx.rgb + bloom * uBloom, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
