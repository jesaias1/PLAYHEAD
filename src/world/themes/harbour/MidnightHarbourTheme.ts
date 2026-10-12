/**
 * MIDNIGHT HARBOUR — a vast working port at night.
 *
 * Black water, monumental hulls, skeletal cranes and very little light:
 *
 *   OPENING    loading docks: quays and container stacks on both sides, sheds
 *              behind, one anchored ship's lights far out
 *   BUILD      the route runs alongside a cargo ship's hull while the cranes
 *              on the opposite quay swing into view overhead
 *   (lull)     a warehouse-side passage with sparse warm lamps (the song's
 *              breakdown, or its quietest building section if it has none)
 *   PEAK       open water: ships at anchor, a far line of cranes, the
 *              breakwater lights, framed by two cranes at the way in
 *   FINALE     the lighthouse on its caisson beyond the finish
 *
 * WATER is scenery and nothing else: no collision, no trigger, no effect on
 * the player. It is one plane placed BELOW every gameplay surface of the
 * course (route, ramps, shelves, spines) with the corridor's own clearance, so
 * it can never submerge or hide anything you can land on. On a course that
 * descends a long way, structures built beside the higher parts of the route
 * stand tall above the water rather than the water rising to meet them.
 *
 * PRESENTATION ONLY: every piece is checked against the RouteExclusionCorridor
 * as final world-space bounds before it is accepted.
 */

