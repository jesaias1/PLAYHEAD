import { expect, it, vi } from 'vitest';
import { attachArtifactVideoPreview } from '../src/ui/ArtifactVideoPreview';

it('keeps focused previews silent and releases the decoder on dismissal', () => {
  const video: any = {
    style: {}, setAttribute: vi.fn(), play: vi.fn().mockRejectedValue(new Error('autoplay blocked')),
    pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn(), remove: vi.fn()
  };
  vi.stubGlobal('document', { createElement: vi.fn(() => video) });
  try {
    const container = { appendChild: vi.fn() } as unknown as HTMLElement;
    const release = attachArtifactVideoPreview(container, '/assets/viewmodel/karambit/videos/signalism.mp4');
    expect(video).toMatchObject({ muted: true, defaultMuted: true, volume: 0, loop: true, playsInline: true, controls: false });
    expect(video.style.cssText).toContain('pointer-events:none');
    expect(container.appendChild).toHaveBeenCalledWith(video);
    release();
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.removeAttribute).toHaveBeenCalledWith('src');
    expect(video.load).toHaveBeenCalledOnce();
    expect(video.remove).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});
