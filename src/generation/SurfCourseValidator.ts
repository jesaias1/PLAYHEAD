import * as THREE from 'three';
/**
 * SurfCourseValidator — SURF-specific traversal validation and repair.
 *
 * Validates a generated surf course against the FROZEN movement constants
 * (gravity, jump impulse) using the ACTUAL generated geometry, not a proxy:
 *   - ribbon C0/C1 continuity (shared stations, bounded normal change)
 *   - ballistic transfer catch envelopes against the REAL target surface bounds
 *   - descent/climb feasibility within a realistic speed envelope
 *   - ENTRY / BODY / EXIT structure and platform <-> surf relationships
 *   - no seam snagging (adjacent segments share an identical boundary edge)
 *
 * The SURF pipeline NEVER runs the normal platform RouteValidator repair: that
 * can move collision boxes without moving the stored ribbon stations and would
 * silently break the sampled surface. `snapPlatformChain` is the SURF-specific
 * replacement and translates downstream geometry without deforming ribbons.
 */

import { GeneratedTrack, RouteNode, Vector3Like } from './GenerationTypes';
import { PLAYHEAD_MOVEMENT_V1 } from '../player/MovementConfig';
import { getNodeExitAnchor, getNodeEntryAnchor } from './RouteConnectivityValidator';
import { ribbonSurfaceCorners, ribNodeExitAnchorFull, buildRibbonSurfaceMesh, RibbonSurfaceTriangle } from './SurfRibbon';

export const SURF_GRAVITY = PLAYHEAD_MOVEMENT_V1.gravity;
export const SURF_JUMP_VELOCITY = PLAYHEAD_MOVEMENT_V1.jumpVelocity;
export const SURF_PLAYER_HEIGHT = PLAYHEAD_MOVEMENT_V1.playerHeight;
export const SURF_PLAYER_RADIUS = PLAYHEAD_MOVEMENT_V1.playerRadius;

/** Realistic horizontal surf speed envelope (m/s). */
export const SURF_SPEED_ENVELOPE = {
  minimum: 12.0,
  expected: 20.0,
  highSkill: 30.0
};

/** Maximum allowed angle between the normals of two adjacent ribbon samples. */
export const MAX_RIBBON_NORMAL_STEP_DEG = 20.0;
/** Maximum vertical mismatch between a shared station's two node edges (m). */
export const MAX_SEAM_MISMATCH = 0.05;

export interface SurfCourseIssue {
  kind:
    | 'CONNECTIVITY'
    | 'STRUCTURE'
    | 'ENTRY'
    | 'EXIT'
    | 'RIBBON_CONTINUITY'
    | 'SEAM_MISMATCH'
    | 'TRANSFER_ENVELOPE'
    | 'CLIMB_FEASIBILITY'
    | 'CATCH_VOLUME';
  detail: string;
  nodeIds?: number[];
}

export interface SurfCourseValidation {
  isValid: boolean;
  issues: SurfCourseIssue[];
  surfNodeCount: number;
  totalNodeCount: number;
  /** SURF traversal DISTANCE fraction (surf node length / total route length). */
  surfFraction: number;
}

function horizontal(a: RouteNode, b: RouteNode): number {
  const x=getNodeExitAnchor(a).position,y=getNodeEntryAnchor(b).position;
  return Math.hypot(y.x-x.x,y.z-x.z);
}

/** Angle in degrees between two (unit) direction vectors. */
function angleBetweenDeg(a: Vector3Like, b: Vector3Like): number {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  return (Math.acos(dot) * 180) / Math.PI;
}

/**
 * Vertical velocity a surf exit imparts, from the segment's slope.
 *
 * Three YXZ local forward is (+z, y = -sin(pitch)), so a positive `pitch`
 * (nose-down lip) yields a NEGATIVE vertical velocity. Getting this sign wrong
 * flips every transfer arc.
 */
export function surfExitVerticalVelocity(node: RouteNode, horizontalSpeed: number): number {
  return -horizontalSpeed * Math.tan(node.pitch);
}

export interface TransferCheck {
  reachable: boolean;
  verticalOffset: number;
  lateralWithinCatch: boolean;
  flightTime: number;
  catchHalfWidth: number;
  trajectory?: { start: Vector3Like; velocity: Vector3Like; duration: number };
}

