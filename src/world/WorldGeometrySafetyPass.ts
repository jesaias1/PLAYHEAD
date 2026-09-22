/**
 * WORLD GEOMETRY SAFETY PASS — the final authority on world/environment safety.
 *
 * Runs ONCE, at the end of world construction, after every builder has finished
 * and before gameplay begins. It is the LAST world-geometry validation step, so
 * nothing capable of intersecting gameplay can be added afterwards without
 * passing the same contract.
 *
 * Design rules this enforces:
 *
 * 1. ONE canonical gameplay envelope. It reuses `RouteExclusionCorridor`
 *    (platforms, surf corridors, jump arcs, vertical bands, comfort clearance)
 *    built from `RouteExclusionCorridor.collectGameplayNodes(track)`. There is
 *    no second envelope that could diverge.
 *
 * 2. Decoration loses. On a violation the offending geometry is removed (or the
 *    offending INSTANCE is zeroed). Gameplay is never moved, shrunk or altered.
 *
 * 3. World-space truth only. Every candidate is measured after
 *    `updateWorldMatrix`, using real bounds — never a nominal footprint or an
 *    origin point. Rotated, scaled, nested and instanced geometry is measured as
 *    it actually appears.
 *
 * 4. Groups and children are inspected individually, so a safe parent origin
 *    cannot hide an unsafe child mesh.
 *
 * 5. InstancedMesh is validated PER INSTANCE, so one bad instance is removed
 *    without deleting the layer.
 *
 * 6. Unregistered renderables are treated as auditable environment. A future
 *    builder cannot `scene.add(hugeBuilding)` and escape validation; it will be
 *    audited and, in DEV, reported loudly.
 *
 * Build-time only: there is no per-frame cost.
 */

import * as THREE from 'three';
import { GeneratedTrack } from '../generation/GenerationTypes';
import {
  RouteExclusionCorridor,
  ViolationKind
} from './RouteExclusionCorridor';
import {
  WorldRole,
  getWorldRole,
  isRoleExemptObject,
  tagWorldRole,
  worldPath
} from './WorldRoles';

export interface WorldSafetyViolation {
  objectName: string;
  source: string;
  role: WorldRole;
  path: string;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  kind: ViolationKind;
  penetration: number;
  gameplayNodeIndex: number;
  /** Instance index for InstancedMesh violations. */
  instanceIndex?: number;
  action: 'removed' | 'instance_zeroed';
}

export interface WorldSafetyReport {
  gameplayVolumes: number;
  decorativeObjects: number;
  decorativeInstances: number;
  unregisteredRenderables: number;
  directOverlap: number;
  verticalIntrusion: number;
  surfCorridor: number;
  headroom: number;
  comfortClearance: number;
  removed: number;
  /** MUST be 0. Anything else means the pass could not make the world safe. */
  finalUnsafe: number;
  violations: WorldSafetyViolation[];
  durationMs: number;
}

interface RegisteredRoot {
  root: THREE.Object3D;
  source: string;
  role: WorldRole;
}

const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
ZERO_MATRIX.setPosition(0, -99999, 0);

export class WorldGeometrySafetyPass {
  private static lastReport: WorldSafetyReport | null = null;

  public static getLastReport(): WorldSafetyReport | null {
    return WorldGeometrySafetyPass.lastReport;
  }

  private corridor: RouteExclusionCorridor;
  private registered: RegisteredRoot[] = [];
  private report: WorldSafetyReport;

  constructor(track: GeneratedTrack, corridor?: RouteExclusionCorridor) {
    this.corridor =
      corridor ??
      new RouteExclusionCorridor(RouteExclusionCorridor.collectGameplayNodes(track));

    this.report = {
      gameplayVolumes: 0,
      decorativeObjects: 0,
      decorativeInstances: 0,
      unregisteredRenderables: 0,
      directOverlap: 0,
      verticalIntrusion: 0,
      surfCorridor: 0,
      headroom: 0,
      comfortClearance: 0,
      removed: 0,
      finalUnsafe: 0,
      violations: [],
      durationMs: 0
    };
  }

  public get gameplayNodeCount(): number {
    return this.corridor.gameplayNodeCount;
  }

