// Sîn VFX — shockwave ring / rising wall (local uv: x around, y across or up).
varying vec2 vUv;
varying float vViewZ;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vViewZ = -mv.z;
}
