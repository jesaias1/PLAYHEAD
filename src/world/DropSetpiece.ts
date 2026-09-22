/**
 * Major Drop Setpiece Generator for PLAYHEAD SIGNAL RENDER
 * "Cosmic Pixel Brutalism" drop setpieces:
 * 1. SPLIT_MONOLITH
 * 2. SPECTRAL_CATHEDRAL
 * 3. VOID_BRIDGE
 * 4. SIGNAL_GATE
 * 5. FRACTURE
 */

import * as THREE from 'three';
import { TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack, RouteNode } from '../generation/GenerationTypes';
import { MusicVisualState } from './MusicVisualController';
import { BrutalistShapeLibrary } from './BrutalistShapeLibrary';
import { PixelTextureGenerator } from './PixelTextureGenerator';
import { RouteExclusionCorridor } from './RouteExclusionCorridor';
import { tagWorldRole } from './WorldRoles';

export type DropSetpieceFamily = 'SPLIT_MONOLITH' | 'SPECTRAL_CATHEDRAL' | 'VOID_BRIDGE' | 'SIGNAL_GATE' | 'FRACTURE';

export class DropSetpiece {
  public group: THREE.Group;
  public family: DropSetpieceFamily;
  private dropNode: RouteNode | null = null;
  private materials: THREE.MeshStandardMaterial[] = [];
  private animatedElements: THREE.Object3D[] = [];

  /** Resolved safe base positions, so animation never re-enters the corridor. */
  private monolithBaseX: Map<THREE.Object3D, number> = new Map();
  private fractureBaseX: Map<THREE.Object3D, number> = new Map();
  private fractureBaseY: Map<THREE.Object3D, number> = new Map();

  constructor(scene: THREE.Scene, analysis: TrackAnalysis, track: GeneratedTrack) {
    this.group = new THREE.Group();
    // World role: declared explicitly so the final world safety pass can
    // never mistake this geometry for gameplay (or miss it entirely).
    tagWorldRole(this.group, 'DECORATION', 'DropSetpiece');

    const families: DropSetpieceFamily[] = [
      'SPLIT_MONOLITH',
      'SPECTRAL_CATHEDRAL',
      'VOID_BRIDGE',
      'SIGNAL_GATE',
      'FRACTURE'
    ];
    this.family = families[Math.abs(analysis.seed) % families.length];

    this.build(analysis, track);
    scene.add(this.group);
  }

