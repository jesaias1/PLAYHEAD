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

    // 0. Procedural Textures for Brutalist Surface Detail
    const concreteTex = createProceduralConcreteTexture();
    const surfTex = createProceduralSurfTexture();

    // 1. Route Platform Material (Heavy cast brutalist concrete with micro-roughness)
    const platformMaterial = new THREE.MeshStandardMaterial({
      color: surfaceColor,
      roughness: 0.88,
      metalness: 0.12,
      roughnessMap: concreteTex,
      bumpMap: concreteTex,
      bumpScale: 0.035
    });

    // 2. Surf Material (Polished dark metallic slate with directional glide sheen)
    const surfMaterial = new THREE.MeshStandardMaterial({
      color: 0x18202b,
      emissive: isPalette ? paletteOrAccent.primary : new THREE.Color(0x00f0ff),
      emissiveIntensity: 0.14,
      roughness: 0.28,
      metalness: 0.72,
      roughnessMap: surfTex,
      bumpMap: surfTex,
      bumpScale: 0.02
    });
    reactiveMaterials.push(surfMaterial);

    // 3. Audio-Reactive Accent Edge Material
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: 0x050608,
      emissive: accentColor,
      emissiveIntensity: 0.55,
      roughness: 0.35,
      metalness: 0.75
    });
    reactiveMaterials.push(accentMaterial);

    // 4. Checkpoint Emissive Material
    const checkpointMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a0c10,
      emissive: accentColor,
      emissiveIntensity: 1.5,
      transparent: true,
      opacity: 0.82,
      roughness: 0.18
    });
    reactiveMaterials.push(checkpointMaterial);

    // 5. Finish Gate Material (Bright pristine monumental monolith)
    const finishMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: accentColor,
      emissiveIntensity: 1.9,
      roughness: 0.12,
      metalness: 0.88
    });
    reactiveMaterials.push(finishMaterial);

    // 6. Background Monument Material (Ultra-dark towering monolithic slabs)
    const backgroundMonolithMaterial = new THREE.MeshStandardMaterial({
      color: voidColor,
      roughness: 0.94,
      metalness: 0.1,
      roughnessMap: concreteTex,
      bumpMap: concreteTex,
      bumpScale: 0.05
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
 * Features stepped plinth footings and clean architectural proportions
 */
function createCheckpointArch(node: RouteNode, material: THREE.Material): THREE.Group {
  const archGroup = new THREE.Group();
  archGroup.position.set(node.position.x, node.position.y, node.position.z);
  archGroup.rotation.set(node.pitch, node.yaw, node.roll, 'YXZ');

  const archHeight = 8.5;
  const pillarWidth = 1.2;
  const halfWidth = node.dimensions.x * 0.5;

  // Stepped Plinth Footings (Left & Right)
  const plinthGeom = new THREE.BoxGeometry(pillarWidth * 1.6, 0.8, pillarWidth * 1.6);
  const plinthLeft = new THREE.Mesh(plinthGeom, material);
  plinthLeft.position.set(-halfWidth + pillarWidth * 0.5, 0.4, 0);
  archGroup.add(plinthLeft);

  const plinthRight = new THREE.Mesh(plinthGeom, material);
  plinthRight.position.set(halfWidth - pillarWidth * 0.5, 0.4, 0);
  archGroup.add(plinthRight);

  // Left Pillar
  const pLeft = new THREE.Mesh(new THREE.BoxGeometry(pillarWidth, archHeight, pillarWidth), material);
  pLeft.position.set(-halfWidth + pillarWidth * 0.5, archHeight * 0.5, 0);
  archGroup.add(pLeft);

  // Right Pillar
  const pRight = new THREE.Mesh(new THREE.BoxGeometry(pillarWidth, archHeight, pillarWidth), material);
  pRight.position.set(halfWidth - pillarWidth * 0.5, archHeight * 0.5, 0);
  archGroup.add(pRight);

  // Top Beam (Overhanging lintel)
  const beam = new THREE.Mesh(new THREE.BoxGeometry(node.dimensions.x + pillarWidth, pillarWidth * 1.2, pillarWidth * 1.4), material);
  beam.position.set(0, archHeight, 0);
  archGroup.add(beam);

  return archGroup;
}

/**
 * Monumental final portal structure
 * Multi-tiered brutalist monoliths with vertical accent core
 */
function createFinishPortal(node: RouteNode, material: THREE.Material, accentColor: THREE.Color): THREE.Group {
  const portalGroup = new THREE.Group();
  portalGroup.position.set(node.position.x, node.position.y, node.position.z);
  portalGroup.rotation.set(node.pitch, node.yaw, node.roll, 'YXZ');

  const portalHeight = 26.0;
  const pillarWidth = 3.6;
  const halfWidth = node.dimensions.x * 0.5;

  // Colossal Twin Tiered Monoliths
  // Base tier
  const baseLeft = new THREE.Mesh(new THREE.BoxGeometry(pillarWidth * 1.3, portalHeight * 0.4, pillarWidth * 2.4), material);
  baseLeft.position.set(-halfWidth - pillarWidth * 0.6, portalHeight * 0.2, 0);
  portalGroup.add(baseLeft);

  const baseRight = new THREE.Mesh(new THREE.BoxGeometry(pillarWidth * 1.3, portalHeight * 0.4, pillarWidth * 2.4), material);
  baseRight.position.set(halfWidth + pillarWidth * 0.6, portalHeight * 0.2, 0);
  portalGroup.add(baseRight);

  // Main columns
  const pLeft = new THREE.Mesh(new THREE.BoxGeometry(pillarWidth, portalHeight, pillarWidth * 2), material);
  pLeft.position.set(-halfWidth - pillarWidth * 0.5, portalHeight * 0.5, 0);
  portalGroup.add(pLeft);

  const pRight = new THREE.Mesh(new THREE.BoxGeometry(pillarWidth, portalHeight, pillarWidth * 2), material);
  pRight.position.set(halfWidth + pillarWidth * 0.5, portalHeight * 0.5, 0);
  portalGroup.add(pRight);

  // Overhead Monolithic Double Lintel
  const lowerLintel = new THREE.Mesh(new THREE.BoxGeometry(node.dimensions.x + pillarWidth * 3.2, pillarWidth * 1.2, pillarWidth * 2.2), material);
  lowerLintel.position.set(0, portalHeight + pillarWidth * 0.6, 0);
  portalGroup.add(lowerLintel);

  const upperLintel = new THREE.Mesh(new THREE.BoxGeometry(node.dimensions.x + pillarWidth * 1.8, pillarWidth * 0.8, pillarWidth * 1.8), material);
  upperLintel.position.set(0, portalHeight + pillarWidth * 1.6, 0);
  portalGroup.add(upperLintel);

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
 * Stepped monolith with central negative space slot
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

  const height = 85.0 + (node.id % 4) * 25.0;
  const width = 10.0 + (node.id % 3) * 4.0;
  const depth = 14.0;

  // Split monolith with central vertical negative space channel
  const wingWidth = width * 0.42;
  const slitOffset = (width - wingWidth) * 0.5;

  const leftWing = new THREE.Mesh(new THREE.BoxGeometry(wingWidth, height, depth), material);
  leftWing.position.set(-slitOffset, height * 0.5, 0);
  pylonGroup.add(leftWing);

  const rightWing = new THREE.Mesh(new THREE.BoxGeometry(wingWidth, height, depth), material);
  rightWing.position.set(slitOffset, height * 0.5, 0);
  pylonGroup.add(rightWing);

  // Overhead crown cap connecting wings
  const crown = new THREE.Mesh(new THREE.BoxGeometry(width, height * 0.08, depth * 1.1), material);
  crown.position.set(0, height * 0.96, 0);
  pylonGroup.add(crown);

  return pylonGroup;
}

/**
 * Procedural concrete texture generator
 * Generates subtle formwork aggregate noise and fine striations
 */
function createProceduralConcreteTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  try {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);

    const imgData = ctx.getImageData(0, 0, size, size);
    const data = imgData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const grain = (Math.random() - 0.5) * 28;
        const formwork = Math.sin(y * 0.08) * 8 + Math.cos(x * 0.03) * 6;
        const val = Math.max(0, Math.min(255, 128 + grain + formwork));
        data[idx] = val;
        data[idx + 1] = val;
        data[idx + 2] = val;
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    return texture;
  } catch {
    return null;
  }
}

/**
 * Procedural surf texture generator
 * Generates sleek directional micro-grooves and specular highlights
 */
function createProceduralSurfTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  try {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#606060';
    ctx.fillRect(0, 0, size, size);

    const imgData = ctx.getImageData(0, 0, size, size);
    const data = imgData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const groove = Math.sin(x * 0.5) * 25 + (Math.random() - 0.5) * 12;
        const val = Math.max(0, Math.min(255, 96 + groove));
        data[idx] = val;
        data[idx + 1] = val;
        data[idx + 2] = val;
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 8);
    return texture;
  } catch {
    return null;
  }
}
