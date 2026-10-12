/**
 * ORBITAL STATION — a monumental station above a planet's night side.
 *
 * The opposite of the city's density and the mountains' nature: black space,
 * a few very large, widely spaced pieces of working hardware, and one visual
 * anchor, the planet. Laid out along the song's own sections:
 *
 *   OPENING    a service bay: hull walls on the planet side, modules opposite,
 *              a truss ceiling overhead; the planet only shows through gaps
 *   BUILD      docking arms and gantries; the walls thin out and space opens
 *   (passage)  a short run of gantry frames and shroud plates that closes the
 *              view completely just before the music arrives...
 *   PEAK       ...and then nothing: the full planet, the solar wings and the
 *              station core far off
 *   BREAKDOWN  a dark maintenance stretch of antenna masts and single lights
 *   FINALE     the communications array and its beacon, beyond the finish
 *
 * PRESENTATION ONLY, like every theme: no collision, gravity and movement are
 * untouched, and every piece is measured as final world-space bounds against
 * the RouteExclusionCorridor before it is accepted. That check is why
 * everything stands well off the route and nothing is ever placed beneath it,
 * which also keeps the view down to the planet clear.
 */

import * as THREE from 'three';
import { PaletteSelector, TrackPalette } from '../../../audio/TrackPalettes';
import { tagWorldRole } from '../../WorldRoles';
import {
  EnvironmentThemeBuildContext,
  EnvironmentThemeDefinition,
  EnvironmentThemeFrame,
  EnvironmentThemeInstance,
  EnvironmentThemeLighting
} from '../EnvironmentTheme';
import { GlowBatch, InstanceBatch, NO_LAMP, mulberry32 } from '../ThemeInstancing';
import {
  ProgressionSpan,
  ProgressionValues,
  RouteFrame,
  deriveProgression,
  roleSpan,
  sampleProgression
} from '../ThemeProgression';
import { ThemeReactivity } from '../ThemeReactivity';
import {
  OrbitalUniforms,
  createOrbitalGlowMaterial,
  createOrbitalSkyMaterial,
  createOrbitalStructureMaterial,
  createOrbitalUniforms
} from './OrbitalShaders';

/** Working-light level of the station by section; sustained energy rides on it. */
const STATION_LIGHT: ProgressionValues = { OPENING: 0.42, BUILD: 0.62, PEAK: 0.9, BREAKDOWN: 0.28, FINALE: 0.78 };

const KIND_HULL = 0;
const KIND_TRUSS = 1;
const KIND_SOLAR = 2;
const KIND_DISH = 3;
const KIND_MODULE = 4;
const GLOW_FLOOD = 0;
const GLOW_NAV = 1;
const GLOW_BEACON = 2;

const AMBER = new THREE.Color(1.0, 0.62, 0.2);
const COLD = new THREE.Color(0.8, 0.9, 1.0);
const UP = new THREE.Vector3(0, 1, 0);

/** The planet is on this side of the route's overall heading (-1 = left). */
const PLANET_SIDE = -1;

export interface OrbitalStationStats {
  gantries: number;
  hullPlates: number;
  modules: number;
  dockingArms: number;
  solarPanels: number;
  masts: number;
  navLights: number;
  floodlights: number;
  hasPassage: boolean;
  hasCommsArray: boolean;
  /** Candidates dropped because no corridor-safe position was found. */
  rejected: number;
  drawBatches: number;
}

interface PlaceSpec {
  u: number;
  /** Metres to the route's right (negative = left). */
  lateral: number;
  /** Height of the piece's centre above the route. */
  up: number;
  along?: number;
  size: [number, number, number];
  /** Extra rotation in the piece's own frame (X across, Y up, Z along). */
  rot?: THREE.Euler;
  kind: number;
  texel: number;
  conduit?: boolean;
  lamp?: THREE.Vector4;
  /** Step outward (lateral) or upward until the piece clears the corridor. */
  push?: { lateral?: number; up?: number; steps: number };
}

interface Placed {
  position: THREE.Vector3;
  lateral: number;
  up: number;
}

