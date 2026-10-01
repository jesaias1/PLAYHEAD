/**
 * Distant Audio Skyline & Monumental Composition for PLAYHEAD SIGNAL RENDER
 * "Cosmic Pixel Brutalism" structured horizon architecture.
 *
 * Replaces repetitive box grids with composed architectural clusters:
 * Primary Landmark Monolith + Secondary Support Stelae + Background Negative Space.
 */

import * as THREE from 'three';
import { TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack } from '../generation/GenerationTypes';
import { MusicVisualState, resolveChannels } from './MusicVisualController';
import { RouteExclusionCorridor } from './RouteExclusionCorridor';
import { CitySignageSystem, MonolithAnchor, StelaAnchor } from './CitySignageSystem';
import { tagWorldRole } from './WorldRoles';

/**
 * ARCHITECTURAL TOWER SHADER (patched onto the skyline's standard materials).
 *
 * The skyline instances are plain boxes; this patch turns each one into a
 * piece of brutalist architecture without adding geometry:
 *
 * - SILHOUETTE: per-instance profiles carve the box with discard — stepped
 *   setback crowns, through-slot cutouts, split twin prongs — so no two
 *   neighbours share the same outline. DoubleSide lets a carved opening reveal
 *   the tower's inner walls, so cutouts read as hollow structure.
 * - SURFACE: lit corner pilasters, recessed vertical ribs, heavy ledge bands
 *   every few dozen metres, and a very sparse scatter of lit windows.
 * - SIGNAL: the music-driven emissive lives ONLY in one recessed vertical
 *   channel per face (plus the shared scan bands inside it), so the light
 *   reads as embedded in the structure instead of painted on.
 * - DEPTH: fog is replaced by a dedicated atmospheric perspective (mass lifts
 *   toward a cool haze with distance) and towers dissolve into the abyss.
 *
 * Per-instance data: aTower = (topY, seed).
 */
