/**
 * Procedural Geometry Builder for PLAYHEAD SIGNAL RENDER
 * "Cosmic Pixel Brutalism" architectural world builder.
 *
 * Constructs Three.js meshes, materials, and accent elements using
 * BrutalistShapeLibrary, PixelTextureGenerator, and PixelArtLibrary.
 */

import * as THREE from 'three';
import { GeneratedTrack, RouteNode, RouteNodeType } from '../generation/GenerationTypes';
import { createPlatformGeometry } from '../generation/PlatformShape';
import { VisualAccent } from '../audio/AudioFeatures';
import { TrackPalette } from '../audio/TrackPalettes';
import { PixelTextureGenerator } from './PixelTextureGenerator';
import { BrutalistShapeLibrary } from './BrutalistShapeLibrary';
import { PixelArtLibrary } from './PixelArtLibrary';
import { RouteExclusionCorridor } from './RouteExclusionCorridor';
import { ReactiveChannel } from './PlayheadSystem';
import { FINISH_GATE_HEIGHT } from '../gameplay/FinishGateDetector';

export interface RouteEdgeItem {
  mesh: THREE.LineSegments;
  nodeArcLength: number;
  nodeTime: number;
}

/**
 * A large architectural signal surface (gate frame, finish plane, accent trim)
 * that is lit by the music rather than by the playhead's temporal state.
 */
export interface ReactiveBeaconItem {
  mesh: THREE.Mesh;
  channel: ReactiveChannel;
}

/**
 * A moving gameplay obstacle whose mesh must track its deterministic collider
 * position every frame. Base is the oscillation centre; lateral is the unit
 * local-+X direction in world space.
 */
export interface AnimatedObstacleItem {
  mesh: THREE.Mesh;
  outline: THREE.LineSegments | null;
  baseX: number;
  baseY: number;
  baseZ: number;
  lateralX: number;
  lateralZ: number;
  amplitude: number;
  speed: number;
  phase: number;
}

export interface BuiltWorldAssets {
  rootGroup: THREE.Group;
  decorativeGroup: THREE.Group;
  reactiveMaterials: THREE.MeshStandardMaterial[];
  reactiveBeacons: ReactiveBeaconItem[];
  edgeLines: THREE.LineSegments[];
  routeEdgeItems: RouteEdgeItem[];
  animatedObstacles: AnimatedObstacleItem[];
  dispose: () => void;
}

