/**
 * MIDNIGHT MOUNTAINS — the first non-city environment.
 *
 * A cold, moonlit alpine night laid out as a journey along the song:
 *
 *   OPENING    an enclosed valley: steep walls close in, a few warm lamps
 *   BUILD      the walls step back and the observatory's light appears ahead
 *   PEAK       two needle spires frame the route; beyond them the widest view,
 *              the great peak, and the aurora overhead
 *   BREAKDOWN  an intimate pass by a small hamlet, calmer light
 *   FINALE     the observatory on its summit above the finish
 *
 * The roles come from the song's own analysed sections (ThemeProgression), and
 * every piece is placed in route-relative coordinates, so the NORMAL and SURF
 * courses of the song each get the same arc over their own geometry.
 *
 * PRESENTATION ONLY. Nothing here collides, and every candidate is measured
 * against the RouteExclusionCorridor as final world-space bounds before it is
 * accepted; a candidate that does not fit is moved outward or dropped. The
 * World's final safety pass then audits the result again.
 *
 * Cost: one sky dome, a handful of instanced batches sharing one material, and
 * a single additive billboard batch. No real lights, no extra render passes.
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
import {
  ProgressionSpan,
  ProgressionValues,
  RouteFrame,
  deriveProgression,
  roleSpan,
  sampleProgression
} from '../ThemeProgression';
import { GlowBatch, InstanceBatch, NO_LAMP, composeYaw, mulberry32 } from '../ThemeInstancing';
import { ThemeReactivity } from '../ThemeReactivity';
import {
  AURORA_BAND_COUNT,
  MidnightUniforms,
  createGlowMaterial,
  createMidnightUniforms,
  createSkyMaterial,
  createTerrainMaterial
} from './MidnightShaders';

/** How closed-in the valley is (1 = steep walls close by, 0 = open vista). */
const ENCLOSURE: ProgressionValues = { OPENING: 1.0, BUILD: 0.45, PEAK: 0.0, BREAKDOWN: 0.75, FINALE: 0.3 };
/** How much of the aurora has arrived. Used sparingly outside the peak. */
const AURORA: ProgressionValues = { OPENING: 0.1, BUILD: 0.42, PEAK: 1.0, BREAKDOWN: 0.3, FINALE: 0.82 };
/** Lamp brightness: the breakdown is deliberately calmer. */
const LAMP_LEVEL: ProgressionValues = { OPENING: 0.85, BUILD: 0.95, PEAK: 1.0, BREAKDOWN: 0.62, FINALE: 0.95 };
const MIST: ProgressionValues = { OPENING: 0.8, BUILD: 0.5, PEAK: 0.3, BREAKDOWN: 0.7, FINALE: 0.4 };
/** Metres of route between lamps. Sparse everywhere, closest in the pass. */
const LAMP_SPACING: ProgressionValues = { OPENING: 190, BUILD: 150, PEAK: 130, BREAKDOWN: 100, FINALE: 120 };

const KIND_ROCK = 0;
const KIND_STRUCTURE = 1;
const KIND_DOME = 2;
const KIND_ROOF = 3;
const GLOW_LAMP = 0;
const GLOW_WINDOW = 1;
const GLOW_BEACON = 2;
/** Number of structures the percussion accent rotates between. */
const ACCENT_SLOTS = 5;
/** Lantern height above the top of its crag. */
const LAMP_HEIGHT = 6.4;

const NO_MIST = { top: -1e6, depth: 1 };
const WARM = new THREE.Color(1.0, 0.6, 0.26);
const COOL = new THREE.Color(0.62, 0.8, 1.0);

export interface MidnightMountainsStats {
  peaks: number;
  crags: number;
  lamps: number;
  cabins: number;
  glows: number;
  hasObservatory: boolean;
  hasGreatPeak: boolean;
  /** Candidates dropped because no corridor-safe position was found. */
  rejected: number;
  drawBatches: number;
}

/**
 * Faceted rock. `flatTop` gives a mesa that structures and lamps can stand on;
 * otherwise the form tapers to an off-centre summit. Unit size: base radius
 * about 1, height exactly 1, base at y = 0.
 */
