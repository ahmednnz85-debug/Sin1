uniform float now;
uniform vec3 glow;
varying vec2 v;
varying float a;
void main(){
  float gold=step(.66,glow.r);
  float curl=sin(v.y*39.-now*7.6)*.10*min(v.y*4.,1.);
  float grain=noise2(vec2(v.x*23.+v.y*7.,v.y*36.-now*8.));
  float taper=smoothstep(0.,.19,v.x)*(1.-smoothstep(.78,1.,v.x));
  float core=exp(-abs(v.x-.49-curl)*10.);
  float fray=exp(-abs(v.x-.39+curl*.8)*15.)*noise2(vec2(v.y*41.-now*5.,v.x*8.));
  float sheet=atlas(vec2(fract(v.y*.83-now*.11),.46+curl),gold>.5?uRegionGold:uRegion).a;
  float breakup=mix(.39+.61*grain,.38+.41*grain+.38*sheet,uHasSheet);
  vec3 hue=mix(glow,uPalette,uRecolor);
  vec3 hot=mix(hue*.53,mix(vec3(.76,.89,1.),vec3(1.,.85,.58),gold),core*.72);
  float strength=a*taper*(.15+core*.43+fray*.16)*breakup*uOpacity;
  if(strength<.006) discard;
  gl_FragColor=vec4(hot*(1.08+.44*uGlow),strength);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
