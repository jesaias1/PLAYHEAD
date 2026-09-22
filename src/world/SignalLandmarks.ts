/**
 * AUDIO LANDMARKS — world-scale structures that visibly perform the song.
 *
 * Why this exists: the existing reactive mass (skyline monoliths / stelae) is
 * placed PERPENDICULAR to travel, 175-210m to the side. At that angle it is
 * outside the forward field of view for most of a run, so long stretches felt
 * visually disconnected from the music even though the channels were active.
 *
 * These landmarks are placed AHEAD of the route (forward offset > lateral
 * offset) so at almost any normal gameplay moment at least one clearly
 * audio-responsive structure is in front of the player.
 *
 * Everything here is presentation only:
 * - decoration, no collision, no corridor intrusion (validated against the
 *   single authoritative RouteExclusionCorridor at build time)
 * - three InstancedMeshes total, so the whole landmark field costs ~4 draw
 *   calls regardless of how many landmarks exist
 * - all animation is shader uniforms driven by the authoritative
 *   MusicVisualState channels; no new analyser, no per-frame mesh creation
 */

import * as THREE from 'three';
import { TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack } from '../generation/GenerationTypes';
import { MusicVisualState, resolveChannels } from './MusicVisualController';
import { RouteExclusionCorridor } from './RouteExclusionCorridor';
import { TrackPalette } from '../audio/TrackPalettes';
import { tagWorldRole } from './WorldRoles';

export type LandmarkArchetype = 'SIGNAL_TOWER' | 'WAVEFORM_MONOLITH' | 'SPECTRAL_COLUMN';

/** Number of live waveform columns baked into the monolith shader. */
const WAVE_COLUMNS = 32;
/** Number of stacked bands in a spectral column. */
const SPECTRAL_BANDS = 6;

const VERTEX_SHADER = `
varying vec2 vLandmarkUv;
varying float vLandmarkLocalY;

void main() {
  vLandmarkUv = uv;
  vLandmarkLocalY = position.y;

  vec4 instancePosition = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    instancePosition = instanceMatrix * instancePosition;
  #endif
  vec4 viewPosition = modelViewMatrix * instancePosition;
  gl_Position = projectionMatrix * viewPosition;
}
`;

/**
 * SIGNAL TOWER — segmented vertical light bands that travel up the shaft.
 * The band travel speed follows musical activity, so slow tracks sweep slowly.
 */
const TOWER_FRAGMENT = `
uniform vec3 uPrimary;
uniform vec3 uHighlight;
uniform float uBassMass;
uniform float uTransient;
uniform float uDrop;
uniform float uScanPhase;
uniform float uSegCount;
uniform float uSegSharp;
uniform float uGain;
uniform float uOpacity;

varying vec2 vLandmarkUv;
varying float vLandmarkLocalY;

void main() {
  float coord = vLandmarkLocalY + 0.5;
  float seg = fract(coord * uSegCount - uScanPhase);
  float bandPulse = pow(1.0 - abs(seg * 2.0 - 1.0), uSegSharp);

  float mass = 0.10 + uBassMass * 0.55 + uTransient * 0.45 + uDrop * 0.9;
  float lit = mass + bandPulse * (0.35 + uBassMass * 0.9 + uTransient * 0.7);
  vec3 col = mix(uPrimary, uHighlight, clamp(bandPulse * 0.7 + uDrop * 0.5, 0.0, 1.0));
  gl_FragColor = vec4(col * lit * uGain, uOpacity);
}
`;

/**
 * WAVEFORM MONOLITH — a colossal slab whose facade draws the CURRENT audio
 * waveform. It is a spectrum-like facade, not an analytically perfect scope:
 * it only needs to communicate "the song is here".
 */
