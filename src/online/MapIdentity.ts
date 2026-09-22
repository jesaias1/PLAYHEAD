/**
 * CANONICAL MAP IDENTITY — the hard prerequisite for competitive online play.
 *
 * A public leaderboard is only meaningful if every player is running the SAME
 * map. This module defines one canonical identity for an official level:
 *
 *   trackId          stable Signal Pack id
 *   mapVersion       route/generator version
 *   mapFingerprint   content hash of the FINAL assembled gameplay map
 *   movementVersion  PLAYHEAD_MOVEMENT_V1 identity
 *   generatorVersion obstacle/spine/fork generator identity
 *
 * Rules enforced here:
 * - The fingerprint is computed from the FINAL track the client actually plays,
 *   after route, ramps, shelves, spines, obstacles and forks are all resolved.
 * - Floats are quantised before hashing (0.1 mm) so a 1-ULP difference between
 *   JS engines cannot change the fingerprint, while any real layout difference
 *   does.
 * - `verifyAgainstRegistry` refuses to allow competitive submission when the
 *   locally computed identity does not match the shipped canonical registry.
 *
 * Nothing here changes generation. It only measures it.
 */

import { GeneratedTrack, RouteNode } from '../generation/GenerationTypes';
import { ROUTE_GENERATION_VERSION } from '../generation/RouteGenerator';
import { PLAYHEAD_MOVEMENT_V1 } from '../player/MovementConfig';
import { murmurHash3, seedToHex } from '../utils/hash';

/** Bumped when the fingerprint algorithm itself changes. */
export const MAP_FINGERPRINT_ALGORITHM = 1;

/**
 * Movement identity. Derived from the frozen PLAYHEAD_MOVEMENT_V1 values, so a
 * retune automatically invalidates competitive runs without anyone remembering
 * to bump a manual version.
 */
export const MOVEMENT_VERSION: string = (() => {
  const c = PLAYHEAD_MOVEMENT_V1;
  const canonical = [
    `g${c.gravity}`,
    `j${c.jumpVelocity}`,
    `ga${c.groundAcceleration}`,
    `aa${c.airAcceleration}`,
    `gw${c.maxGroundWishSpeed}`,
    `aw${c.maxAirWishSpeed}`,
    `ss${c.supplementalAirSteer}`,
    `f${c.friction}`,
    `st${c.stopSpeed}`,
    `cy${c.coyoteTime}`,
    `jb${c.jumpBufferTime}`,
    `ph${c.playerHeight}`,
    `pr${c.playerRadius}`,
    `eh${c.eyeHeight}`,
    `su${c.speedUnitScale}`
  ].join('|');
  return `phmv1_${seedToHex(murmurHash3(canonical, 0x504c4d56))}`;
})();

/** Obstacle / spine / fork generator identity. */
export const GENERATOR_VERSION: string = `gen_${ROUTE_GENERATION_VERSION}`;

export interface MapIdentity {
  trackId: string;
  mapVersion: number;
  mapFingerprint: string;
  movementVersion: string;
  generatorVersion: string;
}

/** Quantise a coordinate to 0.1 mm so cross-engine float noise cannot matter. */
function q(value: number): string {
  if (!Number.isFinite(value)) return 'x';
  return value.toFixed(4);
}

function pushNode(parts: string[], node: RouteNode, tag: string): void {
  parts.push(
    [
      tag,
      node.id,
      q(node.position.x),
      q(node.position.y),
      q(node.position.z),
      q(node.dimensions.x),
      q(node.dimensions.y),
      q(node.dimensions.z),
      q(node.yaw),
      q(node.pitch),
      q(node.roll),
      node.type,
      node.isSurf ? 1 : 0,
      node.exitWidth === undefined ? '-' : q(node.exitWidth),
      node.exitLateralOffset === undefined ? '-' : q(node.exitLateralOffset),
      node.forkBranchType ?? '-',
      node.signalSpineVariant ?? '-',
      node.obstacleType ?? '-'
    ].join(',')
  );
}

/**
 * Builds the canonical identity string for a FINAL track. Order is the
 * generation order, which is itself deterministic.
 */
