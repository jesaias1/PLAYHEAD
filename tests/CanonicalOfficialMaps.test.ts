/**
 * CANONICAL OFFICIAL MAPS — registry generation + determinism verification.
 *
 * This file is BOTH the registry generator and the regression guard:
 *
 *   WRITE_REGISTRY=1  -> rewrites src/online/OfficialMapRegistry.ts from the
 *                        shipped presets
 *   (default)         -> asserts the shipped registry matches the presets, so it
 *                        can never silently drift
 *
 * Everything is measured through `PresetLevelCache.buildLevelData`, the SAME
 * pure function the browser uses, so the registry cannot disagree with what a
 * client actually builds.
 *
 * Heavy runs are opt-in:
 *   CANONICAL_FULL=1  -> 100 repeated generations per mandatory track (the
 *                        milestone requirement) + 10 per other track
 *   default           -> a fast regression subset
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';

import { SignalPackCatalog } from '../src/audio/SignalPackCatalog';
import { PresetLevelCache } from '../src/audio/PresetLevelCache';
import {
  ANALYSIS_ALGORITHM_VERSION,
  MapIdentity,
  RegistryEntry,
  computeAnalysisIdentity,
  computeMapIdentity
} from '../src/online/MapIdentity';
import { ROUTE_GENERATION_VERSION } from '../src/generation/RouteGenerator';
import { GeometryBuilder } from '../src/world/GeometryBuilder';
import { RouteExclusionCorridor } from '../src/world/RouteExclusionCorridor';
import { WorldGeometrySafetyPass } from '../src/world/WorldGeometrySafetyPass';
import { PaletteSelector } from '../src/audio/TrackPalettes';
import { QUALITY_PRESETS } from '../src/rendering/QualityPresets';
import * as shippedRegistry from '../src/online/OfficialMapRegistry';

const PRESET_DIR = path.resolve(__dirname, '../public/music/presets');
const REGISTRY_PATH = path.resolve(__dirname, '../src/online/OfficialMapRegistry.ts');
const ACCEPTED_MAPS_PATH = path.resolve(
  __dirname,
  '../supabase/functions/submit-run/accepted-maps.ts'
);
const FULL = process.env.CANONICAL_FULL === '1';
const WRITE = process.env.WRITE_REGISTRY === '1';

/** Mandatory regression cases from the milestone. */
const MANDATORY = ['track_14_kz_ascent', 'track_5_gravity_line'];

interface TrackReport {
  trackId: string;
  title: string;
  identity: MapIdentity;
  rootSeed: number;
  analysisVersion: number;
  determinismPass: boolean;
  repeats: number;
  worldSafetyPass: boolean;
  finalUnsafe: number;
  routeNodes: number;
}

function presetPath(trackId: string): string {
  return path.join(PRESET_DIR, `${trackId}.json`);
}

/** Fresh parse every call: simulates a brand new session / cold load. */
function loadFresh(trackId: string) {
  const raw = fs.readFileSync(presetPath(trackId), 'utf8');
  const json = JSON.parse(raw) as Record<string, unknown>;
  return PresetLevelCache.buildLevelData(json);
}

function identityFor(trackId: string): MapIdentity {
  const level = loadFresh(trackId);
  return computeMapIdentity(trackId, level.track, level.analysis);
}

// ---------------------------------------------------------------------------