const MONOLITH_FRAGMENT = `
uniform vec3 uPrimary;
uniform vec3 uHighlight;
uniform float uWave[${WAVE_COLUMNS}];
uniform float uMidFlow;
uniform float uDrop;
uniform float uGain;
uniform float uOpacity;

varying vec2 vLandmarkUv;
varying float vLandmarkLocalY;

void main() {
  float column = floor(vLandmarkUv.x * float(${WAVE_COLUMNS}));
  float amp = 0.0;
  for (int i = 0; i < ${WAVE_COLUMNS}; i++) {
    if (float(i) == column) amp = uWave[i];
  }

  // Amplitude bar from the bottom of the slab, plus a faint full-height grid.
  float barTop = 0.08 + amp * 0.78;
  float inBar = step(vLandmarkUv.y, barTop);
  float grid = step(0.92, fract(vLandmarkUv.x * float(${WAVE_COLUMNS})));

  float lit = inBar * (0.22 + amp * 1.15 + uMidFlow * 0.35 + uDrop * 0.8)
            + grid * 0.10 * (0.3 + uMidFlow);
  vec3 col = mix(uPrimary, uHighlight, clamp(amp * 1.1 + uDrop * 0.6, 0.0, 1.0));
  gl_FragColor = vec4(col * lit * uGain, uOpacity);
}
`;

/**
 * SPECTRAL COLUMN — stacked frequency bands. The bottom of the column answers
 * bass, the top answers highs, so the player can literally see which part of
 * the music is driving the world.
 */
const COLUMN_FRAGMENT = `
uniform vec3 uPrimary;
uniform vec3 uHighlight;
uniform float uBands[${SPECTRAL_BANDS}];
uniform float uGain;
uniform float uOpacity;

varying vec2 vLandmarkUv;
varying float vLandmarkLocalY;

void main() {
  float coord = clamp(vLandmarkLocalY + 0.5, 0.0, 0.999);
  int band = int(floor(coord * float(${SPECTRAL_BANDS})));

  float energy = 0.0;
  for (int i = 0; i < ${SPECTRAL_BANDS}; i++) {
    if (i == band) energy = uBands[i];
  }

  // Band separators stay faintly visible so the stack reads as a machine.
  float separator = step(0.94, fract(coord * float(${SPECTRAL_BANDS})));
  float lit = 0.08 + energy * 1.25 + separator * 0.06;
  vec3 col = mix(uPrimary, uHighlight, clamp(energy * 1.1, 0.0, 1.0));
  gl_FragColor = vec4(col * lit * uGain, uOpacity);
}
`;

interface LandmarkInstance {
  archetype: LandmarkArchetype;
  matrix: THREE.Matrix4;
}

export class SignalLandmarks {
  public group: THREE.Group;

  private towers: THREE.InstancedMesh | null = null;
  private monoliths: THREE.InstancedMesh | null = null;
  private monolithBacking: THREE.InstancedMesh | null = null;
  private columns: THREE.InstancedMesh | null = null;

  private towerUniforms: Record<string, THREE.IUniform> = {};
  private monolithUniforms: Record<string, THREE.IUniform> = {};
  private columnUniforms: Record<string, THREE.IUniform> = {};

  private towerCount = 0;
  private monolithCount = 0;
  private columnCount = 0;


