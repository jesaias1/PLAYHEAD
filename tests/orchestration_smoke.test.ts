import { describe, it, expect } from 'vitest';
import { MusicPack } from '../src/audio/MusicPack';

describe('Orchestration Smoke Test', () => {
  it('verifies MusicPack catalog count and first track properties', () => {
    const catalog = MusicPack.getCatalog();
    expect(catalog).toHaveLength(14);

    const firstTrack = catalog[0];
    expect(firstTrack).toBeDefined();
    expect(firstTrack.id).toBe('track_1_signal_drift');
    expect(firstTrack.title).toBe('SIGNAL DRIFT');
  });
});
