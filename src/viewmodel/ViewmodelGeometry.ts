/**
 * Procedural First-Person Viewmodel Geometry for PLAYHEAD
 * Constructs stylized cyber-runner hands, forearms, and the PLAYHEAD Karambit.
 *
 * Designed with a clean, chunky retro-futuristic silhouette,
 * matte technical fabrics, articulated glove plates, and an emissive signal fuller.
 */

import * as THREE from 'three';

export interface ViewmodelMeshes {
  rootGroup: THREE.Group;
  rightArmGroup: THREE.Group;
  leftArmGroup: THREE.Group;
  knifeGroup: THREE.Group;
  knifeSignalMaterial: THREE.MeshStandardMaterial;
  dispose: () => void;
}

export class ViewmodelGeometry {
  /**
   * Builds the complete viewmodel rig with arms and stylized karambit
   */
  public static buildRig(accentColor: THREE.Color = new THREE.Color(0x00f0ff)): ViewmodelMeshes {
    const rootGroup = new THREE.Group();
    const rightArmGroup = new THREE.Group();
    const leftArmGroup = new THREE.Group();
    const knifeGroup = new THREE.Group();

    // 1. Shared Materials
    const sleeveMaterial = new THREE.MeshStandardMaterial({
      color: 0x2e3848,
      roughness: 0.65,
      metalness: 0.25
    });

    const gloveMaterial = new THREE.MeshStandardMaterial({
      color: 0x425268,
      roughness: 0.45,
      metalness: 0.35
    });

    const knuckleMaterial = new THREE.MeshStandardMaterial({
      color: 0x768fae,
      roughness: 0.2,
      metalness: 0.8
    });

    const knifeHandleMaterial = new THREE.MeshStandardMaterial({
      color: 0x1c2330,
      roughness: 0.55,
      metalness: 0.4
    });

    const knifeBladeMaterial = new THREE.MeshStandardMaterial({
      color: 0x6e829c,
      roughness: 0.18,
      metalness: 0.92
    });

    const knifeBevelMaterial = new THREE.MeshStandardMaterial({
      color: 0xf4f8ff,
      roughness: 0.08,
      metalness: 0.98
    });

    const knifeSignalMaterial = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: accentColor,
      // Blade signal strip. Deliberately restrained: the viewmodel must never
      // compete with the architecture or bloom into the player's view.
      emissiveIntensity: 1.9,
      roughness: 0.1,
      metalness: 0.5
    });

    // 2. Build Right Arm & Hand
    buildArm(rightArmGroup, false, sleeveMaterial, gloveMaterial, knuckleMaterial);

    // 3. Build Left Arm & Hand
    buildArm(leftArmGroup, true, sleeveMaterial, gloveMaterial, knuckleMaterial);

    // 4. Build Stylized Karambit
    buildKarambit(
      knifeGroup,
      knifeHandleMaterial,
      knifeBladeMaterial,
      knifeBevelMaterial,
      knifeSignalMaterial
    );

    // Attach knife to right hand grip anchor with dynamic ready presentation
    rightArmGroup.add(knifeGroup);
    knifeGroup.position.set(0.015, -0.01, -0.07);
    knifeGroup.rotation.set(-0.2, 0.3, -0.15);

    rootGroup.add(rightArmGroup);
    rootGroup.add(leftArmGroup);

    const dispose = () => {
      rootGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    };

    return {
      rootGroup,
      rightArmGroup,
      leftArmGroup,
      knifeGroup,
      knifeSignalMaterial,
      dispose
    };
  }
}

/**
 * Builds a chunky stylized forearm and glove
 */
