/**
 * FLOW RINGS: an optional, purely cosmetic surf gimmick.
 *
 * Occasionally a long surf ribbon carries a short chain of glowing rings along
 * the natural riding line. Passing through them is satisfying but never
 * necessary: no ring has a collider, touches movement, or affects timing,
 * scoring or the leaderboard. Placement is deterministic from the track, and
 * rings stay clear of obstacles.
 */

import * as THREE from 'three';
import type { GeneratedTrack, Vector3Like } from '../generation/GenerationTypes';

export interface FlowRingChain {
  id: number;
  rings: FlowRingSpec[];
}

export interface FlowRingSpec {
  center: Vector3Like;
  /** Unit direction of travel through the ring. */
  forward: Vector3Like;
}

export const FLOW_RING_RADIUS = 1.5;
/** How far above the surf surface (along its normal) the player rides. */
const RIDE_HEIGHT = 1.1;
const RING_SPACING = 13;
const MAX_RINGS_PER_CHAIN = 7;
const MIN_RINGS_PER_CHAIN = 4;
/** Only every third long ribbon gets a chain, so rings stay a surprise. */
const RIBBON_STRIDE = 3;
const OBSTACLE_CLEARANCE = 4;

interface Sample {
  p: THREE.Vector3;
  t: THREE.Vector3;
  n: THREE.Vector3;
  right: THREE.Vector3;
  halfWidth: number;
  arc: number;
}

const v3 = (v: Vector3Like): THREE.Vector3 => new THREE.Vector3(v.x, v.y, v.z);

export function buildFlowRingChains(track: GeneratedTrack | null): FlowRingChain[] {
  if (!track || track.courseType !== 'SURF') return [];

  // One ordered station list per continuous ribbon.
  const ribbons = new Map<number, Sample[]>();
  let arc = 0;
  for (const node of track.route) {
    const stations = node.ribbon?.stations;
    if (!node.isSurf || !stations || node.ribbonId === undefined) continue;
    const list = ribbons.get(node.ribbonId) ?? [];
    for (const [i, s] of stations.entries()) {
      if (i === 1 && node !== track.route[track.route.length - 1] && list.length > 0) continue;
      if (!s.tangent || !s.right) continue;
      const p = v3(s.center);
      if (list.length > 0) arc = list[list.length - 1].arc + p.distanceTo(list[list.length - 1].p);
      else arc = 0;
      list.push({
        p,
        t: v3(s.tangent).normalize(),
        n: v3(s.normal).normalize(),
        right: v3(s.right).normalize(),
        halfWidth: s.halfWidth,
        arc
      });
    }
    ribbons.set(node.ribbonId, list);
  }

  const obstacles = (track.obstacles ?? []).map(o => ({
    p: v3(o.position),
    r: Math.hypot(o.dimensions.x, o.dimensions.z) * 0.5 + OBSTACLE_CLEARANCE
  }));

  const chains: FlowRingChain[] = [];
  let eligible = 0;
  for (const [ribbonId, list] of [...ribbons.entries()].sort((a, b) => a[0] - b[0])) {
    if (list.length < 2) continue;
    const length = list[list.length - 1].arc;
    if (length < RING_SPACING * (MIN_RINGS_PER_CHAIN + 2)) continue;
    if (eligible++ % RIBBON_STRIDE !== 1) continue;

    const rings: FlowRingSpec[] = [];
    let at = Math.max(RING_SPACING, length * 0.2);
    let seg = 0;
    for (let k = 0; k < MAX_RINGS_PER_CHAIN && at < length - RING_SPACING * 0.5; k++, at += RING_SPACING) {
      while (seg < list.length - 2 && list[seg + 1].arc < at) seg++;
      const a = list[seg];
      const b = list[seg + 1];
      const u = THREE.MathUtils.clamp((at - a.arc) / Math.max(1e-4, b.arc - a.arc), 0, 1);
      const p = a.p.clone().lerp(b.p, u);
      const n = a.n.clone().lerp(b.n, u).normalize();
      const right = a.right.clone().lerp(b.right, u).normalize();
      const half = THREE.MathUtils.lerp(a.halfWidth, b.halfWidth, u);
      // A gentle weave across the deck, so the chain asks for a little carving.
      p.addScaledVector(right, Math.sin(k * 1.1 + ribbonId) * half * 0.22);
      p.addScaledVector(n, RIDE_HEIGHT);
      if (obstacles.some(o => o.p.distanceTo(p) < o.r)) continue;
      const forward = a.t.clone().lerp(b.t, u).normalize();
      rings.push({
        center: { x: p.x, y: p.y, z: p.z },
        forward: { x: forward.x, y: forward.y, z: forward.z }
      });
    }
    if (rings.length >= MIN_RINGS_PER_CHAIN) chains.push({ id: ribbonId, rings });
  }
  return chains;
}

