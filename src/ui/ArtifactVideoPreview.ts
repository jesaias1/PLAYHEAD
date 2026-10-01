/** One silent presentation decoder, created only for a focused owned Artifact. */
export function attachArtifactVideoPreview(container: HTMLElement, path: string): () => void {
  const video = document.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.volume = 0;
  video.loop = true;
  video.playsInline = true;
  video.controls = false;
  video.preload = 'metadata';
  video.setAttribute('aria-hidden', 'true');
  video.style.cssText = 'display:block;width:100%;max-height:140px;object-fit:cover;pointer-events:none;margin-top:12px;opacity:.85';
  video.src = path;
  container.appendChild(video);
  void video.play().catch(() => undefined);
  return () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
  };
}