export class OrbitalStationInstance implements EnvironmentThemeInstance {
  public readonly id = 'ORBITAL_STATION' as const;
  public readonly group = new THREE.Group();
  public readonly skyGroup = new THREE.Group();
  public readonly lighting: EnvironmentThemeLighting;
  public readonly uniforms: OrbitalUniforms = createOrbitalUniforms();
  public readonly spans: ProgressionSpan[];
  public readonly reactivity = new ThemeReactivity();
  public readonly stats: OrbitalStationStats = {
    gantries: 0,
    hullPlates: 0,
    modules: 0,
    dockingArms: 0,
    solarPanels: 0,
    masts: 0,
    navLights: 0,
    floodlights: 0,
    hasPassage: false,
    hasCommsArray: false,
    rejected: 0,
    drawBatches: 0
  };

  private readonly frame: RouteFrame;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  /** Percussion onsets of the song (time, strength) and the playback cursor. */
  private readonly hits: Array<{ time: number; strength: number }> = [];
  private hitCursor = 0;
  private lastSongTime = -1;
  private routeU = -1;
  private disposed = false;

  constructor(private readonly context: EnvironmentThemeBuildContext) {
    this.group.name = 'OrbitalStation';
    this.skyGroup.name = 'OrbitalStationSky';
    tagWorldRole(this.group, 'DECORATION', 'OrbitalStation', false);
    tagWorldRole(this.skyGroup, 'IGNORE_WORLD_SAFETY', 'OrbitalStationSky', false);

    const { track, analysis } = context;
    this.frame = new RouteFrame(track.route, track.totalDistance);
    this.spans = deriveProgression(analysis, track);

    const start = this.frame.sample(0).position;
    const end = this.frame.sample(1).position;
    const heading = end.clone().sub(start).setY(0);
    if (heading.lengthSq() < 1e-6) heading.set(0, 0, 1);
    heading.normalize();

    // The planet hangs below and to one side of the whole course, so its limb
    // crosses the forward view as a long curve instead of a flat horizon.
    const planetAzimuth = heading.clone().applyAxisAngle(UP, -PLANET_SIDE * 1.22);
    const planetDir = planetAzimuth.multiplyScalar(Math.cos(0.8)).setY(-Math.sin(0.8)).normalize();
    this.uniforms.uPlanetDir.value.copy(planetDir);
    // Dawn is just beyond the limb ahead of the route.
    const sunSide = heading.clone().addScaledVector(planetDir, -heading.dot(planetDir)).normalize();
    this.uniforms.uSunSide.value.copy(sunSide);

    const keyDir = heading
      .clone()
      .applyAxisAngle(UP, PLANET_SIDE * 0.7)
      .multiplyScalar(Math.cos(0.95))
      .setY(Math.sin(0.95))
      .normalize();
    this.uniforms.uKeyDir.value.copy(keyDir);
    this.lighting = {
      keyColor: 0xdbe8ff,
      keyIntensity: 1.6,
      keyOffset: keyDir.clone().multiplyScalar(150),
      hemiSkyColor: 0x39465c,
      hemiGroundColor: 0x0d1a33,
      hemiIntensity: 1.0
    };

    // Percussion: bright onsets that are not just the top of a bass hit.
    for (const onset of analysis.onsets ?? []) {
      if (onset.highs > 0.3 && onset.highs >= onset.bass * 0.8) {
        this.hits.push({ time: onset.time, strength: onset.highs * onset.strength });
      }
    }

    const skyMaterial = createOrbitalSkyMaterial(this.uniforms);
    this.materials.push(skyMaterial);
    const dome = new THREE.Mesh(this.track(new THREE.SphereGeometry(900, 32, 20)), skyMaterial);
    dome.name = 'OrbitalSkyDome';
    dome.renderOrder = -1000;
    dome.frustumCulled = false;
    this.skyGroup.add(dome);

    if (!this.frame.isEmpty) this.buildStation();
  }