function buildArm(
  parentGroup: THREE.Group,
  isLeft: boolean,
  sleeveMat: THREE.Material,
  gloveMat: THREE.Material,
  knuckleMat: THREE.Material
): void {
  const armGroup = new THREE.Group();
  const sign = isLeft ? -1 : 1;

  // 1. Forearm (Chunky tapered sleeve with faceted edges)
  const forearmGeom = new THREE.CylinderGeometry(0.038, 0.048, 0.28, 8);
  const forearm = new THREE.Mesh(forearmGeom, sleeveMat);
  forearm.rotation.x = Math.PI * 0.48;
  forearm.rotation.y = sign * 0.12;
  forearm.position.set(0, -0.05, 0.15);
  armGroup.add(forearm);

  // Sleeve cuff band
  const cuffGeom = new THREE.CylinderGeometry(0.041, 0.041, 0.035, 8);
  const cuff = new THREE.Mesh(cuffGeom, knuckleMat);
  cuff.rotation.copy(forearm.rotation);
  cuff.position.set(0, -0.03, 0.02);
  armGroup.add(cuff);

  // 2. Wrist & Palm
  const palmGeom = new THREE.BoxGeometry(0.065, 0.038, 0.085);
  const palm = new THREE.Mesh(palmGeom, gloveMat);
  palm.position.set(0, -0.02, -0.03);
  armGroup.add(palm);

  // Armored knuckle plate
  const knuckleGeom = new THREE.BoxGeometry(0.062, 0.012, 0.032);
  const knuckle = new THREE.Mesh(knuckleGeom, knuckleMat);
  knuckle.position.set(0, 0.002, -0.035);
  armGroup.add(knuckle);

  // 3. Thumb
  const thumbProxGeom = new THREE.BoxGeometry(0.02, 0.018, 0.035);
  const thumbProx = new THREE.Mesh(thumbProxGeom, gloveMat);
  thumbProx.position.set(-sign * 0.036, -0.01, -0.01);
  thumbProx.rotation.set(0.2, -sign * 0.6, sign * 0.3);
  armGroup.add(thumbProx);

  const thumbDistGeom = new THREE.BoxGeometry(0.018, 0.016, 0.028);
  const thumbDist = new THREE.Mesh(thumbDistGeom, gloveMat);
  thumbDist.position.set(-sign * 0.048, -0.008, -0.035);
  thumbDist.rotation.set(0.4, -sign * 0.8, sign * 0.4);
  armGroup.add(thumbDist);

  // 4. Four Fingers (Articulated based on hand role)
  const fingerWidth = 0.014;
  const fingerSpacing = 0.0155;

  for (let i = 0; i < 4; i++) {
    const xPos = (-0.023 + i * fingerSpacing) * sign;
    const fingerLen = i === 1 || i === 2 ? 0.036 : 0.032;

    if (!isLeft) {
      // Right Hand: Curling tightly around karambit grip and index ring
      const isIndex = i === 3; // Outermost finger index
      const fProxGeom = new THREE.BoxGeometry(fingerWidth, 0.014, fingerLen);
      const fProx = new THREE.Mesh(fProxGeom, gloveMat);
      fProx.position.set(xPos, -0.025, -0.075);
      fProx.rotation.x = isIndex ? -0.7 : -0.9;
      armGroup.add(fProx);

      const fDistGeom = new THREE.BoxGeometry(fingerWidth * 0.9, 0.012, fingerLen * 0.8);
      const fDist = new THREE.Mesh(fDistGeom, gloveMat);
      fDist.position.set(xPos, -0.042, -0.09);
      fDist.rotation.x = isIndex ? -1.3 : -1.6;
      armGroup.add(fDist);
    } else {
      // Left Hand: Open, agile balance posture
      const fProxGeom = new THREE.BoxGeometry(fingerWidth, 0.013, fingerLen * 1.1);
      const fProx = new THREE.Mesh(fProxGeom, gloveMat);
      fProx.position.set(xPos, -0.02, -0.08);
      fProx.rotation.x = -0.35 + i * 0.05;
      fProx.rotation.y = sign * (0.08 - i * 0.04);
      armGroup.add(fProx);

      const fDistGeom = new THREE.BoxGeometry(fingerWidth * 0.9, 0.011, fingerLen * 0.9);
      const fDist = new THREE.Mesh(fDistGeom, gloveMat);
      fDist.position.set(xPos, -0.028, -0.11);
      fDist.rotation.x = -0.6;
      armGroup.add(fDist);
    }
  }

  parentGroup.add(armGroup);
}

/**
 * Builds the stylized PLAYHEAD Karambit
 */
