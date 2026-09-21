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

  /**
   * TRACK HERO BANNER (256x128)
   * Colossal high-definition display with real song title, BPM badge,
   * deterministic track code, telemetry status, and stepped waveform envelope.
   */
  public static getTrackHeroBannerTexture(
    title: string,
    bpm: number,
    trackCode: string,
    accentHex = '#00f0ff',
    secondaryHex = '#ff00aa',
    waveform?: Float32Array
  ): THREE.CanvasTexture {
    const key = `billboard_hero_${title}_${bpm}_${trackCode}_${accentHex}_${secondaryHex}`;
    return this.getOrCreateRect(key, 256, 128, (ctx, w, h) => {
      // Obsidian monitor glass
      ctx.fillStyle = '#030509';
      ctx.fillRect(0, 0, w, h);

      // Outer bezel and technical grid
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      ctx.strokeRect(2, 2, w - 4, h - 4);

      // Corner bracket accents
      ctx.strokeStyle = accentHex;
      ctx.lineWidth = 3;
      // Top-left
      ctx.beginPath(); ctx.moveTo(2, 16); ctx.lineTo(2, 2); ctx.lineTo(16, 2); ctx.stroke();
      // Top-right
      ctx.beginPath(); ctx.moveTo(w - 16, 2); ctx.lineTo(w - 2, 2); ctx.lineTo(w - 2, 16); ctx.stroke();
      // Bottom-left
      ctx.beginPath(); ctx.moveTo(2, h - 16); ctx.lineTo(2, h - 2); ctx.lineTo(16, h - 2); ctx.stroke();
      // Bottom-right
      ctx.beginPath(); ctx.moveTo(w - 16, h - 2); ctx.lineTo(w - 2, h - 2); ctx.lineTo(w - 2, h - 16); ctx.stroke();

      // Header kicker
      ctx.font = 'bold 9px monospace';
      ctx.fillStyle = '#64748b';
      ctx.fillText('[PLAYHEAD SIGNAL RENDER // NAV SYSTEM]', 14, 16);

      // Track Title (large, clean, bold)
      ctx.font = 'bold 20px monospace, "Segoe UI", sans-serif';
      // Subtle accent glow
      ctx.fillStyle = secondaryHex;
      ctx.fillText(title.toUpperCase().slice(0, 22), 15, 39);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(title.toUpperCase().slice(0, 22), 14, 38);

      // BPM Badge (high-contrast pill)
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(14, 46, 70, 16);
      ctx.strokeStyle = accentHex;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(14, 46, 70, 16);
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = accentHex;
      ctx.fillText(`${bpm} BPM`, 20, 58);

      // Track ID badge
      ctx.fillStyle = secondaryHex;
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`PH://${trackCode.toUpperCase()}`, 92, 58);

      // Status Line
      ctx.font = '9px monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('LOCK: TRANSIENT SYNC  //  DSP ACTIVE', 14, 76);

      // Real Waveform / Spectrum Analyzer bars
      const numBars = 36;
      const barSpacing = (w - 28) / numBars;
      for (let b = 0; b < numBars; b++) {
        const bx = 14 + b * barSpacing;
        let val = 0.3;
        if (waveform && waveform.length > 0) {
          const wIdx = Math.floor((b / numBars) * waveform.length);
          val = Math.max(0.1, Math.min(1.0, waveform[wIdx] || 0.3));
        } else {
          val = 0.2 + 0.6 * Math.abs(Math.sin((b * 0.4) + 1.2));
        }
        const barH = Math.max(4, Math.round(val * 32));
        const by = 114 - barH;

        ctx.fillStyle = val > 0.75 ? secondaryHex : (val > 0.45 ? accentHex : '#334155');
        ctx.fillRect(bx, by, barSpacing - 2, barH);

        // Peak dot
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(bx, by - 2, barSpacing - 2, 1);
      }

      // Bottom calibration hazard footer
      ctx.fillStyle = '#ffb700';
      for (let x = 14; x < w - 14; x += 12) {
        ctx.fillRect(x, 120, 6, 2);
      }
    });
  }

  /**
   * VERTICAL JAPANESE STELAE RUNNER (64x256)
   * High-contrast edge-mounted neon stela with authentic system Kanji,
   * English reading subtitle, hex coordinate ticker, and vertical VU meters.
   */
  public static getVerticalJapaneseSignTexture(
    termIndex = 0,
    accentHex = '#00f0ff',
    secondaryHex = '#ff00aa'
  ): THREE.CanvasTexture {
    const approvedTerms = [
      { kanji: '信号', reading: 'SIGNAL', code: 'SIG-01' },
      { kanji: '再生', reading: 'PLAYBACK', code: 'PLY-02' },
      { kanji: '入力', reading: 'INPUT', code: 'INP-03' },
      { kanji: '速度', reading: 'VELOCITY', code: 'VEL-04' },
      { kanji: '深度', reading: 'DEPTH', code: 'DPT-05' },
      { kanji: '同期', reading: 'SYNC', code: 'SNC-06' },
      { kanji: '解析', reading: 'ANALYSIS', code: 'ANL-07' },
      { kanji: '軌道', reading: 'TRAJECTORY', code: 'TRJ-08' },
      { kanji: '周波', reading: 'FREQUENCY', code: 'FRQ-09' }
    ];
    const term = approvedTerms[Math.abs(termIndex) % approvedTerms.length];
    const key = `billboard_vert_jp_${term.code}_${accentHex}_${secondaryHex}`;

    return this.getOrCreateRect(key, 64, 256, (ctx, w, h) => {
      // Dark monolith runner
      ctx.fillStyle = '#020409';
      ctx.fillRect(0, 0, w, h);

      // Neon outer frame
      ctx.strokeStyle = accentHex;
      ctx.lineWidth = 2;
      ctx.strokeRect(2, 2, w - 4, h - 4);

      // Header block with code
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(4, 4, w - 8, 20);
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = secondaryHex;
      ctx.fillText(term.code, w / 2, 18);

      // English subtitle
      ctx.font = 'bold 8px monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(term.reading, w / 2, 34);

      // Divider line
      ctx.fillStyle = accentHex;
      ctx.fillRect(10, 40, w - 20, 2);

      // Main Vertical Kanji Glyphs (High contrast, bold)
      ctx.font = 'bold 36px "Segoe UI", "Hiragino Sans", "Meiryo", monospace, sans-serif';
      ctx.textBaseline = 'middle';

      // Character 1
      ctx.fillStyle = secondaryHex;
      ctx.fillText(term.kanji[0], w / 2 + 1, 71);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(term.kanji[0], w / 2, 70);

      // Character 2
      ctx.fillStyle = secondaryHex;
      ctx.fillText(term.kanji[1], w / 2 + 1, 119);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(term.kanji[1], w / 2, 118);

      // Center separator
      ctx.fillStyle = accentHex;
      ctx.fillRect(8, 142, w - 16, 2);

      // Vertical hex coordinates & status
      ctx.font = 'bold 8px monospace';
      ctx.fillStyle = '#64748b';
      ctx.fillText(`0x${(termIndex * 31 + 79).toString(16).toUpperCase()}`, w / 2, 156);
      ctx.fillText('DSP-SYNC', w / 2, 168);
      ctx.fillText('LOCK:OK', w / 2, 180);

      // Binary dot matrix
      ctx.fillStyle = accentHex;
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 3; col++) {
          if ((row + col + termIndex) % 2 === 0) {
            ctx.fillRect(18 + col * 12, 192 + row * 6, 4, 3);
          }
        }
      }

      // Vertical VU audio meter
      for (let b = 0; b < 8; b++) {
        const by = 244 - b * 4;
        ctx.fillStyle = b > 5 ? secondaryHex : (b > 2 ? accentHex : '#1e293b');
        ctx.fillRect(12, by, w - 24, 2.5);
      }
    });
  }

  /**
   * HORIZONTAL TELEMETRY DISPLAY (192x64)
   * Sleek brutalist operator screen showing section information,
   * live transient tracking, and oscilloscope wave.
   */
  public static getHorizontalTelemetryTexture(
    trackTitle: string,
    sectionTheme: string,
    accentHex = '#00f0ff',
    secondaryHex = '#ff00aa'
  ): THREE.CanvasTexture {
    const key = `billboard_telem_${trackTitle}_${sectionTheme}_${accentHex}_${secondaryHex}`;
    return this.getOrCreateRect(key, 192, 64, (ctx, w, h) => {
      ctx.fillStyle = '#040710';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#1a2436';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(2, 2, w - 4, h - 4);

      // Top title bar
      ctx.fillStyle = '#0b1120';
      ctx.fillRect(4, 4, w - 8, 14);
      ctx.font = 'bold 8px monospace';
      ctx.fillStyle = accentHex;
      ctx.fillText(`AUDIO NAV // ${trackTitle.toUpperCase().slice(0, 16)}`, 8, 14);

      // Main Section Readout
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`SEC // ${sectionTheme.toUpperCase()}`, 8, 34);

      // Radar / Scope on right side
      ctx.strokeStyle = accentHex;
      ctx.lineWidth = 1;
      ctx.strokeRect(138, 20, 46, 38);
      ctx.beginPath();
      ctx.arc(161, 39, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = secondaryHex;
      ctx.fillRect(160, 38, 3, 3);

      // Status ticks
      ctx.font = '8px monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('DSP LOCK: ACTIVE', 8, 46);
      ctx.fillStyle = '#64748b';
      ctx.fillText('TRANSIENT: SYNC', 8, 56);
    });
  }

  /**
   * SPECTROGRAM FREQUENCY MATRIX (128x128)
   * Stepped LED audio matrix with 16 multi-band columns,
   * peak hold markers, and DSP status.
   */
  public static getSpectrogramMatrixTexture(
    accentHex = '#00f0ff',
    secondaryHex = '#ff00aa'
  ): THREE.CanvasTexture {
    const key = `billboard_spectro_matrix_${accentHex}_${secondaryHex}`;
    return this.getOrCreateRect(key, 128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#020306';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#111928';
      ctx.lineWidth = 1;
      ctx.strokeRect(2, 2, w - 4, h - 4);

      // Header
      ctx.font = 'bold 8px monospace';
      ctx.fillStyle = '#64748b';
      ctx.fillText('[FREQ SPECTRUM // 16-BAND]', 8, 12);

      // 16 Frequency columns
      const cols = 16;
      const colW = 6;
      for (let c = 0; c < cols; c++) {
        const cx = 10 + c * 7;
        const norm = c / cols;
        // Peak profile typical of electronic music (strong bass/mid curve)
        const profile = Math.max(0.15, Math.sin(norm * Math.PI * 0.9 + 0.2));
        const colHeight = Math.round(profile * 90);

        for (let y = 0; y < colHeight; y += 4) {
          const py = 116 - y;
          const ratio = y / 90;
          ctx.fillStyle = ratio > 0.75 ? secondaryHex : (ratio > 0.4 ? accentHex : '#0284c7');
          ctx.fillRect(cx, py, colW, 3);
        }

        // Peak marker
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx, 116 - colHeight - 3, colW, 2);
      }

      // Frequency axis
      ctx.font = '7px monospace';
      ctx.fillStyle = '#475569';
      ctx.fillText('20Hz', 10, 124);
      ctx.fillText('1kHz', 56, 124);
      ctx.fillText('20k', 104, 124);
    });
  }

  /**
   * ROOFTOP CROWN GLYPH SIGN (128x64)
   * High-contrast iconic glyph perched atop skyscraper parapets.
   */
  public static getRooftopCrownTexture(
    glyphIndex = 0,
    accentHex = '#00f0ff',
    secondaryHex = '#ff00aa'
  ): THREE.CanvasTexture {
    const key = `billboard_crown_${glyphIndex}_${accentHex}_${secondaryHex}`;
    return this.getOrCreateRect(key, 128, 64, (ctx, w, h) => {
      ctx.fillStyle = '#020306';
      ctx.fillRect(0, 0, w, h);

      // Steel truss frame
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      ctx.strokeRect(3, 3, w - 6, h - 6);

      const center = w / 2;
      const gType = Math.abs(glyphIndex) % 4;

      if (gType === 0) {
        // Cosmic Eye in the Void
        ctx.strokeStyle = accentHex;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(center, 32, 18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = secondaryHex;
        ctx.beginPath();
        ctx.arc(center, 32, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(center - 2, 30, 4, 4);
      } else if (gType === 1) {
        // Delta Horizon / Inverted Pyramid
        ctx.strokeStyle = accentHex;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(center - 24, 16);
        ctx.lineTo(center + 24, 16);
        ctx.lineTo(center, 50);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = secondaryHex;
        ctx.beginPath();
        ctx.moveTo(center - 10, 20);
        ctx.lineTo(center + 10, 20);
        ctx.lineTo(center, 36);
        ctx.closePath();
        ctx.fill();
      } else if (gType === 2) {
        // Audio Pulse Signal / Chevron
        ctx.fillStyle = accentHex;
        for (let i = -3; i <= 3; i++) {
          const barH = 36 - Math.abs(i) * 8;
          ctx.fillRect(center + i * 8 - 3, 32 - barH / 2, 6, barH);
        }
      } else {
        // Stepped Diamond Matrix
        ctx.strokeStyle = secondaryHex;
        ctx.lineWidth = 2;
        ctx.strokeRect(center - 16, 16, 32, 32);
        ctx.fillStyle = accentHex;
        ctx.fillRect(center - 8, 24, 16, 16);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(center - 3, 29, 6, 6);
      }

      // Corner strobe beacon markers
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(6, 6, 4, 4);
      ctx.fillRect(w - 10, 6, 4, 4);
      ctx.fillRect(6, h - 10, 4, 4);
      ctx.fillRect(w - 10, h - 10, 4, 4);
    });
  }

  /**
   * BRUTALIST SLIT WINDOW CLUSTER (64x128)
   * Dense, irregular clusters of narrow brutalist horizontal slit windows
   * giving towering monoliths architectural human scale.
   */
  public static getWindowClusterTexture(
    theme: 'cool' | 'warm' | 'accent' = 'cool',
    accentHex = '#00f0ff'
  ): THREE.CanvasTexture {
    const key = `facade_windows_${theme}_${accentHex}`;
    return this.getOrCreateRect(key, 64, 128, (ctx, w, h) => {
      // Dark monolith basalt/concrete
      ctx.fillStyle = '#04060a';
      ctx.fillRect(0, 0, w, h);

      // Lit window color
      const litColor = theme === 'warm' ? '#fbbf24' : (theme === 'accent' ? accentHex : '#7dd3fc');
      const unlitColor = '#0b1018';

      // Rows of horizontal slit windows
      for (let y = 6; y < h - 6; y += 7) {
        for (let x = 6; x < w - 6; x += 11) {
          // Pseudorandom hash to cluster lights realistically
          const hash = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
          const isLit = (hash - Math.floor(hash)) < 0.28;

          ctx.fillStyle = isLit ? litColor : unlitColor;
          ctx.fillRect(x, y, 7, 2);
        }
      }
    });
  }

  /**
   * FACADE STRUCTURAL RIBS & CONDUITS (32x128)
   * Vertical architectural seams, structural mullions, and illuminated conduits.
   */
  public static getFacadeRibsTexture(accentHex = '#00f0ff'): THREE.CanvasTexture {
    const key = `facade_ribs_${accentHex}`;
    return this.getOrCreateRect(key, 32, 128, (ctx, w, h) => {
      ctx.fillStyle = '#030508';
      ctx.fillRect(0, 0, w, h);

      // Subtle vertical panel seams
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(6, 0, 2, h);
      ctx.fillRect(15, 0, 2, h);
      ctx.fillRect(24, 0, 2, h);

      // Illuminated central conduit
      ctx.fillStyle = accentHex;
      ctx.fillRect(16, 0, 1, h);

      // Horizontal expansion joint ticks
      ctx.fillStyle = '#1e293b';
      for (let y = 16; y < h; y += 32) {
        ctx.fillRect(0, y, w, 2);
      }
    });
  }

  public static getOrCreateRect(
    key: string,
    width: number,
    height: number,
    paintFn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
  ): THREE.CanvasTexture {
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    if (typeof document === 'undefined') {
      const mockTex = new THREE.CanvasTexture(null as unknown as HTMLCanvasElement);
      this.cache.set(key, mockTex);
      return mockTex;
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

