/**
 * WORLD GEOMETRY SAFETY — the final authority contract.
 *
 * Covers the required cases: vertical intrusions, groups/children, rotation and
 * scale, InstancedMesh per-instance removal, surf / jump / fork / spine
 * conflicts, vertically separated safe decoration, late-added geometry,
 * merged-batch component traceability — plus the real GRAVITY LINE regression,
 * the full official-track sweep and a generation stress run.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';

import { WorldGeometrySafetyPass } from '../src/world/WorldGeometrySafetyPass';
import { tagWorldRole } from '../src/world/WorldRoles';
import { RouteExclusionCorridor } from '../src/world/RouteExclusionCorridor';
import { RouteGenerator, ROUTE_GENERATION_VERSION } from '../src/generation/RouteGenerator';
import { RouteChallengeGenerator } from '../src/generation/RouteChallengeGenerator';
import { SignalSpineGenerator } from '../src/generation/SignalSpineGenerator';
import { SeededRandom } from '../src/generation/SeededRandom';
import { GeometryBuilder } from '../src/world/GeometryBuilder';
import { SkylineArchitecture } from '../src/world/SkylineArchitecture';
import { SpectralArchitecture } from '../src/world/SpectralArchitecture';
import { DropSetpiece } from '../src/world/DropSetpiece';
import { CelestialLandmarks } from '../src/world/CelestialLandmarks';
import { SignalLandmarks } from '../src/world/SignalLandmarks';
import { RouteSignalPackets } from '../src/world/RouteSignalPackets';
import { SpectacleRenderer } from '../src/world/SpectacleRenderer';
import { PaletteSelector } from '../src/audio/TrackPalettes';
import { TrackAnalysis } from '../src/audio/AudioFeatures';
import { GeneratedTrack, RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';

// ---------------------------------------------------------------------------
// Synthetic fixtures
// ---------------------------------------------------------------------------

function node(
  id: number,
  x: number,
  y: number,
  z: number,
  overrides: Partial<RouteNode> = {}
): RouteNode {
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
    isBoost: false,
    ...overrides
  };
}

function syntheticTrack(nodes: RouteNode[], extra: Partial<GeneratedTrack> = {}): GeneratedTrack {
  return {
    seed: 1,
    route: nodes,
    checkpoints: [],
    finish: {
      routeNodeId: nodes[nodes.length - 1].id,
      time: 10,
      position: nodes[nodes.length - 1].position,
      yaw: 0
    },
    totalDistance: nodes[nodes.length - 1].arcLength,
    targetDuration: 10,
    repairedJumpsCount: 0,
    ...extra
  };
}

function runPass(
  track: GeneratedTrack,
  root: THREE.Object3D,
  source = 'test',
  role: 'DECORATION' | 'VISUAL_ONLY' = 'DECORATION'
) {
  const scene = new THREE.Scene();
  scene.add(root);
  const pass = new WorldGeometrySafetyPass(track);
  pass.register(root, source, role);
  const report = pass.run(scene);
  return { pass, report, scene };
}

function boxMesh(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  opts: { rotationY?: number; name?: string } = {}
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial());
  mesh.position.set(x, y, z);
  if (opts.rotationY) mesh.rotation.y = opts.rotationY;
  if (opts.name) mesh.name = opts.name;
  return mesh;
}

// ---------------------------------------------------------------------------

describe('World geometry safety — decoration loses', () => {
  it('rejects a decorative box rising through a platform', () => {
    const track = syntheticTrack([node(0, 0, 0, 0), node(1, 0, 0, 30)]);
    const group = new THREE.Group();
    const offender = boxMesh(6, 20, 6, 0, 9, 0, { name: 'Riser' });
    group.add(offender);
    const { report } = runPass(track, group);

    expect(report.removed).toBe(1);
    expect(report.violations[0].kind).toBe('GAMEPLAY_OVERLAP');
    expect(report.violations[0].objectName).toBe('Riser');
    expect(report.finalUnsafe).toBe(0);
    expect(offender.parent).toBeNull();
  });

  it('rejects a decorative pylon descending through a platform', () => {
    const track = syntheticTrack([node(0, 0, 0, 0)]);
    const group = new THREE.Group();
    group.add(boxMesh(3, 200, 3, 0, -100, 0, { name: 'Pylon' }));
    const { report } = runPass(track, group);

    expect(report.removed).toBe(1);
    expect(report.violations[0].objectName).toBe('Pylon');
    expect(report.finalUnsafe).toBe(0);
  });

  it('keeps a safe building beside the route', () => {
    const track = syntheticTrack([node(0, 0, 0, 0), node(1, 0, 0, 30)]);
    const group = new THREE.Group();
    const safe = boxMesh(20, 300, 20, 400, 100, 15, { name: 'SafeTower' });
    group.add(safe);
    const { report } = runPass(track, group);

    expect(report.removed).toBe(0);
    expect(report.finalUnsafe).toBe(0);
    expect(safe.parent).toBe(group);
  });

  it('rejects a very tall building whose ORIGIN is safe but whose geometry reaches the route', () => {
    const track = syntheticTrack([node(0, 0, 0, 0)]);
    const group = new THREE.Group();
    // Centre is 150m away, but the structure is 320m wide so it reaches across
    // the route: the origin is outside, the geometry is not.
    group.add(boxMesh(320, 400, 20, 150, 100, 0, { name: 'WideSlab' }));
    const { report } = runPass(track, group);

    expect(report.removed).toBe(1);
    expect(report.finalUnsafe).toBe(0);
  });

  it('rejects a safe parent Group containing an unsafe child Mesh', () => {
    const track = syntheticTrack([node(0, 0, 0, 0)]);
    const root = new THREE.Group();
    root.position.set(500, 0, 0); // safe origin
    const inner = new THREE.Group();
    root.add(inner);
    const bad = boxMesh(10, 40, 10, -500, 10, 0, { name: 'BadChild' }); // lands on the route
    inner.add(bad);
    const { report } = runPass(track, root);

    expect(report.removed).toBe(1);
    expect(report.violations[0].objectName).toBe('BadChild');
    expect(report.finalUnsafe).toBe(0);
  });

  it('uses real world-space bounds for rotated and scaled geometry', () => {
    const track = syntheticTrack([node(0, 0, 0, 0)]);
    // A long thin bar whose CENTRE is far away. Unrotated it is clear; rotated
    // 90 degrees it sweeps across the route.
    const root = new THREE.Group();
    const bar = boxMesh(4, 4, 200, 90, 0, 0, { name: 'SweepBar' });
    bar.rotation.y = Math.PI / 2;
    root.add(bar);

    const { report } = runPass(track, root);
    expect(report.removed).toBe(1);
    expect(report.finalUnsafe).toBe(0);
  });

  it('removes only the offending InstancedMesh instance and keeps the rest', () => {
    const track = syntheticTrack([node(0, 0, 0, 0)]);
    const root = new THREE.Group();
    const geom = new THREE.BoxGeometry(10, 40, 10);
    const inst = new THREE.InstancedMesh(geom, new THREE.MeshStandardMaterial(), 3);
    inst.name = 'TowerBatch';
    const dummy = new THREE.Object3D();
    const positions = [
      [0, 10, 0],     // ON the route -> must go
      [400, 100, 0],  // safe
      [-400, 100, 0]  // safe
    ];
    positions.forEach((p, i) => {
      dummy.position.set(p[0], p[1], p[2]);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    root.add(inst);

    const { report } = runPass(track, root);
    expect(report.removed).toBe(1);
    expect(report.violations[0].instanceIndex).toBe(0);
    expect(report.finalUnsafe).toBe(0);

    // The batch survives, and the two safe instances are untouched.
    const m = new THREE.Matrix4();
    inst.getMatrixAt(1, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBeCloseTo(400, 3);
    inst.getMatrixAt(2, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBeCloseTo(-400, 3);
  });

  it('keeps decoration that is vertically separated from the route', () => {
    const track = syntheticTrack([node(0, 0, 0, 0)]);
    const root = new THREE.Group();
    // Far below the protected band of a node at y=0.
    root.add(boxMesh(20, 40, 20, 0, -400, 0, { name: 'DeepSafe' }));
    const { report } = runPass(track, root);

    expect(report.removed).toBe(0);
    expect(report.finalUnsafe).toBe(0);
  });

  it('rejects surf-corridor conflicts', () => {
    const surf = node(0, 0, 0, 0, { isSurf: true, type: RouteNodeType.SURF_RAMP, yaw: 0 });
    const track = syntheticTrack([surf, node(1, 0, -6, 60)]);
    const root = new THREE.Group();
    // Sits inside the forward launch cone of the surf ramp.
    root.add(boxMesh(10, 30, 10, 0, 10, 70, { name: 'ConeBlocker' }));
    const { report } = runPass(track, root);

    expect(report.removed).toBeGreaterThanOrEqual(1);
    expect(report.finalUnsafe).toBe(0);
  });

  it('rejects conflicts with a route fork branch', () => {
    const main = [node(0, 0, 0, 0), node(1, 0, 0, 60)];
    const branchNode = node(70000, 18, 0, 30, { isOptional: false, forkBranchType: 'SAFE_VS_STRAFE' });
    const track = syntheticTrack(main, {
      forks: [
        {
          id: 1,
          type: 'SAFE_VS_STRAFE',
          entryNodeId: 0,
          rejoinNodeId: 1,
          entryArcLength: 0,
          rejoinArcLength: 60,
          safeDistance: 60,
          masteryDistance: 58,
          masteryNodes: [branchNode],
          validated: true
        }
      ]
    });
    const root = new THREE.Group();
    root.add(boxMesh(12, 40, 12, 18, 10, 30, { name: 'ForkBlocker' }));
    const { report } = runPass(track, root);

    expect(report.removed).toBe(1);
    expect(report.finalUnsafe).toBe(0);
  });

  it('rejects conflicts with a Signal Spine', () => {
    const main = [node(0, 0, 0, 0), node(1, 0, 0, 60)];
    const spine = node(90000, 0, 0, 30, {
      isOptional: true,
      isSignalSpine: true,
      signalSpineVariant: 'STRAIGHT',
      dimensions: { x: 1.2, y: 0.3, z: 30 }
    });
    const track = syntheticTrack(main, { signalSpines: [spine] });
    const root = new THREE.Group();
    root.add(boxMesh(8, 40, 8, 0, 15, 30, { name: 'SpineBlocker' }));
    const { report } = runPass(track, root);

    expect(report.removed).toBe(1);
    expect(report.finalUnsafe).toBe(0);
  });

  it('catches LATE-ADDED decoration that was never registered', () => {
    const track = syntheticTrack([node(0, 0, 0, 0)]);
    const scene = new THREE.Scene();
    const registered = new THREE.Group();
    tagWorldRole(registered, 'DECORATION', 'test.registered');
    scene.add(registered);

    // Added after registration, with no role at all.
    const latecomer = boxMesh(10, 60, 10, 0, 25, 0, { name: 'LateUnregistered' });
    scene.add(latecomer);

    const pass = new WorldGeometrySafetyPass(track);
    pass.register(registered, 'test.registered', 'DECORATION');
    const report = pass.run(scene);

    expect(report.unregisteredRenderables).toBe(1);
    expect(report.removed).toBe(1);
    expect(report.finalUnsafe).toBe(0);
    expect(latecomer.parent).toBeNull();
  });

  it('traces a single offending component inside a merged batch', () => {
    const track = syntheticTrack([node(0, 0, 0, 0)]);
    const root = new THREE.Group();

    // A merged batch with component metadata: one component is on the route,
    // one is far away. The batch must be reported per component, and only the
    // offending component removed — the batch itself survives.
    const batch = boxMesh(200, 1, 200, 0, 0, 0, { name: 'MergedDecorative' });
    const offenderBox = new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(0, 10, 0),
      new THREE.Vector3(10, 40, 10)
    );
    const safeBox = new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(600, 100, 0),
      new THREE.Vector3(10, 40, 10)
    );
    batch.userData.mergedComponents = [
      { name: 'Component_Offender', source: 'test.merged', box: offenderBox },
      { name: 'Component_Safe', source: 'test.merged', box: safeBox }
    ];
    root.add(batch);

    const { report } = runPass(track, root);
    expect(report.removed).toBe(1);
    expect(report.violations[0].objectName).toBe('Component_Offender');
    // The batch survives with its safe component intact.
    expect(batch.parent).toBe(root);
    expect((batch.userData.mergedComponents as unknown[]).length).toBe(1);
    expect(report.finalUnsafe).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Real-world assembly
// ---------------------------------------------------------------------------

interface AssembledWorld {
  scene: THREE.Scene;
  track: GeneratedTrack;
  report: ReturnType<WorldGeometrySafetyPass['run']>;
  pass: WorldGeometrySafetyPass;
}

function loadPreset(trackId: string): { analysis: TrackAnalysis; track: GeneratedTrack } {
  const presetPath = path.resolve(__dirname, `../public/music/presets/${trackId}.json`);
  const json = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
  const analysis: TrackAnalysis = json.analysis;
  if (Array.isArray(analysis.waveform)) {
    analysis.waveform = new Float32Array(analysis.waveform as unknown as number[]);
  }

  let track: GeneratedTrack = json.track;
  if (!track?.route || track.generationVersion !== ROUTE_GENERATION_VERSION) {
    track = RouteGenerator.generate(analysis);
  }
  if (!track.optionalRamps || track.optionalRamps.length === 0) {
    const rng = new SeededRandom(analysis.seed || 12345);
    track.optionalRamps = RouteGenerator.generateOptionalSideSurfs(track.route, rng);
  }
  track.obstacles = RouteChallengeGenerator.generate(track.route, analysis, {
    recoveryShelves: track.recoveryShelves
  });
  if (!track.signalSpines || track.signalSpines.length === 0) {
    const rng = new SeededRandom(analysis.seed || 12345);
    track.signalSpines = SignalSpineGenerator.generate(track.route, analysis, rng, {
      obstacles: track.obstacles
    });
  }
  return { analysis, track };
}

/** Assembles the complete world exactly as World.loadTrack does, then audits. */
function assembleAndAudit(track: TrackAnalysis, generated: GeneratedTrack): AssembledWorld {
  const palette = PaletteSelector.selectPalette(track.seed, 0.5, track.globalEnergy);
  const scene = new THREE.Scene();

  const built = GeometryBuilder.buildWorld(generated, palette);
  scene.add(built.rootGroup);
  const skyline = new SkylineArchitecture(scene, track, generated);
  const celestial = new CelestialLandmarks(scene, track, generated, palette);
  const spectral = new SpectralArchitecture(scene, track, generated);
  const drop = new DropSetpiece(scene, track, generated);
  const landmarks = new SignalLandmarks(track, generated, palette, 1.0);
  scene.add(landmarks.group);
  const packets = new RouteSignalPackets(generated, palette, 32);
  scene.add(packets.group);
  const spectacle = new SpectacleRenderer(scene);
  spectacle.init(generated);

  const corridor = new RouteExclusionCorridor(
    RouteExclusionCorridor.collectGameplayNodes(generated)
  );
  const pass = new WorldGeometrySafetyPass(generated, corridor);
  pass.register(drop.group, 'DropSetpiece', 'DECORATION');
  pass.register(spectral.group, 'SpectralArchitecture', 'DECORATION');
  pass.register(skyline.group, 'SkylineArchitecture', 'DECORATION');
  pass.register(celestial.group, 'CelestialLandmarks', 'VISUAL_ONLY');
  pass.register(built.rootGroup, 'GeometryBuilder', 'DECORATION');
  pass.register(landmarks.group, 'SignalLandmarks', 'DECORATION');
  pass.register(packets.group, 'RouteSignalPackets', 'VISUAL_ONLY');
  pass.register(spectacle.group, 'SpectacleRenderer', 'IGNORE_WORLD_SAFETY');

  const report = pass.run(scene);
  return { scene, track: generated, report, pass };
}

