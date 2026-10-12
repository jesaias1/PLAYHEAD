/**
 * SIGNAL CITY — the layer that turns the original city into PLAYHEAD's home.
 *
 * The existing city (the monumental skyline with its travelling signal bands,
 * spectral canyons, signage, megastructure) is kept exactly as it is. This
 * layer is built ON TOP of it for city maps and adds what it lacked: places
 * people live, things that work, and a few landmarks worth steering by.
 *
 *   OPENING    an intimate district: residential blocks close on both sides
 *   BUILD      the blocks thin; the paired towers stand off one side and the
 *              broadcast tower shows between buildings
 *   PEAK       no near buildings at all: the open skyline, anchored by the
 *              broadcast tower
 *   BREAKDOWN  housing again, a substation, and the elevated transit line
 *              with its train
 *   FINALE     the broadcast terminal beyond the finish
 *
 * Songs differ deterministically: which side the transit line and the tower
 * take, the proportions of the housing, how warm and how lived-in the windows
 * are, and the signal colour all come from the track's seed and palette.
 *
 * PRESENTATION ONLY. Every piece is measured as final world-space bounds
 * against the RouteExclusionCorridor before it is accepted. The train is the
 * only thing that moves, and the WHOLE volume it sweeps is validated, not its
 * resting position: a span of viaduct is only built if span plus train
 * clearance is corridor-safe, and the train only runs on built spans.
 */

import * as THREE from 'three';
import { tagWorldRole } from '../../WorldRoles';
import {
  EnvironmentThemeBuildContext,
  EnvironmentThemeFrame,
  EnvironmentThemeInstance,
  EnvironmentThemeLighting
} from '../EnvironmentTheme';
import { GlowBatch, InstanceBatch, mulberry32 } from '../ThemeInstancing';
import {
  ProgressionSpan,
  ProgressionValues,
  RouteFrame,
  deriveProgression,
  roleSpan,
  sampleProgression
} from '../ThemeProgression';
import { ThemeReactivity } from '../ThemeReactivity';
import { createOrbitalGlowMaterial, OrbitalUniforms } from '../orbital/OrbitalShaders';
import { SignalCityUniforms, createSignalCityMaterial, createSignalCityUniforms } from './SignalCityShaders';

/** How closely housing presses on the route (1 = canyon, 0 = open rooftops). */
const INTIMACY: ProgressionValues = { OPENING: 1.0, BUILD: 0.5, PEAK: 0.0, BREAKDOWN: 0.8, FINALE: 0.25 };
/** Landmark lighting level; sustained energy rides on it. */
const DISTRICT_LIGHT: ProgressionValues = { OPENING: 0.45, BUILD: 0.65, PEAK: 0.95, BREAKDOWN: 0.35, FINALE: 0.85 };

const KIND_CONCRETE = 0;
const KIND_GLASS = 1;
const KIND_LATTICE = 2;
const KIND_TRAIN = 4;
const GLOW_STEADY = 0;
const GLOW_NAV = 1;
const GLOW_BEACON = 2;

const RED = new THREE.Color(1.0, 0.16, 0.1);
const AMBER = new THREE.Color(1.0, 0.62, 0.22);
const UP = new THREE.Vector3(0, 1, 0);
/** Clearance above the deck that the train occupies along its whole run. */
const TRAIN_HEIGHT = 5.2;
const TRAIN_CARS = 5;
const TRAIN_CAR_LENGTH = 19;

export interface SignalCityStats {
  housing: number;
  rooftopUnits: number;
  viaductSpans: number;
  hasTrain: boolean;
  hasBroadcastTower: boolean;
  hasSplitTowers: boolean;
  hasTerminal: boolean;
  hasSubstation: boolean;
  beacons: number;
  rejected: number;
  drawBatches: number;
}

