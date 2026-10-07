/**
 * CANONICAL SURF MAPS — registry generation + determinism verification.
 *
 * This file is BOTH the SURF registry generator and its regression guard:
 *
 *   WRITE_REGISTRY=1  -> rewrites src/online/OfficialSurfMapRegistry.ts and
 *                        supabase/functions/submit-run/accepted-surf-maps.ts
 *   (default)         -> asserts the shipped registry matches a fresh
 *                        regeneration, so it can never silently drift
 *
 * The regeneration uses the SAME deterministic inputs the client uses: the
 * shipped official preset analysis (whose duration is the actual decoded
 * buffer duration baked at precompute time) and the SURF generation version.
 * Filenames are never trusted.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { SignalPackCatalog } from '../src/audio/SignalPackCatalog';
import { PresetLevelCache } from '../src/audio/PresetLevelCache';
import { TrackGenerator } from '../src/generation/TrackGenerator';
import { computeSurfMapIdentity, surfBoardTrackId, SURF_MOVEMENT_VERSION } from '../src/online/SurfMapIdentity';
import { computeAnalysisIdentity, RegistryEntry } from '../src/online/MapIdentity';
import { OFFICIAL_SURF_MAP_REGISTRY } from '../src/online/OfficialSurfMapRegistry';

const PRESET_DIR = path.resolve(__dirname, '../public/music/presets');
const SURF_REGISTRY_PATH = path.resolve(__dirname, '../src/online/OfficialSurfMapRegistry.ts');
const ACCEPTED_SURF_PATH = path.resolve(
  __dirname,
  '../supabase/functions/submit-run/accepted-surf-maps.ts'
);
const WRITE = process.env.WRITE_REGISTRY === '1';

function loadFresh(trackId: string) {
  const raw = fs.readFileSync(path.join(PRESET_DIR, `${trackId}.json`), 'utf8');
  const json = JSON.parse(raw) as Record<string, unknown>;
  return PresetLevelCache.buildLevelData(json);
}

/** Regenerate the official SURF map from its shipped deterministic inputs. */
function regenerate(trackId: string): RegistryEntry {
  const level = loadFresh(trackId);
  const track = TrackGenerator.generate(level.analysis, 'SURF');
  const identity = computeSurfMapIdentity(trackId, track, level.analysis);
  const analysisIdentity = computeAnalysisIdentity(level.analysis);
  return {
    trackId: identity.trackId,
    seed: analysisIdentity.seed,
    mapVersion: identity.mapVersion,
    mapFingerprint: identity.mapFingerprint,
    movementVersion: identity.movementVersion,
    generatorVersion: identity.generatorVersion,
    analysisVersion: 1,
    analysisFingerprint: analysisIdentity.analysisFingerprint
  };
}

describe('Canonical SURF maps — namespacing', () => {
  it('namespaces every surf board id and never uses a bare official id', () => {
    for (const track of SignalPackCatalog.getTracks()) {
      const level = loadFresh(track.id);
      const surfTrack = TrackGenerator.generate(level.analysis, 'SURF');
      expect(surfTrack.obstacles?.length ?? 0, `${track.id} authored Surf challenges`).toBeGreaterThan(0);
      const identity = computeSurfMapIdentity(track.id, surfTrack, level.analysis);
      expect(identity.trackId.startsWith(`surf:${track.id}:`)).toBe(true);
      expect(identity.trackId).toBe(surfBoardTrackId(track.id, identity.mapFingerprint));
      expect(identity.trackId).not.toBe(track.id);
      expect(identity.generatorVersion).toContain('surf_gen_');
      expect(identity.movementVersion).toBe(SURF_MOVEMENT_VERSION);
    }
  });
});

