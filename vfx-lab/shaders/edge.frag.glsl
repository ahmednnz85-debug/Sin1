uniform float now,amount,width,part,engraving;
uniform vec2 limits;
uniform float line[12];
uniform vec3 shade;
uniform sampler2D mask;
varying vec3 weaponPoint,norm,lens;
varying vec2 mappedUv;
void main(){
  float u=(weaponPoint.y-limits.x)/(limits.y-limits.x);
  if(u<0.||u>1.) discard;
  float edge=0.;
  for(int j=0;j<12;j++) edge+=line[j]*max(0.,1.-abs(u*11.-float(j)));
  float coordinate=part<.5?weaponPoint.z:part<1.5?-weaponPoint.x:abs(weaponPoint.x);
  float contour=1.-smoothstep(width*.15,width,edge-coordinate);
  float fades=smoothstep(0.,.06,u)*(1.-smoothstep(.93,1.,u));
  float stamp=engraving*smoothstep(.23,.83,dot(texture2D(mask,mappedUv).rgb,vec3(.23,.65,.12)));
  float fresnel=pow(1.-abs(dot(normalize(lens),normalize(norm))),1.4);
  float grain=noise2(vec2(u*19.-now*4.,coordinate*39.+now*.17));
  float plate=atlas(vec2(fract(u*.65-now*.21),.46),part<.5?uRegion:uRegionGold).a;
  float flow=mix(.52+.47*grain,.44+grain*.28+plate*.42,uHasSheet*.85);
  float a=max(stamp*.72,contour*fades*(.56+fresnel*.44))*amount*flow;
  if(a<.014) discard;
  vec3 hue=mix(shade,uPalette,uRecolor);
  vec3 heat=part<.5?vec3(.64,.85,1.):vec3(1.,.79,.45);
  gl_FragColor=vec4(mix(hue,heat,stamp*.49+fresnel*.24)*(1.18+uGlow*.45),a*.88*uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
