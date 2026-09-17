/**
 * PixelTextureGenerator for PLAYHEAD SIGNAL RENDER
 * "Cosmic Pixel Brutalism" authored low-resolution texture library.
 *
 * Generates authored 64x64 to 128x128 pixel textures using HTML5 canvas,
 * configured with THREE.NearestFilter for crisp, graphic pixel definition.
 */

import * as THREE from 'three';

export class PixelTextureGenerator {
  private static cache: Map<string, THREE.CanvasTexture> = new Map();

  /**
   * Dark Concrete: Cast brutalist concrete with formwork seam lines,
   * chunky aggregate speckling, and dithered surface gradation.
   */
  public static getDarkConcreteTexture(): THREE.CanvasTexture {
    return this.getOrCreate('dark_concrete', 128, (ctx, size) => {
      // Base dark concrete tone
      ctx.fillStyle = '#11151c';
      ctx.fillRect(0, 0, size, size);

      // Formwork board bands (every 32 pixels)
      for (let y = 0; y < size; y += 32) {
        ctx.fillStyle = '#0a0d13';
        ctx.fillRect(0, y, size, 2);
        ctx.fillStyle = '#1c222e';
        ctx.fillRect(0, y + 2, size, 1);

        // Tie rod holes
        for (let x = 16; x < size; x += 32) {
          ctx.fillStyle = '#06080c';
          ctx.fillRect(x - 2, y + 14, 4, 4);
          ctx.fillStyle = '#222b3a';
          ctx.fillRect(x - 1, y + 15, 2, 2);
        }
      }

      // Chunky aggregate pixel noise
      const img = ctx.getImageData(0, 0, size, size);
      const data = img.data;
      for (let i = 0; i < data.length; i += 4) {
        const n = ((i * 1337) ^ (i >> 3)) % 29 - 14;
        data[i] = Math.max(0, Math.min(255, data[i] + n));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
      }
      ctx.putImageData(img, 0, 0);
    });
  }

  /**
   * Black Basalt: Dark volcanic stone with polygonal jointing lines
   * and fine crystalline flecks.
   */
  public static getBlackBasaltTexture(): THREE.CanvasTexture {
    return this.getOrCreate('black_basalt', 128, (ctx, size) => {
      ctx.fillStyle = '#080a0f';
      ctx.fillRect(0, 0, size, size);

      // Basalt column fracture lines
      ctx.strokeStyle = '#151b27';
      ctx.lineWidth = 2;
      const cells = 4;
      const step = size / cells;
      for (let cy = 0; cy < cells; cy++) {
        for (let cx = 0; cx < cells; cx++) {
          const px = cx * step + ((cy % 2) * step * 0.5);
          const py = cy * step;
          ctx.strokeRect(px, py, step, step);
        }
      }

      // High-contrast mineral specks
      for (let i = 0; i < 70; i++) {
        const x = Math.floor(Math.random() * size);
        const y = Math.floor(Math.random() * size);
        ctx.fillStyle = (i % 3 === 0) ? '#283549' : '#030406';
        ctx.fillRect(x, y, 2, 2);
      }
    });
  }

  /**
   * Rough Metal: Chunky industrial metal plating with seam rivets
   * and subtle directional brush striations.
   */
  public static getRoughMetalTexture(): THREE.CanvasTexture {
    return this.getOrCreate('rough_metal', 64, (ctx, size) => {
      ctx.fillStyle = '#161920';
      ctx.fillRect(0, 0, size, size);

      // Directional horizontal micro-brushing
      for (let y = 0; y < size; y += 2) {
        ctx.fillStyle = (y % 4 === 0) ? '#1c202a' : '#12141a';
        ctx.fillRect(0, y, size, 1);
      }

      // Rivets along borders
      ctx.fillStyle = '#2f3647';
      for (let p = 4; p < size; p += 16) {
        ctx.fillRect(p, 2, 3, 3);
        ctx.fillRect(p, size - 5, 3, 3);
        ctx.fillRect(2, p, 3, 3);
        ctx.fillRect(size - 5, p, 3, 3);
      }
    });
  }

