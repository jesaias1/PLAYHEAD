/**
 * REMOTE GHOST — WORLD SAFETY SURVIVAL + DEV PROBES.
 *
 * THE BUG THIS FILE EXISTS FOR
 *
 *   The remote opponent was created, attached to the scene, fed live transforms,
 *   positioned correctly, marked visible — and rendered NOTHING.
 *
 *   `World.loadTrack()` runs the world geometry safety pass over the WHOLE scene:
 *
 *       safetyPass.run(this.scene)        // World.ts
 *
 *   Phase 1 collects every MESH in the scene. Phase 2 resolves a role per leaf:
 *
 *       if (isRoleExemptObject(obj)) continue;         // checked the MESH
 *       const tag = getWorldRole(obj);                 // walked ancestors
 *       const role = tag?.role ?? 'DECORATION';        // fell back to DECORATION
 *
 *   `GhostVisual` set `worldSafetyExempt` / `devHelper` on its GROUP and never
 *   tagged a world role. So the check on the child MESH was false, no role was
 *   found, and the body and trace were audited as unregistered DECORATION.
 *
 *   A ghost is created at the world origin, and the route's first node is the
 *   origin, so its bounding box intersected the gameplay corridor immediately.
 *   DECORATION LOSES: both meshes were `removeFromParent()`'d on the first map
 *   load. The group survived with zero children and could never draw again.
 *
 *   The solo ghosts escaped only by timing: `GhostManager.prepareTrack()` runs on
 *   entering COUNTDOWN, i.e. AFTER the audit. The remote ghost is created at boot
 *   in `initOnline()`, so it was always present for the audit.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';

import { GhostVisual } from '../src/replay/GhostVisual';
import { WorldGeometrySafetyPass } from '../src/world/WorldGeometrySafetyPass';
import { isRoleExemptObject, getWorldRole } from '../src/world/WorldRoles';
import { GeneratedTrack, RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';
import {
  DEBUG_MARKER_COLOR,
  DEBUG_MARKER_SIZE,
  DEBUG_OFFSET_X,
  LIVE_MS,
  RemoteGhostRenderer,
  SAMPLE_REJECT_MS
} from '../src/online/RemoteGhostRenderer';
import type { GhostSample } from '../src/online/RaceRoomService';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function node(id: number, x: number, y: number, z: number): RouteNode {
  return {
    id,
    time: id,
    position: { x, y, z },
    dimensions: { x: 16, y: 2, z: 24 },
    yaw: 0,
    pitch: 0,
    roll: 0,
    type: RouteNodeType.RUNWAY,
    intensity: 0.5,
    sectionIndex: 0,
    arcLength: id * 30,
    isSurf: false,
    isBoost: false
  };
}

/** A route that starts at the world ORIGIN, exactly like a real generated track. */
function originTrack(): GeneratedTrack {
  return {
    seed: 1,
    route: [node(0, 0, 0, 0), node(1, 0, 0, 40), node(2, 0, 0, 80)],
    checkpoints: [],
    finish: { routeNodeId: 2, time: 10, position: { x: 0, y: 0, z: 80 }, yaw: 0 },
    totalDistance: 80,
    targetDuration: 10,
    repairedJumpsCount: 0
  } as unknown as GeneratedTrack;
}

/** Runs the real safety pass over a scene, exactly as World.loadTrack does. */
function auditScene(scene: THREE.Scene): { removed: number; unregistered: number } {
  const pass = new WorldGeometrySafetyPass(originTrack());
  const report = pass.run(scene);
  return { removed: report.removed, unregistered: report.unregisteredRenderables };
}

function sample(over: Partial<GhostSample> = {}): GhostSample {
  return {
    userId: 'remote-player',
    t: Date.now(),
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    running: true,
    attempt: 0,
    ...over
  };
}

// ---------------------------------------------------------------------------
// 1. THE REGRESSION — the ghost must survive the world safety pass
// ---------------------------------------------------------------------------