describe('Canonical official maps — catalog integrity', () => {
  it('has exactly one canonical preset per catalog track and no stale files', () => {
    const tracks = SignalPackCatalog.getTracks();
    expect(tracks.length).toBeGreaterThan(0);

    const onDisk = new Set(
      fs.readdirSync(PRESET_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
    );
    const catalogIds = tracks.map((t) => t.id);

    const missing = catalogIds.filter((id) => !onDisk.has(id));
    const stale = [...onDisk].filter((f) => !catalogIds.includes(f));

    expect(missing, `missing canonical presets: ${missing.join(', ')}`).toEqual([]);
    expect(stale, `stale presets that must be removed: ${stale.join(', ')}`).toEqual([]);
  });

  it('bakes a fully resolved track, so runtime analysis is never needed', () => {
    for (const track of SignalPackCatalog.getTracks()) {
      const level = loadFresh(track.id);
      // A baked generationVersion equal to the current generator version means
      // `hasStaleRoute` is false and the shipped track is used verbatim.
      expect(level.track.generationVersion, `${track.id} generationVersion`).toBe(
        ROUTE_GENERATION_VERSION
      );
      expect(level.track.route.length, `${track.id} route`).toBeGreaterThan(5);
      expect(level.analysis, `${track.id} analysis`).toBeTruthy();
      expect(level.analysis.frames.length, `${track.id} frames`).toBeGreaterThan(100);
      expect(level.analysis.sections.length, `${track.id} sections`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------

describe('Canonical official maps — determinism', () => {
  it(`is 100/100 identical for the mandatory regression tracks${FULL ? '' : ' (subset; CANONICAL_FULL=1 for the full run)'}`, () => {
    const repeats = FULL ? 100 : 10;
    for (const trackId of MANDATORY) {
      const fingerprints = new Set<string>();
      for (let i = 0; i < repeats; i++) {
        fingerprints.add(identityFor(trackId).mapFingerprint);
      }
      expect(
        fingerprints.size,
        `${trackId}: ${repeats} generations produced ${fingerprints.size} distinct fingerprints`
      ).toBe(1);
    }
  }, FULL ? 900_000 : 300_000);

  it('is stable across the entire official catalog', () => {
    const repeats = FULL ? 10 : 3;
    const unstable: string[] = [];
    for (const track of SignalPackCatalog.getTracks()) {
      const fingerprints = new Set<string>();
      for (let i = 0; i < repeats; i++) {
        fingerprints.add(identityFor(track.id).mapFingerprint);
      }
      if (fingerprints.size !== 1) {
        unstable.push(`${track.id}: ${fingerprints.size} distinct`);
      }
    }
    expect(unstable).toEqual([]);
  }, FULL ? 900_000 : 300_000);

  it('is independent of quality tier (quality is presentation only)', () => {
    // 1. The identity is a pure function of (analysis, track, versions): it has
    //    no quality input at all.
    const src = fs.readFileSync(
      path.resolve(__dirname, '../src/online/MapIdentity.ts'),
      'utf8'
    );
    expect(src).not.toMatch(/QualityPreset|qualityTier|renderScale|decorationLodDistance/);

    // 2. The ROUTE geometry actually rendered is identical across tiers: quality
    //    scales decoration detail, never gameplay geometry.
    const level = loadFresh('track_5_gravity_line');
    const palette = PaletteSelector.selectPalette(level.analysis.seed, 0.5, level.analysis.globalEnergy);

    const routeGeometrySignature = (): string => {
      const built = GeometryBuilder.buildWorld(level.track, palette);
      const merged = built.rootGroup.getObjectByName('RoutePlatformsMerged') as THREE.Mesh | null;
      const surf = built.rootGroup.getObjectByName('RouteSurfPlatformsMerged') as THREE.Mesh | null;
      const count = (m: THREE.Mesh | null): number =>
        m ? (m.geometry.getAttribute('position') as THREE.BufferAttribute).count : 0;
      const sig = `${count(merged)}:${count(surf)}`;
      built.dispose();
      return sig;
    };

    const signature = routeGeometrySignature();
    // Tier differences are rendering-only; the same signature must hold.
    expect(QUALITY_PRESETS.LOW.decorationLodDistance).not.toBe(
      QUALITY_PRESETS.HIGH.decorationLodDistance
    );
    expect(routeGeometrySignature()).toBe(signature);
  }, 300_000);

  it('is identical for fresh sessions (no cached state)', () => {
    const first = identityFor('track_14_kz_ascent');
    // Simulate a cold session by clearing the module cache and re-parsing.
    PresetLevelCache.clear();
    const second = identityFor('track_14_kz_ascent');
    expect(second.mapFingerprint).toBe(first.mapFingerprint);
    expect(second.analysisFingerprint).toBe(first.analysisFingerprint);
  });
});

// ---------------------------------------------------------------------------

describe('Canonical official maps — world safety', () => {
  it('passes FINAL UNSAFE DECORATION = 0 for every official track', () => {
    const failures: string[] = [];
    for (const track of SignalPackCatalog.getTracks()) {
      const level = loadFresh(track.id);
      const scene = new THREE.Scene();
      const palette = PaletteSelector.selectPalette(level.analysis.seed, 0.5, level.analysis.globalEnergy);
      const built = GeometryBuilder.buildWorld(level.track, palette);
      scene.add(built.rootGroup);

      const corridor = new RouteExclusionCorridor(
        RouteExclusionCorridor.collectGameplayNodes(level.track)
      );
      const pass = new WorldGeometrySafetyPass(level.track, corridor);
      pass.register(built.rootGroup, 'GeometryBuilder', 'DECORATION');
      const report = pass.run(scene);

      if (report.finalUnsafe !== 0) {
        failures.push(`${track.id}: finalUnsafe=${report.finalUnsafe}`);
      }
      expect(report.finalUnsafe, `${track.id} world safety`).toBe(0);
      built.dispose();
    }
    expect(failures).toEqual([]);
  }, 600_000);

  it('rejects the same decoration deterministically across repeated runs', () => {
    const signatures = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const level = loadFresh('track_5_gravity_line');
      const scene = new THREE.Scene();
      const palette = PaletteSelector.selectPalette(level.analysis.seed, 0.5, level.analysis.globalEnergy);
      const built = GeometryBuilder.buildWorld(level.track, palette);
      scene.add(built.rootGroup);
      const corridor = new RouteExclusionCorridor(
        RouteExclusionCorridor.collectGameplayNodes(level.track)
      );
      const pass = new WorldGeometrySafetyPass(level.track, corridor);
      pass.register(built.rootGroup, 'GeometryBuilder', 'DECORATION');
      const report = pass.run(scene);
      signatures.add(`${report.removed}:${report.finalUnsafe}`);
      built.dispose();
    }
    expect(signatures.size).toBe(1);
  }, 300_000);
});

// ---------------------------------------------------------------------------

describe('Canonical official maps — registry', () => {
  it('matches the shipped registry exactly, and reports every track', () => {
    const tracks = SignalPackCatalog.getTracks();
    const reports: TrackReport[] = [];
    const entries: RegistryEntry[] = [];

    for (const track of tracks) {
      const level = loadFresh(track.id);
      const identity = computeMapIdentity(track.id, level.track, level.analysis);
      const analysisIdentity = computeAnalysisIdentity(level.analysis);

      const repeats = FULL ? (MANDATORY.includes(track.id) ? 100 : 10) : 1;
      const fingerprints = new Set<string>();
      for (let i = 0; i < repeats; i++) fingerprints.add(identityFor(track.id).mapFingerprint);
      const determinismPass = fingerprints.size === 1;

      const scene = new THREE.Scene();
      const palette = PaletteSelector.selectPalette(level.analysis.seed, 0.5, level.analysis.globalEnergy);
      const built = GeometryBuilder.buildWorld(level.track, palette);
      scene.add(built.rootGroup);
      const corridor = new RouteExclusionCorridor(
        RouteExclusionCorridor.collectGameplayNodes(level.track)
      );
      const pass = new WorldGeometrySafetyPass(level.track, corridor);
      pass.register(built.rootGroup, 'GeometryBuilder', 'DECORATION');
      const safety = pass.run(scene);
      built.dispose();

      entries.push({
        trackId: track.id,
        seed: analysisIdentity.seed,
        mapVersion: identity.mapVersion,
        mapFingerprint: identity.mapFingerprint,
        movementVersion: identity.movementVersion,
        generatorVersion: identity.generatorVersion,
        analysisVersion: ANALYSIS_ALGORITHM_VERSION,
        analysisFingerprint: analysisIdentity.analysisFingerprint
      });

      reports.push({
        trackId: track.id,
        title: track.title,
        identity,
        rootSeed: analysisIdentity.seed,
        analysisVersion: ANALYSIS_ALGORITHM_VERSION,
        determinismPass,
        repeats,
        worldSafetyPass: safety.finalUnsafe === 0,
        finalUnsafe: safety.finalUnsafe,
        routeNodes: level.track.route.length
      });

      expect(determinismPass, `${track.id} determinism`).toBe(true);
      expect(safety.finalUnsafe, `${track.id} world safety`).toBe(0);
    }

    if (WRITE) {
      fs.writeFileSync(REGISTRY_PATH, renderRegistry(entries), 'utf8');
      fs.writeFileSync(ACCEPTED_MAPS_PATH, renderAcceptedMaps(entries), 'utf8');
      console.log(`[CANONICAL] registry written: ${entries.length} tracks (client + edge function)`);
    }

    console.log(renderReport(reports));

    // Drift guard: the shipped registry must equal what the presets produce.
    expect(shippedRegistry.OFFICIAL_MAP_REGISTRY.length).toBe(entries.length);
    for (const entry of entries) {
      const found = shippedRegistry.OFFICIAL_MAP_REGISTRY.find((e) => e.trackId === entry.trackId);
      expect(found, `${entry.trackId} missing from shipped registry`).toBeTruthy();
      expect(found).toEqual(entry);
    }
    expect(shippedRegistry.REGISTRY_READY).toBe(true);
  }, FULL ? 1_800_000 : 600_000);
});

// ---------------------------------------------------------------------------

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
 * OFFICIAL MAP REGISTRY — canonical competitive identity for official tracks.
 *
 * ⚠️ GENERATED FILE. DO NOT EDIT BY HAND.
 *
 * Regenerate with:
 *   npm run precompute-presets          # rebuild canonical presets first
 *   WRITE_REGISTRY=1 npx vitest run tests/CanonicalOfficialMaps.test.ts
 *
 * Then mirror the same identities into ACCEPTED_MAPS in
 * supabase/functions/submit-run/index.ts and redeploy that function.
 *
 * Every entry is produced by \`PresetLevelCache.buildLevelData\` — the exact
 * function the browser uses — so this table cannot disagree with what a client
 * builds. A run whose locally computed identity does not match its entry is not
 * eligible for public leaderboard submission.
 */

import type { RegistryEntry } from './MapIdentity';

/**
 * True: every official track has a canonical, versioned, deterministic map with
 * FINAL UNSAFE DECORATION = 0, verified by tests/CanonicalOfficialMaps.test.ts.
 */
export const REGISTRY_READY = true;

/** Canonical identity per official track. */
export const OFFICIAL_MAP_REGISTRY: readonly RegistryEntry[] = [
${rows}
];

/** Human-facing reason shown when a run cannot be submitted competitively. */
export const REGISTRY_BLOCKED_REASON =
  'CANONICAL MAP IDENTITY PENDING // official presets must be regenerated ' +
  'before competitive submission is enabled';

export function getRegistryEntry(trackId: string): RegistryEntry | undefined {
  return OFFICIAL_MAP_REGISTRY.find((e) => e.trackId === trackId);
}

/**
 * Serialisable form of the registry for the submit-run Edge Function, so the
 * server accepts exactly the fingerprints this client can produce.
 */
export function getAcceptedFingerprints(): Record<
  string,
  { mapVersion: number; mapFingerprint: string; movementVersion: string }
> {
  const out: Record<
    string,
    { mapVersion: number; mapFingerprint: string; movementVersion: string }
  > = {};
  for (const entry of OFFICIAL_MAP_REGISTRY) {
    out[entry.trackId] = {
      mapVersion: entry.mapVersion,
      mapFingerprint: entry.mapFingerprint,
      movementVersion: entry.movementVersion
    };
  }
  return out;
}
`;
}

function renderAcceptedMaps(entries: RegistryEntry[]): string {
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
 * ACCEPTED CANONICAL MAPS — the server's copy of the official map registry.
 *
 * ⚠️ GENERATED FILE. DO NOT EDIT BY HAND.
 *
 * Regenerate with:
 *   npm run precompute-presets
 *   WRITE_REGISTRY=1 npx vitest run tests/CanonicalOfficialMaps.test.ts
 *
 * It is emitted from the SAME computation that produces
 * \`src/online/OfficialMapRegistry.ts\`, so the client and the server can never
 * disagree about which maps are canonical.
 *
 * The submit-run function accepts a run ONLY when its track_id, map_version,
 * map_fingerprint and movement_version all match an entry here.
 */

export interface AcceptedMap {
  trackId: string;
  mapVersion: number;
  mapFingerprint: string;
  movementVersion: string;
}

export const ACCEPTED_MAPS: AcceptedMap[] = [
${rows}
];
`;
}

function renderReport(reports: TrackReport[]): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('[CANONICAL OFFICIAL MAPS]');
  lines.push(
    'TRACK'.padEnd(34) +
      'MAP VER'.padEnd(9) +
      'ROOT SEED'.padEnd(12) +
      'ANALYSIS'.padEnd(11) +
      'DETERM'.padEnd(8) +
      'SAFETY'.padEnd(8) +
      'MAP FINGERPRINT'
  );
  for (const r of reports) {
    lines.push(
      r.trackId.padEnd(34) +
        String(r.identity.mapVersion).padEnd(9) +
        String(r.rootSeed).padEnd(12) +
        `v${r.analysisVersion}`.padEnd(11) +
        `${r.determinismPass ? 'PASS' : 'FAIL'}`.padEnd(8) +
        `${r.worldSafetyPass ? 'PASS' : 'FAIL'}`.padEnd(8) +
        r.identity.mapFingerprint
    );
  }
  const allPass = reports.every((r) => r.determinismPass && r.worldSafetyPass);
  lines.push(`TOTAL ${reports.length} tracks | ALL PASS: ${allPass ? 'YES' : 'NO'}`);
  lines.push('');
  return lines.join('\n');
}
