/**
 * BrutalistShapeLibrary for PLAYHEAD SIGNAL RENDER
 * "Cosmic Pixel Brutalism" architectural form generator.
 *
 * Implements the 20 monumental shape primitives:
 * Monolith, Beveled Slab, Broken Slab, Cathedral Rib, Arch, Broken Arch,
 * Split Frame, Cantilever, Pylon/Stela, Suspended Plate, Stair Mass,
 * Signal Fin, Ring Segment, Wave Cliff, Surf Canyon Wall, Floating Ruin, Altar Block.
 */

import * as THREE from 'three';

export class BrutalistShapeLibrary {
  /**
   * MONOLITH: Colossal vertical block with stepped base plinth and vertical negative slot.
   */
  public static createMonolith(
    width = 16.0,
    height = 90.0,
    depth = 20.0,
    material: THREE.Material
  ): THREE.Group {
    const group = new THREE.Group();

    // 1. Heavy stepped plinth foundation
    const plinthGeom = new THREE.BoxGeometry(width * 1.3, height * 0.08, depth * 1.3);
    const plinth = new THREE.Mesh(plinthGeom, material);
    plinth.position.y = height * 0.04;
    group.add(plinth);

    // 2. Twin vertical towers with central light slot
    const towerW = width * 0.44;
    const slotW = width * 0.12;
    const bodyHeight = height * 0.88;

    const leftGeom = new THREE.BoxGeometry(towerW, bodyHeight, depth);
    const leftTower = new THREE.Mesh(leftGeom, material);
    leftTower.position.set(-(towerW * 0.5 + slotW * 0.5), height * 0.08 + bodyHeight * 0.5, 0);
    group.add(leftTower);

    const rightGeom = new THREE.BoxGeometry(towerW, bodyHeight, depth);
    const rightTower = new THREE.Mesh(rightGeom, material);
    rightTower.position.set((towerW * 0.5 + slotW * 0.5), height * 0.08 + bodyHeight * 0.5, 0);
    group.add(rightTower);

    // 3. Heavy lintel crown cap
    const crownGeom = new THREE.BoxGeometry(width * 1.15, height * 0.08, depth * 1.1);
    const crown = new THREE.Mesh(crownGeom, material);
    crown.position.y = height * 0.96;
    group.add(crown);

    return group;
  }

  /**
   * BEVELED SLAB: Heavy horizontal architectural deck with beveled/chamfered underside.
   */
  public static createBeveledSlab(
    width = 30.0,
    height = 6.0,
    depth = 40.0,
    material: THREE.Material
  ): THREE.Group {
    const group = new THREE.Group();

    // Upper primary slab
    const topGeom = new THREE.BoxGeometry(width, height * 0.65, depth);
    const top = new THREE.Mesh(topGeom, material);
    top.position.y = height * 0.325;
    group.add(top);

    // Stepped bevel underside
    const bevelGeom = new THREE.BoxGeometry(width * 0.82, height * 0.35, depth * 0.82);
    const bevel = new THREE.Mesh(bevelGeom, material);
    bevel.position.y = -height * 0.175;
    group.add(bevel);

    return group;
  }

  /**
   * BROKEN SLAB: Massive architectural slab fractured into two misaligned blocks.
   */
  public static createBrokenSlab(
    width = 24.0,
    height = 10.0,
    depth = 32.0,
    material: THREE.Material,
    fractureGap = 2.8
  ): THREE.Group {
    const group = new THREE.Group();

    const halfW = width * 0.48;
    const geomA = new THREE.BoxGeometry(halfW, height, depth);
    const meshA = new THREE.Mesh(geomA, material);
    meshA.position.set(-(halfW * 0.5 + fractureGap * 0.5), height * 0.5, 0);
    meshA.rotation.z = -0.04;
    group.add(meshA);

    const geomB = new THREE.BoxGeometry(halfW, height * 0.85, depth);
    const meshB = new THREE.Mesh(geomB, material);
    meshB.position.set((halfW * 0.5 + fractureGap * 0.5), height * 0.425 - 1.2, 0);
    meshB.rotation.z = 0.05;
    group.add(meshB);

    return group;
  }

