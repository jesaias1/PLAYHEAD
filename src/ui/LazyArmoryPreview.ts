import type { ArmoryPreview, ArmoryPreviewMode, ArmoryPreviewSelection } from './ArmoryPreview';

/** Load the inspection UI only when needed, retaining the latest selection. */
export class LazyArmoryPreview {
  private instance: ArmoryPreview | null = null;
  private loading = false;
  private disposed = false;
  private visible = false;
  private host: HTMLElement | null = null;
  private selection: ArmoryPreviewSelection | null = null;

  public mount(host: HTMLElement): void { this.host = host; this.sync(); }
  public update(selection: ArmoryPreviewSelection): void { this.selection = { ...selection }; this.sync(); }
  public show(): void { this.visible = true; this.sync(); }
  public hide(): void { this.visible = false; this.instance?.hide(); }
  public setMode(_mode: ArmoryPreviewMode): void { /* The preview supports only item mode. */ }
  public getMode(): ArmoryPreviewMode { return 'item'; }
  public dispose(): void { this.disposed = true; this.instance?.dispose(); this.instance = null; this.host = null; }

  private sync(): void {
    if (this.disposed || !this.visible || !this.host || !this.selection) return;
    if (this.instance) {
      this.instance.mount(this.host);
      this.instance.update(this.selection);
      this.instance.show();
      return;
    }
    if (this.loading) return;
    this.loading = true;
    this.host.textContent = 'LOADING PREVIEW…';
    void import('./ArmoryPreview').then(({ ArmoryPreview }) => {
      if (this.disposed) return;
      if (this.host) this.host.textContent = '';
      this.instance = new ArmoryPreview();
      this.sync();
    }).catch(() => {
      if (this.host && !this.disposed) this.host.textContent = 'PREVIEW UNAVAILABLE // SELECT AGAIN TO RETRY';
    }).finally(() => { this.loading = false; });
  }
}
