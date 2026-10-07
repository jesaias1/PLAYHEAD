import { TrackAnalysis } from '../audio/AudioFeatures';
import { GeneratedTrack } from './GenerationTypes';
import { RouteGenerator } from './RouteGenerator';
import { RouteConnectivityValidator, RouteConnectivityResult } from './RouteConnectivityValidator';
import { isCustomAnalysis } from './CustomPhraseProfile';
import { SurfCourseGenerator } from './SurfCourseGenerator';
import { SurfCourseValidator } from './SurfCourseValidator';
import { CourseType, normalizeCourseType } from './CourseType';

export interface GenerationReport {
  track: GeneratedTrack;
  /** Course style this report was generated for. */
  courseType?: CourseType;
  attempts: number;
  wasRepaired: boolean;
  wasRegenerated: boolean;
  usedSafeFallback: boolean;
  connectivity: RouteConnectivityResult;
}

export class TrackGenerator {
  public static lastReport: GenerationReport | null = null;

  /**
   * Generates a course using the requested course type. PLAYHEAD (the default)
   * is byte-for-byte the legacy pipeline; SURF uses the surf-dominant course
   * generator. The type travels onto the generated definition so cache/PB/replay
   * identity can never mix the two.
   */
  public static generate(analysis: TrackAnalysis, courseType: CourseType = 'PLAYHEAD'): GeneratedTrack {
    if (normalizeCourseType(courseType) === 'SURF') {
      return this.generateSurf(analysis);
    }
    return this.generatePlayhead(analysis);
  }

  /**
   * SURF course generation. Connectivity + surf traversal are both validated on
   * the ACTUAL final geometry; a course that fails is regenerated with a
   * derived deterministic seed and finally falls back to a guaranteed-valid
   * straight-line surf course. An impossible surf course is never shipped.
   */
  private static generateSurf(analysis: TrackAnalysis): GeneratedTrack {
    console.log(`[TrackGenerator] Generating SURF course for "${analysis.filename}" (${analysis.duration.toFixed(1)}s, ${analysis.bpm} BPM, seed: 0x${analysis.seed.toString(16)})`);
    const maxAttempts = 5;
    let attempts = 0;
    let currentAnalysis = analysis;

    while (attempts < maxAttempts) {
      attempts++;
      const track = SurfCourseGenerator.generate(currentAnalysis, 'SURF');
      const connectivity = RouteConnectivityValidator.validate(track);
      const surfValidation = SurfCourseValidator.validate(track);

      if (connectivity.isValid && surfValidation.isValid) {
        console.log(`[TrackGenerator] SURF success on attempt ${attempts}: ${connectivity.summary}`);
        this.lastReport = {
          track,
          courseType: 'SURF',
          attempts,
          wasRepaired: track.repairedJumpsCount > 0,
          wasRegenerated: attempts > 1,
          usedSafeFallback: false,
          connectivity
        };
        return track;
      }

      console.warn(`[TrackGenerator] SURF attempt ${attempts} failed validation (connectivity: ${connectivity.brokenEdges.length}, surf: ${surfValidation.issues.length}); retrying with derived seed.`);
      currentAnalysis = {
        ...currentAnalysis,
        seed: ((currentAnalysis.seed * 1664525 + 1013904223) >>> 0)
      };
    }

    const fallbackTrack = SurfCourseGenerator.generateSafeFallback(analysis);
    const fallbackValidation = RouteConnectivityValidator.validate(fallbackTrack);
    const fallbackSurf = SurfCourseValidator.validate(fallbackTrack);
    if (!fallbackValidation.isValid || !fallbackSurf.isValid) {
      // The safe fallback is built only from straight ribbons, so this is a hard
      // bug rather than an unlucky seed. Refuse to ship an invalid surf course.
      throw new Error('CUSTOM SURF COURSE COULD NOT BE VALIDATED');
    }

    this.lastReport = {
      track: fallbackTrack,
      courseType: 'SURF',
      attempts,
      wasRepaired: false,
      wasRegenerated: true,
      usedSafeFallback: true,
      connectivity: fallbackValidation
    };
    return fallbackTrack;
  }

  public static generatePlayhead(analysis: TrackAnalysis): GeneratedTrack {
    console.log(`[TrackGenerator] Generating course for "${analysis.filename}" (${analysis.duration.toFixed(1)}s, ${analysis.bpm} BPM, seed: 0x${analysis.seed.toString(16)})`);

    const maxAttempts = 5;
    let attempts = 0;
    let currentAnalysis = analysis;

    while (attempts < maxAttempts) {
      attempts++;
      const track = RouteGenerator.generate(currentAnalysis);
      const validation = RouteConnectivityValidator.validate(track);

      if (validation.isValid) {
        console.log(`[TrackGenerator] Success on attempt ${attempts}: ${validation.summary}`);
        console.log(`[TrackGenerator] Generated ${track.route.length} nodes, ${track.checkpoints.length} checkpoints, ${track.repairedJumpsCount} repaired transitions, total distance: ${track.totalDistance.toFixed(1)}m`);

        this.lastReport = {
          track,
          attempts,
          wasRepaired: track.repairedJumpsCount > 0,
          wasRegenerated: attempts > 1,
          usedSafeFallback: false,
          connectivity: validation
        };

        return track;
      }

      console.warn(`[TrackGenerator] Attempt ${attempts} failed connectivity validation: ${validation.brokenEdges.length} broken edge(s) found. Retrying with deterministic derived seed...`);
      for (const be of validation.brokenEdges) {
        console.warn(`  Broken Edge ${be.index}: ${be.from.type} -> ${be.to.type} (gap: ${be.horizontalDist.toFixed(1)}m, step: ${be.verticalDelta.toFixed(1)}m) - ${be.failureReason}`);
      }

      // Derive deterministic retry seed
      currentAnalysis = {
        ...currentAnalysis,
        seed: ((currentAnalysis.seed * 1664525 + 1013904223) >>> 0)
      };
    }

    // Defensive layer: Guaranteed safe fallback course
    console.error(`[TrackGenerator] CRITICAL: All ${maxAttempts} procedural generation attempts failed connectivity validation. Generating guaranteed safe fallback course.`);
    const fallbackTrack = RouteGenerator.generateSafeFallback(analysis);
    const fallbackValidation = RouteConnectivityValidator.validate(fallbackTrack);

    // The fallback must itself be valid. For custom audio we reject rather than
    // hand an unvalidated course to the player (Game surfaces a retry); for
    // official presets we preserve the legacy last-resort behaviour.
    if (!fallbackValidation.isValid) {
      const summary = `${fallbackValidation.brokenEdges.length} broken edge(s)`;
      if (isCustomAnalysis(analysis)) {
        console.error(`[TrackGenerator] Safe fallback failed validation for custom audio (${summary}); rejecting this analysis.`);
        throw new Error('CUSTOM COURSE COULD NOT BE VALIDATED');
      }
      console.warn(`[TrackGenerator] Safe fallback reported ${summary}; returning it as the legacy last resort.`);
    }

    this.lastReport = {
      track: fallbackTrack,
      attempts,
      wasRepaired: false,
      wasRegenerated: true,
      usedSafeFallback: true,
      connectivity: fallbackValidation
    };

    return fallbackTrack;
  }
}
