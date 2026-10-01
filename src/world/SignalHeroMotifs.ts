/**
 * SignalHeroMotifs — per-track HERO COMPOSITION.
 *
 * Each official track's world profile names a `hero.motif`. This module turns
 * that name into ONE memorable, authored landmark family placed in validated
 * negative space near the route: a giant broken orbital ring, a suspended
 * colossal frame, a vertical energy chasm, fractured archipelago, an impossible
 * distant tower, hanging architecture, a machine spine, or a monolith field.
 *
 * Rules honoured:
 *   - Decoration only. Every accepted placement is validated against the
 *     authoritative route corridor using its ACTUAL final world-space bounds
 *     (the composed instance matrix × the shared unit box) before it is kept;
 *     no placement is ever allowed inside the gameplay envelope, and gameplay is
 *     never moved to fit a hero.
 *   - Deterministic from the track seed. ALL accepted box segments are batched
 *     into a SINGLE InstancedMesh sharing ONE unit BoxGeometry and ONE material,
 *     so authored variety costs instance transforms (and one draw call), not a
 *     mesh/geometry/material per element. The final safety pass still audits
 *     each instance individually.
 *   - Signal Drift / fallback are never built (usesOverride=false), preserving
 *     the reference world exactly. Nothing here allocates per frame.
 */

import * as THREE from 'three';
import { TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack } from '../generation/GenerationTypes';
import { TrackPalette } from '../audio/TrackPalettes';
import { OfficialWorldProfile } from './SignalWorldProfile';
import { RouteExclusionCorridor } from './RouteExclusionCorridor';
import { tagWorldRole } from './WorldRoles';

/** One authored box segment, in FINAL local-space size + world placement. */
interface HeroBox {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

export class SignalHeroMotifs {
  public readonly group: THREE.Group = new THREE.Group();
  public built = false;

  /** True only when the profile names HERO as a reacting subsystem. Cached so
   *  the per-frame update never builds a fresh array. */
  public reacts = false;

  private material: THREE.MeshStandardMaterial | null = null;
  private geometry: THREE.BoxGeometry | null = null;
  private mesh: THREE.InstancedMesh | null = null;

  constructor(
    _analysis: TrackAnalysis,
    track: GeneratedTrack,
    palette: TrackPalette,
    profile: OfficialWorldProfile
  ) {
    this.group.name = 'SignalHeroMotifs';
    tagWorldRole(this.group, 'DECORATION', 'SignalHeroMotifs');
    if (!profile.usesOverride) return;
    this.reacts = profile.reaction.emphasis.includes('HERO');
    this.build(track, palette, profile);
  }

  private build(
    track: GeneratedTrack,
    palette: TrackPalette,
    profile: OfficialWorldProfile
  ): void {
    const route = track.route;
    if (route.length < 5) return;

    const corridor = new RouteExclusionCorridor(RouteExclusionCorridor.collectGameplayNodes(track));

    // aTower packing is (0.06). Keep the hero material simple + high contrast.
    this.material = new THREE.MeshStandardMaterial({
      color: palette.surfaceDark.clone().multiplyScalar(0.85),
      roughness: 0.55,
      metalness: 0.45,
      emissive: palette.primary.clone(),
      emissiveIntensity: 0.35
    });

    const openness = profile.space.openness;
    const vert = profile.space.verticality;
    const heroScale = profile.hero.scale * (profile.hero.dominant ? 1.15 : 1.0);
    const motif = profile.hero.motif;

    // Anchor ~62% along the route so the hero is visible AHEAD of the player.
    const anchorNode = route[Math.max(1, Math.min(route.length - 2, Math.floor(route.length * 0.62)))];
    const fwd = new THREE.Vector3(Math.sin(anchorNode.yaw), 0, Math.cos(anchorNode.yaw));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);

    const baseDist = (260 + (1 - openness) * 140) * (0.9 + heroScale * 0.25);

    // Height scale reused by every authored motif (matches the prior box()).
    const hs = 0.8 + vert * 0.5;

    const boxes: HeroBox[] = [];
    const emit = (
      w: number,
      h: number,
      d: number,
      pos: THREE.Vector3,
      ry: number,
      rx = 0,
      rz = 0
    ): void => {
      boxes.push({ w, h, d, x: pos.x, y: pos.y, z: pos.z, rx, ry, rz });
    };

    const at = (along: number, lateral: number, y: number): THREE.Vector3 =>
      new THREE.Vector3(
        anchorNode.position.x + fwd.x * along + right.x * lateral,
        anchorNode.position.y + y,
        anchorNode.position.z + fwd.z * along + right.z * lateral
      );

    const abyssY = Math.min(...route.map((n) => n.position.y)) - 120;

