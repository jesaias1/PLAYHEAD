import * as THREE from 'three';
import { RouteNode } from './GenerationTypes';

export interface PlatformFootprint {
  entryHalfWidth: number;
  exitHalfWidth: number;
  halfDepth: number;
  halfHeight: number;
}

/** One authoritative footprint shared by rendering, collision, and clearance. */
export function getPlatformFootprint(node: RouteNode): PlatformFootprint {
  return {
    entryHalfWidth: node.dimensions.x * 0.5,
    exitHalfWidth: (node.exitWidth ?? node.dimensions.x) * 0.5,
    halfDepth: node.dimensions.z * 0.5,
    halfHeight: node.dimensions.y * 0.5
  };
}

export function getPlatformMaxHalfWidth(node: RouteNode): number {
  const shape = getPlatformFootprint(node);
  return Math.max(shape.entryHalfWidth, shape.exitHalfWidth);
}

export function getPlatformHalfWidthAtLocalZ(node: RouteNode, localZ: number): number {
  const shape = getPlatformFootprint(node);
  return interpolatePlatformHalfWidth(
    shape.entryHalfWidth,
    shape.exitHalfWidth,
    shape.halfDepth,
    localZ
  );
}

export function interpolatePlatformHalfWidth(
  entryHalfWidth: number,
  exitHalfWidth: number,
  halfDepth: number,
  localZ: number
): number {
  if (halfDepth <= 0) return entryHalfWidth;
  const clampedZ = Math.max(-halfDepth, Math.min(halfDepth, localZ));
  const t = (clampedZ + halfDepth) / (halfDepth * 2);
  return entryHalfWidth + (exitHalfWidth - entryHalfWidth) * t;
}

export function createPlatformGeometry(node: RouteNode): THREE.BufferGeometry {
  const shape = getPlatformFootprint(node);
  if (Math.abs(shape.exitHalfWidth - shape.entryHalfWidth) < 1e-6) {
    return new THREE.BoxGeometry(node.dimensions.x, node.dimensions.y, node.dimensions.z);
  }

  const geometry = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < positions.count; i++) {
    const localZ = positions.getZ(i);
    const width = localZ > 0 ? shape.exitHalfWidth * 2 : shape.entryHalfWidth * 2;
    positions.setXYZ(
      i,
      positions.getX(i) * width,
      positions.getY(i) * node.dimensions.y,
      localZ * node.dimensions.z
    );
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
