import { describe, it, expect, beforeEach } from 'vitest';
import { LeaderboardManager } from '../src/leaderboard/LeaderboardManager';
import { RunResults } from '../player/PlayerStats';

function createLocalStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, String(value)); }
  };
}

function makeMockResults(overrides: Partial<RunResults> = {}): RunResults {
  return {
    completionTime: 45.234,
    targetTime: 60.0,
    score: 12500,
    rank: 'GOLD',
    fallsCount: 0,
    maxSpeed: 820,
    averageSpeed: 640,
    strafeEfficiency: 85,
    ...overrides
  };
}

describe('LeaderboardManager', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createLocalStorageMock(),
      configurable: true,
      writable: true
    });
    (LeaderboardManager as any).instance = undefined;
  });

  it('returns empty record summary when no runs have been recorded', () => {
    const lm = LeaderboardManager.getInstance();
    const summary = lm.getRecordSummary('track_01');
    expect(summary.bestRank).toBeNull();
    expect(summary.pbTime).toBeNull();
    expect(summary.localFirstTime).toBeNull();
  });

  it('records official run and establishes PB and Local #1', () => {
    const lm = LeaderboardManager.getInstance();
    const res = makeMockResults({ completionTime: 50.123, score: 10000, rank: 'SILVER' });

    const outcome = lm.recordOfficialRun('track_01', 1337, res, true);
    expect(outcome.isNewPB).toBe(true);
    expect(outcome.isNewLocalFirst).toBe(true);

    const summary = lm.getRecordSummary('track_01');
    expect(summary.bestRank).toBe('SILVER');
    expect(summary.pbTime).toBe(50.123);
    expect(summary.localFirstTime).toBe(50.123);
  });

  it('does not overwrite PB or Local #1 on slower subsequent runs, but upgrades rank', () => {
    const lm = LeaderboardManager.getInstance();
    lm.recordOfficialRun('track_01', 1337, makeMockResults({ completionTime: 40.0, rank: 'SILVER' }), true);

    // Slower run, but higher rank (e.g. perfect strafe efficiency / score)
    const slower = lm.recordOfficialRun('track_01', 1337, makeMockResults({ completionTime: 42.5, rank: 'GOLD' }), true);
    expect(slower.isNewPB).toBe(false);
    expect(slower.isNewLocalFirst).toBe(false);

    const summary = lm.getRecordSummary('track_01');
    expect(summary.bestRank).toBe('GOLD');
    expect(summary.pbTime).toBe(40.0);
    expect(summary.localFirstTime).toBe(40.0);
  });

  it('updates PB and Local #1 on faster subsequent runs', () => {
    const lm = LeaderboardManager.getInstance();
    lm.recordOfficialRun('track_01', 1337, makeMockResults({ completionTime: 45.0, rank: 'SILVER' }), true);

    const faster = lm.recordOfficialRun('track_01', 1337, makeMockResults({ completionTime: 38.2, rank: 'DIAMOND' }), true);
    expect(faster.isNewPB).toBe(true);
    expect(faster.isNewLocalFirst).toBe(true);

    const summary = lm.getRecordSummary('track_01');
    expect(summary.bestRank).toBe('DIAMOND');
    expect(summary.pbTime).toBe(38.2);
    expect(summary.localFirstTime).toBe(38.2);
  });

  it('ignores invalid or UNRANKED runs for official records', () => {
    const lm = LeaderboardManager.getInstance();
    const res = makeMockResults({ completionTime: 30.0, rank: 'UNRANKED' });

    const out1 = lm.recordOfficialRun('track_01', 1337, res, true);
    expect(out1.isNewPB).toBe(false);
    expect(out1.isNewLocalFirst).toBe(false);

    const out2 = lm.recordOfficialRun('track_01', 1337, makeMockResults({ rank: 'GOLD' }), false);
    expect(out2.isNewPB).toBe(false);
    expect(out2.isNewLocalFirst).toBe(false);

    expect(lm.getRecord('track_01')).toBeNull();
  });

  it('validates leaderboard eligibility correctly', () => {
    const lm = LeaderboardManager.getInstance();

    expect(lm.canSubmitToLeaderboard({ isOfficial: true, isValid: true, rank: 'GOLD' })).toBe(true);
    expect(lm.canSubmitToLeaderboard({ isOfficial: false, isValid: true, rank: 'GOLD' })).toBe(false); // Custom audio
    expect(lm.canSubmitToLeaderboard({ isOfficial: true, isValid: false, rank: 'GOLD' })).toBe(false); // Cheated/invalid
    expect(lm.canSubmitToLeaderboard({ isOfficial: true, isValid: true, rank: 'UNRANKED' })).toBe(false);
    expect(lm.canSubmitToLeaderboard({ isOfficial: true, isValid: true, rank: undefined })).toBe(false);
  });

  it('prepares and queues submission candidates with deduplication and persistence', () => {
    const lm = LeaderboardManager.getInstance();
    const candidate = lm.prepareSubmissionCandidate(
      'track_01',
      'CHRONO DUST',
      4242,
      makeMockResults({ completionTime: 44.123, rank: 'GOLD' }),
      true
    );

    expect(candidate.version).toBe(1);
    expect(candidate.status).toBe('QUEUED_LOCAL');
    expect(candidate.trackId).toBe('track_01');
    expect(candidate.trackTitle).toBe('CHRONO DUST');
    expect(candidate.seed).toBe(4242);
    expect(candidate.completionTime).toBe(44.123);
    expect(candidate.clientBuild).toBeDefined();

    // Queue candidate
    const queued = lm.queueSubmission(candidate);
    expect(queued).toBe(true);
    expect(lm.isCandidateQueued(candidate.submissionId)).toBe(true);
    expect(lm.getQueuedSubmissions()).toHaveLength(1);

    // Duplicate candidate within 1s is rejected
    const dupQueued = lm.queueSubmission({ ...candidate, submissionId: 'sub_different' });
    expect(dupQueued).toBe(true);
    expect(lm.getQueuedSubmissions()).toHaveLength(1); // Length unchanged due to deduplication

    // New instance loads queue from storage
    (LeaderboardManager as any).instance = undefined;
    const lm2 = LeaderboardManager.getInstance();
    expect(lm2.getQueuedSubmissions()).toHaveLength(1);
    expect(lm2.getQueuedSubmissions()[0].trackId).toBe('track_01');

    // Clear queue
    lm2.clearQueue();
    expect(lm2.getQueuedSubmissions()).toHaveLength(0);
  });
});
