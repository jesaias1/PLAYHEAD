/**
 * Playhead Temporality System for PLAYHEAD
 * Manages the Past / Present / Future spatial-temporal activation states
 * and now-line ignition relative to player position and audio timeline.
 */

import * as THREE from 'three';
import { MusicVisualState } from './MusicVisualController';

export interface PlayheadActivationMesh {
  mesh: THREE.Mesh | THREE.LineSegments;
  nodeArcLength: number;
  nodeTime: number;
  baseOpacity: number;
  baseEmissive?: number;
  channel?: ReactiveChannel;
}

/**
 * Reactive channels for the world's audio-reactive signal surfaces.
 *
 * `TEMPORAL` is the original behavior: architecture ignites when the playhead
 * reaches it and dims into the future/past. The remaining channels are
 * STRUCTURAL BEACONS — major gates, finish planes and accent trims — which stay
 * legible at all times and instead breathe with the music. They deliberately
 * bypass the future/past dimming so a gate never reads as "dead" when the
 * player is ahead of or behind the score.
 */
export type ReactiveChannel = 'TEMPORAL' | 'GATE_FRAME' | 'FINISH_PLANE' | 'ACCENT_TRIM' | 'HEADER_BAR';

/**
 * Fraction of an item's authored emissive that is NOT scaled by the music
 * reactivity multiplier.
 *
 * This is the legibility floor. Route trim, gates and the finish portal keep a
 * stable authored luminance in the quietest section, while the music-driven
 * part of the response is free to sit much lower. The result is real dynamic
 * range without raising the ceiling: quiet parts genuinely read quiet, and a
 * drop is obviously bigger because it starts from further down.
 */
const PRESENT_LEGIBILITY_FLOOR = 0.5;

/**
 * Shared attack/response curves per channel, in emissive-ratio terms.
 *
 * `onset` drives the fast transient flash, `drop` is the major-event surge and
 * `energy` is the slow baseline breathing.
 *
 * CALIBRATION NOTE (measured, not guessed): `energy` on real tracks sits around
 * 0.71 mean with a 10th percentile near 0.59, while `onsetPulse` swings the full
 * 0..1. Sustained energy therefore has to stay a WEAK term — if it is strong
 * enough to look impressive on its own it holds every gate permanently above
 * the bloom threshold, which reads as constant glow rather than as the world
 * answering the music. These coefficients keep the rest state clearly below the
 * 0.88 bloom threshold and let transients/drops cross it, so the glow is
 * beat-locked by construction.
 *
 * `floor` is the legibility floor (see PRESENT_LEGIBILITY_FLOOR): it is applied
 * OUTSIDE the reactivity multiplier, so it is unaffected by effect intensity or
 * by a quiet section. It exists so gameplay-critical signals never disappear.
 */
const CHANNEL_RESPONSE: Record<ReactiveChannel, { onset: number; energy: number; drop: number; floor: number }> = {
  // PRIMARY: major gates / important architecture — the strongest response.
  // Rest ~0.48 (luminous, no bloom) -> transient peak ~1.7 (blooms hard).
  GATE_FRAME: { onset: 1.9, energy: 0.13, drop: 2.4, floor: 0.54 },
  // PRIMARY: finish signal plane. A large surface, so it needs the LOWEST
  // resting luminance or it reads as an always-on glow wall.
  // Rest ~0.60 -> transient peak ~1.6.
  FINISH_PLANE: { onset: 1.0, energy: 0.14, drop: 2.0, floor: 0.60 },
  // SECONDARY: route edge / signal accents — visible, clearly subordinate.
  // Rest ~0.42 -> transient peak ~1.6.
  ACCENT_TRIM: { onset: 1.2, energy: 0.16, drop: 1.4, floor: 0.26 },
  // TERTIARY: a small number of environmental details. Shimmer only.
  HEADER_BAR: { onset: 0.45, energy: 0.10, drop: 0.5, floor: 0.45 },
  // Unused by registered beacons; kept for exhaustiveness.
  TEMPORAL: { onset: 0, energy: 0, drop: 0, floor: 0 }
};

export class PlayheadSystem {
  private activeItems: PlayheadActivationMesh[] = [];

  constructor(_scene: THREE.Scene) {
    // Playhead activation manager initializes with the scene
  }

  public registerItem(
    mesh: THREE.Mesh | THREE.LineSegments,
    arcLength: number,
    nodeTime: number,
    baseOpacity = 1.0,
    baseEmissive = 0.5
  ): void {
    this.activeItems.push({
      mesh,
      nodeArcLength: arcLength,
      nodeTime,
      baseOpacity,
      baseEmissive,
      channel: 'TEMPORAL'
    });
  }