export class SignalCityLayer implements EnvironmentThemeInstance {
  public readonly id = 'SIGNAL_CITY' as const;
  public readonly group = new THREE.Group();
  /** Unused: the city keeps its own sky. */
  public readonly skyGroup = new THREE.Group();
  /** Unused: the city keeps its own lighting. */
  public readonly lighting: EnvironmentThemeLighting = {
    keyColor: 0xffffff,
    keyIntensity: 2.3,
    keyOffset: new THREE.Vector3(50, 120, 60),
    hemiSkyColor: 0x45556b,
    hemiGroundColor: 0x111620,
    hemiIntensity: 1.05
  };
  public readonly uniforms: SignalCityUniforms = createSignalCityUniforms();
  public readonly spans: ProgressionSpan[];
  public readonly reactivity = new ThemeReactivity();
  public readonly stats: SignalCityStats = {
    housing: 0,
    rooftopUnits: 0,
    viaductSpans: 0,
    hasTrain: false,
    hasBroadcastTower: false,
    hasSplitTowers: false,
    hasTerminal: false,
    hasSubstation: false,
    beacons: 0,
    rejected: 0,
    drawBatches: 0
  };
  /** Where the landmarks ended up (for composition checks and tests). */
  public readonly landmarks: { broadcastTower?: THREE.Vector3; splitTowers?: THREE.Vector3; terminal?: THREE.Vector3 } = {};
  /** Centre line of the built viaduct run the train travels, deck-top height. */
  public readonly trainPath: THREE.Vector3[] = [];

  private readonly frame: RouteFrame;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly hits: Array<{ time: number; strength: number }> = [];
  private hitCursor = 0;
  private lastSongTime = -1;
  private routeU = -1;
  private trainMesh: THREE.InstancedMesh | null = null;
  private trainLengths: number[] = [];
  private trainTotal = 0;
  private disposed = false;

  constructor(private readonly context: EnvironmentThemeBuildContext) {
    this.group.name = 'SignalCity';
    this.skyGroup.name = 'SignalCitySky';
    tagWorldRole(this.group, 'DECORATION', 'SignalCity', false);
    tagWorldRole(this.skyGroup, 'IGNORE_WORLD_SAFETY', 'SignalCitySky', false);

    const { track, analysis, palette } = context;
    this.frame = new RouteFrame(track.route, track.totalDistance);
    this.spans = deriveProgression(analysis, track);
    this.uniforms.uSignal.value.copy(palette.primary);
    this.uniforms.uHaze.value.copy(palette.fogColor).multiplyScalar(1.6).add(new THREE.Color(0.006, 0.008, 0.014));

    for (const onset of analysis.onsets ?? []) {
      if (onset.highs > 0.3 && onset.highs >= onset.bass * 0.8) {
        this.hits.push({ time: onset.time, strength: onset.highs * onset.strength });
      }
    }
    if (!this.frame.isEmpty) this.build();
  }

  private track<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private build(): void {
    const { corridor, track, quality } = this.context;
    const rng = mulberry32((track.seed ^ 0x53494743) >>> 0);
    const frame = this.frame;
    const spans = this.spans;
    const detail = quality?.reactiveLandmarkScale ?? 1;
    const metres = (m: number): number => m / frame.total;

    // District character, fixed per song.
    const transitSide = rng() > 0.5 ? 1 : -1;
    const towerSide = -transitSide;
    const slabby = rng();
    const lived = 0.2 + rng() * 0.22;
    this.uniforms.uWarmth.value = 0.62 + rng() * 0.3;

    const boxes = new InstanceBatch('SignalCityBoxes', this.track(new THREE.BoxGeometry(1, 1, 1)));
    const glows = new GlowBatch();
    const scratch = new THREE.Box3();
    const fits = (geomBox: THREE.Box3, matrix: THREE.Matrix4): boolean =>
      corridor.evaluateVolume(scratch.copy(geomBox).applyMatrix4(matrix)) === null;

    const orient = (forward: THREE.Vector3, right: THREE.Vector3, yaw = 0): THREE.Quaternion => {
      const q = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(right.clone().negate(), UP, forward)
      );
      if (yaw) q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
      return q;
    };

