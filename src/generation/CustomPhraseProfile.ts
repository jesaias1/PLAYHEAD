/**
 * CUSTOM phrase budgeting.
 *
 * Official tracks keep the historical `section.duration * refSpeed` target
 * distance exactly. Custom audio instead sizes each section from a conservative
 * competent-speed time budget with headroom/recovery: slower ascent/precision
 * and structural sections, slightly faster flow/surf/speed. Movement physics
 * are never touched here — only how much route geometry is authored for a
 * given musical section.
 */

import { AnalysisSection, SectionTheme, TrackAnalysis } from '../audio/AudioFeatures';

export interface CustomPhraseProfile {
  isCustom: boolean;
  /** Target-distance multiplier keyed by section theme. */
  paceByTheme: Partial<Record<SectionTheme, number>>;
  /** Section themes with genuine rhythmic/structural support for surf. */
  surfThemes: Set<SectionTheme>;
}

const BASE_PACE: Record<SectionTheme, number> = {
  FLOW: 1.0,
  SURF: 1.0,
  SPEED: 1.0,
  BREATH: 0.86,
  BUILDUP: 0.82,
  DROP: 0.9,
  ASCENT: 0.78,
  PRECISION: 0.8,
  DESCENT: 0.82
};

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** True when the analysis came from the player-supplied custom path. */
export function isCustomAnalysis(analysis: TrackAnalysis): boolean {
  return analysis.customSource != null || analysis.customAggregate != null;
}

/**
 * Genuine musical support for surf on a CUSTOM track.
 *
 * Surf must be earned by rhythm or a real transition — never by sustained
 * brightness alone. A bright ambient pad (low onset density, steady energy)
 * must not receive a forced surf line. A strong energy transition (build into
 * a drop/release) or a genuinely dense rhythmic section does qualify.
 */
export function supportsCustomSurf(section: AnalysisSection, previous?: AnalysisSection | null): boolean {
  const density = clamp01(section.rhythmicDensity);
  const intensity = clamp01(section.intensity);
  const rhythmic = density >= 0.16 && intensity >= 0.4;
  const sustainedStrong = intensity >= 0.78 && density >= 0.12;
  const strongTransition =
    previous != null &&
    density >= 0.12 &&
    Math.abs(intensity - previous.intensity) >= 0.25 &&
    intensity >= 0.5;
  const structural = section.theme === 'DROP' || section.theme === 'BUILDUP' || section.theme === 'SPEED';
  return (
    (rhythmic && (structural || density >= 0.28 || intensity >= 0.62)) ||
    sustainedStrong ||
    strongTransition ||
    (structural && intensity >= 0.5 && density >= 0.12)
  );
}

/** True when ANY custom section has genuine surf support. */
export function customTrackHasSurfSupport(analysis: TrackAnalysis): boolean {
  for (let i = 0; i < analysis.sections.length; i++) {
    if (supportsCustomSurf(analysis.sections[i], i > 0 ? analysis.sections[i - 1] : null)) return true;
  }
  return false;
}

export function computeCustomPhraseProfile(analysis: TrackAnalysis): CustomPhraseProfile {
  if (!isCustomAnalysis(analysis)) {
    return { isCustom: false, paceByTheme: {}, surfThemes: new Set() };
  }

  const aggregate = analysis.customAggregate;
  const dynamics = clamp01(aggregate?.dynamics ?? 0.3);
  const sectionCount = Math.max(1, analysis.sections.length);
  const density = clamp01(
    aggregate?.density ??
      analysis.sections.reduce((sum, s) => sum + s.rhythmicDensity, 0) / sectionCount
  );

  // Conservative competent-speed pace with headroom and recovery room.
  const headroom = 0.62 + 0.08 * dynamics;
  const paceByTheme: Partial<Record<SectionTheme, number>> = {};
  for (const theme of Object.keys(BASE_PACE) as SectionTheme[]) {
    let pace = BASE_PACE[theme] * headroom;
    if (theme === 'SURF' || theme === 'FLOW' || theme === 'SPEED') {
      pace *= 1.06 + 0.06 * density;
    }
    if (theme === 'ASCENT' || theme === 'PRECISION') {
      pace *= 0.94;
    }
    paceByTheme[theme] = Math.min(1, Math.max(0.5, pace));
  }

  // Surf requires genuine rhythmic/structural support; ambient BREATH sections
  // are never selected by default.
  const surfThemes = new Set<SectionTheme>(['FLOW', 'SURF', 'SPEED', 'DROP', 'BUILDUP']);
  if (density >= 0.18) surfThemes.add('PRECISION');

  return { isCustom: true, paceByTheme, surfThemes };
}
