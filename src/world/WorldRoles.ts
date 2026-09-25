/**
 * WORLD ROLES — explicit semantic ownership for every world object.
 *
 * Why this exists: the recurring "structure through the course" bug was never a
 * maths failure inside the corridor validator. It was an OWNERSHIP failure. The
 * validator only ever received `decorativeGroup` and a handful of system groups,
 * so anything a builder added straight to `rootGroup` (checkpoint arches, the
 * finish monument, foundation pylons) was invisible to it — including 136m and
 * 308m tall monuments sitting directly on route nodes.
 *
 * Roles make that impossible to repeat: an object either IS gameplay, or it is
 * environment that must survive the world safety pass, or it is explicitly
 * exempt. There is no "unlabelled" option — an unlabelled renderable is treated
 * as auditable environment by the safety pass and reported loudly in DEV.
 *
 * Roles are read from the NEAREST tagged ancestor, so a builder can tag a whole
 * group one way and tag an individual child differently (which is exactly how
 * the checkpoint arch keeps its authored framing while its foundations stay
 * audited).
 */

import * as THREE from 'three';

export type WorldRole =
  /** Colliding surfaces the player is meant to interact with. Never audited. */
  | 'GAMEPLAY'
  /** Environment architecture. Must NEVER intersect the gameplay envelope. */
  | 'DECORATION'
  /** Non-colliding presentation attached to gameplay (trim, framing, beacons). */
  | 'VISUAL_ONLY'
  /** Explicitly outside world safety (sky, camera, UI, DEV helpers). */
  | 'IGNORE_WORLD_SAFETY';

export interface WorldRoleTag {
  role: WorldRole;
  /** Builder/system that created the object, for forensic reporting. */
  source: string;
}

const ROLE_KEY = 'worldRole';

/** Tags an object (and optionally its whole subtree) with a world role. */
export function tagWorldRole(
  object: THREE.Object3D,
  role: WorldRole,
  source: string,
  recursive = true
): void {
  const tag: WorldRoleTag = { role, source };
  object.userData[ROLE_KEY] = tag;
  if (recursive) {
    object.traverse((child) => {
      if (child === object) return;
      child.userData[ROLE_KEY] = tag;
    });
  }
}

/** Reads the nearest role tag on this object or any ancestor. */
export function getWorldRole(object: THREE.Object3D): WorldRoleTag | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const tag = current.userData?.[ROLE_KEY] as WorldRoleTag | undefined;
    if (tag) return tag;
    current = current.parent;
  }
  return null;
}

/** True when the safety pass must not touch this object. */
export function isSafetyExempt(object: THREE.Object3D): boolean {
  const tag = getWorldRole(object);
  if (!tag) return false;
  return tag.role === 'GAMEPLAY' || tag.role === 'IGNORE_WORLD_SAFETY';
}

/**
 * Objects that legitimately have no world role: the camera, the viewmodel
 * overlay, and anything explicitly marked as a DEV helper or safety-exempt.
 *
 * The flags are read from the object AND its ancestors. Reading only the object
 * itself was a trap: `GhostVisual` set `worldSafetyExempt` on its group, the pass
 * checked the child MESH, and the ghost's meshes were deleted as unregistered
 * DECORATION. A group-level exemption must protect its subtree.
 */
export function isRoleExemptObject(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    const anyObj = current as unknown as { isCamera?: boolean; isLight?: boolean };
    if (anyObj.isCamera || anyObj.isLight) return true;
    if (current.userData?.devHelper === true) return true;
    if (current.userData?.worldSafetyExempt === true) return true;
    current = current.parent;
  }
  return false;
}

/** Human-readable hierarchy path, for forensic reporting. */
export function worldPath(object: THREE.Object3D): string {
  const parts: string[] = [];
  let current: THREE.Object3D | null = object;
  while (current) {
    parts.unshift(current.name || current.type);
    current = current.parent;
  }
  return parts.join('/');
}
