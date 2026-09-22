/**
 * ROUTE SIGNAL PACKETS — the audio signal travelling through the level.
 *
 * A small pool of additive light strips that are emitted on real musical
 * transients and travel forward along the route's platform edges, decaying as
 * they go. This is the cheapest possible way to make the ROUTE itself carry the
 * song: one InstancedMesh, one material, no per-frame mesh creation, and no
 * change to route generation, collision or the batched route geometry.
 *
 * Presentation only. Nothing here is read by physics or gameplay.
 */

import * as THREE from 'three';
import { GeneratedTrack, RouteNode } from '../generation/GenerationTypes';
import { MusicVisualState, resolveChannels } from './MusicVisualController';
import { TrackPalette } from '../audio/TrackPalettes';
import { getPlatformMaxHalfWidth } from '../generation/PlatformShape';

interface PathSample {
  arc: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  halfWidth: number;
}

interface Packet {
  active: boolean;
  path: number;
  arc: number;
  lane: number;
  age: number;
  life: number;
  length: number;
  width: number;
}

/** Distance behind the player where packets are emitted. */
const EMIT_BEHIND = 38.0;
/** Seconds a packet lives before it is recycled. */
const PACKET_LIFE = 1.5;
/** Minimum seconds between emissions, so a dense track never floods. */
const EMIT_COOLDOWN = 0.085;

export class RouteSignalPackets {
  public group: THREE.Group;

  private mesh: THREE.InstancedMesh | null = null;
  private material: THREE.MeshBasicMaterial | null = null;
  private paths: PathSample[][] = [];
  private packets: Packet[] = [];

  private poolSize: number;
  private emitCooldown = 0;
  private previousTransient = 0;

  private dummy = new THREE.Object3D();

  constructor(
    track: GeneratedTrack,
    palette: TrackPalette,
    poolSize = 32
  ) {
    this.group = new THREE.Group();
    this.group.name = 'RouteSignalPackets';
    this.poolSize = Math.max(0, Math.floor(poolSize));

    this.paths = RouteSignalPackets.buildPaths(track);
    if (this.paths.length === 0 || this.poolSize === 0) return;

    this.material = new THREE.MeshBasicMaterial({
      color: palette.primary.clone(),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      this.material,
      this.poolSize
    );
    this.mesh.name = 'RouteSignalPackets';
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    for (let i = 0; i < this.poolSize; i++) {
      this.packets.push({
        active: false,
        path: 0,
        arc: 0,
        lane: 1,
        age: 0,
        life: PACKET_LIFE,
        length: 6,
        width: 1.2
      });
    }

    // Park every instance out of sight until it is emitted.
    this.writeMatrices();
    this.group.add(this.mesh);
  }

  /**
   * Builds arc-length-parameterised edge polylines: the main route (the SAFE
   * line) plus every fork mastery branch, so a player on either line sees the
   * signal travelling along the geometry they are actually on.
   */
  private static buildPaths(track: GeneratedTrack): PathSample[][] {
    const paths: PathSample[][] = [];

    const toSamples = (nodes: RouteNode[]): PathSample[] => {
      const samples: PathSample[] = [];
      for (const node of nodes) {
        if (node.isSurf) continue;
        samples.push({
          arc: node.arcLength,
          x: node.position.x,
          y: node.position.y + node.dimensions.y * 0.5,
          z: node.position.z,
          yaw: node.yaw,
          halfWidth: getPlatformMaxHalfWidth(node)
        });
      }
      samples.sort((a, b) => a.arc - b.arc);
      return samples;
    };

    const main = toSamples(track.route);
    if (main.length >= 2) paths.push(main);

    for (const fork of track.forks ?? []) {
      const branch = toSamples(fork.masteryNodes);
      if (branch.length >= 2) paths.push(branch);
    }

    return paths;
  }

  /** Samples the path at an arc length, returning the edge position. */
  private sampleEdge(
    pathIndex: number,
    arc: number,
    lane: number,
    out: { x: number; y: number; z: number; yaw: number }
  ): boolean {
    const path = this.paths[pathIndex];
    if (!path || path.length < 2) return false;

    if (arc <= path[0].arc) {
      const s = path[0];
      out.x = s.x;
      out.y = s.y;
      out.z = s.z;
      out.yaw = s.yaw;
      return true;
    }
    const last = path[path.length - 1];
    if (arc >= last.arc) return false;

    // Binary search for the segment containing this arc length.
    let lo = 0;
    let hi = path.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (path[mid].arc <= arc) lo = mid;
      else hi = mid;
    }

    const a = path[lo];
    const b = path[hi];
    const span = Math.max(1e-4, b.arc - a.arc);
    const t = Math.max(0, Math.min(1, (arc - a.arc) / span));

    const cx = a.x + (b.x - a.x) * t;
    const cy = a.y + (b.y - a.y) * t;
    const cz = a.z + (b.z - a.z) * t;
    const yaw = a.yaw + (b.yaw - a.yaw) * t;
    const halfWidth = a.halfWidth + (b.halfWidth - a.halfWidth) * t;

    // Offset to the platform edge.
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    out.x = cx + rightX * lane * halfWidth;
    out.y = cy;
    out.z = cz + rightZ * lane * halfWidth;
    out.yaw = yaw;
    return true;
  }

