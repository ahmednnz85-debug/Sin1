varying vec2 vUv;
varying vec4 vColor;
varying float vTime,vSeed;
void main(){
  vec2 p=vUv*2.-1.;
  float r=length(p);
  vec2 warp=vec2(noise2(p*3.+vSeed),noise2(p*4.-vSeed));
  float f=noise2(p*3.25+warp*.85+vec2(vSeed,-vTime*.6))*.69+
    noise2(p*7.9-vSeed+warp)*.31;
  float broken=smoothstep(.25,.73,f);
  float shell=pow(clamp((1.-r)*1.55,0.,1.),1.55);
  float fade=smoothstep(0.,.075,vTime)*pow(1.-vTime,1.33)*smoothstep(-.97,-.47,p.y);
  float alpha=broken*shell*fade*vColor.a*uOpacity*.45;
  if(alpha<.005) discard;
  gl_FragColor=vec4(vColor.rgb*(.62+.48*f),alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