export class GeometryBuilder {
  public static buildWorld(
    track: GeneratedTrack,
    paletteOrAccent: TrackPalette | VisualAccent
  ): BuiltWorldAssets {
    const rootGroup = new THREE.Group();
    const decorativeGroup = new THREE.Group();
    decorativeGroup.name = 'BuiltWorldDecorativeGroup';
    rootGroup.add(decorativeGroup);
    const reactiveMaterials: THREE.MeshStandardMaterial[] = [];
    const reactiveBeacons: ReactiveBeaconItem[] = [];
    const edgeLines: THREE.LineSegments[] = [];
    const routeEdgeItems: RouteEdgeItem[] = [];
    const animatedObstacles: AnimatedObstacleItem[] = [];

    /**
     * Beacons share one material instance per channel, so only the first mesh
     * per material is registered — every sibling shares the same animated
     * result without paying for redundant per-frame writes.
     */
    const registeredBeaconMaterials = new Set<THREE.Material>();
    const registerBeacon = (mesh: THREE.Mesh, channel: ReactiveChannel): void => {
      const mat = mesh.material as THREE.Material;
      if (registeredBeaconMaterials.has(mat)) return;
      registeredBeaconMaterials.add(mat);
      reactiveBeacons.push({ mesh, channel });
    };

    // Authoritative Route Exclusion Corridor (including any optional skill lines, recovery shelves, and signal spines)
    const allRouteNodes = [
      ...track.route,
      ...(track.optionalRamps || []),
      ...(track.recoveryShelves || []),
      ...(track.signalSpines || [])
    ];
    const corridor = new RouteExclusionCorridor(allRouteNodes);

    // Shared Palette Colors
    const isPalette = 'primary' in paletteOrAccent;
    const primaryCol = isPalette ? paletteOrAccent.primary : new THREE.Color(paletteOrAccent.hex);
    const secondaryCol = isPalette ? paletteOrAccent.secondary : primaryCol.clone().offsetHSL(0.1, 0, 0);
    const surfaceCol = isPalette ? paletteOrAccent.surface : new THREE.Color(0x0e141f);
    const voidCol = isPalette ? paletteOrAccent.void : new THREE.Color(0x04060a);

    const primaryHex = isPalette ? paletteOrAccent.primaryHex : paletteOrAccent.hex;
    const secondaryHex = isPalette ? paletteOrAccent.secondaryHex : primaryHex;

    // 0. Authored NearestFilter Pixel Textures
    const concreteTex = PixelTextureGenerator.getDarkConcreteTexture();
    const basaltTex = PixelTextureGenerator.getBlackBasaltTexture();
    const surfTex = PixelTextureGenerator.getSurfSignalTexture(primaryHex);

    // 1. Route Platform Material (Brutalist Cast Concrete with Pixel Aggregate)
    const platformMaterial = new THREE.MeshStandardMaterial({
      color: surfaceCol,
      roughness: 0.72,
      metalness: 0.12,
      emissive: new THREE.Color(0x060910),
      map: concreteTex,
      bumpMap: concreteTex,
      bumpScale: 0.04
    });

    // 2. Surf Material (Directional Glide Chevrons + Edge Guide Rails)
    const surfMaterial = new THREE.MeshStandardMaterial({
      color: 0x141c2b,
      emissive: primaryCol,
      emissiveIntensity: 0.28,
      roughness: 0.22,
      metalness: 0.78,
      map: surfTex,
      bumpMap: surfTex,
      bumpScale: 0.03
    });
    reactiveMaterials.push(surfMaterial);

    // 3. Audio-Reactive Accent Edge Material
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: 0x05060a,
      emissive: primaryCol,
      emissiveIntensity: 0.75,
      roughness: 0.25,
      metalness: 0.85
    });
    reactiveMaterials.push(accentMaterial);

    // 3b. Dedicated Signal Spine Top Material:
    // Primarily uses the normal platform grey family (78%) blended with subtle signal tint (22%).
    // Sits close to ordinary platform concrete architecture without looking like a loud brightly colored bridge.
    const spineTopMaterial = new THREE.MeshStandardMaterial({
      color: surfaceCol.clone().lerp(primaryCol, 0.22),
      emissive: primaryCol,
      emissiveIntensity: 0.05,
      roughness: 0.68,
      metalness: 0.16,
      map: concreteTex,
      bumpMap: concreteTex,
      bumpScale: 0.04
    });
    reactiveMaterials.push(spineTopMaterial);

    // 4. Checkpoint Material
    const checkpointMaterial = new THREE.MeshStandardMaterial({
      color: 0x080c14,
      emissive: secondaryCol,
      emissiveIntensity: 1.6,
      transparent: true,
      opacity: 0.88,
      roughness: 0.15
    });
    reactiveMaterials.push(checkpointMaterial);

    // 5. Finish Gate Material
    const finishMaterial = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      emissive: primaryCol,
      emissiveIntensity: 2.1,
      roughness: 0.1,
      metalness: 0.9
    });
    reactiveMaterials.push(finishMaterial);

    // 6. Background Monumental Basalt Material
    const backgroundMonolithMaterial = new THREE.MeshStandardMaterial({
      color: voidCol,
      roughness: 0.92,
      metalness: 0.12,
      map: basaltTex,
      bumpMap: basaltTex,
      bumpScale: 0.06
    });

    // 7. Architectural Mural Material
    const muralTex = PixelArtLibrary.getMuralTexture(primaryHex, secondaryHex);
    const muralMaterial = new THREE.MeshBasicMaterial({
      map: muralTex,
      side: THREE.DoubleSide
    });

    // 8. Audio-Reactive Signal Beacons
    // These are the monumental gate frames / finish planes / accent trims.
    // They are authored to sit just BELOW the bloom threshold at rest, so a
    // strong transient is what pushes them over the threshold and makes the
    // architecture visibly answer the beat. Emissive is driven per-frame from
    // the single authoritative MusicVisualController state (see PlayheadSystem).
    const makeBeaconMaterial = (
      color: number,
      emissive: THREE.Color,
      baseEmissive: number,
      opacity = 1.0
    ): THREE.MeshStandardMaterial => {
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity: baseEmissive,
        roughness: 0.22,
        metalness: 0.4,
        transparent: opacity < 1.0,
        opacity
      });
      reactiveMaterials.push(mat);
      return mat;
    };

    // Major checkpoint gate frame: luminous wireframe lattice, strong transient answer.
    const gateFrameMaterial = makeBeaconMaterial(0x05060a, secondaryCol.clone(), 0.55, 0.62);
    gateFrameMaterial.wireframe = true;

    // Finish signal plane: the large glowing portal wall the player runs through.
    const finishPlaneMaterial = makeBeaconMaterial(0x0a0f18, primaryCol.clone(), 0.62, 0.5);
    finishPlaneMaterial.side = THREE.DoubleSide;
    finishPlaneMaterial.blending = THREE.AdditiveBlending;
    finishPlaneMaterial.depthWrite = false;

    // Secondary trim: finish pylon edge indicators + embedded ground signal line.
    const accentTrimMaterial = makeBeaconMaterial(0x05060a, primaryCol.clone(), 0.42);

    // Tertiary detailing: floating header signal bar.
    const headerBarMaterial = makeBeaconMaterial(0x080c14, secondaryCol.clone(), 0.45, 0.8);

    // Gameplay obstacles use one dark structural material and one shared signal
    // material. Their silhouettes remain readable even when the emissive pulse
    // is at rest, while the approach strip telegraphs the required response.
    const obstacleBodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x070a10,
      emissive: secondaryCol,
      emissiveIntensity: 0.12,
      roughness: 0.62,
      metalness: 0.48,
      map: basaltTex
    });
    const obstacleSignalMaterial = makeBeaconMaterial(0x0a111a, primaryCol.clone(), 0.48, 0.9);

    // Build Route Meshes
    for (let i = 0; i < track.route.length; i++) {
      const node = track.route[i];

      // Rendering and collision consume the same authoritative footprint.
      const geom = createPlatformGeometry(node);

      // Surf face readability: top (+Y) gets glowing chevrons, bottom/sides get dark basalt
      const surfMultiMat = [
        accentMaterial,
        accentMaterial,
        surfMaterial,
        backgroundMonolithMaterial,
        accentMaterial,
        accentMaterial
      ];
      const mat = node.isSurf
        ? surfMultiMat
        : (node.type === RouteNodeType.FINISH ? finishMaterial : platformMaterial);
      const mesh = new THREE.Mesh(geom, mat);

      mesh.position.set(node.position.x, node.position.y, node.position.z);
      mesh.rotation.set(node.pitch, node.yaw, node.roll, 'YXZ');
      rootGroup.add(mesh);

      // Descending Monolithic Foundation Pillars plunging into the deep void (320m - 540m)
      if (!node.isSurf && node.type !== RouteNodeType.FINISH && i % 6 === 0) {
        const pylonHeight = 320.0 + ((i * 31) % 220.0);
        const pylonWidth = Math.min(3.4, node.dimensions.x * 0.45);
        const pylonGeom = new THREE.BoxGeometry(pylonWidth, pylonHeight, pylonWidth * 1.2);
        const pylonMesh = new THREE.Mesh(pylonGeom, backgroundMonolithMaterial);
        pylonMesh.position.set(node.position.x, node.position.y - pylonHeight * 0.5 - node.dimensions.y * 1.5, node.position.z);
        pylonMesh.rotation.set(0, node.yaw, 0);
        rootGroup.add(pylonMesh);
      }

      // Add Emissive Edge Trim on lateral sides
      const edgesGeom = new THREE.EdgesGeometry(geom);
      const lineMat = new THREE.LineBasicMaterial({
        color: node.isSurf ? secondaryCol : primaryCol,
        transparent: true,
        opacity: node.isSurf ? 0.98 : (node.isBoost ? 1.0 : 0.85)
      });
      const edges = new THREE.LineSegments(edgesGeom, lineMat);
      edges.position.copy(mesh.position);
      edges.rotation.copy(mesh.rotation);
      rootGroup.add(edges);
      edgeLines.push(edges);
      routeEdgeItems.push({
        mesh: edges,
        nodeArcLength: node.arcLength,
        nodeTime: node.time
      });

      // Checkpoint Arch Gateway
      if (node.type === RouteNodeType.CHECKPOINT) {
        const { group: arch, gateFrame } = createSteppedCheckpointArch(
          node,
          checkpointMaterial,
          gateFrameMaterial
        );
        rootGroup.add(arch);
        registerBeacon(gateFrame, 'GATE_FRAME');
      }

      // Finish Portal Monument
      if (node.type === RouteNodeType.FINISH) {
        const finishPortal = createFinishMonument(
          node,
          finishMaterial,
          { plane: finishPlaneMaterial, trim: accentTrimMaterial, header: headerBarMaterial },
          registerBeacon
        );
        rootGroup.add(finishPortal);
      }

      // Procedural Brutalist Landmarks framing the route (added to decorativeGroup for validation)
      if (i % 4 === 0 && node.type !== RouteNodeType.FINISH) {
        const side = (i % 8 === 0 ? 1 : -1);
        const landmark = createRouteLandmark(node, side, i, backgroundMonolithMaterial, muralMaterial, corridor);
        if (landmark) decorativeGroup.add(landmark);
      }

      // Surf Canyon Walls framing surf sections (added to decorativeGroup for validation)
      if (node.isSurf && i % 2 === 0) {
        const canyon = createSurfFlank(node, backgroundMonolithMaterial, corridor);
        if (canyon) decorativeGroup.add(canyon);
      }
    }

    // Deterministic route challenges. Collision consumes these exact same box
    // dimensions in PhysicsWorld; only the thin floor strip is non-colliding
    // telegraph geometry.
    if (track.obstacles) {
      for (const obstacle of track.obstacles) {
        const geom = new THREE.BoxGeometry(
          obstacle.dimensions.x,
          obstacle.dimensions.y,
          obstacle.dimensions.z
        );
        // Jumpable signal beams glow; structural blockers stay dark basalt so
        // the route reads as architecture rather than an obstacle course.
        const isSignalElement =
          obstacle.obstacleType === 'SCAN_BAR' || obstacle.obstacleType === 'SWEEP_BEAM';
        const bodyMaterial = isSignalElement ? obstacleSignalMaterial : obstacleBodyMaterial;
        const mesh = new THREE.Mesh(geom, bodyMaterial);
        mesh.name = `RouteObstacle:${obstacle.obstacleType}:${obstacle.id}`;
        mesh.position.set(obstacle.position.x, obstacle.position.y, obstacle.position.z);
        mesh.rotation.set(0, obstacle.yaw, 0, 'YXZ');
        mesh.userData.routeObstacleId = obstacle.id;
        rootGroup.add(mesh);
        if (isSignalElement) registerBeacon(mesh, 'ACCENT_TRIM');

        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(geom),
          new THREE.LineBasicMaterial({ color: primaryCol, transparent: true, opacity: 0.95 })
        );
        outline.name = `RouteObstacleOutline:${obstacle.id}`;
        outline.position.copy(mesh.position);
        outline.rotation.copy(mesh.rotation);
        rootGroup.add(outline);
        edgeLines.push(outline);
        routeEdgeItems.push({ mesh: outline, nodeArcLength: obstacle.arcLength, nodeTime: obstacle.time });

        // Moving obstacles register their mesh so it tracks the deterministic
        // collider motion each frame (song-time driven, never audio jitter).
        if (obstacle.obstacleMotion) {
          const sinYaw = Math.sin(obstacle.yaw);
          const cosYaw = Math.cos(obstacle.yaw);
          animatedObstacles.push({
            mesh,
            outline,
            baseX: obstacle.position.x,
            baseY: obstacle.position.y,
            baseZ: obstacle.position.z,
            lateralX: cosYaw,
            lateralZ: -sinYaw,
            amplitude: obstacle.obstacleMotion.amplitude,
            speed: obstacle.obstacleMotion.speed,
            phase: obstacle.obstacleMotion.phase
          });
        }

        // Obstacles communicate through silhouette, opening and edge
        // illumination only. The old translucent floor read-strip was removed:
        // it looked like a walkable platform and violated PLAYHEAD's visual
        // language. Collision is unaffected (the strip was never a collider).
      }
    }

    // Build Subtle Recovery Catch-Shelves (Subdued safety shelves under tricky sequences)
    if (track.recoveryShelves) {
      for (const shelf of track.recoveryShelves) {
        const geom = new THREE.BoxGeometry(shelf.dimensions.x, shelf.dimensions.y, shelf.dimensions.z);
        const mesh = new THREE.Mesh(geom, backgroundMonolithMaterial);
        mesh.position.set(shelf.position.x, shelf.position.y, shelf.position.z);
        mesh.rotation.set(shelf.pitch, shelf.yaw, shelf.roll, 'YXZ');
        rootGroup.add(mesh);

        // Subdued dark rim edge
        const edgesGeom = new THREE.EdgesGeometry(geom);
        const lineMat = new THREE.LineBasicMaterial({
          color: 0x1f293d,
          transparent: true,
          opacity: 0.6
        });
        const edges = new THREE.LineSegments(edgesGeom, lineMat);
        edges.position.copy(mesh.position);
        edges.rotation.copy(mesh.rotation);
        rootGroup.add(edges);
        edgeLines.push(edges);
      }
    }

    // Build Authoritative Signal Spines (Procedural secondary recovery layer)
    if (track.signalSpines) {
      for (const spine of track.signalSpines) {
        const geom = new THREE.BoxGeometry(spine.dimensions.x, spine.dimensions.y, spine.dimensions.z);
        // Multi-material: Top face (+Y, index 2) uses spineTopMaterial (audio-reactive signal aggregate).
        // Underside (-Y, index 3) gets backgroundMonolithMaterial (dark brutalist basalt).
        // Side faces (indices 0, 1, 4, 5) get accentMaterial (dark with audio-reactive accent trim).
        const meshMat = [
          accentMaterial,
          accentMaterial,
          spine.isSurf ? surfMaterial : spineTopMaterial,
          backgroundMonolithMaterial,
          accentMaterial,
          accentMaterial
        ];

        const mesh = new THREE.Mesh(geom, meshMat);
        mesh.position.set(spine.position.x, spine.position.y, spine.position.z);
        mesh.rotation.set(spine.pitch, spine.yaw, spine.roll, 'YXZ');
        rootGroup.add(mesh);
      }
    }

    // Build Optional Side-Surf Skill Ramps
    if (track.optionalRamps) {
      for (const ramp of track.optionalRamps) {
        const geom = new THREE.BoxGeometry(ramp.dimensions.x, ramp.dimensions.y, ramp.dimensions.z);
        const rampMultiMat = [
          accentMaterial,
          accentMaterial,
          surfMaterial,
          backgroundMonolithMaterial,
          accentMaterial,
          accentMaterial
        ];
        const mesh = new THREE.Mesh(geom, rampMultiMat);
        mesh.position.set(ramp.position.x, ramp.position.y, ramp.position.z);
        mesh.rotation.set(ramp.pitch, ramp.yaw, ramp.roll, 'YXZ');
        rootGroup.add(mesh);


        // Emissive edge trim
        const edgesGeom = new THREE.EdgesGeometry(geom);
        const lineMat = new THREE.LineBasicMaterial({
          color: secondaryCol,
          transparent: true,
          opacity: 0.98
        });
        const edges = new THREE.LineSegments(edgesGeom, lineMat);
        edges.position.copy(mesh.position);
        edges.rotation.copy(mesh.rotation);
        rootGroup.add(edges);
        edgeLines.push(edges);
      }
    }

    const dispose = () => {
      rootGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        } else if (obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
    };

    return {
      rootGroup,
      decorativeGroup,
      reactiveMaterials,
      reactiveBeacons,
      edgeLines,
      routeEdgeItems,
      animatedObstacles,
      dispose
    };
  }
}

