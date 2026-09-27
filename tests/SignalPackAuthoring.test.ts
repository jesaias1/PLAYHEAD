/**
 * OFFICIAL SIGNAL PACK AUTHORING GATE.
 *
 * This is both the automated validation gate and the authoring report. It is
 * the thing that answers, for every shipped official track:
 *
 *   - does an authored profile exist at all?
 *   - does that profile describe the REAL track (sections, song length, surf)?
 *   - what does the route actually contain?
 *   - is the rank target achievable before the music ends?
 *
 * Run it directly for the report:
 *   npx vitest run tests/SignalPackAuthoring.test.ts
 *   SIGNALPACK_TRACK=track_1_signal_drift npx vitest run tests/SignalPackAuthoring.test.ts
 *
 * WHY IT IS A TEST AND NOT A SCRIPT
 *
 * The profiles are TypeScript in `src/`. Node's type stripping cannot resolve
 * the repo's extensionless relative imports, and duplicating the profiles into a
 * `.mjs` tool would guarantee drift. Running inside vitest means the gate uses
 * the SAME module graph the game does, so it cannot validate a stale copy.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  OFFICIAL_PROFILE_VERSION,
  SIGNAL_PACK_CONTENT_VERSION,
  audioMarginSeconds,
  estimateRankTargets,
  rankTimesFor,
  validateOfficialProfile
} from '../src/generation/OfficialTrackProfile';
import {
  OFFICIAL_TRACK_PROFILES,
  SIGNAL_PACK_BANDS,
  getOfficialProfile
} from '../src/generation/OfficialSignalPack';
import type { GeneratedTrack } from '../src/generation/GenerationTypes';

const PRESET_DIR = resolve(__dirname, '..', 'public', 'music', 'presets');

interface PresetSummary {
  trackId: string;
  title: string;
  bpm: number;
  songSeconds: number;
  sectionCount: number;
  track: GeneratedTrack;
}

function loadPresets(): PresetSummary[] {
  const out: PresetSummary[] = [];
  for (const file of readdirSync(PRESET_DIR).filter((f) => f.endsWith('.json')).sort()) {
    const raw = JSON.parse(readFileSync(join(PRESET_DIR, file), 'utf8')) as {
      trackId: string;
      title: string;
      bpm: number;
      analysis?: { duration?: number; sections?: unknown[] };
      track?: GeneratedTrack;
    };
    if (!raw.track) continue;
    out.push({
      trackId: raw.trackId,
      title: raw.title,
      bpm: raw.bpm,
      songSeconds: raw.analysis?.duration ?? 0,
      sectionCount: raw.analysis?.sections?.length ?? 0,
      track: raw.track
    });
  }
  return out;
}

const ALL_PRESETS = loadPresets();
const FILTER = process.env.SIGNALPACK_TRACK;
const PRESETS = FILTER ? ALL_PRESETS.filter((p) => p.trackId === FILTER) : ALL_PRESETS;

// ---------------------------------------------------------------------------
// 1. Coverage: every shipped track is authored, and nothing is orphaned
// ---------------------------------------------------------------------------

describe('Official Signal Pack authoring coverage', () => {
  it('ships 14 official tracks', () => {
    expect(ALL_PRESETS).toHaveLength(14);
  });

  it('every shipped official track has an authored profile', () => {
    const missing = ALL_PRESETS.map((p) => p.trackId).filter((id) => !getOfficialProfile(id));
    expect(missing, `unauthored tracks: ${missing.join(', ')}`).toEqual([]);
  });

  it('every authored profile points at a real shipped track', () => {
    const shipped = new Set(ALL_PRESETS.map((p) => p.trackId));
    const orphans = OFFICIAL_TRACK_PROFILES.map((p) => p.trackId).filter((id) => !shipped.has(id));
    expect(orphans, `profiles with no track: ${orphans.join(', ')}`).toEqual([]);
  });

  it('no duplicate profiles', () => {
    const ids = OFFICIAL_TRACK_PROFILES.map((p) => p.trackId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// 2. Every profile validates against the REAL track it describes
// ---------------------------------------------------------------------------

describe('Official profile validation', () => {
  it('reports zero issues for every profile', () => {
    const allIssues: string[] = [];
    for (const preset of PRESETS) {
      const profile = getOfficialProfile(preset.trackId);
      if (!profile) continue;
      const issues = validateOfficialProfile(
        profile,
        preset.track,
        preset.songSeconds,
        preset.sectionCount
      );
      for (const issue of issues) {
        allIssues.push(`${issue.trackId} [${issue.field}] ${issue.detail}`);
      }
    }
    expect(allIssues, allIssues.join('\n')).toEqual([]);
  });

  it('the validator actually rejects a bad profile', () => {
    const preset = ALL_PRESETS[0];
    const good = getOfficialProfile(preset.trackId)!;

    // A section index that does not exist.
    const badSection = {
      ...good,
      sectionPhrases: [{ sectionIndex: 999, phrase: 'RUN' as const, density: 'SPARSE' as const, primary: 'RUN' as const }]
    };
    expect(validateOfficialProfile(badSection, preset.track, preset.songSeconds, preset.sectionCount))
      .toEqual(expect.arrayContaining([expect.objectContaining({ field: 'sectionPhrases' })]));

    // A spectacle outside the song.
    const badSpectacle = {
      ...good,
      spectacle: [{ atSeconds: preset.songSeconds + 500, intent: 'SIGNAL_BURST' as const }]
    };
    expect(validateOfficialProfile(badSpectacle, preset.track, preset.songSeconds, preset.sectionCount))
      .toEqual(expect.arrayContaining([expect.objectContaining({ field: 'spectacle' })]));

    // Too many motifs.
    const badMotifs = {
      ...good,
      dream: { ...good.dream, motifs: ['ARCHES', 'MONOLITHS', 'BLACK_SLABS', 'RUINED_PILLARS'] as const }
    };
    expect(validateOfficialProfile(badMotifs, preset.track, preset.songSeconds, preset.sectionCount))
      .toEqual(expect.arrayContaining([expect.objectContaining({ field: 'dream.motifs' })]));

    // An ENABLED rank target justified only by a formula.
    const badRank = {
      ...good,
      rankTargets: { enabled: true, targetTimeSeconds: 60, basis: 'GEOMETRIC_ESTIMATE' as const }
    };
    expect(validateOfficialProfile(badRank, preset.track, preset.songSeconds, preset.sectionCount))
      .toEqual(expect.arrayContaining([expect.objectContaining({ field: 'rankTargets.basis' })]));
  });

  it('no shipped profile enables a rank target without human evidence', () => {
    // Authoring must never silently change what Diamond means.
    for (const profile of OFFICIAL_TRACK_PROFILES) {
      const rt = profile.rankTargets;
      if (!rt) continue;
      if (rt.enabled) {
        expect(['HUMAN_PLAYTEST', 'RECORDED_RUNS'], profile.trackId).toContain(rt.basis);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Identity and difficulty structure
// ---------------------------------------------------------------------------

describe('Movement identity and difficulty curve', () => {
  it('every profile states a distinct design intent', () => {
    const intents = OFFICIAL_TRACK_PROFILES.map((p) => p.intent.trim().toLowerCase());
    expect(new Set(intents).size, 'two tracks share a design intent').toBe(intents.length);
    for (const p of OFFICIAL_TRACK_PROFILES) {
      expect(p.intent.length, `${p.trackId} intent is too short`).toBeGreaterThan(40);
    }
  });

  it('uses at least five different movement identities across the pack', () => {
    const identities = new Set(OFFICIAL_TRACK_PROFILES.map((p) => p.movementIdentity));
    expect(identities.size).toBeGreaterThanOrEqual(5);
  });

  it('no single identity dominates more than a third of the pack', () => {
    const counts = new Map<string, number>();
    for (const p of OFFICIAL_TRACK_PROFILES) {
      counts.set(p.movementIdentity, (counts.get(p.movementIdentity) ?? 0) + 1);
    }
    const max = Math.max(...counts.values());
    expect(max, `identity spread: ${[...counts.entries()].map(([k, v]) => k + ':' + v).join(' ')}`)
      .toBeLessThanOrEqual(5);
  });

  it('the difficulty bands form a non-decreasing curve in pack order', () => {
    const order = new Map(SIGNAL_PACK_BANDS.map((b, i) => [b, i]));
    const ranks = OFFICIAL_TRACK_PROFILES.map((p) => order.get(p.band) ?? 0);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i], `band regressed at ${OFFICIAL_TRACK_PROFILES[i].trackId}`)
        .toBeGreaterThanOrEqual(ranks[i - 1]);
    }
  });

  it('the first track is an entry point, not a mastery test', () => {
    expect(OFFICIAL_TRACK_PROFILES[0].band).toBe('ENTRY');
    expect(OFFICIAL_TRACK_PROFILES[0].movementIdentity).toBe('FLOW');
  });

  it('every profile carries a short movement tagline', () => {
    for (const p of OFFICIAL_TRACK_PROFILES) {
      expect(p.tagline.length, p.trackId).toBeLessThanOrEqual(28);
      expect(p.tagline).toMatch(/^[A-Z]+ \/ [A-Z]+$/);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Rank calibration: is a clean run achievable before the music ends?
// ---------------------------------------------------------------------------

describe('Rank target calibration', () => {
  it('reports a geometric estimate for every track', () => {
    for (const preset of PRESETS) {
      const estimate = estimateRankTargets(preset.track);
      expect(Number.isFinite(estimate.estimateSeconds), preset.trackId).toBe(true);
      expect(estimate.estimateSeconds, preset.trackId).toBeGreaterThan(0);
      expect(estimate.distanceMeters, preset.trackId).toBeGreaterThan(0);
    }
  });

  it('the estimator is physics-derived, not arbitrary', () => {
    const preset = ALL_PRESETS[0];
    const a = estimateRankTargets(preset.track);
    // Same track twice must give the same number: it is deterministic.
    const b = estimateRankTargets(preset.track);
    expect(a.estimateSeconds).toBeCloseTo(b.estimateSeconds, 6);
    // A synthetic longer route must estimate longer.
    const longer: GeneratedTrack = {
      ...preset.track,
      route: preset.track.route.map((n) => ({ ...n, position: { ...n.position, z: n.position.z * 2 } }))
    };
    expect(estimateRankTargets(longer).estimateSeconds).toBeGreaterThan(a.estimateSeconds);
  });

  it('rank bands are ordered and monotonic', () => {
    const times = rankTimesFor(100);
    expect(times.DIAMOND).toBeLessThan(times.GOLD);
    expect(times.GOLD).toBeLessThan(times.SILVER);
    expect(times.SILVER).toBeLessThan(times.BRONZE);
  });
});

// ---------------------------------------------------------------------------
// 5. AUTHORING REPORT
// ---------------------------------------------------------------------------

describe('Authoring report', () => {
  it('prints the per-track table', () => {
    const pad = (v: unknown, n: number) => String(v).padEnd(n);
    const num = (v: unknown, n: number) => String(v).padStart(n);
    const lines: string[] = [];
    lines.push('');
    lines.push(`SIGNAL PACK CONTENT v${SIGNAL_PACK_CONTENT_VERSION}  //  PROFILE v${OFFICIAL_PROFILE_VERSION}`);
    lines.push('');
    lines.push(
      pad('track', 34) + pad('band', 13) + pad('identity', 11) + pad('surf', 10) +
      num('nodes', 6) + num('surfN', 6) + num('cps', 5) + num('spec', 5) +
      num('song', 7) + num('est', 7) + num('margin', 8) + '  intent'
    );

    for (const preset of PRESETS) {
      const p = getOfficialProfile(preset.trackId);
      if (!p) continue;
      const est = estimateRankTargets(preset.track);
      const cps = preset.track.checkpoints.length;
      const surfNodes = preset.track.route.filter((n) => n.isSurf).length;
      const margin = audioMarginSeconds(est.estimateSeconds, preset.songSeconds);
      lines.push(
        pad(preset.trackId, 34) + pad(p.band, 13) + pad(p.movementIdentity, 11) +
        pad(p.surfPolicy, 10) + num(preset.track.route.length, 6) + num(surfNodes, 6) +
        num(cps, 5) + num(p.spectacle?.length ?? 0, 5) +
        num(preset.songSeconds.toFixed(1), 7) + num(est.estimateSeconds.toFixed(1), 7) +
        num(margin.toFixed(1), 8) + '  ' + p.tagline
      );
    }

    lines.push('');
    lines.push('est = physics-derived achievable-time estimate (ESTIMATE, not a calibrated target)');
    lines.push('margin = song seconds remaining after the estimate; negative means overtime for a clean run');
    lines.push('');
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));
    expect(lines.length).toBeGreaterThan(PRESETS.length);
  });
});
