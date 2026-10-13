/**
 * SIGNAL PACK AUTHORED COMPOSITION — focused acceptance tests.
 *
 * Covers exactly the new, real behaviour added by this pass:
 *   1. Every official override declares a well-formed authored composition band
 *      (empty / dense / reveal / finish funnel); Drift + fallback stay inert.
 *   2. `compositionDensityScale` is deterministic and only ever THINS.
 *   3. The real skyline actually consumes the bands (empty zones thin clusters,
 *      dense cores are protected), and the inert path is bit-for-bit unchanged.
 *   4. `reaction.curatedThemes` names themes that REALLY occur in each track's
 *      precomputed analysis, so the bounded reaction is not pinned at gainMin.
 *   5. The FINISH_APPROACH hero frames the real finish node without intruding on
 *      gameplay (final geometry safety = 0).
 *
 * Deliberately bounded: no full-suite replay, no visual assertions.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';

import {
  SignalWorldProfileRegistry,
  FALLBACK_WORLD_PROFILE,
  SIGNAL_DRIFT_PROFILE,
  resolveCompositionBands,
  compositionDensityScale,
  INERT_COMPOSITION_BANDS
} from '../src/world/SignalWorldProfile';
import { SkylineArchitecture } from '../src/world/SkylineArchitecture';
import { SignalHeroMotifs } from '../src/world/SignalHeroMotifs';
import { WorldGeometrySafetyPass } from '../src/world/WorldGeometrySafetyPass';
import { RouteExclusionCorridor } from '../src/world/RouteExclusionCorridor';
import { PaletteSelector, TrackPalette } from '../src/audio/TrackPalettes';
import { PresetLevelCache } from '../src/audio/PresetLevelCache';
import { SpectaclePlanner } from '../src/world/SpectaclePlanner';

const presetDir = path.resolve(__dirname, '../public/music/presets');

function officialTrackIds(): string[] {
  return fs
    .readdirSync(presetDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

function loadPreset(trackId: string) {
  const json = JSON.parse(fs.readFileSync(path.resolve(presetDir, `${trackId}.json`), 'utf8'));
  const level = PresetLevelCache.buildLevelData(json);
  return { level, json };
}

describe('Signal Pack composition — authored bands are well formed', () => {
  it('every override track declares ordered in-range bands; Drift/fallback do not', () => {
    expect(resolveCompositionBands(SIGNAL_DRIFT_PROFILE)).toEqual(INERT_COMPOSITION_BANDS);
    expect(resolveCompositionBands(FALLBACK_WORLD_PROFILE)).toEqual(INERT_COMPOSITION_BANDS);

    let overrideCount = 0;
    for (const id of officialTrackIds()) {
      const profile = SignalWorldProfileRegistry.resolveForTrackId(id);
      if (!profile.usesOverride) {
        expect(resolveCompositionBands(profile).active, `${id} must stay inert`).toBe(false);
        continue;
      }
      overrideCount++;
      const b = resolveCompositionBands(profile);
      expect(b.active, `${id} must opt into composition`).toBe(true);
      for (const v of [b.lateStart, b.lateEnd, b.denseStart, b.denseEnd]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(b.lateStart).toBeLessThanOrEqual(b.lateEnd);
      expect(b.denseStart).toBeLessThanOrEqual(b.denseEnd);
      expect(b.revealArc).not.toBeNull();
      expect(b.finishFunnel).not.toBeNull();
    }
    expect(overrideCount).toBe(13);
  });

  it('authored zones genuinely separate density from restraint', () => {
    const profiles = SignalWorldProfileRegistry.all().filter((p) => p.usesOverride);
    // At least one track is genuinely EMPTY in its late zone and DENSE elsewhere,
    // i.e. the bands do not collapse to a constant factor.
    const varied = profiles.filter((p) => {
      const b = resolveCompositionBands(p);
      const at = (f: number) => compositionDensityScale(b, f);
      return at((b.lateStart + b.lateEnd) / 2) < 0.9 && at((b.denseStart + b.denseEnd) / 2) >= 0.99;
    });
    expect(varied.length).toBeGreaterThanOrEqual(10);
  });
});

describe('Signal Pack composition — density field only ever thins', () => {
  it('is identity on the inert path and bounded on the authored path', () => {
    for (let i = 0; i <= 100; i++) {
      expect(compositionDensityScale(INERT_COMPOSITION_BANDS, i / 100)).toBe(1.0);
    }
    const bands = resolveCompositionBands(
      SignalWorldProfileRegistry.resolveForTrackId('track_14_kz_ascent')
    );
    for (let i = 0; i <= 100; i++) {
      const v = compositionDensityScale(bands, i / 100);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1.0);
    }
    // Deterministic: same input, same output.
    expect(compositionDensityScale(bands, 0.42)).toBe(compositionDensityScale(bands, 0.42));
  });
});

describe('Signal Pack composition — the real skyline consumes the bands', () => {
  it('thins authored empty zones on override tracks and is untouched on the inert path', () => {
    const scene = new THREE.Scene();
    const rows: string[] = [];
    let overridesThinned = 0;
    let overrideCount = 0;

    for (const id of officialTrackIds()) {
      const { level } = loadPreset(id);
      const profile = SignalWorldProfileRegistry.resolveForTrackId(id);
      const palette = PaletteSelector.selectPalette(
        level.analysis.seed,
        0.5,
        level.analysis.globalEnergy
      );
      const sky: any = new SkylineArchitecture(scene, level.analysis, level.track, profile);
      const thinned = sky.compositionThinnedInstances as number;
      rows.push(`${id}: thinned=${thinned} impact=${sky.skylineImpact.toFixed(3)}`);

      if (!profile.usesOverride) {
        // Signal Drift keeps the exact authored composition.
        expect(thinned, `${id} inert path must not thin`).toBe(0);
        expect(sky.skylineImpact).toBe(0);
      } else {
        overrideCount++;
        // Authored bands must reach the built skyline (a track whose clusters
        // happen to miss the zone is still valid, hence the aggregate check).
        expect(resolveCompositionBands(profile).active).toBe(true);
        if (thinned > 0) overridesThinned++;
      }
    }
    console.log('[COMPOSITION THINNING]\n  ' + rows.join('\n  '));
    // The bands must genuinely reach the majority of authored worlds, not just
    // exist as inert metadata.
    expect(overridesThinned).toBeGreaterThanOrEqual(Math.ceil(overrideCount * 0.6));
  }, 180000);

  it('protects a dense core: no thinning inside the authored dense zone', () => {
    // Spot-check the arithmetic used by the builder on a track whose dense core
    // is disjoint from its empty zone.
    const profile = SignalWorldProfileRegistry.resolveForTrackId('track_7_drop_zone_surfer');
    const b = resolveCompositionBands(profile);
    const denseMid = (b.denseStart + b.denseEnd) / 2;
    const lateMid = (b.lateStart + b.lateEnd) / 2;
    expect(compositionDensityScale(b, denseMid)).toBe(1.0);
    expect(compositionDensityScale(b, lateMid)).toBeLessThan(0.5);
  });
});

describe('Signal Pack composition — musical reaction is actually reachable', () => {
  it('every curated theme occurs in the track real precomputed sections', () => {
    const rows: string[] = [];
    for (const id of officialTrackIds()) {
      const profile = SignalWorldProfileRegistry.resolveForTrackId(id);
      if (!profile.usesOverride) continue;
      const { level } = loadPreset(id);
      const themes = new Set((level.analysis.sections ?? []).map((s) => s.theme));
      const matched = profile.reaction.curatedThemes.filter((t) => themes.has(t as never));
      rows.push(`${id}: curated=[${profile.reaction.curatedThemes.join(',')}] matched=${matched.length}`);
      expect(
        matched.length,
        `${id} curatedThemes (${profile.reaction.curatedThemes.join(',')}) never occur in the track`
      ).toBeGreaterThan(0);
    }
    console.log('[CURATED THEME REACHABILITY]\n  ' + rows.join('\n  '));
  });
});

describe('Signal Pack composition — FINISH approach hero is safe', () => {
  it('frames the real finish node for KZ ASCENT without intruding on gameplay', () => {
    const { level } = loadPreset('track_14_kz_ascent');
    const profile = SignalWorldProfileRegistry.resolveForTrackId('track_14_kz_ascent');
    const palette = PaletteSelector.selectPalette(
      level.analysis.seed,
      0.5,
      level.analysis.globalEnergy
    );
    const hero = new SignalHeroMotifs(level.analysis, level.track, palette, profile);
    // The finish hero is decoration only and must build as ONE batched mesh.
    expect(hero.built).toBe(true);
    let instanced = 0;
    hero.group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) instanced++;
    });
    expect(instanced).toBe(1);

    // Final authoritative safety pass: nothing from the hero may intrude.
    const corridor = new RouteExclusionCorridor(RouteExclusionCorridor.collectGameplayNodes(level.track));
    const pass = new WorldGeometrySafetyPass(level.track, corridor);
    pass.register(hero.group, 'SignalHeroMotifs', 'DECORATION');
    const report = pass.run(new THREE.Scene());
    expect(report.finalUnsafe).toBe(0);
  }, 120000);
});

describe('Signal Pack composition — spectacle peaks stay prepared and bounded', () => {
  it('plans a small number of peaks per track from the REAL sections', () => {
    for (const id of officialTrackIds()) {
      const { level, json } = loadPreset(id);
      const planner = new SpectaclePlanner();
      planner.plan(level.analysis, level.track);
      // A handful of prepared peaks, never one per kick.
      expect(planner.events.length).toBeGreaterThanOrEqual(3);
      expect(planner.events.length).toBeLessThanOrEqual(6);
      expect(planner.events.filter((e) => e.isSignature).length).toBe(1);
      // Cooldown respected (no spamming).
      for (let i = 1; i < planner.events.length; i++) {
        expect(planner.events[i].triggerTime - planner.events[i - 1].triggerTime).toBeGreaterThanOrEqual(20 - 0.001);
      }
      // The shipped preset already carries prepared events.
      const shipped = (json.spectacleEvents ?? []).length;
      if (shipped > 0) expect(shipped).toBeLessThanOrEqual(6);
    }
  }, 120000);
});