    switch (motif) {
      case 'ORBITAL_RING': {
        // A broken colossal ring standing beyond the finish, tilted.
        const R = 230 * heroScale;
        const t = 18 * heroScale;
        const seg = 22;
        const cx = at(baseDist, 0, 160 + vert * 120);
        for (let i = 0; i < seg; i++) {
          if (i > 7 && i < 10) continue; // broken gap
          const a = (i / seg) * Math.PI * 2;
          const pos = new THREE.Vector3(cx.x + Math.cos(a) * R, cx.y + Math.sin(a) * R, cx.z);
          emit(t, t * 1.1 * hs, (2 * Math.PI * R) / seg + 4, pos, anchorNode.yaw, 0, a);
        }
        break;
      }

      case 'SUSPENDED_FRAME': {
        // Colossal rectangular frame suspended ahead, one span broken.
        const S = 300 * heroScale;
        const tk = 26 * heroScale;
        const cx = at(baseDist, -80, 120 + vert * 120);
        const bar = (w: number, h: number, d: number, ox: number, oy: number): void =>
          emit(w, h, d, new THREE.Vector3(cx.x + ox, cx.y + oy, cx.z), anchorNode.yaw);
        bar(tk, S * hs, tk, -S / 2, 0);
        bar(tk, S * hs, tk, S / 2, 0);
        bar(S, tk, tk, 0, -S / 2);
        bar(S * 0.6, tk, tk, -S * 0.2, S / 2); // broken top span
        break;
      }

      case 'SIGNAL_WALL': {
        // Giant vertical signal wall across the horizon.
        const W = 420 * heroScale;
        const H = 200 * heroScale;
        const cx = at(baseDist, 0, 40);
        emit(W, H * hs, 24, new THREE.Vector3(cx.x, cx.y + H / 2 - 60, cx.z), anchorNode.yaw);
        // Rib buttresses.
        for (let i = -2; i <= 2; i++) {
          emit(
            16,
            H * 0.7 * hs,
            40,
            new THREE.Vector3(cx.x + right.x * i * (W / 5), cx.y - 20, cx.z + right.z * i * (W / 5)),
            anchorNode.yaw
          );
        }
        break;
      }

      case 'ENERGY_CHASM': {
        // Two colossal canyon walls flanking the route line (off-corridor).
        const wallH = 260 * heroScale;
        for (const side of [-1, 1]) {
          const cx = at(0, side * baseDist, 0);
          for (let k = 0; k < 4; k++) {
            const w = 60 + k * 12;
            emit(
              w,
              wallH * (1 - k * 0.12) * hs,
              90,
              new THREE.Vector3(cx.x + fwd.x * (k * 150), cx.y - 30, cx.z + fwd.z * (k * 150)),
              anchorNode.yaw + side * 0.15
            );
          }
        }
        break;
      }

      case 'IMPOSSIBLE_TOWER': {
        // One impossibly tall slender tower far away.
        const H = 900 * heroScale;
        const cx = at(baseDist + 220, 140, 0);
        const Hh = H * hs;
        emit(70, Hh, 70, new THREE.Vector3(cx.x, abyssY + Hh / 2, cx.z), anchorNode.yaw);
        emit(140, 40 * hs, 140, new THREE.Vector3(cx.x, abyssY + Hh, cx.z), anchorNode.yaw);
        break;
      }

      case 'HANGING_ARCHITECTURE': {
        // Structures hanging BELOW the route level, inverted.
        const cx = at(baseDist * 0.6, -120, 0);
        for (let i = 0; i < 5; i++) {
          const w = 90 + i * 20;
          const h = 260 + i * 40;
          emit(
            w,
            h * hs,
            70,
            new THREE.Vector3(cx.x + right.x * i * 90, cx.y - h / 2 - 120, cx.z + right.z * i * 90),
            anchorNode.yaw
          );
        }
        break;
      }

      case 'FRACTURED_ARCHIPELAGO': {
        const cx = at(baseDist * 0.9, 0, 60);
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          const r = 140 + (i * 37) % 160;
          const w = 40 + (i * 29) % 70;
          const h = 80 + (i * 53) % 180;
          emit(
            w,
            h * heroScale * hs,
            30 + (i * 17) % 40,
            new THREE.Vector3(cx.x + Math.cos(a) * r, cx.y + ((i * 61) % 120) - 40, cx.z + Math.sin(a) * r),
            a,
            (i % 3) * 0.1,
            (i % 2) * 0.08
          );
        }
        break;
      }

