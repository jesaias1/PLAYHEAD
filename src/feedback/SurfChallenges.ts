import type { GeneratedTrack, SurfObstaclePhraseKind, Vector3Like } from '../generation/GenerationTypes';

export interface SurfChallengeTarget {
  phraseId: number;
  kind: SurfObstaclePhraseKind;
  ordinal: number;
  total: number;
  center: Vector3Like;
  forward: Vector3Like;
  right: Vector3Like;
  normal: Vector3Like;
  lateral: number;
  radius: number;
  halfWidth: number;
  arc: number;
}

/** Precision targets use final collider station geometry, never music time. */
export function buildSurfChallengeTargets(track: GeneratedTrack): SurfChallengeTarget[] {
  if (track.courseType !== 'SURF') return [];
  const hosts = new Map(track.route.map(node => [node.id, node]));
  const reads = new Map<string, { target: SurfChallengeTarget; low: number; high: number; depth: number }>();
  for (const obstacle of track.obstacles ?? []) {
    const host = hosts.get(obstacle.obstacleSourceNodeId!);
    const station = host?.ribbon?.stations[0];
    if (!station?.tangent || !station.right || obstacle.obstaclePhraseId === undefined || !obstacle.obstacleSurfPhraseKind) continue;
    const usableHalf = station.halfWidth - 0.9;
    const key = `${obstacle.obstaclePhraseId}:${host!.id}`;
    let read = reads.get(key);
    if (!read) {
      read = { low: -usableHalf, high: usableHalf, depth: 0, target: {
        phraseId: obstacle.obstaclePhraseId, kind: obstacle.obstacleSurfPhraseKind,
        ordinal: 0, total: 0, center: { ...station.center }, forward: { ...station.tangent },
        right: { ...station.right }, normal: { ...station.normal }, lateral: 0,
        radius: 0, halfWidth: station.halfWidth, arc: obstacle.arcLength
      } };
      reads.set(key, read);
    }
    if (obstacle.obstacleSafeLane === 'LEFT') read.high = Math.min(read.high, usableHalf - obstacle.dimensions.x);
    else read.low = Math.max(read.low, -usableHalf + obstacle.dimensions.x);
    read.depth = Math.max(read.depth, obstacle.dimensions.z);
  }
  const targets = [...reads.values()].sort((a, b) => a.target.arc - b.target.arc).map(read => {
    const target = read.target;
    target.lateral = (read.low + read.high) * 0.5;
    target.radius = Math.min(1.65, (read.high - read.low) * 0.5 - 0.6);
    // Reward only AFTER the capsule clears the full depth of the solid.
    const clearDistance = read.depth * 0.5 + 1.2;
    target.center.x += target.forward.x * clearDistance;
    target.center.y += target.forward.y * clearDistance;
    target.center.z += target.forward.z * clearDistance;
    return target;
  }).filter(target => target.radius > 0);
  const groups = new Map<number, SurfChallengeTarget[]>();
  for (const target of targets) {
    const group = groups.get(target.phraseId) ?? [];
    group.push(target); groups.set(target.phraseId, group);
  }
  for (const group of groups.values()) group.forEach((target, ordinal) => { target.ordinal = ordinal; target.total = group.length; });
  return targets;
}

export const SURF_CHALLENGE_LABEL: Record<SurfObstaclePhraseKind, string> = {
  SURF_RIB: 'CLEAN LINE', SURF_STAGGER: 'CLEAN SWITCH', SURF_SLALOM: 'SLALOM CLEAR',
  SURF_WEAVE: 'WEAVE CLEAR', SURF_DOUBLE: 'DOUBLE READ', SURF_SWITCHBACK: 'SWITCHBACK CLEAR',
  SURF_KEYHOLE: 'KEYHOLE CLEAR'
};

export interface SurfChallengeSample { position: Vector3Like; velocity: Vector3Like; surfing: boolean }
interface GroupProgress { cleared: number; failed: boolean; awarded: boolean }

/** Presentation-only optional streak. At most 72 small plane tests per tick. */
export class SurfChallengeTracker {
  private targets: SurfChallengeTarget[] = [];
  private groups = new Map<number, GroupProgress>();
  private previous = { x: 0, y: 0, z: 0 };
  private hasPrevious = false;
  private streak = 0;

  public configure(track: GeneratedTrack | null): void {
    this.targets = track ? buildSurfChallengeTargets(track) : [];
    this.groups.clear();
    for (const target of this.targets) this.groups.set(target.phraseId, { cleared: 0, failed: false, awarded: false });
    this.hasPrevious = false; this.streak = 0;
  }
  public suspend(): void { this.hasPrevious = false; }
  public interrupt(): void {
    this.suspend(); this.streak = 0;
    for (const group of this.groups.values()) if (group.cleared > 0 && !group.awarded) group.failed = true;
  }
  public update(dt: number, sample: SurfChallengeSample): { kind: SurfObstaclePhraseKind; streak: number } | null {
    const point = sample.position;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z) ||
        !Number.isFinite(sample.velocity.x) || !Number.isFinite(sample.velocity.y) || !Number.isFinite(sample.velocity.z) || !Number.isFinite(dt) || dt <= 0) {
      this.interrupt(); return null;
    }
    if (!this.hasPrevious) { this.store(point); return null; }
    const dx = point.x - this.previous.x, dy = point.y - this.previous.y, dz = point.z - this.previous.z;
    const speed = Math.hypot(sample.velocity.x, sample.velocity.y, sample.velocity.z);
    if (Math.hypot(dx, dy, dz) > Math.max(4, speed * dt * 2 + 1)) {
      this.interrupt(); this.store(point); return null;
    }
    let event: { kind: SurfObstaclePhraseKind; streak: number } | null = null;
    for (const target of this.targets) {
      const group = this.groups.get(target.phraseId)!;
      if (group.failed || group.awarded || target.ordinal < group.cleared) continue;
      const px = this.previous.x - target.center.x, py = this.previous.y - target.center.y, pz = this.previous.z - target.center.z;
      const before = px * target.forward.x + py * target.forward.y + pz * target.forward.z;
      const after = before + dx * target.forward.x + dy * target.forward.y + dz * target.forward.z;
      if (before >= 0 || after < 0) continue;
      const fraction = -before / (after - before);
      const x = px + dx * fraction, y = py + dy * fraction, z = pz + dz * fraction;
      const lateral = x * target.right.x + y * target.right.y + z * target.right.z;
      const height = x * target.normal.x + y * target.normal.y + z * target.normal.z;
      // An unrelated distant plane crossing (curved/crossing routes) is not a read.
      if (Math.abs(lateral) > target.halfWidth + 4 || Math.abs(height) > 8) continue;
      const forwardSpeed = sample.velocity.x * target.forward.x + sample.velocity.y * target.forward.y + sample.velocity.z * target.forward.z;
      if (target.ordinal !== group.cleared || !sample.surfing || height < -0.8 || height > 1.8 ||
          Math.abs(lateral - target.lateral) > target.radius || forwardSpeed < 2) {
        group.failed = true; this.streak = 0; continue;
      }
      group.cleared++;
      if (group.cleared === target.total) {
        group.awarded = true;
        this.streak = Math.min(8, this.streak + 1);
        event = { kind: target.kind, streak: this.streak };
      }
    }
    this.store(point);
    return event;
  }
  private store(point: Vector3Like): void {
    this.previous.x = point.x; this.previous.y = point.y; this.previous.z = point.z;
    this.hasPrevious = true;
  }
}