export interface FlowRingHit {
  chainId: number;
  /** Rings hit in this chain so far, this attempt. */
  count: number;
  total: number;
  complete: boolean;
}

/** Distance from `p` to the segment a-b. */
export function distanceToSegment(p: Vector3Like, a: Vector3Like, b: Vector3Like): number {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let u = len2 > 1e-9 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2 : 0;
  u = Math.max(0, Math.min(1, u));
  return Math.hypot(a.x + abx * u - p.x, a.y + aby * u - p.y, a.z + abz * u - p.z);
}

const TUBE = 0.07;

export class FlowRings {
  private readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh | null = null;
  private chains: FlowRingChain[] = [];
  /** Per ring: 0 = waiting, then 1 -> 0 as the hit flash fades. */
  private flash: number[] = [];
  private hit: boolean[] = [];
  private chainOf: number[] = [];
  private flat: FlowRingSpec[] = [];
  private chainCount = new Map<number, number>();
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly base = new THREE.Color(0x00f0ff);
  private lastPos: Vector3Like | null = null;
  private time = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = 'FlowRings';
    this.scene.add(this.group);
  }

  public configure(track: GeneratedTrack | null): void {
    this.clearMesh();
    this.chains = buildFlowRingChains(track);
    this.flat = [];
    this.chainOf = [];
    for (const chain of this.chains) {
      for (const ring of chain.rings) {
        this.flat.push(ring);
        this.chainOf.push(chain.id);
      }
    }
    this.flash = this.flat.map(() => 0);
    this.hit = this.flat.map(() => false);
    this.chainCount.clear();
    this.lastPos = null;
    if (this.flat.length === 0) return;

    const geo = new THREE.TorusGeometry(FLOW_RING_RADIUS, TUBE, 8, 40);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.flat.length);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'FlowRingMesh';
    this.group.add(this.mesh);
    this.refresh();
  }

  /** Re-lights every ring: after a restore or restart. */
  public reset(): void {
    this.flash.fill(0);
    this.hit.fill(false);
    this.chainCount.clear();
    this.lastPos = null;
    this.refresh();
  }

  public setAccent(color: THREE.Color): void {
    this.base.copy(color);
  }

  public get ringCount(): number {
    return this.flat.length;
  }

  /** Advances the flashes and reports at most one ring hit this frame. */
  public update(dt: number, position: Vector3Like, enabled: boolean): FlowRingHit | null {
    this.time += dt;
    this.group.visible = enabled && this.flat.length > 0;
    let result: FlowRingHit | null = null;
    if (enabled && this.lastPos) {
      for (let i = 0; i < this.flat.length && !result; i++) {
        if (this.hit[i]) continue;
        if (distanceToSegment(this.flat[i].center, this.lastPos, position) > FLOW_RING_RADIUS * 0.95) continue;
        this.hit[i] = true;
        this.flash[i] = 1;
        const chainId = this.chainOf[i];
        const count = (this.chainCount.get(chainId) ?? 0) + 1;
        this.chainCount.set(chainId, count);
        const total = this.chains.find(c => c.id === chainId)!.rings.length;
        result = { chainId, count, total, complete: count === total };
      }
    }
    this.lastPos = { x: position.x, y: position.y, z: position.z };
    for (let i = 0; i < this.flash.length; i++) this.flash[i] = Math.max(0, this.flash[i] - dt * 2.2);
    if (this.mesh) this.refresh();
    return result;
  }

  private refresh(): void {
    const mesh = this.mesh;
    if (!mesh) return;
    for (let i = 0; i < this.flat.length; i++) {
      const ring = this.flat[i];
      const f = this.flash[i];
      // A hit ring bursts outward and fades; one still waiting breathes softly.
      const s = this.hit[i] ? 1 + (1 - f) * 0.9 : 1 + Math.sin(this.time * 2.2 + i) * 0.03;
      this.dummy.position.set(ring.center.x, ring.center.y, ring.center.z);
      this.dummy.lookAt(ring.center.x + ring.forward.x, ring.center.y + ring.forward.y, ring.center.z + ring.forward.z);
      this.dummy.scale.setScalar(this.hit[i] && f <= 0 ? 0.0001 : s);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      const bright = this.hit[i] ? f : 0.55;
      this.color.copy(this.base).lerp(new THREE.Color(1, 1, 1), this.hit[i] ? 0.6 : 0.25).multiplyScalar(bright);
      mesh.setColorAt(i, this.color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private clearMesh(): void {
    if (!this.mesh) return;
    this.group.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
    this.mesh = null;
  }

  public dispose(): void {
    this.clearMesh();
    this.scene.remove(this.group);
  }
}