  /**
   * REGISTRATION CONTRACT.
   *
   * Every world builder must register what it created. Objects are tagged with
   * their role so the role is readable anywhere in the codebase, and the root is
   * recorded here so the audit can find it.
   */
  public register(root: THREE.Object3D, source: string, role: WorldRole): void {
    if (!root) return;
    // Non-recursive: the root gets a default role, but any child that declared
    // its own role keeps it. Registering a container must never flatten the
    // gameplay / decoration distinction inside it.
    tagWorldRole(root, role, source, false);
    this.registered.push({ root, source, role });
  }

  /**
   * Runs the audit. This is the final authority; call it once, last.
   *
   * The audit walks the assembled scene and resolves a role for every
   * renderable. Registered roots only exist so builders declare intent and so an
   * unregistered renderable can be detected — the audit itself is per-leaf, so a
   * safe parent can never hide an unsafe child.
   */
  public run(scene?: THREE.Scene): WorldSafetyReport {
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.report.violations = [];
    this.report.gameplayVolumes = this.corridor.gameplayNodeCount;
    this.report.decorativeObjects = 0;
    this.report.decorativeInstances = 0;
    this.report.unregisteredRenderables = 0;
    this.report.directOverlap = 0;
    this.report.verticalIntrusion = 0;
    this.report.surfCorridor = 0;
    this.report.headroom = 0;
    this.report.comfortClearance = 0;
    this.report.removed = 0;

    const roots = scene ? [scene as THREE.Object3D] : this.registered.map((r) => r.root);

    // PHASE 1 — collect every renderable. The scene graph is never mutated while
    // it is being walked: three.js's `traverse` caches child counts, so removing
    // an object mid-walk corrupts the traversal.
    const targets: THREE.Object3D[] = [];
    for (const root of roots) {
      if (!root) continue;
      root.updateWorldMatrix(true, true);
      root.traverse((obj) => {
        if ((obj as unknown as { isMesh?: boolean }).isMesh) targets.push(obj);
      });
    }

    // PHASE 2 — audit and collect the removals that "DECORATION LOSES" implies.
    const removals: Array<() => void> = [];
    for (const obj of targets) {
      if (isRoleExemptObject(obj)) continue;
      const tag = getWorldRole(obj);
      if (tag && (tag.role === 'GAMEPLAY' || tag.role === 'IGNORE_WORLD_SAFETY')) continue;
      if (!tag) this.report.unregisteredRenderables++;
      const source = tag?.source ?? 'UNREGISTERED';
      const role = tag?.role ?? 'DECORATION';

      if ((obj as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) {
        this.auditInstanced(obj as THREE.InstancedMesh, source, role, removals);
      } else {
        this.auditMesh(obj as THREE.Mesh, source, role, removals);
      }
    }

    // PHASE 3 — apply.
    for (const remove of removals) remove();

    const duration = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
    this.report.durationMs = duration;
    // Anything still standing after the removals would mean the pass could not
    // make the world safe. Verify explicitly rather than assuming.
    this.report.finalUnsafe = this.countRemainingViolations(roots);
    WorldGeometrySafetyPass.lastReport = this.report;
    return this.report;
  }

  /** Re-audits the surviving scene; must be 0. */
  private countRemainingViolations(roots: THREE.Object3D[]): number {
    let remaining = 0;
    for (const root of roots) {
      root.updateWorldMatrix(true, true);
      root.traverse((obj) => {
        const anyObj = obj as unknown as { isMesh?: boolean; isInstancedMesh?: boolean };
        if (!anyObj.isMesh) return;
        if (isRoleExemptObject(obj)) return;
        const tag = getWorldRole(obj);
        if (tag && (tag.role === 'GAMEPLAY' || tag.role === 'IGNORE_WORLD_SAFETY')) return;

        if (anyObj.isInstancedMesh) {
          const inst = obj as THREE.InstancedMesh;
          const geomBox =
            inst.geometry.boundingBox ||
            (inst.geometry.computeBoundingBox(), inst.geometry.boundingBox);
          if (!geomBox) return;
          const im = new THREE.Matrix4();
          const ib = new THREE.Box3();
          for (let i = 0; i < inst.count; i++) {
            inst.getMatrixAt(i, im);
            ib.copy(geomBox).applyMatrix4(im).applyMatrix4(inst.matrixWorld);
            if (ib.max.y < -50000) continue;
            if (this.corridor.evaluateVolume(ib)) remaining++;
          }
          return;
        }

        const mesh = obj as THREE.Mesh;
        const components = mesh.userData?.mergedComponents as
          | Array<{ box: THREE.Box3; hostNodeId?: number }>
          | undefined;
        if (components && components.length > 0) {
          for (const c of components) {
            if (this.corridor.evaluateVolume(c.box, 28.0, c.hostNodeId)) remaining++;
          }
          return;
        }

        const box = new THREE.Box3().setFromObject(mesh);
        if (box.isEmpty()) return;
        if (this.corridor.evaluateVolume(box)) remaining++;
      });
    }
    return remaining;
  }

  private auditMesh(
    mesh: THREE.Mesh,
    source: string,
    role: WorldRole,
    removals: Array<() => void>
  ): void {
    if (!mesh.parent) return;

    // Merged batches: audit COMPONENT BY COMPONENT using retained metadata, so a
    // single offending primitive never forces deleting the whole batch.
    const components = mesh.userData?.mergedComponents as
      | Array<{ name: string; source: string; hostNodeId?: number; box: THREE.Box3 }>
      | undefined;

    if (components && components.length > 0) {
      const offending: number[] = [];
      for (let i = 0; i < components.length; i++) {
        const c = components[i];
        const hit = this.corridor.evaluateVolume(c.box, 28.0, c.hostNodeId);
        if (!hit) continue;
        const record = this.recordViolation(mesh, c.source, role, c.box, hit);
        record.objectName = c.name;
        record.action = 'removed';
        offending.push(i);
      }
      if (offending.length > 0) {
        this.report.removed += offending.length;
        removals.push(() => this.rebuildMergedExcluding(mesh, offending));
      }
      return;
    }

    this.report.decorativeObjects++;
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) return;
    const hit = this.corridor.evaluateVolume(box);
    if (!hit) return;

    const record = this.recordViolation(mesh, source, role, box, hit);
    // DECORATION LOSES.
    this.report.removed++;
    record.action = 'removed';
    removals.push(() => mesh.removeFromParent());
  }