/**
 * Ballistic catch test for one launch node -> one target surf node, using the
 * target's REAL sampled quad bounds where available.
 */
export function ballisticTransferCheck(
  launch: RouteNode,
  target: RouteNode,
  horizontalSpeed: number,
  targetNodes: RouteNode[] = [target]
): TransferCheck {
  const anchor = getNodeExitAnchor(launch);
  const exit = ribNodeExitAnchorFull(launch);
  const tangent = exit?.tangent ?? { x: Math.sin(anchor.yaw), y: -Math.tan(launch.pitch), z: Math.cos(anchor.yaw) };
  const horizontalLength = Math.hypot(tangent.x, tangent.z) || 1;
  const yaw = Math.atan2(tangent.x, tangent.z);
  const normal = launch.ribbon?.stations[1].normal ?? { x: 0, y: 1, z: 0 };
  const start = new THREE.Vector3(anchor.position.x, anchor.position.y, anchor.position.z)
    .addScaledVector(new THREE.Vector3(normal.x, normal.y, normal.z), SURF_PLAYER_RADIUS);
  const entry = getNodeEntryAnchor(target).position;
  const delta = new THREE.Vector3(entry.x, entry.y, entry.z).sub(start);
  const forward = delta.x * Math.sin(yaw) + delta.z * Math.cos(yaw);
  const failure = { reachable: false, verticalOffset: delta.y, lateralWithinCatch: false, flightTime: 0, catchHalfWidth: realCatchHalfWidth(target) };
  if (!Number.isFinite(horizontalSpeed) || horizontalSpeed <= 0 || forward < -SURF_PLAYER_RADIUS) return failure;
  const triangles = targetNodes.flatMap(catchSurfaceTriangles);
  // Model possible release headings within 30 degrees, at a FIXED horizontal
  // speed. There is no fabricated lateral teleport or added steering velocity.
  const aim = Math.atan2(delta.x, delta.z);
  const angle = Math.atan2(Math.sin(aim-yaw), Math.cos(aim-yaw));
  const limit = Math.PI / 6;
  const headings = [0, -limit, -limit/2, limit/2, limit, Math.max(-limit, Math.min(limit, angle))];
  const jumps = launch.isSurf ? [0] : [0, SURF_JUMP_VELOCITY];
  for (const heading of headings) for (const jump of jumps) {
    const velocity = new THREE.Vector3(Math.sin(yaw+heading)*horizontalSpeed,
      tangent.y / horizontalLength * horizontalSpeed + jump,
      Math.cos(yaw+heading)*horizontalSpeed);
    for (const tri of triangles) {
      // Sphere-plane intersection with the exact ballistic parabola. Check
      // the finite triangle at the root and only accept entry from its front.
      const a = -0.5 * SURF_GRAVITY * tri.normal.y;
      const b = tri.normal.dot(velocity);
      const c = tri.normal.dot(start.clone().sub(tri.a)) - SURF_PLAYER_RADIUS;
      const disc = b*b - 4*a*c;
      const roots = Math.abs(a)<1e-10 ? (Math.abs(b)>1e-10 ? [-c/b] : [])
        : disc>=0 ? [(-b-Math.sqrt(disc))/(2*a), (-b+Math.sqrt(disc))/(2*a)] : [];
      for (const time of roots) {
        if (time <= 0.001 || time > 8 || b+2*a*time >= -1e-6) continue;
        const point = start.clone().addScaledVector(velocity,time);
        point.y -= 0.5*SURF_GRAVITY*time*time;
        const closest = closestPointOnTriangleXYZ(point.x,point.y,point.z,tri);
        const distanceSq = (point.x-closest.x)**2+(point.y-closest.y)**2+(point.z-closest.z)**2;
        if (distanceSq <= SURF_PLAYER_RADIUS**2 + 1e-7) {
          return { reachable: true, lateralWithinCatch: true, flightTime: time,
            verticalOffset: point.y-closest.y, catchHalfWidth: realCatchHalfWidth(target),
            trajectory: { start: {x:start.x,y:start.y,z:start.z}, velocity: {x:velocity.x,y:velocity.y,z:velocity.z}, duration:time } };
        }
      }
    }
  }
  return failure;
}