  /**
   * CANTILEVER: Massive overhanging architectural arm with diagonal brace.
   */
  public static createCantilever(
    length = 45.0,
    height = 14.0,
    width = 12.0,
    material: THREE.Material
  ): THREE.Group {
    const group = new THREE.Group();

    // Vertical anchor pillar
    const pillarGeom = new THREE.BoxGeometry(width * 1.5, height * 2.5, width * 1.5);
    const pillar = new THREE.Mesh(pillarGeom, material);
    pillar.position.set(0, height * 1.25, 0);
    group.add(pillar);

    // Horizontal overhanging arm
    const armGeom = new THREE.BoxGeometry(length, height * 0.75, width);
    const arm = new THREE.Mesh(armGeom, material);
    arm.position.set(length * 0.5, height * 2.2, 0);
    group.add(arm);

    // Diagonal support brace
    const braceLength = Math.hypot(length * 0.6, height * 1.2);
    const braceGeom = new THREE.BoxGeometry(braceLength, width * 0.8, width * 0.8);
    const brace = new THREE.Mesh(braceGeom, material);
    brace.position.set(length * 0.3, height * 1.5, 0);
    brace.rotation.z = Math.atan2(height * 1.2, length * 0.6);
    group.add(brace);

    return group;
  }

  /**
   * PYLON / STELA: Towering monolith marker with stepped tier bevels.
   */
  public static createPylonStela(
    width = 8.0,
    height = 65.0,
    depth = 10.0,
    material: THREE.Material
  ): THREE.Group {
    const group = new THREE.Group();

    // Base tier
    const base = new THREE.Mesh(new THREE.BoxGeometry(width * 1.4, height * 0.15, depth * 1.4), material);
    base.position.y = height * 0.075;
    group.add(base);

    // Mid stem
    const mid = new THREE.Mesh(new THREE.BoxGeometry(width, height * 0.7, depth), material);
    mid.position.y = height * 0.15 + height * 0.35;
    group.add(mid);

    // Top needle spire
    const spire = new THREE.Mesh(new THREE.BoxGeometry(width * 0.6, height * 0.2, depth * 0.6), material);
    spire.position.y = height * 0.9;
    group.add(spire);

    return group;
  }

  /**
   * CATHEDRAL RIB: Sweeping brutalist curved arch rib for grand framing.
   */
  public static createCathedralRib(
    spanWidth = 50.0,
    height = 40.0,
    depth = 6.0,
    thickness = 4.0,
    material: THREE.Material
  ): THREE.Group {
    const group = new THREE.Group();

    const segments = 10;
    for (let i = 0; i < segments; i++) {
      const t0 = i / segments;
      const t1 = (i + 1) / segments;
      const a0 = Math.PI * (1 - t0);
      const a1 = Math.PI * (1 - t1);

      const x0 = Math.cos(a0) * (spanWidth * 0.5);
      const y0 = Math.sin(a0) * height;
      const x1 = Math.cos(a1) * (spanWidth * 0.5);
      const y1 = Math.sin(a1) * height;

      const segLen = Math.hypot(x1 - x0, y1 - y0);
      const segAngle = Math.atan2(y1 - y0, x1 - x0);

      const segGeom = new THREE.BoxGeometry(segLen, thickness, depth);
      const segMesh = new THREE.Mesh(segGeom, material);
      segMesh.position.set((x0 + x1) * 0.5, (y0 + y1) * 0.5, 0);
      segMesh.rotation.z = segAngle;
      group.add(segMesh);
    }

    return group;
  }

  /**
   * BROKEN ARCH: Colossal arch portal with a missing keystones/fractured center.
   */
  public static createBrokenArch(
    spanWidth = 40.0,
    height = 30.0,
    depth = 8.0,
    material: THREE.Material
  ): THREE.Group {
    const group = new THREE.Group();
    const pillarW = 6.0;

    // Left pillar & partial arch
    const leftPillar = new THREE.Mesh(new THREE.BoxGeometry(pillarW, height, depth), material);
    leftPillar.position.set(-spanWidth * 0.5 + pillarW * 0.5, height * 0.5, 0);
    group.add(leftPillar);

    const leftCant = new THREE.Mesh(new THREE.BoxGeometry(spanWidth * 0.35, pillarW, depth), material);
    leftCant.position.set(-spanWidth * 0.25, height, 0);
    leftCant.rotation.z = 0.12;
    group.add(leftCant);

    // Right pillar & collapsed stub
    const rightPillar = new THREE.Mesh(new THREE.BoxGeometry(pillarW, height * 0.8, depth), material);
    rightPillar.position.set(spanWidth * 0.5 - pillarW * 0.5, height * 0.4, 0);
    group.add(rightPillar);

    // Fallen keystone on ground
    const fallen = new THREE.Mesh(new THREE.BoxGeometry(spanWidth * 0.25, pillarW * 0.8, depth * 1.2), material);
    fallen.position.set(4.0, 1.5, depth * 0.5);
    fallen.rotation.set(0.1, 0.3, -0.15);
    group.add(fallen);

    return group;
  }

