/**
 * Shared build helpers for environment themes: deterministic randomness and
 * the instanced batch every theme's scenery is baked into.
 *
 * A batch is one geometry, one material, one draw call. Its per-instance
 * attributes are deliberately generic (aParams / aLamp / aSeed) so a theme's
 * shader decides what they mean.
 */

import * as THREE from 'three';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UP = new THREE.Vector3(0, 1, 0);

/** Position + yaw about the world up axis + scale. */
export function composeYaw(pos: THREE.Vector3, yaw: number, scale: THREE.Vector3): THREE.Matrix4 {
  return new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(UP, yaw), scale);
}

export const NO_LAMP = new THREE.Vector4(0, 0, 0, 0);

/** Collects instances for one geometry, then bakes a single InstancedMesh. */
export class InstanceBatch {
  private matrices: THREE.Matrix4[] = [];
  private params: number[] = [];
  private lamps: number[] = [];
  private seeds: number[] = [];
  /** Local-space bounds of the geometry, for world-space corridor checks. */
  public readonly box: THREE.Box3;

  constructor(public readonly name: string, public readonly geometry: THREE.BufferGeometry) {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    this.box = geometry.boundingBox!;
  }

  public get count(): number {
    return this.matrices.length;
  }

  public add(
    matrix: THREE.Matrix4,
    params: [number, number, number, number],
    seed: number,
    lamp: THREE.Vector4 = NO_LAMP
  ): void {
    this.matrices.push(matrix);
    this.params.push(params[0], params[1], params[2], params[3]);
    this.lamps.push(lamp.x, lamp.y, lamp.z, lamp.w);
    this.seeds.push(seed);
  }

  public build(material: THREE.Material): THREE.InstancedMesh | null {
    if (this.matrices.length === 0) return null;
    this.geometry.setAttribute('aParams', new THREE.InstancedBufferAttribute(new Float32Array(this.params), 4));
    this.geometry.setAttribute('aLamp', new THREE.InstancedBufferAttribute(new Float32Array(this.lamps), 4));
    this.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(this.seeds), 1));
    const mesh = new THREE.InstancedMesh(this.geometry, material, this.matrices.length);
    mesh.name = this.name;
    for (let i = 0; i < this.matrices.length; i++) mesh.setMatrixAt(i, this.matrices[i]);
    mesh.instanceMatrix.needsUpdate = true;
    // Instances span the whole course; per-batch culling would only pop.
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

/** One additive billboard batch: lamps, windows, beacons, navigation lights. */
export class GlowBatch {
  private matrices: THREE.Matrix4[] = [];
  private colors: number[] = [];
  private params: number[] = [];
  /** Local bounds of the unit quad, for world-space corridor checks. */
  public readonly box = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, 0), new THREE.Vector3(0.5, 0.5, 0));

  public get count(): number {
    return this.matrices.length;
  }

  public add(matrix: THREE.Matrix4, color: THREE.Color, params: [number, number, number, number]): void {
    this.matrices.push(matrix);
    this.colors.push(color.r, color.g, color.b);
    this.params.push(params[0], params[1], params[2], params[3]);
  }

  public build(name: string, material: THREE.Material): THREE.InstancedMesh | null {
    if (this.matrices.length === 0) return null;
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(this.colors), 3));
    geometry.setAttribute('aGlow', new THREE.InstancedBufferAttribute(new Float32Array(this.params), 4));
    const mesh = new THREE.InstancedMesh(geometry, material, this.matrices.length);
    mesh.name = name;
    for (let i = 0; i < this.matrices.length; i++) mesh.setMatrixAt(i, this.matrices[i]);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 5;
    return mesh;
  }
}