/** Finite playable triangles, including the real rotated platform top. */
function catchSurfaceTriangles(node: RouteNode): RibbonSurfaceTriangle[] {
  const mesh = buildRibbonSurfaceMesh(node);
  if (mesh) return mesh.collisionTriangles.filter(t => t.kind === 'TOP');
  const euler = new THREE.Euler(node.pitch,node.yaw,node.roll,'YXZ');
  const top = [new THREE.Vector3(-node.dimensions.x/2,node.dimensions.y/2,-node.dimensions.z/2),
    new THREE.Vector3(-node.dimensions.x/2,node.dimensions.y/2,node.dimensions.z/2),
    new THREE.Vector3(node.dimensions.x/2,node.dimensions.y/2,node.dimensions.z/2),
    new THREE.Vector3(node.dimensions.x/2,node.dimensions.y/2,-node.dimensions.z/2)]
    .map(v=>v.applyEuler(euler).add(new THREE.Vector3(node.position.x,node.position.y,node.position.z)));
  const normal = new THREE.Vector3(0,1,0).applyEuler(euler);
  return [{a:top[0],b:top[1],c:top[2],normal,kind:'TOP'}, {a:top[0],b:top[2],c:top[3],normal,kind:'TOP'}];
}

function catchChain(nodes: RouteNode[], index: number): RouteNode[] {
  const target = nodes[index];
  if (target.ribbonId === undefined) return [target];
  const chain: RouteNode[] = [];
  for (let i=index;i<nodes.length && nodes[i].ribbonId===target.ribbonId;i++) chain.push(nodes[i]);
  return chain;
}

/** Ericson closest-point on a triangle from raw xyz components (no allocation). */
function closestPointOnTriangleXYZ(
  px: number, py: number, pz: number,
  tri: RibbonSurfaceTriangle
): { x: number; y: number; z: number } {
  const ax = tri.a.x, ay = tri.a.y, az = tri.a.z;
  const bx = tri.b.x, by = tri.b.y, bz = tri.b.z;
  const cx = tri.c.x, cy = tri.c.y, cz = tri.c.z;
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return { x: ax, y: ay, z: az };
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return { x: bx, y: by, z: bz };
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return { x: ax + abx * v, y: ay + aby * v, z: az + abz * v };
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return { x: cx, y: cy, z: cz };
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return { x: ax + acx * w, y: ay + acy * w, z: az + acz * w };
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return { x: bx + (cx - bx) * w, y: by + (cy - by) * w, z: bz + (cz - bz) * w };
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return { x: ax + abx * v + acx * w, y: ay + aby * v + acy * w, z: az + abz * v + acz * w };
}

/** Real lateral catch half width of a node's sampled quad at its entry edge. */
function realCatchHalfWidth(node: RouteNode): number {
  const corners = ribbonSurfaceCorners(node);
  if (!corners) return node.dimensions.x * 0.5;
  return corners[0].distanceTo(corners[1]) * 0.5;
}

/**
 * Feasibility of a climbing ribbon within the speed envelope, using the ACTUAL
 * sampled rise (not a node count or a proxy elevation).
 */
export function climbFeasibility(
  entrySpeed: number,
  rise: number,
  length: number
): { feasible: boolean; energyMargin: number } {
  const available = (entrySpeed * entrySpeed) / (2 * SURF_GRAVITY);
  const energyMargin = available - rise;
  const slopeOk = Math.abs(Math.asin(Math.max(-1, Math.min(1, rise / Math.max(1, length))))) <= 0.62;
  return { feasible: energyMargin >= 0.0 && slopeOk, energyMargin };
}

/** Climb feasibility using the real sampled rise of each ribbon. */
export function ribbonClimbFeasibility(rise: number, length: number): { feasible: boolean; energyMargin: number } {
  return climbFeasibility(SURF_SPEED_ENVELOPE.minimum, rise, length);
}

/**
 * SURF-specific platform chain repair.
 *
 * Snaps each non-ribbon platform's ENTRY edge to the previous node's EXIT edge
 * (horizontal + vertical), translating the complete downstream plan together.
 * Shared stations move once, preserving ribbon shape and authored AIR gaps.
 * Returns the same node array (mutated in place) plus a repair count.
 */
