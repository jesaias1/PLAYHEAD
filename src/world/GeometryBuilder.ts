/**
 * Procedural Geometry Builder for Monumental Audio Brutalism
 * Constructs Three.js meshes, materials, and accent elements for the course
 */

import * as THREE from 'three';
import { GeneratedTrack, RouteNode, RouteNodeType } from '../generation/GenerationTypes';
import { VisualAccent } from '../audio/AudioFeatures';
import { TrackPalette } from '../audio/TrackPalettes';

export interface RouteEdgeItem {
  mesh: THREE.LineSegments;
  nodeArcLength: number;
  nodeTime: number;
}

export interface BuiltWorldAssets {
  rootGroup: THREE.Group;
  reactiveMaterials: THREE.MeshStandardMaterial[];
  edgeLines: THREE.LineSegments[];
  routeEdgeItems: RouteEdgeItem[];
  dispose: () => void;
}

export class GeometryBuilder {
  public static buildWorld(
    track: GeneratedTrack,
    paletteOrAccent: TrackPalette | VisualAccent
  ): BuiltWorldAssets {
    const rootGroup = new THREE.Group();
    const reactiveMaterials: THREE.MeshStandardMaterial[] = [];
    const edgeLines: THREE.LineSegments[] = [];
    const routeEdgeItems: RouteEdgeItem[] = [];

    // Shared Materials
    const isPalette = 'primary' in paletteOrAccent;
    const accentColor = isPalette
      ? paletteOrAccent.primary
      : new THREE.Color(paletteOrAccent.hex);
    const surfaceColor = isPalette
      ? paletteOrAccent.surface
      : new THREE.Color(0x1a202c);
    const voidColor = isPalette
      ? paletteOrAccent.void
      : new THREE.Color(0x090a0d);

    // 1. Route Platform Material (Dark matte brutalist concrete with clear value contrast)
    const platformMaterial = new THREE.MeshStandardMaterial({
      color: surfaceColor,
      roughness: 0.85,
      metalness: 0.15
    });

    // 2. Surf Material (Polished dark metallic slate with audio-reactive flow)
    const surfMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a222d,
      emissive: isPalette ? paletteOrAccent.primary : new THREE.Color(0x00f0ff),
      emissiveIntensity: 0.12,
      roughness: 0.35,
      metalness: 0.65
    });
    reactiveMaterials.push(surfMaterial);

    // 3. Audio-Reactive Accent Edge Material
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: 0x050608,
      emissive: accentColor,
      emissiveIntensity: 0.5,
      roughness: 0.4,
      metalness: 0.7
    });
    reactiveMaterials.push(accentMaterial);

    // 4. Checkpoint Emissive Material
    const checkpointMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a0c10,
      emissive: accentColor,
      emissiveIntensity: 1.4,
      transparent: true,
      opacity: 0.75,
      roughness: 0.2
    });
    reactiveMaterials.push(checkpointMaterial);

    // 5. Finish Gate Material (Bright pristine monument)
    const finishMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: accentColor,
      emissiveIntensity: 1.8,
      roughness: 0.1,
      metalness: 0.9
    });
    reactiveMaterials.push(finishMaterial);

    // 6. Background Monument Material (Ultra-dark towering monolithic slabs)
    const backgroundMonolithMaterial = new THREE.MeshStandardMaterial({
      color: voidColor,
      roughness: 0.95,
      metalness: 0.1
    });

    // Build Route Meshes
    for (let i = 0; i < track.route.length; i++) {
      const node = track.route[i];

      // Platform Mesh
      const geom = new THREE.BoxGeometry(node.dimensions.x, node.dimensions.y, node.dimensions.z);
      const mat = node.isSurf ? surfMaterial : (node.type === RouteNodeType.FINISH ? finishMaterial : platformMaterial);
      const mesh = new THREE.Mesh(geom, mat);

      mesh.position.set(node.position.x, node.position.y, node.position.z);
      mesh.rotation.set(node.pitch, node.yaw, node.roll, 'YXZ');
      rootGroup.add(mesh);

      // Add Emissive Edge Trim on lateral sides
      const edgesGeom = new THREE.EdgesGeometry(geom);
      const lineMat = new THREE.LineBasicMaterial({
        color: node.isSurf
          ? (isPalette ? paletteOrAccent.secondary : accentColor)
          : accentColor,
        transparent: true,
        opacity: node.isSurf ? 0.95 : (node.isBoost ? 1.0 : 0.85)
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
        const arch = createCheckpointArch(node, checkpointMaterial);
        rootGroup.add(arch);
      }

      // Finish Portal Monument
      if (node.type === RouteNodeType.FINISH) {
        const finishPortal = createFinishPortal(node, finishMaterial, accentColor);
        rootGroup.add(finishPortal);
      }

      // Procedural Background Brutalist Pylons (Every 4-5 nodes)
      if (i % 4 === 0 && node.type !== RouteNodeType.FINISH) {
        const pylon = createBrutalistPylon(node, backgroundMonolithMaterial);
        rootGroup.add(pylon);
      }
    }

    const dispose = () => {
      // Traverse and dispose geometries/materials
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

    return { rootGroup, reactiveMaterials, edgeLines, routeEdgeItems, dispose };
  }
}

