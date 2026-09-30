/**
 * EMBEDDED SIGNAL — confines a standard material's emissive to thin inset
 * centre lines on each face, so reactive structure glows from a groove inside
 * dark mass instead of lighting up as a flat coloured slab.
 *
 * The material's emissiveIntensity keeps driving the response exactly as
 * before; only WHERE it appears changes. Presentation only.
 */

import * as THREE from 'three';

export function patchEmbeddedSignal(material: THREE.MeshStandardMaterial, ambient = 0.1): void {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vEmbUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vEmbUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vEmbUv;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  vec2 embD = abs(vEmbUv - 0.5);
  float embLine = 1.0 - smoothstep(0.015, 0.04, min(embD.x, embD.y));
  vec2 embE = min(vEmbUv, 1.0 - vEmbUv);
  float embEdge = 1.0 - smoothstep(0.0, 0.02, min(embE.x, embE.y));
  totalEmissiveRadiance *= ${ambient.toFixed(3)} + embLine * 1.4 + embEdge * 0.25;
}`
      );
  };
  material.customProgramCacheKey = () => `embedded-signal-${ambient.toFixed(3)}`;
  material.needsUpdate = true;
}