  constructor(
    analysis: TrackAnalysis,
    track: GeneratedTrack,
    palette: TrackPalette,
    landmarkScale = 1.0
  ) {
    this.group = new THREE.Group();
    // World role: declared explicitly so the final world safety pass can
    // never mistake this geometry for gameplay (or miss it entirely).
    tagWorldRole(this.group, 'DECORATION', 'SignalLandmarks');
    this.group.name = 'SignalLandmarks';

    const route = track.route;
    if (route.length < 6) return;

    const corridorNodes = RouteExclusionCorridor.collectGameplayNodes(track);
    const corridor = new RouteExclusionCorridor(corridorNodes);

    let minWorldY = 0;
    for (const n of corridorNodes) {
      if (n.position.y < minWorldY) minWorldY = n.position.y;
    }

    const placements = this.planPlacements(
      route,
      corridor,
      minWorldY,
      landmarkScale,
      analysis.seed >>> 0
    );
    if (placements.length === 0) return;

    const primary = palette.primary.clone();
    const highlight = palette.highlight.clone();

    const towerInstances = placements.filter((p) => p.archetype === 'SIGNAL_TOWER');
    const monolithInstances = placements.filter((p) => p.archetype === 'WAVEFORM_MONOLITH');
    const columnInstances = placements.filter((p) => p.archetype === 'SPECTRAL_COLUMN');

    // --- SIGNAL TOWERS -----------------------------------------------------
    if (towerInstances.length > 0) {
      this.towerUniforms = {
        uPrimary: { value: primary },
        uHighlight: { value: highlight },
        uBassMass: { value: 0 },
        uTransient: { value: 0 },
        uDrop: { value: 0 },
        uScanPhase: { value: 0 },
        uSegCount: { value: 14.0 },
        uSegSharp: { value: 3.5 },
        uGain: { value: 1.0 },
        uOpacity: { value: 1.0 }
      };
      const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: TOWER_FRAGMENT,
        uniforms: this.towerUniforms,
        transparent: true,
        depthWrite: true
      });
      this.towers = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        material,
        towerInstances.length
      );
      this.towers.name = 'SignalTowers';
      this.towers.frustumCulled = false;
      for (const inst of towerInstances) {
        this.towers.setMatrixAt(this.towerCount++, inst.matrix);
      }
      this.towers.count = this.towerCount;
      this.towers.instanceMatrix.needsUpdate = true;
      this.group.add(this.towers);
    }

    // --- WAVEFORM MONOLITHS ------------------------------------------------
    if (monolithInstances.length > 0) {
      const waveArray = new Array(WAVE_COLUMNS).fill(0.2);
      this.monolithUniforms = {
        uPrimary: { value: primary },
        uHighlight: { value: highlight },
        uWave: { value: waveArray },
        uMidFlow: { value: 0 },
        uDrop: { value: 0 },
        uGain: { value: 1.0 },
        uOpacity: { value: 1.0 }
      };
      const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: MONOLITH_FRAGMENT,
        uniforms: this.monolithUniforms,
        transparent: true,
        depthWrite: true,
        side: THREE.DoubleSide
      });
      this.monoliths = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        material,
        monolithInstances.length
      );
      this.monoliths.name = 'WaveformMonoliths';
      this.monoliths.frustumCulled = false;
      for (const inst of monolithInstances) {
        this.monoliths.setMatrixAt(this.monolithCount++, inst.matrix);
      }
      this.monoliths.count = this.monolithCount;
      this.monoliths.instanceMatrix.needsUpdate = true;
      this.group.add(this.monoliths);

      // Dark solid mass behind each waveform slab so it reads as architecture.
      const backingMat = new THREE.MeshStandardMaterial({
        color: 0x05070a,
        roughness: 0.95,
        metalness: 0.1
      });
      this.monolithBacking = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        backingMat,
        monolithInstances.length
      );
      this.monolithBacking.name = 'WaveformMonolithBacking';
      this.monolithBacking.frustumCulled = false;
      const backingMatrix = new THREE.Matrix4();
      for (let i = 0; i < this.monolithCount; i++) {
        const src = monolithInstances[i].matrix;
        backingMatrix.copy(src);
        // Push the solid mass behind the slab along its local -Z.
        const offset = new THREE.Vector3(0, 0, -1.5).applyMatrix4(
          new THREE.Matrix4().extractRotation(src)
        );
        backingMatrix.setPosition(
          new THREE.Vector3().setFromMatrixPosition(src).add(offset)
        );
        this.monolithBacking.setMatrixAt(i, backingMatrix);
      }
      this.monolithBacking.instanceMatrix.needsUpdate = true;
      this.group.add(this.monolithBacking);
    }

    // --- SPECTRAL COLUMNS --------------------------------------------------
    if (columnInstances.length > 0) {
      this.columnUniforms = {
        uPrimary: { value: primary },
        uHighlight: { value: highlight },
        uBands: { value: new Array(SPECTRAL_BANDS).fill(0) },
        uGain: { value: 1.0 },
        uOpacity: { value: 1.0 }
      };
      const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: COLUMN_FRAGMENT,
        uniforms: this.columnUniforms,
        transparent: true,
        depthWrite: true
      });
      this.columns = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        material,
        columnInstances.length
      );
      this.columns.name = 'SpectralColumns';
      this.columns.frustumCulled = false;
      for (const inst of columnInstances) {
        this.columns.setMatrixAt(this.columnCount++, inst.matrix);
      }
      this.columns.count = this.columnCount;
      this.columns.instanceMatrix.needsUpdate = true;
      this.group.add(this.columns);
    }
  }

  /**
   * Places landmarks AHEAD of the route (forward offset > lateral offset) so
   * they sit inside the forward field of view, and rejects any placement that
   * would intrude into the authoritative gameplay corridor.
   */
  private planPlacements(
    route: GeneratedTrack['route'],
    corridor: RouteExclusionCorridor,
    minWorldY: number,
    landmarkScale: number,
    seed: number
  ): LandmarkInstance[] {
    const out: LandmarkInstance[] = [];
    const step = 7;
    const archetypes: LandmarkArchetype[] = [
      'SIGNAL_TOWER',
      'WAVEFORM_MONOLITH',
      'SPECTRAL_COLUMN'
    ];

    const maxLandmarks = Math.max(3, Math.round(Math.min(12, route.length / 6) * landmarkScale));

    const localBox = new THREE.Box3();
    const dummy = new THREE.Object3D();

    // Placement ladder: the corridor's comfort clearance scales with a
    // structure's own footprint, so a colossal landmark needs a lot of room.
    // We step outward until we find genuinely safe space rather than giving up
    // after one try (which previously placed nothing at all).
    const forwardLadder = [200, 270, 350, 440, 540];
    const lateralLadder = [85, 135, 195, 265];

    let placed = 0;
    for (let i = 2; i < route.length - 4 && placed < maxLandmarks; i += step) {
      const node = route[i];
      const stationIndex = Math.floor(i / step);
      const fwdX = Math.sin(node.yaw);
      const fwdZ = Math.cos(node.yaw);
      const rightX = fwdZ;
      const rightZ = -fwdX;

      for (const side of [-1, 1]) {
        if (placed >= maxLandmarks) break;
        // Asymmetric negative space: skip one side on a deterministic cadence.
        if (stationIndex % 3 === 0 && side === 1) continue;

        const archetype =
          archetypes[(stationIndex + (side > 0 ? 1 : 0)) % archetypes.length] ?? 'SIGNAL_TOWER';

        let width: number;
        let depth: number;
        let height: number;

        switch (archetype) {
          case 'WAVEFORM_MONOLITH':
            width = 96.0;
            depth = 16.0;
            height = 120.0;
            break;
          case 'SPECTRAL_COLUMN':
            width = 28.0;
            depth = 28.0;
            height = 210.0;
            break;
          case 'SIGNAL_TOWER':
          default:
            width = 34.0;
            depth = 34.0;
            height = 220.0 + ((seed + i * 23) % 110);
            break;
        }

        let placedHere = false;
        for (const forward of forwardLadder) {
          if (placedHere) break;
          for (const lateral of lateralLadder) {
            // Forward offset deliberately dominates the lateral offset so the
            // structure sits inside the forward view rather than off to a side.
            const jitterF = (seed + i * 17) % 40;
            const jitterL = (seed + i * 11) % 30;
            const px = node.position.x + fwdX * (forward + jitterF) + rightX * side * (lateral + jitterL);
            const pz = node.position.z + fwdZ * (forward + jitterF) + rightZ * side * (lateral + jitterL);
            const baseY = minWorldY - 120.0 + height * 0.5;

            // Face back toward the route so the reactive facade is visible.
            const yaw = Math.atan2(node.position.x - px, node.position.z - pz);

            dummy.position.set(px, baseY, pz);
            dummy.rotation.set(0, yaw, 0);
            dummy.scale.set(width, height, depth);
            dummy.updateMatrix();

            // Authoritative protection: never intrude into gameplay space.
            // Uses the landmark's REAL footprint (full size), not a proxy.
            localBox.setFromCenterAndSize(
              new THREE.Vector3(px, baseY, pz),
              new THREE.Vector3(width, height, depth)
            );
            if (corridor.isBoxInsideCorridor(localBox)) continue;

            out.push({ archetype, matrix: dummy.matrix.clone() });
            placed++;
            placedHere = true;
            break;
          }
        }
      }
    }

    return out;
  }

  /**
   * Drives the landmark field from the authoritative music state. Every value
   * here is a real-time audio or song-structure signal; there is no idle
   * procedural animation beyond the scan phase that is itself music-driven.
   */
  public update(
    state: MusicVisualState,
    liveBands: readonly number[],
    liveWaveform: Float32Array,
    reduceMotion = false
  ): void {
    const ch = resolveChannels(state);
    const react = state.reactivityMultiplier;
    // Reduced motion keeps the luminance response but damps fast sweeps and
    // large staggered propagation.
    const motionScale = reduceMotion ? 0.25 : 1.0;

    if (this.towers) {
      const u = this.towerUniforms;
      u.uBassMass.value = ch.bassMass;
      u.uTransient.value = ch.transient;
      u.uDrop.value = reduceMotion ? ch.dropPrimary : ch.dropPrimary;
      u.uScanPhase.value = ch.scanPhase * motionScale;
      u.uGain.value = (0.55 + ch.sectionEnergy * 0.55) * react;
      u.uPrimary.value.copy(state.palette.primary);
      u.uHighlight.value.copy(state.palette.highlight);
    }

    if (this.monoliths) {
      const u = this.monolithUniforms;
      const wave = u.uWave.value as number[];
      const step = Math.max(1, Math.floor(liveWaveform.length / WAVE_COLUMNS));
      for (let i = 0; i < WAVE_COLUMNS; i++) {
        wave[i] = liveWaveform[Math.min(liveWaveform.length - 1, i * step)] || 0;
      }
      u.uMidFlow.value = ch.midFlow;
      u.uDrop.value = reduceMotion ? ch.dropPrimary : ch.dropSecondary;
      u.uGain.value = (0.6 + ch.sectionEnergy * 0.5) * react;
      u.uPrimary.value.copy(state.palette.primary);
      u.uHighlight.value.copy(state.palette.highlight);
    }

    if (this.columns) {
      const u = this.columnUniforms;
      const bands = u.uBands.value as number[];
      // Low bands at the bottom, high bands at the top: the stack is a
      // readable, live picture of the spectrum.
      bands[0] = liveBands[0] ?? 0;
      bands[1] = liveBands[1] ?? 0;
      bands[2] = liveBands[2] ?? 0;
      bands[3] = liveBands[3] ?? 0;
      bands[4] = liveBands[4] ?? 0;
      bands[5] = liveBands[5] ?? 0;
      u.uGain.value = (0.55 + ch.sectionEnergy * 0.55) * react;
      u.uPrimary.value.copy(state.palette.primary);
      u.uHighlight.value.copy(state.palette.highlight);
    }
  }

  public getVisibleCount(): number {
    return this.towerCount + this.monolithCount + this.columnCount;
  }

  /**
   * Placement positions for diagnostics and tests. Landmarks are deliberately
   * placed AHEAD of the route so they sit in the forward field of view; this
   * exposes the result so that intent can be asserted rather than assumed.
   */
  public getPlacements(): Array<{
    archetype: LandmarkArchetype;
    position: THREE.Vector3;
    size: THREE.Vector3;
  }> {
    const out: Array<{ archetype: LandmarkArchetype; position: THREE.Vector3; size: THREE.Vector3 }> = [];
    const push = (
      mesh: THREE.InstancedMesh | null,
      archetype: LandmarkArchetype,
      count: number
    ): void => {
      if (!mesh) return;
      const m = new THREE.Matrix4();
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      for (let i = 0; i < count; i++) {
        mesh.getMatrixAt(i, m);
        m.decompose(p, q, s);
        out.push({ archetype, position: p.clone(), size: s.clone() });
      }
    };
    push(this.towers, 'SIGNAL_TOWER', this.towerCount);
    push(this.monoliths, 'WAVEFORM_MONOLITH', this.monolithCount);
    push(this.columns, 'SPECTRAL_COLUMN', this.columnCount);
    return out;
  }

  /** Draw-call cost of the whole landmark field (for DEV diagnostics). */
  public getDrawCallCount(): number {
    let n = 0;
    if (this.towers) n++;
    if (this.monoliths) n++;
    if (this.monolithBacking) n++;
    if (this.columns) n++;
    return n;
  }

  public dispose(): void {
    for (const mesh of [this.towers, this.monoliths, this.monolithBacking, this.columns]) {
      if (!mesh) continue;
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material;
      mat.dispose();
    }
    this.towers = null;
    this.monoliths = null;
    this.monolithBacking = null;
    this.columns = null;
    this.towerCount = 0;
    this.monolithCount = 0;
    this.columnCount = 0;
    this.group.clear();
  }
}