function buildKarambit(
  knifeGroup: THREE.Group,
  handleMat: THREE.Material,
  bladeMat: THREE.Material,
  bevelMat: THREE.Material,
  signalMat: THREE.Material
): void {
  // 1. Retention Ring (Pommel)
  const ringGeom = new THREE.TorusGeometry(0.016, 0.005, 8, 16);
  const ring = new THREE.Mesh(ringGeom, handleMat);
  ring.rotation.x = Math.PI * 0.5;
  ring.position.set(0, 0, 0.065);
  knifeGroup.add(ring);

  // 2. Contoured Grip Handle
  const handleGeom = new THREE.BoxGeometry(0.024, 0.038, 0.095);
  const handle = new THREE.Mesh(handleGeom, handleMat);
  handle.position.set(0, 0.005, 0.015);
  handle.rotation.x = 0.08;
  knifeGroup.add(handle);

  // Finger groove scales
  for (let g = 0; g < 3; g++) {
    const grooveGeom = new THREE.BoxGeometry(0.026, 0.006, 0.016);
    const groove = new THREE.Mesh(grooveGeom, bladeMat);
    groove.position.set(0, -0.014, 0.035 - g * 0.026);
    knifeGroup.add(groove);
  }

  // 3. Curved Hawkbill Blade Shape
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0, 0);
  bladeShape.lineTo(0.005, -0.025);
  bladeShape.quadraticCurveTo(0.025, -0.06, 0.012, -0.115); // Talon curve down to tip
  bladeShape.lineTo(0.008, -0.118); // Sharp needle point
  bladeShape.quadraticCurveTo(-0.012, -0.075, -0.015, -0.03); // Sickle cutting belly
  bladeShape.lineTo(-0.01, 0);
  bladeShape.closePath();

  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    depth: 0.005,
    bevelEnabled: true,
    bevelThickness: 0.002,
    bevelSize: 0.002,
    bevelSegments: 2
  };

  const bladeGeom = new THREE.ExtrudeGeometry(bladeShape, extrudeSettings);
  bladeGeom.center();
  const blade = new THREE.Mesh(bladeGeom, bladeMat);
  blade.position.set(0.005, 0.015, -0.065);
  blade.rotation.set(0.12, 0.55, Math.PI * 0.90);
  knifeGroup.add(blade);

  // 4. Polished Blade Edge Trim
  const edgeShape = new THREE.Shape();
  edgeShape.moveTo(0, -0.03);
  edgeShape.quadraticCurveTo(0.025, -0.06, 0.012, -0.115);
  edgeShape.lineTo(0.008, -0.118);
  edgeShape.quadraticCurveTo(0.02, -0.065, 0.005, -0.03);
  edgeShape.closePath();

  const edgeGeom = new THREE.ExtrudeGeometry(edgeShape, { depth: 0.002, bevelEnabled: false });
  edgeGeom.center();
  const edge = new THREE.Mesh(edgeGeom, bevelMat);
  edge.position.set(0.006, 0.015, -0.065);
  edge.rotation.copy(blade.rotation);
  knifeGroup.add(edge);

  // 5. Emissive Signal Channel (Fuller)
  const signalShape = new THREE.Shape();
  signalShape.moveTo(0, -0.02);
  signalShape.quadraticCurveTo(0.014, -0.05, 0.006, -0.095);
  signalShape.lineTo(0.002, -0.095);
  signalShape.quadraticCurveTo(0.01, -0.05, -0.004, -0.02);
  signalShape.closePath();

  const signalGeom = new THREE.ExtrudeGeometry(signalShape, { depth: 0.003, bevelEnabled: false });
  signalGeom.center();
  const signalMesh = new THREE.Mesh(signalGeom, signalMat);
  signalMesh.position.set(0.006, 0.015, -0.063);
  signalMesh.rotation.copy(blade.rotation);
  knifeGroup.add(signalMesh);

  // 6. Subtle Cybernetic Notches on spine
  const notchGeom = new THREE.BoxGeometry(0.008, 0.004, 0.006);
  for (let n = 0; n < 3; n++) {
    const notch = new THREE.Mesh(notchGeom, signalMat);
    notch.position.set(0, 0.03 - n * 0.008, -0.035 - n * 0.015);
    knifeGroup.add(notch);
  }
}
