/**
 * MASTERY GLOVE SYSTEM — derived ownership + the one thing worth persisting.
 *
 * OWNERSHIP IS DERIVED, NOT STORED.
 *
 * Eligibility is recomputed from the canonical catalog plus the authoritative
 * rank records on every read. There is no independent "unlocked" boolean to go
 * stale, so a cross-device or cloud migration can never lose an achievement the
 * player genuinely earned.
 *
 * Only two things persist:
 *   - the EQUIPPED glove id
 *   - a compact "recognized" ledger, used purely so the first launch after this
 *     feature ships can report how many historical achievements were recognised
 *     without firing a burst of reveals
 *
 * Gloves are never awarded by the Signal Decoder, never appear in a drop pool and
 * are never random. Nothing in this module is reachable from the drop economy.
 */

import { SignalPackCatalog } from '../audio/SignalPackCatalog';
import { KarambitSkinSystem } from '../viewmodel/KarambitSkinSystem';
import { getDropGlove, isDropGloveId } from '../viewmodel/DropGloveCatalog';
import {
  DEFAULT_MASTERY_GLOVE_ID,
  MasteryEvaluation,
  MasteryGloveId,
  MasteryProgress,
  MasterySummary,
  evaluateMastery,
  getMasteryGlove,
  isGloveSatisfied,
  MASTERY_GLOVES
} from './MasteryLadder';

const STORAGE_KEY_EQUIPPED = 'playhead.mastery.equippedGlove';
const STORAGE_KEY_RECOGNIZED = 'playhead.mastery.recognizedGloves';

export interface MasteryReconcileResult {
  /** Gloves satisfied now that were not in the recognized ledger before. */
  newlyRecognized: MasteryGloveId[];
  /** True on the very first reconcile after this feature shipped. */
  firstRecognition: boolean;
}

export class MasteryGloveSystem {
  private static instance: MasteryGloveSystem;

  /** Equipped glove id. Supports BOTH the mastery and Signal Drop namespaces. */
  private equippedGloveId: MasteryGloveId | string = DEFAULT_MASTERY_GLOVE_ID;
  /** DEV-only visual preview. NEVER writes ownership or progress. */
  /** DEV-only visual preview. Supports BOTH namespaces. */
  private devPreviewGloveId: string | null = null;
  private recognizedIds: MasteryGloveId[] = [];
  private lastReconcile: MasteryReconcileResult | null = null;
  private listeners = new Set<(gloveId: string) => void>();

  private constructor() {
    this.loadState();
  }

  public static getInstance(): MasteryGloveSystem {
    if (!MasteryGloveSystem.instance) {
      MasteryGloveSystem.instance = new MasteryGloveSystem();
    }
    return MasteryGloveSystem.instance;
  }

  // -- persistence ---------------------------------------------------------