export function snapPlatformChain(nodes: RouteNode[]): { nodes: RouteNode[]; repairsCount: number } {
  let repairsCount = 0;
  for (let i=1;i<nodes.length;i++) {
    const previous=nodes[i-1], current=nodes[i];
    if (current.surfTransition==='AIR' || (current.ribbonId!==undefined && current.ribbonId===previous.ribbonId)) continue;
    const a=getNodeExitAnchor(previous).position, b=getNodeEntryAnchor(current).position;
    const dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z;
    if (Math.max(Math.abs(dx),Math.abs(dy),Math.abs(dz))<1e-5) continue;
    // Translate the complete downstream plan together. This preserves authored
    // transfers and moves every SHARED station once, rather than twice per seam.
    const seen = new Set<Vector3Like>();
    for (let j=i;j<nodes.length;j++) {
      const node=nodes[j]; node.position.x+=dx;node.position.y+=dy;node.position.z+=dz;
      for (const station of node.ribbon?.stations ?? []) {
        if (seen.has(station.center)) continue;
        seen.add(station.center); station.center.x+=dx;station.center.y+=dy;station.center.z+=dz;
      }
    }
    repairsCount++;
  }
  return {nodes,repairsCount};
}

/** Ordered world-space sampled stations of every ribbon, for path exclusion. */
export function collectSurfPathStations(track: GeneratedTrack): Array<{ x: number; y: number; z: number; r: number }> {
  const stations: Array<{ x: number; y: number; z: number; r: number }> = [];
  const byRibbon = new Map<number, RouteNode[]>();
  for (const node of track.route) {
    if (node.ribbonId === undefined || !node.ribbon) continue;
    const list = byRibbon.get(node.ribbonId) ?? [];
    list.push(node);
    byRibbon.set(node.ribbonId, list);
  }
  for (const list of byRibbon.values()) {
    list.sort((a, b) => (a.ribbonStationIndex ?? 0) - (b.ribbonStationIndex ?? 0));
    const first = list[0].ribbon!.stations[0];
    stations.push({ x: first.center.x, y: first.center.y, z: first.center.z, r: first.halfWidth });
    for (const node of list) {
      const s = node.ribbon!.stations[1];
      stations.push({ x: s.center.x, y: s.center.y, z: s.center.z, r: s.halfWidth });
    }
  }
  return stations;
}

/** Horizontal AABB + vertical range of the complete surf travel envelope. */
export function computeSurfTravelBounds(track: GeneratedTrack): {
  minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number;
} | null {
  const stations = collectSurfPathStations(track);
  if (stations.length === 0) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of stations) {
    minX = Math.min(minX, s.x - s.r);
    maxX = Math.max(maxX, s.x + s.r);
    minZ = Math.min(minZ, s.z - s.r);
    maxZ = Math.max(maxZ, s.z + s.r);
    minY = Math.min(minY, s.y);
    maxY = Math.max(maxY, s.y);
  }
  return { minX, maxX, minZ, maxZ, minY, maxY };
}