describe('World geometry safety — GRAVITY LINE regression', () => {
  it('reports zero unsafe decoration on the human-reported level', () => {
    const { analysis, track } = loadPreset('track_5_gravity_line');
    const { report } = assembleAndAudit(analysis, track);

    expect(report.finalUnsafe).toBe(0);
    expect(report.unregisteredRenderables).toBe(0);
    expect(report.gameplayVolumes).toBeGreaterThan(50);
  });

  it('rejects the checkpoint-arch / finish-monument foundation category found in reproduction', () => {
    // The historical offender: a monument foundation hanging off a route node.
    // Re-introduce that exact shape and confirm the pass rejects it.
    const { analysis, track } = loadPreset('track_5_gravity_line');
    const checkpoint = track.route.find((n) => n.type === RouteNodeType.CHECKPOINT);
    expect(checkpoint, 'GRAVITY LINE must have a checkpoint').toBeTruthy();

    const root = new THREE.Group();
    const leg = boxMesh(
      2.2,
      125,
      2.4,
      checkpoint!.position.x,
      checkpoint!.position.y - 62.5,
      checkpoint!.position.z,
      { name: 'CheckpointArch_Leg' }
    );
    tagWorldRole(leg, 'DECORATION', 'GeometryBuilder.CheckpointArchFoundation', false);
    root.add(leg);

    const corridor = new RouteExclusionCorridor(
      RouteExclusionCorridor.collectGameplayNodes(track)
    );
    const scene = new THREE.Scene();
    scene.add(root);
    const pass = new WorldGeometrySafetyPass(track, corridor);
    pass.register(root, 'regression', 'DECORATION');
    const report = pass.run(scene);

    expect(report.removed).toBe(1);
    expect(report.finalUnsafe).toBe(0);
    expect(report.violations[0].source).toBe('GeometryBuilder.CheckpointArchFoundation');
  });
});

