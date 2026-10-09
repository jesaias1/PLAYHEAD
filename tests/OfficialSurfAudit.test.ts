import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { SignalPackCatalog } from '../src/audio/SignalPackCatalog';
import { PresetLevelCache } from '../src/audio/PresetLevelCache';
import { TrackGenerator } from '../src/generation/TrackGenerator';
import { SurfCourseValidator } from '../src/generation/SurfCourseValidator';

describe('official Surf course geometry audit', () => {
  it('audits the final generated route for every shipped track', () => {
    const report = SignalPackCatalog.getTracks().map(entry => {
      const { analysis } = PresetLevelCache.buildLevelData(JSON.parse(readFileSync(`public/music/presets/${entry.id}.json`, 'utf8')));
      const track = TrackGenerator.generate(analysis, 'SURF');
      expect(entry.duration, `${entry.id} menu duration`).toBeCloseTo(analysis.duration, 3);
      const validation = SurfCourseValidator.validate(track);
      expect(validation.issues, entry.id).toEqual([]);
      expect(track.targetDuration, entry.id).toBeCloseTo(analysis.duration, 3);
      expect(track.obstacles?.length, entry.id).toBeGreaterThan(0);
      const ribbons = new Set(track.route.filter(node => node.ribbon).map(node => node.ribbonId));
      const transfers = track.route.filter(node => node.surfTransition === 'AIR').length;
      expect(ribbons.size, entry.id).toBeGreaterThan(3);
      expect(transfers, entry.id).toBeGreaterThan(0);
      return { track: entry.id, songSeconds: analysis.duration, targetSeconds: track.targetDuration,
        distanceMetres: track.totalDistance, ribbons: ribbons.size, airTransfers: transfers,
        obstacles: track.obstacles?.length, surfDistanceFraction: validation.surfFraction,
        geometryIssues: validation.issues };
    });
    if (process.env.WRITE_SURF_AUDIT === '1') {
      mkdirSync('work', { recursive: true });
      writeFileSync('work/official-surf-audit.json', JSON.stringify(report, null, 2));
    }
  });
});