export class SurfCourseValidator {
  public static validatePhrase(nodes: RouteNode[]): { ok: boolean; reason?: string } {
    if (nodes.length === 0) return { ok: false, reason: 'empty phrase' };
    for (const n of nodes) {
      if (
        !Number.isFinite(n.position.x) || !Number.isFinite(n.position.y) || !Number.isFinite(n.position.z) ||
        !Number.isFinite(n.yaw) || !Number.isFinite(n.pitch) || !Number.isFinite(n.roll)
      ) {
        return { ok: false, reason: `non-finite node ${n.id}` };
      }
    }

    const byRibbon = new Map<number, RouteNode[]>();
    for (const n of nodes) {
      if (n.ribbonId === undefined) continue;
      const list = byRibbon.get(n.ribbonId) ?? [];
      list.push(n);
      byRibbon.set(n.ribbonId, list);
    }
    for (const [ribbonId, list] of byRibbon) {
      list.sort((a, b) => (a.ribbonStationIndex ?? 0) - (b.ribbonStationIndex ?? 0));
      if (list.length < 2) continue;
      for (let i = 0; i < list.length - 1; i++) {
        const aExit = list[i].ribbon?.stations[1];
        const bEntry = list[i + 1].ribbon?.stations[0];
        if (!aExit || !bEntry) return { ok: false, reason: `ribbon ${ribbonId} missing stations` };
        const mismatch = Math.hypot(aExit.center.x - bEntry.center.x, aExit.center.y - bEntry.center.y, aExit.center.z - bEntry.center.z);
        if (mismatch > MAX_SEAM_MISMATCH) return { ok: false, reason: `ribbon ${ribbonId} seam mismatch` };
      }
      const first = list[0].ribbon?.stations[0];
      const last = list[list.length - 1].ribbon?.stations[1];
      if (!first || !last) return { ok: false, reason: `ribbon ${ribbonId} missing stations` };
      const rise = last.center.y - first.center.y;
      if (rise > 0) {
        let length = 0;
        for (const n of list) length += n.dimensions.z;
        if (!ribbonClimbFeasibility(rise, length).feasible) return { ok: false, reason: `ribbon ${ribbonId} climb infeasible` };
      }
    }

    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];
      if (!a.isSurf || !b.isSurf) continue;
      if (a.ribbonId !== undefined && a.ribbonId === b.ribbonId) continue;
      const gap = horizontal(a, b);
      if (gap < 1.5) continue;
      // Same honest all-speed rule as the full validator.
      for (const speed of [SURF_SPEED_ENVELOPE.minimum, SURF_SPEED_ENVELOPE.expected, SURF_SPEED_ENVELOPE.highSkill]) {
        const check = ballisticTransferCheck(a, b, speed, catchChain(nodes, i + 1));
        if (!check.reachable || !check.lateralWithinCatch) {
          return { ok: false, reason: `transfer ${a.id}->${b.id} outside real catch envelope at ${speed}m/s` };
        }
      }
    }

    return { ok: true };
  }

  public static validate(track: GeneratedTrack): SurfCourseValidation {
    const issues: SurfCourseIssue[] = [];
    const route = track.route || [];
    const surfNodes = route.filter((n) => n.isSurf);

    if (route.length < 4) {
      issues.push({ kind: 'CONNECTIVITY', detail: `Course has only ${route.length} nodes` });
    }

    // ENTRY / BODY / EXIT structure: the route must open on a platform runway,
    // contain a continuous surf body and close on a finish surface.
    if (route.length > 0) {
      if (route[0].isSurf) {
        issues.push({ kind: 'ENTRY', detail: 'Course does not open on an acceleration platform', nodeIds: [route[0].id] });
      }
      const last = route[route.length - 1];
      if (last.type !== 'FINISH') {
        issues.push({ kind: 'EXIT', detail: 'Course does not close on a finish surface', nodeIds: [last.id] });
      }
    }
    if (surfNodes.length < 4) {
      issues.push({ kind: 'STRUCTURE', detail: `Only ${surfNodes.length} surf nodes` });
    }

    // --- Ribbon continuity + seam checks -----------------------------------
    const byRibbon = new Map<number, RouteNode[]>();
    for (const node of route) {
      if (node.ribbonId === undefined) continue;
      const list = byRibbon.get(node.ribbonId) ?? [];
      list.push(node);
      byRibbon.set(node.ribbonId, list);
    }

    for (const [ribbonId, nodes] of byRibbon) {
      nodes.sort((a, b) => (a.ribbonStationIndex ?? 0) - (b.ribbonStationIndex ?? 0));
      for (let i = 0; i < nodes.length - 1; i++) {
        const a = nodes[i];
        const b = nodes[i + 1];
        const aExit = a.ribbon?.stations[1];
        const bEntry = b.ribbon?.stations[0];
        if (!aExit || !bEntry) {
          issues.push({ kind: 'RIBBON_CONTINUITY', detail: `Ribbon ${ribbonId} node ${a.id} missing stations`, nodeIds: [a.id] });
          continue;
        }
        // REAL shared-edge test: the entry edge of B must equal the exit edge of
        // A to within a hair, in all four corners.
        const cornersA = ribbonSurfaceCorners(a);
        const cornersB = ribbonSurfaceCorners(b);
        if (cornersA && cornersB) {
          const edgeMismatch = Math.max(
            cornersA[2].distanceTo(cornersB[1]),
            cornersA[3].distanceTo(cornersB[0])
          );
          if (edgeMismatch > MAX_SEAM_MISMATCH) {
            issues.push({
              kind: 'SEAM_MISMATCH',
              detail: `Ribbon ${ribbonId} shared edge ${a.id}->${b.id} mismatched by ${edgeMismatch.toFixed(3)}m`,
              nodeIds: [a.id, b.id]
            });
          }
        }
        // Compare the ACTUAL modelled surface-normal change across the node: the
        // angle between its own entry and exit station normals (successive,
        // distinct stations). The previous code compared a shared station normal
        // to ITSELF (aExit.normal vs bEntry.normal, which are byte-identical) so
        // it always read ~0; the real per-sample bending is what must be bounded.
        const normalStepDeg = angleBetweenDeg(a.ribbon!.stations[0].normal, aExit.normal);
        if (normalStepDeg > MAX_RIBBON_NORMAL_STEP_DEG) {
          issues.push({
            kind: 'RIBBON_CONTINUITY',
            detail: `Ribbon ${ribbonId} normal step ${normalStepDeg.toFixed(1)}° exceeds ${MAX_RIBBON_NORMAL_STEP_DEG}°`,
            nodeIds: [a.id, b.id]
          });
        }
      }

      const first = nodes[0]?.ribbon?.stations[0];
      const last = nodes[nodes.length - 1]?.ribbon?.stations[1];
      if (first && last) {
        const rise = last.center.y - first.center.y;
        if (rise > 0) {
          let length = 0;
          for (const n of nodes) length += n.dimensions.z;
          const feasibility = ribbonClimbFeasibility(rise, length);
          if (!feasibility.feasible) {
            issues.push({
              kind: 'CLIMB_FEASIBILITY',
              detail: `Ribbon ${ribbonId} climb ${rise.toFixed(1)}m margin ${feasibility.energyMargin.toFixed(2)}`,
              nodeIds: nodes.map((n) => n.id)
            });
          }
        }
      }
    }

    // --- Transfer envelopes (all surf-spanning relationships, not just surf<->surf) ---
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i];
      const b = route[i + 1];
      const spanIsSurf = a.isSurf || b.isSurf;
      if (!spanIsSurf) continue;
      if (a.ribbonId !== undefined && a.ribbonId === b.ribbonId) continue;
      const gap = horizontal(a, b);
      if (gap < 1.5) continue;

      // HONEST multi-speed rule: the REAL target surface must catch the
      // ballistic arc at ALL three envelope speeds (12 minimum / 20 expected /
      // 30 highSkill). A transfer only safe at one speed is not safe.
      const speeds = [SURF_SPEED_ENVELOPE.minimum, SURF_SPEED_ENVELOPE.expected, SURF_SPEED_ENVELOPE.highSkill];
      let unreachableAt: number | null = null;
      let lateralOk = true;
      for (const speed of speeds) {
        const check = ballisticTransferCheck(a, b, speed, catchChain(route, i + 1));
        if (!check.reachable && unreachableAt === null) unreachableAt = speed;
        if (!check.lateralWithinCatch) lateralOk = false;
      }
      if (unreachableAt !== null) {
        issues.push({
          kind: 'TRANSFER_ENVELOPE',
          detail: `Transfer ${a.id}->${b.id} not caught at ${unreachableAt}m/s across the real target body`,
          nodeIds: [a.id, b.id]
        });
      }
      if (!lateralOk) {
        issues.push({
          kind: 'CATCH_VOLUME',
          detail: `Transfer ${a.id}->${b.id} lateral miss outside real catch width`,
          nodeIds: [a.id, b.id]
        });
      }
    }

    // SURF dominance is measured by traversal DISTANCE, not node count.
    let surfDistance = 0;
    let totalDistance = 0;
    for (const n of route) {
      totalDistance += n.dimensions.z;
      if (n.isSurf) surfDistance += n.dimensions.z;
    }
    const surfFraction = totalDistance > 0 ? surfDistance / totalDistance : 0;

    return {
      isValid: issues.length === 0,
      issues,
      surfNodeCount: surfNodes.length,
      totalNodeCount: route.length,
      surfFraction
    };
  }
}
