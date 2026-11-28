// Sîn VFX — ground decal. PROJECTED: a box volume projected on the real depth buffer
// (any floor shape, no geometry change, never floating). Otherwise a surface-aligned quad.
varying vec4 vClip;
varying vec2 vUv;
varying float vViewZ;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vClip = gl_Position;
  vUv = uv;
  vViewZ = -mv.z;
}