  private build(analysis: TrackAnalysis, track: GeneratedTrack): void {
    const route = track.route;
    if (route.length < 5) return;

    const dropSection = analysis.sections.find(s => s.theme === 'DROP');
    if (!dropSection) return;

    let bestDist = 999999;
    for (const node of route) {
      const d = Math.abs(node.time - dropSection.start);
      if (d < bestDist) {
        bestDist = d;
        this.dropNode = node;
      }
    }
    if (!this.dropNode) return;

    const accentCol = new THREE.Color(analysis.visualAccent.hex);
    const basaltTex = PixelTextureGenerator.getBlackBasaltTexture();
    const concreteTex = PixelTextureGenerator.getDarkConcreteTexture();

    // Dark Basalt Material
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x05080e,
      roughness: 0.9,
      metalness: 0.15,
      map: basaltTex,
      emissive: accentCol,
      emissiveIntensity: 0.03
    });
    this.materials.push(baseMat);

    // Accent Gate Material
    const gateMat = new THREE.MeshStandardMaterial({
      color: 0x0a101d,
      roughness: 0.3,
      metalness: 0.8,
      map: concreteTex,
      emissive: accentCol,
      emissiveIntensity: 0.08
    });
    this.materials.push(gateMat);

    const center = this.dropNode.position;
    const yaw = this.dropNode.yaw;

    this.group.position.set(center.x, center.y, center.z);
    this.group.rotation.y = yaw;

    // The corridor must include EVERY gameplay node, not just the main route:
    // optional surf ramps, recovery shelves and obstacle solids are legitimate
    // gameplay too.
    const allCorridorNodes = RouteExclusionCorridor.collectGameplayNodes(track);
    const corridor = new RouteExclusionCorridor(allCorridorNodes);

    switch (this.family) {
      case 'SPLIT_MONOLITH':
        this.buildSplitMonolith(baseMat, gateMat, corridor);
        break;
      case 'SPECTRAL_CATHEDRAL':
        this.buildSpectralCathedral(baseMat, gateMat, corridor);
        break;
      case 'VOID_BRIDGE':
        this.buildVoidBridge(baseMat, gateMat, corridor);
        break;
      case 'SIGNAL_GATE':
        this.buildSignalGate(baseMat, gateMat, corridor);
        break;
      case 'FRACTURE':
      default:
        this.buildFracture(baseMat, gateMat, corridor);
        break;
    }
  }

  /**
   * AUTHORITATIVE SAFE PLACEMENT for a setpiece module.
   *
   * A hardcoded lateral offset cannot be trusted, because the local rotation of
   * the setpiece group means a fixed +X offset can point directly across the
   * course, and the drop anchor node is often NOT laterally clear of
   * neighbouring nodes. This measures the module's real world-space bounding
   * box and slides it radially outward (in setpiece-local X) until it genuinely
   * clears the protected gameplay volume — or discards it if no clearance
   * exists within a sane distance.
   *
   * Returns the resolved local x, or null when the module must be rejected.
   */
  private placeModuleSafely(
    module: THREE.Object3D,
    corridor: RouteExclusionCorridor,
    preferredX: number,
    step = 12.0,
    maxSteps = 12,
    extraSurfMargin = 28.0
  ): number | null {
    const originalX = preferredX;

    for (let i = 0; i <= maxSteps; i++) {
      // Alternate outward to whichever side the caller asked for.
      const x = originalX + Math.sign(originalX || 1) * i * step;
      module.position.x = x;
      this.group.updateWorldMatrix(true, true);

      const box = new THREE.Box3().setFromObject(module);
      if (!corridor.evaluateVolume(box, extraSurfMargin)) {
        return x;
      }
    }

    // No safe placement — reject rather than intrude into gameplay.
    this.group.remove(module);
    return null;
  }

  private buildSplitMonolith(baseMat: THREE.Material, _accentMat: THREE.Material, corridor: RouteExclusionCorridor): void {
    // Twin colossal brutalist monoliths flanking the drop threshold.
    // Each is relocated radially outward until its real bounding box is clear.
    const preferred = 66.0;

    for (const side of [-1, 1]) {
      const monolith = BrutalistShapeLibrary.createMonolith(18.0, 95.0, 24.0, baseMat);
      monolith.position.set(side * preferred, 0, -25.0);
      this.group.add(monolith);

      const resolvedX = this.placeModuleSafely(monolith, corridor, side * preferred);
      if (resolvedX === null) continue;

      this.monolithBaseX.set(monolith, resolvedX);
      this.animatedElements.push(monolith);
    }
  }

  private buildSpectralCathedral(baseMat: THREE.Material, accentMat: THREE.Material, corridor: RouteExclusionCorridor): void {
    // Repeating sweeping cathedral arch ribs leading up to the drop.
    //
    // A cathedral rib is a semicircular arch centred on its own origin, so its
    // legs land at ±span/2 on the route's Y level and its centre would sit
    // directly in the playable passage. The ribs are therefore lifted into a
    // high "arch bridge" that clears the protected jump envelope entirely while
    // keeping the monumental cathedral language over the drop.
    const ribCount = 5;
    // Lift the arch bridge clear of the protected jump envelope, sized from the
    // corridor's own definition so the two can never drift apart.
    const archBaseY = RouteExclusionCorridor.JUMP_CORRIDOR_ABOVE + 21.0;

    for (let i = 0; i < ribCount; i++) {
      const zOffset = -45.0 + i * 11.0;
      const width = 42.0 + i * 4.0;
      const height = 34.0 + i * 3.5;

      const rib = BrutalistShapeLibrary.createCathedralRib(
        width,
        height,
        5.0,
        2.5,
        i === ribCount - 1 ? accentMat : baseMat
      );
      rib.position.set(0, archBaseY, zOffset);
      this.group.add(rib);

      // Validate the real arch volume before keeping it.
      this.group.updateWorldMatrix(true, true);
      const ribBox = new THREE.Box3().setFromObject(rib);
      if (corridor.evaluateVolume(ribBox, 28.0)) {
        rib.removeFromParent();
        continue;
      }

      this.animatedElements.push(rib);
    }
  }

  private buildVoidBridge(baseMat: THREE.Material, _accentMat: THREE.Material, corridor: RouteExclusionCorridor): void {
    // Twin cantilever pylons flanking the drop jump. The overhanging arms are
    // rotated to sweep PARALLEL to the flight path so they can never reach
    // across it, then relocated outward until measured clear.
    const preferred = 52.0;

    for (const side of [-1, 1]) {
      const cant = BrutalistShapeLibrary.createCantilever(45.0, 16.0, 12.0, baseMat);
      cant.position.set(side * preferred, 0, 0);
      cant.scale.x = side;
      cant.rotation.y = Math.PI * 0.5;
      this.group.add(cant);

      if (this.placeModuleSafely(cant, corridor, side * preferred) === null) continue;
      this.animatedElements.push(cant);
    }
  }

  private buildSignalGate(baseMat: THREE.Material, accentMat: THREE.Material, corridor: RouteExclusionCorridor): void {
    // Massive brutalist pylon stelae framing the threshold with a wide top
    // lintel. Stelae are relocated outward; the lintel spans the gap overhead
    // and is lifted clear of the protected jump envelope.
    const preferred = 52.0;

    let leftX: number | null = null;
    let rightX: number | null = null;

    const leftPylon = BrutalistShapeLibrary.createPylonStela(12.0, 75.0, 14.0, baseMat);
    leftPylon.position.set(-preferred, 0, 0);
    this.group.add(leftPylon);
    leftX = this.placeModuleSafely(leftPylon, corridor, -preferred);
    if (leftX === null) leftPylon.removeFromParent();

    const rightPylon = BrutalistShapeLibrary.createPylonStela(12.0, 75.0, 14.0, baseMat);
    rightPylon.position.set(preferred, 0, 0);
    this.group.add(rightPylon);
    rightX = this.placeModuleSafely(rightPylon, corridor, preferred);
    if (rightX === null) rightPylon.removeFromParent();

    // Lintel clears the protected envelope vertically (see JUMP_CORRIDOR_ABOVE).
    const lintelHeight = RouteExclusionCorridor.JUMP_CORRIDOR_ABOVE + 24.0;
    const lintelSpan = (Math.max(Math.abs(leftX ?? preferred), Math.abs(rightX ?? preferred)) * 2.2);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(lintelSpan, 8.0, 12.0), accentMat);
    lintel.position.set(0, lintelHeight, 0);
    this.group.add(lintel);

    this.group.updateWorldMatrix(true, true);
    const lintelBox = new THREE.Box3().setFromObject(lintel);
    if (corridor.evaluateVolume(lintelBox, 28.0)) {
      lintel.removeFromParent();
    } else {
      this.animatedElements.push(lintel);
    }
  }

  private buildFracture(baseMat: THREE.Material, _accentMat: THREE.Material, corridor: RouteExclusionCorridor): void {
    // Broken slabs and floating ruins hovering outside the playable path.
    for (let i = 0; i < 6; i++) {
      const side = (i % 2 === 0) ? -1 : 1;
      const broken = BrutalistShapeLibrary.createBrokenSlab(24.0, 16.0, 18.0, baseMat);
      const preferredX = side * (78.0 + i * 7.0);
      broken.position.set(preferredX, 6.0 + i * 2.0, -35.0 + i * 14.0);
      this.group.add(broken);

      const resolvedX = this.placeModuleSafely(broken, corridor, preferredX);
      if (resolvedX === null) continue;

      this.fractureBaseX.set(broken, resolvedX);
      this.fractureBaseY.set(broken, broken.position.y);
      this.animatedElements.push(broken);
    }
  }

  public update(visualState: MusicVisualState): void {
    const reactMult = visualState.reactivityMultiplier;
    const dropPulse = visualState.dropImpact;
    const buildup = visualState.buildup;

    if (this.materials[0]) {
      this.materials[0].emissiveIntensity = (0.03 + buildup * 0.35 + dropPulse * 1.5) * reactMult;
      this.materials[0].emissive.copy(visualState.bassColor);
    }
    if (this.materials[1]) {
      this.materials[1].emissiveIntensity = (0.08 + buildup * 0.75 + dropPulse * 2.8) * reactMult;
      this.materials[1].emissive.copy(visualState.palette.highlight);
    }

    // Dynamic geometric response based on setpiece family.
    // Animation moves elements AROUND their resolved safe base positions, so a
    // musical pulse can never push architecture back into the playable corridor.
    if (this.family === 'SPLIT_MONOLITH') {
      const splitOffset = (buildup * 8.0 + dropPulse * 16.0) * reactMult;
      for (const el of this.animatedElements) {
        const baseX = this.monolithBaseX.get(el);
        if (baseX === undefined) continue;
        // Split outward, away from the route.
        el.position.x = baseX + Math.sign(baseX || 1) * splitOffset;
      }
    } else if (this.family === 'SPECTRAL_CATHEDRAL') {
      for (let i = 0; i < this.animatedElements.length; i++) {
        const arch = this.animatedElements[i];
        const phase = visualState.time * 2.0 + i * 0.6;
        // Upward-only motion keeps the arch clear of the protected envelope.
        arch.position.y = RouteExclusionCorridor.JUMP_CORRIDOR_ABOVE + 21.0 + Math.abs(Math.sin(phase)) * 1.0 + dropPulse * 4.5;
      }
    } else if (this.family === 'FRACTURE') {
      for (let i = 0; i < this.animatedElements.length; i++) {
        const broken = this.animatedElements[i];
        const baseX = this.fractureBaseX.get(broken);
        const baseY = this.fractureBaseY.get(broken);
        if (baseX === undefined || baseY === undefined) continue;
        const side = (i % 2 === 0) ? -1 : 1;
        broken.rotation.y = 0.12 * side + Math.sin(visualState.time * 0.8 + i) * 0.08;
        broken.position.x = baseX;
        broken.position.y = baseY + Math.sin(visualState.time * 1.4 + i * 0.7) * 1.2 + dropPulse * 3.5;
      }
    }
  }

  public dispose(): void {
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
    for (const mat of this.materials) {
      mat.dispose();
    }
    this.materials = [];
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
      }
    });
    this.group.clear();
  }
}