  /**
   * Registers a structural beacon (gate frame, finish plane, accent trim).
   *
   * `baseEmissive` is re-read from the live material when omitted, so the
   * authored look defined in GeometryBuilder stays the single source of truth
   * for how bright each surface sits between musical events.
   */
  public registerReactive(
    mesh: THREE.Mesh,
    channel: ReactiveChannel,
    baseEmissiveOverride?: number
  ): void {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (!mat || !('emissiveIntensity' in mat)) return;

    this.activeItems.push({
      mesh,
      nodeArcLength: 0,
      nodeTime: 0,
      baseOpacity: 'opacity' in mat ? (mat.opacity as number) : 1.0,
      baseEmissive: baseEmissiveOverride ?? mat.emissiveIntensity,
      channel
    });
  }

  public update(
    _playerPos: THREE.Vector3,
    playerArcProgress: number,
    _playerYaw: number,
    visualState: MusicVisualState
  ): void {
    // Process all registered items through Future / Present / Past states
    const songTime = visualState.time;
    const nowWindow = 65.0; // +/- 65 metres around player
    const reactMult = visualState.reactivityMultiplier;

    for (let i = 0; i < this.activeItems.length; i++) {
      const item = this.activeItems[i];
      const mat = item.mesh.material as (THREE.MeshStandardMaterial | THREE.LineBasicMaterial);
      if (!mat) continue;

      // Structural beacons bypass temporal gating: they are always "present".
      if (item.channel && item.channel !== 'TEMPORAL') {
        this.applyBeaconReactivity(item, mat, visualState, reactMult);
        continue;
      }

      const deltaArc = item.nodeArcLength - playerArcProgress;

      // Forward-propagating traveling pulse wave along route edges
      const isLine = item.mesh instanceof THREE.LineSegments || mat instanceof THREE.LineBasicMaterial;
      let pulseWave = 0;
      if (deltaArc > 0) {
        const waveDist = (deltaArc - visualState.routePulsePhase * 28.0) % 55.0;
        const distFromCenter = Math.abs(waveDist - 27.5);
        pulseWave = Math.max(0, 1.0 - distFromCenter / 10.0) * visualState.subBass * reactMult;
      }

      if (deltaArc > nowWindow) {
        // ==========================================
        // FUTURE: Darker, cool, dormant, awaiting playhead
        // ==========================================
        const futureDist = deltaArc - nowWindow;
        const futureFactor = Math.max(0, 1.0 - futureDist / 120.0);

        if ('emissiveIntensity' in mat) {
          mat.emissiveIntensity = (item.baseEmissive || 0.5) * 0.15 * futureFactor;
          mat.emissive.copy(visualState.palette.void).lerp(visualState.palette.primary, 0.2);
        }
        if ('opacity' in mat) {
          mat.opacity = item.baseOpacity * (0.25 + 0.3 * futureFactor + pulseWave * 0.45);
        }
        if (isLine && 'color' in mat) {
          mat.color.copy(visualState.palette.surface).lerp(visualState.palette.primary, 0.2 + pulseWave * 0.7);
        }

      } else if (deltaArc < -25.0) {
        // ==========================================
        // PAST: Gradually dims, loses saturation, dissolves
        // ==========================================
        const pastDist = Math.abs(deltaArc) - 25.0;
        const pastFactor = Math.max(0.1, 1.0 - pastDist / 90.0);

        if ('emissiveIntensity' in mat) {
          mat.emissiveIntensity = (item.baseEmissive || 0.5) * 0.15 * pastFactor;
          mat.emissive.copy(visualState.palette.surface);
        }
        if ('opacity' in mat) {
          mat.opacity = item.baseOpacity * (0.15 + 0.45 * pastFactor);
        }
        if (isLine && 'color' in mat) {
          mat.color.copy(visualState.palette.void).lerp(visualState.palette.surface, pastFactor);
        }

      } else {
        // ==========================================
        // PRESENT: Audio-reactive ignition & high contrast
        // ==========================================
        // Check temporal synchronization
        const timeDiff = item.nodeTime - songTime;
        const isAhead = timeDiff > 0.6; // Player arrived before audio
        const isLate = timeDiff < -0.8;  // Player arrived after audio

        let presenceFactor = 1.0;
        if (isAhead) {
          presenceFactor = 0.5;
        } else if (isLate) {
          presenceFactor = 0.7;
        }

        const ignitionPulse = 1.0 - Math.abs(deltaArc) / nowWindow; // 1.0 right at playhead plane

        if ('emissiveIntensity' in mat) {
          const base = item.baseEmissive || 0.6;
          // LEGIBILITY FLOOR + REACTIVE TERM.
          //
          // The floor is deliberately NOT scaled by the music multiplier: the
          // route and its signals must stay readable in a quiet section. Only
          // the reactive term follows the music, which is what lets quiet parts
          // sit genuinely low and a drop be obviously bigger.
          const legibility = base * PRESENT_LEGIBILITY_FLOOR;
          const reactive =
            (visualState.bass * 0.8 + visualState.flux * 0.5 + visualState.dropImpact * 1.5) *
            presenceFactor *
            (1.0 + ignitionPulse * 0.5) *
            reactMult;
          mat.emissiveIntensity = legibility + reactive;
          mat.emissive.copy(visualState.palette.primary).lerp(visualState.palette.highlight, visualState.highlightMix);
        }
        if ('opacity' in mat) {
          // Resting trim opacity is kept LOW so route edges are not "always on".
          // Transients and drops lift it; it never starts near maximum.
          mat.opacity = Math.min(
            1.0,
            item.baseOpacity *
              (0.50 + visualState.energy * 0.20 + ignitionPulse * 0.28 + visualState.dropImpact * 0.30)
          );
        }
        if (isLine && 'color' in mat) {
          mat.color.copy(visualState.palette.primary).lerp(visualState.palette.highlight, 0.3 + ignitionPulse * 0.7);
        }
      }
    }
  }