      case 'CELESTIAL_ASCENT': {
        // Stacked ascending slabs climbing toward the sky.
        const cx = at(baseDist * 0.5, 0, 0);
        for (let i = 0; i < 7; i++) {
          const w = 260 - i * 28;
          emit(w, 26 * hs, w * 0.5, new THREE.Vector3(cx.x, cx.y + 60 + i * 90 * heroScale, cx.z), anchorNode.yaw);
        }
        break;
      }

      case 'INVERTED_SKYLINE': {
        // A mirrored skyline hanging below the route plane.
        const cx = at(baseDist * 0.8, 0, 0);
        for (let i = 0; i < 8; i++) {
          const w = 40 + (i * 31) % 70;
          const h = 200 + (i * 67) % 320;
          emit(
            w,
            h * hs,
            w,
            new THREE.Vector3(cx.x + right.x * (i - 4) * 90, cx.y - h / 2 - 90, cx.z + right.z * (i - 4) * 90),
            anchorNode.yaw
          );
        }
        break;
      }

      case 'MACHINE_SPINE': {
        // One long machine spine with regular fins, running ahead of the route.
        const L = 900 * heroScale;
        const cx = at(baseDist * 0.4, -160, 40);
        emit(
          L,
          50 * hs,
          50,
          new THREE.Vector3(cx.x + fwd.x * L * 0.5, cx.y, cx.z + fwd.z * L * 0.5),
          anchorNode.yaw
        );
        for (let i = 0; i < 10; i++) {
          emit(
            20,
            160 * hs,
            20,
            new THREE.Vector3(cx.x + fwd.x * i * (L / 10), cx.y + 70, cx.z + fwd.z * i * (L / 10)),
            anchorNode.yaw
          );
        }
        break;
      }

      case 'MONOLITH_FIELD': {
        for (let i = 0; i < 8; i++) {
          const w = 50 + (i * 23) % 60;
          const h = 300 + (i * 71) % 400;
          const lat = -400 + (i * 97) % 800;
          const pos = at(baseDist * 0.6 + i * 40, lat, 0);
          pos.y = anchorNode.position.y - 60 + (h * hs) / 2;
          emit(w, h * hs, w * 0.8, pos, anchorNode.yaw + (i % 2 ? 0.2 : -0.15));
        }
        break;
      }

      default:
        break;
    }

    if (boxes.length === 0) return;

    // --- BATCH: one shared unit box, one material, one InstancedMesh --------
    // Corridor validation uses the ACTUAL final world-space bounds of each
    // composed instance (non-uniform scale + rotation), so the safety pass and
    // this build agree; rejected segments are simply never instanced.
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const dummy = new THREE.Object3D();
    const euler = new THREE.Euler();
    const worldBox = new THREE.Box3();
    const unitBox = new THREE.Box3(
      new THREE.Vector3(-0.5, -0.5, -0.5),
      new THREE.Vector3(0.5, 0.5, 0.5)
    );

    const accepted: THREE.Matrix4[] = [];
    for (const b of boxes) {
      euler.set(b.rx, b.ry, b.rz);
      dummy.position.set(b.x, b.y, b.z);
      dummy.quaternion.setFromEuler(euler);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.updateMatrix();
      worldBox.copy(unitBox).applyMatrix4(dummy.matrix);
      // Conservative: reject anything whose (rotated, scaled) AABB intrudes on
      // the gameplay envelope. `isBoxInsideCorridor` returns true on overlap.
      if (corridor.isBoxInsideCorridor(worldBox)) continue;
      accepted.push(dummy.matrix.clone());
    }

    this.geometry = unit;
    if (accepted.length === 0) {
      unit.dispose();
      this.geometry = null;
      this.built = false;
      return;
    }

    this.mesh = new THREE.InstancedMesh(unit, this.material, accepted.length);
    this.mesh.name = 'HeroMotif';
    for (let i = 0; i < accepted.length; i++) this.mesh.setMatrixAt(i, accepted[i]);
    this.mesh.instanceMatrix.needsUpdate = true;
    // Conservative culling bound (instances can sit far from the group origin).
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.built = true;
  }

  /**
   * Bounded, smoothed section/drop response for the hero composition. Only the
   * single shared material's emissive intensity moves, and it is clamped to a
   * safe range. Identity gain (1.0) leaves it exactly as authored for Signal
   * Drift / fallback. No allocation.
   */
  public update(gain = 1.0): void {
    if (!this.material) return;
    this.material.emissiveIntensity = Math.max(0.08, Math.min(0.95, 0.35 * gain));
  }

  public dispose(): void {
    this.group.parent?.remove(this.group);
    if (this.geometry) this.geometry.dispose();
    if (this.material) this.material.dispose();
    this.geometry = null;
    this.material = null;
    this.mesh = null;
  }
}