  private loadState(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const equipped = localStorage.getItem(STORAGE_KEY_EQUIPPED);
      // Accept either namespace; unknown ids fall back safely on read.
      if (equipped && (MASTERY_GLOVES.some((g) => g.id === equipped) || isDropGloveId(equipped))) {
        this.equippedGloveId = equipped;
      }
      const raw = localStorage.getItem(STORAGE_KEY_RECOGNIZED);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          const valid = new Set(MASTERY_GLOVES.map((g) => g.id as string));
          this.recognizedIds = parsed.filter(
            (id): id is MasteryGloveId => typeof id === 'string' && valid.has(id)
          );
        }
      }
    } catch {
      /* localStorage is a convenience; derived ownership still works without it */
    }
  }

  private saveState(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_KEY_EQUIPPED, this.equippedGloveId);
      localStorage.setItem(STORAGE_KEY_RECOGNIZED, JSON.stringify(this.recognizedIds));
    } catch {
      /* best effort */
    }
  }

  // -- progress ------------------------------------------------------------

  /**
   * Authoritative progress: the LIVE canonical catalog plus the rank records the
   * official finish path writes. Custom Audio and the Movement Lab never write
   * here, so they can never satisfy a mastery requirement.
   */
  public getProgress(): MasteryProgress {
    return {
      trackIds: SignalPackCatalog.getTracks().map((t) => t.id),
      ranks: KarambitSkinSystem.getInstance().getTrackRecords()
    };
  }

  public evaluate(): MasteryEvaluation {
    return evaluateMastery(this.getProgress());
  }

  public getSummary(): MasterySummary {
    return this.evaluate().summary;
  }

  public isSatisfied(id: string): boolean {
    return isGloveSatisfied(id as MasteryGloveId, this.getProgress());
  }

  // -- equipped ------------------------------------------------------------

  public getEquippedGloveId(): MasteryGloveId | string {
    // SIGNAL DROP namespace: valid only while the glove is genuinely owned.
    if (isDropGloveId(this.equippedGloveId)) {
      const owned = KarambitSkinSystem.getInstance().isDropGloveOwned(this.equippedGloveId);
      return owned && getDropGlove(this.equippedGloveId) ? this.equippedGloveId : DEFAULT_MASTERY_GLOVE_ID;
    }
    // MASTERY namespace: valid only while the requirement is still satisfied.
    if (!this.isSatisfied(this.equippedGloveId)) return DEFAULT_MASTERY_GLOVE_ID;
    return this.equippedGloveId;
  }

  /**
   * Equips a glove from EITHER namespace.
   *
   * Mastery gloves require their achievement; Signal Drop gloves require
   * ownership. A mastery glove can never be equipped by owning it randomly, and
   * a drop glove can never be equipped by satisfying an achievement.
   */
  public equipAnyGlove(id: string): boolean {
    if (isDropGloveId(id)) {
      if (!getDropGlove(id)) return false;
      if (!KarambitSkinSystem.getInstance().isDropGloveOwned(id)) return false;
      if (id === this.equippedGloveId) return true;
      this.equippedGloveId = id;
      this.saveState();
      this.notify();
      return true;
    }
    // A mastery id must be a REAL ladder id: an unknown string must never silently
    // resolve to the default glove and report success.
    if (!MASTERY_GLOVES.some((g) => g.id === id)) return false;
    return this.equipGlove(id);
  }

  /** Where an equipped glove came from, for honest profile labelling. */
  public static gloveSource(id: string): 'MASTERY' | 'DROP' | 'UNKNOWN' {
    if (isDropGloveId(id)) return getDropGlove(id) ? 'DROP' : 'UNKNOWN';
    return MASTERY_GLOVES.some((g) => g.id === id) ? 'MASTERY' : 'UNKNOWN';
  }

  /** The glove the viewmodel should actually render (DEV preview wins). */
  public getEffectiveGloveId(): MasteryGloveId | string {
    if (this.devPreviewGloveId) return this.devPreviewGloveId;
    return this.getEquippedGloveId();
  }

  public equipGlove(id: string): boolean {
    const definition = getMasteryGlove(id);
    if (!this.isSatisfied(definition.id)) return false;
    if (definition.id === this.equippedGloveId) return true;
    this.equippedGloveId = definition.id;
    this.saveState();
    this.notify();
    return true;
  }

  /** Cloud reconciliation: adopt a remote equipped glove when it is valid. */
  public applyCloudEquippedGlove(id: string | undefined): void {
    if (!id) return;
    if (isDropGloveId(id)) {
      if (!getDropGlove(id)) return;
      if (!KarambitSkinSystem.getInstance().isDropGloveOwned(id)) return;
      if (id === this.equippedGloveId) return;
      this.equippedGloveId = id;
      this.saveState();
      this.notify();
      return;
    }
    const definition = getMasteryGlove(id);
    if (definition.id === DEFAULT_MASTERY_GLOVE_ID && id !== DEFAULT_MASTERY_GLOVE_ID) return;
    if (!this.isSatisfied(definition.id)) return;
    if (definition.id === this.equippedGloveId) return;
    this.equippedGloveId = definition.id;
    this.saveState();
    this.notify();
  }

  // -- DEV preview (never writes ownership or progress) --------------------

  public setDevPreview(id: string | null): void {
    if (id === null) {
      this.devPreviewGloveId = null;
    } else if (isDropGloveId(id)) {
      // A drop glove is previewable by id, even before it is owned.
      this.devPreviewGloveId = getDropGlove(id) ? id : null;
    } else if (MASTERY_GLOVES.some((g) => g.id === id)) {
      this.devPreviewGloveId = id as MasteryGloveId;
    } else {
      this.devPreviewGloveId = null;
    }
    this.notify();
  }

  public getDevPreviewGloveId(): string | null {
    return this.devPreviewGloveId;
  }

  public isDevPreview(): boolean {
    return this.devPreviewGloveId !== null;
  }

  // -- migration -----------------------------------------------------------

  /**
   * Reconciles the recognized ledger with current derived eligibility.
   *
   * On the first launch after this feature ships, an existing player may already
   * satisfy several tiers. Rather than firing a burst of reveals, this reports a
   * single compact count and lets the Armory show the individual gloves.
   */
  public reconcile(): MasteryReconcileResult {
    const evaluation = this.evaluate();
    const recognized = new Set(this.recognizedIds);
    const firstRecognition = recognized.size === 0 && this.recognizedIds.length === 0;

    const newlyRecognized = evaluation.unlockedIds.filter((id) => !recognized.has(id));
    if (newlyRecognized.length > 0) {
      this.recognizedIds = [...evaluation.unlockedIds];
      this.saveState();
    }

    // A player who has not yet earned anything still gets a clean ledger once,
    // so the summary is only ever shown for genuine historical recognition.
    if (firstRecognition && newlyRecognized.length === 0) {
      this.recognizedIds = [...evaluation.unlockedIds];
      this.saveState();
    }

    this.lastReconcile = { newlyRecognized, firstRecognition };
    return { newlyRecognized, firstRecognition };
  }
  public getRecognizedIds(): MasteryGloveId[] {
    return [...this.recognizedIds];
  }

  /** Last reconcile result, for a compact first-launch recognition notice. */
  public getLastReconcile(): MasteryReconcileResult | null {
    return this.lastReconcile;
  }

  // -- listeners -----------------------------------------------------------

  public addListener(fn: (gloveId: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    const id = this.getEffectiveGloveId();
    for (const fn of this.listeners) {
      try {
        fn(id);
      } catch (error) {
        console.warn('[MasteryGloveSystem] listener failed:', error);
      }
    }
  }

  /** Test/DEV helper: forget persisted state. */
  public resetForTests(): void {
    this.equippedGloveId = DEFAULT_MASTERY_GLOVE_ID;
    this.devPreviewGloveId = null;
    this.recognizedIds = [];
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY_EQUIPPED);
        localStorage.removeItem(STORAGE_KEY_RECOGNIZED);
      }
    } catch {
      /* ignore */
    }
  }
}

export const masteryGloveSystem = MasteryGloveSystem.getInstance();
