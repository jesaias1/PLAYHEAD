# THIRD-PARTY ASSETS REGISTRY

This document records third-party 3D models, textures, and assets integrated into PLAYHEAD, along with author attribution, license terms, and modifications.

---

## 1. PSX First Person Arms

- **Asset Name**: PSX First Person Arms
- **Author**: Drillimpact
- **Source**: [https://drillimpact.itch.io/psx-first-person-arms-free](https://drillimpact.itch.io/psx-first-person-arms-free)
- **License**: Creative Commons Zero (CC0 1.0 Public Domain)
- **Local Path**: public/assets/viewmodel/arms/arms_rig.glb
- **Textures**: public/assets/viewmodel/textures/arms_gloves_01.png (512x512 hand-painted black/navy runner gloves)
- **Description**: Fully rigged, low-poly first-person viewmodel arms featuring articulated finger digits, wrist, forearm, and armature with multiple animation clips (knife_idle, knife_draw, etc.).
- **Modifications**:
  - Imported into Three.js via GLTFLoader.
  - Styled with PLAYHEAD's Cosmic Pixel Brutalism material treatment and dedicated lighting.
  - Attached karambit socket to hand.R bone.

---

## 2. Low-Poly Karambit

- **Asset Name**: Karambit
- **Author**: alixor22
- **Source**: Sketchfab ([https://sketchfab.com/alixor22](https://sketchfab.com/alixor22))
- **License**: Creative Commons Attribution (CC-BY 4.0)
- **Local Path**: public/assets/viewmodel/karambit/karambit.glb
- **Description**: Game-ready low-poly Karambit knife (approx. 4.9k vertices / 9.2k tris) featuring an authentic curved hawkbill blade, retention finger ring (pommel), and textured composite handle.
- **Modifications**:
  - Positioned and parented to the viewmodel rig's right hand bone (hand.R) in an authentic tactical reverse grip.
  - Adapted material profile for PLAYHEAD with dark steel blade finish, matte charcoal handle, and dynamic emissive signal fuller synced with active track palette.
