/**
 * ARMORY SIGNAL DROP ACCEPTANCE — client-side state machine.
 *
 * These tests pin the PRODUCTION contract that a local flag cannot mint premium
 * ownership and that a server-issued drop is the only thing the Armory may open:
 *
 *   - Real class award state vs SERVER-CONFIGURED legacy suppression.
 *   - Duplicate notification suppression + pending count.
 *   - A returned unowned KNIFE/GLOVE result becomes owned exactly once.
 *   - Opened-id receipt / retry is idempotent and never rerolls.
 *   - A delayed RPC that resolves AFTER an account switch refuses to apply.
 *   - The cloud pending set is REPLACED (empty on another device / opened).
 *   - Existing replay-override / equip isolation is preserved.
 *   - The silent video factory is muted/looping/playsInline and pause/release/
 *     resume never leaks more than one live decoder.
 *
 * Offline/DEV relies on the class's own roller; the server-configured device is
 * the same instance WITH an opener installed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

import {
  KarambitSkinSystem,
  KARAMBIT_SKINS,
  SIGNAL_DROP_STORAGE_KEY,
  TOTAL_SIGNAL_PACK_TRACKS
} from '../src/viewmodel/KarambitSkinSystem';
import { SignalPackCatalog } from '../src/audio/SignalPackCatalog';
import { dropEligibleGloves } from '../src/viewmodel/DropGloveCatalog';
import { KarambitCosmicMaterial } from '../src/viewmodel/KarambitCosmicShader';

function createLocalStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, String(value)); }
  };
}

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

it('keeps the server reward catalog aligned with eligible cosmetic identities and rarities', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261009000000_white_glove_finishes.sql', import.meta.url), 'utf8');
  const catalog = JSON.parse(sql.match(/select \$q\$(\[[\s\S]*?\])\$q\$::jsonb/)![1]);
  const eligible = [...KARAMBIT_SKINS.filter(s => s.dropEligible), ...dropEligibleGloves()]
    .map(s => ({ id: s.id, rarity: s.rarity })).sort((a,b)=>a.id.localeCompare(b.id));
  expect(catalog.sort((a: {id:string},b: {id:string})=>a.id.localeCompare(b.id))).toEqual(eligible);
});

// A minimal, well-behaved video element stub that records the lifecycle calls.
function createVideoStub() {
  const element: Record<string, unknown> = {
    src: '',
    muted: false,
    defaultMuted: false,
    loop: false,
    playsInline: false,
    preload: '',
    crossOrigin: '',
    controls: true,
    disablePictureInPicture: false,
    videoWidth: 1920,
    videoHeight: 1080,
    readyState: 4,
    paused: false,
    currentSrc: '',
    play: vi.fn(function (this: { paused: boolean }) { this.paused = false; return Promise.resolve(); }),
    pause: vi.fn(function (this: { paused: boolean }) { this.paused = true; }),
    removeAttribute: vi.fn(),
    load: vi.fn()
  };
  return element;
}

describe('Armory Signal Drops — acceptance', () => {
  let skinSystem: KarambitSkinSystem;

  beforeEach(() => {
    (KarambitSkinSystem as any).instance?.dispose?.();
    Object.defineProperty(globalThis, 'localStorage', {
      value: createLocalStorageMock(), configurable: true, writable: true
    });
    (KarambitSkinSystem as any).instance = null;
    skinSystem = KarambitSkinSystem.getInstance();
  });

  afterEach(() => {
    skinSystem.setStructuredDropOpener(null);
    (KarambitSkinSystem as any).instance?.dispose?.();
    (KarambitSkinSystem as any).instance = null;
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Real award state vs server-configured legacy suppression
  // -------------------------------------------------------------------------
  it('records a first-DIAMOND per track but never mints a local openable rank', () => {
    const tracks = SignalPackCatalog.getTracks();
    for (const track of tracks) {
      const completion = skinSystem.recordTrackCompletion(track.id, 'DIAMOND', track.id);
      expect(completion.awardedDropRanks).toEqual(['DIAMOND']);
    }
    // One notification key per unique track, no duplications.
    expect(skinSystem.getAwardedDiamondDropKeys()).toHaveLength(TOTAL_SIGNAL_PACK_TRACKS);
    expect(new Set(skinSystem.getAwardedDiamondDropKeys()).size).toBe(TOTAL_SIGNAL_PACK_TRACKS);
    // No client-side pending drop was created by the SERVER's job.
    expect(skinSystem.getPendingDropCount()).toBe(0);
    expect(skinSystem.getLegacyPendingDropCount()).toBe(0);
  });

  it('does not double-notify a repeated DIAMOND on the same track', () => {
    const track = SignalPackCatalog.getTracks()[0];
    expect(skinSystem.recordTrackCompletion(track.id, 'DIAMOND', track.id).awardedDropRanks)
      .toEqual(['DIAMOND']);
    expect(skinSystem.recordTrackCompletion(track.id, 'DIAMOND', track.id).awardedDropRanks)
      .toEqual([]);
    expect(skinSystem.getAwardedDiamondDropKeys()).toEqual([track.id]);
  });

  it('suppresses the legacy DEV roller while a server opener is configured', async () => {
    skinSystem.grantDevPendingSignals(5, 'GOLD');
    expect(skinSystem.getPendingDropCount()).toBe(5);

    const opener = vi.fn(async (id: string) => ({ dropId: id, cosmeticId: 'ASTRAL', kind: 'KNIFE' as const }));
    skinSystem.setStructuredDropOpener(opener);

    // A configured cloud opener means the legacy rank roller is UNREACHABLE.
    expect(skinSystem.hasStructuredDropPending()).toBe(false);
    const opened = await skinSystem.openNextDrop();
    expect(opened).toBeNull();
    expect(opener).not.toHaveBeenCalled();

    // After the server ledger hydrates, the stale legacy count is reconciled away.
    skinSystem.applyCloudDropLedger({ unopened: [], opened: [], tracks: [] });
    expect(skinSystem.getLegacyPendingDropCount()).toBe(0);
    expect(skinSystem.getPendingDropCount()).toBe(0);
  });

  it('keeps the offline roller for a device with NO cloud opener', async () => {
    skinSystem.grantDevPendingSignals(3, 'GOLD');
    const opened = await skinSystem.openNextDrop();
    expect(opened).not.toBeNull();
    expect(skinSystem.getPendingDropCount()).toBe(2);
  });
  it('does not duplicate a drop id and never inflates the pending count', () => {
    skinSystem.mergeCloudDropAward(UUID_A);
    skinSystem.mergeCloudDropAward(UUID_A);
    skinSystem.mergeCloudDropAward(UUID_A);
    expect(skinSystem.getUnopenedDropIds()).toEqual([UUID_A]);
    expect(skinSystem.getPendingDropCount()).toBe(1);
    // The server ledger may echo the same id; unioned without duplication.
    skinSystem.applyCloudDropLedger({ unopened: [UUID_A], opened: [], tracks: [] });
    expect(skinSystem.getUnopenedDropIds()).toEqual([UUID_A]);
    expect(skinSystem.getPendingDropCount()).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 2. Server open: unowned knife / glove results become owned exactly once
  // -------------------------------------------------------------------------
  it('applies an unowned KNIFE server result once and records the opened id', async () => {
    const target = KARAMBIT_SKINS.find((s) => s.id === 'ASTRAL')!;
    expect(skinSystem.isSkinRewardOwned(target.id)).toBe(false);

    skinSystem.mergeCloudDropAward(UUID_A);
    skinSystem.setStructuredDropOpener(async (id) => ({ dropId: id, cosmeticId: 'ASTRAL', kind: 'KNIFE' }));

    const reward = await skinSystem.openNextDrop();
    expect(reward).not.toBeNull();
    expect(reward!.kind).toBe('KNIFE');
    expect(reward!.item.id).toBe('ASTRAL');
    expect(reward!.dropId).toBe(UUID_A);
    expect(skinSystem.isSkinRewardOwned('ASTRAL')).toBe(true);
    expect(skinSystem.getUnopenedDropIds()).toEqual([]);
    expect(skinSystem.getOpenedDropIds()).toEqual([UUID_A]);
  });

  it('applies an unowned GLOVE server result once', async () => {
    const glove = dropEligibleGloves()[0];
    skinSystem.mergeCloudDropAward(UUID_B);
    skinSystem.setStructuredDropOpener(async (id) => ({ dropId: id, cosmeticId: glove.id, kind: 'GLOVE' }));

    const reward = await skinSystem.openNextDrop();
    expect(reward).not.toBeNull();
    expect(reward!.kind).toBe('GLOVE');
    expect(reward!.item.id).toBe(glove.id);
    expect(skinSystem.isDropGloveOwned(glove.id)).toBe(true);
    // A glove award never touches the knife ledger.
    expect(skinSystem.getRewardOwnedSkinIds()).not.toContain(glove.id);
  });

  // -------------------------------------------------------------------------
  // 3. Receipt / retry idempotency
  // -------------------------------------------------------------------------
  it('never rerolls an already-opened id and is idempotent on retry', async () => {
    skinSystem.mergeCloudDropAward(UUID_A);
    let calls = 0;
    skinSystem.setStructuredDropOpener(async (id) => {
      calls += 1;
      return { dropId: id, cosmeticId: 'REDSHIFT', kind: 'KNIFE' as const };
    });

    const first = await skinSystem.openNextDrop();
    expect(first!.item.id).toBe('REDSHIFT');
    expect(calls).toBe(1);

    // The id is no longer pending, so a retry cannot open anything.
    const retry = await skinSystem.openNextDrop();
    expect(retry).toBeNull();
    expect(calls).toBe(1);

    // Direct replay of the SAME server result is idempotent and cannot reroll.
    const replay = skinSystem.applyServerDropResult({ dropId: UUID_A, cosmeticId: 'ASTRAL', kind: 'KNIFE' });
    expect(replay).not.toBeNull();
    expect(replay!.item.id).toBe('ASTRAL');
    expect(skinSystem.getOpenedDropIds()).toEqual([UUID_A]);
    // Ownership is additive: the earlier winner is still owned.
    expect(skinSystem.isSkinRewardOwned('REDSHIFT')).toBe(true);
  });

  it('treats a spent / collection-complete open as a no-cosmetic result', async () => {
    // Own everything eligible so the server resolves an empty winner.
    const knifeIds = KARAMBIT_SKINS.filter((s) => s.dropEligible).map((s) => s.id);
    skinSystem.applyCloudProgression({ rewardOwnedSkinIds: [...knifeIds, ...dropEligibleGloves().map((g) => g.id)] });

    skinSystem.mergeCloudDropAward(UUID_B);
    skinSystem.setStructuredDropOpener(async (id) => ({ dropId: id, cosmeticId: null, kind: null }));

    const reward = await skinSystem.openNextDrop();
    expect(reward).not.toBeNull();
    expect(reward!.isCollectionComplete).toBe(true);
    expect(reward!.item).toBeDefined();
    expect(skinSystem.getOpenedDropIds()).toEqual([UUID_B]);
    expect(skinSystem.getUnopenedDropIds()).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 4. Account-generation guard
  // -------------------------------------------------------------------------
  it('discards a delayed RPC that resolves AFTER an account reset', async () => {
    skinSystem.mergeCloudDropAward(UUID_A);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let openerDropId = '';
    skinSystem.setStructuredDropOpener(async (id) => {
      openerDropId = id;
      await gate;
      return { dropId: id, cosmeticId: 'ASTRAL', kind: 'KNIFE' as const };
    });

    const pending = skinSystem.openNextDrop();
    expect(openerDropId).toBe(UUID_A);

    // A different account is adopted while the RPC is in flight.
    skinSystem.resetProgressionForAccountSwitch();
    release();

    await expect(pending).rejects.toThrow(/account changed/);
    // The new account inherited NOTHING from the in-flight open.
    expect(skinSystem.getUnopenedDropIds()).toEqual([]);
    expect(skinSystem.getOpenedDropIds()).toEqual([]);
    expect(skinSystem.isSkinRewardOwned('ASTRAL')).toBe(false);
  });

  it('refuses a server id the account no longer has pending', async () => {
    skinSystem.mergeCloudDropAward(UUID_A);
    skinSystem.setStructuredDropOpener(async () => ({ dropId: UUID_B, cosmeticId: 'ASTRAL', kind: 'KNIFE' as const }));
    await expect(skinSystem.openNextDrop()).rejects.toThrow(/no longer pending/);
    expect(skinSystem.isSkinRewardOwned('ASTRAL')).toBe(false);
    expect(skinSystem.getOpenedDropIds()).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 5. Cloud pending set is REPLACED, not unioned
  // -------------------------------------------------------------------------
  it('replaces the pending set when another device opened the drop', () => {
    skinSystem.mergeCloudDropAward(UUID_A);
    expect(skinSystem.getUnopenedDropIds()).toEqual([UUID_A]);

    // Another device opened it: the authoritative ledger reports it opened and
    // nothing unopened. The stale pending entry must disappear.
    skinSystem.applyCloudDropLedger({ unopened: [], opened: [UUID_A], tracks: [] });
    expect(skinSystem.getUnopenedDropIds()).toEqual([]);
    expect(skinSystem.getOpenedDropIds()).toEqual([UUID_A]);
  });

  it('replaces the pending set to EMPTY across devices without local awards', () => {
    skinSystem.applyCloudDropLedger({ unopened: [UUID_A, UUID_B], opened: [], tracks: [] });
    expect(skinSystem.getUnopenedDropIds()).toEqual([UUID_A, UUID_B]);
    // A cross-device reconcile with no local in-flight award clears the set.
    skinSystem.applyCloudDropLedger({ unopened: [], opened: [], tracks: [] });
    expect(skinSystem.getUnopenedDropIds()).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 6. Replay override / equip isolation
  // -------------------------------------------------------------------------
  it('never lets a replay skin preview become owned, pending or equipped', () => {
    const artifact = KARAMBIT_SKINS.find((s) => s.rarity === 'ARTIFACT')!;
    skinSystem.setReplaySkinPreview(artifact.id);
    expect(skinSystem.getReplaySkinPreviewId()).toBe(artifact.id);
    // Ephemeral preview only: no ownership, no equip, no persistence.
    expect(skinSystem.isSkinRewardOwned(artifact.id)).toBe(false);
    expect(skinSystem.getEquippedSkinId()).toBe('SIGNAL_CYAN');
    skinSystem.setReplaySkinPreview(null);
  });

  it('a server open cannot be overwritten by a concurrent equip of another id', async () => {
    skinSystem.mergeCloudDropAward(UUID_A);
    skinSystem.setStructuredDropOpener(async (id) => ({ dropId: id, cosmeticId: 'ASTRAL', kind: 'KNIFE' as const }));
    await skinSystem.openNextDrop();
    expect(skinSystem.isSkinRewardOwned('ASTRAL')).toBe(true);
    // Equipping is a SEPARATE concern and must not disturb the opened ledger.
    expect(skinSystem.equipSkin('ASTRAL')).toBe(true);
    expect(skinSystem.getEquippedSkinId()).toBe('ASTRAL');
    expect(skinSystem.getOpenedDropIds()).toEqual([UUID_A]);
  });

  // -------------------------------------------------------------------------
  // 7. Silent video lifecycle
  // -------------------------------------------------------------------------
  it('builds one muted, looping, playsInline decoder and releases it on unequip', () => {
    const artifact = KARAMBIT_SKINS.find((s) => s.rarity === 'ARTIFACT' && s.profile.videoPath)!;
    skinSystem.applyCloudProgression({ rewardOwnedSkinIds: [artifact.id] });

    const video = createVideoStub();
    const createElement = vi.fn(() => video as unknown as HTMLVideoElement);
    const originalDocument = (globalThis as any).document;
    Object.defineProperty(globalThis, 'document', { value: { createElement }, configurable: true });

    const mat = new KarambitCosmicMaterial();
    expect(skinSystem.equipSkin(artifact.id)).toBe(true);
    skinSystem.applyToMaterial(mat, artifact.id);

    expect(createElement).toHaveBeenCalledWith('video');
    expect(video.muted).toBe(true);
    expect(video.defaultMuted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.controls).toBe(false);
    expect(skinSystem.getActiveVideoCount()).toBe(1);

    // Re-applying the same skin must NOT build a second decoder.
    skinSystem.applyToMaterial(mat, artifact.id);
    expect(createElement).toHaveBeenCalledTimes(1);

    // Equipping away releases the decoder.
    expect(skinSystem.equipSkin('SIGNAL_CYAN')).toBe(true);
    expect((video.pause as any)).toHaveBeenCalled();
    expect((video.removeAttribute as any)).toHaveBeenCalledWith('src');
    expect(skinSystem.getActiveVideoCount()).toBe(0);

    mat.dispose();
    Object.defineProperty(globalThis, 'document', { value: originalDocument, configurable: true });
  });

  it('pause / release / resume never leaves more than one live decoder', () => {
    const artifact = KARAMBIT_SKINS.find((s) => s.rarity === 'ARTIFACT' && s.profile.videoPath)!;
    skinSystem.applyCloudProgression({ rewardOwnedSkinIds: [artifact.id] });

    const video = createVideoStub();
    let created = 0;
    const originalDocument = (globalThis as any).document;
    Object.defineProperty(globalThis, 'document', {
      value: { createElement: vi.fn(() => { created += 1; return video as unknown as HTMLVideoElement; }) },
      configurable: true
    });

    const mat = new KarambitCosmicMaterial();
    skinSystem.equipSkin(artifact.id);
    skinSystem.applyToMaterial(mat, artifact.id);
    expect(skinSystem.getActiveVideoCount()).toBe(1);

    // Suspend (leave the world) releases it without changing the equip.
    skinSystem.suspendActiveVideo();
    expect(skinSystem.getActiveVideoCount()).toBe(0);
    expect(skinSystem.getEquippedSkinId()).toBe(artifact.id);
    expect(video.pause).toHaveBeenCalled();

    // A later material application recreates exactly one decoder (resume).
    skinSystem.applyToMaterial(mat, artifact.id);
    expect(skinSystem.getActiveVideoCount()).toBe(1);
    expect(created).toBe(2);

    mat.dispose();
    Object.defineProperty(globalThis, 'document', { value: originalDocument, configurable: true });
  });
});
