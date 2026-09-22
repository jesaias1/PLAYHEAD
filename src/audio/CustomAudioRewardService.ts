/**
 * CustomAudioRewardService: Manages first-completion cosmetic rewards
 * and anti-farming fingerprinting for Custom Audio courses in PLAYHEAD.
 *
 * Requirements:
 * - Duration >= 60.0 seconds.
 * - Course successfully finished.
 * - Rewarded only on FIRST successful completion of that unique audio signal.
 * - Renaming the file (e.g. song.mp3 -> song-final.mp3) must NOT grant another drop.
 * - Award: 1 normal SIGNAL DROP via canonical Signal Decoder.
 */

const STORAGE_CUSTOM_AUDIO_CLAIMED = 'playhead_custom_audio_claimed_v1';

export class CustomAudioRewardService {
  private static instance: CustomAudioRewardService;
  private claimedFingerprints: Set<string> = new Set();

  private constructor() {
    this.loadState();
  }

  public static getInstance(): CustomAudioRewardService {
    if (!CustomAudioRewardService.instance) {
      CustomAudioRewardService.instance = new CustomAudioRewardService();
    }
    return CustomAudioRewardService.instance;
  }

  private loadState(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(STORAGE_CUSTOM_AUDIO_CLAIMED);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          this.claimedFingerprints = new Set(arr);
        }
      }
    } catch (e) {
      console.warn('[CustomAudioRewardService] Failed to load claimed fingerprints:', e);
    }
  }

  private saveState(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(
        STORAGE_CUSTOM_AUDIO_CLAIMED,
        JSON.stringify([...this.claimedFingerprints])
      );
    } catch (e) {
      console.warn('[CustomAudioRewardService] Failed to save claimed fingerprints:', e);
    }
  }

  /**
   * Computes a stable, deterministic audio content fingerprint from decoded PCM buffer.
   * Independent of filename, file path, or metadata tags.
   */
  public static computeAudioFingerprint(buffer: AudioBuffer): string {
    const channelData = buffer.getChannelData(0);
    const totalSamples = channelData.length;
    const sampleSteps = 256;
    const step = Math.max(1, Math.floor(totalSamples / sampleSteps));

    let h1 = 0x811c9dc5;
    let sum = 0;
    for (let i = 0; i < totalSamples; i += step) {
      const val = Math.round(channelData[i] * 32767);
      sum += Math.abs(val);
      h1 ^= (val & 0xffff);
      h1 = Math.imul(h1, 0x01000193);
    }

    const durMs = Math.round(buffer.duration * 1000);
    const hashHex = (h1 >>> 0).toString(16).padStart(8, '0');
    const sumHex = (sum >>> 0).toString(16).padStart(8, '0');
    return `cafp_v1_${buffer.sampleRate}_${durMs}_${totalSamples}_${hashHex}_${sumHex}`;
  }

  public hasClaimed(fingerprint: string): boolean {
    return this.claimedFingerprints.has(fingerprint);
  }

  /** Read-only view of claimed fingerprints, for cloud reconciliation. */
  public getClaimedFingerprints(): string[] {
    return [...this.claimedFingerprints];
  }

  /**
   * Unions cloud-known fingerprints into the local set.
   *
   * Additive only: a cloud claim can never be removed locally, and a local claim
   * is never removed by a cloud sync, so a re-upload of the same audio can never
   * award a second drop on either side.
   */
  public mergeCloudClaims(fingerprints: readonly string[]): void {
    let changed = false;
    for (const fp of fingerprints) {
      if (typeof fp !== 'string' || fp.length === 0) continue;
      if (this.claimedFingerprints.has(fp)) continue;
      this.claimedFingerprints.add(fp);
      changed = true;
    }
    if (changed) this.saveState();
  }

  public checkEligibility(
    duration: number,
    fingerprint: string
  ): { eligible: boolean; statusMessage: string; reason?: 'TOO_SHORT' | 'ALREADY_CLAIMED' } {
    if (duration < 60.0) {
      return {
        eligible: false,
        statusMessage: 'SIGNAL TOO SHORT // 01:00 MIN REQUIRED',
        reason: 'TOO_SHORT'
      };
    }

    if (this.hasClaimed(fingerprint)) {
      return {
        eligible: false,
        statusMessage: 'SIGNAL ARCHIVED // COMPLETION REWARD CLAIMED',
        reason: 'ALREADY_CLAIMED'
      };
    }

    return {
      eligible: true,
      statusMessage: 'SIGNAL ACQUIRED // FIRST COMPLETION REWARD'
    };
  }

  public claimReward(fingerprint: string): boolean {
    if (this.hasClaimed(fingerprint)) {
      return false;
    }
    this.claimedFingerprints.add(fingerprint);
    this.saveState();
    return true;
  }

  public clearClaims(): void {
    this.claimedFingerprints.clear();
    this.saveState();
  }
}