  private track<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private buildStation(): void {
    const { corridor, track, quality } = this.context;
    const rng = mulberry32((track.seed ^ 0x4f524249) >>> 0);
    const frame = this.frame;
    const spans = this.spans;
    const detail = quality?.reactiveLandmarkScale ?? 1;
    const P = PLANET_SIDE;

    const boxes = new InstanceBatch('OrbitalBoxes', this.track(new THREE.BoxGeometry(1, 1, 1)));
    const cylinders = new InstanceBatch('OrbitalModules', this.track(new THREE.CylinderGeometry(1, 1, 1, 20)));
    const dishGeometry = this.track(new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2));
    dishGeometry.computeBoundingBox();
    const dishes = new InstanceBatch('OrbitalDishes', dishGeometry);
    const ringGeometry = this.track(new THREE.TorusGeometry(1, 0.085, 8, 36));
    ringGeometry.rotateX(Math.PI / 2);
    ringGeometry.computeBoundingBox();
    const rings = new InstanceBatch('OrbitalRings', ringGeometry);
    const glows = new GlowBatch();

    const scratch = new THREE.Box3();
    const fits = (geomBox: THREE.Box3, matrix: THREE.Matrix4): boolean =>
      corridor.evaluateVolume(scratch.copy(geomBox).applyMatrix4(matrix)) === null;

    /** Orientation of a piece: X across the route, Y up, Z along it. */
    const orient = (forward: THREE.Vector3, right: THREE.Vector3, rot?: THREE.Euler): THREE.Quaternion => {
      const basis = new THREE.Matrix4().makeBasis(right.clone().negate(), UP, forward);
      const q = new THREE.Quaternion().setFromRotationMatrix(basis);
      if (rot) q.multiply(new THREE.Quaternion().setFromEuler(rot));
      return q;
    };

    const place = (batch: InstanceBatch, spec: PlaceSpec): Placed | null => {
      const at = frame.sample(spec.u);
      const q = orient(at.forward, at.right, spec.rot);
      const scale = new THREE.Vector3(spec.size[0], spec.size[1], spec.size[2]);
      const steps = spec.push?.steps ?? 0;
      for (let i = 0; i <= steps; i++) {
        const lateral = spec.lateral + Math.sign(spec.lateral || 1) * (spec.push?.lateral ?? 0) * i;
        const up = spec.up + (spec.push?.up ?? 0) * i;
        const position = at.position
          .clone()
          .addScaledVector(at.right, lateral)
          .addScaledVector(at.forward, spec.along ?? 0);
        position.y += up;
        const matrix = new THREE.Matrix4().compose(position, q, scale);
        if (!fits(batch.box, matrix)) continue;
        batch.add(matrix, [spec.kind, spec.texel, spec.conduit ? 1 : 0, 0], rng(), spec.lamp ?? NO_LAMP);
        return { position, lateral, up };
      }
      this.stats.rejected++;
      return null;
    };

    const addGlow = (pos: THREE.Vector3, size: number, color: THREE.Color, intensity: number, kind: number, core = 0): boolean => {
      const matrix = new THREE.Matrix4().compose(pos, new THREE.Quaternion(), new THREE.Vector3(size, size, size));
      if (!fits(glows.box, matrix)) return false;
      glows.add(matrix, color, [intensity, kind, rng(), core]);
      if (kind === GLOW_NAV) this.stats.navLights++;
      if (kind === GLOW_FLOOD) this.stats.floodlights++;
      return true;
    };

    /** A straight lattice member between two world points. */
    const beamBetween = (a: THREE.Vector3, b: THREE.Vector3, thickness: number, conduit: boolean): boolean => {
      const span = b.clone().sub(a);
      const length = span.length();
      if (length < 1) return false;
      const x = span.clone().normalize();
      const z = new THREE.Vector3().crossVectors(x, UP).normalize();
      const y = new THREE.Vector3().crossVectors(z, x).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      const matrix = new THREE.Matrix4().compose(
        a.clone().add(b).multiplyScalar(0.5),
        q,
        new THREE.Vector3(length + thickness, thickness, thickness)
      );
      if (!fits(boxes.box, matrix)) return false;
      boxes.add(matrix, [KIND_TRUSS, 1.5, conduit ? 1 : 0, 0], rng());
      return true;
    };