  /**
   * Painted Signal Surface: Bold graphic warning chevron stripes and signal edge trim.
   */
  public static getPaintedSignalTexture(primaryHex = '#00f0ff'): THREE.CanvasTexture {
    const key = `signal_surface_${primaryHex}`;
    return this.getOrCreate(key, 64, (ctx, size) => {
      ctx.fillStyle = '#090c12';
      ctx.fillRect(0, 0, size, size);

      // Chevrons
      ctx.fillStyle = primaryHex;
      for (let y = -size; y < size * 2; y += 16) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size * 0.5, y + 8);
        ctx.lineTo(size, y);
        ctx.lineTo(size, y + 6);
        ctx.lineTo(size * 0.5, y + 14);
        ctx.lineTo(0, y + 6);
        ctx.closePath();
        ctx.fill();
      }

      // Border signal lines
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 2, size);
      ctx.fillRect(size - 2, 0, 2, size);
    });
  }

  /**
   * Pixel Mosaic: Ordered 4x4 dithered pixel tile pattern.
   */
  public static getPixelMosaicTexture(): THREE.CanvasTexture {
    return this.getOrCreate('pixel_mosaic', 64, (ctx, size) => {
      ctx.fillStyle = '#0b0e14';
      ctx.fillRect(0, 0, size, size);

      const tileSize = 8;
      for (let y = 0; y < size; y += tileSize) {
        for (let x = 0; x < size; x += tileSize) {
          if ((x / tileSize + y / tileSize) % 2 === 0) {
            ctx.fillStyle = '#141a24';
            ctx.fillRect(x, y, tileSize, tileSize);
            ctx.fillStyle = '#1c2433';
            ctx.fillRect(x + 2, y + 2, 4, 4);
          }
        }
      }
    });
  }

  /**
   * Etched Concrete: Brutalist concrete with incised waveform glyphs and signal circuit diagrams.
   */
  public static getEtchedConcreteTexture(): THREE.CanvasTexture {
    return this.getOrCreate('etched_concrete', 128, (ctx, size) => {
      ctx.fillStyle = '#0d1118';
      ctx.fillRect(0, 0, size, size);

      ctx.strokeStyle = '#222d3e';
      ctx.lineWidth = 2;

      // Circuit / Waveform Etchings
      ctx.beginPath();
      // Waveform pulse line across center
      ctx.moveTo(0, 64);
      ctx.lineTo(32, 64);
      ctx.lineTo(44, 36);
      ctx.lineTo(56, 92);
      ctx.lineTo(68, 48);
      ctx.lineTo(80, 80);
      ctx.lineTo(92, 64);
      ctx.lineTo(128, 64);
      ctx.stroke();

      // Framing lines and runic tick marks
      ctx.strokeRect(8, 8, size - 16, size - 16);
      for (let t = 16; t < size - 16; t += 16) {
        ctx.strokeRect(t - 2, 6, 4, 4);
        ctx.strokeRect(t - 2, size - 10, 4, 4);
      }
    });
  }

  /**
   * Surf Signal: High-contrast directional flow signals for surf ramps.
   * Prominently conveys slide orientation, speed lines, and edge contrast.
   */
  public static getSurfSignalTexture(signalHex = '#00f0ff'): THREE.CanvasTexture {
    const key = `surf_signal_${signalHex}`;
    return this.getOrCreate(key, 128, (ctx, size) => {
      // Dark slate base
      ctx.fillStyle = '#0a0e16';
      ctx.fillRect(0, 0, size, size);

      // Subtle directional glide striations
      for (let y = 0; y < size; y += 4) {
        ctx.fillStyle = (y % 8 === 0) ? '#121926' : '#0e141f';
        ctx.fillRect(0, y, size, 2);
      }

      // Directional Flow Chevrons (pointing along the ramp)
      ctx.fillStyle = signalHex;
      for (let y = 8; y < size; y += 32) {
        // Thick graphic arrow
        ctx.beginPath();
        ctx.moveTo(32, y);
        ctx.lineTo(64, y + 16);
        ctx.lineTo(96, y);
        ctx.lineTo(96, y + 8);
        ctx.lineTo(64, y + 24);
        ctx.lineTo(32, y + 8);
        ctx.closePath();
        ctx.fill();
      }

      // Lateral Guide Rails (Bright edge tracks)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 4, size);
      ctx.fillRect(size - 4, 0, 4, size);
      ctx.fillStyle = signalHex;
      ctx.fillRect(4, 0, 4, size);
      ctx.fillRect(size - 8, 0, 4, size);
    });
  }

  /**
   * Star-Stone: Obsidian dark monolith material embedded with rare glowing pixel star flecks.
   */
  public static getStarStoneTexture(): THREE.CanvasTexture {
    return this.getOrCreate('star_stone', 64, (ctx, size) => {
      ctx.fillStyle = '#05070a';
      ctx.fillRect(0, 0, size, size);

      // Embedded glowing pixel crystals
      const starCoords = [
        [12, 18], [44, 12], [28, 42], [52, 50], [10, 54], [38, 28]
      ];
      for (const [x, y] of starCoords) {
        ctx.fillStyle = '#a5b4fc';
        ctx.fillRect(x, y, 2, 2);
        ctx.fillStyle = '#e0e7ff';
        ctx.fillRect(x, y, 1, 1);
        ctx.fillStyle = '#4338ca';
        ctx.fillRect(x - 1, y, 1, 1);
        ctx.fillRect(x + 2, y, 1, 1);
        ctx.fillRect(x, y - 1, 1, 1);
        ctx.fillRect(x, y + 2, 1, 1);
      }
    });
  }

  private static getOrCreate(
    key: string,
    size: number,
    paintFn: (ctx: CanvasRenderingContext2D, size: number) => void
  ): THREE.CanvasTexture {
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    if (typeof document === 'undefined') {
      const empty = new THREE.CanvasTexture(null as unknown as HTMLCanvasElement);
      return empty;
    }

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Disable smoothing so generated pixels remain razor crisp
      ctx.imageSmoothingEnabled = false;
      paintFn(ctx, size);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;

    this.cache.set(key, texture);
    return texture;
  }
}