describe('Remote ghost survives the world safety pass', () => {
  it('a plain untagged mesh at the origin IS removed (the trap is real)', () => {
    // Proves the audit actually reaches and deletes decoration sitting on the
    // route, so the ghost's survival below is meaningful rather than vacuous.
    const scene = new THREE.Scene();
    const victim = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial()
    );
    scene.add(victim);
    const { removed } = auditScene(scene);
    expect(removed).toBeGreaterThan(0);
    expect(victim.parent).toBeNull();
  });

  it('the remote ghost keeps BOTH of its meshes after the audit', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    expect(remote.group.children).toHaveLength(2);

    const { removed } = auditScene(scene);

    // THE FIX: the ghost is untouched and still has something to draw.
    expect(remote.group.children).toHaveLength(2);
    expect(remote.group.parent).toBe(scene);
    expect(removed).toBe(0);
    expect(remote.group.children.every((c) => c.parent === remote.group)).toBe(true);
  });

  it('the ghost is no longer counted as an unregistered renderable', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    const { unregistered } = auditScene(scene);
    expect(unregistered).toBe(0);
  });

  it('the ghost still renders after the audit', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    auditScene(scene);

    remote.setSample(sample({ x: 0, y: 1.5, z: 10 }));
    remote.update(1 / 60, new THREE.Vector3(0, 1.5, 0));

    const diag = remote.getDiagnostics();
    expect(diag.childCount).toBe(2);
    expect(diag.attached).toBe(true);
    expect(diag.rootVisible).toBe(true);
    expect(diag.state).toBe('LIVE');
    expect(diag.materialAlpha).toBeGreaterThan(0);
  });

  it('GhostVisual tags a world role on the group AND every mesh', () => {
    const scene = new THREE.Scene();
    const visual = new GhostVisual(scene, { color: 0x9d8cff });
    // The group is tagged...
    expect(getWorldRole(visual.group)?.role).toBe('IGNORE_WORLD_SAFETY');
    // ...and so is each mesh, which is what the per-leaf audit actually reads.
    for (const child of visual.group.children) {
      expect(getWorldRole(child)?.role, child.type).toBe('IGNORE_WORLD_SAFETY');
      expect(isRoleExemptObject(child), child.type).toBe(true);
    }
    visual.dispose();
  });

  it('a group-level exemption flag now protects its children', () => {
    // The ancestor walk is the structural fix: the old check read only the
    // object's own userData, which is why a group flag was silently useless.
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.userData.worldSafetyExempt = true;
    const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    group.add(child);
    scene.add(group);

    expect(isRoleExemptObject(child)).toBe(true);
    const { removed } = auditScene(scene);
    expect(removed).toBe(0);
    expect(child.parent).toBe(group);
  });

  it('a devHelper flag on a group also protects its children', () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.userData.devHelper = true;
    const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    group.add(child);
    scene.add(group);
    expect(isRoleExemptObject(child)).toBe(true);
    expect(auditScene(scene).removed).toBe(0);
  });

  it('the audit still removes genuine unsafe decoration', () => {
    // The fix must not blunt the pass: real decoration on the route still loses.
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    const bad = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 6), new THREE.MeshBasicMaterial());
    bad.position.set(0, 2, 20);
    scene.add(bad);

    const { removed } = auditScene(scene);
    expect(removed).toBeGreaterThan(0);
    expect(bad.parent).toBeNull();
    expect(remote.group.children).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 2. DEV debug marker
// ---------------------------------------------------------------------------

describe('Remote debug marker', () => {
  it('is OFF by default and creates nothing', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    expect(remote.isDebugMarkerEnabled()).toBe(false);
    expect(scene.children.some((c) => c.name === 'RemoteDebugMarker')).toBe(false);
    expect(remote.getDiagnostics().debugMarker).toBe('OFF');
  });

  it('is a scene SIBLING, not a child of the ghost group', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    remote.setDebugMarker(true);
    const marker = scene.children.find((c) => c.name === 'RemoteDebugMarker');
    expect(marker).toBeDefined();
    // A child of an invisible or detached group would inherit the fault and
    // prove nothing, so it must be independent.
    expect(marker!.parent).toBe(scene);
    expect(remote.group.children.some((c) => c === marker)).toBe(false);
  });

  it('is unmistakable: magenta, wireframe, double-sided, 1 m, never culled', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    remote.setDebugMarker(true);
    const marker = scene.children.find((c) => c.name === 'RemoteDebugMarker') as THREE.Mesh;
    const material = marker.material as THREE.MeshBasicMaterial;

    expect(material.color.getHex()).toBe(DEBUG_MARKER_COLOR);
    expect(material.wireframe).toBe(true);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.transparent).toBe(false);
    expect(marker.frustumCulled).toBe(false);
    expect(DEBUG_MARKER_SIZE).toBe(1);
    const size = new THREE.Box3().setFromObject(marker).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(1, 3);
  });

  it('survives the world safety pass', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    remote.setDebugMarker(true);
    remote.setSample(sample({ x: 0, y: 1.5, z: 5 }));
    remote.update(1 / 60);
    const { removed } = auditScene(scene);
    expect(removed).toBe(0);
    expect(remote.getDiagnostics().debugMarker).toBe('VISIBLE');
  });

  it('sits at the RAW received transform, and hides with no sample', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    remote.setDebugMarker(true);
    const marker = scene.children.find((c) => c.name === 'RemoteDebugMarker') as THREE.Mesh;
    expect(marker.visible).toBe(false);

    remote.setSample(sample({ x: 7, y: 2, z: -3 }));
    remote.update(1 / 60);
    expect(marker.visible).toBe(true);
    expect(marker.position.x).toBeCloseTo(7, 3);
    expect(marker.position.y).toBeCloseTo(2, 3);
    expect(marker.position.z).toBeCloseTo(-3, 3);
  });

  it('is disposed cleanly when switched off', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    remote.setDebugMarker(true);
    expect(scene.children.some((c) => c.name === 'RemoteDebugMarker')).toBe(true);
    remote.setDebugMarker(false);
    expect(scene.children.some((c) => c.name === 'RemoteDebugMarker')).toBe(false);
    expect(remote.getDiagnostics().debugMarker).toBe('OFF');
  });
});