  /**
   * Structural beacon response: a stable, palette-driven luminous floor that
   * answers musical events.
   *
   * Response shape (deliberately three-tiered so the world never strobes):
   * - floor      : always-legible baseline luminance
   * - energy     : slow baseline influence from sustained musical energy
   * - onset      : fast transient answer, dominant term
   * - drop       : major musical event surge
   *
   * The transient and drop terms are what lift emissive above the bloom
   * threshold, so gates "echo" strong beats while sitting calmly between them.
   */
  private applyBeaconReactivity(
    item: PlayheadActivationMesh,
    mat: THREE.MeshStandardMaterial | THREE.LineBasicMaterial,
    visualState: MusicVisualState,
    reactMult: number
  ): void {
    const channel = item.channel as ReactiveChannel;
    const resp = CHANNEL_RESPONSE[channel];
    const base = item.baseEmissive ?? 0.5;

    // Transient answer: onsetPulse is the analyser's real transient strength.
    const transient =
      resp.onset * visualState.onsetPulse +
      resp.drop * visualState.dropImpact;

    // Sustained baseline breathing: deliberately a minor term. Because `energy`
    // runs high on real tracks, a large coefficient here would hold the surface
    // permanently above the bloom threshold and destroy the beat-locked
    // response. Bass is folded in at reduced weight for low-end weight.
    const sustained = resp.energy * (visualState.energy + visualState.bass * 0.5);

    if ('emissiveIntensity' in mat) {
      // LEGIBILITY FLOOR + REACTIVE TERM.
      //
      // The floor is NOT scaled by the music multiplier, so checkpoints, the
      // finish portal and route accents stay readable even in the quietest
      // section. Only the music-driven part follows the reactivity multiplier,
      // which is what gives the world real dynamic range: the same authored
      // floor at rest, with much more headroom for a drop to be obviously bigger.
      const legibility = base * resp.floor;
      const reactive = (sustained + transient) * reactMult;
      mat.emissiveIntensity = legibility + reactive;
    }

    // Palette propagation: primary tinted toward the highlight on strong events,
    // so colour comes from the current map/section rather than a fixed cyan.
    if ('emissive' in mat) {
      const eventMix = Math.min(0.85, visualState.highlightMix + transient * 0.25);
      mat.emissive.copy(visualState.palette.primary).lerp(visualState.palette.highlight, eventMix);
    }

    // Additive/mostly-opaque planes need a modest opacity lift to read as "lit".
    if ('opacity' in mat && (channel === 'FINISH_PLANE' || channel === 'ACCENT_TRIM')) {
      mat.opacity = Math.min(1.0, item.baseOpacity + (transient + sustained * 0.4) * 0.30 * reactMult);
    }
  }

  public clear(): void {
    this.activeItems = [];
  }

  public dispose(): void {
    this.clear();
  }
}