    /**
     * A gantry: two lattice pylons either side of the route joined by a beam
     * high overhead. Open underneath, so it frames the route without ever
     * standing between the player and the next landing.
     */
    const gantry = (u: number, opts: { conduit?: boolean; flood?: boolean; half?: number } = {}): boolean => {
      const at = frame.sample(u);
      const pylonSize: [number, number, number] = [7, 150, 7];
      const tops: THREE.Vector3[] = [];
      const feet: Array<{ lateral: number }> = [];
      for (const side of [-1, 1]) {
        // Probe for the nearest clear lateral with a nominal pylon.
        let found = -1;
        for (let i = 0; i <= 30 && found < 0; i++) {
          const lateral = (opts.half ?? 72) + i * 8;
          const position = at.position.clone().addScaledVector(at.right, side * lateral);
          position.y += 20;
          const m = new THREE.Matrix4().compose(position, orient(at.forward, at.right), new THREE.Vector3(...pylonSize));
          if (fits(boxes.box, m)) found = lateral;
        }
        if (found < 0) {
          this.stats.rejected++;
          return false;
        }
        feet.push({ lateral: side * found });
      }
      for (let lift = 88; lift <= 172 && tops.length === 0; lift += 14) {
        const a = at.position.clone().addScaledVector(at.right, feet[0].lateral);
        const b = at.position.clone().addScaledVector(at.right, feet[1].lateral);
        a.y += lift;
        b.y += lift;
        if (beamBetween(a, b, 9, !!opts.conduit)) tops.push(a, b);
      }
      if (tops.length === 0) {
        this.stats.rejected++;
        return false;
      }
      const lift = tops[0].y - at.position.y;
      for (let i = 0; i < 2; i++) {
        place(boxes, {
          u, lateral: feet[i].lateral, up: (lift - 55) / 2, size: [7, lift + 55, 7],
          kind: KIND_TRUSS, texel: 1.5, conduit: opts.conduit
        });
        const light = tops[i].clone();
        light.y += 7;
        addGlow(light, 11, AMBER, 1.0, GLOW_NAV);
      }
      if (opts.flood) {
        const mid = tops[0].clone().add(tops[1]).multiplyScalar(0.5);
        mid.y -= 8;
        addGlow(mid, 15, COLD, 0.9, GLOW_FLOOD);
      }
      this.stats.gantries++;
      return true;
    };

    /** A slab of hull standing off to one side, washed by its own floodlight. */
    const hullPlate = (u: number, side: number, lateral: number, size: [number, number, number], up: number): Placed | null => {
      const at = frame.sample(u);
      const placed = place(boxes, {
        u, lateral: side * lateral, up, size, kind: KIND_HULL, texel: 1.5,
        push: { lateral: 20, steps: 9 }
      });
      if (!placed) return null;
      this.stats.hullPlates++;
      // Re-seat the floodlight against wherever the plate actually ended up.
      const lamp = placed.position.clone().addScaledVector(at.right, -side * 30);
      lamp.y -= size[1] * 0.18;
      const index = boxes.count - 1;
      this.pendingLamps.push({ batch: boxes, index, lamp: new THREE.Vector4(lamp.x, lamp.y, lamp.z, 70) });
      addGlow(lamp, 13, COLD, 0.8, GLOW_FLOOD);
      return placed;
    };

    /** A pressurised module lying along or across the route. */
    const module = (u: number, lateral: number, up: number, radius: number, length: number, across: boolean): Placed | null => {
      const placed = place(cylinders, {
        u, lateral, up, size: [radius, length, radius],
        rot: across ? new THREE.Euler(0, 0, Math.PI / 2) : new THREE.Euler(Math.PI / 2, 0, 0),
        kind: KIND_MODULE, texel: 1.2, push: { lateral: 18, steps: 9 }
      });
      if (placed) this.stats.modules++;
      return placed;
    };

    const navBuoy = (u: number, side: number): void => {
      const at = frame.sample(u);
      for (let lateral = 50; lateral <= 110; lateral += 6) {
        const pos = at.position.clone().addScaledVector(at.right, side * lateral);
        pos.y += 3 + rng() * 6;
        if (addGlow(pos, 7, AMBER, 1.0, GLOW_NAV)) {
          const body = new THREE.Matrix4().compose(pos, new THREE.Quaternion(), new THREE.Vector3(1.1, 2.4, 1.1));
          if (fits(boxes.box, body)) boxes.add(body, [KIND_HULL, 0.4, 0, 0], rng());
          return;
        }
      }
    };

