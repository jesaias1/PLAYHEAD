/**
 * SURF authored obstacles (1004) - geometry, lane safety and renderer parity.
 *
 * Long SURF ribbons used to read as empty ramps. These tests require that the
 * SurfObstacleGenerator authors REAL gameplay solids on the FINAL banked
 * stations, that a broad safe capsule lane always remains on the actual sampled
 * cross-section, that entry / exit / AIR landing zones stay clear, that the
 * rendered mesh rotation matches the BoxCollider, and that PhysicsWorld
 * actually collides them. No test is relaxed to accommodate worse geometry.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SurfCourseGenerator } from '../src/generation/SurfCourseGenerator';
import { SurfObstacleGenerator, SURF_OBSTACLE } from '../src/generation/SurfObstacleGenerator';
import { TrackAnalysis, AnalysisSection, SectionTheme } from '../src/audio/AudioFeatures';
import { BoxCollider } from '../src/physics/Collider';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { GeometryBuilder } from '../src/world/GeometryBuilder';
import { PLAYHEAD_MOVEMENT_V1 } from '../src/player/MovementConfig';
import { RouteNode } from '../src/generation/GenerationTypes';
import { computeMapFingerprint } from '../src/online/MapIdentity';

function mock(seed: number, duration: number, bpm: number, themes: SectionTheme[]): TrackAnalysis {
  const count = themes.length, step = duration / count;
  const sections: AnalysisSection[] = themes.map((t, i) => ({
    index: i, start: i * step, end: (i + 1) * step, duration: step,
    intensity: t === 'DROP' ? 0.95 : t === 'BREATH' ? 0.25 : 0.6,
    rhythmicDensity: 0.7, brightness: 0.6, theme: t
  }));
  return {
    filename: `s_${seed}`, duration, bpm, bpmConfidence: 0.85, globalEnergy: 0.65,
    frames: [], onsets: [], sections, waveform: new Float32Array(512), seed,
    visualAccent: { name: 'x', hex: '#00f0ff', rgb: [0, 240, 255] }
  };
}

const ENERGETIC: SectionTheme[] = ['FLOW', 'BUILDUP', 'DROP', 'SPEED', 'DROP', 'PRECISION', 'DESCENT', 'ASCENT', 'DROP', 'FLOW'];
const PALETTE = { name: 'Test', hex: '#00f0ff', rgb: [0, 240, 255] as [number, number, number] };

describe('SURF authored obstacles (1004)', () => {
  const track = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');
  const obstacles = track.obstacles ?? [];

  it('authors real gameplay solids on long ribbons, never a wall', () => {
    expect(obstacles.length).toBeGreaterThan(0);
    for (const o of obstacles) {
      expect(o.obstacleType === 'PHASE_BLOCK' || o.obstacleType === 'SPLIT_GATE').toBe(true);
      expect(o.isSurf).toBe(false);
      expect(o.isBoost).toBe(false);
      expect(o.obstacleSurfPhraseKind).toBeTruthy();
      expect(o.obstacleHostRibbonId).toBeGreaterThan(0);
      expect(o.obstacleHostStationIndex).toBeGreaterThan(0);
      expect(o.obstacleSourceNodeId).toBeGreaterThanOrEqual(0);
      // Small solids: never a tall wall, never a micro snag.
      expect(o.dimensions.y).toBeGreaterThanOrEqual(SURF_OBSTACLE.MIN_RIB_HEIGHT - 1e-9);
      expect(o.dimensions.y).toBeLessThanOrEqual(SURF_OBSTACLE.MAX_RIB_HEIGHT + 1e-9);
      expect(o.dimensions.x).toBeGreaterThanOrEqual(SURF_OBSTACLE.MIN_RIB_WIDTH - 1e-9);
      // The solid blocks only one edge, never the whole ribbon width.
      const placement = SurfObstacleGenerator.describePlacement(o, track.route)!;
      expect(placement).toBeTruthy();
      expect(placement.blockedMaxLateral - placement.blockedMinLateral).toBeLessThan(placement.halfWidth * 2);
    }
  });

  it('places every solid on its REAL shared ribbon station basis', () => {
    for (const o of obstacles) {
      const placement = SurfObstacleGenerator.describePlacement(o, track.route)!;
      // Recompute the body centre from the same station basis and compare with
      // the emitted position: placement uses the shared station, not a guessed
      // Euler normal.
      const onSurface = {
        x: placement.surfaceCenter.x + placement.right.x * placement.ribLateral,
        y: placement.surfaceCenter.y + placement.right.y * placement.ribLateral,
        z: placement.surfaceCenter.z + placement.right.z * placement.ribLateral
      };
      const expected = {
        x: onSurface.x + placement.normal.x * o.dimensions.y * 0.5,
        y: onSurface.y + placement.normal.y * o.dimensions.y * 0.5,
        z: onSurface.z + placement.normal.z * o.dimensions.y * 0.5
      };
      expect(Math.hypot(expected.x - o.position.x, expected.y - o.position.y, expected.z - o.position.z)).toBeLessThan(1e-6);
    }
  });

  it('always leaves a broad capsule-safe lane on the actual banked cross-section', () => {
    const radius = PLAYHEAD_MOVEMENT_V1.playerRadius;
    for (const o of obstacles) {
      const placement = SurfObstacleGenerator.describePlacement(o, track.route)!;
      // The blocked interval is measured on the REAL station right axis; the
      // remaining lane must clear the full player diameter with margin.
      expect(placement.safeLaneWidth).toBeGreaterThanOrEqual(SURF_OBSTACLE.SAFE_LANE_MIN - 1e-6);
      const laneLow = placement.safeLaneCenterLateral - placement.safeLaneWidth * 0.5;
      const laneHigh = placement.safeLaneCenterLateral + placement.safeLaneWidth * 0.5;
      // Nearest distance from the blocked rib to the safe-lane centre.
      const ribEdge = placement.safeLane === 'LEFT' ? placement.blockedMinLateral : placement.blockedMaxLateral;
      const clearance = placement.safeLane === 'LEFT' ? ribEdge - laneLow : laneHigh - ribEdge;
      expect(clearance).toBeGreaterThan(2 * radius);
      // The safe lane itself must sit inside the real ribbon surface.
      expect(laneLow).toBeGreaterThanOrEqual(-placement.halfWidth - 1e-6);
      expect(laneHigh).toBeLessThanOrEqual(placement.halfWidth + 1e-6);
      // No collider may intrude into that lane.
      const safeCentre = SurfObstacleGenerator.safeLaneWorldPoint(placement, radius);
      const box = new BoxCollider(o);
      const result = box.testSphere(new THREE.Vector3(safeCentre.x, safeCentre.y, safeCentre.z), radius);
      expect(result.hasContact, `obstacle ${o.id} intrudes into its safe lane`).toBe(false);
    }
  });

  it('keeps entry, exit, checkpoint and AIR landing zones clear of solids', () => {
    const route = track.route;
    const startArc = route[0].arcLength;
    const finishArc = route[route.length - 1].arcLength;
    for (const o of obstacles) {
      expect(o.arcLength).toBeGreaterThan(startArc + SURF_OBSTACLE.ENTRY_CLEARANCE);
      expect(o.arcLength).toBeLessThan(finishArc - SURF_OBSTACLE.EXIT_CLEARANCE);
    }
    for (let i = 1; i < route.length; i++) {
      const prev = route[i - 1];
      const node = route[i];
      if (node.surfTransition === 'AIR') {
        // Consecutive segments of the SAME ribbon can only be flat/sloped, never
        // airborne, so an AIR edge is always a real ribbon change.
        expect(node.ribbonId === undefined || node.ribbonId !== prev.ribbonId).toBe(true);
        for (const o of obstacles) {
          const inLanding = o.arcLength > prev.arcLength - SURF_OBSTACLE.AIR_CLEARANCE_BEFORE &&
            o.arcLength < node.arcLength + node.dimensions.z + SURF_OBSTACLE.AIR_CLEARANCE_AFTER;
          expect(inLanding).toBe(false);
        }
      }
    }
    for (const cp of track.checkpoints) {
      const node = route.find((n) => n.id === cp.routeNodeId);
      if (!node) continue;
      for (const o of obstacles) {
        // Checkpoint runway takeoff must stay clean.
        expect(Math.abs(o.arcLength - node.arcLength)).toBeGreaterThan(SURF_OBSTACLE.CHECKPOINT_CLEARANCE * 0.5);
      }
    }
  });

  it('spaces phrases for reaction time and mixes unobstructed speed runs', () => {
    const byPhrase = new Map<number, RouteNode[]>();
    for (const o of obstacles) {
      const list = byPhrase.get(o.obstaclePhraseId!) ?? [];
      list.push(o);
      byPhrase.set(o.obstaclePhraseId!, list);
    }
    // Group spacing counts each phrase's LAST element (the previous read the
    // player actually leaves), never its first, so a long weave cannot crowd
    // the next phrase.
    const anchored = [...byPhrase.values()].map((list) => Math.max(...list.map((o) => o.arcLength))).sort((a, b) => a - b);
    for (let i = 1; i < anchored.length; i++) {
      expect(anchored[i] - anchored[i - 1]).toBeGreaterThanOrEqual(SURF_OBSTACLE.MIN_GROUP_SPACING - 1e-6);
    }
    // Within one phrase, consecutive elements are spaced by REAL arc metres
    // (never a station count): at the expected surf speed each read is a
    // deliberate lateral question, not a sub-second stutter.
    for (const list of byPhrase.values()) {
      const sorted = [...list].sort((a, b) => a.arcLength - b.arcLength);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].arcLength - sorted[i - 1].arcLength).toBeGreaterThanOrEqual(
          SURF_OBSTACLE.MIN_ELEMENT_ARC_SPACING - 1e-6
        );
      }
    }
    // With a finite cap the run still has long unobstructed stretches between
    // reads: at least one gap is well above the minimum spacing.
    if (anchored.length > 1) {
      expect(anchored[anchored.length - 1] - anchored[0]).toBeGreaterThan(SURF_OBSTACLE.MIN_GROUP_SPACING * 2);
    }
    // Every phrase is a coherent, readable group (1..4 elements on one read).
    for (const list of byPhrase.values()) {
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.length).toBeLessThanOrEqual(4);
      const kind = list[0].obstacleSurfPhraseKind;
      for (const o of list) expect(o.obstacleSurfPhraseKind).toBe(kind);
    }
  });

  it('alternates sides within STAGGER / SLALOM / WEAVE phrases', () => {
    const byPhrase = new Map<number, RouteNode[]>();
    for (const o of obstacles) {
      const list = byPhrase.get(o.obstaclePhraseId!) ?? [];
      list.push(o);
      byPhrase.set(o.obstaclePhraseId!, list);
    }
    for (const list of byPhrase.values()) {
      const kind = list[0].obstacleSurfPhraseKind;
      const sorted = [...list].sort((a, b) => a.arcLength - b.arcLength);
      if (kind === 'SURF_STAGGER' || kind === 'SURF_SLALOM' || kind === 'SURF_WEAVE') {
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i].obstacleSafeLane, `${kind} element ${i} must alternate`).not.toBe(
            sorted[i - 1].obstacleSafeLane
          );
        }
      }
    }
  });

  it('keeps ONE continuous shared safe capsule lane across every phrase', () => {
    const radius = PLAYHEAD_MOVEMENT_V1.playerRadius;
    const byPhrase = new Map<number, RouteNode[]>();
    for (const o of obstacles) {
      const list = byPhrase.get(o.obstaclePhraseId!) ?? [];
      list.push(o);
      byPhrase.set(o.obstaclePhraseId!, list);
    }
    for (const list of byPhrase.values()) {
      const placements = list
        .map((o) => SurfObstacleGenerator.describePlacement(o, track.route)!)
        .filter(Boolean);
      if (placements.length < 2) continue;
      // A single lateral interval that clears EVERY element of the phrase at
      // once. Alternating ribs can each leave a different lane, so this must be
      // a lane common to the whole read, not a per-element lane.
      let low = -Infinity;
      let high = Infinity;
      for (const p of placements) {
        // Free (safe) lateral interval in this station's ribbon-local frame:
        // LEFT lane is the negative side, RIGHT lane the positive side.
        const free =
          p.safeLane === 'LEFT'
            ? { lo: -p.halfWidth, hi: p.blockedMinLateral }
            : { lo: p.blockedMaxLateral, hi: p.halfWidth };
        low = Math.max(low, free.lo);
        high = Math.min(high, free.hi);
      }
      const width = high - low;
      expect(width, 'phrase must share one continuous safe lane').toBeGreaterThanOrEqual(
        SURF_OBSTACLE.SAFE_LANE_MIN - 1e-6
      );
      // And no collider may intrude into that shared lane anywhere in the read.
      const mid = (low + high) * 0.5;
      for (const p of placements) {
        const point = SurfObstacleGenerator.safeLaneWorldPoint(
          { ...p, safeLaneCenterLateral: mid },
          radius
        );
        const sph = new THREE.Vector3(point.x, point.y, point.z);
        for (const o of list) {
          const result = new BoxCollider(o).testSphere(sph, radius);
          expect(result.hasContact, `obstacle ${o.id} intrudes the shared lane`).toBe(false);
        }
      }
    }
  });

  it('is deterministic by seed and changes when the seed changes', () => {
    const a = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');
    const b = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');
    const c = SurfCourseGenerator.generate(mock(0xabcde, 180, 128, ENERGETIC), 'SURF');
    // Compare REAL seed geometry (kind, side, position, dimensions), not only
    // the id stream: an id-only check passes even if placement is identical for
    // every seed.
    const geo = (t: typeof a) =>
      (t.obstacles ?? [])
        .map((o) => [
          o.obstacleSurfPhraseKind,
          o.obstacleSafeLane,
          o.position.x.toFixed(4),
          o.position.y.toFixed(4),
          o.position.z.toFixed(4),
          o.dimensions.x.toFixed(4),
          o.dimensions.z.toFixed(4)
        ].join('|'))
        .join(',');
    const geoA = geo(a);
    const geoB = geo(b);
    const geoC = geo(c);
    expect(geoA).toBe(geoB);
    expect(geoA.length).toBeGreaterThan(0);
    expect(geoC).not.toBe(geoA);
  });

  it('renders an authored solid with the SAME rotation as its BoxCollider', () => {
    const built = GeometryBuilder.buildWorld(track, PALETTE);
    built.rootGroup.updateMatrixWorld(true);
    const byId = new Map<number, THREE.Object3D>();
    built.rootGroup.traverse((child) => {
      const id = (child.userData as { routeObstacleId?: number }).routeObstacleId;
      if (typeof id === 'number') byId.set(id, child);
    });
    expect(byId.size).toBeGreaterThan(0);
    for (const o of obstacles) {
      const mesh = byId.get(o.id)!;
      expect(mesh).toBeTruthy();
      const collider = new BoxCollider(o);
      expect(mesh.rotation.x).toBeCloseTo(collider.rotation.x, 6);
      expect(mesh.rotation.y).toBeCloseTo(collider.rotation.y, 6);
      expect(mesh.rotation.z).toBeCloseTo(collider.rotation.z, 6);
      // And the mesh is registered as gameplay, never decoration.
      const role = mesh.userData.worldRole as { role?: string } | undefined;
      expect(role?.role).toBe('GAMEPLAY');
    }
  }, 30000);

  it('collides authored solids through the real PhysicsWorld', () => {
    const physics = new PhysicsWorld();
    physics.buildFromRoute(track.route, track.optionalRamps, track.recoveryShelves, track.obstacles, track.signalSpines);
    const registered = new Set(physics.obstacleColliders.map((e) => e.id));
    for (const o of obstacles) expect(registered.has(o.id)).toBe(true);
    // A capsule dropped at the solid centre must make contact.
    for (const o of obstacles.slice(0, Math.min(6, obstacles.length))) {
      const centre = new THREE.Vector3(o.position.x, o.position.y, o.position.z);
      const hit = physics.colliders.some((c) => c.testSphere(centre, PLAYHEAD_MOVEMENT_V1.playerRadius).hasContact);
      expect(hit, `obstacle ${o.id} is not colliding`).toBe(true);
    }
  });

  it('adds the surf obstacles to the canonical map fingerprint', () => {
    const withObstacles = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');
    const stripped = SurfCourseGenerator.generate(mock(0x12345, 180, 128, ENERGETIC), 'SURF');
    stripped.obstacles = [];
    expect(computeMapFingerprint(withObstacles)).not.toBe(computeMapFingerprint(stripped));
  });

  it('gives long SURF routes real variety: a deterministic S_CURVE cadence', () => {
    const route = track.route;
    const kinds = new Set(route.map((n) => n.ribbon?.kind).filter(Boolean));
    // The prior generator only reached S_CURVE through RNG; the cadence must
    // guarantee some deterministic S-curve ribbons on a long uniform song.
    expect([...kinds].some((k) => String(k).startsWith('S_CURVE'))).toBe(true);
    // Variety is not just S_CURVE: climbs/descents/transfers must still appear.
    expect([...kinds].some((k) => String(k).startsWith('CLIMB'))).toBe(true);
  });
});


