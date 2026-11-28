uniform float now,progress,energy;
uniform vec3 hue;
varying vec2 v;
varying float shear;
varying vec3 viewDirection;
void main() {
  float vorticity=noise2(vec2(v.x*41.-now*1.88,v.y*7.8-now*2.1));
  float envelope=pow(max(0.,1.-v.y/(.65+.27*sin(v.x*25.13+shear))),1.56);
  float crest=exp(-abs(v.y-.14-.055*shear)*16.);
  float inner=exp(-abs(v.y-.31+.073*shear)*13.)*vorticity;
  float sheet=atlas(vec2(fract(v.x*3.-now*.08),.5+v.y*.18),uRegionGold).a;
  float veins=.43+.58*vorticity+.23*uHasSheet*sheet;
  float edge=(envelope*.12+crest*.16+inner*.10)*veins;
  float a=edge*(1.-smoothstep(.24,1.,progress))*(.51+.49*abs(viewDirection.z))*energy*uOpacity;
  if(a<.006) discard;
  gl_FragColor=vec4(mix(hue,uPalette,uRecolor)*(1.+crest*.36*uGlow),a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
