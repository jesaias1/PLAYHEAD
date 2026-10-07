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
import { buildRibbonSurfaceMesh } from '../generation/SurfRibbon';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchEmbeddedSignal } from './EmbeddedSignal';
import { VisualAccent } from '../audio/AudioFeatures';
import { OfficialWorldProfile, FALLBACK_WORLD_PROFILE } from './SignalWorldProfile';
import { TrackPalette } from '../audio/TrackPalettes';
import { PixelTextureGenerator } from './PixelTextureGenerator';
import { BrutalistShapeLibrary } from './BrutalistShapeLibrary';
import { PixelArtLibrary } from './PixelArtLibrary';
import { RouteExclusionCorridor } from './RouteExclusionCorridor';
import { tagWorldRole } from './WorldRoles';
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
  /**
   * The shared SURF platform material (one instance for every surf deck). SURF
   * presentation may breathe its emissive from the shared music bus; it is never
   * a per-node material and never a profile beacon.
   */
  surfMaterial: THREE.MeshStandardMaterial;
  dispose: () => void;
}

export class GeometryBuilder {
  public static buildWorld(
    track: GeneratedTrack,
    paletteOrAccent: TrackPalette | VisualAccent,
    worldProfile: OfficialWorldProfile = FALLBACK_WORLD_PROFILE
  ): BuiltWorldAssets {
    const rootGroup = new THREE.Group();
    const decorativeGroup = new THREE.Group();
    decorativeGroup.name = 'BuiltWorldDecorativeGroup';
    // Environment architecture: must never intersect the gameplay envelope.
    tagWorldRole(decorativeGroup, 'DECORATION', 'GeometryBuilder.Decorative');
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

    // Authoritative Route Exclusion Corridor (including optional skill lines,
    // recovery shelves, signal spines and obstacle solids).
    const gameplayNodes = RouteExclusionCorridor.collectGameplayNodes(track);
    const corridor = new RouteExclusionCorridor(gameplayNodes);

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

    // --- OFFICIAL WORLD PROFILE ROUTE MATERIAL FAMILY -----------------------
    // Readability is preserved for every family: landing decks stay legible,
    // platform edges stay clear and the surf face stays brighter than the
    // backside. Identity for Signal Drift / fallback (usesOverride=false).
    const routeMat = worldProfile.usesOverride ? worldProfile.material : null;
    const rm = ((): {
      platformColor: number; platformRough: number; platformMetal: number;
      surfColor: number; surfRough: number; surfMetal: number; surfEmissive: number;
      edgeTone: number;
    } => {
      switch (routeMat?.route) {
        case 'FRACTURED_SLAB':
          return { platformColor: 0x0e141f, platformRough: 0.78, platformMetal: 0.12, surfColor: 0x141c2b, surfRough: 0.30, surfMetal: 0.55, surfEmissive: 0.30, edgeTone: 0.9 };
        case 'POLISHED_SIGNAL_STONE':
          return { platformColor: 0x121a24, platformRough: 0.4, platformMetal: 0.34, surfColor: 0x1a2634, surfRough: 0.14, surfMetal: 0.7, surfEmissive: 0.34, edgeTone: 1.15 };
        case 'INDUSTRIAL_PLATE':
          return { platformColor: 0x121315, platformRough: 0.62, platformMetal: 0.58, surfColor: 0x17191c, surfRough: 0.32, surfMetal: 0.82, surfEmissive: 0.24, edgeTone: 1.0 };
        case 'COLD_GLASS':
          return { platformColor: 0x0c1620, platformRough: 0.22, platformMetal: 0.46, surfColor: 0x101d29, surfRough: 0.10, surfMetal: 0.6, surfEmissive: 0.4, edgeTone: 1.2 };
        case 'NEAR_BLACK_CERAMIC':
          return { platformColor: 0x05070a, platformRough: 0.36, platformMetal: 0.2, surfColor: 0x090c11, surfRough: 0.16, surfMetal: 0.48, surfEmissive: 0.36, edgeTone: 0.85 };
        case 'WEATHERED_BRUTALIST':
          return { platformColor: 0x141210, platformRough: 0.86, platformMetal: 0.1, surfColor: 0x191713, surfRough: 0.52, surfMetal: 0.34, surfEmissive: 0.2, edgeTone: 1.05 };
        default:
          return { platformColor: 0x0e141f, platformRough: 0.72, platformMetal: 0.12, surfColor: 0x141c2b, surfRough: 0.22, surfMetal: 0.78, surfEmissive: 0.28, edgeTone: 1.0 };
      }
    })();
    const platformColor = routeMat ? new THREE.Color(rm.platformColor) : surfaceCol;
    const platformRough = routeMat ? rm.platformRough : 0.72;
    const platformMetal = routeMat ? rm.platformMetal : 0.12;
    const surfColor = routeMat ? rm.surfColor : 0x141c2b;
    const surfRough = routeMat ? rm.surfRough : 0.22;
    const surfMetal = routeMat ? rm.surfMetal : 0.78;
    const surfEmissive = routeMat ? rm.surfEmissive : 0.28;
    const platformEdgeTone = routeMat ? rm.edgeTone : 1.0;

    // 1. Route Platform Material (Brutalist Cast Concrete with Pixel Aggregate)
    const platformMaterial = new THREE.MeshStandardMaterial({
      color: platformColor,
      roughness: platformRough,
      metalness: platformMetal,
      emissive: new THREE.Color(0x060910),
      map: concreteTex,
      bumpMap: concreteTex,
      bumpScale: 0.04 * (routeMat ? 1.6 - worldProfile.material.surfaceBreakup : 1.0)
    });

    // 2. Surf Material (Directional Glide Chevrons + Edge Guide Rails)
    const surfMaterial = new THREE.MeshStandardMaterial({
      color: surfColor,
      emissive: primaryCol,
      emissiveIntensity: surfEmissive,
      roughness: surfRough,
      metalness: surfMetal,
      map: surfTex,
      bumpMap: surfTex,
      bumpScale: 0.03
    });
    reactiveMaterials.push(surfMaterial);

    // 1b. ARCHITECTURAL DECK TREATMENT (visual only; collision is untouched).
    // Every platform face knows its size in metres (aFace), so the shader can
    // draw a lit chamfer rim, an inset seam groove carrying a thin signal line,
    // deck joints, and a glowing lip trim just under the top edge of the sides.
    patchPlatformArchitecture(platformMaterial, primaryCol, platformEdgeTone);

    // 1c. Structural underside keels hung beneath each deck.
    const keelMaterial = new THREE.MeshStandardMaterial({
      color: 0x080a10,
      roughness: 0.82,
      metalness: 0.32,
      map: basaltTex
    });
    patchKeel(keelMaterial, primaryCol);
    const keelGeoms: THREE.BufferGeometry[] = [];
    const keelSpaces = gameplayNodes.map((n) => {
      const r = Math.max(n.dimensions.x, n.dimensions.z) * 0.5 + 0.5;
      return {
        id: n.id,
        topY: n.position.y + n.dimensions.y * 0.5,
        box: new THREE.Box3(
          new THREE.Vector3(n.position.x - r, n.position.y - n.dimensions.y * 0.5 - 0.5, n.position.z - r),
          new THREE.Vector3(n.position.x + r, n.position.y + n.dimensions.y * 0.5 + 5.0, n.position.z + r)
        )
      };
    });
    const addKeel = (node: RouteNode): void => {
      const keel = createKeelGeometry(node);
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(node.pitch, node.yaw, node.roll, 'YXZ'));
      m.setPosition(node.position.x, node.position.y, node.position.z);
      keel.applyMatrix4(m);
      keel.computeBoundingBox();
      const kb = keel.boundingBox!;
      const ownTop = node.position.y + node.dimensions.y * 0.5;
      for (const s of keelSpaces) {
        // Only route that sits BELOW this deck can be obstructed by its keel.
        if (s.id === node.id || s.topY >= ownTop - 0.75) continue;
        if (s.box.intersectsBox(kb)) {
          keel.dispose();
          return;
        }
      }
      keelGeoms.push(keel);
    };