// ---------------------------------------------------------------------------
// 3. DEV offset and force-visible
// ---------------------------------------------------------------------------

describe('Remote debug offset', () => {
  it('shifts the RENDERED pose only, never the stored transform', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    remote.setDebugOffset(true);
    remote.setSample(sample({ x: 0, y: 1.5, z: 0 }));
    for (let i = 0; i < 60; i++) remote.update(1 / 60);

    const diag = remote.getDiagnostics();
    // The raw received transform is untouched...
    expect(diag.rxPosition!.x).toBeCloseTo(0, 5);
    // ...while the rendered position carries the offset.
    expect(diag.ghostLocal.x).toBeCloseTo(DEBUG_OFFSET_X, 1);
    expect(DEBUG_OFFSET_X).toBe(1.5);
  });

  it('shifts the debug marker by the same amount', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    remote.setDebugMarker(true);
    remote.setDebugOffset(true);
    remote.setSample(sample({ x: 0, y: 0, z: 0 }));
    remote.update(1 / 60);
    const marker = scene.children.find((c) => c.name === 'RemoteDebugMarker') as THREE.Mesh;
    expect(marker.position.x).toBeCloseTo(DEBUG_OFFSET_X, 3);
  });

  it('never leaks into the interpolated pose when switched off', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    remote.setDebugOffset(true);
    remote.setSample(sample({ x: 0, y: 1.5, z: 0 }));
    for (let i = 0; i < 60; i++) remote.update(1 / 60);
    remote.setDebugOffset(false);
    for (let i = 0; i < 60; i++) remote.update(1 / 60);
    expect(remote.getDiagnostics().ghostLocal.x).toBeCloseTo(0, 1);
  });
});

