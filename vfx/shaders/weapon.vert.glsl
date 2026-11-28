// Sîn VFX — weapon energy overlay. The weapon's own geometry (merged, read-only copy
// of its positions / normals / uv) redrawn as an additive energy shell that is
// pushed a few millimetres along the surface normal, so it moves and rotates with
// the weapon exactly and never separates from it or cuts through it.
attribute vec4 aMask;     // part weights (part 0..3, see registerWeapon), computed from the geometry
attribute float aSigil;   // 1 on primitives that carry the weapon's own emissive sigil texture
attribute float aEdge;    // 0..1 closeness to the cutting edge / rim curve of the part
uniform float uPush;      // metres along the normal
varying vec4 vMask;
varying float vSigil;
varying float vEdge;
varying vec3 vN;
varying vec3 vV;
varying vec3 vLocal;
varying vec2 vUv;
varying float vViewZ;
void main() {
  vec3 p = position + normal * uPush;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vMask = aMask; vSigil = aSigil; vEdge = aEdge;
  vLocal = position; vUv = uv;
  vViewZ = -mv.z;
}