describe('World geometry safety — official track sweep', () => {
  it('reports FINAL UNSAFE = 0 for every official Signal Pack track', () => {
    const presetDir = path.resolve(__dirname, '../public/music/presets');
    const files = fs
      .readdirSync(presetDir)
      .filter((f) => f.endsWith('.json'))
      .sort();

    expect(files.length).toBeGreaterThanOrEqual(10);

    const summary: string[] = [];
    for (const file of files) {
      const trackId = file.replace(/\.json$/, '');
      const { analysis, track } = loadPreset(trackId);
      const { report } = assembleAndAudit(analysis, track);

      summary.push(
        `${trackId}: removed=${report.removed} unregistered=${report.unregisteredRenderables} ` +
          `unsafe=${report.finalUnsafe} (${report.durationMs.toFixed(1)}ms)`
      );

      expect(report.finalUnsafe, `${trackId} must have zero unsafe decoration`).toBe(0);
      expect(report.unregisteredRenderables, `${trackId} must have no unregistered geometry`).toBe(0);
    }
    // Printed so the per-track summary is visible in the test output.
    console.log('[WORLD SAFETY SWEEP]\n  ' + summary.join('\n  '));
  }, 120000);
});

describe('World geometry safety — generation stress', () => {
  it('keeps every generated world free of surviving intersections', () => {
    const themes: string[][] = [
      ['FLOW', 'SURF', 'BUILDUP', 'DROP', 'FLOW'],
      ['FLOW', 'PRECISION', 'DROP', 'FLOW'],
      ['FLOW', 'SPEED', 'ASCENT', 'DESCENT', 'DROP'],
      ['FLOW', 'BUILDUP', 'SPEED', 'PRECISION', 'FLOW', 'SURF']
    ];

    let worlds = 0;
    let candidates = 0;
    let rejected = 0;
    let unsafe = 0;

    for (let i = 0; i < 120; i++) {
      const duration = 60 + (i % 6) * 15;
      const themeSet = themes[i % themes.length];
      const sections = themeSet.map((theme, k) => ({
        index: k,
        start: (k / themeSet.length) * duration,
        end: ((k + 1) / themeSet.length) * duration,
        duration: duration / themeSet.length,
        intensity: 0.7,
        rhythmicDensity: 0.6,
        brightness: 0.5,
        theme
      }));

      const frameCount = Math.floor(duration / 0.02);
      const frames = [];
      for (let f = 0; f < frameCount; f++) {
        frames.push({
          time: f * 0.02,
          rms: 0.45,
          bass: 0.5,
          lowMid: 0.4,
          mid: 0.4,
          high: 0.35,
          centroid: 0.5,
          flux: 0.25
        });
      }

      const analysis: TrackAnalysis = {
        filename: `stress_${i}.wav`,
        duration,
        bpm: 128,
        bpmConfidence: 0.9,
        globalEnergy: 0.7,
        frames,
        sections: sections as TrackAnalysis['sections'],
        onsets: [],
        waveform: new Array(1024).fill(0.4),
        seed: 0x90000000 + i * 7919,
        visualAccent: { name: 'CYAN', hex: '#00f0ff', rgb: [0, 240, 255] }
      };

      const generated = RouteGenerator.generate(analysis);
      const { report } = assembleAndAudit(analysis, generated);
      worlds++;
      candidates += report.decorativeObjects + report.decorativeInstances;
      rejected += report.removed;
      unsafe += report.finalUnsafe;

      expect(report.finalUnsafe, `stress world ${i} must be safe`).toBe(0);
    }

    console.log(
      `[WORLD SAFETY STRESS] worlds=${worlds} candidates=${candidates} ` +
        `rejected=${rejected} survivingUnsafe=${unsafe}`
    );
    expect(worlds).toBe(120);
    expect(unsafe).toBe(0);
  }, 180000);
});