/**
 * Stepped Brutalist Checkpoint Gateway
 * Massive twin stelae pillars with double lintel crown and glowing signal frame.
 *
 * The gate frame is returned separately so the world can drive its emissive
 * from the shared music state instead of leaving it as a static overlay.
 */
function createSteppedCheckpointArch(
  node: RouteNode,
  material: THREE.Material,
  gateFrameMaterial: THREE.MeshStandardMaterial
): { group: THREE.Group; gateFrame: THREE.Mesh } {
  const group = new THREE.Group();
  group.position.set(node.position.x, node.position.y, node.position.z);
  group.rotation.set(node.pitch, node.yaw, node.roll, 'YXZ');

  const archHeight = 9.5;
  const pillarWidth = 1.6;
  const halfWidth = node.dimensions.x * 0.5;

  // Left & Right Stepped Plinths and Descending Support Legs
  for (const side of [-1, 1]) {
    const px = side * (halfWidth + pillarWidth * 0.4);
    // Base Plinth
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(pillarWidth * 1.5, 1.2, pillarWidth * 1.8), material);
    plinth.position.set(px, 0.6, 0);
    group.add(plinth);

    // Main Column Stela
    const stela = new THREE.Mesh(new THREE.BoxGeometry(pillarWidth, archHeight, pillarWidth * 1.2), material);
    stela.position.set(px, archHeight * 0.5, 0);
    group.add(stela);

    // Monumental Descending Support Leg (Anchors 125m down into the void)
    const legDepth = 125.0;
    const legWidth = pillarWidth * 1.35;
    const legGeom = new THREE.BoxGeometry(legWidth, legDepth, pillarWidth * 1.5);
    const leg = new THREE.Mesh(legGeom, material);
    leg.position.set(px, -legDepth * 0.5, 0);
    group.add(leg);

    // Foundation collar below road level
    const collarGeom = new THREE.BoxGeometry(legWidth * 1.3, 4.0, pillarWidth * 1.8);
    const collar = new THREE.Mesh(collarGeom, material);
    collar.position.set(px, -2.5, 0);
    group.add(collar);
  }

  // Transverse Under-Road Monolithic Foundation Beam
  const strutGeom = new THREE.BoxGeometry(node.dimensions.x + pillarWidth * 3.2, 4.0, pillarWidth * 1.6);
  const strut = new THREE.Mesh(strutGeom, material);
  strut.position.set(0, -2.5, 0);
  group.add(strut);

  // Overhead Monolithic Double Lintel
  const lowerLintel = new THREE.Mesh(
    new THREE.BoxGeometry(node.dimensions.x + pillarWidth * 3.0, pillarWidth * 0.9, pillarWidth * 1.4),
    material
  );
  lowerLintel.position.set(0, archHeight, 0);
  group.add(lowerLintel);

  const upperLintel = new THREE.Mesh(
    new THREE.BoxGeometry(node.dimensions.x + pillarWidth * 1.8, pillarWidth * 0.6, pillarWidth * 1.1),
    material
  );
  upperLintel.position.set(0, archHeight + pillarWidth * 0.8, 0);
  group.add(upperLintel);

  // Glowing Checkpoint Gate Frame (audio-reactive signal lattice)
  const gateFrame = new THREE.Mesh(
    new THREE.BoxGeometry(node.dimensions.x * 0.95, archHeight * 0.85, 0.2),
    gateFrameMaterial
  );
  gateFrame.position.set(0, archHeight * 0.45, 0);
  group.add(gateFrame);

  return { group, gateFrame };
}