    const opening = roleSpan(spans, 'OPENING');
    const build = roleSpan(spans, 'BUILD');
    const peak = roleSpan(spans, 'PEAK');
    const breakdown = roleSpan(spans, 'BREAKDOWN');
    const finale = roleSpan(spans, 'FINALE');
    const metres = (m: number): number => m / frame.total;

    // Where the planetary reveal happens: the first moment the music peaks.
    const revealU = peak ? peak.start : 0.35;
    const passageLength = metres(280);
    const passageStart = Math.max((opening?.end ?? 0.08) * 0.6, revealU - passageLength);

    // ---------------------------------------------------------------------
    // OPENING: the service bay. Walled on the planet side, modules opposite,
    // a spine of truss overhead.
    // ---------------------------------------------------------------------
    const bayEnd = Math.min(opening ? opening.end : 0.1, passageStart);
    for (let u = -metres(60), i = 0; u < bayEnd; u += metres(150), i++) {
      // No two plates alike: the bay was built in stages.
      hullPlate(u, P, 150 + rng() * 40, [8, 150 + rng() * 110, 86 + rng() * 40], 20 + rng() * 30);
      if (i % 2 === 0) {
        const hub = module(u + metres(40), -P * 150, 12 + rng() * 20, 15, 84, false);
        if (hub) module(u + metres(40), -P * (Math.abs(hub.lateral) + 46), hub.up + 6, 10, 60, true);
      } else {
        hullPlate(u + metres(30), -P, 190, [8, 120, 80], 50);
      }
      place(boxes, {
        u: u + metres(70), lateral: 0.01, up: 128, size: [14, 14, 150], kind: KIND_TRUSS, texel: 1.5,
        conduit: true, push: { up: 16, steps: 5 }
      });
      const flood = frame.sample(u + metres(70)).position.clone();
      flood.y += 116;
      addGlow(flood, 15, COLD, 0.85, GLOW_FLOOD);
    }
    if (opening) {
      gantry(opening.start + (opening.end - opening.start) * 0.45, { conduit: true });
      gantry(opening.start + (opening.end - opening.start) * 0.9, { conduit: true, flood: true });
    }

    // ---------------------------------------------------------------------
    // BUILD: docking arms reach out, the walls thin, gantries frame the way.
    // ---------------------------------------------------------------------
    const buildStart = build ? build.start : bayEnd;
    for (let u = buildStart + metres(40), i = 0; u < passageStart - metres(40); u += metres(190), i++) {
      const side = i % 2 === 0 ? -P : P;
      const length = 200 + rng() * 80;
      const arm = place(boxes, {
        u, lateral: side * (length / 2 + 190), up: 14 + rng() * 34, size: [length, 12, 12],
        kind: KIND_TRUSS, texel: 1.5, conduit: true, push: { lateral: 24, steps: 9 }
      });
      if (arm) {
        this.stats.dockingArms++;
        const at = frame.sample(u);
        const tip = arm.position.clone().addScaledVector(at.right, -side * (length / 2 + 8));
        const collar = new THREE.Matrix4().compose(
          tip,
          orient(at.forward, at.right, new THREE.Euler(0, 0, Math.PI / 2)),
          new THREE.Vector3(24, 24, 24)
        );
        if (fits(rings.box, collar)) rings.add(collar, [KIND_MODULE, 1.2, 0, 0], rng());
        for (const dy of [-26, 26]) {
          const light = tip.clone();
          light.y += dy;
          addGlow(light, 9, AMBER, 1.0, GLOW_NAV);
        }
        const far = arm.position.clone().addScaledVector(at.right, side * (length / 2 + 4));
        addGlow(far, 11, AMBER, 1.0, GLOW_NAV);
      }
      if (i % 2 === 1) gantry(u + metres(90), { conduit: true });
      if (i % 3 === 0) hullPlate(u + metres(95), P, 190, [8, 150, 90], 40);
    }

