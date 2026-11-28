varying vec2 vUv;
varying vec4 vColor;
varying float vTime,vSeed;
void main() {
  vec2 p=vUv*2.-1.;
  float radius=length(p);
  float tip=pow(max(0.,1.-abs(p.x)),1.4);
  float filament=exp(-p.y*p.y*19.)*tip;
  float kernel=exp(-radius*radius*16.)*(.7+.3*exp(-abs(p.y)*14.));
  float sheet=atlas(vec2(vUv.x, .5+p.y*.12),uRegion).a;
  filament*=mix(1.,.55+.70*sheet,uHasSheet*.7);
  float a=mix(filament,kernel,step(vSeed,-.5))*pow(1.-vTime,1.45)*vColor.a;
  if(a<.004) discard;
  vec3 hot=mix(vColor.rgb,vec3(1.,.91,.72),.37*pow(1.-vTime,4.));
  gl_FragColor=vec4(hot*(.68+uGlow*.8),a*uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
