import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildShareCardModel, drawShareCard, formatShareTime, performResultShare } from '../src/ui/ResultShare';
import type { ShareContext } from '../src/ui/ResultShare';

const context = (): ShareContext => ({
  results: { completionTime: 59.9998, targetTime: 60, syncDelta: -0.0002, maxSpeed: 1200,
    averageSpeed: 900, strafeEfficiency: 87, fallsCount: 0, restartsCount: 0, rank: 'DIAMOND', score: 10000 },
  trackTitle: 'Signal Drift', mode: 'NORMAL', isOfficial: true, isCustomAudio: false,
  isOvertime: false, submittedToWorld: false
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('finished result sharing', () => {
  it('carries rounding into the next minute and snapshots finished results', () => {
    const ctx = context(), model = buildShareCardModel(ctx);
    ctx.results.rank = 'UNRANKED'; ctx.results.completionTime = 8;
    expect(model.rankLine).toBe('RANK // DIAMOND');
    expect(model.timeLine).toBe('01:00.000');
    expect(formatShareTime(NaN)).toBe('--:--.---');
  });
  it('keeps custom Surf, overtime, and accepted board claims honest', () => {
    const ctx = context(); ctx.mode = 'SURF'; ctx.isCustomAudio = true; ctx.submittedToWorld = true;
    let model = buildShareCardModel(ctx);
    expect(model.modeLine).toContain('SURF // CUSTOM AUDIO');
    expect(model.verificationLine).toContain('LOCAL RUN');
    ctx.isCustomAudio = false; ctx.isOvertime = true;
    expect(buildShareCardModel(ctx).verificationLine).toContain('OVERTIME');
    ctx.isOvertime = false; model = buildShareCardModel(ctx);
    expect(model.verificationLine).toContain('ACCEPTED');
    expect(model.text).not.toContain('SERVER-VERIFIED');
  });
  it('bounds long track titles and retains unranked identity in the PNG', () => {
    const ctx = context(); ctx.trackTitle = 'X'.repeat(200); ctx.results.rank = 'UNRANKED';
    const fillText = vi.fn();
    drawShareCard({ font: '', fillStyle: '', textAlign: 'left', textBaseline: 'alphabetic',
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText, measureText: text => ({ width: text.length * 38 }) }, buildShareCardModel(ctx));
    expect(fillText.mock.calls[1][0].length).toBeLessThan(30);
    expect(fillText.mock.calls.some(call => call[0] === 'UNRANKED')).toBe(true);
  });
  it('downloads a real PNG and reports clipboard denial without claiming copy success', async () => {
    const download = vi.fn(), blob = new Blob(['png'], { type: 'image/png' });
    const outcome = await performResultShare(buildShareCardModel(context()), {
      renderPng: async () => blob, download, writeText: async () => { throw new Error('denied'); }
    });
    expect(download).toHaveBeenCalledWith(blob, 'playhead-signal-drift-official.png');
    expect(outcome).toMatchObject({ downloaded: true, copied: false, detail: 'CLIPBOARD BLOCKED' });
  });
  it('passes PNG bytes in a File to native sharing and preserves cancellation', async () => {
    class TestFile extends Blob { constructor(parts: BlobPart[], public name: string, options: BlobPropertyBag) { super(parts, options); } }
    vi.stubGlobal('File', TestFile);
    const download = vi.fn();
    const share = vi.fn(async data => {
      expect(await data.files[0].text()).toBe('real PNG bytes');
      throw Object.assign(new Error('cancel'), { name: 'AbortError' });
    });
    const outcome = await performResultShare(buildShareCardModel(context()), {
      renderPng: async () => new Blob(['real PNG bytes']), canShare: () => true, share, download
    });
    expect(outcome.state).toBe('CANCELLED'); expect(download).not.toHaveBeenCalled();
  });
  it('falls back when capability detection throws, and reports a total failure', async () => {
    const copied = vi.fn();
    const outcome = await performResultShare(buildShareCardModel(context()), {
      renderPng: async () => { throw new Error('canvas'); }, writeText: copied,
      canShare: () => { throw new Error('unsupported'); }
    });
    expect(outcome.copied).toBe(true); expect(outcome.downloaded).toBe(false);
    const failed = await performResultShare(buildShareCardModel(context()), {});
    expect(failed.state).toBe('FAILED');
  });
  it('does not leave a downloaded card stuck on a pending clipboard prompt', async () => {
    vi.useFakeTimers();
    const pending = performResultShare(buildShareCardModel(context()), {
      renderPng: async () => new Blob(['png']), download: vi.fn(), writeText: () => new Promise(() => {})
    });
    await vi.advanceTimersByTimeAsync(2001);
    expect(await pending).toMatchObject({ downloaded: true, copied: false, detail: 'CLIPBOARD BLOCKED' });
  });
});
