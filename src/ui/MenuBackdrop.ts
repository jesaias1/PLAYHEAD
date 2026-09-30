/**
 * MENU BACKDROP — the frontend's living world.
 *
 * A single 2D canvas behind the main menu: deep sky, sparse stars, two layers
 * of distant megastructure silhouettes with signal slits, a horizon glow in the
 * selected track's colour, a faint perspective grid in the abyss below, and a
 * slow signal waveform running along the horizon. When a preview is playing,
 * the waveform and horizon answer the audio.
 *
 * Cheap by construction: CSS-pixel resolution, one canvas, and the loop only
 * runs while the menu is visible.
 */

interface Tower {
  x: number;
  w: number;
  h: number;
  slits: number[];
  layer: 0 | 1;
}

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  tw: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class MenuBackdrop {
  public readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private towers: Tower[] = [];
  private stars: Star[] = [];
  private accent: [number, number, number] = [0, 240, 255];
  private targetAccent: [number, number, number] = [0, 240, 255];
  private fingerprint: number[] = [];
  private running = false;
  private raf = 0;
  private t0 = performance.now();
  private mouseX = 0;
  private mouseY = 0;
  private parallaxX = 0;
  private parallaxY = 0;
  private levelSource: (() => number) | null = null;
  private level = 0;
  private selectKick = 0;
  private w = 0;
  private h = 0;
  private heroWave: HTMLCanvasElement | null = null;
  /** Frames are skipped while this returns false (menu hidden). */
  public isVisible: (() => boolean) | null = null;
  private heroFingerprint: number[] = [];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'menu-bg';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d');
    this.seed();
    if (typeof window !== 'undefined') {
      window.addEventListener('mousemove', (e) => {
        this.mouseX = e.clientX / Math.max(1, window.innerWidth) - 0.5;
        this.mouseY = e.clientY / Math.max(1, window.innerHeight) - 0.5;
      });
    }
  }

  /** Called when a track is selected. */
  public setTrack(accentHex: string, fingerprint: number[]): void {
    this.targetAccent = hexToRgb(accentHex);
    this.fingerprint = fingerprint;
    this.selectKick = 1;
  }

  /** The hero waveform strip under the selected track's title. */
  public attachHeroWave(canvas: HTMLCanvasElement): void {
    this.heroWave = canvas;
  }

  public setHeroFingerprint(bars: number[]): void {
    this.heroFingerprint = bars;
  }

  /** Optional live audio level (0..1), e.g. from the preview analyser. */
  public setLevelSource(fn: (() => number) | null): void {
    this.levelSource = fn;
  }

  public start(): void {
    if (this.running || !this.ctx) return;
    this.running = true;
    const loop = (): void => {
      if (!this.running) return;
      if (!this.isVisible || this.isVisible()) this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  public stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private seed(): void {
    let s = 0x5eed;
    const rnd = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 220; i++) {
      this.stars.push({ x: rnd(), y: rnd() * 0.62, r: rnd() < 0.06 ? 1.6 : rnd() < 0.3 ? 1.0 : 0.6, a: 0.25 + rnd() * 0.6, tw: rnd() * 6.28 });
    }
    // Composition: a dense cluster right of centre, a lone colossus on the far
    // left, and open negative space between them for the hero title.
    const far: Array<[number, number, number]> = [];
    for (let i = 0; i < 26; i++) far.push([rnd(), 0.012 + rnd() * 0.03, 0.08 + rnd() * 0.22]);
    for (const [x, w, h] of far) this.towers.push(this.makeTower(x, w, h, 0, rnd));
    const near: Array<[number, number, number]> = [
      [0.06, 0.05, 0.62],
      [0.115, 0.022, 0.4],
      [0.62, 0.035, 0.46],
      [0.665, 0.06, 0.58],
      [0.735, 0.028, 0.36],
      [0.77, 0.045, 0.5],
      [0.83, 0.02, 0.3],
      [0.9, 0.055, 0.66],
      [0.965, 0.03, 0.42]
    ];
    for (const [x, w, h] of near) this.towers.push(this.makeTower(x, w, h, 1, rnd));
  }

  private makeTower(x: number, w: number, h: number, layer: 0 | 1, rnd: () => number): Tower {
    const slits: number[] = [];
    const count = layer === 1 ? 4 + Math.floor(rnd() * 6) : Math.floor(rnd() * 3);
    for (let i = 0; i < count; i++) slits.push(rnd());
    return { x, w, h, slits, layer };
  }

  private resize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.resize();
    const { w, h } = this;
    const t = (performance.now() - this.t0) / 1000;

    for (let i = 0; i < 3; i++) this.accent[i] += (this.targetAccent[i] - this.accent[i]) * 0.06;
    this.parallaxX += (this.mouseX - this.parallaxX) * 0.04;
    this.parallaxY += (this.mouseY - this.parallaxY) * 0.04;
    const live = this.levelSource ? Math.min(1, this.levelSource()) : 0;
    this.level += (live - this.level) * 0.2;
    this.selectKick *= 0.94;
    const [ar, ag, ab] = this.accent.map((v) => Math.round(v));
    const acc = (a: number): string => `rgba(${ar},${ag},${ab},${a})`;

    const horizon = h * 0.64 + this.parallaxY * 10;

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#020308');
    sky.addColorStop(0.7, '#050912');
    sky.addColorStop(1, '#0a1220');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon);

    // Stars
    for (const s of this.stars) {
      const tw = 0.7 + 0.3 * Math.sin(t * 1.3 + s.tw);
      ctx.fillStyle = `rgba(220,232,255,${s.a * tw})`;
      const x = ((s.x + this.parallaxX * -0.004 + t * 0.0006) % 1) * w;
      ctx.fillRect(x, s.y * h, s.r, s.r);
    }

    // Horizon glow (track colour), swelling with the preview.
    const glowR = w * (0.55 + this.level * 0.12 + this.selectKick * 0.05);
    const glow = ctx.createRadialGradient(w * 0.62, horizon, 0, w * 0.62, horizon, glowR);
    glow.addColorStop(0, acc(0.22 + this.level * 0.18 + this.selectKick * 0.1));
    glow.addColorStop(0.35, acc(0.06));
    glow.addColorStop(1, acc(0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // Abyss below the horizon
    const abyss = ctx.createLinearGradient(0, horizon, 0, h);
    abyss.addColorStop(0, '#060b14');
    abyss.addColorStop(1, '#010204');
    ctx.fillStyle = abyss;
    ctx.fillRect(0, horizon, w, h - horizon);

    // Perspective signal grid far below
    ctx.strokeStyle = acc(0.07);
    ctx.lineWidth = 1;
    const vpX = w * 0.62 + this.parallaxX * 30;
    ctx.beginPath();
    for (let i = -14; i <= 14; i++) {
      ctx.moveTo(vpX + i * 18, horizon + 6);
      ctx.lineTo(vpX + i * w * 0.12, h);
    }
    const scroll = (t * 0.08) % 1;
    for (let j = 0; j < 12; j++) {
      const k = (j + scroll) / 12;
      const y = horizon + 6 + Math.pow(k, 2.2) * (h - horizon);
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    // Megastructure silhouettes: far layer (hazy) then near layer (dark).
    for (const layer of [0, 1] as const) {
      const par = layer === 0 ? 14 : 34;
      for (const tw of this.towers) {
        if (tw.layer !== layer) continue;
        const x = tw.x * w - this.parallaxX * par;
        const tw_ = tw.w * w;
        const top = horizon - tw.h * h;
        ctx.fillStyle = layer === 0 ? 'rgba(18,28,44,0.9)' : '#03050a';
        ctx.fillRect(x, top, tw_, h - top);
        // Lit edge on the sky side
        ctx.fillStyle = layer === 0 ? 'rgba(90,120,160,0.12)' : 'rgba(140,170,210,0.16)';
        ctx.fillRect(x, top, 1, h - top);
        // Signal slits
        for (const sl of tw.slits) {
          const y = top + sl * (horizon - top) * 0.9 + 6;
          ctx.fillStyle = acc(layer === 0 ? 0.25 : 0.45 + this.level * 0.4);
          ctx.fillRect(x + 2, y, tw_ - 4, layer === 0 ? 1 : 2);
        }
      }
    }

    // Horizon waveform: the selected track's program signal, flowing.
    const fp = this.fingerprint.length > 0 ? this.fingerprint : [0.5];
    ctx.beginPath();
    const amp = h * (0.018 + this.level * 0.05 + this.selectKick * 0.02);
    for (let x = 0; x <= w; x += 4) {
      const u = x / w;
      const f = fp[Math.floor(u * fp.length) % fp.length];
      const y =
        horizon -
        2 +
        Math.sin(u * 38 + t * 1.6) * amp * f * Math.sin(u * Math.PI) +
        Math.sin(u * 9 - t * 0.7) * amp * 0.35;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = acc(0.75);
    ctx.lineWidth = 1.5;
    ctx.shadowColor = acc(0.8);
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Scanlines + vignette for the signal-render finish.
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    const vig = ctx.createRadialGradient(w * 0.55, h * 0.5, h * 0.3, w * 0.55, h * 0.5, w * 0.8);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    this.drawHeroWave(t, acc);
  }

  private drawHeroWave(t: number, acc: (a: number) => string): void {
    const c = this.heroWave;
    if (!c || !c.isConnected) return;
    const cw = Math.max(1, Math.round(c.clientWidth));
    const ch = Math.max(1, Math.round(c.clientHeight));
    if (cw < 4 || ch < 4) return;
    if (c.width !== cw || c.height !== ch) {
      c.width = cw;
      c.height = ch;
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, cw, ch);
    const bars = this.heroFingerprint.length > 0 ? this.heroFingerprint : [0.5];
    const n = bars.length;
    const step = cw / n;
    const bw = Math.max(1, step * 0.55);
    const mid = ch * 0.5;
    const head = (t * 0.09) % 1;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const dist = Math.abs(u - head);
      const near = Math.max(0, 1 - dist * 14);
      const wobble = 0.85 + 0.15 * Math.sin(t * 3 + i * 0.7);
      const lv = Math.min(1, bars[i] * wobble * (1 + this.level * 0.9 * Math.sin(t * 9 + i)) + near * 0.25);
      const bh = Math.max(1, lv * (ch * 0.48));
      const played = u < head;
      g.fillStyle = near > 0 ? acc(0.95) : played ? acc(0.55) : 'rgba(170,185,205,0.22)';
      g.fillRect(i * step, mid - bh, bw, bh * 2);
    }
    // Playhead
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(head * cw, 0, 1, ch);
  }
}
