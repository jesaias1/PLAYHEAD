/**
 * Utility to clean soundtrack filenames into clean display titles
 * Strips 'shiva' prefixes, 'treblo' suffixes, and file extensions.
 */

export function cleanTrackTitle(rawFilename: string): string {
  // 1. Remove extension (.ogg, .mp3, .wav, .flac, .m4a)
  let title = rawFilename.replace(/\.(ogg|mp3|wav|flac|m4a)$/i, '');

  // 2. Remove leading "shiva - " or "shiva " (case-insensitive, with any dash or colon)
  title = title.replace(/^shiva\s*[-–—:]*\s*/i, '');

  // 3. Remove trailing " - treblo" or " treblo" (case-insensitive, with any dash or colon)
  title = title.replace(/\s*[-–—:]*\s*treblo$/i, '');

  return title.trim().toUpperCase();
}