/**
 * PLAYHEAD END PLANE / SIGNAL LINE
 * Distinct architectural finish threshold: an ultra-crisp vertical signal plane
 * with embedded ground signal line and twin minimalist brutalist stelae.
 */
function createFinishMonument(
  node: RouteNode,
  material: THREE.Material,
  beaconMaterials: {
    plane: THREE.MeshStandardMaterial;
    trim: THREE.MeshStandardMaterial;
    header: THREE.MeshStandardMaterial;
  },
  registerBeacon: (mesh: THREE.Mesh, channel: ReactiveChannel) => void
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(node.position.x, node.position.y, node.position.z);
  group.rotation.set(node.pitch, node.yaw, node.roll, 'YXZ');

  const planeHeight = FINISH_GATE_HEIGHT;
  const halfWidth = node.dimensions.x * 0.5;
  const pylonWidth = 1.8;

  // 1. Twin Minimalist Brutalist Stelae Framing the Signal Line with Descending Monolith Foundation
  for (const side of [-1, 1]) {
    const px = side * (halfWidth + pylonWidth * 0.6);
    const pylonGeom = new THREE.BoxGeometry(pylonWidth, planeHeight * 1.2, pylonWidth * 1.6);
    const pylon = new THREE.Mesh(pylonGeom, material);
    pylon.position.set(px, planeHeight * 0.6, 0);
    group.add(pylon);

    // Glowing vertical edge indicator (secondary reactive trim)
    const edgeGeom = new THREE.BoxGeometry(0.2, planeHeight * 1.15, 0.2);
    const edge = new THREE.Mesh(edgeGeom, beaconMaterials.trim);
    edge.position.set(px - side * (pylonWidth * 0.45), planeHeight * 0.6, pylonWidth * 0.7);
    group.add(edge);
    registerBeacon(edge, 'ACCENT_TRIM');

    // Descending Foundation Pylon Leg extending 280m into the void
    const pylonLegDepth = 280.0;
    const pylonLegGeom = new THREE.BoxGeometry(pylonWidth * 1.35, pylonLegDepth, pylonWidth * 1.8);
    const pylonLeg = new THREE.Mesh(pylonLegGeom, material);
    pylonLeg.position.set(px, -pylonLegDepth * 0.5, 0);
    group.add(pylonLeg);
  }

  // Transverse Under-Road Foundation Keel
  const keelGeom = new THREE.BoxGeometry(node.dimensions.x + pylonWidth * 3.2, 5.0, pylonWidth * 2.2);
  const keel = new THREE.Mesh(keelGeom, material);
  keel.position.set(0, -3.0, 0);
  group.add(keel);

  // 2. Embedded Ground Signal Line (secondary reactive trim)
  const lineGeom = new THREE.BoxGeometry(node.dimensions.x, 0.08, 0.45);
  const lineMesh = new THREE.Mesh(lineGeom, beaconMaterials.trim);
  lineMesh.position.set(0, node.dimensions.y * 0.5 + 0.05, 0);
  group.add(lineMesh);
  registerBeacon(lineMesh, 'ACCENT_TRIM');

  // 3. Vertical PLAYHEAD Signal Scan Plane (primary reactive portal wall)
  const gateGeom = new THREE.PlaneGeometry(node.dimensions.x, planeHeight);
  const gateMesh = new THREE.Mesh(gateGeom, beaconMaterials.plane);
  gateMesh.position.set(0, planeHeight * 0.5, 0);
  group.add(gateMesh);
  registerBeacon(gateMesh, 'FINISH_PLANE');

  // 4. Floating Header Signal Bar (tertiary reactive detailing)
  const headerGeom = new THREE.BoxGeometry(node.dimensions.x + pylonWidth * 2.0, 0.35, 0.6);
  const headerMesh = new THREE.Mesh(headerGeom, beaconMaterials.header);
  headerMesh.position.set(0, planeHeight, 0);
  group.add(headerMesh);
  registerBeacon(headerMesh, 'HEADER_BAR');

  return group;
}