function patchArchitecture(
  material: THREE.MeshStandardMaterial,
  uniforms: Record<string, THREE.IUniform>
): void {
  material.fog = false;
  material.side = THREE.DoubleSide;
  material.onBeforeCompile = (shader) => {
    for (const key of Object.keys(uniforms)) shader.uniforms[key] = uniforms[key];

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aTower;
varying vec3 vArchWorld;
varying vec2 vArchUv;
varying float vArchUp;
varying vec2 vArchTower;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec4 archWorld = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );
#else
  vec4 archWorld = modelMatrix * vec4( transformed, 1.0 );
#endif
  vArchWorld = archWorld.xyz;
  vArchUv = uv;
  vArchUp = normal.y;
  vArchTower = aTower;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uSignalPhase;
uniform float uSignalGain;
uniform float uSignalSegCount;
uniform float uSignalSegSharp;
uniform float uSignalBandScale;
uniform float uFaceW;
uniform float uCarve;
uniform float uDetail;
uniform vec3 uHaze;
uniform float uAbyssY;
varying vec3 vArchWorld;
varying vec2 vArchUv;
varying float vArchUp;
varying vec2 vArchTower;
float archHash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float archHash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float archChannel = 0.0;
float archWindow = 0.0;`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
{
  float side = 1.0 - step(0.5, abs(vArchUp));
  float relTop = vArchTower.x - vArchWorld.y;
  float seed = vArchTower.y;
  float u = vArchUv.x;
  if (uCarve > 0.0 && side > 0.5) {
    if (seed > 0.35 && seed < 0.6) {
      // Stepped setback crown.
      if (relTop < 30.0 * uCarve && (u < 0.17 || u > 0.83)) discard;
      if (relTop < 13.0 * uCarve && (u < 0.33 || u > 0.67)) discard;
    } else if (seed >= 0.6 && seed < 0.8) {
      // Through-slot cut high in the shaft.
      if (relTop > 34.0 * uCarve && relTop < 58.0 * uCarve && u > 0.3 && u < 0.7) discard;
    } else if (seed >= 0.8) {
      // Split twin prongs.
      if (relTop < 70.0 * uCarve && u > 0.42 && u < 0.58) discard;
    }
  }
}`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  float side = 1.0 - step(0.5, abs(vArchUp));
  float seed = vArchTower.y;
  float mx = vArchUv.x * uFaceW;
  float edgeM = min(mx, uFaceW - mx);
  float pilaster = 1.0 - smoothstep(1.0, 1.4, edgeM);
  float rib = step(fract(mx / 5.0), 0.1) * step(1.4, edgeM) * uDetail;
  float ledgeY = fract((vArchWorld.y + seed * 97.0) / 28.0);
  float ledge = step(0.94, ledgeY) * uDetail;
  float shade = 1.0 - rib * 0.5;
  shade = mix(shade, 2.0, pilaster * 0.55 * side);
  shade = mix(shade, 1.7, ledge * side);
  shade = mix(shade, 1.35, 1.0 - side);
  diffuseColor.rgb *= shade;

  // One recessed signal channel per face.
  float chan = 1.0 - smoothstep(0.15, 0.35, abs(mx - uFaceW * 0.5));
  diffuseColor.rgb *= 1.0 - chan * 0.6 * side;
  archChannel = chan * side * step(0.3, archHash(seed * 31.0 + floor(vArchUv.x + vArchUp)));

  // Sparse lit windows on a few floors only.
  vec2 cell = vec2(floor(mx / 2.2), floor(vArchWorld.y / 3.6));
  vec2 inCell = vec2(fract(mx / 2.2), fract(vArchWorld.y / 3.6));
  float floorLit = step(0.82, archHash(floor(vArchWorld.y / 28.0) + seed * 57.0));
  float lit = step(0.9, archHash2(cell + seed * 13.0)) * step(0.25, inCell.x) * step(inCell.x, 0.75) * step(0.3, inCell.y) * step(inCell.y, 0.55);
  archWindow = lit * floorLit * side * step(1.6, edgeM) * uDetail;
}`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float signalCoord = vArchWorld.y * uSignalBandScale;
  float signalSeg = fract( signalCoord * uSignalSegCount - uSignalPhase );
  float signalPulse = pow( 1.0 - abs( signalSeg * 2.0 - 1.0 ), uSignalSegSharp );
  float relY = vArchWorld.y - cameraPosition.y;
  float abyssFade = smoothstep( -260.0, 10.0, relY );
  // Emissive is confined to the embedded channel (+ its travelling bands).
  totalEmissiveRadiance *= archChannel * (0.35 + signalPulse * 1.6) * mix( 0.2, 1.0, abyssFade );
  totalEmissiveRadiance += emissive * archChannel * signalPulse * uSignalGain * 2.0 * abyssFade;
  totalEmissiveRadiance += vec3(0.55, 0.62, 0.72) * archWindow * 0.22;
}`
      )
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
{
  float dist = length( vArchWorld - cameraPosition );
  float atmo = smoothstep( 90.0, 900.0, dist );
  float abyss = smoothstep( uAbyssY - 380.0, uAbyssY + 40.0, vArchWorld.y );
  gl_FragColor.rgb = mix( uHaze * 0.25, gl_FragColor.rgb, abyss );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, uHaze, atmo * 0.55 );
}`
      );
  };
  material.needsUpdate = true;
}

export class SkylineArchitecture {
  public group: THREE.Group;
  private primaryMonoliths: THREE.InstancedMesh | null = null;
  private supportStelae: THREE.InstancedMesh | null = null;
  private backgroundRidges: THREE.InstancedMesh | null = null;

  private towerMaterials: THREE.MeshStandardMaterial[] = [];
  public signageSystem: CitySignageSystem | null = null;

  // --- Audio-reactive signal bands -----------------------------------------
  // One shared sweep phase (so the whole city scans as a single machine) plus
  // per-tier gains, patched into the three tower materials. This costs three
  // uniform writes per frame and zero extra draw calls.
  private scanPhaseUniform: THREE.IUniform = { value: 0 };
  private mastUniforms = {
    uTime: { value: 0 },
    uAccent: { value: new THREE.Color() },
    uHaze: { value: new THREE.Color() }
  };
  private tierSignalUniforms: Array<Record<string, THREE.IUniform>> = [];

  // Authored per-instance transforms, retained so distance culling can restore
  // them exactly (never regenerating geometry or changing silhouettes).
  private primaryBase: THREE.Matrix4[] = [];
  private supportBase: THREE.Matrix4[] = [];
  private ridgeBase: THREE.Matrix4[] = [];
  private hiddenFlags: Map<THREE.InstancedMesh, boolean[]> = new Map();
  // Perf pass: reusable scratch for the per-frame distance cull so the hot path
  // does not allocate matrices/vectors every frame.
  private cullHiddenMatrix = new THREE.Matrix4();
  private cullPos = new THREE.Vector3();
  private cullingActive = false;

  constructor(scene: THREE.Scene, analysis: TrackAnalysis, track: GeneratedTrack) {
    this.group = new THREE.Group();
    // World role: declared explicitly so the final world safety pass can
    // never mistake this geometry for gameplay (or miss it entirely).
    tagWorldRole(this.group, 'DECORATION', 'SkylineArchitecture');
    this.build(analysis, track);
    scene.add(this.group);
  }

  private build(analysis: TrackAnalysis, track: GeneratedTrack): void {
    const route = track.route;
    if (route.length < 5) return;

    const palette = analysis.visualAccent;
    const accentCol = new THREE.Color(palette.hex);

    // Authored pixel textures

    // 1. Materials (Dark Basalt & Brutalist Monolithic Concrete)
    const primaryMat = new THREE.MeshStandardMaterial({
      color: 0x0c1018,
      roughness: 0.9,
      metalness: 0.18,
      emissive: accentCol,
      emissiveIntensity: 0.03
    });
    this.towerMaterials.push(primaryMat);

    const stelaMat = new THREE.MeshStandardMaterial({
      color: 0x0d121b,
      roughness: 0.86,
      metalness: 0.22,
      emissive: accentCol,
      emissiveIntensity: 0.04
    });
    this.towerMaterials.push(stelaMat);

    const ridgeMat = new THREE.MeshStandardMaterial({
      color: 0x070a10,
      roughness: 0.96,
      metalness: 0.08,
      emissive: accentCol,
      emissiveIntensity: 0.01
    });
    this.towerMaterials.push(ridgeMat);

    // 1b. Patch the three tiers with the shared signal-band sweep. Tier 0
    // (primary monoliths) gets the sharpest, brightest bands; the distant
    // ridge tier gets broad, faint ones.
    // Per tier: face width (m), silhouette carving strength, surface detail.
    const bandConfigs = [
      { gain: 0.0, segCount: 22.0, segSharp: 3.4, bandScale: 0.055, faceW: 24.0, carve: 1.0, detail: 1.0 },
      { gain: 0.0, segCount: 15.0, segSharp: 2.6, bandScale: 0.040, faceW: 11.0, carve: 0.6, detail: 0.8 },
      { gain: 0.0, segCount: 9.0, segSharp: 1.9, bandScale: 0.028, faceW: 70.0, carve: 0.0, detail: 0.35 }
    ];
    let routeMinY = 0;
    for (const n of route) routeMinY = Math.min(routeMinY, n.position.y);
    const haze = new THREE.Color(0.05, 0.065, 0.1);
    this.tierSignalUniforms = bandConfigs.map((cfg) => {
      const uniforms: Record<string, THREE.IUniform> = {
        uSignalPhase: this.scanPhaseUniform,
        uSignalGain: { value: cfg.gain },
        uSignalSegCount: { value: cfg.segCount },
        uSignalSegSharp: { value: cfg.segSharp },
        uSignalBandScale: { value: cfg.bandScale },
        uFaceW: { value: cfg.faceW },
        uCarve: { value: cfg.carve },
        uDetail: { value: cfg.detail },
        uHaze: { value: haze },
        uAbyssY: { value: routeMinY - 40.0 }
      };
      return uniforms;
    });
    for (let t = 0; t < this.towerMaterials.length && t < this.tierSignalUniforms.length; t++) {
      patchArchitecture(this.towerMaterials[t], this.tierSignalUniforms[t]);
    }

    // 2. Geometries
    // Primary Colossal Monolith
    const monolithGeom = new THREE.BoxGeometry(24, 1, 24);
    // Secondary Support Stela
    const stelaGeom = new THREE.BoxGeometry(10, 1, 12);
    // Background Distant Ridge Slab
    const ridgeGeom = new THREE.BoxGeometry(70, 1, 18);

    // Controlled cluster spacing: every 6 nodes to preserve generous negative space
    const step = 6;
    const clusterCount = Math.floor(route.length / step);
    const maxInstances = Math.min(36, clusterCount) * 2;

    this.primaryMonoliths = new THREE.InstancedMesh(monolithGeom, primaryMat, maxInstances);
    this.supportStelae = new THREE.InstancedMesh(stelaGeom, stelaMat, maxInstances * 2);
    this.backgroundRidges = new THREE.InstancedMesh(ridgeGeom, ridgeMat, maxInstances);

    // Per-instance architecture data: (topY, profile seed).
    const towerData = (count: number): THREE.InstancedBufferAttribute =>
      new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
    const pData = towerData(maxInstances);
    const sData = towerData(maxInstances * 2);
    const rData = towerData(maxInstances);
    monolithGeom.setAttribute('aTower', pData);
    stelaGeom.setAttribute('aTower', sData);
    ridgeGeom.setAttribute('aTower', rData);
    const seedOf = (a: number, b: number): number => {
      const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    // Antenna masts + sky-bridges collected while placing monoliths.
    const mastMatrices: THREE.Matrix4[] = [];
    const bridgeMatrices: THREE.Matrix4[] = [];
    const lastMonolithBySide = new Map<number, { pos: THREE.Vector3; topY: number }>();

    const dummy = new THREE.Object3D();
    let pIdx = 0;
    let sIdx = 0;
    let rIdx = 0;

    const allCorridorNodes = RouteExclusionCorridor.collectGameplayNodes(track);
    const corridor = new RouteExclusionCorridor(allCorridorNodes);

    // Calculate global route minimum Y so every skyscraper extends far below the lowest route elevation
    let minWorldY = 0;
    for (const n of allCorridorNodes) {
      if (n.position.y < minWorldY) minWorldY = n.position.y;
    }

    const monolithAnchors: MonolithAnchor[] = [];
    const stelaeAnchors: StelaAnchor[] = [];

    for (let i = 2; i < route.length - 2 && pIdx < maxInstances; i += step) {
      const node = route[i];
      const timeRatio = Math.min(1, Math.max(0, node.time / analysis.duration));
      const frameIdx = Math.floor(timeRatio * (analysis.frames.length - 1));
      const frame = analysis.frames[frameIdx] || { rms: 0.3, bass: 0.3, mid: 0.3, high: 0.3 };

      const fwdX = Math.sin(node.yaw);
      const fwdZ = Math.cos(node.yaw);
      const rightX = fwdZ;
      const rightZ = -fwdX;

      // Place architectural clusters left or right alternating
      for (const side of [-1, 1]) {
        // Skip some sides to maintain asymmetric negative space
        if (((i / step) % 3 === 0) && side === 1) continue;

        // 1. Primary Landmark Monolith (175m - 210m away, plunging 340m-600m into deep abyss)
        const pDist = 175.0 + ((i * 19) % 35);
        const px = node.position.x + rightX * side * pDist;
        const pz = node.position.z + rightZ * side * pDist;
        const pTopY = node.position.y + Math.max(90.0, 100.0 + frame.bass * 160.0);
        const pPlunge = 340.0 + ((i * 37 + (side > 0 ? 113 : 47)) % 260.0); // 340m - 600m varying plunge
        const pAbyssBottom = minWorldY - pPlunge;
        const pHeight = pTopY - pAbyssBottom;
        const py = pAbyssBottom + pHeight * 0.5;

        dummy.position.set(px, py, pz);
        dummy.scale.set(1.0, pHeight, 1.0);
        dummy.rotation.set(0, node.yaw + (side > 0 ? 0.15 : -0.15), 0);
        dummy.updateMatrix();

        // Authoritative full 3D rotated bounding-box validation
        const mLocalBox = new THREE.Box3(
          new THREE.Vector3(-12.0, -0.5, -12.0),
          new THREE.Vector3(12.0, 0.5, 12.0)
        );
        const mCandidateBox = mLocalBox.applyMatrix4(dummy.matrix);

        if (!corridor.isBoxInsideCorridor(mCandidateBox)) {
          const pSeed = seedOf(i, side);
          pData.setXY(pIdx, pTopY, pSeed);
          this.primaryMonoliths.setMatrixAt(pIdx++, dummy.matrix);

          // Masts crown the plain and setback profiles only.
          if (pSeed < 0.6 && ((i / step) | 0) % 2 === 0) {
            const mastH = 26 + pSeed * 60;
            mastMatrices.push(
              new THREE.Matrix4().compose(
                new THREE.Vector3(px, pTopY + mastH * 0.5 - 2, pz),
                new THREE.Quaternion(),
                new THREE.Vector3(1.4, mastH, 1.4)
              )
            );
          }
          // Occasional sky-bridge to the previous monolith on the same side.
          const prev = lastMonolithBySide.get(side);
          const here = new THREE.Vector3(px, 0, pz);
          if (prev && ((i / step) | 0) % 3 === 1) {
            const span = here.distanceTo(prev.pos);
            if (span > 30 && span < 260) {
              const y = Math.min(pTopY, prev.topY) - 38;
              const mid = here.clone().add(prev.pos).multiplyScalar(0.5);
              const yaw = Math.atan2(here.x - prev.pos.x, here.z - prev.pos.z);
              bridgeMatrices.push(
                new THREE.Matrix4().compose(
                  new THREE.Vector3(mid.x, y, mid.z),
                  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
                  new THREE.Vector3(5, 6, span)
                )
              );
            }
          }
          lastMonolithBySide.set(side, { pos: here, topY: pTopY });

          monolithAnchors.push({
            id: `monolith_${i}_${side}`,
            position: dummy.position.clone(),
            width: 24.0,
            depth: 24.0,
            height: pHeight,
            topY: pTopY,
            abyssBottom: pAbyssBottom,
            yaw: node.yaw + (side > 0 ? 0.15 : -0.15),
            side,
            fwdX,
            fwdZ,
            rightX,
            rightZ,
            node,
            nodeIndex: i,
            progressRatio: i / (route.length - 1),
            isHero:
              (analysis.sections &&
                analysis.sections.some(
                  s => s.theme === 'DROP' && node.time >= s.start && node.time <= s.end
                )) ||
              frame.bass > 0.65 ||
              (i / step) % 4 === 1
          });
        }

        // 2. Secondary Support Stelae (Framing primary monolith, staying 160m-225m away)
        for (let st = -1; st <= 1; st += 2) {
          if (sIdx >= maxInstances * 2) break;
          const sDist = pDist + (st > 0 ? 16.0 : -12.0);
          const sx = node.position.x + rightX * side * sDist + fwdX * (st * 24.0);
          const sz = node.position.z + rightZ * side * sDist + fwdZ * (st * 24.0);
          const sTopY = node.position.y + Math.max(50.0, 55.0 + frame.mid * 80.0);
          const sPlunge = 320.0 + ((i * 29 + st * 71) % 240.0); // 320m - 560m varying plunge
          const sAbyssBottom = minWorldY - sPlunge;
          const sHeight = sTopY - sAbyssBottom;
          const sy = sAbyssBottom + sHeight * 0.5;

          dummy.position.set(sx, sy, sz);
          dummy.scale.set(1.0, sHeight, 1.0);
          dummy.rotation.set(0.04 * st, node.yaw + 0.1 * st, 0.05 * side);
          dummy.updateMatrix();

          const sLocalBox = new THREE.Box3(
            new THREE.Vector3(-5.0, -0.5, -6.0),
            new THREE.Vector3(5.0, 0.5, 6.0)
          );
          const sCandidateBox = sLocalBox.applyMatrix4(dummy.matrix);

          if (!corridor.isBoxInsideCorridor(sCandidateBox)) {
            sData.setXY(sIdx, sTopY, seedOf(i * 3 + st, side));
            this.supportStelae.setMatrixAt(sIdx++, dummy.matrix);

            stelaeAnchors.push({
              id: `stela_${i}_${side}_${st}`,
              position: dummy.position.clone(),
              width: 10.0,
              depth: 12.0,
              height: sHeight,
              topY: sTopY,
              abyssBottom: sAbyssBottom,
              yaw: node.yaw + 0.1 * st,
              side,
              fwdX,
              fwdZ,
              rightX,
              rightZ,
              node,
              progressRatio: i / (route.length - 1)
            });
          }
        }

        // 3. Distant Background Ridge (280m - 330m away in far atmosphere)
        if (rIdx < maxInstances) {
          const rDist = 280.0 + ((i * 23) % 50);
          const rx = node.position.x + rightX * side * rDist;
          const rz = node.position.z + rightZ * side * rDist;
          const rTopY = node.position.y + Math.max(55.0, 60.0 + frame.bass * 70.0);
          const rPlunge = 360.0 + ((i * 41) % 240.0); // 360m - 600m varying plunge
          const rAbyssBottom = minWorldY - rPlunge;
          const rHeight = rTopY - rAbyssBottom;
          const ry = rAbyssBottom + rHeight * 0.5;

          dummy.position.set(rx, ry, rz);
          dummy.scale.set(1.0, rHeight, 1.0);
          dummy.rotation.set(0, node.yaw + 0.3, 0);
          dummy.updateMatrix();

          const rLocalBox = new THREE.Box3(
            new THREE.Vector3(-35.0, -0.5, -9.0),
            new THREE.Vector3(35.0, 0.5, 9.0)
          );
          const rCandidateBox = rLocalBox.applyMatrix4(dummy.matrix);

          if (!corridor.isBoxInsideCorridor(rCandidateBox)) {
            rData.setXY(rIdx, rTopY, seedOf(i * 7, side));
            this.backgroundRidges.setMatrixAt(rIdx++, dummy.matrix);
          }
        }
      }
    }

    this.primaryMonoliths.count = pIdx;
    this.supportStelae.count = sIdx;
    this.backgroundRidges.count = rIdx;

    this.primaryMonoliths.instanceMatrix.needsUpdate = true;
    this.supportStelae.instanceMatrix.needsUpdate = true;
    this.backgroundRidges.instanceMatrix.needsUpdate = true;

    // Retain authored transforms for distance culling.
    const capture = (mesh: THREE.InstancedMesh | null): THREE.Matrix4[] => {
      if (!mesh) return [];
      const out: THREE.Matrix4[] = [];
      const tmp = new THREE.Matrix4();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, tmp);
        out.push(tmp.clone());
      }
      this.hiddenFlags.set(mesh, new Array(mesh.count).fill(false));
      return out;
    };
    this.primaryBase = capture(this.primaryMonoliths);
    this.supportBase = capture(this.supportStelae);
    this.ridgeBase = capture(this.backgroundRidges);

    this.group.add(this.primaryMonoliths);
    this.group.add(this.supportStelae);
    this.group.add(this.backgroundRidges);

    // 3b. Antenna masts: thin dark spires with a slow beacon at the tip.
    if (mastMatrices.length > 0) {
      const mastGeom = new THREE.BoxGeometry(1, 1, 1);
      const mastMat = new THREE.ShaderMaterial({
        uniforms: this.mastUniforms,
        vertexShader: `
          varying float vLocalY;
          varying vec3 vWorld;
          void main() {
            vLocalY = position.y;
            vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: `
          uniform float uTime;
          uniform vec3 uAccent;
          uniform vec3 uHaze;
          varying float vLocalY;
          varying vec3 vWorld;
          void main() {
            float tip = step(0.47, vLocalY);
            float blink = step(0.55, fract(uTime * 0.45 + vWorld.x * 0.013));
            vec3 body = vec3(0.03, 0.035, 0.05);
            float atmo = smoothstep(90.0, 900.0, length(vWorld - cameraPosition));
            vec3 col = mix(body, uHaze, atmo * 0.55);
            col = mix(col, mix(uAccent, vec3(1.0), 0.4) * (0.35 + blink * 1.4), tip);
            gl_FragColor = vec4(col, 1.0);
          }`,
        fog: false
      });
      this.mastUniforms.uAccent.value.copy(accentCol);
      this.mastUniforms.uHaze.value.copy(haze);
      const masts = new THREE.InstancedMesh(mastGeom, mastMat, mastMatrices.length);
      mastMatrices.forEach((m, k) => masts.setMatrixAt(k, m));
      masts.instanceMatrix.needsUpdate = true;
      masts.name = 'SkylineMasts';
      masts.frustumCulled = false;
      this.group.add(masts);
    }

    // 3c. Sky-bridges between neighbouring monoliths: connective tissue that
    // makes the skyline read as one structure rather than scattered towers.
    if (bridgeMatrices.length > 0) {
      const bridgeGeom = new THREE.BoxGeometry(1, 1, 1);
      const bData = new THREE.InstancedBufferAttribute(new Float32Array(bridgeMatrices.length * 2), 2);
      bridgeMatrices.forEach((_, k) => bData.setXY(k, 1e5, 0.1));
      bridgeGeom.setAttribute('aTower', bData);
      const bridges = new THREE.InstancedMesh(bridgeGeom, primaryMat, bridgeMatrices.length);
      bridgeMatrices.forEach((m, k) => bridges.setMatrixAt(k, m));
      bridges.instanceMatrix.needsUpdate = true;
      bridges.name = 'SkylineBridges';
      bridges.frustumCulled = false;
      this.group.add(bridges);
    }

    // 4. Mount Audio-Reactive City Signage & Facade Displays
    this.signageSystem = new CitySignageSystem(
      analysis,
      track,
      corridor,
      monolithAnchors,
      stelaeAnchors
    );
    this.group.add(this.signageSystem.group);
    this.group.add(this.signageSystem.frameGroup);
  }

  public update(visualState: MusicVisualState, dt = 0, reduceMotion = false): void {
    const react = visualState.reactivityMultiplier;
    const energy = visualState.energy;
    const ch = resolveChannels(visualState);
    const slot = ch.slot;

    // REACTIVITY HIERARCHY — the city answers the music with a clear order AND
    // a clear delay:
    //   PRIMARY   nearby monoliths:  first to answer (0-80 ms drop window)
    //   SECONDARY support stelae:    answers next (150-350 ms)
    //   TERTIARY  distant ridges:    answers last (250-600 ms)
    //
    // The transient answer is scheduled across the tiers by the music-driven
    // channel slot, so a beat does not light every layer at once. That layered
    // distribution is what makes the city read as separate parts of the music
    // rather than one brightness scalar.
    const primaryOnset = ch.transient * (slot % 3 === 0 ? 1.0 : 0.3);
    const secondaryOnset = ch.transient * (slot % 3 === 1 ? 1.0 : 0.26);
    const tertiaryOnset = ch.transient * (slot % 3 === 2 ? 1.0 : 0.18);

    // Every layer keeps a non-zero baseline so the skyline always breathes,
    // but the baselines stay LOW so a drop has headroom to be obviously bigger.
    const primary =
      (0.10 + energy * 0.14 + ch.bassMass * 0.44 + primaryOnset * 0.58 + ch.dropPrimary * 1.15) * react;
    const secondary =
      (0.06 + energy * 0.10 + ch.bassMass * 0.26 + secondaryOnset * 0.34 + ch.dropSecondary * 0.72) * react;
    const tertiary =
      (0.03 + energy * 0.06 + ch.bassMass * 0.14 + tertiaryOnset * 0.22 + ch.dropTertiary * 0.40) * react;

    if (this.towerMaterials[0]) {
      this.towerMaterials[0].emissiveIntensity = Math.min(1.05, primary);
    }
    if (this.towerMaterials[1]) {
      this.towerMaterials[1].emissiveIntensity = Math.min(0.78, secondary);
    }
    if (this.towerMaterials[2]) {
      this.towerMaterials[2].emissiveIntensity = Math.min(0.52, tertiary);
    }

    // Signal band sweep: one shared phase, per-tier gain. Reduced motion slows
    // the sweep right down but keeps the luminance response.
    const motionScale = reduceMotion ? 0.3 : 1.0;
    this.scanPhaseUniform.value = ch.scanPhase * motionScale;
    this.mastUniforms.uTime.value = visualState.time;
    if (this.tierSignalUniforms.length >= 3) {
      this.tierSignalUniforms[0].uSignalGain.value =
        Math.min(0.9, (0.06 + ch.bassMass * 0.5 + primaryOnset * 0.6 + ch.dropPrimary * 0.9) * react);
      this.tierSignalUniforms[1].uSignalGain.value =
        Math.min(0.6, (0.03 + ch.bassMass * 0.3 + secondaryOnset * 0.4 + ch.dropSecondary * 0.6) * react);
      this.tierSignalUniforms[2].uSignalGain.value =
        Math.min(0.35, (0.02 + ch.bassMass * 0.16 + tertiaryOnset * 0.24 + ch.dropTertiary * 0.4) * react);
    }

    if (this.signageSystem) {
      this.signageSystem.update(visualState, dt);
    }
  }

   /**
   * Refreshes the authored transform baseline after the authoritative world-space
   * RouteExclusionCorridor validation pass has run. This guarantees distance culling
   * and instance restoration never resurrect rejected or zeroed-out instances.
   */
  public refreshAuthoredTransformsAfterValidation(): void {
    const refresh = (mesh: THREE.InstancedMesh | null): THREE.Matrix4[] => {
      if (!mesh) return [];
      const out: THREE.Matrix4[] = [];
      const tmp = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, tmp);
        pos.setFromMatrixPosition(tmp);
        // If an instance was rejected/zeroed by RouteExclusionCorridor, keep it permanently as zeroMatrix
        if (pos.y < -50000 || tmp.elements[0] === 0) {
          const zero = new THREE.Matrix4().makeScale(0, 0, 0);
          zero.setPosition(0, -99999, 0);
          out.push(zero);
        } else {
          out.push(tmp.clone());
        }
      }
      return out;
    };
    this.primaryBase = refresh(this.primaryMonoliths);
    this.supportBase = refresh(this.supportStelae);
    this.ridgeBase = refresh(this.backgroundRidges);
    if (this.primaryMonoliths) this.hiddenFlags.set(this.primaryMonoliths, new Array(this.primaryMonoliths.count).fill(false));
    if (this.supportStelae) this.hiddenFlags.set(this.supportStelae, new Array(this.supportStelae.count).fill(false));
    if (this.backgroundRidges) this.hiddenFlags.set(this.backgroundRidges, new Array(this.backgroundRidges.count).fill(false));
  }

  /**
   * Distance-based visibility for purely decorative skyline clusters.
   *
   * These sit 155-260m+ out and plunge hundreds of metres, so at long range
   * they are a large amount of fill for very little on-screen contribution.
   * Culling individual instances (rather than a whole layer) keeps the
   * silhouette continuous, and because the cutoff is generous and gradual there
   * is no popping near the player.
   *
   * `maxDistance <= 0` disables culling entirely (HIGH / ULTRA).
   */
  /**
   * DEV diagnostics: how many skyline instances are currently drawn vs total.
   * Cheap (reads the cached visibility flags).
   */
  public getVisibleCounts(): { visible: number; total: number } {
    let visible = 0;
    let total = 0;
    const meshes: Array<THREE.InstancedMesh | null> = [
      this.primaryMonoliths,
      this.supportStelae,
      this.backgroundRidges
    ];
    for (const mesh of meshes) {
      if (!mesh) continue;
      total += mesh.count;
      const flags = this.hiddenFlags.get(mesh);
      for (let i = 0; i < mesh.count; i++) {
        if (!flags || !flags[i]) visible++;
      }
    }
    return { visible, total };
  }

  /**
   * Distance-based visibility for purely decorative skyline clusters.
   *
   * `maxDistance <= 0` disables culling entirely (HIGH / ULTRA).
   */
  public applyDistanceCulling(cameraPos: THREE.Vector3, maxDistance: number): void {
    if (this.signageSystem) {
      this.signageSystem.applyDistanceCulling(cameraPos, maxDistance);
    }

    if (maxDistance <= 0) {
      if (this.cullingActive) {
        this.restoreAllInstances();
        this.cullingActive = false;
      }
      return;
    }

    this.cullingActive = true;

    const targets: Array<{ mesh: THREE.InstancedMesh; base: THREE.Matrix4[] }> = [
      { mesh: this.primaryMonoliths!, base: this.primaryBase },
      { mesh: this.supportStelae!, base: this.supportBase },
      { mesh: this.backgroundRidges!, base: this.ridgeBase }
    ];

    const hidden = this.cullHiddenMatrix.makeScale(0, 0, 0);
    hidden.setPosition(0, -99999, 0);
    const pos = this.cullPos;

    for (const { mesh, base } of targets) {
      if (!mesh) continue;
      let dirty = false;
      // Fade band: hide only clearly beyond the cutoff so nothing pops in.
      const cutoffSq = maxDistance * maxDistance;
      for (let i = 0; i < mesh.count; i++) {
        const m = base[i];
        if (!m) continue;
        pos.setFromMatrixPosition(m);
        // Permanently rejected instances stay zeroed
        if (pos.y < -50000 || m.elements[0] === 0) {
          mesh.setMatrixAt(i, hidden);
          continue;
        }

        const far = pos.distanceToSquared(cameraPos) > cutoffSq;
        const current = this.hiddenFlags.get(mesh)![i];
        if (current === far) continue;
        this.hiddenFlags.get(mesh)![i] = far;
        mesh.setMatrixAt(i, far ? hidden : m);
        dirty = true;
      }
      if (dirty) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Restores every instance to its authored transform. */
  private restoreAllInstances(): void {
    const pairs: Array<{ mesh: THREE.InstancedMesh | null; base: THREE.Matrix4[] }> = [
      { mesh: this.primaryMonoliths, base: this.primaryBase },
      { mesh: this.supportStelae, base: this.supportBase },
      { mesh: this.backgroundRidges, base: this.ridgeBase }
    ];
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    hidden.setPosition(0, -99999, 0);
    const pos = new THREE.Vector3();

    for (const { mesh, base } of pairs) {
      if (!mesh) continue;
      for (let i = 0; i < mesh.count; i++) {
        if (base[i]) {
          const m = base[i];
          pos.setFromMatrixPosition(m);
          if (pos.y < -50000 || m.elements[0] === 0) {
            mesh.setMatrixAt(i, hidden);
          } else {
            mesh.setMatrixAt(i, m);
          }
        }
      }
      const flags = this.hiddenFlags.get(mesh);
      if (flags) flags.fill(false);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  public dispose(): void {
    if (this.signageSystem) {
      this.signageSystem.dispose();
      this.signageSystem = null;
    }

    this.group.traverse(obj => {
      if (obj instanceof THREE.InstancedMesh || obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
  }
}