  /**
   * Emits and advances packets. Emission is driven by the real transient
   * channel (onset envelope), never by a timer, so the rhythm is the music's.
   */
  public update(
    state: MusicVisualState,
    playerArc: number,
    dt: number,
    reduceMotion = false
  ): void {
    if (!this.mesh || !this.material) return;

    const ch = resolveChannels(state);
    const transient = ch.transient;

    this.emitCooldown = Math.max(0, this.emitCooldown - dt);

    // Rising transient edge -> emit. Reduced motion lowers the emission rate
    // but never removes the response.
    const rising = transient > 0.28 && transient > this.previousTransient + 0.04;
    const cooldownScale = reduceMotion ? 2.2 : 1.0;
    if (rising && this.emitCooldown <= 0) {
      const burst = transient > 0.72 ? 2 : 1;
      for (let b = 0; b < burst; b++) {
        this.emit(playerArc, ch.slot, b);
      }
      this.emitCooldown = EMIT_COOLDOWN * cooldownScale;
    }
    this.previousTransient = transient;

    // Advance.
    const speed = 26 + ch.bassMass * 34 + ch.sectionEnergy * 10;
    const travel = speed * dt;

    for (const packet of this.packets) {
      if (!packet.active) continue;
      packet.arc += travel;
      packet.age += dt;
      if (packet.age >= packet.life) packet.active = false;
    }

    this.writeMatrices();

    // Colour and glow follow the music.
    const dropGlow = ch.dropPrimary;
    this.material.color
      .copy(state.palette.primary)
      .lerp(state.palette.highlight, Math.min(1, transient * 0.8 + dropGlow * 0.7));
    this.material.opacity = Math.min(
      1.0,
      (0.35 + transient * 0.55 + ch.bassMass * 0.25) * Math.min(1.6, state.reactivityMultiplier)
    );
  }

  private emit(playerArc: number, slot: number, burstIndex: number): void {
    const packet = this.packets.find((p) => !p.active);
    if (!packet) return;

    // Deterministic lane/side selection from the music-driven channel slot.
    const lane = ((slot + burstIndex) % 2 === 0) ? 1 : -1;
    const pathIndex = slot % this.paths.length;

    packet.active = true;
    packet.path = pathIndex;
    packet.arc = playerArc - EMIT_BEHIND + burstIndex * 4.0;
    packet.lane = lane;
    packet.age = 0;
    packet.life = PACKET_LIFE;
    packet.length = 7 + burstIndex * 2.5;
    packet.width = 1.1;
  }

  private writeMatrices(): void {
    if (!this.mesh) return;
    const sample = { x: 0, y: 0, z: 0, yaw: 0 };

    for (let i = 0; i < this.packets.length; i++) {
      const packet = this.packets[i];
      if (!packet.active || !this.sampleEdge(packet.path, packet.arc, packet.lane, sample)) {
        this.dummy.position.set(0, -100000, 0);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }

      // Fade in quickly, out smoothly: fast attack / longer decay.
      const t = packet.age / packet.life;
      const envelope = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
      const scale = Math.max(0.001, envelope);

      this.dummy.position.set(sample.x, sample.y + 0.07, sample.z);
      this.dummy.rotation.set(0, sample.yaw, 0);
      this.dummy.scale.set(
        packet.width * scale,
        0.09 * scale,
        packet.length * scale
      );
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }

  public getActiveCount(): number {
    let n = 0;
    for (const p of this.packets) if (p.active) n++;
    return n;
  }

  public dispose(): void {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
    this.material = null;
    this.packets = [];
    this.paths = [];
    this.group.clear();
  }
}