/**
 * Route Landmark: Places varied monumental architecture
 * (Monoliths, Cantilevers, Cathedral Ribs, and Murals) along the outer perimeter.
 *
 * AUTHORITATIVE PLACEMENT RULE: a landmark is built at its FULL final size and
 * orientation first, then its real world-space bounding box is measured against
 * the corridor. A proxy radius is never trusted, because a rotated or scaled
 * structure's true footprint can be several times larger than the nominal
 * dimension (a 45m cantilever arm rotated across the route produces a ~146m
 * lateral AABB half-extent). Candidates that fail are rejected outright —
 * gameplay is never moved to accommodate decoration.
 */
function createRouteLandmark(
  node: RouteNode,
  side: number,
  index: number,
  basaltMaterial: THREE.Material,
  muralMaterial: THREE.Material,
  corridor: RouteExclusionCorridor
): THREE.Group | null {
  const type = index % 4;

  const baseDist = 92.0 + ((index * 13) % 30);
  const fwdX = Math.sin(node.yaw);
  const fwdZ = Math.cos(node.yaw);
  const rightDir = new THREE.Vector3(fwdZ * side, 0, -fwdX * side);
  const origin = new THREE.Vector3(node.position.x, node.position.y - 10.0, node.position.z);

  // Arrive at a candidate position using the configured lateral offset.
  const candidate = new THREE.Vector3(
    origin.x + rightDir.x * baseDist,
    origin.y,
    origin.z + rightDir.z * baseDist
  );

  const group = new THREE.Group();
  group.position.copy(candidate);
  group.rotation.y = node.yaw + (side > 0 ? 0.2 : -0.2);

  if (type === 0) {
    // Colossal Monolith with Central Light Slot
    const monolith = BrutalistShapeLibrary.createMonolith(18.0, 95.0, 18.0, basaltMaterial);
    group.add(monolith);

    // Architectural Mural attached to front face
    const mural = new THREE.Mesh(new THREE.PlaneGeometry(16.0, 16.0), muralMaterial);
    mural.position.set(0, 45.0, 9.2);
    group.add(mural);
  } else if (type === 1) {
    // Massive Cantilever Overhang.
    // The 45m overhanging arm is oriented PARALLEL to the route so it sweeps
    // along the corridor rather than across it — an arm aimed at the route
    // would reach the flight path from any lateral distance.
    const cantilever = BrutalistShapeLibrary.createCantilever(34.0, 16.0, 10.0, basaltMaterial);
    cantilever.rotation.y = Math.PI * 0.5;
    group.add(cantilever);
  } else if (type === 2) {
    // Cathedral Arch Rib
    const rib = BrutalistShapeLibrary.createCathedralRib(48.0, 55.0, 8.0, 3.5, basaltMaterial);
    group.add(rib);
  } else {
    // Fractured Broken Slab
    const broken = BrutalistShapeLibrary.createBrokenSlab(28.0, 35.0, 20.0, basaltMaterial);
    group.add(broken);
  }

  // Deep descending void foundation trunk (grounded 340m-600m into the abyss)
  const trunkDepth = 340.0 + ((index * 43) % 260.0);
  const trunkGeom = new THREE.BoxGeometry(20.0, trunkDepth, 20.0);
  const trunkMesh = new THREE.Mesh(trunkGeom, basaltMaterial);
  trunkMesh.position.set(0, -trunkDepth * 0.5, 0);
  group.add(trunkMesh);

  // AUTHORITATIVE CHECK on the real final geometry.
  group.updateWorldMatrix(true, true);
  const finalBox = new THREE.Box3().setFromObject(group);
  if (corridor.evaluateVolume(finalBox, 28.0)) {
    return null; // REJECT — decoration must never occupy gameplay airspace
  }

  return group;
}

