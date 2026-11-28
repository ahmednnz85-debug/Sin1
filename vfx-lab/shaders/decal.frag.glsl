uniform float opacity,seed;
varying vec2 vUv;
void main() {
  vec2 p=vUv*2.-1.;
  float r=length(p), angle=atan(p.y,p.x);
  float jitter=noise2(p*9.+seed)*.16+.023*sin(r*65.+seed);
  float rays=abs(sin((angle+jitter)*3.3));
  float cracks=(1.-smoothstep(.012,.065,rays));
  float branches=(1.-smoothstep(.012,.08,abs(sin((angle+jitter)*5.7+r*24.))))*noise2(p*28.+seed)*.52;
  vec4 photo=atlas(vUv,uRegion);
  float edge=(1.-smoothstep(.24,.98,r))*smoothstep(.02,.11,r);
  float depth=max((cracks+branches)*(.74-.28*uHasSheet),photo.a*.77*uHasSheet)*edge;
  vec3 dark=mix(vec3(.016,.019,.025),photo.rgb*.55,uHasSheet);
  float lip=(smoothstep(.035,.084,rays)-smoothstep(.081,.154,rays))*.34;
  float a=depth*opacity*uOpacity;
  if(a<.013) discard;
  gl_FragColor=vec4(dark+vec3(.13,.087,.05)*lip,a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