    // ---------------------------------------------------------------------
    // The passage: gantry frames close together, shrouded on both sides and
    // above, so the view narrows to the route... and ends at the reveal.
    // ---------------------------------------------------------------------
    let frames = 0;
    for (let u = passageStart; u < revealU - metres(20); u += metres(52)) {
      if (gantry(u, { conduit: true, flood: frames % 2 === 0, half: 72 })) frames++;
      hullPlate(u + metres(10), P, 150, [8, 230, 64], 30);
      hullPlate(u + metres(10), -P, 150, [8, 230, 64], 30);
      const roof = place(boxes, {
        u: u + metres(10), lateral: 0.01, up: 150, size: [230, 7, 58], kind: KIND_HULL, texel: 1.5,
        push: { up: 16, steps: 5 }
      });
      if (roof) this.stats.hullPlates++;
    }
    this.stats.hasPassage = frames >= 3;

    // ---------------------------------------------------------------------
    // PEAK: open space. Solar wings against the planet, the station core far
    // off on the other side, one distant ring. Very little else.
    // ---------------------------------------------------------------------
    const peakEnd = finale ? finale.start : 0.95;
    const wing = (u: number, side: number, lateral: number, up: number, panels: number): void => {
      const mastLength = panels * 74;
      const mast = place(boxes, {
        u, lateral: side * lateral, up, size: [9, 9, mastLength], kind: KIND_TRUSS, texel: 1.5,
        conduit: true, push: { lateral: 40, steps: 10 }
      });
      if (!mast) return;
      for (let p = 0; p < panels; p++) {
        for (const hand of [-1, 1]) {
          const panel = place(boxes, {
            u, lateral: mast.lateral + hand * 78, up: mast.up, along: (p - (panels - 1) / 2) * 74,
            size: [132, 2.2, 62], rot: new THREE.Euler(0, 0, hand * 0.16 + (rng() - 0.5) * 0.05),
            kind: KIND_SOLAR, texel: 1.6
          });
          if (panel) this.stats.solarPanels++;
        }
      }
      const at = frame.sample(u);
      for (const end of [-1, 1]) {
        addGlow(mast.position.clone().addScaledVector(at.forward, end * (mastLength / 2 + 6)), 14, AMBER, 1.0, GLOW_NAV);
      }
    };
    const peakLength = Math.max(0.05, peakEnd - revealU);
    wing(revealU + peakLength * 0.1, P, 430, 20, detail < 0.5 ? 3 : 4);
    wing(revealU + peakLength * 0.42, P, 640, -40, 3);
    wing(revealU + peakLength * 0.7, -P, 520, 90, detail < 0.5 ? 2 : 3);
    wing(revealU + peakLength * 0.88, P, 520, 40, 3);

    // The station core: what the whole course is surfing around.
    const coreU = revealU + peakLength * 0.3;
    const core = place(cylinders, {
      u: coreU, lateral: -P * 560, up: 60, size: [82, 620, 82], rot: new THREE.Euler(Math.PI / 2, 0, 0),
      kind: KIND_MODULE, texel: 2.4, push: { lateral: 60, steps: 10 }
    });
    if (core) {
      this.stats.modules++;
      const at = frame.sample(coreU);
      for (const along of [-170, 150]) {
        const habitat = new THREE.Matrix4().compose(
          core.position.clone().addScaledVector(at.forward, along),
          orient(at.forward, at.right, new THREE.Euler(Math.PI / 2, 0, 0)),
          new THREE.Vector3(190, 190, 190)
        );
        if (fits(rings.box, habitat)) rings.add(habitat, [KIND_MODULE, 2.4, 0, 0], rng());
      }
      for (const along of [-320, 0, 320]) {
        addGlow(core.position.clone().addScaledVector(at.forward, along).add(new THREE.Vector3(0, 96, 0)), 18, AMBER, 1.0, GLOW_NAV);
      }
    }
    // Distant infrastructure: one ring, a long way off, towards the planet.
    const farAt = frame.sample(revealU + peakLength * 0.55);
    const farRing = new THREE.Matrix4().compose(
      farAt.position.clone().addScaledVector(farAt.right, P * 980).add(new THREE.Vector3(0, -210, 0)),
      orient(farAt.forward, farAt.right, new THREE.Euler(0.5, 0, 0.9)),
      new THREE.Vector3(170, 170, 170)
    );
    if (fits(rings.box, farRing)) rings.add(farRing, [KIND_MODULE, 3.0, 0, 0], rng());