describe('Force remote visible', () => {
  it('renders a stale opponent that would otherwise be held or hidden', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    remote.setForceVisible(true);
    remote.setSample(sample({ x: 4, y: 1.5, z: 4 }));
    // Age far past every gate.
    (remote as unknown as { lastSampleAt: number }).lastSampleAt = Date.now() - 60_000;
    remote.update(1 / 60, new THREE.Vector3(0, 0, 0));

    const diag = remote.getDiagnostics();
    expect(diag.forceVisible).toBe(true);
    expect(diag.rootVisible).toBe(true);
    // Full alpha, not the hold dim.
    expect(diag.materialAlpha).toBeGreaterThan(0.3);
    // Still the REAL transform.
    expect(diag.ghostLocal.x).toBeCloseTo(4, 1);
    expect(diag.ghostLocal.z).toBeCloseTo(4, 1);
  });

  it('still draws nothing without a transform', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    remote.setForceVisible(true);
    remote.update(1 / 60);
    expect(remote.getDiagnostics().rootVisible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Diagnostics surface
// ---------------------------------------------------------------------------

describe('Remote ghost diagnostics surface', () => {
  it('reports every field the two-browser test needs', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 1000);
    camera.position.set(0, 2, 0);
    // Default camera orientation looks down -Z, so place the opponent in front.
    camera.updateMatrixWorld(true);

    remote.setSample(sample({ x: 0, y: 2, z: -10 }));
    remote.update(1 / 60, new THREE.Vector3(0, 2, 0));
    const d = remote.getDiagnostics(Date.now(), camera);

    expect(d.rxPosition).toEqual({ x: 0, y: 2, z: -10 });
    expect(d.ghostLocal.z).toBeLessThan(0);
    expect(d.ghostWorld.z).toBeCloseTo(d.ghostLocal.z, 5);
    expect(d.attached).toBe(true);
    expect(d.rootVisible).toBe(true);
    expect(d.rootScale).toEqual({ x: 1, y: 1, z: 1 });
    expect(d.childCount).toBe(2);
    expect(d.cameraDistanceM).toBeGreaterThan(0);
    expect(d.frustum).toBe('IN');
    expect(d.cameraLayerMask).toBe(1);
    expect(d.ghostLayerMask).toBe(1);
    expect(d.materialAlpha).toBeGreaterThan(0);
    expect(d.materialVisible).toBe(true);
    expect(typeof d.frustumCulled).toBe('boolean');
    expect(d.debugMarker).toBe('OFF');
  });

  it('reports OUT when the opponent is behind the camera', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 1000);
    camera.position.set(0, 2, 0);
    camera.lookAt(0, 2, -10);
    camera.updateMatrixWorld(true);

    remote.setSample(sample({ x: 0, y: 2, z: 400 }));
    remote.update(1 / 60, new THREE.Vector3(0, 2, 0));
    expect(remote.getDiagnostics(Date.now(), camera).frustum).toBe('OUT');
  });

  it('ghost and camera share the default layer', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    const camera = new THREE.PerspectiveCamera();
    // Neither the ghost nor the gameplay camera inherits a replay/viewmodel layer.
    expect(remote.group.layers.mask).toBe(camera.layers.mask);
    for (const child of remote.group.children) {
      expect(child.layers.mask).toBe(camera.layers.mask);
    }
  });

  it('never reports zero alpha while LIVE', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    remote.setSample(sample({ x: 0, y: 0, z: 5 }));
    for (let i = 0; i < 10; i++) {
      remote.setSample(sample({ x: 0, y: 0, z: 5 }));
      remote.update(1 / 60);
      const d = remote.getDiagnostics();
      if (d.state === 'LIVE') {
        expect(d.materialAlpha).toBeGreaterThan(0);
        expect(d.materialVisible).toBe(true);
      }
    }
  });

  it('never reports a degenerate scale', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    remote.setSample(sample());
    remote.update(1 / 60);
    const s = remote.getDiagnostics().rootScale;
    expect(s.x).toBe(1);
    expect(s.y).toBe(1);
    expect(s.z).toBe(1);
  });

  it('the ghost is human-sized in world units', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    remote.setSample(sample({ x: 0, y: 0, z: 0 }));
    remote.update(1 / 60);
    const box = new THREE.Box3().setFromObject(remote.group);
    const size = box.getSize(new THREE.Vector3());
    expect(size.y).toBeGreaterThan(1.2);
    expect(size.y).toBeLessThan(3.0);
    expect(size.x).toBeGreaterThan(0.4);
  });

  it('the game passes the gameplay camera into the diagnostics', () => {
    const src = readGame();
    expect(src).toMatch(/this\.raceGhost\?\.getDiagnostics\(Date\.now\(\), camera\)/);
    expect(src).toMatch(/const camera = this\.environment\.camera;/);
  });

  it('the DEV probe switches are wired from the F3 overlay', () => {
    const src = readGame();
    expect(src).toMatch(/this\.devOverlay\.onRaceProbeChange = \(state\) => \{/);
    expect(src).toMatch(/setDebugMarker\(state\.marker\)/);
    expect(src).toMatch(/setDebugOffset\(state\.offset\)/);
    expect(src).toMatch(/setForceVisible\(state\.force\)/);
  });

  it('the DEV probes default OFF and are never enabled by production code', () => {
    const src = readGame();
    expect(src).not.toMatch(/setDebugMarker\(true\)/);
    expect(src).not.toMatch(/setForceVisible\(true\)/);
    expect(src).not.toMatch(/setDebugOffset\(true\)/);
  });
});

function readGame(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(
    path.join(path.resolve(__dirname, '..'), 'src', 'core', 'Game.ts'),
    'utf8'
  );
}

// ---------------------------------------------------------------------------
// 5. Receiver filters unchanged
// ---------------------------------------------------------------------------

describe('Remote ghost filters unchanged', () => {
  it('drops genuinely stale packets and rejects our own transform', () => {
    const remote = new RemoteGhostRenderer(new THREE.Scene());
    remote.setSample(sample({ t: Date.now() - (SAMPLE_REJECT_MS + 500) }));
    expect(remote.getDiagnostics().hasTarget).toBe(false);
    expect(LIVE_MS).toBeGreaterThan(0);
  });

  it('a sample exactly at the live boundary still holds rather than vanishing', () => {
    const scene = new THREE.Scene();
    const remote = new RemoteGhostRenderer(scene);
    remote.setSample(sample({ x: 0, y: 0, z: 0 }));
    (remote as unknown as { lastSampleAt: number }).lastSampleAt = Date.now() - (LIVE_MS + 50);
    remote.update(1 / 60);
    const d = remote.getDiagnostics();
    expect(d.state).toBe('STALE_HOLD');
    expect(d.rootVisible).toBe(true);
    expect(d.childCount).toBe(2);
  });
});

beforeEach(() => {
  // Nothing global to reset; each test builds its own scene and renderer.
});