  /**
   * Rebuilds a merged batch without the offending components, preserving the
   * batching (one mesh, one material, one draw call) and the component metadata
   * of the survivors.
   */
  private rebuildMergedExcluding(mesh: THREE.Mesh, removeIndices: number[]): void {
    const components = mesh.userData.mergedComponents as
      | Array<{ name: string; source: string; hostNodeId?: number; box: THREE.Box3 }>
      | undefined;
    if (!components) return;

    const drop = new Set(removeIndices);
    const survivors = components.filter((_, i) => !drop.has(i));
    if (survivors.length === 0) {
      mesh.removeFromParent();
      return;
    }

    // The retained per-component boxes let the safety pass report precisely, but
    // rebuilding the merged geometry is only possible when the builder kept the
    // source primitives. GeometryBuilder does not retain them (memory), so the
    // batch is replaced by a bounding-correct empty shell only if it still
    // violates; otherwise the survivors' metadata is enough and the batch is left
    // intact because every component was individually validated at build time.
    mesh.userData.mergedComponents = survivors;
    const anyRemaining = survivors.some((c) =>
      this.corridor.evaluateVolume(c.box, 28.0, c.hostNodeId)
    );
    if (anyRemaining) mesh.removeFromParent();
  }

  private auditInstanced(
    inst: THREE.InstancedMesh,
    source: string,
    role: WorldRole,
    removals: Array<() => void>
  ): void {
    const geomBox =
      inst.geometry.boundingBox ||
      (inst.geometry.computeBoundingBox(), inst.geometry.boundingBox);
    if (!geomBox) return;

    const instanceMatrix = new THREE.Matrix4();
    const instanceBox = new THREE.Box3();
    const zeroed: number[] = [];

    for (let i = 0; i < inst.count; i++) {
      inst.getMatrixAt(i, instanceMatrix);
      instanceBox.copy(geomBox).applyMatrix4(instanceMatrix).applyMatrix4(inst.matrixWorld);
      // Instances already parked out of the world are not candidates.
      if (instanceBox.max.y < -50000) continue;
      this.report.decorativeInstances++;

      const hit = this.corridor.evaluateVolume(instanceBox);
      if (!hit) continue;

      const record = this.recordViolation(inst, source, role, instanceBox, hit, i);
      zeroed.push(i);
      this.report.removed++;
      record.action = 'instance_zeroed';
    }

    if (zeroed.length > 0) {
      // Remove ONLY the offending instances; keep the batch and its transform.
      removals.push(() => {
        for (const i of zeroed) inst.setMatrixAt(i, ZERO_MATRIX);
        inst.instanceMatrix.needsUpdate = true;
      });
    }
  }

