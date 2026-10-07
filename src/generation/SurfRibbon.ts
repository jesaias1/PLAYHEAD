import * as THREE from 'three';
import { RouteNode, RouteNodeType, SurfRibbonSegment, SurfRibbonStation, Vector3Like } from './GenerationTypes';

export interface RibbonSpec {
  kind: string;
  length: number;
  startHalfWidth: number;
  endHalfWidth: number;
  startBank: number;
  endBank: number;
  headingChange: number;
  verticalDelta: number;
  headingBend?: number;
}

export const MAX_RIBBON_SEGMENTS = 96;
export const RIBBON_TARGET_SEGMENT_LENGTH = 1.75;
export const RIBBON_THICKNESS = 0.9;
export const RIBBON_OVERLAP = 1.4;

export interface RibbonEmitOptions {
  ribbonId: number;
  nodeIdStart: number;
  timeStart: number;
  timeEnd: number;
  sectionIndex: number;
  intensity: number;
  isOptional?: boolean;
}

/** A station exposed with BOTH the shared tangent and shared right axes so
 * adjacent segments derive their boundary edge from a single source of truth. */
export interface RibbonStationAxes {
  station: SurfRibbonStation;
  tangent: Vector3Like;
  right: Vector3Like;
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

export function vVec(x: number, y: number, z: number): Vector3Like {
  return { x, y, z };
}

export function vNormalize(v: Vector3Like): Vector3Like {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return vVec(v.x / len, v.y / len, v.z / len);
}

export function vCross(a: Vector3Like, b: Vector3Like): Vector3Like {
  return vVec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

export function vDot(a: Vector3Like, b: Vector3Like): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vSub(a: Vector3Like, b: Vector3Like): Vector3Like {
  return vVec(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function vAdd(a: Vector3Like, b: Vector3Like): Vector3Like {
  return vVec(a.x + b.x, a.y + b.y, a.z + b.z);
}

export function vScale(a: Vector3Like, s: number): Vector3Like {
  return vVec(a.x * s, a.y * s, a.z * s);
}

/**
 * Euler (pitch, yaw, roll, YXZ) mapping local +Z to `forward` and local +Y to
 * the orthogonalised `normal`.
 */
export function eulerFromBasis(forward: Vector3Like, normal: Vector3Like): { yaw: number; pitch: number; roll: number } {
  const f = vNormalize(forward);
  let n = vNormalize(normal);
  const dot = vDot(n, f);
  n = vNormalize(vSub(n, vScale(f, dot)));

  const pitch = Math.asin(clamp(-f.y, -1, 1));
  const yaw = Math.atan2(f.x, f.z);

  const euler = new THREE.Euler(pitch, yaw, 0, 'YXZ');
  const basis = new THREE.Matrix4().makeRotationFromEuler(euler);
  const A = new THREE.Vector3(1, 0, 0).applyMatrix4(basis).normalize();
  const B = new THREE.Vector3(0, 1, 0).applyMatrix4(basis).normalize();
  const nv = new THREE.Vector3(n.x, n.y, n.z);
  const roll = Math.atan2(-nv.dot(A), nv.dot(B));
  return { yaw, pitch, roll };
}

/**
 * Samples a ribbon centreline into stations. Every station records a shared
 * `right` axis derived from the LOCAL CENTRELINE TANGENT of the sampled path
 * (not the chord between neighbouring stations), so the exit edge of one
 * segment and the entry edge of the next are computed from the SAME axis and
 * are therefore geometrically identical.
 */
export function buildRibbonStations(
  spec: RibbonSpec,
  startPos: Vector3Like,
  startYaw: number
): SurfRibbonStation[] {
  return buildRibbonStationAxes(spec, startPos, startYaw).map((a) => a.station);
}

export function buildRibbonStationAxes(
  spec: RibbonSpec,
  startPos: Vector3Like,
  startYaw: number
): RibbonStationAxes[] {
  const segments = clamp(Math.ceil(Math.max(spec.length / RIBBON_TARGET_SEGMENT_LENGTH, Math.abs(spec.endBank-spec.startBank)/0.04, (Math.abs(spec.headingChange)+2*Math.abs(spec.headingBend??0))/0.04)), 4, MAX_RIBBON_SEGMENTS);
  const ds = spec.length / segments;

  const centers: Vector3Like[] = [];
  const yaws: number[] = [];
  const banks: number[] = [];
  const halfWidths: number[] = [];

  const slope = clamp(spec.verticalDelta / Math.max(1e-3, spec.length), -0.8, 0.8);
  let x = startPos.x;
  let y = startPos.y;
  let z = startPos.z;
  for (let k = 0; k <= segments; k++) {
    const t = k / segments;
    const yaw = startYaw + spec.headingChange * t + (spec.headingBend ?? 0) * t * t;
    yaws.push(yaw);
    banks.push(spec.startBank + (spec.endBank - spec.startBank) * t);
    halfWidths.push(spec.startHalfWidth + (spec.endHalfWidth - spec.startHalfWidth) * t);
    centers.push(vVec(x, y, z));
    if (k < segments) {
      x += Math.sin(yaw) * ds;
      z += Math.cos(yaw) * ds;
      y += slope * ds;
    }
  }

  const axes: RibbonStationAxes[] = [];
  for (let k = 0; k <= segments; k++) {
    // Central-difference tangent: shared by the two segments that meet at k.
    const prev = centers[Math.max(0, k - 1)];
    const next = centers[Math.min(centers.length - 1, k + 1)];
    let tangent = vNormalize(vSub(next, prev));
    if (!Number.isFinite(tangent.x) || (tangent.x === 0 && tangent.y === 0 && tangent.z === 0)) {
      tangent = vVec(Math.sin(yaws[k]), 0, Math.cos(yaws[k]));
    }
    const bank = banks[k];
    const up = vVec(0, 1, 0);
    const n0 = vNormalize(vSub(up, vScale(tangent, vDot(up, tangent))));
    const right0 = vNormalize(vCross(n0, tangent));
    const normal = vNormalize(vAdd(vScale(n0, Math.cos(bank)), vScale(right0, -Math.sin(bank))));
    // Shared right axis of the TOP FACE at this station. The quad edge is
    // centre +/- right*halfWidth, so it depends only on this station.
    const right = vNormalize(vCross(normal, tangent));
    axes.push({
      station: { center: centers[k], normal, halfWidth: halfWidths[k], right, tangent },
      tangent,
      right
    });
  }

  return axes;
}

/** Entry anchor (real first station centre) of a ribbon node, or null. */
export function ribNodeEntryAnchor(node: RouteNode): { center: Vector3Like; normal: Vector3Like; halfWidth: number } | null {
  const s = node.ribbon?.stations[0];
  if (!s) return null;
  return { center: s.center, normal: s.normal, halfWidth: s.halfWidth };
}

/**
 * Entry anchor of a ribbon node from its REAL stored first station: centre and
 * the station TANGENT (entry-to-exit direction). The tangent prefers the stored
 * shared station tangent and falls back to the segment chord.
 */
export function ribNodeEntryAnchorFull(node: RouteNode): { center: Vector3Like; tangent: Vector3Like } | null {
  const seg = node.ribbon;
  if (!seg) return null;
  const [a, b] = seg.stations;
  const tangent = a.tangent ? vNormalize(a.tangent) : vNormalize(vSub(b.center, a.center));
  return { center: a.center, tangent };
}

/**
 * Exit anchor of a ribbon node from its REAL stored last station: centre and
 * the station TANGENT. A transfer launches from THIS real tangent, never from
 * the OBB yaw/pitch proxy.
 */
export function ribNodeExitAnchorFull(node: RouteNode): { center: Vector3Like; tangent: Vector3Like } | null {
  const seg = node.ribbon;
  if (!seg) return null;
  const [a, b] = seg.stations;
  const tangent = b.tangent ? vNormalize(b.tangent) : vNormalize(vSub(b.center, a.center));
  return { center: b.center, tangent };
}

/** World-space top-face corners of a single station, using the SHARED right axis. */
export function stationEdge(axes: RibbonStationAxes): { left: Vector3Like; right: Vector3Like } {
  const { station, right } = axes;
  return {
    left: vAdd(station.center, vScale(right, -station.halfWidth)),
    right: vAdd(station.center, vScale(right, station.halfWidth))
  };
}

/**
 * Emits one FLAT, BANKED surf node per consecutive station pair. The node's
 * collision surface is the quad [a.left, a.right, b.right, b.left] in world
 * space; adjacent nodes share the exact `a`/`b` station axes, so shared edges
 * are byte-identical.
 */
export function ribbonSegmentNodes(
  stations: SurfRibbonStation[],
  spec: RibbonSpec,
  options: RibbonEmitOptions
): { nodes: RouteNode[]; nextNodeId: number; exitPos: Vector3Like; exitNormal: Vector3Like } {
  const nodes: RouteNode[] = [];
  let nodeId = options.nodeIdStart;
  const segCount = stations.length - 1;

  for (let k = 0; k < segCount; k++) {
    const a = stations[k];
    const b = stations[k + 1];
    const f = vNormalize(vSub(b.center, a.center));
    let n = vNormalize(vAdd(a.normal, b.normal));
    n = vNormalize(vSub(n, vScale(f, vDot(n, f))));
    const { yaw, pitch, roll } = eulerFromBasis(f, n);

    const mid = vScale(vAdd(a.center, b.center), 0.5);
    const segLen = Math.hypot(b.center.x - a.center.x, b.center.y - a.center.y, b.center.z - a.center.z);
    const isLast = k === segCount - 1;
    const length = segLen + (isLast ? 0 : RIBBON_OVERLAP);

    const t = segCount <= 1 ? 0 : k / (segCount - 1);
    const segment: SurfRibbonSegment = {
      ribbonId: options.ribbonId,
      kind: spec.kind,
      stations: [a, b]
    };

    nodes.push({
      id: nodeId++,
      time: options.timeStart + (options.timeEnd - options.timeStart) * t,
      position: vSub(mid, vScale(n, RIBBON_THICKNESS * 0.5)),
      dimensions: { x: a.halfWidth * 2, y: RIBBON_THICKNESS, z: length },
      exitWidth: b.halfWidth * 2,
      yaw,
      pitch,
      roll,
      type: RouteNodeType.SURF_RAMP,
      intensity: options.intensity,
      sectionIndex: options.sectionIndex,
      arcLength: 0,
      isSurf: true,
      surfNormal: n,
      isBoost: false,
      isOptional: options.isOptional,
      ribbon: segment,
      ribbonId: options.ribbonId,
      surfTransition: 'CONNECTED',
      ribbonStationIndex: k
    });
  }

  const last = stations[stations.length - 1];
  return {
    nodes,
    nextNodeId: nodeId,
    exitPos: vVec(last.center.x, last.center.y, last.center.z),
    exitNormal: last.normal
  };
}

/** World-space top-face corners of a ribbon node, from its stored stations. */
export function ribbonTopQuad(node: RouteNode): [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] | null {
  if (!node.ribbon) return null;
  const [a, b] = node.ribbon.stations;
  const tangent = vNormalize(vSub(b.center, a.center));
  const ra = vNormalize(vCross(a.normal, tangent));
  const rb = vNormalize(vCross(b.normal, tangent));
  const p = (c: Vector3Like, r: Vector3Like, w: number, sign: number) =>
    new THREE.Vector3(c.x + r.x * w * sign, c.y + r.y * w * sign, c.z + r.z * w * sign);
  return [
    p(a.center, ra, a.halfWidth, -1),
    p(a.center, ra, a.halfWidth, 1),
    p(b.center, rb, b.halfWidth, 1),
    p(b.center, rb, b.halfWidth, -1)
  ];
}


/**
 * World-space top-face corners [entryLeft, entryRight, exitRight, exitLeft] of
 * a ribbon node, derived from its stored stations and their SHARED right axes.
 * Collision and rendering both consume these exact four points, so the surface
 * ridden and the surface drawn are identical by construction.
 */
export function ribbonSurfaceCorners(
  node: RouteNode
): [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] | null {
  if (!node.ribbon) return null;
  const [a, b] = node.ribbon.stations;
  const tangent = vNormalize(vSub(b.center, a.center));
  const ra = a.right ? vNormalize(a.right) : vNormalize(vCross(a.normal, tangent));
  const rb = b.right ? vNormalize(b.right) : vNormalize(vCross(b.normal, tangent));
  const p = (c: Vector3Like, r: Vector3Like, w: number, sign: number) =>
    new THREE.Vector3(c.x + r.x * w * sign, c.y + r.y * w * sign, c.z + r.z * w * sign);
  return [
    p(a.center, ra, a.halfWidth, -1),
    p(a.center, ra, a.halfWidth, 1),
    p(b.center, rb, b.halfWidth, 1),
    p(b.center, rb, b.halfWidth, -1)
  ];
}

/** Face kind of a ribbon collision triangle. */
export type RibbonFaceKind = 'TOP' | 'BOTTOM' | 'LATERAL';

/** One finite world-space triangle of the ribbon slab. */
export interface RibbonSurfaceTriangle {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  /** Outward unit normal (away from the slab interior). */
  normal: THREE.Vector3;
  kind: RibbonFaceKind;
}

/**
 * The single shared triangulation of a ribbon segment's slab. The visual mesh
 * and the collider BOTH consume this exact data, so the surface drawn and the
 * surface ridden can never disagree.
 *
 * Face roles match the platform shader convention. Top and bottom use eight strips.
 * There are 20 quads, with two outward triangles per quad. End caps are visual only.
 * Collision uses the same finite surface vertices and winding.
 */
export interface RibbonSurfaceMesh {
  positions: number[];
  indices: number[];
  uvs: number[];
  normals: number[];
  faceRoles: number[];
  /** Finite collision triangles: TOP, BOTTOM and the two OUTER LATERALS only.
   *  The travel-perpendicular entry/exit caps are deliberately excluded so a
   *  continuous ribbon never forms an internal slab wall. */
  collisionTriangles: RibbonSurfaceTriangle[];
  /** Averaged station normal of the playable top face. */
  topNormal: THREE.Vector3;
  minY: number;
  maxY: number;
}

/** Averaged unit top normal from the node's stored stations. */
export function ribbonTopNormal(node: RouteNode): THREE.Vector3 {
  const a = node.ribbon?.stations[0]?.normal;
  const b = node.ribbon?.stations[1]?.normal;
  const n = new THREE.Vector3();
  if (a) n.add(new THREE.Vector3(a.x, a.y, a.z));
  if (b) n.add(new THREE.Vector3(b.x, b.y, b.z));
  if (n.lengthSq() < 1e-12) {
    const f = node.surfNormal;
    if (f) return new THREE.Vector3(f.x, f.y, f.z).normalize();
    return new THREE.Vector3(0, 1, 0);
  }
  return n.normalize();
}

function faceNormal3(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): THREE.Vector3 {
  const n = b.clone().sub(a).cross(c.clone().sub(a));
  if (n.lengthSq() < 1e-12) return new THREE.Vector3(0, 1, 0);
  return n.normalize();
}

/**
 * Local vertex indices (relative to a quad's 4-vertex base) for one triangle,
 * ordered so its face normal points along `outward`. `a`,`b`,`c` are the local
 * indices of the winding (a->b->c); when that winding faces inward the b/c pair
 * is swapped. Both triangles of the quad are oriented this way independently,
 * so a planar quad's two triangles always agree with `outward`.
 */
function orientedLocalIndices(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  outward: THREE.Vector3,
  a: number,
  b: number,
  c: number
): [number, number, number] {
  if (faceNormal3(p0, p1, p2).dot(outward) < 0) return [a, c, b];
  return [a, b, c];
}

function pushRibbonTriangle(
  out: RibbonSurfaceTriangle[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  kind: RibbonFaceKind
): void {
  out.push({ a: a.clone(), b: b.clone(), c: c.clone(), normal: faceNormal3(a, b, c), kind });
}

/**
 * Builds the shared ribbon slab mesh from the node's stored stations. Returns
 * null when the node carries no ribbon samples.
 */
export function buildRibbonSurfaceMesh(node: RouteNode): RibbonSurfaceMesh | null {
  const corners = ribbonSurfaceCorners(node);
  if (!corners) return null;
  const [entryLeft, entryRight, exitRight, exitLeft] = corners;
  const topNormal = ribbonTopNormal(node);
  const aNormal = node.ribbon!.stations[0].normal;
  const bNormal = node.ribbon!.stations[1].normal;
  const dropA = new THREE.Vector3(aNormal.x,aNormal.y,aNormal.z).multiplyScalar(-RIBBON_THICKNESS);
  const dropB = new THREE.Vector3(bNormal.x,bNormal.y,bNormal.z).multiplyScalar(-RIBBON_THICKNESS);
  const bl = entryLeft.clone().add(dropA);
  const br = entryRight.clone().add(dropA);
  const fr = exitRight.clone().add(dropB);
  const fl = exitLeft.clone().add(dropB);

  const slabCenter = entryLeft.clone().add(entryRight).add(exitRight).add(exitLeft)
    .add(bl).add(br).add(fr).add(fl).multiplyScalar(0.125);

  const quads: Array<{ v: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]; kind: RibbonFaceKind; collide: boolean }> = [
    { v: [entryRight, exitRight, fr, br], kind: 'LATERAL', collide: true },   // +X right side
    { v: [exitLeft, entryLeft, bl, fl], kind: 'LATERAL', collide: true },     // -X left side
    { v: [exitLeft, exitRight, fr, fl], kind: 'LATERAL', collide: false },    // +Z exit cap (visual only)
    { v: [entryRight, entryLeft, bl, br], kind: 'LATERAL', collide: false }   // -Z entry cap (visual only)
  ];
  // Tessellate across the width as well as along the spline. A single twisted
  // quad creates a diagonal ridge even with dense longitudinal sampling.
  for (let strip=0;strip<8;strip++) {
    const u=strip/8,v=(strip+1)/8;
    quads.push({v:[entryLeft.clone().lerp(entryRight,u),entryLeft.clone().lerp(entryRight,v),
      exitLeft.clone().lerp(exitRight,v),exitLeft.clone().lerp(exitRight,u)],kind:'TOP',collide:true});
    quads.push({v:[bl.clone().lerp(br,u),bl.clone().lerp(br,v),fl.clone().lerp(fr,v),fl.clone().lerp(fr,u)],kind:'BOTTOM',collide:true});
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const faceRoles: number[] = [];
  const indices: number[] = [];
  const collisionTriangles: RibbonSurfaceTriangle[] = [];
  let minY = Infinity;
  let maxY = -Infinity;

  for (const quad of quads) {
    const [v0, v1, v2, v3] = quad.v;
    const centroid = v0.clone().add(v1).add(v2).add(v3).multiplyScalar(0.25);
    let outward = faceNormal3(v0, v1, v2);
    if (outward.dot(centroid.clone().sub(slabCenter)) < 0) outward = outward.negate();

    const base = positions.length / 3;
    for (const v of quad.v) {
      positions.push(v.x, v.y, v.z);
      normals.push(outward.x, outward.y, outward.z);
      faceRoles.push(quad.kind === 'TOP' ? 0 : quad.kind === 'BOTTOM' ? 2 : 1);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);

    // Orient EACH of the quad's two triangles independently so both face OUT.
    // The VISUAL index buffer is built from those SAME local orderings and the
    // COLLISION triangles use the SAME vertices in the SAME order, so the
    // surface drawn and the surface ridden are byte-identical (same winding).
    const triA = orientedLocalIndices(v0, v1, v2, outward, 0, 1, 2);
    const triB = orientedLocalIndices(v0, v2, v3, outward, 0, 2, 3);
    indices.push(
      base + triA[0], base + triA[1], base + triA[2],
      base + triB[0], base + triB[1], base + triB[2]
    );
    if (quad.collide) {
      pushRibbonTriangle(collisionTriangles, quad.v[triA[0]], quad.v[triA[1]], quad.v[triA[2]], quad.kind);
      pushRibbonTriangle(collisionTriangles, quad.v[triB[0]], quad.v[triB[1]], quad.v[triB[2]], quad.kind);
    }
  }

  return { positions, indices, uvs, normals, faceRoles, collisionTriangles, topNormal, minY, maxY };
}

/** Combined collision surface of one continuous ribbon (ordered node array). */
export interface RibbonChainSurface {
  collisionTriangles: RibbonSurfaceTriangle[];
  topNormal: THREE.Vector3;
  center: THREE.Vector3;
  boundingRadius: number;
  minY: number;
  maxY: number;
}

/**
 * Merges an ORDERED array of ribbon segment nodes (one ribbonId, ascending
 * ribbonStationIndex) into a single finite-triangle collision surface. Adjacent
 * segments share an exact boundary edge, so the union is a continuous surface
 * with no internal walls and no duplicated seam corrections.
 */
export function buildRibbonChainSurface(nodes: RouteNode[]): RibbonChainSurface | null {
  const ordered = [...nodes].sort(
    (a, b) => (a.ribbonStationIndex ?? 0) - (b.ribbonStationIndex ?? 0)
  );
  const collisionTriangles: RibbonSurfaceTriangle[] = [];
  const topNormal = new THREE.Vector3();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  let count = 0;
  for (const node of ordered) {
    const mesh = buildRibbonSurfaceMesh(node);
    if (!mesh) continue;
    for (const tri of mesh.collisionTriangles) collisionTriangles.push(tri);
    topNormal.add(mesh.topNormal);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i];
      const y = mesh.positions[i + 1];
      const z = mesh.positions[i + 2];
      min.x = Math.min(min.x, x); min.y = Math.min(min.y, y); min.z = Math.min(min.z, z);
      max.x = Math.max(max.x, x); max.y = Math.max(max.y, y); max.z = Math.max(max.z, z);
      count++;
    }
  }
  if (count === 0 || collisionTriangles.length === 0) return null;
  const center = min.clone().add(max).multiplyScalar(0.5);
  let maxSq = 0;
  for (const tri of collisionTriangles) {
    for (const v of [tri.a, tri.b, tri.c]) {
      maxSq = Math.max(maxSq, v.distanceToSquared(center));
    }
  }
  if (topNormal.lengthSq() < 1e-12) topNormal.set(0, 1, 0);
  return {
    collisionTriangles,
    topNormal: topNormal.normalize(),
    center,
    boundingRadius: Math.sqrt(maxSq),
    minY: min.y,
    maxY: max.y
  };
}