describe('Canonical SURF maps — registry', () => {
  it('matches a fresh regeneration exactly and is deterministic', () => {
    const entries: RegistryEntry[] = [];
    for (const track of SignalPackCatalog.getTracks()) {
      const entry = regenerate(track.id);
      // Determinism: a second regeneration is byte-identical.
      const again = regenerate(track.id);
      expect(again.mapFingerprint, `${track.id} determinism`).toBe(entry.mapFingerprint);
      expect(again.trackId, `${track.id} id determinism`).toBe(entry.trackId);
      entries.push(entry);
    }

    if (WRITE) {
      fs.writeFileSync(SURF_REGISTRY_PATH, renderRegistry(entries), 'utf8');
      fs.writeFileSync(ACCEPTED_SURF_PATH, renderAccepted(entries), 'utf8');
    }

    expect(entries.length).toBe(SignalPackCatalog.getTracks().length);
    if (!WRITE) {
      const shipped = new Map(OFFICIAL_SURF_MAP_REGISTRY.map((e) => [e.trackId, e]));
      for (const entry of entries) {
        const found = shipped.get(entry.trackId);
        expect(found, `shipped surf registry missing ${entry.trackId}`).toBeTruthy();
        expect(found!.mapFingerprint).toBe(entry.mapFingerprint);
        expect(found!.movementVersion).toBe(entry.movementVersion);
      }
      expect(OFFICIAL_SURF_MAP_REGISTRY.length).toBe(entries.length);
    }
  }, 300_000);
});

function renderRegistry(entries: RegistryEntry[]): string {
  const rows = entries
    .map(
      (e) =>
        `  {\n` +
        `    trackId: '${e.trackId}',\n` +
        `    seed: ${e.seed},\n` +
        `    mapVersion: ${e.mapVersion},\n` +
        `    mapFingerprint: '${e.mapFingerprint}',\n` +
        `    movementVersion: '${e.movementVersion}',\n` +
        `    generatorVersion: '${e.generatorVersion}',\n` +
        `    analysisVersion: ${e.analysisVersion},\n` +
        `    analysisFingerprint: '${e.analysisFingerprint}'\n` +
        `  }`
    )
    .join(',\n');

  return `/**
 * OFFICIAL SURF MAP REGISTRY — canonical competitive identity for official
 * SURF maps.
 *
 * ⚠️ GENERATED FILE. DO NOT EDIT BY HAND.
 *
 * Regenerate with:
 *   WRITE_REGISTRY=1 npx vitest run tests/CanonicalSurfMaps.test.ts
 *
 * Each entry is derived from the SAME deterministic inputs the client uses to
 * regenerate the surf course: the shipped official preset analysis (actual
 * decoded duration) plus the SURF generator version. The track id is
 * namespace-prefixed so a surf record can never mix with a NORMAL record.
 */

import type { RegistryEntry } from './MapIdentity';

export const SURF_REGISTRY_READY = true;

export const OFFICIAL_SURF_MAP_REGISTRY: readonly RegistryEntry[] = [
${rows}
];
`;
}

function renderAccepted(entries: RegistryEntry[]): string {
  const rows = entries
    .map(
      (e) =>
        `  {\n` +
        `    trackId: '${e.trackId}',\n` +
        `    mapVersion: ${e.mapVersion},\n` +
        `    mapFingerprint: '${e.mapFingerprint}',\n` +
        `    movementVersion: '${e.movementVersion}'\n` +
        `  }`
    )
    .join(',\n');

  return `/**
 * ACCEPTED CANONICAL SURF MAPS — the server's copy of the SURF registry.
 *
 * ⚠️ GENERATED FILE. DO NOT EDIT BY HAND.
 *
 * Regenerate with:
 *   WRITE_REGISTRY=1 npx vitest run tests/CanonicalSurfMaps.test.ts
 *
 * Emitted from the SAME computation as src/online/OfficialSurfMapRegistry.ts.
 * The submit-run function accepts a SURF run ONLY when its namespaced track_id,
 * map_version, map_fingerprint and movement_version all match an entry here.
 */

export interface AcceptedSurfMap {
  trackId: string;
  mapVersion: number;
  mapFingerprint: string;
  movementVersion: string;
}

export const ACCEPTED_SURF_MAPS: AcceptedSurfMap[] = [
${rows}
];
`;
}