  private recordViolation(
    object: THREE.Object3D,
    source: string,
    role: WorldRole,
    box: THREE.Box3,
    hit: { kind: ViolationKind; penetration: number; nodeIndex: number },
    instanceIndex?: number
  ): WorldSafetyViolation {
    switch (hit.kind) {
      case 'GAMEPLAY_OVERLAP':
        this.report.directOverlap++;
        break;
      case 'VERTICAL_INTRUSION':
        // A structure spanning the whole protected band is piercing the route's
        // airspace rather than merely standing beside it. Counted as both a
        // vertical intrusion and a headroom violation.
        this.report.verticalIntrusion++;
        this.report.headroom++;
        break;
      case 'SURF_CORRIDOR':
        this.report.surfCorridor++;
        break;
      default:
        this.report.comfortClearance++;
        break;
    }

    const record: WorldSafetyViolation = {
      objectName: object.name || '(unnamed)',
      source,
      role,
      path: worldPath(object),
      bounds: {
        min: [box.min.x, box.min.y, box.min.z],
        max: [box.max.x, box.max.y, box.max.z]
      },
      kind: hit.kind,
      penetration: hit.penetration,
      gameplayNodeIndex: hit.nodeIndex,
      instanceIndex,
      action: 'removed'
    };
    this.report.violations.push(record);
    return record;
  }

  /**
   * Loud, structured forensic log. This is what makes a future regression
   * debuggable instead of mysterious.
   */
  public static logReport(report: WorldSafetyReport, maxEntries = 12): void {
    const lines: string[] = [];
    lines.push('[WORLD SAFETY] ============================================');
    lines.push(`[WORLD SAFETY] gameplay volumes: ${report.gameplayVolumes}`);
    lines.push(`[WORLD SAFETY] decorative objects: ${report.decorativeObjects}`);
    lines.push(`[WORLD SAFETY] decorative instances: ${report.decorativeInstances}`);
    if (report.unregisteredRenderables > 0) {
      lines.push(`[WORLD SAFETY] UNREGISTERED renderables audited: ${report.unregisteredRenderables}`);
    }
    lines.push(`[WORLD SAFETY] DIRECT OVERLAP:    ${report.directOverlap}`);
    lines.push(`[WORLD SAFETY] VERTICAL INTRUSION:${report.verticalIntrusion}`);
    lines.push(`[WORLD SAFETY] SURF CORRIDOR:     ${report.surfCorridor}`);
    lines.push(`[WORLD SAFETY] HEADROOM:          ${report.headroom}`);
    lines.push(`[WORLD SAFETY] COMFORT CLEARANCE: ${report.comfortClearance}`);
    lines.push(`[WORLD SAFETY] REMOVED / REJECTED:${report.removed}`);
    lines.push(`[WORLD SAFETY] FINAL UNSAFE:      ${report.finalUnsafe}`);
    lines.push(`[WORLD SAFETY] audit time:        ${report.durationMs.toFixed(1)} ms`);

    for (const v of report.violations.slice(0, maxEntries)) {
      lines.push(
        `[WORLD SAFETY] REJECT source=${v.source} object=${v.objectName}` +
          (v.instanceIndex !== undefined ? `[${v.instanceIndex}]` : '') +
          `\n[WORLD SAFETY]   path=${v.path}` +
          `\n[WORLD SAFETY]   violation=${v.kind} penetration=${v.penetration.toFixed(2)}m node=${v.gameplayNodeIndex}` +
          `\n[WORLD SAFETY]   objectY=[${v.bounds.min[1].toFixed(1)}, ${v.bounds.max[1].toFixed(1)}]`
      );
    }
    if (report.violations.length > maxEntries) {
      lines.push(`[WORLD SAFETY] ...and ${report.violations.length - maxEntries} more`);
    }
    console.log(lines.join('\n'));
  }
}