    // A few lone gantries keep a sense of structure through the open stretch.
    for (let u = revealU + metres(420); u < peakEnd - metres(100); u += metres(detail < 0.5 ? 620 : 430)) {
      if (breakdown && u > breakdown.start - metres(60) && u < breakdown.end + metres(60)) continue;
      gantry(u, { conduit: true, half: 80 });
    }

    // ---------------------------------------------------------------------
    // BREAKDOWN: maintenance. Antenna masts, a pod or two, single lights.
    // ---------------------------------------------------------------------
    if (breakdown) {
      for (let u = breakdown.start + metres(30), i = 0; u < breakdown.end - metres(20); u += metres(150), i++) {
        const side = i % 2 === 0 ? 1 : -1;
        const height = 150 + rng() * 70;
        const mast = place(boxes, {
          u, lateral: side * 78, up: height / 2 - 40, size: [5, height, 5], kind: KIND_TRUSS, texel: 1.2,
          push: { lateral: 8, steps: 9 }
        });
        if (mast) {
          this.stats.masts++;
          const tip = mast.position.clone();
          tip.y += height / 2 + 4;
          addGlow(tip, 10, AMBER, 1.0, GLOW_NAV);
        }
        if (i % 2 === 1) module(u + metres(60), -side * 110, 4 + rng() * 14, 8, 30, rng() > 0.5);
      }
    }

    // ---------------------------------------------------------------------
    // FINALE: the communications array, beyond the finish, against the planet.
    // ---------------------------------------------------------------------
    if (finale) {
      for (let u = finale.start + metres(120); u < 1 - metres(140); u += metres(230)) gantry(u, { conduit: true, flood: true });
    }
    for (let forward = 480; forward <= 800 && !this.stats.hasCommsArray; forward += 60) {
      const u = 1 + metres(forward);
      const height = 330;
      const tower = place(boxes, {
        u, lateral: P * 190, up: height / 2 - 110, size: [18, height, 18], kind: KIND_TRUSS, texel: 1.5,
        conduit: true
      });
      if (!tower) continue;
      const at = frame.sample(u);
      const head = tower.position.clone();
      head.y += height / 2;
      // The main dish opens up and back over the course, so its lit bowl is
      // what you see on approach; two smaller ones hang off the tower.
      const toFinish = frame.sample(1).position.clone().sub(head).setY(0).normalize();
      const dishAt = (centre: THREE.Vector3, radius: number, axis: THREE.Vector3): void => {
        // The hemisphere's rim is its open face: point its pole AWAY from the axis.
        const q = new THREE.Quaternion().setFromUnitVectors(UP, axis.clone().normalize().negate());
        const m = new THREE.Matrix4().compose(centre, q, new THREE.Vector3(radius, radius * 0.36, radius));
        if (fits(dishes.box, m)) dishes.add(m, [KIND_DISH, 2.0, 0, 0], rng());
      };
      const mainAxis = toFinish.clone().multiplyScalar(0.62).add(new THREE.Vector3(0, 0.72, 0));
      dishAt(head.clone().add(new THREE.Vector3(0, 30, 0)).addScaledVector(toFinish, -20), 104, mainAxis);
      dishAt(
        tower.position.clone().addScaledVector(at.right, -P * 46).add(new THREE.Vector3(0, 40, 0)),
        36,
        toFinish.clone().multiplyScalar(0.9).addScaledVector(at.right, -P * 0.5).add(new THREE.Vector3(0, 0.3, 0))
      );
      dishAt(
        tower.position.clone().addScaledVector(at.right, P * 42).add(new THREE.Vector3(0, -40, 0)),
        28,
        toFinish.clone().multiplyScalar(0.8).addScaledVector(at.right, P * 0.7).add(new THREE.Vector3(0, 0.1, 0))
      );
      // The beacon stands on a spire in front of the dish, clear of its rim.
      const spireBase = head.clone().addScaledVector(toFinish, 96);
      const spire = new THREE.Matrix4().compose(
        spireBase.clone().add(new THREE.Vector3(0, 40, 0)),
        new THREE.Quaternion(),
        new THREE.Vector3(2.6, 150, 2.6)
      );
      if (fits(boxes.box, spire)) boxes.add(spire, [KIND_HULL, 0.8, 0, 0], rng());
      beamBetween(head.clone().add(new THREE.Vector3(0, -30, 0)), spireBase.clone().add(new THREE.Vector3(0, -30, 0)), 7, true);
      const beacon = spireBase.clone();
      beacon.y += 122;
      addGlow(beacon, 46, AMBER, 1.4, GLOW_BEACON, 0.1);
      for (let y = -height / 2 + 40; y < height / 2; y += 70) {
        const light = tower.position.clone();
        light.y += y;
        addGlow(light.addScaledVector(toFinish, 14), 11, AMBER, 1.0, GLOW_NAV);
      }
      this.stats.hasCommsArray = true;
    }