import * as THREE from 'three';
import { PaletteSelector, TrackPalette } from '../../../audio/TrackPalettes';
import { RouteNode } from '../../../generation/GenerationTypes';
import { tagWorldRole } from '../../WorldRoles';
import {
  EnvironmentThemeBuildContext,
  EnvironmentThemeDefinition,
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
import {
  HarbourUniforms,
  WATER_LIGHT_COUNT,
  createHarbourSkyMaterial,
  createHarbourStructureMaterial,
  createHarbourUniforms,
  createHarbourWaterMaterial
} from './HarbourShaders';

/** Working-light level of the port; sustained energy rides on it. */
const PORT_LIGHT: ProgressionValues = { OPENING: 0.4, BUILD: 0.62, PEAK: 0.92, BREAKDOWN: 0.3, FINALE: 0.75 };

const KIND_CONCRETE = 0;
const KIND_HULL = 1;
const KIND_LATTICE = 2;
const KIND_CONTAINERS = 3;
const KIND_SHED = 4;
const KIND_BANDED = 5;
const GLOW_STEADY = 0;
const GLOW_NAV = 1;
const GLOW_BEACON = 2;

const AMBER = new THREE.Color(1.0, 0.58, 0.18);
const RED = new THREE.Color(1.0, 0.14, 0.08);
const GREEN = new THREE.Color(0.15, 1.0, 0.45);
const WHITE = new THREE.Color(1.0, 0.94, 0.8);
const UP = new THREE.Vector3(0, 1, 0);
/** Nothing is built deeper than this below its local route height. */
const MAX_DEPTH = 230;

export interface MidnightHarbourStats {
  quays: number;
  containerStacks: number;
  sheds: number;
  cranes: number;
  hullSections: number;
  anchoredShips: number;
  lights: number;
  hasShipAlongside: boolean;
  hasLighthouse: boolean;
  waterY: number;
  /** Lowest gameplay surface of the course, for the water-clearance check. */
  lowestGameplayY: number;
  rejected: number;
  drawBatches: number;
}

interface WaterLight {
  position: THREE.Vector3;
  color: THREE.Color;
  kind: number;
  distance: number;
}

export class MidnightHarbourInstance implements EnvironmentThemeInstance {
  public readonly id = 'MIDNIGHT_HARBOUR' as const;
  public readonly group = new THREE.Group();
  public readonly skyGroup = new THREE.Group();
  public readonly lighting: EnvironmentThemeLighting;
  public readonly uniforms: HarbourUniforms = createHarbourUniforms();
  public readonly spans: ProgressionSpan[];
  public readonly reactivity = new ThemeReactivity();
  public readonly stats: MidnightHarbourStats = {
    quays: 0,
    containerStacks: 0,
    sheds: 0,
    cranes: 0,
    hullSections: 0,
    anchoredShips: 0,
    lights: 0,
    hasShipAlongside: false,
    hasLighthouse: false,
    waterY: 0,
    lowestGameplayY: 0,
    rejected: 0,
    drawBatches: 0
  };
  /** The water plane. Follows the player in X/Z only; its height never changes. */
  public water: THREE.Mesh | null = null;

  private readonly frame: RouteFrame;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly waterLights: WaterLight[] = [];
  private readonly nearest: WaterLight[] = [];
  private nearestAge = 0;
  private readonly hits: Array<{ time: number; strength: number }> = [];
  private hitCursor = 0;
  private lastSongTime = -1;
  private routeU = -1;
  private disposed = false;

  constructor(private readonly context: EnvironmentThemeBuildContext) {
    this.group.name = 'MidnightHarbour';
    this.skyGroup.name = 'MidnightHarbourSky';
    tagWorldRole(this.group, 'DECORATION', 'MidnightHarbour', false);
    tagWorldRole(this.skyGroup, 'IGNORE_WORLD_SAFETY', 'MidnightHarbourSky', false);

    const { track, analysis, palette } = context;
    this.frame = new RouteFrame(track.route, track.totalDistance);
    this.spans = deriveProgression(analysis, track);
    this.uniforms.uHaze.value.copy(palette.fogColor).multiplyScalar(1.4).add(new THREE.Color(0.006, 0.009, 0.014));

    const start = this.frame.sample(0).position;
    const end = this.frame.sample(1).position;
    const heading = end.clone().sub(start).setY(0);
    if (heading.lengthSq() < 1e-6) heading.set(0, 0, 1);
    heading.normalize();
    const keyDir = heading.clone().applyAxisAngle(UP, 0.6).multiplyScalar(Math.cos(1.0)).setY(Math.sin(1.0)).normalize();
    this.uniforms.uKeyDir.value.copy(keyDir);
    this.lighting = {
      keyColor: 0xc4d2ee,
      keyIntensity: 1.55,
      keyOffset: keyDir.clone().multiplyScalar(150),
      hemiSkyColor: 0x2a3648,
      hemiGroundColor: 0x241a10,
      hemiIntensity: 1.1
    };

    for (const onset of analysis.onsets ?? []) {
      if (onset.highs > 0.3 && onset.highs >= onset.bass * 0.8) {
        this.hits.push({ time: onset.time, strength: onset.highs * onset.strength });
      }
    }

    const skyMaterial = createHarbourSkyMaterial(this.uniforms);
    this.materials.push(skyMaterial);
    const dome = new THREE.Mesh(this.track(new THREE.SphereGeometry(900, 24, 16)), skyMaterial);
    dome.name = 'HarbourSkyDome';
    dome.renderOrder = -1000;
    dome.frustumCulled = false;
    this.skyGroup.add(dome);

    if (!this.frame.isEmpty) this.build(heading);
  }

  private track<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private build(heading: THREE.Vector3): void {
    const { corridor, track, analysis, quality } = this.context;
    const rng = mulberry32((track.seed ^ 0x48415242) >>> 0);
    const frame = this.frame;
    const spans = this.spans;
    const detail = quality?.reactiveLandmarkScale ?? 1;
    const metres = (m: number): number => m / frame.total;
    const quaySide = rng() > 0.5 ? 1 : -1;
    const shipSide = -quaySide;
    this.uniforms.uPortDir.value.copy(new THREE.Vector3(-heading.z, 0, heading.x).multiplyScalar(quaySide));

    const boxes = new InstanceBatch('HarbourBoxes', this.track(new THREE.BoxGeometry(1, 1, 1)));
    const cylinders = new InstanceBatch('HarbourCylinders', this.track(new THREE.CylinderGeometry(1, 1, 1, 16)));
    const glows = new GlowBatch();
    const scratch = new THREE.Box3();
    const unit = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
    const fits = (geomBox: THREE.Box3, matrix: THREE.Matrix4): boolean =>
      corridor.evaluateVolume(scratch.copy(geomBox).applyMatrix4(matrix)) === null;

    // -------------------------------------------------------------------
    // WATER LEVEL. Below every gameplay surface of the course, then lowered
    // further until a slab covering the whole course at that height clears
    // the corridor (so the plane is safe wherever it follows the player).
    // -------------------------------------------------------------------
    const gameplay: RouteNode[] = [
      ...track.route,
      ...(track.optionalRamps ?? []),
      ...(track.recoveryShelves ?? []),
      ...(track.signalSpines ?? []),
      ...(track.obstacles ?? [])
    ];
    for (const fork of track.forks ?? []) gameplay.push(...fork.masteryNodes);
    let lowest = Infinity;
    const extent = new THREE.Box3();
    for (const node of gameplay) {
      lowest = Math.min(lowest, node.position.y - (node.dimensions?.y ?? 2));
      extent.expandByPoint(new THREE.Vector3(node.position.x, 0, node.position.z));
    }
    if (!isFinite(lowest)) lowest = 0;
    extent.expandByScalar(400);
    let waterY = lowest - 70;
    for (let i = 0; i < 12; i++) {
      const slab = new THREE.Box3(
        new THREE.Vector3(extent.min.x, waterY - 1, extent.min.z),
        new THREE.Vector3(extent.max.x, waterY, extent.max.z)
      );
      if (corridor.evaluateVolume(slab) === null) break;
      waterY -= 12;
    }
    this.stats.waterY = waterY;
    this.stats.lowestGameplayY = lowest;
    this.uniforms.uWaterY.value = waterY;

    const orient = (forward: THREE.Vector3, right: THREE.Vector3, yaw = 0): THREE.Quaternion => {
      const q = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(right.clone().negate(), UP, forward)
      );
      if (yaw) q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
      return q;
    };

    interface Placed { centre: THREE.Vector3; topY: number; bottomY: number; lateral: number; q: THREE.Quaternion; forward: THREE.Vector3; right: THREE.Vector3 }

    /**
     * A box standing in the water: its top is `top` above the local route (or
     * above the water when `afloat`), its foot at the water or MAX_DEPTH down.
     */
    const block = (spec: {
      u: number;
      lateral: number;
      along?: number;
      size: [number, number];
      top: number;
      afloat?: boolean;
      bottomAt?: number;
      kind: number;
      texel: number;
      lived?: number;
      strip?: boolean;
      yaw?: number;
      batch?: InstanceBatch;
      push?: { step: number; steps: number };
    }): Placed | null => {
      const at = frame.sample(spec.u);
      const q = orient(at.forward, at.right, spec.yaw ?? 0);
      const topY = spec.afloat ? waterY + spec.top : at.position.y + spec.top;
      const bottomY = spec.bottomAt ?? Math.max(waterY - 3, at.position.y - MAX_DEPTH);
      const height = Math.max(1, topY - bottomY);
      const batch = spec.batch ?? boxes;
      const scale = new THREE.Vector3(spec.size[0], height, spec.size[1]);
      const steps = spec.push?.steps ?? 0;
      for (let i = 0; i <= steps; i++) {
        const lateral = spec.lateral + Math.sign(spec.lateral || 1) * (spec.push?.step ?? 0) * i;
        const centre = at.position.clone().addScaledVector(at.right, lateral).addScaledVector(at.forward, spec.along ?? 0);
        centre.y = (topY + bottomY) / 2;
        const matrix = new THREE.Matrix4().compose(centre, q, scale);
        if (!fits(batch.box, matrix)) continue;
        batch.add(matrix, [spec.kind, spec.texel, spec.lived ?? 0, spec.strip ? 1 : 0], rng());
        return { centre, topY, bottomY, lateral, q, forward: at.forward, right: at.right };
      }
      this.stats.rejected++;
      return null;
    };

    /** A free box given directly in world space (boom, deckhouse, ...). */
    const piece = (centre: THREE.Vector3, q: THREE.Quaternion, size: THREE.Vector3, kind: number, texel: number, lived = 0, batch: InstanceBatch = boxes): boolean => {
      const matrix = new THREE.Matrix4().compose(centre, q, size);
      if (!fits(batch.box, matrix)) return false;
      batch.add(matrix, [kind, texel, lived, 0], rng());
      return true;
    };

    const light = (pos: THREE.Vector3, size: number, color: THREE.Color, intensity: number, kind: number, core = 0): boolean => {
      const matrix = new THREE.Matrix4().compose(pos, new THREE.Quaternion(), new THREE.Vector3(size, size, size));
      if (!fits(unit, matrix)) return false;
      glows.add(matrix, color, [intensity, kind, rng(), core]);
      this.waterLights.push({ position: pos.clone(), color: color.clone().multiplyScalar(intensity), kind, distance: 0 });
      this.stats.lights++;
      return true;
    };

    const opening = roleSpan(spans, 'OPENING');
    const peak = roleSpan(spans, 'PEAK');
    const builds = spans.filter((s) => s.role === 'BUILD');
    // The quiet passage: the breakdown, or the calmest later building section.
    let lull = roleSpan(spans, 'BREAKDOWN');
    if (!lull && builds.length > 1) {
      lull = builds.slice(1).reduce((a, b) =>
        (analysis.sections[b.sectionIndex]?.intensity ?? 1) < (analysis.sections[a.sectionIndex]?.intensity ?? 1) ? b : a
      );
    }
    const shipSpan = builds.find((s) => s !== lull) ?? builds[0] ?? null;
    const isLull = (u: number): boolean => !!lull && u >= lull.start && u < lull.end;

    /** A quay with container stacks on it, a floodlight mast, and maybe a shed behind. */
    const dock = (u: number, side: number, shed: boolean): void => {
      const quay = block({
        u, lateral: side * 152, size: [84, 60], top: -5, kind: KIND_CONCRETE, texel: 1.5, strip: true,
        push: { step: 14, steps: 6 }
      });
      if (!quay) return;
      this.stats.quays++;
      // Stacks stand in ordered rows along the quay edge, never scattered.
      for (let row = 0; row < 2; row++) {
        for (const along of [-17, 13]) {
          if (rng() < 0.22) continue;
          const tiers = 1 + Math.floor(rng() * 4);
          const centre = quay.centre.clone()
            .addScaledVector(quay.right, -side * (26 - row * 15))
            .addScaledVector(quay.forward, along);
          centre.y = quay.topY + tiers * 1.3;
          if (piece(centre, quay.q, new THREE.Vector3(7.32, tiers * 2.6, 24.4), KIND_CONTAINERS, 0.4)) this.stats.containerStacks++;
        }
      }
      const mastBase = quay.centre.clone().addScaledVector(quay.right, -side * 37).addScaledVector(quay.forward, 26);
      mastBase.y = quay.topY + 17;
      if (piece(mastBase, quay.q, new THREE.Vector3(1.6, 34, 1.6), KIND_LATTICE, 0.6)) {
        light(mastBase.clone().add(new THREE.Vector3(0, 18.5, 0)), 13, AMBER, 0.95, GLOW_STEADY);
      }
      if (shed) {
        const building = block({
          u, lateral: quay.lateral + side * 96, size: [64, 58], top: 20 + rng() * 10, kind: KIND_SHED, texel: 1.2,
          lived: 0.3, push: { step: 16, steps: 3 }
        });
        if (building) this.stats.sheds++;
      }
    };

    /** A ship-to-shore gantry crane: two legs, a boom out over the water. */
    const crane = (u: number, side: number, lateral: number, boomHeight: number, afloatBase: boolean): boolean => {
      // Step outward until the legs and the boom all clear the corridor.
      for (let i = 0; i < 6; i++) {
        if (craneAt(u, side, lateral + i * 18, boomHeight, afloatBase)) return true;
      }
      this.stats.rejected++;
      return false;
    };
    const craneAt = (u: number, side: number, lateral: number, boomHeight: number, afloatBase: boolean): boolean => {
      const at = frame.sample(u);
      const q = orient(at.forward, at.right);
      const base = afloatBase ? waterY + 6 : Math.max(waterY - 3, at.position.y - MAX_DEPTH);
      const top = afloatBase ? waterY + boomHeight : at.position.y + boomHeight;
      const legAt = (l: number): THREE.Vector3 => {
        const p = at.position.clone().addScaledVector(at.right, side * l);
        p.y = (top + base) / 2;
        return p;
      };
      const legSize = new THREE.Vector3(5, top - base, 5);
      const inner = new THREE.Matrix4().compose(legAt(lateral), q, legSize);
      const outer = new THREE.Matrix4().compose(legAt(lateral + 30), q, legSize);
      // The boom reaches out over the water but stops well short of the route.
      const boomLength = afloatBase ? 150 : 104;
      const boomCentre = at.position.clone().addScaledVector(at.right, side * (lateral + 30 - boomLength / 2 + 14));
      boomCentre.y = top + 6;
      const boom = new THREE.Matrix4().compose(boomCentre, q, new THREE.Vector3(boomLength, 8, 7));
      if (!fits(boxes.box, inner) || !fits(boxes.box, outer) || !fits(boxes.box, boom)) {
        return false;
      }
      boxes.add(inner, [KIND_LATTICE, 1.0, 0, 0], rng());
      boxes.add(outer, [KIND_LATTICE, 1.0, 0, 0], rng());
      boxes.add(boom, [KIND_LATTICE, 1.0, 0, 0], rng());
      const house = at.position.clone().addScaledVector(at.right, side * (lateral + 15));
      house.y = top + 15;
      piece(house, q, new THREE.Vector3(16, 9, 10), KIND_SHED, 0.8, 0.5);
      const tip = boomCentre.clone().addScaledVector(at.right, -side * (boomLength / 2));
      light(tip.clone().add(new THREE.Vector3(0, 6, 0)), afloatBase ? 16 : 9, RED, 1.0, GLOW_NAV);
      light(house.clone().add(new THREE.Vector3(0, 8, 0)), afloatBase ? 16 : 9, RED, 1.0, GLOW_NAV);
      this.stats.cranes++;
      return true;
    };

    /** A ship built from hull sections, bow towards `bowAlong`. */
    const ship = (u: number, side: number, lateral: number, length: number, afloat: boolean, deckTop: number): boolean => {
      const sections = Math.max(3, Math.round(length / 56));
      const sectionLength = length / sections;
      let placedAny = false;
      let first: Placed | null = null;
      let last: Placed | null = null;
      for (let i = 0; i < sections; i++) {
        const along = (i - (sections - 1) / 2) * sectionLength;
        // Fine entry at the bow, fuller towards the stern.
        const beam = i === sections - 1 ? 22 : i === sections - 2 ? 36 : 46;
        const hull = block({
          u, lateral: side * lateral, along, size: [beam, sectionLength + 0.5], top: i === sections - 1 ? deckTop + 5 : deckTop,
          afloat, bottomAt: afloat ? waterY - 2 : undefined, kind: KIND_HULL, texel: 1.4, lived: i < 2 ? 0.7 : 0.25
        });
        if (!hull) continue;
        this.stats.hullSections++;
        placedAny = true;
        if (!first) first = hull;
        last = hull;
        // Deck cargo amidships.
        if (i >= 2 && i < sections - 1) {
          const cargo = hull.centre.clone();
          const tiers = 2 + Math.floor(rng() * 3);
          cargo.y = hull.topY + tiers * 1.3;
          if (piece(cargo, hull.q, new THREE.Vector3(Math.floor((beam - 6) / 2.44) * 2.44, tiers * 2.6, Math.floor((sectionLength - 6) / 12.2) * 12.2), KIND_CONTAINERS, 0.4)) {
            this.stats.containerStacks++;
          }
        }
      }
      if (!placedAny || !first || !last) return false;
      // Accommodation block and funnel aft.
      const house = first.centre.clone();
      house.y = first.topY + 15;
      piece(house, first.q, new THREE.Vector3(38, 30, 24), KIND_SHED, 0.9, 0.55);
      const funnel = house.clone().addScaledVector(first.forward, -4);
      funnel.y = first.topY + 38;
      piece(funnel, first.q, new THREE.Vector3(6.5, 16, 6.5), KIND_BANDED, 0.8, 0, cylinders);
      const mast = funnel.clone().add(new THREE.Vector3(0, 12, 0));
      light(mast, afloat ? 20 : 10, WHITE, 0.9, GLOW_STEADY);
      // Port and starboard lights, and one at the stem.
      light(house.clone().addScaledVector(first.right, 20).add(new THREE.Vector3(0, 8, 0)), afloat ? 15 : 8, RED, 0.9, GLOW_NAV);
      light(house.clone().addScaledVector(first.right, -20).add(new THREE.Vector3(0, 8, 0)), afloat ? 15 : 8, GREEN, 0.9, GLOW_NAV);
      light(new THREE.Vector3(last.centre.x, last.topY + 6, last.centre.z), afloat ? 15 : 8, WHITE, 0.8, GLOW_STEADY);
      return true;
    };

    // ---------------------------------------------------------------------
    // OPENING: docks on both sides. BUILD: quay and cranes on one side only.
    // ---------------------------------------------------------------------
    const dockEnd = peak ? peak.start : 0.6;
    for (let u = -metres(40), i = 0; u < dockEnd - metres(40); u += metres(64), i++) {
      if (isLull(u)) continue;
      const inOpening = !!opening && u < opening.end;
      dock(u, quaySide, i % 2 === 0);
      if (inOpening) dock(u + metres(20), shipSide, i % 3 === 1);
    }

    // The ship alongside, and the cranes that work her from the far quay.
    if (shipSpan) {
      const shipU = (shipSpan.start + shipSpan.end) / 2;
      const length = Math.min(330, (shipSpan.end - shipSpan.start) * frame.total * 0.8);
      for (let lateral = 124; lateral <= 190 && !this.stats.hasShipAlongside; lateral += 12) {
        // All sections share one lateral, so try the whole ship at each.
        const before = boxes.count;
        const rejectedBefore = this.stats.rejected;
        if (ship(shipU, shipSide, lateral, length, false, 22) && boxes.count - before >= 6) {
          this.stats.hasShipAlongside = true;
        } else if (boxes.count === before) {
          this.stats.rejected = rejectedBefore;
        }
      }
      for (const t of [0.25, 0.6, 0.9]) {
        const u = shipSpan.start + (shipSpan.end - shipSpan.start) * t;
        for (let height = 92; height <= 150; height += 14) {
          if (crane(u, quaySide, 122, height, false)) break;
        }
      }
    }

    // ---------------------------------------------------------------------
    // The quiet passage: sheds close by on both sides, a few warm lamps.
    // ---------------------------------------------------------------------
    if (lull) {
      for (let u = lull.start + metres(30), i = 0; u < lull.end - metres(30); u += metres(110), i++) {
        for (const side of [-1, 1]) {
          const shed = block({
            u: u + (side > 0 ? metres(40) : 0), lateral: side * 128, size: [48, 86], top: 16 + rng() * 14,
            kind: KIND_SHED, texel: 1.2, lived: 0.2, strip: i % 2 === 0, push: { step: 12, steps: 7 }
          });
          if (!shed) continue;
          this.stats.sheds++;
          const lamp = shed.centre.clone().addScaledVector(shed.right, -side * 27);
          lamp.y = shed.topY - 4;
          light(lamp, 9, AMBER, 0.8, GLOW_STEADY);
        }
      }
    }

    // ---------------------------------------------------------------------
    // PEAK: open water. Two cranes frame the way in; beyond them ships ride
    // at anchor, a far terminal's cranes stand in a row, and the breakwater
    // lights mark the harbour mouth.
    // ---------------------------------------------------------------------
    if (peak) {
      const length = peak.end - peak.start;
      for (const side of [-1, 1]) {
        for (let height = 96; height <= 152; height += 14) {
          if (crane(peak.start + metres(10), side, 124, height, false)) break;
        }
      }
      const anchorages: Array<[number, number, number, number]> = [
        [peak.start + length * 0.3, shipSide, 520, 250],
        [peak.start + length * 0.62, shipSide, 820, 300],
        [peak.start + length * 0.75, quaySide, 640, 220]
      ];
      for (const [u, side, lateral, shipLength] of anchorages.slice(0, detail < 0.5 ? 2 : 3)) {
        if (ship(u, side, lateral, shipLength, true, 26)) this.stats.anchoredShips++;
      }
      // Far terminal: a low quay at the waterline with a rank of cranes.
      const terminalU = peak.start + length * 0.45;
      for (let i = 0; i < (detail < 0.5 ? 3 : 5); i++) {
        const u = terminalU + metres((i - 2) * 95);
        block({ u, lateral: quaySide * 800, size: [70, 96], top: 6, afloat: true, bottomAt: waterY - 2, kind: KIND_CONCRETE, texel: 2.0, strip: true });
        crane(u, quaySide, 770, 120, true);
      }
      // Breakwater across the far water, with its port and starboard marks.
      const mouthU = peak.start + length * 0.9;
      for (let i = -3; i <= 3; i++) {
        if (i === 0) continue;
        const arm = block({
          u: mouthU, lateral: shipSide * 700, along: i * 92, size: [14, 90], top: 5, afloat: true, bottomAt: waterY - 2,
          kind: KIND_CONCRETE, texel: 2.0
        });
        if (arm && Math.abs(i) === 1) {
          light(new THREE.Vector3(arm.centre.x, arm.topY + 9, arm.centre.z).addScaledVector(arm.forward, -i * 40), 18, i < 0 ? RED : GREEN, 1.0, GLOW_NAV);
        }
      }
    }

    // ---------------------------------------------------------------------
    // FINALE: the lighthouse on its caisson, beyond the finish.
    // ---------------------------------------------------------------------
    for (let forward = 460; forward <= 760 && !this.stats.hasLighthouse; forward += 60) {
      const u = 1 + metres(forward);
      const caisson = block({ u, lateral: shipSide * 230, size: [58, 58], top: -8, kind: KIND_CONCRETE, texel: 2.0, strip: true });
      if (!caisson) continue;
      let y = caisson.topY;
      let ok = true;
      for (const [radius, height] of [[11, 46], [9.5, 44], [8, 40]] as Array<[number, number]>) {
        const centre = new THREE.Vector3(caisson.centre.x, y + height / 2, caisson.centre.z);
        ok = piece(centre, caisson.q, new THREE.Vector3(radius, height, radius), KIND_BANDED, 1.0, 0, cylinders) && ok;
        y += height;
      }
      if (!ok) continue;
      const gallery = new THREE.Vector3(caisson.centre.x, y + 1.2, caisson.centre.z);
      piece(gallery, caisson.q, new THREE.Vector3(11, 2.4, 11), KIND_CONCRETE, 0.6, 0, cylinders);
      const lantern = new THREE.Vector3(caisson.centre.x, y + 8, caisson.centre.z);
      light(lantern, 64, WHITE, 1.5, GLOW_BEACON, 0.12);
      light(new THREE.Vector3(caisson.centre.x, caisson.topY + 6, caisson.centre.z).addScaledVector(caisson.forward, -34), 10, AMBER, 0.9, GLOW_STEADY);
      this.stats.hasLighthouse = true;
    }

    // ---------------------------------------------------------------------
    // Bake.
    // ---------------------------------------------------------------------
    const structure = createHarbourStructureMaterial(this.uniforms);
    this.materials.push(structure);
    for (const batch of [boxes, cylinders]) {
      const mesh = batch.build(structure);
      if (mesh) {
        this.group.add(mesh);
        this.stats.drawBatches++;
      }
    }

    const waterMaterial = createHarbourWaterMaterial(this.uniforms);
    this.materials.push(waterMaterial);
    const waterGeometry = this.track(new THREE.PlaneGeometry(4200, 4200, 1, 1));
    waterGeometry.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(waterGeometry, waterMaterial);
    this.water.name = 'HarbourWater';
    this.water.position.set(start0(frame).x, waterY, start0(frame).z);
    this.water.frustumCulled = false;
    this.water.renderOrder = -500;
    this.group.add(this.water);
    this.stats.drawBatches++;

    const glowMaterial = createOrbitalGlowMaterial(this.uniforms as unknown as OrbitalUniforms);
    this.materials.push(glowMaterial);
    const glowMesh = glows.build('HarbourGlows', glowMaterial);
    if (glowMesh) {
      this.track(glowMesh.geometry);
      this.group.add(glowMesh);
      this.stats.drawBatches++;
    }
  }

  public update(frame: EnvironmentThemeFrame): void {
    if (this.disposed) return;
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const u = this.uniforms;
    this.skyGroup.position.copy(frame.playerPos);
    // The water follows in X/Z only, snapped so its pattern never swims.
    if (this.water) {
      this.water.position.x = Math.round(frame.playerPos.x / 50) * 50;
      this.water.position.z = Math.round(frame.playerPos.z / 50) * 50;
    }

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
    const station = Math.min(1, sampleProgression(this.spans, PORT_LIGHT, this.routeU) * (0.6 + 0.4 * sustain));
    const hat = Math.min(1, this.reactivity.hat * effect);
    const beacon = 0.5 + 0.5 * Math.sin(now * 0.8);
    u.uStation.value = station;
    u.uKick.value = Math.min(1, this.reactivity.kick * effect);
    u.uHat.value = hat;
    u.uHatSlot.value = this.reactivity.hatSlot;
    u.uAccent.value = Math.min(1, this.reactivity.accent * effect);
    u.uAccentSlot.value = this.reactivity.accentSlot;
    u.uBeacon.value = beacon;
    u.uTime.value = frame.reduceMotion ? 0 : now;

    // The water carries the same changes: its glitter paths use the live
    // level of the nearest lights.
    // Which lights are nearest only changes as you travel, so re-pick them a
    // few times a second (no per-frame sort or allocation); their LEVELS are
    // still updated every frame.
    if (this.nearestAge-- <= 0 || this.nearest.length === 0) {
      this.nearestAge = 15;
      for (const l of this.waterLights) l.distance = l.position.distanceToSquared(frame.playerPos);
      this.waterLights.sort((a, b) => a.distance - b.distance);
      this.nearest.length = 0;
      for (let i = 0; i < Math.min(WATER_LIGHT_COUNT, this.waterLights.length); i++) this.nearest.push(this.waterLights[i]);
    }
    for (let i = 0; i < WATER_LIGHT_COUNT; i++) {
      const entry = this.nearest[i];
      if (!entry) {
        u.uLightPos.value[i].set(0, -1e5, 0);
        u.uLightColor.value[i].setRGB(0, 0, 0);
        continue;
      }
      const level = entry.kind === GLOW_STEADY ? 0.3 + 0.8 * station
        : entry.kind === GLOW_NAV ? 0.55 + 0.7 * hat
        : 0.5 + 0.5 * beacon;
      u.uLightPos.value[i].copy(entry.position);
      u.uLightColor.value[i].copy(entry.color).multiplyScalar(level);
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.skyGroup.removeFromParent();
    this.group.clear();
    this.skyGroup.clear();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.water = null;
  }
}

function start0(frame: RouteFrame): THREE.Vector3 {
  return frame.sample(0).position;
}

function createHarbourPalette(): TrackPalette {
  const palette = PaletteSelector.getPaletteByName('MIDNIGHT_HARBOUR');
  palette.fogColor = new THREE.Color('#03060b');
  return palette;
}

export const MIDNIGHT_HARBOUR_THEME: EnvironmentThemeDefinition = {
  id: 'MIDNIGHT_HARBOUR',
  displayName: 'MIDNIGHT HARBOUR',
  createPalette: createHarbourPalette,
  build: (context) => new MidnightHarbourInstance(context)
};