export function buildMapIdentityString(track: GeneratedTrack): string {
  const parts: string[] = [
    `alg:${MAP_FINGERPRINT_ALGORITHM}`,
    `mapVersion:${ROUTE_GENERATION_VERSION}`,
    `movement:${MOVEMENT_VERSION}`,
    `generator:${GENERATOR_VERSION}`,
    `seed:${track.seed >>> 0}`,
    `total:${q(track.totalDistance)}`,
    `target:${q(track.targetDuration)}`,
    `finish:${track.finish?.routeNodeId ?? -1},${track.finish ? q(track.finish.time) : '-'}`,
    `checkpoints:${track.checkpoints?.length ?? 0}`
  ];

  for (const cp of track.checkpoints ?? []) {
    parts.push(`cp:${cp.routeNodeId},${q(cp.time)},${q(cp.position.x)},${q(cp.position.y)},${q(cp.position.z)}`);
  }

  for (const node of track.route) pushNode(parts, node, 'r');
  for (const node of track.optionalRamps ?? []) pushNode(parts, node, 'm');
  for (const node of track.recoveryShelves ?? []) pushNode(parts, node, 's');
  for (const node of track.signalSpines ?? []) pushNode(parts, node, 'n');
  for (const node of track.obstacles ?? []) pushNode(parts, node, 'o');

  for (const fork of track.forks ?? []) {
    parts.push(`f:${fork.id},${fork.type},${fork.entryNodeId},${fork.rejoinNodeId},${q(fork.safeDistance)},${q(fork.masteryDistance)}`);
    for (const node of fork.masteryNodes) pushNode(parts, node, 'b');
  }

  return parts.join('\n');
}

/** Short, stable, human-shareable fingerprint of the canonical map content. */
export function computeMapFingerprint(track: GeneratedTrack): string {
  const canonical = buildMapIdentityString(track);
  // Two independent 32-bit hashes -> a 64-bit-ish fingerprint.
  const h1 = murmurHash3(canonical, 0x50484d31);
  const h2 = murmurHash3(canonical, 0x50484d32);
  const bytes = canonical.length;
  return `mfp_v${MAP_FINGERPRINT_ALGORITHM}_${seedToHex(h1)}${seedToHex(h2)}_${bytes.toString(16)}`;
}

export function computeMapIdentity(trackId: string, track: GeneratedTrack): MapIdentity {
  return {
    trackId,
    mapVersion: ROUTE_GENERATION_VERSION,
    mapFingerprint: computeMapFingerprint(track),
    movementVersion: MOVEMENT_VERSION,
    generatorVersion: GENERATOR_VERSION
  };
}

export interface RegistryEntry {
  trackId: string;
  seed: number;
  mapVersion: number;
  mapFingerprint: string;
  movementVersion: string;
  generatorVersion: string;
}

export type IdentityVerdict =
  | { ok: true; entry: RegistryEntry }
  | {
      ok: false;
      reason:
        | 'NOT_OFFICIAL_TRACK'
        | 'MISSING_FROM_REGISTRY'
        | 'MAP_VERSION_MISMATCH'
        | 'MAP_FINGERPRINT_MISMATCH'
        | 'MOVEMENT_VERSION_MISMATCH';
      detail: string;
    };

/**
 * Verifies a locally computed identity against the shipped canonical registry.
 *
 * Competitive submission is allowed ONLY when this returns ok. If the local map
 * does not match the registry the player can still play and keep local PBs —
 * they simply do not submit to the public board, because their map is not the
 * canonical one.
 */
export function verifyAgainstRegistry(
  identity: MapIdentity,
  registry: readonly RegistryEntry[]
): IdentityVerdict {
  const entry = registry.find((e) => e.trackId === identity.trackId);
  if (!entry) {
    return {
      ok: false,
      reason: 'MISSING_FROM_REGISTRY',
      detail: `no canonical entry for ${identity.trackId}`
    };
  }
  if (entry.mapVersion !== identity.mapVersion) {
    return {
      ok: false,
      reason: 'MAP_VERSION_MISMATCH',
      detail: `registry ${entry.mapVersion} vs local ${identity.mapVersion}`
    };
  }
  if (entry.movementVersion !== identity.movementVersion) {
    return {
      ok: false,
      reason: 'MOVEMENT_VERSION_MISMATCH',
      detail: `registry ${entry.movementVersion} vs local ${identity.movementVersion}`
    };
  }
  if (entry.mapFingerprint !== identity.mapFingerprint) {
    return {
      ok: false,
      reason: 'MAP_FINGERPRINT_MISMATCH',
      detail: `registry ${entry.mapFingerprint} vs local ${identity.mapFingerprint}`
    };
  }
  return { ok: true, entry };
}