    // 3. Audio-Reactive Accent Edge Material
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: 0x05060a,
      emissive: primaryCol,
      emissiveIntensity: 0.55,
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
      emissiveIntensity: 1.3,
      transparent: true,
      opacity: 0.88,
      roughness: 0.15
    });
    reactiveMaterials.push(checkpointMaterial);
    // Arch body = dark portal architecture with its signal in inset grooves
    // and edges. The reactive gate lattice (the beacon) is untouched.
    patchEmbeddedSignal(checkpointMaterial, 0.07);

    // 5. Finish Gate Material
    const finishMaterial = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      emissive: primaryCol,
      emissiveIntensity: 1.7,
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
    const gateFrameMaterial = makeBeaconMaterial(0x05060a, secondaryCol.clone(), 0.50, 0.62);
    gateFrameMaterial.wireframe = true;

    // Finish signal plane: the large glowing portal wall the player runs through.
    const finishPlaneMaterial = makeBeaconMaterial(0x0a0f18, primaryCol.clone(), 0.55, 0.5);
    finishPlaneMaterial.side = THREE.DoubleSide;
    finishPlaneMaterial.blending = THREE.AdditiveBlending;
    finishPlaneMaterial.depthWrite = false;

    // Secondary trim: finish pylon edge indicators + embedded ground signal line.
    const accentTrimMaterial = makeBeaconMaterial(0x05060a, primaryCol.clone(), 0.42);

    // Tertiary detailing: floating header signal bar.
    const headerBarMaterial = makeBeaconMaterial(0x080c14, secondaryCol.clone(), 0.40, 0.8);

    // Gameplay obstacles share a small family of materials so each obstacle
    // type reads differently by SHAPE and edge treatment rather than by being
    // painted a different bright colour. Bodies stay close to PLAYHEAD's dark
    // architecture; signal colour is used as narrow rails / caps / trim.
    const obstacleBodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a0e15,
      emissive: secondaryCol,
      // Dark brutalist mass: signal colour is trim/edge, never a saturated
      // surface. Low metalness avoids the body picking up the cyan ambient.
      emissiveIntensity: 0.05,
      roughness: 0.78,
      metalness: 0.16,
      map: basaltTex
    });
    // Full luminous bar (SCAN BAR).
    const obstacleSignalMaterial = makeBeaconMaterial(0x0a111a, primaryCol.clone(), 0.48, 0.9);

    // SWEEP BEAM: dark machined body with a single luminous signal rail on top,
    // so it reads as a moving mechanical arm rather than a second scan bar.
    const obstacleRailBodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a0d13,
      emissive: secondaryCol,
      emissiveIntensity: 0.04,
      roughness: 0.5,
      metalness: 0.42,
      map: basaltTex
    });
    const obstacleRailTopMaterial = makeBeaconMaterial(0x0d1622, primaryCol.clone(), 0.85, 1.0);

    // PHASE BLOCK / SPLIT GATE: restrained signal cap on an otherwise dark
    // brutalist mass.
    const obstacleCapMaterial = new THREE.MeshStandardMaterial({
      color: 0x0b1017,
      emissive: secondaryCol,
      emissiveIntensity: 0.14,
      roughness: 0.62,
      metalness: 0.2,
      map: basaltTex
    });

    /**
     * Per-family material assignment. BoxGeometry face order is
     * [+X, -X, +Y, -Y, +Z, -Z]. Collision always uses obstacle.dimensions, so
     * the visual box and the collider remain identical.
     */
    const obstacleMaterials = (obstacle: RouteNode): THREE.Material | THREE.Material[] => {
      const isThread =
        obstacle.obstaclePhraseKind === 'LEFT_RIGHT_THREAD' ||
        obstacle.obstaclePhraseKind === 'THREE_WALL_THREAD';
      switch (obstacle.obstacleType) {
        case 'SCAN_BAR':
          return obstacleSignalMaterial;
        case 'SWEEP_BEAM':
          return [
            obstacleRailBodyMaterial,
            obstacleRailBodyMaterial,
            obstacleRailTopMaterial,
            obstacleRailBodyMaterial,
            obstacleRailBodyMaterial,
            obstacleRailBodyMaterial
          ];
        case 'PHASE_BLOCK':
          // Dark solid mass with a lit cap and a lit approach face.
          return [
            obstacleBodyMaterial,
            obstacleBodyMaterial,
            obstacleCapMaterial,
            obstacleBodyMaterial,
            obstacleBodyMaterial,
            obstacleCapMaterial
          ];
        case 'SPLIT_GATE':
          // Wall threads are plain tall dark fins; gates get a lit lintel so
          // they read as a framed portal.
          return isThread
            ? obstacleBodyMaterial
            : [
                obstacleBodyMaterial,
                obstacleBodyMaterial,
                obstacleCapMaterial,
                obstacleBodyMaterial,
                obstacleBodyMaterial,
                obstacleBodyMaterial
              ];
        case 'SIGNAL_SHUTTER':
        default:
          return obstacleBodyMaterial;
      }
    };

    // Static, same-material geometry is baked to world space and merged, so the
    // route costs a handful of draw calls instead of one per platform/pylon.
    const platformGeoms: THREE.BufferGeometry[] = [];
    const surfPlatformGeoms: THREE.BufferGeometry[] = [];
    const ribbonEdgeGroups = new Map<number, {geometries: THREE.BufferGeometry[]; node: RouteNode}>();
    const finishPlatformGeoms: THREE.BufferGeometry[] = [];
    const pylonGeoms: THREE.BufferGeometry[] = [];
    const pylonComponents: Array<{
      name: string;
      source: string;
      hostNodeId?: number;
      box: THREE.Box3;
    }> = [];
    const platformEuler = new THREE.Euler();
    const platformMatrix = new THREE.Matrix4();
    const pylonEuler = new THREE.Euler();
    const pylonMatrix = new THREE.Matrix4();

    // Adds one gameplay platform to the batched static pipeline: its edge trim
    // line plus its baked geometry, classified by material. Shared by the main
    // route and by route-fork mastery branches so a fork costs geometry, never
    // one draw call per platform.
    const addPlatformNode = (node: RouteNode): void => {
      // SURF ribbon nodes render their EXACT sampled top mesh (the same world
      // corners the RibbonSurfaceCollider collides against), not a trapezoid
      // proxy, so the visual face and the ridden face are identical.
      if (node.ribbon && node.isSurf) {
        const ribbonGeom = createRibbonSurfaceGeometry(node);
        if (ribbonGeom) {
          addFaceSizeAttribute(ribbonGeom, node);
          const ribbonEdges = new THREE.EdgesGeometry(ribbonGeom);
          const ribbonId = node.ribbonId ?? node.id;
          const group = ribbonEdgeGroups.get(ribbonId) ?? {geometries: [], node};
          group.geometries.push(ribbonEdges);
          ribbonEdgeGroups.set(ribbonId, group);
          surfPlatformGeoms.push(ribbonGeom);
          return;
        }
      }
      // Rendering and collision consume the same authoritative footprint.
      const geom = createPlatformGeometry(node);
      addFaceSizeAttribute(geom, node);
      if (!node.isSurf && node.type !== RouteNodeType.FINISH) addKeel(node);

      // Edge trim is built from the LOCAL geometry before the platform geometry
      // is baked into world space for batching.
      const edgesGeom = new THREE.EdgesGeometry(geom);
      const lineMat = new THREE.LineBasicMaterial({
        color: node.isSurf ? secondaryCol : primaryCol,
        transparent: true,
        opacity: node.isSurf ? 0.98 : (node.isBoost ? 1.0 : 0.4)
      });
      const edges = new THREE.LineSegments(edgesGeom, lineMat);
      tagWorldRole(edges, 'VISUAL_ONLY', 'GeometryBuilder.RouteEdgeTrim', false);
      edges.position.set(node.position.x, node.position.y, node.position.z);
      edges.rotation.set(node.pitch, node.yaw, node.roll, 'YXZ');
      rootGroup.add(edges);
      edgeLines.push(edges);
      routeEdgeItems.push({
        mesh: edges,
        nodeArcLength: node.arcLength,
        nodeTime: node.time
      });

      // DRAW-CALL FIX: platforms are static and share a material, so they are
      // baked into world space and merged into one mesh per material instead of
      // one mesh (and one draw call) each.
      platformEuler.set(node.pitch, node.yaw, node.roll, 'YXZ');
      platformMatrix.makeRotationFromEuler(platformEuler);
      platformMatrix.setPosition(node.position.x, node.position.y, node.position.z);
      geom.applyMatrix4(platformMatrix);
      if (node.type === RouteNodeType.FINISH) {
        finishPlatformGeoms.push(geom);
      } else if (node.isSurf) {
        surfPlatformGeoms.push(geom);
      } else {
        platformGeoms.push(geom);
      }
    };

    // Build Route Meshes
    for (let i = 0; i < track.route.length; i++) {
      const node = track.route[i];
      addPlatformNode(node);

      // Descending Monolithic Foundation Pillars plunging into the deep void (320m - 540m)
      //
      // ROOT-CAUSE FIX: these used to be added to rootGroup with no validation
      // at all, so a pillar from a high platform could plunge straight through a
      // lower route section. A foundation pillar is attached directly beneath
      // its OWN platform, so the corridor's comfort clearance is the wrong test
      // (its neighbours are only metres away). It is validated instead by
      // DIRECT geometry intersection against every other gameplay node.
      if (!node.isSurf && node.type !== RouteNodeType.FINISH && i % 6 === 0) {
        const pylonHeight = 320.0 + ((i * 31) % 220.0);
        const pylonWidth = Math.min(3.4, node.dimensions.x * 0.45);
        const pylonTopY = node.position.y - node.dimensions.y * 1.5;
        const pylonCenterY = pylonTopY - pylonHeight * 0.5;

        const pylonBox = new THREE.Box3().setFromCenterAndSize(
          new THREE.Vector3(node.position.x, pylonCenterY, node.position.z),
          new THREE.Vector3(pylonWidth, pylonHeight, pylonWidth * 1.2)
        );

        if (!corridor.evaluateVolume(pylonBox, 28.0, node.id)) {
          const pylonGeom = new THREE.BoxGeometry(pylonWidth, pylonHeight, pylonWidth * 1.2);
          pylonEuler.set(0, node.yaw, 0, 'YXZ');
          pylonMatrix.makeRotationFromEuler(pylonEuler);
          pylonMatrix.setPosition(node.position.x, pylonCenterY, node.position.z);
          pylonGeom.applyMatrix4(pylonMatrix);
          pylonGeoms.push(pylonGeom);
          pylonComponents.push({
            name: `FoundationPylon_${node.id}`,
            source: 'GeometryBuilder.FoundationPylon',
            hostNodeId: node.id,
            box: pylonBox.clone()
          });
        }
      }

      // Checkpoint Arch Gateway
      //
      // AUTHORED GAMEPLAY THRESHOLD. The player is meant to pass through this
      // arch, so the framing itself is registered as GAMEPLAY. Its deep
      // foundation legs / collars / transverse strut are NOT something the player
      // interacts with: they were 125m spears hanging off a route node that no
      // validator ever saw. They are removed entirely, which eliminates the whole
      // class of "structure passing vertically through the course".
      if (node.type === RouteNodeType.CHECKPOINT) {
        const { group: arch, gateFrame } = createSteppedCheckpointArch(
          node,
          checkpointMaterial,
          gateFrameMaterial
        );
        tagWorldRole(arch, 'GAMEPLAY', 'GeometryBuilder.CheckpointArch');
        rootGroup.add(arch);
        registerBeacon(gateFrame, 'GATE_FRAME');
      }

      // Finish Portal Monument
      //
      // Same contract: the signal line and its framing are an authored gameplay
      // threshold (GAMEPLAY). The 280m descending pylon legs and the transverse
      // under-road keel are removed.
      if (node.type === RouteNodeType.FINISH) {
        const finishPortal = createFinishMonument(
          node,
          finishMaterial,
          { plane: finishPlaneMaterial, trim: accentTrimMaterial, header: headerBarMaterial },
          registerBeacon
        );
        tagWorldRole(finishPortal, 'GAMEPLAY', 'GeometryBuilder.FinishMonument');
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

    // Route-fork mastery branches render through the SAME batched pipeline
    // (platforms merged per material, edge trim shared with the music pulse), so
    // adding forks does not regress draw calls.
    if (track.forks) {
      for (const fork of track.forks) {
        for (const node of fork.masteryNodes) {
          addPlatformNode(node);
          if (node.isSurf) {
            const canyon = createSurfFlank(node, backgroundMonolithMaterial, corridor);
            if (canyon) decorativeGroup.add(canyon);
          }
        }
      }
    }

    // Merge the batched static route geometry (one draw call per material).
    //
    // Merged batches carry COMPONENT METADATA so a single offending primitive
    // stays traceable (and removable) inside a large batch. Gameplay batches are
    // tagged GAMEPLAY; the decorative foundation-pylon batch is tagged
    // DECORATION and is audited component-by-component by the final world safety
    // pass using the canonical envelope.
    const addBatched = (
      geoms: THREE.BufferGeometry[],
      material: THREE.Material,
      name: string,
      role: 'GAMEPLAY' | 'DECORATION' | 'VISUAL_ONLY' = 'GAMEPLAY',
      components?: Array<{ name: string; source: string; hostNodeId?: number; box: THREE.Box3 }>
    ): void => {
      if (geoms.length === 0) return;
      const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
      if (geoms.length > 1) {
        for (const g of geoms) g.dispose();
      }
      if (!merged) return;
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = name;
      tagWorldRole(mesh, role, `GeometryBuilder.${name}`, false);
      if (components && components.length > 0) {
        mesh.userData.mergedComponents = components;
      }
      rootGroup.add(mesh);
    };
    addBatched(platformGeoms, platformMaterial, 'RoutePlatformsMerged');
    for (const group of ribbonEdgeGroups.values()) {
      const merged = mergeGeometries(group.geometries);
      for (const geometry of group.geometries) geometry.dispose();
      if (!merged) continue;
      // One independently reactive trim per musical ribbon, rather than one
      // material and draw call for every tiny collision sample.
      const material = new THREE.LineBasicMaterial({color:secondaryCol,transparent:true,opacity:0.98});
      const line = new THREE.LineSegments(merged, material);
      line.userData.surfRibbonTrim = true;
      tagWorldRole(line,'VISUAL_ONLY','GeometryBuilder.RouteEdgeTrim',false);
      rootGroup.add(line);
      edgeLines.push(line);
      routeEdgeItems.push({mesh:line,nodeArcLength:group.node.arcLength,nodeTime:group.node.time});
    }
    addBatched(surfPlatformGeoms, surfMaterial, 'RouteSurfPlatformsMerged');
    addBatched(finishPlatformGeoms, finishMaterial, 'RouteFinishMerged');
    addBatched(keelGeoms, keelMaterial, 'RouteKeelsMerged', 'VISUAL_ONLY');
    addBatched(
      pylonGeoms,
      backgroundMonolithMaterial,
      'FoundationPylonsMerged',
      'DECORATION',
      pylonComponents
    );

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
        // Per-family silhouettes: dark brutalist bodies, luminous bars, moving
        // rails. Signal colour is trim, not a full saturated surface.
        const bodyMaterial = obstacleMaterials(obstacle);
        const mesh = new THREE.Mesh(geom, bodyMaterial);
        mesh.name = `RouteObstacle:${obstacle.obstacleType}:${obstacle.id}`;
        mesh.position.set(obstacle.position.x, obstacle.position.y, obstacle.position.z);
        mesh.rotation.set(0, obstacle.yaw, 0, 'YXZ');
        mesh.userData.routeObstacleId = obstacle.id;
        // Obstacles are authoritative gameplay solids (they collide), so they
        // are never candidates for world-safety rejection.
        tagWorldRole(mesh, 'GAMEPLAY', 'GeometryBuilder.RouteObstacle', false);
        rootGroup.add(mesh);
        // Only single-material signal elements can be driven as beacons.
        if (!Array.isArray(mesh.material) && mesh.material === obstacleSignalMaterial) {
          registerBeacon(mesh, 'ACCENT_TRIM');
        }

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
        tagWorldRole(mesh, 'GAMEPLAY', 'GeometryBuilder.RecoveryShelf', false);
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
    //
    // DRAW-CALL FIX: spines used a 6-material array each, which costs SIX draw
    // calls per spine (three.js draws one call per material group). With ~110
    // spines that was ~660 of the frame's ~1100 draw calls — over half the
    // frame for geometry that is a thin top-surface strip. They are now baked
    // into a single merged mesh per material (1-2 draws total) with the exact
    // same transforms and dimensions.
    if (track.signalSpines && track.signalSpines.length > 0) {
      const solidSpineGeoms: THREE.BufferGeometry[] = [];
      const surfSpineGeoms: THREE.BufferGeometry[] = [];
      const solidSpineColors: number[][] = [];
      const surfSpineColors: number[][] = [];
      const spineEuler = new THREE.Euler();
      const spineMatrix = new THREE.Matrix4();

      // VISUAL FRAGMENTATION WITHOUT HOLES.
      //
      // The walkable core of a covered Signal Spine is continuous by hard rule,
      // so the "fragmented signal" read is produced here instead: each covered
      // gap gets a 4-step luminance ladder applied to its segments as vertex
      // colours. Collision is untouched; only the trim alternates.
      const TRIM_LADDER = [1.0, 0.72, 0.5, 0.84];
      let lastGapKey = '';
      let gapIndex = -1;

      for (const spine of track.signalSpines) {
        const geom = new THREE.BoxGeometry(spine.dimensions.x, spine.dimensions.y, spine.dimensions.z);
        spineEuler.set(spine.pitch, spine.yaw, spine.roll, 'YXZ');
        spineMatrix.makeRotationFromEuler(spineEuler);
        spineMatrix.setPosition(spine.position.x, spine.position.y, spine.position.z);
        geom.applyMatrix4(spineMatrix);

        const host = spine.signalSpineHostGap;
        const gapKey = host ? `${host.aId}->${host.bId}` : spine.signalSpineVariant || 'spine';
        if (gapKey !== lastGapKey) {
          lastGapKey = gapKey;
          gapIndex++;
        }
        const trim = TRIM_LADDER[gapIndex % TRIM_LADDER.length];

        const count = geom.attributes.position.count;
        const colors: number[] = [];
        for (let v = 0; v < count; v++) colors.push(trim, trim, trim);

        if (spine.isSurf) {
          surfSpineGeoms.push(geom);
          surfSpineColors.push(colors);
        } else {
          solidSpineGeoms.push(geom);
          solidSpineColors.push(colors);
        }
      }

      const addMergedSpines = (
        geoms: THREE.BufferGeometry[],
        colors: number[][],
        material: THREE.Material,
        name: string
      ): void => {
        if (geoms.length === 0) return;
        const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
        if (geoms.length > 1) {
          for (const g of geoms) g.dispose();
        }
        if (!merged) return;

        // Attach the alternating trim as a vertex colour attribute. The merged
        // attribute order matches the input order, so each colour block lines up
        // with the segment it belongs to.
        const total = merged.attributes.position.count;
        const packed = new Float32Array(total * 3);
        let cursor = 0;
        for (let i = 0; i < colors.length; i++) {
          const block = colors[i];
          packed.set(block, cursor);
          cursor += block.length;
        }
        merged.setAttribute('color', new THREE.BufferAttribute(packed, 3));

        const trimMaterial = (material as THREE.MeshStandardMaterial).clone();
        trimMaterial.vertexColors = true;

        const mesh = new THREE.Mesh(merged, trimMaterial);
        mesh.name = name;
        tagWorldRole(mesh, 'GAMEPLAY', 'GeometryBuilder.SignalSpinesMerged', false);
        rootGroup.add(mesh);
      };

      addMergedSpines(solidSpineGeoms, solidSpineColors, spineTopMaterial, 'SignalSpinesMerged');
      addMergedSpines(surfSpineGeoms, surfSpineColors, surfMaterial, 'SignalSpinesSurfMerged');
    }

    // Build Optional Side-Surf Skill Ramps
    if (track.optionalRamps) {
      for (const ramp of track.optionalRamps) {
        const geom = new THREE.BoxGeometry(ramp.dimensions.x, ramp.dimensions.y, ramp.dimensions.z);
        // Single material (was a 6-material array = 6 draw calls per ramp).
        const mesh = new THREE.Mesh(geom, surfMaterial);
        mesh.position.set(ramp.position.x, ramp.position.y, ramp.position.z);
        mesh.rotation.set(ramp.pitch, ramp.yaw, ramp.roll, 'YXZ');
        tagWorldRole(mesh, 'GAMEPLAY', 'GeometryBuilder.OptionalSideSurf', false);
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
      surfMaterial,
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

  // NO DESCENDING FOUNDATION.
  //
  // This arch previously hung a 125m support leg, a 4m foundation collar and a
  // transverse under-road beam off every checkpoint node. Because the arch is
  // built directly onto the route node and was never passed to any decoration
  // validator, those parts could pass vertically through the course (and through
  // lower route layers on folding routes). The framing is what the player reads;
  // the foundations were pure hazard, so they are gone.
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
  }

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

  // 1. Twin Minimalist Brutalist Stelae Framing the Signal Line.
  //
  // NO DESCENDING FOUNDATION: the previous 280m pylon legs and the transverse
  // under-road keel were unvalidated structure hanging off a route node — the
  // exact "building passing vertically through the course" failure class. The
  // framing the player reads (stelae, signal line, portal plane, header) stays.
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
  }

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

// ===========================================================================
// ROUTE ARCHITECTURE — visual-only deck treatment + underside keels.
// None of this touches collision: PhysicsWorld builds colliders from nodes.
// ===========================================================================

/**
 * Per-vertex face size in metres (x = u extent, y = v extent) and face kind
 * (z: 0 = top, 1 = side, 2 = bottom). BoxGeometry face order is
 * [+X, -X, +Y, -Y, +Z, -Z] with 4 vertices each.
 */
function addFaceSizeAttribute(geom: THREE.BufferGeometry, node: RouteNode): void {
  if (geom.hasAttribute('aFace')) return;
  const pos = geom.getAttribute('position');
  const data = new Float32Array(pos.count * 3);
  const w = node.dimensions.x;
  const h = node.dimensions.y;
  const d = node.dimensions.z;
  const faces: Array<[number, number, number]> = [
    [d, h, 1],
    [d, h, 1],
    [w, d, 0],
    [w, d, 2],
    [w, h, 1],
    [w, h, 1]
  ];
  const normals = geom.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) {
    let f: [number, number, number];
    if (pos.count === 24) {
      f = faces[Math.floor(i / 4)];
    } else {
      const ny = normals ? normals.getY(i) : 0;
      f = ny > 0.5 ? faces[2] : ny < -0.5 ? faces[3] : faces[4];
    }
    data[i * 3] = f[0];
    data[i * 3 + 1] = f[1];
    data[i * 3 + 2] = f[2];
  }
  geom.setAttribute('aFace', new THREE.BufferAttribute(data, 3));
}

function patchPlatformArchitecture(material: THREE.MeshStandardMaterial, accent: THREE.Color, edgeTone = 1.0): void {
  const seamColor = { value: accent.clone() };
  const edgeToneUniform = { value: edgeTone };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSeamColor = seamColor;
    shader.uniforms.uEdgeTone = edgeToneUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 aFace;\nvarying vec3 vFace;\nvarying vec2 vPlatUv;'
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFace = aFace;\n  vPlatUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uSeamColor;
uniform float uEdgeTone;
varying vec3 vFace;
varying vec2 vPlatUv;
float archGlow = 0.0;
float archTop = 0.0;`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  vec2 meters = vPlatUv * vFace.xy;
  vec2 ed = min(meters, vFace.xy - meters);
  float edgeD = min(ed.x, ed.y);
  if (vFace.z < 0.5) {
    // TOP DECK: lit chamfer, inset groove with a signal line, deck joints.
    float rim = 1.0 - smoothstep(0.18, 0.3, edgeD);
    float groove = smoothstep(0.85, 0.9, edgeD) * (1.0 - smoothstep(1.15, 1.2, edgeD));
    float jointDist = abs(fract(meters.y / 5.0 + 0.5) - 0.5) * 5.0;
    float joint = (1.0 - smoothstep(0.06, 0.12, jointDist)) * step(1.2, edgeD);
    // Inner field is a touch lighter than the border band: reads as an inset slab.
    float field = step(1.2, edgeD);
    diffuseColor.rgb *= (1.0 - groove * 0.7 - joint * 0.4) * mix(0.8, 1.15, field);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 2.4 + vec3(0.06), rim * 0.7);
    float line = smoothstep(0.96, 0.99, edgeD) * (1.0 - smoothstep(1.06, 1.09, edgeD));

    // Pixel-block wear: restrained aggregate breakup, strongest near edges and
    // fading out toward the centre of the deck so landings stay clean.
    vec2 wearCell = floor(meters * 1.5);
    float wearN = fract(sin(dot(wearCell, vec2(12.9898, 78.233))) * 43758.5453);
    float wearMask = 1.0 - smoothstep(1.2, 3.5, edgeD);
    diffuseColor.rgb *= 1.0 - step(0.86, wearN) * 0.22 * wearMask;

    // Stencilled corner brackets at the inset corners.
    float bracket =
      (step(1.36, ed.x) * step(ed.x, 1.5) * step(1.36, ed.y) * step(ed.y, 2.4)) +
      (step(1.36, ed.y) * step(ed.y, 1.5) * step(1.36, ed.x) * step(ed.x, 2.4));
    bracket = min(bracket, 1.0) * step(4.0, min(vFace.x, vFace.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.8 + vec3(0.03), bracket * 0.6);

    archGlow = (line * 0.7 + rim * 0.06 + bracket * 0.35) * uEdgeTone;
    archTop = 1.0;
  } else if (vFace.z < 1.5) {
    // SIDES: dark mass, a glowing lip trim just under the deck edge, and a
    // darkening toward the underside so the deck floats.
    float topDist = (1.0 - vPlatUv.y) * vFace.y;
    float lip = smoothstep(0.1, 0.14, topDist) * (1.0 - smoothstep(0.3, 0.34, topDist));
    diffuseColor.rgb *= 0.5 * mix(1.0, 0.55, vPlatUv.y < 0.5 ? 1.0 - vPlatUv.y * 2.0 : 0.0);
    archGlow = lip * 1.1;
  } else {
    diffuseColor.rgb *= 0.3;
  }
}`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  totalEmissiveRadiance += uSeamColor * archGlow;
  {
    // Grazing sky sheen on deck tops: far platforms catch the atmosphere, so
    // surfaces stay readable at speed without lifting the whole scene.
    float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
    totalEmissiveRadiance += (vec3(0.05, 0.07, 0.11) + uSeamColor * 0.02) * fres * archTop * 1.4;
  }`
      );
  };
  material.needsUpdate = true;
}

/**
 * Tapered structural keel beneath a deck: full inset footprint at the top,
 * narrowing toward the bottom. aKeel = 0 at the deck, 1 at the keel tip.
 */
function createKeelGeometry(node: RouteNode): THREE.BufferGeometry {
  const w = node.dimensions.x;
  const d = node.dimensions.z;
  const depth = THREE.MathUtils.clamp(Math.max(w, d) * 0.28, 2.2, 9.0);
  const g = new THREE.BoxGeometry(1, 1, 1);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const keelV = new Float32Array(pos.count);
  const topY = -node.dimensions.y * 0.5 + 0.02;
  for (let i = 0; i < pos.count; i++) {
    const isTop = pos.getY(i) > 0;
    const sx = isTop ? w * 0.92 : w * 0.42;
    const sz = isTop ? d * 0.92 : d * 0.55;
    pos.setXYZ(i, pos.getX(i) * sx, isTop ? topY : topY - depth, pos.getZ(i) * sz);
    keelV[i] = isTop ? 0 : 1;
  }
  pos.needsUpdate = true;
  g.setAttribute('aKeel', new THREE.BufferAttribute(keelV, 1));
  g.computeVertexNormals();
  return g;
}

function patchKeel(material: THREE.MeshStandardMaterial, accent: THREE.Color): void {
  const seamColor = { value: accent.clone() };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uKeelSeam = seamColor;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aKeel;\nvarying float vKeel;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vKeel = aKeel;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uKeelSeam;\nvarying float vKeel;')
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n  diffuseColor.rgb *= mix(1.0, 0.35, vKeel);'
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  {
    // Signal seam where keel meets deck, and a faint strata band lower down.
    float seam = 1.0 - smoothstep(0.02, 0.06, vKeel);
    float strata = smoothstep(0.52, 0.55, vKeel) * (1.0 - smoothstep(0.57, 0.6, vKeel));
    totalEmissiveRadiance += uKeelSeam * (seam * 0.35 + strata * 0.18);
  }`
      );
  };
  material.needsUpdate = true;
}



/**
 * Builds the visual geometry for a SURF ribbon segment DIRECTLY from its
 * stored, world-space sampled corners. Collision (RibbonSurfaceCollider) reads
 * the identical corners, so the rendered surface and the ridden surface can
 * never diverge. Returns null if the node carries no ribbon samples.
 */
function createRibbonSurfaceGeometry(node: RouteNode): THREE.BufferGeometry | null {
  // The visual mesh and the RibbonSurfaceCollider consume the SAME shared
  // triangulation of the SAME four sampled corners, so the surface drawn and
  // the surface ridden are identical by construction. The mesh is INDEXED with
  // 36 correct outward-facing triangle indices (two per quad): without them
  // WebGL would draw triangles straight across the face boundaries.
  const mesh = buildRibbonSurfaceMesh(node);
  if (!mesh) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(mesh.indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(mesh.uvs, 2));
  const faceData = mesh.faceRoles.flatMap(role => role === 0 || role === 2
    ? [node.dimensions.x,node.dimensions.z,role] : [node.dimensions.z,node.dimensions.y,role]);
  geometry.setAttribute('aFace', new THREE.Float32BufferAttribute(faceData, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