/**
 * Creates an elegant brutalist arch marking a checkpoint
 */
function createCheckpointArch(node: RouteNode, material: THREE.Material): THREE.Group {
  const archGroup = new THREE.Group();
  archGroup.position.set(node.position.x, node.position.y, node.position.z);
  archGroup.rotation.set(node.pitch, node.yaw, node.roll, 'YXZ');

  const archHeight = 8.0;
  const pillarWidth = 1.0;
  const halfWidth = node.dimensions.x * 0.5;

  // Left Pillar
  const pLeft = new THREE.Mesh(new THREE.BoxGeometry(pillarWidth, archHeight, pillarWidth), material);
  pLeft.position.set(-halfWidth + pillarWidth * 0.5, archHeight * 0.5, 0);
  archGroup.add(pLeft);

  // Right Pillar
  const pRight = new THREE.Mesh(new THREE.BoxGeometry(pillarWidth, archHeight, pillarWidth), material);
  pRight.position.set(halfWidth - pillarWidth * 0.5, archHeight * 0.5, 0);
  archGroup.add(pRight);

  // Top Beam
  const beam = new THREE.Mesh(new THREE.BoxGeometry(node.dimensions.x, pillarWidth, pillarWidth), material);
  beam.position.set(0, archHeight, 0);
  archGroup.add(beam);

  return archGroup;
}

/**
 * Monumental final portal structure
 */
function createFinishPortal(node: RouteNode, material: THREE.Material, accentColor: THREE.Color): THREE.Group {
  const portalGroup = new THREE.Group();
  portalGroup.position.set(node.position.x, node.position.y, node.position.z);
  portalGroup.rotation.set(node.pitch, node.yaw, node.roll, 'YXZ');

  const portalHeight = 24.0;
  const pillarWidth = 3.5;
  const halfWidth = node.dimensions.x * 0.5;

  // Colossal Twin Monoliths
  const pLeft = new THREE.Mesh(new THREE.BoxGeometry(pillarWidth, portalHeight, pillarWidth * 2), material);
  pLeft.position.set(-halfWidth - pillarWidth * 0.5, portalHeight * 0.5, 0);
  portalGroup.add(pLeft);

  const pRight = new THREE.Mesh(new THREE.BoxGeometry(pillarWidth, portalHeight, pillarWidth * 2), material);
  pRight.position.set(halfWidth + pillarWidth * 0.5, portalHeight * 0.5, 0);
  portalGroup.add(pRight);

  // Overhead Monolithic Lintel
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(node.dimensions.x + pillarWidth * 3, pillarWidth * 1.5, pillarWidth * 2), material);
  lintel.position.set(0, portalHeight + pillarWidth * 0.75, 0);
  portalGroup.add(lintel);

  // Glowing Finish Energy Gateway (Center plane)
  const gateGeom = new THREE.PlaneGeometry(node.dimensions.x, portalHeight);
  const gateMat = new THREE.MeshBasicMaterial({
    color: accentColor,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide
  });
  const gateMesh = new THREE.Mesh(gateGeom, gateMat);
  gateMesh.position.set(0, portalHeight * 0.5, 0);
  portalGroup.add(gateMesh);

  return portalGroup;
}

/**
 * Distant massive brutalist pylon framing the negative space
 */
function createBrutalistPylon(node: RouteNode, material: THREE.Material): THREE.Group {
  const pylonGroup = new THREE.Group();
  const side = ((node.id % 2) === 0 ? 1 : -1);
  const dist = 65.0 + (node.id % 5) * 12.0;

  const px = node.position.x + Math.cos(node.yaw) * side * dist;
  const pz = node.position.z - Math.sin(node.yaw) * side * dist;
  const py = node.position.y - 20.0;

  pylonGroup.position.set(px, py, pz);
  pylonGroup.rotation.y = node.yaw + (side > 0 ? 0.3 : -0.3);

  const height = 80.0 + (node.id % 4) * 20.0;
  const width = 8.0 + (node.id % 3) * 4.0;
  const depth = 12.0;

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.y = height * 0.5;
  pylonGroup.add(mesh);

  return pylonGroup;
}