/**
 * Surf Flank: Non-colliding towering canyon walls framing safe surf routes.
 * Grounded deep into the void and verified against the RouteExclusionCorridor.
 */
function createSurfFlank(
  node: RouteNode,
  material: THREE.Material,
  corridor: RouteExclusionCorridor
): THREE.Group | null {
  const side = (node.yaw > 0 ? 1 : -1);
  const baseDist = 72.0; // Pushed outward for safe lateral surf clearance
  const radius = 32.0;
  const minY = -200.0;
  const maxY = 50.0;

  const fwdX = Math.sin(node.yaw);
  const fwdZ = Math.cos(node.yaw);
  const rightDir = new THREE.Vector3(fwdZ * side, 0, -fwdX * side);
  const origin = new THREE.Vector3(node.position.x, node.position.y - 5.0, node.position.z);

  const safePos = corridor.findSafeOffsetPosition(
    origin,
    rightDir,
    baseDist,
    radius,
    minY,
    maxY,
    8,
    18.0
  );

  if (!safePos) return null;

  const group = new THREE.Group();
  group.position.copy(safePos);
  group.rotation.set(node.pitch, node.yaw, node.roll, 'YXZ');

  const canyonWall = BrutalistShapeLibrary.createSurfCanyonWall(50.0, 40.0, 6.0, 0.25, material);
  group.add(canyonWall);

  // Plunging void foundation for canyon wall (grounded 320m into the abyss)
  const flankDepth = 320.0;
  const flankLeg = new THREE.Mesh(new THREE.BoxGeometry(48.0, flankDepth, 6.0), material);
  flankLeg.position.set(0, -flankDepth * 0.5, 0);
  group.add(flankLeg);

  // Authoritative validation on final transformed geometry
  group.updateWorldMatrix(true, true);
  const finalBox = new THREE.Box3().setFromObject(group);
  if (corridor.evaluateVolume(finalBox, 32.0)) {
    return null; // Reject if canyon wall encroaches on surf airspace
  }

  return group;
}
