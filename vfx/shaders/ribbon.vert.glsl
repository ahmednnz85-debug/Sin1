// Sîn VFX — weapon trail ribbon. Positions are world-space samples of the real
// weapon rails (several tracking points on the blade), written by the CPU each frame.
attribute vec4 aData;   // u along trail (0 head → 1 tail), v across (0 inner → 1 edge), speed factor, sample age (s)
varying vec4 vData;
varying float vViewZ;
varying vec3 vWorld;
void main() {
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vData = aData;
  vViewZ = -mv.z;
  vWorld = position;
}