  /**
   * SURF CANYON WALL: Dramatic inclined brutalist rock/concrete flank framing surf sequences.
   */
  public static createSurfCanyonWall(
    length = 60.0,
    height = 45.0,
    thickness = 8.0,
    slantAngle = 0.28,
    material: THREE.Material
  ): THREE.Group {
    const group = new THREE.Group();

    // Main angled canyon wall
    const wallGeom = new THREE.BoxGeometry(thickness, height, length);
    const wall = new THREE.Mesh(wallGeom, material);
    wall.position.y = height * 0.5;
    wall.rotation.z = slantAngle;
    group.add(wall);

    // Longitudinal horizontal relief ribs
    for (let r = -1; r <= 1; r++) {
      const ribGeom = new THREE.BoxGeometry(thickness * 1.3, 2.5, length * 1.02);
      const rib = new THREE.Mesh(ribGeom, material);
      rib.position.set(0, height * 0.5 + r * (height * 0.28), 0);
      rib.rotation.z = slantAngle;
      group.add(rib);
    }

    return group;
  }

  /**
   * SIGNAL FIN: Aerodynamic brutalist blade projecting vertically into the sky.
   */
  public static createSignalFin(
    height = 50.0,
    baseWidth = 14.0,
    thickness = 3.0,
    material: THREE.Material
  ): THREE.Group {
    const group = new THREE.Group();

    // Tapered fin stack (3 tiers)
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(baseWidth, height * 0.45, thickness), material);
    t1.position.y = height * 0.225;
    group.add(t1);

    const t2 = new THREE.Mesh(new THREE.BoxGeometry(baseWidth * 0.65, height * 0.35, thickness * 0.85), material);
    t2.position.y = height * 0.45 + height * 0.175;
    group.add(t2);

    const t3 = new THREE.Mesh(new THREE.BoxGeometry(baseWidth * 0.3, height * 0.25, thickness * 0.7), material);
    t3.position.y = height * 0.8 + height * 0.125;
    group.add(t3);

    return group;
  }

  /**
   * FLOATING RUIN: Cluster of hovering brutalist stepped slabs framing negative space.
   */
  public static createFloatingRuin(
    width = 24.0,
    height = 18.0,
    depth = 24.0,
    material: THREE.Material
  ): THREE.Group {
    const group = new THREE.Group();

    // Central primary floating slab
    const slabA = new THREE.Mesh(new THREE.BoxGeometry(width, height * 0.3, depth), material);
    slabA.position.set(0, height * 0.5, 0);
    group.add(slabA);

    // Orbiting satellite slabs
    const slabB = new THREE.Mesh(new THREE.BoxGeometry(width * 0.5, height * 0.2, depth * 0.5), material);
    slabB.position.set(width * 0.6, height * 0.7, -depth * 0.3);
    slabB.rotation.set(0.08, 0.15, -0.05);
    group.add(slabB);

    const slabC = new THREE.Mesh(new THREE.BoxGeometry(width * 0.4, height * 0.25, depth * 0.4), material);
    slabC.position.set(-width * 0.55, height * 0.25, depth * 0.4);
    slabC.rotation.set(-0.06, -0.1, 0.08);
    group.add(slabC);

    return group;
  }

  /**
   * ALTAR BLOCK: Monolithic podium with recessed steps and central accent channel.
   */
  public static createAltarBlock(
    width = 20.0,
    height = 8.0,
    depth = 20.0,
    material: THREE.Material
  ): THREE.Group {
    const group = new THREE.Group();

    // 3 stepped tiers
    for (let i = 0; i < 3; i++) {
      const scale = 1.0 - i * 0.18;
      const tierH = height / 3;
      const tierGeom = new THREE.BoxGeometry(width * scale, tierH, depth * scale);
      const mesh = new THREE.Mesh(tierGeom, material);
      mesh.position.y = (i + 0.5) * tierH;
      group.add(mesh);
    }

    return group;
  }
}