    /** A box whose BASE sits `baseBelow` under the route and rises to `top`. */
    const block = (spec: {
      u: number;
      lateral: number;
      along?: number;
      size: [number, number];
      top: number;
      baseBelow: number;
      kind: number;
      texel: number;
      lived?: number;
      crown?: boolean;
      yaw?: number;
      push?: { step: number; steps: number };
    }): { centre: THREE.Vector3; topY: number; lateral: number; q: THREE.Quaternion } | null => {
      const at = frame.sample(spec.u);
      const q = orient(at.forward, at.right, spec.yaw ?? 0);
      const height = spec.top + spec.baseBelow;
      const scale = new THREE.Vector3(spec.size[0], height, spec.size[1]);
      const steps = spec.push?.steps ?? 0;
      for (let i = 0; i <= steps; i++) {
        const lateral = spec.lateral + Math.sign(spec.lateral || 1) * (spec.push?.step ?? 0) * i;
        const centre = at.position
          .clone()
          .addScaledVector(at.right, lateral)
          .addScaledVector(at.forward, spec.along ?? 0);
        centre.y += (spec.top - spec.baseBelow) / 2;
        const matrix = new THREE.Matrix4().compose(centre, q, scale);
        if (!fits(boxes.box, matrix)) continue;
        boxes.add(matrix, [spec.kind, spec.texel, spec.lived ?? 0, spec.crown ? 1 : 0], rng());
        return { centre, topY: at.position.y + spec.top, lateral, q };
      }
      this.stats.rejected++;
      return null;
    };

    const glow = (pos: THREE.Vector3, size: number, color: THREE.Color, intensity: number, kind: number, core = 0): boolean => {
      const matrix = new THREE.Matrix4().compose(pos, new THREE.Quaternion(), new THREE.Vector3(size, size, size));
      if (!fits(glows.box, matrix)) return false;
      glows.add(matrix, color, [intensity, kind, rng(), core]);
      this.stats.beacons++;
      return true;
    };

