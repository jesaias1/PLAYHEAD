import { describe, it, expect, beforeEach } from 'vitest';
import { CustomAudioRewardService } from '../src/audio/CustomAudioRewardService';

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

function createMockAudioBuffer(samples: number, sampleRate = 44100, freqMultiplier = 1.0): AudioBuffer {
  const channelData = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    channelData[i] = Math.sin((i / 44.1) * freqMultiplier);
  }
  return {
    sampleRate,
    length: samples,
    duration: samples / sampleRate,
    numberOfChannels: 1,
    getChannelData: () => channelData
  } as unknown as AudioBuffer;
}

describe('CustomAudioRewardService', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createLocalStorageMock(),
      configurable: true,
      writable: true
    });
    (CustomAudioRewardService as any).instance = undefined;
  });

  it('generates a stable deterministic fingerprint independent of filename or external state', () => {
    // 60 seconds of 44100Hz audio
    const bufferA = createMockAudioBuffer(44100 * 60, 44100, 1.0);
    // Simulating "renamed file" with identical decoded PCM data
    const bufferARenamed = createMockAudioBuffer(44100 * 60, 44100, 1.0);

    const fp1 = CustomAudioRewardService.computeAudioFingerprint(bufferA);
    const fp2 = CustomAudioRewardService.computeAudioFingerprint(bufferARenamed);

    expect(fp1).toBe(fp2);
    expect(fp1.startsWith('cafp_v1_')).toBe(true);

    // Different audio content generates a different fingerprint
    const bufferB = createMockAudioBuffer(44100 * 60, 44100, 2.5);
    const fp3 = CustomAudioRewardService.computeAudioFingerprint(bufferB);
    expect(fp3).not.toBe(fp1);
  });

  it('enforces >=60.0s duration qualification check', () => {
    const service = CustomAudioRewardService.getInstance();
    const fp = 'test_fingerprint_01';

    // 59.9 seconds -> rejected
    const tooShort = service.checkEligibility(59.9, fp);
    expect(tooShort.eligible).toBe(false);
    expect(tooShort.reason).toBe('TOO_SHORT');
    expect(tooShort.statusMessage).toContain('01:00 MIN REQUIRED');

    // 60.0 seconds -> eligible
    const qualified = service.checkEligibility(60.0, fp);
    expect(qualified.eligible).toBe(true);
    expect(qualified.reason).toBeUndefined();
    expect(qualified.statusMessage).toContain('FIRST COMPLETION REWARD');
  });

  it('latches reward on first claim and denies repeated claims for the same fingerprint (anti-farming)', () => {
    const service = CustomAudioRewardService.getInstance();
    const fp = 'test_fingerprint_unique';

    expect(service.hasClaimed(fp)).toBe(false);

    // First claim succeeds
    const firstClaim = service.claimReward(fp);
    expect(firstClaim).toBe(true);
    expect(service.hasClaimed(fp)).toBe(true);

    // Repeated claim fails
    const secondClaim = service.claimReward(fp);
    expect(secondClaim).toBe(false);

    // Eligibility check now reports already claimed
    const checkAfterClaim = service.checkEligibility(90.0, fp);
    expect(checkAfterClaim.eligible).toBe(false);
    expect(checkAfterClaim.reason).toBe('ALREADY_CLAIMED');
    expect(checkAfterClaim.statusMessage).toContain('SIGNAL ARCHIVED');

    // Claim state is persistent across instance reload
    (CustomAudioRewardService as any).instance = undefined;
    const reloadedService = CustomAudioRewardService.getInstance();
    expect(reloadedService.hasClaimed(fp)).toBe(true);
  });

  it('clears claims successfully when requested', () => {
    const service = CustomAudioRewardService.getInstance();
    const fp = 'test_fp';
    service.claimReward(fp);
    expect(service.hasClaimed(fp)).toBe(true);

    service.clearClaims();
    expect(service.hasClaimed(fp)).toBe(false);
  });
});
