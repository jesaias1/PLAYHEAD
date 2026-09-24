/**
 * PRODUCTION POLISH V1 — visual calibration + effect intensity.
 *
 * These tests lock in the presentation contract from the polish pass:
 *
 *   1. EFFECT INTENSITY scales DECORATIVE / audio-reactive output only, and
 *      STANDARD is exactly the identity (no drift from the authored look).
 *   2. It is structurally unable to reach gameplay: no physics, movement,
 *      generation, map-identity or scoring module reads it.
 *   3. The reference bloom calibration is the calmer one (higher threshold,
 *      tighter radius, lower strength).
 *   4. Dynamic range comes from LOWERING the baseline, not from raising peaks:
 *      quiet sections sit clearly below drops, and drops keep their ceiling.
 *   5. The music envelope releases faster than it attacks, so the world drops
 *      back to the quiet baseline quickly instead of lingering near the top.
 *   6. Gameplay legibility floors are NOT scaled by the music multiplier, so
 *      route trim, gates and the finish portal stay readable in a quiet section.
 *   7. The remote ghost cannot blind or occlude: translucent normal-blended
 *      body, thin additive trace, no wide halo.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';

import {
  EFFECT_INTENSITIES,
  EFFECT_INTENSITY_PROFILES,
  resolveEffectProfile
} from '../src/rendering/EffectIntensity';
import { SettingsManager } from '../src/core/Settings';
import { SongDirector } from '../src/world/SongDirector';
import { PlayheadSystem } from '../src/world/PlayheadSystem';
import { RemoteGhostRenderer, RIVAL_SIGNAL_COLOR } from '../src/online/RemoteGhostRenderer';
import { GhostVisual } from '../src/replay/GhostVisual';
import type { MusicVisualState } from '../src/world/MusicVisualController';

const repoRoot = path.resolve(__dirname, '..');

function read(relative: string): string {
  return fs.readFileSync(path.join(repoRoot, relative), 'utf8');
}

function minimalVisualState(overrides: Partial<MusicVisualState> = {}): MusicVisualState {
  return {
    energy: 0.5,
    bass: 0.5,
    subBass: 0.3,
    flux: 0.3,
    onsetPulse: 0,
    buildup: 0,
    dropImpact: 0,
    sectionTheme: 'VERSE',
    sectionIndex: 0,
    progress: 0.5,
    highlightMix: 0.05,
    reactivityMultiplier: 1.0,
    palette: {
      primary: new THREE.Color(0x00f0ff),
      secondary: new THREE.Color(0x9d8cff),
      highlight: new THREE.Color(0xffffff),
      surface: new THREE.Color(0x111820),
      void: new THREE.Color(0x05070a)
    },
    ...overrides
  } as unknown as MusicVisualState;
}

// ---------------------------------------------------------------------------
// 1. Profile table
// ---------------------------------------------------------------------------

describe('Effect intensity — profile table', () => {
  it('STANDARD is exactly the identity, so the reference look does not drift', () => {
    const std = EFFECT_INTENSITY_PROFILES.STANDARD;
    expect(std.emissiveScale).toBe(1.0);
    expect(std.bloomScale).toBe(1.0);
    expect(std.exposureLiftScale).toBe(1.0);
    expect(std.additiveScale).toBe(1.0);
    expect(std.viewmodelScale).toBe(1.0);
  });

  it('is monotonic LOW < STANDARD < HIGH on every axis', () => {
    const { LOW, STANDARD, HIGH } = EFFECT_INTENSITY_PROFILES;
    const axes = [
      'emissiveScale',
      'bloomScale',
      'exposureLiftScale',
      'additiveScale',
      'viewmodelScale'
    ] as const;
    for (const axis of axes) {
      expect(LOW[axis]).toBeGreaterThan(0);
      expect(LOW[axis]).toBeLessThan(STANDARD[axis]);
      expect(STANDARD[axis]).toBeLessThan(HIGH[axis]);
    }
  });

  it('never fully disables the look at LOW (bloom stays non-zero)', () => {
    expect(EFFECT_INTENSITY_PROFILES.LOW.bloomScale).toBeGreaterThan(0);
    expect(EFFECT_INTENSITY_PROFILES.LOW.emissiveScale).toBeGreaterThan(0);
  });

  it('resolves unknown / corrupt saved values to STANDARD', () => {
    expect(resolveEffectProfile('LOW').emissiveScale).toBe(0.55);
    expect(resolveEffectProfile('HIGH').bloomScale).toBe(1.3);
    for (const bad of [undefined, null, '', 'ULTRA', 42, {}, 'standard']) {
      expect(resolveEffectProfile(bad)).toEqual(EFFECT_INTENSITY_PROFILES.STANDARD);
    }
  });

  it('exposes exactly three intensities', () => {
    expect([...EFFECT_INTENSITIES]).toEqual(['LOW', 'STANDARD', 'HIGH']);
  });

  it('every profile axis is actually consumed by a rendering path', () => {
    // Guards against a profile field becoming decorative dead weight.
    const consumers: Array<[keyof typeof EFFECT_INTENSITY_PROFILES.STANDARD, string]> = [
      ['emissiveScale', 'src/world/World.ts'],
      ['bloomScale', 'src/rendering/PostProcessing.ts'],
      ['exposureLiftScale', 'src/world/Environment.ts'],
      ['additiveScale', 'src/core/Game.ts'],
      ['viewmodelScale', 'src/viewmodel/ViewmodelController.ts']
    ];
    for (const [axis, file] of consumers) {
      expect(read(file)).toContain(axis);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Settings integration
// ---------------------------------------------------------------------------

describe('Effect intensity — settings', () => {
  it('defaults to STANDARD', () => {
    // Read the DEFAULT_SETTINGS literal without instantiating the singleton,
    // which would touch localStorage.
    const src = read('src/core/Settings.ts');
    expect(src).toMatch(/effectIntensity: 'STANDARD'/);
  });

  it('is part of GameSettings and persisted with the rest of the settings', () => {
    const src = read('src/core/Settings.ts');
    expect(src).toMatch(/effectIntensity: EffectIntensity;/);
    expect(src).toMatch(/export type EffectIntensity = 'LOW' \| 'STANDARD' \| 'HIGH';/);
    // Same storage path as every other setting: no separate persistence.
    expect(src).toMatch(/const STORAGE_KEY = 'trackrun_settings';/);
  });

  it('is offered in the settings UI and wired to the manager', () => {
    const modal = read('src/ui/SettingsModal.ts');
    expect(modal).toMatch(/id="set-effect-intensity"/);
    expect(modal).toMatch(/LOW \(CALMEST, LEAST GLOW\)/);
    expect(modal).toMatch(/STANDARD \(REFERENCE\)/);
    expect(modal).toMatch(/this\.settingsManager\.update\(\{ effectIntensity:/);
  });

  it('Game applies it live and to the rival ghost', () => {
    const game = read('src/core/Game.ts');
    expect(game).toMatch(/changedKeys\.has\('effectIntensity'\)/);
    expect(game).toMatch(/environment\.setEffectIntensity\(/);
    expect(game).toMatch(/raceGhost\?\.setEffectScale\(/);
  });
});

// ---------------------------------------------------------------------------
// 3. Structural safety — presentation only
// ---------------------------------------------------------------------------

describe('Effect intensity — cannot reach gameplay', () => {
  it('no physics / movement / generation module references it', () => {
    const guardedDirs = ['src/physics', 'src/player', 'src/generation', 'src/gameplay'];
    const offenders: string[] = [];
    for (const dir of guardedDirs) {
      const abs = path.join(repoRoot, dir);
      if (!fs.existsSync(abs)) continue;
      for (const file of fs.readdirSync(abs)) {
        if (!file.endsWith('.ts')) continue;
        const src = fs.readFileSync(path.join(abs, file), 'utf8');
        if (/effectIntensity|effectProfile|EffectIntensity/.test(src)) {
          offenders.push(`${dir}/${file}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('map identity does not depend on any visual setting', () => {
    const identity = read('src/online/MapIdentity.ts');
    expect(identity).not.toMatch(/effectIntensity|effectProfile|bloom|emissive/i);
  });

  it('the profile is applied at exactly one gameplay-adjacent read site', () => {
    // World is the only world-update module that reads it, and only to scale
    // the audio-reactive multiplier — never geometry, collision or timing.
    const world = read('src/world/World.ts');
    const reads = world.match(/environment\.effectProfile/g) ?? [];
    expect(reads).toHaveLength(1);
    expect(world).toMatch(/reactivityMultiplier =\s*\n\s*\(directorState\.spectralReactivity \+ this\.signalImpulse\) \* effectEmissiveScale/);
  });
});

// ---------------------------------------------------------------------------
// 4. Bloom calibration
// ---------------------------------------------------------------------------

describe('Bloom calibration — reduced baseline, preserved peaks', () => {
  it('uses a high threshold so ordinary lit geometry does not bloom', () => {
    const pp = read('src/rendering/PostProcessing.ts');
    expect(pp).toMatch(/const BLOOM_THRESHOLD = 0\.88;/);
    // Previously 0.82. A higher threshold is strictly calmer.
    expect(pp).not.toMatch(/BLOOM_THRESHOLD = 0\.82/);
  });

  it('uses a tighter radius and a lower base strength than before', () => {
    const pp = read('src/rendering/PostProcessing.ts');
    expect(pp).toMatch(/const BLOOM_RADIUS = 0\.28;/);
    expect(pp).toMatch(/const BASE_BLOOM_STRENGTH = 0\.34;/);
    expect(pp).not.toMatch(/0\.45,\s*\/\/ strength/);
    expect(pp).not.toMatch(/0\.35,\s*\/\/ radius/);
  });

  it('bloom is never disabled and composes preset × effect intensity', () => {
    const pp = read('src/rendering/PostProcessing.ts');
    expect(pp).toMatch(/this\.bloomPass\.enabled = true;/);
    expect(pp).toMatch(/BASE_BLOOM_STRENGTH \* preset\.bloomScale \* this\.effectProfile\.bloomScale/);
    expect(pp).toMatch(/strength \* scale \* this\.effectProfile\.bloomScale/);
  });

  it('exposure only scales the music LIFT, never the base exposure', () => {
    const env = read('src/world/Environment.ts');
    expect(env).toMatch(/const BASE_EXPOSURE = 1\.10;/);
    expect(env).toMatch(/const targetExposure = BASE_EXPOSURE \+ exposureLift;/);
    expect(env).toMatch(/this\.effectProfile\.exposureLiftScale/);
  });
});

// ---------------------------------------------------------------------------
// 5. Dynamic range — quieter baseline, same ceiling
// ---------------------------------------------------------------------------

describe('SongDirector — dynamic range', () => {
  function runPhase(
    director: SongDirector,
    visual: Partial<MusicVisualState>,
    frames: number,
    dt = 1 / 60,
    songTimeStart = 10
  ): void {
    for (let i = 0; i < frames; i++) {
      director.update(songTimeStart + i * dt, 0, dt, minimalVisualState(visual));
    }
  }

  it('a quiet section sits clearly below a drop', () => {
    const director = new SongDirector();

    runPhase(director, { sectionTheme: 'BREATH', energy: 0.2, progress: 0.5 }, 240);
    const quietBloom = director.state.bloomStrength;
    const quietReactivity = director.state.spectralReactivity;

    runPhase(director, { sectionTheme: 'DROP', dropImpact: 1.0, energy: 1.0, progress: 0.5 }, 240);
    const dropBloom = director.state.bloomStrength;
    const dropReactivity = director.state.spectralReactivity;

    expect(quietBloom).toBeLessThan(0.35);
    expect(dropBloom).toBeGreaterThan(0.7);
    // Real separation, not a token difference.
    expect(dropBloom).toBeGreaterThan(quietBloom * 2);

    expect(quietReactivity).toBeLessThan(0.6);
    expect(dropReactivity).toBeGreaterThan(1.2);
  });

  it('preserves the peak: the drop ceiling was not lowered', () => {
    const director = new SongDirector();
    runPhase(director, { sectionTheme: 'DROP', dropImpact: 1.0, energy: 1.0, progress: 0.5 }, 600);
    // The pre-polish drop target was 0.75 + 0.20 = 0.95 at full impact.
    expect(director.state.bloomStrength).toBeGreaterThan(0.9);
  });

  it('releases faster than it attacks', () => {
    // Cross the SAME midpoint of the quiet<->drop range in both directions, so
    // the comparison measures the envelope rate rather than the travel distance.
    const MIDPOINT = 0.575;

    const attack = new SongDirector();
    // Converge quiet first.
    runPhase(attack, { sectionTheme: 'BREATH', energy: 0.2, progress: 0.5 }, 240);
    expect(attack.state.bloomStrength).toBeLessThan(MIDPOINT);
    let attackFrames = 0;
    while (attackFrames < 600 && attack.state.bloomStrength < MIDPOINT) {
      attack.update(10 + attackFrames / 60, 0, 1 / 60, minimalVisualState({
        sectionTheme: 'DROP', dropImpact: 1.0, energy: 1.0, progress: 0.5
      }));
      attackFrames++;
    }

    const release = new SongDirector();
    runPhase(release, { sectionTheme: 'DROP', dropImpact: 1.0, energy: 1.0, progress: 0.5 }, 240);
    expect(release.state.bloomStrength).toBeGreaterThan(MIDPOINT);
    let releaseFrames = 0;
    while (releaseFrames < 600 && release.state.bloomStrength > MIDPOINT) {
      release.update(10 + releaseFrames / 60, 0, 1 / 60, minimalVisualState({
        sectionTheme: 'BREATH', energy: 0.2, progress: 0.5
      }));
      releaseFrames++;
    }

    expect(attackFrames).toBeGreaterThan(0);
    expect(releaseFrames).toBeGreaterThan(0);
    expect(releaseFrames).toBeLessThan(attackFrames);
  });

  it('the quiet reactivity floor is low but non-zero (world is never dead)', () => {
    const director = new SongDirector();
    runPhase(director, { sectionTheme: 'OUTRO', energy: 0, progress: 0.99 }, 600);
    expect(director.state.spectralReactivity).toBeGreaterThanOrEqual(0.34);
    expect(director.state.spectralReactivity).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// 6. Legibility floors survive a quiet section
// ---------------------------------------------------------------------------

describe('PlayheadSystem — gameplay legibility floors', () => {
  function beacon(channel: 'GATE_FRAME' | 'FINISH_PLANE' | 'ACCENT_TRIM', base: number) {
    const scene = new THREE.Scene();
    const system = new PlayheadSystem(scene);
    const material = new THREE.MeshStandardMaterial({ emissiveIntensity: base });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    system.registerReactive(mesh, channel);
    return { system, material };
  }

  it('a gate stays readable even when the music multiplier is near zero', () => {
    const { system, material } = beacon('GATE_FRAME', 0.55);
    system.update(
      new THREE.Vector3(),
      0,
      0,
      minimalVisualState({
        reactivityMultiplier: 0.02,
        onsetPulse: 0,
        dropImpact: 0,
        energy: 0,
        bass: 0
      })
    );
    // Floor = 0.55 * 0.54 = 0.297. A scaled floor would collapse to ~0.006.
    expect(material.emissiveIntensity).toBeGreaterThan(0.25);
    expect(material.emissiveIntensity).toBeLessThan(0.32);
  });

  it('the finish portal keeps its low resting luminance in a quiet section', () => {
    const { system, material } = beacon('FINISH_PLANE', 0.55);
    system.update(
      new THREE.Vector3(),
      0,
      0,
      minimalVisualState({ reactivityMultiplier: 0.02, onsetPulse: 0, dropImpact: 0, energy: 0 })
    );
    expect(material.emissiveIntensity).toBeGreaterThan(0.28);
  });

  it('a transient still lifts the gate far above the floor', () => {
    const { system, material } = beacon('GATE_FRAME', 0.55);
    system.update(
      new THREE.Vector3(),
      0,
      0,
      minimalVisualState({
        reactivityMultiplier: 1.32,
        onsetPulse: 1,
        dropImpact: 0.8,
        energy: 0.9,
        bass: 0.9
      })
    );
    // Drop/transient peaks must still cross the 0.88 bloom threshold.
    expect(material.emissiveIntensity).toBeGreaterThan(1.5);
  });

  it('effect intensity scales the reactive term but never the legibility floor', () => {
    const quiet = (mult: number): number => {
      const { system, material } = beacon('GATE_FRAME', 0.55);
      system.update(
        new THREE.Vector3(),
        0,
        0,
        minimalVisualState({ reactivityMultiplier: mult, onsetPulse: 0, dropImpact: 0, energy: 0 })
      );
      return material.emissiveIntensity;
    };
    // LOW vs HIGH effect intensity at the same (quiet) musical moment.
    const low = quiet(0.34 * 0.55);
    const high = quiet(0.34 * 1.18);
    expect(low).toBeGreaterThan(0.25);
    expect(high).toBeGreaterThan(0.25);
    // Both sit at the same floor when nothing is happening.
    expect(Math.abs(high - low)).toBeLessThan(0.01);
  });

  it('route trim resting opacity is no longer near maximum', () => {
    const scene = new THREE.Scene();
    const system = new PlayheadSystem(scene);
    const material = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.85 });
    const mesh = new THREE.LineSegments(new THREE.BufferGeometry(), material);
    // Node at the far edge of the presence window so the playhead-plane
    // ignition pulse is zero: this measures the true RESTING opacity.
    system.registerItem(mesh, 65, 0, 0.85, 1.0);
    system.update(
      new THREE.Vector3(),
      0,
      0,
      minimalVisualState({ energy: 0, dropImpact: 0, bass: 0, subBass: 0, reactivityMultiplier: 0.34 })
    );
    // Rest ≈ 0.85 * 0.50 = 0.425, previously ≈ 0.85 * 0.75 = 0.64.
    expect(material.opacity).toBeGreaterThan(0.35);
    expect(material.opacity).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// 7. Remote ghost readability
// ---------------------------------------------------------------------------

describe('Remote ghost — readability', () => {
  // The visual representation is shared (GhostVisual) between the live
  // multiplayer ghost and the recorded-run ghost race. The readability contract
  // lives there so the two can never drift apart.
  const bodyOf = (visual: GhostVisual): THREE.MeshBasicMaterial =>
    (visual as unknown as { bodyMaterial: THREE.MeshBasicMaterial }).bodyMaterial;
  const traceOf = (visual: GhostVisual): THREE.MeshBasicMaterial =>
    (visual as unknown as { traceMaterial: THREE.MeshBasicMaterial }).traceMaterial;

  it('has a translucent, normal-blended body that cannot add light', () => {
    const visual = new GhostVisual(new THREE.Scene(), { color: RIVAL_SIGNAL_COLOR });
    const body = bodyOf(visual);
    expect(body.transparent).toBe(true);
    expect(body.blending).toBe(THREE.NormalBlending);
    expect(body.depthWrite).toBe(false);
    expect(body.opacity).toBeGreaterThan(0.25);
    expect(body.opacity).toBeLessThan(0.55);
    visual.dispose();
  });

  it('keeps only a thin additive trace, not a wide halo', () => {
    const visual = new GhostVisual(new THREE.Scene(), { color: RIVAL_SIGNAL_COLOR });
    const trace = traceOf(visual);
    expect(trace.wireframe).toBe(true);
    expect(trace.blending).toBe(THREE.AdditiveBlending);
    expect(trace.opacity).toBeLessThan(0.3);
    visual.dispose();
  });

  it('is visually distinct from the local player accent (rival violet, not cyan)', () => {
    const visual = new GhostVisual(new THREE.Scene(), { color: RIVAL_SIGNAL_COLOR });
    expect(bodyOf(visual).color.getHex()).toBe(0x9d8cff);
    // The multiplayer renderer defaults to the same identity.
    const live = new RemoteGhostRenderer(new THREE.Scene());
    expect(bodyOf((live as unknown as { visual: GhostVisual }).visual).color.getHex()).toBe(0x9d8cff);
    live.dispose();
    visual.dispose();
  });

  it('scales with effect intensity but stays clamped and never fully disappears', () => {
    const visual = new GhostVisual(new THREE.Scene(), { color: RIVAL_SIGNAL_COLOR });
    const body = bodyOf(visual);
    const trace = traceOf(visual);

    visual.setOpacityScale(0.55);
    expect(body.opacity).toBeLessThan(0.3);
    expect(trace.opacity).toBeLessThan(0.15);

    visual.setOpacityScale(1.35);
    expect(body.opacity).toBeLessThanOrEqual(0.75);
    expect(trace.opacity).toBeLessThanOrEqual(0.5);

    // A weak tier must never erase the ghost entirely.
    visual.setOpacityScale(0.01);
    expect(body.opacity).toBeGreaterThan(0.1);
    expect(trace.opacity).toBeGreaterThan(0);

    // Invalid values are ignored, never crash.
    const before = body.opacity;
    visual.setOpacityScale(0);
    visual.setOpacityScale(Number.NaN);
    expect(body.opacity).toBe(before);
    visual.dispose();
  });

  it('the live multiplayer renderer delegates its visual to the shared component', () => {
    const live = new RemoteGhostRenderer(new THREE.Scene());
    const visual = (live as unknown as { visual: GhostVisual }).visual;
    expect(visual).toBeInstanceOf(GhostVisual);
    // Effect scaling and colour route through the shared visual.
    live.setEffectScale(0.55);
    expect(bodyOf(visual).opacity).toBeLessThan(0.3);
    live.setColor(0x123456);
    expect(bodyOf(visual).color.getHex()).toBe(0x123456);
    live.dispose();
  });
});

// ---------------------------------------------------------------------------
// 8. Quality/effect composition sanity
// ---------------------------------------------------------------------------

describe('Effect intensity composes with quality', () => {
  it('Environment owns the profile and re-applies bloom on change', () => {
    const env = read('src/world/Environment.ts');
    expect(env).toMatch(/public effectProfile: EffectIntensityProfile = resolveEffectProfile\('STANDARD'\);/);
    expect(env).toMatch(/this\.postProcessing\.setEffectIntensity\(this\.effectProfile\);/);
    expect(env).toMatch(/public setEffectIntensity\(value: EffectIntensity\)/);
  });

  it('the settings singleton still loads cleanly with the new key', () => {
    // Node environment has no localStorage: this must not throw and must
    // produce a usable settings object including the new key.
    const manager = SettingsManager.getInstance();
    expect(manager.settings.effectIntensity).toBeDefined();
    expect(['LOW', 'STANDARD', 'HIGH']).toContain(manager.settings.effectIntensity);
  });
});
