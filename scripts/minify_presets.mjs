/**
 * MINIFY CANONICAL PRESETS — formatting-only production step.
 *
 * Rewrites every `public/music/presets/*.json` file without pretty-print
 * whitespace. This is a FORMATTING change and nothing else:
 *
 *   - no float rounding, no array truncation, no key removal
 *   - no analysis recomputation, no route changes, no regeneration
 *   - the parsed object graph is structurally identical before and after
 *
 * The script REFUSES to write a file whose structural digest changed, and
 * reports the exact byte savings. Safe to re-run (idempotent).
 *
 * Canonical identity is verified separately and more strongly by the registry
 * drift guard:
 *
 *   npx vitest run tests/CanonicalOfficialMaps.test.ts
 *
 * Usage:  node scripts/minify_presets.mjs [--check]
 *         --check  report savings without writing
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PRESETS_DIR = path.resolve(process.cwd(), 'public/music/presets');
const CHECK_ONLY = process.argv.includes('--check');

/**
 * Order-sensitive structural digest of a parsed JSON value.
 *
 * Walks the real object graph, tagging every type and preserving array order
 * and object key order. Two payloads with the same digest are structurally
 * identical, which is a stronger claim than "re-stringify matches".
 */
function structuralDigest(value) {
  const hash = crypto.createHash('sha256');
  const walk = (v) => {
    if (v === null) return hash.update('n;');
    if (Array.isArray(v)) {
      hash.update(`a[${v.length}]{`);
      for (const item of v) walk(item);
      hash.update('}');
      return;
    }
    switch (typeof v) {
      case 'number':
        // Tag with the exact IEEE value, so no numeric drift can hide.
        hash.update(`d:${Object.is(v, -0) ? '-0' : v};`);
        return;
      case 'string':
        hash.update(`s:${v.length}:${v};`);
        return;
      case 'boolean':
        hash.update(`b:${v};`);
        return;
      case 'object': {
        const keys = Object.keys(v);
        hash.update(`o[${keys.length}]{`);
        for (const key of keys) {
          hash.update(`k:${key}:`);
          walk(v[key]);
        }
        hash.update('}');
        return;
      }
      default:
        hash.update(`x:${String(v)};`);
    }
  };
  walk(value);
  return hash.digest('hex');
}

if (!fs.existsSync(PRESETS_DIR)) {
  console.error(`[MINIFY] Presets directory not found: ${PRESETS_DIR}`);
  process.exit(1);
}

const files = fs
  .readdirSync(PRESETS_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

if (files.length === 0) {
  console.error('[MINIFY] No preset JSON files found.');
  process.exit(1);
}

let bytesBefore = 0;
let bytesAfter = 0;
let changed = 0;
let largest = { name: '', before: 0, after: 0 };
const failures = [];

for (const file of files) {
  const full = path.join(PRESETS_DIR, file);
  const before = fs.readFileSync(full, 'utf8');
  bytesBefore += Buffer.byteLength(before, 'utf8');

  let parsed;
  try {
    parsed = JSON.parse(before);
  } catch (err) {
    failures.push(`${file}: unparseable (${err.message})`);
    continue;
  }

  const digestBefore = structuralDigest(parsed);

  const after = JSON.stringify(parsed);
  const digestAfter = structuralDigest(JSON.parse(after));

  if (digestBefore !== digestAfter) {
    failures.push(`${file}: STRUCTURAL DIGEST CHANGED (${digestBefore} -> ${digestAfter})`);
    continue;
  }

  const afterBytes = Buffer.byteLength(after, 'utf8');
  bytesAfter += afterBytes;

  if (afterBytes > largest.after) {
    largest = { name: file, before: Buffer.byteLength(before, 'utf8'), after: afterBytes };
  }

  if (after !== before) {
    changed++;
    if (!CHECK_ONLY) {
      // Preserve the original trailing newline convention (none was present).
      fs.writeFileSync(full, after, 'utf8');
    }
  }
}

if (failures.length > 0) {
  console.error('[MINIFY] ABORTED — structural identity would change:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

const mb = (b) => (b / 1024 / 1024).toFixed(2);
const pct = bytesBefore > 0 ? (100 * (1 - bytesAfter / bytesBefore)).toFixed(1) : '0.0';

console.log(`[MINIFY] ${files.length} presets, structural identity VERIFIED`);
console.log(`[MINIFY] files rewritten: ${changed}${CHECK_ONLY ? ' (check only — nothing written)' : ''}`);
console.log(`[MINIFY] total: ${mb(bytesBefore)} MB -> ${mb(bytesAfter)} MB  (-${pct}%)`);
console.log(
  `[MINIFY] largest: ${largest.name} ${mb(largest.before)} MB -> ${mb(largest.after)} MB`
);