    // ---------------------------------------------------------------------
    // Navigation buoys: sparse amber lights marking the way through.
    // ---------------------------------------------------------------------
    let buoySide = 1;
    for (let arc = 90; arc < frame.total - 40; arc += 150 + rng() * 60) {
      navBuoy(arc / frame.total, buoySide);
      buoySide = -buoySide;
    }

    // ---------------------------------------------------------------------
    // Bake.
    // ---------------------------------------------------------------------
    const structure = createOrbitalStructureMaterial(this.uniforms);
    this.materials.push(structure);
    for (const batch of [boxes, cylinders, dishes, rings]) {
      const mesh = batch.build(structure);
      if (!mesh) continue;
      for (const pending of this.pendingLamps) {
        if (pending.batch !== batch) continue;
        const attribute = mesh.geometry.getAttribute('aLamp') as THREE.InstancedBufferAttribute;
        attribute.setXYZW(pending.index, pending.lamp.x, pending.lamp.y, pending.lamp.z, pending.lamp.w);
      }
      this.group.add(mesh);
      this.stats.drawBatches++;
    }
    this.pendingLamps.length = 0;

    const glowMaterial = createOrbitalGlowMaterial(this.uniforms);
    this.materials.push(glowMaterial);
    const glowMesh = glows.build('OrbitalGlows', glowMaterial);
    if (glowMesh) {
      this.track(glowMesh.geometry);
      this.group.add(glowMesh);
      this.stats.drawBatches++;
    }
  }

  /** Floodlights assigned to an instance after it found its final position. */
  private readonly pendingLamps: Array<{ batch: InstanceBatch; index: number; lamp: THREE.Vector4 }> = [];

  public update(frame: EnvironmentThemeFrame): void {
    if (this.disposed) return;
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const u = this.uniforms;
    this.skyGroup.position.copy(frame.playerPos);

    const target = Math.max(0, Math.min(1, frame.routeProgress));
    if (this.routeU < 0) this.routeU = target;
    else this.routeU += (target - this.routeU) * (1 - Math.exp(-dt / 1.4));

    // Fire the percussion hits the song passed since the last frame; a seek
    // or restart re-finds the cursor instead of replaying the gap.
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

    // Sustained energy: the station's working light builds and relaxes.
    u.uStation.value = Math.min(1, sampleProgression(this.spans, STATION_LIGHT, this.routeU) * (0.6 + 0.4 * sustain));
    // Bass: conduits. Percussion: navigation lights.
    u.uKick.value = Math.min(1, this.reactivity.kick * effect);
    u.uHat.value = Math.min(1, this.reactivity.hat * effect);
    u.uHatSlot.value = this.reactivity.hatSlot;
    u.uAccent.value = Math.min(1, this.reactivity.accent * effect);
    u.uAccentSlot.value = this.reactivity.accentSlot;
    u.uBeacon.value = 0.5 + 0.5 * Math.sin(now * 0.5);
    // The ground creeps by at orbital pace: about a degree every ten seconds.
    u.uDrift.value = frame.reduceMotion ? 0 : now * 0.0016;
    u.uTime.value = now;
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
  }
}

function createOrbitalPalette(): TrackPalette {
  const palette = PaletteSelector.getPaletteByName('ORBITAL_STATION');
  palette.fogColor = new THREE.Color('#000002');
  return palette;
}

export const ORBITAL_STATION_THEME: EnvironmentThemeDefinition = {
  id: 'ORBITAL_STATION',
  displayName: 'ORBITAL STATION',
  createPalette: createOrbitalPalette,
  build: (context) => new OrbitalStationInstance(context)
};
