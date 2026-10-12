/**
 * 8-bit rank gems for the run report: one authored pixel sprite, four
 * palettes. Drawn as crisp SVG rects so it scales without blurring.
 */

export type GemRank = 'BRONZE' | 'SILVER' | 'GOLD' | 'DIAMOND';

/** X outline, W glint, L light facet, M mid facet, D dark facet, . empty. */
const SPRITE = [
  '...XXXXXXX...',
  '..XLLLWLMDX..',
  '.XLLWWLLMMDX.',
  'XLLWWLLLMMDDX',
  'XLLLLLLMMMDDX',
  'XXXXXXXXXXXXX',
  '.XLMMMMMDDDX.',
  '..XLMMMMDDX..',
  '...XLMMDDX...',
  '....XLMDX....',
  '.....XMX.....',
  '......X......'
];

const PALETTES: Record<GemRank, Record<string, string>> = {
  BRONZE: { X: '#3a1a08', W: '#ffe2c2', L: '#e59a5c', M: '#b8672e', D: '#7a3d16' },
  SILVER: { X: '#22262e', W: '#ffffff', L: '#d6dde8', M: '#9aa5b6', D: '#5e6878' },
  GOLD: { X: '#3d2a00', W: '#fff8c8', L: '#ffd84a', M: '#e0a516', D: '#99690a' },
  DIAMOND: { X: '#0b2540', W: '#ffffff', L: '#bff3ff', M: '#5fc8f2', D: '#2b78c8' }
};

export function isGemRank(value: string): value is GemRank {
  return value === 'BRONZE' || value === 'SILVER' || value === 'GOLD' || value === 'DIAMOND';
}

/** Inline SVG markup for a rank's gem. `pixel` is the size of one sprite pixel. */
export function rankGemSvg(rank: GemRank, pixel = 4): string {
  const palette = PALETTES[rank];
  const width = SPRITE[0].length;
  const height = SPRITE.length;
  let rects = '';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const key = SPRITE[y][x];
      if (key === '.') continue;
      rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${palette[key]}"/>`;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width * pixel}" ` +
    `height="${height * pixel}" shape-rendering="crispEdges" role="img" aria-label="${rank} rank">${rects}</svg>`
  );
}