function buildRockGeometry(rng: () => number, flatTop: boolean): THREE.BufferGeometry {
  const segments = 12;
  const levels = flatTop ? [0, 0.3, 0.62, 0.9, 1.0] : [0, 0.1, 0.22, 0.36, 0.5, 0.64, 0.77, 0.88, 0.96];
  const mesaRadii = [1.0, 0.8, 0.62, 0.5, 0.45];
  // A few strong buttresses give the silhouette aretes instead of a cone.
  const buttresses = [rng() * 6.28, rng() * 6.28, rng() * 6.28, rng() * 6.28];
  const ridge: number[] = [];
  for (let j = 0; j < segments; j++) {
    const angle = (j / segments) * Math.PI * 2;
    let lobe = 0;
    for (const b of buttresses) lobe = Math.max(lobe, Math.pow(Math.max(0, Math.cos(angle - b)), 3));
    ridge.push(flatTop ? 0.9 + (rng() - 0.5) * 0.22 + lobe * 0.12 : 0.74 + lobe * 0.5 + (rng() - 0.5) * 0.14);
  }
  // The summit leans off-centre, so no two views of a peak match.
  const leanX = flatTop ? 0 : (rng() - 0.5) * 0.7;
  const leanZ = flatTop ? 0 : (rng() - 0.5) * 0.7;

  const positions: number[] = [];
  const indices: number[] = [];
  for (let l = 0; l < levels.length; l++) {
    const h = levels[l];
    // Concave flanks: a broad foot steepening towards the top, with the odd
    // bench where a level steps out.
    const bench = l === 0 || flatTop ? 1 : 1 + (rng() - 0.5) * 0.26;
    const radius = flatTop ? mesaRadii[l] : (Math.pow(1 - h, 1.25) + 0.035) * bench;
    const twist = (rng() - 0.5) * 0.2;
    const shift = Math.pow(h, 1.5);
    for (let j = 0; j < segments; j++) {
      const angle = (j / segments) * Math.PI * 2 + twist;
      const r = radius * ridge[j] * (1 + (rng() - 0.5) * 0.2);
      const lift = l === 0 || flatTop ? 0 : (rng() - 0.5) * 0.035;
      positions.push(Math.cos(angle) * r + leanX * shift, h + lift, Math.sin(angle) * r + leanZ * shift);
    }
  }
  for (let l = 0; l < levels.length - 1; l++) {
    for (let j = 0; j < segments; j++) {
      const a = l * segments + j;
      const b = l * segments + ((j + 1) % segments);
      const c = (l + 1) * segments + ((j + 1) % segments);
      const d = (l + 1) * segments + j;
      indices.push(a, d, b, b, d, c);
    }
  }
  const top = positions.length / 3;
  if (flatTop) positions.push(0, 1, 0);
  else positions.push(leanX, 1, leanZ);
  const apex = new THREE.Vector3(flatTop ? 0 : leanX, 1, flatTop ? 0 : leanZ);
  const lastRing = (levels.length - 1) * segments;
  for (let j = 0; j < segments; j++) {
    indices.push(lastRing + j, top, lastRing + ((j + 1) % segments));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  // Where the summit actually is, so things can be stood on it.
  geometry.userData.apex = apex;
  return geometry;
}

/** Pitched roof prism: unit footprint, ridge along z, base at y = 0. */
function buildRoofGeometry(): THREE.BufferGeometry {
  const p = [
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5,
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5
  ];
  const i = [0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geometry.setIndex(i);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

interface PlacedRock {
  /** World position of the summit (the top centre of a mesa). */
  summit: THREE.Vector3;
  centre: THREE.Vector3;
  baseY: number;
  topY: number;
  radius: number;
  height: number;
}

export class MidnightMountainsInstance implements EnvironmentThemeInstance {
  public readonly id = 'MIDNIGHT_MOUNTAINS' as const;
  public readonly group = new THREE.Group();
  public readonly skyGroup = new THREE.Group();
  public readonly lighting: EnvironmentThemeLighting;
  public readonly uniforms: MidnightUniforms = createMidnightUniforms();
  public readonly spans: ProgressionSpan[];
  public readonly reactivity = new ThemeReactivity();
  public readonly stats: MidnightMountainsStats = {
    peaks: 0,
    crags: 0,
    lamps: 0,
    cabins: 0,
    glows: 0,
    hasObservatory: false,
    hasGreatPeak: false,
    rejected: 0,
    drawBatches: 0
  };

  private readonly frame: RouteFrame;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly bands: number[] = new Array(AURORA_BAND_COUNT).fill(0);
  private routeU = -1;
  private auroraPhase = 0;
  private auroraAxisReady = false;
  /** Hi-hat onsets of the song (time, strength), and the playback cursor. */
  private readonly hats: Array<{ time: number; strength: number }> = [];
  private hatCursor = 0;
  private lastSongTime = -1;
  private subPhase = 0;
  private disposed = false;

  constructor(private readonly context: EnvironmentThemeBuildContext) {
    this.group.name = 'MidnightMountains';
    this.skyGroup.name = 'MidnightMountainsSky';
    tagWorldRole(this.group, 'DECORATION', 'MidnightMountains', false);
    tagWorldRole(this.skyGroup, 'IGNORE_WORLD_SAFETY', 'MidnightMountainsSky', false);

    const { track, analysis } = context;
    this.frame = new RouteFrame(track.route, track.totalDistance);
    this.spans = deriveProgression(analysis, track);

    // One heading for the whole night: the aurora hangs over where the journey
    // is going and the moon stands off to one side of it.
    const start = this.frame.sample(0).position;
    const end = this.frame.sample(1).position;
    const heading = end.clone().sub(start).setY(0);
    if (heading.lengthSq() < 1e-6) heading.set(0, 0, 1);
    heading.normalize();
    const moonAzimuth = heading.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.92);
    const moonDir = moonAzimuth.clone().multiplyScalar(Math.cos(0.5)).setY(Math.sin(0.5)).normalize();
    // The key light that falls on the route comes from the moon's side but
    // from higher up, so platforms are lit evenly instead of at a glancing
    // angle that would streak them with highlights.
    const keyDir = moonAzimuth.clone().multiplyScalar(Math.cos(1.0)).setY(Math.sin(1.0)).normalize();
    this.uniforms.uMoonDir.value.copy(moonDir);
    this.uniforms.uAuroraFwd.value.copy(heading);

    this.lighting = {
      keyColor: 0xa9c2ff,
      keyIntensity: 1.7,
      keyOffset: keyDir.multiplyScalar(150),
      hemiSkyColor: 0x3a5592,
      hemiGroundColor: 0x0a1020,
      hemiIntensity: 1.25
    };

    // Hi-hats come straight from the analysed onsets: bright, and not just the
    // top of a kick. Using the events keeps the glints exactly on the hits.
    for (const onset of analysis.onsets ?? []) {
      if (onset.highs > 0.3 && onset.highs >= onset.bass * 0.8) {
        this.hats.push({ time: onset.time, strength: onset.highs * onset.strength });
      }
    }

    this.buildSky();
    if (!this.frame.isEmpty) this.buildScenery();
  }

  private track<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private buildSky(): void {
    const scale = this.context.quality?.reactiveLandmarkScale ?? 1;
    const steps = scale < 0.5 ? 6 : scale < 0.9 ? 9 : 12;
    const material = createSkyMaterial(this.uniforms, steps);
    this.materials.push(material);
    const dome = new THREE.Mesh(this.track(new THREE.SphereGeometry(900, 32, 20)), material);
    dome.name = 'MidnightSkyDome';
    dome.renderOrder = -1000;
    dome.frustumCulled = false;
    this.skyGroup.add(dome);
  }

  private buildScenery(): void {
    const { corridor, track, quality } = this.context;
    const rng = mulberry32((track.seed ^ 0x4d49444e) >>> 0);
    const frame = this.frame;
    const spans = this.spans;
    const detail = quality?.reactiveLandmarkScale ?? 1;

    const peaks = new InstanceBatch('MidnightPeaks', this.track(buildRockGeometry(rng, false)));
    const crags = new InstanceBatch('MidnightCrags', this.track(buildRockGeometry(rng, true)));
    const boxGeometry = this.track(new THREE.BoxGeometry(1, 1, 1));
    boxGeometry.translate(0, 0.5, 0);
    boxGeometry.computeBoundingBox();
    const boxes = new InstanceBatch('MidnightStructures', boxGeometry);
    const roofs = new InstanceBatch('MidnightRoofs', this.track(buildRoofGeometry()));
    const drumGeometry = this.track(new THREE.CylinderGeometry(1, 1, 1, 18));
    drumGeometry.translate(0, 0.5, 0);
    drumGeometry.computeBoundingBox();
    const drums = new InstanceBatch('MidnightDrums', drumGeometry);
    const domeGeometry = this.track(new THREE.SphereGeometry(1, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2));
    domeGeometry.computeBoundingBox();
    const domes = new InstanceBatch('MidnightDomes', domeGeometry);

    const glows = new GlowBatch();

    const scratchBox = new THREE.Box3();
    const fits = (geomBox: THREE.Box3, matrix: THREE.Matrix4): boolean =>
      corridor.evaluateVolume(scratchBox.copy(geomBox).applyMatrix4(matrix)) === null;

    const compose = composeYaw;

    // Views that must stay open: from the build and the peak towards the
    // observatory's light. Rock that would stand in one of them is not placed.
    const sightlines: Array<{ ray: THREE.Ray; length: number }> = [];
    const blocksSightline = (box: THREE.Box3): boolean => {
      const hit = new THREE.Vector3();
      for (const s of sightlines) {
        if (s.ray.intersectBox(box, hit) && hit.distanceTo(s.ray.origin) < s.length) return true;
      }
      return false;
    };

    const addGlow = (
      pos: THREE.Vector3,
      size: number,
      color: THREE.Color,
      intensity: number,
      kind: number,
      slot = 0,
      core = 0
    ): boolean => {
      const matrix = compose(pos, 0, new THREE.Vector3(size, size, size));
      if (!fits(glows.box, matrix)) return false;
      glows.add(matrix, color, [intensity, kind, slot, core]);
      return true;
    };

    /**
     * Places one rock form beside the route at fraction `u`, stepping outward
     * from `lateral` until its real world-space bounds clear the corridor.
     */
    const placeRock = (
      batch: InstanceBatch,
      opts: {
        u: number;
        side: number;
        lateral: number;
        maxLateral: number;
        step: number;
        radius: number;
        topAbove: number;
        depthBelow: number;
        texel: number;
        mistTopBelow: number;
        mistDepth: number;
        along?: number;
        respectSightlines?: boolean;
        lamp?: (top: THREE.Vector3) => THREE.Vector4;
      }
    ): PlacedRock | null => {
      const at = frame.sample(opts.u);
      const yaw = rng() * Math.PI * 2;
      const stretch = 0.85 + rng() * 0.4;
      const seed = rng();
      const height = opts.topAbove + opts.depthBelow;
      const baseY = at.position.y - opts.depthBelow;
      for (let lateral = opts.lateral; lateral <= opts.maxLateral; lateral += opts.step) {
        const pos = at.position
          .clone()
          .addScaledVector(at.right, opts.side * lateral)
          .addScaledVector(at.forward, opts.along ?? 0);
        pos.y = baseY;
        const matrix = compose(pos, yaw, new THREE.Vector3(opts.radius, height, opts.radius * stretch));
        if (!fits(batch.box, matrix)) continue;
        if (opts.respectSightlines && blocksSightline(scratchBox.copy(batch.box).applyMatrix4(matrix))) continue;
        const top = (batch.geometry.userData.apex as THREE.Vector3).clone().applyMatrix4(matrix);
        batch.add(
          matrix,
          [KIND_ROCK, opts.texel, at.position.y - opts.mistTopBelow, opts.mistDepth],
          seed,
          opts.lamp ? opts.lamp(top) : NO_LAMP
        );
        return { summit: top, centre: pos, baseY, topY: baseY + height, radius: opts.radius, height };
      }
      this.stats.rejected++;
      return null;
    };

    /** A cabin on top of `rock`, its lit window turned towards `face`. */
    const addCabin = (rock: PlacedRock, face: THREE.Vector3, scale: number, slot: number): boolean => {
      const toRoute = face.clone().sub(rock.centre).setY(0);
      if (toRoute.lengthSq() < 1e-6) toRoute.set(0, 0, 1);
      toRoute.normalize();
      const yaw = Math.atan2(toRoute.x, toRoute.z);
      const base = new THREE.Vector3(rock.centre.x, rock.topY - 0.6 * scale, rock.centre.z);
      const body = compose(base, yaw, new THREE.Vector3(8 * scale, 4.6 * scale, 6.4 * scale));
      const roofBase = base.clone();
      roofBase.y += 4.6 * scale;
      const roof = compose(roofBase, yaw, new THREE.Vector3(9.4 * scale, 3.4 * scale, 7.6 * scale));
      if (!fits(boxes.box, body) || !fits(roofs.box, roof)) {
        this.stats.rejected++;
        return false;
      }
      const seed = rng();
      boxes.add(body, [KIND_STRUCTURE, 1.0 * scale, NO_MIST.top, NO_MIST.depth], seed);
      roofs.add(roof, [KIND_ROOF, 0.8 * scale, NO_MIST.top, NO_MIST.depth], seed);
      const window = base.clone().addScaledVector(toRoute, 3.4 * scale);
      window.y += 2.4 * scale;
      addGlow(window, 3.2 * scale, WARM, 0.85, GLOW_WINDOW, slot % ACCENT_SLOTS);
      this.stats.cabins++;
      return true;
    };

    // ---------------------------------------------------------------------
    // FINALE: the observatory. Placed first so its sightlines can keep the
    // rest of the range out of the way.
    // ---------------------------------------------------------------------
    const finish = frame.sample(1);
    let observatoryLight: THREE.Vector3 | null = null;
    for (let forward = 520; forward <= 850 && !observatoryLight; forward += 55) {
      const uSite = 1 + forward / frame.total;
      // Off the route axis, so the finish gate never stands in front of it.
      const summit = placeRock(peaks, {
        u: uSite,
        side: -1,
        lateral: 210,
        maxLateral: 210,
        step: 1,
        radius: 250,
        topAbove: 235,
        depthBelow: 270,
        texel: 5,
        mistTopBelow: 30,
        mistDepth: 190
      });
      if (!summit) continue;
      const crown = summit.summit.clone();
      crown.y -= 40;
      const toFinish = finish.position.clone().sub(crown).setY(0).normalize();
      const yaw = Math.atan2(toFinish.x, toFinish.z);
      const drum = compose(crown, yaw, new THREE.Vector3(52, 34, 52));
      const domeBase = crown.clone();
      domeBase.y += 34;
      const dome = compose(domeBase, yaw, new THREE.Vector3(48, 44, 48));
      if (!fits(drums.box, drum) || !fits(domes.box, dome)) {
        this.stats.rejected++;
        continue;
      }
      drums.add(drum, [KIND_STRUCTURE, 2.0, NO_MIST.top, NO_MIST.depth], rng());
      domes.add(dome, [KIND_DOME, 2.0, NO_MIST.top, NO_MIST.depth], rng());
      // A low annex and a mast give the silhouette a readable asymmetry.
      const side = new THREE.Vector3(toFinish.z, 0, -toFinish.x);
      const annexPos = crown.clone().addScaledVector(side, 70);
      annexPos.y -= 6;
      const annex = compose(annexPos, yaw, new THREE.Vector3(46, 22, 32));
      if (fits(boxes.box, annex)) {
        boxes.add(annex, [KIND_STRUCTURE, 2.0, NO_MIST.top, NO_MIST.depth], rng());
        for (let w = 0; w < 3; w++) {
          const win = annexPos.clone().addScaledVector(toFinish, 16.5).addScaledVector(side, (w - 1) * 12);
          win.y += 12;
          addGlow(win, 6.5, WARM, 0.9, GLOW_WINDOW, w % ACCENT_SLOTS);
        }
      }
      const mastPos = crown.clone().addScaledVector(side, -62);
      const mast = compose(mastPos, yaw, new THREE.Vector3(2.2, 92, 2.2));
      if (fits(boxes.box, mast)) boxes.add(mast, [KIND_STRUCTURE, 1.0, NO_MIST.top, NO_MIST.depth], rng());
      const light = mastPos.clone();
      light.y += 95;
      addGlow(light, 34, COOL, 1.3, GLOW_BEACON, 0, 0.12);
      // The open slit glows towards the finish.
      const slit = domeBase.clone().addScaledVector(toFinish, 38);
      slit.y += 22;
      addGlow(slit, 44, COOL, 0.5, GLOW_BEACON, 0, 0.05);
      observatoryLight = light;
      this.stats.hasObservatory = true;
    }

    if (observatoryLight) {
      const build = roleSpan(spans, 'BUILD');
      const peak = roleSpan(spans, 'PEAK');
      const views: number[] = [];
      if (build) views.push(build.start + (build.end - build.start) * 0.55, build.end);
      if (peak) views.push((peak.start + peak.end) * 0.5, peak.end);
      for (const u of views) {
        const eye = frame.sample(u).position;
        eye.y += 8;
        const to = observatoryLight.clone().sub(eye);
        const length = to.length();
        sightlines.push({ ray: new THREE.Ray(eye, to.normalize()), length: length - 260 });
      }
    }

    // ---------------------------------------------------------------------
    // PEAK: the great mountain and the two needle spires that frame the route.
    // ---------------------------------------------------------------------
    const peakSpan = roleSpan(spans, 'PEAK');
    if (peakSpan) {
      // A form this size has to stand a long way off to clear the corridor,
      // so it is sized to still dominate from there. Away from the moon first,
      // so its lit face is turned to the route.
      const uHero = (peakSpan.start + peakSpan.end) * 0.5 + 0.03;
      for (const side of [-1, 1]) {
        const hero = placeRock(peaks, {
          u: uHero, side, lateral: 900, maxLateral: 1500, step: 50,
          radius: 330, topAbove: 740, depthBelow: 300, texel: 9, mistTopBelow: 20, mistDepth: 230,
          respectSightlines: true
        });
        if (!hero) continue;
        this.stats.hasGreatPeak = true;
        this.stats.peaks++;
        const lateral = hero.centre.clone().sub(frame.sample(uHero).position).setY(0).length();
        for (const along of [-330, 350]) {
          const shoulder = placeRock(peaks, {
            u: uHero, side, along, lateral: lateral - 60, maxLateral: lateral + 300, step: 60,
            radius: 220, topAbove: 400 + rng() * 90, depthBelow: 300, texel: 8, mistTopBelow: 20, mistDepth: 230,
            respectSightlines: true
          });
          if (shoulder) this.stats.peaks++;
        }
        break;
      }
      for (const side of [-1, 1]) {
        const spire = placeRock(peaks, {
          u: peakSpan.start + 0.012, side, lateral: 96, maxLateral: 260, step: 8,
          radius: 21, topAbove: 250 + rng() * 40, depthBelow: 210, texel: 2.5, mistTopBelow: 34, mistDepth: 150,
          respectSightlines: true
        });
        if (spire) this.stats.peaks++;
      }
    }

    // ---------------------------------------------------------------------
    // The ranges. A mountain is a MASSIF: a main summit with lower shoulders
    // strung along the valley, so crests read as ridgelines, not as cones.
    // ---------------------------------------------------------------------
    const placeMassif = (opts: Parameters<typeof placeRock>[1], shoulders: number): PlacedRock | null => {
      const main = placeRock(peaks, opts);
      if (!main) return null;
      this.stats.peaks++;
      const lateral = main.centre.clone().sub(frame.sample(opts.u).position).setY(0).length();
      for (let i = 0; i < shoulders; i++) {
        const direction = i % 2 === 0 ? 1 : -1;
        const reach = 0.75 + rng() * 0.5 + Math.floor(i / 2) * 0.8;
        const scale = 0.52 + rng() * 0.26;
        const shoulder = placeRock(peaks, {
          ...opts,
          along: (opts.along ?? 0) + direction * opts.radius * reach,
          lateral: lateral + (rng() - 0.3) * opts.radius * 0.5,
          maxLateral: lateral + opts.radius * 1.2,
          radius: opts.radius * (0.6 + rng() * 0.25),
          topAbove: opts.topAbove * scale
        });
        if (shoulder) this.stats.peaks++;
      }
      return main;
    };

    // Near needles: a few slender towers close to the route where the valley
    // is tight. Accents, not a fence.
    const stepNear = 150 / frame.total;
    for (let u = -0.02; u <= 1.0; u += stepNear) {
      const enclosure = sampleProgression(spans, ENCLOSURE, u);
      if (enclosure < 0.35) continue;
      const side = rng() > 0.5 ? 1 : -1;
      const placed = placeRock(peaks, {
        u: u + (rng() - 0.5) * stepNear * 0.5,
        side,
        lateral: THREE.MathUtils.lerp(230, 120, enclosure) + rng() * 50,
        maxLateral: 420,
        step: 18,
        radius: (34 + rng() * 26) * (0.8 + enclosure * 0.4),
        topAbove: THREE.MathUtils.lerp(90, 190, enclosure) * (0.7 + rng() * 0.6),
        depthBelow: 190,
        texel: 2.5,
        mistTopBelow: 30,
        mistDepth: 140,
        respectSightlines: true
      });
      if (placed) this.stats.peaks++;
    }

    // The valley walls proper: big massifs that close the valley in when the
    // music is enclosed and fall back and drop when it opens.
    const midPeaks: PlacedRock[] = [];
    const stepMid = (detail < 0.5 ? 330 : 240) / frame.total;
    for (let u = -0.1; u <= 1.08; u += stepMid) {
      const enclosure = sampleProgression(spans, ENCLOSURE, u);
      for (const side of [-1, 1]) {
        const radius = 170 + rng() * 80;
        const placed = placeMassif(
          {
            u: u + (rng() - 0.5) * stepMid * 0.5,
            side,
            lateral: THREE.MathUtils.lerp(760, 400, enclosure) + rng() * 80,
            maxLateral: 1050,
            step: 40,
            radius,
            // In the open vista the walls stay low, so the far range and the
            // great peak stand clear above them.
            topAbove: THREE.MathUtils.lerp(170, 430, enclosure) * (0.8 + rng() * 0.4),
            depthBelow: 250,
            texel: 6,
            mistTopBelow: 24,
            mistDepth: 190,
            respectSightlines: true
          },
          detail < 0.5 ? 1 : 2
        );
        if (placed) midPeaks.push(placed);
      }
    }

    // The far range: the horizon line of the whole night.
    const stepFar = (detail < 0.5 ? 520 : 380) / frame.total;
    for (let u = -700 / frame.total; u <= 1 + 1000 / frame.total; u += stepFar) {
      for (const side of [-1, 1]) {
        placeMassif(
          {
            u: u + (rng() - 0.5) * stepFar * 0.5,
            side,
            lateral: 1120 + rng() * 240,
            maxLateral: 1500,
            step: 80,
            radius: 320 + rng() * 160,
            topAbove: 400 + rng() * 300,
            depthBelow: 280,
            texel: 11,
            mistTopBelow: 10,
            mistDepth: 240,
            respectSightlines: true
          },
          2
        );
      }
    }
    // Close the view behind the start and beyond the observatory.
    for (const [u, offsets] of [
      [-900 / frame.total, [-520, 60, 560]],
      [1 + 1300 / frame.total, [-700, 680]]
    ] as Array<[number, number[]]>) {
      for (const offset of offsets) {
        placeMassif(
          {
            u, side: Math.sign(offset) || 1, lateral: Math.abs(offset), maxLateral: Math.abs(offset), step: 1,
            radius: 330 + rng() * 120, topAbove: 440 + rng() * 240, depthBelow: 280,
            texel: 11, mistTopBelow: 10, mistDepth: 240
          },
          1
        );
      }
    }

    // ---------------------------------------------------------------------
    // Lamps: sparse warm lights on flat-topped crags, alternating sides.
    // ---------------------------------------------------------------------
    let lampSide = rng() > 0.5 ? 1 : -1;
    let arc = 40;
    while (arc < frame.total - 30) {
      const u = arc / frame.total;
      const side = lampSide;
      const crag = placeRock(crags, {
        u, side, lateral: 56, maxLateral: 150, step: 6,
        radius: 6.6 + rng() * 1.2, topAbove: 2 + rng() * 7, depthBelow: 50,
        texel: 1.0, mistTopBelow: 13, mistDepth: 30,
        lamp: (top) => new THREE.Vector4(top.x, top.y + LAMP_HEIGHT, top.z, 15)
      });
      if (crag) {
        const head = new THREE.Vector3(crag.centre.x, crag.topY + LAMP_HEIGHT, crag.centre.z);
        const post = compose(
          new THREE.Vector3(head.x, crag.topY - 0.5, head.z),
          0,
          new THREE.Vector3(0.55, 6.6, 0.55)
        );
        if (fits(boxes.box, post)) boxes.add(post, [KIND_STRUCTURE, 0.5, NO_MIST.top, NO_MIST.depth], rng());
        if (addGlow(head, 11, WARM, 1.2, GLOW_LAMP)) this.stats.lamps++;
        this.stats.crags++;
      }
      lampSide = -lampSide;
      arc += sampleProgression(spans, LAMP_SPACING, u) * (0.85 + rng() * 0.3);
    }

    // ---------------------------------------------------------------------
    // Cabins: one in the opening valley, a hamlet in the breakdown, and a few
    // lit windows high on the middle range for scale.
    // ---------------------------------------------------------------------
    const cabinSites: Array<{ u: number; side: number }> = [];
    const opening = roleSpan(spans, 'OPENING');
    if (opening) cabinSites.push({ u: opening.start + (opening.end - opening.start) * 0.62, side: 1 });
    const breakdown = roleSpan(spans, 'BREAKDOWN');
    if (breakdown) {
      const length = breakdown.end - breakdown.start;
      for (const t of [0.34, 0.46, 0.57]) cabinSites.push({ u: breakdown.start + length * t, side: -1 });
    }
    let slot = 0;
    for (const site of cabinSites) {
      const at = frame.sample(site.u);
      const ledge = placeRock(crags, {
        u: site.u, side: site.side, lateral: 84, maxLateral: 190, step: 7,
        radius: 9.5, topAbove: 4 + rng() * 10, depthBelow: 50,
        texel: 1.0, mistTopBelow: 13, mistDepth: 30,
        lamp: (top) => {
          const toward = at.position.clone().sub(top).setY(0).normalize();
          return new THREE.Vector4(top.x + toward.x * 6, top.y + 2.2, top.z + toward.z * 6, 7);
        }
      });
      if (ledge) {
        this.stats.crags++;
        addCabin(ledge, at.position, 1, slot++);
      }
    }
    const distant = midPeaks.filter((_, i) => i % 4 === 1).slice(0, detail < 0.5 ? 3 : 6);
    for (const peak of distant) {
      const nearest = frame.sample(this.nearestFraction(peak.centre)).position;
      const toRoute = nearest.clone().sub(peak.centre).setY(0).normalize();
      const fraction = 0.3 + rng() * 0.12;
      // Stand a small ledge on the flank so the cabin has ground under it.
      const flank = peak.radius * Math.pow(1 - fraction, 0.85) * 0.82;
      const ledgeTop = peak.baseY + fraction * peak.height;
      const pos = peak.centre.clone().addScaledVector(toRoute, flank);
      pos.y = ledgeTop - 40;
      const ledgeMatrix = compose(pos, rng() * 6.28, new THREE.Vector3(16, 40, 16));
      if (!fits(crags.box, ledgeMatrix)) continue;
      crags.add(ledgeMatrix, [KIND_ROCK, 3, NO_MIST.top, NO_MIST.depth], rng());
      addCabin(
        { summit: new THREE.Vector3(pos.x, ledgeTop, pos.z), centre: pos, baseY: pos.y, topY: ledgeTop, radius: 16, height: 40 },
        nearest,
        2.1,
        slot++
      );
    }

    // ---------------------------------------------------------------------
    // Bake.
    // ---------------------------------------------------------------------
    const terrainMaterial = createTerrainMaterial(this.uniforms);
    terrainMaterial.side = THREE.DoubleSide;
    this.materials.push(terrainMaterial);
    for (const batch of [peaks, crags, boxes, roofs, drums, domes]) {
      const mesh = batch.build(terrainMaterial);
      if (mesh) {
        this.group.add(mesh);
        this.stats.drawBatches++;
      }
    }

    const glowMaterial = createGlowMaterial(this.uniforms);
    this.materials.push(glowMaterial);
    const glowMesh = glows.build('MidnightGlows', glowMaterial);
    if (glowMesh) {
      this.track(glowMesh.geometry);
      this.group.add(glowMesh);
      this.stats.glows = glows.count;
      this.stats.drawBatches++;
    }
  }

  /** Coarse nearest route fraction to a world point (build-time only). */
  private nearestFraction(point: THREE.Vector3): number {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      const d = this.frame.sample(u).position.distanceToSquared(point);
      if (d < bestDist) {
        bestDist = d;
        best = u;
      }
    }
    return best;
  }

  public update(frame: EnvironmentThemeFrame): void {
    if (this.disposed) return;
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const u = this.uniforms;
    this.skyGroup.position.copy(frame.playerPos);

    // Scenery state follows the player along the route, eased in time as well
    // as in space, so even a restart glides rather than cuts.
    const target = Math.max(0, Math.min(1, frame.routeProgress));
    if (this.routeU < 0) this.routeU = target;
    else this.routeU += (target - this.routeU) * (1 - Math.exp(-dt / 1.4));

    // Fire the hi-hats the song passed since the last frame. A seek or restart
    // re-finds the cursor instead of replaying everything in between.
    const now = frame.songTime;
    if (this.lastSongTime < 0 || now < this.lastSongTime || now - this.lastSongTime > 0.5) {
      this.hatCursor = this.hats.findIndex((h) => h.time > now);
      if (this.hatCursor < 0) this.hatCursor = this.hats.length;
    } else {
      while (this.hatCursor < this.hats.length && this.hats[this.hatCursor].time <= now) {
        if (!frame.reduceMotion) this.reactivity.strikeHat(this.hats[this.hatCursor].strength);
        this.hatCursor++;
      }
    }
    this.lastSongTime = now;

    this.reactivity.update(frame.visualState, dt, frame.reduceMotion);
    const effect = Math.max(0, Math.min(1.25, frame.effectScale));
    const sustain = Math.min(1, this.reactivity.sustain * effect);

    // The curtains drift so they stay over the valley ahead: the axis follows
    // the route's long-range direction, far too slowly to read as steering.
    const ahead = this.frame.sample(this.routeU, 380).forward;
    if (!this.auroraAxisReady) {
      u.uAuroraFwd.value.copy(ahead);
      this.auroraAxisReady = true;
    } else if (!frame.reduceMotion) {
      u.uAuroraFwd.value.lerp(ahead, 1 - Math.exp(-dt / 6)).setY(0);
      if (u.uAuroraFwd.value.lengthSq() < 1e-4) u.uAuroraFwd.value.copy(ahead);
      u.uAuroraFwd.value.normalize();
    }

    const level = sampleProgression(this.spans, AURORA, this.routeU);
    u.uAuroraLevel.value = level;
    u.uAuroraGain.value = level * (0.42 + 0.42 * sustain);
    u.uAuroraHeight.value = 0.25 + 0.75 * sustain;
    u.uAuroraHue.value = this.reactivity.mid;
    u.uAuroraShimmer.value = frame.reduceMotion ? 0 : this.reactivity.high * effect;
    // The level alone would sit flat under a wall of bass, so the hits ride on
    // top of it: a held sub glows, a struck one swells.
    const held = Math.max(0, (this.reactivity.sub - 0.3) / 0.7);
    const sub = Math.min(1, (held * 0.6 + this.reactivity.kick * 0.6) * effect);
    u.uAuroraBass.value = Math.min(1, this.reactivity.kick * 0.55 * effect + sub * 0.4);
    u.uHat.value = Math.min(1, this.reactivity.hat * effect);
    u.uHatSlot.value = this.reactivity.hatSlot;
    u.uSub.value = sub;
    if (!frame.reduceMotion) this.subPhase += dt * (0.5 + 2.4 * sub);
    u.uSubPhase.value = this.subPhase;
    // Sway speed is integrated, so a change in energy bends the motion without
    // ever jumping the curtains.
    this.auroraPhase += dt * (frame.reduceMotion ? 0.05 : 0.07 + 0.3 * sustain);
    u.uAuroraPhase.value = this.auroraPhase;

    const bandFollow = 1 - Math.exp(-dt / 0.45);
    for (let i = 0; i < AURORA_BAND_COUNT; i++) {
      const live = Math.max(0, Math.min(1, frame.bands[i] ?? 0));
      this.bands[i] += (live - this.bands[i]) * bandFollow;
      u.uBands.value[i] = this.bands[i];
    }

    u.uLampLevel.value = sampleProgression(this.spans, LAMP_LEVEL, this.routeU);
    u.uMist.value = sampleProgression(this.spans, MIST, this.routeU);
    u.uKick.value = this.reactivity.kick * effect;
    u.uAccent.value = this.reactivity.accent * effect;
    u.uAccentSlot.value = this.reactivity.accentSlot;
    u.uBeacon.value = 0.5 + 0.5 * Math.sin(frame.songTime * 0.55);
    u.uTime.value = frame.songTime;
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

function createMidnightPalette(): TrackPalette {
  const palette = PaletteSelector.getPaletteByName('MIDNIGHT_MOUNTAINS');
  palette.fogColor = new THREE.Color('#060b1a');
  return palette;
}

export const MIDNIGHT_MOUNTAINS_THEME: EnvironmentThemeDefinition = {
  id: 'MIDNIGHT_MOUNTAINS',
  displayName: 'MIDNIGHT MOUNTAINS',
  createPalette: createMidnightPalette,
  build: (context) => new MidnightMountainsInstance(context)
};