    /** Small working parts on a roof: plant, tanks, a stair head, a mast. */
    const dressRoof = (roof: { centre: THREE.Vector3; topY: number; q: THREE.Quaternion }, w: number, d: number): void => {
      const count = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < count; i++) {
        const sx = 3 + rng() * (w * 0.3);
        const sz = 3 + rng() * (d * 0.3);
        const sy = 2.5 + rng() * 5;
        const offset = new THREE.Vector3((rng() - 0.5) * (w - sx - 2), 0, (rng() - 0.5) * (d - sz - 2)).applyQuaternion(roof.q);
        const pos = new THREE.Vector3(roof.centre.x + offset.x, roof.topY + sy / 2, roof.centre.z + offset.z);
        const matrix = new THREE.Matrix4().compose(pos, roof.q, new THREE.Vector3(sx, sy, sz));
        if (!fits(boxes.box, matrix)) continue;
        boxes.add(matrix, [KIND_CONCRETE, 0.8, 0, 0], rng());
        this.stats.rooftopUnits++;
      }
      if (rng() > 0.72) {
        const mastHeight = 14 + rng() * 16;
        const pos = new THREE.Vector3(roof.centre.x, roof.topY + mastHeight / 2, roof.centre.z);
        const matrix = new THREE.Matrix4().compose(pos, roof.q, new THREE.Vector3(1.2, mastHeight, 1.2));
        if (fits(boxes.box, matrix)) {
          boxes.add(matrix, [KIND_LATTICE, 0.6, 0, 0], rng());
          glow(new THREE.Vector3(pos.x, roof.topY + mastHeight + 1.5, pos.z), 5, RED, 0.9, GLOW_NAV);
        }
      }
    };

    const opening = roleSpan(spans, 'OPENING');
    const buildSpan = roleSpan(spans, 'BUILD');
    const peak = roleSpan(spans, 'PEAK');
    const breakdown = roleSpan(spans, 'BREAKDOWN');

    // ---------------------------------------------------------------------
    // Housing: three related families (slab, tower, stepped), pressing close
    // where the music is intimate and absent where it opens out.
    // ---------------------------------------------------------------------
    const stepHousing = metres(detail < 0.5 ? 120 : 82);
    for (let u = 0.004; u < 0.992; u += stepHousing) {
      const intimacy = sampleProgression(spans, INTIMACY, u);
      if (intimacy < 0.2) continue;
      for (const side of [-1, 1]) {
        if (rng() > 0.35 + intimacy * 0.6) continue;
        const family = rng() < slabby ? 'SLAB' : rng() < 0.55 ? 'TOWER' : 'STEPPED';
        const width = family === 'SLAB' ? 22 + rng() * 10 : 18 + rng() * 8;
        const depth = family === 'SLAB' ? 38 + rng() * 22 : 18 + rng() * 10;
        const top = (family === 'TOWER' ? 95 + rng() * 80 : 42 + rng() * 60) * (0.8 + intimacy * 0.3);
        const uJit = u + (rng() - 0.5) * stepHousing * 0.5;
        const base = block({
          u: uJit, lateral: side * (104 + rng() * 26), size: [width, depth], top, baseBelow: 150,
          kind: KIND_CONCRETE, texel: 1.0, lived: lived * (0.6 + rng() * 0.8), crown: rng() > 0.7,
          push: { step: 10, steps: 5 }
        });
        if (!base) continue;
        this.stats.housing++;
        dressRoof(base, width, depth);
        if (family === 'STEPPED') {
          // A set-back upper volume: the same building, a second roofline.
          const upper = block({
            u: uJit, lateral: base.lateral + side * 3, size: [width * 0.62, depth * 0.7], top: top + 22 + rng() * 26,
            baseBelow: -top, kind: KIND_CONCRETE, texel: 1.0, lived: lived, crown: true
          });
          if (upper) dressRoof(upper, width * 0.62, depth * 0.7);
        }
      }
    }

    // ---------------------------------------------------------------------
    // The broadcast tower: the city's anchor, seen in glimpses through the
    // build and standing clear across the peak.
    // ---------------------------------------------------------------------
    const anchor = peak ?? buildSpan ?? { start: 0.4, end: 0.6 };
    const towerU = anchor.start + (anchor.end - anchor.start) * 0.55;
    const shaft = block({
      u: towerU, lateral: towerSide * 470, size: [58, 58], top: 250, baseBelow: 260,
      kind: KIND_CONCRETE, texel: 2.0, lived: 0.05, crown: true, push: { step: 40, steps: 8 }
    });
    if (shaft) {
      this.stats.hasBroadcastTower = true;
      this.landmarks.broadcastTower = new THREE.Vector3(shaft.centre.x, shaft.topY, shaft.centre.z);
      const centre = (y: number): THREE.Vector3 => new THREE.Vector3(shaft.centre.x, shaft.topY + y, shaft.centre.z);
      const stack = (size: number, from: number, to: number, kind: number, crown: boolean, lived = 0): void => {
        const matrix = new THREE.Matrix4().compose(centre((from + to) / 2), shaft.q, new THREE.Vector3(size, to - from, size));
        if (fits(boxes.box, matrix)) boxes.add(matrix, [kind, 2.0, lived, crown ? 1 : 0], rng());
      };
      stack(40, 0, 130, KIND_CONCRETE, true);
      stack(104, 130, 148, KIND_CONCRETE, true, 0.8); // the studio deck
      stack(26, 148, 250, KIND_CONCRETE, false);
      stack(13, 250, 430, KIND_LATTICE, false);
      for (const y of [-60, 132, 250, 340, 432]) glow(centre(y), y > 400 ? 44 : 24, RED, 1.25, y > 400 ? GLOW_BEACON : GLOW_NAV, y > 400 ? 0.1 : 0);
    }

    // ---------------------------------------------------------------------
    // The paired towers: one building split down the middle, joined by two
    // bridges. Stands on the transit side during the build.
    // ---------------------------------------------------------------------
    const pairU = buildSpan ? buildSpan.start + (buildSpan.end - buildSpan.start) * 0.5 : (opening?.end ?? 0.1) + 0.05;
    const half = block({
      u: pairU, lateral: transitSide * 360, along: -31, size: [46, 44], top: 300, baseBelow: 240,
      kind: KIND_GLASS, texel: 1.4, lived: 0.16, crown: true, push: { step: 30, steps: 6 }
    });
    if (half) {
      const other = block({
        u: pairU, lateral: half.lateral, along: 31, size: [46, 44], top: 262, baseBelow: 240,
        kind: KIND_GLASS, texel: 1.4, lived: 0.2, crown: true
      });
      if (other) {
        this.stats.hasSplitTowers = true;
        this.landmarks.splitTowers = new THREE.Vector3(half.centre.x, half.topY, half.centre.z);
        const at = frame.sample(pairU);
        for (const y of [90, 205]) {
          const pos = at.position.clone().addScaledVector(at.right, half.lateral);
          pos.y += y;
          const matrix = new THREE.Matrix4().compose(pos, half.q, new THREE.Vector3(14, 7, 20));
          if (fits(boxes.box, matrix)) boxes.add(matrix, [KIND_GLASS, 1.0, 0.6, 0], rng());
        }
        glow(new THREE.Vector3(half.centre.x, half.topY + 4, half.centre.z), 9, RED, 1.0, GLOW_NAV);
        glow(new THREE.Vector3(other.centre.x, other.topY + 4, other.centre.z), 9, RED, 1.0, GLOW_NAV);
      }
    }

    // ---------------------------------------------------------------------
    // Elevated transit. Each span is accepted only if the span AND the space
    // a train occupies above it clear the corridor; the train then runs on
    // the longest unbroken run of accepted spans.
    // ---------------------------------------------------------------------
    const transitFrom = breakdown ? breakdown.start - 0.05 : 0.55;
    const transitTo = breakdown ? breakdown.end + 0.06 : 0.8;
    const spanArc = 58;
    let run: THREE.Vector3[] = [];
    let best: THREE.Vector3[] = [];
    const deckPoint = (u: number): THREE.Vector3 => {
      const at = frame.sample(u, 160);
      const p = at.position.clone().addScaledVector(at.right, transitSide * 245);
      p.y -= 14;
      return p;
    };
    const closeRun = (): void => {
      if (run.length > best.length) best = run;
      run = [];
    };
    for (let u = transitFrom; u < transitTo; u += metres(spanArc)) {
      const a = deckPoint(u);
      const b = deckPoint(u + metres(spanArc));
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const along = b.clone().sub(a);
      const length = along.length();
      const x = along.clone().normalize();
      const z = new THREE.Vector3().crossVectors(x, UP).normalize();
      const y = new THREE.Vector3().crossVectors(z, x).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      const deck = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(length + 1.5, 3.2, 9));
      // The swept volume: deck plus everything a passing train occupies.
      const swept = new THREE.Matrix4().compose(
        mid.clone().add(new THREE.Vector3(0, TRAIN_HEIGHT / 2, 0)),
        q,
        new THREE.Vector3(length + 1.5, 3.2 + TRAIN_HEIGHT + 1.0, 9)
      );
      if (!fits(boxes.box, swept)) {
        this.stats.rejected++;
        closeRun();
        continue;
      }
      boxes.add(deck, [KIND_CONCRETE, 1.2, 0, 1], rng());
      this.stats.viaductSpans++;
      const pier = new THREE.Matrix4().compose(
        a.clone().add(new THREE.Vector3(0, -112, 0)),
        q,
        new THREE.Vector3(7, 220, 7)
      );
      if (fits(boxes.box, pier)) boxes.add(pier, [KIND_CONCRETE, 1.6, 0, 0], rng());
      if (run.length === 0) run.push(a.clone().add(new THREE.Vector3(0, 1.6, 0)));
      run.push(b.clone().add(new THREE.Vector3(0, 1.6, 0)));
    }
    closeRun();
    if (best.length >= 5) {
      this.trainPath.push(...best);
      this.trainLengths = [0];
      for (let i = 1; i < best.length; i++) this.trainLengths.push(this.trainLengths[i - 1] + best[i].distanceTo(best[i - 1]));
      this.trainTotal = this.trainLengths[this.trainLengths.length - 1];
      this.stats.hasTrain = true;
    }

    // ---------------------------------------------------------------------
    // Substation: low transformer bays close to the route in the breakdown.
    // Their signal lines are what the bass brightens.
    // ---------------------------------------------------------------------
    if (breakdown) {
      const subU = breakdown.start + (breakdown.end - breakdown.start) * 0.5;
      let placed = 0;
      for (let i = 0; i < 6; i++) {
        const bay = block({
          u: subU + metres((i - 2.5) * 13), lateral: -transitSide * 62, size: [7, 9], top: 3 + (i % 2) * 5, baseBelow: 16,
          kind: KIND_CONCRETE, texel: 0.5, crown: true, push: { step: 6, steps: 8 }
        });
        if (bay) placed++;
      }
      this.stats.hasSubstation = placed >= 3;
    }

    // ---------------------------------------------------------------------
    // FINALE: the broadcast terminal beyond the finish, with its mast.
    // ---------------------------------------------------------------------
    for (let forward = 400; forward <= 700 && !this.stats.hasTerminal; forward += 60) {
      const u = 1 + metres(forward);
      const hall = block({
        u, lateral: towerSide * 120, size: [210, 110], top: 34, baseBelow: 180,
        kind: KIND_CONCRETE, texel: 1.6, lived: 0.1, crown: true
      });
      if (!hall) continue;
      this.stats.hasTerminal = true;
      this.landmarks.terminal = new THREE.Vector3(hall.centre.x, hall.topY, hall.centre.z);
      const upper = block({
        u, lateral: hall.lateral + towerSide * 30, size: [120, 70], top: 78, baseBelow: -34,
        kind: KIND_GLASS, texel: 1.4, lived: 0.5, crown: true
      });
      const mastBase = new THREE.Vector3(hall.centre.x, (upper ?? hall).topY, hall.centre.z);
      const mastHeight = 190;
      const mast = new THREE.Matrix4().compose(
        mastBase.clone().add(new THREE.Vector3(0, mastHeight / 2, 0)),
        hall.q,
        new THREE.Vector3(11, mastHeight, 11)
      );
      if (fits(boxes.box, mast)) boxes.add(mast, [KIND_LATTICE, 1.5, 0, 0], rng());
      glow(mastBase.clone().add(new THREE.Vector3(0, mastHeight + 4, 0)), 30, RED, 1.3, GLOW_BEACON, 0.1);
      glow(mastBase.clone().add(new THREE.Vector3(0, mastHeight * 0.5, 0)), 12, RED, 1.0, GLOW_NAV);
      // Forecourt lamps mark the approach.
      const at = frame.sample(u);
      for (const side of [-1, 1]) {
        const lamp = hall.centre.clone().addScaledVector(at.right, side * 80).addScaledVector(at.forward, -62);
        lamp.y = hall.topY + 6;
        glow(lamp, 10, AMBER, 0.9, GLOW_STEADY);
      }
    }

    // ---------------------------------------------------------------------
    // Bake.
    // ---------------------------------------------------------------------
    const structure = createSignalCityMaterial(this.uniforms);
    this.materials.push(structure);
    const mesh = boxes.build(structure);
    if (mesh) {
      this.group.add(mesh);
      this.stats.drawBatches++;
    }

    if (this.stats.hasTrain) {
      const geometry = this.track(new THREE.BoxGeometry(1, 1, 1));
      const params: number[] = [];
      const seeds: number[] = [];
      for (let i = 0; i < TRAIN_CARS; i++) {
        params.push(KIND_TRAIN, 1.0, 0.86, 0);
        seeds.push(i * 0.137);
      }
      geometry.setAttribute('aParams', new THREE.InstancedBufferAttribute(new Float32Array(params), 4));
      geometry.setAttribute('aLamp', new THREE.InstancedBufferAttribute(new Float32Array(TRAIN_CARS * 4), 4));
      geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 1));
      this.trainMesh = new THREE.InstancedMesh(geometry, structure, TRAIN_CARS);
      this.trainMesh.name = 'SignalCityTrain';
      this.trainMesh.frustumCulled = false;
      this.trainMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(this.trainMesh);
      this.stats.drawBatches++;
      this.poseTrain(0);
    }

    // The glow shader is shared with the station: steady lamps, navigation
    // lights that answer percussion, and slow beacons.
    const glowMaterial = createOrbitalGlowMaterial(this.uniforms as unknown as OrbitalUniforms);
    this.materials.push(glowMaterial);
    const glowMesh = glows.build('SignalCityGlows', glowMaterial);
    if (glowMesh) {
      this.track(glowMesh.geometry);
      this.group.add(glowMesh);
      this.stats.drawBatches++;
    }
  }

  /** World matrices of the train's cars at `time` seconds (also used by tests). */
  public trainMatrices(time: number): THREE.Matrix4[] {
    const out: THREE.Matrix4[] = [];
    if (!this.stats.hasTrain) return out;
    const trainLength = TRAIN_CARS * (TRAIN_CAR_LENGTH + 1.2);
    const usable = Math.max(1, this.trainTotal - trainLength);
    // A slow shuttle: out, a pause, and back. Position depends only on time.
    const period = 2 * (usable / 22 + 6);
    const phase = (((time % period) + period) % period) / period;
    const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
    const eased = Math.min(1, Math.max(0, (tri - 0.06) / 0.88));
    const head = (eased * eased * (3 - 2 * eased)) * usable;
    const at = new THREE.Vector3();
    const ahead = new THREE.Vector3();
    for (let i = 0; i < TRAIN_CARS; i++) {
      const d = head + (i + 0.5) * (TRAIN_CAR_LENGTH + 1.2);
      this.pathPoint(d, at);
      this.pathPoint(Math.min(this.trainTotal, d + 2), ahead);
      const x = ahead.sub(at);
      if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
      x.normalize();
      const z = new THREE.Vector3().crossVectors(x, UP).normalize();
      const y = new THREE.Vector3().crossVectors(z, x).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      out.push(
        new THREE.Matrix4().compose(
          at.clone().add(new THREE.Vector3(0, TRAIN_HEIGHT * 0.42, 0)),
          q,
          new THREE.Vector3(TRAIN_CAR_LENGTH, 3.6, 3.4)
        )
      );
    }
    return out;
  }

  private pathPoint(distance: number, out: THREE.Vector3): THREE.Vector3 {
    const lengths = this.trainLengths;
    const d = Math.min(this.trainTotal, Math.max(0, distance));
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < d) i++;
    const span = Math.max(1e-4, lengths[i] - lengths[i - 1]);
    return out.copy(this.trainPath[i - 1]).lerp(this.trainPath[i], (d - lengths[i - 1]) / span);
  }

  private poseTrain(time: number): void {
    if (!this.trainMesh) return;
    const matrices = this.trainMatrices(time);
    for (let i = 0; i < matrices.length; i++) this.trainMesh.setMatrixAt(i, matrices[i]);
    this.trainMesh.instanceMatrix.needsUpdate = true;
  }

  public update(frame: EnvironmentThemeFrame): void {
    if (this.disposed) return;
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const u = this.uniforms;

    const target = Math.max(0, Math.min(1, frame.routeProgress));
    if (this.routeU < 0) this.routeU = target;
    else this.routeU += (target - this.routeU) * (1 - Math.exp(-dt / 1.4));

    const now = frame.songTime;
    if (this.lastSongTime < 0 || now < this.lastSongTime || now - this.lastSongTime > 0.5) {
      this.hitCursor = this.hits.findIndex((h) => h.time > now);
      if (this.hitCursor < 0) this.hitCursor = this.hits.length;
    } else {
      while (this.hitCursor < this.hits.length && this.hits[this.hitCursor].time <= now) {
        if (!frame.reduceMotion) this.reactivity.strikeHat(this.hits[this.hitCursor].strength);
        this.hitCursor++;
      }
    }
    this.lastSongTime = now;

    this.reactivity.update(frame.visualState, dt, frame.reduceMotion);
    const effect = Math.max(0, Math.min(1.25, frame.effectScale));
    const sustain = Math.min(1, this.reactivity.sustain * effect);
    u.uStation.value = Math.min(1, sampleProgression(this.spans, DISTRICT_LIGHT, this.routeU) * (0.6 + 0.4 * sustain));
    u.uKick.value = Math.min(1, this.reactivity.kick * effect);
    u.uHat.value = Math.min(1, this.reactivity.hat * effect);
    u.uHatSlot.value = this.reactivity.hatSlot;
    u.uAccent.value = Math.min(1, this.reactivity.accent * effect);
    u.uAccentSlot.value = this.reactivity.accentSlot;
    u.uBeacon.value = 0.5 + 0.5 * Math.sin(now * 0.9);
    u.uTime.value = now;

    // The train is driven by song time alone, so it is where it should be
    // after a restart or a seek, and it holds still under reduce-motion.
    if (!frame.reduceMotion) this.poseTrain(now);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.skyGroup.removeFromParent();
    this.group.clear();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.trainMesh = null;
  }
}

/** Builds the Signal City layer for a city map. */
export function buildSignalCityLayer(context: EnvironmentThemeBuildContext): SignalCityLayer {
  return new SignalCityLayer(context);
}
