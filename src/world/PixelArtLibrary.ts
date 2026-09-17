/**
 * PixelArtLibrary for PLAYHEAD SIGNAL RENDER
 * "Cosmic Pixel Brutalism" 2D/2.5D authored pixel art sprite motifs.
 *
 * Generates authored 32x32, 64x64, and 128x128 pixel art textures
 * for celestial objects, symbolic relics, murals, and environmental landmarks.
 * Configured with THREE.NearestFilter for razor-sharp retro pixel definition.
 */

import * as THREE from 'three';

export class PixelArtLibrary {
  private static cache: Map<string, THREE.CanvasTexture> = new Map();

  /**
   * GIANT PIXEL MOON (128x128)
   * Authored celestial moon with dithered crescent shadow, crater clusters, and lunar rim.
   */
  public static getMoonTexture(highlightHex = '#f8fafc', shadowHex = '#0c1424'): THREE.CanvasTexture {
    const key = `celestial_moon_${highlightHex}_${shadowHex}`;
    return this.getOrCreate(key, 128, (ctx, size) => {
      const center = size / 2;
      const radius = 54;

      // Draw pixel circle
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = x - center;
          const dy = y - center;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist <= radius) {
            // Crescent terminator calculation
            const terminatorX = center - 12 + Math.sqrt(Math.max(0, radius * radius - dy * dy)) * 0.4;
            const inSunlight = x >= terminatorX;

            // Dither along the terminator border (4px dither band)
            const ditherDist = Math.abs(x - terminatorX);
            const isDitherPixel = ((x + y) % 2 === 0);

            if (inSunlight || (ditherDist < 4 && isDitherPixel)) {
              // Craters in sunlight
              const isCraterA = Math.hypot(x - (center + 14), y - (center - 10)) < 9;
              const isCraterB = Math.hypot(x - (center + 24), y - (center + 18)) < 13;
              const isCraterC = Math.hypot(x - (center + 8), y - (center + 26)) < 7;

              if (isCraterA || isCraterB || isCraterC) {
                ctx.fillStyle = '#cbd5e1'; // Crater floor
              } else {
                ctx.fillStyle = highlightHex; // Bright lunar surface
              }
            } else {
              ctx.fillStyle = shadowHex; // Dark side of the moon
            }
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }

      // Outer dithered lunar aura
      ctx.fillStyle = highlightHex;
      for (let a = 0; a < Math.PI * 2; a += 0.08) {
        const ax = Math.round(center + Math.cos(a) * (radius + 2));
        const ay = Math.round(center + Math.sin(a) * (radius + 2));
        if ((ax + ay) % 3 === 0) {
          ctx.fillRect(ax, ay, 1, 1);
        }
      }
    });
  }

  /**
   * SOLAR ECLIPSE (128x128)
   * Pitch black occulting disc with stepped radiating pixel solar corona.
   */
  public static getEclipseTexture(coronaHex = '#f59e0b'): THREE.CanvasTexture {
    const key = `celestial_eclipse_${coronaHex}`;
    return this.getOrCreate(key, 128, (ctx, size) => {
      const center = size / 2;
      const radius = 46;

      // Radiant pixel corona rays
      ctx.fillStyle = coronaHex;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = x - center;
          const dy = y - center;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > radius && dist < radius + 16) {
            const angle = Math.atan2(dy, dx);
            const ray = Math.sin(angle * 16.0);
            if (ray > 0.1 && ((x ^ y) % 2 === 0)) {
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }
      }

      // Diamond ring flash beacon (top-right)
      const flashX = center + Math.round(radius * 0.707);
      const flashY = center - Math.round(radius * 0.707);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(flashX - 3, flashY - 3, 7, 7);
      ctx.fillRect(flashX - 8, flashY - 1, 17, 3);
      ctx.fillRect(flashX - 1, flashY - 8, 3, 17);

      // Pitch black occulting moon disc
      ctx.fillStyle = '#020305';
      ctx.beginPath();
      ctx.arc(center, center, radius, 0, Math.PI * 2);
      ctx.fill();

      // Sharp white rim edge
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  /**
   * EYE IN THE VOID (128x128)
   * Iconic surreal cosmic eye with geometric pixel iris, pupil, and radiating aura ticks.
   */
  public static getEyeInTheVoidTexture(irisHex = '#00f0ff', auraHex = '#a855f7'): THREE.CanvasTexture {
    const key = `cosmic_eye_${irisHex}_${auraHex}`;
    return this.getOrCreate(key, 128, (ctx, size) => {
      const center = size / 2;

      // Almond eye outline coordinates
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = Math.abs(x - center) / 48.0;
          if (dx <= 1.0) {
            const eyeCurve = (1.0 - dx * dx) * 22.0;
            const dy = Math.abs(y - center);
            if (dy <= eyeCurve) {
              // Inside eye sclera
              ctx.fillStyle = '#0f172a';
              ctx.fillRect(x, y, 1, 1);

              // Circular iris
              const irisDist = Math.hypot(x - center, y - center);
              if (irisDist <= 16) {
                ctx.fillStyle = irisHex;
                ctx.fillRect(x, y, 1, 1);
                // Dark pupil
                if (irisDist <= 6) {
                  ctx.fillStyle = '#020617';
                  ctx.fillRect(x, y, 1, 1);
                }
                // Pupil white glint
                if (x === center - 2 && y === center - 2) {
                  ctx.fillStyle = '#ffffff';
                  ctx.fillRect(x, y, 2, 2);
                }
              }
            } else if (dy <= eyeCurve + 2) {
              // Eyelid border
              ctx.fillStyle = '#f8fafc';
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }
      }

      // Radiating eyebrow/aura spikes
      ctx.fillStyle = auraHex;
      for (let i = -5; i <= 5; i++) {
        const sx = center + i * 8;
        const topY = center - (1.0 - (Math.abs(i * 8) / 48) ** 2) * 22 - 6;
        ctx.fillRect(sx, topY, 2, 6);

        const botY = center + (1.0 - (Math.abs(i * 8) / 48) ** 2) * 22;
        ctx.fillRect(sx, botY, 2, 6);
      }
    });
  }

  /**
   * SURREAL FLOWER (64x64)
   * Geometric pixel blossom for quiet, organic visual sections.
   */
  public static getFlowerTexture(petalHex = '#f472b6', coreHex = '#fde047'): THREE.CanvasTexture {
    const key = `surreal_flower_${petalHex}_${coreHex}`;
    return this.getOrCreate(key, 64, (ctx, size) => {
      const center = size / 2;

      // 6 geometric petals
      ctx.fillStyle = petalHex;
      for (let p = 0; p < 6; p++) {
        const angle = (p / 6) * Math.PI * 2;
        const px = center + Math.cos(angle) * 14;
        const py = center + Math.sin(angle) * 14;

        for (let r = 0; r < 10; r++) {
          for (let w = -4; w <= 4; w++) {
            if (Math.abs(w) <= 4 - Math.abs(r - 5)) {
              const x = Math.round(px + Math.cos(angle) * (r - 5) - Math.sin(angle) * w);
              const y = Math.round(py + Math.sin(angle) * (r - 5) + Math.cos(angle) * w);
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }
      }

      // Golden pixel core
      ctx.fillStyle = coreHex;
      ctx.fillRect(center - 5, center - 5, 10, 10);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(center - 2, center - 2, 4, 4);
    });
  }

  /**
   * SIGNAL MOTH (64x64)
   * Iconic nocturnal pixel moth with geometric wing chevrons and feathery antennae.
   */
  public static getMothTexture(wingHex = '#a78bfa', accentHex = '#38bdf8'): THREE.CanvasTexture {
    const key = `signal_moth_${wingHex}_${accentHex}`;
    return this.getOrCreate(key, 64, (ctx, size) => {
      const center = size / 2;

      // Symmetrical wings
      ctx.fillStyle = wingHex;
      for (let side of [-1, 1]) {
        // Forewing
        for (let y = 14; y < 46; y++) {
          const w = (y - 14) * 0.75;
          const x0 = center + side * 4;
          const x1 = center + side * (4 + w);
          const startX = Math.min(x0, x1);
          const len = Math.abs(x1 - x0);
          ctx.fillRect(startX, y, len, 1);
        }

        // Wing eye-spot
        ctx.fillStyle = accentHex;
        ctx.fillRect(center + side * 14, 28, 4, 4);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(center + side * 15, 29, 2, 2);
        ctx.fillStyle = wingHex;

        // Antennae
        ctx.fillStyle = '#e2e8f0';
        for (let a = 0; a < 8; a++) {
          ctx.fillRect(center + side * (4 + a), 12 - a, 1, 1);
          if (a % 2 === 0) ctx.fillRect(center + side * (4 + a), 11 - a, 2, 1);
        }
      }

      // Moth body
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(center - 2, 14, 4, 30);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(center - 1, 16, 2, 2);
      ctx.fillRect(center - 1, 22, 2, 2);
      ctx.fillRect(center - 1, 28, 2, 2);
    });
  }

  /**
   * SIGNAL HALO (64x64)
   * Concentric glowing pixel signal rings with cardinal notch ticks.
   */
  public static getHaloTexture(haloHex = '#38bdf8'): THREE.CanvasTexture {
    const key = `signal_halo_${haloHex}`;
    return this.getOrCreate(key, 64, (ctx, size) => {
      const center = size / 2;

      // Outer ring
      ctx.strokeStyle = haloHex;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(center, center, 24, 0, Math.PI * 2);
      ctx.stroke();

      // Inner dithered ring
      for (let a = 0; a < Math.PI * 2; a += 0.12) {
        if (Math.sin(a * 4.0) > 0.0) {
          const rx = Math.round(center + Math.cos(a) * 16);
          const ry = Math.round(center + Math.sin(a) * 16);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(rx, ry, 1, 1);
        }
      }

      // Cardinal ticks
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(center - 1, 2, 2, 6);
      ctx.fillRect(center - 1, size - 8, 2, 6);
      ctx.fillRect(2, center - 1, 6, 2);
      ctx.fillRect(size - 8, center - 1, 6, 2);
    });
  }

  /**
   * HERO STAR CROSS (32x32)
   * 4-point retro lens flare cross star.
   */
  public static getStarCrossTexture(colorHex = '#ffffff'): THREE.CanvasTexture {
    const key = `hero_star_cross_${colorHex}`;
    return this.getOrCreate(key, 32, (ctx, size) => {
      const center = size / 2;
      ctx.fillStyle = colorHex;

      // Horizontal beam
      for (let x = 2; x < size - 2; x++) {
        const thickness = Math.max(1, 4 - Math.abs(x - center) / 4);
        ctx.fillRect(x, center - Math.floor(thickness / 2), 1, thickness);
      }
      // Vertical beam
      for (let y = 2; y < size - 2; y++) {
        const thickness = Math.max(1, 4 - Math.abs(y - center) / 4);
        ctx.fillRect(center - Math.floor(thickness / 2), y, thickness, 1);
      }

      // Center bright core
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(center - 2, center - 2, 4, 4);
    });
  }

  /**
   * GIANT PIXEL MURAL (256x256)
   * Architectural relief mural incorporating cosmic eye, waveforms, and monolith motifs.
   */
  public static getMuralTexture(primaryHex = '#00f0ff', secondaryHex = '#a855f7'): THREE.CanvasTexture {
    const key = `architectural_mural_${primaryHex}_${secondaryHex}`;
    return this.getOrCreate(key, 256, (ctx, size) => {
      // Dark slate background
      ctx.fillStyle = '#080b11';
      ctx.fillRect(0, 0, size, size);

      // Grid framework
      ctx.strokeStyle = '#141c2b';
      ctx.lineWidth = 1;
      for (let p = 0; p < size; p += 32) {
        ctx.strokeRect(p, 0, 32, size);
        ctx.strokeRect(0, p, size, 32);
      }

      // Central Eye Mural
      ctx.strokeStyle = primaryHex;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(128, 128, 48, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = secondaryHex;
      ctx.fillRect(116, 116, 24, 24);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(124, 124, 8, 8);

      // Radiating stepped rays
      ctx.fillStyle = primaryHex;
      for (let r = 0; r < 8; r++) {
        const angle = (r / 8) * Math.PI * 2;
        const rx = 128 + Math.cos(angle) * 75;
        const ry = 128 + Math.sin(angle) * 75;
        ctx.fillRect(rx - 3, ry - 3, 6, 6);
      }

      // Lower brutalist monolith silhouettes
      ctx.fillStyle = '#101622';
      ctx.fillRect(32, 190, 40, 66);
      ctx.fillRect(80, 170, 36, 86);
      ctx.fillRect(140, 170, 36, 86);
      ctx.fillRect(184, 190, 40, 66);

      // Border running glyphs
      ctx.fillStyle = '#ffffff';
      for (let b = 16; b < size; b += 32) {
        ctx.fillRect(b, 8, 8, 2);
        ctx.fillRect(b, size - 10, 8, 2);
      }
    });
  }

  /**
   * PLAYHEAD CYBERNETIC BILLBOARD (128x64)
   * High-contrast screen with glowing telemetry meters, coordinate ticker, and bold signal glyph.
   */
  public static getSignalBillboardTexture(primaryHex = '#00f0ff', secondaryHex = '#ff00aa'): THREE.CanvasTexture {
    const key = `billboard_signal_${primaryHex}_${secondaryHex}`;
    return this.getOrCreateRect(key, 128, 64, (ctx, w, h) => {
      // Dark monitor glass
      ctx.fillStyle = '#05070d';
      ctx.fillRect(0, 0, w, h);

      // Outer bezel and grid lines
      ctx.strokeStyle = '#121a28';
      ctx.lineWidth = 1;
      ctx.strokeRect(1, 1, w - 2, h - 2);

      // Glowing header bar
      ctx.fillStyle = primaryHex;
      ctx.fillRect(4, 4, 38, 5);

      // Binary/coordinate ticker
      ctx.fillStyle = '#475569';
      for (let x = 46; x < w - 4; x += 6) {
        ctx.fillRect(x, 5, 3, 3);
      }

      // Stepped VU audio meters
      for (let bar = 0; bar < 12; bar++) {
        const bx = 8 + bar * 5;
        const bHeight = 10 + ((bar * 7) % 24);
        ctx.fillStyle = bar > 8 ? secondaryHex : primaryHex;
        ctx.fillRect(bx, 44 - bHeight, 3, bHeight);
      }

      // Signal Eye Logo (right side)
      ctx.strokeStyle = primaryHex;
      ctx.lineWidth = 2;
      ctx.strokeRect(84, 20, 36, 24);
      ctx.fillStyle = secondaryHex;
      ctx.fillRect(98, 28, 8, 8);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(100, 30, 4, 4);

      // Warning footer line
      ctx.fillStyle = '#334155';
      ctx.fillRect(4, 54, w - 8, 2);
      ctx.fillStyle = primaryHex;
      ctx.fillRect(4, 54, 24, 2);
    });
  }

  /**
   * HAZARD / VECTOR BILLBOARD (128x64)
   * Diagonal hazard caution stripes with kanji/rune aesthetic vectors.
   */
  public static getHazardBillboardTexture(primaryHex = '#ffb700'): THREE.CanvasTexture {
    const key = `billboard_hazard_${primaryHex}`;
    return this.getOrCreateRect(key, 128, 64, (ctx, w, h) => {
      ctx.fillStyle = '#080a0f';
      ctx.fillRect(0, 0, w, h);

      // Top and bottom hazard chevrons
      ctx.fillStyle = primaryHex;
      for (let x = -8; x < w + 16; x += 14) {
        ctx.beginPath();
        ctx.moveTo(x, 2);
        ctx.lineTo(x + 6, 2);
        ctx.lineTo(x + 2, 8);
        ctx.lineTo(x - 4, 8);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(x, h - 8);
        ctx.lineTo(x + 6, h - 8);
        ctx.lineTo(x + 2, h - 2);
        ctx.lineTo(x - 4, h - 2);
        ctx.fill();
      }

      // Center vector glyphs
      ctx.strokeStyle = primaryHex;
      ctx.lineWidth = 2;
      ctx.strokeRect(16, 18, 28, 28);
      ctx.beginPath();
      ctx.moveTo(16, 32);
      ctx.lineTo(44, 32);
      ctx.moveTo(30, 18);
      ctx.lineTo(30, 46);
      ctx.stroke();

      // Bold text block pixels
      ctx.fillStyle = '#ffffff';
      for (let r = 0; r < 3; r++) {
        const y = 22 + r * 8;
        ctx.fillRect(56, y, 54, 4);
      }
    });
  }

  /**
   * SPECTROGRAM BILLBOARD (128x64)
   * Oscilloscope / spectrum analyzer with stepped frequency peaks.
   */
  public static getSpectrogramBillboardTexture(accentHex = '#00f0ff'): THREE.CanvasTexture {
    const key = `billboard_spectro_${accentHex}`;
    return this.getOrCreateRect(key, 128, 64, (ctx, w, h) => {
      ctx.fillStyle = '#040508';
      ctx.fillRect(0, 0, w, h);

      // Fine grid
      ctx.strokeStyle = '#0e1622';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < w; gx += 16) {
        ctx.strokeRect(gx, 0, 16, h);
      }
      for (let gy = 0; gy < h; gy += 16) {
        ctx.strokeRect(0, gy, w, 16);
      }

      // Waveform trace
      ctx.strokeStyle = accentHex;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 4; x < w - 4; x += 4) {
        const norm = (x / w) * Math.PI * 4;
        const waveY = 32 + Math.sin(norm * 2.5) * 14 * Math.sin(norm * 0.5);
        if (x === 4) ctx.moveTo(x, waveY);
        else ctx.lineTo(x, waveY);
      }
      ctx.stroke();

      // Glowing peak markers
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(28, 16, 3, 3);
      ctx.fillRect(68, 14, 3, 3);
      ctx.fillRect(104, 20, 3, 3);
    });
  }

  private static getOrCreateRect(
    key: string,
    width: number,
    height: number,
    paintFn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
  ): THREE.CanvasTexture {
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    if (typeof document === 'undefined') {
      return new THREE.CanvasTexture(null as unknown as HTMLCanvasElement);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      paintFn(ctx, width, height);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;

    this.cache.set(key, texture);
    return texture;
  }

  private static getOrCreate(
    key: string,
    size: number,
    paintFn: (ctx: CanvasRenderingContext2D, size: number) => void
  ): THREE.CanvasTexture {
    return this.getOrCreateRect(key, size, size, (ctx, w) => paintFn(ctx, w));
  }
}
