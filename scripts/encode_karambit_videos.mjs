/**
 * ENCODE KARAMBIT ANIMATED SKINS — production step for video-backed cosmetics.
 *
 * WHY THIS EXISTS
 *
 * Animated knife skins are `THREE.VideoTexture`s. A video texture re-uploads the
 * whole decoded frame to the GPU every time the video advances, so upload
 * traffic scales with pixel count:
 *
 *     1920x1080 @ 30 fps -> ~249 MB/s
 *      960x540  @ 30 fps ->  ~62 MB/s
 *      640x360  @ 30 fps ->  ~28 MB/s
 *
 * The source assets shipped at up to 1920x1080 with an unused AAC audio track on
 * ten of the fifteen files. The blade interior occupies a small part of the
 * first-person view, so that resolution and audio were pure cost.
 *
 * WHAT IT PRODUCES
 *
 * For every `<name>.mp4` in the source directory:
 *   - `<name>.mp4`      long side 960, CRF 26, no audio  (STANDARD tiers)
 *   - `<name>.low.mp4`  long side 640, CRF 27, no audio  (LOW / MEDIUM tiers)
 *
 * Both are h264/yuv420p with `+faststart` so playback can begin before the whole
 * file has arrived, and both keep the source frame rate and aspect ratio
 * (portrait sources stay portrait).
 *
 * QUALITY IS A HUMAN CALL. SSIM against the source at these settings measured
 * 0.93-0.97 including the resolution reduction, which is comfortably inside the
 * "indistinguishable on a viewmodel" band — but verify visually before shipping
 * a re-encode.
 *
 * REQUIREMENT: ffmpeg on PATH (or set FFMPEG=/path/to/ffmpeg).
 *   ffmpeg -version
 *
 * ⚠ RUN THIS ONLY ON ORIGINAL MASTERS.
 * The files currently in `public/.../videos` are already the 960/640 productions
 * of this script. Re-running it on them would re-encode an already-encoded file
 * (a generational quality loss) and inflate the "source total" it reports. If a
 * new cosmetic is added, drop its ORIGINAL file in and run the script; if you
 * need to restore a master, take it from git history.
 *
 * USAGE:
 *   node scripts/encode_karambit_videos.mjs [--check]
 *     --check   print the plan without writing anything
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const VIDEO_DIR = path.resolve(process.cwd(), 'public/assets/viewmodel/karambit/videos');
const CHECK_ONLY = process.argv.includes('--check');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

const TARGETS = [
  { suffix: '', longSide: 960, crf: 26, label: 'standard' },
  { suffix: '.low', longSide: 640, crf: 27, label: 'low' }
];

try {
  execFileSync(FFMPEG, ['-version'], { stdio: 'ignore' });
} catch {
  console.error(
    `[ENCODE] ffmpeg not found (tried "${FFMPEG}").\n` +
      '         Install ffmpeg, or set FFMPEG=/path/to/ffmpeg. Nothing was written.'
  );
  process.exit(1);
}

if (!fs.existsSync(VIDEO_DIR)) {
  console.error(`[ENCODE] Video directory not found: ${VIDEO_DIR}`);
  process.exit(1);
}

// Only true sources are inputs: never re-encode an already-generated variant.
const sources = fs
  .readdirSync(VIDEO_DIR)
  .filter((f) => f.endsWith('.mp4') && !f.endsWith('.low.mp4'))
  .sort();

if (sources.length === 0) {
  console.error('[ENCODE] No source .mp4 files found.');
  process.exit(1);
}

const mb = (b) => (b / 1048576).toFixed(2);
let before = 0;
let after = 0;

for (const file of sources) {
  const src = path.join(VIDEO_DIR, file);
  before += fs.statSync(src).size;

  for (const target of TARGETS) {
    const base = file.replace(/\.mp4$/, '');
    const out = path.join(VIDEO_DIR, `${base}${target.suffix}.mp4`);
    const scale =
      `scale='if(gt(iw,ih),${target.longSide},-2)':'if(gt(iw,ih),-2,${target.longSide})'`;

    if (!CHECK_ONLY) {
      execFileSync(
        FFMPEG,
        [
          '-y', '-loglevel', 'error',
          '-i', src,
          '-vf', scale,
          '-an',
          '-c:v', 'libx264',
          '-crf', String(target.crf),
          '-preset', 'slow',
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
          out
        ],
        { stdio: 'inherit' }
      );
    }
    if (fs.existsSync(out)) after += fs.statSync(out).size;
  }
  console.log(`[ENCODE] ${file} done`);
}

console.log(
  `[ENCODE] ${sources.length} sources -> ${TARGETS.length} variants each` +
    `${CHECK_ONLY ? ' (check only — nothing written)' : ''}`
);
console.log(`[ENCODE] source total ${mb(before)} MB | shipped total ${mb(after)} MB`);
