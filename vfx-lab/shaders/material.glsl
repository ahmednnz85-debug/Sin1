uniform float uOpacity, uGlow, uRecolor;
uniform vec3 uPalette;
uniform sampler2D uSheet;
uniform vec4 uRegion, uRegionGold;
uniform float uHasSheet;
float seed2(vec2 p) {
  return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);
}
float noise2(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(seed2(i),seed2(i+vec2(1.,0.)),f.x),
             mix(seed2(i+vec2(0.,1.)),seed2(i+vec2(1.,1.)),f.x),f.y);
}
vec4 atlas(vec2 uv, vec4 region) {
  return texture2D(uSheet,region.xy+region.zw*clamp(uv,.008,.992));
}
